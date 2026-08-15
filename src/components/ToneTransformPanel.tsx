import { useId, useState } from 'react';
import { cx } from '@/app/cx';
import { TONE_OPERATIONS, type ToneOperationId } from '@/apl/toneOperations';
import type { TransformApi } from '@/apl/useApl';
import { projectionSource } from '@/tones/matrix';
import { noteName, phraseToAplLiteral, REST, type Phrase } from '@/tones/phrase';
import styles from './AplPanel.module.css';

/*
 * Transform with APL, for the Tone phrase.
 *
 * The same panel as the Beats one, with one control fewer. There is no Target, because a Tone phrase
 * is one line and there is nothing to choose between "this track" and "all tracks" — so the
 * control is absent rather than present and disabled, which is the difference between an
 * interface that fits its data and one that was copied from something else.
 *
 * Peek shows the phrase as `n`, sixteen numbers with the note names underneath. That pairing is
 * the whole lesson of Stage 8 in one block: `60 0 0 63` *is* the tune, and `n+5` moves it.
 */

export interface ToneTransformPanelProps {
  readonly transform: TransformApi;
  /** The Tone phrase the APL would operate on, for Peek's array view. */
  readonly phrase: Phrase;
  /** Whether the Tones side of the shared Explore editor is open. */
  readonly exploreOpen: boolean;
  /** Open that editor, pointing it at this panel's APL if it is free to do so. */
  readonly onEditApl: () => void;
}

