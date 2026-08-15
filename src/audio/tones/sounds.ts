/*
 * The four Tone sounds, and how loud each one is.
 *
 * One preset per category from the Jupiter-4 public-domain library, chosen by measuring
 * candidates rather than by reading their names — attack time, peak level, sustain-to-attack
 * energy and brightness. `scripts/prepare-jupiter4.mjs` records what was measured and why, and
 * `src/audio/tones/jupiter4.json` records exactly which recordings were taken.
 *
 * The gains are the same idea as the drum kits': the recordings arrive at wildly different levels
 * — the Pad peaks at 6% of full scale and the Lead at 100% — and a Sound selector that changed
 * how loud the melody was would be a volume control pretending to be an instrument control. Each
 * gain brings its sound to the same working peak, and nothing else about the recording is touched.
 *
 * `--tone-target` below is well under the drums, on purpose. A melody that has to be turned down
 * before the kit is audible is a melody mixed too loud, and Stage 8's whole promise is that the
 * groove keeps playing underneath.
 */

import manifest from './jupiter4.json';

/** Where the prepared samples live under the published base path. */
export const TONE_AUDIO_DIRECTORY = 'audio/tones';

export type ToneSoundId = 'lead' | 'bass' | 'keys' | 'pad';

export interface ToneSample {
  readonly file: string;
  /** The MIDI note this recording was played at. Pitch shifting is relative to it. */
  readonly rootMidi: number;
}

export interface ToneSoundDefinition {
  readonly id: ToneSoundId;
  /** What the selector shows. */
  readonly name: string;
  /** One line, for the selector's title. */
  readonly blurb: string;
  /**
   * Playback gain, from measurement.
   *
   * Each sound's loudest prepared recording is brought to the same peak, so switching sound
   * changes the timbre and not the level. Derived by `npm run measure:tones`, not chosen by ear.
   */
  readonly gain: number;
  readonly samples: readonly ToneSample[];
}

/**
 * The peak every sound is brought to.
 *
 * Chosen against the drums rather than in isolation: the synthesised kit's loudest voice peaks
 * around −1.2 dBFS, and a melodic line sitting about 8 dB below that is present without being
 * the loudest thing in the bar. It is one number, applied the same way to all four, so the
 * *relative* character of the four presets survives — a bright lead still reads brighter than a
 * pad, it just no longer arrives sixteen times louder.
 */
export const TONE_TARGET_PEAK = 0.34;

/** The peak of each sound's loudest prepared recording, read from the manifest. */
function loudestPeak(id: ToneSoundId): number {
  const samples = manifest.sounds[id]?.samples ?? [];
  return samples.reduce((peak, sample) => Math.max(peak, sample.peak ?? 0), 0);
}

function samplesFor(id: ToneSoundId): ToneSample[] {
  return (manifest.sounds[id]?.samples ?? []).map((sample) => ({
    file: sample.file,
    rootMidi: sample.rootMidi,
  }));
}

function define(id: ToneSoundId, name: string, blurb: string): ToneSoundDefinition {
  const peak = loudestPeak(id);
  return {
    id,
    name,
    blurb,
    // A sound whose manifest went missing must not become a divide-by-zero that plays at infinity.
    gain: peak > 0 ? Number((TONE_TARGET_PEAK / peak).toFixed(3)) : 1,
    samples: samplesFor(id),
  };
}

/**
 * The four, in the order they are offered.
 *
 * Lead first because it is the one that most obviously demonstrates what Tones is: bright,
 * immediate, and impossible to miss under a drum kit.
 */
export const TONE_SOUNDS: readonly ToneSoundDefinition[] = [
  define('lead', 'Lead', 'Blip Lead. Bright and immediate — cuts straight through the kit.'),
  define('bass', 'Bass', '4 Bass. Round and low, sitting under the kick rather than against it.'),
  define('keys', 'Keys', 'Petals Piano. Percussive, so sixteenths still articulate.'),
  define('pad', 'Pad', 'jp4 - Shimmer. Sustained and airy, for phrases with room in them.'),
];

const BY_ID: Partial<Record<string, ToneSoundDefinition>> = Object.fromEntries(
  TONE_SOUNDS.map((sound) => [sound.id, sound]),
);

/** The sound a session starts on. */
export const DEFAULT_TONE_SOUND: ToneSoundId = 'lead';

/**
 * How loud the melody is before anybody moves the fader.
 *
 * Under the drums on purpose, and this is the second of the two places that judgement is made —
 * `TONE_TARGET_PEAK` above sets how loud the *recordings* are relative to each other, this sets
 * how loud the layer is relative to the kit. Kept as a control rather than baked into the gains
 * so that somebody writing a melody-led piece can turn the tune up without having to turn the
 * whole kit down.
 */
export const DEFAULT_TONE_VOLUME = 0.7;

export function toneSoundById(id: string): ToneSoundDefinition {
  return BY_ID[id] ?? TONE_SOUNDS[0]!;
}

export function isToneSoundId(value: unknown): value is ToneSoundId {
  return typeof value === 'string' && Object.hasOwn(BY_ID, value);
}

/** Where one prepared sample is served from. */
export function toneSampleUrl(file: string, base: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${TONE_AUDIO_DIRECTORY}/${file}`;
}
