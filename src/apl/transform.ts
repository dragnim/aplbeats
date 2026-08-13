/*
 * One transform, from a request to a validated pattern.
 *
 * The layer between the interface and the network, and the place the request discipline
 * lives. TryAPL is somebody else's infrastructure and this application has promised not to
 * treat it as a clock, so the rules are enforced here rather than hoped for at the call
 * sites:
 *
 *   a transform happens only when this function is called, and it is called only from a
 *   button;
 *
 *   an identical request — same pattern, same operation, same target, same parameters, same
 *   generator of source — is answered from a small in-memory cache and makes no request at
 *   all;
 *
 *   nothing retries. A failure is a failure, reported once.
 *
 * Everything about *when* to call this belongs to `useTransform`. Everything about what a
 * valid answer looks like belongs to `matrix.ts`. This is the join.
 */

import { patternsEqual, type Pattern } from '@/pattern/pattern';
import { AplError, type AplClient } from './client';
import { buildCustomSource } from './custom';
import { parseAplMatrix } from './matrix';
import {
  buildTransformSource,
  isValidTarget,
  resolveParameters,
  type Operation,
  type Parameters,
  type Target,
  type TransformSource,
} from './operations';

export interface TransformRequest {
  readonly operation: Operation;
  readonly target: Target;
  readonly parameters: Parameters;
  readonly pattern: Pattern;
}

/**
 * A hand-written expression, from Explore.
 *
 * Deliberately handled by this same service rather than by one of its own. Everything that
 * matters — the client, the timeout, the cache, the parser, the refusal to accept a partial
 * answer — is identical whether the APL was generated from a template or typed by a person,
 * and a second service with its own copy of those rules would be a second set of rules to keep
 * in step.
 */
export interface CustomRequest {
  /** Exactly what the editor holds, trimmed. Never rewritten. */
  readonly core: string;
  readonly target: Target;
  readonly pattern: Pattern;
}

export interface TransformOutcome {
  readonly pattern: Pattern;
  readonly source: TransformSource;
  /** Whether this came from the cache rather than from TryAPL. */
  readonly cached: boolean;
  /** Round trip in milliseconds. Zero for a cached answer. */
  readonly durationMs: number;
}

/**
 * How many answers to remember.
 *
 * Enough that pressing Apply, undoing, and pressing it again costs nothing, and that
 * stepping a rotation back and forth over a few values stays free. Small enough that it is
 * unmistakably a cache rather than storage: thirty-two patterns is four kilobytes.
 */
export const CACHE_LIMIT = 32;

/**
 * A key that changes whenever the answer would.
 *
 * The pattern is part of it, which is the whole point: the same operation on a different bar
 * is a different question. Serialised as the bits rather than hashed, because 128 characters
 * is nothing and a hash collision here would hand back the wrong rhythm.
 */
export function cacheKey(request: TransformRequest): string {
  const resolved = resolveParameters(request.operation, request.parameters);
  const parameters = Object.keys(resolved)
    .sort()
    .map((key) => `${key}=${String(resolved[key as keyof Parameters] ?? 0)}`)
    .join(',');

  const bits = request.pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('');

  return `${request.operation.id}|${String(request.target)}|${parameters}|${bits}`;
}

/**
 * The same idea for a hand-written expression.
 *
 * The expression goes in verbatim, whitespace and all. Normalising it would mean understanding
 * APL well enough to know which whitespace is meaningless, which this application does not and
 * should not claim to — and the cost of getting that wrong is handing back the answer to a
 * different program. Two spaces instead of one is a cache miss and one extra request, which is
 * a much better failure than a wrong rhythm.
 *
 * Prefixed, so a custom expression can never collide with a generated one.
 */
export function customCacheKey(request: CustomRequest): string {
  const bits = request.pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('');
  return `custom|${String(request.target)}|${request.core}|${bits}`;
}

export class TransformService {
  private readonly client: AplClient;
  private readonly cache = new Map<string, Pattern>();

