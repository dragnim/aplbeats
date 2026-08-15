import { useCallback, useRef, useState } from 'react';
import { cx } from '@/app/cx';
import {
  isPitch,
  noteName,
  PHRASE_LENGTH,
  REST,
  stepLabel,
  TONE_MAX_MIDI,
  TONE_MIN_MIDI,
  type Phrase,
} from '@/tones/phrase';
import styles from './ToneStrip.module.css';

/*
 * The melody, as sixteen columns.
 *
 * Deliberately *not* a second eight-by-sixteen grid, and not a piano roll either. The whole point
 * of Tones is that a melody is a different shape of data from a rhythm — one line of numbers
 * rather than a matrix of yes and no — and an editor that looked like the drum grid would quietly
 * argue the opposite. Sixteen steps across, one value each, and the value is a *number* you can
 * see: the note name is printed in the pad and the pad's height shows the pitch.
 *
 * **Editing without a modal.** Each step is one button. Up and Down move it by a semitone,
 * Page Up and Page Down by an octave, Backspace or Delete or `0` make it a rest, and Left and
 * Right walk the bar. A tap on a rest gives it a note; a tap on a note selects it, so the editor
 * row below — which is the same operations as buttons — can act on it. Nothing opens, nothing
 * overlays, and there is no state to be in.
 *
 * **Every change is heard.** Moving a note previews it at once, whether the transport is running
 * or not, which is the same bargain the drum grid makes: this is an instrument, and an instrument
 * that waits until you press Play to tell you what you did is a form.
 *
 * The pads keep a usable size at every width and the strip scrolls sideways when they will not
 * all fit, which is exactly the trade the drum grid makes and for exactly the same reason. On a
 * phone they are shorter and the note names shorten to the pitch class, because "G♯4" at that
 * width is a smudge and "G♯" is a note.
 */

const STEPS = Array.from({ length: PHRASE_LENGTH }, (_, step) => step);
const STEPS_PER_BEAT = 4;

/** Where a pad that had been resting starts. Middle C, so a new note is somewhere sensible. */
const DEFAULT_NEW_NOTE = 60;

export interface ToneStripProps {
  readonly phrase: Phrase;
  readonly playheadStep: number;
  readonly isPlaying: boolean;
  /** Called once at the start of an editing gesture, so one drag is one Undo. */
  readonly onEditGesture: () => void;
  readonly onSetNote: (step: number, value: number) => void;
  /** Sound one pitch now. Called for every change, and for a tap on an existing note. */
  readonly onPreview: (midi: number) => void;
}

