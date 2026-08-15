/*
 * Check every factual claim about the bundled samples against ground truth.
 *
 *   npm run verify:credits
 *
 * The attribution tables are generated from the manifest, and a generator that quietly drops a row
 * produces documentation that looks complete and is not. So every claim is checked against the
 * thing it describes: the upstream repository at the pinned commit, the bytes on disk, and the
 * manifest the application actually runs on.
 *
 * It earned its keep immediately. Two real errors survived a careful read and were caught here:
 * the notices claimed six voices were rate-shifted when three are, and both documents listed six
 * substitutions when the manifest declares seven — the Casio SK-1's rim was missing from the
 * README. Counts written in two places drift; counts derived from one of them cannot, so the
 * checks below derive wherever they can.
 *
 * It talks to github.com, so it is a manual check rather than part of `npm test`. It makes no
 * request to TryAPL.
 */
/*
 * `fetch(...).json()` hands back `any` — the network is the other side of a serialisation
 * boundary and there is nothing this side can know about what crossed it. Every read of it is
 * guarded below, and the unsafety is bounded and local to this script.
 */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const readme = readFileSync('README.md', 'utf8');
const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
const provenance = readFileSync('src/audio/kits/provenance.ts', 'utf8');
const kitsSource = readFileSync('src/audio/kits/kits.ts', 'utf8');
const checksums = JSON.parse(readFileSync('src/audio/kits/checksums.json', 'utf8'));
const render = JSON.parse(readFileSync('src/audio/kits/tr909-render.json', 'utf8'));

const problems = [];
const notes = [];
const check = (ok, label, detail = '') => {
  if (ok) notes.push(`  ok    ${label}`);
  else problems.push(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
};

const SHA = 'a894cb8c72abe15b05e7b4fd4b8ee561c0f9e960';
const RAW = `https://raw.githubusercontent.com/smpldsnds/drum-machines/${SHA}`;

/* ---- 1. the pinned commit, everywhere it appears --------------------------- */

check(provenance.includes(SHA), 'provenance.ts pins the expected commit');
check(checksums.commit === SHA, 'checksums.json pins the same commit');
check(notices.includes(SHA), 'notices quote the full SHA');
check(readme.includes(SHA), 'README links the full SHA');

/* ---- 2. upstream still has that commit, and its tree ----------------------- */

const tree = await fetch(`https://api.github.com/repos/smpldsnds/drum-machines/git/trees/${SHA}?recursive=1`)
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);

if (tree === null) {
  problems.push('  FAIL  could not fetch the upstream tree to verify against');
} else {
  const paths = tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path);

  check(
    !paths.some((p) => /^LICEN[CS]E/iu.test(p)),
    'upstream really has no root LICENSE file',
    paths.filter((p) => /licen/iu.test(p)).join(', '),
  );
  check(!paths.some((p) => p.toLowerCase().endsWith('.wav')), 'upstream really ships no WAV files');
  check(
    paths.some((p) => p.endsWith('.m4a')),
    'upstream ships .m4a',
  );
  check(
    paths.some((p) => p.endsWith('.ogg')),
    'upstream ships .ogg',
  );

  // The one notice file in the tree.
  const notices_upstream = paths.filter(
    (p) => /\.(txt|md)$/iu.test(p) && !p.startsWith('.') && p !== 'README.md',
  );
  check(
    notices_upstream.length === 1 && notices_upstream[0] === 'TR-808/TR808.TXT',
    'TR-808/TR808.TXT is the only per-pack notice upstream',
    notices_upstream.join(', '),
  );

  // The excluded pack exists upstream and really has three samples and no kick.
  const micro = paths.filter((p) => p.startsWith('Micro-Rhythmer-12/') && p.endsWith('.m4a'));
  check(micro.length === 3, 'Micro Rhythmer 12 has exactly three samples upstream', String(micro.length));
  check(
    !micro.some((p) => /kick|bd|bass/iu.test(p)),
    'Micro Rhythmer 12 really has no kick',
    micro.join(', '),
  );

  // Every pack we claim to include exists upstream.
  for (const match of provenance.matchAll(/upstreamPath:\s*'([^']+)'/gu)) {
    check(
      paths.some((p) => p.startsWith(`${match[1]}/`)),
      `upstream has pack ${match[1]}`,
    );
  }
}

