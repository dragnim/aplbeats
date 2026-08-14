import { useCallback, useMemo, useReducer, useRef } from 'react';
import type { PresetId } from '@/generation/presets';
import { randomSeed } from '@/generation/prng';
import type { Pattern } from '@/pattern/pattern';
import {
  canUndo as historyHasSomething,
  createStudio,
  studioReducer,
  type CreativeState,
  type MacroName,
} from './studio';

/*
 * The studio, in React.
 *
 * Two things the reducer deliberately cannot do for itself, both of them here.
 *
 * It cannot draw a seed. `randomise` and `newSeed` take one as an argument so the reducer
 * stays pure and testable; this is where the one genuinely non-deterministic call in the
 * application lives.
 *
 * And it cannot tell where one gesture ends and the next begins. A drag across eight
 * cells must be one Undo, and a slider dragged from twenty to seventy must be one Undo;
 * the reducer coalesces by comparing a label, and the label is minted here, because only
 * this layer sees pointer events.
 */

export interface StudioApi {
  readonly state: CreativeState;
  readonly canUndo: boolean;
  /** A new take on the current groove, blended by Variation. */
  readonly randomise: () => void;
  /** A clean slate at a new seed. */
  readonly newSeed: () => void;
  readonly setPreset: (preset: PresetId) => void;
  /** Move a macro. The number changes; the pattern does not until `commitMacro`. */
  readonly setMacro: (macro: MacroName, value: number) => void;
  /** End of a macro gesture: regenerate, and close the history entry. */
  readonly commitMacro: () => void;
  readonly toggleLock: (track: number) => void;
  /**
   * Begin an editing gesture.
   *
   * Called once at the start of a press, a tap or a key activation. Everything painted
   * before the next `beginEdit` belongs to one Undo.
   */
  readonly beginEdit: () => void;
  readonly setCell: (track: number, step: number, value: boolean) => void;
  /**
   * Install a pattern that came back from APL.
   *
   * One Undo entry, atomically. Takes a finished matrix rather than an operation because by
   * the time this is called the transform has already happened and been validated — see
   * `useApl`.
   */
  readonly applyTransform: (pattern: Pattern) => void;
  readonly undo: () => void;
}

export function useStudio(initial: CreativeState): StudioApi {
  const [studio, dispatch] = useReducer(studioReducer, initial, createStudio);

  /*
   * Gesture labels, as counters.
   *
   * Two of them, because a cell drag and a slider drag can be told apart by which
   * counter moved. Refs rather than state: nothing renders differently because a gesture
   * is open, and a re-render per pointer-down would be a re-render for nothing.
   */
  const editGesture = useRef(0);
  const macroGesture = useRef(0);
  /** Which macro the open gesture belongs to, or null when none is. */
  const openMacro = useRef<MacroName | null>(null);

  const randomise = useCallback(() => {
    dispatch({ type: 'randomise', seed: randomSeed() });
  }, []);

  const newSeed = useCallback(() => {
    dispatch({ type: 'newSeed', seed: randomSeed() });
  }, []);

  const setPreset = useCallback((preset: PresetId) => {
    dispatch({ type: 'setPreset', preset });
  }, []);

  const setMacro = useCallback((macro: MacroName, value: number) => {
    // The first move of a gesture opens one; `commitMacro` closes it. A drag therefore
    // saves the state before it began, once, however many values it passes through.
    if (openMacro.current !== macro) {
      openMacro.current = macro;
      macroGesture.current += 1;
    }
    dispatch({ type: 'setMacro', macro, value, gesture: `macro:${String(macroGesture.current)}` });
  }, []);

  const commitMacro = useCallback(() => {
    const macro = openMacro.current;
    if (macro === null) return;
    openMacro.current = null;
    dispatch({ type: 'commitMacro', macro });
  }, []);

  const toggleLock = useCallback((track: number) => {
    dispatch({ type: 'toggleLock', track });
  }, []);

  const beginEdit = useCallback(() => {
    editGesture.current += 1;
  }, []);

  const setCell = useCallback((track: number, step: number, value: boolean) => {
    dispatch({
      type: 'setCell',
      track,
      step,
      value,
      gesture: `edit:${String(editGesture.current)}`,
    });
  }, []);

  const applyTransform = useCallback((pattern: Pattern) => {
    dispatch({ type: 'applyTransform', pattern });
  }, []);

  const undo = useCallback(() => {
    // A macro gesture left open would coalesce the next move into the entry Undo just
    // restored, which is a way of losing a change nobody asked to lose.
    openMacro.current = null;
    dispatch({ type: 'undo' });
  }, []);

  return useMemo(
    () => ({
      state: studio.present,
      canUndo: historyHasSomething(studio),
      randomise,
      newSeed,
      setPreset,
      setMacro,
      commitMacro,
      toggleLock,
      beginEdit,
      setCell,
      applyTransform,
      undo,
    }),
    [
      studio,
      randomise,
      newSeed,
      setPreset,
      setMacro,
      commitMacro,
      toggleLock,
      beginEdit,
      setCell,
      applyTransform,
      undo,
    ],
  );
}

/** The pattern, for anything that only needs that. */
export function patternOf(state: CreativeState): Pattern {
  return state.pattern;
}