export function ToneStrip({
  phrase,
  playheadStep,
  isPlaying,
  onEditGesture,
  onSetNote,
  onPreview,
}: ToneStripProps): React.JSX.Element {
  /*
   * Which step the editor row acts on.
   *
   * Also the one step in the tab order, exactly as the drum grid does it: sixteen tab stops in a
   * row is sixteen presses to get past the melody, and the arrow keys are what a grid is for.
   */
  const [selected, setSelected] = useState(0);
  const pads = useRef<(HTMLButtonElement | null)[]>([]);

  const focusStep = useCallback((step: number) => {
    const clamped = Math.min(PHRASE_LENGTH - 1, Math.max(0, step));
    setSelected(clamped);
    pads.current[clamped]?.focus();
  }, []);

  /**
   * Change one step, and let somebody hear it.
   *
   * The gesture is opened by the caller rather than here, because a key held down to slide a note
   * up five semitones is one gesture and one Undo, while five separate presses are five.
   */
  const change = useCallback(
    (step: number, value: number) => {
      onSetNote(step, value);
      if (value !== REST) onPreview(value);
    },
    [onSetNote, onPreview],
  );

  const nudge = useCallback(
    (step: number, semitones: number) => {
      const current = phrase[step] ?? REST;
      // A rest nudged upward becomes a note rather than doing nothing, which is how somebody who
      // has never read any of this discovers that a rest can become a note.
      const from = current === REST ? DEFAULT_NEW_NOTE - semitones : current;
      const next = from + semitones;
      if (!isPitch(next)) return;
      change(step, next);
    },
    [phrase, change],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, step: number): void => {
    /*
     * One gesture per key *sequence*, not per key event.
     *
     * `event.repeat` is false on the first press and true while it is held, so holding Up to
     * slide a note up an octave banks one history entry and releasing and pressing again banks
     * another. That is what somebody means by "one change".
     */
    const beginsGesture = !event.repeat;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        if (beginsGesture) onEditGesture();
        nudge(step, 1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        if (beginsGesture) onEditGesture();
        nudge(step, -1);
        return;
      case 'PageUp':
        event.preventDefault();
        if (beginsGesture) onEditGesture();
        nudge(step, 12);
        return;
      case 'PageDown':
        event.preventDefault();
        if (beginsGesture) onEditGesture();
        nudge(step, -12);
        return;
      case 'Backspace':
      case 'Delete':
      case '0':
        event.preventDefault();
        onEditGesture();
        change(step, REST);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        focusStep(step - 1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        focusStep(step + 1);
        return;
      case 'Home':
        event.preventDefault();
        focusStep(0);
        return;
      case 'End':
        event.preventDefault();
        focusStep(PHRASE_LENGTH - 1);
        return;
      default:
    }
  };

  const onActivate = (step: number): void => {
    setSelected(step);
    const current = phrase[step] ?? REST;

    // A rest becomes a note; a note is only auditioned. Tapping an existing note to erase it
    // would make the melody hard to *hear*, which is the one thing this control is for.
    if (current === REST) {
      onEditGesture();
      change(step, DEFAULT_NEW_NOTE);
      return;
    }
    onPreview(current);
  };

  const selectedValue = phrase[selected] ?? REST;

  return (
    <div className={styles.strip}>
      {/*
        The pads scroll sideways rather than shrinking, exactly as the drum grid's do.

        The alternative was to let sixteen pads share whatever width a phone has, which at 390px
        is 21px each — under the 24px WCAG 2.2 target-spacing floor, and small enough that a
        thumb hits the wrong note. A pad that keeps its size and a strip that scrolls is the
        trade the sequencer already made, and making the same one here means the two layers
        behave the same way under a finger.
      */}
      <div className={styles.scroller}>
        <div className={cx(styles.pads, 'noSelect')} role="group" aria-label="Melody steps">
          {STEPS.map((step) => {
            const value = phrase[step] ?? REST;
            const sounding = value !== REST;

            return (
              <button
                key={step}
                ref={(node) => {
                  pads.current[step] = node;
                }}
                type="button"
                className={cx(
                  styles.pad,
                  sounding && styles.padSounding,
                  step % STEPS_PER_BEAT === 0 && styles.beatStart,
                  step === playheadStep && styles.underPlayhead,
                  step === playheadStep && isPlaying && styles.playing,
                )}
                /*
                 * The pitch, in the name rather than only in the picture.
                 *
                 * "Step 4, G4" — everything the pad shows, said in the order somebody would say it.
                 * The height of the fill is decoration; this is the value.
                 */
                aria-label={`Step ${String(step + 1)}, ${stepLabel(value)}`}
                tabIndex={step === selected ? 0 : -1}
                onKeyDown={(event) => {
                  onKeyDown(event, step);
                }}
                onClick={() => {
                  onActivate(step);
                }}
                style={
                  sounding ? ({ '--pitch': String(heightFor(value)) } as React.CSSProperties) : undefined
                }
              >
                <span aria-hidden="true" className={styles.fill} />
                <span aria-hidden="true" className={styles.note}>
                  <span className={styles.noteFull}>{sounding ? noteName(value) : '·'}</span>
                  <span className={styles.noteShort}>{sounding ? pitchClass(value) : '·'}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/*
        The same operations as the arrow keys, as buttons.

        Not a fallback for the keyboard but the primary way on a touch screen, where there are no
        arrow keys at all. It acts on the selected step, which is named in the heading above it so
        that "Up" is never an instruction without an object.
      */}
      <div className={styles.editor}>
        <p className={styles.selection}>
          <span className={styles.selectionLabel}>Step {selected + 1}</span>
          <span className={styles.selectionValue}>{stepLabel(selectedValue)}</span>
        </p>

        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              onEditGesture();
              nudge(selected, -12);
            }}
            aria-label={`Step ${String(selected + 1)} down an octave`}
            disabled={selectedValue !== REST && selectedValue - 12 < TONE_MIN_MIDI}
          >
            −12
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              onEditGesture();
              nudge(selected, -1);
            }}
            aria-label={`Step ${String(selected + 1)} down a semitone`}
            disabled={selectedValue !== REST && selectedValue - 1 < TONE_MIN_MIDI}
          >
            −1
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              onEditGesture();
              nudge(selected, 1);
            }}
            aria-label={`Step ${String(selected + 1)} up a semitone`}
            disabled={selectedValue !== REST && selectedValue + 1 > TONE_MAX_MIDI}
          >
            +1
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              onEditGesture();
              nudge(selected, 12);
            }}
            aria-label={`Step ${String(selected + 1)} up an octave`}
            disabled={selectedValue !== REST && selectedValue + 12 > TONE_MAX_MIDI}
          >
            +12
          </button>
          <button
            type="button"
            className={cx(styles.button, styles.rest)}
            onClick={() => {
              onEditGesture();
              change(selected, selectedValue === REST ? DEFAULT_NEW_NOTE : REST);
            }}
            aria-label={
              selectedValue === REST
                ? `Give step ${String(selected + 1)} a note`
                : `Make step ${String(selected + 1)} a rest`
            }
          >
            {selectedValue === REST ? 'Note' : 'Rest'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** How full a pad is drawn, 0 to 1, across the instrument's whole range. */
function heightFor(midi: number): number {
  const span = TONE_MAX_MIDI - TONE_MIN_MIDI;
  return Math.min(1, Math.max(0, (midi - TONE_MIN_MIDI) / span));
}

/** "G♯", without the octave. What fits in a pad on a phone. */
function pitchClass(midi: number): string {
  return noteName(midi).replace(/-?\d+$/u, '');
}