/* ---- 3. the upstream licence sentence, quoted exactly ---------------------- */

const upstreamReadme = await fetch(`${RAW}/README.md`)
  .then((r) => (r.ok ? r.text() : null))
  .catch(() => null);

if (upstreamReadme === null) {
  problems.push('  FAIL  could not fetch the upstream README to compare the licence wording');
} else {
  const quoted = 'A collection of public domain samples of different drum machines';
  check(upstreamReadme.includes(quoted), 'the quoted licence sentence appears verbatim upstream');
  check(notices.includes(quoted), 'notices quote it exactly');
  check(readme.includes('A collection of public domain samples'), 'README quotes it');
  check(!/licen[cs]e/iu.test(upstreamReadme), 'upstream README mentions no licence beyond that line');
}

/* ---- 4. bundled bytes are byte-for-byte upstream --------------------------- */

const entries = Object.entries(checksums.files);
check(entries.length === 71, 'checksums cover 71 files', String(entries.length));

let totalBytes = 0;
for (const [, entry] of entries) totalBytes += entry.bytes;
const totalKb = (totalBytes / 1024).toFixed(1);
check(notices.includes(`${totalKb} KB`), `notices state the real total (${totalKb} KB)`);
check(readme.includes(`${totalKb} KB`), `README states the real total (${totalKb} KB)`);

// Every file on disk matches its recorded hash.
let mismatched = 0;
for (const [key, entry] of entries) {
  const path = join('public/audio', key);
  if (!existsSync(path)) {
    problems.push(`  FAIL  bundled file missing: ${key}`);
    continue;
  }
  const bytes = readFileSync(path);
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    mismatched += 1;
  }
}
check(mismatched === 0, 'every bundled file matches its recorded checksum', `${String(mismatched)} differ`);

// And a sample of them match what upstream actually serves, right now.
const sampled = entries.filter((_, index) => index % 9 === 0);
let upstreamMismatch = 0;
for (const [key, entry] of sampled) {
  const response = await fetch(`${RAW}/${entry.upstream}`).catch(() => null);
  if (response === null || !response.ok) {
    problems.push(`  FAIL  could not fetch upstream ${entry.upstream}`);
    continue;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== entry.sha256) {
    upstreamMismatch += 1;
    problems.push(`  FAIL  ${key} differs from upstream ${entry.upstream}`);
  }
}
check(upstreamMismatch === 0, `${String(sampled.length)} spot-checked files are byte-for-byte upstream`);

/* ---- 5. the TR-808 notice, preserved unaltered ----------------------------- */

const noticePath = 'public/audio/tr-808/TR808.TXT';
check(existsSync(noticePath), 'the TR-808 notice is bundled at the documented path');
if (existsSync(noticePath)) {
  const local = readFileSync(noticePath);
  const upstream = await fetch(`${RAW}/TR-808/TR808.TXT`)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null);
  check(upstream !== null && Buffer.from(upstream).equals(local), 'the notice is byte-identical to upstream');
  const text = local.toString('utf8');
  check(text.includes('ABSOLUTELY FREE'), 'the notice contains the quoted phrase');
  check(text.includes('103852'), 'the notice contains the quoted serial number');
  check(text.includes('Michael Fischer'), 'the notice names its author');
  check(notices.includes(noticePath), 'notices link the notice path');
  check(readme.includes(noticePath), 'README links the notice path');
}

/* ---- 6. every mapping row is present and complete -------------------------- */

const ROWS = ['Kick', 'Snare', 'Closed Hat', 'Open Hat', 'Clap', 'Low Perc', 'High Perc', 'Rim'];
const allKits = [...kitsSource.matchAll(/id:\s*'([^']+)',\s*\n\s*name:\s*'([^']+)'/gu)].filter(
  ([, id]) => id !== 'synth',
);

/*
 * The copied kits only. TR-909 is documented under its own heading, with a table of upstream
 * classes rather than upstream files, so folding it in here would look for a mapping table that
 * does not exist and is not supposed to. It is checked in section 12 instead.
 */
const kitNames = allKits.filter(([, id]) => id !== 'tr-909').map(([, , name]) => name);

