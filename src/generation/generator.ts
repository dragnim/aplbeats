/*
 * The generator.
 *
 * One pure function from settings to an 8 × 16 Boolean matrix. No clock, no audio, no
 * React, no `Math.random` — the same inputs give the same bar on every machine, for
 * ever, which is what makes a seed worth showing and a groove worth returning to.
 *
 * The shape of the work, for every track:
 *
 *   Density says how many events this instrument gets, within its own range.
 *   The metrical model and the preset say where those events would like to be.
 *   Complexity says whether the bar repeats itself, and whether sixteenths exist at all.
 *   The strategy says how the choosing is done.
 *   Then the tracks are reconciled with each other, which is where a kit comes from.
 *
 * That last step is the one that separates this from eight independent random rows. An
 * open hat that lands on a closed hat is a mistake; a clap unrelated to the snare is a
 * coincidence; three auxiliary percussion parts scattered independently are clutter. The
 * relationships are generated, not hoped for.
 */

import { createPattern, setCell, STEP_COUNT, type Pattern } from '@/pattern/pattern';
import { TRACKS, type TrackId } from '@/pattern/tracks';
import { euclideanSteps } from './euclidean';
import { presetById, type Preset, type PresetId, type TrackProfile } from './presets';
import { streamFor, weightedChoice, type Rng } from './prng';
import { GENERATOR_VERSION } from './version';
import {
  exactEventCount,
  macro,
  placementWeights,
  repetitionPeriod,
  smoothstep,
  OFFBEAT_STEPS,
} from './weights';

export { GENERATOR_VERSION } from './version';

export interface GenerateOptions {
  readonly seed: number;
  readonly preset: PresetId;
  /** 0–100. How much happens. */
  readonly density: number;
  /** 0–100. How intricate it is. */
  readonly complexity: number;
  /** 0–100. How far events lean off the beat. */
  readonly syncopation: number;
  /** Rows to keep, bit for bit. Locked tracks are copied from `currentPattern`. */
  readonly lockedTracks?: readonly boolean[] | undefined;
  /** Where locked rows come from. Required if anything is locked. */
  readonly currentPattern?: Pattern | undefined;
}

/** The steps a track fires on, as a set, while it is being built. */
type StepSet = Set<number>;

/**
 * A complete bar.
 *
 * Locked tracks are copied straight from `currentPattern` and never generated, which is
 * the whole of the lock guarantee: there is no code path in which a locked row is
 * computed and then restored, so there is nothing to get wrong.
 */
export function generatePattern(options: GenerateOptions): Pattern {
  const preset = presetById(options.preset);
  const locked = options.lockedTracks ?? [];
  const current = options.currentPattern;

  const rows = new Map<TrackId, StepSet>();

  /* ---- the parts, in the order they depend on each other ---------------- */

  const kick = generateTrack('kick', preset, options);
  rows.set('kick', kick);

  const snare = generateTrack('snare', preset, options, { avoid: kick, avoidance: 0.55 });
  rows.set('snare', snare);

  const closedHat = generateTrack('closedHat', preset, options);
  const openHat = generateOpenHat(preset, options, closedHat);
  // The closed hat gives way wherever the open hat landed. Both at once is a flam, not
  // a texture, and it is the single most common way a generated kit sounds wrong.
  for (const step of openHat) closedHat.delete(step);
  rows.set('closedHat', closedHat);
  rows.set('openHat', openHat);

  rows.set('clap', generateClap(preset, options, snare));

  /*
   * The low tom keeps clear of the kick and of the snare.
   *
   * The kick for register — two things at the bottom of the spectrum on one sixteenth is
   * mud — and the snare because the review grids produced bars where the low percussion
   * played the snare's figure exactly, note for note. Doubling a part is not a second part.
   */
  const lowPerc = generateTrack('lowPerc', preset, options, {
    avoid: new Set([...kick, ...snare]),
    avoidance: 0.4,
  });
  rows.set('lowPerc', lowPerc);
  const highPerc = generateHighPerc(preset, options, lowPerc, snare);
  rows.set('highPerc', highPerc);
  rows.set('rim', generateTrack('rim', preset, options, { avoid: snare, avoidance: 0.4 }));

  /* ---- assemble ---------------------------------------------------------- */

  let pattern = createPattern();
  for (let track = 0; track < TRACKS.length; track += 1) {
    const definition = TRACKS[track];
    if (definition === undefined) continue;

    if (locked[track] === true && current !== undefined) {
      const row = current[track];
      if (row !== undefined) {
        for (let step = 0; step < STEP_COUNT; step += 1) {
          if (row[step] === true) pattern = setCell(pattern, track, step, true);
        }
        continue;
      }
    }

    for (const step of rows.get(definition.id) ?? []) {
      pattern = setCell(pattern, track, step, true);
    }
  }

  return pattern;
}

