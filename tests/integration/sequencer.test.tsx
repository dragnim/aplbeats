import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sequencer, type SequencerProps } from '@/components/Sequencer';
import { createInitialGroove } from '@/pattern/initialGroove';
import { noLocks } from '@/app/studio';
import { createMixer } from '@/pattern/mixer';
import { cellAt, createPattern, setCell } from '@/pattern/pattern';

/*
 * The grid as a component: does it render the pattern faithfully, and does it report
 * the right edit?
 *
 * The pointer-drag behaviour is not here. jsdom has no layout, so
 * `elementFromPoint` — which is how a drag knows what it is over — returns nothing
 * useful. That is checked in a real browser by the end-to-end suite instead, which
 * is the honest place for it.
 */

function setup(overrides: Partial<SequencerProps> = {}) {
  const onSetCell = vi.fn();
  const onToggleMute = vi.fn();
  const onToggleLock = vi.fn();
  const onVolumeChange = vi.fn();
  const onAuditionTrack = vi.fn();
  const onEditGesture = vi.fn();

  const props: SequencerProps = {
    pattern: createInitialGroove(),
    mixer: createMixer(),
    playheadStep: 0,
    isPlaying: false,
    locks: noLocks(),
    onSetCell,
    onToggleMute,
    onToggleLock,
    onVolumeChange,
    onAuditionTrack,
    onEditGesture,
    ...overrides,
  };

  render(<Sequencer {...props} />);
  return { props, onSetCell, onToggleMute, onToggleLock, onVolumeChange, onAuditionTrack, onEditGesture };
}

