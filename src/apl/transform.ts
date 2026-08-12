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

    const key = cacheKey(request);
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