/* ------------------------------------------------------------------------- */

interface TrackContext {
  /** Steps this track would rather not share, and how strongly. */
  readonly avoid?: StepSet;
  readonly avoidance?: number;
}

/**
 * The tracks that hold a groove's identity, and are therefore left alone by Density.
 *
 * See `densityBucket`. Everything else reorganises as Density moves; these two only gain
 * and lose events.
 */
const RHYTHM_SECTION: ReadonlySet<TrackId> = new Set(['kick', 'snare']);

/**
 * A coarse Density band, mixed into a track's random stream.
 *
 * Without this, Density has dead zones ten points wide. Event counts are integers, so a
 * control with a hundred positions and a range of eight to thirty-five triggers must
 * repeat itself somewhere — but measured over sixty seeds the median widest plateau was
 * ten density points and the worst was thirteen. Dragging the slider a tenth of its
 * travel and hearing nothing is a broken control, whatever the arithmetic says.
 *
 * Banding Density into the stream means the *arrangement* changes every few points even
 * when no count does. The kick and snare are excluded so the groove keeps its identity:
 * they gain and lose events, but their figure does not reshuffle underneath you. It is
 * the ornamentation that moves, which is what a drummer would do anyway.
 *
 * Still perfectly deterministic — the same Density gives the same band gives the same bar.
 */
function densityBucket(id: TrackId, density: number): number {
  return RHYTHM_SECTION.has(id) ? 0 : Math.round(macro(density) * 25);
}

/** One track's steps, by whichever strategy its preset uses. */
function generateTrack(
  id: TrackId,
  preset: Preset,
  options: GenerateOptions,
  context: TrackContext = {},
): StepSet {
  const profile = preset.tracks[id];
  const rng = streamFor(options.seed, GENERATOR_VERSION, preset.id, id, densityBucket(id, options.density));
  const count = countFor(profile, options, rng);

  if (count <= 0) return new Set();

  const weights = weightsFor(profile, options, context);

  /*
   * The insisted-on steps come out of the budget, not on top of it.
   *
   * Adding them afterwards inflated every count — a snare asked for two events and got
   * four, a kick asked for three got five — and, worse, the extras landed outside the
   * repeating window and quietly destroyed the repetition that low Complexity is
   * supposed to produce. Reserving them first keeps Density honest and the tiling
   * intact.
   */
  const chosen = requiredSteps(profile, options, rng, count);
  for (const step of chosen) weights[step] = 0;
  const budget = Math.max(0, count - chosen.size);

  let steps: number[] = [];
  if (budget > 0) {
    switch (preset.strategy) {
      case 'euclidean':
        steps = euclideanTrack(profile, options, budget, rng);
        break;
      case 'cross':
        steps = crossTrack(profile, options, budget, rng, weights);
        break;
      case 'glitch':
        steps = glitchTrack(profile, options, budget, rng, weights);
        break;
      case 'weighted':
        steps =
          MOTIF_TRACKS.has(id) && rng.chance(preset.motifs)
            ? motifTrack(options, budget, rng, weights)
            : weightedTrack(profile, options, budget, rng, weights);
        break;
    }
  }

  for (const step of steps) {
    if (step >= 0 && step < STEP_COUNT) chosen.add(step);
  }

  limitRuns(chosen, profile.maxRun ?? STEP_COUNT, rng);
  return chosen;
}

