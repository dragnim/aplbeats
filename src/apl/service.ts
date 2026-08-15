/*
 * One APL request, from a question to a validated answer.
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
 * Three kinds of question arrive here, in two layers, and all six share everything that matters.
 * A *transform* changes what is there with one of the built-in operations. A *custom* expression
 * is one somebody typed in Explore. A *generation* asks a recipe for something there was not one
 * of before. Each exists for Beats and for Tones. The client, the timeout, the cache and the
 * refusal to accept a partial answer are the same for all six, and a second service with its own
 * copy of those rules would be a second set of rules to keep in step — which they would not have
 * stayed.
 *
 * The one thing that is *not* shared is the parser, and it must not be: a rhythm is eight rows of
 * ones and zeros and a melody is one row of MIDI numbers, so there is exactly one place where the
 * two paths differ and it is the six lines that read the reply. Everything above that — when a
 * request is allowed, what makes two questions the same question, what happens when TryAPL says
 * no — is one code path on purpose.
 *
 * The answers are tagged rather than merely differently shaped. `AplOutcome` is a discriminated
 * union on `domain`, so the caller cannot install a melody as a rhythm even by accident: the
 * field it would have to read does not exist on the other kind.
 *
 * That is also why this is `AplService` and not `TransformService`. It stopped being a
 * transform service the moment it could make a rhythm rather than only change one, and a name
 * that needs a comment explaining what it really does is a name that should have changed.
 *
 * Everything about *when* to call this belongs to `useApl`. What a valid rhythm looks like
 * belongs to `matrix.ts` and what a valid melody looks like belongs to `tones/phrase.ts`. This
 * is the join.
 */

import { patternsEqual, type Pattern } from '@/pattern/pattern';
import { AplError, type AplClient } from './client';
import { buildCustomSource, buildToneCustomSource } from './custom';
import {
  APL_GENERATOR_VERSION,
  buildGenerateSource,
  normaliseLockedRows,
  type LockedRows,
  type Recipe,
} from './generators';
import { clampSeed } from '@/generation/prng';
import { parseAplMatrix } from './matrix';
import { parseAplPhrase, phrasesEqual, type Phrase } from '@/tones/phrase';
import {
  buildToneGenerateSource,
  clampRoot,
  TONE_GENERATOR_VERSION,
  type ToneRecipe,
  type ToneScale,
} from './toneGenerators';
import { buildToneSource, type ToneOperation } from './toneOperations';
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

/**
 * What every answer carries, whichever layer asked.
 *
 * Split out so the two outcome types below cannot drift on the parts that have nothing to do
 * with the music: where the answer came from, how long it took, and what was sent.
 */
interface OutcomeMeta {
  readonly source: AplSource;
  /** Whether this came from the cache rather than from TryAPL. */
  readonly cached: boolean;
  /** Round trip in milliseconds. Zero for a cached answer. */
  readonly durationMs: number;
}

/**
 * A rhythm, back from APL.
 *
 * The `domain` tag is not decoration. Both layers run through one service, one client, one cache
 * and one busy lane — which is the design and not an accident — so the *only* thing keeping a
 * melody from being installed as a rhythm is that these two types cannot be mistaken for one
 * another. `outcome.pattern` does not exist on a Tone answer, and TypeScript says so at the one
 * place it matters: the `if` in `useApl` that decides what to do with a reply.
 */
export interface TransformOutcome extends OutcomeMeta {
  readonly domain: 'beats';
  readonly pattern: Pattern;
}

/** A melody, back from APL. Sixteen numbers, already validated by `parseAplPhrase`. */
export interface ToneOutcome extends OutcomeMeta {
  readonly domain: 'tones';
  readonly phrase: Phrase;
}

export type AplOutcome = TransformOutcome | ToneOutcome;

/** Which layer a request belongs to. The tag on every outcome, named for the places that pass it. */
export type AplDomain = AplOutcome['domain'];

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

/* ------------------------------------------------------------------------- */

