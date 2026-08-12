import { describe, expect, it } from 'vitest';
import { EXPECTED_VALUES, parseAplMatrix, patternToAplLiteral, rowToAplLiteral } from '@/apl/matrix';
import { aplErrorIn, buildRequestPayload, parseWireResponse } from '@/apl/wire';
import { createInitialGroove } from '@/pattern/initialGroove';
import { countTriggers, STEP_COUNT, TRACK_COUNT } from '@/pattern/pattern';

/*
 * Reading a reply from a service that is not ours.
 *
 * Everything here is about refusing things. TryAPL will happily return a scalar, a vector, a
 * nested array or an error message — all with HTTP 200 — and none of those is a drum pattern.
 * The contract is exact: eight lines, sixteen values each, every value 0 or 1. Anything else
 * is refused whole, because half a transformed bar is worse than none: the visitor would hear
 * something nobody asked for with no way to know why.
 */

/** Eight lines of sixteen digits, as the live service really formats them. */
function validReply(fill: (track: number, step: number) => 0 | 1): string[] {
  return Array.from({ length: TRACK_COUNT }, (_unused, track) =>
    Array.from({ length: STEP_COUNT }, (_alsoUnused, step) => String(fill(track, step))).join(' '),
  );
}

describe('sending the matrix', () => {
  it('writes it as an APL literal of the declared shape', () => {
    const literal = patternToAplLiteral(createInitialGroove());
    expect(literal.startsWith('8 16⍴')).toBe(true);
    expect(literal.slice('8 16⍴'.length).split(' ')).toHaveLength(EXPECTED_VALUES);
  });

  it('writes it in row-major order, which is the order ⍴ fills', () => {
    // The kick's first step is a 1 and its second is a 0, so the literal must start "1 0".
    const literal = patternToAplLiteral(createInitialGroove());
    expect(literal).toContain('8 16⍴1 0 0 0 0 0 1 0');
  });

  it('writes one row as a bare vector, for Peek', () => {
    const row = rowToAplLiteral(createInitialGroove(), 0);
    expect(row).toBe('1 0 0 0 0 0 1 0 0 0 1 0 0 0 1 0');
  });

  it('round-trips through the parser', () => {
    const groove = createInitialGroove();
    const literal = patternToAplLiteral(groove);
    const values = literal.slice('8 16⍴'.length).split(' ');
    const lines = Array.from({ length: TRACK_COUNT }, (_unused, track) =>
      values.slice(track * STEP_COUNT, (track + 1) * STEP_COUNT).join(' '),
    );

    const parsed = parseAplMatrix(lines);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.pattern).toEqual(groove);
  });
});

describe('a valid reply', () => {
  it('becomes the pattern it describes', () => {
    const parsed = parseAplMatrix(validReply((track, step) => ((track + step) % 3 === 0 ? 1 : 0)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.pattern).toHaveLength(TRACK_COUNT);
    for (const row of parsed.pattern) expect(row).toHaveLength(STEP_COUNT);
    expect(parsed.pattern[0]?.[0]).toBe(true);
    expect(parsed.pattern[0]?.[1]).toBe(false);
  });

  it('accepts an all-silent matrix', () => {
    const parsed = parseAplMatrix(validReply(() => 0));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(countTriggers(parsed.pattern)).toBe(0);
  });

  it('accepts an all-firing matrix', () => {
    const parsed = parseAplMatrix(validReply(() => 1));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(countTriggers(parsed.pattern)).toBe(EXPECTED_VALUES);
  });

  it('tolerates padding and alignment', () => {
    // A service that lines its columns up is read the same as one that does not.
    const lines = validReply(() => 1).map((line) => `   ${line.split(' ').join('   ')}   `);
    expect(parseAplMatrix(lines).ok).toBe(true);
  });

  it('tolerates blank lines around it', () => {
    const lines = ['', '', ...validReply(() => 0), '', '   '];
    expect(parseAplMatrix(lines).ok).toBe(true);
  });

  it('tolerates tabs between values', () => {
    const lines = validReply(() => 1).map((line) => line.split(' ').join('\t'));
    expect(parseAplMatrix(lines).ok).toBe(true);
  });
});

describe('a reply that is refused', () => {
  const cases: readonly { readonly name: string; readonly lines: string[] }[] = [
    { name: 'nothing at all', lines: [] },
    { name: 'only blank lines', lines: ['', '  ', ''] },
    { name: 'too few rows', lines: validReply(() => 1).slice(0, 7) },
    { name: 'too many rows', lines: [...validReply(() => 1), '1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1'] },
    {
      name: 'a row with too few values',
      lines: validReply(() => 1).map((line, index) => (index === 3 ? '1 1 1' : line)),
    },
    {
      name: 'a row with too many values',
      lines: validReply(() => 1).map((line, index) => (index === 3 ? `${line} 1` : line)),
    },
    {
      name: 'a value of 2',
      lines: validReply(() => 1).map((line, index) => (index === 0 ? line.replace('1', '2') : line)),
    },
    {
      // APL's high minus. Not a JavaScript number at all, which is exactly why it is compared
      // as text rather than parsed.
      name: 'a negative value',
      lines: validReply(() => 1).map((line, index) => (index === 0 ? line.replace('1', '¯1') : line)),
    },
    {
      name: 'a decimal',
      lines: validReply(() => 1).map((line, index) => (index === 0 ? line.replace('1', '1.0') : line)),
    },
    {
      name: 'a signed value',
      lines: validReply(() => 1).map((line, index) => (index === 0 ? line.replace('1', '+1') : line)),
    },
    {
      name: 'exponential notation',
      lines: validReply(() => 1).map((line, index) => (index === 0 ? line.replace('1', '1e0') : line)),
    },
    {
      name: 'text',
      lines: validReply(() => 1).map((line, index) => (index === 0 ? line.replace('1', 'x') : line)),
    },
    // A 128-element vector: the right number of values, the wrong shape entirely.
    { name: 'a flat vector', lines: [Array.from({ length: EXPECTED_VALUES }, () => '1').join(' ')] },
    // A 16 × 8 matrix: also 128 values, also not this pattern.
    {
      name: 'a transposed matrix',
      lines: Array.from({ length: 16 }, () => '1 1 1 1 1 1 1 1'),
    },
    { name: 'an APL error', lines: ['LENGTH ERROR', '      m[9;]←⌽m[9;]', '      ∧'] },
    { name: 'a scalar', lines: ['1'] },
  ];

  it.each(cases)('refuses $name', ({ lines }) => {
    const parsed = parseAplMatrix(lines);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).not.toBe('');
  });

  it('says why, so the reason can reach a console', () => {
    const parsed = parseAplMatrix(['1 1 1']);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain('rows');
  });
});