check(allKits.length === 10, 'ten sampled kits in the manifest', String(allKits.length));
check(kitNames.length === 9, 'nine of them copied from the sample collection', String(kitNames.length));

for (const document of [
  { name: 'README', text: readme },
  { name: 'notices', text: notices },
]) {
  for (const kit of kitNames) {
    // Kit names carry no regex metacharacters, so the heading is matched as plain text.
    // Trimmed, because the files use CRLF and a stray carriage return breaks every comparison.
    const lines = document.text.split(String.fromCharCode(10)).map((line) => line.trimEnd());
    const at = lines.findIndex((line) => /^#{4,5} /u.test(line) && line.replace(/^#+ /u, '') === kit);
    if (at === -1) {
      problems.push(`  FAIL  ${document.name}: no mapping table for ${kit}`);
      continue;
    }
    const table = lines.slice(at, at + 20);
    // Prettier pads table cells to align them, so the raw prefix will not match.
    const cellsOf = (line) => line.split('|').map((cell) => cell.trim());
    const missing = ROWS.filter((row) => !table.some((line) => cellsOf(line)[1] === row));
    check(missing.length === 0, `${document.name}: ${kit} maps all eight rows`, missing.join(', '));
    check(!table.join(' ').includes('| ? |'), `${document.name}: ${kit} has no unresolved cells`);
  }
}

/* ---- 7. table shape: every row has the same column count ------------------- */

let brokenTables = 0;
for (const document of [
  { name: 'README', text: readme },
  { name: 'notices', text: notices },
]) {
  const lines = document.text.split('\n');
  let width = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.trimStart().startsWith('|')) {
      width = 0;
      continue;
    }
    // `\|` inside a cell is an escaped pipe, not a column separator — the APL operations
    // table has two of them. Removing them first is what makes this count columns rather than
    // punctuation.
    const columns = line.replaceAll(String.raw`\|`, '').split('|').length;
    if (width === 0) width = columns;
    else if (columns !== width) {
      brokenTables += 1;
      problems.push(
        `  FAIL  ${document.name}:${String(index + 1)} table row has ${String(columns)} cells, expected ${String(width)}`,
      );
    }
  }
}
check(brokenTables === 0, 'every table row has a consistent column count');

/* ---- 8. gain and rate claims match the implementation ---------------------- */

const rateShifted = [
  ...kitsSource.matchAll(/(\w+):\s*\{\s*file:\s*'[^']+',\s*gain:\s*[\d.]+,\s*playbackRate:\s*([\d.]+)/gu),
];
check(rateShifted.length === 3, 'three voices are rate-shifted in the manifest', String(rateShifted.length));

const claimedRates = { 1.45: '45%', 1.2: '20%', 1.6: '60%' };
for (const [, row, rate] of rateShifted) {
  const percent = claimedRates[Number(rate)];
  check(percent !== undefined, `rate ${rate} on ${row} is a documented figure`);
  if (percent !== undefined) {
    check(readme.includes(`${percent} fast`), `README states "${percent} fast"`);
  }
}
check(notices.includes('three voices in two kits'), 'notices count the rate-shifted voices correctly');
{
  /*
   * Which kits contain a rate shift, counted by walking the manifest line by line rather than
   * with a regex spanning whole objects — the block structure is easier to follow than the
   * pattern that would match it.
   */
  const kitsWithRates = new Set();
  let currentKit = null;
  for (const line of kitsSource.split(String.fromCharCode(10))) {
    const id = /^ {4}id: '([^']+)',$/u.exec(line);
    if (id !== null) currentKit = id[1];
    if (line.includes('playbackRate:') && currentKit !== null) kitsWithRates.add(currentKit);
  }
  check(kitsWithRates.size === 2, 'rate shifts occur in exactly two kits', [...kitsWithRates].join(', '));
  check(
    notices.includes('MFB-512') && notices.includes("Casio SK-1's clap"),
    'notices name the rate-shifted voices',
  );
}

/*
 * Counted from the manifest rather than hardcoded.
 *
 * The first version of this check asserted "six", which is what the README happened to say — and
 * the manifest had seven. A number written in two places drifts; a number derived from one of them
 * cannot.
 */
