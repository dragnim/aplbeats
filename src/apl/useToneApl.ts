import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadToneCreateSettings,
  loadToneExploreDraft,
  saveToneCreateSettings,
  saveToneExploreDraft,
  type ToneExploreContext,
} from '@/app/persistence';
import { clampSeed, randomSeed } from '@/generation/prng';
import type { Phrase } from '@/tones/phrase';
import { buildToneCustomSource, checkCustomExpression } from './custom';
import { clampParameter, type AplSource, type Parameters } from './operations';
import { toneCustomIdentityKey, type AplService, type ToneOutcome } from './service';
import {
  buildToneGenerateSource,
  clampRoot,
  DEFAULT_ROOT,
  DEFAULT_SCALE_ID,
  DEFAULT_TONE_RECIPE_ID,
  toneGeneratorRandomSeed,
  toneRecipeById,
  toneScaleById,
  type ToneRecipe,
  type ToneRecipeId,
  type ToneScale,
  type ToneScaleId,
} from './toneGenerators';
import {
  buildToneCore,
  buildToneSource,
  toneOperationById,
  TONE_OPERATIONS,
  type ToneOperation,
  type ToneOperationId,
} from './toneOperations';
import type { RunKind } from './useApl';

/*
 * The Tones half of the one APL lane.
 *
 * A separate file, and emphatically **not** a separate lane. It owns no client, no cache, no busy
 * flag and no request counter: it is handed `submit` by `useApl` and every request it makes goes
 * through exactly the machinery every Beats request goes through. Pressing Generate on the melody
 * while a rhythm is in flight is refused by the same `busy` ref that refuses two rhythms, which is
 * the promise made to TryAPL and the reason this is a parameter rather than a second hook with
 * its own copy of the rules.
 *
 * What it does own is the *state*: which recipe, root, scale and seed the Tone Create controls
 * hold, which operation and parameter the Tone Transform controls hold, and the Tones side of
 * Explore — which is a genuinely separate draft from the Beats one, because `⌽m` and `⌽n` are
 * different programs against different data and an editor that swapped one for the other when you
 * changed tab would lose somebody's work every time.
 *
 * Nothing here executes on load. Restoring a recipe and a seed restores a selector and a number;
 * there is no path from this file to a request that a button press does not open.
 */

export interface ToneCreateApi {
  readonly recipe: ToneRecipe;
  readonly scale: ToneScale;
  readonly root: number;
  readonly seed: number;
  readonly setRecipe: (id: ToneRecipeId) => void;
  readonly setScale: (id: ToneScaleId) => void;
  readonly setRoot: (root: number) => void;
  readonly setSeed: (seed: number) => void;
  /** Another valid seed. Local, and it runs nothing. */
  readonly newSeed: () => void;
  /** The whole request this would make, for Peek. Never sent unless Generate is pressed. */
  readonly source: AplSource;
  /** The one thing in Tone Create that can cause a network request. */
  readonly generate: () => void;
}

export interface ToneExploreApi {
  readonly expression: string;
  /** Whether the editor is still mirroring whichever Tone control it is following. */
  readonly isPristine: boolean;
  /** Which built-in Tone source this draft follows: the transform controls, or the recipe. */
  readonly origin: ToneExploreOrigin;
  /** The seed this expression runs under, if it needs one. */
  readonly randomSeed: number | null;
  /** Why this cannot be run, if it cannot. Local; costs no request. */
  readonly problem: string | null;
  readonly canRun: boolean;
  readonly source: AplSource;
  readonly setExpression: (expression: string) => void;
  readonly follow: (origin: ToneExploreOrigin) => void;
  readonly loadFrom: (origin: ToneExploreOrigin) => void;
  readonly loadCurrent: () => void;
  /** The one thing in Tone Explore that can cause a network request. */
  readonly run: () => void;
}

export type ToneExploreOrigin = 'transform' | 'create';

