import { expect, test, type Page } from '@playwright/test';

/*
 * The generative controls, driven in a real browser.
 *
 * The generator itself is covered exhaustively by unit tests over pure functions, which is
 * far faster and more thorough than anything here could be. These are the promises that
 * are about the whole application working: that Randomise changes the grid, that Undo
 * brings it back, that a locked row survives every generative action, that a slider
 * dragged across its range is one Undo rather than fifty, and that a session comes back
 * when you do.
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

/** The whole grid as a string, for comparing bars. */
async function gridOf(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
  );
}

/** One track's row, for checking a lock held. */
async function rowOf(page: Page, track: number): Promise<string> {
  return page.evaluate(
    (index) =>
      [...document.querySelectorAll(`button[data-track="${String(index)}"]`)]
        .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
        .join(''),
    track,
  );
}

/**
 * The seed on screen.
 *
 * By class rather than by text: a bare `/^\d+$/` matches the step ruler's beat numbers
 * first, which is a locator that passes for the wrong reason.
 */
async function seedOf(page: Page): Promise<string> {
  return (await page.locator('[class*="seedValue"]').innerText()).trim();
}

/**
 * Start from the documented opening state, with no stored session.
 *
 * Cleared by loading once, emptying storage and reloading — not by `addInitScript`, which
 * runs on *every* navigation and so would also wipe the session immediately before the
 * reload that is meant to restore it.
 */
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

test('opens with the generator visible and nothing to undo', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  await expect(page.getByRole('button', { name: 'Randomise' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Straight' })).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Density' })).toHaveValue('62');
  await expect(page.getByRole('slider', { name: 'Variation' })).toHaveValue('65');
  await expect(page.getByText('16998')).toBeVisible();

  expect(problems).toEqual([]);
});

test('Randomise changes the groove, draws a new seed, and can be undone', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  const before = await gridOf(page);
  const seedBefore = await seedOf(page);

  await page.getByRole('button', { name: 'Randomise' }).click();
  const after = await gridOf(page);

  expect(after).not.toBe(before);
  expect(await seedOf(page)).not.toBe(seedBefore);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await gridOf(page)).toBe(before);
  expect(await seedOf(page)).toBe(seedBefore);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  expect(problems).toEqual([]);
});

test('repeated Randomise keeps producing different bars', async ({ page }) => {
  // The whole point of the stage. A button that produces the same thing twice, or that
  // stops changing anything after a few presses, has failed regardless of the arithmetic.
  const problems = watchForProblems(page);
  await freshVisit(page);

  const seen = new Set<string>([await gridOf(page)]);
  for (let press = 0; press < 10; press += 1) {
    await page.getByRole('button', { name: 'Randomise' }).click();
    seen.add(await gridOf(page));
  }

  expect(seen.size).toBeGreaterThanOrEqual(10);
  expect(problems).toEqual([]);
});

test('a locked track survives every generative action', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  // Give the kick something distinctive to protect, then lock it.
  await page.locator('button[data-track="0"][data-step="1"]').click();
  await page.getByRole('button', { name: 'Lock Kick against the generator' }).click();
  await expect(page.getByRole('button', { name: 'Lock Kick against the generator' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const protectedRow = await rowOf(page, 0);

  await page.getByRole('button', { name: 'Randomise' }).click();
  expect(await rowOf(page, 0)).toBe(protectedRow);

  await page.getByRole('button', { name: 'New Seed' }).click();
  expect(await rowOf(page, 0)).toBe(protectedRow);

  await page.getByRole('radio', { name: 'Glitch' }).click();
  expect(await rowOf(page, 0)).toBe(protectedRow);

  // A macro commit regenerates too, and must also respect the lock.
  const density = page.getByRole('slider', { name: 'Density' });
  await density.fill('90');
  await density.press('Tab');
  expect(await rowOf(page, 0)).toBe(protectedRow);

  // And a locked track is still editable by hand. Lock means the generator may not touch
  // it, not that the visitor may not.
  await page.locator('button[data-track="0"][data-step="2"]').click();
  expect(await rowOf(page, 0)).not.toBe(protectedRow);

  expect(problems).toEqual([]);
});

test('changing a preset changes the character of the groove, and is undoable', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  const before = await gridOf(page);
  await page.getByRole('radio', { name: 'Four on Floor' }).click();
  await expect(page.getByRole('radio', { name: 'Four on Floor' })).toBeChecked();

  const after = await gridOf(page);
  expect(after).not.toBe(before);

  // Four on Floor means what it says: a kick on all four beats.
  const kick = await rowOf(page, 0);
  for (const beat of [0, 4, 8, 12]) {
    expect(kick[beat]).toBe('1');
  }

  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await gridOf(page)).toBe(before);
  await expect(page.getByRole('radio', { name: 'Straight' })).toBeChecked();

  expect(problems).toEqual([]);
});

