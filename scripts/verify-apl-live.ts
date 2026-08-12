/*
 * Prove that the APL really runs.
 *
 *   npm run verify:apl-live
 *   npm run verify:apl-live -- --only euclidean
 *   npm run verify:apl-live -- --dry-run          print the expressions, send nothing
 *
 * Everything else in this project is mocked, and rightly so: TryAPL is somebody else's
 * service and a test suite that called it on every push would be an abuse of it. But a
 * suite that only ever talks to a mock cannot tell you whether the thing works, and the
 * whole claim of Stage 3 is that "Apply with APL" means what it says. So there is exactly
 * one thing here that talks to the real service, it is never run by CI, and it is run by
 * hand when the APL changes.
 *
 * It is deliberately frugal, and deliberately loud about the count:
 *
 *   one request per operation, and no more — currently four;
 *   nothing retries;
 *   the exact number is printed at the end, every time.
 *
 * What makes it worth those four requests is that none of it is a re-implementation. The
 * expression is built by the production source builder, sent by the production client, and
 * read by the production parser. The only thing this file adds is the comparison: what came
 * back from Dyalog, against what `reference.ts` says the expression means. If those agree,
 * then the APL on screen is the APL that ran and it does what the interface claims.
 */

import { TryAplClient, AplError } from '@/apl/client';
import { aplConfig } from '@/apl/config';
import { parseAplMatrix } from '@/apl/matrix';
import { buildTransformSource, OPERATIONS, targetName, type Parameters, type Target } from '@/apl/operations';
import { applyReferenceTransform } from '@/apl/reference';
import { createInitialGroove } from '@/pattern/initialGroove';
import { patternsEqual, type Pattern } from '@/pattern/pattern';
import { TRACKS } from '@/pattern/tracks';

/* ------------------------------------------------------------------------- */

interface Check {
  readonly operationId: string;
  readonly target: Target;
  readonly parameters: Parameters;
  /** Why this particular case, rather than another. */
  readonly because: string;
}

/**
 * One case per operation, chosen to cover every distinct shape of expression.
 *
 * Not a sweep. A sweep over parameters would multiply the request count for almost no
 * information: the arithmetic is APL's, not ours, and if `5>16|5×⍳16` evaluates correctly
 * then `7>16|7×⍳16` is not in doubt. What is worth one request each is every *form* the
 * source builder can emit — indexed assignment against whole-matrix assignment, ⌽ as a monad
 * against ⌽ as a dyad, a high minus in a literal, and a rotation composed onto a generated
 * pulse rather than applied on its own.
 */
const CHECKS: readonly Check[] = [
  {
    operationId: 'rotate',
    target: 0,
    parameters: { amount: -1 },
    because: 'indexed assignment, and the high minus in a literal',
  },
  {
    operationId: 'reverse',
    target: 'all',
    parameters: {},
    because: 'whole-matrix assignment, and ⌽ as a monad',
  },
  {
    operationId: 'periodic',
    target: 4,
    parameters: { period: 4, rotation: 0 },
    because: '⍳ and | under ⎕IO←0, which is where an origin mistake would show',
  },
  {
    operationId: 'euclidean',
    target: 5,
    parameters: { pulses: 5, rotation: 3 },
    because: 'a rotation composed onto a generated pulse, in one expression',
  },
];

/* ------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const force = argv.includes('--force');
const only = valueOf('--only');

function valueOf(flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

/*
 * Refused under CI unless somebody insists.
 *
 * The npm script name says what it does, but a name is not a safeguard: this is the one
 * command in the repository that costs somebody else something, and a workflow that
 * acquired it by accident would call it on every push for as long as it took anyone to
 * notice.
 */
if (process.env.CI !== undefined && !force && !dryRun) {
  console.error('verify:apl-live is a manual check and will not run under CI. Pass --force if you mean it.');
  process.exit(2);
}

const selected = only === null ? CHECKS : CHECKS.filter((check) => check.operationId === only);
if (selected.length === 0) {
  console.error(
    `No operation called "${String(only)}". Try one of: ${CHECKS.map((c) => c.operationId).join(', ')}`,
  );
  process.exit(2);
}

/* ------------------------------------------------------------------------- */

/** Every request that actually left this process. */
const sent: { expression: string; bytes: number }[] = [];

const countingFetch: typeof fetch = (input, init) => {
  const body = typeof init?.body === 'string' ? init.body : '';
  sent.push({ expression: body, bytes: Buffer.byteLength(body, 'utf8') });
  return fetch(input, init);
};

const client = new TryAplClient({ fetchImpl: countingFetch });
const groove = createInitialGroove();

interface Result {
  readonly check: Check;
  readonly expression: string;
  readonly outcome: 'agrees' | 'disagrees' | 'failed' | 'skipped';
  readonly detail?: string;
  readonly fromApl?: Pattern;
  readonly expected: Pattern;
  readonly durationMs?: number;
}

