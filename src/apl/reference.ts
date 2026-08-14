/*
 * What the APL is supposed to mean, in TypeScript.
 *
 * **Nothing in the application imports this.** It is imported by tests and by the live
 * verification script, and by nothing else — which is checked by a test, because the whole
 * credibility of Stage 3 rests on it: if a transform could quietly fall back to these
 * functions, then "Apply with APL" would be decoration and the project would be a drum
 * machine with a costume.
 *
 * What they are for is proving what the expressions do. `¯3⌽v` either moves a rhythm three
 * steps later or it does not, and asserting that against a second implementation is a far
 * better test than asserting it against a fixture nobody can check by eye. They also let the
 * live verification compare real APL output against an expectation computed locally, which is
 * what makes four live requests enough to prove that the APL does what the interface claims.
 */

import { STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import type { Operation, Parameters, Target } from './operations';
import { resolveParameters } from './operations';

/** `n⌽v` — rotate left by n. Negative moves right, which musically means later. */
export function rotateVector(row: readonly boolean[], by: number): boolean[] {
  const length = row.length;
  if (length === 0) return [];
  const shift = ((Math.trunc(by) % length) + length) % length;
  return Array.from({ length }, (_unused, index) => row[(index + shift) % length] === true);
}

/** `⌽v` — reverse. */
export function reverseVector(row: readonly boolean[]): boolean[] {
  return [...row].reverse().map((cell) => cell === true);
}

/** `0=p|⍳16` — a hit on every step divisible by p, counting from the downbeat. */
export function periodicVector(period: number, steps = STEP_COUNT): boolean[] {
  const p = Math.max(1, Math.trunc(period));
  return Array.from({ length: steps }, (_unused, index) => index % p === 0);
}

/** `k>16|k×⍳16` — k hits spread as evenly across the bar as the arithmetic allows. */
export function euclideanVector(pulses: number, steps = STEP_COUNT): boolean[] {
  const k = Math.max(0, Math.trunc(pulses));
  return Array.from({ length: steps }, (_unused, index) => (k * index) % steps < k);
}

/**
 * The whole transform, as the APL would perform it.
 *
 * Mirrors `buildAplSource` statement for statement: resolve the parameters, compute the
 * core expression, then either replace one row or the whole matrix.
 */
export function applyReferenceTransform(
  operation: Operation,
  target: Target,
  parameters: Parameters,
  pattern: Pattern,
): Pattern {
  const resolved = resolveParameters(operation, parameters);
  const rows = pattern.map((row) => [...row].map((cell) => cell === true));

  const rotation = resolved.rotation ?? 0;

  switch (operation.id) {
    case 'rotate': {
      const by = resolved.amount ?? 0;
      if (target === 'all') return rows.map((row) => rotateVector(row, by));
      return replaceRow(rows, target, rotateVector(rows[target] ?? [], by));
    }

    case 'reverse': {
      if (target === 'all') return rows.map((row) => reverseVector(row));
      return replaceRow(rows, target, reverseVector(rows[target] ?? []));
    }

    case 'periodic': {
      const pulse = rotateVector(periodicVector(resolved.period ?? 4), rotation);
      if (target === 'all') return rows.map(() => [...pulse]);
      return replaceRow(rows, target, pulse);
    }

    case 'euclidean': {
      const pulse = rotateVector(euclideanVector(resolved.pulses ?? 5), rotation);
      if (target === 'all') return rows.map(() => [...pulse]);
      return replaceRow(rows, target, pulse);
    }
  }
}

function replaceRow(rows: boolean[][], track: number, row: readonly boolean[]): Pattern {
  if (!Number.isInteger(track) || track < 0 || track >= TRACK_COUNT) return rows;
  return rows.map((existing, index) => (index === track ? [...row] : existing));
}
