import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GENERATOR_VERSION } from '@/generation/version';
import { INITIAL_CREATIVE_STATE } from '@/app/openingState';
import { clearSession, loadSession, saveSession, type Session } from '@/app/persistence';
import { studioReducer, createStudio } from '@/app/studio';
import { createMixer, setVolume, toggleMute } from '@/pattern/mixer';
import { countTriggers } from '@/pattern/pattern';

/*
 * Reading a session back.
 *
 * Every one of these is really the same test: `localStorage` is untrusted input. It is
 * editable by anyone with the developer tools open, it survives across versions of the
 * application, and it can be truncated by a quota. So the interesting cases are all the
 * malformed ones — a valid round trip is the easy half.
 */

const STORAGE_KEY = 'aplbeats.session.v1';

function sessionOf(overrides: Partial<Session> = {}): Session {
  return {
    creative: INITIAL_CREATIVE_STATE,
    bpm: 112,
    swing: 0.18,
    mixer: createMixer(),
    ...overrides,
  };
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  clearSession();
});

describe('a round trip', () => {
  it('brings everything back', () => {
    const studio = studioReducer(createStudio(INITIAL_CREATIVE_STATE), {
      type: 'randomise',
      seed: 4242,
    });
    const mixer = toggleMute(setVolume(createMixer(), 2, 0.31), 5);
    const session = sessionOf({ creative: studio.present, bpm: 140, swing: 0.42, mixer });

    saveSession(session);
    const restored = loadSession();

    expect(restored).not.toBeNull();
    expect(restored?.creative.pattern).toEqual(session.creative.pattern);
    expect(restored?.creative.seed).toBe(4242);
    expect(restored?.creative.preset).toBe(session.creative.preset);
    expect(restored?.creative.density).toBe(session.creative.density);
    expect(restored?.creative.variation).toBe(session.creative.variation);
    expect(restored?.bpm).toBe(140);
    expect(restored?.swing).toBeCloseTo(0.42, 6);
    expect(restored?.mixer[2]?.volume).toBeCloseTo(0.31, 6);
    expect(restored?.mixer[5]?.muted).toBe(true);
  });

  it('brings locks back', () => {
    const locked = studioReducer(createStudio(INITIAL_CREATIVE_STATE), {
      type: 'toggleLock',
      track: 3,
    });
    saveSession(sessionOf({ creative: locked.present }));
    expect(loadSession()?.creative.locks[3]).toBe(true);
  });

  it('finds nothing when nothing was stored', () => {
    expect(loadSession()).toBeNull();
  });

  it('forgets on request', () => {
    saveSession(sessionOf());
    expect(loadSession()).not.toBeNull();
    clearSession();
    expect(loadSession()).toBeNull();
  });
});

describe('a session that cannot be trusted', () => {
  it('is ignored when it is not JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not json at all {{{');
    expect(loadSession()).toBeNull();
  });

  it('is ignored when the schema is from another version', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schema: 99, generator: GENERATOR_VERSION, creative: {} }),
    );
    expect(loadSession()).toBeNull();
  });

  it('is ignored when the generator has moved on', () => {
    /*
     * The version that matters most. Tuning the weights changes what a seed *means*, so a
     * stored seed from an older generator would restore a groove nobody had ever heard and
     * blame it on the seed. Discarded rather than regenerated as something else.
     */
    saveSession(sessionOf());
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...(stored as object), generator: GENERATOR_VERSION + 1 }),
    );
    expect(loadSession()).toBeNull();
  });

  it('is ignored when the pattern is missing', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schema: 1, generator: GENERATOR_VERSION, creative: { seed: 5 } }),
    );
    expect(loadSession()).toBeNull();
  });

  it('survives a pattern of the wrong shape', () => {
    // `fromBits` pads and trims to eight by sixteen, so a short or long array lands on the
    // standard shape rather than producing a matrix nothing else can cope with.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schema: 1,
        generator: GENERATOR_VERSION,
        creative: { bits: [[1, 1, 1]], seed: 7, preset: 'broken' },
      }),
    );

    const restored = loadSession();
    expect(restored?.creative.pattern).toHaveLength(8);
    expect(restored?.creative.pattern[0]).toHaveLength(16);
    expect(countTriggers(restored?.creative.pattern ?? [])).toBe(3);
  });

  it('clamps numbers that would break the scheduler', () => {
    /*
     * A `NaN` tempo reaching the scheduler is a beat that never arrives, and this is the
     * one path by which a hand-edited value could get there.
     */
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schema: 1,
        generator: GENERATOR_VERSION,
        creative: {
          bits: [[1]],
          seed: -5,
          density: 5000,
          complexity: -20,
          syncopation: null,
          variation: 'lots',
        },
        bpm: Number.NaN,
        swing: 99,
      }),
    );

    const restored = loadSession();
    expect(restored).not.toBeNull();
    expect(Number.isFinite(restored?.bpm ?? Number.NaN)).toBe(true);
    expect(restored?.bpm).toBeGreaterThanOrEqual(60);
    expect(restored?.swing).toBeLessThanOrEqual(1);
    expect(restored?.creative.density).toBe(100);
    expect(restored?.creative.complexity).toBe(0);
    expect(restored?.creative.seed).toBeGreaterThan(0);
  });

  it('falls back to a real preset when the stored one does not exist', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schema: 1,
        generator: GENERATOR_VERSION,
        creative: { bits: [[1]], preset: 'nonexistent' },
      }),
    );
    expect(loadSession()?.creative.preset).toBe('straight');
  });

  it('falls back to the default mixer when the stored one is nonsense', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schema: 1,
        generator: GENERATOR_VERSION,
        creative: { bits: [[1]] },
        mixer: 'not an array',
      }),
    );
    expect(loadSession()?.mixer).toEqual(createMixer());
  });
});
