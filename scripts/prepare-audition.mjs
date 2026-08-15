/*
 * Prepare the audition bench's audio, locally, from the pinned upstream release.
 *
 *   npm run prepare:audition                 fetch and build anything missing
 *   npm run prepare:audition -- --role lead  one role at a time
 *   npm run prepare:audition -- --force      rebuild everything
 *   npm run prepare:audition -- --clean      delete the built audio, keep the cache
 *
 * **Nothing this writes is ever committed.** `.audition/` is gitignored and lives outside
 * `public/`, so it cannot reach a build even by accident — the dev server serves it through a
 * plugin that exists only in dev. Thirty candidates at five roots is about eighty megabytes, which
 * is a fine thing to have on a laptop and an absurd thing to have in a repository.
 *
 * ---
 *
 * **The cache is the point.** Extracting one recording costs one to three megabytes over `Range`
 * requests, and there are a hundred and fifty of them. Cached in `.audition/cache/` by upstream
 * path, so the first run is slow, every later run is instant, and rebuilding the Pad variants to
 * try a different trim length costs nothing at all. Clearing it is `rm -rf .audition`.
 *
 * ---
 *
 * **Five roots, not seven.** Production prepares 48 54 60 66 72 78 84; this prepares the middle
 * five, 54 60 66 72 78. They are a *subset* of the production roots, so the files are byte-identical
 * to what production would build — the winner needs 48 and 84 adding and nothing re-deciding. Five
 * covers MIDI 51–81 at the production shift budget of three semitones, and both audition phrases
 * live between 60 and 72.
 *
 * ---
 *
 * **Three variants, for the Pad question.** Stage 8 trims everything to 1.2 s and uses no loops,
 * and the brief asks whether that is what is wrong with the pads:
 *
 *   `trim`     1.2 s, exactly as production prepares it
 *   `natural`  4.0 s, so a slow pad has time to become one
 *   `loop`     up to upstream's own loop end, looping between upstream's own points
 *
 * Leads get `trim` only, deliberately: a lead that needs four seconds to speak is not a lead, and
 * the brief is explicit that a weak patch must not be rescued by changing the model around it.
 *
 * **No loop point is invented.** `loop` is built only where the source AIFF's `INST`/`MARK` chunks
 * declare one, cross-checked against the SFZ mapping where the library ships one. Nothing is
 * repeated, faded into itself, reverberated or filtered. Where there is no loop metadata there is
 * no loop variant, and the bench says so.
 */

/* eslint-disable @typescript-eslint/no-unsafe-return -- the archive layout is untyped. */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteZip } from './lib/remote-zip.mjs';
import { readAiff, toMono, writeWav } from './lib/aiff.mjs';
import { CANDIDATES } from './audition-shortlist.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const force = args.includes('--force');
const cleaning = args.includes('--clean');
const onlyRole = args.includes('--role') ? args[args.indexOf('--role') + 1] : null;

const RELEASE_BASE = 'https://github.com/publicsamples/Roland-Jupiter-4/releases/download/1.0';

