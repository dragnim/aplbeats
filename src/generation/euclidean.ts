/*
 * Even distribution: Bjorklund's algorithm.
 *
 * Given `pulses` events to place in `steps` positions, spread them as evenly as the
 * arithmetic allows. When the two divide, the answer is obvious. When they do not —
 * five in sixteen, three in eight — the answer is the pattern that a great deal of the
 * world's music independently arrived at, which is why Godfried Toussaint called these
 * the Euclidean rhythms.
 *
 * E(3,8) is the tresillo. E(5,8) is the cinquillo. E(2,5), E(5,12), E(7,16) are all
 * things you have heard.
 *
 * This is kept in its own file, small and free of everything else, because it is the
 * clearest thing in APL Beats to show as an array operation later: the whole of it is
 * one line of APL, and the contrast between that line and the recursion below is a
 * large part of the point of the project. Nothing here knows about tracks, presets or
 * grooves.
 */

/**
 * `pulses` events distributed as evenly as possible across `steps` positions.
 *
 * The classical formulation, expressed as the recursion it actually is: repeatedly take
 * the remainder off the end and fold it into the front, which is Euclid's algorithm for
 * the greatest common divisor with the quotients kept.
 *
 * Always begins on step zero, which is the convention and is also what makes it useful
 * musically — the rotation is applied afterwards, on purpose, because *which* rotation
 * is a musical decision and evenness is not.
 */
export function euclideanPattern(pulses: number, steps: number): boolean[] {
  const total = Math.max(0, Math.trunc(steps));
  const wanted = Math.max(0, Math.trunc(pulses));

  if (total === 0) return [];
  if (wanted <= 0) return Array.from({ length: total }, () => false);
  if (wanted >= total) return Array.from({ length: total }, () => true);

  // Groups of "one event" and "one rest", repeatedly balanced against each other.
  let front: boolean[][] = Array.from({ length: wanted }, () => [true]);
  let back: boolean[][] = Array.from({ length: total - wanted }, () => [false]);

  while (back.length > 1) {
    const pairs = Math.min(front.length, back.length);
    const merged: boolean[][] = [];
    for (let i = 0; i < pairs; i += 1) {
      merged.push([...(front[i] ?? []), ...(back[i] ?? [])]);
    }

    const leftovers = front.length > pairs ? front.slice(pairs) : back.slice(pairs);
    front = merged;
    back = leftovers;
  }

  return [...front, ...back].flat();
}

/**
 * `pattern` rotated left by `by` places, wrapping.
 *
 * Rotation is what turns one even distribution into a family of them. E(5,16) starting
 * on the downbeat is a clave; the same five events rotated by two is a different figure
 * entirely, and rotating each track differently is most of what stops a Euclidean kit
 * sounding like eight metronomes agreeing.
 */
export function rotate<T>(pattern: readonly T[], by: number): T[] {
  const length = pattern.length;
  if (length === 0) return [];
  const shift = ((by % length) + length) % length;
  return [...pattern.slice(shift), ...pattern.slice(0, shift)];
}

/** The step indices of a Boolean pattern, for callers that want positions rather than a mask. */
export function stepsOf(pattern: readonly boolean[]): number[] {
  const steps: number[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === true) steps.push(index);
  }
  return steps;
}

/** `pulses` events across `steps`, rotated: the form the generator actually asks for. */
export function euclideanSteps(pulses: number, steps: number, rotation = 0): number[] {
  return stepsOf(rotate(euclideanPattern(pulses, steps), rotation));
}
