import { describe, expect, it } from 'vitest';
import {
  APL_GENERATOR_VERSION,
  buildGenerateSource,
  DEFAULT_RECIPE_ID,
  generatorRandomSeed,
  isRecipeId,
  normaliseLockedRows,
  RECIPES,
  recipeById,
  type Recipe,
} from '@/apl/generators';
import { checkCustomExpression, MAX_CUSTOM_LENGTH } from '@/apl/custom';
import { parseAplMatrix } from '@/apl/matrix';
import { MAX_SEED, MIN_SEED } from '@/generation/prng';
import { createInitialGroove } from '@/pattern/initialGroove';
import { TRACK_COUNT } from '@/pattern/pattern';
import { DIAMOND } from '@/apl/wire';
import { aplConfig } from '@/apl/config';

/*
 * What the generator sends, checked without sending anything.
 *
 * The live proof that these expressions run in Dyalog is `verify:apl-generators-live`, four
 * deliberate requests, never in CI. Everything here is the half of the claim that can be
 * checked for nothing and must never be allowed to rot: that each recipe's source is a single
 * well-formed expression, that it fits the editor it can be loaded into, that the seed reaches
 * APL as a validated integer and by no other route, and that a locked row is preserved by the
 * request rather than by JavaScript afterwards.
 */

const pattern = createInitialGroove();
const build = (recipe: Recipe, seed = 47291, lockedRows: readonly number[] = []) =>
  buildGenerateSource({ recipe, seed, pattern, lockedRows });

describe('the recipe list', () => {
  it('ships at least three recipes', () => {
    // Four candidates were designed; a recipe that could not be made musical was rejected
    // rather than shipped, and three is the floor that keeps the feature worth having.
    expect(RECIPES.length).toBeGreaterThanOrEqual(3);
  });

  it('has no duplicate identifiers, and names every one', () => {
    const ids = RECIPES.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const recipe of RECIPES) {
      expect(recipe.name.length, recipe.id).toBeGreaterThan(2);
      expect(recipe.blurb.length, recipe.id).toBeGreaterThan(10);
    }
  });

  it('opens on a recipe that exists', () => {
    expect(RECIPES.some((recipe) => recipe.id === DEFAULT_RECIPE_ID)).toBe(true);
  });

  it('maps every identifier exhaustively, and falls back rather than failing', () => {
    for (const recipe of RECIPES) {
      expect(isRecipeId(recipe.id)).toBe(true);
      expect(recipeById(recipe.id)).toBe(recipe);
    }
    for (const value of ['euclidean-kit', '', 'FOUR-ON-FLOOR', null, undefined, 42, {}, []]) {
      expect(isRecipeId(value), JSON.stringify(value)).toBe(false);
    }
    // A withdrawn recipe in a stored session must not be a startup failure.
    expect(recipeById('euclidean-kit')).toBe(RECIPES[0]);
  });

  it('explains itself in two to four short lines', () => {
    for (const recipe of RECIPES) {
      expect(recipe.explanation.length, recipe.id).toBeGreaterThanOrEqual(2);
      expect(recipe.explanation.length, recipe.id).toBeLessThanOrEqual(4);
      for (const line of recipe.explanation) {
        expect(line.length, `${recipe.id}: ${line}`).toBeGreaterThan(20);
        // A line, not a paragraph. Peek is not a tutorial.
        expect(line.length, `${recipe.id}: ${line}`).toBeLessThan(140);
      }
    }
  });

  it('only explains glyphs its own core actually uses', () => {
    /*
     * The rule that keeps the explanations honest. A line about ∘. beside an expression with no
     * outer product in it is worse than no line, because it teaches the reader to distrust the
     * ones that are right.
     */
    /*
     * `,` is deliberately absent. It is both an APL primitive and the commonest mark in an
     * English sentence, so a prose comma is indistinguishable from a mention of catenate and
     * the check would fail on every explanation that contains a subordinate clause. The glyphs
     * below have no such double life.
     */
    const NOTABLE = ['∘.', '⍳', '⌽', '?', '∨', '∧', '|', '⍵'];
    for (const recipe of RECIPES) {
      const prose = recipe.explanation.join(' ');
      for (const glyph of NOTABLE) {
        if (!prose.includes(glyph)) continue;
        expect(recipe.core.includes(glyph), `${recipe.id} explains ${glyph} but does not use it`).toBe(true);
      }
    }
  });
});