/** The same pinned assets, by category. Sizes in the source, for the reason prepare-jupiter4 gives. */
const ARCHIVES = {
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

/** The middle five of production's seven. See the header. */
const ROOTS = [54, 60, 66, 72, 78];

/** How far a root may be shifted, which is what five roots six semitones apart guarantees. */
const MAX_SHIFT_SEMITONES = 3;

const FADE_SECONDS = 0.04;

/**
 * The three lengths, and what each is asking.
 *
 * `trim` is the production question — is 1.2 s enough? `natural` is the control — does the same
 * patch become a pad given four seconds? `loop` is the upper bound — does honouring upstream's own
 * sustain loop add anything the natural length does not?
 */
const VARIANTS = {
  trim: { seconds: 1.2, loop: false },
  natural: { seconds: 4, loop: false },
  loop: { seconds: null, loop: true },
};

/** What the bench should reach for first, per role. Leads only get the production model. */
const VARIANTS_FOR = { lead: ['trim'], reference: ['trim'], pad: ['trim', 'natural', 'loop'] };

/**
 * The working peak every candidate is brought to.
 *
 * The same number production uses, applied the same way, for the reason the brief insists on:
 * a comparison in which one sound is simply louder is not a comparison. This is preparation for
 * listening, not a way of choosing.
 */
const TARGET_PEAK = 0.34;

const audition = join(root, '.audition');
const cacheDir = join(audition, 'cache');
const audioDir = join(audition, 'audio');
const manifestPath = join(audition, 'candidates.json');

/* ------------------------------------------------------------------------- */

if (cleaning) {
  rmSync(audioDir, { recursive: true, force: true });
  rmSync(manifestPath, { force: true });
  console.log('Removed the built audition audio. The upstream cache is kept.');
  process.exit(0);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** One archive per category, opened at most once and only if something has to be built. */
const archives = new Map();
async function archiveFor(category) {
  if (!archives.has(category)) {
    const parts = ARCHIVES[category];
    if (parts === undefined) throw new Error(`no archive pinned for category ${category}`);
    const zip = new RemoteZip(parts.map(([name, size]) => ({ url: `${RELEASE_BASE}/${name}`, size })));
    await zip.open();
    archives.set(category, zip);
  }
  return archives.get(category);
}

/**
 * One upstream recording, from the cache or from the network.
 *
 * Keyed by the upstream path with the slashes flattened, so a cached file can be traced back to
 * exactly what it came from by reading its name.
 */
async function upstreamBytes(category, path) {
  const key = `${path.replaceAll(/[/\\:*?"<>|]/gu, '__')}`;
  const cached = join(cacheDir, key);
  if (existsSync(cached)) return { bytes: readFileSync(cached), fromCache: true };

  const archive = await archiveFor(category);
  const bytes = await archive.extract(path);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, bytes);
  return { bytes, fromCache: false };
}

/**
 * The SFZ mapping for a preset, from the repository at the pinned commit.
 *
 * **Not from the release archives** — they contain audio and a stray `.git` directory and no SFZ
 * at all, which is why the first version of this found none. The mappings live in `SFZ/` in the
 * repository, generated from the original EXS instruments, and about half the presets have one.
 *
 * The same pinned commit `prepare-jupiter4.mjs` reads its licence from, so this introduces no new
 * download path. Cached like everything else; a 404 is an answer and is cached as one.
 */
const SFZ_BASE =
  'https://raw.githubusercontent.com/publicsamples/Roland-Jupiter-4/64377f813341a10a57d26df9e10f548d43f166cd/SFZ';

async function sfzFor(preset) {
  const cached = join(cacheDir, `sfz__${preset.replaceAll(/[/\\:*?"<>|]/gu, '_')}.sfz`);
  if (existsSync(cached)) {
    const text = readFileSync(cached, 'utf8');
    return text === '' ? null : text;
  }

  const response = await fetch(`${SFZ_BASE}/${encodeURIComponent(preset)}.sfz`).catch(() => null);
  const text = response !== null && response.ok ? await response.text() : '';
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, text);
  return text === '' ? null : text;
}

/**
 * The SFZ mapping's loop points for one recording, in frames.
 *
 * `exs2sfz` writes one region per key with the sample's filename on it, so the region is found by
 * filename rather than by key — the filenames carry a four-letter suffix in some presets and the
 * key alone would match the wrong line.
 *
 * Read to corroborate the AIFF's own `INST`/`MARK` chunks, and used on its own where the AIFF has
 * none. Both are upstream's metadata; neither is invented here.
 */
function sfzLoopFor(sfzText, sampleFile) {
  if (sfzText === null) return null;

  for (const line of sfzText.split('\n')) {
    if (!line.includes(sampleFile)) continue;
    const start = /loop_start=(\d+)/u.exec(line);
    const end = /loop_end=(\d+)/u.exec(line);
    if (start === null || end === null) return null;

    const from = Number(start[1]);
    const to = Number(end[1]);
    return to > from ? { start: from, end: to } : null;
  }

  return null;
}

/* ------------------------------------------------------------------------- */

console.log('\nThe Jupiter-4 audition bench.');
console.log(`Roots ${ROOTS.join(' ')} — at most ${String(MAX_SHIFT_SEMITONES)} semitones of shift.\n`);

const wanted = CANDIDATES.filter((candidate) => onlyRole === null || candidate.role === onlyRole);
const manifest = {
  upstream: RELEASE_BASE,
  roots: ROOTS,
  maxShiftSemitones: MAX_SHIFT_SEMITONES,
  targetPeak: TARGET_PEAK,
  fadeSeconds: FADE_SECONDS,
  variants: VARIANTS,
  preparedBy: 'scripts/prepare-audition.mjs',
  candidates: [],
};

/* Anything already built and still wanted is kept, so a --role run does not lose the others. */
if (existsSync(manifestPath) && !force) {
  try {
    const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.candidates = (previous.candidates ?? []).filter(
      (entry) => !wanted.some((candidate) => candidate.id === entry.id),
    );
  } catch {
    // Nothing worth keeping.
  }
}

let networkBefore = 0;
let built = 0;
let reused = 0;