/**
 * A melody transform: one of the four operations, applied to the phrase in hand.
 *
 * No target. A melody is one line, so there is nothing to choose between "this track" and "all
 * tracks" — the field that would have carried the choice is absent rather than present and
 * ignored, which is the difference between a type that describes the domain and a type that
 * describes the other domain with holes in it.
 */
export interface ToneTransformRequest {
  readonly operation: ToneOperation;
  readonly parameters: Parameters;
  readonly phrase: Phrase;
}

/** A generated melody: a recipe, a root, a scale and a seed. Needs no current phrase at all. */
export interface ToneGenerateRequest {
  readonly recipe: ToneRecipe;
  readonly root: number;
  readonly scale: ToneScale;
  /** Clamped to 1–999999 by the source builder before it reaches APL. */
  readonly seed: number;
}

/** A hand-written melody expression, from the Tones side of Explore. */
export interface ToneCustomRequest {
  /** Exactly what the editor holds, trimmed. Never rewritten. */
  readonly core: string;
  readonly phrase: Phrase;
  /** The seed `⎕RL` is fixed to, when the expression needs one. See `customIdentityKey`. */
  readonly randomSeed?: number;
}

/** A melody as cache-key text: sixteen numbers, comma separated. */
function phraseBits(phrase: Phrase): string {
  return phrase.join(',');
}

/**
 * The key for a melody transform.
 *
 * Prefixed `tone`, so nothing on this side can ever collide with a rhythm — which matters more
 * here than it looks, because the two share one cache and a collision would hand a melody back
 * as a rhythm or the reverse.
 */
export function toneCacheKey(request: ToneTransformRequest): string {
  const parameters = Object.keys(request.parameters)
    .sort()
    .map((key) => `${key}=${String(request.parameters[key as keyof Parameters] ?? 0)}`)
    .join(',');

  return `tone|${request.operation.id}|${parameters}|${phraseBits(request.phrase)}`;
}

/**
 * The key for a generated melody.
 *
 * Versioned, and the version is the Tone one: what a Tone recipe and seed mean has nothing to do
 * with what a rhythm recipe and seed mean, so they move independently.
 *
 * The current phrase is deliberately absent. A Tone recipe never reads what is already there —
 * there is no equivalent of a locked row — so generating, editing a note, and generating again at
 * the same settings is answered from cache and makes no request. Which is correct: the same
 * recipe under the same seed would have computed exactly that.
 */
export function toneGenerateCacheKey(request: ToneGenerateRequest): string {
  return `tone-generate|v${String(TONE_GENERATOR_VERSION)}|${request.recipe.id}|${
    request.scale.id
  }|${String(clampRoot(request.root))}|${String(clampSeed(request.seed))}`;
}

/** The identity of a hand-written melody expression: the Tone half of `customIdentityKey`. */
export function toneCustomIdentityKey(request: {
  readonly core: string;
  readonly randomSeed?: number | null;
}): string {
  const seed =
    request.randomSeed === undefined || request.randomSeed === null
      ? 'none'
      : String(clampSeed(request.randomSeed));

  return `rl=${seed}|${request.core}`;
}

export function toneCustomCacheKey(request: ToneCustomRequest): string {
  return `tone-custom|${toneCustomIdentityKey(request)}|${phraseBits(request.phrase)}`;
}

/* ------------------------------------------------------------------------- */

/**
 * What the cache holds.
 *
 * Tagged for the same reason the outcomes are: one cache, two kinds of music, and a key prefix
 * is a convention while a discriminated union is a rule. If a Tone key ever did collide with a
 * Beats key, this turns a wrong rhythm into a cache miss.
 */
type CachedAnswer =
  | { readonly domain: 'beats'; readonly pattern: Pattern }
  | { readonly domain: 'tones'; readonly phrase: Phrase };

export class AplService {
  private readonly client: AplClient;
  private readonly cache = new Map<string, CachedAnswer>();

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

