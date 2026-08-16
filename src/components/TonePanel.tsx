import { noteCount, phraseToAplLiteral, type Phrase } from '@/tones/phrase';
import panel from './AplPanel.module.css';
import styles from './TonePanel.module.css';

/*
 * The Tones Play workspace: the phrase, as APL holds it.
 *
 * What is left after Stage 9 took the Sound and Volume controls out of it. Those are properties
 * of the *layer* — true whichever workspace is open — and they now sit above the matrix with the
 * drum kit's opposite number. What remains here is the one thing that genuinely belongs to a
 * workspace called Play: the sixteen numbers you are playing.
 *
 * That readout is the whole reason Tones exists, and it is here rather than behind a Peek because
 * it costs nothing to show. `n` is sixteen numbers. Anybody can read it, nobody has to, and
 * seeing `0 60 0 63` line up with the notes just drawn is the moment the array stops being an
 * abstraction. The Beats side needs `8 16⍴` and a Peek to show the same thing; the phrase needs
 * neither, and the contrast is the lesson.
 */

export interface TonePanelProps {
  readonly phrase: Phrase;
}

export function TonePanel({ phrase }: TonePanelProps): React.JSX.Element {
  const notes = noteCount(phrase);

  return (
    <section className={panel.panel} aria-label="Tones">
      <div className={panel.header}>
        <h3 className={panel.title}>The phrase</h3>
        <p className={panel.summary}>
          {/*
            "Notes", not "sounding". A note rings through the rests after it, so at any instant
            more of the bar is sounding than has a number in it — and a count that said otherwise
            would be describing the data while pretending to describe the sound.
          */}
          {notes === 0
            ? 'Sixteen rests. Give a step a note to begin.'
            : `${String(notes)} notes in 16 steps.`}
        </p>
      </div>

      <div className={styles.vector}>
        <p className={styles.vectorLabel}>
          As APL holds it — a numeric vector <code className={styles.variable}>n</code>, where 0 is a rest.
        </p>
        {/*
          A `pre`, not an `output`.

          `<output>` carries an implicit live region, which would be exactly wrong here: this
          changes on every note somebody draws, so a screen reader would read sixteen numbers
          aloud after every movement of the pointer. The cells themselves announce their own
          pitches, which is the right granularity. This is for looking at.
        */}
        <pre className={styles.vectorValue}>
          <code>{phraseToAplLiteral(phrase)}</code>
        </pre>
      </div>
    </section>
  );
}
