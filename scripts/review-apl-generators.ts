/*
 * Listen to the APL recipes, across many seeds, without touching TryAPL.
 *
 *   npm run review:apl-generators
 *   npm run review:apl-generators -- --grids           print the bars
 *   npm run review:apl-generators -- --only broken
 *   npm run review:apl-generators -- --seeds 64
 *
 * What this is, and what it is not.
 *
 * It is a **structural model** of each recipe's Core APL: the same expression, transcribed into
 * TypeScript array operations, with the seeded draws coming from this project's own PRNG rather
 * than from Dyalog's. That makes it useless for predicting what seed 47291 will actually
 * produce — the draws differ — and exactly right for the question review has to answer, which
 * is whether the *recipe* is any good across the space of random choices it can make. Judging
 * that needs hundreds of bars, and hundreds of bars must not mean hundreds of requests to
 * somebody else's service.
 *
 * It is **not** a fallback, it is not shipped, and nothing in `src/` imports it. The recipes
 * themselves are imported from production rather than restated, so the model cannot drift from
 * what ships without the transcription below failing to make sense — but the transcription is
 * still a transcription, and `verify:apl-generators-live` is what proves the real thing runs.
 *
 * The metrics are guardrails, not music. They catch the failures that are not worth listening
 * for — an empty bar, a missing kick, eight identical rows, a seed that changes nothing — and
 * then the grids are there to be read, because a recipe that passes every check and still
 * sounds like a dropped tray of cutlery has to be rejected on the evidence of an ear.
 */

import { RECIPES, type Recipe, type RecipeId } from '@/apl/generators';
import { createRng, MIN_SEED, MAX_SEED } from '@/generation/prng';
import { STEP_COUNT, TRACK_COUNT } from '@/pattern/pattern';
import { TRACKS } from '@/pattern/tracks';

/* ---- the APL primitives the recipes use, as arrays ------------------------- */

type Grid = number[][];

/** `⍳n` — with ⎕IO←0, the numbers 0 to n−1. */
const iota = (n: number): number[] => Array.from({ length: n }, (_u, i) => i);

/** `L∘.f R` — the outer product, which is what lets eight numbers become eight rows. */
const outer = (
  left: readonly number[],
  right: readonly number[],
  f: (a: number, b: number) => number,
): Grid => left.map((a) => right.map((b) => f(a, b)));

/** `R⌽M` — each row rotated left by its own amount. */
const rotateRows = (rows: readonly number[], grid: Grid): Grid =>
  grid.map((row, i) => {
    const by = (((rows[i] ?? 0) % row.length) + row.length) % row.length;
    return [...row.slice(by), ...row.slice(0, by)];
  });

const zip = (a: Grid, b: Grid, f: (x: number, y: number) => number): Grid =>
  a.map((row, i) => row.map((value, j) => f(value, b[i]?.[j] ?? 0)));

const or = (a: Grid, b: Grid): Grid => zip(a, b, (x, y) => (x !== 0 || y !== 0 ? 1 : 0));
const and = (a: Grid, b: Grid): Grid => zip(a, b, (x, y) => (x !== 0 && y !== 0 ? 1 : 0));

/** `0=P∘.|⍳n` — one periodic pulse row per track, over n steps. */
const periodicOver = (periods: readonly number[], steps: number): Grid =>
  outer(periods, iota(steps), (p, s) => (p > 0 && s % p === 0 ? 1 : 0));

/** `0=P∘.|⍳16` — one periodic pulse row per track, over the whole bar. */
const periodic = (periods: readonly number[]): Grid => periodicOver(periods, STEP_COUNT);

/** `(P∘.×16⍴1)>16|P∘.×⍳16` — one Euclidean rhythm per track. */
const euclidean = (pulses: readonly number[]): Grid =>
  outer(pulses, iota(STEP_COUNT), (k, s) => ((k * s) % STEP_COUNT < k ? 1 : 0));

/**
 * A source of seeded draws standing in for `?`.
 *
 * The project's own PRNG, not Dyalog's RNG1. Reproducing RNG1 in TypeScript would be a large
 * parallel implementation built to make a sentence in a report true, and the brief is right
 * that the invariant worth testing is the musical one rather than the bitwise one.
 */
interface Rolls {
  /** `?n⍴m` — n draws, each 0 to m−1. */
  vector(n: number, m: number): number[];
  /** `?v` — one draw per element, each bounded by that element. */
  each(bounds: readonly number[]): number[];
  /** `?8 16⍴m` — a whole grid of draws. */
  grid(m: number): Grid;
}

function rolls(seed: number): Rolls {
  const prng = createRng(seed);
  const one = (m: number): number => prng.int(m);
  return {
    vector: (n, m) => Array.from({ length: n }, () => one(m)),
    each: (bounds) => bounds.map((bound) => one(bound)),
    grid: (m) => Array.from({ length: TRACK_COUNT }, () => Array.from({ length: STEP_COUNT }, () => one(m))),
  };
}

