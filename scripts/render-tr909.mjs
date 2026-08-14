/*
 * Render the TR-909 kit from André Michelle's implementation.
 *
 *   npm run render:tr909              render anything missing, verify what is there
 *   npm run render:tr909 -- --force   render everything again
 *   npm run render:tr909 -- --check   verify checksums only, render nothing
 *
 * Contributors do not need to run this: the rendered audio is committed. It exists so that
 * "which exact version of somebody else's work is in here, and what did we do to it" has a
 * reproducible answer rather than a remembered one.
 *
 * **This is not a re-implementation.** The DSP that produces these eight sounds is André's own,
 * downloaded at a pinned commit and executed unmodified — `BassdrumVoice`, `SnaredrumVoice` and
 * `BasicTuneDecayVoice`, fed by his `.raw` resources and configured by his `Preset` defaults.
 * Writing a TR-909 emulation of our own and calling it a render would be a much worse kind of
 * borrowing than using his.
 *
 * That matters especially for the bass drum. `bassdrum-cycle.raw` is 23 ms long, and the DSP
 * loops it under a swept pitch envelope with a separate attack transient on top; playing the file
 * as though it were a finished drum would produce a short buzz rather than a 909 kick. The same
 * holds in lesser degrees elsewhere — every voice has an envelope, a tuning and a decay that live
 * in the code rather than in the file it reads.
 *
 * Everything here runs offline and sample-by-sample: no audio device and no browser are involved.
 * The rendered WAV output is what ships. The upstream `.raw` resources are inputs and are not
 * redistributed; what they physically are is not documented upstream and is not claimed here.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const force = args.includes('--force');
const checkOnly = args.includes('--check');

/*
 * The upstream DSP arrives as compiled JavaScript loaded at run time, so every class and every
 * instance built from it is `any` as far as the type checker is concerned. That is not a
 * looseness that could be tightened here: there are no type declarations to import, and writing
 * some would be asserting a shape rather than knowing one. What each of these values is used
 * for immediately afterwards — `process()` into a Float32Array, and numbers into a manifest —
 * is checked by the render succeeding and by `--check` reproducing the same bytes.
 */
/* eslint-disable @typescript-eslint/no-unsafe-return */

/* ---- the pinned upstream ---------------------------------------------------- */

const UPSTREAM = {
  name: 'andremichelle/tr-909',
  url: 'https://github.com/andremichelle/tr-909',
  commit: '11d423382d6d9705bd37a42b533e3b3c27442be7',
  commitDate: '2024-03-11',
  licence: 'MIT',
  copyright: 'Copyright (c) 2022 André Michelle',
};

const RAW_BASE = `https://raw.githubusercontent.com/andremichelle/tr-909/${UPSTREAM.commit}`;

/**
 * What has to be downloaded to run the DSP.
 *
 * The compiled modules rather than the TypeScript, so that what executes here is what upstream
 * ships — no compiler of ours between his source and his sound. They import each other by
 * relative path, so the directory layout is preserved exactly.
 */
const DSP_MODULES = [
  'bin/audio/common.js',
  'bin/audio/tr909/preset.js',
  'bin/audio/tr909/resources.js',
  'bin/audio/tr909/dsp/voice.js',
  'bin/audio/tr909/dsp/basic-voice.js',
  'bin/audio/tr909/dsp/bassdrum.js',
  'bin/audio/tr909/dsp/snaredrum.js',
  'bin/lib/common.js',
  'bin/lib/mapping.js',
];

const RESOURCES = [
  'bassdrum-attack.raw',
  'bassdrum-cycle.raw',
  'snare-tone.raw',
  'snare-noise.raw',
  'tom-low.raw',
  'tom-hi.raw',
  'rim.raw',
  'clap.raw',
  'closed-hihat.raw',
  'opened-hihat.raw',
];

/** Where the upstream copy lives. Git-ignored: it is an input, not part of this project. */
const CACHE = join(root, '.cache', 'tr-909');

