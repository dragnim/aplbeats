/*
 * Look at a lot of generated bars at once.
 *
 * Judging a generator one Randomise press at a time is hopeless: you cannot tell
 * whether a preset has collapsed, whether one track dominates every result, or whether
 * two seeds are quietly producing the same bar, because you never see enough of them
 * together. This prints them together.
 *
 *   npm run review:patterns                     every preset, 12 seeds each
 *   npm run review:patterns -- --seeds 24       more of them
 *   npm run review:patterns -- --preset broken  one preset, in full
 *   npm run review:patterns -- --sweep density  one preset across a macro's range
 *   npm run review:patterns -- --summary        statistics only, no grids
 *   npm run review:patterns -- --plateau        how wide Density's dead zones are
 *
 * There is deliberately no score. Every number here is a count or a ratio, and what
 * they are for is making bars comparable so that a person can look at forty of them and
 * see what is wrong. A generator that optimised a number would produce bars that scored
 * well, which is not the same thing as bars worth listening to.
 */

import { GENERATOR_VERSION, generatePattern } from '@/generation/generator';
import { measurePattern, renderPattern, summarise } from '@/generation/metrics';
import { PRESETS, presetById, type PresetId } from '@/generation/presets';
import { patternDistance } from '@/generation/metrics';
import type { Pattern } from '@/pattern/pattern';
import { TRACKS } from '@/pattern/tracks';

interface Settings {
  density: number;
  complexity: number;
  syncopation: number;
}

const DEFAULTS: Settings = { density: 48, complexity: 42, syncopation: 34 };

/** Seeds chosen by a fixed stride so a review is repeatable between runs. */
function seedsFor(count: number): number[] {
  return Array.from({ length: count }, (_unused, index) => 1000 + index * 7919);
}

