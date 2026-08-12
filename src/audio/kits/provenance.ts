/*
 * Where every bundled sample came from.
 *
 * This file is the answer to "which exact version of somebody else's work is in this
 * repository, and on what basis". It is authored by hand, it is the input to
 * `scripts/import-samples.mjs`, and it is what the attribution documentation is generated
 * from — so a future kit cannot be added without its provenance being written down, because
 * the importer has nowhere to read a download URL from otherwise.
 *
 * The audit behind it is recorded in THIRD_PARTY_NOTICES.md. The short version:
 *
 *   the upstream collection carries no LICENSE file — the only licence statement anywhere in
 *   it is the one line in its README, "A collection of public domain samples of different
 *   drum machines", and that line is therefore the licence basis for every pack except one;
 *
 *   the TR-808 pack is the exception and is much better documented: it ships Michael
 *   Fischer's 1994 notice, which names the machine, its serial number, the equipment used and
 *   states the samples are "ABSOLUTELY FREE". That notice is bundled beside the audio, because
 *   a notice that does not travel with the files it describes is not a notice;
 *
 *   no pack anywhere in the collection carries a restriction inconsistent with
 *   redistribution — no non-commercial clause, no no-redistribution clause, no licence text of
 *   any kind;
 *
 *   one pack was excluded, and why is recorded below.
 *
 * Nothing here is inferred. Where a machine had no instrument for one of the eight rows, the
 * substitution says so in plain words rather than implying the machine had a sound it did not.
 */

import type { KitId } from './types';

/* ------------------------------------------------------------------------- */

export const UPSTREAM = {
  name: 'smpldsnds/drum-machines',
  url: 'https://github.com/smpldsnds/drum-machines',
  /**
   * The exact commit every bundled sample was taken from.
   *
   * Pinned, not tracked. `main` is a moving target and a rebuilt bundle has to be able to
   * produce the same bytes; the importer downloads from this SHA and nothing else.
   */
  commit: 'a894cb8c72abe15b05e7b4fd4b8ee561c0f9e960',
  commitDate: '2024-04-11',
  /** The collection's own licence statement, quoted exactly. */
  licenceStatement: 'A collection of public domain samples of different drum machines',
  /** Where that statement appears. There is no LICENSE file in the repository. */
  licenceStatementSource: 'README.md',
} as const;

/**
 * The format the samples are in, and why it is not WAV.
 *
 * The brief expected WAV. The upstream repository contains none: every pack is published as
 * `.ogg` and `.m4a` only, and the WAVs its contributing instructions mention are not
 * committed. So there is no lossless original to prefer, and "preserve the originals" here
 * means bundling upstream's own published files unaltered rather than re-encoding them again.
 *
 * `.m4a` of the two, because AAC decodes in every browser this application supports, whereas
 * Ogg Vorbis does not decode reliably in Safari. Every bundled file is a byte-for-byte copy
 * of upstream's; the checksums in `checksums.json` are the evidence.
 */
export const SAMPLE_FORMAT = {
  extension: '.m4a',
  codec: 'AAC in an MP4 container',
  processing: 'none — bundled byte-for-byte as published upstream',
} as const;

/* ------------------------------------------------------------------------- */

export interface FileProvenance {
  /** The name this file has in APL Beats. */
  readonly file: string;
  /** The name it has upstream, within the pack directory. */
  readonly upstream: string;
  /** What the machine calls this sound. */
  readonly instrument: string;
}

export interface KitProvenance {
  readonly id: KitId;
  /** The machine, as its manufacturer named it. Text only. */
  readonly machine: string;
  /** The pack directory upstream. */
  readonly upstreamPath: string;
  /** What is known about where these recordings came from. */
  readonly provenanceNote: string;
  /** The basis on which they are redistributed here. */
  readonly licenceBasis: string;
  /** An upstream notice file bundled alongside the audio, if the pack has one. */
  readonly noticeFile?: string;
  readonly files: readonly FileProvenance[];
  /**
   * Rows this machine could not fill from a matching instrument.
   *
   * Written out because the alternative — quietly using a snare for a hand clap — would be a
   * claim about the machine that is not true.
   */
  readonly substitutions?: readonly string[];
}

