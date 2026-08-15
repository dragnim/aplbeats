import { useCallback, useRef, useState } from 'react';
import { cx } from '@/app/cx';
import {
  cellToggle,
  DEFAULT_WORKING_PITCH,
  MATRIX_ROWS,
  pitchForRow,
  octaveOf,
  phraseToMatrix,
  pitchClassOf,
  ROW_IS_BLACK,
  ROW_NAMES,
} from '@/tones/matrix';
import {
  isPitch,
  PHRASE_LENGTH,
  REST,
  stepLabel,
  TONE_MAX_MIDI,
  TONE_MIN_MIDI,
  type Phrase,
} from '@/tones/phrase';
import styles from './ToneMatrix.module.css';

/*
 * The Tone phrase, as twelve rows by sixteen columns.
 *
 * This replaces a strip of sixteen pads that printed note names and drew pitch as the height of a
 * fill. That worked and had two faults nothing would have designed away: thirty-seven semitones
 * across forty pixels means a semitone is one pixel, so nobody ever read the shape of a phrase
 * from it; and putting a G on step 6 meant selecting step 6 and pressing Up until the label said
 * G. Every other sequencer lets you point at where the note goes.
 *
 * **The rows are pitch classes.** C at the bottom, B at the top, and C3, C4, C5 and C6 all light
 * the same row with a different octave badge. That is what lets twelve rows hold a three-octave
 * instrument without pages, bases or a scrolling window — see `@/tones/matrix`, where the model
 * lives and where the reason it cannot be inverted is written down.
 *
 * **The grid is a view, and `n` is still the data.** Nothing here holds a matrix. Every gesture
 * computes a new MIDI value and hands it to `onSetNote`; the grid is redrawn from the phrase that
 * comes back. If that ever inverts — if a 12 × 16 array becomes the thing being edited — the whole
 * point of Tones has quietly gone.
 *
 * **One note per column, by inheritance.** A phrase holds one value per step, so at most one cell
 * in a column can be lit. Clicking an empty cell in a column that already sounds *moves* the note
 * there, in one gesture and one Undo entry, rather than refusing or stacking. Somebody who tries
 * to place two notes in one column learns what monophonic means without reading a word.
 *
 * **Arrow keys move; Space edits.** That reverses the strip, where Up and Down changed the pitch.
 * In a grid the arrows are how you get about — one hundred and ninety-two cells and one tab stop,
 * exactly as the drum grid does it — and the editor row below still offers the semitone arithmetic
 * to anybody who preferred it.
 */

const STEPS = Array.from({ length: PHRASE_LENGTH }, (_, step) => step);
/** Top to bottom, because that is the order the rows are drawn in. */
const ROWS = Array.from({ length: MATRIX_ROWS }, (_, row) => MATRIX_ROWS - 1 - row);
const STEPS_PER_BEAT = 4;

export interface ToneMatrixProps {
  readonly phrase: Phrase;
  readonly playheadStep: number;
  readonly isPlaying: boolean;
  /** Called once at the start of an editing gesture, so one drag is one Undo. */
  readonly onEditGesture: () => void;
  readonly onSetNote: (step: number, value: number) => void;
  /** Sound one pitch now. Called for every change, and for a tap on a note already there. */
  readonly onPreview: (midi: number) => void;
}

