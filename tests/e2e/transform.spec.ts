import { expect, test, type Page, type Route } from '@playwright/test';
import { operationById, type Parameters, type Target } from '@/apl/operations';
import { applyReferenceTransform } from '@/apl/reference';
import { createInitialGroove } from '@/pattern/initialGroove';
import type { Pattern } from '@/pattern/pattern';

/*
 * Transform with APL, end to end, against a mocked TryAPL.
 *
 * **Not one live request is made by this file, or by any part of `npm run test:e2e`.** TryAPL
 * is somebody else's service and a CI suite that hammered it on every push would be exactly
 * the behaviour this project promised not to build. What is mocked is only the network: the
 * source generation, the wire encoding, the response validation, the staleness rule, the
 * cache and the Undo integration are all the real ones, running in a real browser.
 *
 * The mock earns its keep by computing its answer from the matrix it was actually sent, using
 * the reference implementations. A fake returning a fixed reply would pass every one of these
 * tests while proving almost nothing — the interesting failures are all of the form "the
 * matrix that came back was not the matrix that went in".
 *
 * Live APL is verified separately and deliberately, by `npm run verify:apl-live`, by hand.
 */

const ENDPOINT = 'https://tryapl.org/Exec';
const CELL = 'button[data-track][data-step]';

/** The groove the page opens on, so expectations can be computed rather than pasted. */
const GROOVE = createInitialGroove();

/* ------------------------------------------------------------------------- */

/** How the mock should answer one request. */
type Answer =
  | { readonly kind: 'apl'; readonly lines: readonly string[] }
  | { readonly kind: 'raw'; readonly status?: number; readonly body?: string }
  | { readonly kind: 'abort' };

interface MockOptions {
  /** Held before answering, for the staleness and timeout tests. */
  readonly delayMs?: number;
  /** Decides the answer from the expression. Defaults to performing the transform. */
  readonly answer?: (expression: string) => Answer;
}

interface Mock {
  /** Every expression received, in order. The request count is its length. */
  readonly expressions: string[];
}

/**
 * Intercept TryAPL.
 *
 * Both the POST and its CORS preflight: the client sends `application/json`, which is not a
 * simple request, so the browser asks first. Whether Playwright routes the preflight or
 * handles it itself varies, so both are answered here and neither can be the reason a test
 * fails.
 */
async function mockApl(page: Page, options: MockOptions = {}): Promise<Mock> {
  const expressions: string[] = [];
  const answerFor = options.answer ?? ((expression: string) => performTransform(expression));

  await page.route(ENDPOINT, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
        },
      });
      return;
    }

    const expression = expressionOf(route.request().postData());
    expressions.push(expression);

    if (options.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    const answer = answerFor(expression);

    /*
     * Swallowed, because answering a request the page has given up on is not a failure.
     *
     * The timeout test depends on it: the client aborts at six seconds and the handler is
     * still holding the reply, so the fulfil that follows has nowhere to go.
     */
    try {
      if (answer.kind === 'abort') {
        await route.abort('failed');
      } else if (answer.kind === 'raw') {
        await route.fulfill({
          status: answer.status ?? 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: answer.body ?? '',
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          // Items 1 and 2 are opaque; the live service sends a sequence number and a blob.
          body: JSON.stringify(['', 4834, '', answer.lines]),
        });
      }
    } catch {
      // The request was abandoned before this could answer it.
    }
  });

  return { expressions };
}

/** The expression out of a request body, validated as the real wire format. */
function expressionOf(postData: string | null): string {
  expect(postData, 'the request had no body').not.toBeNull();
  const payload: unknown = JSON.parse(postData ?? 'null');
  expect(Array.isArray(payload)).toBe(true);
  const items = payload as unknown[];
  expect(items).toHaveLength(4);
  // A fresh workspace every time. Sending a returned state back answers CORRUPT WS.
  expect(items[0]).toBe('');
  expect(typeof items[3]).toBe('string');
  return items[3] as string;
}

