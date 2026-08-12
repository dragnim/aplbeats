/*
 * The presets: eight different ways of wanting a bar to go.
 *
 * A preset is not a saved pattern. It is a set of dispositions — how many events each
 * instrument tends towards, where each one likes to sit, which positions it insists on,
 * how readily it repeats itself, and how the eight of them relate. Two seeds under one
 * preset should sound like two takes by the same drummer; the same seed under two
 * presets should sound like two different drummers.
 *
 * Almost all of that is data. The generator reads these profiles and does the same work
 * for every preset, which is what keeps the presets comparable and the generator honest:
 * a preset cannot cheat by having its own private code path. The four `strategy` values
 * are the exception, and they earn it — an evenly distributed rhythm and a weighted
 * random one are genuinely different algorithms, not different numbers.
 */

import { STEP_COUNT } from '@/pattern/pattern';
import type { TrackId } from '@/pattern/tracks';

/** How a track's events are chosen. */
export type Strategy =
  /** Weighted choice over the metrical model. The default, and most presets. */
  | 'weighted'
  /** Bjorklund's even distribution, rotated per track. */
  | 'euclidean'
  /** Short bursts and deliberate holes rather than a spread. */
  | 'glitch'
  /** A recurring cycle whose length is not four, set against the pulse. */
  | 'cross';

export interface TrackProfile {
  /** Events at Density 0 and at Density 100. The track's musical range, not a probability. */
  readonly count: readonly [min: number, max: number];
  /** Eases the density curve. Above 1 the track stays sparse until Density is well up. */
  readonly countCurve?: number;
  /** A multiplier per step: this instrument's own opinion about where it belongs. */
  readonly emphasis?: readonly number[];
  /** Extra pull towards the four beats, whatever Syncopation says. */
  readonly anchorPull?: number;
  /** Shifts the repetition threshold. Positive repeats more readily. */
  readonly periodBias?: number;
  /** How much of the Syncopation macro reaches this track, 0 to 1. */
  readonly syncopationScale?: number;
  /** Steps this track insists on, in order of importance, as far as the budget allows. */
  readonly required?: readonly number[];
  /** Chance a required step is nudged off its position at high Complexity. */
  readonly displace?: number;
  /** Longest run of consecutive steps allowed. Guards against machine-gun figures. */
  readonly maxRun?: number;
  /** Cycle length for the `cross` strategy. */
  readonly cycle?: number;
  /** Cycle lengths the `cross` strategy may choose between, one per seed. */
  readonly cycleOptions?: readonly number[];
  /** Pulse count and rotation for the `euclidean` strategy, before Density adjusts it. */
  readonly euclid?: { readonly rotation: number };
}

export interface Preset {
  readonly id: PresetId;
  readonly name: string;
  /** One line, for the control's title attribute. Never shown as body copy. */
  readonly blurb: string;
  readonly strategy: Strategy;
  readonly tracks: Readonly<Record<TrackId, TrackProfile>>;
  /**
   * What the open hat does about the closed hat.
   *
   * `answer` lands where the closed hat is not; `offbeat` takes the "and" of the beat
   * and pushes the closed hat off it; `sparse` does very little. In every case the
   * closed hat gives way where the open hat lands, because two hats on one sixteenth is
   * a mistake rather than a texture.
   */
  readonly openHat: 'answer' | 'offbeat' | 'sparse';
  /** Whether the clap doubles the snare, sits beside it, or goes its own way. */
  readonly clap: 'double' | 'offset' | 'independent';
  /** How much the three auxiliary tracks work as motifs rather than as placements, 0 to 1. */
  readonly motifs: number;
  /** Chance the auxiliary pair answer each other rather than playing together. */
  readonly callResponse: number;
}

