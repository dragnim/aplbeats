/*
 * Measuring a pattern.
 *
 * None of this is a judgement about whether a groove is any good — no number can be —
 * and there is deliberately no "quality score" here. What these do is make a bar
 * *comparable*, which is what both the review tooling and the statistical tests need:
 * whether raising Density really added events, whether raising Syncopation really moved
 * them off the beat, whether a preset has quietly collapsed into producing the same
 * thing for every seed.
 *
 * Everything here is a plain count or ratio over the Boolean matrix. Pure, cheap, and
 * with no opinions.
 */

import { cellAt, countTriggers, STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import { TRACKS } from '@/pattern/tracks';
import { metricalStrength, positionClass } from './weights';

export interface PatternMetrics {
  /** Events in the whole bar. */
  readonly triggers: number;
  /** Events per track, in row order. */
  readonly perTrack: readonly number[];
  /** Events on the four beats. */
  readonly onBeat: number;
  /** Events on the offbeat eighths. */
  readonly offbeat: number;
  /** Events on the remaining sixteenths. */
  readonly sixteenth: number;
  /**
   * The share of events falling somewhere other than a beat, 0 to 1.
   *
   * The headline number for Syncopation: it should rise as the control does. Zero for
   * an empty bar rather than undefined, so a sample can be averaged without special
   * cases.
   */
  readonly offbeatShare: number;
  /**
   * Mean metrical strength of the occupied positions, 0 to 1.
   *
   * A second, finer view of the same thing. `offbeatShare` counts positions in three
   * buckets; this weights every one of them, so it moves even when events shuffle
   * between two kinds of weak position.
   */
  readonly meanStrength: number;
  /** Steps where more than one track fires. */
  readonly stackedSteps: number;
  /** The most tracks firing on any one step. */
  readonly maxStack: number;
  /** Steps with nothing at all. */
  readonly emptySteps: number;
  /**
   * How much the bar repeats itself, 0 to 1.
   *
   * The headline number for Complexity, and it should *fall* as the control rises. One
   * means every quarter of the bar is identical on every track; zero means no repetition
   * at either period.
   */
  readonly selfSimilarity: number;
}

/** Everything measurable about a bar. */
export function measurePattern(pattern: Pattern): PatternMetrics {
  const perTrack: number[] = [];
  let onBeat = 0;
  let offbeat = 0;
  let sixteenth = 0;
  let strengthTotal = 0;

  for (let track = 0; track < TRACK_COUNT; track += 1) {
    let count = 0;
    for (let step = 0; step < STEP_COUNT; step += 1) {
      if (!cellAt(pattern, track, step)) continue;
      count += 1;
      strengthTotal += metricalStrength(step);

      switch (positionClass(step)) {
        case 'beat':
          onBeat += 1;
          break;
        case 'offbeat':
          offbeat += 1;
          break;
        case 'sixteenth':
          sixteenth += 1;
          break;
      }
    }
    perTrack.push(count);
  }

  const triggers = onBeat + offbeat + sixteenth;

  let stackedSteps = 0;
  let maxStack = 0;
  let emptySteps = 0;
  for (let step = 0; step < STEP_COUNT; step += 1) {
    let stack = 0;
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      if (cellAt(pattern, track, step)) stack += 1;
    }
    if (stack === 0) emptySteps += 1;
    if (stack > 1) stackedSteps += 1;
    if (stack > maxStack) maxStack = stack;
  }

  return {
    triggers,
    perTrack,
    onBeat,
    offbeat,
    sixteenth,
    offbeatShare: triggers === 0 ? 0 : (offbeat + sixteenth) / triggers,
    meanStrength: triggers === 0 ? 0 : strengthTotal / triggers,
    stackedSteps,
    maxStack,
    emptySteps,
    selfSimilarity: selfSimilarityOf(pattern),
  };
}

/**
 * How much the bar is made of a repeated figure.
 *
 * Measured at both useful periods and combined: quarter-bar repetition counts for more
 * than half-bar repetition, because it is far more audible. A pattern that repeats every
 * four steps *also* repeats every eight, so the two are not independent — which is fine,
 * since what is wanted is one number that falls as a bar becomes less predictable.
 */
export function selfSimilarityOf(pattern: Pattern): number {
  const quarter = agreementAtPeriod(pattern, 4);
  const half = agreementAtPeriod(pattern, 8);
  return 0.65 * quarter + 0.35 * half;
}

