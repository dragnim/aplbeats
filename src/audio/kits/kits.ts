/*
 * The drum machines, and which sound plays on which row.
 *
 * One entry per machine, and the mapping onto the eight APL Beats rows is deliberate rather
 * than alphabetical: a machine usually has more sounds than rows, and choosing which of its
 * three snares or five congas belongs where is a musical decision that ought to be written
 * down in one place. Filenames appear here and in `provenance.ts` and nowhere else — never in
 * a component.
 *
 * The gains are measurements, not taste. Every sample is scaled so that at full level it peaks
 * where the synthesised voice for the same row peaks, less six tenths of a decibel of headroom
 * — which is what stops a kit change from being a volume change, and what keeps the worst case
 * of all eight rows at once clear of full scale. Timbre, decay and transient shape are
 * untouched, so an 808 kick still booms and an SK-1 snare is still a toy.
 *
 * They are generated rather than chosen: `npm run measure:kits -- --gains` prints exactly these
 * numbers, and `npm run measure:kits` checks the result against the reference. Several are well
 * below 1 because the upstream files are lossy encodes that decode above full scale.
 *
 * Two things are true of every kit here and are worth stating once:
 *
 *   the machine names are text, used to identify a sound set. No logos, no artwork, no
 *   suggestion of endorsement — APL Beats is not affiliated with any of these manufacturers;
 *
 *   changing kit changes eight sounds and nothing else. It cannot reach the pattern, the seed,
 *   the macros, the locks, the APL settings or the transport.
 */

import { TRACK_IDS } from '@/pattern/tracks';
import { HAT_CHOKE_GROUP, isSampleKit, SYNTH_KIT_ID, type KitDefinition, type KitId } from './types';

/** Where the bundled audio lives, under the published base path. */
export const AUDIO_DIRECTORY = 'audio';

/* ------------------------------------------------------------------------- */

