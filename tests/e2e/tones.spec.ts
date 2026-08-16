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
 * The other half is what a Tone editor can break that a rhythm editor cannot: pitches. A step
 * has a *value*, so there is a keyboard down the left, arrow keys that walk the grid, and a
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
/*
 * One cell of the Tone matrix, by row and step.
 *
 * By data attribute rather than by accessible name, because the name of a cell is now the *row* —
 * "Step 3, D♯" — and twelve of those share a column. The name is what a screen reader hears and is
 * asserted on its own below; this is how a test says which square it means.
 */
const cell = (page: Page, row: number, step: number) =>
  page.locator(`[data-row="${String(row)}"][data-step="${String(step - 1)}"]`);

/** Whichever cell sounds in a column — none, or exactly one, because the sampler is monophonic. */
const sounding = (page: Page, step: number) =>
  page.locator(`[data-step="${String(step - 1)}"][aria-pressed="true"]`);

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
  await expect(page.getByRole('group', { name: 'Tone steps' })).toBeVisible();
  // One layer at a time: the drum grid is gone, not merely hidden.
  await expect(page.locator(CELL)).toHaveCount(0);

  await layer(page, 'Beats').click();
  await expect(page.locator(CELL)).toHaveCount(128);
  await expect(page.getByRole('group', { name: 'Tone steps' })).toHaveCount(0);
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
   * Somebody who came for the drums and never opened Tones should pay none of the sound's
   * 724 KB — and somebody who opened it once should not pay again for glancing back at the kick.
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

/* ---- editing a phrase ---------------------------------------------------- */

test('a note carries its pitch and its octave in its name', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  // The opening phrase: C4 on step 1, and a rest on the backbeat.
  await expect(sounding(page, 1)).toHaveAccessibleName('Step 1, C4');
  await expect(sounding(page, 5)).toHaveCount(0);

  // An empty cell names its row and no octave, because it has none to name until it sounds.
  await expect(cell(page, 7, 5)).toHaveAccessibleName('Step 5, G');
});

test('C3, C4, C5 and C6 share one row and differ by their badge', async ({ page }) => {
  /*
   * The load-bearing claim of the whole editor. Twelve rows hold a thirty-seven semitone
   * instrument because a row is a pitch *class*, so four octaves of C are one row and four
   * different names.
   */
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await cell(page, 0, 2).click();
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, C4');

  await page.getByRole('button', { name: 'Step 2 up an octave' }).click();
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, C5');
  await page.getByRole('button', { name: 'Step 2 up an octave' }).click();
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, C6');

  // Still the C row, four octaves later — MIDI 84 has a home rather than being a thirteenth row.
  await expect(cell(page, 0, 2)).toHaveAttribute('aria-pressed', 'true');
});

test('placing a note in the grid moves the vector with it', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  // Scoped to the Tones panel: the transport bar has readouts of its own, and a bare selector
  // would match a tempo before it matched a phrase.
  const vector = page.getByRole('region', { name: 'Tones' }).locator('pre');
  await expect(vector).toContainText('60 0 0 63');

  // The C♯ row on step 1: one row up from the C that is there, so one semitone up.
  await cell(page, 1, 1).click();
  await expect(sounding(page, 1)).toHaveAccessibleName('Step 1, C♯4');
  // The readout is the same data, so it has to move with it — that is the whole demonstration.
  await expect(vector).toContainText('61 0 0 63');

  await page.keyboard.press('PageUp');
  await expect(sounding(page, 1)).toHaveAccessibleName('Step 1, C♯5');
  await expect(vector).toContainText('73 0 0 63');
});

test('a column holds one note: clicking another row moves it', async ({ page }) => {
  /*
   * Monophonic, shown rather than explained. Nothing is erased first and nothing stacks — the
   * note is simply somewhere else, in one gesture.
   */
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await expect(sounding(page, 4)).toHaveAccessibleName('Step 4, D♯4');

  await cell(page, 7, 4).click();
  await expect(sounding(page, 4)).toHaveAccessibleName('Step 4, G4');
  await expect(page.locator('[data-step="3"][aria-pressed="true"]')).toHaveCount(1);
  await expect(cell(page, 3, 4)).toHaveAttribute('aria-pressed', 'false');
});

