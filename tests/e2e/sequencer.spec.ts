import { expect, test, type Page } from '@playwright/test';

/*
 * What only a browser can answer.
 *
 * The pattern model, the mixer and the scheduler are covered by unit tests, which
 * are faster and more thorough than anything here could be. These are the promises
 * that are about the real thing: that the page loads clean, that a drag paints, that
 * a keyboard can reach every step, that a phone-sized window is usable, and that
 * leaving the tab stops the music.
 *
 * Deliberately silent on whether it sounds good. No headless browser has ears.
 */

const CELL = 'button[data-track][data-step]';

/** Every console error and page error, collected for the whole test. */
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

function cell(page: Page, track: number, step: number) {
  return page.locator(`button[data-track="${String(track)}"][data-step="${String(step)}"]`);
}

/**
 * Skip unless this browser can make a sound.
 *
 * Playwright's WebKit is built without Web Audio — `AudioContext` is simply not on
 * the window — so nothing about playback can be asserted there. Asked of the page
 * rather than decided from the project's name, so a browser added later cannot
 * quietly drop this coverage without anybody noticing.
 */
async function requireAudio(page: Page): Promise<void> {
  const available = await page.evaluate(() => typeof window.AudioContext === 'function');
  test.skip(!available, 'This browser build has no Web Audio.');
}

/** Whether this project drives a touchscreen rather than a pointer. */
function isTouch(testInfo: { project: { use: { hasTouch?: boolean } } }): boolean {
  return testInfo.project.use.hasTouch === true;
}

/**
 * Whether a computed `scale` means "not scaled".
 *
 * The browsers do not agree on how to say it. Chromium reports `none`; WebKit
 * reports every axis, as `1 1`. Comparing against a string would therefore pass on
 * one engine and fail on the other for identical, correct behaviour.
 */
function isUnscaled(scale: string | undefined): boolean {
  if (scale === undefined) return false;
  if (scale === 'none') return true;
  return scale
    .trim()
    .split(/\s+/)
    .every((axis) => Number.parseFloat(axis) === 1);
}

test('opens on a groove, with no console errors', async ({ page }) => {
  const problems = watchForProblems(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();

  // Eight tracks of sixteen steps, all present.
  await expect(page.locator(CELL)).toHaveCount(128);

  /*
   * The opening pattern is a groove and not an empty grid.
   *
   * The exact count is asserted because it is a fact about a file that is edited by
   * hand: a mistyped row would still render, and a test that only checked for "more
   * than none" would let it through.
   */
  await expect(page.locator(`${CELL}[aria-pressed="true"]`)).toHaveCount(32);

  // And it is a groove rather than four-on-the-floor: the kick touches exactly one
  // of the four beats.
  const kickOnBeats = await page.evaluate(() =>
    [0, 4, 8, 12].filter(
      (step) =>
        document
          .querySelector(`button[data-track="0"][data-step="${String(step)}"]`)
          ?.getAttribute('aria-pressed') === 'true',
    ),
  );
  expect(kickOnBeats).toEqual([0]);

  expect(problems).toEqual([]);
});

test('plays, moves the playhead, and pauses where it was', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('/');
  await requireAudio(page);

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Playing');

  /*
   * The playhead advances.
   *
   * Sampled over a second and a half, which at the opening tempo is nearly three
   * bars. Asserting on several distinct columns rather than on a particular one
   * keeps this about "does it move" and out of the business of guessing how fast a
   * shared CI runner gets round to it.
   */
  const columns = new Set<number>();
  for (let sample = 0; sample < 25; sample += 1) {
    const column = await currentColumn(page);
    if (column !== null) columns.add(column);
    await page.waitForTimeout(60);
  }
  expect(columns.size).toBeGreaterThan(3);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('status')).toHaveText('Paused');

  // And having paused, it stays put.
  const restingPlace = await currentColumn(page);
  await page.waitForTimeout(700);
  expect(await currentColumn(page)).toBe(restingPlace);

  expect(problems).toEqual([]);
});

