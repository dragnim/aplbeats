/*
 * The recipes APL writes Tone phrases from.
 *
 * The Beats side of this file's counterpart makes eight rows of yes and no. This makes sixteen
 * numbers — and everything that was awkward about generating a rhythm is easy here, because a
 * phrase is what an array language is *actually* shaped like. There are no outer products below.
 * There is a scale, written as the vector it is, and there is indexing into it.
 *
 *     s←0 3 5 7 10        the scale, as intervals from the root
 *     s[?16⍴5]            sixteen seeded degrees, drawn from it
 *     r+s[?16⍴5]          sixteen pitches
 *     ×0<?16⍴7            and some of them silenced
 *
 * That is the whole idiom, and every recipe here is a variation on it. Anybody who reads four
 * lines of this has learnt indexing, reshape and seeded selection without being taught any of
 * them separately.
 *
 * ---
 *
 * **Root and Scale are controls, not recipes.** Which notes are available is a musical decision
 * a person should be making — C minor pentatonic under a heavy kit, D dorian over something
 * lighter — and making it a separate control means four recipes times five scales times twelve
 * roots rather than four fixed tunes. The recipes decide *rhythm and contour*: a steady pulse, a
 * repeated cell, something sparse, something climbing.
 *
 * **Nothing can leave the instrument.** The root is bounded to 48–71 and the widest scale reaches
 * 11 semitones above it, so the highest pitch any recipe can produce is 82 — inside the sampled
 * range of 48 to 84. That is why no core here carries a clamp: the range is guaranteed by the
 * controls rather than repaired by the expression, which keeps every recipe short enough to read.
 *
 * **The first step always sounds.** Every seeded rest mask is catenated onto a leading 1. A
 * phrase that opens on a rest is a perfectly good phrase, and a *generated* one that opens on a
 * rest reads as a generator that failed — and at a low density the mask could in principle come
 * back all zeroes, which would be sixteen rests and a button that appeared broken.
 *
 * **The seed is not in the Core APL**, exactly as on the Beats side: it goes in the wrapper as
 * `⎕RL←<seed> 1`. The root and the scale *are* in the core, because they are what the expression
 * is about — but they arrive as numbers from clamped ranges and named vectors from the table
 * below, never as text from the interface.
 *
 * Glyph palette: `⍳ ⍴ | > < = × , ? {} ⍵ +` and bracket indexing, all from the Stage 3 and
 * Stage 6 verified sets, plus a live check of vector indexing before these were designed. See
 * `scripts/verify-apl-tones-live.ts`.
 */

import { clampSeed } from '@/generation/prng';
import { noteName, PHRASE_LENGTH, TONE_MIN_MIDI } from '@/tones/phrase';
import { aplNumber, IO_ORIGIN, type AplSource } from './operations';
import { DIAMOND } from './wire';

/**
 * The version of what a recipe, a root, a scale and a seed *mean*.
 *
 * The Tone counterpart of `APL_GENERATOR_VERSION`, and separate from it: changing a rhythm
 * recipe has nothing to say about what a phrase seed produces, and coupling them would throw
 * away one side's stored settings every time the other was tuned.
 */
export const TONE_GENERATOR_VERSION = 1;

/** Which random number generator, as the second element of `⎕RL`. */
const RNG1 = 1;

/* --- Scales --------------------------------------------------------------- */

export type ToneScaleId = 'minor-pentatonic' | 'major-pentatonic' | 'dorian' | 'natural-minor' | 'major';

export interface ToneScale {
  readonly id: ToneScaleId;
  readonly name: string;
  /** Semitones above the root. Written into the core as an APL vector. */
  readonly degrees: readonly number[];
  /** One line, for the selector's title. */
  readonly blurb: string;
}