test('a rest becomes a note, and a note becomes a rest', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await cell(page, 0, 2).click();
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, C4');

  // Clicking the lit cell again clears the column, and so does Backspace.
  await cell(page, 0, 2).click();
  await expect(sounding(page, 2)).toHaveCount(0);

  await cell(page, 0, 2).click();
  await page.keyboard.press('Backspace');
  await expect(sounding(page, 2)).toHaveCount(0);
});

test('the strip below offers octaves, and only octaves', async ({ page }) => {
  /*
   * The one thing the grid cannot say. A click chooses a pitch *class*, so the octave has to come
   * from somewhere else — while the semitone buttons the strip used to carry are what the grid is
   * *for*: the row above is one semitone, and offering a button for it was admitting the grid did
   * not work.
   */
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await cell(page, 0, 2).click();
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, C4');

  await page.getByRole('button', { name: 'Step 2 up an octave' }).click();
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, C5');

  await page.getByRole('button', { name: 'Step 2 down an octave' }).click();
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, C4');

  // A semitone is a row, not a button.
  await expect(page.getByRole('button', { name: /semitone/u })).toHaveCount(0);

  // And the row below C is B, an actual semitone down, reached by clicking it.
  await cell(page, 11, 2).click();
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, B4');
});

test('arrow keys walk the grid without leaving it', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await cell(page, 0, 1).focus();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 0, 2)).toBeFocused();

  // Up and Down move between rows. They no longer edit — that is what Space and the row below do.
  await page.keyboard.press('ArrowUp');
  await expect(cell(page, 1, 2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 0, 2)).toBeFocused();

  // The bottom is the bottom: C is the lowest row and there is nothing under it.
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 0, 2)).toBeFocused();

  await page.keyboard.press('End');
  await expect(cell(page, 0, 16)).toBeFocused();
  // The end is the end: a phrase has sixteen steps and there is no seventeenth to reach.
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 0, 16)).toBeFocused();

  await page.keyboard.press('Home');
  await expect(cell(page, 0, 1)).toBeFocused();
});

test('the grid is one tab stop, not a hundred and ninety-two', async ({ page }) => {
  // The same bargain the drum grid makes. Sixteen tab presses to get past a bar would be bad;
  // a hundred and ninety-two would be an interface nobody could use with a keyboard at all.
  requireRoomToDraw();
  await freshVisit(page);
  await layer(page, 'Tones').click();

  const reachable = page.locator('[data-row][data-step][tabindex="0"]');
  await expect(reachable).toHaveCount(1);
});

/**
 * Skip where a synthetic stroke cannot physically reach the cells it needs.
 *
 * Not a capability check — pointer events work in every project. It is geometry, and the axis that
 * matters is *width*, because width is what decides whether the transport lays out in one row or
 * stacks. Narrow, it stacks into roughly 325px of sticky header; the free space left below it is
 * shorter than the twelve-row grid, so a stroke spanning several rows would have to begin under
 * the header, where `elementFromPoint` correctly finds the header rather than the step. A finger
 * scrolls and then draws what it can see; `page.mouse` fires at coordinates and cannot.
 *
 * Written against width rather than a project name, and it caught its own first draft: that one
 * asked for height ≥ 800 and skipped the desktop project — 1280 × 720 — while happily running on a
 * Pixel 7, which is 412 × 839. Exactly the two it was meant to separate, the wrong way round.
 *
 * So the plumbing is proved on the desktop viewport, and what a stroke *decides* — what it paints,
 * which octave it holds, what it replaces — is `paintValue`, covered in every project by
 * `tests/unit/toneMatrix.test.ts`.
 */
