/*
 * The transformations, the APL that performs them, and what they mean.
 *
 * Every operation appears three times in this file and that repetition is deliberate:
 *
 *   the APL that TryAPL actually executes, built from a template;
 *   a TypeScript reference implementation, used only by tests;
 *   a short explanation, shown in Peek.
 *
 * The reference implementations are **never** used in production. They exist so a test can
 * assert what the APL is supposed to mean, and so the equivalence between the two can be
 * checked without spending a request. If APL is unavailable, the operation is unavailable —
 * quietly substituting the TypeScript would make "Apply with APL" a lie, and the whole
 * point of this stage is that it is not one.
 *
 * ⎕IO←0 throughout. The application is zero-indexed, the grid is zero-indexed, and the
 * eight track rows and sixteen step columns line up with their JavaScript indices exactly —
 * so there is no +1 anywhere between the sequencer and the interpreter. It also makes the
 * arithmetic operations read the way they are meant to: `0=p|⍳16` picks out every pth step
 * *starting from the downbeat*, which under ⎕IO←1 it would not.
 */

import { STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import { TRACKS } from '@/pattern/tracks';
import { patternToAplLiteral } from './matrix';
import { DIAMOND } from './wire';

/** Zero-based, matching the grid. `⎕IO←0` is sent with every request. */
export const IO_ORIGIN = 0;

/*
 * Four, and a fifth that was built and then removed.
 *
 * `(s×⍳8)⌽m` — a vector left argument to ⌽, rotating every track by its own amount — was
 * implemented as "Stagger" and taken out again after the musical review, because it was the
 * best APL here and the worst music. Three things settled it. Under ⎕IO←0 the first row's
 * rotation is `s×0`, so the kick never moved at all, which is not what "shift each track a
 * little further than the one above" promises. The backbeat was lost at seven of its eight
 * settings. And the amount did not modulate a feel: ¯1 and 3 produced the same degree of
 * smear, so the control reshuffled rather than intensified. The evidence is reproducible with
 * `npm run review:transforms -- --stagger`, which still computes it.
 *
 * The brief made a fifth operation optional and conditional on it being genuinely worthwhile.
 * An operation whose defence is that the expression is elegant fails the only test this stage
 * actually set: make beats first.
 */
export const OPERATION_IDS = ['rotate', 'reverse', 'periodic', 'euclidean'] as const;
export type OperationId = (typeof OPERATION_IDS)[number];

/** `all` means every track at once; a number is a track row. */
export type Target = 'all' | number;

export interface ParameterSpec {
  readonly key: 'amount' | 'period' | 'pulses' | 'rotation';
  /** What the control is called. Never the APL variable name. */
  readonly label: string;
  readonly min: number;
  readonly max: number;
  /** Values that would make the operation a no-op, and are skipped by the control. */
  readonly excludeZero?: boolean;
  readonly defaultValue: number;
}

export interface Operation {
  readonly id: OperationId;
  /** Plain language, always visible. Never only a glyph. */
  readonly name: string;
  /** One line, in musical terms. Shown under the control. */
  readonly summary: string;
  readonly parameters: readonly ParameterSpec[];
  /**
   * Whether the operation may be applied to every track at once.
   *
   * False where it would be nonsense rather than merely unusual: Periodic and Euclidean
   * *replace* a row, so applying them to everything would make all eight tracks identical
   * — which is not a rhythm, it is a mistake with eight voices.
   */
  readonly allowsAllTracks: boolean;
  /**
   * Two or three short lines explaining the glyphs, shown in Peek.
   *
   * Compact on purpose. The code and the sound do most of the teaching; this is a caption,
   * not a lesson.
   */
  readonly explanation: readonly string[];
}

export type Parameters = Readonly<Partial<Record<ParameterSpec['key'], number>>>;

/* ------------------------------------------------------------------------- */

export const OPERATIONS: readonly Operation[] = [
  {
    id: 'rotate',
    name: 'Rotate',
    summary: 'Move the rhythm through time.',
    parameters: [{ key: 'amount', label: 'Steps', min: -8, max: 8, excludeZero: true, defaultValue: -1 }],
    allowsAllTracks: true,
    explanation: [
      '⌽ rotates an array. A negative amount moves it later, a positive one earlier.',
      'On the whole matrix it rotates every track along the time axis at once.',
    ],
  },
  {
    id: 'reverse',
    name: 'Reverse',
    summary: 'Play the pattern backwards.',
    parameters: [],
    allowsAllTracks: true,
    explanation: [
      '⌽ with nothing on its left reverses instead of rotating.',
      'The last sixteenth becomes the first.',
    ],
  },
  {
    id: 'periodic',
    name: 'Periodic',
    summary: 'A steady pulse, every few steps.',
    parameters: [
      { key: 'period', label: 'Every', min: 2, max: 8, defaultValue: 4 },
      { key: 'rotation', label: 'Shift', min: 0, max: 15, defaultValue: 0 },
    ],
    // Replaces the row outright, so every track would come out the same.
    allowsAllTracks: false,
    explanation: [
      '⍳ makes the step numbers 0 to 15.',
      '| takes the remainder, and 0= keeps the steps that divide exactly.',
    ],
  },
  {
    id: 'euclidean',
    name: 'Euclidean',
    summary: 'Spread the hits as evenly as the count allows.',
    parameters: [
      { key: 'pulses', label: 'Hits', min: 1, max: 16, defaultValue: 5 },
      { key: 'rotation', label: 'Shift', min: 0, max: 15, defaultValue: 0 },
    ],
    allowsAllTracks: false,
    explanation: [
      'k×⍳16 counts up in steps of k, and 16| wraps it round the bar.',
      'k> keeps a hit wherever the count wrapped — which spreads them evenly.',
    ],
  },
];

const BY_ID: Readonly<Record<OperationId, Operation>> = Object.fromEntries(
  OPERATIONS.map((operation) => [operation.id, operation]),
) as Record<OperationId, Operation>;

export function operationById(id: string): Operation {
  return (BY_ID as Record<string, Operation | undefined>)[id] ?? OPERATIONS[0]!;
}

export function isOperationId(value: unknown): value is OperationId {
  return typeof value === 'string' && Object.hasOwn(BY_ID, value);
}

/* ------------------------------------------------------------------------- */

/**
 * A number as APL writes it.
 *
 * Negatives take the high minus, `¯`, which is part of the numeric literal rather than an
 * operator. Sending `-1` would parse as *negate one* — which happens to give the same value
 * here, but would be wrong the moment it sat beside anything else, and would be wrong in
 * Peek, where the whole purpose is to show APL as APL is written.
 */
export function aplNumber(value: number): string {
  const whole = Math.trunc(value);
  return whole < 0 ? `¯${String(Math.abs(whole))}` : String(whole);
}

/**
 * A parameter, brought inside its declared range.
 *
 * Every number reaching the source builder passes through here. Nothing from the interface
 * is ever spliced into APL as text — the controls produce numbers, the numbers are clamped
 * to a range declared in this file, and only then are they formatted. That is what makes
 * "no arbitrary APL" a property of the code rather than a promise about the UI.
 */
export function clampParameter(spec: ParameterSpec, value: number | undefined): number {
  const raw = value ?? spec.defaultValue;
  if (!Number.isFinite(raw)) return spec.defaultValue;

  let clamped = Math.min(spec.max, Math.max(spec.min, Math.round(raw)));
  if (spec.excludeZero === true && clamped === 0) {
    // Step past zero in the direction the value was heading, so a slider dragged through
    // the middle does not stall there.
    clamped = raw < 0 ? -1 : 1;
  }
  return clamped;
}

/** Every parameter for an operation, clamped, with defaults filled in. */
export function resolveParameters(operation: Operation, parameters: Parameters): Parameters {
  const resolved: Record<string, number> = {};
  for (const spec of operation.parameters) {
    resolved[spec.key] = clampParameter(spec, parameters[spec.key]);
  }
  return resolved;
}

/** Whether a target is usable for an operation. */
export function isValidTarget(operation: Operation, target: Target): boolean {
  if (target === 'all') return operation.allowsAllTracks;
  return Number.isInteger(target) && target >= 0 && target < TRACK_COUNT;
}

/** The target an operation should fall back to when the current one does not suit it. */
export function defaultTargetFor(operation: Operation, current: Target): Target {
  if (isValidTarget(operation, current)) return current;
  if (operation.allowsAllTracks) return 'all';
  // Periodic and Euclidean replace a row, so "all tracks" becomes a single track — the one
  // that was already chosen if there was one, and the kick if there was not.
  return typeof current === 'number' ? current : 0;
}

/** How a target reads in the interface. */
export function targetName(target: Target): string {
  return target === 'all' ? 'All tracks' : (TRACKS[target]?.name ?? `Track ${String(target)}`);
}

/* ------------------------------------------------------------------------- */

export interface SourceRequest {
  readonly operation: Operation;
  readonly target: Target;
  readonly parameters: Parameters;
  readonly pattern: Pattern;
}

export interface AplSource {
  /**
   * The interesting part, shown in Peek as "Core APL".
   *
   * The expression that does the work, with no transport around it — which is the thing
   * worth reading, and the thing worth learning.
   */
  readonly core: string;
  /** Every statement, in order, as they are sent. */
  readonly statements: readonly string[];
  /** What is actually POSTed: the statements joined with `⋄`. */
  readonly expression: string;
}

/**
 * The APL for one transform.
 *
 * Four statements. Set the index origin; write the pattern down as a matrix; transform it;
 * hand the matrix back as the result. Only the third is interesting, which is why Peek shows
 * it on its own and offers the rest separately.
 */
export function buildAplSource({ operation, target, parameters, pattern }: SourceRequest): AplSource {
  const resolved = resolveParameters(operation, parameters);
  const core = buildCore(operation, target, resolved);

  const assignment = target === 'all' ? `m←${core}` : `m[${aplNumber(target)};]←${core}`;

  const statements = [`⎕IO←${String(IO_ORIGIN)}`, `m←${patternToAplLiteral(pattern)}`, assignment, 'm'];

  return { core, statements, expression: statements.join(` ${DIAMOND} `) };
}

/** The expression that does the work, without the transport around it. */
function buildCore(operation: Operation, target: Target, parameters: Parameters): string {
  const subject = target === 'all' ? 'm' : `m[${aplNumber(target)};]`;

  switch (operation.id) {
    case 'rotate':
      return `${aplNumber(parameters.amount ?? 0)}⌽${subject}`;

    case 'reverse':
      return `⌽${subject}`;

    case 'periodic': {
      const period = aplNumber(parameters.period ?? 4);
      const pulse = `0=${period}|⍳${String(STEP_COUNT)}`;
      return withRotation(pulse, parameters.rotation);
    }

    case 'euclidean': {
      /*
       * `k>16|k×⍳16`.
       *
       * Counting up in steps of k and wrapping at the bar gives a hit wherever the count
       * came round — which distributes k hits across sixteen steps as evenly as the
       * arithmetic allows. Checked exhaustively against the Stage 2 Bjorklund
       * implementation: eleven of the seventeen pulse counts are identical to it and the
       * other six are the same rhythm at a different rotation, with the gap structure — never
       * more than two distinct gap lengths, differing by one — holding throughout. See
       * `scripts/check-euclidean.ts`.
       */
      const pulses = aplNumber(parameters.pulses ?? 5);
      const steps = String(STEP_COUNT);
      const pulse = `${pulses}>${steps}|${pulses}×⍳${steps}`;
      return withRotation(pulse, parameters.rotation);
    }
  }
}

function withRotation(expression: string, rotation: number | undefined): string {
  const by = rotation ?? 0;
  return by === 0 ? expression : `${aplNumber(by)}⌽${expression}`;
}
