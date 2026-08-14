import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AplError, type AplClient, type AplExecution } from '@/apl/client';
import { RECIPES } from '@/apl/generators';
import { useApl } from '@/apl/useApl';
import { CreatePanel } from '@/components/CreatePanel';
import { ExploreEditor } from '@/components/ExploreEditor';
import { createInitialGroove } from '@/pattern/initialGroove';
import { setCell, TRACK_COUNT, type Pattern } from '@/pattern/pattern';

/*
 * Create with APL, in a rendered page.
 *
 * Three things are being defended here and they are the ones most likely to rot quietly.
 *
 * **The request count.** Every control on this panel except one is free, and the only way to keep
 * that true is to count. A panel that made a request when the recipe changed would still look
 * and behave correctly; it would simply be spending somebody else's service on every click.
 *
 * **Staleness.** A generation is asynchronous, and unlike a transform it can be invalidated
 * without the pattern moving at all — by a lock, a recipe, or a seed. Those cases have no
 * natural symptom: the wrong bar just arrives and looks plausible.
 *
 * **One lane.** Three buttons, one request at a time, dropped rather than queued.
 */

const GROOVE = createInitialGroove();

const reply = (pattern: Pattern): string[] =>
  pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join(' '));

/** A bar unlike the opening groove, so an install is unmistakable. */
const GENERATED: Pattern = GROOVE.map((row, track) => row.map((_cell, step) => (track * 3 + step) % 5 === 0));

interface Deferred {
  readonly settle: (lines: string[]) => void;
  readonly fail: (error: Error) => void;
}

/** A client whose replies are released by the test, so a request can be held mid-flight. */
function controllableClient() {
  const calls: string[] = [];
  const pending: Deferred[] = [];
  const client: AplClient = {
    execute: (expression: string): Promise<AplExecution> => {
      calls.push(expression);
      return new Promise<AplExecution>((resolve, reject) => {
        pending.push({
          settle: (lines) => {
            resolve({ outputLines: lines, durationMs: 1 });
          },
          fail: reject,
        });
      });
    },
    cancel: () => undefined,
  };
  return { client, calls, pending };
}

/** A client that answers at once. */
function instantClient(lines: string[] = reply(GENERATED)) {
  const calls: string[] = [];
  const client: AplClient = {
    execute: (expression: string): Promise<AplExecution> => {
      calls.push(expression);
      return Promise.resolve({ outputLines: lines, durationMs: 1 });
    },
    cancel: () => undefined,
  };
  return { client, calls };
}

/**
 * The page, composed as `App` composes it: panel, and one editor beside it.
 *
 * The harness owns the pattern and the locks, so installing a result really changes the bar and
 * locking a track really reaches the hook.
 */
function Harness({
  client,
  initialLocks = [],
}: {
  client: AplClient;
  initialLocks?: readonly number[];
}): React.JSX.Element {
  const [pattern, setPattern] = useState<Pattern>(GROOVE);
  const [lockedRows, setLockedRows] = useState<readonly number[]>(initialLocks);
  const [exploreOpen, setExploreOpen] = useState(false);
  const transform = useApl({ pattern, lockedRows, client, onApply: setPattern });

  return (
    <>
      <CreatePanel
        transform={transform}
        exploreOpen={exploreOpen}
        onEditApl={() => {
          transform.explore.follow('create');
          setExploreOpen(true);
        }}
      />
      {exploreOpen && <ExploreEditor transform={transform} />}

      {/* Test-only controls, so the harness can move the world under a request in flight. */}
      <button
        type="button"
        onClick={() => {
          setPattern((current) => setCell(current, 7, 15, !(current[7]?.[15] ?? false)));
        }}
      >
        edit a cell
      </button>
      <button
        type="button"
        onClick={() => {
          setLockedRows((current) => (current.includes(0) ? [] : [0]));
        }}
      >
        toggle kick lock
      </button>
      <button
        type="button"
        onClick={() => {
          setLockedRows(Array.from({ length: TRACK_COUNT }, (_u, row) => row));
        }}
      >
        lock everything
      </button>
      <div data-testid="bits">
        {pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('')}
      </div>
    </>
  );
}