/**
 * Five scales, pentatonics first.
 *
 * Ordered by how hard they are to get a bad phrase out of rather than by music theory. A
 * pentatonic has no semitone steps at all, so a random walk through it lands on nothing that
 * clashes with anything — which is exactly what you want when the notes are being chosen by a
 * seed. The seven-note scales are further down because they can produce a genuinely wrong note
 * against a bass line, and somebody should reach them on purpose.
 */
export const TONE_SCALES: readonly ToneScale[] = [
  {
    id: 'minor-pentatonic',
    name: 'Minor pentatonic',
    degrees: [0, 3, 5, 7, 10],
    blurb: 'Five notes, no semitones. The one that always works.',
  },
  {
    id: 'major-pentatonic',
    name: 'Major pentatonic',
    degrees: [0, 2, 4, 7, 9],
    blurb: 'Five notes, brighter. Open and folk-like.',
  },
  {
    id: 'dorian',
    name: 'Dorian',
    degrees: [0, 2, 3, 5, 7, 9, 10],
    blurb: 'Minor with a raised sixth. The one house and jazz keep coming back to.',
  },
  {
    id: 'natural-minor',
    name: 'Natural minor',
    degrees: [0, 2, 3, 5, 7, 8, 10],
    blurb: 'Seven notes, unambiguously minor.',
  },
  {
    id: 'major',
    name: 'Major',
    degrees: [0, 2, 4, 5, 7, 9, 11],
    blurb: 'Seven notes, unambiguously major.',
  },
];

const SCALES_BY_ID: Partial<Record<string, ToneScale>> = Object.fromEntries(
  TONE_SCALES.map((scale) => [scale.id, scale]),
);

export const DEFAULT_SCALE_ID: ToneScaleId = 'minor-pentatonic';

export function toneScaleById(id: string): ToneScale {
  return SCALES_BY_ID[id] ?? TONE_SCALES[0]!;
}

export function isToneScaleId(value: unknown): value is ToneScaleId {
  return typeof value === 'string' && Object.hasOwn(SCALES_BY_ID, value);
}

/* --- Roots ---------------------------------------------------------------- */

/**
 * The roots on offer: two octaves, C3 to B4.
 *
 * Bounded rather than offered across the whole instrument, and the bound is arithmetic rather
 * than taste. The widest scale here reaches 11 semitones above its root, so a root of 71 can
 * produce 82 — inside the sampled range of 48 to 84, with two semitones to spare. A third octave
 * of roots would put generated notes above the top of the instrument, and the recipes would need
 * a clamp that made them longer and less readable to fix a problem this range simply does not
 * have.
 *
 * Two octaves rather than one because register is a real musical choice: the same recipe at C3
 * is a bass line and at C4 is a lead, and making somebody reach for the Octave transform to get
 * there would be asking them to fix the generator's answer rather than ask a better question.
 */
export const TONE_ROOT_MIN = TONE_MIN_MIDI;
export const TONE_ROOT_MAX = TONE_MIN_MIDI + 23;
/** C4: middle C, and the register a lead sits in. */
export const DEFAULT_ROOT = TONE_MIN_MIDI + 12;

/** The roots, as MIDI numbers with the names the selector shows. */
export const TONE_ROOTS: readonly { readonly midi: number; readonly name: string }[] = Array.from(
  { length: TONE_ROOT_MAX - TONE_ROOT_MIN + 1 },
  (_, index) => ({ midi: TONE_ROOT_MIN + index, name: noteName(TONE_ROOT_MIN + index) }),
);

export function clampRoot(root: number): number {
  if (!Number.isFinite(root)) return DEFAULT_ROOT;
  return Math.min(TONE_ROOT_MAX, Math.max(TONE_ROOT_MIN, Math.round(root)));
}

/* --- Recipes -------------------------------------------------------------- */

export type ToneRecipeId = 'pulse' | 'riff' | 'sparse' | 'climb';

