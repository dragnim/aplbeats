/*
 * A hand-written expression, wrapped in the machinery APL Beats already provides.
 *
 * Stage 3 generated the APL from templates, so it could be certain what it was sending. Stage 5
 * lets somebody type the interesting part themselves, and the question that raises is not
 * "is this safe?" — TryAPL is the sandbox, and a blacklist pretending otherwise would be
 * theatre — but "can this be placed into the wrapper without changing what the wrapper means?"
 *
 * The wrapper is:
 *
 *     ⎕IO←0 ⋄ m←8 16⍴… ⋄ m[2;]←(<yours>) ⋄ m
 *
 * The parentheses do most of the work. Whatever precedence an expression has, bracketing it
 * makes the assignment unambiguous, so almost nothing needs forbidding. What does need
 * forbidding is anything that could escape the expression and rewrite the statements around it:
 *
 *   `⋄` would add statements of its own, and the fourth statement is the one that returns the
 *   matrix — an expression that appended `⋄ 0` would leave nothing to parse;
 *
 *   a newline is the same problem in a different costume;
 *
 *   `⍝` comments to the end of the line, and the line continues ` ⋄ m` — so a trailing comment
 *   would silently delete the statement that hands the rhythm back;
 *
 *   `)` or `]` at the start are Dyalog's line-oriented session commands, which cannot be part
 *   of an expression at all. Rejecting them here produces a sentence somebody can act on
 *   rather than a SYNTAX ERROR from a machine that never had a chance.
 *
 * That is the whole list, and each entry is about *wrapping*, not about safety. `⎕SH` and
 * friends are not blocked here: TryAPL refuses them itself, and pretending this file could do
 * that job would be a worse lie than any of them.
 */

