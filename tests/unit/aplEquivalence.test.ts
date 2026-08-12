import { describe, expect, it } from 'vitest';
import { operationById, resolveParameters, type Target } from '@/apl/operations';
import {
  applyReferenceTransform,
  euclideanVector,
  periodicVector,
  reverseVector,
  rotateVector,
} from '@/apl/reference';
import { euclideanPattern, rotate as rotateArray } from '@/generation/euclidean';
import { createInitialGroove } from '@/pattern/initialGroove';
import { cellAt, createPattern, setCell, STEP_COUNT, TRACK_COUNT } from '@/pattern/pattern';

/*
 * What the APL means.
 *
 * These assert the *semantics* of each expression against a second implementation, which is a
 * far better test than a fixture nobody can check by eye: `¯3⌽v` either moves a rhythm three
 * steps later or it does not.
 *
 * The reference implementations are never used in production — a separate test forbids any
 * module under `src/` from importing them — so their only job is to say what the expressions
 * are supposed to do. The live verification script then confirms that real APL agrees, which is
 * what makes this file evidence rather than a tautology.
 */

const GROOVE = createInitialGroove();

/** Which steps a row fires on, for readable assertions. */
function stepsOf(row: readonly boolean[]): number[] {
  const steps: number[] = [];
  row.forEach((on, index) => {
    if (on) steps.push(index);
  });
  return steps;
}

describe('rotate', () => {
  it('moves a rhythm later for a negative amount', () => {
    /*
     * The direction that matters musically, and the one confirmed against the live service: the
     * opening kick fires on 0, 6, 10 and 14, and `¯1⌽` moved it to 1, 7, 11 and 15.
     */
    const kick = GROOVE[0]!;
    expect(stepsOf(kick)).toEqual([0, 6, 10, 14]);
    expect(stepsOf(rotateVector(kick, -1))).toEqual([1, 7, 11, 15]);
  });

  it('moves a rhythm earlier for a positive amount', () => {
    expect(stepsOf(rotateVector(GROOVE[0]!, 2))).toEqual([4, 8, 12, 14]);
  });

  it('wraps round the bar', () => {
    const single = setCell(createPattern(), 0, 0, true)[0]!;
    expect(stepsOf(rotateVector(single, 1))).toEqual([15]);
    expect(stepsOf(rotateVector(single, -1))).toEqual([1]);
  });

  it('returns to where it started after a full cycle', () => {
    expect(rotateVector(GROOVE[2]!, STEP_COUNT)).toEqual([...GROOVE[2]!]);
    expect(rotateVector(GROOVE[2]!, -STEP_COUNT)).toEqual([...GROOVE[2]!]);
  });

  it('rotates only the targeted row', () => {
    const result = applyReferenceTransform(operationById('rotate'), 3, { amount: -2 }, GROOVE);
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      if (track === 3) expect(result[track]).not.toEqual([...GROOVE[track]!]);
      else expect(result[track]).toEqual([...GROOVE[track]!]);
    }
  });

  it('rotates every row by the same amount for the whole matrix', () => {
    const result = applyReferenceTransform(operationById('rotate'), 'all', { amount: -1 }, GROOVE);
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      expect(result[track]).toEqual(rotateVector(GROOVE[track]!, -1));
    }
  });
});

describe('reverse', () => {
  it('turns the last sixteenth into the first', () => {
    const clap = GROOVE[4]!;
    expect(stepsOf(clap)).toEqual([4, 12, 15]);
    expect(stepsOf(reverseVector(clap))).toEqual([0, 3, 11]);
  });

  it('is its own inverse', () => {
    expect(reverseVector(reverseVector(GROOVE[2]!))).toEqual([...GROOVE[2]!]);
  });

  it('leaves a palindrome alone', () => {
    // Which is also why applying Reverse to one can produce no Undo entry: nothing changed.
    const palindrome = [true, false, true, true, false, true].concat(Array.from({ length: 10 }, () => false));
    const symmetric = [...palindrome.slice(0, 8), ...[...palindrome.slice(0, 8)].reverse()];
    expect(reverseVector(reverseVector(symmetric))).toEqual(symmetric);
  });
});

