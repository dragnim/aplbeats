import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aplNumber,
  buildAplSource,
  clampParameter,
  defaultTargetFor,
  isOperationId,
  isValidTarget,
  operationById,
  OPERATIONS,
  resolveParameters,
  targetName,
  type Operation,
  type Target,
} from '@/apl/operations';
import { createInitialGroove } from '@/pattern/initialGroove';
import { createPattern, setCell, TRACK_COUNT } from '@/pattern/pattern';

/*
 * The APL that gets sent.
 *
 * Two things are being established. That each operation produces the expression it claims to,
 * indexed at the right row, with ⎕IO←0 — and that nothing a visitor can type ends up inside
 * that expression as text. The second matters more: Stage 3 accepts no arbitrary APL, and the
 * way that is enforced is that the controls produce numbers, the numbers are clamped against
 * ranges declared in `operations.ts`, and only then are they formatted.
 */

const GROOVE = createInitialGroove();

function sourceFor(operation: Operation, target: Target, parameters = {}) {
  return buildAplSource({ operation, target, parameters, pattern: GROOVE });
}

describe('the transport statements', () => {
  it('set the index origin to zero, first', () => {
    /*
     * ⎕IO←0 is not a detail. The application is zero-indexed and so is the grid, so with it
     * set there is no ±1 anywhere between a track's row number on screen and its row number
     * in APL. It also makes the arithmetic read correctly: `0=4|⍳16` picks out every fourth
     * step *from the downbeat*, which under ⎕IO←1 it would not.
     */
    const source = sourceFor(operationById('reverse'), 'all');
    expect(source.statements[0]).toBe('⎕IO←0');
  });

  it('write the pattern down as an 8 × 16 matrix', () => {
    const source = sourceFor(operationById('reverse'), 'all');
    expect(source.statements[1]).toMatch(/^m←8 16⍴[01]( [01]){127}$/u);
  });

  it('end by handing the matrix back', () => {
    const source = sourceFor(operationById('reverse'), 'all');
    expect(source.statements[source.statements.length - 1]).toBe('m');
  });

  it('are sent as one expression joined with diamonds', () => {
    // TryAPL evaluates exactly one expression per request.
    const source = sourceFor(operationById('reverse'), 3);
    expect(source.expression).toBe(source.statements.join(' ⋄ '));
    expect(source.expression.split('⋄')).toHaveLength(4);
  });

  it('carry the pattern the visitor actually has, not a placeholder', () => {
    const pattern = setCell(createPattern(), 0, 0, true);
    const source = buildAplSource({
      operation: operationById('reverse'),
      target: 'all',
      parameters: {},
      pattern,
    });
    expect(source.statements[1]).toBe(`m←8 16⍴1${' 0'.repeat(127)}`);
  });
});

describe('rotate', () => {
  const rotate = operationById('rotate');

  it('rotates one track along the time axis', () => {
    const source = sourceFor(rotate, 2, { amount: -1 });
    expect(source.core).toBe('¯1⌽m[2;]');
    expect(source.statements[2]).toBe('m[2;]←¯1⌽m[2;]');
  });

  it('rotates the whole matrix when every track is targeted', () => {
    // `⌽` acts on the last axis, which for this matrix is time — so one expression rotates
    // all eight tracks without mentioning any of them.
    const source = sourceFor(rotate, 'all', { amount: 3 });
    expect(source.core).toBe('3⌽m');
    expect(source.statements[2]).toBe('m←3⌽m');
  });

  it('writes a negative amount with a high minus', () => {
    /*
     * `¯1` is a negative literal; `-1` is *negate one*. They happen to agree here, but the
     * second is not how APL is written, and Peek exists to show APL as APL is written.
     */
    expect(sourceFor(rotate, 0, { amount: -8 }).core).toBe('¯8⌽m[0;]');
    expect(sourceFor(rotate, 0, { amount: -8 }).core).not.toContain('-8');
  });
});

describe('reverse', () => {
  it('is a bare ⌽', () => {
    expect(sourceFor(operationById('reverse'), 4).core).toBe('⌽m[4;]');
    expect(sourceFor(operationById('reverse'), 'all').core).toBe('⌽m');
  });

  it('takes no parameters, so its source depends only on the target', () => {
    const once = sourceFor(operationById('reverse'), 4, { amount: 5, pulses: 9 });
    const twice = sourceFor(operationById('reverse'), 4, {});
    expect(once.core).toBe(twice.core);
  });
});

