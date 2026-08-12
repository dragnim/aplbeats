/*
 * The matrix crossing the boundary, in both directions.
 *
 * Out is easy: a pattern is 128 Booleans and becomes `8 16⍴0 1 0 …`, which is both valid
 * APL and legible in Peek — a visitor reading the full request can see their own drum
 * pattern written out as data, which is a large part of the point.
 *
 * Back is where the care goes. The reply comes from a service that is not ours, over a
 * network, from an interpreter that will happily return a scalar, a vector, a nested array
 * or an error message — all with HTTP 200. So the contract is exact and narrow: **eight
 * lines, sixteen values each, every value 0 or 1, and nothing else.** Anything short of
 * that is refused whole. There is no partial acceptance, because half a transformed bar is
 * worse than none: the visitor would hear something nobody asked for and have no way to
 * know why.
 */

import { STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';

/** How many values a valid reply carries. */
export const EXPECTED_VALUES = TRACK_COUNT * STEP_COUNT;

/**
 * A pattern as an APL matrix literal.
 *
 * `8 16⍴` then the values in row-major order, which is the order `⍴` fills. Written with
 * single spaces so the literal stays short enough to read and short enough to send.
 */
export function patternToAplLiteral(pattern: Pattern): string {
  const values: string[] = [];
  for (let track = 0; track < TRACK_COUNT; track += 1) {
    const row = pattern[track];
    for (let step = 0; step < STEP_COUNT; step += 1) {
      values.push(row?.[step] === true ? '1' : '0');
    }
  }
  return `${String(TRACK_COUNT)} ${String(STEP_COUNT)}⍴${values.join(' ')}`;
}

/** One track's row as an APL vector literal, for Peek's array view. */
export function rowToAplLiteral(pattern: Pattern, track: number): string {
  const row = pattern[track];
  const values: string[] = [];
  for (let step = 0; step < STEP_COUNT; step += 1) {
    values.push(row?.[step] === true ? '1' : '0');
  }
  return values.join(' ');
}

export type MatrixParseResult =
  { readonly ok: true; readonly pattern: Pattern } | { readonly ok: false; readonly reason: string };

/**
 * The pattern in these output lines, or a reason it is not one.
 *
 * Deliberately strict about structure as well as about content. Counting 128 values across
 * however many lines happened to arrive would accept a 16 × 8 matrix, a 128-element vector
 * and a 4 × 32 matrix as though they were the same thing — and each of those means the
 * transform did something other than what was asked. The row and column structure *is* the
 * shape check, so it is enforced line by line.
 */
export function parseAplMatrix(outputLines: readonly string[]): MatrixParseResult {
  // Trailing blank lines are ordinary in APL output and carry no meaning.
  const lines = [...outputLines];
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift();

  if (lines.length === 0) return { ok: false, reason: 'the reply was empty' };

  if (lines.length !== TRACK_COUNT) {
    return {
      ok: false,
      reason: `expected ${String(TRACK_COUNT)} rows, received ${String(lines.length)}`,
    };
  }

  const rows: boolean[][] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    // Split on any run of whitespace, so a service that pads or aligns its columns is read
    // the same as one that does not.
    const tokens = line.trim().split(/\s+/u);

    if (tokens.length !== STEP_COUNT) {
      return {
        ok: false,
        reason: `row ${String(index)} has ${String(tokens.length)} values, expected ${String(STEP_COUNT)}`,
      };
    }

    const row: boolean[] = [];
    for (const token of tokens) {
      /*
       * Exactly "0" or "1" as text, rather than a parsed number compared to 0 and 1.
       * `Number('1.0')`, `Number('+1')`, `Number('1e0')` and `Number(' 1 ')` are all 1, and
       * none of them is what a Boolean matrix prints. `¯1` — APL's high minus — is not a
       * JavaScript number at all, which is exactly the sort of value that must be refused
       * rather than quietly becoming NaN and then false.
       */
      if (token !== '0' && token !== '1') {
        return {
          ok: false,
          reason: `row ${String(index)} contains ${JSON.stringify(token)}, expected 0 or 1`,
        };
      }
      row.push(token === '1');
    }

    rows.push(row);
  }

  return { ok: true, pattern: rows };
}
