import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/app/App';
import { KITS } from '@/audio/kits/kits';
import { isSampleKit, SYNTH_KIT_ID } from '@/audio/kits/types';

/*
 * The one rule Stage 4 exists to keep: changing the drum machine changes the sound, not the
 * rhythm.
 *
 * Driven through the whole application rather than through the hook, because the claim is about
 * the product. Everything creative is read off the interface before and after a kit change — the
 * grid cell by cell, the seed, the preset, all four macros, every lock, the tempo, the swing,
 * every mute and every fader — and compared. There is no assertion here about a *sound*, because
 * jsdom has none; what is asserted is that nothing else moved.
 *
 * The samples are mocked at `fetch`. Decoding is mocked too: jsdom has no Web Audio, and this
 * suite is about state rather than audio.
 */

/** A request's URL, however `fetch` was called. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** Everything a visitor would be sorry to lose, read off the rendered interface. */
function creativeState(): Record<string, unknown> {
  const cells = [...document.querySelectorAll('button[data-track][data-step]')]
    .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
    .join('');

  const sliders = Object.fromEntries(
    [...document.querySelectorAll('input[type="range"]')].map((input) => [
      input.getAttribute('aria-label') ?? input.id,
      (input as HTMLInputElement).value,
    ]),
  );

  const locks = [...document.querySelectorAll('button[aria-label^="Lock"]')].map((button) =>
    button.getAttribute('aria-pressed'),
  );

  const mutes = [...document.querySelectorAll('button[aria-label^="Mute"]')].map((button) =>
    button.getAttribute('aria-pressed'),
  );

  const preset = [...document.querySelectorAll('input[type="radio"]')].find(
    (radio) => (radio as HTMLInputElement).checked,
  );

  return {
    cells,
    sliders,
    locks,
    mutes,
    preset: preset?.getAttribute('value') ?? null,
    seed: document.querySelector('[class*="seedValue"]')?.textContent?.trim() ?? null,
  };
}

const SAMPLED = KITS.filter(isSampleKit);
const FIRST = SAMPLED[0]!;
const SECOND = SAMPLED[1]!;

let fetches: string[] = [];

/**
 * Answer every sample request with plausible bytes.
 *
 * `hold` keeps the requests open until the returned function is called, which is the only way
 * to observe the loading state: a mock that resolves immediately is ready before React has
 * finished the click that asked for it.
 */
function mockNetwork(
  options: { readonly fail?: (url: string) => boolean; readonly hold?: boolean } = {},
): () => void {
  fetches = [];
  const waiting: (() => void)[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      fetches.push(url);

      const answer = (): Response => {
        if (options.fail?.(url) === true) {
          return { ok: false, status: 404, statusText: 'Not Found' } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(128)),
        } as unknown as Response;
      };

      if (options.hold !== true) return Promise.resolve(answer());
      return new Promise<Response>((resolve) => {
        waiting.push(() => {
          resolve(answer());
        });
      });
    }),
  );

  return () => {
    for (const release of waiting.splice(0)) release();
  };
}

/*
 * A decoder, because jsdom has none.
 *
 * `OfflineAudioContext` is what the loader reaches for and it does not exist here, so it is
 * stubbed with something that returns a buffer-shaped object. Nothing in this suite inspects one.
 */
function mockDecoding(): void {
  class FakeOfflineAudioContext {
    decodeAudioData(): Promise<AudioBuffer> {
      return Promise.resolve({
        length: 1024,
        duration: 0.02,
        numberOfChannels: 1,
        sampleRate: 44_100,
      } as unknown as AudioBuffer);
    }
  }
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
}

/*
 * By role, not by label.
 *
 * The select and its live region are both named "Drum machine", which is right for a screen
 * reader — a combobox and a status region are announced quite differently, and both want that
 * name — but it makes `getByLabelText` ambiguous. The role is what tells them apart.
 */
const selector = (): HTMLSelectElement =>
  screen.getByRole('combobox', { name: 'Drum machine' }) as HTMLSelectElement;
const kitStatus = (): HTMLElement => screen.getByRole('status', { name: 'Drum machine' });

