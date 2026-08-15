import { PHRASE_LENGTH, REST, TONE_MAX_MIDI, TONE_MIN_MIDI, isPitch, type Phrase } from './phrase';

/*
 * The Tone phrase seen as twelve rows of sixteen columns.
 *
 * A *view*, and the word is load-bearing. `n` is still sixteen MIDI numbers and still the only
 * thing stored, transformed or sent; this module says which cell of a grid each of those numbers
 * lights. Nothing here is persisted and nothing here reaches APL.
 *
 * **Twelve rows are pitch classes, not an octave window.** Row 0 is C, row 11 is B, and C3, C4,
 * C5 and C6 all light the same row — the octave is drawn as a badge on the cell rather than by
 * being somewhere else vertically. That is what makes twelve rows enough for a thirty-seven
 * semitone instrument, and it is why there is no octave page, no base note and no scrolling
 * window: every note the sampler can play has a row already.
 *
 * **The projection is one-way.** A matrix cell says "a G sounds on step 6"; it does not say which
 * G. So `n` cannot be rebuilt from the grid, and no code here pretends otherwise — the editor
 * changes `n` directly and the grid is redrawn from it. A reversible 12 × 16 encoding would have
 * needed thirty-seven rows, which is a piano roll, which is not what this is.
 *
 * The one trap, and it is worth naming because it is silent: `12|0` is 0, so a rest has the pitch
 * class of C. Every function below masks rests explicitly rather than relying on the arithmetic,
 * and `projectionSource` shows the same mask in the APL it prints.
 */

/** Twelve rows: one per pitch class, C at the bottom. */
export const MATRIX_ROWS = 12;

/** C, C♯, D … B — the row order, bottom to top. */
export const ROW_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

/** Which rows are black keys. Not decoration: it is how anybody finds C without counting. */
export const ROW_IS_BLACK: readonly boolean[] = [
  false,
  true,
  false,
  true,
  false,
  false,
  true,
  false,
  true,
  false,
  true,
  false,
];

/** Where a note with no history goes. Middle C, as the strip used it. */
export const DEFAULT_WORKING_PITCH = 60;

/** Which row a pitch lights. Rests have no row; ask `isPitch` first. */
export function pitchClassOf(midi: number): number {
  return ((midi % MATRIX_ROWS) + MATRIX_ROWS) % MATRIX_ROWS;
}

/**
 * The octave badge, in the convention where 60 is C4.
 *
 * Scientific pitch notation, the same one `noteName` uses, so the badge on a cell and the name in
 * the editor row below can never disagree about which C this is.
 */
export function octaveOf(midi: number): number {
  return Math.floor(midi / MATRIX_ROWS) - 1;
}

/** Twelve rows of sixteen: `true` where that pitch class sounds on that step. */
export type ToneMatrix = readonly (readonly boolean[])[];

/**
 * The grid, from the phrase.
 *
 * At most one cell in any column is `true`, because a phrase holds one value per step and the
 * sampler is monophonic. That is not enforced here — it is inherited, which is the difference
 * between a constraint the editor imposes and the shape of the data showing through.
 */
export function phraseToMatrix(phrase: Phrase): ToneMatrix {
  return Array.from({ length: MATRIX_ROWS }, (_, row) =>
    Array.from({ length: PHRASE_LENGTH }, (_, step) => {
      const value = phrase[step] ?? REST;
      return value !== REST && pitchClassOf(value) === row;
    }),
  );
}

/**
 * Which pitch a row means, given the note you were on.
 *
 * **The same octave the reference is in**, and that is a decision worth defending, because the
 * obvious alternative — the *nearest* pitch of that class — is wrong here and wrong in a way that
 * only shows up on screen.
 *
 * The twelve rows are drawn as one octave: C along the bottom, B along the top. So clicking a row
 * above the note you were on has to sound above it, and clicking below has to sound below. Nearest
 * breaks that. From C4, the G row is five rows *up* and nearest would give G3, five semitones
 * *down*. From B4 the C row is eleven rows down and nearest would give C5, a semitone up. Both are
 * defensible arithmetic and both look like a bug.
 *
 * Crossing an octave is therefore never something a click does — it is what the ±12 controls and
 * Page Up and Page Down are for, which is also the only place the octave is ever named.
 *
 * The one exception is the edge. C6 is the top of the instrument, so from there the B row cannot
 * be B6; it drops to B5, because the alternative is refusing the click.
 */
export function pitchForRow(row: number, reference: number): number {
  const inSameOctave = reference - pitchClassOf(reference) + row;
  if (isPitch(inSameOctave)) return inSameOctave;

  /* Past an end of the instrument: the same class, in the nearest octave that exists. */
  for (const shifted of [inSameOctave - MATRIX_ROWS, inSameOctave + MATRIX_ROWS]) {
    if (isPitch(shifted)) return shifted;
  }

  /*
   * Unreachable while the range spans more than an octave, and a clamp rather than a throw
   * because a NaN reaching the phrase would be a silent corruption rather than a visible fault.
   */
  return Math.min(TONE_MAX_MIDI, Math.max(TONE_MIN_MIDI, inSameOctave));
}

/**
 * What clicking a cell does, as a value rather than as an effect.
 *
 * Three cases, and the third is the one that matters: clicking an empty cell in a column that
 * already sounds *moves* the note there rather than refusing or stacking. One gesture, one Undo
 * entry, nothing to erase first.
 */
export function cellToggle(phrase: Phrase, row: number, step: number, workingPitch: number): number {
  const current = phrase[step] ?? REST;
  if (current !== REST && pitchClassOf(current) === row) return REST;
  return pitchForRow(row, current === REST ? workingPitch : current);
}

/**
 * The APL that turns `n` into the grid, as text.
 *
 * Shown in the Tones Peek, never executed — it is arithmetic over sixteen numbers and sending a
 * grid redraw to a remote interpreter would be absurd. Verified against real Dyalog by hand for
 * rests, for MIDI 48 and 84, for several octaves on one row, and for an ordinary phrase.
 *
 * `×[1]0<n` is the whole reason this is correct rather than nearly correct. Without it every rest
 * would light the C row, because `12|0` is 0.
 */
export function projectionSource(phrase: Phrase): readonly string[] {
  return ['⎕IO←0', `n←${phrase.map((value) => String(value)).join(' ')}`, 'M←((⍳12)∘.=12|n)×[1]0<n'];
}