describe('periodic', () => {
  const periodic = operationById('periodic');

  it('builds a pulse from the step numbers', () => {
    expect(sourceFor(periodic, 2, { period: 4, rotation: 0 }).core).toBe('0=4|⍳16');
  });

  it('adds a rotation only when there is one', () => {
    // `0⌽x` is a no-op, and printing it in Peek would be noise pretending to be information.
    expect(sourceFor(periodic, 2, { period: 4, rotation: 0 }).core).not.toContain('⌽');
    expect(sourceFor(periodic, 2, { period: 4, rotation: 2 }).core).toBe('2⌽0=4|⍳16');
  });

  it('replaces the target row rather than combining with it', () => {
    expect(sourceFor(periodic, 6, { period: 3 }).statements[2]).toBe('m[6;]←0=3|⍳16');
  });

  it('cannot be applied to every track at once', () => {
    // It replaces a row, so all eight would come out identical — which is not a rhythm.
    expect(isValidTarget(periodic, 'all')).toBe(false);
    expect(periodic.allowsAllTracks).toBe(false);
  });
});

describe('euclidean', () => {
  const euclidean = operationById('euclidean');

  it('spreads the pulses with multiplication and a remainder', () => {
    expect(sourceFor(euclidean, 5, { pulses: 5, rotation: 0 }).core).toBe('5>16|5×⍳16');
  });

  it('takes a rotation', () => {
    expect(sourceFor(euclidean, 5, { pulses: 3, rotation: 7 }).core).toBe('7⌽3>16|3×⍳16');
  });

  it('cannot be applied to every track at once', () => {
    expect(isValidTarget(euclidean, 'all')).toBe(false);
  });
});

describe('parameters', () => {
  it('are clamped to the range the operation declares', () => {
    const rotate = operationById('rotate');
    const amount = rotate.parameters[0]!;

    expect(clampParameter(amount, 500)).toBe(amount.max);
    expect(clampParameter(amount, -500)).toBe(amount.min);
    expect(clampParameter(amount, 3)).toBe(3);
  });

  it('are rounded, so a fractional value cannot reach the source', () => {
    const euclidean = operationById('euclidean');
    const pulses = euclidean.parameters[0]!;
    expect(clampParameter(pulses, 5.7)).toBe(6);
    expect(sourceFor(euclidean, 0, { pulses: 5.7 }).core).toBe('6>16|6×⍳16');
  });

  it('fall back to the default for anything unusable', () => {
    const rotate = operationById('rotate');
    const amount = rotate.parameters[0]!;
    expect(clampParameter(amount, Number.NaN)).toBe(amount.defaultValue);
    expect(clampParameter(amount, Number.POSITIVE_INFINITY)).toBe(amount.defaultValue);
    expect(clampParameter(amount, undefined)).toBe(amount.defaultValue);
  });

  it('skip past zero where zero would be a no-op', () => {
    const rotate = operationById('rotate');
    const amount = rotate.parameters[0]!;
    expect(clampParameter(amount, 0)).not.toBe(0);
    expect(clampParameter(amount, 0.2)).toBe(1);
    expect(clampParameter(amount, -0.2)).toBe(-1);
  });

  it('are filled in from defaults when absent', () => {
    const resolved = resolveParameters(operationById('euclidean'), {});
    expect(resolved.pulses).toBe(5);
    expect(resolved.rotation).toBe(0);
  });
});

