import { expect, test, type Page, type Route } from '@playwright/test';
import { createInitialGroove } from '@/pattern/initialGroove';
import type { Pattern } from '@/pattern/pattern';

/*
 * Explore, end to end, against a mocked TryAPL.
 *
 * **Not one live request is made by this file, or by any part of `npm run test:e2e`.** The mock
 * understands a small, honest subset of APL — enough to answer the expressions these tests
 * actually type — and computes its reply from the matrix it was really sent, so a wrong answer
 * here means the pipeline mangled something rather than that a fixture went stale.
 *
 * The test that matters most is the first one, and it is the product in one paragraph: make a
 * beat, peek at the APL, change ¯1 to ¯2, run it, hear the kick move, undo it.
 */

const ENDPOINT = 'https://tryapl.org/Exec';
const CELL = 'button[data-track][data-step]';
const GROOVE = createInitialGroove();

/* ------------------------------------------------------------------------- */

type Answer =
  | { readonly kind: 'apl'; readonly lines: readonly string[] }
  | { readonly kind: 'raw'; readonly status?: number; readonly body?: string };

interface Mock {
  /** Every expression received, in order. The request count is its length. */
  readonly expressions: string[];
}

interface MockOptions {
  readonly delayMs?: number;
  readonly answer?: (expression: string) => Answer;
}

async function mockApl(page: Page, options: MockOptions = {}): Promise<Mock> {
  const expressions: string[] = [];
  const answerFor = options.answer ?? ((expression: string) => evaluate(expression));

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

    const answer = answerFor(expression);
    try {
      await route.fulfill({
        status: answer.kind === 'raw' ? (answer.status ?? 200) : 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: answer.kind === 'raw' ? (answer.body ?? '') : JSON.stringify(['', 4834, '', answer.lines]),
      });
    } catch {
      // The page gave up on this request before it could be answered.
    }
  });

  return { expressions };
}

/* ---- a very small APL, for the expressions these tests type ---------------- */

/** The `8 16⍴…` literal, back as a pattern. */
function matrixIn(expression: string): Pattern {
  const literal = /8 16⍴([01 ]+)/u.exec(expression)?.[1] ?? '';
  const values = literal.trim().split(/\s+/u);
  return Array.from({ length: 8 }, (_unused, track) =>
    Array.from({ length: 16 }, (_alsoUnused, step) => values[track * 16 + step] === '1'),
  );
}

const rotate = (row: readonly boolean[], by: number): boolean[] => {
  const n = row.length;
  const shift = ((Math.trunc(by) % n) + n) % n;
  return Array.from({ length: n }, (_unused, index) => row[(index + shift) % n] === true);
};

const numberOf = (literal: string): number => Number(literal.replace('¯', '-'));

/**
 * Evaluate the handful of expression shapes these tests use.
 *
 * Deliberately tiny and deliberately honest: it recognises what it recognises and refuses the
 * rest with a SYNTAX ERROR, exactly as a real interpreter would. Writing a fuller APL here would
 * be writing an interpreter to test a text box.
 */
