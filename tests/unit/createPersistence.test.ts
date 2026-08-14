import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APL_GENERATOR_VERSION, DEFAULT_RECIPE_ID, RECIPES } from '@/apl/generators';
import {
  clearSession,
  loadCreateSettings,
  loadExploreDraft,
  loadMasterVolume,
  saveCreateSettings,
  saveExploreDraft,
  saveMasterVolume,
} from '@/app/persistence';
import { MAX_SEED, MIN_SEED } from '@/generation/prng';

/*
 * Five storage keys, and the rule that keeps them apart.
 *
 * Stage 5.1 shipped a bug worth remembering: a global search-and-replace put the Master Volume's
 * `removeItem` inside `saveExploreDraft`, so discarding an Explore draft silently reset
 * somebody's listening level. Nothing failed, nothing warned, and it took instrumenting
 * `Storage.prototype.removeItem` to find.
 *
 * So every save function touches only the key it is named for, `clearSession` is the only thing
 * entitled to reach across them, and both halves of that are asserted here rather than
 * remembered. Stage 6 adds a fifth key, which is a fifth chance to make the same mistake.
 */

const CREATE_KEY = 'aplbeats.apl-create.v1';
const EXPLORE_KEY = 'aplbeats.explore.v1';
const VOLUME_KEY = 'aplbeats.master-volume.v1';
const KIT_KEY = 'aplbeats.kit.v1';
const SESSION_KEY = 'aplbeats.session.v1';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

/* ------------------------------------------------------------------------- */

