/*
 * The six Tone sounds, and how loud each one is.
 *
 * **Sounds, not categories.** The first version of this offered Lead, Bass, Keys and Pad — one
 * preset each, chosen by measurement, with the category names in the selector. Two of the four
 * were bad, and the shape of the list was part of why: a Pad slot has to be filled by something,
 * so it was, by the least unsuitable pad in the library rather than by a sound worth having.
 *
 * These six were chosen by ear from every playable preset upstream publishes, and they are offered
 * under their own names. Four come from Lead, Bass and Keys; one comes from Misc and is a lead in
 * everything but its filing. **None comes from Pads**: fourteen were auditioned and none was good
 * enough, and a list of six good sounds is better than a list of seven with a bad one in it.
 *
 * `category` records where each recording really came from. That is provenance and it stays
 * accurate whatever the sound is called — see `jupiter4.json` and THIRD_PARTY_NOTICES.md.
 *
 * The gains are the same idea as the drum kits': the recordings arrive at wildly different levels
 * — Noisy Lead peaks at 4% of full scale and Petals Piano at 100% — and a Sound selector that
 * changed how loud the Tones were would be a volume control pretending to be an instrument
 * control. Each gain brings its sound to the same working peak, and nothing else about the
 * recording is touched.
 */

import manifest from './jupiter4.json';

/** Where the prepared samples live under the published base path. */
export const TONE_AUDIO_DIRECTORY = 'audio/tones';

export type ToneSoundId =
  'petals-piano' | 'chunky' | 'noisy-lead' | 'gone-away-forever' | 'fake-flute' | 'four-bass';

export interface ToneSample {
  readonly file: string;
  /** The MIDI note this recording was played at. Pitch shifting is relative to it. */
  readonly rootMidi: number;
}

export interface ToneSoundDefinition {
  readonly id: ToneSoundId;
  /** What the selector shows: the preset's own name, tidied of upstream's `jp4 - ` prefixes. */
  readonly name: string;
  /**
   * Where the recordings came from, upstream.
   *
   * Provenance rather than a label for the interface — the selector deliberately does not group by
   * it, because grouping by category is what produced a Pad nobody wanted. Shown in the panel as a
   * quiet line, and recorded in the manifest and the notices.
   */
  readonly category: string;
  /** The preset's name exactly as upstream spells it, which is not always how it is shown. */
  readonly preset: string;
  /** One line, for the selector's title. */
  readonly blurb: string;
  /**
   * Playback gain, from measurement.
   *
   * Each sound's loudest prepared recording is brought to the same peak, so switching sound
   * changes the timbre and not the level. Applied by `ToneSampler`, which is worth saying because
   * for the whole of Stage 8 it was applied nowhere at all.
   */
  readonly gain: number;
  readonly samples: readonly ToneSample[];
}

/**
 * The peak every sound is brought to.
 *
 * Chosen against the drums rather than in isolation: the synthesised kit's loudest voice peaks
 * around −1.2 dBFS, and a pitched line sitting about 8 dB below that is present without being
 * the loudest thing in the bar. It is one number, applied the same way to all six, so the
 * *relative* character of the presets survives — a bright lead still reads brighter than a flute,
 * it just no longer arrives twenty times louder.
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
  const entry = manifest.sounds[id];

  return {
    id,
    name,
    // Read from the manifest rather than repeated here, so the two cannot drift apart.
    category: entry?.upstreamCategory ?? 'unknown',
    preset: entry?.preset ?? name,
    blurb,
    // A sound whose manifest went missing must not become a divide-by-zero that plays at infinity.
    gain: peak > 0 ? Number((TONE_TARGET_PEAK / peak).toFixed(3)) : 1,
    samples: samplesFor(id),
  };
}

/**
 * The six, in the order they are offered.
 *
 * Petals Piano first because it is the default, and it is the default because it makes the shape
 * of a phrase obvious on first play — which is the only job a default has. Then the three leads,
 * loudest and brightest to softest, then the bass, which is the one that changes what the phrase
 * is *for* rather than merely how it sounds.
 */
export const TONE_SOUNDS: readonly ToneSoundDefinition[] = [
  define('petals-piano', 'Petals Piano', 'Percussive and bright, so sixteenths still articulate.'),
  define('chunky', 'Chunky', 'A plucked bright lead, decaying rather than spiking.'),
  define(
    'gone-away-forever',
    'Gone Away Forever',
    'Loud and sustained: the closest thing here to a pad that still speaks in a sixteenth.',
  ),
  define('noisy-lead', 'Noisy Lead', 'Nasal and level — it holds its note rather than decaying under it.'),
  define('fake-flute', 'Fake Flute', 'Soft, round and breathy. The gentlest voice here.'),
  define('four-bass', '4 Bass', 'Round and low, sitting under the kick rather than against it.'),
];

const BY_ID: Partial<Record<string, ToneSoundDefinition>> = Object.fromEntries(
  TONE_SOUNDS.map((sound) => [sound.id, sound]),
);

/**
 * The sound a session starts on.
 *
 * Petals Piano, chosen by ear over every lead in the library. The default matters more than any
 * other single choice here because it decides what somebody hears the first time they open Tones,
 * and a percussive voice makes a sixteen-step phrase legible in a way a sustained one does not.
 */
export const DEFAULT_TONE_SOUND: ToneSoundId = 'petals-piano';

/**
 * How loud the Tones are before anybody moves the fader.
 *
 * Under the drums on purpose, and this is the second of the two places that judgement is made —
 * `TONE_TARGET_PEAK` above sets how loud the *recordings* are relative to each other, this sets
 * how loud the layer is relative to the kit. Kept as a control rather than baked into the gains
 * so that somebody writing a Tone-led piece can turn the tune up without having to turn the
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