describe('the wire format', () => {
  it('sends a fresh workspace and the expression', () => {
    /*
     * A returned state is never sent back. TryAPL answers `CORRUPT WS: Workspace was reset` for
     * one, so nothing can be assigned in one request and read in the next — which suits this
     * application exactly, since a transform carries its own matrix and needs no memory.
     */
    expect(buildRequestPayload('⌽⍳5')).toEqual(['', 0, '', '⌽⍳5']);
  });

  it('reads the reply the live service actually sends', () => {
    const parsed = parseWireResponse(['<state>', 4906, '<blob>', ['1 2 3', '4 5 6']]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.response.outputLines).toEqual(['1 2 3', '4 5 6']);
  });

  it('tolerates output collapsed into one string', () => {
    const parsed = parseWireResponse(['', 0, '', 'a\nb']);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.response.outputLines).toEqual(['a', 'b']);
  });

  it.each([
    ['not an array', { state: '', output: [] }],
    ['too short', ['', 0, '']],
    ['a non-string state', [0, 0, '', []]],
    ['output that is neither string nor array', ['', 0, '', 42]],
    ['output containing a non-string', ['', 0, '', ['ok', 7]]],
    ['null', null],
  ])('refuses a reply that is %s', (_name, payload) => {
    expect(parseWireResponse(payload).ok).toBe(false);
  });
});

describe('APL errors', () => {
  it('are found in output that arrives with HTTP 200', () => {
    /*
     * The single most important fact about this wire format. An APL error is not an HTTP error:
     * it comes back as ordinary output lines, so a status check alone would treat `SYNTAX
     * ERROR` as a successful reply and then fail to parse it as a matrix — reporting the wrong
     * cause.
     */
    expect(aplErrorIn(['SYNTAX ERROR', '      ⌽⌽⌽', '      ∧'])).toBe('SYNTAX ERROR');
    expect(aplErrorIn(['   DOMAIN ERROR   '])).toBe('DOMAIN ERROR');
    expect(aplErrorIn(['LENGTH ERROR'])).toBe('LENGTH ERROR');
    expect(aplErrorIn(['RANK ERROR'])).toBe('RANK ERROR');
    expect(aplErrorIn(['INDEX ERROR'])).toBe('INDEX ERROR');
    expect(aplErrorIn(['CORRUPT WS: Workspace was reset'])).toBe('CORRUPT WS: Workspace was reset');
    expect(aplErrorIn(['NOT SUPPORTED'])).toBe('NOT SUPPORTED');
  });

  it('are not invented from a matrix of digits', () => {
    // A false positive here would refuse a perfectly good rhythm.
    expect(aplErrorIn(validReply(() => 1))).toBeNull();
    expect(aplErrorIn(validReply(() => 0))).toBeNull();
    expect(aplErrorIn([])).toBeNull();
  });
});