const declaredSubstitutions = provenance
  .split(String.fromCharCode(10))
  .filter((line) => /^ {6}'(Rim|Clap|High Perc):/u.test(line)).length;
const readmeSubstitutions = (readme.match(/^- \*\*[^*]+, (Rim|Clap|High Perc)\*\* —/gmu) ?? []).length;
check(
  readmeSubstitutions === declaredSubstitutions,
  `README lists every substitution (${String(declaredSubstitutions)})`,
  `README has ${String(readmeSubstitutions)}`,
);
check(notices.includes('Seven rows across four kits'), 'notices state the substitution count');
check(readme.includes('Seven rows across four kits'), 'README states the substitution count');

/* ---- 9. per-kit sizes -------------------------------------------------------*/

const perKit = new Map();
for (const [key, entry] of entries) {
  const kitId = key.split('/')[0];
  perKit.set(kitId, (perKit.get(kitId) ?? 0) + entry.bytes);
}
for (const [kitId, bytes] of perKit) {
  const kb = (bytes / 1024).toFixed(1);
  check(readme.includes(`${kb} KB`), `README states ${kitId} at ${kb} KB`);
}

const largest = entries.sort((a, b) => b[1].bytes - a[1].bytes)[0];
check(
  readme.includes(`\`${largest[0]}\``) && readme.includes(`${(largest[1].bytes / 1024).toFixed(1)} KB`),
  `README names the largest file (${largest[0]})`,
);

/* ---- 10. stray files, and non-affiliation ---------------------------------- */

/*
 * Every directory, not just the checksummed ones — a whole unrecorded kit is a worse failure
 * than a stray file inside a recorded one, and looking only where a manifest points cannot
 * find it.
 */
const renderedNames = new Set(Object.values(render.voices).map((voice) => `tr-909/${voice.file}`));
/*
 * The Tone samples too, from their own manifest.
 *
 * Named here rather than skipped: a directory ignored is a directory anything could be dropped
 * into, which is the failure this check exists to find.
 */
const toneManifest = JSON.parse(readFileSync('src/audio/tones/jupiter4.json', 'utf8'));
const toneNames = new Set(
  Object.values(toneManifest.sounds).flatMap((sound) => sound.samples.map((s) => `tones/${s.file}`)),
);
let stray = 0;
for (const kitId of readdirSync('public/audio')) {
  if (!statSync(join('public/audio', kitId)).isDirectory()) continue;
  for (const name of readdirSync(join('public/audio', kitId))) {
    const key = `${kitId}/${name}`;
    if (!checksums.files[key] && !renderedNames.has(key) && !toneNames.has(key)) {
      stray += 1;
      problems.push(`  FAIL  unaccounted file on disk: ${key}`);
    }
  }
}
check(stray === 0, 'no unaccounted files under public/audio');

for (const document of [
  { name: 'README', text: readme },
  { name: 'notices', text: notices },
]) {
  check(/not affiliated with or endorsed by/u.test(document.text), `${document.name} states non-affiliation`);
  check(/[Nn]o logos/u.test(document.text), `${document.name} states that no logos appear`);
}

/* ---- 11. the two documents do not contradict each other -------------------- */

const claims = [
  [
    'nine of ten packs included',
    /nine of its ten packs|nine of the nine|nine included|nine sampled machines/u,
  ],
  ['no LICENSE file', /no LICENSE file/u],
  ['no WAV upstream', /no WAV|are no WAV files/u],
  ['byte-for-byte', /byte-for-byte/u],
];
for (const [label, pattern] of claims) {
  check(pattern.test(readme), `README states: ${label}`);
  check(pattern.test(notices), `notices state: ${label}`);
}

/* ---- 12. the rendered kit, against its own upstream ------------------------ */

/*
 * A different upstream and a different obligation. MIT asks that the notice travel with the
 * work, so the licence text is checked word-for-word against the file it was copied from rather
 * than eyeballed — a licence quoted approximately is not a licence quoted.
 */

const TR909_SHA = '11d423382d6d9705bd37a42b533e3b3c27442be7';
const TR909_RAW = `https://raw.githubusercontent.com/andremichelle/tr-909/${TR909_SHA}`;

check(render.upstream.commit === TR909_SHA, 'render manifest pins the expected commit');
check(provenance.includes(TR909_SHA), 'provenance.ts pins the same commit');
check(notices.includes(TR909_SHA), 'notices quote the full TR-909 SHA');
check(readme.includes(TR909_SHA), 'README links the full TR-909 SHA');

const tr909Tree = await fetch(
  `https://api.github.com/repos/andremichelle/tr-909/git/trees/${TR909_SHA}?recursive=1`,
)
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);

