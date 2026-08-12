/*
 * The creative state, and the history of it.
 *
 * Everything a visitor would be sorry to lose: the pattern, the seed it came from, the
 * preset and macros that shaped it, and which tracks are protected from the generator.
 * Tempo, swing and the mixer are deliberately *not* here — see `HISTORY_DEPTH` below.
 *
 * A pure reducer over immutable state, which is what makes Undo a matter of keeping the
 * previous values rather than working out how to reverse anything. Nothing in this file
 * knows that React exists, and nothing in it is random: `randomise` and `newSeed` are
 * given their seed rather than drawing one, so the whole reducer can be tested by
 * stating inputs and reading outputs.
 */

import { generatePattern } from '@/generation/generator';
import { applyVariation } from '@/generation/mutate';
import { isPresetId, type PresetId } from '@/generation/presets';
import { clampSeed } from '@/generation/prng';
import { patternsEqual, setCell, TRACK_COUNT, type Pattern } from '@/pattern/pattern';

/**
 * How many steps back Undo reaches.
 *
 * Thirty is far more than anyone counts and still nothing in memory: a pattern is a
 * hundred and twenty-eight booleans and six numbers.
 */
export const HISTORY_DEPTH = 30;

export type MacroName = 'density' | 'complexity' | 'syncopation' | 'variation';

export const MACRO_NAMES: readonly MacroName[] = ['density', 'complexity', 'syncopation', 'variation'];

/** Everything Undo restores. */
export interface CreativeState {
  readonly pattern: Pattern;
  readonly seed: number;
  readonly preset: PresetId;
  readonly density: number;
  readonly complexity: number;
  readonly syncopation: number;
  readonly variation: number;
  /** Which tracks the generator may not touch, in row order. */
  readonly locks: readonly boolean[];
}

export interface StudioState {
  readonly present: CreativeState;
  readonly past: readonly CreativeState[];
  /**
   * The gesture that last pushed onto the history.
   *
   * How a drag across eight cells becomes one Undo rather than eight: the first change
   * of a gesture saves the state before it, and every later change carrying the same
   * label does not. A slider dragged from twenty to seventy is the same idea.
   */
  readonly gesture: string | null;
}

export type StudioAction =
  /** A new take on the current groove, moved towards it by Variation. */
  | { readonly type: 'randomise'; readonly seed: number }
  /** A clean slate at a new seed. Variation does not apply. */
  | { readonly type: 'newSeed'; readonly seed: number }
  | { readonly type: 'setPreset'; readonly preset: PresetId }
  /** Move a macro without regenerating. `gesture` coalesces a drag into one history entry. */
  | { readonly type: 'setMacro'; readonly macro: MacroName; readonly value: number; readonly gesture: string }
  /**
   * The end of a macro gesture: regenerate at the settings now in force.
   *
   * Carries which macro moved, because Variation is the one that must *not* regenerate —
   * it describes what the next Randomise will do, not what this bar is.
   */
  | { readonly type: 'commitMacro'; readonly macro: MacroName }
  | { readonly type: 'toggleLock'; readonly track: number }
  /**
   * A pattern that came back from APL.
   *
   * Carries the finished matrix rather than the operation that produced it, because by the
   * time this is dispatched the transform has already happened somewhere else and been
   * validated. The reducer's job is only to install it and remember what was there before.
   */
  | { readonly type: 'applyTransform'; readonly pattern: Pattern }
  | {
      readonly type: 'setCell';
      readonly track: number;
      readonly step: number;
      readonly value: boolean;
      readonly gesture: string;
    }
  | { readonly type: 'undo' };

/* ------------------------------------------------------------------------- */