export interface ToneRecipe {
  readonly id: ToneRecipeId;
  readonly name: string;
  /** One line, for the selector's title and the panel. */
  readonly blurb: string;
  /**
   * The expression, given a root and a scale.
   *
   * A function rather than a string because the root and the scale genuinely belong in the
   * expression — `60+0 3 5 7 10[…]` is what makes it a phrase in C minor rather than a shape.
   * Both arrive as numbers, from a clamped range and a table in this file, so nothing from the
   * interface is ever spliced into APL as text.
   */
  readonly core: (root: number, scale: ToneScale) => string;
  /** Two to four short lines about the APL ideas this recipe uses. Only its own glyphs. */
  readonly explanation: readonly string[];
}

/** A scale as APL writes it: `0 3 5 7 10`, parenthesised so it can be indexed. */
function scaleLiteral(scale: ToneScale): string {
  return `(${scale.degrees.map((degree) => aplNumber(degree)).join(' ')})`;
}

export const TONE_RECIPES: readonly ToneRecipe[] = [
  {
    id: 'pulse',
    name: 'Pulse',
    blurb: 'A note on every other step, chosen from the scale. Steady, and always on the beat.',
    /*
     * The simplest thing that is unmistakably a phrase.
     *
     * A fixed eighth-note grid — `0=2|⍳16` — with seeded degrees on it. The rhythm never moves,
     * so what the seed changes is the *tune*, which makes it the recipe to press twice when you
     * want to hear what a seed does. It also sits under a drum kit without argument, because
     * every note lands on an eighth.
     */
    core: (root, scale) =>
      `(${aplNumber(root)}+${scaleLiteral(scale)}[?${String(PHRASE_LENGTH)}⍴${String(
        scale.degrees.length,
      )}])×0=2|⍳${String(PHRASE_LENGTH)}`,
    explanation: [
      's[?16⍴5] draws sixteen degrees from a five-note scale — the ? is where the seed lives.',
      'Adding the root turns degrees into pitches, all sixteen at once.',
      '0=2|⍳16 is a note on every even step; × silences the rest.',
    ],
  },
  {
    id: 'riff',
    name: 'Riff',
    blurb: 'A four-step cell, repeated four times. The one that sounds written rather than drawn.',
    /*
     * `16⍴` doing the work of a loop, a phrase structure and a hook all at once.
     *
     * Reshape *cycles*: give it four values and ask for sixteen and it repeats them. So a
     * four-step cell becomes a bar of the same figure four times over, which is what most
     * memorable bass lines and most acid lines actually are.
     *
     * Musically this is the strongest of the four by a distance, because repetition is what
     * makes a sequence of notes into a riff — and it costs one glyph.
     */
    core: (root, scale) =>
      `${String(PHRASE_LENGTH)}⍴(${aplNumber(root)}+${scaleLiteral(scale)}[?4⍴${String(
        scale.degrees.length,
      )}])×1,0<?3⍴3`,
    explanation: [
      '?4⍴5 draws a four-step cell, and s[…] turns those into notes.',
      '16⍴ repeats the cell to fill the bar — reshape cycles, which is the whole trick.',
      '1,0<?3⍴3 rests some of the cell but never its first step, so the riff always lands.',
    ],
  },
  {
    id: 'sparse',
    name: 'Sparse',
    blurb: 'A few notes with room around them. For phrases that answer the drums rather than cover them.',
    /*
     * Density as a seeded threshold, and the recipe that is mostly silence on purpose.
     *
     * `2>?16⍴7` is true about two times in seven, so a bar comes out with four or five notes in
     * it. The whole point is the space: a phrase that plays on every step leaves the kit nothing
     * to say, and the most useful thing a generator can offer beside a drum machine is a line
     * that gets out of the way.
     */
    core: (root, scale) =>
      `(${aplNumber(root)}+${scaleLiteral(scale)}[?${String(PHRASE_LENGTH)}⍴${String(
        scale.degrees.length,
      )}])×1,2>?${String(PHRASE_LENGTH - 1)}⍴7`,
    explanation: [
      '2>?15⍴7 is true about two times in seven — a seeded density, and most of the bar is rest.',
      'The leading 1 keeps step one sounding, so a sparse bar never comes back empty.',
      '× applies the mask to the sixteen pitches in one go.',
    ],
  },
  {
    id: 'climb',
    name: 'Climb',
    blurb: 'An arpeggio walking up the scale and wrapping round. Mechanical, in the good way.',
    /*
     * Deterministic contour, seeded interval — the opposite arrangement to the other three.
     *
     * `5|j×⍳16` counts up in steps of j through a five-note scale and wraps at the top, which is
     * an arpeggio: 0 2 4 1 3 0 2 … for j=2. The seed chooses the interval j and the degree the
     * figure starts on, and nothing else — so pressing Generate again gives a recognisably
     * related figure rather than an unrelated one, which is exactly the opposite of what the
     * other three recipes offer and the reason this one is here.
     *
     * Two draws rather than one because with j alone there were only four possible phrases, and
     * a seed control that has four answers is a seed control that appears broken on its fifth
     * press. A starting degree multiplies that by the length of the scale.
     *
     * The dfn is there so the interval can be drawn once and named: `{…}1+?4` binds j to ⍵.
     */
    core: (root, scale) => {
      const length = String(scale.degrees.length);
      const steps = String(PHRASE_LENGTH);
      return `{(${aplNumber(root)}+${scaleLiteral(scale)}[${length}|(?${length})+⍵×⍳${steps}])×0=2|⍳${steps}}1+?4`;
    },
    explanation: [
      'j×⍳16 counts up in steps of j; 5| wraps it round a five-note scale.',
      'Indexing the scale with that gives an arpeggio — the same figure a sequencer would loop.',
      '? draws the interval and the starting degree, so the seed picks the shape rather than every note.',
      'The dfn binds the interval as ⍵ so the one draw can be named and used.',
    ],
  },
];

