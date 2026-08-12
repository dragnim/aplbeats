/*
 * Deterministic randomness.
 *
 * Every groove APL Beats generates is a pure function of its inputs, and this is what
 * makes that possible: a small pseudo-random generator whose entire state is one
 * 32-bit integer. Given the same seed it produces the same sequence, on every machine
 * and in every browser, for ever.
 *
 * `Math.random` cannot do this. Its state is not addressable, so a groove made with it
 * cannot be written down, shared, tested, or returned to — and a seed you cannot
 * reproduce is not a seed. It is also why the review tooling and the tests can say
 * anything meaningful at all.
 *
 * The one property that matters beyond reproducibility is *independence*: the eight
 * tracks each draw from their own stream, derived from the seed by hashing. Without
 * that, adding one event to the kick would shift every subsequent draw and rewrite the
 * whole kit — which would make locks impossible and Variation meaningless.
 */

/** How the seed is shown and stored: a plain positive integer. */
export const MIN_SEED = 1;
export const MAX_SEED = 999_999;

/**
 * A stream of deterministic randomness.
 *
 * Deliberately an object with methods rather than a bare function, because generation
 * asks for weighted choices and shuffles far more often than it asks for a number
 * between zero and one, and spelling those out at every call site is where bias creeps
 * in.
 */
export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, bound). Zero if `bound` is not positive. */
  int(bound: number): number;
  /** An integer in [min, max], inclusive both ends. */
  range(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** One item, uniformly. `undefined` only for an empty list. */
  pick<T>(items: readonly T[]): T | undefined;
  /** A new array, shuffled. The input is untouched. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * mulberry32.
 *
 * Thirty-two bits of state and about five operations per number. Its statistical
 * quality is far beyond anything a drum machine can hear, and its size is the point:
 * the whole generator's behaviour is reproducible from one integer that a person can
 * read aloud.
 */
export function createRng(seed: number): Rng {
  let state = normaliseSeed(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };

  const int = (bound: number): number => {
    if (!Number.isFinite(bound) || bound <= 0) return 0;
    return Math.floor(next() * bound);
  };

  return {
    next,
    int,
    range: (min, max) => (max <= min ? min : min + int(max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[int(items.length)],
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        const a = copy[i];
        const b = copy[j];
        if (a !== undefined && b !== undefined) {
          copy[i] = b;
          copy[j] = a;
        }
      }
      return copy;
    },
  };
}

/**
 * Any number into a usable 32-bit state.
 *
 * A state of zero would leave mulberry32 on a single fixed point, so zero becomes
 * something else. Nothing else about the value matters — the generator mixes hard
 * enough that neighbouring seeds share nothing.
 */
function normaliseSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0x9e3779b9;
  const truncated = Math.trunc(seed) | 0;
  return truncated === 0 ? 0x9e3779b9 : truncated;
}

/**
 * A seed derived from a seed and some labels.
 *
 * This is what gives each track its own stream. `derive(seed, 'kick')` and
 * `derive(seed, 'snare')` are unrelated sequences from the same groove, so the kick can
 * be regenerated without disturbing the snare — which is what locks need, and what
 * stops one extra hat rewriting the entire kit.
 *
 * FNV-1a over the labels, then mixed into the seed. Cheap, and well enough distributed
 * that "kick" and "kick2" go nowhere near each other.
 */
export function derive(seed: number, ...labels: (string | number)[]): number {
  let hash = 0x811c9dc5;

  const absorb = (value: number): void => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193);
  };

  for (const label of labels) {
    const text = typeof label === 'number' ? `#${String(label)}` : label;
    for (let i = 0; i < text.length; i += 1) {
      absorb(text.charCodeAt(i));
      absorb(text.charCodeAt(i) >>> 8);
    }
    absorb(0x1f); // separator, so ('ab','c') and ('a','bc') differ
  }

  return (hash ^ Math.imul(normaliseSeed(seed), 0x85ebca6b)) | 0;
}

/** A stream for one named purpose within one groove. */
export function streamFor(seed: number, ...labels: (string | number)[]): Rng {
  return createRng(derive(seed, ...labels));
}

/**
 * A fresh seed to show the visitor.
 *
 * The one place in the application allowed to be non-deterministic, and it has to be:
 * "give me something I have not heard" cannot come from the thing it is trying to
 * escape. Everything downstream of it is reproducible from the number it returns.
 */
export function randomSeed(): number {
  return MIN_SEED + Math.floor(Math.random() * (MAX_SEED - MIN_SEED + 1));
}

/** `seed` brought into the displayed range, so a stored or typed value is always usable. */
export function clampSeed(seed: number): number {
  if (!Number.isFinite(seed)) return MIN_SEED;
  const whole = Math.trunc(seed);
  const span = MAX_SEED - MIN_SEED + 1;
  return MIN_SEED + ((((whole - MIN_SEED) % span) + span) % span);
}

/**
 * Choose `count` items by weight, without replacement.
 *
 * The heart of placement. Generation decides *how many* events a track should have and
 * *how much each step deserves one*, and this turns those two into a set of steps.
 * Roulette-wheel selection with the chosen item removed each time, so a heavily
 * weighted step is likely but never certain — which is what keeps two seeds at the same
 * settings from producing the same bar.
 *
 * Zero and negative weights are never chosen. If fewer than `count` items have any
 * weight at all, fewer are returned rather than the floor being fudged upwards.
 */
export function weightedChoice(rng: Rng, weights: readonly number[], count: number): number[] {
  const remaining = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const chosen: number[] = [];

  for (let taken = 0; taken < count; taken += 1) {
    let total = 0;
    for (const weight of remaining) total += weight;
    if (total <= 0) break;

    let target = rng.next() * total;
    let index = remaining.length - 1;
    for (let i = 0; i < remaining.length; i += 1) {
      target -= remaining[i] ?? 0;
      if (target <= 0) {
        index = i;
        break;
      }
    }

    chosen.push(index);
    remaining[index] = 0;
  }

  return chosen.sort((a, b) => a - b);
}
