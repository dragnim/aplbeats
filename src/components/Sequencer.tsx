import { useCallback, useRef, useState } from 'react';
import { cx } from '@/app/cx';
import type { Mixer } from '@/pattern/mixer';
import { cellAt, STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import { TRACKS } from '@/pattern/tracks';
import { STEPS_PER_BEAT } from '@/transport/timing';
import { TrackControls } from './TrackControls';
import styles from './Sequencer.module.css';

/*
 * The sequencer: eight tracks of sixteen steps, and the only thing on the page
 * that matters.
 *
 * It renders the pattern and reports edits. It holds no pattern of its own, which
 * is what keeps the matrix in `pattern.ts` the single account of what is playing —
 * the same account APL will eventually be handed.
 *
 * Three interaction models over one set of buttons, which is most of the work here:
 *
 *   Pointer, fine. Press to toggle, then drag to paint the same value across
 *   neighbours. The value is decided once, at the press, so crossing a cell twice
 *   in one gesture cannot undo the first crossing.
 *
 *   Pointer, touch. Tap only. A touch that becomes a scroll must not leave a
 *   trail of switched-on steps behind it, so touches are handled on `click` — which
 *   the browser withholds if the gesture turned out to be a pan — rather than on
 *   press. The grid stays scrollable, which on a phone it has to be.
 *
 *   Keyboard. Arrow keys between neighbours, Home and End to the ends of the bar,
 *   Space or Enter to toggle. One Tab stop for the whole grid, by roving tabindex,
 *   so a keyboard visitor is not made to press Tab a hundred and twenty-eight times
 *   to get past it.
 */

export interface SequencerProps {
  readonly pattern: Pattern;
  readonly mixer: Mixer;
  /** Which column the playhead is on. */
  readonly playheadStep: number;
  readonly isPlaying: boolean;
  /** Which tracks the generator may not touch, in row order. */
  readonly locks: readonly boolean[];
  readonly onSetCell: (track: number, step: number, value: boolean) => void;
  readonly onToggleMute: (track: number) => void;
  readonly onToggleLock: (track: number) => void;
  readonly onVolumeChange: (track: number, volume: number) => void;
  readonly onAuditionTrack: (track: number) => void;
  /**
   * The first thing any editing gesture does.
   *
   * Opening an audio device needs a user gesture, and this is the earliest honest
   * one — so a step switched on can be heard immediately rather than on the next
   * pass of a transport that may not even be running.
   */
  readonly onEditGesture: () => void;
}

interface Coordinate {
  readonly track: number;
  readonly step: number;
}

interface PaintGesture {
  readonly pointerId: number;
  /** Decided at the press and held for the whole drag. */
  readonly value: boolean;
  /** Cells already dealt with, so one gesture touches each of them once. */
  readonly visited: Set<number>;
}

const STEPS = Array.from({ length: STEP_COUNT }, (_unused, index) => index);

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function cellKey(track: number, step: number): number {
  return track * STEP_COUNT + step;
}

export function Sequencer({
  pattern,
  mixer,
  playheadStep,
  isPlaying,
  locks,
  onSetCell,
  onToggleMute,
  onToggleLock,
  onVolumeChange,
  onAuditionTrack,
  onEditGesture,
}: SequencerProps): React.JSX.Element {
  /** Which cell Tab lands on. Follows the arrow keys and the last cell pressed. */
  const [focus, setFocus] = useState<Coordinate>({ track: 0, step: 0 });

  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const gesture = useRef<PaintGesture | null>(null);
  /**
   * Whether the press already dealt with this cell.
   *
   * A mouse press and release on one cell produces a `pointerdown` *and* a `click`.
   * The press paints; the click must then do nothing, or every mouse toggle would
   * immediately undo itself.
   */
  const pressHandled = useRef(false);

  const moveFocus = useCallback((track: number, step: number) => {
    const next = { track: clamp(track, TRACK_COUNT - 1), step: clamp(step, STEP_COUNT - 1) };
    setFocus(next);
    // Focused directly rather than through an effect: an effect would also fire on
    // mount and steal focus from the page the moment it loaded.
    cellRefs.current[cellKey(next.track, next.step)]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, track: number, step: number) => {
      // Space and Enter are left alone: a native button already activates on both,
      // and `onClick` below is what handles it.
      switch (event.key) {
        case 'ArrowLeft':
          moveFocus(track, step - 1);
          break;
        case 'ArrowRight':
          moveFocus(track, step + 1);
          break;
        case 'ArrowUp':
          moveFocus(track - 1, step);
          break;
        case 'ArrowDown':
          moveFocus(track + 1, step);
          break;
        case 'Home':
          moveFocus(track, 0);
          break;
        case 'End':
          moveFocus(track, STEP_COUNT - 1);
          break;
        default:
          return;
      }
      // Only reached when a key was handled. Arrow keys would otherwise scroll the
      // grid's own scroller out from under the cell that just took focus.
      event.preventDefault();
    },
    [moveFocus],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, track: number, step: number) => {
      onEditGesture();
      setFocus({ track, step });

      /*
       * Touch presses are not acted on here.
       *
       * A finger on a step may be about to toggle it or about to scroll the grid,
       * and there is no way to know yet. Waiting for `click` lets the browser
       * decide, and the browser is right: it withholds the click when the gesture
       * turned into a pan. Painting by dragging is therefore a pointer affordance
       * only, which is the correct trade — a phone that switched on nine steps every
       * time you scrolled would be unusable.
       */
      if (event.pointerType === 'touch') return;
      if (event.button !== 0) return;

      const value = !cellAt(pattern, track, step);
      gesture.current = { pointerId: event.pointerId, value, visited: new Set([cellKey(track, step)]) };
      pressHandled.current = true;

      /*
       * Capture, so a drag that leaves the button keeps reporting to it. Without it
       * the gesture ends the moment the pointer crosses into the next cell.
       *
       * Guarded, because capture is not always available or always allowed: it throws
       * for a pointer that is no longer active — a mouse button released in the
       * instant between the press and this line — and jsdom has no implementation of
       * it at all. Neither is worth losing the toggle over. Painting simply stops at
       * the cell pressed, which is what a press was anyway.
       */
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Not fatal: see above.
      }

      onSetCell(track, step, value);
    },
    [onEditGesture, onSetCell, pattern],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const active = gesture.current;
      if (active === null || active.pointerId !== event.pointerId) return;

      /*
       * Which cell is under the pointer, asked of the document rather than tracked.
       *
       * Pointer capture sends every move to the button the gesture started on, so
       * the event target is no help. Hit-testing the actual coordinates is, and it
       * stays correct if the grid scrolls or reflows mid-drag.
       */
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const cell = element?.closest<HTMLElement>('[data-track][data-step]');
      if (cell == null) return;

      const track = Number(cell.dataset.track);
      const step = Number(cell.dataset.step);
      if (!Number.isInteger(track) || !Number.isInteger(step)) return;

      const key = cellKey(track, step);
      if (active.visited.has(key)) return;
      active.visited.add(key);
      onSetCell(track, step, active.value);
    },
    [onSetCell],
  );

  const endGesture = useCallback(() => {
    gesture.current = null;
  }, []);

  const handleClick = useCallback(
    (track: number, step: number) => {
      // The press already painted this one; the click that follows it is noise.
      if (pressHandled.current) {
        pressHandled.current = false;
        return;
      }

      // A tap, or Space, or Enter.
      onEditGesture();
      setFocus({ track, step });
      onSetCell(track, step, !cellAt(pattern, track, step));
    },
    [onEditGesture, onSetCell, pattern],
  );

  return (
    <div className={styles.scroller}>
      <div className={cx(styles.grid, 'noSelect')}>
        {/*
          The step ruler. Hidden from assistive technology because every button
          below already says which step it is, and sixteen numbers announced twice
          is sixteen numbers too many. The playhead marker rides along it.
        */}
        <div className={styles.header} aria-hidden="true">
          <div className={styles.corner} />
          <div className={styles.headerSteps}>
            {STEPS.map((step) => (
              <div
                key={step}
                className={cx(
                  styles.stepNumber,
                  step % STEPS_PER_BEAT === 0 && styles.beatStart,
                  step === playheadStep && styles.headerPlayhead,
                  step === playheadStep && isPlaying && styles.headerPlaying,
                )}
              >
                <span className={styles.stepLabel}>{step % STEPS_PER_BEAT === 0 ? step / 4 + 1 : '·'}</span>
                <span className={styles.marker} />
              </div>
            ))}
          </div>
        </div>

        {TRACKS.map((track, trackIndex) => {
          const mix = mixer[trackIndex] ?? { muted: false, volume: 0 };

          return (
            <div key={track.id} className={styles.track}>
              <div className={styles.controlsCell}>
                <TrackControls
                  track={track}
                  mix={mix}
                  locked={locks[trackIndex] === true}
                  onToggleMute={() => {
                    onToggleMute(trackIndex);
                  }}
                  onToggleLock={() => {
                    onToggleLock(trackIndex);
                  }}
                  onVolumeChange={(volume) => {
                    onVolumeChange(trackIndex, volume);
                  }}
                  onAudition={() => {
                    onEditGesture();
                    onAuditionTrack(trackIndex);
                  }}
                />
              </div>

              <div className={styles.steps} role="group" aria-label={`${track.name} steps`}>
                {STEPS.map((step) => {
                  const active = cellAt(pattern, trackIndex, step);
                  const isFocusTarget = focus.track === trackIndex && focus.step === step;
                  const underPlayhead = step === playheadStep;

                  return (
                    <button
                      key={step}
                      type="button"
                      ref={(element) => {
                        cellRefs.current[cellKey(trackIndex, step)] = element;
                      }}
                      data-track={trackIndex}
                      data-step={step}
                      className={cx(
                        styles.cell,
                        active && styles.active,
                        mix.muted && styles.mutedCell,
                        step % STEPS_PER_BEAT === 0 && styles.beatStart,
                        underPlayhead && styles.underPlayhead,
                        underPlayhead && isPlaying && styles.playing,
                      )}
                      /*
                       * State lives in `aria-pressed`, not in the name.
                       *
                       * A name of "Kick, step 5, active" has to be re-announced in
                       * full every time it changes, and reads as a label that
                       * happens to contain a fact. `aria-pressed` is the fact, is
                       * announced as a change, and can be queried at any time.
                       */
                      aria-label={`${track.name}, step ${String(step + 1)}`}
                      aria-pressed={active}
                      tabIndex={isFocusTarget ? 0 : -1}
                      onKeyDown={(event) => {
                        handleKeyDown(event, trackIndex, step);
                      }}
                      onPointerDown={(event) => {
                        handlePointerDown(event, trackIndex, step);
                      }}
                      onPointerMove={handlePointerMove}
                      onPointerUp={endGesture}
                      onPointerCancel={endGesture}
                      onLostPointerCapture={endGesture}
                      onClick={() => {
                        handleClick(trackIndex, step);
                      }}
                    >
                      {/*
                        The lit face of the step. A child rather than the button
                        itself, so the swell as the playhead crosses it can be a
                        transform on something whose box is not also the tap target.
                      */}
                      <span className={styles.face} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