/* ------------------------------------------------------------------------- */

export const KIT_PROVENANCE: readonly KitProvenance[] = [
  {
    id: 'tr-808',
    machine: 'Roland TR-808 Rhythm Composer',
    upstreamPath: 'TR-808',
    provenanceNote:
      'Michael Fischer of Technopolis, "Sound Sample Set 1.0.0", 9 August 1994. Sampled ' +
      'directly from a Roland TR-808, serial number 103852, from the individual instrument ' +
      'outputs at 16-bit / 44.1 kHz — not sampled from another drum machine. 116 samples ' +
      'covering five positions of every sound-shaping knob.',
    licenceBasis:
      'The bundled notice states the samples are "ABSOLUTELY FREE" and imposes no ' +
      'restriction. The upstream collection additionally describes them as public domain.',
    noticeFile: 'TR808.TXT',
    files: [
      { file: 'kick.m4a', upstream: 'kick/bd5050.m4a', instrument: 'Bass Drum, tone and decay centred' },
      { file: 'snare.m4a', upstream: 'snare/sd5050.m4a', instrument: 'Snare Drum, tone and snappy centred' },
      { file: 'closed-hat.m4a', upstream: 'hihat-close/ch.m4a', instrument: 'Closed Hi Hat' },
      { file: 'open-hat.m4a', upstream: 'hihat-open/oh50.m4a', instrument: 'Open Hi Hat, decay centred' },
      { file: 'clap.m4a', upstream: 'clap/cp.m4a', instrument: 'Hand Clap' },
      { file: 'low-perc.m4a', upstream: 'conga-low/lc50.m4a', instrument: 'Low Conga, tuning centred' },
      { file: 'high-perc.m4a', upstream: 'conga-hi/hc50.m4a', instrument: 'High Conga, tuning centred' },
      { file: 'rim.m4a', upstream: 'rimshot/rs.m4a', instrument: 'Rim Shot' },
    ],
  },
  {
    id: 'lm-2',
    machine: 'Linn LM-2 (LinnDrum)',
    upstreamPath: 'LM-2',
    provenanceNote:
      'No per-pack notice upstream. 29 samples covering the LinnDrum’s instruments, ' +
      'including three snare and three sidestick tunings and five congas.',
    licenceBasis:
      'The upstream collection’s public-domain statement. No restriction stated anywhere in the pack.',
    files: [
      { file: 'kick.m4a', upstream: 'kick.m4a', instrument: 'Bass drum' },
      { file: 'snare.m4a', upstream: 'snare-m.m4a', instrument: 'Snare, middle of three tunings' },
      { file: 'closed-hat.m4a', upstream: 'hhclosed.m4a', instrument: 'Closed hi-hat' },
      { file: 'open-hat.m4a', upstream: 'hhopen.m4a', instrument: 'Open hi-hat' },
      { file: 'clap.m4a', upstream: 'clap.m4a', instrument: 'Hand clap' },
      { file: 'low-perc.m4a', upstream: 'conga-l.m4a', instrument: 'Low conga (151 Hz)' },
      { file: 'high-perc.m4a', upstream: 'conga-h.m4a', instrument: 'High conga (320 Hz)' },
      { file: 'rim.m4a', upstream: 'stick-m.m4a', instrument: 'Sidestick, middle of three tunings' },
    ],
  },
  {
    id: 'cr-8000',
    machine: 'Roland CR-8000 CompuRhythm',
    upstreamPath: 'Roland-CR-8000',
    provenanceNote: 'No per-pack notice upstream. 13 samples, one per instrument on the machine.',
    licenceBasis:
      'The upstream collection’s public-domain statement. No restriction stated anywhere in the pack.',
    files: [
      { file: 'kick.m4a', upstream: 'kick.m4a', instrument: 'Bass drum' },
      { file: 'snare.m4a', upstream: 'snare.m4a', instrument: 'Snare drum' },
      { file: 'closed-hat.m4a', upstream: 'hihat-closed.m4a', instrument: 'Closed hi-hat' },
      { file: 'open-hat.m4a', upstream: 'hihat-open.m4a', instrument: 'Open hi-hat' },
      { file: 'clap.m4a', upstream: 'clap.m4a', instrument: 'Hand clap' },
      { file: 'low-perc.m4a', upstream: 'conga-low.m4a', instrument: 'Low conga (190 Hz)' },
      { file: 'high-perc.m4a', upstream: 'conga-high.m4a', instrument: 'High conga (302 Hz)' },
      { file: 'rim.m4a', upstream: 'rimshot.m4a', instrument: 'Rimshot' },
    ],
  },
  {
    id: 'drumtraks',
    machine: 'Sequential Circuits Drumtraks',
    upstreamPath: 'Sequential-Circuits-Drumtraks',
    provenanceNote: 'No per-pack notice upstream. 13 samples, upstream filenames prefixed "DT_".',
    licenceBasis:
      'The upstream collection’s public-domain statement. No restriction stated anywhere in the pack.',
    files: [
      { file: 'kick.m4a', upstream: 'DT_Kick.m4a', instrument: 'Bass drum' },
      { file: 'snare.m4a', upstream: 'DT_Snare.m4a', instrument: 'Snare drum' },
      { file: 'closed-hat.m4a', upstream: 'DT_Closedhat.m4a', instrument: 'Closed hi-hat' },
      { file: 'open-hat.m4a', upstream: 'DT_Openhat.m4a', instrument: 'Open hi-hat' },
      { file: 'clap.m4a', upstream: 'DT_Clap.m4a', instrument: 'Hand clap' },
      { file: 'low-perc.m4a', upstream: 'DT_Tom02.m4a', instrument: 'Tom 2, the lower of the two (95 Hz)' },
      {
        file: 'high-perc.m4a',
        upstream: 'DT_Tom01.m4a',
        instrument: 'Tom 1, the higher of the two (160 Hz)',
      },
      { file: 'rim.m4a', upstream: 'DT_Rimshot.m4a', instrument: 'Rimshot' },
    ],
  },
  {
    id: 'rz-1',
    machine: 'Casio RZ-1',
    upstreamPath: 'Casio-RZ1',
    provenanceNote:
      'No per-pack notice upstream. 12 samples. The three toms are numbered rather than ' +
      'named; measured, they run high to low — tom-1 at 151 Hz, tom-2 at 127 Hz, tom-3 at 95 Hz.',
    licenceBasis:
      'The upstream collection’s public-domain statement. No restriction stated anywhere in the pack.',
    files: [
      { file: 'kick.m4a', upstream: 'kick.m4a', instrument: 'Bass drum' },
      { file: 'snare.m4a', upstream: 'snare.m4a', instrument: 'Snare drum' },
      { file: 'closed-hat.m4a', upstream: 'hihat-closed.m4a', instrument: 'Closed hi-hat' },
      { file: 'open-hat.m4a', upstream: 'hihat-open.m4a', instrument: 'Open hi-hat' },
      { file: 'clap.m4a', upstream: 'clap.m4a', instrument: 'Hand clap' },
      { file: 'low-perc.m4a', upstream: 'tom-3.m4a', instrument: 'Tom 3, the lowest of three (95 Hz)' },
      { file: 'high-perc.m4a', upstream: 'tom-1.m4a', instrument: 'Tom 1, the highest of three (151 Hz)' },
      { file: 'rim.m4a', upstream: 'clave.m4a', instrument: 'Clave' },
    ],
  },
  {
    id: 'mfb-512',
    machine: 'MFB-512',
    upstreamPath: 'MFB-512',
    provenanceNote:
      'No per-pack notice upstream. 9 samples: kick, snare, two hats, clap, cymbal and three toms.',
    licenceBasis:
      'The upstream collection’s public-domain statement. No restriction stated anywhere in the pack.',
    files: [
      { file: 'kick.m4a', upstream: 'kick.m4a', instrument: 'Bass drum' },
      { file: 'snare.m4a', upstream: 'snare.m4a', instrument: 'Snare drum' },
      { file: 'closed-hat.m4a', upstream: 'hihat-closed.m4a', instrument: 'Closed hi-hat' },
      { file: 'open-hat.m4a', upstream: 'hihat-open.m4a', instrument: 'Open hi-hat' },
      { file: 'clap.m4a', upstream: 'clap.m4a', instrument: 'Hand clap' },
      { file: 'low-perc.m4a', upstream: 'tom-low.m4a', instrument: 'Low tom (101 Hz)' },
      { file: 'high-perc.m4a', upstream: 'tom-hi.m4a', instrument: 'High tom (143 Hz)' },
      { file: 'rim.m4a', upstream: 'tom-mid.m4a', instrument: 'Mid tom (120 Hz)' },
    ],
    substitutions: [
      'Rim: the MFB-512 has no rimshot, clave or woodblock. Its mid tom stands in, played 45% ' +
        'fast so that it reads as a short click rather than as a third tom.',
    ],
  },
  {
    id: 'mr-10',
    machine: 'Yamaha MR10',
    upstreamPath: 'Yamaha-MR10',
    provenanceNote:
      'No per-pack notice upstream. 14 samples, including two bass drums and a short snare ' +
      'alongside the full one.',
    licenceBasis:
      'The upstream collection’s public-domain statement. No restriction stated anywhere in the pack.',
    files: [
      { file: 'kick.m4a', upstream: 'kick1.m4a', instrument: 'Bass drum, the second of two' },
      { file: 'snare.m4a', upstream: 'snare.m4a', instrument: 'Snare drum' },
      { file: 'closed-hat.m4a', upstream: 'chihat.m4a', instrument: 'Closed hi-hat' },
      { file: 'open-hat.m4a', upstream: 'ohihat.m4a', instrument: 'Open hi-hat' },
      { file: 'clap.m4a', upstream: 'shortsn.m4a', instrument: 'Short snare' },
      { file: 'low-perc.m4a', upstream: 'lowtom.m4a', instrument: 'Low tom (113 Hz)' },
      { file: 'high-perc.m4a', upstream: 'hitom.m4a', instrument: 'High tom (226 Hz)' },
      { file: 'rim.m4a', upstream: 'shorthi.m4a', instrument: 'Short high percussion' },
    ],
    substitutions: [
      'Clap: the MR10 has no hand clap. Its short snare stands in — a separate recording from ' +
        'the snare on the snare row, not the same file twice.',
    ],
  },
  {
    id: '808-mini',
    machine: '808 Mini',
    upstreamPath: '808-mini',
    provenanceNote:
      'No per-pack notice upstream, and no statement of which machine or unit was recorded. ' +
      '13 samples: one kick, three snares, two closed and two open hats, three toms, a ride ' +
      'and a crash. A separate and undocumented sample set — not part of the documented ' +
      'Michael Fischer TR-808 set above, despite the name.',
    licenceBasis:
      'The upstream collection’s public-domain statement. No restriction stated anywhere in the pack.',
    files: [
      { file: 'kick.m4a', upstream: 'kick.m4a', instrument: 'Bass drum' },
      { file: 'snare.m4a', upstream: 'snare-2.m4a', instrument: 'Snare, second of three' },
      { file: 'closed-hat.m4a', upstream: 'hhclosed-1.m4a', instrument: 'Closed hi-hat, first of two' },
      { file: 'open-hat.m4a', upstream: 'hhopen-1.m4a', instrument: 'Open hi-hat, first of two' },
      { file: 'clap.m4a', upstream: 'snare-3.m4a', instrument: 'Snare, third of three' },
      { file: 'low-perc.m4a', upstream: 'tom-low.m4a', instrument: 'Low tom (95 Hz)' },
      { file: 'high-perc.m4a', upstream: 'tom-high.m4a', instrument: 'High tom (190 Hz)' },
      { file: 'rim.m4a', upstream: 'hhclosed-2.m4a', instrument: 'Closed hi-hat, second of two' },
    ],
    substitutions: [
      'Clap: this pack has no hand clap. Its third snare stands in — a separate recording, not ' +
        'the snare row repeated.',
      'Rim: no rimshot or clave either. The second closed hat stands in, which is bright and ' +
        'short enough to read as a click.',
    ],
  },
  {
    id: 'sk-1',
    machine: 'Casio SK-1',
    upstreamPath: 'Casio-SK1',
    provenanceNote:
      'No per-pack notice upstream. Six samples only — the SK-1 is a lo-fi sampling keyboard ' +
      'rather than a drum machine, and its rhythm section is correspondingly small.',
    licenceBasis:
      'The upstream collection’s public-domain statement. No restriction stated anywhere in the pack.',
    files: [
      { file: 'kick.m4a', upstream: 'kick.m4a', instrument: 'Bass drum' },
      { file: 'snare.m4a', upstream: 'snare.m4a', instrument: 'Snare drum' },
      { file: 'closed-hat.m4a', upstream: 'hithat.m4a', instrument: 'Closed hi-hat' },
      { file: 'open-hat.m4a', upstream: 'hihat-open.m4a', instrument: 'Open hi-hat' },
      { file: 'low-perc.m4a', upstream: 'tom-low.m4a', instrument: 'Low tom (226 Hz)' },
      { file: 'rim.m4a', upstream: 'tom-hi.m4a', instrument: 'High tom (905 Hz)' },
    ],
    substitutions: [
      'Clap: the SK-1 has no hand clap. Its snare stands in, played 20% fast — the same file as ' +
        'the snare row, deliberately, because there is nothing else to use.',
      'High Perc: no second tuned drum either. Its low tom stands in, played 60% fast, which ' +
        'puts it around 360 Hz and clear of the low percussion row.',
      'Rim: its high tom, which at 905 Hz is already a short click rather than a drum.',
    ],
  },
];

