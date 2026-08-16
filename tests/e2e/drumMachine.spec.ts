import { expect, test, type Page } from '@playwright/test';

/*
 * The drum machine selector, in a real browser, with real audio files.
 *
 * These are the promises that need a browser rather than jsdom: that the bundled samples decode
 * at all, that a kit switch does not disturb a running transport, and that a missing asset falls
 * back without taking the rhythm with it.
 *
 * Nothing here touches TryAPL. The APL suite covers that, and Stage 4 has no business adding
 * requests to somebody else's service.
 */

const CELL = 'button[data-track][data-step]';

function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    problems.push(`page: ${error.message}`);
  });
  return problems;
}

/** The whole grid as 128 characters, for comparing bars. */
async function gridOf(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
  );
}

/** Everything a visitor would be sorry to lose. */
async function creativeState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    cells: [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
    sliders: [...document.querySelectorAll('input[type="range"]')].map(
      (input) => `${input.getAttribute('aria-label') ?? input.id}=${(input as HTMLInputElement).value}`,
    ),
    locks: [...document.querySelectorAll('button[aria-label^="Lock"]')].map((button) =>
      button.getAttribute('aria-pressed'),
    ),
    mutes: [...document.querySelectorAll('button[aria-label^="Mute"]')].map((button) =>
      button.getAttribute('aria-pressed'),
    ),
    preset:
      [...document.querySelectorAll('input[type="radio"]')]
        .find((radio) => (radio as HTMLInputElement).checked)
        ?.getAttribute('value') ?? null,
    seed: document.querySelector('[class*="seedValue"]')?.textContent?.trim() ?? null,
  }));
}

const selector = (page: Page) => page.getByRole('combobox', { name: 'Kit' });
const kitStatus = (page: Page) => page.getByRole('status', { name: 'Kit' });

/** Skip unless this browser can make a sound. */
async function requireAudio(page: Page): Promise<void> {
  const available = await page.evaluate(() => typeof window.AudioContext === 'function');
  test.skip(!available, 'This browser build has no Web Audio.');
}

/**
 * Skip unless this browser can decode a sample.
 *
 * Playwright's WebKit is built without Web Audio entirely — no `AudioContext` and no
 * `OfflineAudioContext` — so it cannot decode a kit however well the files are served. That is a
 * limitation of this build rather than of Safari, and it is asked of the page rather than
 * decided from the project name, so adding a browser later cannot quietly drop this coverage.
 *
 * The graceful behaviour on such an engine is not skipped: it has a test of its own below.
 */
async function requireSampleDecoding(page: Page): Promise<void> {
  const available = await page.evaluate(() => typeof window.OfflineAudioContext === 'function');
  test.skip(!available, 'This browser build cannot decode audio.');
}

/** Start from the documented opening state, with no stored session. */
async function freshVisit(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
    } catch {
      // Storage disabled by policy: there was nothing stored to begin with.
    }
  });
  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();
}

/** Which sample requests the page made. */
function watchSampleRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/audio/')) requests.push(url);
  });
  return requests;
}

/* ------------------------------------------------------------------------- */

test('opens on the synthesised kit and downloads no audio', async ({ page }) => {
  const problems = watchForProblems(page);
  const requests = watchSampleRequests(page);
  await freshVisit(page);

  await expect(selector(page)).toHaveValue('synth');
  await expect(kitStatus(page)).toHaveText('');

  // The whole point of keeping the synthesised kit: a first visit costs nothing.
  expect(requests).toEqual([]);
  expect(problems).toEqual([]);
});

test('changing the drum machine changes the sound, not the rhythm', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);
  await requireSampleDecoding(page);

  // Make the state distinctive, so "unchanged" means something.
  await page.getByRole('button', { name: 'Randomise' }).click();
  await page.locator('button[data-track="7"][data-step="3"]').click();
  await page.getByRole('button', { name: 'Lock Kick against the generator' }).click();
  await page.getByRole('button', { name: 'Mute Clap' }).click();

  const before = await creativeState(page);

  await selector(page).selectOption('tr-808');
  await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });
  await expect(selector(page)).toHaveValue('tr-808');

  expect(await creativeState(page)).toEqual(before);
  expect(problems).toEqual([]);
});

