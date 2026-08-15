import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROOT, DEFAULT_SCALE_ID, DEFAULT_TONE_RECIPE_ID } from '@/apl/toneGenerators';
import { DEFAULT_TONE_VOLUME } from '@/audio/tones/sounds';
import {
  clearSession,
  loadExploreDraft,
  loadSession,
  loadToneCreateSettings,
  loadToneExploreDraft,
  loadTones,
  loadToneVolume,
  saveExploreDraft,
  saveSession,
  saveToneCreateSettings,
  saveToneExploreDraft,
  saveTones,
  saveToneVolume,
} from '@/app/persistence';
import { createStudio, studioReducer, type CreativeState } from '@/app/studio';
import { INITIAL_CREATIVE_STATE } from '@/app/openingState';
import { createMixer } from '@/pattern/mixer';
import { createInitialGroove } from '@/pattern/initialGroove';
import { emptyPhrase, openingPhrase, REST, setStep } from '@/tones/phrase';

/*
 * What is remembered, where, and what happens when one of the keys goes bad.
 *
 * The interesting property is the *separation*. Stage 8 could have put the phrase in the session
 * record next to the pattern — it is creative state, it is in the same Undo history, and one key
 * would have been less code. It is separate because of what the session key means: a session is
 * discarded outright whenever the drum generator's version changes, since a stored seed describes
 * a different rhythm under a different generator. A phrase is sixteen numbers that describe
 * themselves, and tuning the drum generator has nothing to say about somebody's tune.
 *
 * So the claim these tests hold in place is: **the keys are independent**. Losing one must never
 * take another with it, and no key may reach across into another's.
 */

beforeEach(() => {
  clearSession();
});

describe('the phrase, under its own key', () => {
  it('comes back exactly as it was left', () => {
    const phrase = setStep(openingPhrase(), 7, 72);
    saveTones({ phrase, soundId: 'four-bass' });

    const restored = loadTones();
    expect(restored?.phrase).toEqual(phrase);
    expect(restored?.soundId).toBe('four-bass');
  });

  it('survives a drum generator version bump that discards the session', () => {
    /*
     * The whole reason for the separate key, and the behaviour worth stating plainly: after a
     * generator bump the drums restart from the opening groove and the phrase is exactly where it
     * was left.
     */
    saveTones({ phrase: emptyPhrase(), soundId: 'fake-flute' });
    saveSession({
      creative: INITIAL_CREATIVE_STATE,
      bpm: 112,
      swing: 0.18,
      mixer: createMixer(),
    });

    // Exactly what a generator bump does to the session record: its version no longer matches.
    const raw = globalThis.localStorage.getItem('aplbeats.session.v1');
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    globalThis.localStorage.setItem('aplbeats.session.v1', JSON.stringify({ ...parsed, generator: 999 }));

    expect(loadSession()).toBeNull();
    expect(loadTones()?.phrase).toEqual(emptyPhrase());
    expect(loadTones()?.soundId).toBe('fake-flute');
  });

  it('discards a phrase that has been tampered with, rather than repairing it', () => {
    /*
     * `localStorage` is editable by anyone with the developer tools open, so a pitch of 4000
     * reaching the sampler must be impossible rather than merely unlikely — and a *repaired*
     * phrase is not the phrase anybody wrote.
     */
    const bad = [
      { phrase: Array.from({ length: 16 }, () => 4000), soundId: 'chunky' },
      { phrase: Array.from({ length: 17 }, () => 60), soundId: 'chunky' },
      { phrase: [60.5, ...Array.from({ length: 15 }, () => REST)], soundId: 'chunky' },
      { phrase: 'not a phrase', soundId: 'chunky' },
    ];

    for (const record of bad) {
      globalThis.localStorage.setItem('aplbeats.tones.v1', JSON.stringify({ schema: 1, ...record }));
      expect(loadTones(), JSON.stringify(record).slice(0, 40)).toBeNull();
    }
  });

  it('keeps a valid phrase when only its instrument has gone', () => {
    // Losing a whole phrase because its sound was renamed would be the wrong trade.
    globalThis.localStorage.setItem(
      'aplbeats.tones.v1',
      JSON.stringify({ schema: 1, phrase: [...openingPhrase()], soundId: 'trombone' }),
    );

    const restored = loadTones();
    expect(restored?.phrase).toEqual(openingPhrase());
    expect(restored?.soundId).toBe('petals-piano');
  });

  it('carries a phrase across the sound-set rename', () => {
    /*
     * The migration that actually happens to somebody.
     *
     * Stage 8 shipped four sounds identified by category — `lead`, `bass`, `keys`, `pad` — and the
     * curation pass replaced them with six identified by preset. Anybody who used Tones has one of
     * the old four in storage, and none of them exists any more.
     *
     * There is deliberately no translation table. Two of the four sounds are *gone* rather than
     * renamed, so mapping `lead` to a lead would hand somebody an instrument they never chose; and
     * a schema bump would throw the phrase away, which is the one thing worth keeping. So the
     * phrase is restored and the sound falls back to the new default, which is exactly what the
     * unknown-identifier path already did.
     */
    for (const stale of ['lead', 'bass', 'keys', 'pad']) {
      globalThis.localStorage.setItem(
        'aplbeats.tones.v1',
        JSON.stringify({ schema: 1, phrase: [...openingPhrase()], soundId: stale }),
      );

      const restored = loadTones();
      expect(restored?.phrase, stale).toEqual(openingPhrase());
      expect(restored?.soundId, stale).toBe('petals-piano');
    }
  });
});

