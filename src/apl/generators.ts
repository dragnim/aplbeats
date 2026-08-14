/*
 * The recipes APL generates whole rhythms from.
 *
 * Stage 3 gave APL a rhythm and asked it to change one. Stage 6 asks it for a rhythm there was
 * not one of before — eight rows, sixteen steps, from nothing but a seed and an expression.
 *
 * Three things about the design are worth stating before the recipes themselves.
 *
 * **The seed is not in the Core APL.** It goes in the wrapper, as `⎕RL←<seed> 1`, and the
 * expression is byte-identical for every seed. That matters in three places at once: Peek shows
 * one expression rather than one per seed; nothing from the interface is ever spliced into APL
 * as text, because the only number that varies is an integer that has been through
 * `clampSeed`; and Explore can load a generator and re-run it unchanged, because the thing that
 * made it reproducible was never part of what you edit.
 *
 * **Randomness modifies structure; it does not replace it.** Every recipe here is a
 * *structural* skeleton — periodic masks, Euclidean distributions, rotations — with seeded
 * choices deciding its parameters or thinning its result. None of them is `?128⍴2` reshaped,
 * and the difference is audible: a random 128-bit mask is not a rhythm, it is a texture.
 *
 * **One expression, and one you can read.** Each core fits the Stage 5 Explore contract
 * unchanged — under 320 code points, no `⋄`, no newline, no comment — because "Edit this APL"
 * has to lead into the same editor everything else does. Where a recipe needs to use a seeded
 * vector twice, it binds it as a dfn's `⍵` rather than reaching for a second statement.
 *
 * ---
 *
 * The glyph palette is not a matter of taste. TryAPL's Safe Execute refuses some primitives
 * *lexically*, rejecting the whole request and naming the character — the first Stage 6 spike
 * failed this way, on `∈`, and so never tested the thing it was written to test. Everything
 * used below was confirmed live before any recipe was designed around it: `⍳ ⍴ | > = × ⌽ ∨ ∧`
 * from Stage 3, and `? ∘. {}` and a vector left argument to `⌽` by deliberate probe.
 *
 * The idioms, once, so the recipes below read as music rather than as puzzles:
 *
 *     ⍳16                  the sixteen step positions, 0 to 15
 *     0=P∘.|⍳16            one periodic mask per track — row i pulses every P[i] steps
 *     (P∘.×16⍴1)>16|P∘.×⍳16   one Euclidean rhythm per track, P[i] hits spread over the bar
 *     R⌽…                  each row rotated by its own amount, so the tracks sit apart
 *     (D∘.×16⍴1)>?8 16⍴16  a seeded layer, D[i] chances in sixteen per track
 *     ?8⍴9, ?⍵             seeded parameters — a fixed range, or one bounded by another row's
 *
 * `∘.` is doing the work that makes this APL rather than eight loops: an outer product turns
 * eight per-track numbers into an 8 × 16 grid in one glyph, which is the whole reason a kit
 * can be described as one array expression instead of as a program.
 */

