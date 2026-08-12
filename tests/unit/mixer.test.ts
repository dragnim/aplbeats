import { describe, expect, it } from 'vitest';
import {
  clampVolume,
  createMixer,
  effectiveLevel,
  MAX_VOLUME,
  MIN_VOLUME,
  setVolume,
  toggleMute,
  trackIdFor,
} from '@/pattern/mixer';
import { TRACKS } from '@/pattern/tracks';

describe('creating a mixer', () => {
  it('has one entry per track, unmuted, at the kit balance', () => {
    const mixer = createMixer();
    expect(mixer).toHaveLength(TRACKS.length);
    mixer.forEach((mix, index) => {
      expect(mix.muted).toBe(false);
      expect(mix.volume).toBe(TRACKS[index]?.defaultVolume);
    });
  });

  it('starts the kit balanced rather than flat', () => {
    // Eight percussion voices all at full is not a kit, it is a pile. The hats and
    // percussion start below the kick and snare because that is what a groove needs.
    const mixer = createMixer();
    const kick = mixer[0]?.volume ?? 0;
    const closedHat = mixer[2]?.volume ?? 0;
    expect(kick).toBeGreaterThan(closedHat);
    for (const mix of mixer) {
      expect(mix.volume).toBeGreaterThan(0);
      expect(mix.volume).toBeLessThanOrEqual(1);
    }
  });
});

describe('volume', () => {
  it('is clamped to the fader travel', () => {
    expect(clampVolume(-1)).toBe(MIN_VOLUME);
    expect(clampVolume(5)).toBe(MAX_VOLUME);
    expect(clampVolume(0.42)).toBe(0.42);
  });

  it('reads anything unusable as silence', () => {
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(MAX_VOLUME);
  });

  it('moves one fader and leaves the rest', () => {
    const before = createMixer();
    const after = setVolume(before, 3, 0.25);
    expect(after[3]?.volume).toBe(0.25);
    expect(after[2]).toBe(before[2]);
  });

  it('never mutates, and returns the same mixer when nothing moved', () => {
    const before = createMixer();
    const same = setVolume(before, 0, before[0]?.volume ?? 0);
    expect(same).toBe(before);
    expect(setVolume(before, 99, 0.5)).toBe(before);
  });
});

describe('mute', () => {
  it('flips one track', () => {
    const muted = toggleMute(createMixer(), 1);
    expect(muted[1]?.muted).toBe(true);
    expect(muted[0]?.muted).toBe(false);
    expect(toggleMute(muted, 1)[1]?.muted).toBe(false);
  });

  it('leaves the fader where it was, so the mute can be lifted', () => {
    const before = createMixer();
    const muted = toggleMute(before, 4);
    expect(muted[4]?.volume).toBe(before[4]?.volume);
  });

  it('ignores a track that does not exist', () => {
    const before = createMixer();
    expect(toggleMute(before, 99)).toBe(before);
  });
});

describe('the level a track actually sounds at', () => {
  it('combines mute and volume in one place', () => {
    const mixer = setVolume(createMixer(), 0, 0.8);
    expect(effectiveLevel(mixer, 0)).toBe(0.8);
    expect(effectiveLevel(toggleMute(mixer, 0), 0)).toBe(0);
  });

  it('is zero for a track that is not there', () => {
    expect(effectiveLevel(createMixer(), 99)).toBe(0);
  });
});

describe('track identifiers', () => {
  it('names the voice for each row', () => {
    expect(trackIdFor(0)).toBe('kick');
    expect(trackIdFor(7)).toBe('rim');
    expect(trackIdFor(8)).toBeUndefined();
  });

  it('is unique across the kit', () => {
    // The identifier is what a saved pattern refers to and what the engine looks a
    // voice up by. Two rows sharing one would silently play the same sound twice.
    const ids = TRACKS.map((track) => track.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
