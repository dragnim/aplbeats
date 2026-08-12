/*
 * Variation: how much of a new idea to take.
 *
 * Deliberately separate from generation, because they answer different questions. The
 * generator says what a bar at these settings *would* be; this says how far to move
 * from the bar you already have towards it. Keeping the two apart is what stops
 * Randomise meaning "throw it away and start again" — which is the difference between a
 * button you press once and a button you keep pressing.
 *
 * The behaviour being aimed at:
 *
 *   0     the groove you have
 *   20    one or two things move; still plainly the same beat
 *   50    a remix of it — related, clearly changed
 *   100   a new groove
 *
 * Two mechanisms do that, and the second matters more than the first. Choosing *how
 * many* cells to take from the candidate gives a smooth dial. Choosing *which tracks
 * take anything at all* is what makes low settings feel musical: a bar where the hats
 * developed and nothing else did sounds like a decision, where a bar with one cell moved
 * on every track sounds like a fault.
 */

import { cellAt, setCell, STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import { streamFor } from './prng';
import { GENERATOR_VERSION } from './version';
import { macro, metricalStrength } from './weights';

export interface VariationOptions {
  readonly currentPattern: Pattern;
  readonly candidatePattern: Pattern;
  /** 0–100. How far to move towards the candidate. */
  readonly variation: number;
  /** The candidate's seed, so the blend is as reproducible as the candidate is. */
  readonly seed: number;
  readonly lockedTracks?: readonly boolean[] | undefined;
}

/**
 * The current pattern moved some of the way towards the candidate.
 *
 * At 100 the result is the candidate outright. At 0 it is the current pattern outright.
 * Everywhere between, a subset of the cells that differ are taken across — chosen with
 * a musical preference rather than uniformly, and concentrated on some tracks rather
 * than spread thinly over all eight.
 */
export function applyVariation({
  currentPattern,
  candidatePattern,
  variation,
  seed,
  lockedTracks,
}: VariationOptions): Pattern {
  const amount = macro(variation);
  const locked = lockedTracks ?? [];

  if (amount <= 0) return currentPattern;

  /*
   * The very top of the control takes the candidate outright.
   *
   * Handled here rather than falling out of the arithmetic below, and that is what makes
   * the arithmetic usable. Guaranteeing "Variation 100 means the new groove" from a
   * per-track roll forces the roll into a narrow band — and a narrow band stops
   * distinguishing *which* tracks move well before the middle of the control, which is
   * exactly where that distinction does the most work. Pinning the end frees the rest.
   */
  if (amount >= 0.98) {
    let whole = currentPattern;
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      if (locked[track] === true) continue;
      for (let step = 0; step < STEP_COUNT; step += 1) {
        whole = setCell(whole, track, step, cellAt(candidatePattern, track, step));
      }
    }
    return whole;
  }

  let result = currentPattern;
  let changes = 0;

  /*
   * The best change available on a track that was left alone.
   *
   * Kept so that a Randomise which happens to skip every track still does something. A
   * creative button that occasionally has no effect reads as broken however defensible
   * the arithmetic behind it.
   */
  const heldBack: Difference[] = [];

  for (let track = 0; track < TRACK_COUNT; track += 1) {
    if (locked[track] === true) continue;

    const differences = differingCells(currentPattern, candidatePattern, track);
    if (differences.length === 0) continue;

    const rng = streamFor(seed, GENERATOR_VERSION, 'variation', track);

    /*
     * Whether this track moves at all, and by how much.
     *
     * The roll is what spreads the change unevenly, and it is the reason low Variation
     * feels musical: a bar where the hats developed and nothing else did sounds like a
     * decision, where one cell moved on each of eight tracks sounds like a fault. At a
     * tenth of the control about a fifth of the tracks clear the threshold; by three
     * quarters, all of them do, and a growing share are replaced outright rather than
     * edited.
     */
    const intensity = amount * 1.3 - rng.next() * 0.85;
    if (intensity <= 0) {
      const best = chooseCells(differences, 1, rng.next())[0];
      if (best !== undefined) heldBack.push(best);
      continue;
    }

    // Near the top, take the row wholesale. A track that is nine tenths replaced sounds
    // worse than one replaced completely — the leftovers read as mistakes.
    if (intensity >= 0.92) {
      for (let step = 0; step < STEP_COUNT; step += 1) {
        result = setCell(result, track, step, cellAt(candidatePattern, track, step));
      }
      changes += differences.length;
      continue;
    }

    const wanted = Math.max(1, Math.round(differences.length * Math.min(1, intensity)));
    for (const cell of chooseCells(differences, wanted, rng.next())) {
      result = setCell(result, track, cell.step, cell.value);
      changes += 1;
    }
  }

  if (changes === 0) {
    const fallback = heldBack[0];
    if (fallback !== undefined) {
      result = setCell(result, fallback.track, fallback.step, fallback.value);
    }
  }

  return result;
}

interface Difference {
  readonly track: number;
  readonly step: number;
  readonly value: boolean;
  /** How much taking this one changes the character of the bar. */
  readonly salience: number;
}

/** The cells of one track where the two patterns disagree. */
function differingCells(current: Pattern, candidate: Pattern, track: number): Difference[] {
  const differences: Difference[] = [];

  for (let step = 0; step < STEP_COUNT; step += 1) {
    const wanted = cellAt(candidate, track, step);
    if (cellAt(current, track, step) === wanted) continue;

    /*
     * Weak positions first.
     *
     * A change on the downbeat is heard as a different beat; a change on the last
     * sixteenth is heard as the same beat, developing. Since low Variation is asking
     * for the second of those, the cells that alter the least are the ones to take
     * first — and the strong positions only start moving once there is a real budget.
     */
    differences.push({ track, step, value: wanted, salience: 1.05 - metricalStrength(step) });
  }

  return differences;
}

/**
 * `wanted` of the available changes, preferring the ones that disturb least.
 *
 * Ordered by salience — weak positions first — and then taken from a shortlist a little
 * longer than the number needed, rotated deterministically. The shortlist is what keeps
 * the preference intact: rotating over the whole list would sort the cells and then
 * ignore the sorting, and a low Variation that moved the downbeat would feel unreliable
 * in exactly the range that needs to feel gentle. Rotating within the shortlist is what
 * stops two presses at the same setting moving the same cell twice.
 */
function chooseCells(differences: Difference[], wanted: number, rotation: number): Difference[] {
  const ordered = [...differences].sort((a, b) => b.salience - a.salience || a.step - b.step);
  const take = Math.min(wanted, ordered.length);
  if (take >= ordered.length) return ordered;

  const shortlist = ordered.slice(0, Math.min(ordered.length, take + 2 + Math.ceil(take / 2)));
  const offset = Math.floor(rotation * shortlist.length) % shortlist.length;

  const chosen: Difference[] = [];
  for (let i = 0; i < take; i += 1) {
    const cell = shortlist[(offset + i) % shortlist.length];
    if (cell !== undefined) chosen.push(cell);
  }
  return chosen;
}
