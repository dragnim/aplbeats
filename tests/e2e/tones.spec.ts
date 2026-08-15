import { expect, test, type Page } from '@playwright/test';

/*
 * Tones, in a browser.
 *
 * Stage 8 added a second layer of music and a second set of tabs above the ones Stage 7 added,
 * and the promise made about them is unusually specific: **switching layers is visual and nothing
 * else**. Not "usually harmless", not "fast" — it must make no request, fetch nothing it has
 * already fetched, stop no playback and lose no work. That is the kind of claim a suite testing
 * only the musical behaviour would let rot, so it is asserted here directly.
 *
 * The other half is what a melody editor can break that a rhythm editor cannot: pitches. A step
 * has a *value*, so there is an editor row, arrow keys that move a note by a semitone, and a
 * vector readout that has to agree with all of it.
 *
 * What is not tested here is sound. Playwright cannot hear, and a test that asserted an
 * `AudioBufferSourceNode` was constructed would be asserting an implementation. The scheduling —
 * which is the part that could genuinely go wrong — is proved in `tests/unit/toneTransport.test.ts`,
 * to a tenth of a millisecond.
 */

const CELL = 'button[data-track][data-step]';

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

/**
 * Skip unless this browser can make a sound.
 *
 * Playwright's WebKit is built without Web Audio, so it has no `OfflineAudioContext` either — and
 * the Tone loader deliberately checks for one *before* fetching, because downloading three
 * megabytes that can never be decoded is three megabytes of somebody's data spent on a certainty.
 * So on that build nothing is fetched, correctly, and there is nothing here to assert.
 *
 * Asked of the page rather than decided from the project's name, so a browser added later cannot
 * quietly drop this coverage without anybody noticing.
 */
async function requireAudio(page: Page): Promise<void> {
  const available = await page.evaluate(
    () => typeof window.AudioContext === 'function' && typeof window.OfflineAudioContext === 'function',
  );
  test.skip(!available, 'This browser build has no Web Audio.');
}

/** Requests to TryAPL, counted. Passive interface work must make none. */
function watchApl(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://tryapl.org')) seen.push(request.url());
  });
  return seen;
}

/** Requests for Tone samples, counted. Nothing until Tones is opened; nothing twice. */
function watchSamples(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/audio/tones/')) seen.push(request.url());
  });
  return seen;
}

const layer = (page: Page, name: 'Beats' | 'Tones') =>
  page.getByRole('tablist', { name: 'Layer' }).getByRole('tab', { name, exact: true });
const workspace = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name, exact: true });
const pad = (page: Page, step: number) =>
  page.getByRole('button', { name: new RegExp(`^Step ${String(step)},`, 'u') });

/* ---- the layer tabs ------------------------------------------------------ */