test('tempo and swing can be changed while it plays', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('/');
  await requireAudio(page);

  const tempo = page.getByRole('slider', { name: 'Tempo' });
  await expect(tempo).toHaveValue('112');

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  await tempo.fill('160');
  await expect(tempo).toHaveValue('160');
  await expect(tempo).toHaveAttribute('aria-valuetext', '160 beats per minute');

  const swing = page.getByRole('slider', { name: 'Swing' });
  await swing.fill('67');
  await expect(swing).toHaveAttribute('aria-valuetext', '67 per cent');

  // Still playing, and still no complaints: a tempo change must not restart or
  // upset the transport.
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('a pointer drag paints a run of steps, and a second drag erases it', async ({ page }, testInfo) => {
  test.skip(isTouch(testInfo), 'Painting by dragging is deliberately a fine-pointer affordance.');

  const problems = watchForProblems(page);
  await page.goto('/');

  // The rim track's row is nearly empty, so a painted run is unambiguous.
  const from = await cell(page, 7, 2).boundingBox();
  const to = await cell(page, 7, 6).boundingBox();
  if (from === null || to === null) throw new Error('The grid did not lay out.');

  await dragAcross(page, from, to);
  for (const step of [2, 3, 4, 5, 6]) {
    await expect(cell(page, 7, step)).toHaveAttribute('aria-pressed', 'true');
  }

  /*
   * The same drag again, and it clears.
   *
   * Which is the property worth having: the value is decided at the press, from the
   * cell pressed, and held for the gesture. Crossing a cell twice in one drag
   * therefore cannot undo the first crossing, and a fresh drag from an active cell
   * erases rather than flickering.
   */
  await dragAcross(page, from, to);
  for (const step of [2, 3, 4, 5, 6]) {
    await expect(cell(page, 7, step)).toHaveAttribute('aria-pressed', 'false');
  }

  expect(problems).toEqual([]);
});

test('the grid is navigable and editable by keyboard', async ({ page }, testInfo) => {
  test.skip(isTouch(testInfo), 'No keyboard on a phone.');

  const problems = watchForProblems(page);
  await page.goto('/');

  // One Tab stop for a hundred and twenty-eight steps.
  await expect(page.locator(`${CELL}[tabindex="0"]`)).toHaveCount(1);

  await cell(page, 0, 0).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 1, 2)).toBeFocused();

  // Space toggles what is focused, and the change is reported as a pressed state.
  await expect(cell(page, 1, 2)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Space');
  await expect(cell(page, 1, 2)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(cell(page, 1, 2)).toHaveAttribute('aria-pressed', 'false');

  // End and Home reach the ends of the bar, and neither runs off it.
  await page.keyboard.press('End');
  await expect(cell(page, 1, 15)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 1, 15)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(cell(page, 1, 0)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(cell(page, 1, 0)).toBeFocused();

  // Up from the top row stays on the top row.
  await page.keyboard.press('ArrowUp');
  await expect(cell(page, 0, 0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(cell(page, 0, 0)).toBeFocused();

  expect(problems).toEqual([]);
});

test('every step and control has an accessible name', async ({ page }) => {
  await page.goto('/');

  await expect(cell(page, 0, 4)).toHaveAccessibleName('Kick, step 5');
  await expect(cell(page, 3, 15)).toHaveAccessibleName('Open Hat, step 16');

  await expect(page.getByRole('button', { name: 'Mute Kick' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('slider', { name: 'Closed Hat volume' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Snare steps' })).toBeVisible();

  /*
   * Exactly one button called "Play".
   *
   * The track names are auditioning buttons and are called "Preview". They were
   * called "Play Kick" and so on, which put nine buttons beginning "Play" on one
   * page — ambiguous to look at and considerably worse to listen to.
   */
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Preview Low Perc' })).toBeVisible();
});

test('mute and volume are reflected in the interface', async ({ page }) => {
  await page.goto('/');

  const mute = page.getByRole('button', { name: 'Mute Kick' });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'false');

  const fader = page.getByRole('slider', { name: 'Snare volume' });
  await fader.fill('30');
  await expect(fader).toHaveValue('30');
  await expect(fader).toHaveAttribute('aria-valuetext', '30 per cent');
});

test('leaving the tab pauses the transport', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('/');
  await requireAudio(page);

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('status')).toHaveText('Playing');

  /*
   * A hidden document, forced.
   *
   * Playwright cannot background a tab, so `visibilityState` is redefined and the
   * event dispatched — which is exactly what the browser does, and exactly what the
   * application listens for.
   */
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(page.getByRole('status')).toHaveText('Paused');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('a phone-sized window is usable', async ({ page }, testInfo) => {
  test.skip(!isTouch(testInfo), 'About the phone layout in particular.');

  const problems = watchForProblems(page);
  await page.goto('/');

  // The page itself never scrolls sideways. The grid does, which is deliberate.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  // The whole bar is on screen. Seeing the pattern is the instrument, so the phone
  // layout puts each track's name above its steps rather than beside them.
  const first = await cell(page, 0, 0).boundingBox();
  const last = await cell(page, 0, 15).boundingBox();
  if (first === null || last === null) throw new Error('The grid did not lay out.');
  expect(last.x + last.width).toBeLessThanOrEqual(overflow.clientWidth + 1);

  /*
   * Steps stay reachable, by WCAG 2.2's spacing exception rather than by size.
   *
   * Sixteen targets of twenty-four CSS pixels do not fit across a phone, so the pads
   * are smaller than that and their spacing is what carries the conformance: adjacent
   * centres more than twenty-four pixels apart means a twenty-four pixel circle on
   * each never overlaps its neighbour. Asserted on the pitch for that reason — the
   * gap between pads is load-bearing here, not decoration.
   */
  const second = await cell(page, 0, 1).boundingBox();
  const below = await cell(page, 1, 0).boundingBox();
  if (second === null || below === null) throw new Error('The grid did not lay out.');
  expect(second.x - first.x).toBeGreaterThanOrEqual(24);
  expect(below.y - first.y).toBeGreaterThanOrEqual(24);
  expect(first.width).toBeGreaterThanOrEqual(20);

  // A tap toggles.
  const target = cell(page, 5, 0);
  await expect(target).toHaveAttribute('aria-pressed', 'false');
  await target.tap();
  await expect(target).toHaveAttribute('aria-pressed', 'true');

  expect(problems).toEqual([]);
});

/*
 * Split from the test above on purpose.
 *
 * `test.skip` part-way through a test marks the whole thing skipped, even the
 * assertions that already passed — so a phone layout verified on WebKit would be
 * reported as unverified merely because that build cannot play a sound. The audio
 * half lives here instead, where skipping it costs nothing.
 */
test('a phone can start the transport by tapping', async ({ page }, testInfo) => {
  test.skip(!isTouch(testInfo), 'About the phone layout in particular.');
  await page.goto('/');
  await requireAudio(page);

  await page.getByRole('button', { name: 'Play', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Playing');
});

test('reduced motion switches the movement off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  // Waited for, not assumed. `goto` resolves when the document has loaded, which is
  // before React has mounted anything — and a `querySelector` that finds nothing
  // reads as a passing assertion about an element that was never there.
  await expect(cell(page, 0, 0)).toBeVisible();

  // Nothing is scaled, and nothing is transitioning. True of every step, playing or
  // not, so this needs no audio and runs everywhere.
  const motion = await page.evaluate(() => {
    const face = document.querySelector('[class*="face"]');
    if (face === null) return null;
    const style = getComputedStyle(face);
    return { scale: style.scale, duration: style.transitionDuration };
  });
  expect(motion).not.toBeNull();
  expect(isUnscaled(motion?.scale)).toBe(true);
  expect(motion?.duration).toMatch(/^0s(,\s*0s)*$/);
});

test('reduced motion keeps the playhead legible without moving anything', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await requireAudio(page);

  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(300);

  // The current column still says so — with an outline, which is a difference that
  // survives being held still.
  const playing = await page.evaluate(() => {
    const face = document.querySelector('[class*="playing"] [class*="face"]');
    if (face === null) return null;
    const style = getComputedStyle(face);
    return { boxShadow: style.boxShadow, scale: style.scale };
  });
  expect(playing).not.toBeNull();
  expect(playing?.boxShadow).not.toBe('none');
  expect(isUnscaled(playing?.scale)).toBe(true);
});

/* ------------------------------------------------------------------------- */

/** Which column the playhead marker is on, or null if there is none. */
async function currentColumn(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const marked = document.querySelector('[class*="headerPlayhead"]');
    if (marked?.parentElement == null) return null;
    return [...marked.parentElement.children].indexOf(marked);
  });
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Press on one cell and drag in a straight line to another, in small steps. */
async function dragAcross(page: Page, from: Box, to: Box): Promise<void> {
  const y = from.y + from.height / 2;
  const startX = from.x + from.width / 2;
  const endX = to.x + to.width / 2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let sample = 1; sample <= 12; sample += 1) {
    await page.mouse.move(startX + ((endX - startX) * sample) / 12, y);
  }
  await page.mouse.up();
}
