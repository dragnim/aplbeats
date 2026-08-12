import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AplError, type AplClient, type AplExecution } from '@/apl/client';
import { useTransform } from '@/apl/useTransform';
import { TransformPanel } from '@/components/TransformPanel';
import { applyReferenceTransform } from '@/apl/reference';
import { operationById } from '@/apl/operations';
import { createInitialGroove } from '@/pattern/initialGroove';
import { setCell, type Pattern } from '@/pattern/pattern';

/*
 * The panel, the hook, and above all *when a request happens*.
 *
 * The promise made to TryAPL is that one deliberate action means at most one request, and that
 * nothing else in the application can cause one. That is a claim about the interface rather than
 * about the network layer, so it is tested here: choose an operation, change a target, drag a
 * number, open Peek, and count the requests. The answer must be zero until Apply is pressed.
 */

const GROOVE = createInitialGroove();

/** A client that counts requests and answers as instructed. */
function countingClient(answer: (expression: string) => string[] | Error, delayMs = 0) {
  const calls: string[] = [];

  const client: AplClient = {
    execute: (expression: string): Promise<AplExecution> => {
      calls.push(expression);
      const result = answer(expression);
      const settle = (): AplExecution => {
        if (result instanceof Error) throw result;
        return { outputLines: result, durationMs: 1 };
      };

      if (delayMs === 0) {
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(settle());
      }
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (result instanceof Error) reject(result);
          else resolve(settle());
        }, delayMs);
      });
    },
    cancel: () => undefined,
  };

  return { client, calls };
}

/** Eight lines of sixteen digits, as the live service formats a Boolean matrix. */
function reply(pattern: Pattern): string[] {
  return pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join(' '));
}

/**
 * The matrix out of an expression, as APL would read it.
 *
 * Lets a fake client behave like the real one — transforming whatever it was actually sent
 * rather than returning a fixed answer, which is the only way a cache test can be trusted.
 */
function matrixIn(expression: string): Pattern {
  const literal = /8 16⍴([01 ]+)/u.exec(expression)?.[1] ?? '';
  const values = literal.trim().split(' ');
  return Array.from({ length: 8 }, (_unused, track) =>
    Array.from({ length: 16 }, (_alsoUnused, step) => values[track * 16 + step] === '1'),
  );
}

/** A fake that reverses whatever matrix it is given, along the time axis. */
function reversingClient() {
  return countingClient((expression) => reply(matrixIn(expression).map((row) => [...row].reverse())));
}

/**
 * A harness that owns the pattern, so applying a transform really does change it.
 *
 * `onApply` is a spy as well, so the tests can assert both that the pattern moved and that it
 * moved exactly once.
 */
function Harness({
  client,
  onApplied,
  initial = GROOVE,
}: {
  client: AplClient;
  onApplied?: (pattern: Pattern) => void;
  initial?: Pattern;
}): React.JSX.Element {
  const [pattern, setPattern] = useState<Pattern>(initial);
  const transform = useTransform({
    pattern,
    client,
    onApply: (next) => {
      setPattern(next);
      onApplied?.(next);
    },
  });

  return (
    <>
      <TransformPanel transform={transform} pattern={pattern} />
      {/*
        A compact rendering of the current bar, so a test can see it change.

        A plain div, not an `<output>`: that element carries an implicit `role="status"`, which
        would make the harness a second live region competing with the panel's own — and would
        make `getByRole('status')` ambiguous for the wrong reason.
      */}
      <div data-testid="bits">
        {pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('')}
      </div>
    </>
  );
}

function bitsOf(pattern: Pattern): string {
  return pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('');
}