  constructor(client: AplClient) {
    this.client = client;
  }

  /** How many answers are remembered. Read by tests. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** Abandon whatever is in flight. */
  cancel(): void {
    this.client.cancel();
  }

  /**
   * Transform a pattern with APL.
   *
   * Rejects with an `AplError` for every failure, and in every one of those cases the caller
   * leaves the current pattern alone. There is deliberately no third outcome — no partial
   * result, no "best effort", and above all no local computation standing in for a failed
   * request.
   */
  async run(request: TransformRequest, signal?: AbortSignal): Promise<TransformOutcome> {
    if (!isValidTarget(request.operation, request.target)) {
      throw new AplError(
        'badResponse',
        'That operation cannot be applied to that target.',
        `${request.operation.id} does not accept target ${String(request.target)}`,
      );
    }

    const source = buildTransformSource({
      operation: request.operation,
      target: request.target,
      parameters: request.parameters,
      pattern: request.pattern,
    });

    return this.execute(cacheKey(request), source, signal);
  }

  /**
   * Run a hand-written expression.
   *
   * Every target is valid here, unlike the built-in operations: Periodic and Euclidean refuse
   * "all tracks" because they replace a row and eight identical rows is not a rhythm, but a
   * person writing their own expression may perfectly well mean to build a whole matrix.
   */
  async runCustom(request: CustomRequest, signal?: AbortSignal): Promise<TransformOutcome> {
    const source = buildCustomSource(request);
    return this.execute(customCacheKey(request), source, signal);
  }

  /**
   * The lane both of them run in.
   *
   * Cache, execute, parse, remember — in that order, and identically whichever kind of request
   * arrived. There is deliberately no third outcome: no partial result, no best effort, and
   * above all no local computation standing in for a failed request.
   */
  private async execute(
    key: string,
    source: TransformSource,
    signal?: AbortSignal,
  ): Promise<TransformOutcome> {
    const remembered = this.cache.get(key);
    if (remembered !== undefined) {
      // Re-inserted so the most recently useful answer is the last to be dropped.
      this.cache.delete(key);
      this.cache.set(key, remembered);
      return { pattern: remembered, source, cached: true, durationMs: 0 };
    }

    const execution = await this.client.execute(source.expression, signal);

    const parsed = parseAplMatrix(execution.outputLines);
    if (!parsed.ok) {
      throw new AplError(
        'badResponse',
        'APL sent something unexpected. Your beat was not changed.',
        parsed.reason,
      );
    }

    /*
     * A transform that changed nothing is still a valid answer, and still worth caching —
     * but it must not become an Undo entry, so it is reported rather than hidden. The caller
     * decides; see `useTransform`.
     */
    this.remember(key, parsed.pattern);

    return { pattern: parsed.pattern, source, cached: false, durationMs: execution.durationMs };
  }

  /** Whether this exact request already has an answer. */
  has(request: TransformRequest): boolean {
    return this.cache.has(cacheKey(request));
  }

  /** The same, for a hand-written expression. */
  hasCustom(request: CustomRequest): boolean {
    return this.cache.has(customCacheKey(request));
  }

  private remember(key: string, pattern: Pattern): void {
    this.cache.set(key, pattern);
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next();
      if (oldest.done === true) break;
      this.cache.delete(oldest.value);
    }
  }
}

/**
 * Whether an answer is still wanted.
 *
 * The staleness rule, in one place. A transform is asynchronous, so between asking and
 * answering the visitor may have edited a cell, pressed Randomise, or undone something — and
 * a reply computed from a bar that no longer exists must not overwrite the bar that does.
 *
 * Compared by value rather than by a revision counter on purpose: if the pattern has come
 * back round to what the request was based on — edited and undone, say — then the answer is
 * still correct and there is no reason to throw it away.
 */
export function isStillApplicable(basedOn: Pattern, current: Pattern): boolean {
  return patternsEqual(basedOn, current);
}