function requireRoomToDraw(): void {
  const viewport = test.info().project.use.viewport;
  const wide = viewport === undefined || viewport === null || viewport.width >= 1024;
  test.skip(!wide, 'The grid does not fit clear of the stacked transport at this width.');
}

/* ---- drawing with a pointer ---------------------------------------------- */

/**
 * Drag from one cell to another, through every cell between them.
 *
 * The real thing rather than a synthetic sequence: a press, a run of moves along the line, and a
 * release. The moves are what the component hit-tests, so a drag written as "down here, up there"
 * would prove nothing at all — it is the crossing that has to paint.
 */
async function drawThrough(page: Page, path: readonly (readonly [number, number])[]): Promise<void> {
  /*
   * Scrolled into view first, and that is not a nicety.
   *
   * `click()` scrolls to its target; `page.mouse` does not — it fires at whatever coordinates it
   * is given. On a phone-sized viewport the grid sits below the fold, so boxes computed without
   * this describe a cell at y=738 in a 664px window, the press lands on nothing, and the failure
   * reads as "the note never appeared" rather than "the test aimed off the screen".
   */
  const [firstRow, firstStep] = path[0] ?? [0, 0];
  await cell(page, firstRow, firstStep).scrollIntoViewIfNeeded();

  const boxes = [];
  for (const [row, step] of path) {
    const box = await cell(page, row, step).boundingBox();
    if (box === null) throw new Error(`no box for row ${String(row)} step ${String(step)}`);
    /*
     * The grid scrolls sideways on a phone, so a step past the fold has a box the pointer can
     * never reach. Left unchecked that surfaces as a baffling assertion failure about a note that
     * did not appear; caught here it says which step the path asked for and could not have.
     */
    const view = page.viewportSize();
    const offScreen =
      view !== null &&
      (box.x < 0 || box.y < 0 || box.x + box.width > view.width || box.y + box.height > view.height);
    if (offScreen) {
      throw new Error(
        `row ${String(row)} step ${String(step + 1)} is outside the viewport — a stroke cannot reach it`,
      );
    }
    boxes.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }

  const first = boxes[0];
  if (first === undefined) return;

  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of boxes.slice(1)) {
    // Two samples per cell, so the test also exercises "already inside, do not rewrite".
    await page.mouse.move(point.x, point.y, { steps: 2 });
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.up();
}

/** The phrase as the panel prints it — the data, not the picture. */
const vectorOf = async (page: Page): Promise<string> =>
  ((await page.getByRole('region', { name: 'Tones' }).locator('pre').innerText()) ?? '').trim();

test('dragging across the grid draws a phrase', async ({ page }) => {
  requireRoomToDraw();
  await freshVisit(page);
  await layer(page, 'Tones').click();

  /*
   * C, D, E, G across steps 2 to 5 — a rising line, drawn in one stroke.
   *
   * Begun on step 2, which is a rest, because a stroke that began on a note would be an erase.
   * Step 4 already sounds D♯4 and is drawn straight through: it keeps its own octave and becomes
   * E4, which is the rule that lets a line be drawn across an existing phrase without transposing
   * it. Every step is inside the narrowest viewport, so the same stroke is possible on a phone.
   */
  await drawThrough(page, [
    [0, 2],
    [2, 3],
    [4, 4],
    [7, 5],
  ]);

  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, C4');
  await expect(sounding(page, 3)).toHaveAccessibleName('Step 3, D4');
  await expect(sounding(page, 4)).toHaveAccessibleName('Step 4, E4');
  await expect(sounding(page, 5)).toHaveAccessibleName('Step 5, G4');
});

test('a diagonal drag changes pitch class with every step', async ({ page }) => {
  requireRoomToDraw();
  await freshVisit(page);
  await layer(page, 'Tones').click();

  const apl = watchApl(page);

  await drawThrough(page, [
    [0, 6],
    [1, 7],
    [2, 8],
    [3, 9],
  ]);

  await expect(sounding(page, 6)).toHaveAccessibleName('Step 6, C4');
  await expect(sounding(page, 7)).toHaveAccessibleName('Step 7, C♯4');
  await expect(sounding(page, 8)).toHaveAccessibleName('Step 8, D4');
  await expect(sounding(page, 9)).toHaveAccessibleName('Step 9, D♯4');

  // Drawing is local arithmetic and must cost nothing.
  expect(apl, `TryAPL requests: ${apl.join(', ')}`).toHaveLength(0);
});

