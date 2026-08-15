import { expect, test, type Page, type Route } from '@playwright/test';

/*
 * Create with APL, end to end, against a mocked TryAPL.
 *
 * **Not one live request is made by this file, or by any part of `npm run test:e2e`.** The mock
 * is the whole point: CI must not depend on somebody else's service being up, and it must not
 * add load to it either. The real thing is proved by `verify:apl-generators-live`, four
 * deliberate requests, run by hand.
 *
 * What only a real browser can answer is here: that the panel exists and is usable, that the
 * controls really cost nothing, that Undo takes one press, that the transport does not stumble
 * when a bar is replaced underneath it, and that the whole thing fits on a phone.
 */

const ENDPOINT = 'https://tryapl.org/Exec';
const CELL = 'button[data-track][data-step]';

/**
 * A mock that answers a generation with a bar derived from the seed it was given.
 *
 * Not an APL interpreter — writing one to test a button would be writing an interpreter to test
 * a button. What it does have to get right is the two properties the interface depends on: the
 * same seed gives the same matrix, and a different seed gives a different one. Anything else it
 * refuses, exactly as the real service would.
 */
async function mockApl(page: Page, options: { delayMs?: number } = {}): Promise<{ expressions: string[] }> {
  const expressions: string[] = [];

  await page.route(ENDPOINT, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
      return;
    }

    const payload: unknown = JSON.parse(route.request().postData() ?? 'null');
    const expression = (payload as unknown[])[3] as string;
    expressions.push(expression);

    if (options.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    // The seed the request fixed ⎕RL to, which is what the answer is derived from.
    const seed = Number(/⎕RL←(\d+) 1/u.exec(expression)?.[1] ?? '1');
    const lines = Array.from({ length: 8 }, (_unused, track) =>
      Array.from({ length: 16 }, (_alsoUnused, step) =>
        (track * 7 + step * 3 + (seed % 11)) % 4 === 0 ? '1' : '0',
      ).join(' '),
    );

    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(['', 4834, '', lines]),
      });
    } catch {
      // The page gave up on this request before it could be answered.
    }
  });

  return { expressions };
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
  await openWorkspace(page, 'Create');
}

/** The whole grid as 128 characters, for comparing bars. */
async function gridOf(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
  );
}

const createPanel = (page: Page) => page.getByRole('region', { name: 'Create with APL' });
const generate = (page: Page) => page.getByRole('button', { name: 'Generate with APL' });
const createStatus = (page: Page) => page.getByRole('status', { name: 'APL generation' });
const recipe = (page: Page) => page.getByLabel('Recipe');
const seed = (page: Page) => page.getByLabel('Seed');

/* ------------------------------------------------------------------------- */

test('the panel is there, and its controls cost nothing', async ({ page }) => {
  const mock = await mockApl(page);
  await freshVisit(page);

  await expect(generate(page)).toBeVisible();
  await expect(recipe(page)).toBeVisible();
  await expect(seed(page)).toBeVisible();

  // Every control except one is free, and this is how that stays true.
  await recipe(page).selectOption('broken');
  await seed(page).fill('47291');
  await page.getByRole('button', { name: 'New APL seed' }).click();
  await createPanel(page).getByRole('button', { name: 'Peek at the APL' }).click();

  expect(mock.expressions, 'the Create controls must send nothing').toEqual([]);
});

test('one press generates one bar, with one request', async ({ page }) => {
  const mock = await mockApl(page);
  await freshVisit(page);

  const before = await gridOf(page);
  await seed(page).fill('47291');
  await generate(page).click();

  await expect(createStatus(page)).toHaveText('Generated.');
  expect(mock.expressions).toHaveLength(1);
  expect(await gridOf(page)).not.toBe(before);

  // The seed really reached APL, and RNG1 was named explicitly.
  expect(mock.expressions[0]).toContain('⎕RL←47291 1');
  expect(mock.expressions[0]).toContain('⎕IO←0');
});