describe('periodic', () => {
  it('fires on every step divisible by the period, starting from the downbeat', () => {
    // Which is what ⎕IO←0 buys: `0=4|⍳16` counts 0, 4, 8, 12 rather than 1, 5, 9, 13.
    expect(stepsOf(periodicVector(4))).toEqual([0, 4, 8, 12]);
    expect(stepsOf(periodicVector(2))).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(stepsOf(periodicVector(3))).toEqual([0, 3, 6, 9, 12, 15]);
    expect(stepsOf(periodicVector(8))).toEqual([0, 8]);
  });

  it('replaces the target row outright', () => {
    const result = applyReferenceTransform(operationById('periodic'), 6, { period: 4 }, GROOVE);
    expect(stepsOf(result[6]!)).toEqual([0, 4, 8, 12]);
    // And nothing else moves.
    expect(result[5]).toEqual([...GROOVE[5]!]);
  });

  it('takes a rotation, which shifts the whole pulse', () => {
    const result = applyReferenceTransform(operationById('periodic'), 6, { period: 4, rotation: 2 }, GROOVE);
    // `2⌽0=4|⍳16` moves the pulse two steps earlier, wrapping.
    expect(stepsOf(result[6]!)).toEqual([2, 6, 10, 14]);
  });
});

describe('euclidean', () => {
  it('always begins on the downbeat', () => {
    // Musically valuable and not true of every Bjorklund phase: a rhythm that starts on the
    // beat sits under a groove immediately.
    for (let pulses = 1; pulses <= STEP_COUNT; pulses += 1) {
      expect(euclideanVector(pulses)[0], `k=${String(pulses)}`).toBe(true);
    }
  });

  it('places exactly the number of hits asked for', () => {
    for (let pulses = 0; pulses <= STEP_COUNT; pulses += 1) {
      expect(euclideanVector(pulses).filter(Boolean)).toHaveLength(pulses);
    }
  });

  it('uses at most two distinct gap lengths, differing by one', () => {
    /*
     * The defining property of a maximally even — that is, genuinely Euclidean — rhythm, and the
     * real reason the expression is acceptable rather than merely concise. E(5,16) comes out as
     * gaps of 4,3,3,3,3; E(7,16) as 3,2,2,3,2,2,2. Never three sizes, never a difference of two.
     */
    for (let pulses = 2; pulses <= STEP_COUNT - 1; pulses += 1) {
      const steps = stepsOf(euclideanVector(pulses));
      const gaps = steps.map((step, index) =>
        index === steps.length - 1 ? STEP_COUNT - step + (steps[0] ?? 0) : (steps[index + 1] ?? 0) - step,
      );
      const distinct = [...new Set(gaps)].sort((a, b) => a - b);

      expect(distinct.length, `k=${String(pulses)} gaps ${gaps.join(',')}`).toBeLessThanOrEqual(2);
      if (distinct.length === 2) {
        expect((distinct[1] ?? 0) - (distinct[0] ?? 0), `k=${String(pulses)}`).toBe(1);
      }
    }
  });

  it('is Bjorklund up to a rotation, for every pulse count', () => {
    /*
     * The equivalence the brief asked to be established rather than assumed.
     *
     * `k>16|k×⍳16` is not always *identical* to the Stage 2 Bjorklund implementation: eleven of
     * the seventeen pulse counts match exactly, and the other six are the same rhythm at a
     * different rotation. Both are Euclidean; they differ only in which of the rhythm's rotations
     * is called the first. Recorded here so the relationship is a tested fact rather than a note
     * in a commit message.
     */
    const offsets = new Map<number, number>();

    for (let pulses = 0; pulses <= STEP_COUNT; pulses += 1) {
      const formula = euclideanVector(pulses);
      const bjorklund = euclideanPattern(pulses, STEP_COUNT);

      let found: number | null = null;
      for (let by = 0; by < STEP_COUNT; by += 1) {
        if (rotateArray(bjorklund, by).every((cell, index) => cell === formula[index])) {
          found = by;
          break;
        }
      }

      expect(found, `k=${String(pulses)} is not a rotation of Bjorklund`).not.toBeNull();
      if (found !== null) offsets.set(pulses, found);
    }

    // Eleven identical, six rotated. If a future change to either implementation alters that
    // split, this is where it will be noticed.
    const identical = [...offsets.entries()].filter(([, by]) => by === 0).map(([k]) => k);
    expect(identical).toEqual([0, 1, 2, 4, 7, 8, 11, 12, 13, 14, 16]);
  });

  it('keeps that relationship when a rotation is applied to either form', () => {
    // So the Shift control behaves identically whichever formulation is used underneath.
    for (let pulses = 1; pulses <= STEP_COUNT; pulses += 1) {
      const bjorklund = euclideanPattern(pulses, STEP_COUNT);
      let offset = 0;
      for (let by = 0; by < STEP_COUNT; by += 1) {
        if (rotateArray(bjorklund, by).every((cell, index) => cell === euclideanVector(pulses)[index])) {
          offset = by;
          break;
        }
      }

      for (let shift = 0; shift < STEP_COUNT; shift += 1) {
        expect(
          rotateVector(euclideanVector(pulses), shift),
          `k=${String(pulses)} shift=${String(shift)}`,
        ).toEqual(rotateArray(bjorklund, offset + shift).map((cell) => cell === true));
      }
    }
  });

  it('replaces only the target row', () => {
    const result = applyReferenceTransform(operationById('euclidean'), 5, { pulses: 5 }, GROOVE);
    expect(stepsOf(result[5]!)).toEqual([0, 4, 7, 10, 13]);
    expect(result[4]).toEqual([...GROOVE[4]!]);
  });
});