describe('the Create settings', () => {
  it('round-trip', () => {
    saveCreateSettings({ recipeId: 'broken', seed: 47291 });
    expect(loadCreateSettings()).toEqual({ recipeId: 'broken', seed: 47291 });
  });

  it('are nothing at all when nothing is stored', () => {
    expect(loadCreateSettings()).toBeNull();
  });

  it('clamp the seed on the way in and on the way out', () => {
    saveCreateSettings({ recipeId: DEFAULT_RECIPE_ID, seed: 1e9 });
    const loaded = loadCreateSettings();
    expect(loaded?.seed).toBeGreaterThanOrEqual(MIN_SEED);
    expect(loaded?.seed).toBeLessThanOrEqual(MAX_SEED);
  });

  it('refuse a recipe that no longer exists', () => {
    // A recipe withdrawn in a later release must not be restored as a selector value nothing
    // matches — nor be a startup failure.
    window.localStorage.setItem(
      CREATE_KEY,
      JSON.stringify({
        schema: 1,
        aplGeneratorVersion: APL_GENERATOR_VERSION,
        recipeId: 'euclidean-kit',
        seed: 47291,
      }),
    );
    expect(loadCreateSettings()).toBeNull();
  });

  it('refuse settings written under a different APL generator version', () => {
    /*
     * Recipe plus seed describes a rhythm. Under a different set of recipe expressions it would
     * describe a different one, so restoring the pair and implying it would reproduce what
     * somebody heard would be a small, quiet lie.
     */
    window.localStorage.setItem(
      CREATE_KEY,
      JSON.stringify({
        schema: 1,
        aplGeneratorVersion: APL_GENERATOR_VERSION + 1,
        recipeId: RECIPES[0]!.id,
        seed: 47291,
      }),
    );
    expect(loadCreateSettings()).toBeNull();
  });

  it('refuse anything malformed rather than trusting it', () => {
    for (const raw of [
      'not json',
      'null',
      '[]',
      JSON.stringify({ schema: 99, recipeId: 'broken', seed: 1 }),
      JSON.stringify({ schema: 1, aplGeneratorVersion: APL_GENERATOR_VERSION, seed: 1 }),
      JSON.stringify({
        schema: 1,
        aplGeneratorVersion: APL_GENERATOR_VERSION,
        recipeId: 'broken',
        seed: 'nope',
      }),
    ]) {
      window.localStorage.setItem(CREATE_KEY, raw);
      expect(loadCreateSettings(), raw).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------------- */

describe('the Explore draft, and the Stage 5 drafts that came before it', () => {
  it('loads a Stage 5 draft that has no context at all', () => {
    /*
     * The migration, and the reason `context` is optional rather than a schema bump. A draft
     * written before Stage 6 existed has no such field; discarding it for missing something that
     * did not exist when it was written would be throwing away somebody's APL for nothing.
     */
    window.localStorage.setItem(EXPLORE_KEY, JSON.stringify({ schema: 1, expression: '2⌽m', target: 'all' }));

    const draft = loadExploreDraft();
    expect(draft?.expression).toBe('2⌽m');
    expect(draft?.target).toBe('all');
    expect(draft?.context).toBeUndefined();
  });

  it('round-trips a draft that carries a random seed', () => {
    saveExploreDraft({ expression: '?8 16⍴2', target: 'all', context: { randomSeed: 47291 } });
    expect(loadExploreDraft()).toEqual({
      expression: '?8 16⍴2',
      target: 'all',
      context: { randomSeed: 47291 },
    });
  });

  it('writes no context field when there is none, so an older build could still read it', () => {
    saveExploreDraft({ expression: '2⌽m', target: 0 });
    const raw = JSON.parse(window.localStorage.getItem(EXPLORE_KEY) ?? '{}') as Record<string, unknown>;
    expect(Object.hasOwn(raw, 'context')).toBe(false);
  });

  it('keeps the expression when only the context is corrupt', () => {
    // Losing somebody's APL because the optional half of the record was damaged would be the
    // wrong trade.
    window.localStorage.setItem(
      EXPLORE_KEY,
      JSON.stringify({ schema: 1, expression: '2⌽m', target: 'all', context: { randomSeed: 'nope' } }),
    );
    const draft = loadExploreDraft();
    expect(draft?.expression).toBe('2⌽m');
    expect(draft?.context).toBeUndefined();
  });

  it('clamps a stored seed, so nothing outside 1–999999 can reach ⎕RL by way of storage', () => {
    window.localStorage.setItem(
      EXPLORE_KEY,
      JSON.stringify({ schema: 1, expression: '?8 16⍴2', target: 'all', context: { randomSeed: 1e12 } }),
    );
    const seed = loadExploreDraft()?.context?.randomSeed ?? 0;
    expect(seed).toBeGreaterThanOrEqual(MIN_SEED);
    expect(seed).toBeLessThanOrEqual(MAX_SEED);
  });
});

/* ------------------------------------------------------------------------- */

describe('one key each', () => {
  /** Everything stored, so a save can be checked for reaching outside its own key. */
  function fillEverything(): void {
    saveCreateSettings({ recipeId: 'broken', seed: 47291 });
    saveExploreDraft({ expression: '2⌽m', target: 'all' });
    saveMasterVolume(0.37);
    window.localStorage.setItem(KIT_KEY, JSON.stringify({ schema: 1, kitId: 'tr-909' }));
    window.localStorage.setItem(SESSION_KEY, 'session');
  }

  const survivors = () => ({
    create: window.localStorage.getItem(CREATE_KEY),
    explore: window.localStorage.getItem(EXPLORE_KEY),
    volume: window.localStorage.getItem(VOLUME_KEY),
    kit: window.localStorage.getItem(KIT_KEY),
    session: window.localStorage.getItem(SESSION_KEY),
  });

  it('discarding an Explore draft touches nothing else', () => {
    fillEverything();
    const before = survivors();

    saveExploreDraft(null);

    const after = survivors();
    expect(after.explore).toBeNull();
    expect(after.create).toBe(before.create);
    expect(after.volume).toBe(before.volume);
    expect(after.kit).toBe(before.kit);
    expect(after.session).toBe(before.session);
    // The one that was actually lost in Stage 5.1, checked by value rather than by presence.
    expect(loadMasterVolume()).toBeCloseTo(0.37, 5);
  });

  it('writing Create settings touches nothing else', () => {
    fillEverything();
    const before = survivors();

    saveCreateSettings({ recipeId: 'cross', seed: 12345 });

    const after = survivors();
    expect(after.explore).toBe(before.explore);
    expect(after.volume).toBe(before.volume);
    expect(after.kit).toBe(before.kit);
    expect(after.session).toBe(before.session);
    expect(loadMasterVolume()).toBeCloseTo(0.37, 5);
    expect(loadExploreDraft()?.expression).toBe('2⌽m');
  });

  it('writing a volume or a draft leaves the Create settings alone', () => {
    fillEverything();

    saveMasterVolume(0.9);
    saveExploreDraft({ expression: '⌽m', target: 'all' });

    expect(loadCreateSettings()).toEqual({ recipeId: 'broken', seed: 47291 });
  });

  it('clearSession is the one thing entitled to reach across all five', () => {
    fillEverything();
    clearSession();

    const after = survivors();
    expect(after.create).toBeNull();
    expect(after.explore).toBeNull();
    expect(after.volume).toBeNull();
    expect(after.kit).toBeNull();
    expect(after.session).toBeNull();
  });
});
