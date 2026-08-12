import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/app/App';

/*
 * The whole application in jsdom, which has no Web Audio at all.
 *
 * That absence is the point rather than a limitation to be worked around. A browser
 * may refuse to open an audio device for any number of reasons — no output, a policy
 * the gesture did not satisfy, a locked-down build — and what must not happen is a
 * page that breaks, or a Play button that latches on having started nothing. What
 * should happen is a transport that plainly did not start.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('opening APL Beats', () => {
  it('shows the identity, the transport and the grid', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('APL BEATS');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Tempo' })).toHaveValue('112');
    expect(screen.getByRole('slider', { name: 'Swing' })).toHaveValue('18');
    expect(document.querySelectorAll('button[data-track][data-step]')).toHaveLength(128);
  });

  it('opens on the groove rather than an empty grid', () => {
    render(<App />);
    const active = document.querySelectorAll('button[data-track][data-step][aria-pressed="true"]');
    expect(active).toHaveLength(32);
  });

  it('does not autoplay', () => {
    // Browsers would refuse anyway, but this is also simply what a visitor expects: a
    // page that starts making noise on load is a page that gets closed.
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Paused');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });
});

describe('editing', () => {
  it('switches a step on and leaves the rest alone', async () => {
    const user = userEvent.setup();
    render(<App />);

    const target = screen.getByRole('button', { name: 'Rim, step 1' });
    expect(target).toHaveAttribute('aria-pressed', 'false');

    await user.click(target);
    expect(target).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('button[data-track][data-step][aria-pressed="true"]')).toHaveLength(33);

    await user.click(target);
    expect(target).toHaveAttribute('aria-pressed', 'false');
  });

  it('mutes a track without erasing its part', async () => {
    const user = userEvent.setup();
    render(<App />);

    const before = document.querySelectorAll('button[data-track="0"][aria-pressed="true"]').length;
    await user.click(screen.getByRole('button', { name: 'Mute Kick' }));

    expect(screen.getByRole('button', { name: 'Mute Kick' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('button[data-track="0"][aria-pressed="true"]')).toHaveLength(before);
  });
});

describe('without an audio device', () => {
  it('reports plainly that it did not start, rather than latching on', async () => {
    /*
     * jsdom has no `AudioContext`, so constructing one throws. The transport catches
     * that, logs it once, and returns to stopped — so the interface still says Play
     * and the visitor can try again after granting whatever was missing.
     */
    const complaints = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Paused');
    expect(complaints).toHaveBeenCalledOnce();
  });

  it('stays editable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Play' }));
    const target = screen.getByRole('button', { name: 'Rim, step 2' });
    await user.click(target);
    expect(target).toHaveAttribute('aria-pressed', 'true');
  });

  it('still moves its tempo and swing controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    const tempo = screen.getByRole('slider', { name: 'Tempo' });
    await user.clear(tempo).catch(() => undefined);
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(tempo, { target: { value: '96' } });
    expect(tempo).toHaveValue('96');

    const swing = screen.getByRole('slider', { name: 'Swing' });
    fireEvent.change(swing, { target: { value: '0' } });
    expect(swing).toHaveAttribute('aria-valuetext', 'Straight');
  });
});