/**
 * Perform the transform the expression describes, as APL would.
 *
 * Reads the matrix out of the literal the application built and the operation out of the
 * core, then hands the work to the reference implementations — so the mock transforms what it
 * was sent rather than returning something prepared in advance.
 */
function performTransform(expression: string): Answer {
  const pattern = matrixIn(expression);
  const { operationId, target, parameters } = readIntent(expression);
  const result = applyReferenceTransform(operationById(operationId), target, parameters, pattern);
  return { kind: 'apl', lines: aplLinesFor(result) };
}

/** The `8 16⍴…` literal, back as a pattern. */
function matrixIn(expression: string): Pattern {
  const literal = /8 16⍴([01 ]+)/u.exec(expression)?.[1];
  expect(literal, `no 8 16⍴ literal in ${expression}`).toBeDefined();
  const values = (literal ?? '').trim().split(/\s+/u);
  expect(values).toHaveLength(128);
  return Array.from({ length: 8 }, (_unused, track) =>
    Array.from({ length: 16 }, (_alsoUnused, step) => values[track * 16 + step] === '1'),
  );
}

/**
 * What the expression is asking for.
 *
 * Recognised from the generated APL rather than passed in alongside it, which is a small
 * assertion in its own right: if the source builder stopped producing the expression these
 * patterns describe, the mock would fail to understand it and the test would say so.
 */
function readIntent(expression: string): {
  operationId: string;
  target: Target;
  parameters: Parameters;
} {
  const statements = expression.split(' ⋄ ');
  const assignment = statements[2] ?? '';

  const indexed = /^m\[(¯?\d+);\]←(.*)$/u.exec(assignment);
  const target: Target = indexed === null ? 'all' : Number(aplToJs(indexed[1] ?? '0'));
  const core = indexed === null ? assignment.replace(/^m←/u, '') : (indexed[2] ?? '');

  // Periodic and Euclidean, with an optional leading rotation.
  const periodic = /^(?:(¯?\d+)⌽)?0=(¯?\d+)\|⍳16$/u.exec(core);
  if (periodic !== null) {
    return {
      operationId: 'periodic',
      target,
      parameters: {
        period: aplToJs(periodic[2] ?? '4'),
        rotation: aplToJs(periodic[1] ?? '0'),
      },
    };
  }

  const euclidean = /^(?:(¯?\d+)⌽)?(¯?\d+)>16\|(?:¯?\d+)×⍳16$/u.exec(core);
  if (euclidean !== null) {
    return {
      operationId: 'euclidean',
      target,
      parameters: {
        pulses: aplToJs(euclidean[2] ?? '5'),
        rotation: aplToJs(euclidean[1] ?? '0'),
      },
    };
  }

  const rotate = /^(¯?\d+)⌽/u.exec(core);
  if (rotate !== null) {
    return { operationId: 'rotate', target, parameters: { amount: aplToJs(rotate[1] ?? '0') } };
  }

  expect(core.startsWith('⌽'), `unrecognised core APL: ${core}`).toBe(true);
  return { operationId: 'reverse', target, parameters: {} };
}

/** An APL numeric literal as a number. The high minus is part of the literal. */
function aplToJs(literal: string): number {
  return Number(literal.replace('¯', '-'));
}

/** A pattern as the live service prints it: eight lines of sixteen space-separated digits. */
function aplLinesFor(pattern: Pattern): string[] {
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

/** The whole grid as 128 characters, for comparing bars. */
async function gridOf(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
  );
}

/** Which steps a track's row has a hit on. Reads a grid string, not a pattern. */
function stepsOf(bits: string, track: number): number[] {
  const row = bits.slice(track * 16, (track + 1) * 16);
  return [...row].flatMap((bit, step) => (bit === '1' ? [step] : []));
}