import { patternToAplLiteral } from './matrix';
import { aplNumber, IO_ORIGIN, type TransformSource } from './operations';
import { clampSeed } from '@/generation/prng';
import { TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import { DIAMOND } from './wire';

/**
 * The version of what a recipe and a seed *mean*.
 *
 * Separate from `GENERATOR_VERSION`, which belongs to the local TypeScript generator and is not
 * this system's business. Together with the recipe id and the seed it describes a result:
 * change any core expression below in a way that alters its output, and this has to go up, or a
 * stored recipe-and-seed would quietly start meaning a different rhythm.
 *
 * Not a claim of eternal bit-stability. What is controlled here is the expression, the RNG
 * selection and the seed; what Dyalog does with them across future releases is Dyalog's.
 */
export const APL_GENERATOR_VERSION = 1;

/** Which random number generator, as the second element of `⎕RL`. */
const RNG1 = 1;

export type RecipeId = 'four-on-floor' | 'broken' | 'halves' | 'cross';

export interface Recipe {
  readonly id: RecipeId;
  /** What the selector shows. */
  readonly name: string;
  /** One line, for the selector's title and the panel. */
  readonly blurb: string;
  /**
   * The expression that makes the rhythm. Identical for every seed.
   *
   * Shown in Peek as Core APL, and loaded verbatim into Explore. There is no second, simpler
   * version for teaching: what is displayed is what runs.
   */
  readonly core: string;
  /**
   * Two to four short lines about the APL ideas this recipe uses.
   *
   * Only the glyphs actually in its own core. A line explaining `∘.` beside an expression that
   * does not use one is worse than no line at all.
   */
  readonly explanation: readonly string[];
}

/* ------------------------------------------------------------------------- */

export const RECIPES: readonly Recipe[] = [
  {
    id: 'four-on-floor',
    name: 'Four on Floor',
    blurb: 'Kick on the quarters, backbeat snare, hats for motion. The safe one.',
    /*
     * A fixed skeleton, plus a seeded layer that may only land where the music allows.
     *
     * The skeleton is eight periodic masks at eight rotations: the kick every four steps from
     * 0, the snare every eight from 4 — which is the backbeat — hats every two, the open hat
     * displaced onto the offbeat, and the percussion sparse. That much never moves, which is
     * what earns the recipe its name.
     *
     * The second half is where the seed lives. `(D∘.×16⍴1)>?8 16⍴16` gives row i roughly D[i]
     * chances in sixteen of an extra hit, and it is masked by a second periodic grid so those
     * extras land on musical subdivisions rather than anywhere at all — sixteenths for the
     * closed hat, quarters for the snare and clap, eighths for the percussion. Without that
     * mask the recipe filled its gaps with noise; with it, the additions swing.
     *
     * `D` begins with 0, so the kick row can never gain a hit. Everything else can.
     */
    core: '((0 4 0 2 4 8 12 6)⌽0=(4 8 2 8 8 16 16 16)∘.|⍳16)∨(0=(4 4 1 4 4 2 2 2)∘.|⍳16)∧((0,(2 5 3 2 3 2 3)+?7⍴3)∘.×16⍴1)>?8 16⍴16',
    explanation: [
      '⍳16 makes the sixteen step positions; 0=P∘.|⍳16 turns eight periods into eight pulse rows.',
      '⌽ with a vector on the left rotates each row by its own amount — that is what puts the snare on the backbeat.',
      '? draws the seeded part: D chances in sixteen per row, so the seed decides the extras.',
      '∧ keeps those extras on musical subdivisions; ∨ adds them to the skeleton.',
    ],
  },
  {
    id: 'broken',
    name: 'Broken',
    blurb: 'Syncopated kick, snare you can still find, hats holding it together.',
    /*
     * Euclidean rhythms at fixed rotations, with seeded hit counts.
     *
     * The opposite emphasis from Four on Floor: there the structure was fixed and the seed
     * added: here the structure itself is what the seed chooses, and the rotations are fixed so
     * the result still has somewhere to stand. Five to seven kick hits spread evenly over
     * sixteen steps lands on 0 and then off the grid — a kick that starts on the beat and then
     * refuses to stay there, which is the entire idea of the recipe.
     *
     * The rotation vector is the groove: the snare and clap are pushed to 12 so their Euclidean
     * figures fall on the backbeat, the closed hat stays at 0, and the percussion is scattered.
     *
     * Not Four on Floor with a row rotated. The kick is a different *kind* of pattern.
     */
    core: '{(0 12 0 4 12 5 9 3)⌽(⍵∘.×16⍴1)>16|⍵∘.×⍳16}(5 2 8 3 2 5 3 4)+?8⍴3',
    explanation: [
      'k>16|k×⍳16 is a Euclidean rhythm: k hits spread as evenly over sixteen steps as arithmetic allows.',
      '∘. does it for all eight tracks at once, one hit count per row.',
      '? chooses those counts, so the seed decides how busy each track is.',
      'The dfn binds the counts as ⍵ so one seeded draw can be used twice.',
    ],
  },
  {
    id: 'halves',
    name: 'Halves',
    blurb: 'An eight-step figure, then the same figure answering itself.',
    /*
     * The only recipe built along the step axis rather than the track axis.
     *
     * An eight-step figure is made for all eight tracks at once — the *call* — and then the bar
     * is that figure catenated with a displaced copy of itself: the *answer*. `⍵,R⌽⍵` is the
     * whole idea, and it is two glyphs. Because the answer is the call moved rather than a fresh
     * draw, the two halves are recognisably the same music, which is what makes a bar of it feel
     * like a phrase instead of like sixteen independent decisions.
     *
     * The kick and the snare are given rotation 0 in the answer, so the kick keeps its quarters
     * and the snare keeps 4 and 12 across both halves. Everything else is displaced by a seeded
     * amount, so the second half of the bar is where the variation lives.
     *
     * This replaced a candidate called Euclidean Kit, which is worth recording. That recipe drew
     * its rotations from each row's own hit count — elegant, and the reason it had to go: a
     * freely rotated Euclidean kick lands on beat one only by luck, and across a seed sample it
     * mostly did not. Every fix that restored the downbeat turned it into Broken.
     */
    core: '{⍵,(0 0,?6⍴8)⌽⍵}(0 4 0 2 4 6 2 5)⌽0=(4 8,2+?6⍴4)∘.|⍳8',
    explanation: [
      '⍳8 makes a half-bar, and 0=P∘.|⍳8 gives each track its pulse within it.',
      'The dfn catenates that figure with a rotated copy: ⍵,R⌽⍵ is the call and the answer.',
      '? chooses how far each track’s answer is displaced — the kick and snare stay put.',
      ', is what makes one bar out of two halves.',
    ],
  },
  {
    id: 'cross',
    name: 'Cross',
    blurb: 'Cycles of two to seven steps crossing a sixteen-step bar, over a steady kick.',
    /*
     * Periods that do not divide the bar, over one that does.
     *
     * A cycle of three or five or seven steps does not come round where a sixteen-step bar
     * does, so the tracks drift against each other and against the bar line — figures that
     * interlock rather than line up. Everything still fits in one sixteen-step bar, which is
     * why this is called Cross and not Polyrhythm: the tracks cross, the metre does not.
     *
     * The kick is the concession that makes it music. Its period is fixed at four and its
     * rotation at zero, so however far the other seven wander there is something to hear them
     * against. Without that anchor the recipe was mush — which was worth finding out by
     * listening rather than by defending the idea.
     */
    core: '{(0,?7⍴16)⌽0=⍵∘.|⍳16}4,2+?7⍴6',
    explanation: [
      '⍵∘.|⍳16 gives every step position its remainder under each track’s own cycle length.',
      '0= turns each of those into a pulse — every third step, every fifth, every seventh.',
      '? chooses the cycle lengths and the rotations, so the seed decides how they interlock.',
      'The leading 4 keeps the kick on the quarters, so the crossing has something to cross.',
    ],
  },
];

const BY_ID: Partial<Record<string, Recipe>> = Object.fromEntries(
  RECIPES.map((recipe) => [recipe.id, recipe]),
);

/** The recipe a session starts on: the one that is hardest to get a bad beat out of. */
export const DEFAULT_RECIPE_ID: RecipeId = 'four-on-floor';

export function recipeById(id: string): Recipe {
  return BY_ID[id] ?? RECIPES[0]!;
}

export function isRecipeId(value: unknown): value is RecipeId {
  return typeof value === 'string' && Object.hasOwn(BY_ID, value);
}

/* ------------------------------------------------------------------------- */

/** Which rows the generator may not touch, as row indices in ascending order. */
export type LockedRows = readonly number[];

/** Locked rows, validated and sorted. Anything that is not a row index is discarded. */
export function normaliseLockedRows(locks: Iterable<number>): number[] {
  const rows = new Set<number>();
  for (const row of locks) {
    if (Number.isInteger(row) && row >= 0 && row < TRACK_COUNT) rows.add(row);
  }
  return [...rows].sort((a, b) => a - b);
}

export interface GenerateSourceRequest {
  readonly recipe: Recipe;
  /** Brought into 1–999999 by `clampSeed` before it is ever formatted. */
  readonly seed: number;
  /** The current rhythm. Sent only when a locked row has to be preserved from it. */
  readonly pattern: Pattern;
  readonly lockedRows: LockedRows;
}

/**
 * The full request for one generation.
 *
 * The shape, when nothing is locked:
 *
 *     ⎕IO←0 ⋄ ⎕RL←47291 1 ⋄ <core>
 *
 * and when something is:
 *
 *     ⎕IO←0 ⋄ ⎕RL←47291 1 ⋄ m←8 16⍴… ⋄ g←(<core>) ⋄ g[0 3;]←m[0 3;] ⋄ g
 *
 * Two things about the second form are deliberate. The locked rows are restored **in APL**, so
 * the matrix that arrives is the whole answer rather than something JavaScript has to finish —
 * and the restoration happens *after* the core has run, so locking a row cannot change the
 * random draws the other seven got. Lock the kick and the hats come out exactly as they would
 * have. That is worth the extra statement.
 *
 * The current pattern is sent only when a lock needs it. With nothing locked the request does
 * not mention the current rhythm at all, which is both shorter and the reason a cached result
 * can survive the visitor editing a cell.
 */
export function buildGenerateSource({
  recipe,
  seed,
  pattern,
  lockedRows,
}: GenerateSourceRequest): TransformSource {
  const safeSeed = clampSeed(seed);
  const locks = normaliseLockedRows(lockedRows);

  const preamble = [`⎕IO←${String(IO_ORIGIN)}`, `⎕RL←${String(safeSeed)} ${String(RNG1)}`];

  if (locks.length === 0) {
    const statements = [...preamble, recipe.core];
    return { core: recipe.core, statements, expression: statements.join(` ${DIAMOND} `) };
  }

  const rows = locks.map((row) => aplNumber(row)).join(' ');
  const statements = [
    ...preamble,
    `m←${patternToAplLiteral(pattern)}`,
    `g←(${recipe.core})`,
    `g[${rows};]←m[${rows};]`,
    'g',
  ];

  return { core: recipe.core, statements, expression: statements.join(` ${DIAMOND} `) };
}

/**
 * The seed a generated expression has to run under to reproduce its result.
 *
 * Read by Explore, which has to be able to say "APL Beats fixes ⎕RL to 47291 for this
 * expression" and then actually do it — otherwise loading a generator into the editor and
 * pressing Run would give a different rhythm than the button that made it, and Peek would be
 * a lie.
 */
export function generatorRandomSeed(seed: number): number {
  return clampSeed(seed);
}