/** A macro value brought into range and onto a whole number. */
export function clampMacro(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** No track locked. */
export function noLocks(): boolean[] {
  return Array.from({ length: TRACK_COUNT }, () => false);
}

/**
 * The pattern these settings describe, from scratch.
 *
 * Used by everything except Randomise: changing a preset or a macro re-renders the same
 * seed at the new setting, so the groove you are shaping stays the groove you are
 * shaping. Locked tracks are carried across untouched.
 */
function regenerate(state: CreativeState): Pattern {
  return generatePattern({
    seed: state.seed,
    preset: state.preset,
    density: state.density,
    complexity: state.complexity,
    syncopation: state.syncopation,
    lockedTracks: state.locks,
    currentPattern: state.pattern,
  });
}

/** `state` with the present pushed onto the history, bounded. */
function remember(state: StudioState, gesture: string | null): StudioState {
  const past = [...state.past, state.present].slice(-HISTORY_DEPTH);
  return { ...state, past, gesture };
}

/**
 * Whether this change begins a new history entry.
 *
 * A gesture that is already open — the same drag, the same slider movement — adds to the
 * entry it started rather than making another.
 */
function isNewGesture(state: StudioState, gesture: string): boolean {
  return state.gesture !== gesture;
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'randomise': {
      /*
       * A new candidate, adopted as far as Variation allows.
       *
       * The seed changes on every press — using the current one would regenerate the
       * identical candidate and the button would appear broken from the second press
       * onwards. The seed shown is therefore the seed of the most recent candidate, which
       * is the honest thing for it to be.
       */
      const seed = clampSeed(action.seed);
      const candidate = generatePattern({
        seed,
        preset: state.present.preset,
        density: state.present.density,
        complexity: state.present.complexity,
        syncopation: state.present.syncopation,
        lockedTracks: state.present.locks,
        currentPattern: state.present.pattern,
      });

      const pattern = applyVariation({
        currentPattern: state.present.pattern,
        candidatePattern: candidate,
        variation: state.present.variation,
        seed,
        lockedTracks: state.present.locks,
      });

      const remembered = remember(state, null);
      return { ...remembered, present: { ...state.present, seed, pattern } };
    }

    case 'newSeed': {
      // Variation deliberately does not apply. This is the "start again" action, and the
      // one that makes the seed feel like a place rather than a number.
      const seed = clampSeed(action.seed);
      const next: CreativeState = { ...state.present, seed };
      const remembered = remember(state, null);
      return { ...remembered, present: { ...next, pattern: regenerate(next) } };
    }

    case 'setPreset': {
      if (!isPresetId(action.preset) || action.preset === state.present.preset) return state;
      const next: CreativeState = { ...state.present, preset: action.preset };
      const remembered = remember(state, null);
      return { ...remembered, present: { ...next, pattern: regenerate(next) } };
    }

    case 'setMacro': {
      const value = clampMacro(action.value);
      if (state.present[action.macro] === value && state.gesture === action.gesture) return state;

      const base = isNewGesture(state, action.gesture) ? remember(state, action.gesture) : state;
      return { ...base, gesture: action.gesture, present: { ...base.present, [action.macro]: value } };
    }

    case 'commitMacro': {
      /*
       * The end of a macro gesture, and where the pattern actually changes.
       *
       * Regenerating on every input event would be a torrent of new bars while the pointer
       * moved — unreadable, and unlistenable while the transport is running. The number
       * moves live; the groove moves once, when the gesture ends.
       *
       * No history entry: `setMacro` already saved the state before the drag began.
       */
      const settled = { ...state, gesture: null };

      /*
       * Variation changes nothing here, and must not.
       *
       * It says how far the *next* Randomise will move, so re-rendering the bar when it
       * moves would be answering a question nobody asked — and worse, it would silently
       * replace the curated opening groove with a generated one the first time anybody
       * touched the slider.
       */
      if (action.macro === 'variation') return settled;

      const pattern = regenerate(state.present);
      if (patternsEqual(pattern, state.present.pattern)) return settled;
      return { ...settled, present: { ...state.present, pattern } };
    }

    case 'toggleLock': {
      const locks = state.present.locks.map((locked, index) => (index === action.track ? !locked : locked));
      const remembered = remember(state, null);
      return { ...remembered, present: { ...state.present, locks } };
    }

    case 'applyTransform': {
      /*
       * One transform, one Undo entry, and an atomic swap.
       *
       * Atomic for free: the pattern is an immutable matrix, so installing it is a single
       * reference change. There is no moment at which half the bar is transformed, and a step
       * already handed to Web Audio played from a complete matrix while the next one plays
       * from a complete matrix.
       *
       * A transform that returns the bar unchanged — reversing a palindrome, rotating by a
       * full cycle — banks no history, because an Undo that does nothing is worse than no
       * Undo at all. It is still a success as far as the caller is concerned.
       *
       * Locks are deliberately not consulted. A lock means the *generator* may not touch a
       * row; a transform is an explicit instruction from the visitor, like clicking a cell.
       */
      if (patternsEqual(action.pattern, state.present.pattern)) {
        return { ...state, gesture: null };
      }

      const remembered = remember(state, null);
      return { ...remembered, present: { ...state.present, pattern: action.pattern } };
    }

    case 'setCell': {
      const pattern = setCell(state.present.pattern, action.track, action.step, action.value);

      /*
       * A crossing that changes nothing is not an edit.
       *
       * Left completely alone, gesture included. Marking the gesture as open here was a
       * quiet bug: a drag whose *first* crossed cell already held the value being painted
       * would open the gesture without banking any history, and then every later cell in
       * that drag saw a gesture already open and banked none either — so the whole drag
       * became impossible to undo.
       */
      if (pattern === state.present.pattern) return state;

      const base = isNewGesture(state, action.gesture) ? remember(state, action.gesture) : state;
      return { ...base, gesture: action.gesture, present: { ...base.present, pattern } };
    }

    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return { past: state.past.slice(0, -1), present: previous, gesture: null };
    }
  }
}

/** Whether there is anything to undo. */
export function canUndo(state: StudioState): boolean {
  return state.past.length > 0;
}

/** A studio wrapped around a creative state, with no history behind it. */
export function createStudio(present: CreativeState): StudioState {
  return { present, past: [], gesture: null };
}