describe('the Tone level', () => {
  it('comes back, and defaults below the drums rather than above them', () => {
    expect(loadToneVolume()).toBe(DEFAULT_TONE_VOLUME);
    expect(DEFAULT_TONE_VOLUME).toBeLessThan(1);

    saveToneVolume(0.42);
    expect(loadToneVolume()).toBeCloseTo(0.42, 5);
  });

  it('falls back rather than to silence when the stored value is nonsense', () => {
    globalThis.localStorage.setItem('aplbeats.tone-volume.v1', JSON.stringify({ schema: 1, volume: 'loud' }));
    expect(loadToneVolume()).toBe(DEFAULT_TONE_VOLUME);
  });

  it('is clamped on the way in and on the way out', () => {
    saveToneVolume(9);
    expect(loadToneVolume()).toBe(1);
    saveToneVolume(-3);
    expect(loadToneVolume()).toBe(0);
  });
});

describe('the Tone Create controls', () => {
  it('come back, and execute nothing on the way', () => {
    saveToneCreateSettings({ recipeId: 'sparse', scaleId: 'dorian', root: 55, seed: 4711 });

    const restored = loadToneCreateSettings();
    expect(restored).toEqual({ recipeId: 'sparse', scaleId: 'dorian', root: 55, seed: 4711 });
  });

  it('are discarded when the Tone generator version moves, and only then', () => {
    saveToneCreateSettings({
      recipeId: DEFAULT_TONE_RECIPE_ID,
      scaleId: DEFAULT_SCALE_ID,
      root: DEFAULT_ROOT,
      seed: 1,
    });

    const raw = globalThis.localStorage.getItem('aplbeats.apl-tone-create.v1');
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    globalThis.localStorage.setItem(
      'aplbeats.apl-tone-create.v1',
      JSON.stringify({ ...parsed, toneGeneratorVersion: 99 }),
    );

    // Recipe plus scale plus root plus seed describes a phrase. Under a different set of recipe
    // expressions the same four values would describe a different one.
    expect(loadToneCreateSettings()).toBeNull();
  });

  it('refuse a recipe or scale this build does not have', () => {
    globalThis.localStorage.setItem(
      'aplbeats.apl-tone-create.v1',
      JSON.stringify({
        schema: 1,
        toneGeneratorVersion: 1,
        recipeId: 'jazz',
        scaleId: 'dorian',
        root: 60,
        seed: 1,
      }),
    );
    expect(loadToneCreateSettings()).toBeNull();
  });
});