function bitsOf(pattern: Pattern): string {
  return pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('');
}

/** What the reference says an operation should produce from the opening groove. */
function expected(
  operationId: string,
  target: Target,
  parameters: Parameters,
  from: Pattern = GROOVE,
): string {
  return bitsOf(applyReferenceTransform(operationById(operationId), target, parameters, from));
}

/** Start from the documented opening state, with no stored session. */
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

const panel = (page: Page) => page.getByRole('region', { name: 'Transform with APL' });
const status = (page: Page) => page.getByRole('status', { name: 'APL transform' });
const applyButton = (page: Page) => page.getByRole('button', { name: /Apply with APL|Running APL/u });

/** Skip unless this browser can make a sound. */
async function requireAudio(page: Page): Promise<void> {
  const available = await page.evaluate(() => typeof window.AudioContext === 'function');
  test.skip(!available, 'This browser build has no Web Audio.');
}

/* ------------------------------------------------------------------------- */

test('opens with the panel visible and nothing sent', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);

  await expect(panel(page)).toBeVisible();
  await expect(applyButton(page)).toBeEnabled();
  await expect(status(page)).toHaveText('');

  // The opening groove, untouched, and not a single request to show it.
  expect(await gridOf(page)).toBe(bitsOf(GROOVE));
  expect(mock.expressions).toEqual([]);

  expect(problems).toEqual([]);
});

test('the whole flow: choose, peek, apply, undo', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);

  const before = await gridOf(page);
  expect(before).toBe(bitsOf(GROOVE));

  // Kick, rotated one step later.
  await panel(page).getByLabel('Target').selectOption('0');
  await panel(page).getByLabel('Operation').selectOption('rotate');
  await panel(page).getByLabel('Steps').fill('-1');

  /*
   * Peek, before anything has been sent.
   *
   * The point of the feature is that the code on screen is the code that runs, so the
   * expression is read here and compared with what actually goes over the wire below.
   */
  await page.getByRole('button', { name: 'Peek at the APL' }).click();
  await expect(panel(page).getByText('Core APL')).toBeVisible();
  const core = (await panel(page).locator('pre code').first().innerText()).trim();
  expect(core).toBe('¯1⌽m[0;]');
  expect(mock.expressions, 'looking at the APL must not send it').toEqual([]);

  const fullRequest = (await panel(page).locator('pre code').last().innerText()).trim();
  expect(fullRequest).toContain('⎕IO←0');
  expect(fullRequest).toContain('8 16⍴');

  await applyButton(page).click();
  await expect(status(page)).toHaveText('Applied.');

  // Exactly one request, and it carried exactly what Peek promised.
  expect(mock.expressions).toHaveLength(1);
  const sent = mock.expressions[0] ?? '';
  expect(sent).toContain(core);
  expect(sent).toBe(fullRequest.split('\n').join(' ⋄ '));

  // The grid now shows what APL sent back.
  const after = await gridOf(page);
  expect(after).toBe(expected('rotate', 0, { amount: -1 }));
  expect(after).not.toBe(before);

  // Musically: the kick was on 0, 6, 10 and 14, and is now one sixteenth later throughout.
  expect(stepsOf(after, 0)).toEqual([1, 7, 11, 15]);
  // And only the kick moved.
  expect(after.slice(16)).toBe(before.slice(16));

  // And one Undo puts it back, exactly.
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await gridOf(page)).toBe(before);

  expect(problems).toEqual([]);
});