const RECIPES_BY_ID: Partial<Record<string, ToneRecipe>> = Object.fromEntries(
  TONE_RECIPES.map((recipe) => [recipe.id, recipe]),
);

/** The recipe a session starts on: the one that most obviously sounds written. */
export const DEFAULT_TONE_RECIPE_ID: ToneRecipeId = 'riff';

export function toneRecipeById(id: string): ToneRecipe {
  return RECIPES_BY_ID[id] ?? TONE_RECIPES[0]!;
}

export function isToneRecipeId(value: unknown): value is ToneRecipeId {
  return typeof value === 'string' && Object.hasOwn(RECIPES_BY_ID, value);
}

/* ------------------------------------------------------------------------- */

export interface ToneGenerateSourceRequest {
  readonly recipe: ToneRecipe;
  readonly root: number;
  readonly scale: ToneScale;
  /** Brought into 1–999999 by `clampSeed` before it is ever formatted. */
  readonly seed: number;
}

/**
 * The full request for one generated phrase.
 *
 *     ⎕IO←0 ⋄ ⎕RL←47291 1 ⋄ <core>
 *
 * Three statements, and no fourth. Unlike a rhythm there is nothing to preserve from what was
 * there before — Beats has locked tracks, and a phrase is one line, so "lock the phrase and
 * generate a new one" has no meaning. The whole answer comes back from the core.
 */
export function buildToneGenerateSource({ recipe, root, scale, seed }: ToneGenerateSourceRequest): AplSource {
  const core = recipe.core(clampRoot(root), scale);
  const statements = [`⎕IO←${String(IO_ORIGIN)}`, `⎕RL←${String(clampSeed(seed))} ${String(RNG1)}`, core];

  return { core, statements, expression: statements.join(` ${DIAMOND} `) };
}

/** The seed a generated phrase has to run under to reproduce itself. Read by Explore. */
export function toneGeneratorRandomSeed(seed: number): number {
  return clampSeed(seed);
}
