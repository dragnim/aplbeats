import { expect, test, type Page } from '@playwright/test';

/*
 * The grid must not grow while it plays.
 *
 * A hit effect that scales a step's face past the cell's own box enlarges the scroller's
 * scrollable overflow — CSS counts the *transformed* border boxes of descendants — so at a
 * width where the sixteen steps fit exactly, the last column swelling produced a horizontal
 * scrollbar that flickered in and out once per bar. Ink (a shadow, a glow) does not do this;
 * geometry does.
 *
 * Measured per animation frame rather than by polling, because the whole fault lasts about
 * ninety milliseconds and a sampler slower than a frame would miss it and report success.
 */

const CELL = 'button[data-track][data-step]';
const SCROLLER = '[class*="scroller"]';

async function freshVisit(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
    } catch {
      // Storage disabled by policy: nothing was stored.
    }
  });
  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();
}

async function requireAudio(page: Page): Promise<void> {
  const available = await page.evaluate(() => typeof window.AudioContext === 'function');
  test.skip(!available, 'This browser build has no Web Audio.');
}

interface OverflowWatch {
  /** The largest scrollWidth − clientWidth seen, in CSS pixels. */
  readonly worstOverflow: number;
  /** Frames sampled. A handful would mean the watch never really ran. */
  readonly frames: number;
  /** Whether the playhead was ever seen on the last column while it was watching. */
  readonly sawLastColumn: boolean;
}

/**
 * Watch the scroller for `ms`, every frame, and report the worst overflow.
 *
 * Also reports whether the playhead reached the last column, so a pass cannot be earned by
 * simply never arriving at the interesting moment.
 */
async function watchOverflow(page: Page, ms: number): Promise<OverflowWatch> {
  return page.evaluate(
    ({ duration, selector }) =>
      new Promise<OverflowWatch>((resolve) => {
        const scroller = document.querySelector(selector);
        if (scroller === null) {
          resolve({ worstOverflow: 0, frames: 0, sawLastColumn: false });
          return;
        }

        let worstOverflow = 0;
        let frames = 0;
        let sawLastColumn = false;
        const started = performance.now();

        const tick = (): void => {
          frames += 1;
          worstOverflow = Math.max(worstOverflow, scroller.scrollWidth - scroller.clientWidth);

          const marked = document.querySelector('[class*="headerPlaying"]');
          if (marked?.parentElement != null) {
            const column = [...marked.parentElement.children].indexOf(marked);
            if (column === 15) sawLastColumn = true;
          }

          if (performance.now() - started < duration) requestAnimationFrame(tick);
          else resolve({ worstOverflow, frames, sawLastColumn });
        };

        requestAnimationFrame(tick);
      }),
    { duration: ms, selector: SCROLLER },
  );
}

/** Whether the grid fits without scrolling at all while stopped. */
async function fitsWithoutScrolling(page: Page): Promise<boolean> {
  return page.evaluate((selector) => {
    const scroller = document.querySelector(selector);
    return scroller !== null && scroller.scrollWidth <= scroller.clientWidth;
  }, SCROLLER);
}

test('the last step is active in the groove APL Beats opens on', async ({ page }) => {
  // The whole fault depends on this, so it is asserted rather than assumed. If the opening
  // groove ever loses its last-sixteenth events, the regression test below would pass by
  // testing nothing.
  await freshVisit(page);

  const lastColumnActive = await page.evaluate(
    () =>
      [...document.querySelectorAll('button[data-step="15"]')].filter(
        (cell) => cell.getAttribute('aria-pressed') === 'true',
      ).length,
  );
  expect(lastColumnActive).toBeGreaterThan(0);
});