function parseArgs(argv: readonly string[]) {
  const options = {
    seeds: 12,
    preset: undefined as PresetId | undefined,
    sweep: undefined as keyof Settings | undefined,
    summary: false,
    plateau: false,
    settings: { ...DEFAULTS },
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg ?? '') {
      case '--seeds':
        options.seeds = Number(value) || 12;
        i += 1;
        break;
      case '--preset':
        options.preset = value as PresetId;
        i += 1;
        break;
      case '--sweep':
        options.sweep = value as keyof Settings;
        i += 1;
        break;
      case '--summary':
        options.summary = true;
        break;
      case '--plateau':
        options.plateau = true;
        break;
      case '--density':
      case '--complexity':
      case '--syncopation':
        options.settings[(arg ?? '').slice(2) as keyof Settings] = Number(value) || 0;
        i += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function build(seed: number, preset: PresetId, settings: Settings): Pattern {
  return generatePattern({ seed, preset, ...settings });
}

/** Every bar for one preset, printed in full with its statistics. */
function reviewPreset(preset: PresetId, seeds: readonly number[], settings: Settings, summary: boolean) {
  const definition = presetById(preset);
  const patterns = seeds.map((seed) => ({ seed, pattern: build(seed, preset, settings) }));

  console.log('');
  console.log('='.repeat(78));
  console.log(`${definition.name}  —  ${definition.blurb}`);
  console.log(
    `strategy ${definition.strategy}   density ${String(settings.density)}   ` +
      `complexity ${String(settings.complexity)}   syncopation ${String(settings.syncopation)}`,
  );
  console.log('='.repeat(78));

  if (!summary) {
    for (const { seed, pattern } of patterns) {
      console.log('');
      console.log(`Seed ${String(seed)}   ${summarise(pattern)}`);
      for (const line of renderPattern(pattern)) console.log(`  ${line}`);
    }
  }

  reportCollapse(definition.name, patterns);
}

/**
 * The failure modes worth catching automatically.
 *
 * Not quality — these are the ways a generator goes wrong that are tedious to spot by
 * eye across two dozen bars and obvious once counted: identical outputs, a track that
 * never appears, a track that appears in everything, and a trigger count that never
 * moves.
 */
function reportCollapse(name: string, patterns: readonly { seed: number; pattern: Pattern }[]) {
  const metrics = patterns.map(({ pattern }) => measurePattern(pattern));
  const triggers = metrics.map((m) => m.triggers);

  const fingerprints = new Set(patterns.map(({ pattern }) => JSON.stringify(pattern)));
  const duplicates = patterns.length - fingerprints.size;

  let closestPair = 1;
  for (let i = 0; i < patterns.length; i += 1) {
    for (let j = i + 1; j < patterns.length; j += 1) {
      const a = patterns[i];
      const b = patterns[j];
      if (a === undefined || b === undefined) continue;
      closestPair = Math.min(closestPair, patternDistance(a.pattern, b.pattern));
    }
  }

  const silentTracks: string[] = [];
  const constantTracks: string[] = [];
  TRACKS.forEach((track, index) => {
    const counts = metrics.map((m) => m.perTrack[index] ?? 0);
    if (counts.every((count) => count === 0)) silentTracks.push(track.name);
    else if (new Set(counts).size === 1) constantTracks.push(`${track.name}=${String(counts[0])}`);
  });

  const mean = triggers.reduce((total, value) => total + value, 0) / Math.max(1, triggers.length);
  const similarity = metrics.reduce((total, m) => total + m.selfSimilarity, 0) / Math.max(1, metrics.length);
  const offbeat = metrics.reduce((total, m) => total + m.offbeatShare, 0) / Math.max(1, metrics.length);
  const stacks = metrics.reduce((total, m) => total + m.maxStack, 0) / Math.max(1, metrics.length);

  console.log('');
  console.log(`  ${name}: ${String(patterns.length)} seeds`);
  console.log(
    `    triggers ${String(Math.min(...triggers))}–${String(Math.max(...triggers))} (mean ${mean.toFixed(1)})` +
      `   repeat ${similarity.toFixed(2)}   offbeat share ${offbeat.toFixed(2)}   mean max-stack ${stacks.toFixed(1)}`,
  );
  console.log(`    closest pair differs by ${(closestPair * 100).toFixed(1)}% of cells`);

  if (duplicates > 0) console.log(`    ** ${String(duplicates)} duplicate pattern(s)`);
  if (silentTracks.length > 0) console.log(`    ** never fires: ${silentTracks.join(', ')}`);
  if (constantTracks.length > 0)
    console.log(`    ** identical count every seed: ${constantTracks.join(', ')}`);
  if (closestPair < 0.03) console.log('    ** two seeds are nearly the same bar');
}

/**
 * How many consecutive Density values produce the identical bar.
 *
 * Event counts are integers, so a control with a hundred positions must repeat itself
 * somewhere — but it should be a few points, not a tenth of the travel. Measured on the
 * whole pattern rather than the trigger count, because a count that holds while the
 * arrangement moves is not a dead zone.
 *
 * This found the fault it exists to guard against: rounding counts to nearest gave a
 * median plateau of ten density points and a worst of thirteen.
 */
function plateauReport(preset: PresetId, settings: Settings) {
  const widths: number[] = [];

  for (let index = 0; index < 60; index += 1) {
    const seed = 977 * (index + 1);
    let previous = '';
    let run = 0;
    let worst = 0;
    for (let density = 20; density <= 95; density += 1) {
      const fingerprint = JSON.stringify(build(seed, preset, { ...settings, density }));
      run = fingerprint === previous ? run + 1 : 0;
      worst = Math.max(worst, run);
      previous = fingerprint;
    }
    widths.push(worst + 1);
  }

  widths.sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] ?? 0;
  console.log(
    `  ${presetById(preset).name.padEnd(14)} median ${String(median).padStart(2)}  ` +
      `worst ${String(widths[widths.length - 1]).padStart(2)}  best ${String(widths[0]).padStart(2)}`,
  );
}

/** One preset across a macro's whole range, to see the control actually working. */
function sweep(preset: PresetId, macro: keyof Settings, seeds: readonly number[], settings: Settings) {
  const definition = presetById(preset);
  console.log('');
  console.log(`${definition.name}: ${macro} sweep over ${String(seeds.length)} seeds`);
  console.log('  value   triggers  on-beat  offbeat  16ths  repeat  max-stack');

  for (const value of [0, 15, 30, 45, 60, 75, 90, 100]) {
    const patterns = seeds.map((seed) => build(seed, preset, { ...settings, [macro]: value }));
    const metrics = patterns.map(measurePattern);
    const mean = (pick: (m: (typeof metrics)[number]) => number) =>
      metrics.reduce((total, m) => total + pick(m), 0) / metrics.length;

    console.log(
      `  ${String(value).padStart(5)}   ${mean((m) => m.triggers)
        .toFixed(1)
        .padStart(8)}  ` +
        `${mean((m) => m.onBeat)
          .toFixed(1)
          .padStart(7)}  ${mean((m) => m.offbeat)
          .toFixed(1)
          .padStart(7)}  ` +
        `${mean((m) => m.sixteenth)
          .toFixed(1)
          .padStart(5)}  ${mean((m) => m.selfSimilarity)
          .toFixed(2)
          .padStart(6)}  ` +
        `${mean((m) => m.maxStack)
          .toFixed(1)
          .padStart(9)}`,
    );
  }
}

/* ------------------------------------------------------------------------- */

const options = parseArgs(process.argv.slice(2));
const seeds = seedsFor(options.seeds);

console.log(`APL Beats generator v${String(GENERATOR_VERSION)} — ${String(seeds.length)} seeds`);

if (options.plateau) {
  console.log('');
  console.log('Widest run of identical patterns across Density, over 60 seeds:');
  for (const preset of options.preset === undefined ? PRESETS.map((p) => p.id) : [options.preset]) {
    plateauReport(preset, options.settings);
  }
} else if (options.sweep !== undefined) {
  for (const preset of options.preset === undefined ? PRESETS.map((p) => p.id) : [options.preset]) {
    sweep(preset, options.sweep, seeds, options.settings);
  }
} else {
  for (const preset of options.preset === undefined ? PRESETS.map((p) => p.id) : [options.preset]) {
    reviewPreset(preset, seeds, options.settings, options.summary);
  }
}