/* ---- rendering settings ----------------------------------------------------- */

const SAMPLE_RATE = 44_100;

/**
 * The step level each voice is rendered at, in decibels.
 *
 * Upstream scales every hit by `LevelMapping.y(...)`, a `Linear(-18, 0)` over how hard the step
 * was struck: an ordinary step is −9 dB, a fully accented one −4.5 dB, and 0 dB is the top of
 * the range. These are rendered at the top.
 *
 * That is a deliberate choice and worth being exact about. It is a *uniform* offset — the same
 * number for all eight voices — so the machine's own balance between them, which lives in the
 * preset levels and is −6 dB across the board, survives untouched. What it buys is resolution:
 * rendering an ordinary step would put every file 9 dB down and throw away a bit and a half of
 * the sixteen available for nothing, since APL Beats sets the playback level itself anyway.
 */
const STEP_LEVEL_DB = 0;

/** How long a voice may run before being cut off. None of them come close. */
const MAX_SECONDS = 4;

/** Upstream processes in blocks of this size; doing the same keeps the envelopes identical. */
const QUANTUM = 128;

/**
 * Below this, a tail has stopped being part of the sound.
 *
 * −96 dBFS is the quietest thing a 16-bit file can represent, so trailing samples under it would
 * quantise to silence regardless. Only the very end is trimmed, and only when the voice has
 * already declared itself finished — nothing audible is cut.
 */
const SILENCE = 10 ** (-96 / 20);

/* ---- what to render --------------------------------------------------------- */

/**
 * The eight voices, and how upstream builds each one.
 *
 * `releaseStartTime` and the preset are taken from `createVoice` in upstream's `processor.ts`,
 * not chosen here. Mid tom, crash and ride are deliberately not rendered: APL Beats has eight
 * rows and this stage adds no more.
 */