describe('every operation', () => {
  const operations = ['rotate', 'reverse', 'periodic', 'euclidean'] as const;

  it('returns an 8 × 16 matrix of Booleans', () => {
    for (const id of operations) {
      const operation = operationById(id);
      const target: Target = operation.allowsAllTracks ? 'all' : 3;
      const result = applyReferenceTransform(operation, target, {}, GROOVE);

      expect(result, id).toHaveLength(TRACK_COUNT);
      for (const row of result) {
        expect(row, id).toHaveLength(STEP_COUNT);
        for (const cell of row) expect(typeof cell, id).toBe('boolean');
      }
    }
  });

  it('never mutates the pattern it was given', () => {
    const before = JSON.stringify(GROOVE);
    for (const id of operations) {
      const operation = operationById(id);
      const target: Target = 2;
      applyReferenceTransform(operation, target, {}, GROOVE);
    }
    expect(JSON.stringify(GROOVE)).toBe(before);
  });

  it('resolves its parameters the same way the source builder does', () => {
    // So a test asserting the reference is also asserting the expression, rather than two
    // things that merely happen to agree at the default values.
    for (const id of operations) {
      const operation = operationById(id);
      const resolved = resolveParameters(operation, { amount: 999, period: 999, pulses: 999, rotation: 999 });
      for (const spec of operation.parameters) {
        expect(resolved[spec.key], `${id}.${spec.key}`).toBe(spec.max);
      }
    }
  });

  it('leaves a locked track transformable, because a lock is about the generator', () => {
    /*
     * Locks are deliberately not consulted by a transform. A lock means the *generator* may not
     * touch a row; asking APL to reverse a particular track is an explicit instruction, like
     * clicking a cell — and a control that silently refused would be a control that appeared
     * broken.
     */
    const result = applyReferenceTransform(operationById('reverse'), 0, {}, GROOVE);
    expect(cellAt(result, 0, 0)).toBe(cellAt(GROOVE, 0, 15));
  });
});
