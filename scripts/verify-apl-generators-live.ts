/*
 * Prove the recipes really generate, in real Dyalog APL.
 *
 *   npm run verify:apl-generators-live
 *   npm run verify:apl-generators-live -- --dry-run     print the requests, send nothing
 *
 * One request per shipped recipe. Not one per question, and not one per seed — each request
 * carries several generations and the comparisons are made here, which is what keeps the budget
 * in single digits while still proving the thing that matters:
 *
 *   the expression runs at all, under a seeded ⎕RL, on the real service;
 *   the result is 8 × 16 and nothing but 0 and 1;
 *   the same seed gives the same matrix — twice in one session, which is the harder claim;
 *   a different seed gives a different matrix, so the seed is not decoration;
 *   a locked row comes back byte-for-byte from the current pattern, and locking it does not
 *   disturb what the other seven rows generated.
 *
 * Everything sent is built by the production source builder and read by the production parser.
 * The only thing this file adds is the comparing. `review:apl-generators` is where the *music*
 * is judged, locally and for nothing; this is where the mechanism is proved, live and sparingly.
 *
 * Never run by CI. The count is printed every time.
 */

import { TryAplClient, AplError } from '@/apl/client';
import { buildGenerateSource, RECIPES, type Recipe } from '@/apl/generators';
import { parseAplMatrix } from '@/apl/matrix';
import { createInitialGroove } from '@/pattern/initialGroove';
import { patternsEqual, STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import { DIAMOND } from '@/apl/wire';

const dryRun = process.argv.includes('--dry-run');

/** The seeds every recipe is checked at. Fixed, so two runs are comparable. */
const SEED = 47291;
const OTHER = 123456;

/** The row locked in the lock check. The kick, because it is the one people lock. */
const LOCKED_ROW = 0;

const pattern = createInitialGroove();
const client = new TryAplClient();
let requests = 0;

const rowsOf = (pattern: Pattern): string[] =>
  Array.from({ length: TRACK_COUNT }, (_u, track) =>
    Array.from({ length: STEP_COUNT }, (_v, step) => ((pattern[track]?.[step] ?? false) ? '1' : '0')).join(
      '',
    ),
  );

interface Outcome {
  readonly recipe: Recipe;
  readonly notes: string[];
  readonly failures: string[];
}

async function check(recipe: Recipe): Promise<Outcome> {
  const notes: string[] = [];
  const failures: string[] = [];

  /*
   * Four generations in one request.
   *
   * Built by concatenating four complete production requests. Each one sets ⎕IO and ⎕RL for
   * itself, so they compose without any of them having to know the others exist — and every
   * statement sent is one the application would have sent on its own.
   */
  const plain = buildGenerateSource({ recipe, seed: SEED, pattern, lockedRows: [] });
  const again = buildGenerateSource({ recipe, seed: SEED, pattern, lockedRows: [] });
  const other = buildGenerateSource({ recipe, seed: OTHER, pattern, lockedRows: [] });
  const locked = buildGenerateSource({ recipe, seed: SEED, pattern, lockedRows: [LOCKED_ROW] });

  const source = [plain, again, other, locked].map((s) => s.expression).join(` ${DIAMOND} `);

  console.log(`\n${'─'.repeat(76)}`);
  console.log(`${recipe.name}  —  core ${String([...recipe.core].length)} code points`);
  console.log(`${'─'.repeat(76)}`);
  console.log(`core:  ${recipe.core}`);
  console.log(`\nsource (${String([...source].length)} code points):\n${source}`);

  if (dryRun) return { recipe, notes: ['not sent'], failures: [] };

  requests += 1;
  let lines: readonly string[];
  try {
    ({ outputLines: lines } = await client.execute(source));
  } catch (error) {
    if (error instanceof AplError) {
      failures.push(`APL refused it: ${error.message}`);
      for (const line of error.aplLines) failures.push(`  ${line}`);
      return { recipe, notes, failures };
    }
    throw error;
  }

  // Four printed matrices, eight non-blank lines each.
  const rows = lines.map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
  if (rows.length !== 4 * TRACK_COUNT) {
    failures.push(`expected ${String(4 * TRACK_COUNT)} rows of output, received ${String(rows.length)}`);
    return { recipe, notes, failures };
  }

  const parsed = [0, 1, 2, 3].map((index) =>
    parseAplMatrix(rows.slice(index * TRACK_COUNT, (index + 1) * TRACK_COUNT)),
  );
  const labels = ['seed 47291', 'seed 47291 again', 'seed 123456', 'seed 47291, kick locked'];

  for (const [index, result] of parsed.entries()) {
    if (!result.ok) failures.push(`${labels[index] ?? ''}: ${result.reason}`);
  }
  if (failures.length > 0) return { recipe, notes, failures };

  const patterns = parsed.map((r) => (r.ok ? r.pattern : null));
  const [first, second, different, withLock] = patterns;
  if (
    first === undefined ||
    second === undefined ||
    different === undefined ||
    withLock === undefined ||
    first === null ||
    second === null ||
    different === null ||
    withLock === null
  ) {
    failures.push('a matrix failed to parse');
    return { recipe, notes, failures };
  }

  notes.push('every matrix is 8 × 16, and nothing but 0 and 1');

  if (patternsEqual(first, second)) notes.push('the same seed gave the same matrix, twice in one session');
  else failures.push('the same seed gave two different matrices');

  if (patternsEqual(first, different))
    failures.push('a different seed gave the same matrix — the seed does nothing');
  else notes.push('a different seed gave a different matrix');

  /* the lock: the row comes back from the pattern, and the others are untouched */
  const currentRow = rowsOf(pattern)[LOCKED_ROW];
  const lockedRow = rowsOf(withLock)[LOCKED_ROW];
  if (lockedRow === currentRow) notes.push('the locked kick came back byte-for-byte from the current bar');
  else failures.push(`the locked kick changed: ${String(currentRow)} became ${String(lockedRow)}`);

  const unlockedUnchanged = rowsOf(first)
    .slice(1)
    .every((row, index) => row === rowsOf(withLock).slice(1)[index]);
  if (unlockedUnchanged) notes.push('locking the kick left the other seven rows exactly as they generated');
  else failures.push('locking the kick changed what the other seven rows generated');

  const hits = rowsOf(first).reduce((total, row) => total + [...row].filter((c) => c === '1').length, 0);
  notes.push(`${String(hits)} hits at seed ${String(SEED)}`);
  for (const row of rowsOf(first)) notes.push(`  ${[...row].map((c) => (c === '1' ? '■' : '·')).join(' ')}`);

  return { recipe, notes, failures };
}

/* ---- run ------------------------------------------------------------------- */

const outcomes: Outcome[] = [];
for (const recipe of RECIPES) outcomes.push(await check(recipe));

console.log(`\n${'='.repeat(76)}`);
for (const { recipe, notes, failures } of outcomes) {
  console.log(`\n${recipe.name}:`);
  for (const note of notes) console.log(`  ok    ${note}`);
  for (const failure of failures) console.log(`  FAIL  ${failure}`);
}

const failed = outcomes.reduce((total, o) => total + o.failures.length, 0);
console.log(`\nLive TryAPL requests used: ${String(requests)}`);
if (failed > 0) {
  console.log(`${String(failed)} failure(s).`);
  process.exitCode = 1;
} else if (!dryRun) {
  console.log('Every shipped recipe generates a valid, repeatable, seed-sensitive bar in real Dyalog APL.');
}