export const KITS: readonly KitDefinition[] = [
  {
    id: SYNTH_KIT_ID,
    name: 'APL Beats Synth',
    blurb: 'The synthesised kit. No download, always available.',
    kind: 'synth',
  },
  {
    id: 'tr-808',
    name: 'TR-808',
    blurb: 'Roland TR-808. Long booming kick, thin snare, that cowbell of a rimshot.',
    kind: 'sample',
    directory: 'tr-808',
    voices: {
      kick: { file: 'kick.m4a', gain: 1.11 },
      snare: { file: 'snare.m4a', gain: 1.055 },
      closedHat: { file: 'closed-hat.m4a', gain: 1.024, chokeGroup: HAT_CHOKE_GROUP },
      openHat: { file: 'open-hat.m4a', gain: 0.699, chokeGroup: HAT_CHOKE_GROUP },
      clap: { file: 'clap.m4a', gain: 0.845 },
      lowPerc: { file: 'low-perc.m4a', gain: 0.487 },
      highPerc: { file: 'high-perc.m4a', gain: 0.459 },
      rim: { file: 'rim.m4a', gain: 0.75 },
    },
  },
  {
    id: 'lm-2',
    name: 'LinnDrum LM-2',
    blurb: 'Linn LM-2. Sampled drums, dry and tight, with a famous hand clap.',
    kind: 'sample',
    directory: 'lm-2',
    voices: {
      kick: { file: 'kick.m4a', gain: 0.608 },
      snare: { file: 'snare.m4a', gain: 0.452 },
      closedHat: { file: 'closed-hat.m4a', gain: 0.51, chokeGroup: HAT_CHOKE_GROUP },
      openHat: { file: 'open-hat.m4a', gain: 0.383, chokeGroup: HAT_CHOKE_GROUP },
      clap: { file: 'clap.m4a', gain: 0.64 },
      lowPerc: { file: 'low-perc.m4a', gain: 0.36 },
      highPerc: { file: 'high-perc.m4a', gain: 0.511 },
      rim: { file: 'rim.m4a', gain: 0.55 },
    },
  },
  {
    id: 'cr-8000',
    name: 'CR-8000',
    blurb: 'Roland CR-8000. Warmer and rounder than the 808, with a hard snare.',
    kind: 'sample',
    directory: 'cr-8000',
    voices: {
      kick: { file: 'kick.m4a', gain: 0.81 },
      snare: { file: 'snare.m4a', gain: 0.493 },
      closedHat: { file: 'closed-hat.m4a', gain: 0.563, chokeGroup: HAT_CHOKE_GROUP },
      openHat: { file: 'open-hat.m4a', gain: 0.494, chokeGroup: HAT_CHOKE_GROUP },
      clap: { file: 'clap.m4a', gain: 0.713 },
      lowPerc: { file: 'low-perc.m4a', gain: 0.407 },
      highPerc: { file: 'high-perc.m4a', gain: 0.464 },
      rim: { file: 'rim.m4a', gain: 0.629 },
    },
  },
  {
    id: 'drumtraks',
    name: 'Drumtraks',
    blurb: 'Sequential Circuits Drumtraks. Punchy eighties samples, long toms.',
    kind: 'sample',
    directory: 'drumtraks',
    voices: {
      kick: { file: 'kick.m4a', gain: 0.717 },
      snare: { file: 'snare.m4a', gain: 0.618 },
      closedHat: { file: 'closed-hat.m4a', gain: 0.532, chokeGroup: HAT_CHOKE_GROUP },
      openHat: { file: 'open-hat.m4a', gain: 0.58, chokeGroup: HAT_CHOKE_GROUP },
      clap: { file: 'clap.m4a', gain: 0.645 },
      lowPerc: { file: 'low-perc.m4a', gain: 0.419 },
      highPerc: { file: 'high-perc.m4a', gain: 0.503 },
      rim: { file: 'rim.m4a', gain: 0.695 },
    },
  },
  {
    id: 'rz-1',
    name: 'Casio RZ-1',
    blurb: 'Casio RZ-1. Twelve-bit and a little brittle, which is the appeal.',
    kind: 'sample',
    directory: 'rz-1',
    voices: {
      kick: { file: 'kick.m4a', gain: 0.684 },
      snare: { file: 'snare.m4a', gain: 0.493 },
      closedHat: { file: 'closed-hat.m4a', gain: 0.497, chokeGroup: HAT_CHOKE_GROUP },
      openHat: { file: 'open-hat.m4a', gain: 0.519, chokeGroup: HAT_CHOKE_GROUP },
      clap: { file: 'clap.m4a', gain: 0.623 },
      lowPerc: { file: 'low-perc.m4a', gain: 0.545 },
      highPerc: { file: 'high-perc.m4a', gain: 0.512 },
      rim: { file: 'rim.m4a', gain: 0.543 },
    },
  },
  {
    id: 'mfb-512',
    name: 'MFB-512',
    blurb: 'MFB-512. Analogue, blunt and very direct.',
    kind: 'sample',
    directory: 'mfb-512',
    voices: {
      kick: { file: 'kick.m4a', gain: 0.722 },
      snare: { file: 'snare.m4a', gain: 0.553 },
      closedHat: { file: 'closed-hat.m4a', gain: 0.503, chokeGroup: HAT_CHOKE_GROUP },
      openHat: { file: 'open-hat.m4a', gain: 0.421, chokeGroup: HAT_CHOKE_GROUP },
      clap: { file: 'clap.m4a', gain: 0.645 },
      lowPerc: { file: 'low-perc.m4a', gain: 0.466 },
      highPerc: { file: 'high-perc.m4a', gain: 0.517 },
      // The mid tom, hurried into being a click. See provenance.ts.
      rim: { file: 'rim.m4a', gain: 0.469, playbackRate: 1.45 },
    },
  },
  {
    id: 'mr-10',
    name: 'Yamaha MR10',
    blurb: 'Yamaha MR10. A small, soft-spoken machine with a short snare.',
    kind: 'sample',
    directory: 'mr-10',
    voices: {
      kick: { file: 'kick.m4a', gain: 0.81 },
      snare: { file: 'snare.m4a', gain: 0.609 },
      closedHat: { file: 'closed-hat.m4a', gain: 0.618, chokeGroup: HAT_CHOKE_GROUP },
      openHat: { file: 'open-hat.m4a', gain: 0.71, chokeGroup: HAT_CHOKE_GROUP },
      clap: { file: 'clap.m4a', gain: 0.651 },
      lowPerc: { file: 'low-perc.m4a', gain: 0.505 },
      highPerc: { file: 'high-perc.m4a', gain: 1.165 },
      rim: { file: 'rim.m4a', gain: 0.555 },
    },
  },
  {
    id: '808-mini',
    name: '808 Mini',
    blurb: 'A small, undocumented 808-style set. Softer than the TR-808 above.',
    kind: 'sample',
    directory: '808-mini',
    voices: {
      kick: { file: 'kick.m4a', gain: 1.015 },
      snare: { file: 'snare.m4a', gain: 0.792 },
      closedHat: { file: 'closed-hat.m4a', gain: 0.756, chokeGroup: HAT_CHOKE_GROUP },
      openHat: { file: 'open-hat.m4a', gain: 0.466, chokeGroup: HAT_CHOKE_GROUP },
      clap: { file: 'clap.m4a', gain: 0.778 },
      lowPerc: { file: 'low-perc.m4a', gain: 0.344 },
      highPerc: { file: 'high-perc.m4a', gain: 0.282 },
      /*
       * A hi-hat sample standing in for the rim, but deliberately *not* in the hat choke
       * group. Authentic hardware would share the circuit; musically the rim is an
       * independent part, and putting it in the group would let it swallow the hats.
       */
      rim: { file: 'rim.m4a', gain: 0.633 },
    },
  },
  {
    id: 'sk-1',
    name: 'Casio SK-1',
    blurb: 'Casio SK-1. Eight-bit toy sampling, and proud of it.',
    kind: 'sample',
    directory: 'sk-1',
    voices: {
      kick: { file: 'kick.m4a', gain: 0.796 },
      snare: { file: 'snare.m4a', gain: 0.596 },
      closedHat: { file: 'closed-hat.m4a', gain: 0.545, chokeGroup: HAT_CHOKE_GROUP },
      openHat: { file: 'open-hat.m4a', gain: 0.464, chokeGroup: HAT_CHOKE_GROUP },
      // The snare again, hurried. Its own choke group, so it does not cut the snare row.
      clap: { file: 'snare.m4a', gain: 0.599, playbackRate: 1.2 },
      lowPerc: { file: 'low-perc.m4a', gain: 0.397 },
      // The low tom, well up, so the two percussion rows are not one drum played twice.
      highPerc: { file: 'low-perc.m4a', gain: 0.375, playbackRate: 1.6 },
      rim: { file: 'rim.m4a', gain: 0.579 },
    },
  },
];