/** The three tracks that work best as a recurring figure rather than as placements. */
const MOTIF_TRACKS: ReadonlySet<TrackId> = new Set(['lowPerc', 'highPerc', 'rim']);

/**
 * A short figure, repeated.
 *
 * The auxiliary percussion needs this more than anything else in the generator. Given a
 * budget of two or three events and weighted placement, those three tracks produce
 * isolated single hits scattered over the bar — which is not a part, it is punctuation
 * with nothing to punctuate. The review grids showed it immediately: a lone rim on the
 * downbeat underneath a kick, a hat and a high perc, four seeds running.
 *
 * A figure of two or three events, placed twice or four times over the bar, is
 * recognisable. That is the whole difference between percussion and filler.
 */
function motifTrack(options: GenerateOptions, count: number, rng: Rng, weights: readonly number[]): number[] {
  if (count < 2) return weightedChoice(rng, weights, count);

  // The shape of the figure: a first event, then one or two more close behind it.
  const span = 2 + rng.int(1 + Math.round(macro(options.complexity) * 3));
  const hits = Math.min(count, 2 + (rng.chance(macro(options.complexity) * 0.7) ? 1 : 0));

  const offsets = new Set<number>([0]);
  let guard = 0;
  while (offsets.size < hits && guard < 12) {
    guard += 1;
    offsets.add(1 + rng.int(span));
  }

  // How often it comes round. Half-bar recurrence reads as a phrase; every beat reads
  // as part of the kit's pulse.
  const stride = rng.chance(0.65) ? 8 : 4;
  const [start = 0] = weightedChoice(rng, weights, 1);

  const steps = new Set<number>();
  for (let base = start; base < STEP_COUNT; base += stride) {
    for (const offset of offsets) {
      const step = base + offset;
      if (step < STEP_COUNT) steps.add(step);
    }
  }

  return reconcileCount([...steps], count, weights, rng, stride);
}

/**
 * How many events a track gets, this seed.
 *
 * Density fixes the ideal, which is fractional; this rounds it, and *how* it rounds is
 * where two separate faults were fixed.
 *
 * The fraction is compared against a threshold drawn once per seed per track, rather than
 * rounded to nearest. Rounding to nearest gave Density dead zones several points wide,
 * because all eight tracks crossed their integer boundaries at almost the same moments —
 * densities 62 and 68 produced byte-identical bars. Dithering spreads roughly thirty
 * crossings across the control instead of clustering eight of them, so almost any move
 * changes something. It also gives the count its own seed diversity for free.
 *
 * The wide tracks get a further event either way, because a hat moving by one is a nudge
 * where a rim moving by one is half its part. Everything stays inside the profile's own
 * range, so a preset that insists on four kicks still gets four.
 */
function countFor(profile: TrackProfile, options: GenerateOptions, rng: Rng): number {
  const [min, max] = profile.count;
  const span = max - min;
  if (span <= 0) return min;

  const exact = exactEventCount(options.density, min, max, profile.countCurve ?? 1);
  const floor = Math.floor(exact);
  const dithered = floor + (exact - floor > rng.next() ? 1 : 0);
  const extra = span >= 6 ? rng.range(-1, 1) : 0;

  return Math.min(max, Math.max(min, dithered + extra));
}