/* ------------------------------------------------------------------------- */

export interface ExcludedPack {
  readonly upstreamPath: string;
  readonly machine: string;
  readonly reason: string;
}

/**
 * What was left out, and why.
 *
 * Recorded because "we included everything that passed" is only meaningful next to the list
 * of what did not. Neither exclusion here is a licensing exclusion: nothing in the collection
 * carried a restriction inconsistent with redistribution.
 */
export const EXCLUDED_PACKS: readonly ExcludedPack[] = [
  {
    upstreamPath: 'Micro-Rhythmer-12',
    machine: 'Univox Micro Rhythmer 12',
    reason:
      'Three samples only — a closed hat, an open hat and a snare — and no bass drum of any ' +
      'kind. Eight rows cannot be filled from three sounds without six of them being the same ' +
      'sound, and a drum machine with no kick is not a drum machine. Excluded for coverage, ' +
      'not for provenance.',
  },
];

/* ------------------------------------------------------------------------- */

/** Every bundled sample, as `kitId/file` — the list the importer downloads and tests check. */
export function bundledFiles(): { kitId: KitId; file: string; upstream: string }[] {
  return KIT_PROVENANCE.flatMap((kit) =>
    kit.files.map((entry) => ({
      kitId: kit.id,
      file: entry.file,
      upstream: `${kit.upstreamPath}/${entry.upstream}`,
    })),
  );
}

export function provenanceFor(kitId: KitId): KitProvenance | undefined {
  return KIT_PROVENANCE.find((kit) => kit.id === kitId);
}
