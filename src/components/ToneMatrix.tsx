import { useCallback, useRef, useState } from 'react';
import { cx } from '@/app/cx';
import {
  cellToggle,
  DEFAULT_WORKING_PITCH,
  MATRIX_ROWS,
  octaveOf,
  phraseToMatrix,
  pitchClassOf,
  pitchForRow,
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
 * Replaced a strip of sixteen pads that drew pitch as the height of a fill: thirty-seven semitones
 * across forty pixels is one pixel a semitone, so nobody read the shape of a phrase from it, and
 * putting a G on step 6 meant pressing Up until the label said G.
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
 * **Arrow keys move; Space edits.** In a grid the arrows are how you get about — a hundred and
 * ninety-two cells and one tab stop, exactly as the drum grid does it. Page Up and Page Down move
 * the note an octave, which is the one thing a click cannot say.
 *
 * ---
 *
 * On the look, because the first build got it wrong in an instructive way. It drew a hundred and
 * ninety-two bordered, filled, rounded buttons and called it a sequencer; what it actually looked
 * like was a dashboard widget. A hardware step sequencer does the opposite — **the empty steps are
 * nearly nothing**, small marks on open ground, and the notes are the only things with weight. So
 * an empty cell here is a 5px square with no border and no background, a note is a solid block,
 * and the ratio between them is doing all the work. The cells themselves are transparent and flush
 * against each other, which is also what lets the playhead be a clean vertical band rather than
 * sixteen outlined boxes.
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
   * Which cell the keyboard is on, and which column the strip below acts on.
   *
   * The column is the part that shows in the interface; the row only decides where the next Space
   * lands. Both start where the eye does: the first step, middle of the grid.
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
   * Move the note in a column by an octave.
   *
   * The one thing a click cannot say, so it is the one interval with its own control. A rest
   * nudged upward becomes a note rather than doing nothing, which is how somebody who has read
   * none of this discovers that a rest can become a note.
   */
  const shiftOctave = useCallback(
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
     * One gesture per key *sequence*, not per key event: holding Page Up to climb three octaves
     * banks one history entry, and pressing it three times banks three. That is what somebody
     * means by "one change".
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
        shiftOctave(step, 12);
        return;
      case 'PageDown':
        event.preventDefault();
        if (beginsGesture) onEditGesture();
        shiftOctave(step, -12);
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
        target floor and small enough that a thumb hits the wrong step. A column that keeps its
        size and a grid that scrolls is the trade the sequencer already made, and making the same
        one here means the two layers behave the same way under a finger.
      */}
      <div className={styles.scroller}>
        <div className={cx(styles.grid, 'noSelect')}>
          {/*
            The ruler, above the grid rather than below it.

            Where a sequencer puts it, and it frees the space under the grid for the one control
            strip. The beats are the numbers that are lit; the rest are there to be counted from.
          */}
          <div className={styles.ruler} aria-hidden="true">
            <span className={styles.keySpacer} />
            {STEPS.map((step) => (
              <span
                key={step}
                className={cx(
                  styles.tick,
                  step % STEPS_PER_BEAT === 0 && styles.tickBeat,
                  step === selected && styles.tickSelected,
                  step === playheadStep && isPlaying && styles.tickPlaying,
                )}
              >
                {step % STEPS_PER_BEAT === 0 ? String(step / STEPS_PER_BEAT + 1) : '·'}
              </span>
            ))}
          </div>

          <div className={styles.rows} role="group" aria-label="Tone steps">
            {ROWS.map((row) => {
              const isSharp = ROW_IS_BLACK[row] === true;

              return (
                <div
                  key={row}
                  className={styles.row}
                  role="group"
                  aria-label={`${ROW_NAMES[row] ?? ''} steps`}
                >
                  {/*
                    A key, not a caption.

                    The single change that does most to make this read as an instrument: naturals
                    are pale keys running the full width, sharps are dark keys held back from the
                    front edge, and with no gaps between the rows they meet to form a keyboard seen
                    side-on. Sticky, because the grid scrolls and a row nobody can name is a row
                    nobody can use.
                  */}
                  <span
                    aria-hidden="true"
                    className={cx(styles.key, isSharp ? styles.keySharp : styles.keyNatural)}
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
                          cells.current[row * PHRASE_LENGTH + step] = node;
                        }}
                        type="button"
                        className={cx(
                          styles.cell,
                          isSharp && styles.cellSharp,
                          lit && styles.lit,
                          step % STEPS_PER_BEAT === 0 && styles.beatStart,
                          step === playheadStep && styles.underPlayhead,
                          step === playheadStep && isPlaying && styles.playing,
                        )}
                        /*
                         * "Step 6, G" until something sounds there, then "Step 6, G4".
                         *
                         * The octave is not a property of the row — it belongs to the note — so an
                         * empty cell has no octave to announce, and inventing one would be a lie
                         * about where a press would land.
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
                        {/*
                          Two marks, and the whole visual argument is the difference between them.
                          An empty step is a dot with no border and no fill — barely there, and
                          only there so the eye can count. A note is a solid block carrying its
                          octave. Nothing in between, so a phrase reads at a glance.
                        */}
                        {lit ? (
                          <span aria-hidden="true" className={styles.note}>
                            {octaveOf(value)}
                          </span>
                        ) : (
                          <span aria-hidden="true" className={styles.dot} />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/*
        One strip, for the one thing the grid cannot say.

        A click chooses a pitch class; it can never choose an octave, so that is what is left here
        — and nothing else is. The old row carried −12, −1, +1, +12 and Rest, which made the grid
        look like a picture of an editor that lived underneath it. Semitones are what the grid is
        *for*: the row above or the row below is one semitone, and offering a button for it was
        admitting the grid did not work.
      */}
      <div className={styles.strip}>
        <p className={styles.selection}>
          <span className={styles.selectionStep}>Step {String(selected + 1).padStart(2, '0')}</span>
          <span className={cx(styles.selectionNote, selectedValue === REST && styles.selectionRest)}>
            {stepLabel(selectedValue)}
          </span>
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              onEditGesture();
              shiftOctave(selected, -12);
            }}
            aria-label={`Step ${String(selected + 1)} down an octave`}
            disabled={selectedValue !== REST && selectedValue - 12 < TONE_MIN_MIDI}
          >
            <span aria-hidden="true" className={styles.actionGlyph}>
              ▾
            </span>
            <span aria-hidden="true">8ve</span>
          </button>

          <button
            type="button"
            className={styles.action}
            onClick={() => {
              onEditGesture();
              shiftOctave(selected, 12);
            }}
            aria-label={`Step ${String(selected + 1)} up an octave`}
            disabled={selectedValue !== REST && selectedValue + 12 > TONE_MAX_MIDI}
          >
            <span aria-hidden="true" className={styles.actionGlyph}>
              ▴
            </span>
            <span aria-hidden="true">8ve</span>
          </button>

          <button
            type="button"
            className={cx(styles.action, styles.actionRest)}
            onClick={() => {
              onEditGesture();
              change(selected, selectedValue === REST ? pitchForRow(focus.row, workingPitch) : REST);
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
