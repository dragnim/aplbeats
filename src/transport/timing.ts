/*
 * The arithmetic of the beat.
 *
 * Every one of these is a pure function of numbers, with no clock, no audio
 * context and no state, which is deliberate: musical timing is the part of a drum
 * machine that is hardest to check by ear and easiest to check by test. The
 * scheduler in `scheduler.ts` owns the when; this file owns the how long.
 *
 * The grid is one bar of four-four divided into sixteen sixteenth notes, so a
 * step is a sixteenth and four steps make a beat.
 */

import { STEP_COUNT } from '@/pattern/pattern';

export const STEPS_PER_BAR = STEP_COUNT;
export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = STEPS_PER_BAR / STEPS_PER_BEAT;

/*
 * The tempo range.
 *
 * Wide enough for half-speed dub and for drum and bass, narrow enough that a
 * dragged slider still lands where it was aimed. Both ends are also a guard: the
 * scheduler divides by the tempo, so zero and infinity must never reach it.
 */
export const MIN_BPM = 60;
export const MAX_BPM = 200;
export const BPM_STEP = 1;

/**
 * How far a swung step can be pushed, as a fraction of one step.
 *
 * Swing here delays every other sixteenth. At 0 the grid is straight. At 1 the
 * delay is half a step, which puts the late sixteenth two-thirds of the way
 * through the pair — a hard, dotted shuffle. Two-thirds of the way up the control,
 * around 67%, is the classic triplet swing, where the pair divides 2:1.
 *
 * Half a step is the ceiling on purpose. Beyond it a swung step would arrive
 * closer to the following pair than to its own, which stops sounding like swing
 * and starts sounding like a mistake.
 */
export const MAX_SWING_FRACTION = 0.5;

/**
 * `bpm` brought inside the usable range.
 *
 * Only `NaN` is special-cased, and it becomes the slowest tempo. The infinities are
 * left to `Math.min`/`Math.max`, which clamp them to the end they came from — the
 * answer anyone would expect, and the one that keeps this a clamp rather than a
 * clamp with a surprise in it.
 */
export function clampBpm(bpm: number): number {
  if (Number.isNaN(bpm)) return MIN_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

/** `swing` brought inside 0 to 1, with `NaN` read as straight. */
export function clampSwing(swing: number): number {
  if (Number.isNaN(swing)) return 0;
  return Math.min(1, Math.max(0, swing));
}

/** Seconds per quarter note. */
export function secondsPerBeat(bpm: number): number {
  return 60 / clampBpm(bpm);
}

/** Seconds per sixteenth note, which is one column of the grid. */
export function secondsPerStep(bpm: number): number {
  return secondsPerBeat(bpm) / STEPS_PER_BEAT;
}

/** Seconds for one pass of the whole sixteen-step bar. */
export function secondsPerBar(bpm: number): number {
  return secondsPerStep(bpm) * STEPS_PER_BAR;
}

/**
 * Whether a step is one of the ones swing delays.
 *
 * The odd-numbered steps counting from zero: the second and fourth sixteenth of
 * every beat. Leaving the even ones alone is what keeps the beat itself in place
 * while the notes between them lean late.
 */
export function isSwungStep(stepIndex: number): boolean {
  return Math.abs(stepIndex) % 2 === 1;
}

/**
 * How late a step arrives, in seconds.
 *
 * Applied to the step's position on the straight grid rather than added to a
 * running total, which is the whole reason this is a function of the index. Swing
 * that accumulated would drift the bar longer with every pass.
 */
export function swingDelaySeconds(stepIndex: number, bpm: number, swing: number): number {
  if (!isSwungStep(stepIndex)) return 0;
  return clampSwing(swing) * MAX_SWING_FRACTION * secondsPerStep(bpm);
}

/** Which column of the grid step `stepIndex` lands on, wrapping negative indices forwards. */
export function stepIndexInBar(stepIndex: number): number {
  return ((stepIndex % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
}