describe('nothing asks APL until Apply is pressed', () => {
  it('renders without a request', () => {
    const { client, calls } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);
    expect(calls).toHaveLength(0);
  });

  it('changing the operation makes no request', async () => {
    const user = userEvent.setup();
    const { client, calls } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    await user.selectOptions(screen.getByLabelText('Operation'), 'euclidean');
    await user.selectOptions(screen.getByLabelText('Operation'), 'periodic');
    await user.selectOptions(screen.getByLabelText('Operation'), 'reverse');
    expect(calls).toHaveLength(0);
  });

  it('changing the target makes no request', async () => {
    const user = userEvent.setup();
    const { client, calls } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    await user.selectOptions(screen.getByLabelText('Target'), '3');
    await user.selectOptions(screen.getByLabelText('Target'), '5');
    expect(calls).toHaveLength(0);
  });

  it('changing a parameter makes no request, however many times it moves', async () => {
    /*
     * The one that matters most. A slider that requested as it moved is exactly what this
     * project promised not to build, and the reason the parameters are spinners rather than
     * sliders — but the guarantee has to be in the code, not in the choice of control.
     */
    const user = userEvent.setup();
    const { client, calls } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    const steps = screen.getByLabelText('Steps');
    for (const value of ['1', '2', '3', '4', '5', '6', '7', '8']) {
      await user.clear(steps);
      await user.type(steps, value);
    }
    expect(calls).toHaveLength(0);
  });

  it('opening Peek makes no request', async () => {
    // The APL shown is built from a template in the browser, so it costs nothing to look at.
    const user = userEvent.setup();
    const { client, calls } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
    expect(screen.getByText('Core APL')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('shows the APL for the current settings before anything is sent', async () => {
    const user = userEvent.setup();
    const { client, calls } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
    expect(screen.getByText('¯1⌽m')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Operation'), 'euclidean');
    await user.selectOptions(screen.getByLabelText('Target'), '5');
    expect(screen.getByText('5>16|5×⍳16')).toBeInTheDocument();

    expect(calls).toHaveLength(0);
  });
});

describe('Apply', () => {
  it('makes exactly one request and installs the result', async () => {
    const user = userEvent.setup();
    const expected = applyReferenceTransform(operationById('rotate'), 'all', { amount: -1 }, GROOVE);
    const { client, calls } = countingClient(() => reply(expected));
    const onApplied = vi.fn();

    render(<Harness client={client} onApplied={onApplied} />);
    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));

    await waitFor(() => {
      expect(screen.getByTestId('bits')).toHaveTextContent(bitsOf(expected));
    });
    expect(calls).toHaveLength(1);
    expect(onApplied).toHaveBeenCalledOnce();
    expect(await screen.findByText('Applied.')).toBeInTheDocument();
  });

  it('is ignored while a request is already in flight', async () => {
    // A held key or an impatient double press must not become a request storm.
    const user = userEvent.setup();
    const { client, calls } = countingClient(() => reply(GROOVE), 40);
    render(<Harness client={client} />);

    const apply = screen.getByRole('button', { name: 'Apply with APL' });
    await user.click(apply);
    // Disabled while running, and the hook refuses a second attempt regardless.
    expect(apply).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply with APL' })).toBeEnabled();
    });
    expect(calls).toHaveLength(1);
  });

  it('answers an identical second press from the cache', async () => {
    /*
     * Reverse is its own inverse, so pressing Apply three times asks two distinct questions and
     * then repeats the first — which is exactly the shape a cache has to get right. The fake
     * reverses whatever it is sent, so the sequence is genuine rather than staged.
     */
    const user = userEvent.setup();
    const { client, calls } = reversingClient();

    render(<Harness client={client} />);
    await user.selectOptions(screen.getByLabelText('Operation'), 'reverse');

    const reversed = bitsOf(GROOVE.map((row) => [...row].reverse()));

    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));
    await waitFor(() => {
      expect(screen.getByTestId('bits')).toHaveTextContent(reversed);
    });
    expect(calls).toHaveLength(1);

    // Reversing back: a different question, so a second request.
    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));
    await waitFor(() => {
      expect(screen.getByTestId('bits')).toHaveTextContent(bitsOf(GROOVE));
    });
    expect(calls).toHaveLength(2);

    // The third press repeats the first question exactly, and must not reach the service.
    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));
    await waitFor(() => {
      expect(screen.getByText('Applied, from cache.')).toBeInTheDocument();
    });
    expect(screen.getByTestId('bits')).toHaveTextContent(reversed);
    expect(calls).toHaveLength(2);
  });
});