test('Beats and Tones are real tabs, and Beats is where you land', async ({ page }) => {
  await freshVisit(page);

  const list = page.getByRole('tablist', { name: 'Layer' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('tab')).toHaveCount(2);

  // Beats first, because that is what somebody came for.
  await expect(layer(page, 'Beats')).toHaveAttribute('aria-selected', 'true');
  await expect(layer(page, 'Tones')).toHaveAttribute('aria-selected', 'false');
  // Horizontal at every width, so it needs none of the measuring the rail below it does.
  await expect(list).toHaveAttribute('aria-orientation', 'horizontal');
});

test('arrow keys move between layers, and the list wraps', async ({ page }) => {
  await freshVisit(page);

  await layer(page, 'Beats').focus();
  await page.keyboard.press('ArrowRight');
  await expect(layer(page, 'Tones')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowRight');
  await expect(layer(page, 'Beats')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('End');
  await expect(layer(page, 'Tones')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(layer(page, 'Beats')).toHaveAttribute('aria-selected', 'true');
});

test('each layer shows its own instrument, and only that one', async ({ page }) => {
  await freshVisit(page);

  await expect(page.locator(CELL)).toHaveCount(128);

  await layer(page, 'Tones').click();
  await expect(page.getByRole('group', { name: 'Melody steps' })).toBeVisible();
  // One layer at a time: the drum grid is gone, not merely hidden.
  await expect(page.locator(CELL)).toHaveCount(0);

  await layer(page, 'Beats').click();
  await expect(page.locator(CELL)).toHaveCount(128);
  await expect(page.getByRole('group', { name: 'Melody steps' })).toHaveCount(0);
});

test('switching layers makes no request and does not stop the music', async ({ page }) => {
  /*
   * The load-bearing promise of the stage, asserted directly. Anything else would make the tabs a
   * mode, and modes in a musical instrument are how you lose a take.
   */
  await freshVisit(page);
  await requireAudio(page);
  const apl = watchApl(page);

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  for (let round = 0; round < 3; round += 1) {
    await layer(page, 'Tones').click();
    await layer(page, 'Beats').click();
  }

  // Still playing, and nothing was asked of TryAPL.
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(apl, `TryAPL requests: ${apl.join(', ')}`).toHaveLength(0);
});

test('each layer remembers which tool it had open', async ({ page }) => {
  await freshVisit(page);

  await workspace(page, 'Transform').click();
  await expect(page.getByRole('button', { name: 'Apply with APL' })).toBeVisible();

  await layer(page, 'Tones').click();
  // The Tones side starts on its own Play, rather than inheriting the Beats tab.
  await expect(workspace(page, 'Play')).toHaveAttribute('aria-selected', 'true');

  await workspace(page, 'Create').click();
  await layer(page, 'Beats').click();
  // And coming back finds the Beats transform, not Play.
  await expect(workspace(page, 'Transform')).toHaveAttribute('aria-selected', 'true');

  await layer(page, 'Tones').click();
  await expect(workspace(page, 'Create')).toHaveAttribute('aria-selected', 'true');
});

/* ---- the samples --------------------------------------------------------- */

test('nothing is downloaded until Tones is opened, and nothing twice', async ({ page }) => {
  /*
   * Somebody who came for the drums and never opened the melody should pay none of its 2.9 MB —
   * and somebody who opened it once should not pay again for glancing back at the kick.
   */
  const samples = watchSamples(page);
  await freshVisit(page);
  await requireAudio(page);

  await page.getByRole('button', { name: 'Randomise' }).click();
  expect(samples, 'fetched before Tones was ever opened').toHaveLength(0);

  await layer(page, 'Tones').click();
  await expect.poll(() => samples.length).toBeGreaterThan(0);

  const afterFirst = samples.length;
  await layer(page, 'Beats').click();
  await layer(page, 'Tones').click();
  await page.waitForTimeout(300);
  expect(samples).toHaveLength(afterFirst);
});

/* ---- editing a melody ---------------------------------------------------- */

test('a step carries its pitch in its name, not only in its picture', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  // The opening melody: C4 on step 1, and a rest on the backbeat.
  await expect(pad(page, 1)).toHaveAccessibleName('Step 1, C4');
  await expect(pad(page, 5)).toHaveAccessibleName('Step 5, rest');
});

test('arrow keys move a note by a semitone, and the vector agrees', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  // Scoped to the Tones panel: the transport bar has readouts of its own, and a bare selector
  // would match a tempo before it matched a melody.
  const vector = page.getByRole('region', { name: 'Tones' }).locator('pre');
  await expect(vector).toContainText('60 0 0 63');

  await pad(page, 1).focus();
  await page.keyboard.press('ArrowUp');
  await expect(pad(page, 1)).toHaveAccessibleName('Step 1, C♯4');
  // The readout is the same data, so it has to move with it — that is the whole demonstration.
  await expect(vector).toContainText('61 0 0 63');

  await page.keyboard.press('PageUp');
  await expect(pad(page, 1)).toHaveAccessibleName('Step 1, C♯5');
  await expect(vector).toContainText('73 0 0 63');
});

test('a rest becomes a note, and a note becomes a rest', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await pad(page, 2).click();
  await expect(pad(page, 2)).toHaveAccessibleName('Step 2, C4');

  await page.keyboard.press('Backspace');
  await expect(pad(page, 2)).toHaveAccessibleName('Step 2, rest');
});

test('the editor row acts on the step you selected', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await pad(page, 4).click();
  await expect(pad(page, 4)).toHaveAccessibleName('Step 4, D♯4');

  await page.getByRole('button', { name: 'Step 4 up an octave' }).click();
  await expect(pad(page, 4)).toHaveAccessibleName('Step 4, D♯5');

  await page.getByRole('button', { name: 'Step 4 down a semitone' }).click();
  await expect(pad(page, 4)).toHaveAccessibleName('Step 4, D5');
});