beforeEach(() => {
  window.localStorage.clear();
  mockNetwork();
  mockDecoding();
  // jsdom has no AudioContext; the transport logs once and stays stopped. Expected, and noisy.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/* ------------------------------------------------------------------------- */

describe('the selector', () => {
  it('offers the synthesised kit and every sampled machine', () => {
    render(<App />);

    expect(selector()).toHaveValue(SYNTH_KIT_ID);
    for (const kit of KITS) {
      expect(screen.getByRole('option', { name: kit.name }), kit.id).toBeInTheDocument();
    }
  });

  it('sits with the transport rather than behind a disclosure', () => {
    render(<App />);
    // Inside the transport region, which is where an instrument control belongs.
    const transportHeading = screen.getByRole('heading', { name: 'Transport' });
    expect(transportHeading).toBeInTheDocument();
    expect(selector()).toBeInTheDocument();
  });

  it('downloads nothing at all on the default kit', () => {
    // The synthesised kit is code. A visitor who never opens the selector fetches no audio.
    render(<App />);
    expect(fetches.filter((url) => url.includes('/audio/'))).toEqual([]);
  });

  it('says nothing while there is nothing to say', () => {
    render(<App />);
    expect(kitStatus()).toHaveTextContent('');
  });
});

describe('changing the drum machine', () => {
  it('leaves every part of the rhythm exactly as it was', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Make the state distinctive first, so "unchanged" is a meaningful claim.
    await user.click(screen.getByRole('button', { name: 'Randomise' }));
    await user.click(screen.getByRole('button', { name: 'Rim, step 3' }));
    await user.click(screen.getByRole('button', { name: 'Lock Kick against the generator' }));
    await user.click(screen.getByRole('button', { name: 'Mute Clap' }));

    const before = creativeState();

    await user.selectOptions(selector(), FIRST.id);
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });

    expect(creativeState()).toEqual(before);
  });

  it('is not undoable, and does not consume the undo that was waiting', async () => {
    /*
     * Choosing an instrument is a listening decision, like moving a fader. Undo is for things
     * done to the Boolean matrix — so the Undo after a kit change must still undo the edit.
     */
    const user = userEvent.setup();
    render(<App />);

    const opening = creativeState();
    await user.click(screen.getByRole('button', { name: 'Rim, step 5' }));
    const edited = creativeState();
    expect(edited).not.toEqual(opening);

    await user.selectOptions(selector(), FIRST.id);
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });

    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(creativeState().cells).toEqual(opening.cells);
    // And the kit did not come back with it.
    expect(selector()).toHaveValue(FIRST.id);
  });

  it('loads only the kit that was chosen', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(selector(), FIRST.id);
    await waitFor(() => {
      expect(fetches.length).toBeGreaterThan(0);
    });

    for (const other of SAMPLED) {
      if (other.id === FIRST.id) continue;
      expect(
        fetches.some((url) => url.includes(`/${other.directory}/`)),
        other.id,
      ).toBe(false);
    }
  });

  it('shows that it is loading, and then stops saying so', async () => {
    const user = userEvent.setup();
    const release = mockNetwork({ hold: true });
    render(<App />);

    await user.selectOptions(selector(), FIRST.id);

    // Held open, so the loading line is observable rather than gone before the assertion.
    expect(kitStatus()).toHaveTextContent('Loading kit…');
    expect(selector()).toHaveValue(FIRST.id);

    release();
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });
  });

  it('keeps playing the old kit until the new one is completely ready', async () => {
    /*
     * Never half one machine and half another. The kit is installed by one assignment after all
     * eight samples have decoded, so while a load is in flight the previous kit is still what
     * sounds — and the interface says so by saying "Loading kit…" rather than by going quiet.
     */
    const user = userEvent.setup();
    const release = mockNetwork({ hold: true });
    render(<App />);

    await user.selectOptions(selector(), FIRST.id);
    expect(kitStatus()).toHaveTextContent('Loading kit…');

    // The pattern is editable and the transport untouched throughout.
    const target = screen.getByRole('button', { name: 'Rim, step 9' });
    await user.click(target);
    expect(target).toHaveAttribute('aria-pressed', 'true');

    release();
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });
    expect(target).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets a second choice win when the first is still loading', async () => {
    /*
     * A load that finishes after the visitor has moved on must not become the active kit. Same
     * staleness rule the APL transforms use, and for the same reason.
     */
    const user = userEvent.setup();
    const release = mockNetwork({ hold: true });
    render(<App />);

    await user.selectOptions(selector(), FIRST.id);
    await user.selectOptions(selector(), SECOND.id);
    expect(selector()).toHaveValue(SECOND.id);

    release();
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });

    // The later choice is what stands, and what was remembered.
    expect(selector()).toHaveValue(SECOND.id);
    expect(window.localStorage.getItem('aplbeats.kit.v1')).toContain(SECOND.id);
  });

  it('costs nothing to come back to a kit already heard', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(selector(), FIRST.id);
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });
    await user.selectOptions(selector(), SECOND.id);
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });

    const after = fetches.length;
    await user.selectOptions(selector(), FIRST.id);
    await waitFor(() => {
      expect(selector()).toHaveValue(FIRST.id);
    });

    expect(fetches).toHaveLength(after);
    // And it never showed a loading line, because there was nothing to load.
    expect(kitStatus()).toHaveTextContent('');
  });

  it('goes back to the synthesised kit without a request', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(selector(), FIRST.id);
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });

    const after = fetches.length;
    await user.selectOptions(selector(), SYNTH_KIT_ID);

    expect(fetches).toHaveLength(after);
    expect(selector()).toHaveValue(SYNTH_KIT_ID);
  });
});