export interface ToneAplApi {
  readonly operation: ToneOperation;
  readonly parameters: Parameters;
  /** The APL for the current settings, ready for Peek. Never sent unless Apply is pressed. */
  readonly source: AplSource;
  readonly setOperation: (id: ToneOperationId) => void;
  readonly setParameter: (key: keyof Parameters, value: number) => void;
  /** Applies the current melody transform. */
  readonly apply: () => void;
  readonly create: ToneCreateApi;
  readonly explore: ToneExploreApi;
}

/**
 * What `useApl` hands down: the lane, and a live view of the melody.
 *
 * `submit` is the whole of the shared machinery. `phraseRef` is read at the moment a request is
 * built rather than captured when a callback was made, for the same reason the Beats side reads
 * `patternRef`: a melody edited between a press and its request must be the melody that is sent.
 */
export interface UseToneAplOptions {
  readonly submit: (
    kind: RunKind,
    domain: 'tones',
    work: (service: AplService) => Promise<ToneOutcome>,
    stillCurrent?: () => boolean,
  ) => void;
  /** The melody as it stands this render, for building the sources the panels display. */
  readonly phrase: Phrase;
  readonly phraseRef: React.RefObject<Phrase>;
}

const FIRST_OPERATION = TONE_OPERATIONS[0]!;