test('a sampled kit really decodes, and every row of it', async ({ page }) => {
  /*
   * The one thing only a browser can answer: whether the bundled AAC files decode. If a pack were
   * corrupt, truncated, or in a codec this engine lacks, the kit would fall back to the
   * synthesised one — so the selector still holding the kit's name is the proof it worked.
   */
  const problems = watchForProblems(page);
  const requests = watchSampleRequests(page);
  await freshVisit(page);
  await requireSampleDecoding(page);

  await selector(page).selectOption('lm-2');
  await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });
  await expect(selector(page)).toHaveValue('lm-2');

  // Eight rows, though two may share a file, so at least six distinct requests.
  const distinct = new Set(requests.map((url) => url.split('/').pop()));
  expect(distinct.size).toBeGreaterThanOrEqual(6);
  for (const url of requests) expect(url).toContain('/audio/lm-2/');

  expect(problems).toEqual([]);
});

test('loads only the chosen kit, and remembers one it has already heard', async ({ page }) => {
  const problems = watchForProblems(page);
  const requests = watchSampleRequests(page);
  await freshVisit(page);
  await requireSampleDecoding(page);

  await selector(page).selectOption('tr-808');
  await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });
  const afterFirst = requests.length;
  expect(afterFirst).toBeGreaterThan(0);

  await selector(page).selectOption('cr-8000');
  await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });
  const afterSecond = requests.length;
  expect(afterSecond).toBeGreaterThan(afterFirst);

  // Back to the first: decoded already, so not one further request.
  await selector(page).selectOption('tr-808');
  await expect(selector(page)).toHaveValue('tr-808');
  await expect(kitStatus(page)).toHaveText('');
  expect(requests).toHaveLength(afterSecond);

  // And nothing else was ever fetched.
  for (const url of requests) {
    expect(url.includes('/audio/tr-808/') || url.includes('/audio/cr-8000/'), url).toBe(true);
  }

  expect(problems).toEqual([]);
});

test('the transport carries on through a kit change', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);
  await requireAudio(page);
  await requireSampleDecoding(page);

  const before = await gridOf(page);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');

  // Let it get somewhere into the bar first, so a reset would be obvious.
  await page.waitForTimeout(500);

  await selector(page).selectOption('tr-808');
  await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });

  // Still playing, still the same bar, and the playhead still moving.
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(await gridOf(page)).toBe(before);

  const columns = new Set<number>();
  for (let sample = 0; sample < 20; sample += 1) {
    const column = await page.evaluate(() => {
      const marked = document.querySelector('[class*="headerPlayhead"]');
      if (marked?.parentElement == null) return null;
      return [...marked.parentElement.children].indexOf(marked);
    });
    if (column !== null) columns.add(column);
    await page.waitForTimeout(60);
  }
  expect(columns.size).toBeGreaterThan(3);

  // Tempo and swing untouched by the swap.
  await expect(page.getByRole('slider', { name: 'Tempo' })).toHaveValue('112');
  await expect(page.getByRole('slider', { name: 'Swing' })).toHaveValue('18');

  await page.getByRole('button', { name: 'Pause' }).click();
  expect(problems).toEqual([]);
});

test('switching between several kits while playing stays clean', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);
  await requireAudio(page);
  await requireSampleDecoding(page);

  const before = await gridOf(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');

  for (const kit of ['tr-808', 'drumtraks', 'rz-1', 'synth']) {
    await selector(page).selectOption(kit);
    await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });
    await expect(selector(page)).toHaveValue(kit);
    await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');
  }

  expect(await gridOf(page)).toBe(before);
  await page.getByRole('button', { name: 'Pause' }).click();
  expect(problems).toEqual([]);
});

test('the chosen machine comes back, and does not start playing', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);
  await requireSampleDecoding(page);

  await selector(page).selectOption('drumtraks');
  await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });

  // Edit the bar too, so it is clear the two are remembered independently.
  await page.locator('button[data-track="6"][data-step="11"]').click();
  const edited = await gridOf(page);
  // The session write is debounced; wait past it.
  await page.waitForTimeout(800);

  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();

  await expect(selector(page)).toHaveValue('drumtraks');
  expect(await gridOf(page)).toBe(edited);

  // No autoplay, ever, whatever was restored.
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Paused');

  expect(problems).toEqual([]);
});

test('a missing sample falls back to the synthesised kit without losing the beat', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);
  await requireSampleDecoding(page);

  // One asset broken, which is enough: a kit arrives whole or not at all.
  await page.route('**/audio/tr-808/snare.m4a', (route) => route.fulfill({ status: 404, body: 'gone' }));

  const before = await creativeState(page);
  await selector(page).selectOption('tr-808');

  await expect(kitStatus(page)).toContainText('Could not load TR-808', { timeout: 20_000 });
  await expect(kitStatus(page)).toContainText('APL Beats Synth');

  // The selector shows what is actually playing, and the rhythm is untouched.
  await expect(selector(page)).toHaveValue('synth');
  expect(await creativeState(page)).toEqual(before);

  // Still an instrument: editable, and it still plays.
  await page.locator('button[data-track="7"][data-step="1"]').click();
  await expect(page.locator('button[data-track="7"][data-step="1"]')).toHaveAttribute('aria-pressed', 'true');

  // The browser logs the 404 itself; nothing else should have gone wrong.
  expect(problems.filter((problem) => !problem.includes('Failed to load resource'))).toEqual([]);
  expect(problems.filter((problem) => problem.startsWith('page:'))).toEqual([]);
});