test('a slider dragged across its range is one Undo', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'Dragged with a pointer.');

  const problems = watchForProblems(page);
  await freshVisit(page);

  const before = await gridOf(page);
  const density = page.getByRole('slider', { name: 'Density' });
  /*
   * Scrolled to first, because `boundingBox` reports viewport coordinates and does not scroll
   * the way a locator action would. With the APL panel now sitting between the sequencer and
   * the generator, the slider can start below the fold — and a `mouse.move` to a point outside
   * the viewport does nothing at all, so the drag silently never happened.
   */
  await density.scrollIntoViewIfNeeded();
  const box = await density.boundingBox();
  if (box === null) throw new Error('The Density slider did not lay out.');

  // A real drag, through many intermediate values, in one gesture.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(box.x + box.width * (0.5 + (0.45 * step) / 20), box.y + box.height / 2);
  }
  await page.mouse.up();

  expect(Number(await density.inputValue())).toBeGreaterThan(62);
  expect(await gridOf(page)).not.toBe(before);

  // One press of Undo, and everything is back — both the value and the bar.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(density).toHaveValue('62');
  expect(await gridOf(page)).toBe(before);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  expect(problems).toEqual([]);
});

test('a drag across several steps is one Undo', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'Painting is a fine-pointer affordance.');

  const problems = watchForProblems(page);
  await freshVisit(page);

  const before = await rowOf(page, 7);
  const from = await page.locator('button[data-track="7"][data-step="2"]').boundingBox();
  const to = await page.locator('button[data-track="7"][data-step="6"]').boundingBox();
  if (from === null || to === null) throw new Error('The grid did not lay out.');

  const y = from.y + from.height / 2;
  await page.mouse.move(from.x + from.width / 2, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 12 + from.width / 2, y);
  }
  await page.mouse.up();

  expect(await rowOf(page, 7)).not.toBe(before);

  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await rowOf(page, 7)).toBe(before);

  expect(problems).toEqual([]);
});

test('a lock change is undoable on its own', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  const lock = page.getByRole('button', { name: 'Lock Snare against the generator' });
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');

  expect(problems).toEqual([]);
});

test('the session comes back', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  await page.getByRole('radio', { name: 'Broken' }).click();
  await page.getByRole('button', { name: 'Randomise' }).click();

  const grid = await gridOf(page);
  const seed = await seedOf(page);

  // The save is debounced; give it room.
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();

  expect(await gridOf(page)).toBe(grid);
  expect(await seedOf(page)).toBe(seed);
  await expect(page.getByRole('radio', { name: 'Broken' })).toBeChecked();

  // Restoring must never start playing. Coming back to a page that begins making noise is
  // worse than losing the session would have been.
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Paused');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  // And the restored session is a starting point, not a history: there is nothing to undo
  // back past the moment the page loaded.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  expect(problems).toEqual([]);
});

test('generating while playing does not disturb the transport', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  const audioAvailable = await page.evaluate(() => typeof window.AudioContext === 'function');
  test.skip(!audioAvailable, 'This browser build has no Web Audio.');

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');

  // Several generative actions in quick succession, while the scheduler is running. The
  // pattern is swapped atomically; nothing here should stop, stall or complain.
  for (let press = 0; press < 5; press += 1) {
    await page.getByRole('button', { name: 'Randomise' }).click();
  }
  await page.getByRole('radio', { name: 'Syncopated' }).click();
  await page.getByRole('button', { name: 'New Seed' }).click();

  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  // The playhead is still moving.
  const columns = new Set<number>();
  for (let sample = 0; sample < 14; sample += 1) {
    columns.add(
      await page.evaluate(() => {
        const marked = document.querySelector('[class*="headerPlaying"]');
        if (marked?.parentElement == null) return -1;
        return [...marked.parentElement.children].indexOf(marked);
      }),
    );
    await page.waitForTimeout(70);
  }
  expect(columns.size).toBeGreaterThan(2);

  expect(problems).toEqual([]);
});