export function ToneTransformPanel({
  transform,
  phrase,
  exploreOpen,
  onEditApl,
}: ToneTransformPanelProps): React.JSX.Element {
  const ids = useId();
  const [peekOpen, setPeekOpen] = useState(false);

  const { status, error, lastWasCached, lastRun, lastDomain, tones } = transform;
  const { operation, parameters, source, explore } = tones;

  const running = status === 'running';
  /*
   * Whose outcome this is.
   *
   * Two checks rather than one, because there is one lane and now two layers in it. `lastRun`
   * keeps Apply from claiming what Generate did; `lastDomain` keeps the Tone phrase from claiming what
   * the drums did. Either alone would let this panel announce a result it had nothing to do with.
   */
  const mine = lastRun === 'fixed' && lastDomain === 'tones';

  const exploreIsShowingThis = explore.origin === 'transform' && explore.isPristine;

  return (
    <section className={styles.panel} aria-label="Transform the Tone phrase with APL">
      <div className={styles.header}>
        <h3 className={styles.title}>
          Transform with <span className={styles.apl}>APL</span>
        </h3>
        <p className={styles.summary}>{operation.summary}</p>
      </div>

      <div className={styles.controls}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-operation`}>
            Operation
          </label>
          <select
            id={`${ids}-operation`}
            className={styles.select}
            value={operation.id}
            onChange={(event) => {
              tones.setOperation(event.currentTarget.value as ToneOperationId);
            }}
          >
            {TONE_OPERATIONS.map((option) => (
              <option key={option.id} value={option.id} title={option.summary}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        {/* Number inputs rather than sliders, for the reason the Beats panel gives: a slider
            invites dragging, and dragging would invite a request per value. */}
        {operation.parameters.map((spec) => (
          <div key={spec.key} className={styles.field}>
            <label className={styles.label} htmlFor={`${ids}-${spec.key}`}>
              {spec.label}
            </label>
            <input
              id={`${ids}-${spec.key}`}
              type="number"
              className={styles.number}
              min={spec.min}
              max={spec.max}
              step={1}
              value={parameters[spec.key] ?? spec.defaultValue}
              onChange={(event) => {
                tones.setParameter(spec.key, Number(event.currentTarget.value));
              }}
            />
          </div>
        ))}

        <button
          type="button"
          className={styles.apply}
          onClick={tones.apply}
          disabled={running}
          aria-label="Apply with APL"
          aria-busy={running && mine}
        >
          {running && mine ? 'Running APL…' : 'Apply with APL'}
        </button>
      </div>

      <p
        className={cx(styles.status, mine && status === 'failed' && styles.statusFailed)}
        role="status"
        aria-label="APL Tone transform"
      >
        {mine && status === 'running' && 'Running APL…'}
        {mine && status === 'applied' && (lastWasCached ? 'Applied, from cache.' : 'Applied.')}
        {mine && status === 'unchanged' && 'That made no difference to this Tone phrase.'}
        {mine && status === 'failed' && error}
      </p>

      <div className={styles.peek}>
        <button
          type="button"
          className={styles.peekToggle}
          onClick={() => {
            setPeekOpen((open) => !open);
          }}
          aria-expanded={peekOpen}
          aria-controls={`${ids}-peek`}
        >
          <span aria-hidden="true" className={cx(styles.chevron, peekOpen && styles.chevronOpen)}>
            ▸
          </span>
          Peek at the APL
        </button>

        {peekOpen && (
          <div className={styles.peekBody} id={`${ids}-peek`}>
            <div className={styles.peekBlock}>
              <h4 className={styles.peekHeading}>Core APL</h4>
              <pre className={styles.code}>
                <code>{source.core}</code>
              </pre>
              <ul className={styles.explanation}>
                {operation.explanation.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              {!exploreOpen && (
                <button type="button" className={styles.editToggle} onClick={onEditApl}>
                  Edit this APL
                </button>
              )}

              {exploreOpen && exploreIsShowingThis && (
                <p className={styles.note}>This expression is open in Explore.</p>
              )}

              {exploreOpen && !explore.isPristine && (
                <>
                  <p className={styles.note}>
                    Explore is holding APL you wrote, so it has been left alone. Loading this transform would
                    replace it.
                  </p>
                  <button
                    type="button"
                    className={styles.editToggle}
                    onClick={() => {
                      explore.loadFrom('transform');
                    }}
                  >
                    Load this transform into Explore
                  </button>
                </>
              )}
            </div>

            <div className={styles.peekBlock}>
              <h4 className={styles.peekHeading}>The vector it works on</h4>
              {/*
                The Tone phrase twice: as APL holds it, and as a musician reads it.

                This is the moment the penny is supposed to drop for the second time. Beats made
                the point that a rhythm is a Boolean matrix; this makes the sharper one, that a
                *tune* is a vector of numbers — and the note names underneath are what stop that
                from being a claim somebody has to take on faith.
              */}
              <pre className={styles.code}>
                <code>
                  {phraseToAplLiteral(phrase)}
                  {'\n'}
                  {phrase.map((value) => (value === REST ? '·' : noteName(value))).join(' ')}
                </code>
              </pre>
              <p className={styles.note}>
                Sixteen numbers. 0 is a rest; everything else is a MIDI note, where 60 is middle C. That is
                the whole phrase — no shape prefix, because a vector does not need one.
              </p>
            </div>

            <div className={styles.peekBlock}>
              <h4 className={styles.peekHeading}>The same phrase, as the grid draws it</h4>
              {/*
                The projection, in the language the grid is an argument about.

                Not sent anywhere — it is arithmetic over sixteen numbers, and asking a remote
                interpreter to redraw a grid would be absurd. It is here because the matrix above
                is a *view* and a reader is entitled to see exactly what kind: one line turns the
                vector into twelve rows, and no line turns it back, because the octave is not in
                the grid at all.
              */}
              <pre className={cx(styles.code, styles.codeWrapped)}>
                <code>{projectionSource(phrase).join('\n')}</code>
              </pre>
              <p className={styles.note}>
                <span className={styles.glyph}>12|n</span> is the row each note lands on, so C3, C4, C5 and C6
                share one row and differ only by the badge drawn on the cell.{' '}
                <span className={styles.glyph}>∘.=</span> compares the twelve rows against all sixteen steps
                at once — the same outer product the drum generator uses to build{' '}
                <span className={styles.glyph}>m</span>. And <span className={styles.glyph}>×[1]0&lt;n</span>{' '}
                is what makes it true rather than nearly true: without it every rest would light the C row,
                because <span className={styles.glyph}>12|0</span> is 0.
              </p>
              <p className={styles.note}>
                There is no expression back. A cell says <em>a G sounds on step 6</em> and never which G, so
                the grid cannot rebuild <span className={styles.glyph}>n</span> — which is the honest reason
                the vector, and not the grid, is the thing that is stored, transformed and sent.
              </p>
            </div>

            <div className={styles.peekBlock}>
              <h4 className={styles.peekHeading}>Full request</h4>
              <pre className={cx(styles.code, styles.codeWrapped)}>
                <code>{source.statements.join('\n')}</code>
              </pre>
              <p className={styles.note}>
                Sent to TryAPL as one line joined with <span className={styles.glyph}>⋄</span>. The first two
                statements set the index origin and write your phrase down as data; only the third is the
                interesting one.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