import { clampSeed } from '@/generation/prng';
import { patternToAplLiteral } from './matrix';
import { aplNumber, IO_ORIGIN, type Target, type AplSource } from './operations';
import { STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import { phraseToAplLiteral, PHRASE_LENGTH, TONE_MAX_MIDI, TONE_MIN_MIDI, type Phrase } from '@/tones/phrase';
import { DIAMOND } from './wire';

/**
 * How long a hand-written expression may be.
 *
 * Generous — three hundred and twenty characters is far more than any of the built-in
 * operations need, and enough for a genuinely intricate one — and finite, because the point of
 * a limit is that somebody cannot paste a novel into somebody else's interpreter. Counted in
 * code points, so a line of APL glyphs measures the way a person would count it.
 */
export const MAX_CUSTOM_LENGTH = 320;

export type CustomCheck =
  { readonly ok: true; readonly core: string } | { readonly ok: false; readonly reason: string };

/**
 * Whether this text can be the core of a request, and if not, why not in one sentence.
 *
 * Deliberately not a parser. It does not know APL, does not try to, and says so — everything it
 * rejects is rejected because of what it would do to the *wrapper*, which is the only part
 * this application owns.
 */
export function checkCustomExpression(input: string): CustomCheck {
  const core = input.trim();

  if (core.length === 0) {
    return { ok: false, reason: 'There is nothing to run yet. Write an expression first.' };
  }

  const length = [...core].length;
  if (length > MAX_CUSTOM_LENGTH) {
    return {
      ok: false,
      reason: `That is ${String(length)} characters; the limit is ${String(MAX_CUSTOM_LENGTH)}.`,
    };
  }

  if (core.includes(DIAMOND)) {
    return {
      ok: false,
      reason: `Remove the ${DIAMOND}. Explore runs one expression, and APL Beats adds the statements around it.`,
    };
  }

  if (/[\n\r]/u.test(core)) {
    return {
      ok: false,
      reason: 'Keep it to one line. Explore runs a single expression.',
    };
  }

  if (core.includes('⍝')) {
    return {
      ok: false,
      reason: 'Remove the ⍝. A comment would run to the end of the line and swallow the rest of the request.',
    };
  }

  if (core.startsWith(')') || core.startsWith(']')) {
    return {
      ok: false,
      reason:
        'That is a session command, not an expression. Explore runs one APL expression against your rhythm.',
    };
  }

  return { ok: true, core };
}

/* ------------------------------------------------------------------------- */

export interface CustomSourceRequest {
  /** What the visitor typed. Trimmed, never otherwise altered. */
  readonly core: string;
  /** Where the result is installed: one row, or the whole matrix. */
  readonly target: Target;
  readonly pattern: Pattern;
  /**
   * The seed `⎕RL` is fixed to, when the expression needs one.
   *
   * Absent for ordinary Explore, which is how it has always been: a transform expression gives
   * the same answer whenever you run it and has no use for a random source. Present when the
   * expression came from Create, because a generator uses `?` — and an unedited generator that
   * gave a different bar than the button which produced it would make Peek a lie.
   *
   * APL Beats still owns this. The person edits the expression; the origin, the seed and the
   * matrix wrapper are the application's, and none of them is editable text.
   */
  readonly randomSeed?: number;
}

/**
 * The full request for a hand-written expression.
 *
 * The same four statements the built-in operations use, with the visitor's expression in the
 * third — parenthesised, and otherwise untouched. Whitespace inside it survives exactly as
 * typed, because the expression shown in the editor and the expression that runs have to be
 * the same thing.
 */
export function buildCustomSource({ core, target, pattern, randomSeed }: CustomSourceRequest): AplSource {
  const trimmed = core.trim();
  const assignment = target === 'all' ? `m←(${trimmed})` : `m[${aplNumber(target)};]←(${trimmed})`;

  /*
   * `⎕RL` goes immediately after `⎕IO` and before anything else, so the seed is already fixed
   * by the time the expression runs — and nowhere else, so an expression that does not use `?`
   * is sent exactly as Stage 5 sent it.
   */
  const random = randomSeed === undefined ? [] : [`⎕RL←${String(clampSeed(randomSeed))} 1`];

  const statements = [
    `⎕IO←${String(IO_ORIGIN)}`,
    ...random,
    `m←${patternToAplLiteral(pattern)}`,
    assignment,
    'm',
  ];

  return { core: trimmed, statements, expression: statements.join(` ${DIAMOND} `) };
}

/**
 * What the expression has to produce, in one sentence.
 *
 * Shown beside the editor, because the contract is the one thing somebody cannot guess: an
 * expression that returns the wrong shape is the most common way a first experiment fails, and
 * "RANK ERROR" on its own does not say which shape was wanted.
 */
export function customContract(target: Target): string {
  return target === 'all'
    ? `Return an ${String(TRACK_COUNT)} × ${String(STEP_COUNT)} matrix of 0s and 1s. It becomes the whole rhythm.`
    : `Return ${String(STEP_COUNT)} values of 0 or 1. They become that track's row.`;
}

/** Every target Explore accepts. Unlike the built-in operations, all of them. */
export function everyTarget(): Target[] {
  return ['all', ...Array.from({ length: TRACK_COUNT }, (_unused, index) => index)];
}

/* ------------------------------------------------------------------------- */

export interface ToneCustomSourceRequest {
  /** What the visitor typed. Trimmed, never otherwise altered. */
  readonly core: string;
  readonly phrase: Phrase;
  /** The seed `⎕RL` is fixed to, when the expression came from a Tone recipe. */
  readonly randomSeed?: number;
}

/**
 * The same, for a phrase.
 *
 * Deliberately the same wrapper shape and the same four statements, because `checkCustomExpression`
 * above is doing the same job for both: everything it forbids — `⋄`, a newline, `⍝`, a leading
 * `)` — is forbidden because of what it would do to *these statements*, and the statements are
 * identical in structure. One check, one contract, two kinds of music.
 *
 * The one difference is the assignment. There is no target: a phrase is one line, so the
 * expression's result becomes the whole of `n` and there is no bracket form.
 */
export function buildToneCustomSource({ core, phrase, randomSeed }: ToneCustomSourceRequest): AplSource {
  const trimmed = core.trim();
  const random = randomSeed === undefined ? [] : [`⎕RL←${String(clampSeed(randomSeed))} 1`];

  const statements = [
    `⎕IO←${String(IO_ORIGIN)}`,
    ...random,
    `n←${phraseToAplLiteral(phrase)}`,
    `n←(${trimmed})`,
    'n',
  ];

  return { core: trimmed, statements, expression: statements.join(` ${DIAMOND} `) };
}

/**
 * What a phrase expression has to produce.
 *
 * Stated as the numbers rather than as "a phrase", because that is the contract APL is actually
 * held to — and because "0 is a rest" is the one fact somebody needs to know before their first
 * expression, and the one nothing else in the editor would tell them.
 */
export function toneContract(): string {
  return `Return ${String(PHRASE_LENGTH)} whole numbers: 0 for a rest, or a MIDI note from ${String(
    TONE_MIN_MIDI,
  )} to ${String(TONE_MAX_MIDI)}. They become the Tone phrase.`;
}
