/*
 * Check that what is published actually works.
 *
 * CI proving a commit passes its tests is not the same as the published site being
 * that commit and serving every asset it needs. A base path resolved wrongly, a
 * Content-Security-Policy that blocks a script, a Pages deployment that half
 * succeeded: none of those fail a test run, and all of them fail a visitor.
 *
 *   npm run verify:deployment                 the full check, one live TryAPL request
 *   npm run verify:deployment -- --no-apl     everything except that request
 *   npm run verify:deployment -- https://example.com/somewhere/
 *
 * Exits non-zero on anything wrong, so it can gate a release.
 *
 * **This makes one real request to TryAPL**, and it is the only check that can: whether the
 * deployed origin is allowed to talk to tryapl.org is a fact about CORS and about the
 * published Content-Security-Policy, and neither can be established from a mock or from
 * localhost. It is one request, it is counted, and it is printed. Run by hand, never by CI.
 */

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const url = args.find((argument) => !argument.startsWith('--')) ?? 'https://dragnim.github.io/aplbeats/';
const checkApl = !args.includes('--no-apl');

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
const status = await page.getByRole('status', { name: 'Playback' }).innerText();
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

/* ---- APL, for real, from the published origin ----------------------------- */

/*
 * The check nothing else can make.
 *
 * The end-to-end suite mocks the endpoint, so it proves the product flow and says nothing about
 * whether the browser will *allow* the request from https://dragnim.github.io — which depends on
 * TryAPL's CORS headers and on the Content-Security-Policy as actually served. Those are
 * properties of the deployment, so they are checked against the deployment, once.
 *
 * Since Stage 5 the one request goes through **Explore** rather than through a fixed control,
 * because that path proves strictly more: the editor, the wrapping of a hand-written expression,
 * the CSP, CORS, real Dyalog execution, the parser, installation, and Undo. A second request for
 * the fixed controls would prove a subset of the same boundary.
 */
let aplRequests = 0;

if (checkApl) {
  page.on('request', (request) => {
    if (request.url().startsWith('https://tryapl.org')) aplRequests += 1;
  });

  const panel = page.getByRole('region', { name: 'Transform with APL' });
  const aplStatus = page.getByRole('status', { name: 'APL transform' });
  const exploreStatus = page.getByRole('status', { name: 'Explore' });

  await panel.scrollIntoViewIfNeeded();

  // Peek first, then Explore. Neither may send anything.
  await page.getByRole('button', { name: 'Peek at the APL' }).click();
  const core = (await panel.locator('pre code').first().innerText()).trim();
  console.log(`  Peek shows: ${core}`);

  await page.getByRole('button', { name: 'Edit this APL' }).click();
  const editor = page.getByRole('textbox', { name: 'Your APL expression' });
  const opened = (await editor.inputValue()).trim();
  console.log(`  Explore opens on: ${opened}`);
  if (opened !== core) note(`the editor opened on "${opened}" but Peek shows "${core}"`);
  if (aplRequests !== 0) note(`opening Explore sent ${String(aplRequests)} request(s); it must send none`);

  /*
   * An expression no fixed control could have produced: a rim wherever the kick plays and the
   * snare does not. It reads two rows and writes a third, which is the whole argument for
   * Explore existing.
   */
  await page.getByLabel('Result goes to').selectOption('7');
  await editor.fill('m[0;]∧~m[1;]');
  if (aplRequests !== 0) note(`typing sent ${String(aplRequests)} request(s); it must send none`);

  const beforeApl = await gridOf();
  await page.getByRole('button', { name: 'Run this APL' }).click();

  try {
    await exploreStatus
      .filter({ hasText: /Applied|unavailable|too long|unexpected|could not|cannot/ })
      .waitFor({ timeout: 30_000 });
  } catch {
    note('the custom expression never reported an outcome within 30s');
  }

  const said = (await exploreStatus.innerText()).trim();
  const afterApl = await gridOf();
  console.log(`  live TryAPL requests: ${String(aplRequests)}`);
  console.log(`  Explore said: ${said}`);

  if (aplRequests !== 1) note(`expected exactly 1 request, counted ${String(aplRequests)}`);
  if (said !== 'Applied.') note(`custom APL did not run from the published origin: "${said}"`);

  // The rim row should now be the kick, minus anything the snare is doing.
  const rows = [...beforeApl.matchAll(/.{16}/gu)].map((row) => row[0]);
  const kick = rows[0] ?? '';
  const snare = rows[1] ?? '';
  const expectedRim = [...kick]
    .map((cell, step) => (cell === '1' && snare[step] !== '1' ? '1' : '0'))
    .join('');
  const actualRim = afterApl.slice(7 * 16);
  console.log(`  the rim is the kick without the snare: ${String(actualRim === expectedRim)}`);
  if (actualRim !== expectedRim) {
    note(`the rim row is ${actualRim}, expected ${expectedRim}`);
  }
  // And nothing else moved.
  if (afterApl.slice(0, 7 * 16) !== beforeApl.slice(0, 7 * 16)) {
    note('a custom expression targeting one row changed another');
  }

  // Undo restores it, on the published site as everywhere else.
  await page.getByRole('button', { name: 'Undo' }).click();
  if ((await gridOf()) !== beforeApl) note('Undo did not restore the pattern after a custom run');

  // The fixed control is still there and still says nothing it did not do.
  if ((await aplStatus.innerText()).trim() !== '') {
    note('the fixed transform reported an outcome it did not produce');
  }
}

await browser.close();

if (problems.length > 0) {
  console.error('\nProblems:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    checkApl
      ? `\nThe published site loads clean, opens on its groove, plays, and ran hand-written APL in ${String(aplRequests)} request.`
      : '\nThe published site loads clean, opens on its groove and plays. APL was not checked.',
  );
}
