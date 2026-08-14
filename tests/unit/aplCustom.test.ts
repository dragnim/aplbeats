import { describe, expect, it } from 'vitest';
import {
  buildCustomSource,
  checkCustomExpression,
  customContract,
  everyTarget,
  MAX_CUSTOM_LENGTH,
} from '@/apl/custom';
import { customCacheKey } from '@/apl/service';
import { createInitialGroove } from '@/pattern/initialGroove';
import { setCell, TRACK_COUNT } from '@/pattern/pattern';

/*
 * The boundary Stage 5 actually owns.
 *
 * Not APL grammar — that is Dyalog's job, and a parser here pretending to know what a valid
 * expression looks like would be wrong in ways nobody could predict. What is tested is the
 * wrapper: that a hand-written expression goes into the third statement unaltered, that the
 * three statements around it survive whatever was written, and that the few inputs which could
 * escape the wrapper are refused with a sentence somebody can act on.
 */

const GROOVE = createInitialGroove();

/** The statements of a custom request, for reading. */
function statementsFor(core: string, target: 'all' | number = 'all'): readonly string[] {
  return buildCustomSource({ core, target, pattern: GROOVE }).statements;
}

/* ------------------------------------------------------------------------- */

describe('the wrapper around a hand-written expression', () => {
  it('is the same four statements the built-in operations use', () => {
    const statements = statementsFor('⌽m');

    expect(statements).toHaveLength(4);
    expect(statements[0]).toBe('⎕IO←0');
    expect(statements[1]).toMatch(/^m←8 16⍴[01 ]+$/u);
    expect(statements[2]).toBe('m←(⌽m)');
    // The fourth returns the matrix; without it there is nothing to parse.
    expect(statements[3]).toBe('m');
  });

  it('assigns a single track by index, counting from zero', () => {
    expect(statementsFor('⌽m[2;]', 2)[2]).toBe('m[2;]←(⌽m[2;])');
    expect(statementsFor('16⍴1', 0)[2]).toBe('m[0;]←(16⍴1)');
    expect(statementsFor('16⍴1', TRACK_COUNT - 1)[2]).toBe('m[7;]←(16⍴1)');
  });

  it('brackets the expression, so precedence cannot reach the assignment', () => {
    /*
     * The reason almost nothing needs forbidding. Whatever somebody writes, the parentheses
     * make the statement mean "assign this whole thing", so an expression that would otherwise
     * bind loosely cannot rewrite what it is being assigned to.
     */
    expect(statementsFor('1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16', 3)[2]).toBe(
      'm[3;]←(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16)',
    );
  });

  it('does not alter what was written', () => {
    // Spacing inside an expression is the author's business, not this application's.
    const spaced = 'm[1;] ∨ 2 ⌽ m[1;]';
    expect(statementsFor(spaced, 4)[2]).toBe(`m[4;]←(${spaced})`);
  });

  it('trims the outside, and only the outside', () => {
    const source = buildCustomSource({ core: '   ⌽m   ', target: 'all', pattern: GROOVE });
    expect(source.core).toBe('⌽m');
    expect(source.statements[2]).toBe('m←(⌽m)');
  });

  it('carries the current pattern, not a remembered one', () => {
    const edited = setCell(GROOVE, 7, 3, true);
    const before = statementsFor('⌽m')[1];
    const after = buildCustomSource({ core: '⌽m', target: 'all', pattern: edited }).statements[1];
    expect(after).not.toBe(before);
  });

  it('joins the statements with the diamond, as the wire format needs', () => {
    const source = buildCustomSource({ core: '⌽m', target: 'all', pattern: GROOVE });
    expect(source.expression).toBe(source.statements.join(' ⋄ '));
    expect(source.expression.endsWith(' ⋄ m')).toBe(true);
  });
});

/* ------------------------------------------------------------------------- */

