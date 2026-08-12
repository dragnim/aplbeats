/*
 * Check that what is published actually works.
 *
 * CI proving a commit passes its tests is not the same as the published site being
 * that commit and serving every asset it needs. A base path resolved wrongly, a
 * Content-Security-Policy that blocks a script, a Pages deployment that half
 * succeeded: none of those fail a test run, and all of them fail a visitor.
 *
 *   npm run verify:deployment
 *   npm run verify:deployment -- https://example.com/somewhere/
 *
 * Exits non-zero on anything wrong, so it can gate a release.
 */

import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'https://dragnim.github.io/aplbeats/';

const problems = [];
const note = (message) => {
  problems.push(message);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') note(`console error: ${message.text()}`);
});
page.on('pageerror', (error) => {
  note(`page error: ${error.message}`);
});
page.on('requestfailed', (request) => {
  note(`failed request: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
});
page.on('response', (response) => {
  if (response.status() >= 400) note(`HTTP ${String(response.status())}: ${response.url()}`);
});

console.log(`Checking ${url}`);

const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
if (response === null || !response.ok()) {
  note(`the page itself returned ${response === null ? 'nothing' : String(response.status())}`);
}

console.log(`  title: ${await page.title()}`);

// The application mounted, which means the bundle loaded from the right base path.
const cells = await page.locator('button[data-track][data-step]').count();
console.log(`  steps rendered: ${String(cells)}`);
if (cells !== 128) note(`expected 128 steps, found ${String(cells)}`);

const active = await page.locator('button[data-track][data-step][aria-pressed="true"]').count();
console.log(`  steps active in the opening groove: ${String(active)}`);
if (active !== 32) note(`expected the opening groove's 32 triggers, found ${String(active)}`);

// Nothing autoplays.
const status = await page.locator('[role="status"]').innerText();
console.log(`  transport on arrival: ${status}`);
if (status !== 'Paused') note(`expected a paused transport on arrival, found "${status}"`);

// And it starts, and the playhead moves off the audio clock.
await page.getByRole('button', { name: 'Play', exact: true }).click();
const columns = new Set();
for (let sample = 0; sample < 20; sample += 1) {
  const column = await page.evaluate(() => {
    const marked = document.querySelector('[class*="headerPlaying"]');
    if (marked?.parentElement == null) return null;
    return [...marked.parentElement.children].indexOf(marked);
  });
  if (column !== null) columns.add(column);
  await page.waitForTimeout(70);
}
console.log(`  playhead visited ${String(columns.size)} columns in 1.4s`);
if (columns.size < 4) note(`the playhead barely moved: ${String(columns.size)} columns`);

/* ---- the generative controls are live ------------------------------------ */

const gridOf = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
  );

const seedOf = () => page.locator('[class*="seedValue"]').innerText();

await page.getByRole('button', { name: 'Pause' }).click();

const beforeRandomise = await gridOf();
const seedBefore = (await seedOf()).trim();
await page.getByRole('button', { name: 'Randomise' }).click();

const afterRandomise = await gridOf();
const seedAfter = (await seedOf()).trim();
console.log(`  Randomise changed the grid: ${String(afterRandomise !== beforeRandomise)}`);
console.log(`  Randomise drew a new seed: ${seedBefore} -> ${seedAfter}`);
if (afterRandomise === beforeRandomise) note('Randomise did not change the pattern');
if (seedAfter === seedBefore) note('Randomise did not draw a new seed');

await page.getByRole('button', { name: 'Undo' }).click();
const undone = await gridOf();
console.log(`  Undo restored it: ${String(undone === beforeRandomise)}`);
if (undone !== beforeRandomise) note('Undo did not restore the pattern');

// Ten presses, ten different bars: the product promise of the whole stage.
const seen = new Set();
for (let press = 0; press < 10; press += 1) {
  await page.getByRole('button', { name: 'Randomise' }).click();
  seen.add(await gridOf());
}
console.log(`  ten Randomise presses gave ${String(seen.size)} distinct bars`);
if (seen.size < 9) note(`repeated Randomise produced only ${String(seen.size)} distinct bars`);

const presets = await page.getByRole('radio').count();
console.log(`  presets offered: ${String(presets)}`);
if (presets !== 8) note(`expected 8 presets, found ${String(presets)}`);

await browser.close();

if (problems.length > 0) {
  console.error('\nProblems:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nThe published site loads clean, opens on its groove and plays.');
}
