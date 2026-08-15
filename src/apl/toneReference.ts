/*
 * What the Tone expressions mean, in TypeScript.
 *
 * **Never used in production.** Nothing in `src/apl/service.ts` or `useApl.ts` can reach this
 * file. It exists for two things: so `tests/unit/toneGenerators.test.ts` can assert what each
 * expression is supposed to do without spending a request, and so `npm run review:apl-tones` can
 * print a hundred phrases to judge for nothing. If APL is unavailable, the feature is
 * unavailable — quietly substituting these would make "Create with APL" a lie, which is the one
 * thing this whole part of the application exists not to be.
 *
 * The seeded draws come from this project's own PRNG rather than from Dyalog's, exactly as
 * `review-apl-generators.ts` does on the Beats side. So this **cannot predict what seed 47291
 * will actually produce** — and it is not for that. It is for judging whether a recipe is any
 * good across the space of choices it can make, which does not depend on which particular
 * choices a given seed draws. `npm run verify:apl-tones-live` is what checks that the real APL
 * agrees about shape, range and structure.
 *
 * The transforms are a different matter: they contain no randomness at all, so these
 * implementations are exact, and the tests hold the APL and the TypeScript to the same answers.
 */

import { createRng } from '@/generation/prng';
import {
  isPhraseValue,
  PHRASE_LENGTH,
  REST,
  TONE_MAX_MIDI,
  TONE_MIN_MIDI,
  type Phrase,
} from '@/tones/phrase';
import type { Parameters } from './operations';
import type { ToneRecipe, ToneScale } from './toneGenerators';
import type { ToneOperation } from './toneOperations';

/** A stand-in for `?`: `n` values, each 0 to `limit`−1, from one seeded stream. */
interface Draws {
  readonly many: (count: number, limit: number) => number[];
  readonly one: (limit: number) => number;
}

function draws(seed: number): Draws {
  const rng = createRng(seed);
  return {
    many: (count, limit) => Array.from({ length: count }, () => rng.int(limit)),
    one: (limit) => rng.int(limit),
  };
}

/**
 * What each recipe computes, in the order its APL computes it.
 *
 * Written to mirror the expression line for line rather than to be idiomatic TypeScript, because
 * the only reason this exists is to be checkably the same thing. Where the APL reads
 * `(r+s[?16⍴5])×0=2|⍳16`, this reads as the same three steps in the same order.
 */
export function generatePhrase(recipe: ToneRecipe, root: number, scale: ToneScale, seed: number): Phrase {
  const roll = draws(seed);
  const degrees = scale.degrees;
  const length = degrees.length;

  switch (recipe.id) {
    case 'pulse': {
      // (r+s[?16⍴5])×0=2|⍳16
      const picks = roll.many(PHRASE_LENGTH, length);
      return picks.map((pick, step) => (step % 2 === 0 ? root + (degrees[pick] ?? 0) : REST));
    }

    case 'riff': {
      // 16⍴(r+s[?4⍴5])×1,0<?3⍴3
      const picks = roll.many(4, length);
      const mask = [1, ...roll.many(3, 3).map((value) => (value > 0 ? 1 : 0))];
      const cell = picks.map((pick, index) =>
        (mask[index] ?? 0) === 1 ? root + (degrees[pick] ?? 0) : REST,
      );
      // ⍴ cycles: four values asked to fill sixteen repeat four times.
      return Array.from({ length: PHRASE_LENGTH }, (_, step) => cell[step % cell.length] ?? REST);
    }

    case 'sparse': {
      // (r+s[?16⍴5])×1,2>?15⍴7
      const picks = roll.many(PHRASE_LENGTH, length);
      const mask = [1, ...roll.many(PHRASE_LENGTH - 1, 7).map((value) => (value < 2 ? 1 : 0))];
      return picks.map((pick, step) => ((mask[step] ?? 0) === 1 ? root + (degrees[pick] ?? 0) : REST));
    }

    case 'climb': {
      /*
       * {(r+s[5|(?5)+⍵×⍳16])×0=2|⍳16}1+?4
       *
       * The draw order matters and is the one place this file has to be careful: APL evaluates
       * the right argument `1+?4` before the dfn body runs, so the interval is drawn first and
       * the starting degree second.
       */
      const stride = 1 + roll.one(4);
      const start = roll.one(length);
      return Array.from({ length: PHRASE_LENGTH }, (_, step) =>
        step % 2 === 0 ? root + (degrees[(start + stride * step) % length] ?? 0) : REST,
      );
    }
  }
}

/** What each transform computes. Exact — there is no randomness in any of them. */
export function applyToneOperation(operation: ToneOperation, parameters: Parameters, phrase: Phrase): Phrase {
  const amount = parameters.amount ?? 0;

  switch (operation.id) {
    case 'transpose':
      return shift(phrase, amount);

    case 'octave':
      return shift(phrase, 12 * amount);

    case 'reverse':
      return [...phrase].reverse();

    case 'rotate':
      return rotate(phrase, amount);
  }
}

/** `(48⌈84⌊n+k)×0<n`: arithmetic on the notes, rests left alone. */
function shift(phrase: Phrase, semitones: number): Phrase {
  return phrase.map((value) => {
    if (value === REST) return REST;
    return Math.min(TONE_MAX_MIDI, Math.max(TONE_MIN_MIDI, value + semitones));
  });
}

/**
 * `k⌽n`, with APL's sign convention.
 *
 * A positive left argument takes from further along the vector, so the phrase appears to move
 * *earlier*. Written as one modulo rather than as a loop for the same reason the APL is one
 * glyph: the operation is a re-indexing, not a repeated shuffle.
 */
function rotate(phrase: Phrase, by: number): Phrase {
  const size = phrase.length;
  return phrase.map((_, index) => phrase[(((index + by) % size) + size) % size] ?? REST);
}

/** Whether every value a reference implementation produced is one a phrase may hold. */
export function isWellFormed(phrase: Phrase): boolean {
  return phrase.length === PHRASE_LENGTH && phrase.every(isPhraseValue);
}