/** The placement weights for a track, after its profile and its neighbours. */
function weightsFor(profile: TrackProfile, options: GenerateOptions, context: TrackContext): number[] {
  const weights = placementWeights({
    syncopation: options.syncopation * (profile.syncopationScale ?? 1),
    complexity: options.complexity,
    emphasis: profile.emphasis,
    anchorPull: profile.anchorPull,
  });

  // Leaving room for another part is a musical decision, not a collision check: the
  // step is discouraged, not forbidden, so the two can still land together when the
  // weighting happens to want it.
  const avoid = context.avoid;
  const avoidance = context.avoidance ?? 0;
  if (avoid !== undefined && avoidance > 0) {
    for (const step of avoid) {
      const existing = weights[step];
      if (existing !== undefined) weights[step] = existing * (1 - avoidance);
    }
  }

  return weights;
}

/* ---- strategies ---------------------------------------------------------- */

/**
 * Weighted choice, over a window that repeats.
 *
 * At low Complexity the window is four steps and the bar is that figure four times over
 * — which is what "simple" sounds like, far more than a low event count does. The count
 * is then reconciled against the target by adding to or trimming from the *last*
 * repetition, so the arithmetic works out and the bar gets a fill at the end of it,
 * which is where a drummer would put one anyway.
 */
function weightedTrack(
  profile: TrackProfile,
  options: GenerateOptions,
  count: number,
  rng: Rng,
  weights: readonly number[],
): number[] {
  const period = repetitionPeriod(options.complexity, profile.periodBias ?? 0);
  if (period >= STEP_COUNT) return weightedChoice(rng, weights, count);

  const windowCount = Math.max(1, Math.round((count * period) / STEP_COUNT));
  const inWindow = weightedChoice(rng, weights.slice(0, period), windowCount);

  const tiled: number[] = [];
  for (let start = 0; start < STEP_COUNT; start += period) {
    for (const step of inWindow) tiled.push(start + step);
  }

  return reconcileCount(tiled, count, weights, rng, period);
}

/**
 * Add or remove events until the count is right, working from the end of the bar.
 *
 * Repetition quantises the count — a four-step figure can only produce multiples of
 * four — so something has to give. Taking the difference out of the last repetition is
 * both the arithmetic fix and the musical one: the bar stays recognisably a repeated
 * figure, and its final beat differs, which is a fill.
 */
function reconcileCount(
  tiled: readonly number[],
  target: number,
  weights: readonly number[],
  rng: Rng,
  period: number,
): number[] {
  const steps = new Set(tiled);
  const lastRepetition = STEP_COUNT - period;

  while (steps.size > target) {
    const candidates = [...steps].filter((step) => step >= lastRepetition);
    const removable = candidates.length > 0 ? candidates : [...steps];
    const victim = removable[rng.int(removable.length)];
    if (victim === undefined) break;
    steps.delete(victim);
  }

  while (steps.size < target) {
    const free: number[] = [];
    const freeWeights: number[] = [];
    for (let step = 0; step < STEP_COUNT; step += 1) {
      if (steps.has(step)) continue;
      free.push(step);
      // Weighted towards the end of the bar, so the addition reads as a fill.
      freeWeights.push((weights[step] ?? 0) * (step >= lastRepetition ? 2.2 : 1));
    }
    if (free.length === 0) break;

    const [pick] = weightedChoice(rng, freeWeights, 1);
    const step = pick === undefined ? free[0] : free[pick];
    if (step === undefined) break;
    steps.add(step);
  }

  return [...steps];
}

/**
 * Bjorklund's even distribution, rotated.
 *
 * Syncopation moves the rotation rather than the weighting, which is the only thing it
 * sensibly can do to an evenly spread rhythm: the spacing is the whole point and must
 * not be disturbed, but *where the spacing starts* changes everything about how it sits
 * against the pulse. Complexity adds a per-seed rotation of its own, so two seeds under
 * this preset are not the same eight figures.
 */