export function ToneMatrix({
  phrase,
  playheadStep,
  isPlaying,
  onEditGesture,
  onSetNote,
  onPreview,
}: ToneMatrixProps): React.JSX.Element {
  /*
   * Which cell the keyboard is on, and which column the editor row acts on.
   *
   * The column is the part that persists in the interface below; the row only decides where the
   * next Space lands. Both start where the eye does: the first step, middle of the grid.
   */
  const [focus, setFocus] = useState({ row: pitchClassOf(DEFAULT_WORKING_PITCH), step: 0 });

  /*
   * The octave a new note arrives in.
   *
   * A cell says which *class* was clicked and nothing about which octave was meant, so something
   * has to decide, and the honest answer is "the octave you were last in". Moving a note uses the
   * note's own octave; placing into an empty column uses this. Deliberately not persisted — it is
   * where your hand is, not a setting.
   */
  const [workingPitch, setWorkingPitch] = useState(DEFAULT_WORKING_PITCH);

  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const at = (row: number, step: number): number => row * PHRASE_LENGTH + step;

  const matrix = phraseToMatrix(phrase);

  const focusCell = useCallback((row: number, step: number) => {
    const nextRow = Math.min(MATRIX_ROWS - 1, Math.max(0, row));
    const nextStep = Math.min(PHRASE_LENGTH - 1, Math.max(0, step));
    setFocus({ row: nextRow, step: nextStep });
    cells.current[nextRow * PHRASE_LENGTH + nextStep]?.focus();
  }, []);

  /** Change one step, remember where we are, and let somebody hear it. */
  const change = useCallback(
    (step: number, value: number) => {
      onSetNote(step, value);
      if (value !== REST) {
        setWorkingPitch(value);
        onPreview(value);
      }
    },
    [onSetNote, onPreview],
  );

  /** Place, move or clear the note in a column, from a cell. */
  const toggle = useCallback(
    (row: number, step: number) => {
      onEditGesture();
      change(step, cellToggle(phrase, row, step, workingPitch));
    },
    [phrase, workingPitch, onEditGesture, change],
  );

  /**
   * Move the note in a column by an interval, as the editor row does.
   *
   * A rest nudged upward becomes a note rather than doing nothing, which is how somebody who has
   * read none of this discovers that a rest can become a note.
   */
  const nudge = useCallback(
    (step: number, semitones: number) => {
      const current = phrase[step] ?? REST;
      const from = current === REST ? workingPitch - semitones : current;
      const next = from + semitones;
      if (!isPitch(next)) return;
      change(step, next);
      setFocus((was) => ({ row: pitchClassOf(next), step: was.step }));
    },
    [phrase, workingPitch, change],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, row: number, step: number): void => {
    /*
     * One gesture per key *sequence*, not per key event, exactly as the strip had it: holding
     * Page Up to climb three octaves banks one history entry, and pressing it three times banks
     * three. That is what somebody means by "one change".
     */
    const beginsGesture = !event.repeat;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        focusCell(row + 1, step);
        return;
      case 'ArrowDown':
        event.preventDefault();
        focusCell(row - 1, step);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        focusCell(row, step - 1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        focusCell(row, step + 1);
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
      case 'Home':
        event.preventDefault();
        focusCell(row, 0);
        return;
      case 'End':
        event.preventDefault();
        focusCell(row, PHRASE_LENGTH - 1);
        return;
      default:
    }
  };

  const selected = focus.step;
  const selectedValue = phrase[selected] ?? REST;

  return (
    <div className={styles.matrix}>
      {/*
        The grid scrolls sideways rather than shrinking, exactly as the drum grid does.

        Sixteen columns sharing whatever width a phone has is 21px each, under the 24px WCAG 2.2
        target floor and small enough that a thumb hits the wrong step. A cell that keeps its size
        and a grid that scrolls is the trade the sequencer already made, and making the same one
        here means the two layers behave the same way under a finger.
      */}
      <div className={styles.scroller}>
        <div className={cx(styles.grid, 'noSelect')} role="group" aria-label="Tone steps">
          {ROWS.map((row) => (
            <div key={row} className={styles.row} role="group" aria-label={`${ROW_NAMES[row] ?? ''} steps`}>
              <span
                aria-hidden="true"
                className={cx(styles.rowLabel, ROW_IS_BLACK[row] === true && styles.black)}
              >
                {ROW_NAMES[row]}
              </span>
              {STEPS.map((step) => {
                const lit = matrix[row]?.[step] === true;
                const value = phrase[step] ?? REST;

                return (
                  <button
                    key={step}
                    ref={(node) => {
                      cells.current[at(row, step)] = node;
                    }}
                    type="button"
                    className={cx(
                      styles.cell,
                      ROW_IS_BLACK[row] === true && styles.blackRow,
                      lit && styles.lit,
                      step % STEPS_PER_BEAT === 0 && styles.beatStart,
                      step === playheadStep && styles.underPlayhead,
                      step === playheadStep && isPlaying && styles.playing,
                    )}
                    /*
                     * "Step 6, G" until something sounds there, then "Step 6, G4".
                     *
                     * The octave is not a property of the row — it belongs to the note — so an
                     * empty cell has no octave to announce and inventing one would be a lie about
                     * where a press would land. Arrowing up a column reads as the twelve names,
                     * and the one that sounds says which G it is.
                     */
                    aria-label={
                      lit
                        ? `Step ${String(step + 1)}, ${stepLabel(value)}`
                        : `Step ${String(step + 1)}, ${ROW_NAMES[row] ?? ''}`
                    }
                    aria-pressed={lit}
                    tabIndex={row === focus.row && step === focus.step ? 0 : -1}
                    data-row={row}
                    data-step={step}
                    onKeyDown={(event) => {
                      onKeyDown(event, row, step);
                    }}
                    onClick={() => {
                      setFocus({ row, step });
                      toggle(row, step);
                    }}
                  >
                    {lit && (
                      <span aria-hidden="true" className={styles.octave}>
                        {octaveOf(value)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          <div className={styles.stepNumbers} aria-hidden="true">
            <span className={styles.rowLabel} />
            {STEPS.map((step) => (
              <span
                key={step}
                className={cx(styles.stepNumber, step % STEPS_PER_BEAT === 0 && styles.beatNumber)}
              >
                {step + 1}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/*
        The same intervals as the keyboard, as buttons.

        Not a fallback but the primary way on a touch screen, where there are no arrow keys at all
        — and the one thing the grid alone cannot offer, since a cell says which class you meant
        and never which octave. It acts on the selected step, named in the heading above it so
        that "up an octave" is never an instruction without an object.
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
              const next = selectedValue === REST ? pitchForRow(focus.row, workingPitch) : REST;
              change(selected, next);
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