describe('every recipe’s core expression', () => {
  it('is non-empty and fits the Explore contract unchanged', () => {
    /*
     * The single most important property in Stage 6's design. "Edit this APL" leads into the
     * Stage 5 editor, and the editor's own validator is what is asked here — not a copy of its
     * rules. A recipe that cannot be loaded into Explore is a recipe whose Peek would have to
     * lie about being editable.
     */
    for (const recipe of RECIPES) {
      const check = checkCustomExpression(recipe.core);
      expect(check.ok, `${recipe.id}: ${check.ok ? '' : check.reason}`).toBe(true);
      if (check.ok) expect(check.core).toBe(recipe.core);
      expect([...recipe.core].length, recipe.id).toBeLessThanOrEqual(MAX_CUSTOM_LENGTH);
    }
  });

  it('contains no statement separator, newline or comment', () => {
    // Belt as well as braces: these are the three ways an expression escapes its wrapper, and
    // the recipes are authored by hand rather than validated at a UI boundary.
    for (const recipe of RECIPES) {
      expect(recipe.core, recipe.id).not.toContain(DIAMOND);
      expect(recipe.core, recipe.id).not.toContain('⍝');
      expect(/[\n\r]/u.test(recipe.core), recipe.id).toBe(false);
      expect(recipe.core.trim(), recipe.id).toBe(recipe.core);
    }
  });

  it('is the same expression whatever the seed', () => {
    /*
     * The seed lives in ⎕RL, never in the expression. That is what lets Peek show one piece of
     * APL, lets Explore re-run it, and makes "no arbitrary UI string is inserted into APL" true
     * by construction rather than by inspection.
     */
    for (const recipe of RECIPES) {
      const seeds = [MIN_SEED, 47291, 123456, MAX_SEED];
      const cores = seeds.map((seed) => build(recipe, seed).core);
      expect(new Set(cores).size, recipe.id).toBe(1);
      expect(cores[0], recipe.id).toBe(recipe.core);
    }
  });

  it('uses only glyphs confirmed to run on the service', () => {
    /*
     * TryAPL's Safe Execute refuses some primitives lexically and rejects the whole request. The
     * first Stage 6 spike died on ∈ — an expression that never ran, testing nothing. This is the
     * list that was confirmed live before any recipe was designed, and a recipe reaching outside
     * it should fail here rather than at somebody's keyboard.
     */
    const ALLOWED = new Set([...'0123456789 ()⍳⍴|>=×⌽∨∧?∘.{}⍵,+']);
    for (const recipe of RECIPES) {
      const stray = [...recipe.core].filter((glyph) => !ALLOWED.has(glyph));
      expect(stray, `${recipe.id} uses unconfirmed ${stray.join('')}`).toEqual([]);
    }
  });
});

describe('the request a generation sends', () => {
  it('sets ⎕IO←0 and an explicit seeded ⎕RL, in that order, first', () => {
    for (const recipe of RECIPES) {
      const { statements } = build(recipe, 47291);
      expect(statements[0], recipe.id).toBe('⎕IO←0');
      // The seed and the RNG. RNG1 explicitly, because Dyalog documents RNG2 as not offering
      // repeatable user-seeded sequences.
      expect(statements[1], recipe.id).toBe('⎕RL←47291 1');
    }
  });

  it('ends by returning the matrix', () => {
    for (const recipe of RECIPES) {
      expect(build(recipe).statements.at(-1), recipe.id).toBe(recipe.core);
      expect(build(recipe, 47291, [0]).statements.at(-1), recipe.id).toBe('g');
    }
  });

  it('represents the seed only as a validated integer', () => {
    /*
     * Every seed goes through `clampSeed` before it is formatted, so nothing outside 1–999999
     * and nothing non-integral can reach APL. Checked with the values a number input can
     * actually produce, including the ones a person types by accident.
     */
    const recipe = RECIPES[0]!;
    for (const seed of [0, -1, 1e9, 4.7, NaN, Infinity, -Infinity, MIN_SEED - 1, MAX_SEED + 1]) {
      const { statements } = build(recipe, seed);
      const line = statements[1] ?? '';
      const match = /^⎕RL←(\d+) 1$/u.exec(line);
      expect(match, `seed ${String(seed)} produced ${line}`).not.toBeNull();
      const used = Number(match?.[1]);
      expect(Number.isInteger(used), String(seed)).toBe(true);
      expect(used, String(seed)).toBeGreaterThanOrEqual(MIN_SEED);
      expect(used, String(seed)).toBeLessThanOrEqual(MAX_SEED);
    }
  });

  it('agrees with the seed Explore will be told about', () => {
    // Peek says "⎕RL is fixed to 47291"; Explore has to run under exactly that or the two
    // disagree and the reproducibility claim is empty.
    for (const seed of [47291, 0, 1e9, 4.7]) {
      const { statements } = build(RECIPES[0]!, seed);
      expect(statements[1]).toBe(`⎕RL←${String(generatorRandomSeed(seed))} 1`);
    }
  });

  it('fits well inside the source limit, locks and all', () => {
    for (const recipe of RECIPES) {
      const everyRowLocked = Array.from({ length: TRACK_COUNT }, (_u, row) => row);
      for (const locks of [[], [0], [0, 3], everyRowLocked]) {
        const { expression } = build(recipe, 47291, locks);
        expect([...expression].length, `${recipe.id} with ${String(locks.length)} locks`).toBeLessThan(
          aplConfig.maxSourceLength,
        );
      }
    }
  });

  it('never mentions the current bar when nothing is locked', () => {
    /*
     * Not an optimisation — it is why a cached generation survives the visitor editing a cell.
     * If the request carried the current pattern regardless, the cache key would have to as
     * well, and every keystroke on the grid would throw the cache away.
     */
    for (const recipe of RECIPES) {
      const { expression } = build(recipe, 47291, []);
      expect(expression, recipe.id).not.toContain('m←');
      expect(expression.split(DIAMOND), recipe.id).toHaveLength(3);
    }
  });
});