function evaluate(expression: string): Answer {
  const m = matrixIn(expression);
  const statements = expression.split(' ⋄ ');
  const assignment = statements[2] ?? '';

  /*
   * Both wrappings, because both controls come through here.
   *
   * Explore parenthesises the expression it was given — `m←(⌽m)` — so that whatever precedence
   * somebody wrote cannot reach the assignment. The built-in operations generate their own APL
   * and need no such bracket, so they emit `m←⌽m`. A mock that understood only one of them would
   * answer SYNTAX ERROR to the other and blame the application for it.
   */
  const indexed = /^m\[(¯?\d+);\]←\(?(.*?)\)?$/u.exec(assignment);
  const whole = /^m←\(?(.*?)\)?$/u.exec(assignment);
  const core = indexed?.[2] ?? whole?.[1] ?? '';
  const target = indexed === null ? 'all' : numberOf(indexed[1] ?? '0');

  /** A 16-long row, from the expressions a single-track target accepts. */
  const rowFrom = (source: string): boolean[] | null => {
    let match = /^(¯?\d+)⌽m\[(¯?\d+);\]$/u.exec(source);
    if (match !== null) return rotate(m[numberOf(match[2] ?? '0')] ?? [], numberOf(match[1] ?? '0'));

    match = /^⌽m\[(¯?\d+);\]$/u.exec(source);
    if (match !== null) return [...(m[numberOf(match[1] ?? '0')] ?? [])].reverse();

    match = /^m\[(¯?\d+);\]∨(¯?\d+)⌽m\[(¯?\d+);\]$/u.exec(source);
    if (match !== null) {
      const left = m[numberOf(match[1] ?? '0')] ?? [];
      const right = rotate(m[numberOf(match[3] ?? '0')] ?? [], numberOf(match[2] ?? '0'));
      return left.map((cell, index) => cell || right[index] === true);
    }

    match = /^0=(\d+)\|⍳16$/u.exec(source);
    if (match !== null) {
      const period = Number(match[1]);
      return Array.from({ length: 16 }, (_unused, index) => index % period === 0);
    }

    match = /^~m\[(¯?\d+);\]$/u.exec(source);
    if (match !== null) return (m[numberOf(match[1] ?? '0')] ?? []).map((cell) => !cell);

    return null;
  };

  /** A whole matrix, from the expressions "all tracks" accepts. */
  const matrixFrom = (source: string): Pattern | null => {
    if (source === '⌽m') return m.map((row) => [...row].reverse());
    const match = /^(¯?\d+)⌽m$/u.exec(source);
    if (match !== null) return m.map((row) => rotate(row, numberOf(match[1] ?? '0')));
    if (source === '~m') return m.map((row) => row.map((cell) => !cell));
    if (source === 'm') return m;
    return null;
  };

  const syntaxError: Answer = {
    kind: 'apl',
    lines: ['SYNTAX ERROR', `      ${assignment}`, '        ∧'],
  };

  if (target === 'all') {
    const result = matrixFrom(core);
    if (result === null) return syntaxError;
    return { kind: 'apl', lines: linesFor(result) };
  }

  const row = rowFrom(core);
  if (row === null) return syntaxError;
  const result = m.map((existing, index) => (index === target ? row : existing));
  return { kind: 'apl', lines: linesFor(result) };
}

function linesFor(pattern: Pattern): string[] {
  return pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join(' '));
}

/* ------------------------------------------------------------------------- */

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

async function gridOf(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
  );
}

function bitsOf(pattern: Pattern): string {
  return pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('');
}

/** Which steps a track fires on. */
function stepsOf(bits: string, track: number): number[] {
  return [...bits.slice(track * 16, (track + 1) * 16)].flatMap((bit, step) => (bit === '1' ? [step] : []));
}

const panel = (page: Page) => page.getByRole('region', { name: 'Transform with APL' });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Your APL expression' });
const runButton = (page: Page) => page.getByRole('button', { name: 'Run this APL' });
const exploreStatus = (page: Page) => page.getByRole('status', { name: 'Explore' });

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

/** Play, Peek, Explore. */
async function openExplore(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Peek at the APL' }).click();
  await page.getByRole('button', { name: 'Edit this APL' }).click();
  await expect(editor(page)).toBeVisible();
}

/* ------------------------------------------------------------------------- */

test('the whole point: peek, edit a number, run it, hear the kick move', async ({ page }) => {
  /*
   * The acceptance test for the entire stage, and deliberately the first one in the file. A
   * visitor makes a beat, looks at the APL behind it, changes ¯1 to ¯2, runs it, and the kick
   * moves by two sixteenths instead of one. Then they undo it.
   */
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);

  const before = await gridOf(page);
  expect(before).toBe(bitsOf(GROOVE));
  expect(stepsOf(before, 0)).toEqual([0, 6, 10, 14]);

  // Rotate the kick, as the fixed controls would.
  await panel(page).getByLabel('Target').selectOption('0');
  await panel(page).getByLabel('Operation').selectOption('rotate');

  await openExplore(page);

  // The editor starts on the expression that would genuinely have run.
  await expect(editor(page)).toHaveValue('¯1⌽m[0;]');
  expect(mock.expressions, 'opening Explore must send nothing').toEqual([]);

  // Change the number.
  await editor(page).fill('¯2⌽m[0;]');
  expect(mock.expressions, 'typing must send nothing').toEqual([]);

  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Applied.');

  // Exactly one request, carrying exactly what the editor showed.
  expect(mock.expressions).toHaveLength(1);
  expect(mock.expressions[0]).toContain('m[0;]←(¯2⌽m[0;])');

  // And the kick has moved two sixteenths later, not one.
  const after = await gridOf(page);
  expect(stepsOf(after, 0)).toEqual([2, 8, 12, 0].sort((a, b) => a - b));
  expect(after.slice(16)).toBe(before.slice(16));

  // One Undo puts it back exactly.
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await gridOf(page)).toBe(before);

  expect(problems).toEqual([]);
});

