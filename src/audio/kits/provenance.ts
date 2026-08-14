/*
 * Where every bundled sound came from.
 *
 * This file is the answer to "which exact version of somebody else's work is in this
 * repository, and on what basis". It is authored by hand, it is the input to
 * `scripts/import-samples.mjs`, and it is what the attribution documentation is generated
 * from — so a future kit cannot be added without its provenance being written down, because
 * the importer has nowhere to read a download URL from otherwise.
 *
 * There are two upstreams and they are kept apart on purpose. Nine kits are *copied samples*
 * from `smpldsnds/drum-machines`, byte-for-byte, and are covered by everything immediately
 * below. One kit, the TR-909, is *rendered* from MIT-licensed DSP and is covered by a separate
 * section further down, because a derived render and a copied file need different evidence.
 *
 * The audit behind the copied samples is recorded in THIRD_PARTY_NOTICES.md. The short version:
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
/* Rendered kits: a different upstream, and a different kind of thing.        */
/* ------------------------------------------------------------------------- */

/*
 * Everything above this line is somebody's recording, copied unchanged.
 *
 * Everything below is not a recording at all. The TR-909 kit was *rendered*: André Michelle's
 * open-source reimplementation of the machine's DSP was run offline, at a pinned commit, with
 * the machine's own front-panel defaults, and the eight resulting waveforms were written to
 * disk. No hardware was recorded and no upstream audio file was copied — the `.raw` wavetables
 * the DSP reads are inputs to it, not the output.
 *
 * The distinction is kept structural rather than explained in a comment somewhere, because the
 * two carry different obligations. A copied sample needs its source pack and a checksum proving
 * the bytes are unaltered. A derived render needs the source *code*, its licence, the commit,
 * the settings and a pipeline that can produce the same bytes again — a checksum against
 * upstream would be meaningless, since there is nothing upstream to compare to.
 *
 * So `bundledFiles()` still means "files copied from smpldsnds", `checksums.json` still means
 * "and here is the proof they are unaltered", and neither had to be weakened to accommodate a
 * kit that works differently.
 */

export const RENDERED_UPSTREAM = {
  name: 'andremichelle/tr-909',
  url: 'https://github.com/andremichelle/tr-909',
  author: 'André Michelle',
  /**
   * The exact commit the DSP was run from.
   *
   * Pinned for the same reason the sample collection is, and with more at stake: the output is
   * computed rather than copied, so the code that computes it *is* the source material.
   */
  commit: '11d423382d6d9705bd37a42b533e3b3c27442be7',
  commitDate: '2024-03-11',
  licence: 'MIT',
  copyright: 'Copyright (c) 2022 André Michelle',
  /**
   * The one thing in that repository which is not the author's to relicense, and is not used.
   *
   * Its README credits Isaac Cotec for the Roland, TR-909 and Rhythm Composer logo SVGs. APL
   * Beats uses no logo, no artwork and no part of the upstream interface — only the DSP and the
   * wavetables it reads. Recorded here so that "we checked" is a fact rather than a claim.
   */
  excludedFromUse: 'The logo SVGs credited to Isaac Cotec. Not copied, not rendered, not used.',
  /**
   * Also credited upstream, and creating no interest here.
   *
   * The README thanks Sascha Kaltenschnee for lending a DinSync RE-909 to develop against.
   * Lending hardware to someone writing an emulator is not authorship of the emulator and not
   * a copyright in its output, so there is nothing to clear — but it was checked rather than
   * assumed.
   */
  acknowledgement: 'Sascha Kaltenschnee, for lending the hardware the emulator was developed against.',
} as const;

/**
 * What the renders are, and the one place the chain is not lossless.
 *
 * Worth stating plainly rather than claiming lossless and hoping. The DSP computes in float32
 * and the files are 16-bit PCM, so there is exactly one lossy step: that quantisation, rounded,
 * with no dither. It is about 96 dB below full scale and the quietest voice still sits 79 dB
 * above it after the playback gain, so it is inaudible — but it is a real step and it is why
 * `lossless` is `false` in the render manifest rather than `true` with an asterisk.
 *
 * Unlike the sampled kits, there was a choice here, and 16-bit PCM was preferred over lossy
 * encoding: it keeps the pipeline reproducible byte-for-byte, which is what lets
 * `npm run render:tr909 -- --check` prove the shipped files are still the ones the pinned
 * source produces. That check is worth more than the 200 kB an AAC encode would have saved.
 */
export const RENDER_FORMAT = {
  extension: '.wav',
  codec: '16-bit PCM, mono, 44.1 kHz',
  lossless: false,
  lossyStep: 'float32 render quantised to 16-bit PCM, rounded, no dither',
  processing: 'none beyond that quantisation — no normalisation, no limiting, no editing',
} as const;

export interface RenderedVoiceProvenance {
  /** The name this file has in APL Beats. */
  readonly file: string;
  /** What the machine calls this sound. */
  readonly instrument: string;
  /** The upstream class that computes it. */
  readonly dspClass: string;
  /** The upstream source file that class lives in. */
  readonly dspSource: string;
  /** The upstream wavetables that class reads, relative to the repository root. */
  readonly resources: readonly string[];
}

export interface RenderedKitProvenance {
  readonly id: KitId;
  /** The machine, as its manufacturer named it. Text only. */
  readonly machine: string;
  /** How these files came to exist, in one paragraph. */
  readonly renderingNote: string;
  /** The basis on which the result is redistributed here. */
  readonly licenceBasis: string;
  readonly voices: readonly RenderedVoiceProvenance[];
  /** Rows the machine has that APL Beats does not, and the reverse. */
  readonly mappingNote: string;
}

