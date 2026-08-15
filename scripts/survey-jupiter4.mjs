/*
 * What is actually in the Jupiter-4 library, preset by preset.
 *
 *   npm run survey:jupiter4                  every playable preset in every category
 *   npm run survey:jupiter4 -- --measure     also fetch one mid note from each and measure it
 *   npm run survey:jupiter4 -- --category Lead
 *
 * Stage 8 first chose four presets by measuring a handful of candidates, and two of the four are
 * the ones the ear later rejected. This was the first half of the fix: look at *everything* first,
 * so a shortlist is drawn from the whole library rather than from whatever was inspected first.
 *
 * It is kept because the claims the documents make about the library — how many presets FX holds,
 * whether Pads are chromatically sampled, what a preset's recordings actually contain — should be
 * checkable by anybody who doubts them, and `verify-credits` asserts several of those numbers. A
 * survey nobody can re-run is an assertion, not a finding.
 *
 * The listing costs about a megabyte per category — ZIP central directories over `Range` requests,
 * no audio. `--measure` fetches one recording per preset, which is a few megabytes more and is
 * what makes it possible to say "these six are all the same kind of bright" without listening to
 * sixty.
 *
 * **The measurements narrow; they do not choose.** That distinction is the whole reason the sound
 * set was redone. The six shipped sounds were chosen by ear, from a shortlist this drew.
 *
 * No TryAPL request, ever. The pinned upstream release, and nothing else.
 */

/* eslint-disable @typescript-eslint/no-unsafe-return -- the release layout is untyped. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteZip } from './lib/remote-zip.mjs';
import { readAiff, toMono } from './lib/aiff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const measuring = args.includes('--measure');
const only = args.includes('--category') ? args[args.indexOf('--category') + 1] : null;

/*
 * The same pinned release Stage 8 prepared from, with every category this time.
 *
 * Sizes are in the source rather than looked up, exactly as `prepare-jupiter4.mjs` explains: the
 * anonymous releases API is rate-limited, and a length that is part of the source is a length a
 * reader can check.
 */
const RELEASE_BASE = 'https://github.com/publicsamples/Roland-Jupiter-4/releases/download/1.0';

const CATEGORIES = {
  Bass: [['Bass.zip', 657270387]],
  Keys: [
    ['Keys.zip.001', 1000000000],
    ['Keys.zip.002', 788988894],
  ],
  Lead: [
    ['Lead.zip.001', 1000000000],
    ['Lead.zip.002', 809393740],
  ],
  Pads: [
    ['Pads.zip.001', 1000000000],
    ['Pads.zip.002', 1000000000],
    ['Pads.zip.003', 1000000000],
    ['Pads.zip.004', 385960488],
  ],
  FX: [
    ['FX.zip.001', 1000000000],
    ['FX.zip.002', 907003152],
  ],
  Misc: [
    ['Misc.zip.001', 1000000000],
    ['Misc.zip.002', 436061712],
  ],
};

/** The note measured from each preset. Middle C, or the nearest sampled key to it. */
const MEASURE_AT = 60;

/* Into the gitignored cache, beside the other vendored upstream working files. */
const outPath = join(root, '.cache', 'jupiter4-survey.json');

/* ------------------------------------------------------------------------- */

/**
 * What a recording is like, in numbers.
 *
 * Every one of these is a *narrowing* tool. They are good at saying "this preset is four times
 * brighter than that one" and useless at saying which of them belongs in the product, which is
 * the mistake this whole pass exists to undo.
 */
function measure(mono, sampleRate) {
  let peak = 0;
  for (const value of mono) peak = Math.max(peak, Math.abs(value));

  /** Time to 90% of peak. A pad swells; a blip does not. */
  let attackFrames = mono.length;
  for (let at = 0; at < mono.length; at += 1) {
    if (Math.abs(mono[at]) >= peak * 0.9) {
      attackFrames = at;
      break;
    }
  }

  /** How much is left half a second in, and one second in, relative to the peak. */
  const level = (fromSeconds, forSeconds) => {
    const from = Math.min(mono.length, Math.round(fromSeconds * sampleRate));
    const to = Math.min(mono.length, from + Math.round(forSeconds * sampleRate));
    if (to <= from) return 0;
    let sum = 0;
    for (let at = from; at < to; at += 1) sum += mono[at] * mono[at];
    return Math.sqrt(sum / (to - from));
  };

  const attackRms = level(0, 0.1);
  const halfSecond = level(0.5, 0.1);
  const oneSecond = level(1, 0.1);
  const twoSeconds = level(2, 0.1);

  /** Zero crossings per second: a crude, cheap and quite reliable proxy for brightness. */
  let crossings = 0;
  for (let at = 1; at < mono.length; at += 1) {
    if (mono[at - 1] < 0 !== mono[at] < 0) crossings += 1;
  }

  return {
    peak: Number(peak.toFixed(5)),
    attackMs: Number(((attackFrames / sampleRate) * 1000).toFixed(1)),
    attackRms: Number(attackRms.toFixed(5)),
    /* Sustain as a fraction of the attack, at three distances. A pad holds; a pluck does not. */
    at500ms: Number((attackRms > 0 ? halfSecond / attackRms : 0).toFixed(3)),
    at1s: Number((attackRms > 0 ? oneSecond / attackRms : 0).toFixed(3)),
    at2s: Number((attackRms > 0 ? twoSeconds / attackRms : 0).toFixed(3)),
    brightnessHz: Math.round(crossings / 2 / (mono.length / sampleRate)),
    durationSeconds: Number((mono.length / sampleRate).toFixed(2)),
  };
}

