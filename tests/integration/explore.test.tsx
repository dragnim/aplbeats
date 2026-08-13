import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AplError, type AplClient, type AplExecution } from '@/apl/client';
import { useTransform } from '@/apl/useTransform';
import { TransformPanel } from '@/components/TransformPanel';
import { createInitialGroove } from '@/pattern/initialGroove';
import { setCell, type Pattern } from '@/pattern/pattern';

/*
 * Explore: the editor, and above all *when it asks TryAPL anything*.
 *
 * The promise Stage 3 made was that one deliberate press meant at most one request. Stage 5 puts
 * a text box next to that promise, which is the most dangerous thing it could have done — a box
 * somebody types in is a box that could fire a request per keystroke. So most of this file is a
 * count: type, insert glyphs, change the target, open and close things, and assert zero.
 *
 * The other half is staleness, which now has two forms. The pattern can move under a request, as
 * before; and the *code* can move under it too, which is new. A result must never appear beneath
 * an expression that did not produce it.
 */

const GROOVE = createInitialGroove();

/** Eight lines of sixteen digits, as the live service formats a Boolean matrix. */
function reply(pattern: Pattern): string[] {
  return pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join(' '));
}

/** The matrix out of an expression, so a fake can transform what it was actually sent. */
function matrixIn(expression: string): Pattern {
  const literal = /8 16⍴([01 ]+)/u.exec(expression)?.[1] ?? '';
  const values = literal.trim().split(' ');
  return Array.from({ length: 8 }, (_unused, track) =>
    Array.from({ length: 16 }, (_alsoUnused, step) => values[track * 16 + step] === '1'),
  );
}

interface Counting {
  readonly client: AplClient;
  /** Every expression received, in order. Its length is the request count. */
  readonly calls: string[];
  /** Let a held request finish. */
  readonly release: () => void;
}

/**
 * A client that counts, and can be held open.
 *
 * `hold` is what makes the staleness tests possible: a reply that arrives before the test can
 * change anything proves nothing about what happens when it arrives after.
 */
function countingClient(
  answer: (expression: string) => string[] | Error,
  options: { readonly hold?: boolean } = {},
): Counting {
  const calls: string[] = [];
  const waiting: (() => void)[] = [];

  const client: AplClient = {
    execute: (expression: string): Promise<AplExecution> => {
      calls.push(expression);
      const settle = (): AplExecution | Error => {
        const result = answer(expression);
        return result instanceof Error ? result : { outputLines: result, durationMs: 1 };
      };

      if (options.hold !== true) {
        const result = settle();
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      }

      return new Promise((resolve, reject) => {
        waiting.push(() => {
          const result = settle();
          if (result instanceof Error) reject(result);
          else resolve(result);
        });
      });
    },
    cancel: () => undefined,
  };

  return {
    client,
    calls,
    release: () => {
      for (const go of waiting.splice(0)) go();
    },
  };
}

/**
 * A client that refuses the way the real one refuses an APL error.
 *
 * The interpreter's objections are detected in `TryAplClient`, not in the service — an error
 * arrives as HTTP 200 and is recognised by reading the output — so a fake that merely returned
 * the error lines would be parsed as a malformed matrix and prove nothing. This rejects with
 * exactly what the real client would have thrown.
 */
function refusing(lines: readonly string[]): Counting {
  const calls: string[] = [];
  return {
    calls,
    release: () => undefined,
    client: {
      execute: (expression: string) => {
        calls.push(expression);
        return Promise.reject(
          new AplError('aplError', 'APL could not run that. Your beat was not changed.', lines[0], lines),
        );
      },
      cancel: () => undefined,
    },
  };
}

/** A fake that reverses whatever matrix it is given, along the time axis. */
function reversing(options: { readonly hold?: boolean } = {}): Counting {
  return countingClient(
    (expression) => reply(matrixIn(expression).map((row) => [...row].reverse())),
    options,
  );
}

