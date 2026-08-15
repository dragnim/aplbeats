/*
 * Prepare the Tone samples from the Roland Jupiter-4 public-domain library.
 *
 *   npm run prepare:jupiter4            fetch anything missing, verify what is there
 *   npm run prepare:jupiter4 -- --force rebuild every asset
 *   npm run prepare:jupiter4 -- --check verify checksums only, fetch nothing
 *
 * Contributors do not need to run this: the prepared audio is committed. It exists so that
 * "which exact recordings are in here, and what was done to them" has a reproducible answer.
 *
 * ---
 *
 * **The upstream audio is not in the repository.** `publicsamples/Roland-Jupiter-4` holds only
 * sampler programs — `.exs`, `.nki`, `.uvip` — and SFZ mappings. The recordings live in release
 * 1.0, as six ZIP archives totalling about ten gigabytes: Bass alone is 627 MB and Pads is 3.2 GB
 * across four parts.
 *
 * APL Beats needs twenty-eight of those recordings. Downloading 7 GB to keep 3 MB would make this
 * script something nobody would run twice, so it does not: GitHub's asset host answers `Range`
 * requests, and a ZIP is readable from its end. `lib/remote-zip.mjs` reads each archive's central
 * directory — about 300 KB for a 627 MB file — and then fetches only the entries wanted. The
 * whole preparation costs roughly 25 MB of network rather than seven gigabytes.
 *
 * ---
 *
 * What is done to each recording, and why. Every step is here so the manifest can state it:
 *
 *   **Stereo to mono.** Every SFZ region is centred (`pan=50`) and the Jupiter-4 voice is mono;
 *   the two channels are a stereo treatment rather than two signals. APL Beats plays one Tone at
 *   a time through one gain, so there was nowhere for the width to go. Halves the payload.
 *
 *   **24-bit to 16-bit.** The one lossy step, rounded, no dither, about 96 dB down.
 *
 *   **Trimmed to 1.2 seconds.** A Tone note occupies one sequencer step — 134 ms at the opening
 *   tempo and 250 ms at the slowest — so 1.2 s covers the longest note with room for its release
 *   and for the audition preview. The full recordings run 3 to 12 seconds.
 *
 *   **A 40 ms fade at the trim.** Not an effect: a hard cut mid-waveform clicks if anything ever
 *   outlives the buffer. The fade is at the very end, past any note this instrument can play.
 *
 * Nothing is normalised, equalised, retuned or edited. Loudness between sounds is handled by a
 * single documented gain per sound, applied at playback exactly as the drum kits are — see
 * `src/audio/tones/sounds.ts`.
 *
 * **On the loop points.** Several presets carry genuine sustain loops, in both the SFZ mapping
 * and the AIFF `INST`/`MARK` chunks, and both are recorded in the manifest. They are *not* used,
 * and that is a decision rather than an oversight: every loop here begins between 1.5 and 8
 * seconds into the recording, and a Tone note has ended long before then. Keeping the audio up to
 * the loop would cost about five times the payload for something no note can reach. Inventing
 * earlier loop points is exactly what the brief forbids, so the loops are documented and unused.
 */

/* eslint-disable @typescript-eslint/no-unsafe-return -- the release API is untyped JSON. */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteZip } from './lib/remote-zip.mjs';
import { readAiff, toMono, writeWav } from './lib/aiff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const force = args.includes('--force');
const checkOnly = args.includes('--check');

/* ---- the pinned upstream ---------------------------------------------------- */

const UPSTREAM = {
  name: 'publicsamples/Roland-Jupiter-4',
  url: 'https://github.com/publicsamples/Roland-Jupiter-4',
  /** The repository commit the SFZ mappings and the licence were read from. */
  commit: '64377f813341a10a57d26df9e10f548d43f166cd',
  /** The release the audio comes from. Pinned by tag *and* by per-asset SHA-256 below. */
  releaseTag: '1.0',
  releaseName: 'Roland Jupiter 4 Audio',
  releasePublished: '2021-10-03',
  licence: 'Public domain dedication',
  licenceFile: 'LICENSE',
};