test('Reverse, Periodic and Euclidean each transform through APL', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);

  /* Reverse, on the whole matrix. */
  await panel(page).getByLabel('Operation').selectOption('reverse');
  await panel(page).getByLabel('Target').selectOption('all');
  await applyButton(page).click();
  await expect(status(page)).toHaveText('Applied.');
  expect(await gridOf(page)).toBe(expected('reverse', 'all', {}));

  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await gridOf(page)).toBe(bitsOf(GROOVE));

  /* Periodic: a closed hat every four steps. Row 4 is the closed hat. */
  await panel(page).getByLabel('Operation').selectOption('periodic');
  await panel(page).getByLabel('Target').selectOption('4');
  await panel(page).getByLabel('Every').fill('4');
  await applyButton(page).click();
  await expect(status(page)).toHaveText('Applied.');

  const withPulse = await gridOf(page);
  expect(withPulse).toBe(expected('periodic', 4, { period: 4, rotation: 0 }));
  // Four hits, on the four beats, and nowhere else.
  expect(withPulse.slice(4 * 16, 5 * 16)).toBe('1000100010001000');

  /* Euclidean: five hits across sixteen, on the same row. */
  await panel(page).getByLabel('Operation').selectOption('euclidean');
  await panel(page).getByLabel('Target').selectOption('4');
  await panel(page).getByLabel('Hits').fill('5');
  await applyButton(page).click();
  await expect(status(page)).toHaveText('Applied.');

  const euclid = (await gridOf(page)).slice(4 * 16, 5 * 16);
  // 5×⍳16 wrapped at 16 comes round on steps 0, 4, 7, 10 and 13 — gaps of 4, 3, 3, 3, 3.
  expect(euclid).toBe('1000100100100100');
  expect(stepsOf(await gridOf(page), 4)).toEqual([0, 4, 7, 10, 13]);

  // Three transforms, three requests, and three Undo entries.
  expect(mock.expressions).toHaveLength(3);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect((await gridOf(page)).slice(4 * 16, 5 * 16)).toBe('1000100010001000');

  expect(problems).toEqual([]);
});

test('the shift moves a Euclidean figure without changing its density', async ({ page }) => {
  // Rotating a generated pulse is the operation the brief asked to be tried musically:
  // the same five hits, arriving somewhere else.
  const problems = watchForProblems(page);
  await mockApl(page);
  await freshVisit(page);

  await panel(page).getByLabel('Operation').selectOption('euclidean');
  await panel(page).getByLabel('Target').selectOption('5');
  await panel(page).getByLabel('Hits').fill('5');
  await panel(page).getByLabel('Shift').fill('3');
  await applyButton(page).click();
  await expect(status(page)).toHaveText('Applied.');

  const row = (await gridOf(page)).slice(5 * 16, 6 * 16);
  expect(row).toBe(expected('euclidean', 5, { pulses: 5, rotation: 3 }).slice(5 * 16, 6 * 16));
  expect([...row].filter((bit) => bit === '1')).toHaveLength(5);

  expect(problems).toEqual([]);
});