describe('locked rows', () => {
  it('are restored inside APL, after the core has run', () => {
    /*
     * Two properties in one shape. The matrix that comes back is the whole answer, so JavaScript
     * never merges rows into a reply — and because the restoration happens after the core, the
     * random draws the other seven rows got are the draws they would have got unlocked. Locking
     * the kick must not change the hats.
     */
    const { statements } = build(RECIPES[0]!, 47291, [0, 3]);
    expect(statements).toEqual([
      '⎕IO←0',
      '⎕RL←47291 1',
      expect.stringMatching(/^m←8 16⍴[01 ]+$/u),
      `g←(${RECIPES[0]!.core})`,
      'g[0 3;]←m[0 3;]',
      'g',
    ]);
  });

  it('are sorted, deduplicated and bounded', () => {
    expect(normaliseLockedRows([3, 0, 3])).toEqual([0, 3]);
    expect(normaliseLockedRows([])).toEqual([]);
    // Anything that is not a row index is discarded rather than formatted into APL.
    expect(normaliseLockedRows([-1, 8, 99, 1.5, NaN, Infinity, 2])).toEqual([2]);
    expect(normaliseLockedRows(Array.from({ length: TRACK_COUNT }, (_u, r) => r))).toHaveLength(TRACK_COUNT);
  });

  it('appear in the request as bare non-negative integers', () => {
    for (const locks of [[0], [1, 2], [0, 7]]) {
      const { statements } = build(RECIPES[0]!, 47291, locks);
      expect(statements[4]).toBe(`g[${locks.join(' ')};]←m[${locks.join(' ')};]`);
    }
  });
});

describe('the generator version', () => {
  it('is a positive integer, and its own number', () => {
    /*
     * Separate from GENERATOR_VERSION, which belongs to the local TypeScript generator. Recipe
     * plus seed plus this version describes a result, so changing a core expression's output
     * without changing this would make a stored seed quietly mean a different rhythm.
     */
    expect(Number.isInteger(APL_GENERATOR_VERSION)).toBe(true);
    expect(APL_GENERATOR_VERSION).toBeGreaterThan(0);
  });
});

describe('what the parser will be given', () => {
  it('reads a well-formed reply through the existing parser', () => {
    // No second parser exists. The shape a recipe promises is the shape `parseAplMatrix` accepts.
    const lines = Array.from({ length: TRACK_COUNT }, () => '1 0 0 0 1 0 0 0 1 0 0 0 1 0 0 0');
    const result = parseAplMatrix(lines);
    expect(result.ok).toBe(true);
  });

  it('refuses a reply of the wrong shape, as a generation must', () => {
    for (const lines of [['1 0 1'], Array.from({ length: 7 }, () => '1 0 0 0 1 0 0 0 1 0 0 0 1 0 0 0')]) {
      expect(parseAplMatrix(lines).ok).toBe(false);
    }
  });
});
