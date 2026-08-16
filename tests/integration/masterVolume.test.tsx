import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/app/App';

/*
 * Master volume, in the whole application.
 *
 * Two claims worth checking here rather than in the engine: that it appears where a listening
 * control belongs, and that moving it changes nothing else. The second is the one that could
 * quietly go wrong — a volume control that nudged the pattern, the seed or a track fader would
 * be a mixing desk with a fault, and the fault would be found by ear weeks later.
 */

/** Everything a visitor would be sorry to have moved. */
function creativeState(): Record<string, unknown> {
  return {
    cells: [...document.querySelectorAll('button[data-track][data-step]')]
      .map((cell) => (cell.getAttribute('aria-pressed') === 'true' ? '1' : '0'))
      .join(''),
    sliders: Object.fromEntries(
      [...document.querySelectorAll('input[type="range"]')]
        .filter((input) => input.id !== 'transport-master')
        .map((input) => [input.getAttribute('aria-label') ?? input.id, (input as HTMLInputElement).value]),
    ),
    locks: [...document.querySelectorAll('button[aria-label^="Lock"]')].map((button) =>
      button.getAttribute('aria-pressed'),
    ),
    mutes: [...document.querySelectorAll('button[aria-label^="Mute"]')].map((button) =>
      button.getAttribute('aria-pressed'),
    ),
    preset:
      [...document.querySelectorAll('input[type="radio"]')]
        .find((radio) => (radio as HTMLInputElement).checked)
        ?.getAttribute('value') ?? null,
    seed: document.querySelector('[class*="seedValue"]')?.textContent?.trim() ?? null,
    kit: (document.querySelector('select#\\:r0\\:-kit') as HTMLSelectElement | null)?.value ?? null,
  };
}

const master = (): HTMLInputElement =>
  screen.getByRole('slider', { name: 'Master volume' }) as HTMLInputElement;

beforeEach(() => {
  window.localStorage.clear();
  // jsdom has no AudioContext; the transport logs once and stays stopped. Expected, and noisy.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/* ------------------------------------------------------------------------- */

describe('the control', () => {
  it('sits in the transport, with Play, Tempo and Swing', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Transport' })).toBeInTheDocument();
    expect(master()).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Tempo' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Swing' })).toBeInTheDocument();
  });

  it('opens at full volume, so nothing sounds different by default', () => {
    render(<App />);
    expect(master()).toHaveValue('100');
    expect(master()).toHaveAttribute('aria-valuetext', '100 per cent');
  });

  it('is a real range input, not a div pretending to be one', () => {
    // Which is what makes arrow keys, Home, End and a screen reader work without being written.
    render(<App />);
    expect(master().tagName).toBe('INPUT');
    expect(master()).toHaveAttribute('type', 'range');
    expect(master()).toHaveAttribute('min', '0');
    expect(master()).toHaveAttribute('max', '100');
    expect(master()).toHaveAttribute('step', '1');
  });

  it('shows the level, and says it', () => {
    render(<App />);

    fireEvent.change(master(), { target: { value: '37' } });
    expect(master()).toHaveValue('37');
    expect(master()).toHaveAttribute('aria-valuetext', '37 per cent');
    expect(screen.getByText('37')).toBeInTheDocument();
  });

  it('says "Silent" at the bottom rather than implying a mute button exists', () => {
    render(<App />);
    fireEvent.change(master(), { target: { value: '0' } });
    expect(master()).toHaveAttribute('aria-valuetext', 'Silent');
  });

  it('can be focused, so a keyboard can reach it', async () => {
    /*
     * Whether arrow keys *move* it is not asserted here, and deliberately: jsdom does not
     * implement a range input's native key handling, so a test of it here would be testing jsdom.
     * Being a real `<input type="range">` with a sane min, max and step — which the test above
     * asserts — is what makes the keyboard work, and the end-to-end suite checks it in a browser
     * that actually implements it.
     */
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    master().focus();
    expect(document.activeElement).toBe(master());
  });
});

describe('moving it', () => {
  it('changes nothing else at all', () => {
    render(<App />);

    // Make the state distinctive first, so "unchanged" means something.
    fireEvent.click(screen.getByRole('button', { name: 'Randomise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rim, step 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lock Kick against the generator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mute Clap' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Tempo' }), { target: { value: '96' } });

    const before = creativeState();

    for (const value of ['80', '55', '20', '0', '100', '37']) {
      fireEvent.change(master(), { target: { value } });
    }

    expect(creativeState()).toEqual(before);
    expect(master()).toHaveValue('37');
  });

  it('leaves the track faders alone, and their relative mix with them', () => {
    /*
     * The eight faders decide the balance between the voices; Master decides how loud the
     * finished result is. Turning one down must not rewrite the others.
     */
    render(<App />);

    const kick = screen.getByRole('slider', { name: 'Kick volume' });
    const hat = screen.getByRole('slider', { name: 'Closed Hat volume' });
    fireEvent.change(kick, { target: { value: '70' } });
    fireEvent.change(hat, { target: { value: '45' } });

    fireEvent.change(master(), { target: { value: '20' } });
    expect(kick).toHaveValue('70');
    expect(hat).toHaveValue('45');

    fireEvent.change(master(), { target: { value: '100' } });
    expect(kick).toHaveValue('70');
    expect(hat).toHaveValue('45');
  });

  it('is not undoable', () => {
    // Listening state, like tempo. An Undo that turned the volume back up instead of restoring
    // the last edit would be answering a question nobody asked.
    render(<App />);

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.change(master(), { target: { value: '40' } });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Rim, step 5' }));
    fireEvent.change(master(), { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    // The edit came back; the volume stayed where it was put.
    expect(screen.getByRole('button', { name: 'Rim, step 5' })).toHaveAttribute('aria-pressed', 'false');
    expect(master()).toHaveValue('10');
  });

  it('does not disturb the drum machine', () => {
    render(<App />);
    const selector = screen.getByRole('combobox', { name: 'Kit' });

    fireEvent.change(master(), { target: { value: '37' } });
    expect(selector).toHaveValue('synth');
  });
});

describe('remembering it', () => {
  it('comes back, and does not start playing', () => {
    const first = render(<App />);
    fireEvent.change(master(), { target: { value: '37' } });
    first.unmount();

    render(<App />);

    expect(master()).toHaveValue('37');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Playback' })).toHaveTextContent('Paused');
  });

  it('remembers silence, rather than treating it as nothing stored', () => {
    const first = render(<App />);
    fireEvent.change(master(), { target: { value: '0' } });
    first.unmount();

    render(<App />);
    expect(master()).toHaveValue('0');
  });

  it('is kept apart from the session, so a discarded groove does not take it', () => {
    const first = render(<App />);
    fireEvent.change(master(), { target: { value: '42' } });
    first.unmount();

    // Throw away the creative session, as a generator version bump would.
    window.localStorage.removeItem('aplbeats.session.v1');

    render(<App />);
    expect(master()).toHaveValue('42');
  });

  it('opens at full volume when the stored value is nonsense', () => {
    window.localStorage.setItem('aplbeats.master-volume.v1', 'not json');
    render(<App />);
    expect(master()).toHaveValue('100');
  });
});