test('an expression can build one track out of another', async ({ page }) => {
  /*
   * The second realisation, and the one that makes it array programming rather than a number
   * box: the clap row does not have to come from the clap row.
   */
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);

  const before = await gridOf(page);
  await openExplore(page);

  await page.getByLabel('Result goes to').selectOption('4');
  await editor(page).fill('m[1;]∨2⌽m[1;]');
  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Applied.');

  const after = await gridOf(page);
  const snare = stepsOf(before, 1);
  const expected = [...new Set([...snare, ...snare.map((step) => (step + 14) % 16)])].sort((a, b) => a - b);
  expect(stepsOf(after, 4)).toEqual(expected);

  // Only the clap changed; the snare it was built from is untouched.
  expect(after.slice(0, 4 * 16)).toBe(before.slice(0, 4 * 16));
  expect(after.slice(5 * 16)).toBe(before.slice(5 * 16));

  expect(mock.expressions).toHaveLength(1);
  expect(problems).toEqual([]);
});

test('an expression can replace the whole matrix', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockApl(page);
  await freshVisit(page);
  await openExplore(page);

  const before = await gridOf(page);
  await page.getByLabel('Result goes to').selectOption('all');
  await editor(page).fill('⌽m');
  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Applied.');

  const expected = [...before.matchAll(/.{16}/gu)].map((row) => [...row[0]].reverse().join('')).join('');
  expect(await gridOf(page)).toBe(expected);

  expect(problems).toEqual([]);
});

test('the transport keeps playing through a run', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockApl(page);
  await freshVisit(page);

  const hasAudio = await page.evaluate(() => typeof window.AudioContext === 'function');
  test.skip(!hasAudio, 'This browser build has no Web Audio.');

  await openExplore(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');
  await page.waitForTimeout(400);

  await editor(page).fill('⌽m');
  await page.getByLabel('Result goes to').selectOption('all');
  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Applied.');

  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');

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

/* ------------------------------------------------------------------------- */

test('nothing but Run sends anything', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);
  await openExplore(page);

  // Type a great deal.
  await editor(page).fill('¯3⌽m[0;]');
  await editor(page).press('End');
  await editor(page).type('  ');

  // Insert glyphs.
  for (const glyph of ['⌽', '⍳', '⍴', '∨', '~']) {
    await page.getByRole('button', { name: new RegExp(`^Insert ${glyph}`, 'u') }).click();
  }

  // Change everything that can be changed.
  await page.getByLabel('Result goes to').selectOption('3');
  await page.getByLabel('Result goes to').selectOption('all');
  await panel(page).getByLabel('Operation').selectOption('euclidean');
  await panel(page).getByLabel('Target').selectOption('5');
  await page.getByRole('button', { name: 'Randomise' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();

  expect(mock.expressions).toEqual([]);
  expect(problems).toEqual([]);
});

test('Ctrl+Enter runs it, and holding it does not storm', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page, { delayMs: 700 });
  await freshVisit(page);
  await openExplore(page);

  await editor(page).fill('⌽m');
  await editor(page).focus();

  // Six presses while one is in flight. One request.
  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press('Control+Enter');
  }
  expect(mock.expressions).toHaveLength(1);

  await expect(exploreStatus(page)).toHaveText('Applied.', { timeout: 10_000 });
  expect(mock.expressions).toHaveLength(1);

  expect(problems).toEqual([]);
});

test('a plain Enter does not run anything', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);
  await openExplore(page);

  await editor(page).focus();
  await page.keyboard.press('Enter');

  expect(mock.expressions).toEqual([]);
  expect(problems).toEqual([]);
});

test('the same expression on the same bar is answered from memory', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);
  await openExplore(page);

  await page.getByLabel('Result goes to').selectOption('all');
  await editor(page).fill('⌽m');

  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Applied.');
  expect(mock.expressions).toHaveLength(1);

  // Reverse again: a different bar, so a real request — and it restores the original.
  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Applied.');
  expect(mock.expressions).toHaveLength(2);

  // Now it is the first question again, and the answer is remembered.
  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Applied, from cache.');
  expect(mock.expressions).toHaveLength(2);

  expect(problems).toEqual([]);
});