test('a stroke stays in the octave it began in', async ({ page }) => {
  /*
   * The anchor is frozen at pointer-down. Were it to follow the last note placed, this line —
   * which crosses the top of the grid and comes back to the bottom — would step down an octave
   * each time it wrapped, and a long diagonal could wander out of the range entirely.
   */
  requireRoomToDraw();
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await drawThrough(page, [
    [11, 1],
    [0, 2],
    [11, 3],
    [0, 4],
  ]);

  await expect(sounding(page, 1)).toHaveAccessibleName('Step 1, B4');
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, C4');
  await expect(sounding(page, 3)).toHaveAccessibleName('Step 3, B4');
  await expect(sounding(page, 4)).toHaveAccessibleName('Step 4, C4');
});

test('drawing over an existing note replaces it rather than stacking', async ({ page }) => {
  requireRoomToDraw();
  await freshVisit(page);
  await layer(page, 'Tones').click();

  // Step 4 opens on D♯4. Draw straight through it on the G row.
  await expect(sounding(page, 4)).toHaveAccessibleName('Step 4, D♯4');

  await drawThrough(page, [
    [7, 3],
    [7, 4],
    [7, 5],
  ]);

  await expect(sounding(page, 4)).toHaveAccessibleName('Step 4, G4');
  // Still one note in the column, because a column holds one note.
  await expect(page.locator('[data-step="3"][aria-pressed="true"]')).toHaveCount(1);
});

test('one drag is one Undo, however many steps it crossed', async ({ page }) => {
  requireRoomToDraw();
  await freshVisit(page);
  await layer(page, 'Tones').click();

  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeDisabled();

  const before = await vectorOf(page);

  await drawThrough(page, [
    [9, 1],
    [9, 2],
    [9, 3],
    [9, 4],
    [9, 5],
  ]);

  const after = await vectorOf(page);
  expect(after).not.toBe(before);

  // One press, and the whole line is gone — not five presses for five steps.
  await undo.click();
  expect(await vectorOf(page)).toBe(before);
  await expect(undo).toBeDisabled();
});

test('crossing a cell twice in one stroke does not edit it twice', async ({ page }) => {
  /*
   * Asserted through Undo, because that is where a duplicate would show: two writes to the same
   * step inside one gesture still coalesce into one entry, but a wobble that rewrote a cell would
   * also re-preview it, and the guard that stops one stops the other.
   */
  requireRoomToDraw();
  await freshVisit(page);
  await layer(page, 'Tones').click();

  const undo = page.getByRole('button', { name: 'Undo' });
  const before = await vectorOf(page);

  // Out along the A row and straight back over the same cells.
  await drawThrough(page, [
    [9, 6],
    [9, 7],
    [9, 8],
    [9, 7],
    [9, 6],
  ]);

  await expect(sounding(page, 6)).toHaveAccessibleName('Step 6, A4');
  await expect(sounding(page, 7)).toHaveAccessibleName('Step 7, A4');
  await expect(sounding(page, 8)).toHaveAccessibleName('Step 8, A4');

  await undo.click();
  expect(await vectorOf(page)).toBe(before);
});

test('the stroke ends with the pointer, and moving after it paints nothing', async ({ page }) => {
  requireRoomToDraw();
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await drawThrough(page, [
    [5, 2],
    [5, 3],
  ]);
  const after = await vectorOf(page);

  // The pointer is up. Moving across the grid now must change nothing.
  const far = await cell(page, 8, 10).boundingBox();
  if (far !== null) await page.mouse.move(far.x + far.width / 2, far.y + far.height / 2);
  const alsoFar = await cell(page, 8, 12).boundingBox();
  if (alsoFar !== null) await page.mouse.move(alsoFar.x + alsoFar.width / 2, alsoFar.y + alsoFar.height / 2);

  expect(await vectorOf(page)).toBe(after);
});