test('playback carries on, and carries the transformed bar', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockApl(page);
  await freshVisit(page);
  await requireAudio(page);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');

  await panel(page).getByLabel('Operation').selectOption('reverse');
  await panel(page).getByLabel('Target').selectOption('all');
  await applyButton(page).click();
  await expect(status(page)).toHaveText('Applied.');

  // The bar changed under the playhead, and the transport did not so much as flinch.
  expect(await gridOf(page)).toBe(expected('reverse', 'all', {}));
  await expect(page.getByRole('status', { name: 'Playback' })).toHaveText('Playing');

  /*
   * The playhead is still moving.
   *
   * Which is the only thing this suite can honestly say about the transform reaching the
   * audio: the scheduler reads the current pattern rather than a copy taken at Play, and
   * that it kept scheduling at all is what a browser can demonstrate. There is no output
   * device to listen to.
   */
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

test('Peek shows the whole request, and nothing widens the page', async ({ page }) => {
  /*
   * The full request is one logical line of about three hundred characters, and the entire
   * reason it is on screen is so that all of it can be read. It used to be cut mid-digit at
   * the container edge — legal, since the box scrolls, but it read as a rendering fault and
   * showed the visitor the first third of the thing the feature exists to show.
   *
   * The matrix block above it is the opposite case and must *not* wrap: sixteen digits in a
   * row is only a row while it stays on one line.
   */
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);

  await page.getByRole('button', { name: 'Peek at the APL' }).click();
  await expect(panel(page).getByText('Core APL')).toBeVisible();

  const blocks = await page.evaluate(() =>
    [...document.querySelectorAll('[class*="peekBody"] pre')].map((pre) => ({
      overflow: pre.scrollWidth - pre.clientWidth,
      wraps: getComputedStyle(pre).whiteSpace === 'pre-wrap',
      text: (pre.textContent ?? '').slice(0, 12),
    })),
  );
  expect(blocks).toHaveLength(3);

  // The request wraps, so all of it is visible.
  const request = blocks[2];
  expect(request?.wraps, 'the full request should wrap rather than scroll').toBe(true);
  expect(request?.overflow, 'a wrapped block should not overflow').toBeLessThanOrEqual(0);

  // The matrix keeps its alignment, whether or not it needs to scroll to do so.
  expect(blocks[1]?.wraps, 'the matrix must not wrap').toBe(false);

  // And nothing in Peek widens the page, which the sixteen-step bar cannot afford.
  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(documentOverflow).toBeLessThanOrEqual(1);

  expect(mock.expressions).toEqual([]);
  expect(problems).toEqual([]);
});

test('nothing but Apply sends anything', async ({ page }) => {
  /*
   * The promise made to TryAPL, in a real browser.
   *
   * Covered by the integration tests as well, and worth repeating here because this is the
   * whole application: playback running, cells being edited, Randomise pressed, sliders
   * dragged, and the panel's own controls exercised.
   */
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);

  await panel(page).getByLabel('Operation').selectOption('euclidean');
  await panel(page).getByLabel('Target').selectOption('3');
  for (const hits of ['2', '5', '9', '13']) {
    await panel(page).getByLabel('Hits').fill(hits);
  }
  for (const shift of ['1', '2', '3']) {
    await panel(page).getByLabel('Shift').fill(shift);
  }
  await page.getByRole('button', { name: 'Peek at the APL' }).click();
  await panel(page).getByLabel('Operation').selectOption('rotate');
  await panel(page).getByLabel('Target').selectOption('all');

  await page.locator('button[data-track="2"][data-step="5"]').click();
  await page.getByRole('button', { name: 'Randomise' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();

  expect(mock.expressions).toEqual([]);
  expect(problems).toEqual([]);
});

test('the same transform twice costs one request', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);

  await panel(page).getByLabel('Operation').selectOption('reverse');
  await panel(page).getByLabel('Target').selectOption('all');

  await applyButton(page).click();
  await expect(status(page)).toHaveText('Applied.');
  const reversed = await gridOf(page);
  expect(mock.expressions).toHaveLength(1);

  // Undone and asked again: the same question about the same bar, answered from memory.
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await gridOf(page)).toBe(bitsOf(GROOVE));

  await applyButton(page).click();
  await expect(status(page)).toHaveText('Applied, from cache.');
  expect(await gridOf(page)).toBe(reversed);
  expect(mock.expressions, 'a cached answer must not reach the network').toHaveLength(1);

  expect(problems).toEqual([]);
});

/* ------------------------------------------------------------------------- */

test('a server failure leaves the beat alone and says so', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page, {
    answer: () => ({ kind: 'raw', status: 503, body: 'Service Unavailable' }),
  });
  await freshVisit(page);

  const before = await gridOf(page);
  await applyButton(page).click();

  await expect(status(page)).toHaveText('APL is unavailable right now. Your beat was not changed.');
  expect(await gridOf(page)).toBe(before);
  // Nothing happened, so there is nothing to undo.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  // And it did not try again.
  expect(mock.expressions).toHaveLength(1);

  // The visitor can retry, and a working service is not held against them.
  await page.unroute(ENDPOINT);
  const second = await mockApl(page);
  await applyButton(page).click();
  await expect(status(page)).toHaveText('Applied.');
  expect(await gridOf(page)).not.toBe(before);
  expect(second.expressions).toHaveLength(1);

  /*
   * The browser logs the 503 itself, which is not the application's doing and cannot be
   * suppressed from script. What matters is that nothing *else* was logged and that no
   * exception escaped — a handled failure should be quiet apart from the network's own note.
   */
  expect(problems.filter((problem) => !problem.includes('Failed to load resource'))).toEqual([]);
});