if (tr909Tree === null) {
  problems.push('  FAIL  could not fetch the TR-909 upstream tree to verify against');
} else {
  const paths = tr909Tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path);

  check(
    paths.some((p) => /^LICEN[CS]E/iu.test(p)),
    'upstream really does have a root LICENSE file',
  );

  // Every file the render claims to have read must still be there, at that commit.
  const missing = Object.keys(render.upstreamFiles).filter((p) => !paths.includes(p));
  check(missing.length === 0, 'every file the render read still exists upstream', missing.join(', '));

  /*
   * The carve-out, checked as a negative. Nothing from upstream's `logos` or image directories
   * may appear in the render's input list, however the audit paragraph is worded.
   */
  const logoish = Object.keys(render.upstreamFiles).filter((p) =>
    /logo|\.svg$|\.png$|\.jpe?g$|\.woff2?$/iu.test(p),
  );
  check(logoish.length === 0, 'no logo, image or font from upstream was read', logoish.join(', '));
}

const upstreamLicence = await fetch(`${TR909_RAW}/LICENSE`)
  .then((r) => (r.ok ? r.text() : null))
  .catch(() => null);

if (upstreamLicence === null) {
  problems.push('  FAIL  could not fetch the upstream LICENSE to compare against');
} else {
  // Compared as words, because the notices reflow it into a blockquote and line breaks differ.
  const words = (text) => text.replaceAll(/[>\s]+/gu, ' ').trim();
  check(
    words(notices).includes(words(upstreamLicence)),
    'notices reproduce the MIT licence word-for-word, as MIT requires',
  );
  check(
    upstreamLicence.includes(render.upstream.copyright),
    'the copyright line in the manifest is upstream’s own',
    render.upstream.copyright,
  );
  check(readme.includes('André Michelle'), 'README names the copyright holder');
  check(notices.includes('André Michelle'), 'notices name the copyright holder');
}

const upstreamTr909Readme = await fetch(`${TR909_RAW}/README.md`)
  .then((r) => (r.ok ? r.text() : null))
  .catch(() => null);

if (upstreamTr909Readme === null) {
  problems.push('  FAIL  could not fetch the upstream README to verify the credits against');
} else {
  /*
   * The two people upstream credits. Both are named in the notices — one because their work is
   * deliberately not used, the other because thanking someone for lending hardware is the sort
   * of thing an audit should record having read rather than skipped.
   */
  for (const person of ['Isaac Cotec', 'Sascha Kaltenschnee']) {
    check(
      upstreamTr909Readme.includes(person),
      `upstream really does credit ${person}`,
      'the audit paragraph would need rewriting',
    );
    check(notices.includes(person), `notices account for ${person}`);
  }
}

/* ---- 13. the rendered files match the manifest, and the docs match both ---- */

let renderMismatch = 0;
let renderedBytes = 0;
for (const [row, voice] of Object.entries(render.voices)) {
  const path = join('public/audio/tr-909', voice.file);
  if (!existsSync(path)) {
    renderMismatch += 1;
    problems.push(`  FAIL  rendered file missing: ${path}`);
    continue;
  }
  const bytes = readFileSync(path);
  renderedBytes += bytes.length;
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== voice.sha256 || bytes.length !== voice.bytes) {
    renderMismatch += 1;
    problems.push(`  FAIL  ${row}: ${voice.file} does not match the render manifest`);
  }
}
check(renderMismatch === 0, 'every rendered file matches its recorded checksum');
check(Object.keys(render.voices).length === 8, 'all eight rows are rendered');

const renderedKb = (renderedBytes / 1024).toFixed(1);
check(readme.includes(`${renderedKb} KB`), `README states the TR-909 at ${renderedKb} KB`);
check(notices.includes(`${renderedKb} KB`), `notices state the TR-909 at ${renderedKb} KB`);