test('beginning a stroke on a note erases across the steps it crosses', async ({ page }) => {
  requireRoomToDraw();
  await freshVisit(page);
  await layer(page, 'Tones').click();

  // The opening phrase sounds on steps 1, 4, 6, 9, 12 and 14.
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(6);

  /*
   * Begin on the note at step 1 and drag along the C row to step 6.
   *
   * Erasing follows the *column*, not the row: the notes at steps 4 and 6 are on the D♯ and G rows
   * and the stroke never touches those rows, but it crosses their columns and they go. Anything
   * else would mean tracing each note exactly, which is not a gesture anybody can perform.
   */
  await drawThrough(page, [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [0, 6],
  ]);

  for (const step of [1, 4, 6]) {
    await expect(sounding(page, step), `step ${String(step)}`).toHaveCount(0);
  }
  // The three past the stroke are untouched: an erase clears what it crosses and nothing else.
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(3);
});

test('a single click still edits one step, as it always did', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await cell(page, 4, 3).click();
  await expect(sounding(page, 3)).toHaveAccessibleName('Step 3, E4');

  await cell(page, 4, 3).click();
  await expect(sounding(page, 3)).toHaveCount(0);
});

test('the keyboard still edits, so drawing is something gained and nothing lost', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  // Tab order, arrow keys, then Space — none of which involves a pointer at all.
  await cell(page, 0, 2).focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, D4');

  await page.keyboard.press('PageUp');
  await expect(sounding(page, 2)).toHaveAccessibleName('Step 2, D5');

  await page.keyboard.press('Backspace');
  await expect(sounding(page, 2)).toHaveCount(0);

  // And Enter activates as well as Space.
  await page.keyboard.press('Enter');
  await expect(sounding(page, 2)).toHaveCount(1);
});

/* ---- the note reacting to being played ---------------------------------- */

test('only the note under the playhead is struck, and only while playing', async ({ page }) => {
  await freshVisit(page);
  await requireAudio(page);
  await layer(page, 'Tones').click();

  const struck = page.locator('[aria-pressed="true"] > span[class*="struck"]');

  // Stopped: the playhead is parked on step 1, and nothing is being struck.
  await expect(struck).toHaveCount(0);

  await page.getByRole('button', { name: 'Play' }).click();

  /*
   * At most one at a time, and always on a step that sounds.
   *
   * Sampled rather than caught at one instant, because the playhead moves every 134ms and a single
   * assertion would be a race. What must hold on every sample is the invariant: never two, and
   * never on a rest — a rest has no block to strike.
   */
  const restSteps = [2, 3, 5, 7, 8, 10, 11, 13, 15, 16];
  for (let sample = 0; sample < 12; sample += 1) {
    const count = await struck.count();
    expect(count, 'a struck note at a time').toBeLessThanOrEqual(1);

    for (const step of restSteps) {
      await expect(page.locator(`[data-step="${String(step - 1)}"] span[class*="struck"]`)).toHaveCount(0);
    }
    await page.waitForTimeout(70);
  }

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(struck).toHaveCount(0);
});

test('the pulse is paint only, so the bar cannot twitch sideways', async ({ page }) => {
  /*
   * A CSS transform would have been the obvious way to make a note pop, and it would have
   * pushed the scroll width of the grid out once a step. The animation is background and
   * box-shadow, neither of which takes part in layout.
   */
  await freshVisit(page);
  await requireAudio(page);
  await layer(page, 'Tones').click();

  const widthOf = async () =>
    page.evaluate(() => document.querySelector('[aria-label="Tone steps"]')?.parentElement?.scrollWidth ?? 0);

  const before = await widthOf();
  await page.getByRole('button', { name: 'Play' }).click();

  for (let sample = 0; sample < 8; sample += 1) {
    expect(await widthOf(), 'the grid must not grow while notes are struck').toBe(before);
    await page.waitForTimeout(60);
  }

  await page.getByRole('button', { name: 'Pause' }).click();
});

