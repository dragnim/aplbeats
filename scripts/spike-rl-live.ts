/*
 * Stage 6, first question: does a seeded ⎕RL survive TryAPL's Safe Execute?
 *
 *   npx tsx scripts/spike-rl-live.ts
 *   npx tsx scripts/spike-rl-live.ts --glyphs    also probe the wider glyph palette
 *
 * Everything Stage 6 wants to build rests on one assumption, and the brief is right to
 * insist it be tested before any of it exists: that APL Beats can ask Dyalog for a
 * *repeatable* random sequence through TryAPL. If `⎕RL←seed 1` is refused, or accepted and
 * ignored, then "same recipe and seed gives the same beat" is not a promise this product can
 * make, and the shape of the feature has to change rather than the wording around it.
 *
 * Two requests, and the design of them matters:
 *
 *   1. acceptance, repeatability and seed-sensitivity in a single request. The seed is set, a
 *      matrix generated, the seed set again, a second generated, then a third under a
 *      different seed — and all three are printed. Repeatability *within* one interpreter
 *      session is the strictly harder claim and needs no second round trip.
 *
 *   2. the same expression and seed in a fresh session, because that is what production does:
 *      a new workspace every request. This cannot be folded into the first without defeating
 *      its purpose.
 *
 * The three matrices are compared here rather than in APL, deliberately. An `∧/` comparison
 * would have been one line shorter and would have made the request depend on glyphs this
 * spike has not yet established are allowed — and the first attempt at this file failed for
 * exactly that reason: it reached for `∈`, which TryAPL refuses, and so never tested ⎕RL at
 * all. The blacklist is lexical and rejects the whole request, so the probe expression uses
 * only glyphs Stage 3 already proved live — ⌽ ⍴ ⍳ | > = × — plus the one new thing being
 * tested, `?`.
 *
 * RNG1 explicitly, as the second element of ⎕RL. Dyalog documents RNG2 as not offering
 * repeatable user-seeded sequences, so it is not a candidate and is not tried.
 *
 * Nothing here is production code and nothing here ships. It answers one question.
 */

import { TryAplClient, AplError } from '@/apl/client';
import { DIAMOND } from '@/apl/wire';

/*
 * A deliberately ordinary generator expression: structure that randomness modifies.
 *
 * Quarter positions across every row — `0=4|⍳16` reshaped to 8×16 — thinned by a random 0/1
 * per cell. Not a candidate recipe; those do not exist yet, and testing one now would test
 * the recipe rather than the mechanism. What it does need to be is representative of the
 * shape every recipe will have, and to return 8 rows of 16 zeroes and ones.
 */
const EXPRESSION = '(8 16⍴0=4|⍳16)×?8 16⍴2';

const client = new TryAplClient();
let requests = 0;

/** One request, or the APL error that came back instead. */
async function run(label: string, statements: readonly string[]): Promise<readonly string[] | null> {
  requests += 1;
  const source = statements.join(` ${DIAMOND} `);
  console.log(`\n--- ${label} (request ${String(requests)}) ---`);
  console.log(source);
  try {
    const { outputLines: lines } = await client.execute(source);
    console.log('reply:');
    for (const line of lines) console.log(`  ${line}`);
    return lines;
  } catch (error) {
    if (error instanceof AplError) {
      console.log('APL refused it:');
      for (const line of error.aplLines) console.log(`  ${line}`);
      return null;
    }
    throw error;
  }
}

/** Non-blank lines, grouped into blocks of eight — one printed matrix each. */
function matrices(lines: readonly string[]): string[][] {
  const rows = lines.map((line) => line.trim()).filter((line) => line !== '');
  const blocks: string[][] = [];
  for (let at = 0; at + 8 <= rows.length; at += 8) blocks.push(rows.slice(at, at + 8));
  return blocks;
}

const wellFormed = (block: readonly string[] | undefined): boolean =>
  block !== undefined &&
  block.length === 8 &&
  block.every((line) => {
    const tokens = line.split(/\s+/u);
    return tokens.length === 16 && tokens.every((token) => token === '0' || token === '1');
  });

const same = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((line, i) => line === b[i]);

/* ---- 1: acceptance, repeatability and seed-sensitivity in one session ------ */