test('an unreachable service reads as unavailable rather than breaking the page', async ({ page }) => {
  const problems = watchForProblems(page);
  await mockApl(page, { answer: () => ({ kind: 'abort' }) });
  await freshVisit(page);

  const before = await gridOf(page);
  await applyButton(page).click();

  await expect(status(page)).toHaveText('APL is unavailable right now. Your beat was not changed.');
  expect(await gridOf(page)).toBe(before);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  // A failed fetch is a rejected promise, not a page error.
  expect(problems.filter((problem) => problem.startsWith('page:'))).toEqual([]);
});

test('an APL error arrives as HTTP 200 and is still a failure', async ({ page }) => {
  /*
   * The single most important fact about this wire format. `LENGTH ERROR` comes back with a
   * perfectly cheerful status code, so a client that trusted the status would install a
   * pattern made of error text.
   */
  const problems = watchForProblems(page);
  await mockApl(page, {
    answer: () => ({
      kind: 'apl',
      lines: ['LENGTH ERROR: Mismatched left and right arguments', '      m←3⌽m', '        ∧'],
    }),
  });
  await freshVisit(page);

  const before = await gridOf(page);
  await applyButton(page).click();

  await expect(status(page)).toHaveText('APL could not complete that transform. Your beat was not changed.');
  expect(await gridOf(page)).toBe(before);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  expect(problems).toEqual([]);
});

test('a malformed reply is refused rather than half-read', async ({ page }) => {
  const problems = watchForProblems(page);
  await freshVisit(page);
  const before = await gridOf(page);

  const malformed: readonly { readonly name: string; readonly answer: Answer }[] = [
    { name: 'not JSON at all', answer: { kind: 'raw', body: '<html>Gateway timeout</html>' } },
    { name: 'the wrong shape', answer: { kind: 'raw', body: '{"output":["1 1 1"]}' } },
    { name: 'too few rows', answer: { kind: 'apl', lines: ['1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0'] } },
    { name: 'too few columns', answer: { kind: 'apl', lines: Array.from({ length: 8 }, () => '1 0 1') } },
    {
      name: 'not Boolean',
      answer: {
        kind: 'apl',
        lines: Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => '2').join(' ')),
      },
    },
    { name: 'prose', answer: { kind: 'apl', lines: Array.from({ length: 8 }, () => 'sorry, no') } },
  ];

  for (const { name, answer } of malformed) {
    await page.unroute(ENDPOINT);
    const mock = await mockApl(page, { answer: () => answer });

    // The same request every time, and it reaches the network every time — a failure is
    // never cached, so there is no remembered answer to hide behind.
    await panel(page).getByLabel('Operation').selectOption('reverse');
    await panel(page).getByLabel('Target').selectOption('all');
    await applyButton(page).click();

    await expect(status(page), name).toHaveText('APL sent something unexpected. Your beat was not changed.');
    expect(await gridOf(page), name).toBe(before);
    expect(mock.expressions, name).toHaveLength(1);
  }

  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  // The console carries the reason for whoever wants it; it is a warning, not an error.
  expect(problems.filter((problem) => problem.startsWith('page:'))).toEqual([]);
});