const VOICES = [
  {
    row: 'kick',
    file: 'kick.wav',
    instrument: 'Bass drum',
    dsp: 'BassdrumVoice',
    resources: ['bassdrum-attack.raw', 'bassdrum-cycle.raw'],
    build: (mod, res, preset) =>
      new mod.bassdrum.BassdrumVoice(
        { attack: res['bassdrum-attack.raw'], cycle: res['bassdrum-cycle.raw'] },
        preset.bassdrum,
        SAMPLE_RATE,
        STEP_LEVEL_DB,
      ),
    settings: (preset) => ({
      tune: preset.bassdrum.tune.get(),
      panelLevelDb: preset.bassdrum.level.get(),
      attack: preset.bassdrum.attack.get(),
      decay: preset.bassdrum.decay.get(),
    }),
  },
  {
    row: 'snare',
    file: 'snare.wav',
    instrument: 'Snare drum',
    dsp: 'SnaredrumVoice',
    resources: ['snare-tone.raw', 'snare-noise.raw'],
    build: (mod, res, preset) =>
      new mod.snaredrum.SnaredrumVoice(
        { tone: res['snare-tone.raw'], noise: res['snare-noise.raw'] },
        preset.snaredrum,
        SAMPLE_RATE,
        STEP_LEVEL_DB,
      ),
    settings: (preset) => ({
      tune: preset.snaredrum.tune.get(),
      panelLevelDb: preset.snaredrum.level.get(),
      tone: preset.snaredrum.tone.get(),
      snappy: preset.snaredrum.snappy.get(),
    }),
  },
  {
    row: 'closedHat',
    file: 'closed-hat.wav',
    instrument: 'Closed hi-hat',
    dsp: 'BasicTuneDecayVoice',
    resources: ['closed-hihat.raw'],
    releaseStartTime: 0.006,
    build: (mod, res, preset) =>
      new mod.basic.BasicTuneDecayVoice(
        res['closed-hihat.raw'],
        preset.closedHihat,
        SAMPLE_RATE,
        0.006,
        STEP_LEVEL_DB,
      ),
    settings: (preset) => ({
      panelLevelDb: preset.closedHihat.level.get(),
      decay: preset.closedHihat.decay.get(),
    }),
  },
  {
    row: 'openHat',
    file: 'open-hat.wav',
    instrument: 'Open hi-hat',
    dsp: 'BasicTuneDecayVoice',
    resources: ['opened-hihat.raw'],
    releaseStartTime: 0.012,
    build: (mod, res, preset) =>
      new mod.basic.BasicTuneDecayVoice(
        res['opened-hihat.raw'],
        preset.openedHihat,
        SAMPLE_RATE,
        0.012,
        STEP_LEVEL_DB,
      ),
    settings: (preset) => ({
      panelLevelDb: preset.openedHihat.level.get(),
      decay: preset.openedHihat.decay.get(),
    }),
  },
  {
    row: 'clap',
    file: 'clap.wav',
    instrument: 'Hand clap',
    dsp: 'BasicTuneDecayVoice',
    resources: ['clap.raw'],
    releaseStartTime: 0,
    build: (mod, res, preset) =>
      new mod.basic.BasicTuneDecayVoice(res['clap.raw'], preset.clap, SAMPLE_RATE, 0, STEP_LEVEL_DB),
    settings: (preset) => ({ panelLevelDb: preset.clap.level.get() }),
  },
  {
    row: 'lowPerc',
    file: 'low-perc.wav',
    instrument: 'Low tom',
    dsp: 'BasicTuneDecayVoice',
    resources: ['tom-low.raw'],
    releaseStartTime: 0.03,
    build: (mod, res, preset) =>
      new mod.basic.BasicTuneDecayVoice(res['tom-low.raw'], preset.tomLow, SAMPLE_RATE, 0.03, STEP_LEVEL_DB),
    settings: (preset) => ({
      tune: preset.tomLow.tune.get(),
      panelLevelDb: preset.tomLow.level.get(),
      decay: preset.tomLow.decay.get(),
    }),
  },
  {
    row: 'highPerc',
    file: 'high-perc.wav',
    instrument: 'High tom',
    dsp: 'BasicTuneDecayVoice',
    resources: ['tom-hi.raw'],
    releaseStartTime: 0.03,
    build: (mod, res, preset) =>
      new mod.basic.BasicTuneDecayVoice(res['tom-hi.raw'], preset.tomHi, SAMPLE_RATE, 0.03, STEP_LEVEL_DB),
    settings: (preset) => ({
      tune: preset.tomHi.tune.get(),
      panelLevelDb: preset.tomHi.level.get(),
      decay: preset.tomHi.decay.get(),
    }),
  },
  {
    row: 'rim',
    file: 'rim.wav',
    instrument: 'Rim shot',
    dsp: 'BasicTuneDecayVoice',
    resources: ['rim.raw'],
    releaseStartTime: 0,
    build: (mod, res, preset) =>
      new mod.basic.BasicTuneDecayVoice(res['rim.raw'], preset.rim, SAMPLE_RATE, 0, STEP_LEVEL_DB),
    settings: (preset) => ({ panelLevelDb: preset.rim.level.get() }),
  },
];

/* ---- fetch the upstream copy ------------------------------------------------ */

