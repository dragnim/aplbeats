/*
 * Prove the Tone expressions really work, in real Dyalog APL.
 *
 *   npm run verify:apl-tones-live
 *   npm run verify:apl-tones-live -- --dry-run     print the requests, send nothing
 *
 * Two requests. Not one per recipe and not one per seed: everything the recipes need proving
 * about goes in one request and everything the transforms need goes in the other, because each
 * answer is a single line of sixteen numbers and a dozen of them fit comfortably in one reply.
 *
 * What the first request establishes:
 *
 *   every recipe's expression runs at all, on the real service, under a seeded ⎕RL — which
 *   includes the thing that had not been tested before Stage 8: **indexing a vector by a vector
 *   of seeded indices**, `s[?16⍴5]`, and reshape-cycling, `16⍴`;
 *   every answer is sixteen whole numbers, each a rest or a pitch this instrument can play;
 *   the same seed gives the same melody, twice in one session;
 *   a different seed gives a different melody, so the seed is not decoration.
 *
 * And the second:
 *
 *   each transform runs and returns sixteen valid values;
 *   each agrees exactly with its TypeScript reference implementation — which is a stronger claim
 *   than the recipes can make, because the transforms contain no randomness, so agreement is
 *   exact rather than structural.
 *
 * Everything sent is built by the production source builders and read by the production parser.
 * The only thing this file adds is the comparing. `review:apl-tones` is where the *music* is
 * judged, locally and for nothing; this is where the mechanism is proved, live and sparingly.
 *
 * Never run by CI. The count is printed every time.
 */

import { TryAplClient, AplError } from '@/apl/client';
import { DIAMOND } from '@/apl/wire';
import { buildToneGenerateSource, TONE_RECIPES, toneScaleById, DEFAULT_ROOT } from '@/apl/toneGenerators';
import { buildToneSource, TONE_OPERATIONS } from '@/apl/toneOperations';
import { applyToneOperation } from '@/apl/toneReference';
import { noteName, openingPhrase, parseAplPhrase, phrasesEqual, REST, type Phrase } from '@/tones/phrase';

const dryRun = process.argv.includes('--dry-run');

/** Fixed, so two runs are comparable. */
const SEED = 47291;
const OTHER = 123456;

const scale = toneScaleById('minor-pentatonic');
const client = new TryAplClient();
let requests = 0;

const notes: string[] = [];
const failures: string[] = [];

const show = (phrase: Phrase): string =>
  phrase.map((value) => (value === REST ? '  ·' : noteName(value).padStart(3))).join(' ');

/* ---- the recipes ----------------------------------------------------------- */

/*
 * Three generations per recipe in one request: the seed, the same seed again, and another seed.
 *
 * Built by concatenating complete production requests. Each sets ⎕IO and ⎕RL for itself, so they
 * compose without any of them knowing the others exist — and every statement sent is one the
 * application would have sent on its own.
 */
const generations = TONE_RECIPES.flatMap((recipe) => [
  { recipe, label: `${recipe.name} @ ${String(SEED)}`, seed: SEED },
  { recipe, label: `${recipe.name} @ ${String(SEED)} again`, seed: SEED },
  { recipe, label: `${recipe.name} @ ${String(OTHER)}`, seed: OTHER },
]);

const generateSource = generations
  .map(({ recipe, seed }) => buildToneGenerateSource({ recipe, root: DEFAULT_ROOT, scale, seed }).expression)
  .join(` ${DIAMOND} `);

console.log(`${'─'.repeat(76)}\nRecipes\n${'─'.repeat(76)}`);
for (const recipe of TONE_RECIPES) {
  console.log(`${recipe.name.padEnd(8)} ${recipe.core(DEFAULT_ROOT, scale)}`);
}
console.log(`\nsource (${String([...generateSource].length)} code points):\n${generateSource}\n`);