function euclideanTrack(profile: TrackProfile, options: GenerateOptions, count: number, rng: Rng): number[] {
  const base = profile.euclid?.rotation ?? 0;
  const syncopatedShift = Math.round(macro(options.syncopation) * 3);
  /*
   * A per-seed rotation, widening with Complexity.
   *
   * Rotation is the only freedom an even distribution has, so it is the only place
   * seed diversity can come from here. A narrow window made two seeds differ by five per
   * cent of their cells; at the top of Complexity the figure can start anywhere.
   */
  const complexityJitter = rng.int(2 + Math.round(macro(options.complexity) * 14));
  return euclideanSteps(count, STEP_COUNT, base + syncopatedShift + complexityJitter);
}

/**
 * A cycle whose length is not four.
 *
 * Every `cycle` steps from an offset, which against a sixteen-step bar of four-four is
 * a cross-rhythm: three gives a hemiola, five and seven come back round only at the bar
 * line. The count then trims or extends it, so Density still means what it means.
 */
function crossTrack(
  profile: TrackProfile,
  options: GenerateOptions,
  count: number,
  rng: Rng,
  weights: readonly number[],
): number[] {
  /*
   * Which cycle, and where it starts.
   *
   * Both drawn per seed, because a fixed cycle at a fixed offset has almost no freedom
   * left: the review tooling found two seeds differing by three per cent of their cells.
   * A part that is a three-cycle in one bar and a five-cycle in the next is still the
   * same idea — a figure that does not fit the metre — which is what this preset is.
   */
  const choices = profile.cycleOptions ?? [profile.cycle ?? 4];
  const cycle = Math.max(2, choices[rng.int(choices.length)] ?? 4);

  /*
   * Where the cycle starts.
   *
   * Anchored to the downbeat at low Syncopation and free at high, which is the only
   * lever that makes sense here: the spacing is the figure and must not be disturbed,
   * but a three-cycle beginning on the downbeat pulls against the pulse quite
   * differently from one beginning a sixteenth after it.
   */
  const reach = 1 + Math.round(macro(options.syncopation) * (cycle - 1));
  const offset = rng.int(reach);

  const steps: number[] = [];
  for (let step = offset; step < STEP_COUNT; step += cycle) steps.push(step);

  return reconcileCount(steps, count, weights, rng, cycle);
}

/**
 * Short runs with holes between them.
 *
 * Glitch is disruption with a shape. Events arrive in bursts of one to three
 * consecutive steps rather than spread out, and a contiguous region of the bar is
 * emptied outright — so what is heard is a figure being interrupted, which is
 * recognisable, rather than a uniform scatter, which is not.
 */
function glitchTrack(
  profile: TrackProfile,
  options: GenerateOptions,
  count: number,
  rng: Rng,
  weights: readonly number[],
): number[] {
  const intensity = smoothstep(0.2, 0.9, macro(options.complexity));
  const maxBurst = Math.min(profile.maxRun ?? 3, 1 + Math.round(intensity * 2));

  const steps = new Set<number>();
  let guard = 0;
  while (steps.size < count && guard < 40) {
    guard += 1;
    const [start] = weightedChoice(rng, weights, 1);
    if (start === undefined) break;

    const length = 1 + rng.int(maxBurst);
    for (let offset = 0; offset < length && steps.size < count; offset += 1) {
      const step = start + offset;
      if (step < STEP_COUNT) steps.add(step);
    }
  }

  // One deliberate hole, so the disruption has somewhere to be heard against.
  const holeStart = rng.int(STEP_COUNT - 3);
  const holeLength = 2 + rng.int(2);
  if (steps.size > 2) {
    for (let step = holeStart; step < holeStart + holeLength; step += 1) steps.delete(step);
  }

  return [...steps];
}

/* ---- relationships ------------------------------------------------------- */

/**
 * The open hat, placed against the closed hat rather than beside it.
 *
 * `offbeat` takes the "and" of the beat, which is the house lift. `answer` goes where
 * the closed hat is not. `sparse` does a little of the latter and not much of it. In
 * every case the caller removes the closed hat wherever this lands.
 */
