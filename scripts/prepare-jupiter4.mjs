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
 * 1.0, as thirteen ZIP parts across six categories totalling about ten gigabytes: Bass alone is
 * 627 MB and Pads is 3.2 GB across four parts. Four categories are read; Pads and FX are not.
 *
 * APL Beats needs forty-two of those recordings. Downloading gigabytes to keep four megabytes would
 * make this
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
 * The six sounds APL Beats ships, chosen by ear.
 *
 * Not one per category, and that is the point. Stage 8 shipped four presets picked by measurement
 * — brightest Lead, fastest-attacking Pad — and the two picked for the most measurable reasons
 * were the two that sounded worst. These six came out of a listening pass over every playable
 * preset in the library, each one heard against the opening groove at the shipped tempo rather
 * than as an isolated note.
 *
 * **There is no Pad.** Fourteen were auditioned and none was worth shipping. A category left
 * unfilled is a smaller fault than a bad sound in it, and the selector offers sounds rather than
 * categories, so nothing in the interface has a hole in it.
 *
 * `category` records where each recording actually came from, which is provenance and stays
 * accurate whatever the sound is called: three come from Lead, one each from Keys and Bass, and
 * `jp4 - Fake Flute` is from Misc. The interface shows the preset name.
 *
 * The measurements below are what narrowed the field to something listenable. They did not choose
 * the winners and are recorded because they explain the working gains, not because they rank
 * anything.
 */
