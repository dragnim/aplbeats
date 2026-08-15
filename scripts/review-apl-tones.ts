/*
 * The Tone recipes and transforms, on the page, before anybody hears them.
 *
 * The same tool as `review-apl-generators.ts` and for the same reason: the tests can prove a
 * melody is sixteen numbers in the right range, and no test can tell you it is a tune. This
 * prints what each recipe and each transform actually produces so that a person can look at it,
 * and it does that **locally** — the APL is evaluated by a small reference interpreter in this
 * file, not by TryAPL, so reviewing costs no requests at all.
 *
 * The reference implementations here are never used in production and are not a fallback. They
 * exist so this review can run offline and so `tests/unit/toneGenerators.test.ts` can assert what
 * each expression is supposed to mean. `npm run verify:apl-tones-live` is what proves the real
 * APL agrees, and that is the one that spends requests.
 *
 *   npm run review:apl-tones                 every recipe, five seeds each
 *   npm run review:apl-tones -- --seeds 12   more seeds
 *   npm run review:apl-tones -- --scale dorian --root 62
 */

import {
  DEFAULT_ROOT,
  TONE_RECIPES,
  TONE_SCALES,
  toneScaleById,
  type ToneRecipe,
  type ToneScale,
} from '../src/apl/toneGenerators';
import { TONE_OPERATIONS, buildToneCore } from '../src/apl/toneOperations';
import { generatePhrase, applyToneOperation } from '../src/apl/toneReference';
import { noteName, noteCount, REST, type Phrase } from '../src/tones/phrase';

const args = process.argv.slice(2);

function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
}

const seedCount = Number(option('seeds', '5'));
const scale: ToneScale = toneScaleById(option('scale', 'minor-pentatonic'));
const root = Number(option('root', String(DEFAULT_ROOT)));

/** A melody as sixteen columns of note names, so its shape is visible at a glance. */
function strip(phrase: Phrase): string {
  return phrase.map((value) => (value === REST ? '  ·' : noteName(value).padStart(3))).join(' ');
}

/** The same melody as a picture, one row per semitone band. Reading the contour is the point. */
function contour(phrase: Phrase): string[] {
  const sounding = phrase.filter((value) => value !== REST);
  if (sounding.length === 0) return ['(silence)'];

  const low = Math.min(...sounding);
  const high = Math.max(...sounding);
  const rows = Math.max(1, Math.min(8, high - low + 1));

  const lines: string[] = [];
  for (let row = rows - 1; row >= 0; row -= 1) {
    const band = phrase.map((value) => {
      if (value === REST) return '   ';
      const at = high === low ? 0 : Math.round(((value - low) / (high - low)) * (rows - 1));
      return at === row ? ' ██' : '   ';
    });
    lines.push(`  ${band.join(' ')}`);
  }
  return lines;
}

console.log(`Scale: ${scale.name} (${scale.degrees.join(' ')})   Root: ${noteName(root)}\n`);

for (const recipe of TONE_RECIPES satisfies readonly ToneRecipe[]) {
  console.log(`━━ ${recipe.name} ${'━'.repeat(Math.max(0, 66 - recipe.name.length))}`);
  console.log(`   ${recipe.blurb}`);
  console.log(`   ${recipe.core(root, scale)}\n`);

  for (let index = 0; index < seedCount; index += 1) {
    const seed = 1000 + index * 7919;
    const phrase = generatePhrase(recipe, root, scale, seed);
    console.log(`  seed ${String(seed).padEnd(7)} ${String(noteCount(phrase)).padStart(2)} notes`);
    console.log(`  ${strip(phrase)}`);
    for (const line of contour(phrase)) console.log(line);
    console.log('');
  }
}

console.log(`━━ Transforms ${'━'.repeat(56)}`);
const subject = generatePhrase(TONE_RECIPES[1]!, root, scale, 4711);
console.log(`  before    ${strip(subject)}\n`);

for (const operation of TONE_OPERATIONS) {
  const parameters = { amount: operation.parameters[0]?.defaultValue ?? 0 };
  const after = applyToneOperation(operation, parameters, subject);
  console.log(`  ${operation.name.padEnd(10)}${strip(after)}`);
  console.log(`  ${' '.repeat(10)}${buildToneCore(operation, parameters)}\n`);
}

console.log(`Scales available: ${TONE_SCALES.map((entry) => entry.id).join(', ')}`);
