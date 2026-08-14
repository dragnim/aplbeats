import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadCreateSettings,
  loadExploreDraft,
  saveCreateSettings,
  saveExploreDraft,
  type ExploreContext,
} from '@/app/persistence';

import { clampSeed, randomSeed } from '@/generation/prng';
import { TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import {
  buildGenerateSource,
  DEFAULT_RECIPE_ID,
  normaliseLockedRows,
  recipeById,
  type LockedRows,
  type Recipe,
  type RecipeId,
} from './generators';
import { AplError, TryAplClient, type AplClient } from './client';
import { buildCustomSource, checkCustomExpression } from './custom';
import {
  defaultTargetFor,
  isValidTarget,
  operationById,
  OPERATIONS,
  resolveParameters,
  type Operation,
  type OperationId,
  type Parameters,
  type Target,
} from './operations';
import { buildAplSource, type AplSource } from './operations';
import { isStillApplicable, AplService, type TransformOutcome } from './service';

/*
 * When APL runs, and what the interface knows about it.
 *
 * This is the file that keeps the promise about TryAPL. Every rule about *when* a request may
 * be made lives here, in one place, where it can be read and counted:
 *
 *   exactly three functions can cause a request — `apply`, Explore's `run`, and Create's
 *   `generate` — and each is called from one button and from nowhere else;
 *
 *   changing the operation, the target, a parameter, the recipe or the seed changes state and
 *   nothing else. So does drawing a new seed, and so does opening Peek;
 *
 *   playback, the playhead, Randomise and editing the grid cannot reach this file at all;
 *
 *   a second press of *any* of the three while one is in flight is ignored rather than queued.
 *   One `busy` ref governs all of them, which is what makes "one execution lane" a property of
 *   the code rather than a convention between three call sites;
 *
 *   there are no retries and no polling anywhere.
 *
 * The last of those is worth stating plainly: there is no `setInterval`, no `setTimeout` that
 * re-requests, and no effect with a request in it. The two `setTimeout`s here write to
 * `localStorage` half a second after typing stops and cannot reach the network. A request is
 * caused by a click and by nothing else.
 *
 * Stage 6 added the third lane rather than a second hook. A `useGenerate` with its own client,
 * busy flag and cache would have been a second set of these rules to keep in step, and they
 * would not have stayed in step.
 */

export type TransformStatus = 'idle' | 'running' | 'applied' | 'failed' | 'unchanged';

/**
 * Which of the three ways in produced the current status.
 *
 * They share one request state — one busy flag, one counter, one cache — but they must not
 * claim each other's results. "Generated." appearing beside Transform because Explore
 * succeeded would be a small lie told constantly, so every panel checks this before showing
 * anything.
 */
export type RunKind = 'fixed' | 'custom' | 'generate';

/**
 * Where Explore's expression came from.
 *
 * Stage 5 had one answer and did not need to ask. Now there are two built-in sources that can
 * be loaded into the editor, and the origin decides three things: which controls a *pristine*
 * draft follows, whether the expression needs a random seed, and which "Load current…" button
 * makes sense beside it.
 */
export type ExploreOrigin = 'transform' | 'create';

export interface ExploreApi {
  /** Exactly what the editor holds. */
  readonly expression: string;
  /** Where the result is installed. Explore accepts every target, unlike the operations. */
  readonly target: Target;
  /**
   * Whether the editor is still following the fixed controls.
   *
   * Pristine, it mirrors the Core APL those controls generate, so moving Steps from ¯1 to ¯2
   * updates the editor and the visitor sees the connection. The first edit ends that, and from
   * then on nothing overwrites their draft except the button that says it will.
   */
  readonly isPristine: boolean;
  /** Why this expression cannot be run, if it cannot. Local; costs no request. */
  readonly problem: string | null;
  /** Whether Run would do anything. */
  readonly canRun: boolean;
  /** The whole request this expression would make, for the read-only Full request block. */
  readonly source: AplSource;
  readonly setExpression: (expression: string) => void;
  readonly setTarget: (target: Target) => void;
  /** Which built-in source this draft is following, or came from. */
  readonly origin: ExploreOrigin;
  /**
   * The seed this expression will run under, if it needs one.
   *
   * Shown in the intro, so nobody has to wonder why `?` repeats — and sent, so that running an
   * unedited generator reproduces the bar the Generate button made.
   */
  readonly randomSeed: number | null;
  /**
   * Follow a different built-in source, but only if there is nothing to lose.
   *
   * What "Edit this APL" calls. With a pristine draft it switches which controls the editor
   * mirrors; with an edited one it does nothing at all, because somebody's writing must not
   * disappear because they opened a Peek. The explicit `loadFrom` is how it is replaced.
   */
  readonly follow: (origin: ExploreOrigin) => void;
  /** Discard the draft and take the Core APL that source currently generates. Explicit only. */
  readonly loadFrom: (origin: ExploreOrigin) => void;
  /** Replace the draft with the Core APL the current origin generates. */
  readonly loadCurrent: () => void;
  /** The one thing in Explore that can cause a network request. */
  readonly run: () => void;
}

/**
 * Create with APL: the controls, and the one button that spends a request.
 *
 * Deliberately not merged with Randomise. Randomise is instant, local, deterministic and works
 * with the network unplugged; this is a deliberate act that asks Dyalog for a bar. Changing the
 * recipe or the seed makes no request whatsoever — only `generate` does, and only once per
 * press.
 */
export interface CreateApi {
  readonly recipe: Recipe;
  readonly seed: number;
  readonly setRecipe: (id: RecipeId) => void;
  readonly setSeed: (seed: number) => void;
  /** Another valid seed. Local, and it runs nothing. */
  readonly newSeed: () => void;
  /**
   * Whether generating could change anything.
   *
   * False when every track is locked, because then there is nothing APL is allowed to write and
   * the honest thing is a disabled button rather than a request that proves it.
   */
  readonly canGenerate: boolean;
  /** Why not, when not — for the status line beside the button. */
  readonly blockedReason: string | null;
  /** The whole request this would make, for Peek. Never sent unless Generate is pressed. */
  readonly source: AplSource;
  /** The one thing in Create that can cause a network request. */
  readonly generate: () => void;
}

export interface TransformState {
  readonly operation: Operation;
  readonly target: Target;
  readonly parameters: Parameters;
  readonly status: TransformStatus;
  /** The last failure, for the interface. Cleared when a new transform starts. */
  readonly error: string | null;
  /** Whether the last success came from the cache rather than from TryAPL. */
  readonly lastWasCached: boolean;
  /** Which control produced the current status, so each shows its own outcome. */
  readonly lastRun: RunKind | null;
  /**
   * What Dyalog said, when Dyalog is what objected.
   *
   * Empty unless the interpreter itself refused the expression. Explore shows these; the fixed
   * controls never produce them, because they generate their own APL.
   */
  readonly aplLines: readonly string[];
  /** The APL for the current settings, ready for Peek. Never sent unless Apply is pressed. */
  readonly source: AplSource;
  /** Whether Apply would do anything. */
  readonly canApply: boolean;
}

export interface TransformApi extends TransformState {
  readonly setOperation: (id: OperationId) => void;
  readonly setTarget: (target: Target) => void;
  readonly setParameter: (key: keyof Parameters, value: number) => void;
  /** Applies the current transform. One of the three things that can cause a request. */
  readonly apply: () => void;
  readonly explore: ExploreApi;
  readonly create: CreateApi;
}

export interface UseAplOptions {
  /** The bar a transform would be applied to. */
  readonly pattern: Pattern;
  /**
   * Which rows the generator may not touch.
   *
   * Locks mean "the generator may not change this" — the built-in transforms deliberately ignore
   * them, because asking for a rotation of the kick and being refused because the kick is locked
   * would be absurd. Create *is* a generator, so it respects them.
   */
  readonly lockedRows: LockedRows;
  /** Install a validated result. Exactly one Undo entry. */
  readonly onApply: (pattern: Pattern) => void;
  /** Swapped for a fake in tests. Defaults to the real TryAPL client. */
  readonly client?: AplClient;
}

const FIRST_OPERATION = OPERATIONS[0]!;

export function useApl({ pattern, lockedRows, onApply, client }: UseAplOptions): TransformApi {
  /*
   * The Create controls, restored once and never executed on restore.
   *
   * Reading these back cannot cause a request — there is no path from here to `submit` that a
   * button press does not open. Somebody who was working with Broken at seed 47291 finds them
   * both again, and nothing has happened in the meantime.
   */
  const [recipeId, setRecipeId] = useState<RecipeId>(
    () => loadCreateSettings()?.recipeId ?? DEFAULT_RECIPE_ID,
  );
  /*
   * A fresh seed when there is nothing stored, drawn once.
   *
   * In the initialiser rather than in an effect, so the first paint already shows the seed that
   * would be used. A seed that appeared a frame after the panel did would look like something
   * had happened.
   */
  const [createSeed, setCreateSeed] = useState<number>(() => loadCreateSettings()?.seed ?? randomSeed());

  const [operationId, setOperationId] = useState<OperationId>(FIRST_OPERATION.id);
  const [target, setTargetState] = useState<Target>('all');
  const [parameters, setParameters] = useState<Parameters>(() => resolveParameters(FIRST_OPERATION, {}));
  const [status, setStatus] = useState<TransformStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastWasCached, setLastWasCached] = useState(false);
  const [lastRun, setLastRun] = useState<RunKind | null>(null);
  const [aplLines, setAplLines] = useState<readonly string[]>([]);

  /*
   * The Explore draft, restored once.
   *
   * A draft that survives a refresh but never runs itself: somebody who was halfway through an
   * experiment when they reloaded should find their expression, not a blank box, and certainly
   * not a request they did not ask for.
   */
  const [customExpression, setCustomExpression] = useState<string | null>(
    () => loadExploreDraft()?.expression ?? null,
  );
  const [customTarget, setCustomTarget] = useState<Target | null>(() => loadExploreDraft()?.target ?? null);
  /*
   * The execution context that came back with the draft.
   *
   * A Stage 5 draft has none, and loads exactly as it always did — that is the whole migration,
   * and it is why the field is optional rather than the schema being bumped. A Stage 6 draft
   * that began life as a generator carries the seed it was generated under, so reload-and-Run
   * still reproduces the bar.
   */
  const [customContext, setCustomContext] = useState<ExploreContext | null>(
    () => loadExploreDraft()?.context ?? null,
  );
  const [exploreOrigin, setExploreOrigin] = useState<ExploreOrigin>(() =>
    loadExploreDraft()?.context?.randomSeed === undefined ? 'transform' : 'create',
  );

  const operation = operationById(operationId);

  /*
   * The service, built once and kept outside the render cycle.
   *
   * `useRef` rather than `useMemo`, because a cache that could be discarded by a re-render
   * would be a cache that occasionally asks TryAPL the same question twice.
   */
  const serviceRef = useRef<AplService | null>(null);
  if (serviceRef.current === null) {
    serviceRef.current = new AplService(client ?? new TryAplClient());
  }

  /** The current bar and callback, read at the moment a reply arrives rather than captured. */
  const patternRef = useRef(pattern);
  const applyRef = useRef(onApply);
  useEffect(() => {
    patternRef.current = pattern;
    applyRef.current = onApply;
  }, [pattern, onApply]);

  /** Whether a request is in flight. A ref, so `apply` can check it without being rebuilt. */
  const busy = useRef(false);

  /**
   * Which request is the current one.
   *
   * Incremented by every `apply`. A reply whose number is no longer the latest is discarded —
   * which, together with the pattern comparison below, is the whole of the staleness
   * protection.
   */
  const requestId = useRef(0);

  useEffect(() => {
    const service = serviceRef.current;
    return () => {
      // Leaving the page abandons whatever is in flight rather than letting it resolve into a
      // component that no longer exists.
      service?.cancel();
    };
  }, []);

  const setOperation = useCallback((id: OperationId) => {
    const next = operationById(id);
    setOperationId(next.id);
    setParameters(resolveParameters(next, {}));
    // An operation that cannot do what the current target asks moves the target rather than
    // presenting an Apply button that would refuse.
    setTargetState((current) => defaultTargetFor(next, current));
    setStatus('idle');
    setError(null);
  }, []);

  const setTarget = useCallback((next: Target) => {
    setTargetState(next);
    setStatus('idle');
    setError(null);
  }, []);

  const setParameter = useCallback(
    (key: keyof Parameters, value: number) => {
      /*
       * Changes the number and nothing else.
       *
       * No request, no debounce, no "preview" — because a preview is a request, and a slider
       * that made requests as it moved is exactly what this project has promised TryAPL it
       * will never build. The APL shown in Peek updates immediately, locally, because it is
       * generated from a template rather than fetched.
       */
      setParameters((current) => resolveParameters(operation, { ...current, [key]: value }));
      setStatus('idle');
      setError(null);
    },
    [operation],
  );

  const source = useMemo(
    () => buildAplSource({ operation, target, parameters, pattern }),
    [operation, target, parameters, pattern],
  );

  const canApply = isValidTarget(operation, target);

  /**
   * One request, whichever control asked for it.
   *
   * Both `apply` and Explore's `run` come through here, and that is the whole of "one execution
   * lane": one `busy` ref refuses a second request while any request is in flight, one counter
   * decides which reply is still wanted, and one set of staleness rules governs both. A separate
   * hook for Explore would have been a second set of rules to keep in step, and they would not
   * have stayed in step.
   *
   * `stillCurrent` is the extra check Explore needs. The pattern can move under a request — that
   * was Stage 3's problem — and now the *code* can move too: somebody may edit the editor while
   * their last run is still out. A result must never be installed under an expression that did
   * not produce it, so the caller says what would make its own reply stale.
   */
  const submit = useCallback(
    (
      kind: RunKind,
      work: (service: AplService) => Promise<TransformOutcome>,
      stillCurrent: () => boolean = () => true,
    ) => {
      const service = serviceRef.current;
      if (service === null) return;

      // A second press while one is in flight is dropped, not queued. Queueing would let a
      // held-down key become a request storm.
      if (busy.current) return;

      const basedOn = patternRef.current;
      const id = requestId.current + 1;
      requestId.current = id;
      busy.current = true;

      setLastRun(kind);
      setStatus('running');
      setError(null);
      setAplLines([]);

      void work(service)
        .then((outcome) => {
          if (requestId.current !== id) return; // Superseded by a newer transform.

          /*
           * The staleness checks.
           *
           * Between asking and answering the visitor may have edited a cell, pressed Randomise,
           * undone something — or, in Explore, rewritten the expression. A matrix computed from
           * a bar that no longer exists must not overwrite the bar that does, and a result must
           * not appear beneath an expression that did not produce it. Either way the reply is
           * dropped and nothing is claimed about it.
           */
          if (!isStillApplicable(basedOn, patternRef.current) || !stillCurrent()) {
            setStatus('idle');
            return;
          }

          /*
           * An answer that changes nothing is a success with nothing to undo.
           *
           * Worth saying out loud rather than leaving the interface silent: a valid expression
           * that happens to return the same rhythm is a perfectly good thing to have written,
           * and an Undo entry that appears to do nothing is worse than no Undo entry.
           */
          if (isStillApplicable(outcome.pattern, patternRef.current)) {
            setLastWasCached(outcome.cached);
            setStatus('unchanged');
            return;
          }

          applyRef.current(outcome.pattern);
          setLastWasCached(outcome.cached);
          setStatus('applied');
        })
        .catch((thrown: unknown) => {
          if (requestId.current !== id) return;

          const failure = thrown instanceof AplError ? thrown : null;
          // A superseded request is not a failure anybody needs telling about.
          if (failure?.kind === 'cancelled') {
            setStatus('idle');
            return;
          }

          if (failure?.detail !== undefined) console.warn(`[apl] ${failure.detail}`);
          setAplLines(failure?.aplLines ?? []);
          setError(failure?.message ?? 'APL is unavailable right now. Your beat was not changed.');
          setStatus('failed');
        })
        .finally(() => {
          if (requestId.current === id) busy.current = false;
        });
    },
    [],
  );

  const apply = useCallback(() => {
    if (!isValidTarget(operation, target)) return;
    submit('fixed', (service) => service.run({ operation, target, parameters, pattern: patternRef.current }));
  }, [operation, parameters, target, submit]);

  /* ---- Create with APL ---------------------------------------------------- */

  const recipe = recipeById(recipeId);
  const locks = useMemo(() => normaliseLockedRows(lockedRows), [lockedRows]);

  /**
   * The locks and the Create settings as they are *now*, read when a reply arrives.
   *
   * Refs for the same reason `latestExpression` is one. A generation is asynchronous and none of
   * these need change the pattern to invalidate it: locking a row, changing the recipe, or
   * typing a new seed all mean the answer in flight is the answer to a question nobody is
   * asking any more. Comparing against the values captured at submit time would compare them
   * with themselves and could never be stale.
   */
  const latestCreate = useRef({ recipeId, seed: createSeed, locks: locks.join(',') });
  useEffect(() => {
    latestCreate.current = { recipeId, seed: createSeed, locks: locks.join(',') };
  }, [recipeId, createSeed, locks]);

  /* Remembered a moment after things settle, exactly like the Explore draft. */
  useEffect(() => {
    const handle = setTimeout(() => {
      saveCreateSettings({ recipeId, seed: createSeed });
    }, 500);
    return () => {
      clearTimeout(handle);
    };
  }, [recipeId, createSeed]);

  const setRecipe = useCallback((id: RecipeId) => {
    /*
     * Changes which expression would run, and nothing else.
     *
     * No request, no preview — for the same reason a parameter slider makes none. The APL shown
     * in Peek updates immediately because it is a constant in this repository, not something
     * fetched.
     */
    setRecipeId(recipeById(id).id);
    setStatus('idle');
    setError(null);
    setAplLines([]);
  }, []);

  const setSeed = useCallback((next: number) => {
    setCreateSeed(clampSeed(next));
    setStatus('idle');
    setError(null);
    setAplLines([]);
  }, []);

  const newSeed = useCallback(() => {
    // A local draw. The same function Randomise uses for its own seed, and just as offline.
    setCreateSeed(randomSeed());
    setStatus('idle');
    setError(null);
    setAplLines([]);
  }, []);

  const createSource = useMemo(
    () => buildGenerateSource({ recipe, seed: createSeed, pattern, lockedRows: locks }),
    [recipe, createSeed, pattern, locks],
  );

  /*
   * Every track locked means there is nothing to generate.
   *
   * A disabled button and a sentence, rather than a request whose entire answer would be the bar
   * that is already on screen. Spending somebody else's service to prove that would be rude and
   * pointless in equal measure.
   */
  const everythingLocked = locks.length >= TRACK_COUNT;
  const canGenerate = !everythingLocked;
  const blockedReason = everythingLocked
    ? 'Every track is locked, so there is nothing for APL to write. Unlock a track to generate.'
    : null;

  const generate = useCallback(() => {
    if (locks.length >= TRACK_COUNT) return;

    const asked = { recipeId, seed: createSeed, locks: locks.join(',') };

    submit(
      'generate',
      (service) =>
        service.runGenerate({
          recipe: recipeById(recipeId),
          seed: createSeed,
          pattern: patternRef.current,
          lockedRows: locks,
        }),
      /*
       * Stale if any of the three things that decide the answer has moved.
       *
       * The shared pattern comparison in `submit` catches an edit, a Randomise or an Undo. It
       * cannot catch these, because changing the recipe, the seed or a lock need not change the
       * current bar at all — and a Broken bar arriving after somebody switched to Cross would be
       * a result nobody asked for, installed under a control that disagrees with it.
       */
      () =>
        latestCreate.current.recipeId === asked.recipeId &&
        latestCreate.current.seed === asked.seed &&
        latestCreate.current.locks === asked.locks,
    );
  }, [recipeId, createSeed, locks, submit]);

  const create = useMemo<CreateApi>(
    () => ({
      recipe,
      seed: createSeed,
      setRecipe,
      setSeed,
      newSeed,
      canGenerate,
      blockedReason,
      source: createSource,
      generate,
    }),
    [recipe, createSeed, setRecipe, setSeed, newSeed, canGenerate, blockedReason, createSource, generate],
  );

  /* ---- Explore ----------------------------------------------------------- */

  /**
   * What the editor shows.
   *
   * Pristine, it *is* the Core APL the fixed controls generate — not a copy, not an
   * approximation, the same string Peek is displaying. That is the whole point of the feature:
   * the expression somebody starts editing must be the expression that would really have run,
   * or the first edit teaches them something false.
   */
  const isPristine = customExpression === null;

  /*
   * Which built-in source a pristine editor mirrors.
   *
   * Pristine and following Create, it is the recipe's expression and moves when the recipe or
   * the seed does — the Stage 5 rule, extended to the second source rather than duplicated for
   * it. Pristine and following Transform, it is what it always was.
   */
  const pristineCore = exploreOrigin === 'create' ? recipe.core : source.core;
  const exploreExpression = customExpression ?? pristineCore;
  const exploreTarget = customTarget ?? (exploreOrigin === 'create' ? 'all' : target);

  /*
   * The seed the expression runs under.
   *
   * Pristine from Create, it tracks the Create seed, so an unedited generator reproduces exactly
   * what the Generate button produced. Once edited, it is whatever was captured at the moment of
   * the first edit and stored with the draft — so a reload followed by Run is still reproducible,
   * and so changing the Create seed afterwards cannot silently rewrite somebody's experiment.
   *
   * A generator that begins as "All tracks" and is then pointed at one track keeps its seed. The
   * expression still uses `?`, and taking the seed away because the target moved would make it
   * non-reproducible for no reason anybody asked for.
   */
  const exploreRandomSeed = isPristine
    ? exploreOrigin === 'create'
      ? createSeed
      : null
    : (customContext?.randomSeed ?? null);

  const check = checkCustomExpression(exploreExpression);
  const exploreProblem = check.ok ? null : check.reason;

  const exploreSource = useMemo(
    () =>
      buildCustomSource({
        core: exploreExpression,
        target: exploreTarget,
        pattern,
        ...(exploreRandomSeed === null ? {} : { randomSeed: exploreRandomSeed }),
      }),
    [exploreExpression, exploreTarget, pattern, exploreRandomSeed],
  );

  /**
   * What the editor holds *now*, read when a reply arrives.
   *
   * A ref rather than the closed-over value, and that distinction is the whole of the check: the
   * running expression is captured when the request starts, so comparing it with itself would
   * always agree and nothing could ever be stale. It has to be compared with what is on screen
   * at the moment the answer comes back.
   */
  const latestExpression = useRef(exploreExpression);
  useEffect(() => {
    latestExpression.current = exploreExpression;
  }, [exploreExpression]);

  /*
   * The draft, written a moment after typing stops.
   *
   * Debounced, because a keystroke is not worth a serialise and a write, and half a second is
   * well below the time it takes to reach for a tab.
   */
  useEffect(() => {
    if (customExpression === null) return;
    const handle = setTimeout(() => {
      saveExploreDraft({
        expression: customExpression,
        target: exploreTarget,
        ...(customContext === null ? {} : { context: customContext }),
      });
    }, 500);
    return () => {
      clearTimeout(handle);
    };
  }, [customExpression, exploreTarget, customContext]);

  /**
   * The context a draft keeps when it stops being pristine.
   *
   * Captured at the moment of the first edit rather than tracked afterwards. Somebody who edits
   * a generator has made that expression theirs, and having the Create seed keep changing
   * underneath it would mean their Run gave a different answer each time for reasons nothing on
   * screen explained.
   */
  const detachContext = useCallback(() => {
    setCustomContext((current) => {
      if (current !== null) return current;
      return exploreOrigin === 'create' ? { randomSeed: createSeed } : null;
    });
  }, [exploreOrigin, createSeed]);

  const setExpression = useCallback(
    (next: string) => {
      /*
       * The first edit ends the connection to the fixed controls.
       *
       * From here the draft is the visitor's, and nothing overwrites it except the button that
       * says it will. Changing the Operation, a parameter, the recipe or the seed afterwards
       * would otherwise quietly discard somebody's writing, which is the one thing an editor
       * must never do.
       */
      detachContext();
      setCustomExpression(next);
      setStatus('idle');
      setError(null);
      setAplLines([]);
    },
    [detachContext],
  );

  const setExploreTarget = useCallback(
    (next: Target) => {
      // Also an edit: where the result lands is part of what the expression means. A generator
      // pointed at one track becomes ordinary custom Explore, and keeps its seed.
      detachContext();
      setCustomTarget(next);
      setCustomExpression((current) => current ?? pristineCore);
      setStatus('idle');
      setError(null);
      setAplLines([]);
    },
    [pristineCore, detachContext],
  );

  /**
   * Take a built-in source's expression, discarding whatever was in the editor.
   *
   * The *explicit* load, reached from a button that says so. Nothing else in the application
   * calls it, which is what makes "your draft will not disappear because you opened a Peek"
   * true rather than careful.
   */
  const loadFrom = useCallback((origin: ExploreOrigin) => {
    setExploreOrigin(origin);
    setCustomExpression(null);
    setCustomTarget(null);
    setCustomContext(null);
    saveExploreDraft(null);
    setStatus('idle');
    setError(null);
    setAplLines([]);
  }, []);

  /**
   * Point a *pristine* editor at a different source, and otherwise do nothing.
   *
   * What "Edit this APL" calls from either Peek. With an empty or unedited editor it switches
   * which controls are being mirrored, which is what somebody clicking it wants. With an edited
   * one it deliberately does nothing: the draft stays, and the panel offers the explicit load
   * instead. A modal asking "are you sure?" would be a worse answer to the same question.
   */
  const follow = useCallback(
    (origin: ExploreOrigin) => {
      if (!isPristine) return;
      setExploreOrigin(origin);
      setStatus('idle');
      setError(null);
      setAplLines([]);
    },
    [isPristine],
  );

  const loadCurrent = useCallback(() => {
    loadFrom(exploreOrigin);
  }, [loadFrom, exploreOrigin]);

  const runCustom = useCallback(() => {
    const valid = checkCustomExpression(exploreExpression);
    if (!valid.ok) return;

    submit(
      'custom',
      (service) =>
        service.runCustom({
          core: valid.core,
          target: exploreTarget,
          pattern: patternRef.current,
          ...(exploreRandomSeed === null ? {} : { randomSeed: exploreRandomSeed }),
        }),
      // Stale if the editor has moved on. The network must not freeze somebody's writing, so
      // editing during a run is allowed and the reply is what gets discarded.
      () => latestExpression.current.trim() === valid.core,
    );
  }, [exploreExpression, exploreTarget, exploreRandomSeed, submit]);

  const explore = useMemo<ExploreApi>(
    () => ({
      expression: exploreExpression,
      target: exploreTarget,
      isPristine,
      origin: exploreOrigin,
      randomSeed: exploreRandomSeed,
      problem: exploreProblem,
      canRun: exploreProblem === null,
      source: exploreSource,
      setExpression,
      setTarget: setExploreTarget,
      follow,
      loadFrom,
      loadCurrent,
      run: runCustom,
    }),
    [
      exploreExpression,
      exploreTarget,
      isPristine,
      exploreOrigin,
      exploreRandomSeed,
      exploreProblem,
      exploreSource,
      setExpression,
      setExploreTarget,
      follow,
      loadFrom,
      loadCurrent,
      runCustom,
    ],
  );

  return useMemo(
    () => ({
      operation,
      target,
      parameters,
      status,
      error,
      lastWasCached,
      lastRun,
      aplLines,
      source,
      canApply,
      setOperation,
      setTarget,
      setParameter,
      apply,
      explore,
      create,
    }),
    [
      operation,
      target,
      parameters,
      status,
      error,
      lastWasCached,
      lastRun,
      aplLines,
      source,
      canApply,
      setOperation,
      setTarget,
      setParameter,
      apply,
      explore,
      create,
    ],
  );
}