const SEED = 123456;
const OTHER = 654321;

const first = await run('same seed twice, then a different seed, one session', [
  '⎕IO←0',
  `⎕RL←${String(SEED)} 1`,
  `a←${EXPRESSION}`,
  `⎕RL←${String(SEED)} 1`,
  `b←${EXPRESSION}`,
  `⎕RL←${String(OTHER)} 1`,
  `c←${EXPRESSION}`,
  'a',
  'b',
  'c',
]);

const blocks = first === null ? [] : matrices(first);
const [a, b, c] = blocks;

/* ---- 2: the same seed again, in a fresh workspace -------------------------- */

const second =
  first === null
    ? null
    : await run('same seed, fresh session — the production case', [
        '⎕IO←0',
        `⎕RL←${String(SEED)} 1`,
        EXPRESSION,
      ]);

const fresh = second === null ? undefined : matrices(second)[0];

/* ---- verdict --------------------------------------------------------------- */

console.log('\n================ verdict ================');
const results: [boolean, string][] = [
  [first !== null, '⎕RL←seed 1 is accepted — no NOT SUPPORTED, NONCE or DOMAIN ERROR'],
  [blocks.length === 3, 'three matrices came back, one per generation'],
  [wellFormed(a) && wellFormed(b) && wellFormed(c), 'each is 8 rows of 16, every value 0 or 1'],
  [same(a, b), 'the same seed reproduces the same matrix within one session'],
  [!same(a, c) && c !== undefined, 'a different seed produces a different matrix'],
  [same(a, fresh), 'the same seed reproduces the same matrix in a FRESH session'],
];
for (const [ok, label] of results) console.log(`  ${ok ? 'YES' : 'NO '}  ${label}`);

/* ---- optional: what else is allowed --------------------------------------- */

if (process.argv.includes('--glyphs') && first !== null) {
  /*
   * A separate question, asked separately.
   *
   * TryAPL's refusal is lexical and rejects the whole request, naming the offending
   * character — so a batch of candidate glyphs cannot be graded, but a failure does identify
   * one blocked glyph precisely. That makes this a bisect rather than a survey: send the
   * whole palette, remove whatever is named, send again. Cheap in requests, and it maps the
   * constraint before any recipe is designed around a glyph that cannot run.
   */
  const CANDIDATES = '(?4),(2∨3),(2∧3),(~0),(⌈/⍳4),(⌊/⍳4),(,⍉2 2⍴⍳4),(,⊖2 2⍴⍳4),(1 0 1/⍳3)';
  const probe = await run('glyph palette probe', ['⎕IO←0', `≢${CANDIDATES}`]);
  console.log(
    probe === null
      ? '  the palette contains something TryAPL refuses — the name is above'
      : '  every glyph in the probe is allowed',
  );

  /*
   * The three idioms the recipes are actually built out of, which are worth their own request:
   * a dfn, so one expression can bind a seeded vector and use it twice; an outer product, so
   * eight per-track numbers become an 8 × 16 grid in one glyph; and a *vector* left argument to
   * ⌽, so every row rotates by its own amount. Without these three, a kit cannot be described
   * as one array expression and Stage 6 would need a different shape entirely.
   */
  const idioms = await run('the three recipe idioms', [
    '⎕IO←0',
    '⎕RL←4242 1',
    '{(?8⍴16)⌽(⍵∘.×16⍴1)>16|⍵∘.×⍳16}2+?8⍴7',
    '(0 4 0 2 4 1 3 7)⌽0=(4 8 2 8 8 16 16 16)∘.|⍳16',
    '(0 1 3 2 1 3 2 2∘.×16⍴1)>?8 16⍴16',
  ]);
  console.log(
    idioms === null
      ? '  one of the idioms is refused — the recipes need redesigning'
      : '  dfn, outer product and vector-left ⌽ are all allowed',
  );
}

console.log(`\nLive TryAPL requests used: ${String(requests)}`);

if (!results.every(([ok]) => ok)) {
  console.log('\nThe seeded model does NOT hold as assumed. Stop and report before building on it.');
  process.exitCode = 1;
} else {
  console.log('\nThe seeded model holds. Stage 6 can be built on ⎕RL←seed 1.');
}