/** A harness that owns the pattern, so running really does change it. */
function Harness({ client, initial = GROOVE }: { client: AplClient; initial?: Pattern }): React.JSX.Element {
  const [pattern, setPattern] = useState<Pattern>(initial);
  const transform = useTransform({ pattern, client, onApply: setPattern });

  return (
    <>
      <TransformPanel transform={transform} pattern={pattern} />
      <div data-testid="bits">
        {pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('')}
      </div>
    </>
  );
}

function bitsOf(pattern: Pattern): string {
  return pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('');
}

const editor = (): HTMLTextAreaElement =>
  screen.getByRole('textbox', { name: 'Your APL expression' }) as HTMLTextAreaElement;
const runButton = () => screen.getByRole('button', { name: 'Run this APL' });
const exploreStatus = () => screen.getByRole('status', { name: 'Explore' });
const grid = () => screen.getByTestId('bits').textContent ?? '';

/**
 * Type APL, including its brackets.
 *
 * `user.type` reads `[` and `{` as its own keyboard syntax — `[Enter]`, `{Shift}` — so a line of
 * APL with an index in it parses as a key description and throws. Doubling them is the documented
 * escape, and doing it here keeps the tests reading like the APL they are typing.
 */
async function typeCode(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.type(editor(), text.replaceAll('[', '[[').replaceAll('{', '{{'));
}

/** Open Peek, then Explore. Neither costs a request. */
async function openExplore(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
  await user.click(screen.getByRole('button', { name: 'Edit this APL' }));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------- */

describe('getting to Explore', () => {
  it('is reached from inside Peek, and costs nothing to open', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);

    // Not there until Peek is open: Explore is the second step of a progression.
    expect(screen.queryByRole('button', { name: 'Edit this APL' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
    expect(screen.getByRole('button', { name: 'Edit this APL' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your APL expression' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit this APL' }));
    expect(editor()).toBeInTheDocument();

    expect(calls).toEqual([]);
  });

  it('starts from the expression that would really have run', async () => {
    /*
     * The whole argument of the feature. If the editor opened on a teaching approximation, the
     * first edit would teach somebody something false about their own beat.
     */
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);

    await user.selectOptions(screen.getByLabelText('Target'), '0');
    await user.selectOptions(screen.getByLabelText('Operation'), 'rotate');
    await openExplore(user);

    const shown = screen.getAllByText('¯1⌽m[0;]');
    expect(shown.length).toBeGreaterThan(0);
    expect(editor()).toHaveValue('¯1⌽m[0;]');
  });

  it('follows the fixed controls while it is untouched', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);

    await user.selectOptions(screen.getByLabelText('Target'), '0');
    await openExplore(user);
    expect(editor()).toHaveValue('¯1⌽m[0;]');

    await user.selectOptions(screen.getByLabelText('Operation'), 'reverse');
    expect(editor()).toHaveValue('⌽m[0;]');

    await user.selectOptions(screen.getByLabelText('Operation'), 'euclidean');
    expect(editor()).toHaveValue('5>16|5×⍳16');

    expect(calls).toEqual([]);
  });
});

describe('nothing asks APL until Run is pressed', () => {
  it('typing makes no request, however much of it there is', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.clear(editor());
    await typeCode(user, '¯2⌽m[0;]');
    await typeCode(user, '∨m[1;]');

    expect(editor()).toHaveValue('¯2⌽m[0;]∨m[1;]');
    expect(calls).toEqual([]);
  });

  it('inserting glyphs makes no request', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    for (const glyph of ['⌽', '⍳', '⍴', '∨']) {
      await user.click(screen.getByRole('button', { name: new RegExp(`^Insert ${glyph}`, 'u') }));
    }
    expect(calls).toEqual([]);
  });

  it('changing where the result goes makes no request', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.selectOptions(screen.getByLabelText('Result goes to'), '3');
    await user.selectOptions(screen.getByLabelText('Result goes to'), 'all');
    expect(calls).toEqual([]);
  });

  it('loading the current transform makes no request', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.clear(editor());
    await typeCode(user, '⌽m');
    await user.click(screen.getByRole('button', { name: 'Load current transform' }));

    expect(editor()).toHaveValue('¯1⌽m');
    expect(calls).toEqual([]);
  });

  it('one press of Run is one request', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.click(runButton());
    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('Applied.');
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('m←(¯1⌽m)');
  });
});

