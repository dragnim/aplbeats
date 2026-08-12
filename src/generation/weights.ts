/*
 * Where events want to be.
 *
 * A bar of four-four is not sixteen equal slots. The downbeat is not the same kind of
 * place as the second sixteenth of beat three, and a generator that treats them alike
 * produces noise no matter how carefully it is tuned afterwards. So everything starts
 * here: a weight per step, saying how much that position deserves an event.
 *
 * Three things bend those weights, and they are deliberately different mechanisms
 * rather than three names for one probability:
 *
 *   Syncopation blends towards a *second* profile — one that favours the offbeats and
 *   the pickups into the next beat. It is not an inversion of the first. Inverting
 *   metrical weight would put events on the weakest sixteenths, which does not sound
 *   syncopated, it sounds arbitrary.
 *
 *   Complexity opens up the sixteenth grid. At the bottom of the range the odd steps
 *   are effectively unavailable, so a pattern *cannot* be intricate however dense it
 *   gets. That is what keeps the two controls apart.
 *
 *   Density does not appear here at all. It decides how many events to place; these
 *   weights decide where they go.
 */

import { STEP_COUNT } from '@/pattern/pattern';

/** The four beats of the bar, counting from zero. */
export const BEAT_STEPS = [0, 4, 8, 12] as const;

/** The offbeat eighths — the "and" of each beat. */
export const OFFBEAT_STEPS = [2, 6, 10, 14] as const;

/** The sixteenths between them: the "e" and the "a" of each beat. */
export const SIXTEENTH_STEPS = [1, 3, 5, 7, 9, 11, 13, 15] as const;

/** The last sixteenth of each beat — where a pickup into the next beat lives. */
export const PICKUP_STEPS = [3, 7, 11, 15] as const;

export type PositionClass = 'beat' | 'offbeat' | 'sixteenth';

/**
 * How strong each step is, metrically.
 *
 * The bar's downbeat first, then the half-bar, then the other two beats; the offbeat
 * eighths well below those, and the remaining sixteenths well below again. These are
 * ordinary Western metrical hierarchy — the numbers are tuned by ear rather than
 * derived, but the ordering is not a matter of taste.
 */
// prettier-ignore
export const METRICAL_WEIGHTS: readonly number[] = [
  1.00, 0.16, 0.42, 0.20,  // beat 1
  0.68, 0.16, 0.40, 0.20,  // beat 2
  0.82, 0.16, 0.42, 0.20,  // beat 3
  0.68, 0.16, 0.40, 0.24,  // beat 4 — its last sixteenth leads back to the downbeat
];

/**
 * Where syncopation pulls events to.
 *
 * The "and" of each beat first, then the sixteenth immediately before each beat — the
 * anticipation, which is what most syncopation actually is: an event arriving early and
 * leaving the beat itself empty. The beats keep a small share rather than none, because
 * a bar with nothing on any beat has not been syncopated, it has been dismantled.
 */
// prettier-ignore
export const SYNCOPATION_WEIGHTS: readonly number[] = [
  0.22, 0.34, 1.00, 0.82,  // beat 1
  0.16, 0.34, 0.95, 0.86,  // beat 2
  0.20, 0.34, 1.00, 0.82,  // beat 3
  0.16, 0.34, 0.95, 0.90,  // beat 4
];

/** Which of the three kinds of position a step is. */
export function positionClass(step: number): PositionClass {
  const inBar = ((step % STEP_COUNT) + STEP_COUNT) % STEP_COUNT;
  if (inBar % 4 === 0) return 'beat';
  if (inBar % 2 === 0) return 'offbeat';
  return 'sixteenth';
}

/** Whether a step falls on one of the four beats. */
export function isBeat(step: number): boolean {
  return positionClass(step) === 'beat';
}

/** The metrical strength of a step, 0 to 1. */
export function metricalStrength(step: number): number {
  return METRICAL_WEIGHTS[((step % STEP_COUNT) + STEP_COUNT) % STEP_COUNT] ?? 0;
}

/** A macro value of 0–100 as a fraction of 0–1, clamped. */
export function macro(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / 100));
}

/** Smooth 0→1 across [edge0, edge1], flat outside it. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * How available the sixteenth grid is, 0 to 1.
 *
 * The single most important consequence of Complexity, and the reason it is not another
 * Density. Below about fifteen per cent the odd steps are shut almost completely, so
 * the generator is working on an eighth-note grid and a pattern physically cannot be
 * intricate — however many events Density asks for, they go on the eighths. Above about
 * seventy per cent the whole sixteenth grid is open.
 */