/* ------------------------------------------------------------------------- */

const BY_ID = new Map(KITS.map((kit) => [kit.id, kit]));

/** The kit a session starts on: the synthesised one, which needs no download. */
export const DEFAULT_KIT_ID = SYNTH_KIT_ID;

export function kitById(id: string): KitDefinition | undefined {
  return BY_ID.get(id);
}

/**
 * A kit identifier, or the synthesised kit.
 *
 * Every route into the application that carries a kit id goes through here — restoring a
 * session, mostly. An id that no longer exists must not be a startup failure, so an unknown
 * one silently becomes the kit that cannot fail.
 */
export function resolveKitId(id: unknown): KitId {
  return typeof id === 'string' && BY_ID.has(id) ? id : SYNTH_KIT_ID;
}

/** Where one of a kit's samples is fetched from, honouring the published base path. */
export function sampleUrl(directory: string, file: string, baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${AUDIO_DIRECTORY}/${directory}/${file}`;
}

/*
 * Every sampled kit fills every row.
 *
 * Checked at import time, because the failure it prevents is a silent one: a row with no voice
 * would simply stop making a sound on that kit, and the pattern would look right while being
 * audibly wrong. Cheap to check, and it fails loudly on the mistake this file invites.
 */
for (const kit of KITS) {
  if (!isSampleKit(kit)) continue;
  for (const id of TRACK_IDS) {
    if (kit.voices[id] === undefined) {
      throw new Error(`The "${kit.name}" kit has no sound for the "${id}" row.`);
    }
  }
}