describe('the keyboard shortcut', () => {
  it('runs on Ctrl+Enter, and on Cmd+Enter', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    editor().focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });

    // A different expression, so the second run is not simply answered from the cache.
    await user.clear(editor());
    await typeCode(user, '⌽m');
    editor().focus();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
  });

  it('does not run on plain Enter', async () => {
    // A box somebody writes in. A stray newline must not spend anyone's compute.
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    editor().focus();
    await user.keyboard('{Enter}');
    expect(calls).toEqual([]);
  });

  it('cannot be held down to make a request storm', async () => {
    /*
     * A held key repeats the keydown, and every repeat calls run. The busy guard is what stops
     * that becoming forty requests, and this is the test that proves it rather than assuming it.
     */
    const user = userEvent.setup();
    const { client, calls, release } = reversing({ hold: true });
    render(<Harness client={client} />);
    await openExplore(user);

    editor().focus();
    await user.keyboard('{Control>}{Enter}{Enter}{Enter}{Enter}{Enter}{Enter}{/Control}');

    expect(calls).toHaveLength(1);
    release();
    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('Applied.');
    });
    expect(calls).toHaveLength(1);
  });
});

describe('one execution lane', () => {
  it('will not start an Explore run while a fixed transform is in flight', async () => {
    const user = userEvent.setup();
    const { client, calls, release } = reversing({ hold: true });
    render(<Harness client={client} />);
    await openExplore(user);

    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));
    expect(calls).toHaveLength(1);

    // The editor is still usable — the network must not freeze somebody's writing — but Run
    // cannot start a second request.
    await user.click(runButton());
    expect(calls).toHaveLength(1);

    release();
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'APL transform' })).toHaveTextContent('Applied.');
    });
  });

  it('will not start a fixed transform while an Explore run is in flight', async () => {
    const user = userEvent.setup();
    const { client, calls, release } = reversing({ hold: true });
    render(<Harness client={client} />);
    await openExplore(user);

    await user.click(runButton());
    expect(calls).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));
    expect(calls).toHaveLength(1);

    release();
    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('Applied.');
    });
  });

  it('reports each outcome under the control that caused it', async () => {
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));
    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'APL transform' })).toHaveTextContent('Applied.');
    });
    // Explore said nothing, because Explore did nothing.
    expect(exploreStatus()).toHaveTextContent('');
  });
});

describe('the cache', () => {
  it('answers the same expression on the same bar without asking again', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.clear(editor());
    await typeCode(user, '⌽m');

    // Reverse it: one request, and the bar is now backwards.
    await user.click(runButton());
    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('Applied.');
    });
    expect(calls).toHaveLength(1);

    /*
     * Reverse it again. A different bar, so a different question and a second request — and it
     * puts the groove back exactly where it started.
     */
    await user.click(runButton());
    await waitFor(() => {
      expect(grid()).toBe(bitsOf(GROOVE));
    });
    expect(calls).toHaveLength(2);

    // Now the same expression on the same bar as the very first run. Answered from memory.
    await user.click(runButton());
    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('Applied, from cache.');
    });
    expect(calls).toHaveLength(2);
  });

  it('asks again for a different expression', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.click(runButton());
    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('Applied.');
    });

    await user.clear(editor());
    await typeCode(user, '⌽m');
    await user.click(runButton());
    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('Applied.');
    });
    expect(calls).toHaveLength(2);
  });
});

