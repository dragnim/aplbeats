import { describe, expect, it } from 'vitest';
import {
  cellToggle,
  DEFAULT_WORKING_PITCH,
  MATRIX_ROWS,
  pitchForRow,
  octaveOf,
  phraseToMatrix,
  pitchClassOf,
  projectionSource,
  ROW_IS_BLACK,
  ROW_NAMES,
  type ToneMatrix,
} from '@/tones/matrix';
import {
  emptyPhrase,
  isPitch,
  noteName,
  openingPhrase,
  PHRASE_LENGTH,
  REST,
  setStep,
  TONE_MAX_MIDI,
  TONE_MIN_MIDI,
  type Phrase,
} from '@/tones/phrase';

/*
 * The grid as a projection of the vector.
 *
 * Everything here guards one idea: the twelve rows are *pitch classes*, so an octave is not a
 * position and the projection cannot be inverted. The tests that matter most are the ones about
 * rests, because `12|0` is 0 and a rest that is not masked lands silently on the C row — silently
 * being the operative word, since the phrase would still be right and only the picture wrong.
 */

/** Every lit cell, as [row, step], in reading order. */
function lit(matrix: ToneMatrix): [number, number][] {
  const found: [number, number][] = [];
  matrix.forEach((row, rowIndex) => {
    row.forEach((on, step) => {
      if (on) found.push([rowIndex, step]);
    });
  });
  return found.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

describe('the twelve rows', () => {
  it('is one row per pitch class, C at the bottom and B at the top', () => {
    expect(MATRIX_ROWS).toBe(12);
    expect(ROW_NAMES).toHaveLength(12);
    expect(ROW_NAMES[0]).toBe('C');
    expect(ROW_NAMES[11]).toBe('B');
    // Five black keys, in the places a keyboard puts them.
    expect(ROW_IS_BLACK.filter(Boolean)).toHaveLength(5);
    expect([1, 3, 6, 8, 10].every((row) => ROW_IS_BLACK[row] === true)).toBe(true);
  });

  it('puts every note the instrument can play on a row, with nothing left over', () => {
    /*
     * The reason there is no octave page and no thirteenth row. Thirty-seven semitones do not
     * divide by twelve, which would be a problem if the rows were an octave *window*; they are
     * pitch classes, so the question never arises.
     */
    for (let midi = TONE_MIN_MIDI; midi <= TONE_MAX_MIDI; midi += 1) {
      const row = pitchClassOf(midi);
      expect(row, String(midi)).toBeGreaterThanOrEqual(0);
      expect(row, String(midi)).toBeLessThan(MATRIX_ROWS);
    }
  });

  it('puts C3, C4, C5 and C6 on the same row', () => {
    expect([48, 60, 72, 84].map(pitchClassOf)).toEqual([0, 0, 0, 0]);
    // And tells them apart by the badge, which is the only place the octave lives.
    expect([48, 60, 72, 84].map(octaveOf)).toEqual([3, 4, 5, 6]);
  });

  it('agrees with the note names, so a badge and the editor row cannot disagree', () => {
    for (let midi = TONE_MIN_MIDI; midi <= TONE_MAX_MIDI; midi += 1) {
      expect(noteName(midi), String(midi)).toBe(
        `${String(ROW_NAMES[pitchClassOf(midi)])}${String(octaveOf(midi))}`,
      );
    }
  });
});

describe('drawing the grid', () => {
  it('is twelve rows of sixteen', () => {
    const matrix = phraseToMatrix(openingPhrase());
    expect(matrix).toHaveLength(MATRIX_ROWS);
    for (const row of matrix) expect(row).toHaveLength(PHRASE_LENGTH);
  });

  it('lights the opening phrase where the notes are', () => {
    // 60 C, 63 D♯, 67 G, 65 F, 63 D♯, 60 C — rows 0, 3, 7, 5, 3, 0.
    expect(lit(phraseToMatrix(openingPhrase()))).toEqual([
      [0, 0],
      [3, 3],
      [7, 5],
      [5, 8],
      [3, 11],
      [0, 13],
    ]);
  });

  it('leaves a rest column empty rather than lighting C', () => {
    /*
     * The one silent failure this whole module can have. `12|0` is 0, so any projection that does
     * not mask rests draws a C on every rest — sixteen columns of C for an empty phrase, and the
     * phrase itself perfectly correct all the while.
     */
    const matrix = phraseToMatrix(emptyPhrase());
    expect(lit(matrix)).toEqual([]);
    expect(matrix[0]?.some(Boolean)).toBe(false);
  });

  it('never lights two cells in one column, for any phrase', () => {
    // Inherited rather than enforced: a phrase holds one value per step.
    const phrases: Phrase[] = [
      openingPhrase(),
      emptyPhrase(),
      [48, 60, 72, 84, 49, 61, 73, 50, 62, 74, 51, 63, 75, 52, 64, 76],
      Array.from({ length: PHRASE_LENGTH }, (_, step) => (step % 3 === 0 ? REST : 48 + step)),
    ];

    for (const phrase of phrases) {
      const matrix = phraseToMatrix(phrase);
      for (let step = 0; step < PHRASE_LENGTH; step += 1) {
        const inColumn = matrix.filter((row) => row[step] === true).length;
        expect(inColumn, `step ${String(step)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('holds several octaves at once on one row', () => {
    const phrase = setStep(setStep(setStep(setStep(emptyPhrase(), 0, 48), 1, 60), 2, 72), 3, 84);
    expect(lit(phraseToMatrix(phrase))).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
  });

  it('draws every playable note somewhere, MIDI 48 to 84 included', () => {
    for (let midi = TONE_MIN_MIDI; midi <= TONE_MAX_MIDI; midi += 1) {
      const matrix = phraseToMatrix(setStep(emptyPhrase(), 4, midi));
      expect(lit(matrix), String(midi)).toEqual([[pitchClassOf(midi), 4]]);
    }
  });
});

describe('choosing which octave a click meant', () => {
  it('sounds where the row is: above the reference means above it', () => {
    /*
     * The rows are drawn as one octave, C along the bottom and B along the top, so a click has to
     * agree with the picture. Nearest-pitch would not: from C4 the G row is five rows up and would
     * give G3, five semitones down.
     */
    expect(pitchForRow(7, 60)).toBe(67);
    expect(pitchForRow(2, 60)).toBe(62);
    expect(pitchForRow(11, 60)).toBe(71);
  });

  it('sounds below the reference when the row is below it', () => {
    // From B4 at the top of the grid, the C row along the bottom is C4 — down eleven, as drawn.
    expect(pitchForRow(0, 71)).toBe(60);
    expect(pitchForRow(3, 71)).toBe(63);
  });

  it('stays put when the class is the one already there', () => {
    expect(pitchForRow(pitchClassOf(67), 67)).toBe(67);
  });

  it('never leaves the instrument', () => {
    for (let reference = TONE_MIN_MIDI; reference <= TONE_MAX_MIDI; reference += 1) {
      for (let row = 0; row < MATRIX_ROWS; row += 1) {
        const chosen = pitchForRow(row, reference);
        expect(isPitch(chosen), `${String(row)} from ${String(reference)}`).toBe(true);
        expect(pitchClassOf(chosen), `${String(row)} from ${String(reference)}`).toBe(row);
        // Within the reference's own octave, so never further than eleven semitones away.
        expect(Math.abs(chosen - reference)).toBeLessThanOrEqual(12);
      }
    }
  });

  it('reaches the very top and the very bottom of the range', () => {
    expect(pitchForRow(0, 84)).toBe(84);
    expect(pitchForRow(0, 80)).toBe(72);
    expect(pitchForRow(0, 48)).toBe(48);
    expect(pitchForRow(0, 50)).toBe(48);
  });

  it('drops an octave rather than refusing a click past the top', () => {
    // From C6 there is no B6 to reach, so the B row is B5. The alternative is a dead cell.
    expect(pitchForRow(11, 84)).toBe(83);
    expect(pitchForRow(7, 84)).toBe(79);
  });
});

describe('what a click does', () => {
  it('places a note in an empty column, in the octave the hand was in', () => {
    const phrase = emptyPhrase();
    expect(cellToggle(phrase, 7, 4, DEFAULT_WORKING_PITCH)).toBe(67);
  });

  it('clears the column when the lit cell is clicked', () => {
    const phrase = setStep(emptyPhrase(), 4, 67);
    expect(cellToggle(phrase, 7, 4, DEFAULT_WORKING_PITCH)).toBe(REST);
  });

  it('moves the note when another cell in the same column is clicked', () => {
    /*
     * The case that makes it feel like an instrument rather than a form. Nothing is erased first,
     * it is one value and therefore one Undo entry, and the note keeps its own octave as the
     * reference so it moves the short way.
     */
    const phrase = setStep(emptyPhrase(), 4, 67);
    expect(cellToggle(phrase, 5, 4, DEFAULT_WORKING_PITCH)).toBe(65);
    expect(cellToggle(phrase, 11, 4, DEFAULT_WORKING_PITCH)).toBe(71);
  });

  it('keeps the octave of the note it moves, not the working pitch', () => {
    // A note up at C6 moved to the B row becomes B5, not B4 near where somebody last clicked.
    const phrase = setStep(emptyPhrase(), 2, 84);
    expect(cellToggle(phrase, 11, 2, 60)).toBe(83);
  });

  it('round-trips: place then click the same cell again is where it started', () => {
    let phrase = emptyPhrase();
    for (let row = 0; row < MATRIX_ROWS; row += 1) {
      const placed = cellToggle(phrase, row, 6, DEFAULT_WORKING_PITCH);
      phrase = setStep(phrase, 6, placed);
      expect(phraseToMatrix(phrase)[row]?.[6]).toBe(true);

      const cleared = cellToggle(phrase, row, 6, DEFAULT_WORKING_PITCH);
      expect(cleared).toBe(REST);
      phrase = setStep(phrase, 6, cleared);
    }
  });
});

describe('the APL shown in Peek', () => {
  /*
   * Verified against real Dyalog by hand — three requests, none of them in CI and none at runtime.
   * The phrase used there is the one below: C3, C4, C5 and C6 on one row, two Bs an octave apart,
   * a black key, an ordinary middle note and seven rests. Dyalog produced exactly the eight lit
   * cells this projection produces, and lit nothing in any rest column.
   */
  const VERIFIED: Phrase = [48, 0, 60, 0, 72, 0, 84, 0, 61, 0, 63, 0, 0, 0, 59, 71];

  it('is the three statements, index origin first', () => {
    const source = projectionSource(openingPhrase());
    expect(source).toHaveLength(3);
    expect(source[0]).toBe('⎕IO←0');
    expect(source[1]).toBe('n←60 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0');
    expect(source[2]).toBe('M←((⍳12)∘.=12|n)×[1]0<n');
  });

  it('masks the rests, which is the whole difference between right and nearly right', () => {
    // If this ever loses `×[1]0<n`, every rest lights the C row and no test but this one notices.
    expect(projectionSource(emptyPhrase())[2]).toContain('×[1]0<n');
  });

  it('describes the same grid the interface draws', () => {
    /*
     * The claim the Peek makes, checked rather than asserted: the TypeScript projection and the
     * APL are the same function. Dyalog's answer for this phrase was rows 0 0 0 0 1 3 11 11 at
     * steps 0 2 4 6 8 10 14 15, and that is what `phraseToMatrix` produces.
     */
    expect(lit(phraseToMatrix(VERIFIED))).toEqual([
      [0, 0],
      [0, 2],
      [0, 4],
      [0, 6],
      [1, 8],
      [3, 10],
      [11, 14],
      [11, 15],
    ]);
    expect(projectionSource(VERIFIED)[1]).toBe(`n←${VERIFIED.join(' ')}`);
  });
});