function generateOpenHat(preset: Preset, options: GenerateOptions, closedHat: StepSet): StepSet {
  const profile = preset.tracks.openHat;
  const rng = streamFor(
    options.seed,
    GENERATOR_VERSION,
    preset.id,
    'openHat',
    densityBucket('openHat', options.density),
  );
  const count = countFor(profile, options, rng);
  if (count <= 0) return new Set();

  const weights = weightsFor(profile, options, {});

  for (let step = 0; step < STEP_COUNT; step += 1) {
    const weight = weights[step] ?? 0;
    const occupied = closedHat.has(step);

    switch (preset.openHat) {
      case 'offbeat':
        weights[step] = weight * (OFFBEAT_STEPS.includes(step as 2 | 6 | 10 | 14) ? 3.2 : 0.35);
        break;
      case 'answer':
        weights[step] = weight * (occupied ? 0.2 : 1.6);
        break;
      case 'sparse':
        weights[step] = weight * (occupied ? 0.1 : 1);
        break;
    }
  }

  /*
   * Placed through the same repeating window as everything else, rather than by a bare
   * weighted draw. Open hats on the "and" of one and the "and" of three is a figure;
   * open hats on the "and" of two and the "a" of four is an accident — and since the
   * closed hat gives way wherever this lands, an irregular open hat tears holes in an
   * otherwise regular hat part.
   */
  const steps = new Set(weightedTrack(profile, options, count, rng, weights));
  limitRuns(steps, profile.maxRun ?? 1, rng);
  return steps;
}

/**
 * The clap, as a relation of the snare.
 *
 * `double` widens the backbeat by landing on it; `offset` shadows it a sixteenth or two
 * later, which is the answering figure a second player would give it; `independent`
 * goes its own way. A clap generated with no reference to the snare at all is the
 * commonest way a generated kit sounds like two machines in one room.
 */
function generateClap(preset: Preset, options: GenerateOptions, snare: StepSet): StepSet {
  const profile = preset.tracks.clap;
  const rng = streamFor(
    options.seed,
    GENERATOR_VERSION,
    preset.id,
    'clap',
    densityBucket('clap', options.density),
  );
  const count = countFor(profile, options, rng);
  if (count <= 0) return new Set();

  if (preset.clap === 'independent') {
    return generateTrack('clap', preset, options, { avoid: snare, avoidance: 0.3 });
  }

  const steps = new Set<number>();

  if (preset.clap === 'double') {
    for (const step of [...snare].sort((a, b) => a - b)) {
      if (steps.size >= count) break;
      steps.add(step);
    }
  } else {
    /*
     * A shadow of the snare, and never underneath it.
     *
     * The offset can land the clap on another of the snare's own steps — a snare on four and
     * six shifted by two puts a clap on six, where the snare already is. That is not an
     * answering figure, it is a thickened snare, and the review grids were full of them.
     */
    const shift = rng.chance(0.6) ? 1 : 2;
    for (const step of [...snare].sort((a, b) => a - b)) {
      if (steps.size >= count) break;
      const answer = (step + shift) % STEP_COUNT;
      if (!snare.has(answer)) steps.add(answer);
    }
  }

  // Any remaining budget goes wherever the preset's weighting wants it.
  if (steps.size < count) {
    const weights = weightsFor(profile, options, {});
    for (const step of steps) weights[step] = 0;
    for (const step of weightedChoice(rng, weights, count - steps.size)) steps.add(step);
  }

  return steps;
}

/**
 * The high percussion, as an answer to the low percussion.
 *
 * With probability `callResponse` it echoes the low part a step or two later — the
 * simplest call and response there is, and enough to make two auxiliary tracks sound
 * like they are listening to each other rather than sharing a bar by accident.
 * Otherwise it is generated on its own terms, avoiding the snare.
 */