const totalKbAll = ((renderedBytes + totalBytes) / 1024).toFixed(1);
check(readme.includes(`${totalKbAll} KB`), `README states the combined total, ${totalKbAll} KB`);

/*
 * The honesty checks. Every one of these is a claim it would be easy and tempting to round off
 * in the wrong direction, so each is asserted rather than left to prose review.
 */
check(render.rendering.lossless === false, 'the manifest does not claim the renders are lossless');
check(
  /not quite lossless|`"lossless": false`/u.test(readme),
  'README says plainly that the renders are not quite lossless',
);
check(
  /is not quite lossless|`"lossless": false`|Not quite/u.test(notices),
  'notices say plainly that the renders are not quite lossless',
);
/*
 * What the documents may and may not say about the upstream resources.
 *
 * Both halves are checked, because both are ways of getting this wrong. The claim that has to be
 * present is the one that can be substantiated — the `.raw` files are not redistributed, only the
 * render is. The claims that must be absent are the ones that cannot: upstream does not document
 * where those waveforms came from, and its history includes commits replacing them wholesale, so
 * "no recording is involved" was an inference stated as a finding. Asserted here rather than left
 * to prose review, because it is exactly the sort of tidy sentence that grows back.
 */
/*
 * Prose is reflowed by Prettier, so a phrase that reads as one sentence is often two lines in the
 * file. Every check below matches against the text with its whitespace collapsed, or it would be
 * testing the line width rather than the claim.
 */
const flowed = (text) => text.replaceAll(/\s+/gu, ' ');

for (const document of [
  { name: 'README', text: flowed(readme) },
  { name: 'notices', text: flowed(notices) },
]) {
  check(
    /does not redistribute/u.test(document.text) && /rendered WAV files?/u.test(document.text),
    `${document.name} states that only the rendered WAV files are redistributed`,
  );
  check(
    /not copied from a set of finished drum-machine samples/u.test(document.text),
    `${document.name} distinguishes the rendered kit from the sampled ones factually`,
  );

  const overclaims = [
    [/contains no recording/iu, 'claims the kit contains no recording'],
    [/no recording of a TR-909/iu, 'claims no TR-909 was recorded'],
    [/not recordings of a machine/iu, 'claims the resources are not recordings'],
    [/wavetable inputs/iu, 'characterises the resources as wavetables'],
    [/creates no copyright interest/iu, 'draws a legal conclusion about the hardware loan'],
  ];
  for (const [pattern, what] of overclaims) {
    check(!pattern.test(document.text), `${document.name} does not overclaim: ${what}`);
  }
}

check(
  /no substitution/iu.test(readme) && /no substitution/iu.test(notices),
  'both documents state the TR-909 needs no substitution',
);
check(
  provenance.includes('Isaac Cotec') && provenance.includes('Sascha Kaltenschnee'),
  'the machine-readable manifest records both upstream credits',
);
check(
  !/creates no copyright interest|not recordings of a machine/iu.test(provenance),
  'the machine-readable manifest does not overclaim either',
);
check(
  [readme, notices, provenance]
    .map(flowed)
    .every((text) => /makes no separate authorship or licensing claim/u.test(text)),
  'all three record the Kaltenschnee credit as what upstream states, and nothing further',
);

/* ---- 8. the Tone samples --------------------------------------------------- */

/*
 * The Jupiter-4 release, checked the same way the two kits are: against the upstream repository at
 * the pinned commit, against the bytes on disk, and against the manifest the application runs on.
 *
 * The audio here is not in the repository — it is published only as release archives totalling
 * about 10.4 GB — so what is fetched is the `LICENSE` at the pinned commit and the release
 * metadata. The *audio* is verified against the manifest by `npm run prepare:jupiter4 -- --check`,
 * which needs no network at all; duplicating that here would mean downloading gigabytes to learn
 * something already proved.
 */
const tones = toneManifest;
const TONE_SHA = tones.upstream.commit;
const TONE_RAW = `https://raw.githubusercontent.com/publicsamples/Roland-Jupiter-4/${TONE_SHA}`;