export const RENDERED_KIT_PROVENANCE: readonly RenderedKitProvenance[] = [
  {
    id: 'tr-909',
    machine: 'Roland TR-909 Rhythm Composer',
    renderingNote:
      'Rendered offline by `npm run render:tr909` from the upstream DSP at the pinned commit, ' +
      'at 44.1 kHz, one voice at a time, in the same 128-frame blocks upstream processes in. ' +
      'Every front-panel control was left at the upstream preset default; the only uniform ' +
      'change is that each hit is struck at the top of upstream’s step-level range rather than ' +
      'at an ordinary step, which costs nothing musically and keeps a bit and a half of ' +
      'sixteen-bit resolution. Each render runs until the voice reports itself finished, and ' +
      'only the tail below −96 dBFS is trimmed. The pipeline is deterministic: repeated runs ' +
      'produce byte-identical files, and `--check` verifies the shipped ones still match.',
    licenceBasis:
      'MIT. The licence permits use, modification and redistribution of the source and of ' +
      'works derived from it, requiring only that the copyright notice and licence text travel ' +
      'with it — which they do, in THIRD_PARTY_NOTICES.md. No logo, artwork, interface asset ' +
      'or font from the upstream project is used.',
    mappingNote:
      'The TR-909 has eleven instruments; APL Beats has eight rows. Bass drum, snare drum, ' +
      'closed and open hi-hat, hand clap and rim shot map one to one. The low and high toms ' +
      'take the two percussion rows. The mid tom, crash and ride are not used — nothing here ' +
      'is a substitution, because the machine has a real instrument for every row.',
    voices: [
      {
        file: 'kick.wav',
        instrument: 'Bass drum',
        dspClass: 'BassdrumVoice',
        dspSource: 'typescript/audio/tr909/dsp/bassdrum.ts',
        resources: ['resources/bassdrum-attack.raw', 'resources/bassdrum-cycle.raw'],
      },
      {
        file: 'snare.wav',
        instrument: 'Snare drum',
        dspClass: 'SnaredrumVoice',
        dspSource: 'typescript/audio/tr909/dsp/snaredrum.ts',
        resources: ['resources/snare-tone.raw', 'resources/snare-noise.raw'],
      },
      {
        file: 'closed-hat.wav',
        instrument: 'Closed hi-hat',
        dspClass: 'BasicTuneDecayVoice',
        dspSource: 'typescript/audio/tr909/dsp/basic-voice.ts',
        resources: ['resources/closed-hihat.raw'],
      },
      {
        file: 'open-hat.wav',
        instrument: 'Open hi-hat',
        dspClass: 'BasicTuneDecayVoice',
        dspSource: 'typescript/audio/tr909/dsp/basic-voice.ts',
        resources: ['resources/opened-hihat.raw'],
      },
      {
        file: 'clap.wav',
        instrument: 'Hand clap',
        dspClass: 'BasicTuneDecayVoice',
        dspSource: 'typescript/audio/tr909/dsp/basic-voice.ts',
        resources: ['resources/clap.raw'],
      },
      {
        file: 'low-perc.wav',
        instrument: 'Low tom',
        dspClass: 'BasicTuneDecayVoice',
        dspSource: 'typescript/audio/tr909/dsp/basic-voice.ts',
        resources: ['resources/tom-low.raw'],
      },
      {
        file: 'high-perc.wav',
        instrument: 'High tom',
        dspClass: 'BasicTuneDecayVoice',
        dspSource: 'typescript/audio/tr909/dsp/basic-voice.ts',
        resources: ['resources/tom-hi.raw'],
      },
      {
        file: 'rim.wav',
        instrument: 'Rim shot',
        dspClass: 'BasicTuneDecayVoice',
        dspSource: 'typescript/audio/tr909/dsp/basic-voice.ts',
        resources: ['resources/rim.raw'],
      },
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

/**
 * Every copied sample, as `kitId/file` — the list the importer downloads and tests check.
 *
 * Copied files only. The rendered kits have no upstream file to download or compare against,
 * which is exactly why they are not here.
 */
export function bundledFiles(): { kitId: KitId; file: string; upstream: string }[] {
  return KIT_PROVENANCE.flatMap((kit) =>
    kit.files.map((entry) => ({
      kitId: kit.id,
      file: entry.file,
      upstream: `${kit.upstreamPath}/${entry.upstream}`,
    })),
  );
}

/** Every rendered file, as `kitId/file`. The other half of what ships under `public/audio`. */
export function renderedFiles(): { kitId: KitId; file: string }[] {
  return RENDERED_KIT_PROVENANCE.flatMap((kit) =>
    kit.voices.map((voice) => ({ kitId: kit.id, file: voice.file })),
  );
}

/**
 * Every bundled audio file, however it got here.
 *
 * For the questions that do not care about the difference — does the file exist, is it served,
 * is it referenced by exactly one kit. The questions that *do* care use the two lists above.
 */
export function allAudioFiles(): { kitId: KitId; file: string }[] {
  return [...bundledFiles().map(({ kitId, file }) => ({ kitId, file })), ...renderedFiles()];
}

export function provenanceFor(kitId: KitId): KitProvenance | undefined {
  return KIT_PROVENANCE.find((kit) => kit.id === kitId);
}

export function renderedProvenanceFor(kitId: KitId): RenderedKitProvenance | undefined {
  return RENDERED_KIT_PROVENANCE.find((kit) => kit.id === kitId);
}
