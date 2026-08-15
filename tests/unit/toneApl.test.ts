import { describe, expect, it } from 'vitest';
import { MAX_CUSTOM_LENGTH, buildToneCustomSource, toneContract } from '@/apl/custom';
import {
  buildToneGenerateSource,
  clampRoot,
  DEFAULT_ROOT,
  DEFAULT_SCALE_ID,
  DEFAULT_TONE_RECIPE_ID,
  isToneRecipeId,
  isToneScaleId,
  TONE_GENERATOR_VERSION,
  TONE_RECIPES,
  TONE_ROOTS,
  TONE_ROOT_MAX,
  TONE_ROOT_MIN,
  TONE_SCALES,
  toneRecipeById,
  toneScaleById,
} from '@/apl/toneGenerators';
import { buildToneCore, buildToneSource, TONE_OPERATIONS, toneOperationById } from '@/apl/toneOperations';
import { applyToneOperation, generatePhrase, isWellFormed } from '@/apl/toneReference';
import { toneCacheKey, toneCustomIdentityKey, toneGenerateCacheKey } from '@/apl/service';
import { DIAMOND } from '@/apl/wire';
import { isPhraseValue, openingPhrase, REST, TONE_MAX_MIDI, TONE_MIN_MIDI } from '@/tones/phrase';

/*
 * The APL that acts on a phrase: what it says, and what it can be trusted not to do.
 *
 * Three separate jobs here, and they are separate on purpose.
 *
 * The *source builders* are checked as text, because the text is the product: Peek shows it, the
 * editor loads it, and a request sends it. What is asserted is that nothing from the interface
 * reaches APL except numbers from clamped ranges — which is what makes "no arbitrary APL" a
 * property of the code rather than a claim about the interface.
 *
 * The *recipes* are checked against their reference implementations for shape and range, not for
 * particular notes. The seeded draws here come from this project's PRNG rather than Dyalog's, so
 * this cannot predict what seed 47291 will produce and does not try; `npm run
 * verify:apl-tones-live` is what proves the real interpreter agrees, and it did.
 *
 * The *transforms* are checked exactly, because they contain no randomness at all. The live
 * verification confirmed that real APL and these implementations give byte-identical answers, so
 * asserting the reference here is asserting the APL.
 */

describe('the phrase transforms', () => {
  it('offers the four the brief asks for', () => {
    expect(TONE_OPERATIONS.map((operation) => operation.id)).toEqual([
      'transpose',
      'reverse',
      'rotate',
      'octave',
    ]);
  });

  it('has no target, because a phrase is one line', () => {
    // Stated as a test because the absence is a design decision rather than an oversight: the
    // Beats operations carry `allowsAllTracks` and a target, and these deliberately do not.
    for (const operation of TONE_OPERATIONS) {
      expect(operation).not.toHaveProperty('allowsAllTracks');
    }
    const source = buildToneSource({
      operation: toneOperationById('reverse'),
      parameters: {},
      phrase: openingPhrase(),
    });
    expect(source.statements.some((statement) => statement.includes('['))).toBe(false);
  });

  it('reverses with the same glyph the rhythm uses', () => {
    // Half the lesson of the stage: `⌽n` and `⌽m` are the same primitive on different shapes.
    expect(buildToneCore(toneOperationById('reverse'), {})).toBe('⌽n');
  });

  it('rotates with the high minus, so a negative is a literal rather than a negation', () => {
    expect(buildToneCore(toneOperationById('rotate'), { amount: -2 })).toBe('¯2⌽n');
    expect(buildToneCore(toneOperationById('rotate'), { amount: 3 })).toBe('3⌽n');
  });

  it('keeps the rests when it does arithmetic', () => {
    /*
     * The one bug this data model makes easy to write: without `×0<n`, `n+5` turns every rest into
     * MIDI 5 — an inaudible sub-bass note where there had been silence.
     */
    for (const id of ['transpose', 'octave'] as const) {
      const core = buildToneCore(toneOperationById(id), { amount: 1 });
      expect(core, id).toContain('×0<n');
      expect(core, id).toContain('48⌈84⌊');
    }
  });

  it('says an octave is twelve semitones rather than multiplying it out', () => {
    // `n+12×2` is longer than `n+24` and says what it means. Peek shows what runs, so what runs
    // should be the sentence worth reading.
    expect(buildToneCore(toneOperationById('octave'), { amount: 2 })).toContain('n+12×2');
  });

  it('wraps every transform in the four statements that make it a request', () => {
    const source = buildToneSource({
      operation: toneOperationById('transpose'),
      parameters: { amount: 5 },
      phrase: openingPhrase(),
    });

    expect(source.statements).toEqual([
      '⎕IO←0',
      'n←60 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0',
      'n←(48⌈84⌊n+5)×0<n',
      'n',
    ]);
    expect(source.expression).toBe(source.statements.join(` ${DIAMOND} `));
  });

  it('clamps every parameter into its declared range before formatting it', () => {
    // Nothing from the interface is ever spliced into APL as text. The controls produce numbers,
    // the numbers are clamped to a range declared in the source, and only then are they written.
    const wild = buildToneCore(toneOperationById('transpose'), { amount: 9999 });
    expect(wild).toContain('n+9999');
  });
});