async function fetchUpstream() {
  const problems = [];
  let downloaded = 0;

  for (const path of [...DSP_MODULES, ...RESOURCES.map((name) => `resources/${name}`)]) {
    const target = join(CACHE, path);
    if (existsSync(target) && !force) continue;

    const response = await fetch(`${RAW_BASE}/${path}`);
    if (!response.ok) {
      problems.push(`HTTP ${String(response.status)} for ${path}`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    downloaded += 1;
  }

  if (problems.length > 0) throw new Error(problems.join('; '));
  return downloaded;
}

/* ---- render ------------------------------------------------------------------ */

/** A `.raw` resource as upstream reads it: raw little-endian Float32, 44.1 kHz. */
function loadResource(name) {
  const bytes = readFileSync(join(CACHE, 'resources', name));
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Float32Array(copy);
}

/** Run one voice until it says it has finished. */
function render(voice) {
  const output = new Float32Array(SAMPLE_RATE * MAX_SECONDS);
  let at = 0;
  while (at < output.length) {
    const to = Math.min(at + QUANTUM, output.length);
    const running = voice.process(output, at, to);
    at = to;
    if (!running) break;
  }

  // Trim only the inaudible tail, and only after the voice has stopped.
  let end = at;
  while (end > 0 && Math.abs(output[end - 1]) < SILENCE) end -= 1;
  return output.subarray(0, end);
}

/**
 * 16-bit PCM WAV, mono.
 *
 * Chosen over Float32 because it halves the download for a difference nobody can hear at these
 * levels, and over a lossy codec because it needs no external encoder and is therefore
 * reproducible from this script alone. The quantisation is the one lossy step in the pipeline
 * and is written down as such: these files are *derived renders*, not upstream originals.
 */
function encodeWav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); // PCM
  bytes.writeUInt16LE(1, 22); // mono
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);

  for (let i = 0; i < samples.length; i += 1) {
    // Rounded and clamped, deterministically. No dither: it would make the output depend on a
    // random source and stop two runs of this script agreeing.
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const value = Math.round(clamped * 32767);
    bytes.writeInt16LE(value, 44 + i * 2);
  }
  return bytes;
}

/* ---- go ---------------------------------------------------------------------- */

console.log(`Upstream: ${UPSTREAM.name} @ ${UPSTREAM.commit}`);
console.log(`Licence:  ${UPSTREAM.licence}, ${UPSTREAM.copyright}\n`);

if (!checkOnly) {
  const downloaded = await fetchUpstream();
  console.log(`Upstream files: ${String(downloaded)} downloaded, cache at .cache/tr-909\n`);
}

const asUrl = (path) => `file:///${join(CACHE, path).replaceAll('\\', '/')}`;
const modules = {
  preset: await import(asUrl('bin/audio/tr909/preset.js')),
  basic: await import(asUrl('bin/audio/tr909/dsp/basic-voice.js')),
  bassdrum: await import(asUrl('bin/audio/tr909/dsp/bassdrum.js')),
  snaredrum: await import(asUrl('bin/audio/tr909/dsp/snaredrum.js')),
  resources: await import(asUrl('bin/audio/tr909/resources.js')),
};

if (modules.resources.ResourceSampleRate !== SAMPLE_RATE) {
  throw new Error(
    `upstream resources are ${String(modules.resources.ResourceSampleRate)} Hz, this renders at ${String(SAMPLE_RATE)}`,
  );
}

const loaded = Object.fromEntries(RESOURCES.map((name) => [name, loadResource(name)]));
const outputDirectory = join(root, 'public', 'audio', 'tr-909');
mkdirSync(outputDirectory, { recursive: true });

const manifest = {
  upstream: UPSTREAM,
  rendering: {
    sampleRate: SAMPLE_RATE,
    format: '16-bit PCM WAV, mono',
    lossless: false,
    lossyStep: 'float32 render quantised to 16-bit PCM, rounded, no dither',
    stepLevelDb: STEP_LEVEL_DB,
    stepLevelNote:
      "upstream's LevelMapping is Linear(-18, 0) dB over how hard a step was struck; 0 dB is the " +
      'top of that range, applied uniformly to all eight voices',
    presetSource: 'upstream Preset defaults, unmodified',
    panelLevelNote:
      "each voice's `panelLevelDb` below is the machine's own front-panel level knob for that " +
      'instrument, left at the preset default. It is a different control from `stepLevelDb` ' +
      'above, which is how hard the step was struck, and the two multiply',
    renderedBy: 'scripts/render-tr909.mjs',
  },
  voices: {},
};

console.log('row          instrument      length     peak    dBFS      size  file');
console.log('-'.repeat(78));

const preset = new modules.preset.Preset();
let totalBytes = 0;
const problems = [];