for (const candidate of wanted) {
  const outFor = (variant, rootMidi) => join(audioDir, candidate.id, `${variant}-${String(rootMidi)}.wav`);

  const variants = VARIANTS_FOR[candidate.role] ?? ['trim'];
  const entry = {
    ...candidate,
    upstreamCategory: candidate.category,
    roots: ROOTS,
    maxShiftSemitones: MAX_SHIFT_SEMITONES,
    variants: {},
  };

  /*
   * The SFZ, if this preset has one.
   *
   * Cheap: it is a few kilobytes and it is the only thing that can corroborate a loop. Absent for
   * many presets, which is not a fault — the AIFF chunks are upstream's own metadata too.
   */
  const presetName = candidate.folder
    .split('/')
    .pop()
    .replace(/-SAMPLES$/u, '');
  const sfzText = (await sfzFor(presetName)) ?? (await sfzFor(candidate.preset));
  entry.sfz = sfzText === null ? null : `SFZ/${presetName}.sfz`;

  /* Which sampled keys this preset has, and the nearest one to each root we want. */
  const archive = await archiveFor(candidate.category);
  const available = [...archive.entries.keys()]
    .filter((name) => name.startsWith(`${candidate.folder}/`) && /\.aif$/iu.test(name))
    .map((name) => ({ name, key: Number((/-(\d+)-127/u.exec(name) ?? [])[1]) }))
    .filter((file) => Number.isFinite(file.key));

  if (available.length === 0) {
    console.log(`  ${candidate.id.padEnd(19)} SKIPPED — no chromatic AIFFs under ${candidate.folder}`);
    continue;
  }

  console.log(`${candidate.id.padEnd(19)} ${candidate.preset} — ${candidate.category}`);

  /* Read every root once, then write each variant from the same decoded audio. */
  const sources = [];
  for (const rootMidi of ROOTS) {
    const chosen = [...available].sort((a, b) => Math.abs(a.key - rootMidi) - Math.abs(b.key - rootMidi))[0];

    const { bytes, fromCache } = await upstreamBytes(candidate.category, chosen.name);
    if (fromCache) reused += 1;
    else built += 1;

    const aiff = readAiff(bytes);
    const mono = toMono(aiff.data);
    const sfzLoop = sfzLoopFor(sfzText, chosen.name.split('/').pop());

    /*
     * The loop, and whether to believe it.
     *
     * The AIFF's own `INST`/`MARK` chunks are the primary source. Where the SFZ also declares one
     * and they agree within a frame or two, that is corroboration; where they disagree by more,
     * the loop is recorded as disputed and no loop variant is built from it. Frame indices survive
     * the conversion untouched — mono averaging and 24-to-16-bit change values, not positions —
     * so nothing has to be translated as long as the sample rate is unchanged, which it is.
     */
    /*
     * Which loop to believe, when there are two.
     *
     * The AIFF chunks and the SFZ mapping are both upstream's own. Where both exist and agree
     * within a few frames, that is corroboration. Where both exist and disagree, the loop is
     * recorded as disputed and no loop variant is built — a wrong loop point is a click on every
     * pass, which is exactly the artefact this is meant to avoid. Where only one exists, it is
     * used: one piece of real metadata beats none, and neither is being invented.
     */
    const aiffLoop = aiff.loop;
    const agrees =
      aiffLoop !== null &&
      sfzLoop !== null &&
      Math.abs(aiffLoop.start - sfzLoop.start) <= 64 &&
      Math.abs(aiffLoop.end - sfzLoop.end) <= 64;

    const loop = aiffLoop ?? sfzLoop;
    const disputed = aiffLoop !== null && sfzLoop !== null && !agrees;

    sources.push({
      rootMidi,
      sourceKey: chosen.key,
      path: chosen.name,
      sha256: sha256(bytes),
      bytes: bytes.length,
      sampleRate: aiff.sampleRate,
      bits: aiff.bits,
      channels: aiff.channels,
      frames: aiff.frames,
      mono,
      aiffLoop,
      sfzLoop,
      loop: disputed ? null : loop,
      loopSource: disputed ? 'disputed' : aiffLoop !== null ? 'aiff' : sfzLoop !== null ? 'sfz' : 'none',
      loopAgrees: aiffLoop !== null && sfzLoop !== null ? agrees : null,
    });
  }

  /* One working gain for the whole candidate, from its loudest root, exactly as production does. */
  let loudest = 0;
  for (const source of sources) {
    for (const value of source.mono) loudest = Math.max(loudest, Math.abs(value));
  }
  entry.sourcePeak = Number(loudest.toFixed(5));
  entry.gain = loudest > 0 ? Number((TARGET_PEAK / loudest).toFixed(4)) : 1;

  for (const variant of variants) {
    const shape = VARIANTS[variant];
    const samples = [];
    let missingLoop = false;

    for (const source of sources) {
      const { mono, sampleRate } = source;

      /* How much of the recording this variant keeps. */
      let keep;
      let loopSeconds = null;

      if (shape.loop) {
        if (source.loop === null) {
          missingLoop = true;
          break;
        }
        /*
         * Everything up to the loop end, plus a tenth of a second so the loop is comfortably
         * inside the buffer. Nothing beyond it is needed: the source never plays past loop end.
         */
        keep = Math.min(mono.length, source.loop.end + Math.round(0.1 * sampleRate));
        loopSeconds = {
          start: Number((source.loop.start / sampleRate).toFixed(6)),
          end: Number((source.loop.end / sampleRate).toFixed(6)),
        };
      } else {
        keep = Math.min(mono.length, Math.round(shape.seconds * sampleRate));
      }

      const trimmed = mono.slice(0, keep);

      /*
       * The fade at the cut, on the non-looping variants only.
       *
       * A looped buffer must not be faded: the fade would land inside the loop region and be heard
       * on every pass, which is precisely the cycling artefact the brief forbids.
       */
      if (!shape.loop) {
        const fadeFrames = Math.round(FADE_SECONDS * sampleRate);
        for (let index = 0; index < Math.min(fadeFrames, keep); index += 1) {
          trimmed[keep - 1 - index] *= index / fadeFrames;
        }
      }

      const wav = writeWav(trimmed, sampleRate);
      const path = outFor(variant, source.rootMidi);
      if (force || !existsSync(path)) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, wav);
      }

      let peak = 0;
      for (const value of trimmed) peak = Math.max(peak, Math.abs(value));

      samples.push({
        file: `${candidate.id}/${variant}-${String(source.rootMidi)}.wav`,
        rootMidi: source.rootMidi,
        sourceKey: source.sourceKey,
        upstreamPath: source.path,
        upstreamSha256: source.sha256,
        upstreamBytes: source.bytes,
        sourceChannels: source.channels,
        sourceBits: source.bits,
        sourceFrames: source.frames,
        sampleRate: source.sampleRate,
        frames: keep,
        seconds: Number((keep / source.sampleRate).toFixed(3)),
        peak: Number(peak.toFixed(5)),
        bytes: wav.length,
        sha256: sha256(wav),
        loop: loopSeconds,
        loopFrames: shape.loop ? source.loop : null,
        loopSource: shape.loop ? source.loopSource : null,
        loopCorroboratedBySfz: shape.loop ? source.loopAgrees : null,
      });
    }

    if (missingLoop) {
      entry.variants[variant] = {
        available: false,
        why:
          'no reliable loop metadata: upstream declares none, or its AIFF chunks and its SFZ ' +
          'mapping disagree. No loop is invented to make this patch sustain.',
      };
      console.log(`   ${variant.padEnd(8)} — not built: no reliable loop metadata`);
      continue;
    }

    const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);
    entry.variants[variant] = {
      available: true,
      loops: shape.loop,
      seconds: shape.seconds,
      bytes: totalBytes,
      samples,
    };

    console.log(
      `   ${variant.padEnd(8)} ${String(samples.length)} roots  ` +
        `${(totalBytes / 1024).toFixed(0).padStart(5)} KB  ` +
        `${samples[0].seconds.toFixed(2)}s each  ` +
        `${shape.loop ? `loop ${String(samples[0].loop.start.toFixed(2))}–${String(samples[0].loop.end.toFixed(2))}s` : 'natural decay'}`,
    );
  }

  manifest.candidates.push(entry);
  console.log('');
}

/* Sorted back into shortlist order, so a --role run does not scramble the bench. */
const order = new Map(CANDIDATES.map((candidate, index) => [candidate.id, index]));
manifest.candidates.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

mkdirSync(audition, { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const networkBytes = [...archives.values()].reduce((sum, zip) => sum + zip.bytesRead, networkBefore);
const onDisk = existsSync(audioDir)
  ? readdirSync(audioDir, { recursive: true })
      .map((name) => join(audioDir, String(name)))
      .filter((path) => path.endsWith('.wav'))
  : [];

console.log('═'.repeat(78));
console.log(`Candidates: ${String(manifest.candidates.length)}`);
console.log(`Files:      ${String(onDisk.length)}`);
console.log(
  `Network:    ${(networkBytes / 1048576).toFixed(1)} MB  (${String(built)} fetched, ${String(reused)} from cache)`,
);
console.log(`Manifest:   ${manifestPath}`);
console.log('\nNothing here is committed. Run `npm run dev` and open /aplbeats/audition.html.');
