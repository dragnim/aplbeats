import { expect, test, type Page } from '@playwright/test';

/*
 * The workspace, and the theme.
 *
 * Stage 7 rebuilt the page: a tab rail beside the sequencer instead of four cards stacked down a
 * long one, and a light theme beside the dark. Both are structural enough that a suite which
 * only checked the musical behaviour would let either rot without noticing.
 *
 * What is checked here is what a redesign can actually break: that the tabs are real tabs a
 * keyboard can drive, that the active one is exposed to assistive technology rather than only
 * coloured, that the theme is remembered and beats the system once chosen, and that switching
 * either of them costs nothing — no request, no lost work.
 *
 * What is *not* checked here is how any of it looks. `review:layout` measures the widths and
 * takes the screenshots; pixel assertions in a suite like this age badly and catch little.
 */

const CELL = 'button[data-track][data-step]';
const THEME_KEY = 'aplbeats.theme.v1';

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

/** Requests to TryAPL, counted. Passive interface work must make none. */
function watchApl(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://tryapl.org')) seen.push(request.url());
  });
  return seen;
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
/**
 * What the document says the theme is, asserted with retries.
 *
 * The attribute is written by a React effect, so a plain `evaluate` can read the frame before it
 * lands — which is a flake rather than a finding. `expect.poll` waits the way a locator assertion
 * would.
 */
const themeOf = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const expectTheme = async (page: Page, value: string | null, because = ''): Promise<void> => {
  await expect.poll(() => themeOf(page), { message: because }).toBe(value);
};
const toggle = (page: Page) => page.getByRole('button', { name: /Switch to (dark|light) theme/u });

/* ---- the workspace rail -------------------------------------------------- */

test('the four workspaces are real tabs, and one is selected', async ({ page }) => {
  await freshVisit(page);

  const list = page.getByRole('tablist', { name: 'Workspace' });
  await expect(list).toBeVisible();
  // Four, inside the Workspace list. There are two more above it since Stage 8 — the Beats and
  // Tones layer tabs — which are a different tablist and are tested in `tones.spec.ts`.
  await expect(list.getByRole('tab')).toHaveCount(4);

  // Play first, because that is what somebody is here for.
  await expect(tab(page, 'Play')).toHaveAttribute('aria-selected', 'true');
  for (const name of ['Create', 'Transform', 'Explore']) {
    await expect(tab(page, name)).toHaveAttribute('aria-selected', 'false');
  }
});

