/*
 * The four things APL does to a melody, and why they are the four.
 *
 * The Beats operations act on `m`, an 8 × 16 Boolean matrix. These act on `n`, a sixteen-element
 * numeric vector — and the contrast is the entire teaching point of Stage 8. Two of the four are
 * *the same glyph doing the same thing to a different shape*: `⌽n` reverses a melody exactly as
 * `⌽m` reverses a rhythm, and `3⌽n` rotates one as `3⌽m` rotates the other. Nothing was written
 * twice to make that true. It is true because rank-polymorphism is what array languages are for,
 * and seeing it happen to your own music is worth more than a paragraph claiming it.
 *
 * The other two exist because a melody has something a rhythm has not: a *value* at each step.
 * You cannot transpose a Boolean. `n+5` is a sentence that only makes sense here, and the fact
 * that it is spelt `n+5` rather than as a loop over sixteen notes is the second half of the
 * lesson.
 *
 * ---
 *
 * **Rests survive everything.** Zero is a rest, so `0<n` is the mask of sounding notes and
 * `×0<n` puts the rests back after any arithmetic. Without it, `n+5` would turn every rest into
 * MIDI 5 — an inaudible sub-bass note where there had been silence — which is the one bug this
 * data model makes easy to write and easy to prevent.
 *
 * **Notes stay inside the instrument.** `48⌈84⌊` holds the result within the sampled range. A
 * pitch outside it would be refused by the parser and the whole transform lost, so it is clamped
 * in APL rather than validated in JavaScript: a melody transposed up past the top of the
 * instrument keeps its top note at the top rather than failing. That is a real edge — say so in
 * the explanation rather than pretend the range is infinite.
 *
 * Every glyph here was confirmed working against TryAPL's Safe Execute before anything was
 * designed around it: `⌽ + × < ⌈ ⌊` all appear in Stage 3's or Stage 6's verified palette.
 */

import { phraseToAplLiteral, TONE_MAX_MIDI, TONE_MIN_MIDI, type Phrase } from '@/tones/phrase';
import { aplNumber, IO_ORIGIN, type AplSource, type ParameterSpec, type Parameters } from './operations';
import { DIAMOND } from './wire';

export const TONE_OPERATION_IDS = ['transpose', 'reverse', 'rotate', 'octave'] as const;
export type ToneOperationId = (typeof TONE_OPERATION_IDS)[number];

export interface ToneOperation {
  readonly id: ToneOperationId;
  /** Plain language, always visible. Never only a glyph. */
  readonly name: string;
  /** One line, in musical terms. */
  readonly summary: string;
  readonly parameters: readonly ParameterSpec[];
  /** Two or three short lines explaining the glyphs, shown in Peek. */
  readonly explanation: readonly string[];
}

export const TONE_OPERATIONS: readonly ToneOperation[] = [
  {
    id: 'transpose',
    name: 'Transpose',
    summary: 'Move every note up or down, in semitones.',
    parameters: [
      { key: 'amount', label: 'Semitones', min: -12, max: 12, excludeZero: true, defaultValue: 5 },
    ],
    explanation: [
      'n+5 adds five semitones to all sixteen values at once. No loop, because a vector is one thing.',
      '0<n marks the sounding notes, and ×0<n puts the rests back — otherwise every rest would become a note.',
      '48⌈84⌊ keeps the result inside the instrument’s range.',
    ],
  },
  {
    id: 'reverse',
    name: 'Reverse',
    summary: 'Play the melody backwards.',
    parameters: [],
    explanation: [
      '⌽ with nothing on its left reverses — the same glyph that reverses a rhythm, on a different shape.',
      'The last note becomes the first, and the rests come with it.',
    ],
  },
  {
    id: 'rotate',
    name: 'Rotate',
    summary: 'Move the melody through time.',
    parameters: [{ key: 'amount', label: 'Steps', min: -8, max: 8, excludeZero: true, defaultValue: -2 }],
    explanation: [
      '⌽ with a number on its left rotates. A negative amount moves the melody later, a positive one earlier.',
      'Exactly what k⌽m does to a rhythm — one expression, two kinds of music.',
    ],
  },
  {
    id: 'octave',
    name: 'Octave',
    summary: 'Move the whole melody by whole octaves.',
    parameters: [{ key: 'amount', label: 'Octaves', min: -2, max: 2, excludeZero: true, defaultValue: 1 }],
    explanation: [
      'An octave is twelve semitones, so this is n+12×k — the same arithmetic, a musical unit.',
      '×0<n keeps the rests, and 48⌈84⌊ keeps the notes inside the instrument.',
    ],
  },
];

const BY_ID: Partial<Record<string, ToneOperation>> = Object.fromEntries(
  TONE_OPERATIONS.map((operation) => [operation.id, operation]),
);

export function toneOperationById(id: string): ToneOperation {
  return BY_ID[id] ?? TONE_OPERATIONS[0]!;
}

export function isToneOperationId(value: unknown): value is ToneOperationId {
  return typeof value === 'string' && Object.hasOwn(BY_ID, value);
}

/* ------------------------------------------------------------------------- */

export interface ToneSourceRequest {
  readonly operation: ToneOperation;
  readonly parameters: Parameters;
  readonly phrase: Phrase;
}

/**
 * The APL for one melody transform.
 *
 * Four statements, the same shape as a Beats transform: set the index origin, write the melody
 * down, transform it, hand it back. There is no target — a melody is one line, so there is
 * nothing to choose between "this track" and "all tracks", and the control that would have
 * offered the choice is simply absent rather than present and disabled.
 */
export function buildToneSource({ operation, parameters, phrase }: ToneSourceRequest): AplSource {
  const core = buildToneCore(operation, parameters);

  const statements = [`⎕IO←${String(IO_ORIGIN)}`, `n←${phraseToAplLiteral(phrase)}`, `n←${core}`, 'n'];

  return { core, statements, expression: statements.join(` ${DIAMOND} `) };
}

/** The expression that does the work, without the transport around it. */
export function buildToneCore(operation: ToneOperation, parameters: Parameters): string {
  const amount = parameters.amount ?? 0;

  switch (operation.id) {
    case 'transpose':
      return keepRestsAndRange(`n+${aplNumber(amount)}`);

    case 'reverse':
      return '⌽n';

    case 'rotate':
      return `${aplNumber(amount)}⌽n`;

    case 'octave':
      /*
       * `12×k` rather than the multiplied-out number.
       *
       * `n+12×2` is longer than `n+24` and says what it means: an octave is twelve semitones,
       * and this operation is the semitone one with a musical unit on the front. Peek shows what
       * runs, so what runs should be the sentence worth reading.
       */
      return keepRestsAndRange(`n+12×${aplNumber(amount)}`);
  }
}

/**
 * Arithmetic on pitches, with the two rules that make it music.
 *
 * `48⌈84⌊…` holds the result inside the sampled range, and `×0<n` restores the rests using the
 * mask of the *original* vector — which is why it is applied last and why the mask is `0<n`
 * rather than `0<` the result: a rest that had been shifted to 48 by the clamp must go back to
 * being a rest, not become the instrument's lowest note.
 */
function keepRestsAndRange(expression: string): string {
  return `(${String(TONE_MIN_MIDI)}⌈${String(TONE_MAX_MIDI)}⌊${expression})×0<n`;
}