const bitsOf = (pattern: Pattern): string =>
  pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('');

const bits = () => screen.getByTestId('bits').textContent;
const generateButton = () => screen.getByRole('button', { name: 'Generate with APL' });
const createStatus = () => screen.getByRole('status', { name: 'APL generation' });

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

/* ------------------------------------------------------------------------- */

describe('what costs a request, and what does not', () => {
  it('makes none on render, on recipe changes, on seed typing or on New seed', async () => {
    const user = userEvent.setup();
    const { client, calls } = instantClient();
    render(<Harness client={client} />);

    expect(calls).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText('Recipe'), RECIPES[1]!.id);
    await user.clear(screen.getByLabelText('Seed'));
    await user.type(screen.getByLabelText('Seed'), '1234');
    await user.click(screen.getByRole('button', { name: 'New APL seed' }));

    // Peek is a local template, so opening it is free too.
    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));

    expect(calls).toHaveLength(0);
  });

  it('makes exactly one per Generate press', async () => {
    const user = userEvent.setup();
    const { client, calls } = instantClient();
    render(<Harness client={client} />);

    await user.click(generateButton());
    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('Generated.');
    });

    expect(calls).toHaveLength(1);
  });

  it('drops a second press while one is in flight rather than queueing it', async () => {
    const user = userEvent.setup();
    const { client, calls, pending } = controllableClient();
    render(<Harness client={client} />);

    await user.click(generateButton());
    expect(calls).toHaveLength(1);

    // Held down, clicked twice more. Neither may become a request.
    await user.click(generateButton());
    await user.click(generateButton());
    expect(calls).toHaveLength(1);

    act(() => {
      pending[0]?.settle(reply(GENERATED));
    });
    await waitFor(() => {
      expect(bits()).toBe(bitsOf(GENERATED));
    });
    expect(calls).toHaveLength(1);
  });

  it('will not start while Explore owns the lane', async () => {
    const user = userEvent.setup();
    const { client, calls, pending } = controllableClient();
    render(<Harness client={client} />);

    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
    await user.click(screen.getByRole('button', { name: 'Edit this APL' }));
    await user.click(screen.getByRole('button', { name: 'Run this APL' }));
    expect(calls).toHaveLength(1);

    await user.click(generateButton());
    expect(calls).toHaveLength(1);

    act(() => {
      pending[0]?.settle(reply(GENERATED));
    });
    await waitFor(() => {
      expect(bits()).toBe(bitsOf(GENERATED));
    });
  });
});

/* ------------------------------------------------------------------------- */

describe('a generated result', () => {
  it('installs the whole bar, and says so', async () => {
    const user = userEvent.setup();
    const { client } = instantClient();
    render(<Harness client={client} />);

    expect(bits()).toBe(bitsOf(GROOVE));
    await user.click(generateButton());

    await waitFor(() => {
      expect(bits()).toBe(bitsOf(GENERATED));
    });
    expect(createStatus()).toHaveTextContent('Generated.');
  });

  it('reports a second identical generation as coming from the cache', async () => {
    /*
     * Getting to "from cache" needs the bar to have moved *away* from the generated one first,
     * which is worth saying because the obvious version of this test does not work: generate
     * twice in a row and the second answer equals what is already on screen, so the honest
     * status is "that seed made no difference" rather than a claim about where it came from.
     *
     * Editing an unlocked cell is what separates the two. The cache key deliberately ignores
     * unlocked rows, so the question is unchanged and no request is made — while the *pattern*
     * has changed, so installing the cached answer is a real change worth reporting.
     */
    const user = userEvent.setup();
    const { client, calls } = instantClient();
    render(<Harness client={client} />);

    await user.click(generateButton());
    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('Generated.');
    });

    await user.click(screen.getByRole('button', { name: 'edit a cell' }));
    await user.click(generateButton());

    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('Generated, from cache.');
    });
    expect(calls).toHaveLength(1);
    expect(bits()).toBe(bitsOf(GENERATED));
  });

  it('says so plainly when the seed made no difference', async () => {
    const user = userEvent.setup();
    // APL returns the bar that is already on screen.
    const { client } = instantClient(reply(GROOVE));
    render(<Harness client={client} />);

    await user.click(generateButton());
    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('That seed made no difference to this beat.');
    });
    // And nothing was installed, so there is nothing useless to undo.
    expect(bits()).toBe(bitsOf(GROOVE));
  });

  it('leaves the beat exactly as it was when APL fails', async () => {
    const user = userEvent.setup();
    const { client, pending } = controllableClient();
    render(<Harness client={client} />);

    await user.click(generateButton());
    act(() => {
      pending[0]?.fail(new AplError('unavailable', 'APL is unavailable right now.'));
    });

    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('APL is unavailable right now.');
    });
    expect(bits()).toBe(bitsOf(GROOVE));
  });
});