export const PRESET_IDS = [
  'straight',
  'fourFloor',
  'broken',
  'syncopated',
  'sparse',
  'euclidean',
  'cross',
  'glitch',
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

/** A 16-step multiplier array, defaulting to 1, with the named steps overridden. */
function emphasise(overrides: Readonly<Record<number, number>>): number[] {
  return Array.from({ length: STEP_COUNT }, (_unused, step) => overrides[step] ?? 1);
}

/**
 * A snare that stays off beats one and three.
 *
 * Merged into every snare profile. Without it the weighted choice happily puts the
 * snare on all four beats — the review grids produced a bar where the kick and the
 * snare were the identical four-on-the-floor row — and a snare on the downbeat beside
 * the kick is not a backbeat, it is a metronome. Beat three keeps a little more room
 * than beat one, because a half-time feel legitimately lives there.
 */
const BACKBEAT_ONLY = emphasise({ 0: 0.05, 8: 0.14 });

/** The auxiliary percussion trio, which most presets treat alike. */
function auxiliary(
  low: TrackProfile,
  high: TrackProfile,
  rim: TrackProfile,
): Pick<Preset['tracks'], 'lowPerc' | 'highPerc' | 'rim'> {
  return { lowPerc: low, highPerc: high, rim };
}

/* ------------------------------------------------------------------------- */

const straight: Preset = {
  id: 'straight',
  name: 'Straight',
  blurb: 'Backbeat, steady hats, few surprises.',
  strategy: 'weighted',
  openHat: 'offbeat',
  clap: 'double',
  motifs: 0.25,
  callResponse: 0.2,
  tracks: {
    // Anchored on the downbeat and the half-bar; reluctant to leave the beats at all.
    kick: {
      count: [2, 5],
      required: [0, 8],
      anchorPull: 0.3,
      syncopationScale: 0.55,
      periodBias: 0.22,
      maxRun: 2,
      // Beats two and four belong to the snare. Leaving them merely "less likely" was
      // not enough: Straight kept generating a kick on all four beats, which is a
      // different preset entirely.
      emphasis: emphasise({ 4: 0.22, 12: 0.26 }),
    },
    // The backbeat, and it does not move.
    snare: {
      count: [2, 3],
      required: [4, 12],
      anchorPull: 0.4,
      syncopationScale: 0.3,
      displace: 0,
      emphasis: BACKBEAT_ONLY,
    },
    closedHat: { count: [4, 13], periodBias: 0.34, syncopationScale: 0.6, anchorPull: 0.15 },
    openHat: { count: [0, 3], syncopationScale: 0.6, periodBias: 0.3 },
    clap: { count: [0, 3], syncopationScale: 0.3 },
    ...auxiliary(
      { count: [0, 4], countCurve: 1.3, syncopationScale: 0.7 },
      { count: [0, 4], countCurve: 1.3, syncopationScale: 0.8 },
      { count: [0, 3], countCurve: 1.4, syncopationScale: 0.9 },
    ),
  },
};

const fourFloor: Preset = {
  id: 'fourFloor',
  name: 'Four on Floor',
  blurb: 'A kick on every beat, hats lifting off it.',
  strategy: 'weighted',
  openHat: 'offbeat',
  clap: 'double',
  motifs: 0.3,
  callResponse: 0.25,
  tracks: {
    /*
     * The one preset where the kick is the pulse rather than a comment on it. All four
     * beats are required, and the sixteenths are shut down hard so extra Density buys
     * an offbeat rather than a stumble.
     */
    kick: {
      count: [4, 7],
      required: [0, 4, 8, 12],
      anchorPull: 1.1,
      syncopationScale: 0.2,
      maxRun: 2,
      emphasis: emphasise({ 1: 0.12, 3: 0.2, 5: 0.12, 7: 0.2, 9: 0.12, 11: 0.2, 13: 0.12, 15: 0.35 }),
    },
    snare: { count: [1, 3], required: [12], anchorPull: 0.3, syncopationScale: 0.4, emphasis: BACKBEAT_ONLY },
    // Off the beat, which is where the lift in this music comes from.
    closedHat: {
      count: [4, 13],
      periodBias: 0.36,
      syncopationScale: 0.7,
      emphasis: emphasise({ 2: 1.5, 6: 1.5, 10: 1.5, 14: 1.5 }),
    },
    openHat: { count: [1, 4], syncopationScale: 0.8 },
    clap: { count: [1, 4], required: [4, 12], syncopationScale: 0.3 },
    ...auxiliary(
      { count: [0, 4], countCurve: 1.2, syncopationScale: 0.8 },
      { count: [0, 5], countCurve: 1.2, syncopationScale: 0.9 },
      { count: [0, 4], countCurve: 1.3, syncopationScale: 1 },
    ),
  },
};

const broken: Preset = {
  id: 'broken',
  name: 'Broken',
  blurb: 'The kick leaves the beats alone and the snare answers late.',
  strategy: 'weighted',
  openHat: 'answer',
  clap: 'offset',
  motifs: 0.55,
  callResponse: 0.55,
  tracks: {
    /*
     * The character of the whole preset. Beats two and four are weighted down almost to
     * nothing, so the kick is pushed onto the "and" and the pickups — which is what
     * "broken" means. The downbeat survives, because a bar with no anchor at all stops
     * being broken and starts being lost.
     */
    kick: {
      count: [3, 7],
      required: [0],
      anchorPull: 0.15,
      syncopationScale: 0.95,
      periodBias: -0.12,
      maxRun: 2,
      emphasis: emphasise({ 4: 0.18, 12: 0.22, 8: 0.55, 6: 1.5, 10: 1.5, 14: 1.4, 3: 1.2, 11: 1.3 }),
    },
    // The backbeat is still there but allowed to arrive early.
    snare: {
      count: [2, 5],
      required: [4, 12],
      displace: 0.45,
      anchorPull: 0.3,
      syncopationScale: 0.75,
      emphasis: emphasise({ 0: 0.06, 8: 0.3, 10: 1.4, 14: 1.3, 7: 1.2 }),
    },
    closedHat: { count: [3, 12], periodBias: -0.05, syncopationScale: 0.6 },
    openHat: { count: [1, 3], syncopationScale: 0.9 },
    clap: { count: [1, 4], syncopationScale: 0.7 },
    ...auxiliary(
      { count: [1, 5], syncopationScale: 0.9, emphasis: emphasise({ 0: 0.3, 4: 0.4, 8: 0.4, 12: 0.4 }) },
      { count: [0, 5], syncopationScale: 1 },
      { count: [0, 4], syncopationScale: 1 },
    ),
  },
};

const syncopated: Preset = {
  id: 'syncopated',
  name: 'Syncopated',
  blurb: 'Anticipations everywhere, the pulse implied rather than stated.',
  strategy: 'weighted',
  openHat: 'answer',
  clap: 'offset',
  motifs: 0.5,
  callResponse: 0.5,
  tracks: {
    /*
     * Everything here leans on the sixteenth before the beat. The Syncopation macro is
     * passed through at full strength on most tracks, so this preset at Syncopation 0
     * is only mildly off-centre and at 100 is thoroughly displaced — the control has its
     * widest travel here, which is the point of the preset.
     */
    kick: {
      count: [3, 7],
      required: [0],
      anchorPull: 0.1,
      syncopationScale: 1,
      periodBias: -0.15,
      maxRun: 2,
      emphasis: emphasise({ 3: 1.6, 7: 1.4, 11: 1.6, 15: 1.5, 4: 0.35, 12: 0.35 }),
    },
    snare: {
      count: [2, 5],
      required: [4, 12],
      displace: 0.6,
      anchorPull: 0.2,
      syncopationScale: 0.9,
      emphasis: emphasise({ 0: 0.06, 8: 0.3, 11: 1.4, 15: 1.3 }),
    },
    closedHat: { count: [3, 12], periodBias: -0.08, syncopationScale: 0.75 },
    openHat: { count: [1, 4], syncopationScale: 1 },
    clap: { count: [1, 4], syncopationScale: 0.9 },
    ...auxiliary(
      { count: [1, 5], syncopationScale: 1 },
      { count: [1, 5], syncopationScale: 1 },
      { count: [0, 5], syncopationScale: 1 },
    ),
  },
};

const sparse: Preset = {
  id: 'sparse',
  name: 'Sparse',
  blurb: 'Space first. What is missing does the work.',
  strategy: 'weighted',
  openHat: 'sparse',
  clap: 'independent',
  motifs: 0.6,
  callResponse: 0.6,
  tracks: {
    /*
     * Not simply "Straight with Density turned down". The ranges are narrower at both
     * ends, the auxiliary tracks are reluctant rather than merely quiet, and the hats
     * repeat over a long period — so the space is structured rather than accidental.
     * Density still travels its full useful distance; it just does so within a smaller
     * world.
     */
    kick: {
      count: [2, 5],
      required: [0],
      anchorPull: 0.5,
      syncopationScale: 0.7,
      periodBias: 0.15,
      maxRun: 1,
    },
    snare: {
      count: [1, 3],
      required: [12],
      anchorPull: 0.35,
      syncopationScale: 0.6,
      maxRun: 1,
      emphasis: BACKBEAT_ONLY,
    },
    closedHat: { count: [2, 7], countCurve: 1.35, periodBias: 0.36, syncopationScale: 0.75 },
    openHat: { count: [0, 2], countCurve: 1.4, syncopationScale: 0.8 },
    clap: { count: [0, 2], countCurve: 1.5, syncopationScale: 0.7 },
    ...auxiliary(
      { count: [0, 3], countCurve: 1.6, syncopationScale: 0.9, maxRun: 1 },
      { count: [0, 3], countCurve: 1.6, syncopationScale: 0.9, maxRun: 1 },
      { count: [0, 2], countCurve: 1.7, syncopationScale: 1, maxRun: 1 },
    ),
  },
};

const euclidean: Preset = {
  id: 'euclidean',
  name: 'Euclidean',
  blurb: 'Every part spread as evenly as its count allows.',
  strategy: 'euclidean',
  openHat: 'answer',
  clap: 'offset',
  motifs: 0,
  callResponse: 0.3,
  tracks: {
    /*
     * Rotations chosen so the tracks do not all begin together. Eight parts each
     * starting on the downbeat is a textbook illustration, not a groove — and the
     * difference between the two is almost entirely these eight numbers.
     *
     * The kick keeps its anchor and its ceiling: E(7,16) on a kick is a machine, not a
     * rhythm.
     */
    kick: { count: [2, 5], euclid: { rotation: 0 }, required: [0], maxRun: 2 },
    snare: { count: [2, 4], euclid: { rotation: 4 }, emphasis: BACKBEAT_ONLY },
    closedHat: { count: [4, 11], euclid: { rotation: 0 } },
    openHat: { count: [0, 3], euclid: { rotation: 2 } },
    clap: { count: [0, 3], euclid: { rotation: 12 } },
    ...auxiliary(
      { count: [0, 5], euclid: { rotation: 3 } },
      { count: [0, 5], euclid: { rotation: 6 } },
      { count: [0, 4], euclid: { rotation: 9 } },
    ),
  },
};

const cross: Preset = {
  id: 'cross',
  name: 'Cross',
  blurb: 'Three- and five-step figures pulling against a four-four pulse.',
  strategy: 'cross',
  openHat: 'answer',
  clap: 'offset',
  motifs: 0.2,
  callResponse: 0.4,
  tracks: {
    /*
     * Cycles that are not four, laid over a bar that is. A three-step figure crossing
     * four-four is a hemiola; a five-step one against sixteen positions comes back round
     * only at the bar line. Both are audibly *against* something, which is the effect
     * wanted.
     *
     * Called Cross rather than Polyrhythm on purpose. The bar is still sixteen steps
     * and still repeats, so these are cross-rhythms within a bar, not independent cycles
     * of different lengths. Naming it Polyrhythm would be claiming an architecture this
     * stage deliberately does not have.
     */
    // The rhythm section keeps the four, so there is something for the rest to cross.
    kick: { count: [2, 5], cycleOptions: [4, 6], required: [0], anchorPull: 0.6, maxRun: 2 },
    snare: {
      count: [2, 4],
      required: [4, 12],
      anchorPull: 0.4,
      cycleOptions: [4, 8],
      emphasis: BACKBEAT_ONLY,
    },
    closedHat: { count: [4, 12], cycleOptions: [3, 5], periodBias: -0.2 },
    openHat: { count: [0, 3], cycleOptions: [5, 6, 7] },
    clap: { count: [0, 3], cycleOptions: [5, 6] },
    ...auxiliary(
      { count: [1, 5], cycleOptions: [3, 5] },
      { count: [1, 5], cycleOptions: [3, 5, 7] },
      { count: [0, 4], cycleOptions: [5, 7] },
    ),
  },
};

const glitch: Preset = {
  id: 'glitch',
  name: 'Glitch',
  blurb: 'Bursts, holes and a snare that will not stay put.',
  strategy: 'glitch',
  openHat: 'answer',
  clap: 'offset',
  motifs: 0.85,
  callResponse: 0.7,
  tracks: {
    /*
     * Structured disruption, not static. Events arrive in short runs with deliberate
     * holes between them, and the same short figure recurs — so there is something to
     * recognise even while it is being interrupted.
     *
     * The kick is the exception and stays disciplined. A kick made of random bursts
     * removes the last thing holding the bar together, and the result is not glitchy,
     * it is simply broken.
     */
    kick: { count: [2, 6], required: [0], anchorPull: 0.45, maxRun: 2, syncopationScale: 0.8 },
    snare: {
      count: [2, 5],
      required: [4, 12],
      displace: 0.75,
      syncopationScale: 1,
      maxRun: 2,
      emphasis: BACKBEAT_ONLY,
    },
    closedHat: { count: [4, 13], periodBias: -0.4, syncopationScale: 0.9 },
    openHat: { count: [0, 4], syncopationScale: 1 },
    clap: { count: [1, 4], displace: 0.6, syncopationScale: 1 },
    ...auxiliary(
      { count: [1, 6], syncopationScale: 1 },
      { count: [1, 6], syncopationScale: 1 },
      { count: [1, 5], syncopationScale: 1 },
    ),
  },
};

/* ------------------------------------------------------------------------- */

const BY_ID: Readonly<Record<PresetId, Preset>> = {
  straight,
  fourFloor,
  broken,
  syncopated,
  sparse,
  euclidean,
  cross,
  glitch,
};

/** Every preset, in the order they are offered. */
export const PRESETS: readonly Preset[] = PRESET_IDS.map((id) => BY_ID[id]);

/** The preset with this identifier, falling back to Straight for an unknown one. */
export function presetById(id: string): Preset {
  return (BY_ID as Record<string, Preset | undefined>)[id] ?? straight;
}

/** Whether a string names a preset that exists. Used when reading stored state. */
export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && Object.hasOwn(BY_ID, value);
}