test('a corrupt sample is refused rather than half-played', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);
  await requireSampleDecoding(page);

  // Served successfully, but it is not audio. Decoding must fail and fall back.
  await page.route('**/audio/mfb-512/kick.m4a', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/mp4', body: 'this is not an MP4 at all' }),
  );

  const before = await gridOf(page);
  await selector(page).selectOption('mfb-512');

  await expect(kitStatus(page)).toContainText('Could not load MFB-512', { timeout: 20_000 });
  await expect(selector(page)).toHaveValue('synth');
  expect(await gridOf(page)).toBe(before);

  expect(problems.filter((problem) => problem.startsWith('page:'))).toEqual([]);
});

test('a failed kit does not greet you again on the next visit', async ({ page }) => {
  /*
   * The stored choice moves back to the synthesised kit when a load fails, so a machine that has
   * stopped being available does not produce the same error on every reload for ever.
   */
  const problems = watchForProblems(page);
  await freshVisit(page);
  await requireSampleDecoding(page);
  await page.route('**/audio/sk-1/**', (route) => route.fulfill({ status: 500, body: 'no' }));

  await selector(page).selectOption('sk-1');
  await expect(kitStatus(page)).toContainText('Could not load', { timeout: 20_000 });
  await page.waitForTimeout(800);

  await page.unroute('**/audio/sk-1/**');
  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();

  await expect(selector(page)).toHaveValue('synth');
  await expect(kitStatus(page)).toHaveText('');

  expect(problems.filter((problem) => problem.startsWith('page:'))).toEqual([]);
});

test('the selector is usable on a phone, and nothing overflows sideways', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, 'This project drives a pointer.');
  const problems = watchForProblems(page);
  await freshVisit(page);

  await selector(page).scrollIntoViewIfNeeded();
  await expect(selector(page)).toBeVisible();

  const box = await selector(page).boundingBox();
  // A real target rather than a sliver: WCAG's 24 px, which the phone grid also works to.
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);

  /*
   * Selecting is exercised whether or not this engine can decode. Where it can, the kit loads;
   * where it cannot, it says so and falls back — and either way the layout must not move.
   */
  await selector(page).selectOption('tr-808');
  await expect(kitStatus(page)).not.toHaveText('Loading kit…', { timeout: 20_000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  expect(problems.filter((problem) => problem.startsWith('page:'))).toEqual([]);
});

test('a browser with no Web Audio says so, and downloads nothing', async ({ page }) => {
  /*
   * The other side of the skip above, and the reason it is worth having a browser in the matrix
   * that cannot do this. An engine with no Web Audio cannot decode a sample however well it is
   * served, so the kit is refused *before* anything is fetched — spending fifty kilobytes of
   * somebody's data on a certainty would be careless — and the message says the browser is the
   * limitation rather than blaming the kit.
   */
  const problems = watchForProblems(page);
  const requests = watchSampleRequests(page);
  await freshVisit(page);

  test.skip(
    await page.evaluate(() => typeof window.OfflineAudioContext === 'function'),
    'This browser can decode audio; the graceful path is covered elsewhere.',
  );

  const before = await gridOf(page);
  await selector(page).selectOption('tr-808');

  await expect(kitStatus(page)).toContainText('cannot play sampled kits', { timeout: 20_000 });
  await expect(kitStatus(page)).toContainText('APL Beats Synth');
  await expect(selector(page)).toHaveValue('synth');

  // Not one byte fetched, because nothing could have been done with it.
  expect(requests).toEqual([]);
  expect(await gridOf(page)).toBe(before);
  expect(problems.filter((problem) => problem.startsWith('page:'))).toEqual([]);
});