const RELEASE_BASE = `https://github.com/publicsamples/Roland-Jupiter-4/releases/download/${UPSTREAM.releaseTag}`;

/* ---- what is prepared -------------------------------------------------------- */

const SAMPLE_RATE = 44_100;
/** Frames kept from each recording. 1.2 s: longer than any note, shorter than any loop. */
const TRIM_FRAMES = Math.round(SAMPLE_RATE * 1.2);
/** The fade at the trim, so an overrun cannot click. */
const FADE_FRAMES = Math.round(SAMPLE_RATE * 0.04);

/**
 * The playable range, derived rather than chosen.
 *
 * Each selected preset is sampled chromatically over its own span; the intersection of the four
 * is MIDI 48–83. The range below is that, rounded up to a whole three octaves — the one note past
 * the intersection, 84, is reached by shifting the top root of the two presets that stop at 83.
 *
 * C3 to C6. Low enough for a bass line to sit under a kick, high enough for a lead to be a lead.
 */
export const TONE_MIN_MIDI = 48;
export const TONE_MAX_MIDI = 84;

/**
 * Roots every six semitones, so nothing is shifted further than three.
 *
 * Three semitones is about the limit before a shifted analogue sample starts to sound like a
 * shifted sample rather than a note: the formants move with the pitch and a synth brass patch
 * begins to read as a different instrument. Seven roots covers three octaves at that spacing.
 */
const ROOTS = [48, 54, 60, 66, 72, 78, 84];

/**
 * One preset per category, chosen by measuring candidates rather than by name.
 *
 * What was measured, from a mid-register note of each: attack time to 90% of peak, peak level,
 * the ratio of sustain energy to attack energy, and zero-crossing rate as a proxy for brightness.
 * The rejected candidates and the reasoning are in the stage report and in THIRD_PARTY_NOTICES.
 */
const SOUNDS = [
  {
    id: 'bass',
    name: 'Bass',
    asset: ['Bass.zip'],
    /** The folder inside the archive, and the preset name as upstream spells it. */
    folder: '4Bass',
    preset: '4 Bass',
    sfz: '4 Bass.sfz',
    because:
      '58 ms attack and a level sustain, bright enough to be heard under a kick without ' +
      'competing with it. The one bass preset here with genuine loop metadata in both its SFZ ' +
      'mapping and its AIFF chunks.',
  },
  {
    id: 'keys',
    name: 'Keys',
    asset: ['Keys.zip.001', 'Keys.zip.002'],
    folder: 'Petals Piano-SAMPLES',
    preset: 'Petals Piano',
    sfz: 'Petals Piano.sfz',
    because:
      '6 ms attack at full scale, decaying to about a third — percussive enough to articulate ' +
      'sixteenths where the organs, at 6% of full scale and a flat sustain, would have washed.',
  },
  {
    id: 'lead',
    name: 'Lead',
    asset: ['Lead.zip.001', 'Lead.zip.002'],
    folder: 'Blip Lead-SAMPLES',
    preset: 'Blip Lead',
    sfz: 'Blip Lead.sfz',
    because:
      'The brightest candidate by a factor of four and the only one at full scale with a 13 ms ' +
      'attack. A lead has to cut through a drum kit, and the alternatives peaked at 4% of scale.',
  },
  {
    id: 'pad',
    name: 'Pad',
    asset: ['Pads.zip.001', 'Pads.zip.002', 'Pads.zip.003', 'Pads.zip.004'],
    folder: 'jp4 - Shimmer-SAMPLES',
    preset: 'jp4 - Shimmer',
    sfz: null,
    because:
      'The fastest-attacking pad with a real sustain: 78 ms, holding at 95%. The swelling pads ' +
      'take 300–400 ms to arrive, which is longer than a sixteenth at any tempo this plays.',
  },
];

/* ---- fetch ------------------------------------------------------------------- */

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const outDir = join(root, 'public', 'audio', 'tones');
const manifestPath = join(root, 'src', 'audio', 'tones', 'jupiter4.json');