test('each tab shows its own workspace, and only that one', async ({ page }) => {
  await freshVisit(page);

  await expect(page.getByRole('button', { name: 'Randomise' })).toBeVisible();

  await tab(page, 'Create').click();
  await expect(page.getByRole('button', { name: 'Generate with APL' })).toBeVisible();
  // One workspace at a time is the whole point: the last one is gone, not merely hidden.
  await expect(page.getByRole('button', { name: 'Randomise' })).toHaveCount(0);

  await tab(page, 'Transform').click();
  await expect(page.getByRole('button', { name: 'Apply with APL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate with APL' })).toHaveCount(0);

  await tab(page, 'Explore').click();
  await expect(page.getByLabel('Your APL expression')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply with APL' })).toHaveCount(0);
});

test('the selected tab is announced, not merely coloured', async ({ page }) => {
  await freshVisit(page);
  await tab(page, 'Transform').click();

  await expect(tab(page, 'Transform')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Play')).toHaveAttribute('aria-selected', 'false');

  // And it names the panel it opens, so a reader can get from one to the other.
  const controls = await tab(page, 'Transform').getAttribute('aria-controls');
  expect(controls).toBeTruthy();
  await expect(page.locator(`#${String(controls)}`)).toHaveAttribute('role', 'tabpanel');
});

test('arrow keys move between tabs, as a tablist should', async ({ page }) => {
  await freshVisit(page);

  await tab(page, 'Play').focus();
  await page.keyboard.press('ArrowDown');
  await expect(tab(page, 'Create')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowDown');
  await expect(tab(page, 'Transform')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowUp');
  await expect(tab(page, 'Create')).toHaveAttribute('aria-selected', 'true');

  // Home and End reach the ends; the list wraps rather than stopping.
  await page.keyboard.press('End');
  await expect(tab(page, 'Explore')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(tab(page, 'Play')).toHaveAttribute('aria-selected', 'true');
});

test('the rail reports the orientation it is actually drawn in', async ({ page }) => {
  /*
   * `aria-orientation` is a claim about what is on screen, and the rail has two shapes: a vertical
   * column beside the sequencer, and a horizontal strip above the APL panel on a narrow screen. It
   * claimed vertical in both until this was fixed.
   *
   * The claim is not made by React guessing a width — the stylesheet declares
   * `--rail-orientation` in the same media query that turns the flex direction, and the component
   * reads it back. So this test is also checking that the two cannot drift apart: it asserts the
   * ARIA against the *computed flex direction*, which is the layout itself rather than a second
   * copy of the breakpoint.
   */
  await freshVisit(page);
  const list = page.getByRole('tablist', { name: 'Workspace' });

  const drawnDirection = (): Promise<string> =>
    list.evaluate((element) => getComputedStyle(element).flexDirection);

  /*
   * The rail turns at 61.9375rem — 991px — which is its own breakpoint and not the one where the
   * APL column stops sitting beside the sequencer. 1024 is above it, so the rail is still a
   * vertical column there even though the workspace has already stacked. The two widths either
   * side of 991 are the ones worth asserting.
   */
  for (const [width, expected] of [
    [1600, 'vertical'],
    [1280, 'vertical'],
    [1024, 'vertical'],
    [960, 'horizontal'],
    [390, 'horizontal'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });

    await expect(list, `aria-orientation at ${String(width)}px`).toHaveAttribute(
      'aria-orientation',
      expected,
    );

    // And the layout agrees, which is the half a hard-coded breakpoint would let rot.
    await expect
      .poll(drawnDirection, { message: `flex direction at ${String(width)}px` })
      .toBe(expected === 'vertical' ? 'column' : 'row');
  }
});

test('every tab carries its word, not only a glyph', async ({ page }) => {
  await freshVisit(page);
  // Mystery-meat navigation is the failure mode a rail of icons invites. Each has both.
  for (const name of ['Play', 'Create', 'Transform', 'Explore']) {
    await expect(tab(page, name)).toContainText(name);
  }
});

test('every workspace wears the same card', async ({ page }) => {
  /*
   * Explore did not, and it was visible: it had been styled as a section *inside* the Transform
   * panel's Peek — a top rule and some padding, which is what a divided-off block wants — and
   * Stage 7 lifted it out to be a workspace without giving it the card the others have.
   *
   * The card is one declaration now, in `AplPanel.module.css`, composed or used directly by all
   * four. This compares them as *computed* values rather than asserting particular colours, so it
   * keeps holding in both themes and after any future change to what the card looks like — what
   * it is checking is that they agree, not what they agree on.
   */
  await freshVisit(page);

  const surfaceOf = async (name: string): Promise<Record<string, string>> => {
    await tab(page, name).click();
    return (
      page
        /*
         * The *workspace* panel, not the layer one.
         *
         * Stage 8 put a second tablist above this one, so there are two tab panels on the page:
         * the layer panel wraps the whole workspace and is transparent by design, and the APL
         * column inside it is the card being compared. The layer panel's id carries `domain`.
         */
        .locator('[role="tabpanel"]:not([id*="domain"])')
        .locator('section, > div')
        .first()
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            background: style.backgroundColor,
            radius: style.borderTopLeftRadius,
            border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
            padding: style.paddingTop,
            shadow: style.boxShadow,
          };
        })
    );
  };

  const reference = await surfaceOf('Transform');
  // A card at all, rather than a transparent block on the page background.
  expect(reference.background).not.toBe('rgba(0, 0, 0, 0)');

  for (const name of ['Play', 'Create', 'Explore']) {
    expect(await surfaceOf(name), `${name} does not match the workspace card`).toEqual(reference);
  }
});

test('switching workspaces sends nothing', async ({ page }) => {
  const apl = watchApl(page);
  await freshVisit(page);

  for (const name of ['Create', 'Transform', 'Explore', 'Play', 'Create']) {
    await tab(page, name).click();
  }

  expect(apl, 'moving between workspaces must not reach TryAPL').toEqual([]);
});

test('an Explore draft survives being switched away from', async ({ page }) => {
  /*
   * Only the active workspace is rendered, so the editor is genuinely unmounted when you leave
   * it. The draft lives in `useApl` rather than in the textarea, which is what makes that safe —
   * and this is the test that would notice if it ever stopped being true.
   */
  await freshVisit(page);

  await tab(page, 'Explore').click();
  const editor = page.getByLabel('Your APL expression');
  await editor.fill('~m');

  await tab(page, 'Play').click();
  await expect(page.getByLabel('Your APL expression')).toHaveCount(0);

  await tab(page, 'Explore').click();
  await expect(page.getByLabel('Your APL expression')).toHaveValue('~m');
});

test('Edit this APL moves the workspace to Explore', async ({ page }) => {
  await freshVisit(page);

  await tab(page, 'Transform').click();
  await page.getByRole('button', { name: 'Peek at the APL' }).click();
  await page.getByRole('button', { name: 'Edit this APL' }).click();

  await expect(tab(page, 'Explore')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Your APL expression')).toBeVisible();
});

/* ---- the theme ----------------------------------------------------------- */

test('opens dark when the system has no preference, and says so', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await freshVisit(page);

  // Nothing stored, so the attribute is absent and the stylesheet decides.
  await expectTheme(page, null);
  await expect(toggle(page)).toHaveAccessibleName('Switch to light theme');

  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background, 'a dark stage').toBe('rgb(13, 14, 17)');
});

test('follows a system that asks for light, without storing anything', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await freshVisit(page);

  await expectTheme(page, null, 'following the system is the absence of an attribute');
  await expect(toggle(page)).toHaveAccessibleName('Switch to dark theme');

  const stored = await page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY);
  expect(stored, 'a page nobody has touched must not opt them out of their system').toBeNull();
});

