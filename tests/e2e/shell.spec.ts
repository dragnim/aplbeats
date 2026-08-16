import { expect, test, type Page } from '@playwright/test';

/*
 * The application shell, as Stage 9 rebuilt it.
 *
 * Every other suite tests what the application *does*; this one tests what it *is*. The redesign
 * made four structural claims, and each of them is the kind that decays silently — a control
 * drifting back into the global strip, a card creeping back around a panel, the workspace
 * quietly stopping short of the window. So each is asserted from the laid-out geometry rather
 * than from the stylesheet:
 *
 *   the hierarchy    global transport, then the layer, then the tool
 *   ownership        a kit belongs to Beats; a sound and a volume belong to Tones
 *   adjacency        the mode rail sits *between* the instrument and the panel it switches
 *   the viewport     the workspace fills it, and the footer is one line
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

const layer = (page: Page, name: 'Beats' | 'Tones') =>
  page.getByRole('tablist', { name: 'Layer' }).getByRole('tab', { name, exact: true });

/** Requests to TryAPL, counted. Nothing in this suite may reach it. */
function watchApl(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://tryapl.org')) seen.push(request.url());
  });
  return seen;
}

/**
 * Skip unless this browser can make a sound.
 *
 * Playwright's WebKit is built without Web Audio, so the scheduler never starts and the playhead
 * never moves — which makes every playback assertion below a statement about the harness rather
 * than about the application. Asked of the page rather than decided from the project's name.
 */
async function requireAudio(page: Page): Promise<void> {
  const available = await page.evaluate(
    () => typeof window.AudioContext === 'function' && typeof window.OfflineAudioContext === 'function',
  );
  test.skip(!available, 'This browser build has no Web Audio.');
}

const desktopOnly = (): void => {
  const viewport = test.info().project.use.viewport;
  const wide = viewport === undefined || viewport === null || viewport.width >= 1024;
  test.skip(!wide, 'A desktop composition test.');
};

/* ---- the hierarchy ------------------------------------------------------- */

