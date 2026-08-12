import { describe, expect, it } from 'vitest';
import { generatePattern } from '@/generation/generator';
import { applyVariation } from '@/generation/mutate';
import { changedTracks, patternDistance } from '@/generation/metrics';
import { cellAt, STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';

/*
 * Variation: how far Randomise moves.
 *
 * The behaviour being aimed at is a feel rather than an equation — nought is almost
 * unchanged, twenty is a small evolution, fifty a recognisable remix, a hundred a new
 * groove — so these tests assert the ordering and the ends, not particular distances. What
 * must never break is the monotonic relationship: more Variation must mean more change,
 * and locked tracks must be untouched at every setting.
 */

const CURRENT = generatePattern({
  seed: 1234,
  preset: 'straight',
  density: 60,
  complexity: 45,
  syncopation: 30,
});

/** A candidate from a different seed, which is what Randomise supplies. */
function candidateFor(seed: number): Pattern {
  return generatePattern({ seed, preset: 'straight', density: 60, complexity: 45, syncopation: 30 });
}

/** Mean distance moved at this Variation, over many candidates. */
function meanDistance(variation: number, locks?: readonly boolean[]): number {
  const seeds = Array.from({ length: 40 }, (_unused, index) => 5000 + index * 3571);
  const total = seeds.reduce((sum, seed) => {
    const result = applyVariation({
      currentPattern: CURRENT,
      candidatePattern: candidateFor(seed),
      variation,
      seed,
      ...(locks === undefined ? {} : { lockedTracks: locks }),
    });
    return sum + patternDistance(CURRENT, result);
  }, 0);
  return total / seeds.length;
}

describe('the ends of the control', () => {
  it('changes nothing at zero', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const result = applyVariation({
        currentPattern: CURRENT,
        candidatePattern: candidateFor(seed * 977),
        variation: 0,
        seed,
      });
      expect(result).toBe(CURRENT);
    }
  });

  it('takes the candidate outright at a hundred', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const candidate = candidateFor(seed * 977);
      const result = applyVariation({
        currentPattern: CURRENT,
        candidatePattern: candidate,
        variation: 100,
        seed,
      });
      expect(result).toEqual(candidate);
    }
  });
});

describe('how far it moves', () => {
  it('moves further the higher it is set', () => {
    const distances = [10, 25, 45, 65, 85, 100].map((variation) => meanDistance(variation));
    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i], `variation step ${String(i)}`).toBeGreaterThan(distances[i - 1] ?? 0);
    }
  });

  it('barely moves at the bottom and substantially at the top', () => {
    /*
     * The behavioural targets, as loose bounds. Low Variation should be a nudge — a couple
     * of cells in a hundred and twenty-eight — and high Variation should be most of the
     * unlocked kit. Anything between is a matter of feel and is not asserted.
     */
    expect(meanDistance(10)).toBeLessThan(0.04);
    expect(meanDistance(100)).toBeGreaterThan(0.15);
  });

  it('always does something above zero', () => {
    /*
     * A creative button that occasionally has no effect reads as broken however defensible
     * the arithmetic. If every track happens to fall below its threshold, one change is
     * taken anyway.
     */
    for (let seed = 1; seed <= 60; seed += 1) {
      const candidate = candidateFor(seed * 5171);
      if (patternDistance(CURRENT, candidate) === 0) continue;

      const result = applyVariation({
        currentPattern: CURRENT,
        candidatePattern: candidate,
        variation: 5,
        seed,
      });
      expect(patternDistance(CURRENT, result), `seed ${String(seed)} did nothing`).toBeGreaterThan(0);
    }
  });

  it('spreads the change over more tracks as it rises', () => {
    /*
     * The mechanism that makes low settings feel musical. A bar where the hats developed and
     * nothing else did sounds like a decision; a bar with one cell moved on every one of
     * eight tracks sounds like a fault.
     */
    const tracksTouched = (variation: number): number => {
      const seeds = Array.from({ length: 30 }, (_unused, index) => 700 + index * 4099);
      const total = seeds.reduce((sum, seed) => {
        const result = applyVariation({
          currentPattern: CURRENT,
          candidatePattern: candidateFor(seed),
          variation,
          seed,
        });
        return sum + changedTracks(CURRENT, result).length;
      }, 0);
      return total / seeds.length;
    };

    expect(tracksTouched(15)).toBeLessThan(tracksTouched(50));
    expect(tracksTouched(50)).toBeLessThan(tracksTouched(95));
    expect(tracksTouched(15)).toBeLessThan(3);
  });

  it('prefers the weak positions when it has only a little budget', () => {
    /*
     * A change on the downbeat is heard as a different beat; a change on the last sixteenth
     * is heard as the same beat, developing. Since low Variation is asking for the second of
     * those, the cells that alter least are taken first.
     */
    let onBeat = 0;
    let offBeat = 0;

    for (let seed = 1; seed <= 120; seed += 1) {
      const candidate = candidateFor(seed * 2311);
      const result = applyVariation({
        currentPattern: CURRENT,
        candidatePattern: candidate,
        variation: 12,
        seed,
      });

      for (let track = 0; track < TRACK_COUNT; track += 1) {
        for (let step = 0; step < STEP_COUNT; step += 1) {
          if (cellAt(CURRENT, track, step) === cellAt(result, track, step)) continue;
          if (step % 4 === 0) onBeat += 1;
          else offBeat += 1;
        }
      }
    }

    expect(offBeat).toBeGreaterThan(onBeat * 2);
  });
});

describe('determinism', () => {
  it('blends the same way for the same inputs', () => {
    const candidate = candidateFor(9090);
    const once = applyVariation({
      currentPattern: CURRENT,
      candidatePattern: candidate,
      variation: 45,
      seed: 9090,
    });
    const twice = applyVariation({
      currentPattern: CURRENT,
      candidatePattern: candidate,
      variation: 45,
      seed: 9090,
    });
    expect(twice).toEqual(once);
  });
});

describe('locks', () => {
  const locks = [true, false, false, true, false, false, false, false];

  it('leave locked rows untouched at every setting', () => {
    for (const variation of [5, 20, 40, 60, 80, 100]) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const result = applyVariation({
          currentPattern: CURRENT,
          candidatePattern: candidateFor(seed * 811),
          variation,
          seed,
          lockedTracks: locks,
        });

        locks.forEach((isLocked, track) => {
          if (!isLocked) return;
          for (let step = 0; step < STEP_COUNT; step += 1) {
            expect(
              cellAt(result, track, step),
              `variation ${String(variation)} seed ${String(seed)} track ${String(track)}`,
            ).toBe(cellAt(CURRENT, track, step));
          }
        });
      }
    }
  });

  it('still move the unlocked rows at full', () => {
    expect(meanDistance(100, locks)).toBeGreaterThan(0.1);
  });
});