describe('a result must never lie about the code that produced it', () => {
  it('is discarded if the expression changed while it was running', async () => {
    /*
     * The staleness case Stage 5 adds. Editing during a run is deliberately allowed — the
     * network should not freeze somebody's writing — so the reply is what gets dropped.
     */
    const user = userEvent.setup();
    const { client, calls, release } = reversing({ hold: true });
    render(<Harness client={client} />);
    await openExplore(user);

    const before = grid();
    await user.click(runButton());
    expect(exploreStatus()).toHaveTextContent('Running APL…');

    await user.clear(editor());
    await typeCode(user, '⌽m[0;]');

    release();
    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('');
    });

    // The beat is untouched, and nothing claimed the new expression did anything.
    expect(grid()).toBe(before);
    expect(calls).toHaveLength(1);
  });

  it('is discarded if the pattern changed while it was running', async () => {
    const user = userEvent.setup();
    const { client, release } = reversing({ hold: true });
    const initial = setCell(GROOVE, 7, 1, true);
    render(<Harness client={client} initial={initial} />);
    await openExplore(user);

    await user.click(runButton());
    expect(exploreStatus()).toHaveTextContent('Running APL…');

    // The pattern moves under the request — as Randomise or an edit would move it.
    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));

    release();
    await waitFor(() => {
      expect(exploreStatus()).not.toHaveTextContent('Applied');
    });
  });

  it('applies when neither moved', async () => {
    const user = userEvent.setup();
    const { client, release } = reversing({ hold: true });
    render(<Harness client={client} />);
    await openExplore(user);

    const before = grid();
    await user.click(runButton());
    release();

    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('Applied.');
    });
    expect(grid()).not.toBe(before);
    expect(grid()).toBe(bitsOf(GROOVE.map((row) => [...row].reverse())));
  });
});

describe('when the expression is wrong', () => {
  it('says so locally, without asking APL, and will not run', async () => {
    const user = userEvent.setup();
    const { client, calls } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.clear(editor());
    await typeCode(user, '⌽m ⋄ 0');

    expect(exploreStatus()).toHaveTextContent('⋄');
    expect(runButton()).toBeDisabled();

    await user.click(runButton()).catch(() => undefined);
    expect(calls).toEqual([]);
  });

  it('shows what Dyalog said, so the expression can be fixed', async () => {
    /*
     * The difference between Stage 3 and Stage 5. There, an APL error was the application's own
     * bug and detail was noise; here it belongs to the person reading it, and "APL could not run
     * that" without the word RANK and a caret would be actively unhelpful.
     */
    const user = userEvent.setup();
    const { client } = refusing([
      'RANK ERROR: Mismatched left and right argument ranks',
      '      m←(2 3⍴m)',
      '         ∧',
    ]);
    render(<Harness client={client} />);
    await openExplore(user);

    await user.clear(editor());
    await typeCode(user, '2 3⍴m');
    await user.click(runButton());

    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('APL could not run that');
    });
    // The error, the source and the caret — scoped to the error block, because ∧ is also a
    // glyph button and finding that one would prove nothing.
    const reported = document.querySelector('[class*="aplError"]')?.textContent ?? '';
    expect(reported).toContain('RANK ERROR');
    expect(reported).toContain('m←(2 3⍴m)');
    expect(reported).toContain('∧');
  });

  it('leaves the failed code exactly where it was', async () => {
    const user = userEvent.setup();
    const { client } = refusing(['SYNTAX ERROR', '      m←(⌽⌽)', '        ∧']);
    render(<Harness client={client} />);
    await openExplore(user);

    const before = grid();
    await user.clear(editor());
    await typeCode(user, '⌽⌽');
    await user.click(runButton());

    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('APL could not run that');
    });

    // Code unchanged, beat unchanged. Nothing to undo.
    expect(editor()).toHaveValue('⌽⌽');
    expect(grid()).toBe(before);
  });

  it('refuses a reply that is not a rhythm', async () => {
    const user = userEvent.setup();
    const { client } = countingClient(() => ['1 2 3', '4 5 6']);
    render(<Harness client={client} />);
    await openExplore(user);

    const before = grid();
    await user.click(runButton());

    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('APL sent something unexpected');
    });
    expect(grid()).toBe(before);
  });

  it('refuses values that are not 0 or 1', async () => {
    const user = userEvent.setup();
    const { client } = countingClient(() =>
      Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => '2').join(' ')),
    );
    render(<Harness client={client} />);
    await openExplore(user);

    const before = grid();
    await user.click(runButton());

    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('APL sent something unexpected');
    });
    expect(grid()).toBe(before);
  });

  it('reports a result that changed nothing rather than pretending it did', async () => {
    const user = userEvent.setup();
    const { client } = countingClient((expression) => reply(matrixIn(expression)));
    render(<Harness client={client} />);
    await openExplore(user);

    const before = grid();
    await user.click(runButton());

    await waitFor(() => {
      expect(exploreStatus()).toHaveTextContent('came back the same');
    });
    expect(grid()).toBe(before);
  });
});