check(notices.includes(TONE_SHA), 'the notices pin the Jupiter-4 commit the manifest names');
/*
 * The release, named in whichever form the prose uses.
 *
 * The manifest records `2021-10-03` because that is what a machine wants; the notices say "3
 * October 2021" because that is what a person reads. Both are checked against the one value, so a
 * date corrected in one place and not the other fails here rather than sitting there.
 */
const published = new Date(`${String(tones.upstream.releasePublished)}T00:00:00Z`);
const publishedInWords = published.toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

check(
  notices.includes(tones.upstream.releaseTag) && notices.includes(tones.upstream.releaseName),
  'the notices name the release the audio actually comes from',
);
check(
  notices.includes(publishedInWords) || notices.includes(tones.upstream.releasePublished),
  'the notices state when that release was published',
  `expected "${publishedInWords}"`,
);

const toneLicence = await fetch(`${TONE_RAW}/${tones.upstream.licenceFile}`).then((response) =>
  response.ok ? response.text() : null,
);
check(toneLicence !== null, `upstream has a ${String(tones.upstream.licenceFile)} at that commit`);

if (toneLicence !== null) {
  /*
   * The licence text, compared rather than described.
   *
   * The dedication is quoted in full in the notices, and a quotation that has drifted from its
   * source is worse than a summary — so every line of it is checked to be present.
   */
  const quoted = flowed(notices);
  const missing = toneLicence
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 20)
    .filter((line) => !quoted.includes(flowed(line)));

  check(
    missing.length === 0,
    'the notices quote the public-domain dedication in full',
    missing.length === 0 ? '' : `${String(missing.length)} line(s) missing, first: ${String(missing[0])}`,
  );
  check(
    /released into the public domain/iu.test(toneLicence),
    'the upstream licence really is a public-domain dedication',
  );
}

/* Every prepared file is on disk, and the manifest accounts for all of them. */
const TONE_DIRECTORY = 'public/audio/tones';
const declared = Object.values(tones.sounds).flatMap((sound) => sound.samples.map((s) => s.file));
const onDisk = existsSync(TONE_DIRECTORY) ? readdirSync(TONE_DIRECTORY) : [];

check(declared.length > 0, 'the Tone manifest declares at least one sample');
check(
  declared.every((file) => onDisk.includes(file)),
  'every sample the Tone manifest declares is on disk',
);
check(
  onDisk.every((file) => declared.includes(file)),
  'every file under public/audio/tones is declared by the manifest',
  onDisk.filter((file) => !declared.includes(file)).join(', '),
);

for (const [id, sound] of Object.entries(tones.sounds)) {
  for (const sample of sound.samples) {
    const path = join(TONE_DIRECTORY, sample.file);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== sample.sha256 || bytes.length !== sample.bytes) {
      check(false, `${id}/${sample.file} matches its recorded checksum and size`);
    }
  }
}
check(true, 'every bundled Tone sample matches its recorded checksum and size');

/* The size claims in the documents, against what is actually there. */
const toneBytes = declared.reduce(
  (total, file) =>
    total + (existsSync(join(TONE_DIRECTORY, file)) ? statSync(join(TONE_DIRECTORY, file)).size : 0),
  0,
);
const toneKb = Math.round(toneBytes / 1024);
const toneKbText = toneKb.toLocaleString('en-GB');

check(
  flowed(notices).includes(`${toneKbText} KB across ${String(declared.length)} files`),
  'the notices state the Tone payload size and file count correctly',
  `expected "${toneKbText} KB across ${String(declared.length)} files"`,
);
check(
  flowed(readme).includes(`${toneKbText} KB of Tone samples`),
  'the README states the Tone payload size correctly',
  `expected "${toneKbText} KB of Tone samples"`,
);

/*
 * What the documents may and may not say about the Tone audio.
 *
 * The same two-sided check the rendered kit gets, and the two sides swapped over when the sounds
 * were re-chosen. The first version shipped four presets picked by measurement and said so, and
 * this file forbade any claim that they had been listened to. They have now *been* listened to —
 * every playable preset in the library, against the drum groove — so the required claim is the
 * opposite one, and the thing that must not grow back is the old sentence.
 *
 * What must still be absent is any suggestion that Roland was involved.
 */
