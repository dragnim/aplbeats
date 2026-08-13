import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadExploreDraft, saveExploreDraft } from '@/app/persistence';
import type { Pattern } from '@/pattern/pattern';
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
import { buildTransformSource, type TransformSource } from './operations';
import { isStillApplicable, TransformService, type TransformOutcome } from './transform';

/*
 * When a transform happens, and what the interface knows about it.
 *
 * This is the file that keeps the promise about TryAPL. Every rule about *when* a request may
 * be made lives here, in one place, where it can be read and counted:
 *
 *   `apply` is the only function that can cause a request, and it is called from one button;
 *   changing the operation, the target or a parameter changes state and nothing else;
 *   opening Peek changes nothing;
 *   playback, the playhead, Randomise and editing cannot reach this file at all;
 *   a second `apply` while one is in flight is ignored rather than queued;
 *   there are no retries and no polling anywhere.
 *
 * The last of those is worth stating plainly: there is no `setInterval`, no `setTimeout` that
 * re-requests, and no effect with the request in it. A request is caused by a click and by
 * nothing else.
 */

export type TransformStatus = 'idle' | 'running' | 'applied' | 'failed' | 'unchanged';

/** Which of the two ways in produced the current status. */
export type RunKind = 'fixed' | 'custom';

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
  readonly source: TransformSource;
  readonly setExpression: (expression: string) => void;
  readonly setTarget: (target: Target) => void;
  /** Replace the draft with the Core APL the fixed controls currently generate. */
  readonly loadCurrent: () => void;
  /** The one thing in Explore that can cause a network request. */
  readonly run: () => void;
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
  readonly source: TransformSource;
  /** Whether Apply would do anything. */
  readonly canApply: boolean;
}

export interface TransformApi extends TransformState {
  readonly setOperation: (id: OperationId) => void;
  readonly setTarget: (target: Target) => void;
  readonly setParameter: (key: keyof Parameters, value: number) => void;
  /** The one thing in the application that can cause a network request. */
  readonly apply: () => void;
  readonly explore: ExploreApi;
}

export interface UseTransformOptions {
  /** The bar a transform would be applied to. */
  readonly pattern: Pattern;
  /** Install a validated result. Exactly one Undo entry. */
  readonly onApply: (pattern: Pattern) => void;
  /** Swapped for a fake in tests. Defaults to the real TryAPL client. */
  readonly client?: AplClient;
}

const FIRST_OPERATION = OPERATIONS[0]!;

export function useTransform({ pattern, onApply, client }: UseTransformOptions): TransformApi {
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

  const operation = operationById(operationId);

  /*
   * The service, built once and kept outside the render cycle.
   *
   * `useRef` rather than `useMemo`, because a cache that could be discarded by a re-render
   * would be a cache that occasionally asks TryAPL the same question twice.
   */
  const serviceRef = useRef<TransformService | null>(null);
  if (serviceRef.current === null) {
    serviceRef.current = new TransformService(client ?? new TryAplClient());
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
    () => buildTransformSource({ operation, target, parameters, pattern }),
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
      work: (service: TransformService) => Promise<TransformOutcome>,
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
  const exploreExpression = customExpression ?? source.core;
  const exploreTarget = customTarget ?? target;

  const check = checkCustomExpression(exploreExpression);
  const exploreProblem = check.ok ? null : check.reason;

  const exploreSource = useMemo(
    () => buildCustomSource({ core: exploreExpression, target: exploreTarget, pattern }),
    [exploreExpression, exploreTarget, pattern],
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
      saveExploreDraft({ expression: customExpression, target: exploreTarget });
    }, 500);
    return () => {
      clearTimeout(handle);
    };
  }, [customExpression, exploreTarget]);

  const setExpression = useCallback((next: string) => {
    /*
     * The first edit ends the connection to the fixed controls.
     *
     * From here the draft is the visitor's, and nothing overwrites it except the button that
     * says it will. Changing the Operation or a parameter afterwards would otherwise quietly
     * discard somebody's writing, which is the one thing an editor must never do.
     */
    setCustomExpression(next);
    setStatus('idle');
    setError(null);
    setAplLines([]);
  }, []);

  const setExploreTarget = useCallback(
    (next: Target) => {
      // Also an edit: where the result lands is part of what the expression means.
      setCustomTarget(next);
      setCustomExpression((current) => current ?? source.core);
      setStatus('idle');
      setError(null);
      setAplLines([]);
    },
    [source.core],
  );

  const loadCurrent = useCallback(() => {
    // Back to following the fixed controls, deliberately and on request.
    setCustomExpression(null);
    setCustomTarget(null);
    saveExploreDraft(null);
    setStatus('idle');
    setError(null);
    setAplLines([]);
  }, []);

  const runCustom = useCallback(() => {
    const valid = checkCustomExpression(exploreExpression);
    if (!valid.ok) return;

    submit(
      'custom',
      (service) =>
        service.runCustom({ core: valid.core, target: exploreTarget, pattern: patternRef.current }),
      // Stale if the editor has moved on. The network must not freeze somebody's writing, so
      // editing during a run is allowed and the reply is what gets discarded.
      () => latestExpression.current.trim() === valid.core,
    );
  }, [exploreExpression, exploreTarget, submit]);

  const explore = useMemo<ExploreApi>(
    () => ({
      expression: exploreExpression,
      target: exploreTarget,
      isPristine,
      problem: exploreProblem,
      canRun: exploreProblem === null,
      source: exploreSource,
      setExpression,
      setTarget: setExploreTarget,
      loadCurrent,
      run: runCustom,
    }),
    [
      exploreExpression,
      exploreTarget,
      isPristine,
      exploreProblem,
      exploreSource,
      setExpression,
      setExploreTarget,
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
    ],
  );
}
