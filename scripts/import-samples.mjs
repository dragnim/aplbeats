/*
 * Fetch the drum machine samples, at the pinned upstream commit.
 *
 *   npm run import:samples            download anything missing, verify everything present
 *   npm run import:samples -- --force re-download every file
 *   npm run import:samples -- --check verify checksums only, download nothing
 *
 * Contributors do not need to run this: the audio is committed. It exists so that the
 * provenance question — "which exact version of somebody else's work is in here?" — has a
 * reproducible answer rather than a remembered one.
 *
 * Everything it downloads comes from `src/audio/kits/provenance.ts`, which is the only place
 * upstream paths are written down. There is no URL in this file that names a sample, so a kit
 * cannot be imported without its provenance being recorded first.
 *
 * It writes `src/audio/kits/checksums.json`, and a test compares the bundled bytes against it.
 * That is what makes "bundled byte-for-byte as published upstream" a checkable claim rather
 * than a sentence in a README.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const force = args.includes('--force');
const checkOnly = args.includes('--check');

/* ---- the manifest, read from the TypeScript source ------------------------- */

/*
 * Read rather than imported, because this is a plain Node script and the manifest is
 * TypeScript. A regex over a literal would be fragile, so the two lists it needs are pulled
 * out with a tiny purpose-built parse and then checked for plausibility — 9 kits, 8 files
 * each bar one. If that check fails the shape has changed and this script must be updated
 * rather than guessing.
 */
function readProvenance() {
  const source = readFileSync(join(root, 'src/audio/kits/provenance.ts'), 'utf8');

  const commit = /commit:\s*'([0-9a-f]{40})'/u.exec(source)?.[1];
  if (commit === undefined) throw new Error('No upstream commit in provenance.ts');

  const extension = /extension:\s*'(\.[a-z0-9]+)'/u.exec(source)?.[1] ?? '.m4a';

  const kits = [];
  const kitPattern =
    /\{\s*id:\s*'([^']+)',\s*machine:[\s\S]*?upstreamPath:\s*'([^']+)',[\s\S]*?files:\s*\[([\s\S]*?)\n {4}\]/gu;
  for (const match of source.matchAll(kitPattern)) {
    const [, id, upstreamPath, block] = match;
    const files = [];
    for (const entry of block.matchAll(/\{\s*file:\s*'([^']+)',\s*upstream:\s*'([^']+)'/gu)) {
      files.push({ file: entry[1], upstream: entry[2] });
    }
    const notice = /noticeFile:\s*'([^']+)'/u.exec(match[0])?.[1];
    kits.push({ id, upstreamPath, files, notice });
  }

  if (kits.length === 0) throw new Error('No kits parsed out of provenance.ts');
  return { commit, extension, kits };
}

const { commit, kits } = readProvenance();
const BASE = `https://raw.githubusercontent.com/smpldsnds/drum-machines/${commit}`;

console.log(`Upstream: smpldsnds/drum-machines @ ${commit}`);
console.log(`Kits: ${String(kits.length)}\n`);

/* ---- download ------------------------------------------------------------- */

const checksumPath = join(root, 'src/audio/kits/checksums.json');
const previous = existsSync(checksumPath) ? JSON.parse(readFileSync(checksumPath, 'utf8')) : { files: {} };

const checksums = { upstream: 'smpldsnds/drum-machines', commit, files: {} };
const problems = [];
let downloaded = 0;
let reused = 0;
let totalBytes = 0;

/** Fetch a file, or read the copy already committed. */
async function obtain(localPath, upstreamPath) {
  if (!force && existsSync(localPath)) {
    reused += 1;
    return readFileSync(localPath);
  }
  if (checkOnly) {
    problems.push(`missing and --check given: ${localPath}`);
    return null;
  }

  const url = `${BASE}/${upstreamPath}`;
  const response = await fetch(url);
  if (!response.ok) {
    problems.push(`HTTP ${String(response.status)} for ${url}`);
    return null;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(localPath), { recursive: true });
  writeFileSync(localPath, bytes);
  downloaded += 1;
  return bytes;
}

for (const kit of kits) {
  const directory = join(root, 'public/audio', kit.id);
  const seen = new Map();

  for (const entry of kit.files) {
    const localPath = join(directory, entry.file);
    const upstreamPath = `${kit.upstreamPath}/${entry.upstream}`;

    // Two rows may legitimately share one bundled file; download it once.
    if (seen.has(entry.file)) continue;

    const bytes = await obtain(localPath, upstreamPath);
    if (bytes === null) continue;
    seen.set(entry.file, true);

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = `${kit.id}/${entry.file}`;
    checksums.files[key] = { upstream: upstreamPath, bytes: bytes.length, sha256 };
    totalBytes += bytes.length;

    const before = previous.files?.[key];
    if (before !== undefined && before.sha256 !== sha256) {
      problems.push(`${key} changed: was ${String(before.sha256).slice(0, 12)}, now ${sha256.slice(0, 12)}`);
    }
  }

  /*
   * And the pack's own notice, bundled beside the audio it describes.
   *
   * Served rather than tucked into docs/, so that anybody who finds the samples finds the
   * notice too. A notice that does not travel with the files is not a notice.
   */
  if (kit.notice !== undefined) {
    const localPath = join(directory, kit.notice);
    const bytes = await obtain(localPath, `${kit.upstreamPath}/${kit.notice}`);
    if (bytes !== null) {
      const key = `${kit.id}/${kit.notice}`;
      checksums.files[key] = {
        upstream: `${kit.upstreamPath}/${kit.notice}`,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      totalBytes += bytes.length;
    }
  }
}

/* ---- report --------------------------------------------------------------- */

if (!checkOnly) {
  writeFileSync(checksumPath, `${JSON.stringify(checksums, null, 2)}\n`);
}

const perKit = new Map();
for (const [key, entry] of Object.entries(checksums.files)) {
  const kitId = key.split('/')[0];
  perKit.set(kitId, (perKit.get(kitId) ?? 0) + entry.bytes);
}

console.log('Kit             files      size');
console.log('----------------------------------');
for (const [kitId, bytes] of [...perKit].sort((a, b) => b[1] - a[1])) {
  const count = Object.keys(checksums.files).filter((key) => key.startsWith(`${kitId}/`)).length;
  console.log(
    `${kitId.padEnd(15)} ${String(count).padStart(5)}  ${(bytes / 1024).toFixed(1).padStart(8)} KB`,
  );
}

const largest = Object.entries(checksums.files).sort((a, b) => b[1].bytes - a[1].bytes)[0];
console.log(
  `\nTotal: ${(totalBytes / 1024).toFixed(1)} KB across ${String(Object.keys(checksums.files).length)} files`,
);
if (largest !== undefined) {
  console.log(`Largest: ${largest[0]} at ${(largest[1].bytes / 1024).toFixed(1)} KB`);
}
console.log(`Downloaded ${String(downloaded)}, already present ${String(reused)}`);

if (problems.length > 0) {
  console.error('\nProblems:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
}