test('the toggle switches, persists, and beats the system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await freshVisit(page);

  await toggle(page).click();
  await expectTheme(page, 'light');
  await expect(toggle(page)).toHaveAccessibleName('Switch to dark theme');

  // It survives a reload, and the explicit choice wins over a system that still says dark.
  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();
  await expectTheme(page, 'light');

  await toggle(page).click();
  await expectTheme(page, 'dark');
  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();
  await expectTheme(page, 'dark');
});

test('choosing dark sticks even when the system prefers light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await freshVisit(page);

  await toggle(page).click();
  await expectTheme(page, 'dark');

  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();
  await expectTheme(page, 'dark', 'an explicit choice is not overruled by the system');
});

test('both themes mount cleanly and keep the orange', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });

  await freshVisit(page);

  for (const expected of ['light', 'dark']) {
    await toggle(page).click();
    if ((await themeOf(page)) !== expected) await toggle(page).click();
    await expectTheme(page, expected);

    // The grid is whole, and an active step is still the identity orange in both themes.
    await expect(page.locator(CELL)).toHaveCount(128);
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    );
    expect(accent, 'the accent is the brand and does not change with the theme').toBe('#ff6a13');
  }

  expect(problems).toEqual([]);
});

test('switching theme sends nothing and keeps the beat', async ({ page }) => {
  const apl = watchApl(page);
  await freshVisit(page);

  const before = await page.evaluate(() =>
    [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
  );

  await toggle(page).click();
  await toggle(page).click();

  const after = await page.evaluate(() =>
    [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
  );

  expect(after).toBe(before);
  expect(apl).toEqual([]);
});

/* ---- the shell ----------------------------------------------------------- */

test('Undo sits in the top bar, reachable from every workspace', async ({ page }) => {
  /*
   * It used to live in the generator panel, which was fine when that panel was always on screen.
   * With tabs it would have meant generating a bar on Create and having to leave to take it back.
   */
  await freshVisit(page);

  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeDisabled();

  await page.getByRole('button', { name: 'Randomise' }).click();
  await expect(undo).toBeEnabled();

  for (const name of ['Create', 'Transform', 'Explore']) {
    await tab(page, name).click();
    await expect(undo, `Undo must be reachable from ${name}`).toBeEnabled();
  }

  const before = await page.evaluate(() =>
    [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
  );
  await undo.click();
  const after = await page.evaluate(() =>
    [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
  );
  expect(after).not.toBe(before);
});

test('the transport stays in one row on a desktop, as Stage 5.1 fixed it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'A desktop layout test.');

  await freshVisit(page);

  for (const width of [1600, 1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });

    const rows = await page.evaluate(() => {
      const play = document.querySelector('button[aria-label="Play"], button[aria-label="Pause"]');
      const master = document.querySelector('input[aria-label="Master volume"]');
      if (play === null || master === null) return null;
      return {
        play: Math.round(play.getBoundingClientRect().top),
        master: Math.round(master.getBoundingClientRect().top),
      };
    });

    expect(rows, `the transport is missing at ${String(width)}px`).not.toBeNull();
    // Same row: the drum machine falling to a second line was the Stage 5.1 regression.
    expect(Math.abs((rows?.play ?? 0) - (rows?.master ?? 0)), `wrapped at ${String(width)}px`).toBeLessThan(
      24,
    );
  }
});
