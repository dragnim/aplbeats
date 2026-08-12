import { describe, expect, it } from 'vitest';
import { patternDistance } from '@/generation/metrics';
import { cellAt, countTriggers, STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import { INITIAL_CREATIVE_STATE } from '@/app/openingState';
import {
  canUndo,
  createStudio,
  HISTORY_DEPTH,
  studioReducer,
  type CreativeState,
  type StudioAction,
  type StudioState,
} from '@/app/studio';

/*
 * The creative state and its history.
 *
 * A pure reducer, so all of this is stating inputs and reading outputs — no clock, no
 * React, and no randomness: `randomise` and `newSeed` are handed their seed rather than
 * drawing one, which is what makes them testable at all.
 *
 * The interesting properties are about coalescing. A drag across eight cells must be one
 * Undo and a slider dragged through fifty values must be one Undo, or the history fills
 * with noise and Undo becomes useless exactly when it is needed.
 */

function fresh(): StudioState {
  return createStudio(INITIAL_CREATIVE_STATE);
}

/** Apply a sequence of actions, for readability. */
function run(state: StudioState, ...actions: StudioAction[]): StudioState {
  return actions.reduce(studioReducer, state);
}

function rowOf(pattern: Pattern, track: number): string {
  let row = '';
  for (let step = 0; step < STEP_COUNT; step += 1) row += cellAt(pattern, track, step) ? '1' : '0';
  return row;
}

describe('a fresh studio', () => {
  it('opens on the curated groove with nothing to undo', () => {
    const state = fresh();
    expect(canUndo(state)).toBe(false);
    expect(countTriggers(state.present.pattern)).toBe(32);
    expect(state.present.preset).toBe('straight');
  });
});

describe('randomise', () => {
  it('changes the pattern and adopts the new seed', () => {
    const before = fresh();
    const after = studioReducer(before, { type: 'randomise', seed: 4242 });

    expect(after.present.seed).toBe(4242);
    expect(patternDistance(before.present.pattern, after.present.pattern)).toBeGreaterThan(0);
    expect(canUndo(after)).toBe(true);
  });

  it('is undone completely, pattern and seed together', () => {
    const before = fresh();
    const after = studioReducer(before, { type: 'randomise', seed: 4242 });
    const undone = studioReducer(after, { type: 'undo' });

    expect(undone.present).toEqual(before.present);
    expect(canUndo(undone)).toBe(false);
  });

  it('keeps producing different patterns when pressed repeatedly', () => {
    // The product test for the whole stage, in its smallest form.
    let state = fresh();
    const seen = new Set([JSON.stringify(state.present.pattern)]);
    for (let press = 1; press <= 12; press += 1) {
      state = studioReducer(state, { type: 'randomise', seed: press * 7919 });
      seen.add(JSON.stringify(state.present.pattern));
    }
    expect(seen.size).toBeGreaterThanOrEqual(12);
  });

  it('respects Variation: a low setting barely moves, a high one moves a lot', () => {
    const gentle = run(
      fresh(),
      { type: 'setMacro', macro: 'variation', value: 8, gesture: 'g1' },
      { type: 'randomise', seed: 8888 },
    );
    const drastic = run(
      fresh(),
      { type: 'setMacro', macro: 'variation', value: 100, gesture: 'g1' },
      { type: 'randomise', seed: 8888 },
    );

    const gentleMove = patternDistance(INITIAL_CREATIVE_STATE.pattern, gentle.present.pattern);
    const drasticMove = patternDistance(INITIAL_CREATIVE_STATE.pattern, drastic.present.pattern);
    expect(drasticMove).toBeGreaterThan(gentleMove * 2);
  });
});

describe('new seed', () => {
  it('regenerates outright, ignoring Variation', () => {
    /*
     * The distinction between the two generative buttons. Randomise is a new take on this
     * groove, blended by Variation; New Seed is a clean slate. At a low Variation they must
     * behave very differently or one of them is pointless.
     */
    const base = run(fresh(), { type: 'setMacro', macro: 'variation', value: 5, gesture: 'g1' });
    const randomised = studioReducer(base, { type: 'randomise', seed: 777 });
    const reseeded = studioReducer(base, { type: 'newSeed', seed: 777 });

    const nudge = patternDistance(base.present.pattern, randomised.present.pattern);
    const cleanSlate = patternDistance(base.present.pattern, reseeded.present.pattern);
    expect(cleanSlate).toBeGreaterThan(nudge * 3);
  });

  it('is undoable', () => {
    const before = fresh();
    const after = studioReducer(before, { type: 'newSeed', seed: 31_337 });
    expect(studioReducer(after, { type: 'undo' }).present).toEqual(before.present);
  });
});

describe('presets', () => {
  it('regenerate the pattern and are undoable', () => {
    const before = fresh();
    const after = studioReducer(before, { type: 'setPreset', preset: 'glitch' });

    expect(after.present.preset).toBe('glitch');
    expect(patternDistance(before.present.pattern, after.present.pattern)).toBeGreaterThan(0);

    const undone = studioReducer(after, { type: 'undo' });
    expect(undone.present).toEqual(before.present);
  });

  it('do nothing when the preset is already selected', () => {
    const state = fresh();
    expect(studioReducer(state, { type: 'setPreset', preset: 'straight' })).toBe(state);
  });

  it('ignore a preset that does not exist', () => {
    const state = fresh();
    // Reading a corrupted stored session, or a hand-edited URL one day.
    const nonsense = { type: 'setPreset', preset: 'nope' } as unknown as StudioAction;
    expect(studioReducer(state, nonsense)).toBe(state);
  });
});

describe('macros', () => {
  it('move the number without regenerating until the gesture ends', () => {
    /*
     * The interaction discipline the brief asks for, and the one that will matter far more
     * when APL is doing the generating: the number is live, the groove moves once.
     */
    const before = fresh();
    const dragging = run(
      before,
      { type: 'setMacro', macro: 'density', value: 70, gesture: 'g1' },
      { type: 'setMacro', macro: 'density', value: 80, gesture: 'g1' },
      { type: 'setMacro', macro: 'density', value: 90, gesture: 'g1' },
    );

    expect(dragging.present.density).toBe(90);
    expect(dragging.present.pattern).toBe(before.present.pattern);

    const committed = studioReducer(dragging, { type: 'commitMacro', macro: 'density' });
    expect(committed.present.pattern).not.toBe(before.present.pattern);
  });

  it('make a whole drag one undo', () => {
    let state = fresh();
    for (let value = 63; value <= 95; value += 1) {
      state = studioReducer(state, { type: 'setMacro', macro: 'density', value, gesture: 'drag' });
    }
    state = studioReducer(state, { type: 'commitMacro', macro: 'density' });

    expect(state.past).toHaveLength(1);

    const undone = studioReducer(state, { type: 'undo' });
    expect(undone.present).toEqual(INITIAL_CREATIVE_STATE);
    expect(canUndo(undone)).toBe(false);
  });

  it('make two separate drags two undos', () => {
    const state = run(
      fresh(),
      { type: 'setMacro', macro: 'density', value: 80, gesture: 'first' },
      { type: 'commitMacro', macro: 'density' },
      { type: 'setMacro', macro: 'complexity', value: 20, gesture: 'second' },
      { type: 'commitMacro', macro: 'complexity' },
    );
    expect(state.past).toHaveLength(2);

    const once = studioReducer(state, { type: 'undo' });
    expect(once.present.complexity).toBe(INITIAL_CREATIVE_STATE.complexity);
    expect(once.present.density).toBe(80);

    const twice = studioReducer(once, { type: 'undo' });
    expect(twice.present).toEqual(INITIAL_CREATIVE_STATE);
  });

  it('leave Variation alone when committing, because it does not describe a groove', () => {
    // Variation says what the *next* Randomise will do. Re-rendering the bar when it moves
    // would be answering a question nobody asked.
    const before = fresh();
    const after = run(
      before,
      { type: 'setMacro', macro: 'variation', value: 90, gesture: 'g1' },
      { type: 'commitMacro', macro: 'variation' },
    );
    expect(after.present.variation).toBe(90);
    expect(after.present.pattern).toBe(before.present.pattern);
  });

  it('clamp what they are given', () => {
    const state = run(
      fresh(),
      { type: 'setMacro', macro: 'density', value: 500, gesture: 'a' },
      { type: 'setMacro', macro: 'complexity', value: -20, gesture: 'b' },
      { type: 'setMacro', macro: 'syncopation', value: Number.NaN, gesture: 'c' },
    );
    expect(state.present.density).toBe(100);
    expect(state.present.complexity).toBe(0);
    expect(state.present.syncopation).toBe(0);
  });

  it('do not create a history entry for a commit with no drag behind it', () => {
    const state = fresh();
    expect(studioReducer(state, { type: 'commitMacro', macro: 'density' }).past).toHaveLength(0);
  });
});

describe('manual editing', () => {
  it('makes a whole drag one undo', () => {
    let state = fresh();
    for (let step = 0; step < 8; step += 1) {
      state = studioReducer(state, { type: 'setCell', track: 7, step, value: true, gesture: 'paint' });
    }

    expect(state.past).toHaveLength(1);
    expect(rowOf(state.present.pattern, 7).slice(0, 8)).toBe('11111111');

    const undone = studioReducer(state, { type: 'undo' });
    expect(undone.present.pattern).toEqual(INITIAL_CREATIVE_STATE.pattern);
  });

  it('makes separate presses separate undos', () => {
    const state = run(
      fresh(),
      { type: 'setCell', track: 7, step: 0, value: true, gesture: 'press-1' },
      { type: 'setCell', track: 7, step: 1, value: true, gesture: 'press-2' },
    );
    expect(state.past).toHaveLength(2);
  });

  it('is untouched by a crossing that changes nothing', () => {
    const state = fresh();
    const crossed = studioReducer(state, {
      type: 'setCell',
      track: 7,
      step: 0,
      value: false,
      gesture: 'paint',
    });
    expect(crossed).toBe(state);
  });

  it('still banks history when a drag begins on a cell that does not change', () => {
    /*
     * The bug this guards against was quiet and complete. Marking the gesture open on a
     * no-op crossing meant a drag whose *first* cell already held the value being painted
     * banked no history — and then every later cell in that drag saw a gesture already
     * open and banked none either, so the whole drag could not be undone at all.
     */
    const state = run(
      fresh(),
      { type: 'setCell', track: 7, step: 0, value: false, gesture: 'paint' },
      { type: 'setCell', track: 7, step: 1, value: true, gesture: 'paint' },
      { type: 'setCell', track: 7, step: 2, value: true, gesture: 'paint' },
    );

    expect(state.past).toHaveLength(1);
    expect(studioReducer(state, { type: 'undo' }).present.pattern).toEqual(INITIAL_CREATIVE_STATE.pattern);
  });
});

describe('locks', () => {
  it('are part of the history', () => {
    const before = fresh();
    const after = studioReducer(before, { type: 'toggleLock', track: 3 });

    expect(after.present.locks[3]).toBe(true);
    expect(studioReducer(after, { type: 'undo' }).present.locks[3]).toBe(false);
  });

  it('protect a row from every generative action', () => {
    let state = studioReducer(fresh(), { type: 'toggleLock', track: 0 });
    const protectedRow = rowOf(state.present.pattern, 0);

    state = studioReducer(state, { type: 'randomise', seed: 111 });
    expect(rowOf(state.present.pattern, 0)).toBe(protectedRow);

    state = studioReducer(state, { type: 'newSeed', seed: 222 });
    expect(rowOf(state.present.pattern, 0)).toBe(protectedRow);

    state = studioReducer(state, { type: 'setPreset', preset: 'euclidean' });
    expect(rowOf(state.present.pattern, 0)).toBe(protectedRow);

    state = run(
      state,
      { type: 'setMacro', macro: 'density', value: 95, gesture: 'g' },
      { type: 'commitMacro', macro: 'density' },
    );
    expect(rowOf(state.present.pattern, 0)).toBe(protectedRow);
  });

  it('do not stop the visitor editing the row by hand', () => {
    // Lock means the generator may not alter this track, not that the user may not.
    const state = run(
      fresh(),
      { type: 'toggleLock', track: 0 },
      { type: 'setCell', track: 0, step: 1, value: true, gesture: 'press' },
    );
    expect(cellAt(state.present.pattern, 0, 1)).toBe(true);
  });

  it('can protect the whole kit', () => {
    let state = fresh();
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      state = studioReducer(state, { type: 'toggleLock', track });
    }
    const before = state.present.pattern;
    state = studioReducer(state, { type: 'randomise', seed: 5555 });
    expect(state.present.pattern).toEqual(before);
  });
});