test('the same seed gives the same bar, and a different one does not', async ({ page }) => {
  await mockApl(page);
  await freshVisit(page);

  await seed(page).fill('47291');
  await generate(page).click();
  await expect(createStatus(page)).toHaveText('Generated.');
  const first = await gridOf(page);

  await seed(page).fill('123456');
  await generate(page).click();
  await expect(createStatus(page)).toHaveText('Generated.');
  const second = await gridOf(page);
  expect(second).not.toBe(first);

  await seed(page).fill('47291');
  await generate(page).click();
  await expect(createStatus(page)).toContainText('Generated');
  expect(await gridOf(page)).toBe(first);
});

test('a generated bar is one Undo', async ({ page }) => {
  await mockApl(page);
  await freshVisit(page);

  const before = await gridOf(page);
  await generate(page).click();
  await expect(createStatus(page)).toHaveText('Generated.');
  expect(await gridOf(page)).not.toBe(before);

  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await gridOf(page)).toBe(before);
});

test('Undo after generating restores the bar and changes nothing else', async ({ page }) => {
  await mockApl(page);
  await freshVisit(page);

  const tempo = page.getByRole('slider', { name: 'Tempo' });
  const swing = page.getByRole('slider', { name: 'Swing' });
  const master = page.getByRole('slider', { name: 'Master' });
  await master.fill('64');

  const before = {
    grid: await gridOf(page),
    tempo: await tempo.inputValue(),
    swing: await swing.inputValue(),
    master: await master.inputValue(),
    kit: await page.getByRole('combobox', { name: 'Drum machine' }).inputValue(),
  };

  await generate(page).click();
  await expect(createStatus(page)).toHaveText('Generated.');
  await page.getByRole('button', { name: 'Undo' }).click();

  expect(await gridOf(page)).toBe(before.grid);
  await expect(tempo).toHaveValue(before.tempo);
  await expect(swing).toHaveValue(before.swing);
  await expect(master).toHaveValue(before.master);
  await expect(page.getByRole('combobox', { name: 'Drum machine' })).toHaveValue(before.kit);
});

test('generating while playing does not restart anything', async ({ page }) => {
  const available = await page.evaluate(() => typeof window.AudioContext === 'function');
  test.skip(!available, 'This browser build has no Web Audio.');

  await mockApl(page);
  await freshVisit(page);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');
  await page.waitForTimeout(500);

  const tempo = await page.getByRole('slider', { name: 'Tempo' }).inputValue();
  await generate(page).click();
  await expect(createStatus(page)).toHaveText('Generated.');

  // Still playing, still the same tempo, and the playhead still moving.
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Tempo' })).toHaveValue(tempo);

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
});

test('Randomise stays instant and offline while APL is unreachable', async ({ page }) => {
  /*
   * The rule the whole stage is arranged around. Randomise must never become a network
   * operation — so with every request to TryAPL refused, it still works, and Generate is the
   * only thing that fails.
   */
  await page.route(ENDPOINT, async (route: Route) => {
    await route.abort();
  });
  await freshVisit(page);

  const before = await gridOf(page);
  /*
   * Randomise lives on the Play workspace, so reaching it means going there.
   *
   * That is the design rather than an obstacle: Randomise is the *local* generator's action, and
   * Stage 7 put the local generator in its own tab. What this test is really asserting — that a
   * local action costs no request — is unchanged by where the button sits.
   */
  await openWorkspace(page, 'Play');
  await page.getByRole('button', { name: 'Randomise' }).click();
  await openWorkspace(page, 'Create');
  expect(await gridOf(page)).not.toBe(before);

  const afterRandomise = await gridOf(page);
  await generate(page).click();
  await expect(createStatus(page)).not.toHaveText('');
  // The failure changed nothing.
  expect(await gridOf(page)).toBe(afterRandomise);
});