describe('when APL will not answer', () => {
  it('leaves the beat alone and says so', async () => {
    const user = userEvent.setup();
    const { client } = countingClient(
      () => new AplError('unavailable', 'APL is unavailable right now. Your beat was not changed.'),
    );
    const onApplied = vi.fn();

    render(<Harness client={client} onApplied={onApplied} />);
    const before = screen.getByTestId('bits').textContent;

    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));

    expect(await screen.findByText(/APL is unavailable right now/u)).toBeInTheDocument();
    expect(screen.getByTestId('bits').textContent).toBe(before);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('leaves the beat alone when the reply is malformed', async () => {
    const user = userEvent.setup();
    const { client } = countingClient(() => ['1 1 1', 'nonsense']);
    const onApplied = vi.fn();

    render(<Harness client={client} onApplied={onApplied} />);
    const before = screen.getByTestId('bits').textContent;

    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));

    expect(await screen.findByText(/unexpected/u)).toBeInTheDocument();
    expect(screen.getByTestId('bits').textContent).toBe(before);
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('reports an APL error without pasting it into the interface', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = countingClient(() => ['DOMAIN ERROR', '      m[9;]←⌽m[9;]', '      ∧']);

    render(<Harness client={client} />);
    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));

    // One sentence for the visitor; the raw detail goes to the console.
    expect(await screen.findByText(/Your beat was not changed/u)).toBeInTheDocument();
    expect(screen.queryByText(/DOMAIN ERROR/u)).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('lets a second attempt through after a failure', async () => {
    // No retry loop, but no lock-out either: the visitor decides whether to try again.
    const user = userEvent.setup();
    let attempt = 0;
    const { client, calls } = countingClient(() => {
      attempt += 1;
      return attempt === 1 ? new AplError('timeout', 'APL took too long to answer.') : reply(GROOVE);
    });

    render(<Harness client={client} />);
    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));
    expect(await screen.findByText(/took too long/u)).toBeInTheDocument();
    expect(calls).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
  });
});

describe('a stale reply', () => {
  it('does not overwrite a bar that has moved on', async () => {
    /*
     * The race the brief called out. The visitor presses Apply, edits a cell before the answer
     * arrives, and the answer — computed from a bar that no longer exists — must not land on top
     * of their edit.
     *
     * Simulated by having the harness change its own pattern while the request is in flight,
     * which is what an edit or a Randomise would do.
     */
    const user = userEvent.setup();
    const transformed = applyReferenceTransform(operationById('rotate'), 'all', { amount: -1 }, GROOVE);
    const { client } = countingClient(() => reply(transformed), 60);
    const onApplied = vi.fn();

    function Racing(): React.JSX.Element {
      const [pattern, setPattern] = useState<Pattern>(GROOVE);
      const transform = useTransform({
        pattern,
        client,
        onApply: (next) => {
          setPattern(next);
          onApplied(next);
        },
      });

      return (
        <>
          <TransformPanel transform={transform} pattern={pattern} />
          <button
            type="button"
            onClick={() => {
              setPattern((current) => setCell(current, 7, 0, true));
            }}
          >
            Edit a cell
          </button>
          <div data-testid="bits">{bitsOf(pattern)}</div>
        </>
      );
    }

    render(<Racing />);
    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));
    await user.click(screen.getByRole('button', { name: 'Edit a cell' }));

    const edited = bitsOf(setCell(GROOVE, 7, 0, true));
    expect(screen.getByTestId('bits')).toHaveTextContent(edited);

    // Wait past the reply, then confirm it was discarded rather than applied.
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Apply with APL' })).toBeEnabled();
      },
      { timeout: 2000 },
    );

    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.getByTestId('bits')).toHaveTextContent(edited);
  });
});