describe('the history', () => {
  it('is bounded, dropping the oldest', () => {
    let state = fresh();
    for (let press = 1; press <= HISTORY_DEPTH + 15; press += 1) {
      state = studioReducer(state, { type: 'randomise', seed: press * 313 });
    }
    expect(state.past).toHaveLength(HISTORY_DEPTH);
  });

  it('runs out gracefully', () => {
    let state = studioReducer(fresh(), { type: 'randomise', seed: 99 });
    state = studioReducer(state, { type: 'undo' });
    expect(canUndo(state)).toBe(false);

    // Undoing past the beginning is a no-op, not an error.
    const stuck = studioReducer(state, { type: 'undo' });
    expect(stuck).toBe(state);
  });

  it('restores every part of the creative state together', () => {
    const before = fresh();
    const changed = run(
      before,
      { type: 'setPreset', preset: 'broken' },
      { type: 'setMacro', macro: 'density', value: 90, gesture: 'a' },
      { type: 'commitMacro', macro: 'density' },
      { type: 'toggleLock', track: 4 },
      { type: 'randomise', seed: 2468 },
    );

    let state: StudioState = changed;
    for (let step = 0; step < 4; step += 1) state = studioReducer(state, { type: 'undo' });

    const restored: CreativeState = state.present;
    expect(restored).toEqual(before.present);
  });
});
