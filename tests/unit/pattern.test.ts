import { describe, expect, it } from 'vitest';
import {
  cellAt,
  countTriggers,
  createPattern,
  fromBits,
  isInBounds,
  setCell,
  STEP_COUNT,
  toBits,
  toggleCell,
  TRACK_COUNT,
} from '@/pattern/pattern';

describe('creating a pattern', () => {
  it('is eight tracks of sixteen steps', () => {
    const pattern = createPattern();
    expect(pattern).toHaveLength(8);
    expect(TRACK_COUNT).toBe(8);
    expect(STEP_COUNT).toBe(16);
    for (const row of pattern) expect(row).toHaveLength(16);
  });

  it('starts silent', () => {
    expect(countTriggers(createPattern())).toBe(0);
  });

  it('gives every track its own row', () => {
    // A pattern built by repeating one array would have all eight tracks fire at
    // once, which is the sort of thing that is obvious in the ear and invisible in
    // the code.
    const pattern = setCell(createPattern(), 0, 0, true);
    expect(cellAt(pattern, 0, 0)).toBe(true);
    expect(cellAt(pattern, 1, 0)).toBe(false);
    expect(countTriggers(pattern)).toBe(1);
  });
});

describe('bounds', () => {
  const pattern = createPattern();

  it('accepts every cell of the grid', () => {
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      for (let step = 0; step < STEP_COUNT; step += 1) {
        expect(isInBounds(pattern, track, step)).toBe(true);
      }
    }
  });

  it.each([
    ['a track past the end', 8, 0],
    ['a step past the end', 0, 16],
    ['a negative track', -1, 0],
    ['a negative step', 0, -1],
    ['a fractional step', 0, 4.5],
    ['not a number at all', 0, Number.NaN],
  ])('rejects %s', (_description, track, step) => {
    expect(isInBounds(pattern, track, step)).toBe(false);
  });

  it('reads an out-of-bounds cell as silent rather than throwing', () => {
    // Coordinates arrive from keyboard navigation, from hit-testing a grid that may
    // have reflowed mid-drag, and one day from APL. Reading past the edge should be
    // uneventful.
    expect(cellAt(pattern, 99, 99)).toBe(false);
    expect(cellAt(pattern, -1, 0)).toBe(false);
  });

  it('leaves the pattern alone when written out of bounds', () => {
    expect(setCell(pattern, 8, 0, true)).toBe(pattern);
    expect(setCell(pattern, 0, 16, true)).toBe(pattern);
    expect(toggleCell(pattern, -1, 0)).toBe(pattern);
  });
});

describe('toggling and setting', () => {
  it('turns a silent cell on and an active cell off', () => {
    const on = toggleCell(createPattern(), 2, 7);
    expect(cellAt(on, 2, 7)).toBe(true);
    expect(cellAt(toggleCell(on, 2, 7), 2, 7)).toBe(false);
  });

  it('changes nothing else', () => {
    const before = createPattern();
    const after = setCell(before, 3, 9, true);
    expect(countTriggers(after)).toBe(1);
    // Untouched rows keep their identity, so React re-renders only the row that moved.
    expect(after[0]).toBe(before[0]);
    expect(after[3]).not.toBe(before[3]);
  });

  it('never mutates what it was given', () => {
    const before = createPattern();
    setCell(before, 0, 0, true);
    expect(countTriggers(before)).toBe(0);
  });

  it('returns the same pattern when a write changes nothing', () => {
    // Which is what makes a no-op edit free: an unchanged reference is a re-render
    // React can skip, and a pointer drag over already-painted cells is all no-ops.
    const pattern = setCell(createPattern(), 1, 1, true);
    expect(setCell(pattern, 1, 1, true)).toBe(pattern);
    expect(setCell(createPattern(), 1, 1, false)).toEqual(createPattern());
  });

  it('is idempotent, which is what makes painting safe', () => {
    let pattern = createPattern();
    for (let pass = 0; pass < 5; pass += 1) pattern = setCell(pattern, 4, 4, true);
    expect(countTriggers(pattern)).toBe(1);
  });
});

describe('the numeric form APL will exchange', () => {
  it('writes ones and zeros of the declared shape', () => {
    const bits = toBits(setCell(createPattern(), 0, 0, true));
    expect(bits).toHaveLength(8);
    expect(bits[0]).toHaveLength(16);
    expect(bits[0]?.[0]).toBe(1);
    expect(bits[0]?.[1]).toBe(0);
  });

  it('round-trips a pattern unchanged', () => {
    let pattern = createPattern();
    pattern = setCell(pattern, 0, 0, true);
    pattern = setCell(pattern, 7, 15, true);
    pattern = setCell(pattern, 3, 8, true);
    expect(fromBits(toBits(pattern))).toEqual(pattern);
  });

  it('reads anything non-zero as a trigger', () => {
    const pattern = fromBits([[0, 1, 2, -1, 0.5]]);
    expect(pattern[0]?.slice(0, 5)).toEqual([false, true, true, true, true]);
  });

  it('lands on the standard shape whatever it is given', () => {
    /*
     * Forgiving on purpose. An array from outside — a stored pattern from an older
     * version, or one day an APL result — may be the wrong size, and arriving at
     * eight by sixteen is better than refusing to play.
     */
    const short = fromBits([[1, 1]]);
    expect(short).toHaveLength(8);
    expect(short[0]).toHaveLength(16);
    expect(short[0]?.[0]).toBe(true);
    expect(short[0]?.[2]).toBe(false);
    expect(short[7]?.every((cell) => !cell)).toBe(true);

    const long = fromBits(Array.from({ length: 12 }, () => Array.from({ length: 24 }, () => 1)));
    expect(long).toHaveLength(8);
    expect(long[0]).toHaveLength(16);
    expect(countTriggers(long)).toBe(128);
  });

  it('survives an empty array', () => {
    expect(countTriggers(fromBits([]))).toBe(0);
    expect(fromBits([])).toHaveLength(8);
  });
});