  /* ---- Tones ------------------------------------------------------------- */

  /**
   * Transform a melody with APL.
   *
   * The same lane as everything else — same client, same cache, same timeout, same refusal to
   * accept a partial answer — and a different parser, because a melody is not a matrix. If it
   * fails the caller leaves the melody exactly as it was.
   */
  async runTone(request: ToneTransformRequest, signal?: AbortSignal): Promise<ToneOutcome> {
    const source = buildToneSource(request);
    return this.executeTone(toneCacheKey(request), source, signal);
  }

  /** Ask a recipe for a melody. */
  async runToneGenerate(request: ToneGenerateRequest, signal?: AbortSignal): Promise<ToneOutcome> {
    const source = buildToneGenerateSource(request);
    return this.executeTone(toneGenerateCacheKey(request), source, signal);
  }

  /** Run a hand-written melody expression, from the Tones side of Explore. */
  async runToneCustom(request: ToneCustomRequest, signal?: AbortSignal): Promise<ToneOutcome> {
    const source = buildToneCustomSource(request);
    return this.executeTone(toneCustomCacheKey(request), source, signal);
  }

  /* ---- the lane ---------------------------------------------------------- */

  /**
   * The lane all six of them run in.
   *
   * Cache, execute, parse, remember — in that order, and identically whichever kind of request
   * arrived. There is deliberately no third outcome: no partial result, no best effort, and
   * above all no local computation standing in for a failed request.
   *
   * Split into a Beats half and a Tones half at the *parser* only. Everything above the parse is
   * the same code path, which is the whole reason there is one service rather than two.
   */
  private async execute(key: string, source: AplSource, signal?: AbortSignal): Promise<TransformOutcome> {
    const remembered = this.recall(key);
    if (remembered?.domain === 'beats') {
      return { domain: 'beats', pattern: remembered.pattern, source, cached: true, durationMs: 0 };
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
    this.remember(key, { domain: 'beats', pattern: parsed.pattern });

    return {
      domain: 'beats',
      pattern: parsed.pattern,
      source,
      cached: false,
      durationMs: execution.durationMs,
    };
  }

  private async executeTone(key: string, source: AplSource, signal?: AbortSignal): Promise<ToneOutcome> {
    const remembered = this.recall(key);
    if (remembered?.domain === 'tones') {
      return { domain: 'tones', phrase: remembered.phrase, source, cached: true, durationMs: 0 };
    }

    const execution = await this.client.execute(source.expression, signal);

    const parsed = parseAplPhrase(execution.outputLines);
    if (!parsed.ok) {
      throw new AplError(
        'badResponse',
        'APL sent something unexpected. Your melody was not changed.',
        parsed.reason,
      );
    }

    this.remember(key, { domain: 'tones', phrase: parsed.phrase });

    return {
      domain: 'tones',
      phrase: parsed.phrase,
      source,
      cached: false,
      durationMs: execution.durationMs,
    };
  }

  /** A remembered answer, moved to the end so the most recently useful is the last to be dropped. */
  private recall(key: string): CachedAnswer | undefined {
    const remembered = this.cache.get(key);
    if (remembered === undefined) return undefined;
    this.cache.delete(key);
    this.cache.set(key, remembered);
    return remembered;
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

  /** The same three, for melodies. */
  hasTone(request: ToneTransformRequest): boolean {
    return this.cache.has(toneCacheKey(request));
  }

  hasToneGenerate(request: ToneGenerateRequest): boolean {
    return this.cache.has(toneGenerateCacheKey(request));
  }

  hasToneCustom(request: ToneCustomRequest): boolean {
    return this.cache.has(toneCustomCacheKey(request));
  }

  private remember(key: string, answer: CachedAnswer): void {
    this.cache.set(key, answer);
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

/** The same rule, for a melody. Compared by value, for the same reason. */
export function isPhraseStillApplicable(basedOn: Phrase, current: Phrase): boolean {
  return phrasesEqual(basedOn, current);
}