async function run(): Promise<Result[]> {
  const results: Result[] = [];

  for (const check of selected) {
    const operation = OPERATIONS.find((candidate) => candidate.id === check.operationId);
    if (operation === undefined) {
      throw new Error(`No such operation: ${check.operationId}`);
    }

    const source = buildTransformSource({
      operation,
      target: check.target,
      parameters: check.parameters,
      pattern: groove,
    });
    const expected = applyReferenceTransform(operation, check.target, check.parameters, groove);

    if (dryRun) {
      results.push({ check, expression: source.expression, outcome: 'skipped', expected });
      continue;
    }

    const startedAt = Date.now();
    try {
      const execution = await client.execute(source.expression);
      const parsed = parseAplMatrix(execution.outputLines);

      if (!parsed.ok) {
        results.push({
          check,
          expression: source.expression,
          outcome: 'failed',
          detail: `the reply would not parse: ${parsed.reason}\n${execution.outputLines.join('\n')}`,
          expected,
          durationMs: execution.durationMs,
        });
        continue;
      }

      results.push({
        check,
        expression: source.expression,
        outcome: patternsEqual(parsed.pattern, expected) ? 'agrees' : 'disagrees',
        expected,
        fromApl: parsed.pattern,
        durationMs: execution.durationMs,
      });
    } catch (error) {
      results.push({
        check,
        expression: source.expression,
        outcome: 'failed',
        detail:
          error instanceof AplError
            ? `${error.kind}: ${error.message} ${error.detail ?? ''}`.trim()
            : String(error),
        expected,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  return results;
}

/* ------------------------------------------------------------------------- */

function rowOf(pattern: Pattern, track: number): string {
  return (pattern[track] ?? []).map((cell) => (cell ? '●' : '·')).join('');
}

/** The tracks worth printing for a check: the one it targeted, or all of them. */
function tracksToShow(target: Target): number[] {
  return target === 'all' ? TRACKS.map((_track, index) => index) : [target];
}

function report(results: readonly Result[]): void {
  console.log('');
  console.log(`  Endpoint   ${aplConfig.endpoint}`);
  console.log(`  Pattern    the opening groove, ${String(TRACKS.length)} × 16`);
  console.log(`  ⎕IO        0`);
  console.log('');

  for (const result of results) {
    const { check } = result;
    const heading = `${check.operationId} → ${targetName(check.target)}`;
    const verdict = {
      agrees: 'APL agrees with the reference',
      disagrees: 'APL DISAGREES with the reference',
      failed: 'the request did not complete',
      skipped: 'not sent (--dry-run)',
    }[result.outcome];

    console.log(`  ${heading}`);
    console.log(`    why      ${check.because}`);
    console.log(`    APL      ${result.expression}`);
    console.log(
      `    result   ${verdict}${result.durationMs === undefined ? '' : ` (${String(result.durationMs)} ms)`}`,
    );

    if (result.detail !== undefined) {
      for (const line of result.detail.split('\n')) console.log(`             ${line}`);
    }

    if (result.fromApl !== undefined) {
      for (const track of tracksToShow(check.target)) {
        const name = (TRACKS[track]?.name ?? `track ${String(track)}`).padEnd(11);
        const fromApl = rowOf(result.fromApl, track);
        const wanted = rowOf(result.expected, track);
        const mark = fromApl === wanted ? ' ' : '✗';
        console.log(`    ${mark} ${name}${fromApl}`);
        if (fromApl !== wanted) console.log(`      ${' '.repeat(11)}${wanted}   ← expected`);
      }
    }

    console.log('');
  }

  /*
   * The number, on its own line, every time.
   *
   * The brief asked for us to be conscious of it, and the way to stay conscious of a number
   * is to print it whether or not anybody asked.
   */
  console.log('  ────────────────────────────────────────────────────────');
  console.log(`  Live TryAPL requests made: ${String(sent.length)}`);
  if (sent.length > 0) {
    const bytes = sent.reduce((total, request) => total + request.bytes, 0);
    console.log(`  Bytes sent: ${String(bytes)} in ${String(sent.length)} request(s), nothing retried.`);
  }
  console.log('');

  const disagreed = results.filter((result) => result.outcome === 'disagrees');
  const failed = results.filter((result) => result.outcome === 'failed');

  if (disagreed.length > 0) {
    console.log(
      `  ✗ ${String(disagreed.length)} operation(s) do not mean what the reference says they mean.`,
    );
    console.log('    That is a bug in the APL or in the reference, and one of them is wrong.');
  } else if (failed.length > 0) {
    console.log(`  ! ${String(failed.length)} request(s) did not complete. Nothing was proved either way.`);
  } else if (dryRun) {
    console.log('  Nothing was sent.');
  } else {
    console.log(
      `  ✓ ${String(results.length)} operation(s) executed in Dyalog APL and returned what they should.`,
    );
  }
  console.log('');
}

run()
  .then((results) => {
    report(results);
    const bad = results.filter((result) => result.outcome === 'disagrees' || result.outcome === 'failed');
    process.exit(bad.length === 0 ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(error);
    console.error(`\n  Live TryAPL requests made: ${String(sent.length)}\n`);
    process.exit(1);
  });