/* ------------------------------------------------------------------------- */

describe('a reply that is no longer wanted', () => {
  /*
   * Four ways a generation goes stale, and three of them cannot be caught by comparing patterns
   * — which is exactly why they are here. Changing the recipe, the seed or a lock leaves the
   * current bar untouched, so a stale reply would install cleanly and look entirely plausible.
   */

  it('is discarded when the pattern moved under it', async () => {
    const user = userEvent.setup();
    const { client, pending } = controllableClient();
    render(<Harness client={client} />);

    await user.click(generateButton());
    await user.click(screen.getByRole('button', { name: 'edit a cell' }));
    const afterEdit = bits();

    act(() => {
      pending[0]?.settle(reply(GENERATED));
    });
    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('');
    });
    expect(bits()).toBe(afterEdit);
  });

  it('is discarded when the recipe changed under it', async () => {
    const user = userEvent.setup();
    const { client, pending } = controllableClient();
    render(<Harness client={client} />);

    await user.click(generateButton());
    await user.selectOptions(screen.getByLabelText('Recipe'), RECIPES[1]!.id);

    act(() => {
      pending[0]?.settle(reply(GENERATED));
    });
    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('');
    });
    expect(bits()).toBe(bitsOf(GROOVE));
  });

  it('is discarded when the seed changed under it', async () => {
    const user = userEvent.setup();
    const { client, pending } = controllableClient();
    render(<Harness client={client} />);

    await user.click(generateButton());
    await user.click(screen.getByRole('button', { name: 'New APL seed' }));

    act(() => {
      pending[0]?.settle(reply(GENERATED));
    });
    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('');
    });
    expect(bits()).toBe(bitsOf(GROOVE));
  });

  it('is discarded when a lock changed under it, though the bar did not move', async () => {
    const user = userEvent.setup();
    const { client, pending } = controllableClient();
    render(<Harness client={client} />);

    await user.click(generateButton());
    await user.click(screen.getByRole('button', { name: 'toggle kick lock' }));

    act(() => {
      pending[0]?.settle(reply(GENERATED));
    });
    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('');
    });
    expect(bits()).toBe(bitsOf(GROOVE));
  });
});

/* ------------------------------------------------------------------------- */