/* ------------------------------------------------------------------------- */

console.log('\nThe Jupiter-4 library, preset by preset.\n');

/*
 * Merged into whatever is already there, rather than replacing it.
 *
 * A `--category Lead --measure` run costs 17 MB, so surveying the library one category at a time
 * is the sensible way to do it — and the first version overwrote the file each run, which meant
 * five careful passes left the results of one. Merging is four lines and makes the file the record
 * it was meant to be.
 */
const survey = { upstream: RELEASE_BASE, measuredAt: MEASURE_AT, categories: {} };
if (existsSync(outPath)) {
  try {
    Object.assign(survey.categories, JSON.parse(readFileSync(outPath, 'utf8')).categories ?? {});
  } catch {
    // A corrupt or half-written survey is not worth failing over; this run replaces it.
  }
}

let networkBytes = 0;

for (const [category, parts] of Object.entries(CATEGORIES)) {
  if (only !== null && category !== only) continue;

  const archive = new RemoteZip(parts.map(([name, size]) => ({ url: `${RELEASE_BASE}/${name}`, size })));
  await archive.open();

  const names = [...archive.entries.keys()];
  const audio = names.filter((name) => /\.aif$/iu.test(name));
  const sfz = names.filter((name) => /\.sfz$/iu.test(name));

  /*
   * A preset is a folder of chromatically sampled AIFFs.
   *
   * The `-<key>-127` suffix is how this library names them, and a folder without it is not
   * something a phrase can be played on — which is the test, rather than the folder's name or
   * which archive it happens to live in.
   */
  const presets = new Map();
  for (const name of audio) {
    const folder = name.split('/').slice(0, -1).join('/');
    const key = Number((/-(\d+)-127/u.exec(name) ?? [])[1]);
    if (!Number.isFinite(key)) continue;
    if (!presets.has(folder)) presets.set(folder, []);
    presets.get(folder).push({ name, key });
  }

  console.log(`${'═'.repeat(78)}\n${category}: ${String(presets.size)} playable presets\n`);

  const rows = [];
  for (const [folder, files] of [...presets].sort(([a], [b]) => a.localeCompare(b))) {
    const keys = files.map((file) => file.key).sort((a, b) => a - b);
    const preset = folder
      .split('/')
      .pop()
      .replace(/-SAMPLES$/u, '');

    const row = {
      preset,
      category,
      folder,
      files: files.length,
      lowestKey: keys[0],
      highestKey: keys[keys.length - 1],
      /** The SFZ mapping, where there is one. Read for loop points, never bundled. */
      sfz: sfz.find((name) => name.includes(`/${preset}.sfz`)) ?? null,
    };

    if (measuring) {
      // The nearest sampled key to middle C, so every preset is measured in the same register.
      const chosen = [...files].sort(
        (a, b) => Math.abs(a.key - MEASURE_AT) - Math.abs(b.key - MEASURE_AT),
      )[0];

      const bytes = await archive.extract(chosen.name);
      const aiff = readAiff(bytes);
      const mono = toMono(aiff.data);

      row.measuredFile = chosen.name;
      row.measuredKey = chosen.key;
      row.sourceBytes = bytes.length;
      row.sampleRate = aiff.sampleRate;
      row.sourceBits = aiff.bits;
      row.loop =
        aiff.loop === null
          ? null
          : {
              startFrames: aiff.loop.start,
              endFrames: aiff.loop.end,
              startSeconds: Number((aiff.loop.start / aiff.sampleRate).toFixed(3)),
              endSeconds: Number((aiff.loop.end / aiff.sampleRate).toFixed(3)),
            };
      Object.assign(row, measure(mono, aiff.sampleRate));
    }

    rows.push(row);

    const shape = measuring
      ? `${String(row.durationSeconds).padStart(5)}s  atk ${String(row.attackMs).padStart(6)}ms  ` +
        `peak ${row.peak.toFixed(3)}  hold ${row.at500ms.toFixed(2)}/${row.at1s.toFixed(2)}/${row.at2s.toFixed(2)}  ` +
        `${String(row.brightnessHz).padStart(5)}Hz  ${row.loop ? `loop ${String(row.loop.startSeconds)}s` : 'no loop'}`
      : `${String(files.length).padStart(3)} files  keys ${String(keys[0])}–${String(keys[keys.length - 1])}`;

    console.log(`  ${preset.padEnd(34)} ${shape}`);
  }

  survey.categories[category] = rows;
  networkBytes += archive.bytesRead;
  console.log('');
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(survey, null, 2)}\n`);

console.log(`${'═'.repeat(78)}`);
console.log(`Network: ${(networkBytes / 1048576).toFixed(1)} MB`);
console.log(`Written: ${outPath}`);
console.log('\nMeasurements narrow the field. They do not choose the sound.');