export function sixteenthAvailability(complexity: number): number {
  return 0.04 + 0.96 * smoothstep(0.1, 0.95, macro(complexity));
}

/**
 * How long a pattern goes before it repeats itself, in steps.
 *
 * The other half of Complexity, and the half that is most audible. A groove built from
 * a four-step figure repeated four times is *simple* — recognisably, immediately, however
 * many notes are in it. One that never repeats is complex even if it is nearly empty.
 * Density cannot produce or destroy this, which is exactly the separation the two
 * controls are supposed to have.
 *
 * `bias` shifts a track along the scale: hats and their subdivisions want to repeat far
 * more readily than a percussion motif does.
 */
export function repetitionPeriod(complexity: number, bias = 0): 4 | 8 | 16 {
  // Subtracted, not added. A positive bias means "repeat more readily", which means
  // behaving as though Complexity were lower — the first version added it and so did
  // exactly the opposite of what every preset using it intended.
  const level = macro(complexity) - bias;
  if (level < 0.3) return 4;
  if (level < 0.62) return 8;
  return 16;
}

export interface PlacementOptions {
  /** 0–100. Blends towards the offbeat and anticipation profile. */
  readonly syncopation: number;
  /** 0–100. Opens the sixteenth grid. */
  readonly complexity: number;
  /**
   * A per-track, per-preset multiplier for each step.
   *
   * How a track's own musical character enters the model: a kick's profile is not a
   * hat's, and neither is the generic one. Applied after the blend so a preset can
   * forbid a position outright by weighting it zero.
   */
  readonly emphasis?: readonly number[] | undefined;
  /** Extra pull towards the beats regardless of syncopation, 0 to 1. */
  readonly anchorPull?: number | undefined;
}

/**
 * The weight of every step for one track, ready for `weightedChoice`.
 *
 * Sixteen numbers that say where this instrument, under this preset, at these settings,
 * would like its events to fall. Nothing here decides how many.
 */
export function placementWeights({
  syncopation,
  complexity,
  emphasis,
  anchorPull = 0,
}: PlacementOptions): number[] {
  /*
   * Capped below one. At the very top of the control the metrical profile still
   * contributes a tenth of the weight, which — together with the anchors and the required
   * steps that survive — is what keeps a maximally syncopated bar sounding like it is
   * fighting a pulse rather than like it never had one.
   */
  const blend = 0.9 * macro(syncopation);
  const availability = sixteenthAvailability(complexity);

  const weights: number[] = [];
  for (let step = 0; step < STEP_COUNT; step += 1) {
    const metrical = METRICAL_WEIGHTS[step] ?? 0;
    const syncopated = SYNCOPATION_WEIGHTS[step] ?? 0;

    let weight = metrical * (1 - blend) + syncopated * blend;

    /*
     * The beats keep some pull, but less of it as Syncopation rises.
     *
     * Added at full strength this was a bug with the sign of a feature: at the top of the
     * control the anchor bonus swamped the blend, so the *more* Syncopation was asked for
     * the more events landed on the downbeat. Measured over forty seeds, Syncopation 100
     * put a smaller share of events off the beat than Syncopation 0 did.
     *
     * Fading it keeps what the anchor is for — a track that likes the beats still finds
     * them when nothing else is asked — without letting it argue with the one control whose
     * whole job is to move events away from them.
     */
    if (anchorPull > 0 && isBeat(step)) weight += anchorPull * metrical * (1 - blend * 0.85);

    // Shut the sixteenth grid down at low complexity.
    if (positionClass(step) === 'sixteenth') weight *= availability;

    weight *= emphasis?.[step] ?? 1;
    weights.push(Math.max(0, weight));
  }

  return weights;
}

/**
 * How many events a track should have — before rounding.
 *
 * Deliberately fractional. The range is the track's musical character: a hat that can
 * carry fourteen events and a kick that should rarely exceed six are not on the same
 * scale, and giving them one would make Density mean "everything gets busier at the same
 * rate", which is not what a kit does. The curve is slightly eased so the middle of the
 * control is the useful middle of the range.
 *
 * Rounding is left to the caller, which is not fussiness: rounding here gave Density
 * dead zones several points wide — 62 and 68 produced byte-identical bars — because all
 * eight tracks changed integer at nearly the same moments. See `countFor`.
 */
export function exactEventCount(density: number, min: number, max: number, curve = 1): number {
  return min + Math.pow(macro(density), curve) * (max - min);
}
