import { expect, test, type Page } from '@playwright/test';

/**
 * The Transform panel, as a scope for locators.
 *
 * Stage 6 added a second APL panel with its own "Peek at the APL" and "Edit this APL", so an
 * unscoped locator for either is now ambiguous — and ambiguous to a person reading the page, not
 * only to Playwright. Scoping says which panel is meant.
 */
const transformPanel = (page: Page) => page.getByRole('region', { name: 'Transform with APL' });

/*
 * Master volume, in a real browser.
 *
 * Two things need one. The first is that the control behaves — keyboard, persistence, no layout
 * damage — which jsdom cannot answer honestly for a range input.
 *
 * The second is the claim the whole change rests on, and it is arithmetic rather than opinion:
 * that Master is the *final* attenuation stage, and that at 100% the output is the one APL Beats
 * has always had. That is measured here by rendering the same signal through the real master
 * chain at three settings and comparing the samples — no microphone, no listening, just numbers.
 *
 * No TryAPL requests anywhere in this file. A volume slider has nothing to do with APL.
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
  page.on('request', (request) => {
    if (request.url().includes('tryapl')) problems.push(`unexpected APL request: ${request.url()}`);
  });
  return problems;
}

const master = (page: Page) => page.getByRole('slider', { name: 'Master volume' });

/** Everything a visitor would be sorry to have moved. */
async function creativeState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    cells: [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
    sliders: [...document.querySelectorAll('input[type="range"]')]
      .filter((input) => input.id !== 'transport-master')
      .map((input) => `${input.getAttribute('aria-label') ?? input.id}=${(input as HTMLInputElement).value}`),
    mutes: [...document.querySelectorAll('button[aria-label^="Mute"]')].map((button) =>
      button.getAttribute('aria-pressed'),
    ),
    locks: [...document.querySelectorAll('button[aria-label^="Lock"]')].map((button) =>
      button.getAttribute('aria-pressed'),
    ),
    kit: (document.querySelector('select[id$="-kit"]') as HTMLSelectElement | null)?.value ?? null,
    seed: document.querySelector('[class*="seedValue"]')?.textContent?.trim() ?? null,
  }));
}

/**
 * Open one of the four workspaces.
 *
 * Stage 7 put the local generator, Create, Transform and Explore behind a tab rail beside the
 * sequencer instead of stacking them down the page, so a spec that wants a panel has to ask for
 * it. That is the layout genuinely changing rather than a test needing a workaround: on the page
 * itself, one workspace is open at a time.
 */
async function openWorkspace(page: Page, name: 'Play' | 'Create' | 'Transform' | 'Explore'): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
}

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
  await openWorkspace(page, 'Transform');
}

async function requireAudio(page: Page): Promise<void> {
  const available = await page.evaluate(() => typeof window.AudioContext === 'function');
  test.skip(!available, 'This browser build has no Web Audio.');
}

/* ------------------------------------------------------------------------- */

test('opens at full volume, in the transport bar', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  await expect(master(page)).toBeVisible();
  await expect(master(page)).toHaveValue('100');
  await expect(master(page)).toHaveAttribute('aria-valuetext', '100 per cent');

  expect(problems).toEqual([]);
});

test('moves by keyboard, as a real range input does', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  await master(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(master(page)).toHaveValue('97');

  await page.keyboard.press('Home');
  await expect(master(page)).toHaveValue('0');
  await expect(master(page)).toHaveAttribute('aria-valuetext', 'Silent');

  await page.keyboard.press('End');
  await expect(master(page)).toHaveValue('100');

  expect(problems).toEqual([]);
});

test('changing it while playing disturbs nothing', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);
  await requireAudio(page);

  const before = await creativeState(page);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');
  await page.waitForTimeout(400);

  for (const value of ['60', '20', '0', '100', '45']) {
    await master(page).fill(value);
  }

  // Still playing, same bar, same everything.
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(await creativeState(page)).toEqual(before);

  // And the playhead never restarted.
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

  await page.getByRole('button', { name: 'Pause' }).click();
  expect(problems).toEqual([]);
});