describe('rendering the pattern', () => {
  it('draws a hundred and twenty-eight steps', () => {
    setup();
    expect(screen.getAllByRole('button', { pressed: false }).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('button[data-track][data-step]')).toHaveLength(128);
  });

  it('reports the state of a step as a pressed state, not as part of its name', () => {
    setup({ pattern: setCell(createPattern(), 0, 4, true) });

    const active = screen.getByRole('button', { name: 'Kick, step 5' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Kick, step 6' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('names every step for the track and the step number a musician would use', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Kick, step 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rim, step 16' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Closed Hat, step 9' })).toBeInTheDocument();
  });

  it('groups the steps of a track under the track name', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Low Perc steps' })).toBeInTheDocument();
  });

  it('offers exactly one Tab stop for the whole grid', () => {
    setup();
    expect(document.querySelectorAll('button[data-track][data-step][tabindex="0"]')).toHaveLength(1);
  });
});

describe('clicking a step', () => {
  it('asks for the opposite of what is there', async () => {
    const user = userEvent.setup();
    const { onSetCell } = setup({ pattern: createPattern() });

    await user.click(screen.getByRole('button', { name: 'Snare, step 3' }));
    expect(onSetCell).toHaveBeenCalledWith(1, 2, true);
  });

  it('asks for a step to be switched off when it is on', async () => {
    const user = userEvent.setup();
    const pattern = setCell(createPattern(), 1, 2, true);
    const { onSetCell } = setup({ pattern });

    await user.click(screen.getByRole('button', { name: 'Snare, step 3' }));
    expect(onSetCell).toHaveBeenCalledWith(1, 2, false);
  });

  it('opens the audio device from the gesture, before anything else', async () => {
    /*
     * Order matters. Browsers only allow audio to start inside a user gesture, so if
     * the device is not opened here it cannot be opened at all until the visitor
     * happens to press something else — and the step they just switched on would go
     * unheard.
     */
    const user = userEvent.setup();
    const { onEditGesture, onSetCell } = setup();

    await user.click(screen.getByRole('button', { name: 'Kick, step 2' }));
    expect(onEditGesture).toHaveBeenCalled();
    expect(onEditGesture.mock.invocationCallOrder[0]).toBeLessThan(
      onSetCell.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('reports each click once, not twice', async () => {
    // A press and a click both arrive for one mouse action. If both acted, every
    // toggle would immediately undo itself.
    const user = userEvent.setup();
    const { onSetCell } = setup({ pattern: createPattern() });

    await user.click(screen.getByRole('button', { name: 'Clap, step 1' }));
    expect(onSetCell).toHaveBeenCalledTimes(1);
  });
});

describe('the keyboard', () => {
  it('moves between neighbouring steps with the arrow keys', async () => {
    const user = userEvent.setup();
    setup();

    const start = screen.getByRole('button', { name: 'Kick, step 1' });
    start.focus();

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Kick, step 3' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Snare, step 3' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(screen.getByRole('button', { name: 'Kick, step 2' })).toHaveFocus();
  });

  it('reaches the ends of the bar and stops there', async () => {
    const user = userEvent.setup();
    setup();

    screen.getByRole('button', { name: 'Kick, step 1' }).focus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'Kick, step 16' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Kick, step 16' })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: 'Kick, step 1' })).toHaveFocus();
  });

  it('does not run off the top or the bottom of the kit', async () => {
    const user = userEvent.setup();
    setup();

    screen.getByRole('button', { name: 'Kick, step 1' }).focus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('button', { name: 'Kick, step 1' })).toHaveFocus();

    await user.keyboard('{ArrowDown>8/}');
    expect(screen.getByRole('button', { name: 'Rim, step 1' })).toHaveFocus();
  });

  it('toggles the focused step with Space', async () => {
    const user = userEvent.setup();
    const { onSetCell } = setup({ pattern: createPattern() });

    screen.getByRole('button', { name: 'Open Hat, step 5' }).focus();
    await user.keyboard(' ');
    expect(onSetCell).toHaveBeenCalledWith(3, 4, true);
  });

  it('toggles the focused step with Enter too', async () => {
    const user = userEvent.setup();
    const { onSetCell } = setup({ pattern: createPattern() });

    screen.getByRole('button', { name: 'High Perc, step 2' }).focus();
    await user.keyboard('{Enter}');
    expect(onSetCell).toHaveBeenCalledWith(6, 1, true);
  });

  it('moves the Tab stop to wherever the arrows went', async () => {
    const user = userEvent.setup();
    setup();

    screen.getByRole('button', { name: 'Kick, step 1' }).focus();
    await user.keyboard('{ArrowRight}{ArrowDown}');

    const tabbable = document.querySelectorAll('button[data-track][data-step][tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute('aria-label', 'Snare, step 2');
  });
});

describe('the track controls', () => {
  it('reports a mute as a pressed state', async () => {
    const user = userEvent.setup();
    const mixer = createMixer();
    const { onToggleMute } = setup({ mixer });

    const mute = screen.getByRole('button', { name: 'Mute Snare' });
    expect(mute).toHaveAttribute('aria-pressed', 'false');
    await user.click(mute);
    expect(onToggleMute).toHaveBeenCalledWith(1);
  });

  it('shows a muted track as pressed', () => {
    const mixer = createMixer().map((mix, index) => (index === 2 ? { ...mix, muted: true } : mix));
    setup({ mixer });
    expect(screen.getByRole('button', { name: 'Mute Closed Hat' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports a fader move as a fraction, not a percentage', () => {
    const { onVolumeChange } = setup();
    const fader = screen.getByRole('slider', { name: 'Kick volume' });

    // A change event rather than typing, because a range input is dragged.
    fireEvent.change(fader, { target: { value: '40' } });
    expect(onVolumeChange).toHaveBeenCalledWith(0, 0.4);
  });

  it('previews a track when its name is pressed, without editing anything', async () => {
    const user = userEvent.setup();
    const { onAuditionTrack, onSetCell } = setup();

    await user.click(screen.getByRole('button', { name: 'Preview Clap' }));
    expect(onAuditionTrack).toHaveBeenCalledWith(4);
    expect(onSetCell).not.toHaveBeenCalled();
  });

  it('calls the auditioning button something other than Play', () => {
    /*
     * Eight buttons beginning "Play" beside the one that starts the transport is
     * ambiguous to look at and considerably worse to listen to. This is the assertion
     * that keeps it that way.
     */
    setup();
    expect(screen.queryAllByRole('button', { name: /^Play/ })).toHaveLength(0);
  });
});

describe('the playhead', () => {
  it('marks the current column while playing', () => {
    setup({ playheadStep: 5, isPlaying: true });
    const marked = document.querySelectorAll('[class*="playing"]');
    expect(marked.length).toBeGreaterThan(0);
  });

  it('does not claim to be moving while stopped', () => {
    setup({ playheadStep: 5, isPlaying: false });
    // The resume point is still marked, but not as something playing.
    expect(document.querySelectorAll('[class*="headerPlaying"]')).toHaveLength(0);
    expect(document.querySelectorAll('[class*="headerPlayhead"]').length).toBeGreaterThan(0);
  });
});

describe('the pattern it was given', () => {
  it('is never modified by the component', async () => {
    // The grid renders the pattern and reports edits. It does not own one, which is
    // what keeps the matrix the single account of what is playing.
    const user = userEvent.setup();
    const pattern = createPattern();
    setup({ pattern });

    await user.click(screen.getByRole('button', { name: 'Kick, step 1' }));
    expect(cellAt(pattern, 0, 0)).toBe(false);
  });
});