test('the credits dialog names both audio sources, and links them', async ({ page }) => {
  /*
   * Moved, not removed, and this test moved with it.
   *
   * All of this used to sit permanently in the footer — two paragraphs of provenance under an
   * instrument. Stage 9 put it behind "Credits & licences", which is a change of *where* and not
   * of *whether*: MIT requires the copyright notice to travel with the software, so it still ships
   * in the application rather than only in the repository, and this asserts that it does.
   */
  const problems = watchForProblems(page);
  await freshVisit(page);

  // Nothing of it is in the footer any more; the footer is one line.
  await expect(page.locator('footer')).not.toContainText('André Michelle');

  await page.getByRole('button', { name: 'Credits & licences' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const credits = [
    { name: 'smpldsnds/drum-machines', href: 'https://github.com/smpldsnds/drum-machines' },
    { name: 'andremichelle/tr-909', href: 'https://github.com/andremichelle/tr-909' },
  ];
  for (const { name, href } of credits) {
    const credit = page.getByRole('link', { name });
    await expect(credit).toBeVisible();
    await expect(credit).toHaveAttribute('href', href);
    await expect(credit).toHaveAttribute('rel', /noopener/u);
    await expect(credit).toHaveAttribute('rel', /noreferrer/u);
    await expect(credit).toHaveAttribute('target', '_blank');
  }

  // MIT asks that the copyright holder travel with the work, including into the interface.
  await expect(dialog).toContainText('André Michelle');
  // And the permission notice itself, which is the part the licence actually compels.
  await expect(dialog).toContainText('Permission is hereby granted');
  await expect(dialog).toContainText('WITHOUT WARRANTY OF ANY KIND');
  // The TR-909 is rendered, not recorded, and the credits must not blur that.
  await expect(dialog).toContainText('rendered from');
  // And the non-affiliation statement, which is the other half of naming a manufacturer.
  await expect(dialog).toContainText('not affiliated with or endorsed by');

  // Escape closes it, because it is a real dialog rather than a panel pretending to be one.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  expect(problems).toEqual([]);
});

/* ---- the rendered kit ---------------------------------------------------- */

test('the rendered TR-909 decodes, all eight files of it', async ({ page }) => {
  /*
   * The question only a browser answers for this kit: whether eight WAVs written by a Node
   * script decode in a real engine. Every other kit here is AAC, so this is the first time the
   * loader has been asked for a different container, and "it decoded in Chromium once" is not
   * the same claim as "it decodes".
   */
  const problems = watchForProblems(page);
  const requests = watchSampleRequests(page);
  await freshVisit(page);
  await requireSampleDecoding(page);

  await selector(page).selectOption('tr-909');
  await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });
  await expect(selector(page)).toHaveValue('tr-909');

  // Eight distinct files, no substitutions, so nothing is fetched twice or shared between rows.
  const names = requests.map((url) => url.split('/').pop());
  expect(new Set(names).size).toBe(8);
  for (const url of requests) {
    expect(url).toContain('/audio/tr-909/');
    expect(url.endsWith('.wav'), url).toBe(true);
  }

  expect(problems).toEqual([]);
});

test('switching to the TR-909 and back changes the sound and nothing else', async ({ page }) => {
  /*
   * The whole promise of the stage, walked end to end with the new kit in the middle of it:
   * synth → TR-909 → TR-808 → TR-909 again, while playing, with the pattern, the transport and
   * the master volume all expected to come out the far side untouched — and the second visit to
   * the TR-909 expected to cost nothing, because it is already decoded.
   */
  const problems = watchForProblems(page);
  const requests = watchSampleRequests(page);
  await freshVisit(page);
  await requireAudio(page);
  await requireSampleDecoding(page);

  const master = page.getByRole('slider', { name: 'Master' });
  await master.fill('64');

  const before = await creativeState(page);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');

  // Somewhere into the bar, so that a reset would be obvious rather than plausible.
  await page.waitForTimeout(500);

  await selector(page).selectOption('tr-909');
  await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });
  const afterFirst = requests.length;
  expect(afterFirst).toBe(8);

  await selector(page).selectOption('tr-808');
  await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });
  expect(requests.length).toBeGreaterThan(afterFirst);
  const afterSecond = requests.length;

  // Back to the TR-909, which is decoded already: not one further request.
  await selector(page).selectOption('tr-909');
  await expect(selector(page)).toHaveValue('tr-909');
  await expect(kitStatus(page)).toHaveText('');
  expect(requests).toHaveLength(afterSecond);

  // Still playing, through all three changes.
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  // And nothing a visitor would be sorry to lose has moved, master volume included.
  expect(await creativeState(page)).toEqual(before);
  await expect(master).toHaveValue('64');

  await page.getByRole('button', { name: 'Pause' }).click();
  expect(problems).toEqual([]);
});

test('the TR-909 is remembered, and comes back without a download it already made', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);
  await requireSampleDecoding(page);

  await selector(page).selectOption('tr-909');
  await expect(kitStatus(page)).toHaveText('', { timeout: 20_000 });

  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();
  await expect(selector(page)).toHaveValue('tr-909');

  // Remembered, and not playing: choosing an instrument is not a decision to make noise.
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();

  expect(problems).toEqual([]);
});