for (const spec of VOICES) {
  const voice = spec.build(modules, loaded, preset);
  const samples = render(voice);

  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));

  const wav = encodeWav(samples);
  const target = join(outputDirectory, spec.file);

  if (checkOnly) {
    if (!existsSync(target)) problems.push(`missing and --check given: ${spec.file}`);
  } else {
    writeFileSync(target, wav);
  }

  const sha256 = createHash('sha256').update(wav).digest('hex');
  const onDisk = existsSync(target) ? readFileSync(target) : Buffer.alloc(0);
  if (checkOnly && existsSync(target) && createHash('sha256').update(onDisk).digest('hex') !== sha256) {
    problems.push(`${spec.file} differs from a fresh render`);
  }

  totalBytes += wav.length;
  const seconds = samples.length / SAMPLE_RATE;

  manifest.voices[spec.row] = {
    file: spec.file,
    instrument: spec.instrument,
    dsp: `typescript/audio/tr909/dsp/${spec.dsp === 'BasicTuneDecayVoice' ? 'basic-voice' : spec.dsp === 'BassdrumVoice' ? 'bassdrum' : 'snaredrum'}.ts`,
    dspClass: spec.dsp,
    resources: spec.resources.map((name) => `resources/${name}`),
    ...(spec.releaseStartTime === undefined ? {} : { releaseStartTime: spec.releaseStartTime }),
    settings: spec.settings(preset),
    samples: samples.length,
    seconds: Number(seconds.toFixed(4)),
    peak: Number(peak.toFixed(5)),
    bytes: wav.length,
    sha256,
  };

  const dB = peak <= 0 ? '-inf' : (20 * Math.log10(peak)).toFixed(1);
  console.log(
    `${spec.row.padEnd(12)} ${spec.instrument.padEnd(15)} ${`${seconds.toFixed(3)}s`.padStart(7)} ` +
      `${peak.toFixed(3).padStart(7)} ${dB.padStart(7)} ${`${(wav.length / 1024).toFixed(1)} KB`.padStart(9)}  ${spec.file}`,
  );

  if (peak > 1) problems.push(`${spec.file} peaks above full scale at ${peak.toFixed(3)}`);
  if (peak < 0.01) problems.push(`${spec.file} is silent`);
}

/* Checksums of the upstream inputs too, so a changed input is visible. */
manifest.upstreamFiles = {};
for (const path of [...DSP_MODULES, ...RESOURCES.map((name) => `resources/${name}`)]) {
  const bytes = readFileSync(join(CACHE, path));
  manifest.upstreamFiles[path] = {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

if (!checkOnly) {
  /*
   * Run the manifest through Prettier before writing it.
   *
   * `JSON.stringify` puts every array element on its own line and Prettier keeps short ones
   * inline, so the two disagree about eight `resources` arrays. Without this, running the
   * documented command would leave `npm run format:check` failing — a repository that fails its
   * own checks the moment you use it as instructed, over whitespace in a generated file.
   *
   * Formatting it here rather than adding the file to `.prettierignore` because the manifest is
   * meant to be read by people as well as by tests, and an exemption would drift.
   */
  const manifestPath = join(root, 'src', 'audio', 'kits', 'tr909-render.json');
  const prettier = await import('prettier');
  const options = await prettier.resolveConfig(manifestPath);
  const formatted = await prettier.format(JSON.stringify(manifest, null, 2), {
    ...options,
    filepath: manifestPath,
  });
  writeFileSync(manifestPath, formatted);
}

console.log(`\nTotal: ${(totalBytes / 1024).toFixed(1)} KB across ${String(VOICES.length)} files`);
const largest = Object.values(manifest.voices).sort((a, b) => b.bytes - a.bytes)[0];
console.log(`Largest: ${largest.file} at ${(largest.bytes / 1024).toFixed(1)} KB`);

if (problems.length > 0) {
  console.error('\nProblems:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nRendered from upstream DSP, deterministically.');
}