/**
 * How alike the repetitions of a period are, over the events only.
 *
 * Measured as the overlap of the event sets rather than the agreement of all cells,
 * which sounds like a detail and is not. Most of a drum matrix is empty, so counting
 * every cell means counting mostly silence agreeing with silence: the first version of
 * this returned 0.88 for a bar that repeated every four steps and 0.75 for one that
 * never repeated at all, which is not a measurement, it is a constant with a wobble.
 *
 * Comparing the events gives the full range. Tracks with nothing on them are skipped
 * rather than counted as perfectly self-similar, for the same reason.
 */
function agreementAtPeriod(pattern: Pattern, period: number): number {
  let weightedOverlap = 0;
  let totalWeight = 0;

  for (let track = 0; track < TRACK_COUNT; track += 1) {
    let shared = 0;
    let union = 0;

    for (let step = 0; step < STEP_COUNT; step += 1) {
      const here = cellAt(pattern, track, step);
      const there = cellAt(pattern, track, (step + period) % STEP_COUNT);
      if (here || there) union += 1;
      if (here && there) shared += 1;
    }

    if (union === 0) continue;

    /*
     * Weighted by how much the track has to say.
     *
     * A hat playing nine events that repeat every beat is what makes a bar sound
     * regular; a rim playing one event cannot be self-similar at all, and averaging the
     * two equally buried the hats under tracks that had no opportunity to repeat. The
     * unweighted version reported 0.21 for Straight and 0.19 for Glitch, which is to say
     * it could not tell them apart.
     */
    weightedOverlap += (shared / union) * union;
    totalWeight += union;
  }

  return totalWeight === 0 ? 0 : weightedOverlap / totalWeight;
}

/**
 * How different two patterns are, as a share of all 128 cells.
 *
 * What Variation is measured with: zero means identical, one means every cell differs.
 * A whole-pattern figure rather than a per-track one, because Variation's job is to
 * control the distance between two bars.
 */
export function patternDistance(a: Pattern, b: Pattern): number {
  let differing = 0;
  for (let track = 0; track < TRACK_COUNT; track += 1) {
    for (let step = 0; step < STEP_COUNT; step += 1) {
      if (cellAt(a, track, step) !== cellAt(b, track, step)) differing += 1;
    }
  }
  return differing / (TRACK_COUNT * STEP_COUNT);
}

/** Which tracks differ at all between two patterns. */
export function changedTracks(a: Pattern, b: Pattern): number[] {
  const changed: number[] = [];
  for (let track = 0; track < TRACK_COUNT; track += 1) {
    for (let step = 0; step < STEP_COUNT; step += 1) {
      if (cellAt(a, track, step) !== cellAt(b, track, step)) {
        changed.push(track);
        break;
      }
    }
  }
  return changed;
}

/**
 * A bar as one line of text per track, for reading in a terminal.
 *
 * Grouped in fours because that is how a bar is counted, and using a block rather than a
 * letter because at a glance the shape of a rhythm is what you want to see, not its
 * spelling.
 */
export function renderPattern(pattern: Pattern): string[] {
  return TRACKS.map((track, index) => {
    let row = '';
    for (let step = 0; step < STEP_COUNT; step += 1) {
      if (step > 0 && step % 4 === 0) row += ' ';
      row += cellAt(pattern, index, step) ? '█' : '·';
    }
    return `${track.name.padEnd(10)} ${row}`;
  });
}

/** A one-line summary of a bar, for review output. */
export function summarise(pattern: Pattern): string {
  const metrics = measurePattern(pattern);
  return [
    `${String(metrics.triggers).padStart(3)} triggers`,
    `on-beat ${String(metrics.onBeat).padStart(2)}`,
    `offbeat ${String(metrics.offbeat).padStart(2)}`,
    `16ths ${String(metrics.sixteenth).padStart(2)}`,
    `stacked ${String(metrics.stackedSteps).padStart(2)}`,
    `max ${String(metrics.maxStack)}`,
    `empty ${String(metrics.emptySteps).padStart(2)}`,
    `repeat ${metrics.selfSimilarity.toFixed(2)}`,
  ].join('  ');
}

/** Total triggers, re-exported so review tooling has one import. */
export { countTriggers };