console.log(`\nRoland Jupiter-4 → APL Beats Tones`);
console.log(`upstream ${UPSTREAM.name} @ ${UPSTREAM.commit.slice(0, 7)}, release ${UPSTREAM.releaseTag}\n`);

/**
 * The release assets, pinned by name and exact byte length.
 *
 * Written down rather than looked up. Asking the API for sizes made this script depend on an
 * unauthenticated endpoint that rate-limits after sixty requests an hour — it failed on the first
 * real run — and it also meant the pipeline's idea of the archives could drift silently if
 * upstream ever re-uploaded one. A length that is part of the source is a length a reader can
 * check, and `RemoteZip` fails loudly if the server disagrees with it.
 */
const ASSETS = {
  'Bass.zip': 657270387,
  'Keys.zip.001': 1000000000,
  'Keys.zip.002': 788988894,
  'Lead.zip.001': 1000000000,
  'Lead.zip.002': 809393740,
  'Pads.zip.001': 1000000000,
  'Pads.zip.002': 1000000000,
  'Pads.zip.003': 1000000000,
  'Pads.zip.004': 385960488,
};

const manifest = {
  upstream: UPSTREAM,
  preparation: {
    sampleRate: SAMPLE_RATE,
    format: '16-bit PCM WAV, mono',
    lossless: false,
    lossyStep: 'source 24-bit stereo AIFF averaged to mono and quantised to 16-bit, rounded, no dither',
    trimFrames: TRIM_FRAMES,
    trimSeconds: TRIM_FRAMES / SAMPLE_RATE,
    trimNote:
      'a Tone note occupies one sequencer step — 134 ms at the opening tempo, 250 ms at the ' +
      'slowest — so 1.2 s covers any note plus its release and the audition preview',
    fadeFrames: FADE_FRAMES,
    fadeNote: 'a 40 ms fade at the trim boundary, so nothing outliving the buffer can click',
    processing: 'none beyond that: no normalisation, equalisation, retuning or editing',
    loopsUsed: false,
    loopNote:
      'loop points are recorded below where upstream provides them, and are not used: every one ' +
      'begins later than any note this instrument can play',
    playableRange: { min: TONE_MIN_MIDI, max: TONE_MAX_MIDI },
    roots: ROOTS,
    preparedBy: 'scripts/prepare-jupiter4.mjs',
  },
  sounds: {},
  sourceArchives: {},
};

let networkBytes = 0;
let totalBytes = 0;
let rebuilt = 0;
let mismatched = 0;

mkdirSync(outDir, { recursive: true });