describe('locks', () => {
  it('sends the locked rows to APL, and the current bar with them', async () => {
    const user = userEvent.setup();
    const { client, calls } = instantClient();
    render(<Harness client={client} initialLocks={[0]} />);

    await user.click(generateButton());
    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('Generated.');
    });

    expect(calls[0]).toContain('g[0;]←m[0;]');
    expect(calls[0]).toContain('m←8 16⍴');
  });

  it('refuses to spend a request when every track is locked', async () => {
    const user = userEvent.setup();
    const { client, calls } = instantClient();
    render(<Harness client={client} />);

    await user.click(screen.getByRole('button', { name: 'lock everything' }));

    expect(generateButton()).toBeDisabled();
    expect(createStatus()).toHaveTextContent('Every track is locked');

    await user.click(generateButton());
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- */

describe('status ownership', () => {
  it('does not claim Explore’s result', async () => {
    const user = userEvent.setup();
    const { client } = instantClient();
    render(<Harness client={client} />);

    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
    await user.click(screen.getByRole('button', { name: 'Edit this APL' }));
    await user.click(screen.getByRole('button', { name: 'Run this APL' }));

    await waitFor(() => {
      expect(bits()).toBe(bitsOf(GENERATED));
    });
    // Explore succeeded. Create must say nothing at all about it.
    expect(createStatus()).toHaveTextContent('');
  });
});

/* ------------------------------------------------------------------------- */

describe('Explore, loaded from Create', () => {
  it('opens on the recipe’s own expression, and says which seed it will use', async () => {
    const user = userEvent.setup();
    const { client } = instantClient();
    render(<Harness client={client} />);

    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
    await user.click(screen.getByRole('button', { name: 'Edit this APL' }));

    const editor = screen.getByLabelText('Your APL expression');
    expect(editor).toHaveValue(RECIPES[0]!.core);

    // The intro has to name the seed, or `?` repeating looks like a bug rather than the point.
    const seed = (screen.getByLabelText('Seed') as HTMLInputElement).value;
    expect(screen.getByText(/It also fixes/u).textContent).toContain(seed);
  });

  it('sends the same seeded ⎕RL the Generate button would have', async () => {
    const user = userEvent.setup();
    const { client, calls } = instantClient();
    render(<Harness client={client} />);

    await user.click(generateButton());
    await waitFor(() => {
      expect(createStatus()).toHaveTextContent('Generated.');
    });
    const generated = calls[0] ?? '';

    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
    await user.click(screen.getByRole('button', { name: 'Edit this APL' }));
    await user.click(screen.getByRole('button', { name: 'Run this APL' }));

    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });

    /*
     * The claim Peek makes, checked. The wrapper differs — Explore assigns into `m` and Create
     * returns the recipe directly — but the seeded random context has to be identical, or
     * "Edit this APL" would hand somebody an expression that produces a different rhythm than
     * the button they just pressed.
     */
    const seeded = /⎕RL←(\d+) 1/u.exec(generated)?.[1];
    expect(seeded).toBeDefined();
    expect(calls[1]).toContain(`⎕RL←${String(seeded)} 1`);
    expect(calls[1]).toContain(RECIPES[0]!.core);
  });

  it('does not lose an edited draft because a Peek was opened', async () => {
    const user = userEvent.setup();
    const { client } = instantClient();
    render(<Harness client={client} />);

    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
    await user.click(screen.getByRole('button', { name: 'Edit this APL' }));

    const editor = screen.getByLabelText('Your APL expression');
    await user.clear(editor);
    await user.type(editor, '8 16⍴1');
    expect(editor).toHaveValue('8 16⍴1');

    // Changing the recipe must not reach into somebody's writing.
    await user.selectOptions(screen.getByLabelText('Recipe'), RECIPES[1]!.id);
    expect(editor).toHaveValue('8 16⍴1');

    // The panel offers an explicit load instead, and only that replaces it.
    await user.click(screen.getByRole('button', { name: 'Load this generator into Explore' }));
    expect(editor).toHaveValue(RECIPES[1]!.core);
  });

  it('follows the recipe and seed while it is still pristine', async () => {
    const user = userEvent.setup();
    const { client } = instantClient();
    render(<Harness client={client} />);

    await user.click(screen.getByRole('button', { name: 'Peek at the APL' }));
    await user.click(screen.getByRole('button', { name: 'Edit this APL' }));

    const editor = screen.getByLabelText('Your APL expression');
    expect(editor).toHaveValue(RECIPES[0]!.core);

    await user.selectOptions(screen.getByLabelText('Recipe'), RECIPES[2]!.id);
    expect(editor).toHaveValue(RECIPES[2]!.core);
  });
});