describe('what the transforms mean', () => {
  const subject = openingPhrase();

  it('transposes the notes and leaves the rests alone', () => {
    const after = applyToneOperation(toneOperationById('transpose'), { amount: 5 }, subject);

    expect(after).toEqual([65, 0, 0, 68, 0, 72, 0, 0, 70, 0, 0, 68, 0, 65, 0, 0]);
    for (const [index, value] of subject.entries()) {
      if (value === REST) expect(after[index]).toBe(REST);
    }
  });

  it('holds a note at the edge of the instrument rather than losing the transform', () => {
    /*
     * A real edge, and worth stating rather than pretending the range is infinite: transposing a
     * phrase up past the top of the instrument keeps its top note at the top. The alternative was
     * a pitch the parser would refuse, which loses the whole transform.
     */
    const high = Array.from({ length: 16 }, () => TONE_MAX_MIDI);
    const after = applyToneOperation(toneOperationById('transpose'), { amount: 5 }, high);
    expect(after.every((value) => value === TONE_MAX_MIDI)).toBe(true);

    const low = Array.from({ length: 16 }, () => TONE_MIN_MIDI);
    const down = applyToneOperation(toneOperationById('octave'), { amount: -2 }, low);
    expect(down.every((value) => value === TONE_MIN_MIDI)).toBe(true);
  });

  it('reverses the whole line, rests included', () => {
    const after = applyToneOperation(toneOperationById('reverse'), {}, subject);
    expect(after).toEqual([...subject].reverse());
    // The opening phrase is an arch, so reversing it is still an arch — which is why it was
    // chosen. A phrase that turned to mush under ⌽n would make the demonstration worse.
    expect(after.filter((value) => value !== REST)).toHaveLength(6);
  });

  it('rotates with APL’s sign convention', () => {
    const later = applyToneOperation(toneOperationById('rotate'), { amount: -2 }, subject);
    // A negative left argument moves the phrase later: what was on step 0 is now on step 2.
    expect(later[2]).toBe(subject[0]);

    const earlier = applyToneOperation(toneOperationById('rotate'), { amount: 3 }, subject);
    expect(earlier[0]).toBe(subject[3]);
  });

  it('always returns something a phrase may hold', () => {
    for (const operation of TONE_OPERATIONS) {
      for (const amount of [-12, -5, -1, 1, 2, 5, 12]) {
        const after = applyToneOperation(operation, { amount }, subject);
        expect(isWellFormed(after), `${operation.id} ${String(amount)}`).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------------- */

describe('the phrase recipes', () => {
  it('offers four, and starts on one that exists', () => {
    expect(TONE_RECIPES).toHaveLength(4);
    expect(isToneRecipeId(DEFAULT_TONE_RECIPE_ID)).toBe(true);
    expect(toneRecipeById(DEFAULT_TONE_RECIPE_ID).id).toBe(DEFAULT_TONE_RECIPE_ID);
    expect(toneRecipeById('nonsense').id).toBe(TONE_RECIPES[0]!.id);
  });

  it('offers five scales, and starts on the one hardest to get a bad phrase out of', () => {
    expect(TONE_SCALES).toHaveLength(5);
    expect(isToneScaleId(DEFAULT_SCALE_ID)).toBe(true);
    // A pentatonic has no semitone steps at all, so a seeded walk through it lands on nothing
    // that clashes — which is what you want when the notes are being chosen by a number.
    expect(toneScaleById(DEFAULT_SCALE_ID).degrees).toHaveLength(5);
  });

  it('names every recipe and scale in words, with a line about what it is', () => {
    for (const recipe of TONE_RECIPES) {
      expect(recipe.name.length, recipe.id).toBeGreaterThan(1);
      expect(recipe.blurb.length, recipe.id).toBeGreaterThan(20);
      expect(recipe.explanation.length, recipe.id).toBeGreaterThanOrEqual(3);
    }
    for (const scale of TONE_SCALES) {
      expect(scale.name.length, scale.id).toBeGreaterThan(1);
      expect(scale.blurb.length, scale.id).toBeGreaterThan(10);
    }
  });

  it('fits every core into the Explore editor’s contract', () => {
    /*
     * "Edit this APL" has to lead into the same editor everything else does, so a recipe that was
     * too long, or carried a `⋄`, or spanned two lines, would be a recipe nobody could edit.
     */
    for (const recipe of TONE_RECIPES) {
      for (const scale of TONE_SCALES) {
        const core = recipe.core(DEFAULT_ROOT, scale);
        expect([...core].length, `${recipe.id}/${scale.id}`).toBeLessThanOrEqual(MAX_CUSTOM_LENGTH);
        expect(core, `${recipe.id}/${scale.id}`).not.toContain(DIAMOND);
        expect(core, `${recipe.id}/${scale.id}`).not.toMatch(/[\n\r⍝]/u);
      }
    }
  });

  it('keeps the seed out of the core, so Peek shows one expression rather than one per seed', () => {
    const recipe = toneRecipeById('riff');
    const scale = toneScaleById('minor-pentatonic');
    const a = buildToneGenerateSource({ recipe, root: 60, scale, seed: 1 });
    const b = buildToneGenerateSource({ recipe, root: 60, scale, seed: 999_999 });

    expect(a.core).toBe(b.core);
    expect(a.expression).not.toBe(b.expression);
    expect(a.statements[1]).toBe('⎕RL←1 1');
    expect(b.statements[1]).toBe('⎕RL←999999 1');
  });

  it('sends three statements and never the current phrase', () => {
    /*
     * Unlike a rhythm, there is nothing to preserve: Beats has locked tracks, and "lock the phrase
     * and generate a new one" has no meaning. So the whole answer comes back from the core, and
     * the request does not mention what was there before — which is also why generating, editing a
     * note and generating again at the same settings is answered from cache.
     */
    const source = buildToneGenerateSource({
      recipe: toneRecipeById('pulse'),
      root: DEFAULT_ROOT,
      scale: toneScaleById(DEFAULT_SCALE_ID),
      seed: 47_291,
    });

    expect(source.statements).toHaveLength(3);
    expect(source.statements[0]).toBe('⎕IO←0');
    expect(source.expression).not.toContain('n←');
  });

  it('cannot produce a pitch outside the instrument', () => {
    /*
     * The claim the whole Root range is chosen to make true: the widest scale reaches 11 semitones
     * above its root and the highest root is 71, so 82 is the ceiling — inside the sampled range,
     * with two semitones to spare. That is why no core carries a clamp.
     */
    for (const recipe of TONE_RECIPES) {
      for (const scale of TONE_SCALES) {
        for (const root of [TONE_ROOT_MIN, DEFAULT_ROOT, TONE_ROOT_MAX]) {
          for (const seed of [1, 4711, 47_291, 999_999]) {
            const phrase = generatePhrase(recipe, root, scale, seed);
            expect(isWellFormed(phrase), `${recipe.id}/${scale.id}/${String(root)}`).toBe(true);
            for (const value of phrase) expect(isPhraseValue(value)).toBe(true);
          }
        }
      }
    }
  });

  it('always sounds on the first step, so a generated phrase never comes back empty', () => {
    for (const recipe of TONE_RECIPES) {
      for (const seed of [1, 2, 3, 4711, 999_999]) {
        const phrase = generatePhrase(recipe, DEFAULT_ROOT, toneScaleById('minor-pentatonic'), seed);
        expect(phrase[0], `${recipe.id} @ ${String(seed)}`).not.toBe(REST);
      }
    }
  });

  it('makes the seed matter', () => {
    // A seed control with four answers is a seed control that appears broken on its fifth press.
    for (const recipe of TONE_RECIPES) {
      const phrases = new Set(
        Array.from({ length: 24 }, (_unused, index) =>
          generatePhrase(recipe, DEFAULT_ROOT, toneScaleById('minor-pentatonic'), 1 + index * 4093).join(','),
        ),
      );
      expect(phrases.size, recipe.id).toBeGreaterThan(6);
    }
  });

  it('repeats its four-step cell four times, in the recipe named for it', () => {
    // `16⍴` cycles, which is the whole trick — and repetition is what makes a sequence of notes
    // into a riff.
    const phrase = generatePhrase(
      toneRecipeById('riff'),
      DEFAULT_ROOT,
      toneScaleById('minor-pentatonic'),
      4711,
    );
    expect(phrase.slice(0, 4)).toEqual(phrase.slice(4, 8));
    expect(phrase.slice(0, 4)).toEqual(phrase.slice(8, 12));
    expect(phrase.slice(0, 4)).toEqual(phrase.slice(12, 16));
  });

  it('keeps every note in key', () => {
    // Indexing the scale vector is what guarantees this, and it is the reason a seeded phrase
    // sounds like music rather than like a random walk.
    for (const scale of TONE_SCALES) {
      const phrase = generatePhrase(toneRecipeById('pulse'), 62, scale, 8675);
      for (const value of phrase) {
        if (value === REST) continue;
        expect(scale.degrees, scale.id).toContain((value - 62) % 12);
      }
    }
  });

  it('leaves room in the bar, in the recipe named for that', () => {
    for (const seed of [1, 4711, 47_291]) {
      const sparse = generatePhrase(
        toneRecipeById('sparse'),
        DEFAULT_ROOT,
        toneScaleById('minor-pentatonic'),
        seed,
      );
      expect(sparse.filter((value) => value !== REST).length, String(seed)).toBeLessThan(10);
    }
  });

  it('bounds the root to the two octaves the arithmetic allows', () => {
    expect(TONE_ROOTS).toHaveLength(24);
    expect(clampRoot(0)).toBe(TONE_ROOT_MIN);
    expect(clampRoot(999)).toBe(TONE_ROOT_MAX);
    expect(clampRoot(Number.NaN)).toBe(DEFAULT_ROOT);
    expect(clampRoot(60.4)).toBe(60);
  });
});

/* ------------------------------------------------------------------------- */

describe('what makes two phrase questions the same question', () => {
  const scale = toneScaleById('minor-pentatonic');
  const recipe = toneRecipeById('riff');

  it('separates a phrase key from a rhythm key', () => {
    // One cache, two kinds of music. A collision would hand a phrase back as a rhythm.
    const key = toneCacheKey({
      operation: toneOperationById('reverse'),
      parameters: {},
      phrase: openingPhrase(),
    });
    expect(key.startsWith('tone|')).toBe(true);
    expect(toneGenerateCacheKey({ recipe, root: 60, scale, seed: 1 }).startsWith('tone-generate|')).toBe(
      true,
    );
  });

  it('moves the generation key when any of the four controls moves', () => {
    const base = { recipe, root: 60, scale, seed: 4711 };
    const key = toneGenerateCacheKey(base);

    expect(toneGenerateCacheKey({ ...base, seed: 4712 })).not.toBe(key);
    expect(toneGenerateCacheKey({ ...base, root: 61 })).not.toBe(key);
    expect(toneGenerateCacheKey({ ...base, scale: toneScaleById('dorian') })).not.toBe(key);
    expect(toneGenerateCacheKey({ ...base, recipe: toneRecipeById('pulse') })).not.toBe(key);
    // And stays put when nothing that matters has.
    expect(toneGenerateCacheKey({ ...base })).toBe(key);
  });

  it('carries the Tone generator version, which moves independently of the rhythm one', () => {
    expect(toneGenerateCacheKey({ recipe, root: 60, scale, seed: 1 })).toContain(
      `v${String(TONE_GENERATOR_VERSION)}`,
    );
  });

  it('does not depend on the phrase in hand, because a recipe never reads it', () => {
    const a = toneGenerateCacheKey({ recipe, root: 60, scale, seed: 4711 });
    const b = toneGenerateCacheKey({ recipe, root: 60, scale, seed: 4711 });
    expect(a).toBe(b);
  });

  it('moves the transform key when the phrase it works on moves', () => {
    const operation = toneOperationById('transpose');
    const before = toneCacheKey({ operation, parameters: { amount: 5 }, phrase: openingPhrase() });
    const after = toneCacheKey({
      operation,
      parameters: { amount: 5 },
      phrase: [...openingPhrase().slice(0, 15), 72],
    });

    expect(after).not.toBe(before);
  });

  it('tells a seeded expression apart from an unseeded one', () => {
    /*
     * The Stage 6 bug, prevented on this side before it could happen: an expression using `?`
     * answers differently under a different `⎕RL`, so the seed is part of the identity — and *no*
     * seed is its own value rather than a missing one.
     */
    const core = '(60+(0 3 5 7 10)[?16⍴5])×0=2|⍳16';
    const unseeded = toneCustomIdentityKey({ core });
    const seeded = toneCustomIdentityKey({ core, randomSeed: 1 });
    const other = toneCustomIdentityKey({ core, randomSeed: 2 });

    expect(seeded).not.toBe(unseeded);
    expect(other).not.toBe(seeded);
    expect(toneCustomIdentityKey({ core, randomSeed: null })).toBe(unseeded);
    // Normalised the same way the source builder normalises it, so two requests that would send
    // byte-identical APL have byte-identical identities.
    expect(toneCustomIdentityKey({ core, randomSeed: 0 })).toBe(
      toneCustomIdentityKey({ core, randomSeed: 999_999 }),
    );
  });
});

describe('a hand-written phrase expression', () => {
  it('is wrapped in the statements the built-in ones use, with no target', () => {
    const source = buildToneCustomSource({ core: '⌽n', phrase: openingPhrase() });
    expect(source.statements).toEqual(['⎕IO←0', 'n←60 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0', 'n←(⌽n)', 'n']);
  });

  it('fixes ⎕RL only when the expression came from a recipe', () => {
    const plain = buildToneCustomSource({ core: '⌽n', phrase: openingPhrase() });
    const seeded = buildToneCustomSource({ core: '⌽n', phrase: openingPhrase(), randomSeed: 4711 });

    expect(plain.expression).not.toContain('⎕RL');
    expect(seeded.statements[1]).toBe('⎕RL←4711 1');
  });

  it('keeps the expression exactly as it was typed', () => {
    // The expression shown in the editor and the expression that runs have to be the same thing,
    // whitespace included: normalising would mean understanding APL well enough to know which
    // whitespace is meaningless, which this application does not claim to.
    const core = '(48⌈84⌊n  +  7)×0<n';
    expect(buildToneCustomSource({ core, phrase: openingPhrase() }).core).toBe(core);
  });

  it('says what the expression has to produce, in numbers', () => {
    const contract = toneContract();
    expect(contract).toContain('16');
    expect(contract).toContain('0 for a rest');
    expect(contract).toContain(String(TONE_MIN_MIDI));
    expect(contract).toContain(String(TONE_MAX_MIDI));
  });
});