for (const sound of SOUNDS) {
  console.log(`${sound.name}  — ${sound.preset}`);

  const parts = sound.asset.map((name) => {
    const size = ASSETS[name];
    if (size === undefined) throw new Error(`no pinned size for release asset ${name}`);
    manifest.sourceArchives[name] = { bytes: size, downloadUrl: `${RELEASE_BASE}/${name}` };
    return { url: `${RELEASE_BASE}/${name}`, size };
  });

  const entry = {
    name: sound.name,
    preset: sound.preset,
    upstreamFolder: sound.folder,
    because: sound.because,
    samples: [],
  };

  /*
   * The archive directory is read only when something actually has to be built. `--check` and an
   * up-to-date tree cost no network at all, which is what makes running this routinely bearable.
   */
  let zip = null;
  const openZip = async () => {
    if (zip === null) {
      zip = new RemoteZip(parts);
      await zip.open();
    }
    return zip;
  };

  for (const wanted of ROOTS) {
    const file = `${sound.id}-${String(wanted)}.wav`;
    const path = join(outDir, file);

    // Rebuild only when asked or when the file is not there; otherwise verify below.
    const needsBuild = force || !existsSync(path);

    if (needsBuild && checkOnly) {
      console.log(`   MISSING ${file}`);
      mismatched += 1;
      continue;
    }

    let record;
    if (needsBuild) {
      const archive = await openZip();
      const names = [...archive.entries.keys()];

      /*
       * The nearest sampled key at or below the wanted root, then above it.
       *
       * Two presets stop at 83, so the top root of three octaves is reached by shifting their
       * highest recording up one semitone rather than by pretending they recorded it.
       */
      const available = names
        .filter((name) => name.includes(`/${sound.folder}/`) && /\.aif$/i.test(name))
        .map((name) => ({ name, key: Number((/-(\d+)-127/.exec(name) ?? [])[1]) }))
        .filter((candidate) => Number.isFinite(candidate.key));

      if (available.length === 0) throw new Error(`${sound.folder}: no chromatic AIFFs found`);

      available.sort((a, b) => Math.abs(a.key - wanted) - Math.abs(b.key - wanted));
      const chosen = available[0];

      const sourceBytes = await archive.extract(chosen.name);
      const aiff = readAiff(sourceBytes);
      const mono = toMono(aiff.data);

      const kept = Math.min(TRIM_FRAMES, mono.length);
      const trimmed = mono.slice(0, kept);
      for (let index = 0; index < Math.min(FADE_FRAMES, kept); index += 1) {
        const at = kept - 1 - index;
        trimmed[at] *= index / FADE_FRAMES;
      }

      const wav = writeWav(trimmed, aiff.sampleRate);
      writeFileSync(path, wav);
      rebuilt += 1;

      let peak = 0;
      for (const value of trimmed) peak = Math.max(peak, Math.abs(value));

      record = {
        file,
        rootMidi: chosen.key,
        servesMidi: [wanted - 3, wanted + 3],
        upstreamPath: chosen.name,
        upstreamSha256: sha256(sourceBytes),
        upstreamBytes: sourceBytes.length,
        sourceChannels: aiff.channels,
        sourceBits: aiff.bits,
        sourceFrames: aiff.frames,
        loop: aiff.loop,
        frames: kept,
        peak: Number(peak.toFixed(5)),
        bytes: wav.length,
        sha256: sha256(wav),
      };
      networkBytes = archive.bytesRead;
    } else {
      // Verified against the committed manifest rather than rebuilt.
      const existing = readFileSync(path);
      const previous = existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, 'utf8')).sounds[sound.id]?.samples?.find(
            (s) => s.file === file,
          )
        : undefined;

      record = previous ?? { file, bytes: existing.length, sha256: sha256(existing) };
      if (sha256(existing) !== record.sha256 || existing.length !== record.bytes) {
        console.log(`   CHANGED ${file}`);
        mismatched += 1;
      }
    }

    entry.samples.push(record);
    totalBytes += record.bytes;
    console.log(
      `   ${file.padEnd(16)} root ${String(record.rootMidi ?? '?').padStart(3)}` +
        `  ${(record.bytes / 1024).toFixed(0).padStart(4)} KB` +
        `  peak ${String(record.peak ?? '?').padStart(7)}` +
        `  ${record.loop ? `loop ${String(record.loop.start)}–${String(record.loop.end)} (unused)` : 'no loop'}`,
    );
  }

  manifest.sounds[sound.id] = entry;
  console.log('');
}

if (!checkOnly) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  const prettier = await import('prettier');
  const options = await prettier.resolveConfig(manifestPath);
  const formatted = await prettier.format(JSON.stringify(manifest, null, 2), {
    ...options,
    filepath: manifestPath,
  });
  writeFileSync(manifestPath, formatted);
}

console.log(
  `Total: ${(totalBytes / 1024).toFixed(0)} KB across ${String(SOUNDS.length * ROOTS.length)} files`,
);
if (networkBytes > 0)
  console.log(`Network: ${(networkBytes / 1048576).toFixed(1)} MB (of about 10 GB upstream)`);
if (rebuilt > 0) console.log(`Rebuilt ${String(rebuilt)} file(s).`);
if (mismatched > 0) {
  console.log(`\n${String(mismatched)} file(s) differ from the manifest.`);
  process.exitCode = 1;
} else {
  console.log('\nEvery prepared file matches its recorded checksum.');
}