test('playing a whole bar never makes the grid overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'About the width at which the grid fits exactly.');

  await freshVisit(page);
  await requireAudio(page);

  // The premise: at this width the grid fits, so any overflow at all is the fault.
  expect(await fitsWithoutScrolling(page), 'the grid should fit at desk width').toBe(true);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Playing');

  // Three bars at the opening tempo, sampled every frame.
  const watch = await watchOverflow(page, 2800);

  expect(watch.frames).toBeGreaterThan(60);
  expect(watch.sawLastColumn, 'the playhead never reached the last column').toBe(true);
  expect(watch.worstOverflow, 'the grid grew while playing').toBe(0);
});

test('playing a whole bar never overflows with the last step silent', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'About the width at which the grid fits exactly.');

  await freshVisit(page);
  await requireAudio(page);

  /*
   * Switch off everything in the last column, so this covers the other half of the case.
   *
   * Collected as track numbers first rather than as locators. A locator matching
   * `aria-pressed="true"` stops matching the moment it is clicked, so clicking through a
   * list of them waits for ever on the second one.
   */
  const activeTracks = await page.evaluate(() =>
    [...document.querySelectorAll('button[data-step="15"]')]
      .filter((cell) => cell.getAttribute('aria-pressed') === 'true')
      .map((cell) => (cell as HTMLElement).dataset.track ?? ''),
  );
  expect(activeTracks.length).toBeGreaterThan(0);

  for (const track of activeTracks) {
    await page.locator(`button[data-track="${track}"][data-step="15"]`).click();
  }
  await expect(page.locator('button[data-step="15"][aria-pressed="true"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const watch = await watchOverflow(page, 2800);

  expect(watch.sawLastColumn).toBe(true);
  expect(watch.worstOverflow).toBe(0);
});

test('reduced motion never makes the grid overflow either', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'About the width at which the grid fits exactly.');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freshVisit(page);
  await requireAudio(page);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const watch = await watchOverflow(page, 2800);

  expect(watch.sawLastColumn).toBe(true);
  expect(watch.worstOverflow).toBe(0);
});

test('a dense generated bar never makes the grid overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'About the width at which the grid fits exactly.');

  await freshVisit(page);
  await requireAudio(page);

  // Everything on, on every track, so every column has something to light up.
  const density = page.getByRole('slider', { name: 'Density' });
  await density.fill('100');
  await density.press('Tab');
  await page.getByRole('radio', { name: 'Glitch' }).click();

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const watch = await watchOverflow(page, 2800);

  expect(watch.sawLastColumn).toBe(true);
  expect(watch.worstOverflow).toBe(0);
});

test('the intermediate width can still be scrolled on purpose', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'About a desktop window narrowed by hand.');

  /*
   * The fix must not be "turn horizontal scrolling off".
   *
   * Between the phone layout, which puts each track's name above its steps, and the desk
   * layout, which puts it beside them, there is a band of widths where the name column and
   * sixteen reachable targets genuinely do not both fit. Scrolling there is deliberate and
   * has to keep working.
   */
  await page.setViewportSize({ width: 620, height: 900 });
  await freshVisit(page);

  const geometry = await page.evaluate((selector) => {
    const scroller = document.querySelector(selector);
    if (scroller === null) return null;
    scroller.scrollLeft = 9999;
    return {
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      scrolledTo: scroller.scrollLeft,
      overflowX: getComputedStyle(scroller).overflowX,
    };
  }, SCROLLER);

  expect(geometry?.overflowX).toBe('auto');
  expect(geometry?.scrollWidth ?? 0).toBeGreaterThan(geometry?.clientWidth ?? 0);
  expect(geometry?.scrolledTo ?? 0).toBeGreaterThan(0);
});

test('a phone shows the whole bar with no horizontal scrolling at all', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, 'About the phone layout.');

  await freshVisit(page);

  // The phone layout stacks the controls above the steps precisely so that nothing scrolls.
  expect(await fitsWithoutScrolling(page)).toBe(true);

  const document_ = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(document_.scrollWidth).toBeLessThanOrEqual(document_.clientWidth + 1);
});