const SOUNDS = [
  {
    id: 'petals-piano',
    name: 'Petals Piano',
    category: 'Keys',
    asset: ['Keys.zip.001', 'Keys.zip.002'],
    /** The folder inside the archive, and the preset name as upstream spells it. */
    folder: 'Petals Piano-SAMPLES',
    preset: 'Petals Piano',
    sfz: 'Petals Piano.sfz',
    because:
      'Chosen by ear as the default. 6 ms attack at full scale decaying to about a third, so it ' +
      'articulates sixteenths cleanly and makes the shape of a phrase obvious on first play — ' +
      'which is what a default has to do.',
  },
  {
    id: 'chunky',
    name: 'Chunky',
    category: 'Lead',
    asset: ['Lead.zip.001', 'Lead.zip.002'],
    folder: 'Chunky-SAMPLES',
    preset: 'Chunky',
    sfz: null,
    because:
      'A plucked bright lead: 30 ms attack at 1171 Hz, decaying to half by two seconds. Bright ' +
      'without the spike that made the previous Lead tiring.',
  },
  {
    id: 'noisy-lead',
    name: 'Noisy Lead',
    category: 'Lead',
    asset: ['Lead.zip.001', 'Lead.zip.002'],
    folder: 'jp4 - Noisy Lead-SAMPLES',
    preset: 'jp4 - Noisy Lead',
    sfz: null,
    because:
      'Level throughout at 697 Hz — the nasal end of the range, and the one that holds its note ' +
      'rather than decaying under it.',
  },
  {
    id: 'gone-away-forever',
    name: 'Gone Away Forever',
    category: 'Lead',
    asset: ['Lead.zip.001', 'Lead.zip.002'],
    folder: 'Gone Away Forever-SAMPLES',
    preset: 'Gone Away Forever',
    sfz: null,
    because:
      'Full scale, 320 ms in, holding at five times its attack. The loud and sustained corner of ' +
      'the library, and the closest thing here to a pad that still speaks in a sixteenth.',
  },
  {
    id: 'fake-flute',
    name: 'Fake Flute',
    category: 'Misc',
    asset: ['Misc.zip.001', 'Misc.zip.002'],
    folder: 'jp4 - Fake Flute-SAMPLES',
    preset: 'jp4 - Fake Flute',
    sfz: null,
    because:
      'Filed under Misc rather than Lead, and a lead in everything but its filing: the softest ' +
      'round voice in the library at 276 Hz, holding just under twice its attack.',
  },
  {
    id: 'four-bass',
    name: '4 Bass',
    category: 'Bass',
    asset: ['Bass.zip'],
    folder: '4Bass',
    preset: '4 Bass',
    sfz: '4 Bass.sfz',
    because:
      '58 ms attack and a level sustain, bright enough to be heard under a kick without ' +
      'competing with it. The one bass preset here with genuine loop metadata in both its SFZ ' +
      'mapping and its AIFF chunks.',
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
  'Misc.zip.001': 1000000000,
  'Misc.zip.002': 436061712,
};

/*
 * The two categories nothing is taken from, and their pinned sizes.
 *
 * Not shipped, and *inspected* rather than assumed. `--survey` reads their central directories
 * over Range requests and prints what is in them; the finding is recorded in the manifest below so
 * a reader does not have to take it on trust or spend gigabytes checking. Pads is here because it
 * was auditioned in full and rejected by ear, which is a stronger statement than not looking.
 */
const SURVEY_ASSETS = {
  FX: [
    ['FX.zip.001', 1000000000],
    ['FX.zip.002', 907003152],
  ],
  Pads: [
    ['Pads.zip.001', 1000000000],
    ['Pads.zip.002', 1000000000],
    ['Pads.zip.003', 1000000000],
    ['Pads.zip.004', 385960488],
  ],
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
  /*
   * What is in the library, and what is taken from it.
   *
   * Established by `npm run prepare:jupiter4 -- --survey` and by the listening pass. Two of the
   * six categories contribute nothing, and the reasons are completely different:
   *
   *   **FX** was never a candidate for a pitched voice, though not for the reason first assumed —
   *   its eleven folders are chromatically sampled playable presets rather than one-shots. It is
   *   excluded for scope.
   *
   *   **Pads** was auditioned properly and *failed*. Fourteen of its sixteen presets were prepared
   *   and listened to against the opening groove, and none was worth shipping. That is recorded
   *   here rather than quietly omitted, because "we did not look" and "we looked and none was good
   *   enough" are different statements and only one of them is true.
   *
   * Misc contributes one preset, `jp4 - Fake Flute`, which is a lead in everything but its filing.
   */
  categoriesNotShipped: {
    FX: {
      presets: 11,
      audioFiles: 538,
      chromaticFolders: 11,
      finding:
        'chromatically sampled playable presets, not one-shots — excluded for scope rather than ' +
        'for suitability. Never auditioned.',
    },
    Pads: {
      presets: 16,
      audioFiles: 784,
      chromaticFolders: 16,
      auditioned: 14,
      finding:
        'fourteen of the sixteen were prepared at five roots and auditioned by ear against the ' +
        'opening groove, in three lengths each. None was good enough to ship. APL Beats offers ' +
        'sounds rather than categories, so the shape of the selector does not require one.',
    },
    surveyedBy: 'npm run prepare:jupiter4 -- --survey',
  },
  sounds: {},
  sourceArchives: {},
};

let networkBytes = 0;
let totalBytes = 0;
let rebuilt = 0;
let mismatched = 0;

/* ---- the survey ------------------------------------------------------------ */

/**
 * What is in a category, without downloading it.
 *
 * Reads the ZIP central directory over `Range` requests and counts what kinds of file are there
 * and how many of them look chromatically sampled — the `-<key>-127` naming every playable preset
 * in this library uses. A folder with no chromatic set is not something a phrase can be played on,
 * whatever it is called.
 */
async function survey(label, parts) {
  const archive = new RemoteZip(parts.map(([name, size]) => ({ url: `${RELEASE_BASE}/${name}`, size })));
  await archive.open();

  const names = [...archive.entries.keys()];
  const audio = names.filter((name) => /\.aif$/iu.test(name));
  const folders = new Set(audio.map((name) => name.split('/').slice(0, -1).join('/')));
  const chromatic = new Set(
    audio.filter((name) => /-\d+-127/u.test(name)).map((name) => name.split('/').slice(0, -1).join('/')),
  );

  console.log(`${label}:`);
  console.log(
    `   ${String(names.length)} entries, ${String(audio.length)} AIFF, ${String(folders.size)} folders`,
  );
  console.log(`   ${String(chromatic.size)} folder(s) with chromatically sampled keys`);
  for (const folder of [...folders].sort().slice(0, 12)) {
    const count = audio.filter((name) => name.startsWith(`${folder}/`)).length;
    console.log(
      `     ${folder.padEnd(52)} ${String(count).padStart(4)} files${chromatic.has(folder) ? '  chromatic' : ''}`,
    );
  }
  if (folders.size > 12) console.log(`     … and ${String(folders.size - 12)} more`);
  console.log(`   read ${(archive.bytesRead / 1024).toFixed(1)} KB\n`);

  return {
    entries: names.length,
    audioFiles: audio.length,
    folders: folders.size,
    chromaticFolders: chromatic.size,
  };
}

if (args.includes('--survey')) {
  console.log('Surveying the categories nothing is taken from.\n');
  for (const [label, parts] of Object.entries(SURVEY_ASSETS)) await survey(label, parts);
  process.exit(0);
}

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
    /* Provenance, and it stays accurate whatever the selector calls the sound. */
    upstreamCategory: sound.category,
    upstreamFolder: sound.folder,
    sfz: sound.sfz,
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