/* ------------------------------------------------------------------------- */

test('invalid APL is reported usefully, and the code survives', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockApl(page);
  await freshVisit(page);
  await openExplore(page);

  const before = await gridOf(page);
  await page.getByLabel('Result goes to').selectOption('all');
  await editor(page).fill('⌽⌽⌽nonsense');
  await runButton(page).click();

  await expect(exploreStatus(page)).toContainText('APL could not run that');
  // The interpreter's own words, which is the part somebody can act on.
  await expect(page.locator('[class*="aplError"]')).toContainText('SYNTAX ERROR');

  // Beat unchanged, code unchanged, nothing to undo.
  expect(await gridOf(page)).toBe(before);
  await expect(editor(page)).toHaveValue('⌽⌽⌽nonsense');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  expect(problems).toEqual([]);
});

test('an expression that cannot be wrapped is refused before any request', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);
  await openExplore(page);

  await editor(page).fill('⌽m ⋄ 0');

  await expect(exploreStatus(page)).toContainText('⋄');
  await expect(runButton(page)).toBeDisabled();
  expect(mock.expressions).toEqual([]);

  // Fixing it re-enables Run without anything having been sent.
  await editor(page).fill('⌽m');
  await expect(runButton(page)).toBeEnabled();
  expect(mock.expressions).toEqual([]);

  expect(problems).toEqual([]);
});

test('a reply that is not a rhythm is refused', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockApl(page, { answer: () => ({ kind: 'apl', lines: ['1 2 3', '4 5 6'] }) });
  await freshVisit(page);
  await openExplore(page);

  const before = await gridOf(page);
  await runButton(page).click();

  await expect(exploreStatus(page)).toContainText('APL sent something unexpected');
  expect(await gridOf(page)).toBe(before);

  expect(problems).toEqual([]);
});

test('a slow service times out, and the code is still there', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = watchForProblems(page);
  await mockApl(page, { delayMs: 9_000 });
  await freshVisit(page);
  await openExplore(page);

  const before = await gridOf(page);
  await editor(page).fill('⌽m');
  await page.getByLabel('Result goes to').selectOption('all');
  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Running APL…');

  await expect(exploreStatus(page)).toContainText('took too long', { timeout: 20_000 });
  expect(await gridOf(page)).toBe(before);
  await expect(editor(page)).toHaveValue('⌽m');

  expect(problems.filter((problem) => problem.startsWith('page:'))).toEqual([]);
});

test('a reply for a bar that has moved on is dropped', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page, { delayMs: 1200 });
  await freshVisit(page);
  await openExplore(page);

  await page.getByLabel('Result goes to').selectOption('all');
  await editor(page).fill('⌽m');
  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Running APL…');

  // The bar moves while the request is out.
  const edited = page.locator('button[data-track="6"][data-step="9"]');
  await edited.click();
  const afterEdit = await gridOf(page);

  await expect(exploreStatus(page)).toHaveText('', { timeout: 8000 });
  expect(await gridOf(page)).toBe(afterEdit);
  expect(mock.expressions).toHaveLength(1);

  expect(problems).toEqual([]);
});

test('a reply for code that has been rewritten is dropped', async ({ page }) => {
  /*
   * The staleness case Stage 5 adds. Editing during a run is allowed on purpose — the network
   * must not freeze somebody's writing — so it is the answer that gets discarded, and nothing
   * ever claims the expression on screen produced a result it did not.
   *
   * Note what is *not* asserted: that the status went quiet. Editing clears the status by
   * itself, so waiting for that would pass whether or not the reply was dropped. What proves it
   * is the grid: the request said "reverse everything", and after the reply has certainly
   * arrived the bar is still exactly as it was.
   */
  const problems = watchForProblems(page);
  const mock = await mockApl(page, { delayMs: 800 });
  await freshVisit(page);
  await openExplore(page);

  const before = await gridOf(page);
  await page.getByLabel('Result goes to').selectOption('all');
  await editor(page).fill('⌽m');
  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Running APL…');

  // Rewrite it while the answer is in the air.
  await editor(page).fill('~m');

  // Well past the reply. It arrived, and it was thrown away.
  await page.waitForTimeout(2000);
  expect(await gridOf(page)).toBe(before);
  await expect(editor(page)).toHaveValue('~m');
  expect(mock.expressions).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  // And running the new expression works normally.
  await runButton(page).click();
  await expect(exploreStatus(page)).toHaveText('Applied.', { timeout: 8000 });
  expect(await gridOf(page)).not.toBe(before);
  expect(mock.expressions).toHaveLength(2);

  expect(problems).toEqual([]);
});