function generateHighPerc(
  preset: Preset,
  options: GenerateOptions,
  lowPerc: StepSet,
  snare: StepSet,
): StepSet {
  const rng = streamFor(
    options.seed,
    GENERATOR_VERSION,
    preset.id,
    'highPerc',
    'response',
    densityBucket('highPerc', options.density),
  );

  if (lowPerc.size === 0 || !rng.chance(preset.callResponse)) {
    return generateTrack('highPerc', preset, options, { avoid: snare, avoidance: 0.45 });
  }

  const profile = preset.tracks.highPerc;
  const count = countFor(profile, options, rng);
  if (count <= 0) return new Set();

  const gap = 1 + rng.int(3);
  const steps = new Set<number>();
  for (const step of [...lowPerc].sort((a, b) => a - b)) {
    if (steps.size >= count) break;
    const answer = (step + gap) % STEP_COUNT;
    if (!lowPerc.has(answer)) steps.add(answer);
  }

  if (steps.size < count) {
    const weights = weightsFor(profile, options, { avoid: snare, avoidance: 0.45 });
    for (const step of steps) weights[step] = 0;
    for (const step of lowPerc) weights[step] = (weights[step] ?? 0) * 0.2;
    for (const step of weightedChoice(rng, weights, count - steps.size)) steps.add(step);
  }

  limitRuns(steps, profile.maxRun ?? 2, rng);
  return steps;
}

/* ---- constraints --------------------------------------------------------- */

/**
 * The steps a track insists on.
 *
 * A kick without its downbeat and a straight snare without its backbeat are not
 * variations, they are failures — so those positions are placed first and the rest of
 * the budget fills in around them. Displacement lets a preset knock them off,
 * deliberately and only as far as Complexity allows: the backbeat arriving a sixteenth
 * early is a musical decision, the backbeat arriving anywhere is not.
 */
function requiredSteps(
  profile: TrackProfile,
  options: GenerateOptions,
  rng: Rng,
  budget: number,
): Set<number> {
  const steps = new Set<number>();
  const required = profile.required;
  if (required === undefined || required.length === 0 || budget <= 0) return steps;

  /*
   * Driven by Syncopation as well as Complexity, whichever asks for more.
   *
   * Displacement is what syncopation *is* — an anchor arriving early and leaving its beat
   * empty — so a control that moves everything else off the beat and left the backbeat
   * pinned was only doing half its job. Complexity still drives it too, because a displaced
   * anchor is also a more intricate figure.
   *
   * Presets that must not do this set `displace` to zero, which is how Straight stays
   * straight however far the control is pushed.
   */
  const displaceChance =
    (profile.displace ?? 0) *
    Math.max(
      smoothstep(0.25, 0.85, macro(options.complexity)),
      smoothstep(0.45, 1, macro(options.syncopation)),
    );

  for (const step of required) {
    if (steps.size >= budget) break;

    let target = step;
    if (displaceChance > 0 && rng.chance(displaceChance)) {
      target = (step + (rng.chance(0.65) ? -1 : 1) + STEP_COUNT) % STEP_COUNT;
    }
    steps.add(target);
  }

  return steps;
}

/**
 * Break up runs longer than a track tolerates.
 *
 * Three consecutive sixteenths on a kick is a machine gun, and weighted choice will
 * occasionally produce one however well the weights are tuned — it is a property of
 * choosing independently, not of choosing badly. Cheaper and more reliable to remove
 * afterwards than to complicate the selection.
 */
function limitRuns(steps: StepSet, maxRun: number, rng: Rng): void {
  if (maxRun >= STEP_COUNT || maxRun < 1) return;

  let run = 0;
  for (let step = 0; step < STEP_COUNT; step += 1) {
    if (!steps.has(step)) {
      run = 0;
      continue;
    }

    run += 1;
    if (run > maxRun) {
      // Take out the middle of the run rather than its edges: the attack and the
      // resolution are what the figure is, and the filling between them is not.
      const victim = rng.chance(0.7) ? step - 1 : step;
      steps.delete(victim);
      run = maxRun - 1;
    }
  }
}