test('arrow keys walk the bar without leaving it', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await pad(page, 1).focus();
  await page.keyboard.press('ArrowRight');
  await expect(pad(page, 2)).toBeFocused();

  await page.keyboard.press('End');
  await expect(pad(page, 16)).toBeFocused();
  // The end is the end: a melody has sixteen steps and there is no seventeenth to reach.
  await page.keyboard.press('ArrowRight');
  await expect(pad(page, 16)).toBeFocused();

  await page.keyboard.press('Home');
  await expect(pad(page, 1)).toBeFocused();
});

/* ---- Undo, across both layers ------------------------------------------- */

test('one Undo covers both layers, and takes back whatever was last', async ({ page }) => {
  await freshVisit(page);

  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeDisabled();

  // A drum edit, then a melody edit.
  const cell = page.locator(CELL).nth(2);
  await cell.click();
  await expect(undo).toBeEnabled();

  await layer(page, 'Tones').click();
  await pad(page, 1).focus();
  await page.keyboard.press('ArrowUp');
  await expect(pad(page, 1)).toHaveAccessibleName('Step 1, C♯4');

  // The melody comes back first, because it was the last thing changed.
  await undo.click();
  await expect(pad(page, 1)).toHaveAccessibleName('Step 1, C4');

  // And the drum edit is still there until the next press.
  await layer(page, 'Beats').click();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
});

/* ---- what is remembered -------------------------------------------------- */

test('the melody and its instrument survive a reload', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await pad(page, 3).click();
  await expect(pad(page, 3)).toHaveAccessibleName('Step 3, C4');

  await page.getByLabel('Sound', { exact: true }).selectOption('bass');
  // The write is debounced, so give it the half second it waits for.
  await page.waitForTimeout(800);

  await page.reload();
  await layer(page, 'Tones').click();
  await expect(pad(page, 3)).toHaveAccessibleName('Step 3, C4');
  await expect(page.getByLabel('Sound', { exact: true })).toHaveValue('bass');
});

/* ---- the APL tools ------------------------------------------------------- */

test('the melody has its own three APL tools, and its own Explore draft', async ({ page }) => {
  await freshVisit(page);
  const apl = watchApl(page);

  await layer(page, 'Beats').click();
  await workspace(page, 'Explore').click();
  await page.getByLabel('Your APL expression').fill('2⌽m');

  await layer(page, 'Tones').click();
  await workspace(page, 'Explore').click();
  // A different editor holding a different program: switching layers must not replace one with
  // the other, because that would destroy somebody's work on every switch.
  await expect(page.getByLabel('Your APL expression')).not.toHaveValue('2⌽m');
  await page.getByLabel('Your APL expression').fill('⌽n');

  await layer(page, 'Beats').click();
  await expect(page.getByLabel('Your APL expression')).toHaveValue('2⌽m');
  await layer(page, 'Tones').click();
  await expect(page.getByLabel('Your APL expression')).toHaveValue('⌽n');

  // None of that asked anything of TryAPL. Writing is free; only Run costs a request.
  expect(apl, `TryAPL requests: ${apl.join(', ')}`).toHaveLength(0);
});

test('the melody Peek shows the vector and the notes together, without a request', async ({ page }) => {
  await freshVisit(page);
  const apl = watchApl(page);

  await layer(page, 'Tones').click();
  await workspace(page, 'Transform').click();
  await page.getByRole('button', { name: 'Peek at the APL' }).click();

  const peek = page.locator('[id$="-peek"]').first();
  // Transpose is where the Tone transform controls start, so this is the expression on offer.
  await expect(peek).toContainText('(48⌈84⌊n+5)×0<n');
  // The melody as APL holds it, and as a musician reads it — which is what stops "a tune is a
  // vector of numbers" from being a claim somebody has to take on faith.
  await expect(peek).toContainText('60 0 0 63');
  await expect(peek).toContainText('C4');

  expect(apl, `TryAPL requests: ${apl.join(', ')}`).toHaveLength(0);
});

test('the melody Create controls cost nothing until Generate is pressed', async ({ page }) => {
  await freshVisit(page);
  const apl = watchApl(page);

  await layer(page, 'Tones').click();
  await workspace(page, 'Create').click();

  await page.getByLabel('Recipe').selectOption('sparse');
  await page.getByLabel('Scale').selectOption('dorian');
  await page.getByLabel('Root').selectOption('62');
  await page.getByRole('button', { name: 'New melody seed' }).click();
  await page.getByRole('button', { name: 'Peek at the APL' }).click();

  expect(apl, `TryAPL requests: ${apl.join(', ')}`).toHaveLength(0);
});
