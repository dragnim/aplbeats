/*
 * A Tone phrase: sixteen numbers.
 *
 * The whole conceptual point of Stage 8 is in the type. A beat is a Boolean matrix — eight tracks
 * of sixteen yes-or-no decisions — and a Tone phrase is not. It is a *numeric vector*, and once
 * it is one, `n+5` transposes it, `⌽n` reverses it and `2⌽n` rotates it. The contrast between `m`
 * and `n` is the thing worth teaching, so Tones is deliberately not a second 8 × 16 grid.
 *
 *     m   8 16⍴0 1 0 1 …     rhythm: does this track fire on this step?
 *     n   0 60 0 63 67 …     Tones: which pitch sounds on this step, if any?
 *
 * Zero is a rest rather than a pitch, which is a small design decision doing a lot of work: it
 * makes `0<n` the mask of sounding notes, so `n+5×0<n` transposes the notes and leaves the rests
 * alone — one expression, no conditionals, and it reads as what it does.
 *
 * MIDI numbering throughout, with 60 as middle C. That is the convention every other tool the
 * reader might reach for uses, and inventing a private one to save an octave of arithmetic would
 * be a poor trade.
 */

/** How many steps a phrase has. The same bar the drums play. */
export const PHRASE_LENGTH = 16;

/**
 * No note on this step. Not a pitch, and deliberately the value APL's `0<n` filters out.
 *
 * "Rest" in the sense a step sequencer means it — *nothing is struck here* — rather than "silence
 * begins here". A note already ringing carries on and decays; only a new note takes the voice.
 * That distinction is what lets the same sixteen numbers be a legato line when they are sparse and
 * an articulated one when they are dense, and it is why a slow patch is playable at all. See
 * `AudioEngine.playTone`.
 */
export const REST = 0;

/**
 * The playable range, derived from the source recordings rather than chosen.
 *
 * Each Jupiter-4 preset is sampled chromatically over its own span, and the intersection of the
 * four shipped sounds is MIDI 48–83; the top note is reached by shifting the highest recording of
 * the two presets that stop at 83 up one semitone. So: C3 to C6, three octaves — low enough for a
 * bass line to sit under a kick and high enough for a lead to be a lead.
 *
 * See `scripts/prepare-jupiter4.mjs`, which derives the same numbers from the archives.
 */
export const TONE_MIN_MIDI = 48;
export const TONE_MAX_MIDI = 84;

/** Sixteen values: `REST`, or a MIDI note inside the playable range. */
export type Phrase = readonly number[];

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

/**
 * A MIDI number as a name, in the convention where 60 is C4.
 *
 * Worth stating which convention, because there are two in circulation: some hardware calls MIDI
 * 60 C3 and some calls it C5. This uses scientific pitch notation as most software does, so C4 is
 * middle C and A4 is 440 Hz — which is also what makes `60 → C4` look right to anybody who has
 * used a DAW.
 *
 * Sharps rather than flats throughout. A phrase generator working from scale degrees has no idea
 * whether it is in D♯ minor or E♭ minor, and picking one spelling consistently is more honest
 * than guessing at a key signature nothing in this application tracks.
 */
