/*
 * Mute and volume, one entry per track.
 *
 * Alongside the pattern rather than inside it: the pattern says what the drummer
 * plays, the mixer says how it is heard, and only the first of those is going to
 * become an APL array. Muting a track therefore leaves its row untouched, which
 * is why a mute can be lifted and the part is still there.
 *
 * Pure, and independent of the audio graph. The engine reads these values when it
 * schedules a hit; nothing here knows that Web Audio exists.
 */

import { TRACKS, type TrackId } from './tracks';

export interface TrackMix {
  readonly muted: boolean;
  /** Linear fader position, 0 to 1. Converted to a gain by the audio engine. */
  readonly volume: number;
}

/** One `TrackMix` per track, in row order. */
export type Mixer = readonly TrackMix[];

export const MIN_VOLUME = 0;
export const MAX_VOLUME = 1;

/** `volume` brought inside the fader's travel, with `NaN` read as silence. */
export function clampVolume(volume: number): number {
  if (Number.isNaN(volume)) return MIN_VOLUME;
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, volume));
}

/** A mixer with every track unmuted at the kit's balance. */
export function createMixer(): Mixer {
  return TRACKS.map((track) => ({ muted: false, volume: clampVolume(track.defaultVolume) }));
}

/** `mixer` with one track's mute flipped. Unknown rows are returned unchanged. */
export function toggleMute(mixer: Mixer, track: number): Mixer {
  const entry = mixer[track];
  if (entry === undefined) return mixer;
  return mixer.map((mix, index) => (index === track ? { ...mix, muted: !mix.muted } : mix));
}

/** `mixer` with one track's fader moved. */
export function setVolume(mixer: Mixer, track: number, volume: number): Mixer {
  const entry = mixer[track];
  if (entry === undefined) return mixer;

  const next = clampVolume(volume);
  if (entry.volume === next) return mixer;
  return mixer.map((mix, index) => (index === track ? { ...mix, volume: next } : mix));
}

/**
 * The level a track should actually sound at, 0 when it is muted.
 *
 * The one place that combines the two, so the engine never has to remember to
 * check both and the rule is testable on its own.
 */
export function effectiveLevel(mixer: Mixer, track: number): number {
  const entry = mixer[track];
  if (entry === undefined) return 0;
  return entry.muted ? 0 : clampVolume(entry.volume);
}

/** Whether a track would make any sound at all if its row fired. */
export function isAudible(mixer: Mixer, track: number): boolean {
  return effectiveLevel(mixer, track) > 0;
}

/** The track identifier for a row, for the engine to look up a voice with. */
export function trackIdFor(track: number): TrackId | undefined {
  return TRACKS[track]?.id;
}