/** `D∘.×16⍴1` — a per-track number spread across every column. */
const spread = (values: readonly number[]): Grid => outer(values, iota(STEP_COUNT), (d) => d);

const greater = (a: Grid, b: Grid): Grid => zip(a, b, (x, y) => (x > y ? 1 : 0));

/* ---- the recipes, transcribed --------------------------------------------- */

/*
 * Each of these is one Core APL expression read left to right. They are deliberately written to
 * mirror the APL rather than to be idiomatic TypeScript, so that a change to a recipe's core
 * and a failure to change its model here are visible as a disagreement.
 */
const MODELS: Record<RecipeId, (r: Rolls) => Grid> = {
  // ((0 4 0 2 4 8 12 6)⌽0=(4 8 2 8 8 16 16 16)∘.|⍳16)∨(0=(4 4 1 4 4 2 2 2)∘.|⍳16)∧((0,(2 5 3 2 3 2 3)+?7⍴3)∘.×16⍴1)>?8 16⍴16
  'four-on-floor': (r) => {
    const skeleton = rotateRows([0, 4, 0, 2, 4, 8, 12, 6], periodic([4, 8, 2, 8, 8, 16, 16, 16]));
    const allowed = periodic([4, 4, 1, 4, 4, 2, 2, 2]);
    const jitter = r.vector(7, 3);
    const density = [0, ...[2, 5, 3, 2, 3, 2, 3].map((base, i) => base + (jitter[i] ?? 0))];
    return or(skeleton, and(allowed, greater(spread(density), r.grid(STEP_COUNT))));
  },

  // {(0 12 0 4 12 5 9 3)⌽(⍵∘.×16⍴1)>16|⍵∘.×⍳16}(5 2 8 3 2 5 3 4)+?8⍴3
  broken: (r) => {
    const jitter = r.vector(TRACK_COUNT, 3);
    const pulses = [5, 2, 8, 3, 2, 5, 3, 4].map((base, i) => base + (jitter[i] ?? 0));
    return rotateRows([0, 12, 0, 4, 12, 5, 9, 3], euclidean(pulses));
  },

  // {⍵,(0 0,?6⍴8)⌽⍵}(0 4 0 2 4 6 2 5)⌽0=(4 8,2+?6⍴4)∘.|⍳8
  halves: (r) => {
    const call = rotateRows(
      [0, 4, 0, 2, 4, 6, 2, 5],
      periodicOver([4, 8, ...r.vector(6, 4).map((v) => 2 + v)], 8),
    );
    const answerBy = [0, 0, ...r.vector(6, 8)];
    const answer = rotateRows(answerBy, call);
    return call.map((row, i) => [...row, ...(answer[i] ?? [])]);
  },

  // {(0,?7⍴16)⌽0=⍵∘.|⍳16}4,2+?7⍴6
  cross: (r) => {
    const periods = [4, ...r.vector(7, 6).map((v) => 2 + v)];
    return rotateRows([0, ...r.each(Array.from({ length: 7 }, () => STEP_COUNT))], periodic(periods));
  },
};

/* ---- metrics --------------------------------------------------------------- */

const hits = (grid: Grid): number => grid.reduce((total, row) => total + row.reduce((a, b) => a + b, 0), 0);
const rowHits = (grid: Grid): number[] => grid.map((row) => row.reduce((a, b) => a + b, 0));
const key = (grid: Grid): string => grid.map((row) => row.join('')).join('|');

/** How many of the four downbeats the kick lands on. */
const kickOnQuarters = (grid: Grid): number =>
  [0, 4, 8, 12].filter((step) => (grid[0]?.[step] ?? 0) === 1).length;

/** Whether the snare marks 4 or 12 — the thing that makes a backbeat findable. */
const hasBackbeat = (grid: Grid): boolean =>
  (grid[1]?.[4] ?? 0) === 1 ||
  (grid[1]?.[12] ?? 0) === 1 ||
  (grid[4]?.[4] ?? 0) === 1 ||
  (grid[4]?.[12] ?? 0) === 1;