describe('what Explore refuses to send', () => {
  it('accepts an ordinary expression', () => {
    for (const good of ['⌽m', '¯2⌽m[0;]', 'm[1;]∨2⌽m[1;]', '0=2|⍳16', '8 16⍴0', '~m', 'm[0;],m[1;]']) {
      expect(checkCustomExpression(good), good).toEqual({ ok: true, core: good });
    }
  });

  it('refuses nothing at all, and says what to do about it', () => {
    for (const empty of ['', '   ', '\t']) {
      const check = checkCustomExpression(empty);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toMatch(/nothing to run/iu);
    }
  });

  it('refuses a diamond, because it would add statements of its own', () => {
    /*
     * The one that matters most. `⌽m ⋄ 0` would make the request return a scalar instead of a
     * matrix, and the parser would reject the reply with no useful explanation of why.
     */
    const check = checkCustomExpression('⌽m ⋄ 0');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('⋄');
  });

  it('refuses a comment, because it would swallow the statement that returns the matrix', () => {
    const check = checkCustomExpression('⌽m ⍝ backwards');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('⍝');
  });

  it('refuses more than one line', () => {
    for (const multiline of ['⌽m\n⌽m', '⌽m\r\n0']) {
      const check = checkCustomExpression(multiline);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toMatch(/one line/iu);
    }
  });

  it('refuses a session command, rather than letting Dyalog say SYNTAX ERROR', () => {
    for (const command of [')CLEAR', ')OFF', ']boxing on']) {
      const check = checkCustomExpression(command);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toMatch(/session command/iu);
    }
  });

  it('refuses an expression longer than the limit, and says by how much', () => {
    const long = '1'.repeat(MAX_CUSTOM_LENGTH + 1);
    const check = checkCustomExpression(long);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain(String(MAX_CUSTOM_LENGTH + 1));
      expect(check.reason).toContain(String(MAX_CUSTOM_LENGTH));
    }
  });

  it('accepts an expression exactly at the limit', () => {
    expect(checkCustomExpression('1'.repeat(MAX_CUSTOM_LENGTH)).ok).toBe(true);
  });

  it('measures glyphs the way a person counts them', () => {
    // Code points, not UTF-16 units: a line of APL is not twice as long as it looks.
    expect(checkCustomExpression('⌽'.repeat(MAX_CUSTOM_LENGTH)).ok).toBe(true);
    expect(checkCustomExpression('⌽'.repeat(MAX_CUSTOM_LENGTH + 1)).ok).toBe(false);
  });

  it('does not pretend to be a security boundary', () => {
    /*
     * `⎕SH` and friends are deliberately *not* refused here. TryAPL is the sandbox and refuses
     * them itself; a blacklist in this file would be theatre, and the kind that gets trusted.
     * This test exists so that nobody later mistakes the absence for an oversight.
     */
    expect(checkCustomExpression('⎕SH ⍝x').ok).toBe(false); // the comment, not the ⎕SH
    expect(checkCustomExpression('⎕AV').ok).toBe(true);
  });
});

/* ------------------------------------------------------------------------- */

describe('the contract shown beside the editor', () => {
  it('asks for a matrix when the result goes to every track', () => {
    expect(customContract('all')).toMatch(/8 × 16 matrix/u);
  });

  it('asks for a row when it goes to one', () => {
    expect(customContract(3)).toMatch(/16 values/u);
    expect(customContract(3)).not.toMatch(/matrix/u);
  });
});

describe('the targets Explore offers', () => {
  it('includes every track and the whole matrix', () => {
    expect(everyTarget()).toEqual(['all', 0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('is wider than the built-in operations allow', () => {
    /*
     * Periodic and Euclidean refuse "all tracks" because they replace a row, and eight identical
     * rows is a mistake with eight voices. Somebody writing their own expression may perfectly
     * well mean to build a whole matrix, so Explore does not inherit that restriction.
     */
    expect(everyTarget()).toContain('all');
    expect(everyTarget()).toHaveLength(TRACK_COUNT + 1);
  });
});

/* ------------------------------------------------------------------------- */

describe('the cache key for a hand-written expression', () => {
  const key = (core: string, target: 'all' | number = 'all', pattern = GROOVE) =>
    customCacheKey({ core, target, pattern });

  it('is the same for the same question', () => {
    expect(key('⌽m')).toBe(key('⌽m'));
  });

  it('changes with the expression', () => {
    expect(key('⌽m')).not.toBe(key('¯1⌽m'));
  });

  it('changes with the target', () => {
    expect(key('16⍴1', 0)).not.toBe(key('16⍴1', 1));
  });

  it('changes with the pattern', () => {
    expect(key('⌽m')).not.toBe(key('⌽m', 'all', setCell(GROOVE, 0, 5, true)));
  });

  it('treats whitespace as significant rather than guessing', () => {
    /*
     * Normalising would mean knowing which whitespace APL considers meaningless, which this
     * application does not and should not claim to. Two spaces instead of one costs one extra
     * request; guessing wrong would hand back the answer to a different program.
     */
    expect(key('⌽ m')).not.toBe(key('⌽m'));
  });

  it('cannot collide with a generated transform', () => {
    expect(key('⌽m').startsWith('custom|')).toBe(true);
  });
});
