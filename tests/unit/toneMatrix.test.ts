import { describe, expect, it } from 'vitest';
import {
  cellToggle,
  DEFAULT_WORKING_PITCH,
  MATRIX_ROWS,
  columnAt,
  paintValue,
  pitchForRow,
  rasteriseSegment,
  rowAt,
  strokeStep,
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

describe('painting a stroke', () => {
  /*
   * Drawing is not clicking repeatedly, and the difference is what these guard.
   *
   * A click toggles: press the note you are on and it goes away. A stroke paints: crossing a cell
   * that already holds the note it would place must do nothing, or a line would rub itself out the
   * moment a hand wobbled back along it.
   */
  it('paints where a click would toggle', () => {
    const phrase = setStep(emptyPhrase(), 4, 67);

    // The click on the lit cell clears it; the stroke crossing the same cell leaves it alone.
    expect(cellToggle(phrase, 7, 4, DEFAULT_WORKING_PITCH)).toBe(REST);
    expect(paintValue(phrase, 7, 4, DEFAULT_WORKING_PITCH)).toBe(67);
  });

  it('draws a rising line across four steps, in one octave', () => {
    // C, D, E, G at steps 1 to 4 — the example a stroke is supposed to make easy.
    let phrase = emptyPhrase();
    const anchor = DEFAULT_WORKING_PITCH;

    for (const [row, step] of [
      [0, 0],
      [2, 1],
      [4, 2],
      [7, 3],
    ] as const) {
      phrase = setStep(phrase, step, paintValue(phrase, row, step, anchor));
    }

    expect(phrase.slice(0, 4)).toEqual([60, 62, 64, 67]);
    // And nothing else was touched.
    expect(phrase.slice(4)).toEqual(emptyPhrase().slice(4));
  });

  it('keeps every empty column of a stroke in the octave the stroke began in', () => {
    /*
     * The anchor is frozen for the length of the stroke. Were it to follow the last note placed,
     * a line drawn from B down to C would put the C an octave below the B rather than the step
     * above it, and a long diagonal could wander an octave from where it started.
     */
    let phrase = emptyPhrase();
    const anchor = 60;

    for (const [row, step] of [
      [11, 0],
      [0, 1],
      [11, 2],
      [0, 3],
    ] as const) {
      phrase = setStep(phrase, step, paintValue(phrase, row, step, anchor));
    }

    expect(phrase.slice(0, 4)).toEqual([71, 60, 71, 60]);
  });

  it('keeps a column its own octave when the stroke crosses a note already there', () => {
    // A note up at C6 dragged to the B row becomes B5, not the B nearest the stroke's anchor.
    const phrase = setStep(emptyPhrase(), 2, 84);
    expect(paintValue(phrase, 11, 2, 60)).toBe(83);
  });

  it('replaces rather than stacks, because a column holds one note', () => {
    let phrase = setStep(emptyPhrase(), 6, 60);
    phrase = setStep(phrase, 6, paintValue(phrase, 7, 6, DEFAULT_WORKING_PITCH));

    expect(phrase[6]).toBe(67);
    // Still exactly one lit cell in that column.
    expect(phraseToMatrix(phrase).filter((row) => row[6] === true)).toHaveLength(1);
  });

  it('never leaves the instrument, wherever a stroke wanders', () => {
    for (const anchor of [TONE_MIN_MIDI, 60, TONE_MAX_MIDI]) {
      for (let row = 0; row < MATRIX_ROWS; row += 1) {
        const value = paintValue(emptyPhrase(), row, 0, anchor);
        expect(isPitch(value), `${String(row)} from ${String(anchor)}`).toBe(true);
        expect(pitchClassOf(value)).toBe(row);
      }
    }
  });

  it('is idempotent, so crossing a cell twice is the same as crossing it once', () => {
    // What lets the component skip a repeat rather than write and preview the same note again.
    let phrase = emptyPhrase();
    const once = paintValue(phrase, 5, 9, 60);
    phrase = setStep(phrase, 9, once);
    expect(paintValue(phrase, 5, 9, 60)).toBe(once);
  });
});

describe('rasterising a pointer stroke', () => {
  /*
   * A pencil over a quantised piano roll.
   *
   * The geometry is deliberately out here rather than inside the component, because this is where
   * the two failures both lived. Painting the cell under each raw pointer sample made smooth
   * diagonals land a semitone or two sharp; claiming each column on first entry fixed that and made
   * the gesture go dead under a hand that swept back over its own line. Neither is a matter of
   * opinion once the question is asked geometrically: where was the line when it was over this
   * column?
   */

  /** A grid whose numbers are easy to reason about: 40px columns, 20px rows, C along the bottom. */
  const grid = { leftEdge: 100, columnWidth: 40, bottomEdge: 500, rowHeight: 20 };

  /** The centre of a cell, in pointer coordinates. */
  const at = (row: number, step: number) => ({
    x: grid.leftEdge + (step + 0.5) * grid.columnWidth,
    y: grid.bottomEdge - (row + 0.5) * grid.rowHeight,
  });

  it('finds the column and row a point falls in', () => {
    expect(columnAt(at(0, 0).x, grid)).toBe(0);
    expect(columnAt(at(0, 15).x, grid)).toBe(15);
    expect(rowAt(at(0, 0).y, grid)).toBe(0);
    expect(rowAt(at(11, 0).y, grid)).toBe(11);
  });

  it('clamps rather than running off the end of the bar or the instrument', () => {
    // A hand that leaves the grid keeps drawing at the edge, which is what a piano roll does.
    expect(columnAt(-1000, grid)).toBe(0);
    expect(columnAt(100_000, grid)).toBe(15);
    expect(rowAt(100_000, grid)).toBe(0);
    expect(rowAt(-100_000, grid)).toBe(11);
  });

  it('resolves a horizontal sweep to one mark per column, all on the same row', () => {
    const marks = rasteriseSegment(at(4, 1), at(4, 5), grid);
    expect(marks.map((m) => m.step)).toEqual([1, 2, 3, 4, 5]);
    expect(marks.every((m) => m.row === 4)).toBe(true);
  });

  it('resolves a diagonal to the row the line is at over each column centre', () => {
    /*
     * The original production failure, as arithmetic. From the centre of C at step 1 to the centre
     * of G at step 4 the line rises seven rows over three columns, so at the centres of steps 2 and
     * 3 it stands 7/3 and 14/3 rows above where it began — and it began half a row up, at the
     * centre of row 0. So 0.5 + 2.33 lands in row 2 and 0.5 + 4.67 lands in row 5.
     *
     * That half-row is worth spelling out because the first version of this test forgot it and
     * asserted row 4. What matters is not the exact staircase but that every mark is the height of
     * the *line* over that column, never the height the pointer happened to be at when it left.
     */
    const marks = rasteriseSegment(at(0, 1), at(7, 4), grid);
    expect(marks).toEqual([
      { step: 1, row: 0 },
      { step: 2, row: 2 },
      { step: 3, row: 5 },
      { step: 4, row: 7 },
    ]);
  });

  it('keeps the column under the pointer live while the hand moves vertically', () => {
    /*
     * The failure the column-claiming version had. A purely vertical movement spans one column, and
     * that column has to answer with where the hand is *now* — otherwise a stroke stops responding
     * the moment it has visited somewhere.
     */
    const up = rasteriseSegment(at(2, 6), at(9, 6), grid);
    expect(up).toEqual([{ step: 6, row: 9 }]);

    const down = rasteriseSegment(at(9, 6), at(1, 6), grid);
    expect(down).toEqual([{ step: 6, row: 1 }]);
  });

  it('answers again for a column the stroke has already crossed', () => {
    // Out and back. Nothing is remembered, so the return journey resolves exactly as the first did.
    const out = rasteriseSegment(at(3, 2), at(3, 5), grid);
    const back = rasteriseSegment(at(8, 5), at(8, 2), grid);
    expect(out.map((m) => m.step)).toEqual([2, 3, 4, 5]);
    expect(back.map((m) => m.step)).toEqual([5, 4, 3, 2]);
    expect(back.every((m) => m.row === 8)).toBe(true);
  });

  it('runs in the direction of travel, so previews sound in the order they were drawn', () => {
    expect(rasteriseSegment(at(0, 1), at(0, 4), grid).map((m) => m.step)).toEqual([1, 2, 3, 4]);
    expect(rasteriseSegment(at(0, 4), at(0, 1), grid).map((m) => m.step)).toEqual([4, 3, 2, 1]);
  });

  it('keeps the shape of the line however finely the movement was sampled', () => {
    /*
     * Not "identical to one long segment", and the difference is the point.
     *
     * A finely sampled path reports the hand *inside* a column as well as crossing it, and the
     * column under the hand is supposed to follow — that is the whole of staying live. So a dense
     * path can leave a column a row further along than a single segment would, because the hand
     * really did move there before leaving.
     *
     * What must hold either way is the shape: a line that only rises produces marks that only
     * rise, every column is written once, and nothing overshoots the ends of the stroke.
     */
    const from = at(0, 1);
    const to = at(11, 9);

    const dense = new Map<number, number>();
    let previous = from;
    for (let sample = 1; sample <= 40; sample += 1) {
      const point = {
        x: from.x + ((to.x - from.x) * sample) / 40,
        y: from.y + ((to.y - from.y) * sample) / 40,
      };
      for (const mark of rasteriseSegment(previous, point, grid)) dense.set(mark.step, mark.row);
      previous = point;
    }

    const drawn = [...dense.entries()].sort((a, b) => a[0] - b[0]);
    expect(drawn.map(([step]) => step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const [step, row] of drawn) {
      expect(row, `step ${String(step)} is inside the stroke`).toBeGreaterThanOrEqual(0);
      expect(row, `step ${String(step)} does not overshoot`).toBeLessThanOrEqual(11);
    }
    for (let index = 1; index < drawn.length; index += 1) {
      expect(drawn[index]?.[1] ?? -1, 'the line only rises').toBeGreaterThanOrEqual(
        drawn[index - 1]?.[1] ?? -1,
      );
    }
    // The hand finishes on B at step 9, and that is where the last mark has to be.
    expect(dense.get(9)).toBe(11);
  });
});

describe('what a stroke does to one column', () => {
  it('says nothing to do when the answer is the note already there', () => {
    // The whole of the no-duplicate-preview rule: a hand held still resolves to null.
    expect(strokeStep(67, 7, 60, 'draw')).toBeNull();
    expect(strokeStep(REST, 0, 60, 'erase')).toBeNull();
  });

  it('places from the anchor in an empty column, and from the note in a full one', () => {
    expect(strokeStep(REST, 7, 60, 'draw')).toBe(67);
    // C6 moved to the B row keeps its own octave rather than taking the anchor's.
    expect(strokeStep(84, 11, 60, 'draw')).toBe(83);
  });

  it('erases a column that sounds, whatever row the stroke crossed it at', () => {
    expect(strokeStep(63, 0, 60, 'erase')).toBe(REST);
    expect(strokeStep(63, 9, 60, 'erase')).toBe(REST);
  });

  it('can be applied over and over without drifting', () => {
    // A stroke revisits columns freely, so the same question asked twice must answer the same way.
    const once = strokeStep(REST, 5, 60, 'draw');
    expect(once).toBe(65);
    expect(strokeStep(once ?? REST, 5, 60, 'draw')).toBeNull();
  });
});