describe('nothing from the interface reaches the source as text', () => {
  it('ignores parameter keys the operation does not declare', () => {
    const source = sourceFor(operationById('reverse'), 1, {
      // A key that no operation uses. It must not appear anywhere.
      amount: 9,
      pulses: 9,
    });
    expect(source.expression).not.toContain('9');
  });

  it('produces a source made only of digits, glyphs and the fixed template', () => {
    /*
     * The strongest statement this file can make. Every operation, every target, and the
     * extremes of every parameter — and the result never contains a character that could
     * begin a string, a comment, an execute or a system command.
     */
    /*
     * Characters that could change what the expression *is*, rather than what it computes.
     * Brackets are not among them: they are structure the templates produce themselves, and
     * the allowlist at the end of the loop is what actually bounds the character set.
     */
    const forbidden = ["'", '"', '⍎', '⍕', '⍝', '#', '⎕SH', '⎕CMD', '⎕NA', '∘', ':', '('];

    for (const operation of OPERATIONS) {
      const targets: Target[] = [
        ...(operation.allowsAllTracks ? (['all'] as Target[]) : []),
        0,
        3,
        TRACK_COUNT - 1,
      ];

      for (const target of targets) {
        for (const extreme of [-1e9, -1, 0, 1, 1e9, Number.NaN]) {
          const parameters = Object.fromEntries(operation.parameters.map((spec) => [spec.key, extreme]));
          const source = buildAplSource({ operation, target, parameters, pattern: GROOVE });

          for (const needle of forbidden) {
            expect(
              source.expression,
              `${operation.id}/${String(target)}/${String(extreme)} contained ${needle}`,
            ).not.toContain(needle);
          }

          // Only the characters the templates can produce.
          expect(source.expression).toMatch(/^[0-9 ⎕IO←⋄m⍴[\];⌽⍳|×>=¯]+$/u);
        }
      }
    }
  });

  it('is deterministic', () => {
    for (const operation of OPERATIONS) {
      const target: Target = operation.allowsAllTracks ? 'all' : 2;
      const once = buildAplSource({ operation, target, parameters: {}, pattern: GROOVE });
      const twice = buildAplSource({ operation, target, parameters: {}, pattern: GROOVE });
      expect(twice.expression).toBe(once.expression);
    }
  });
});

describe('targets', () => {
  it('accept every track row and nothing else', () => {
    const rotate = operationById('rotate');
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      expect(isValidTarget(rotate, track)).toBe(true);
    }
    expect(isValidTarget(rotate, TRACK_COUNT)).toBe(false);
    expect(isValidTarget(rotate, -1)).toBe(false);
    expect(isValidTarget(rotate, 1.5)).toBe(false);
  });

  it('move to something usable when an operation cannot accept the current one', () => {
    // Choosing Periodic while "All tracks" is selected must not leave Apply refusing.
    expect(defaultTargetFor(operationById('periodic'), 'all')).toBe(0);
    expect(defaultTargetFor(operationById('euclidean'), 'all')).toBe(0);
    // And a track already chosen is kept, whichever operation is picked.
    expect(defaultTargetFor(operationById('periodic'), 4)).toBe(4);
    expect(defaultTargetFor(operationById('rotate'), 4)).toBe(4);
    expect(defaultTargetFor(operationById('reverse'), 'all')).toBe('all');
  });

  it('read as track names', () => {
    expect(targetName('all')).toBe('All tracks');
    expect(targetName(0)).toBe('Kick');
    expect(targetName(7)).toBe('Rim');
  });
});

describe('operation identifiers', () => {
  it('are recognised, and anything else is not', () => {
    expect(isOperationId('rotate')).toBe(true);
    expect(isOperationId('nope')).toBe(false);
    expect(isOperationId(7)).toBe(false);
  });

  it('fall back to a real operation for an unknown name', () => {
    expect(operationById('nonsense').id).toBe(OPERATIONS[0]!.id);
  });
});

describe('aplNumber', () => {
  it('writes negatives with a high minus and positives plainly', () => {
    expect(aplNumber(0)).toBe('0');
    expect(aplNumber(7)).toBe('7');
    expect(aplNumber(-7)).toBe('¯7');
    expect(aplNumber(-0.4)).toBe('0');
  });
});

describe('the reference implementations stay out of production', () => {
  it('are imported by no module under src/', () => {
    /*
     * The test that keeps Stage 3 honest, and Stage 8 with it.
     *
     * `src/apl/reference.ts` and `src/apl/toneReference.ts` contain TypeScript that does what the
     * APL does, and they exist so tests can assert what the expressions mean. If any module under
     * `src/` ever imported one, a transform could silently be computed locally while the button
     * still said "Apply with APL" — which would make the central claim of this stage false.
     * Cheaper to forbid than to review.
     *
     * Both files, because the melody side has exactly the same temptation and exactly the same
     * cost: a Tone transform quietly computed here would be a lie told in a nicer font.
     */
    const REFERENCES = ['reference.ts', 'toneReference.ts'];
    const offenders: string[] = [];

    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/u.test(entry)) continue;
        if (REFERENCES.some((name) => path.endsWith(join('apl', name)))) continue;

        const contents = readFileSync(path, 'utf8');
        if (
          /from\s+['"][^'"]*apl\/(tone)?[Rr]eference['"]/u.test(contents) ||
          /['"]\.\/(tone)?[Rr]eference['"]/u.test(contents)
        ) {
          offenders.push(path);
        }
      }
    };

    walk('src');
    expect(offenders).toEqual([]);
  });
});