export function useToneApl({ submit, phrase, phraseRef }: UseToneAplOptions): ToneAplApi {
  /* ---- Transform ---------------------------------------------------------- */

  const [operationId, setOperationId] = useState<ToneOperationId>(FIRST_OPERATION.id);
  const [parameters, setParameters] = useState<Parameters>(() => resolve(FIRST_OPERATION, {}));

  const operation = toneOperationById(operationId);

  const setOperation = useCallback((id: ToneOperationId) => {
    const next = toneOperationById(id);
    setOperationId(next.id);
    // Defaults for the new operation. Carrying "5 semitones" across into Octave would mean five
    // octaves, which is not what anybody moving one control to another meant.
    setParameters(resolve(next, {}));
  }, []);

  const setParameter = useCallback(
    (key: keyof Parameters, value: number) => {
      const spec = operation.parameters.find((entry) => entry.key === key);
      if (spec === undefined) return;
      setParameters((current) => ({ ...current, [key]: clampParameter(spec, value) }));
    },
    [operation],
  );

  const source = useMemo(
    () => buildToneSource({ operation, parameters, phrase }),
    // The melody as it is *this render*, not through the ref: this is what Peek displays, and
    // what is displayed must be what the reader can see on the strip beside it. The ref is for
    // the request, which is built later and must use the melody as it is then.
    [operation, parameters, phrase],
  );

  const apply = useCallback(() => {
    submit('fixed', 'tones', (service) =>
      service.runTone({ operation, parameters, phrase: phraseRef.current }),
    );
  }, [operation, parameters, submit, phraseRef]);

  /* ---- Create ------------------------------------------------------------- */

  const restored = useMemo(() => loadToneCreateSettings(), []);
  const [recipeId, setRecipeId] = useState<ToneRecipeId>(restored?.recipeId ?? DEFAULT_TONE_RECIPE_ID);
  const [scaleId, setScaleId] = useState<ToneScaleId>(restored?.scaleId ?? DEFAULT_SCALE_ID);
  const [root, setRootState] = useState<number>(restored?.root ?? DEFAULT_ROOT);
  const [seed, setSeedState] = useState<number>(() => restored?.seed ?? randomSeed());

  const recipe = toneRecipeById(recipeId);
  const scale = toneScaleById(scaleId);

  /*
   * Remembered a moment after things settle, exactly as the Beats Create controls are.
   *
   * Debounced because dragging the seed would otherwise be one write per value, and this cannot
   * reach the network: it writes four values to `localStorage` and nothing else.
   */
  useEffect(() => {
    const handle = setTimeout(() => {
      saveToneCreateSettings({ recipeId, scaleId, root, seed });
    }, 500);
    return () => {
      clearTimeout(handle);
    };
  }, [recipeId, scaleId, root, seed]);

  const setRecipe = useCallback((id: ToneRecipeId) => {
    setRecipeId(toneRecipeById(id).id);
  }, []);

  const setScale = useCallback((id: ToneScaleId) => {
    setScaleId(toneScaleById(id).id);
  }, []);

  const setRoot = useCallback((next: number) => {
    setRootState(clampRoot(next));
  }, []);

  const setSeed = useCallback((next: number) => {
    setSeedState(clampSeed(next));
  }, []);

  const newSeed = useCallback(() => {
    // A local draw, and the same function Randomise uses. Nothing is executed.
    setSeedState(randomSeed());
  }, []);

  const createSource = useMemo(
    () => buildToneGenerateSource({ recipe, root, scale, seed }),
    [recipe, root, scale, seed],
  );

  /** What the current Create controls describe, for the staleness check below. */
  const latestCreate = useRef({ recipeId, scaleId, root, seed });
  useEffect(() => {
    latestCreate.current = { recipeId, scaleId, root, seed };
  }, [recipeId, scaleId, root, seed]);

  const generate = useCallback(() => {
    const asked = { recipeId, scaleId, root, seed };

    submit(
      'generate',
      'tones',
      (service) => service.runToneGenerate({ recipe: toneRecipeById(recipeId), root, scale, seed }),
      /*
       * Stale if any of the four things that decide the answer has moved.
       *
       * `submit`'s own comparison catches an edit or an Undo to the melody. It cannot catch
       * these, because changing the recipe, the scale, the root or the seed need not change the
       * current melody at all — and a Riff arriving after somebody switched to Sparse would be
       * the wrong tune under the right label.
       */
      () =>
        latestCreate.current.recipeId === asked.recipeId &&
        latestCreate.current.scaleId === asked.scaleId &&
        latestCreate.current.root === asked.root &&
        latestCreate.current.seed === asked.seed,
    );
  }, [recipeId, scaleId, root, scale, seed, submit]);

  const create = useMemo<ToneCreateApi>(
    () => ({
      recipe,
      scale,
      root,
      seed,
      setRecipe,
      setScale,
      setRoot,
      setSeed,
      newSeed,
      source: createSource,
      generate,
    }),
    [recipe, scale, root, seed, setRecipe, setScale, setRoot, setSeed, newSeed, createSource, generate],
  );

  /* ---- Explore ------------------------------------------------------------ */

  const restoredDraft = useMemo(() => loadToneExploreDraft(), []);
  const [customExpression, setCustomExpression] = useState<string | null>(restoredDraft?.expression ?? null);
  const [customContext, setCustomContext] = useState<ToneExploreContext | null>(
    restoredDraft?.context ?? null,
  );
  const [exploreOrigin, setExploreOrigin] = useState<ToneExploreOrigin>(() =>
    restoredDraft?.context === undefined ? 'transform' : 'create',
  );

  const isPristine = customExpression === null;

  /*
   * What a pristine editor mirrors, and it is one of two things.
   *
   * Following the transform controls, it shows what Apply would run — so moving Semitones from 5
   * to 7 updates the editor and the connection is visible. Following the recipe, it shows the
   * recipe's own expression, which is the thing "Edit this APL" was pressed on.
   */
  const pristineCore =
    exploreOrigin === 'create' ? recipe.core(clampRoot(root), scale) : buildToneCore(operation, parameters);
  const exploreExpression = customExpression ?? pristineCore;

  /*
   * The seed the expression runs under, if it needs one.
   *
   * A transform expression has no use for `?` and is sent without a `⎕RL` at all, exactly as the
   * Beats side does it. A recipe does, and it must run under the same seed the Generate button
   * used — otherwise loading a recipe into the editor and pressing Run would give a different
   * melody than the button that produced it, and Peek would be a lie.
   */
  const exploreRandomSeed = isPristine
    ? exploreOrigin === 'create'
      ? toneGeneratorRandomSeed(seed)
      : null
    : (customContext?.randomSeed ?? null);

  const check = checkCustomExpression(exploreExpression);
  const exploreProblem = check.ok ? null : check.reason;

  const exploreSource = useMemo(
    () =>
      buildToneCustomSource({
        core: exploreExpression,
        phrase,
        ...(exploreRandomSeed === null ? {} : { randomSeed: exploreRandomSeed }),
      }),
    [exploreExpression, exploreRandomSeed, phrase],
  );

  /**
   * What the editor currently describes, compared with what a reply was asked for.
   *
   * The same function the cache uses, deliberately — Stage 6 shipped with cache identity and
   * staleness identity derived separately on the Beats side and they drifted immediately. One
   * function, one answer to "is this the same run".
   */
  const latestIdentity = useRef('');
  useEffect(() => {
    latestIdentity.current = toneCustomIdentityKey({
      core: exploreExpression.trim(),
      randomSeed: exploreRandomSeed,
    });
  }, [exploreExpression, exploreRandomSeed]);

  /* Remembered a moment after typing stops. Cannot reach the network. */
  useEffect(() => {
    const handle = setTimeout(() => {
      if (customExpression === null) saveToneExploreDraft(null);
      else {
        saveToneExploreDraft({
          expression: customExpression,
          ...(customContext === null ? {} : { context: customContext }),
        });
      }
    }, 500);
    return () => {
      clearTimeout(handle);
    };
  }, [customExpression, customContext]);

  const setExpression = useCallback(
    (next: string) => {
      /*
       * The first edit ends the mirroring, and takes the seed with it.
       *
       * An edited recipe is not the recipe any more. Keeping its seed would mean the editor
       * quietly running under a `⎕RL` that belonged to an expression that no longer exists — so
       * the context is captured at the moment the draft becomes somebody's own, and only then.
       */
      if (customExpression === null && exploreOrigin === 'create') {
        setCustomContext({ randomSeed: toneGeneratorRandomSeed(seed) });
      }
      setCustomExpression(next);
    },
    [customExpression, exploreOrigin, seed],
  );

  const loadFrom = useCallback((origin: ToneExploreOrigin) => {
    setExploreOrigin(origin);
    setCustomExpression(null);
    setCustomContext(null);
    saveToneExploreDraft(null);
  }, []);

  const follow = useCallback(
    (origin: ToneExploreOrigin) => {
      // Non-destructive, exactly as on the Beats side: an edited draft is never replaced by a
      // Peek. The explicit load is how somebody asks for that.
      if (!isPristine) return;
      setExploreOrigin(origin);
    },
    [isPristine],
  );

  const loadCurrent = useCallback(() => {
    loadFrom(exploreOrigin);
  }, [loadFrom, exploreOrigin]);

  const run = useCallback(() => {
    const valid = checkCustomExpression(exploreExpression);
    if (!valid.ok) return;

    const asked = toneCustomIdentityKey({ core: valid.core, randomSeed: exploreRandomSeed });

    submit(
      'custom',
      'tones',
      (service) =>
        service.runToneCustom({
          core: valid.core,
          phrase: phraseRef.current,
          ...(exploreRandomSeed === null ? {} : { randomSeed: exploreRandomSeed }),
        }),
      () => latestIdentity.current === asked,
    );
  }, [exploreExpression, exploreRandomSeed, submit, phraseRef]);

  const explore = useMemo<ToneExploreApi>(
    () => ({
      expression: exploreExpression,
      isPristine,
      origin: exploreOrigin,
      randomSeed: exploreRandomSeed,
      problem: exploreProblem,
      canRun: exploreProblem === null,
      source: exploreSource,
      setExpression,
      follow,
      loadFrom,
      loadCurrent,
      run,
    }),
    [
      exploreExpression,
      isPristine,
      exploreOrigin,
      exploreRandomSeed,
      exploreProblem,
      exploreSource,
      setExpression,
      follow,
      loadFrom,
      loadCurrent,
      run,
    ],
  );

  return useMemo(
    () => ({ operation, parameters, source, setOperation, setParameter, apply, create, explore }),
    [operation, parameters, source, setOperation, setParameter, apply, create, explore],
  );
}

/** Every parameter for an operation, clamped, with defaults filled in. */
function resolve(operation: ToneOperation, parameters: Parameters): Parameters {
  const resolved: Record<string, number> = {};
  for (const spec of operation.parameters) {
    resolved[spec.key] = clampParameter(spec, parameters[spec.key]);
  }
  return resolved;
}