describe('the controls', () => {
  it('offer every track plus all tracks where the operation allows it', async () => {
    const user = userEvent.setup();
    const { client } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    const target = screen.getByLabelText('Target');
    expect(target).toHaveValue('all');

    // Euclidean replaces a row, so "all tracks" is not offered at all.
    await user.selectOptions(screen.getByLabelText('Operation'), 'euclidean');
    expect(screen.queryByRole('option', { name: 'All tracks' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Target')).toHaveValue('0');
    // Every individual track is still there.
    for (const name of ['Kick', 'Snare', 'Rim']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }

    // Choosing a track and then an operation that takes the whole matrix keeps the track,
    // rather than jumping to "all tracks" behind the visitor's back.
    await user.selectOptions(screen.getByLabelText('Target'), '3');
    await user.selectOptions(screen.getByLabelText('Operation'), 'rotate');
    expect(screen.getByLabelText('Target')).toHaveValue('3');
    expect(screen.getByRole('option', { name: 'All tracks' })).toBeInTheDocument();
  });

  it('name the operation in words, not only in glyphs', () => {
    const { client } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    for (const name of ['Rotate', 'Reverse', 'Periodic', 'Euclidean']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
  });

  it('expose the parameters each operation actually has', async () => {
    const user = userEvent.setup();
    const { client } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    expect(screen.getByLabelText('Steps')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Operation'), 'reverse');
    expect(screen.queryByLabelText('Steps')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Operation'), 'euclidean');
    expect(screen.getByLabelText('Hits')).toBeInTheDocument();
    expect(screen.getByLabelText('Shift')).toBeInTheDocument();
  });

  it('expose the pending state on the button and in a status region', async () => {
    const user = userEvent.setup();
    // Long enough that the assertions run while it is genuinely in flight rather than racing
    // userEvent's own awaits.
    const { client } = countingClient(() => reply(GROOVE), 300);
    render(<Harness client={client} />);

    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));

    const running = await screen.findByRole('button', { name: /Running APL/u });
    expect(running).toBeDisabled();
    expect(screen.getByRole('status', { name: 'APL transform' })).toHaveTextContent(/Running APL/u);
  });
});

describe('Peek', () => {
  it('exposes whether it is open', async () => {
    const user = userEvent.setup();
    const { client } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    const toggle = screen.getByRole('button', { name: 'Peek at the APL' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the selected track as a vector of ones and zeros', async () => {
    /*
     * The moment the penny is meant to drop. The kick fires on 0, 6, 10 and 14, and Peek shows
     * exactly that as data — not a picture of data, and not a simplified illustration.
     */
    const user = userEvent.setup();
    const { client } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    await user.selectOptions(screen.getByLabelText('Operation'), 'reverse');
    await user.selectOptions(screen.getByLabelText('Target'), '0');
    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));

    expect(screen.getByText('1 0 0 0 0 0 1 0 0 0 1 0 0 0 1 0')).toBeInTheDocument();
    expect(screen.getByText('Kick, right now')).toBeInTheDocument();
  });

  it('shows the full request, including the origin and the matrix', async () => {
    const user = userEvent.setup();
    const { client } = countingClient(() => reply(GROOVE));
    render(<Harness client={client} />);

    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));

    /*
     * The code block, not the prose beneath it.
     *
     * The note under Full request also mentions the index origin, so matching on the text alone
     * finds two elements — and picking either at random would risk a test that passes on the
     * explanation rather than on the code it is meant to be about.
     */
    const full = screen
      .getAllByText(/⎕IO←0/u)
      .find((node) => node.tagName.toLowerCase() === 'code')?.textContent;

    expect(full).toBeDefined();
    expect(full).toContain('⎕IO←0');
    expect(full).toContain('m←8 16⍴');
    expect(full).toMatch(/\nm$/u);
  });

  it('tracks the pattern, so the array shown is the array that would be sent', async () => {
    const user = userEvent.setup();
    const expected = applyReferenceTransform(operationById('reverse'), 0, {}, GROOVE);
    const { client } = countingClient(() => reply(expected));

    render(<Harness client={client} />);
    await user.selectOptions(screen.getByLabelText('Operation'), 'reverse');
    await user.selectOptions(screen.getByLabelText('Target'), '0');
    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
    await user.click(screen.getByRole('button', { name: 'Apply with APL' }));

    await waitFor(() => {
      // The kick reversed: 0,6,10,14 becomes 1,5,9,15.
      expect(screen.getByText('0 1 0 0 0 1 0 0 0 1 0 0 0 0 0 1')).toBeInTheDocument();
    });
  });
});
