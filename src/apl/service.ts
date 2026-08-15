/*
 * One APL request, from a question to a validated pattern.
 *
 * The layer between the interface and the network, and the place the request discipline
 * lives. TryAPL is somebody else's infrastructure and this application has promised not to
 * treat it as a clock, so the rules are enforced here rather than hoped for at the call
 * sites:
 *
 *   a request happens only when one of these methods is called, and they are called only from
 *   buttons;
 *
 *   an identical question — the same one, however it was asked — is answered from a small
 *   in-memory cache and makes no request at all;
 *
 *   nothing retries. A failure is a failure, reported once.
 *
 * Three kinds of question arrive here and they share everything that matters. A *transform*
 * changes a bar with one of the built-in operations. A *custom* expression is one somebody
 * typed in Explore. A *generation* asks a recipe for a bar there was not one of before. The
 * client, the timeout, the cache, the parser and the refusal to accept a partial answer are the
 * same for all three, and a second service with its own copy of those rules would be a second
 * set of rules to keep in step — which they would not have stayed.
 *
 * That is also why this is `AplService` and not `TransformService`. It stopped being a
 * transform service the moment it could make a rhythm rather than only change one, and a name
 * that needs a comment explaining what it really does is a name that should have changed.
 *
 * Everything about *when* to call this belongs to `useApl`. Everything about what a
 * valid answer looks like belongs to `matrix.ts`. This is the join.
 */

import { patternsEqual, type Pattern } from '@/pattern/pattern';
import { AplError, type AplClient } from './client';
import { buildCustomSource } from './custom';
import {
  APL_GENERATOR_VERSION,
  buildGenerateSource,
  normaliseLockedRows,
  type LockedRows,
  type Recipe,
} from './generators';
import { clampSeed } from '@/generation/prng';
import { parseAplMatrix } from './matrix';
import {
  buildAplSource,
  isValidTarget,
  resolveParameters,
  type Operation,
  type Parameters,
  type Target,
  type AplSource,
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
  /**
   * The seed `⎕RL` is fixed to, when the expression needs one.
   *
   * Absent for an ordinary Explore expression, which is how Stage 5 worked and still works.
   * Present for one loaded from Create, because a generator uses `?` and the seed decides its
   * answer as surely as the expression does.
   *
   * Which makes it part of this request's *identity*, not decoration — see `customIdentityKey`.
   */
  readonly randomSeed?: number;
}

/**
 * Everything that decides what a hand-written expression will answer.
 *
 * Written down once, and once only, because there are two questions that need it and they must
 * never disagree: *have I already computed this?* — the cache — and *is the reply still the one
 * that was asked for?* — staleness. Stage 6 shipped with those two derived separately, and they
 * drifted immediately: the seed reached the request through `buildCustomSource` but neither the
 * cache key nor the staleness check knew about it. So the same expression at a different seed
 * was answered from cache with the wrong rhythm, and a reply computed for one target could
 * install into another.
 *
 * The pattern is deliberately *not* here. It is part of the cache key, because the same
 * expression against a different bar is a different question — but staleness compares patterns
 * by value elsewhere, so that a bar edited and undone is still answerable. These are the parts
 * both questions treat identically.
 *
 * The seed is normalised the same way `buildCustomSource` normalises it, through `clampSeed`,
 * so that two requests which would send byte-identical APL have byte-identical identities. And
 * *no* random context is its own value rather than a missing one: an unseeded expression and a
 * seeded one are different questions even when the seed happens to be 1.
 */
export function customIdentityKey(request: {
  readonly core: string;
  readonly target: Target;
  readonly randomSeed?: number | null;
}): string {
  const seed =
    request.randomSeed === undefined || request.randomSeed === null
      ? 'none'
      : String(clampSeed(request.randomSeed));

  return `${String(request.target)}|rl=${seed}|${request.core}`;
}

export interface TransformOutcome {
  readonly pattern: Pattern;
  readonly source: AplSource;
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
 *
 * The identity above plus the bar it runs against. Built from `customIdentityKey` rather than
 * from the fields directly, so that the cache and the staleness check cannot start disagreeing
 * about what makes two custom runs the same run.
 */
export function customCacheKey(request: CustomRequest): string {
  const bits = request.pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('');
  return `custom|${customIdentityKey(request)}|${bits}`;
}

/**
 * A generation, from a recipe and a seed.
 *
 * Unlike the other two this does not need a bar to work on — a recipe makes one. The current
 * pattern is here only because a *locked* row has to be preserved from it, and that distinction
 * is what the cache key below is built around.
 */
export interface GenerateRequest {
  readonly recipe: Recipe;
  /** Clamped to 1–999999 by the source builder before it reaches APL. */
  readonly seed: number;
  readonly pattern: Pattern;
  readonly lockedRows: LockedRows;
}

/**
 * The key for a generation, and the one that took the most thought.
 *
 * What a generated bar actually depends on is the version, the recipe, the seed, which rows are
 * locked, and *what is in those locked rows*. It does not depend on the rest of the current
 * pattern at all, because the recipe never reads it: with nothing locked the request does not
 * even mention it.
 *
 * So the key includes only the locked rows' contents, and that is a real behaviour rather than
 * a micro-optimisation. Generate with nothing locked, edit a hat, press Generate again — the
 * answer is the one already in hand and no request is made, which is correct, because the same
 * recipe under the same seed would have computed exactly that. Lock the kick and change the
 * kick, and the key moves, because now the answer genuinely would be different.
 *
 * Prefixed so it cannot collide with a transform or a custom expression, and versioned so a
 * future change to a recipe expression cannot be answered out of a cache filled by the old one.
 */
export function generateCacheKey(request: GenerateRequest): string {
  const locks = normaliseLockedRows(request.lockedRows);
  const lockedBits = locks
    .map((row) => `${String(row)}:${(request.pattern[row] ?? []).map((cell) => (cell ? '1' : '0')).join('')}`)
    .join(',');

  return `generate|v${String(APL_GENERATOR_VERSION)}|${request.recipe.id}|${String(
    clampSeed(request.seed),
  )}|${lockedBits}`;
}

export class AplService {
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

    const source = buildAplSource({
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
   * Ask a recipe for a rhythm.
   *
   * The one method here that can return a bar nobody has heard before, and otherwise identical
   * to the other two: same client, same cache, same parser, same refusal to accept anything but
   * a complete 8 × 16 of zeroes and ones. If it fails, the caller leaves the beat exactly as it
   * was — there is no local generator behind this, and that is the entire point of the feature.
   */
  async runGenerate(request: GenerateRequest, signal?: AbortSignal): Promise<TransformOutcome> {
    const source = buildGenerateSource({
      recipe: request.recipe,
      seed: request.seed,
      pattern: request.pattern,
      lockedRows: request.lockedRows,
    });

    return this.execute(generateCacheKey(request), source, signal);
  }

  /**
   * The lane both of them run in.
   *
   * Cache, execute, parse, remember — in that order, and identically whichever kind of request
   * arrived. There is deliberately no third outcome: no partial result, no best effort, and
   * above all no local computation standing in for a failed request.
   */
  private async execute(key: string, source: AplSource, signal?: AbortSignal): Promise<TransformOutcome> {
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
     * decides; see `useApl`.
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

  /** The same, for a generation. Read by tests, and by nothing that makes a request. */
  hasGenerate(request: GenerateRequest): boolean {
    return this.cache.has(generateCacheKey(request));
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