test('reduced motion keeps the state and drops the animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freshVisit(page);
  await requireAudio(page);
  await layer(page, 'Tones').click();

  const animation = await page.evaluate(() => {
    const note = document.querySelector('[aria-pressed="true"] > span');
    if (note === null) return null;
    note.classList.add(
      [...note.classList].find((name) => name.includes('note'))?.replace('note', 'struck') ?? 'struck',
    );
    return getComputedStyle(note).animationName;
  });

  // Whatever else is true, nothing is animating.
  expect(animation === null || animation === 'none').toBe(true);
});

/* ---- Undo, across both layers ------------------------------------------- */

test('one Undo covers both layers, and takes back whatever was last', async ({ page }) => {
  await freshVisit(page);

  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeDisabled();

  // A drum edit, then a phrase edit.
  const drumCell = page.locator(CELL).nth(2);
  await drumCell.click();
  await expect(undo).toBeEnabled();

  await layer(page, 'Tones').click();
  await cell(page, 1, 1).click();
  await expect(sounding(page, 1)).toHaveAccessibleName('Step 1, C♯4');

  // The phrase comes back first, because it was the last thing changed.
  await undo.click();
  await expect(sounding(page, 1)).toHaveAccessibleName('Step 1, C4');

  // And the drum edit is still there until the next press.
  await layer(page, 'Beats').click();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
});

/* ---- what is remembered -------------------------------------------------- */

test('the phrase and its instrument survive a reload', async ({ page }) => {
  await freshVisit(page);
  await layer(page, 'Tones').click();

  await cell(page, 0, 3).click();
  await expect(sounding(page, 3)).toHaveAccessibleName('Step 3, C4');

  await page.getByLabel('Sound', { exact: true }).selectOption('four-bass');
  // The write is debounced, so give it the half second it waits for.
  await page.waitForTimeout(800);

  await page.reload();
  await layer(page, 'Tones').click();
  await expect(sounding(page, 3)).toHaveAccessibleName('Step 3, C4');
  await expect(page.getByLabel('Sound', { exact: true })).toHaveValue('four-bass');
});

/* ---- the APL tools ------------------------------------------------------- */

test('the phrase has its own three APL tools, and its own Explore draft', async ({ page }) => {
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

test('the phrase Peek shows the vector and the notes together, without a request', async ({ page }) => {
  await freshVisit(page);
  const apl = watchApl(page);

  await layer(page, 'Tones').click();
  await workspace(page, 'Transform').click();
  await page.getByRole('button', { name: 'Peek at the APL' }).click();

  const peek = page.locator('[id$="-peek"]').first();
  // Transpose is where the Tone transform controls start, so this is the expression on offer.
  await expect(peek).toContainText('(48⌈84⌊n+5)×0<n');
  // The phrase as APL holds it, and as a musician reads it — which is what stops "a tune is a
  // vector of numbers" from being a claim somebody has to take on faith.
  await expect(peek).toContainText('60 0 0 63');
  await expect(peek).toContainText('C4');

  expect(apl, `TryAPL requests: ${apl.join(', ')}`).toHaveLength(0);
});

test('the phrase Create controls cost nothing until Generate is pressed', async ({ page }) => {
  await freshVisit(page);
  const apl = watchApl(page);

  await layer(page, 'Tones').click();
  await workspace(page, 'Create').click();

  await page.getByLabel('Recipe').selectOption('sparse');
  await page.getByLabel('Scale').selectOption('dorian');
  await page.getByLabel('Root').selectOption('62');
  await page.getByRole('button', { name: 'New Tone seed' }).click();
  await page.getByRole('button', { name: 'Peek at the APL' }).click();

  expect(apl, `TryAPL requests: ${apl.join(', ')}`).toHaveLength(0);
});