/** The largest number of rows that are byte-identical to each other. */
function biggestIdenticalGroup(grid: Grid): number {
  const counts = new Map<string, number>();
  for (const row of grid) {
    const k = row.join('');
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Math.max(...counts.values());
}

/** Longest run of consecutive steps with nothing at all on them. */
function longestSilence(grid: Grid): number {
  let worst = 0;
  let run = 0;
  for (let step = 0; step < STEP_COUNT; step += 1) {
    const anything = grid.some((row) => (row[step] ?? 0) === 1);
    run = anything ? 0 : run + 1;
    worst = Math.max(worst, run);
  }
  return worst;
}

/* ---- review ---------------------------------------------------------------- */

const args = process.argv.slice(2);
const showGrids = args.includes('--grids');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const seedCount = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 48;

/**
 * A fixed seed sample, documented rather than random.
 *
 * Spread across the whole 1–999999 range and including both ends, because a sample drawn near
 * one another would flatter any recipe whose behaviour varies slowly. Fixed so that two runs of
 * this review are comparable, and printed so the sample is part of the finding.
 */
function seedSample(count: number): number[] {
  const seeds = [MIN_SEED, MAX_SEED, 47291, 123456, 999, 8675309 % MAX_SEED];
  const stride = Math.floor((MAX_SEED - MIN_SEED) / Math.max(1, count - seeds.length));
  for (let seed = MIN_SEED + 7; seeds.length < count; seed += stride) seeds.push(seed);
  return seeds.slice(0, count).map((s) => Math.max(MIN_SEED, Math.min(MAX_SEED, s)));
}

const SEEDS = seedSample(seedCount);
const printable = (grid: Grid, track: number): string =>
  (grid[track] ?? []).map((v) => (v === 1 ? '■' : '·')).join(' ');

console.log(`\nReviewing ${String(RECIPES.length)} recipes over ${String(SEEDS.length)} seeds.`);
console.log(`Seed sample: ${SEEDS.slice(0, 8).join(', ')}${SEEDS.length > 8 ? ', …' : ''}`);
console.log('Structural model, local PRNG — not Dyalog draws. See the header.\n');

const problems: string[] = [];

for (const recipe of RECIPES) {
  if (only !== undefined && recipe.id !== only) continue;

  const grids = SEEDS.map((seed) => MODELS[recipe.id](rolls(seed)));
  const totals = grids.map(hits);
  const distinct = new Set(grids.map(key)).size;
  const perRow = Array.from({ length: TRACK_COUNT }, (_u, track) =>
    grids.map((grid) => rowHits(grid)[track] ?? 0),
  );
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  console.log(`\n${'='.repeat(74)}`);
  console.log(`${recipe.name}  (${recipe.id})   core ${String([...recipe.core].length)} code points`);
  console.log(`${'='.repeat(74)}`);
  console.log(`  distinct bars      ${String(distinct)} / ${String(SEEDS.length)}`);
  console.log(
    `  total hits         min ${String(Math.min(...totals))}  mean ${mean(totals).toFixed(1)}  max ${String(Math.max(...totals))}`,
  );
  console.log(
    `  kick on quarters   mean ${mean(grids.map(kickOnQuarters)).toFixed(2)} of 4  ` +
      `(always all four: ${String(grids.every((g) => kickOnQuarters(g) === 4))})`,
  );
  console.log(
    `  backbeat present   ${String(grids.filter(hasBackbeat).length)} / ${String(SEEDS.length)} seeds`,
  );
  console.log(
    `  identical rows     worst ${String(Math.max(...grids.map(biggestIdenticalGroup)))} rows the same`,
  );
  console.log(`  longest silence    ${String(Math.max(...grids.map(longestSilence)))} steps`);
  console.log('\n  per-track hits over the sample (min–max, mean):');
  for (const [track, counts] of perRow.entries()) {
    const name = TRACKS[track]?.name ?? `Track ${String(track)}`;
    console.log(
      `    ${name.padEnd(11)} ${String(Math.min(...counts)).padStart(2)}–${String(Math.max(...counts)).padStart(2)}` +
        `   ${mean(counts).toFixed(1).padStart(4)}`,
    );
  }

  /* guardrails */
  const fails: string[] = [];
  if (totals.some((t) => t === 0)) fails.push('an empty bar');
  if (grids.some((g) => (rowHits(g)[0] ?? 0) === 0)) fails.push('a bar with no kick');
  if (Math.max(...totals) > 100) fails.push(`a bar with ${String(Math.max(...totals))} hits`);
  if (distinct < SEEDS.length * 0.9)
    fails.push(`only ${String(distinct)} distinct bars — the seed barely matters`);
  if (grids.some((g) => biggestIdenticalGroup(g) >= 4)) fails.push('four or more identical rows');
  if (Math.max(...grids.map(longestSilence)) >= 6) fails.push('six or more silent steps');
  if (fails.length > 0) {
    console.log(`\n  GUARDRAIL: ${fails.join('; ')}`);
    problems.push(`${recipe.name}: ${fails.join('; ')}`);
  } else {
    console.log('\n  Guardrails clear.');
  }

  if (showGrids) {
    for (const [index, seed] of SEEDS.slice(0, 3).entries()) {
      const grid = grids[index]!;
      console.log(`\n  --- seed ${String(seed)} — ${String(hits(grid))} hits ---`);
      for (const [track, definition] of TRACKS.entries()) {
        console.log(`    ${definition.name.padEnd(11)} ${printable(grid, track)}`);
      }
    }
  }
}

console.log(`\n${'='.repeat(74)}`);
if (problems.length === 0) {
  console.log('Every recipe cleared its guardrails. Now read the grids and listen.');
} else {
  console.log('Guardrail failures:');
  for (const problem of problems) console.log(`  ${problem}`);
  process.exitCode = 1;
}
console.log('Live TryAPL requests: 0 — this review never leaves the machine.');

/** Unused, but kept honest: a recipe the model does not know about is a mistake. */
void (RECIPES satisfies readonly Recipe[]);
