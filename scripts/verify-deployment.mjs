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
 * Since Stage 6 that one request is a **generation**, not a transform and not a hand-written
 * expression. All three cross the same boundary — CSP, CORS, real Dyalog, the parser,
 * installation, Undo — so proving it three times would be three requests to learn one thing.
 * Generation is the one worth spending it on: it is what this stage shipped, and it is the only
 * path that also proves a seeded `⎕RL` survives the round trip from the published origin.
 *
 * There are four recipes. This makes one request, not four. Whether Cross runs given that Four on
 * Floor does is a question about Dyalog, not about the deployment, and `verify:apl-generators-live`
 * is where it is asked.
 */
let aplRequests = 0;

if (checkApl) {
  page.on('request', (request) => {
    if (request.url().startsWith('https://tryapl.org')) aplRequests += 1;
  });

  const panel = page.getByRole('region', { name: 'Create with APL' });
  const createStatus = page.getByRole('status', { name: 'APL generation' });
  const aplStatus = page.getByRole('status', { name: 'APL transform' });

  // Create is a tab rather than a card on the page, and only the selected workspace is rendered.
  await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Create' }).click();
  await panel.scrollIntoViewIfNeeded();

  /* ---- everything except the button, which must cost nothing ---- */

  const SEED = '47291';
  await panel.getByLabel('Recipe').selectOption('broken');
  await panel.getByLabel('Seed').fill(SEED);
  await panel.getByRole('button', { name: 'New APL seed' }).click();
  await panel.getByLabel('Seed').fill(SEED);
  await panel.getByRole('button', { name: 'Peek at the APL' }).click();

  const core = (await panel.locator('pre code').first().innerText()).trim();
  console.log(`  Peek shows: ${core}`);
  if (aplRequests !== 0) {
    note(`the Create controls sent ${String(aplRequests)} request(s); they must send none`);
  }

  // Peek must show the seed. It is most of the reason the result can be reproduced.
  const request = (await panel.locator('pre code').nth(1).innerText()).trim();
  if (!request.includes(`⎕RL←${SEED} 1`)) {
    note(`Peek's full request does not fix ⎕RL to the seed: ${request.replaceAll('\n', ' ⋄ ')}`);
  }

  /* ---- the one request ---- */

  const beforeApl = await gridOf();
  const playingBefore = (await page.getByRole('status', { name: 'Playback' }).innerText()).trim();
  const tempoBefore = await page.getByRole('slider', { name: 'Tempo' }).inputValue();
  const swingBefore = await page.getByRole('slider', { name: 'Swing' }).inputValue();
  const masterBefore = await page.getByRole('slider', { name: 'Master' }).inputValue();

  await page.getByRole('button', { name: 'Generate with APL' }).click();

  try {
    await createStatus
      .filter({ hasText: /Generated|unavailable|too long|unexpected|could not|cannot|no difference/ })
      .waitFor({ timeout: 30_000 });
  } catch {
    note('the generation never reported an outcome within 30s');
  }

  const said = (await createStatus.innerText()).trim();
  const afterApl = await gridOf();
  console.log(`  live TryAPL requests: ${String(aplRequests)}`);
  console.log(`  Create said: ${said}`);

  if (aplRequests !== 1) note(`expected exactly 1 request, counted ${String(aplRequests)}`);
  if (said !== 'Generated.') note(`APL did not generate from the published origin: "${said}"`);

  /* ---- what came back, and what did not move ---- */

  const hits = [...afterApl].filter((cell) => cell === '1').length;
  console.log(`  the generated bar has ${String(hits)} hits`);
  if (afterApl.length !== 128) note(`the installed bar is ${String(afterApl.length)} cells, expected 128`);
  if (afterApl === beforeApl) note('the generated bar is identical to the one that was there');
  if (hits === 0) note('the generated bar is empty');

  // A generation replaces the rhythm and nothing else.
  const playingAfter = (await page.getByRole('status', { name: 'Playback' }).innerText()).trim();
  if (playingAfter !== playingBefore)
    note(`the transport moved from "${playingBefore}" to "${playingAfter}"`);
  if ((await page.getByRole('slider', { name: 'Tempo' }).inputValue()) !== tempoBefore) {
    note('generating changed the tempo');
  }
  if ((await page.getByRole('slider', { name: 'Swing' }).inputValue()) !== swingBefore) {
    note('generating changed the swing');
  }
  if ((await page.getByRole('slider', { name: 'Master' }).inputValue()) !== masterBefore) {
    note('generating changed the master volume');
  }

  /* ---- one Undo, and no second request ---- */

  await page.getByRole('button', { name: 'Undo' }).click();
  if ((await gridOf()) !== beforeApl) note('Undo did not restore the pattern after a generation');
  if (aplRequests !== 1) note(`Undo cost a request; the count is now ${String(aplRequests)}`);

  // The transform panel is still there and still says nothing it did not do.
  if ((await aplStatus.innerText()).trim() !== '') {
    note('the transform panel reported an outcome it did not produce');
  }
}