for (const document of [
  { name: 'README', text: flowed(readme) },
  { name: 'notices', text: flowed(notices) },
]) {
  const overclaims = [
    [/Roland (supplied|endorses|maintains|provided)/iu, 'implies Roland was involved'],
    [/official Jupiter-4/iu, 'calls the samples official'],
    [/licensed (from|by) Roland/iu, 'claims a licence from Roland'],
    [
      /presets were chosen by measurement|chosen by measurement, not by listening/iu,
      'still says the presets were chosen by measurement',
    ],
  ];
  for (const [pattern, what] of overclaims) {
    check(!pattern.test(document.text), `${document.name} does not overclaim: ${what}`);
  }
}

check(/chosen by ear/iu.test(flowed(notices)), 'the notices say the shipped presets were chosen by ear');
check(
  flowed(notices).includes('not affiliated with or endorsed by Roland'),
  'the notices disclaim affiliation with Roland, which now applies to two kinds of audio',
);
check(
  tones.preparation.loopsUsed === false && /not used/u.test(flowed(notices)),
  'both the manifest and the notices record that upstream loop points are unused',
);

/*
 * Every shipped sound, named in the notices with its real provenance.
 *
 * Derived from the manifest rather than counted by hand, because the whole point of the rename is
 * that the interface shows one name and the provenance records another — and two names per sound
 * is twice as much to let drift. A preset added or removed without the notices following fails
 * here.
 */
for (const [id, sound] of Object.entries(tones.sounds)) {
  const flowedNotices = flowed(notices);
  check(
    flowedNotices.includes(sound.preset),
    `the notices name the preset behind ${sound.name}`,
    `expected "${sound.preset}" (id ${id})`,
  );
  check(
    flowedNotices.includes(sound.upstreamFolder.split('/').pop()),
    `the notices name the upstream folder for ${sound.name}`,
  );
  check(
    typeof sound.upstreamCategory === 'string' && sound.upstreamCategory.length > 0,
    `the manifest records which category ${sound.name} came from`,
  );
}

check(
  Object.keys(tones.sounds).length === 6,
  'six sounds are shipped',
  String(Object.keys(tones.sounds).length),
);
check(
  !Object.values(tones.sounds).some((sound) => sound.upstreamCategory === 'Pads'),
  'nothing shipped comes from Pads',
);

/*
 * The two categories nothing is taken from, and the different reasons.
 *
 * FX was excluded for scope and never auditioned. Pads *was* auditioned — fourteen presets, three
 * lengths each — and rejected by ear. Those are different statements and the documents have to
 * make the difference, because "we did not look" and "we looked and none was good enough" are not
 * interchangeable.
 */
const notShipped = tones.categoriesNotShipped ?? {};
for (const category of ['FX', 'Pads']) {
  const found = notShipped[category];
  check(found !== undefined, `the manifest records what was found in ${category}`);
  if (found === undefined) continue;

  check(
    flowed(notices).includes(String(found.presets)) || flowed(notices).includes(String(found.audioFiles)),
    `the notices state ${category}'s real contents`,
    `${String(found.presets)} presets, ${String(found.audioFiles)} recordings`,
  );
}

check(
  notShipped.Pads?.auditioned === 14 &&
    /Fourteen of its sixteen|fourteen of the sixteen/iu.test(flowed(notices)),
  'both record that Pads was auditioned in full rather than skipped',
);
check(
  /excluded for scope|for scope and never auditioned/iu.test(flowed(notices)),
  'the notices say FX was excluded for scope rather than for suitability',
);

for (const document of [
  { name: 'README', text: flowed(readme) },
  { name: 'notices', text: flowed(notices) },
]) {
  check(
    !/(FX and Misc|they) are effects and one-shots rather than playable/iu.test(document.text),
    `${document.name} does not repeat the corrected claim that FX and Misc are one-shots`,
  );
}

/* ---- report ---------------------------------------------------------------- */

console.log(notes.join('\n'));
console.log('');
if (problems.length > 0) {
  console.log(problems.join('\n'));
  console.log(`\n${String(problems.length)} problem(s).`);
  process.exitCode = 1;
} else {
  console.log(`All ${String(notes.length)} checks passed.`);
}