/* ------------------------------------------------------------------------- */

test('the draft comes back, and never runs itself', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);
  await openExplore(page);

  await editor(page).fill('m[1;]∨2⌽m[1;]');
  await page.getByLabel('Result goes to').selectOption('4');
  // The write is debounced.
  await page.waitForTimeout(800);

  await page.reload();
  await expect(page.locator(CELL).first()).toBeVisible();
  await openExplore(page);

  await expect(editor(page)).toHaveValue('m[1;]∨2⌽m[1;]');
  await expect(page.getByLabel('Result goes to')).toHaveValue('4');
  expect(mock.expressions, 'a restored draft must not run itself').toEqual([]);

  expect(problems).toEqual([]);
});

test('the fixed controls do not overwrite a draft', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockApl(page);
  await freshVisit(page);
  await openExplore(page);

  await editor(page).fill('m[1;]∨2⌽m[1;]');

  await panel(page).getByLabel('Operation').selectOption('reverse');
  await panel(page).getByLabel('Target').selectOption('3');
  await panel(page).getByLabel('Operation').selectOption('euclidean');

  await expect(editor(page)).toHaveValue('m[1;]∨2⌽m[1;]');

  // Only the button that says so replaces it.
  await page.getByRole('button', { name: 'Load current transform' }).click();
  await expect(editor(page)).toHaveValue('5>16|5×⍳16');

  expect(problems).toEqual([]);
});

test('Apply with APL still works, and cannot run beside Explore', async ({ page }) => {
  /*
   * One execution lane, shown the way the interface shows it: while either control is running,
   * the other's button is disabled. The hook refuses a second request outright — there is a unit
   * test that calls it programmatically and counts — but in a browser the guarantee somebody
   * actually meets is that there is nothing to press.
   */
  const problems = watchForProblems(page);
  const mock = await mockApl(page, { delayMs: 900 });
  await freshVisit(page);
  await openExplore(page);

  const before = await gridOf(page);
  await panel(page).getByLabel('Operation').selectOption('reverse');
  await panel(page).getByLabel('Target').selectOption('all');

  await page.getByRole('button', { name: 'Apply with APL' }).click();
  await expect(runButton(page)).toBeDisabled();
  expect(mock.expressions).toHaveLength(1);

  await expect(page.getByRole('status', { name: 'APL transform' })).toHaveText('Applied.', {
    timeout: 8000,
  });
  expect(await gridOf(page)).not.toBe(before);
  // Explore said nothing, because Explore did nothing.
  await expect(exploreStatus(page)).toHaveText('');
  await expect(runButton(page)).toBeEnabled();

  // And the other way round: while Explore runs, Apply is disabled.
  await editor(page).fill('~m');
  await page.getByLabel('Result goes to').selectOption('all');
  await runButton(page).click();
  await expect(page.getByRole('button', { name: 'Apply with APL' })).toBeDisabled();
  await expect(exploreStatus(page)).toHaveText('Applied.', { timeout: 8000 });
  expect(mock.expressions).toHaveLength(2);

  expect(problems).toEqual([]);
});

test('Explore is usable on a phone, and nothing widens the page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, 'This project drives a pointer.');
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);
  await openExplore(page);

  await expect(editor(page)).toBeVisible();
  await editor(page).fill('⌽m');
  await page.getByLabel('Result goes to').selectOption('all');

  // Glyph buttons are real targets, not slivers.
  const glyph = page.getByRole('button', { name: /^Insert ⌽/u });
  const box = await glyph.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);

  await runButton(page).tap();
  await expect(exploreStatus(page)).toHaveText('Applied.');
  expect(mock.expressions).toHaveLength(1);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  expect(problems).toEqual([]);
});

test('a very long expression is refused locally, and says by how much', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);
  await openExplore(page);

  await editor(page).fill('1'.repeat(400));

  await expect(exploreStatus(page)).toContainText('320');
  await expect(runButton(page)).toBeDisabled();
  expect(mock.expressions).toEqual([]);

  expect(problems).toEqual([]);
});