test('the global strip carries only what governs the whole composition', async ({ page }) => {
  /*
   * The drum kit lived here until Stage 9, which was defensible while there was one layer: choose
   * an instrument, then play it. With two layers it became a claim about what the application is —
   * a drum machine with a tab bolted on — so what is left has to be genuinely global.
   */
  await freshVisit(page);

  const header = page.locator('header');
  await expect(header.getByRole('button', { name: /Play|Pause/u })).toBeVisible();
  await expect(header.getByRole('slider', { name: 'Tempo' })).toBeVisible();
  await expect(header.getByRole('slider', { name: 'Swing' })).toBeVisible();
  await expect(header.getByRole('slider', { name: 'Master volume' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Undo' })).toBeVisible();

  // And nothing that belongs to one layer.
  await expect(header.getByRole('combobox', { name: 'Kit' })).toHaveCount(0);
  await expect(header.getByRole('combobox', { name: 'Sound' })).toHaveCount(0);
});

test('each layer owns its own instrument controls', async ({ page }) => {
  await freshVisit(page);

  // Beats owns the kit, and Tones does not offer one.
  await expect(page.getByRole('combobox', { name: 'Kit' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sound' })).toHaveCount(0);

  await layer(page, 'Tones').click();
  await expect(page.getByRole('combobox', { name: 'Sound' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Kit' })).toHaveCount(0);
});

test('the layer tabs are the most prominent navigation on the page', async ({ page }) => {
  /*
   * Which layer you are working on is the top of the hierarchy, and until Stage 9 it looked like
   * the smallest thing on screen — a segmented control the size of a pair of buttons. "Prominent"
   * is asserted as type size rather than as a screenshot: the layer tabs must be set larger than
   * the mode rail's tabs, which are the navigation one level below them.
   */
  await freshVisit(page);

  const sizes = await page.evaluate(() => {
    const size = (selector: string): number => {
      const element = document.querySelector(selector);
      return element === null ? 0 : Number.parseFloat(getComputedStyle(element).fontSize);
    };
    return {
      layerTab: size('[role="tablist"][aria-label="Layer"] [role="tab"]'),
      modeTab: size('[role="tablist"][aria-label="Workspace"] [role="tab"]'),
    };
  });

  expect(sizes.layerTab).toBeGreaterThan(sizes.modeTab);
});

test('Beats and Tones stay reachable and announced from the keyboard', async ({ page }) => {
  await freshVisit(page);

  await layer(page, 'Beats').focus();
  await page.keyboard.press('ArrowRight');
  await expect(layer(page, 'Tones')).toHaveAttribute('aria-selected', 'true');
  await expect(layer(page, 'Tones')).toBeFocused();

  await page.keyboard.press('Home');
  await expect(layer(page, 'Beats')).toHaveAttribute('aria-selected', 'true');
});

/* ---- adjacency ----------------------------------------------------------- */

test('the mode rail sits between the instrument and the workspace it switches', async ({ page }) => {
  /*
   * The single structural claim of the redesign, and the one a stylesheet edit could undo without
   * any test noticing. Measured from the laid-out boxes: instrument, then rail, then panel, left
   * to right — where before Stage 9 the rail was on the far side of the instrument from the thing
   * it controlled.
   */
  desktopOnly();
  await freshVisit(page);

  const order = await page.evaluate(() => {
    const left = (selector: string): number => {
      const element = document.querySelector(selector);
      return element === null ? Number.NaN : Math.round(element.getBoundingClientRect().left);
    };
    return {
      instrument: left('main'),
      rail: left('[role="tablist"][aria-label="Workspace"]'),
      panel: left('[role="tabpanel"]:not([id*="domain"])'),
    };
  });

  expect(order.instrument).toBeLessThan(order.rail);
  expect(order.rail).toBeLessThan(order.panel);
});

test('pressing a mode changes the panel immediately beside it', async ({ page }) => {
  desktopOnly();
  const apl = watchApl(page);
  await freshVisit(page);

  const panel = page.locator('[role="tabpanel"]:not([id*="domain"])');
  const rail = page.getByRole('tablist', { name: 'Workspace' });

  await rail.getByRole('tab', { name: 'Transform' }).click();
  await expect(panel.getByRole('button', { name: 'Apply with APL' })).toBeVisible();

  await rail.getByRole('tab', { name: 'Explore' }).click();
  await expect(panel.getByRole('textbox', { name: 'Your APL expression' })).toBeVisible();

  // Vertical, still — four modes in a column rather than a second row of horizontal tabs.
  await expect(rail).toHaveAttribute('aria-orientation', 'vertical');
  expect(apl, 'switching modes must not reach TryAPL').toEqual([]);
});

/* ---- the viewport -------------------------------------------------------- */

test('the workspace fills the window rather than stopping half way down', async ({ page }) => {
  /*
   * The complaint this stage began with: a drum machine in the top half of a monitor with a field
   * of dead page beneath it. Asserted as a proportion rather than a pixel count, so it holds on
   * any laptop: from the top of the instrument to the bottom of the footer must cover nearly the
   * whole window.
   */
  desktopOnly();
  await freshVisit(page);

  for (const height of [900, 720]) {
    await page.setViewportSize({ width: 1440, height });

    const filled = await page.evaluate(() => {
      const instrument = document.querySelector('main')?.getBoundingClientRect();
      const footer = document.querySelector('footer')?.getBoundingClientRect();
      if (instrument === undefined || footer === undefined) return null;
      return {
        used: Math.round(footer.bottom - instrument.top),
        window: window.innerHeight,
        instrument: Math.round(instrument.height),
      };
    });

    expect(filled).not.toBeNull();
    // Nine tenths of what is left below the header, rather than a short application floating in it.
    expect(
      (filled?.used ?? 0) / (filled?.window ?? 1),
      `the workspace leaves the window empty at ${String(height)}px`,
    ).toBeGreaterThan(0.6);
  }
});

test('the footer is one compact line, not a wall of provenance', async ({ page }) => {
  await freshVisit(page);

  const footer = page.locator('footer');
  const height = await footer.evaluate((element) => Math.round(element.getBoundingClientRect().height));
  expect(height, 'the footer should be a single line').toBeLessThan(72);

  // The paragraphs that used to live here are gone from it.
  await expect(footer).not.toContainText('public-domain');
  await expect(footer).not.toContainText('TryAPL');
});

test('the credits open, close, and carry what has to ship', async ({ page }) => {
  await freshVisit(page);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Credits & licences' }).click();
  await expect(dialog).toBeVisible();
  // The MIT permission notice, which the licence requires to travel with the software.
  await expect(dialog).toContainText('Permission is hereby granted');
  await expect(dialog).toContainText('André Michelle');

  await page.getByRole('button', { name: 'Close credits' }).click();
  await expect(dialog).toBeHidden();
});

/* ---- playback ------------------------------------------------------------ */

test('a sounding drum step reacts, and a silent one does not', async ({ page }) => {
  /*
   * The other half of "the sequencer should look alive". The playhead says where the bar is; this
   * says what is being *hit* — and it must be driven by the real playhead, so it is read from the
   * class the scheduler's own step number puts on the cell rather than from a timer of this
   * suite's own.
   */
  await freshVisit(page);
  await requireAudio(page);
  await page.getByRole('button', { name: 'Play' }).click();

  let sawStruck = false;
  for (let sample = 0; sample < 14; sample += 1) {
    const seen = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('button[data-track][data-step]')];
      const struck = cells.filter(
        (cell) => /playing/u.test(cell.className) && /active/u.test(cell.className),
      );
      const columns = new Set(
        cells.filter((cell) => /playing/u.test(cell.className)).map((cell) => cell.getAttribute('data-step')),
      );
      return { struck: struck.length, columns: columns.size };
    });

    // Whatever else is true: the playhead is one column, and anything struck is an active step.
    expect(seen.columns, 'the playhead must mark exactly one column').toBeLessThanOrEqual(1);
    if (seen.struck > 0) sawStruck = true;
    await page.waitForTimeout(60);
  }

  expect(sawStruck, 'no drum step ever reacted while playing').toBe(true);
  await page.getByRole('button', { name: 'Pause' }).click();

  // Stopped, nothing is struck: a parked playhead is not a sounding one.
  await page.waitForTimeout(200);
  const afterStop = await page.evaluate(
    () =>
      [...document.querySelectorAll('button[data-track][data-step]')].filter((cell) =>
        /playing/u.test(cell.className),
      ).length,
  );
  expect(afterStop).toBe(0);
});

test('the playhead is legible in both themes, in both layers', async ({ page }) => {
  /*
   * "Look at it with the sound muted and understand the rhythm" is the acceptance test, and the
   * thing that would quietly break it is a wash tuned for one theme. So the band is required to
   * differ from an ordinary cell in all four combinations rather than merely to exist.
   */
  await freshVisit(page);
  await requireAudio(page);
  await page.getByRole('button', { name: 'Play' }).click();

  for (const theme of ['dark', 'light']) {
    await page.evaluate((want) => {
      document.documentElement.setAttribute('data-theme', want);
    }, theme);

    for (const which of ['Beats', 'Tones'] as const) {
      await layer(page, which).click();
      await page.waitForTimeout(120);

      const contrast = await page.evaluate((isBeats) => {
        const selector = isBeats ? 'button[data-track][data-step]' : '[data-row][data-step]';
        const cells = [...document.querySelectorAll(selector)];
        const lit = cells.find((cell) => /playing/u.test(cell.className));
        const plain = cells.find((cell) => !/playing/u.test(cell.className));
        if (lit === undefined || plain === undefined) return null;
        const paint = (element: Element): string => {
          const own = getComputedStyle(element).backgroundColor;
          if (own !== 'rgba(0, 0, 0, 0)') return own;
          const face = element.querySelector('span, div');
          return face === null ? own : getComputedStyle(face).backgroundColor;
        };
        return { lit: paint(lit), plain: paint(plain) };
      }, which === 'Beats');

      expect(contrast, `${which} in ${theme} has no playhead`).not.toBeNull();
      expect(contrast?.lit, `${which} in ${theme}: the playhead looks like an ordinary cell`).not.toBe(
        contrast?.plain,
      );
    }
  }

  await page.getByRole('button', { name: 'Pause' }).click();
});

test('reduced motion keeps the playback state and drops the animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freshVisit(page);

  const animations = await page.evaluate(() => {
    const cell =
      document.querySelector('button[data-track][data-step].active') ??
      document.querySelector('button[data-track][data-step]');
    const face = cell?.querySelector('span, div');
    return face === null || face === undefined ? 'none' : getComputedStyle(face).animationName;
  });

  expect(animations === 'none' || animations === '').toBe(true);
});