test('a reply for a bar that no longer exists is dropped', async ({ page }) => {
  /*
   * The staleness rule, which is the one failure mode a mocked network can demonstrate
   * better than a real one: hold the answer, edit the bar underneath it, then let it arrive.
   * A matrix computed from a groove the visitor has since changed must not overwrite the
   * groove they are looking at.
   */
  const problems = watchForProblems(page);
  const mock = await mockApl(page, { delayMs: 1200 });
  await freshVisit(page);

  await panel(page).getByLabel('Operation').selectOption('reverse');
  await panel(page).getByLabel('Target').selectOption('all');
  await applyButton(page).click();
  await expect(status(page)).toHaveText('Running APL…');

  // While it is in flight, change the bar.
  const edited = page.locator('button[data-track="6"][data-step="9"]');
  await edited.click();
  const afterEdit = await gridOf(page);
  expect(afterEdit).not.toBe(bitsOf(GROOVE));

  // The reply arrives, and is discarded: the status goes quiet rather than claiming success.
  await expect(status(page)).toHaveText('', { timeout: 5000 });
  expect(await gridOf(page)).toBe(afterEdit);
  expect(await edited.getAttribute('aria-pressed')).toBe('true');
  expect(mock.expressions).toHaveLength(1);

  // Asking again from where the visitor actually is works normally.
  await applyButton(page).click();
  await expect(status(page)).toHaveText('Applied.', { timeout: 5000 });
  expect(await gridOf(page)).toBe(expected('reverse', 'all', {}, patternFromBits(afterEdit)));

  expect(problems).toEqual([]);
});

test('a slow service times out and says so, once', async ({ page }) => {
  // The configured timeout is six seconds, so the mock simply never answers.
  test.setTimeout(60_000);
  const problems = watchForProblems(page);
  const mock = await mockApl(page, { delayMs: 9_000 });
  await freshVisit(page);

  const before = await gridOf(page);
  await applyButton(page).click();
  await expect(status(page)).toHaveText('Running APL…');

  await expect(status(page)).toHaveText('APL took too long to answer. Your beat was not changed.', {
    timeout: 20_000,
  });
  expect(await gridOf(page)).toBe(before);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  // No retry after a timeout. That is the whole point of having one.
  expect(mock.expressions).toHaveLength(1);

  expect(problems.filter((problem) => problem.startsWith('page:'))).toEqual([]);
});

test('a second Apply while one is in flight is dropped, not queued', async ({ page }) => {
  const problems = watchForProblems(page);
  const mock = await mockApl(page, { delayMs: 900 });
  await freshVisit(page);

  await panel(page).getByLabel('Operation').selectOption('reverse');
  await panel(page).getByLabel('Target').selectOption('all');

  // The button disables itself while running, so this is asserted rather than clicked twice.
  await applyButton(page).click();
  await expect(applyButton(page)).toBeDisabled();
  await expect(applyButton(page)).toHaveText('Running APL…');

  await expect(status(page)).toHaveText('Applied.', { timeout: 5000 });
  expect(mock.expressions).toHaveLength(1);

  expect(problems).toEqual([]);
});

test('the panel is usable on a phone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, 'This project drives a pointer.');
  const problems = watchForProblems(page);
  const mock = await mockApl(page);
  await freshVisit(page);

  const section = panel(page);
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();

  // Nothing overflows the viewport sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await section.getByLabel('Operation').selectOption('reverse');
  await section.getByLabel('Target').selectOption('all');
  await applyButton(page).tap();
  await expect(status(page)).toHaveText('Applied.');
  expect(mock.expressions).toHaveLength(1);
  expect(await gridOf(page)).toBe(expected('reverse', 'all', {}));

  expect(problems).toEqual([]);
});

/* ------------------------------------------------------------------------- */

/** 128 characters back into a pattern, for computing an expectation after an edit. */
function patternFromBits(bits: string): Pattern {
  return Array.from({ length: 8 }, (_unused, track) =>
    Array.from({ length: 16 }, (_alsoUnused, step) => bits[track * 16 + step] === '1'),
  );
}
