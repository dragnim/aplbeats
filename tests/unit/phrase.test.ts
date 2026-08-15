import { describe, expect, it } from 'vitest';
import {
  emptyPhrase,
  isPhrase,
  isPhraseValue,
  isPitch,
  noteCount,
  noteName,
  openingPhrase,
  parseAplPhrase,
  PHRASE_LENGTH,
  phrasesEqual,
  phraseToAplLiteral,
  REST,
  setStep,
  stepLabel,
  TONE_MAX_MIDI,
  TONE_MIN_MIDI,
} from '@/tones/phrase';

/*
 * The phrase model.
 *
 * Small, and worth testing carefully anyway, because a phrase arrives from three places that are
 * all outside this module's control — `localStorage`, an APL reply, and the step editor — and
 * every one of them can hand it something that is nearly right. A seventeenth value, a fraction,
 * a pitch above the top of the instrument: each is a bug wherever it came from, and each has to be
 * refused here rather than discovered later by a sampler asked to play MIDI 4000.
 */

describe('a phrase', () => {
  it('is sixteen steps, matching the bar the drums play', () => {
    expect(PHRASE_LENGTH).toBe(16);
    expect(emptyPhrase()).toHaveLength(16);
    expect(openingPhrase()).toHaveLength(16);
  });

  it('uses zero for a rest, which is what makes 0<n the mask of sounding notes', () => {
    expect(REST).toBe(0);
    // The property the whole data model is built on: no pitch is ever zero, so the two can never
    // be confused and `×0<n` is a complete description of "leave the rests alone".
    expect(isPitch(REST)).toBe(false);
  });

  it('accepts only whole pitches inside the sampled range', () => {
    expect(isPhraseValue(TONE_MIN_MIDI)).toBe(true);
    expect(isPhraseValue(TONE_MAX_MIDI)).toBe(true);
    expect(isPhraseValue(REST)).toBe(true);

    expect(isPhraseValue(TONE_MIN_MIDI - 1)).toBe(false);
    expect(isPhraseValue(TONE_MAX_MIDI + 1)).toBe(false);
    expect(isPhraseValue(60.5)).toBe(false);
    expect(isPhraseValue('60')).toBe(false);
    expect(isPhraseValue(Number.NaN)).toBe(false);
  });

  it('refuses anything that is not sixteen legal values', () => {
    expect(isPhrase(openingPhrase())).toBe(true);
    expect(isPhrase(emptyPhrase())).toBe(true);

    expect(isPhrase([...openingPhrase(), 60])).toBe(false);
    expect(isPhrase(openingPhrase().slice(0, 15))).toBe(false);
    expect(isPhrase(Array.from({ length: 16 }, () => 4000))).toBe(false);
    expect(isPhrase('60 0 0 63')).toBe(false);
    expect(isPhrase(null)).toBe(false);
  });

  it('names notes in the convention where 60 is middle C', () => {
    // Stated in a test because there are two conventions in circulation and picking the wrong one
    // would make every note name in the interface an octave out.
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    expect(noteName(48)).toBe('C3');
    expect(noteName(72)).toBe('C5');
    expect(noteName(61)).toBe('C♯4');
  });

  it('reads a rest as a rest rather than as a note', () => {
    expect(stepLabel(REST)).toBe('rest');
    expect(stepLabel(67)).toBe('G4');
  });

  it('opens on something, because an empty strip teaches nothing', () => {
    const opening = openingPhrase();
    expect(noteCount(opening)).toBeGreaterThan(3);
    expect(opening[0]).not.toBe(REST);
    // Every value playable, or the opening phrase would fail its own validator.
    expect(isPhrase(opening)).toBe(true);
  });

  it('leaves the backbeat alone', () => {
    /*
     * Steps 4 and 12 are where the snare falls. The opening phrase deliberately rests on both, so
     * the first thing anybody hears is a tune answering the kit rather than competing with it.
     */
    const opening = openingPhrase();
    expect(opening[4]).toBe(REST);
    expect(opening[12]).toBe(REST);
  });

  it('changes one step without touching the others', () => {
    const before = openingPhrase();
    const after = setStep(before, 2, 72);

    expect(after[2]).toBe(72);
    expect(after).not.toBe(before);
    expect(before[2]).toBe(REST);
    expect(after.filter((_v, index) => index !== 2)).toEqual(before.filter((_v, index) => index !== 2));
  });

  it('refuses an edit that would put something illegal in the phrase', () => {
    const before = openingPhrase();
    expect(setStep(before, 0, 4000)).toBe(before);
    expect(setStep(before, 0, 60.5)).toBe(before);
    expect(setStep(before, 99, 60)).toBe(before);
    // An edit that changes nothing returns the same array, so nothing downstream re-renders.
    expect(setStep(before, 0, before[0]!)).toBe(before);
  });

  it('compares by value, so an edit and an undo are still the same phrase', () => {
    expect(phrasesEqual(openingPhrase(), openingPhrase())).toBe(true);
    expect(phrasesEqual(openingPhrase(), emptyPhrase())).toBe(false);
  });

  it('writes itself as APL without a shape prefix', () => {
    // Which is half the lesson: `m` needs `8 16⍴` to say what shape it is, and `n` is just numbers.
    expect(phraseToAplLiteral(openingPhrase())).toBe('60 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0');
    expect(phraseToAplLiteral(emptyPhrase())).toBe('0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0');
  });
});

describe('reading a phrase back from APL', () => {
  it('accepts one line of sixteen whole numbers', () => {
    const result = parseAplPhrase(['60 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.phrase).toEqual(openingPhrase());
  });

  it('tolerates the whitespace an interpreter actually prints', () => {
    const result = parseAplPhrase(['', '  60   0  0 63 0 67 0 0 65 0 0 63 0 60 0 0  ', '']);
    expect(result.ok).toBe(true);
  });

  it('refuses a reply that is nearly right', () => {
    // Each of these is a real way an expression can go wrong, and each must lose the *reply*
    // rather than the phrase the visitor already had.
    const cases: readonly [string[], RegExp][] = [
      [[], /empty/u],
      [['60 0 0 63'], /expected 16 values/u],
      [['60 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0 60'], /expected 16 values/u],
      [['60 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0', '60 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0'], /one line/u],
      [['60.5 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0'], /whole number/u],
      [['¯5 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0'], /whole number/u],
      [['4000 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0'], /outside the playable range/u],
      [['1 0 0 63 0 67 0 0 65 0 0 63 0 60 0 0'], /outside the playable range/u],
    ];

    for (const [lines, reason] of cases) {
      const result = parseAplPhrase(lines);
      expect(result.ok, lines.join(' | ')).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(reason);
    }
  });

  it('accepts a phrase of nothing but rests', () => {
    // Sixteen zeroes is a valid answer, however unmusical. Refusing it would mean an expression
    // that silenced the phrase failed rather than silenced it, which is a different thing.
    const result = parseAplPhrase(['0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0']);
    expect(result.ok).toBe(true);
  });
});