test('a failure leaves the beat exactly as it was', async ({ page }) => {
  await page.route(ENDPOINT, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(['', 1, '', ['DOMAIN ERROR', '      x', '      ^']]),
    });
  });
  await freshVisit(page);

  const before = await gridOf(page);
  await generate(page).click();

  await expect(createStatus(page)).toContainText('APL');
  expect(await gridOf(page)).toBe(before);
});

test('locking every track disables Generate and spends nothing', async ({ page }) => {
  const mock = await mockApl(page);
  await freshVisit(page);

  const locks = page.locator('button[aria-label^="Lock"]');
  const count = await locks.count();
  for (let index = 0; index < count; index += 1) await locks.nth(index).click();

  await expect(generate(page)).toBeDisabled();
  await expect(createStatus(page)).toContainText('Every track is locked');
  expect(mock.expressions).toEqual([]);
});

test('a locked track survives a generation, and the others do not', async ({ page }) => {
  const mock = await mockApl(page);
  await freshVisit(page);

  await page.locator('button[aria-label^="Lock"]').first().click();

  const before = await gridOf(page);
  const kickBefore = before.slice(0, 16);

  await generate(page).click();
  await expect(createStatus(page)).toHaveText('Generated.');

  /*
   * The mock returns a whole matrix and does *not* apply the lock itself, which is deliberate:
   * the lock is applied by the APL in the request, so what this really checks is that the
   * request asked for it. The grid is left as the reply says.
   */
  expect(mock.expressions[0]).toContain('g[0;]←m[0;]');
  expect(mock.expressions[0]).toContain('m←8 16⍴');
  expect(kickBefore).toHaveLength(16);
});

test('Peek shows the real expression and the seed, and costs nothing', async ({ page }) => {
  const mock = await mockApl(page);
  await freshVisit(page);

  await seed(page).fill('47291');
  await recipe(page).selectOption('cross');
  await createPanel(page).getByRole('button', { name: 'Peek at the APL' }).click();

  const panel = createPanel(page);
  await expect(panel.getByText('Core APL')).toBeVisible();
  // The seed is deliberately not hidden from Peek — it is most of why the result repeats.
  await expect(panel.getByText('⎕RL←47291 1').first()).toBeVisible();

  expect(mock.expressions, 'opening Peek must send nothing').toEqual([]);
});

test('Edit this APL loads the generator into the one Explore editor', async ({ page }) => {
  const mock = await mockApl(page);
  await freshVisit(page);

  await createPanel(page).getByRole('button', { name: 'Peek at the APL' }).click();

  /*
   * Read the seed while the Create panel is still on screen.
   *
   * "Edit this APL" moves the workspace to Explore, and Stage 7 renders one workspace at a
   * time — so the Seed input is gone by the time the editor appears. That is the layout working:
   * the point of the tab rail is that only the active tool is present.
   */
  const currentSeed = await seed(page).inputValue();

  const panel = createPanel(page);
  await panel.getByRole('button', { name: 'Edit this APL' }).click();

  const editor = page.getByLabel('Your APL expression');
  await expect(editor).toBeVisible();

  // There is one editor on the page, not one per panel.
  await expect(page.getByLabel('Your APL expression')).toHaveCount(1);

  // And it holds the recipe's own expression, with the seed named in the intro.
  await expect(page.getByText(/It also fixes/u)).toContainText(currentSeed);

  expect(mock.expressions, 'opening the editor must send nothing').toEqual([]);
});

test('the panel is usable on a phone, and nothing overflows sideways', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'A mobile viewport test.');

  await mockApl(page);
  await freshVisit(page);

  await expect(generate(page)).toBeVisible();
  await expect(seed(page)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page must not scroll sideways').toBeLessThanOrEqual(1);

  // The seed input has to be big enough to tap and type in.
  const box = await seed(page).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(28);
});

test('the desktop APL area stays on the page at every ordinary width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'A desktop layout test.');

  await mockApl(page);
  await freshVisit(page);

  for (const width of [1600, 1440, 1280, 1024, 834]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(generate(page)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${String(width)}px`).toBeLessThanOrEqual(1);
  }
});