/* ---- Tones, from the published origin -------------------------------------- */

/*
 * Two things the deployment can break that nothing else can.
 *
 * The first is the *paths*. Twenty-eight WAV files are served from the same origin under
 * `/aplbeats/audio/tones/`, and a base path that is right in the dev server and wrong in the
 * published bundle is a silent seven-404 failure — which is exactly the bug this layer shipped
 * with locally before it was caught. Costs no TryAPL request at all.
 *
 * The second is one melody generation, and it is worth its request for a reason the Beats one
 * does not cover: the *reply shape* is different. A rhythm comes back as eight lines of ones and
 * zeros and a melody as one line of MIDI numbers, so they go through different parsers — and a
 * parser that works against a mock and not against real Dyalog's printing is a real failure mode.
 * One request, once, from the published origin.
 */
console.log('\nTones:');

let sampleRequests = 0;
let sampleFailures = 0;
page.on('response', (response) => {
  if (!response.url().includes('/audio/tones/')) return;
  sampleRequests += 1;
  if (!response.ok()) {
    sampleFailures += 1;
    note(`a Tone sample did not load: ${response.url()} (${String(response.status())})`);
  }
});

await page.getByRole('tablist', { name: 'Layer' }).getByRole('tab', { name: 'Tones' }).click();

const pads = page.getByRole('group', { name: 'Melody steps' });
await pads.waitFor({ timeout: 15_000 });
const padCount = await pads.getByRole('button').count();
console.log(`  melody steps: ${String(padCount)}`);
if (padCount !== 16) note(`expected 16 melody steps, found ${String(padCount)}`);

const toneStatus = page.getByRole('status', { name: 'Tone sound' });
try {
  await page.waitForResponse((response) => response.url().includes('/audio/tones/'), { timeout: 15_000 });
} catch {
  note('no Tone sample was requested when Tones was opened');
}
await page.waitForLoadState('networkidle');

console.log(`  sample requests: ${String(sampleRequests)}, failures: ${String(sampleFailures)}`);
if (sampleRequests === 0) note('the Tone sound was never fetched');

const toneMessage = (await toneStatus.innerText()).trim();
if (toneMessage !== '') {
  console.log(`  status line: ${toneMessage}`);
  note(`the Tone sound reported: ${toneMessage}`);
}

if (checkApl) {
  const before = await page.locator('[class*="vectorValue"]').innerText();
  console.log(`  melody before: ${before.trim()}`);

  await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Create' }).click();
  const tonePanel = page.getByRole('region', { name: 'Create a melody with APL' });
  await tonePanel.waitFor();

  await tonePanel.getByLabel('Recipe').selectOption('riff');
  await tonePanel.getByLabel('Seed').fill('47291');
  const requestsBefore = aplRequests;

  await tonePanel.getByRole('button', { name: 'Generate a melody with APL' }).click();

  const melodyStatus = page.getByRole('status', { name: 'APL melody generation' });
  try {
    await melodyStatus
      .filter({ hasText: /Generated|unavailable|too long|unexpected|could not|cannot|no difference/ })
      .waitFor({ timeout: 30_000 });
  } catch {
    note('the melody generation never reported an outcome within 30s');
  }

  const outcome = (await melodyStatus.innerText()).trim();
  console.log(`  ${outcome}`);
  if (!/^Generated/u.test(outcome)) note(`the melody generation reported: ${outcome}`);

  await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Play' }).click();
  const after = (await page.locator('[class*="vectorValue"]').innerText()).trim();
  console.log(`  melody after:  ${after}`);
  if (after === before.trim()) note('the generated melody did not replace the one that was there');

  console.log(`  requests spent on the melody: ${String(aplRequests - requestsBefore)}`);
  if (aplRequests - requestsBefore !== 1) {
    note(`the melody generation cost ${String(aplRequests - requestsBefore)} requests, not 1`);
  }

  await page.getByRole('button', { name: 'Undo' }).click();
  const undoneMelody = (await page.locator('[class*="vectorValue"]').innerText()).trim();
  if (undoneMelody !== before.trim()) note('Undo did not restore the melody');
}

await browser.close();

if (problems.length > 0) {
  console.error('\nProblems:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    checkApl
      ? `\nThe published site loads clean, opens on its groove, plays, serves its ${String(sampleRequests)} Tone samples, and generated both a rhythm and a melody in real Dyalog APL in ${String(aplRequests)} requests.`
      : `\nThe published site loads clean, opens on its groove, plays and serves its ${String(sampleRequests)} Tone samples. APL was not checked.`,
  );
}
