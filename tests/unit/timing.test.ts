import { describe, expect, it } from 'vitest';
import {
  BEATS_PER_BAR,
  clampBpm,
  clampSwing,
  isSwungStep,
  MAX_BPM,
  MAX_SWING_FRACTION,
  MIN_BPM,
  secondsPerBar,
  secondsPerBeat,
  secondsPerStep,
  stepIndexInBar,
  STEPS_PER_BAR,
  STEPS_PER_BEAT,
  swingDelaySeconds,
} from '@/transport/timing';

describe('the grid', () => {
  it('is one bar of four-four in sixteenth notes', () => {
    expect(STEPS_PER_BAR).toBe(16);
    expect(STEPS_PER_BEAT).toBe(4);
    expect(BEATS_PER_BAR).toBe(4);
  });
});

describe('tempo', () => {
  it('is seconds per beat', () => {
    expect(secondsPerBeat(120)).toBe(0.5);
    expect(secondsPerBeat(60)).toBe(1);
    expect(secondsPerBeat(112)).toBeCloseTo(0.535_714_29, 8);
  });

  it('is a quarter of that per step', () => {
    expect(secondsPerStep(120)).toBe(0.125);
    expect(secondsPerStep(140)).toBeCloseTo(60 / 140 / 4, 12);
  });

  it('makes a bar four beats long', () => {
    expect(secondsPerBar(120)).toBe(2);
    expect(secondsPerBar(112)).toBeCloseTo(secondsPerBeat(112) * 4, 12);
  });

  it('is clamped to a range a slider can land on', () => {
    expect(clampBpm(30)).toBe(MIN_BPM);
    expect(clampBpm(400)).toBe(MAX_BPM);
    expect(clampBpm(112)).toBe(112);
  });

  it('never lets a division by zero or infinity through', () => {
    /*
     * The last line of defence. `secondsPerStep` is what the scheduler adds to its
     * clock, and an infinite step is a beat that never arrives — a hang rather than
     * a wrong note.
     */
    expect(clampBpm(0)).toBe(MIN_BPM);
    expect(clampBpm(Number.NaN)).toBe(MIN_BPM);
    expect(clampBpm(Number.POSITIVE_INFINITY)).toBe(MAX_BPM);
    expect(clampBpm(Number.NEGATIVE_INFINITY)).toBe(MIN_BPM);
    expect(Number.isFinite(secondsPerStep(0))).toBe(true);
    expect(secondsPerStep(Number.NaN)).toBeGreaterThan(0);
  });
});

describe('swing', () => {
  it('delays every other sixteenth and leaves the beats alone', () => {
    expect(isSwungStep(0)).toBe(false);
    expect(isSwungStep(1)).toBe(true);
    expect(isSwungStep(4)).toBe(false);
    expect(isSwungStep(15)).toBe(true);
    // Every step that falls on a beat is unswung, which is what keeps the pulse put.
    for (const beat of [0, 4, 8, 12]) expect(isSwungStep(beat)).toBe(false);
  });

  it('does nothing at zero', () => {
    for (let step = 0; step < 16; step += 1) {
      expect(swingDelaySeconds(step, 120, 0)).toBe(0);
    }
  });

  it('reaches half a step at full', () => {
    const step = secondsPerStep(120);
    expect(swingDelaySeconds(1, 120, 1)).toBeCloseTo(step * MAX_SWING_FRACTION, 12);
    expect(MAX_SWING_FRACTION).toBe(0.5);
  });

  it('divides a pair two to one at the classic triplet setting', () => {
    /*
     * Two-thirds of the way up the control is triplet swing: the late sixteenth
     * lands two-thirds of the way through the pair, which is the shuffle everything
     * from a blues to a garage record is built on. Worth pinning down, because it is
     * the one setting a musician will check by ear.
     */
    const step = secondsPerStep(120);
    const pair = step * 2;
    const late = step + swingDelaySeconds(1, 120, 2 / 3);
    expect(late / pair).toBeCloseTo(2 / 3, 6);
  });

  it('is clamped to nothing-to-everything', () => {
    expect(clampSwing(-1)).toBe(0);
    expect(clampSwing(2)).toBe(1);
    expect(clampSwing(Number.NaN)).toBe(0);
    expect(clampSwing(0.18)).toBe(0.18);
  });
});

describe('the shape of a swung bar', () => {
  it('leaves every beat where it was and pushes only the notes between them', () => {
    // Which is what makes swing swing rather than a tempo change: the pulse does not
    // move, and what falls between beats leans late against it.
    for (const beat of [0, 4, 8, 12, 16]) {
      expect(swingDelaySeconds(beat, 112, 1)).toBe(0);
    }
    for (const between of [1, 3, 5, 7, 9, 11, 13, 15]) {
      expect(swingDelaySeconds(between, 112, 1)).toBeGreaterThan(0);
    }
  });

  it('cannot lengthen the bar, because the first step of one is never swung', () => {
    /*
     * The property the whole design of swing hangs on, and the reason the delay is a
     * function of the step index rather than something added to a running total: were
     * it accumulated, the bar would grow a little on every pass and the tempo would
     * drift. That is the one fault in a drum machine that is almost impossible to hear
     * happening and trivial to assert about.
     *
     * `Scheduler.test.ts` asserts it again of the scheduler itself, over sixty-four
     * steps of real scheduling. This is the same fact about the arithmetic beneath it.
     */
    for (const swing of [0, 0.18, 0.5, 2 / 3, 1]) {
      expect(swingDelaySeconds(0, 112, swing)).toBe(0);
      expect(swingDelaySeconds(STEPS_PER_BAR, 112, swing)).toBe(0);
    }
  });

  it('is long-short between swung pairs, and the pair still adds up', () => {
    const step = secondsPerStep(120);
    const late = swingDelaySeconds(1, 120, 1);
    const long = step + late;
    const short = step - late;
    expect(long).toBeGreaterThan(short);
    expect(long + short).toBeCloseTo(step * 2, 12);
  });
});

describe('which column a step is', () => {
  it('wraps forwards at the end of the bar', () => {
    expect(stepIndexInBar(0)).toBe(0);
    expect(stepIndexInBar(15)).toBe(15);
    expect(stepIndexInBar(16)).toBe(0);
    expect(stepIndexInBar(20)).toBe(4);
  });

  it('wraps a negative index forwards too', () => {
    // Pausing rewinds by however many steps were handed over but not heard, and at
    // the top of the bar that arithmetic goes negative.
    expect(stepIndexInBar(-1)).toBe(15);
    expect(stepIndexInBar(-3)).toBe(13);
    expect(stepIndexInBar(-16)).toBe(0);
    expect(stepIndexInBar(-17)).toBe(15);
  });
});