if (!dryRun) {
  requests += 1;
  let lines: readonly string[] = [];
  try {
    ({ outputLines: lines } = await client.execute(generateSource));
  } catch (error) {
    if (error instanceof AplError) {
      failures.push(`APL refused the recipes: ${error.message}`);
      for (const line of error.aplLines) failures.push(`  ${line}`);
    } else throw error;
  }

  const printed = lines.map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
  if (printed.length !== generations.length) {
    failures.push(
      `expected ${String(generations.length)} lines of output, received ${String(printed.length)}`,
    );
  } else {
    const parsed = printed.map((line) => parseAplPhrase([line]));

    for (const [index, result] of parsed.entries()) {
      const label = generations[index]?.label ?? '';
      if (!result.ok) failures.push(`${label}: ${result.reason}`);
      else console.log(`  ${label.padEnd(28)} ${show(result.phrase)}`);
    }

    if (failures.length === 0) {
      notes.push('every recipe returned sixteen whole numbers, each a rest or a playable pitch');

      for (const [index, recipe] of TONE_RECIPES.entries()) {
        const at = index * 3;
        const [first, again, other] = [parsed[at], parsed[at + 1], parsed[at + 2]];
        if (!first?.ok || !again?.ok || !other?.ok) continue;

        if (phrasesEqual(first.phrase, again.phrase)) {
          notes.push(`${recipe.name}: the same seed gave the same melody, twice in one session`);
        } else {
          failures.push(`${recipe.name}: the same seed gave two different melodies`);
        }

        if (phrasesEqual(first.phrase, other.phrase)) {
          failures.push(`${recipe.name}: a different seed gave the same melody — the seed does nothing`);
        } else {
          notes.push(`${recipe.name}: a different seed gave a different melody`);
        }
      }
    }
  }
}

/* ---- the transforms -------------------------------------------------------- */

const subject = openingPhrase();
const transforms = TONE_OPERATIONS.map((operation) => ({
  operation,
  parameters: { amount: operation.parameters[0]?.defaultValue ?? 0 },
}));

const transformSource = transforms
  .map(({ operation, parameters }) => buildToneSource({ operation, parameters, phrase: subject }).expression)
  .join(` ${DIAMOND} `);

console.log(`\n${'─'.repeat(76)}\nTransforms\n${'─'.repeat(76)}`);
console.log(`before   ${show(subject)}`);
console.log(`\nsource (${String([...transformSource].length)} code points):\n${transformSource}\n`);

if (!dryRun) {
  requests += 1;
  let lines: readonly string[] = [];
  try {
    ({ outputLines: lines } = await client.execute(transformSource));
  } catch (error) {
    if (error instanceof AplError) {
      failures.push(`APL refused the transforms: ${error.message}`);
      for (const line of error.aplLines) failures.push(`  ${line}`);
    } else throw error;
  }

  const printed = lines.map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
  if (printed.length !== transforms.length) {
    failures.push(
      `expected ${String(transforms.length)} lines of output, received ${String(printed.length)}`,
    );
  } else {
    for (const [index, line] of printed.entries()) {
      const entry = transforms[index];
      if (entry === undefined) continue;

      const result = parseAplPhrase([line]);
      if (!result.ok) {
        failures.push(`${entry.operation.name}: ${result.reason}`);
        continue;
      }

      console.log(`  ${entry.operation.name.padEnd(10)} ${show(result.phrase)}`);

      const expected = applyToneOperation(entry.operation, entry.parameters, subject);
      if (phrasesEqual(result.phrase, expected)) {
        notes.push(`${entry.operation.name}: real APL and the reference implementation agree exactly`);
      } else {
        failures.push(
          `${entry.operation.name}: APL and the reference disagree\n    APL       ${show(
            result.phrase,
          )}\n    reference ${show(expected)}`,
        );
      }
    }
  }
}

/* ---- report ---------------------------------------------------------------- */

console.log(`\n${'='.repeat(76)}`);
for (const note of notes) console.log(`  ok    ${note}`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);

console.log(`\nLive TryAPL requests used: ${String(requests)}`);
if (failures.length > 0) {
  console.log(`${String(failures.length)} failure(s).`);
  process.exitCode = 1;
} else if (!dryRun) {
  console.log('Every Tone recipe and transform works in real Dyalog APL.');
}