describe('the draft', () => {
  it('is remembered, and never runs itself', async () => {
    const user = userEvent.setup();
    const first = reversing();
    const view = render(<Harness client={first.client} />);
    await openExplore(user);

    await user.clear(editor());
    await typeCode(user, 'm[1;]∨2⌽m[1;]');
    // The write is debounced.
    await new Promise((resolve) => setTimeout(resolve, 600));
    view.unmount();

    const second = reversing();
    render(<Harness client={second.client} />);
    await openExplore(user);

    expect(editor()).toHaveValue('m[1;]∨2⌽m[1;]');
    expect(second.calls).toEqual([]);
  });

  it('ignores a stored draft from a version it does not know', async () => {
    window.localStorage.setItem(
      'aplbeats.explore.v1',
      JSON.stringify({ schema: 99, expression: '⌽m', target: 'all' }),
    );
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    expect(editor()).toHaveValue('¯1⌽m');
  });

  it('ignores stored nonsense', async () => {
    window.localStorage.setItem('aplbeats.explore.v1', 'not json');
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    expect(editor()).toHaveValue('¯1⌽m');
  });
});

describe('the draft is not overwritten behind the visitor', () => {
  it('survives a change to the fixed controls once it has been edited', async () => {
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.clear(editor());
    await typeCode(user, 'm[1;]∨2⌽m[1;]');

    await user.selectOptions(screen.getByLabelText('Operation'), 'reverse');
    await user.selectOptions(screen.getByLabelText('Target'), '3');

    expect(editor()).toHaveValue('m[1;]∨2⌽m[1;]');
  });

  it('is replaced only by the button that says it will be', async () => {
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.clear(editor());
    await typeCode(user, '⌽m');
    await user.selectOptions(screen.getByLabelText('Target'), '2');
    await user.selectOptions(screen.getByLabelText('Operation'), 'reverse');
    expect(editor()).toHaveValue('⌽m');

    await user.click(screen.getByRole('button', { name: 'Load current transform' }));
    expect(editor()).toHaveValue('⌽m[2;]');
  });

  it('offers no way to lose work while it is still pristine', async () => {
    // Nothing to reload, because nothing has been written.
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    expect(screen.queryByRole('button', { name: 'Load current transform' })).not.toBeInTheDocument();
  });
});

describe('glyph insertion', () => {
  it('puts the glyph at the caret', async () => {
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.clear(editor());
    await typeCode(user, 'mm');
    editor().setSelectionRange(1, 1);

    await user.click(screen.getByRole('button', { name: /^Insert ⌽/u }));
    expect(editor()).toHaveValue('m⌽m');
  });

  it('replaces the selection, as typing would', async () => {
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.clear(editor());
    await typeCode(user, 'abc');
    editor().setSelectionRange(0, 3);

    await user.click(screen.getByRole('button', { name: /^Insert ⍳/u }));
    expect(editor()).toHaveValue('⍳');
  });

  it('leaves focus in the editor', async () => {
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    await user.click(screen.getByRole('button', { name: /^Insert ⌽/u }));
    expect(document.activeElement).toBe(editor());
  });

  it('names every glyph, not just draws it', async () => {
    const user = userEvent.setup();
    const { client } = reversing();
    render(<Harness client={client} />);
    await openExplore(user);

    const strip = screen.getByRole('group', { name: 'Insert an APL glyph' });
    const buttons = strip.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(10);
    for (const button of buttons) {
      const name = button.getAttribute('aria-label') ?? '';
      // A symbol and words: "Insert ⌽ — Rotate or reverse".
      expect(name, name).toMatch(/^Insert .+ — .+/u);
    }
  });
});
