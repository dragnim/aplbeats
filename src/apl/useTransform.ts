import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Pattern } from '@/pattern/pattern';
import { AplError, TryAplClient, type AplClient } from './client';
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
import { isStillApplicable, TransformService } from './transform';

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

export type TransformStatus = 'idle' | 'running' | 'applied' | 'failed';

export interface TransformState {
  readonly operation: Operation;
  readonly target: Target;
  readonly parameters: Parameters;
  readonly status: TransformStatus;
  /** The last failure, for the interface. Cleared when a new transform starts. */
  readonly error: string | null;
  /** Whether the last success came from the cache rather than from TryAPL. */
  readonly lastWasCached: boolean;
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

  const apply = useCallback(() => {
    const service = serviceRef.current;
    if (service === null) return;

    // A second press while one is in flight is dropped, not queued. Queueing would let a
    // held-down key become a request storm.
    if (busy.current) return;
    if (!isValidTarget(operation, target)) return;

    const basedOn = patternRef.current;
    const id = requestId.current + 1;
    requestId.current = id;
    busy.current = true;

    setStatus('running');
    setError(null);

    void service
      .run({ operation, target, parameters, pattern: basedOn })
      .then((outcome) => {
        if (requestId.current !== id) return; // Superseded by a newer transform.

        /*
         * The staleness check.
         *
         * Between asking and answering the visitor may have edited a cell, pressed Randomise
         * or undone something. A matrix computed from a bar that no longer exists must not
         * overwrite the bar that does — so if the pattern has moved, the reply is dropped and
         * the beat is left exactly as the visitor left it.
         */
        if (!isStillApplicable(basedOn, patternRef.current)) {
          setStatus('idle');
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
        setError(failure?.message ?? 'APL is unavailable right now. Your beat was not changed.');
        setStatus('failed');
      })
      .finally(() => {
        if (requestId.current === id) busy.current = false;
      });
  }, [operation, parameters, target]);

  return useMemo(
    () => ({
      operation,
      target,
      parameters,
      status,
      error,
      lastWasCached,
      source,
      canApply,
      setOperation,
      setTarget,
      setParameter,
      apply,
    }),
    [
      operation,
      target,
      parameters,
      status,
      error,
      lastWasCached,
      source,
      canApply,
      setOperation,
      setTarget,
      setParameter,
      apply,
    ],
  );
}