describe('the two Explore drafts', () => {
  it('do not touch each other', () => {
    /*
     * The reason there are two of them. `⌽m` and `⌽n` are different programs against different
     * data, and an editor that replaced one with the other when somebody changed tab would destroy
     * work on every switch.
     */
    saveExploreDraft({ expression: '2⌽m', target: 'all' });
    saveToneExploreDraft({ expression: '(48⌈84⌊n+7)×0<n' });

    expect(loadExploreDraft()?.expression).toBe('2⌽m');
    expect(loadToneExploreDraft()?.expression).toBe('(48⌈84⌊n+7)×0<n');

    saveToneExploreDraft(null);
    expect(loadToneExploreDraft()).toBeNull();
    // Clearing one left the other alone, which is the property being tested.
    expect(loadExploreDraft()?.expression).toBe('2⌽m');

    saveToneExploreDraft({ expression: '⌽n' });
    saveExploreDraft(null);
    expect(loadExploreDraft()).toBeNull();
    expect(loadToneExploreDraft()?.expression).toBe('⌽n');
  });

  it('carry the seed a recipe expression needs, and only when it needs one', () => {
    saveToneExploreDraft({ expression: '⌽n' });
    expect(loadToneExploreDraft()?.context).toBeUndefined();

    saveToneExploreDraft({ expression: '?16⍴5', context: { randomSeed: 4711 } });
    expect(loadToneExploreDraft()?.context?.randomSeed).toBe(4711);
  });

  it('refuse a draft that is not a string of sensible length', () => {
    globalThis.localStorage.setItem(
      'aplbeats.tone-explore.v1',
      JSON.stringify({ schema: 1, expression: '' }),
    );
    expect(loadToneExploreDraft()).toBeNull();

    globalThis.localStorage.setItem(
      'aplbeats.tone-explore.v1',
      JSON.stringify({ schema: 1, expression: 'n'.repeat(5000) }),
    );
    expect(loadToneExploreDraft()).toBeNull();
  });
});

describe('one history, both layers', () => {
  const start = (): CreativeState => ({ ...INITIAL_CREATIVE_STATE, pattern: createInitialGroove() });

  it('undoes whichever thing was changed last', () => {
    /*
     * Nobody making music thinks in layers while they work: you transpose the phrase, you dislike
     * it, you press Undo. Two stacks would mean the button had to guess which layer you meant.
     */
    let state = createStudio(start());
    state = studioReducer(state, { type: 'setCell', track: 0, step: 5, value: true, gesture: 'a' });
    state = studioReducer(state, { type: 'applyPhrase', phrase: emptyPhrase() });

    expect(state.present.phrase).toEqual(emptyPhrase());

    state = studioReducer(state, { type: 'undo' });
    expect(state.present.phrase).toEqual(openingPhrase());
    // The drum edit is still there — Undo went back one step, not one layer.
    expect(state.present.pattern[0]?.[5]).toBe(true);

    state = studioReducer(state, { type: 'undo' });
    expect(state.present.pattern[0]?.[5]).toBe(false);
  });

  it('coalesces a note drag into one entry, like a cell drag', () => {
    let state = createStudio(start());
    for (const value of [61, 62, 63, 64, 65]) {
      state = studioReducer(state, { type: 'setNote', step: 0, value, gesture: 'note:1' });
    }

    expect(state.present.phrase[0]).toBe(65);
    state = studioReducer(state, { type: 'undo' });
    // One gesture, one Undo: back to where the phrase started rather than to 64.
    expect(state.present.phrase[0]).toBe(60);
  });

  it('banks no history for a phrase transform that changed nothing', () => {
    // An Undo entry that appears to do nothing is worse than no Undo entry. Reversing a
    // palindrome is still a success as far as the caller is concerned.
    let state = createStudio(start());
    state = studioReducer(state, { type: 'applyPhrase', phrase: openingPhrase() });
    expect(state.past).toHaveLength(0);
  });

  it('refuses a note that is not one', () => {
    let state = createStudio(start());
    const before = state.present.phrase;
    state = studioReducer(state, { type: 'setNote', step: 0, value: 4000, gesture: 'x' });
    expect(state.present.phrase).toBe(before);
  });

  it('leaves the phrase alone when the rhythm is regenerated', () => {
    // Generating a rhythm has no opinion about somebody's tune, and vice versa.
    let state = createStudio(start());
    state = studioReducer(state, { type: 'newSeed', seed: 4711 });
    expect(state.present.phrase).toEqual(openingPhrase());

    state = studioReducer(state, { type: 'applyPhrase', phrase: emptyPhrase() });
    const rhythm = state.present.pattern;
    state = studioReducer(state, { type: 'applyPhrase', phrase: openingPhrase() });
    expect(state.present.pattern).toBe(rhythm);
  });
});