export function noteName(midi: number): string {
  if (!isPitch(midi)) return '—';
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12] ?? '?'}${String(octave)}`;
}

/** How a step reads aloud: "G4", or "rest". */
export function stepLabel(value: number): string {
  return value === REST ? 'rest' : noteName(value);
}

/** Whether this value is a sounding pitch this instrument can play. */
export function isPitch(value: number): boolean {
  return Number.isInteger(value) && value >= TONE_MIN_MIDI && value <= TONE_MAX_MIDI;
}

/** Whether this value is a legal phrase entry: a rest, or a playable pitch. */
export function isPhraseValue(value: unknown): value is number {
  return typeof value === 'number' && (value === REST || isPitch(value));
}

/**
 * Whether this really is a phrase.
 *
 * Strict about length and about every value, because a phrase arrives from three places that are
 * all outside this module's control — `localStorage`, an APL reply, and the step editor — and a
 * seventeen-note phrase or a fractional pitch is a bug wherever it came from.
 */
export function isPhrase(value: unknown): value is Phrase {
  return Array.isArray(value) && value.length === PHRASE_LENGTH && value.every(isPhraseValue);
}

/** A phrase of nothing but rests. Used as a fallback, never as an opening. */
export function emptyPhrase(): Phrase {
  return Array.from({ length: PHRASE_LENGTH }, () => REST);
}

/**
 * The phrase APL Beats opens on.
 *
 * Not silence. Somebody arriving at Tones for the first time should hear what the feature *is*
 * within one bar, and an empty strip teaches nothing.
 *
 * C minor pentatonic over the opening groove — an arch: up through C, E♭, G, and back down
 * through F, E♭, C. Six notes in sixteen steps, so it leaves most of the bar to the drums and
 * never competes with the backbeat on 5 and 13.
 *
 * Chosen partly for how it survives being transformed, which is the first thing anybody will do
 * to it. Reversed it is still an arch. Rotated by two it starts on the E♭ and becomes a
 * suspension. Transposed by 5 it lands in F minor pentatonic and still sits under the kit. A
 * phrase that turned to mush under `⌽n` would make the demonstration worse, not better.
 */
export function openingPhrase(): Phrase {
  return [60, REST, REST, 63, REST, 67, REST, REST, 65, REST, REST, 63, REST, 60, REST, REST];
}

/** A phrase with one step changed. Immutable, like the pattern. */
export function setStep(phrase: Phrase, step: number, value: number): Phrase {
  if (step < 0 || step >= PHRASE_LENGTH) return phrase;
  if (!isPhraseValue(value)) return phrase;
  if (phrase[step] === value) return phrase;

  const next = [...phrase];
  next[step] = value;
  return next;
}

export function phrasesEqual(a: Phrase, b: Phrase): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** How many steps sound. Used by the interface and by the review tooling. */
export function noteCount(phrase: Phrase): number {
  return phrase.filter((value) => value !== REST).length;
}

/**
 * A phrase as APL writes it: sixteen numbers, space separated.
 *
 * No `⍴` and no shape prefix, because a vector does not need one — which is itself part of the
 * lesson. `m` needs `8 16⍴` to say what shape it is; `n` is just numbers.
 */
export function phraseToAplLiteral(phrase: Phrase): string {
  return phrase.map((value) => String(value)).join(' ');
}

/**
 * A phrase from APL's output lines, or a reason it is not one.
 *
 * The contract is exact and narrow, for the same reason the matrix parser's is: this is a reply
 * from a service that is not ours, and a phrase that is *nearly* right is worse than none. It has
 * to be one line of sixteen integers, each a rest or a playable pitch. A fraction, a negative, a
 * pitch outside the instrument, a seventeenth value — each is refused whole and the phrase the
 * visitor had is left alone.
 */
export type PhraseParseResult =
  { readonly ok: true; readonly phrase: Phrase } | { readonly ok: false; readonly reason: string };

export function parseAplPhrase(outputLines: readonly string[]): PhraseParseResult {
  const lines = outputLines.map((line) => line.trim()).filter((line) => line !== '');

  if (lines.length === 0) return { ok: false, reason: 'the reply was empty' };
  if (lines.length > 1) {
    return {
      ok: false,
      reason: `expected one line of ${String(PHRASE_LENGTH)} numbers, received ${String(lines.length)}`,
    };
  }

  const tokens = (lines[0] ?? '').split(/\s+/u);
  if (tokens.length !== PHRASE_LENGTH) {
    return {
      ok: false,
      reason: `expected ${String(PHRASE_LENGTH)} values, received ${String(tokens.length)}`,
    };
  }

  const phrase: number[] = [];
  for (const token of tokens) {
    /*
     * Matched as text before being converted, exactly as the matrix parser does. `Number('60.0')`
     * is 60 and `Number('¯5')` is `NaN`; neither is what an integer vector prints, and a pitch
     * that arrived as `60.0` means the expression produced fractions somewhere.
     */
    if (!/^\d+$/u.test(token)) {
      return { ok: false, reason: `${JSON.stringify(token)} is not a whole number` };
    }

    const value = Number(token);
    if (!isPhraseValue(value)) {
      return {
        ok: false,
        reason: `${String(value)} is outside the playable range ${String(TONE_MIN_MIDI)}–${String(TONE_MAX_MIDI)}`,
      };
    }
    phrase.push(value);
  }

  return { ok: true, phrase };
}