test('is remembered, and does not start playing', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  await master(page).fill('37');
  await page.waitForTimeout(300);

  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();

  await expect(master(page)).toHaveValue('37');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Paused');

  expect(problems).toEqual([]);
});

test('survives discarding an Explore draft', async ({ page }) => {
  /*
   * The interaction that had a bug in it. Load current transform throws the draft away, and for
   * one commit it threw the volume away too — invisible until a reload, and invisible to every
   * test that only ever looked at one storage key at a time.
   */
  const problems = watchForProblems(page);
  await freshVisit(page);

  await master(page).fill('37');
  // Explore is reached *through* the Transform workspace, so start by being on it.
  await openWorkspace(page, 'Transform');
  await transformPanel(page).getByRole('button', { name: 'Peek at the APL' }).click();
  await transformPanel(page).getByRole('button', { name: 'Edit this APL' }).click();

  const editor = page.getByRole('textbox', { name: 'Your APL expression' });
  await editor.fill('~m[2;]');
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Load current transform' }).click();
  await expect(master(page)).toHaveValue('37');

  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();

  // The draft is gone, as asked. The volume is not.
  await expect(master(page)).toHaveValue('37');
  // A reload opens on Play, deliberately: which tool you had open is not a preference.
  await openWorkspace(page, 'Transform');
  await transformPanel(page).getByRole('button', { name: 'Peek at the APL' }).click();
  await transformPanel(page).getByRole('button', { name: 'Edit this APL' }).click();
  await expect(page.getByRole('textbox', { name: 'Your APL expression' })).toHaveValue('¯1⌽m');

  expect(problems).toEqual([]);
});

test('survives a change of drum machine', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  await master(page).fill('37');

  const selector = page.getByRole('combobox', { name: 'Drum machine' });
  const kitStatus = page.getByRole('status', { name: 'Drum machine' });

  for (const kit of ['tr-808', 'lm-2', 'synth']) {
    await selector.selectOption(kit);
    await expect(kitStatus).not.toHaveText('Loading kit…', { timeout: 20_000 });
    await expect(master(page)).toHaveValue('37');
  }

  // And it is still 37 after a reload, whichever kit it settled on.
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();
  await expect(master(page)).toHaveValue('37');

  expect(problems.filter((problem) => problem.startsWith('page:'))).toEqual([]);
});

test('does not open an audio device by itself', async ({ page }) => {
  /*
   * The rule every stage has kept. Moving a fader is not a request for sound, so a page that
   * started an `AudioContext` for it would be a page making noise nobody asked for — and on iOS
   * it would spend the one gesture the browser was willing to grant.
   */
  const problems = watchForProblems(page);
  await freshVisit(page);
  await requireAudio(page);

  await page.evaluate(() => {
    const original = window.AudioContext;
    (window as unknown as { __contexts: number }).__contexts = 0;
    class Counting extends original {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        (window as unknown as { __contexts: number }).__contexts += 1;
      }
    }
    window.AudioContext = Counting as unknown as typeof AudioContext;
  });

  for (const value of ['80', '40', '0', '100']) {
    await master(page).fill(value);
  }

  const built = await page.evaluate(() => (window as unknown as { __contexts: number }).__contexts);
  expect(built).toBe(0);

  expect(problems).toEqual([]);
});

test('the transport bar still fits, with the new control on it', async ({ page }, testInfo) => {
  const problems = watchForProblems(page);
  await freshVisit(page);

  await expect(master(page)).toBeVisible();

  // A real target rather than a sliver, on touch as much as on a pointer.
  const box = await master(page).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(20);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(60);

  // Nothing overflows the page sideways, at any width this project supports.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${testInfo.project.name} overflowed by ${String(overflow)}px`).toBeLessThanOrEqual(1);

  // And the readout does not make the bar breathe as the number changes width.
  const widthAt = async (value: string): Promise<number> => {
    await master(page).fill(value);
    return page.evaluate(() => document.documentElement.scrollWidth);
  };
  const wide = await widthAt('100');
  const narrow = await widthAt('7');
  expect(Math.abs(wide - narrow)).toBeLessThanOrEqual(1);

  expect(problems).toEqual([]);
});