describe('when a kit will not load', () => {
  it('falls back to the synthesised kit and says which one failed', async () => {
    const user = userEvent.setup();
    mockNetwork({ fail: (url) => url.includes(`/${FIRST.directory}/`) });
    render(<App />);

    const before = creativeState();
    await user.selectOptions(selector(), FIRST.id);

    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent(`Could not load ${FIRST.name}`);
    });
    expect(kitStatus()).toHaveTextContent('APL Beats Synth');

    // The selector shows what is actually playing, and the rhythm is untouched.
    expect(selector()).toHaveValue(SYNTH_KIT_ID);
    expect(creativeState()).toEqual(before);
  });

  it('stays usable: the pattern still edits and the generator still runs', async () => {
    const user = userEvent.setup();
    mockNetwork({ fail: () => true });
    render(<App />);

    await user.selectOptions(selector(), FIRST.id);
    await waitFor(() => {
      expect(selector()).toHaveValue(SYNTH_KIT_ID);
    });

    const target = screen.getByRole('button', { name: 'Rim, step 7' });
    await user.click(target);
    expect(target).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Randomise' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  it('clears the message when another kit is chosen', async () => {
    const user = userEvent.setup();
    let broken = true;
    mockNetwork({ fail: () => broken });
    render(<App />);

    await user.selectOptions(selector(), FIRST.id);
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('Could not load');
    });

    broken = false;
    await user.selectOptions(selector(), SECOND.id);
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });
    expect(selector()).toHaveValue(SECOND.id);
  });
});

describe('persistence', () => {
  it('remembers the chosen machine, and restores it without autoplaying', async () => {
    const user = userEvent.setup();
    const first = render(<App />);

    await user.selectOptions(selector(), FIRST.id);
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });
    first.unmount();

    render(<App />);

    expect(selector()).toHaveValue(FIRST.id);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Playback' })).toHaveTextContent('Paused');
  });

  it('keeps the kit under its own key, so a discarded session does not lose it', async () => {
    const user = userEvent.setup();
    const first = render(<App />);

    await user.selectOptions(selector(), FIRST.id);
    await waitFor(() => {
      expect(kitStatus()).toHaveTextContent('');
    });
    first.unmount();

    /*
     * Throw away the creative session, as a generator version bump would. Which drum machine
     * somebody likes has nothing to do with the generator, so it should survive.
     */
    window.localStorage.removeItem('aplbeats.session.v1');

    render(<App />);
    expect(selector()).toHaveValue(FIRST.id);
  });

  it('falls back to the synthesised kit when the stored identifier is gone', () => {
    // A kit withdrawn in a later release must not break startup or leave a silent instrument.
    window.localStorage.setItem('aplbeats.kit.v1', JSON.stringify({ schema: 1, kitId: 'tr-909' }));

    render(<App />);

    expect(selector()).toHaveValue(SYNTH_KIT_ID);
    expect(fetches.filter((url) => url.includes('/audio/'))).toEqual([]);
  });

  it('ignores a stored value from a schema it does not know', () => {
    window.localStorage.setItem('aplbeats.kit.v1', JSON.stringify({ schema: 99, kitId: FIRST.id }));

    render(<App />);

    expect(selector()).toHaveValue(SYNTH_KIT_ID);
  });

  it('ignores stored nonsense', () => {
    window.localStorage.setItem('aplbeats.kit.v1', 'not json at all');
    render(<App />);
    expect(selector()).toHaveValue(SYNTH_KIT_ID);
  });

  it('loads the restored kit, and only that one', async () => {
    window.localStorage.setItem('aplbeats.kit.v1', JSON.stringify({ schema: 1, kitId: SECOND.id }));

    render(<App />);
    expect(selector()).toHaveValue(SECOND.id);

    await waitFor(() => {
      expect(fetches.length).toBeGreaterThan(0);
    });
    for (const url of fetches.filter((entry) => entry.includes('/audio/'))) {
      expect(url).toContain(`/${SECOND.directory}/`);
    }
  });
});