/* ------------------------------------------------------------------------- */

test('the desktop transport is one row', async ({ page }, testInfo) => {
  /*
   * A regression guard with a specific memory.
   *
   * Adding Master made five controls where there had been four, and the drum machine selector —
   * which was laid out label-above-control, a head taller than its neighbours — was pushed onto a
   * second row on its own. The bar went from one line to two and gained a large empty area, at
   * ordinary desktop widths, which is not something a screenshot review should have to catch.
   *
   * Rows are counted from the laid-out geometry rather than from the CSS: group every control by
   * its vertical centre and count the distinct bands. That is what "one row" means to somebody
   * looking at it, so it is what gets asserted.
   */
  test.skip(testInfo.project.use.hasTouch === true, 'Stacking is the intended layout on a phone.');

  const problems = watchForProblems(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await freshVisit(page);

  const layout = await page.evaluate(() => {
    const bar = document.querySelector('[class*="bar"]');
    if (bar === null) return null;

    const controls = [...bar.querySelectorAll('button, input[type="range"], select')];
    const bands: number[] = [];
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      const centre = box.top + box.height / 2;
      if (!bands.some((existing) => Math.abs(existing - centre) < 12)) bands.push(centre);
    }

    return {
      rows: bands.length,
      height: bar.getBoundingClientRect().height,
      controls: controls.length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(layout).not.toBeNull();
  // Play, the kit selector, and the three dials — all of them, on one line.
  expect(layout?.controls).toBe(5);
  expect(layout?.rows, 'the transport wrapped onto more than one row').toBe(1);
  // One row of controls plus padding. Two rows measured 90px, so this fails loudly if it returns.
  expect(layout?.height ?? 0).toBeLessThan(72);
  expect(layout?.overflow).toBeLessThanOrEqual(1);

  expect(problems).toEqual([]);
});

test('the controls stay a usable size once they share a row', async ({ page }, testInfo) => {
  // Fitting on one line must not have been bought by making everything tiny.
  test.skip(testInfo.project.use.hasTouch === true, 'Stacking is the intended layout on a phone.');

  const problems = watchForProblems(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await freshVisit(page);

  /*
   * A floor, not a design target.
   *
   * The three dials share whatever is left after Play and the kit selector, so how wide a slider
   * ends up is partly a function of how wide the labels render — and that differs between font
   * stacks. The same build measures about 93px per slider on Windows and about 76px on CI's
   * Linux runner, both of them perfectly usable. Asserting the number this machine happens to
   * produce would be asserting the font, so this asserts "not tiny" and leaves the rest to the
   * layout.
   */
  for (const name of ['Tempo', 'Swing', 'Master volume']) {
    const box = await page.getByRole('slider', { name }).boundingBox();
    expect(box?.width ?? 0, `${name} is too narrow to use`).toBeGreaterThanOrEqual(64);
    // The height is what a pointer actually has to hit, and it does not depend on the font.
    expect(box?.height ?? 0, `${name} is too short to hit`).toBeGreaterThanOrEqual(16);
  }

  const select = await page.getByRole('combobox', { name: 'Drum machine' }).boundingBox();
  expect(select?.width ?? 0).toBeGreaterThanOrEqual(110);
  expect(select?.height ?? 0).toBeGreaterThanOrEqual(28);

  // And Play is still the strongest thing on the bar.
  const play = await page.getByRole('button', { name: 'Play', exact: true }).boundingBox();
  expect(play?.height ?? 0).toBeGreaterThanOrEqual(32);

  expect(problems).toEqual([]);
});

test('is the final attenuation stage, and 100% is the output we already had', async ({ page }) => {
  /*
   * The arithmetic behind the whole change, measured rather than asserted.
   *
   * The real master chain is built three times over an identical signal — at 100%, 50% and 0% —
   * and the rendered samples are compared. What this proves is exactly the three things the
   * feature promised: that full volume is bit-for-bit the output before this control existed,
   * that half is a clean linear attenuation of that same signal rather than a differently
   * processed one, and that zero is silence.
   *
   * If the gain sat anywhere earlier — before the compressor, say — the 50% render would not be
   * a scaled copy of the 100% one, because the compressor would have been driven differently.
   * That difference is what this test would catch.
   */
  const problems = watchForProblems(page);
  await page.goto('/');
  await requireAudio(page);

  const measured = await page.evaluate(async () => {
    const RATE = 44_100;

    /** The master chain exactly as `AudioEngine` builds it, with the volume node last. */
    async function render(volume: number | null): Promise<Float32Array> {
      const context = new OfflineAudioContext(1, RATE, RATE);

      const mix = context.createGain();
      mix.gain.value = 0.72;

      const glue = context.createDynamicsCompressor();
      glue.threshold.value = -14;
      glue.knee.value = 8;
      glue.ratio.value = 3.2;
      glue.attack.value = 0.004;
      glue.release.value = 0.14;

      // The soft limiter, as `saturator` builds it.
      const shaper = context.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i += 1) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * 1.25);
      }
      shaper.curve = curve;
      shaper.oversample = '4x';

      mix.connect(glue);

      /*
       * `null` is the chain as it was before Stage 5.1 — limiter straight to the speakers. Any
       * other value inserts the new node. Comparing the two is what makes "100% changes nothing"
       * a measurement rather than a claim.
       */
      if (volume === null) {
        glue.connect(shaper).connect(context.destination);
      } else {
        const output = context.createGain();
        output.gain.value = volume;
        glue.connect(shaper).connect(output);
        output.connect(context.destination);
      }

      // A repeatable signal: a decaying 220 Hz tone, loud enough to reach the compressor.
      const source = context.createOscillator();
      source.type = 'sine';
      source.frequency.value = 220;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.9, 0);
      envelope.gain.exponentialRampToValueAtTime(0.001, 0.8);
      source.connect(envelope).connect(mix);
      source.start(0);
      source.stop(0.9);

      const rendered = await context.startRendering();
      return rendered.getChannelData(0).slice();
    }

    const before = await render(null);
    const full = await render(1);
    const half = await render(0.5);
    const silent = await render(0);

    const peak = (data: Float32Array): number => {
      let highest = 0;
      for (const sample of data) highest = Math.max(highest, Math.abs(sample));
      return highest;
    };

    /** The largest sample-by-sample difference between two renders. */
    const worstDifference = (a: Float32Array, b: Float32Array, scale = 1): number => {
      let worst = 0;
      for (let i = 0; i < a.length; i += 1) {
        worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0) * scale));
      }
      return worst;
    };

    return {
      beforePeak: peak(before),
      fullPeak: peak(full),
      halfPeak: peak(half),
      silentPeak: peak(silent),
      // Full volume against the chain as it was before this feature existed.
      fullVersusBefore: worstDifference(before, full),
      // Half volume against half of the full render: linear attenuation of the same signal.
      halfIsScaledFull: worstDifference(half, full, 0.5),
    };
  });

  // The signal was loud enough for the comparison to mean anything.
  expect(measured.beforePeak).toBeGreaterThan(0.1);

  // 100% is the output APL Beats already had — not approximately, identically.
  expect(measured.fullVersusBefore).toBeLessThan(1e-6);
  expect(measured.fullPeak).toBeCloseTo(measured.beforePeak, 6);

  // 50% is that same finished signal, halved. Anything else would mean the gain sits too early.
  expect(measured.halfIsScaledFull).toBeLessThan(1e-6);
  expect(measured.halfPeak).toBeCloseTo(measured.fullPeak / 2, 6);

  // 0% is silence.
  expect(measured.silentPeak).toBe(0);

  expect(problems).toEqual([]);
});
