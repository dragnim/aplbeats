import { useId, useState } from 'react';
import { cx } from '@/app/cx';
import { ExploreEditor } from './ExploreEditor';
import type { TransformApi } from '@/apl/useTransform';
import { rowToAplLiteral } from '@/apl/matrix';
import { OPERATIONS, targetName, type Target } from '@/apl/operations';
import { STEP_COUNT, type Pattern } from '@/pattern/pattern';
import { TRACKS } from '@/pattern/tracks';
import styles from './TransformPanel.module.css';

/*
 * Transform with APL.
 *
 * The reason the project exists, so it sits directly under the sequencer rather than behind a
 * disclosure. Four controls and a button: what to transform, how, by how much, and go.
 *
 * Peek is the second half, and it is *progressive* rather than hidden — the interface makes
 * music without it, and opens it when curiosity does. What it shows is the actual expression
 * that was or would be sent, never a simplified stand-in, because the whole value of the
 * feature is that the code on screen is the code that ran.
 */

export interface TransformPanelProps {
  readonly transform: TransformApi;
  /** The bar the APL would operate on, for Peek's array view. */
  readonly pattern: Pattern;
}

export function TransformPanel({ transform, pattern }: TransformPanelProps): React.JSX.Element {
  const ids = useId();
  const [peekOpen, setPeekOpen] = useState(false);
  /*
   * Explore, opened from inside Peek and kept open once it is.
   *
   * Not reset when Peek closes: somebody who collapses Peek to see the grid and reopens it has
   * not asked to throw their expression away, and the editor coming back empty would feel like
   * losing work even though the draft is stored.
   */
  const [exploreOpen, setExploreOpen] = useState(false);

  const { operation, target, parameters, status, error, source, canApply, lastWasCached, lastRun } =
    transform;
  const running = status === 'running';
  /*
   * Whose outcome this is.
   *
   * Apply with APL and Explore's Run share one execution lane, so they also share one status —
   * but each must only report what it did. A result from the editor appearing beside the Apply
   * button would be the interface claiming something it did not do.
   */
  const fixedRun = lastRun === 'fixed';

  /**
   * Which targets this operation will accept.
   *
   * Every operation accepts a single track; only some accept the whole matrix, because
   * Periodic and Euclidean replace a row rather than transforming it, and eight identical
   * rows is a mistake with eight voices rather than a rhythm.
   */
  const targets: Target[] = [
    ...(operation.allowsAllTracks ? (['all'] as Target[]) : []),
    ...TRACKS.map((_track, index) => index as Target),
  ];

  return (
    <section className={styles.panel} aria-label="Transform with APL">
      <div className={styles.header}>
        <h3 className={styles.title}>
          Transform with <span className={styles.apl}>APL</span>
        </h3>
        <p className={styles.summary}>{operation.summary}</p>
      </div>

      <div className={styles.controls}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-target`}>
            Target
          </label>
          <select
            id={`${ids}-target`}
            className={styles.select}
            value={target === 'all' ? 'all' : String(target)}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              transform.setTarget(raw === 'all' ? 'all' : Number(raw));
            }}
          >
            {targets.map((option) => (
              <option key={String(option)} value={option === 'all' ? 'all' : String(option)}>
                {targetName(option)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-operation`}>
            Operation
          </label>
          <select
            id={`${ids}-operation`}
            className={styles.select}
            value={operation.id}
            onChange={(event) => {
              transform.setOperation(event.currentTarget.value as (typeof OPERATIONS)[number]['id']);
            }}
          >
            {OPERATIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        {/*
          Number inputs rather than sliders, deliberately.

          A slider invites dragging, and dragging invites a request per value — which is
          exactly the interaction this project has promised TryAPL not to build. A spinner
          asks for one number and then waits, which is the shape of one deliberate action.
        */}
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
                transform.setParameter(spec.key, Number(event.currentTarget.value));
              }}
            />
          </div>
        ))}

        {/*
          A stable accessible name, with `aria-busy` for the progress. Stage 1's Play button
          changes its name because the *action* changes; this one's does not, and two buttons
          both announcing "Running APL…" would be two buttons nobody could tell apart.
        */}
        <button
          type="button"
          className={styles.apply}
          onClick={transform.apply}
          disabled={!canApply || running}
          aria-label="Apply with APL"
          aria-busy={running}
        >
          {running ? 'Running APL…' : 'Apply with APL'}
        </button>
      </div>

      {/*
        One line of status, and only when there is something to say.

        `role="status"` rather than an alert, because a failed transform is not an emergency — the
        beat is untouched and the visitor can try again.

        Named, because the page has a second live region for playback. It also changes at most
        twice per transform — running, then applied or failed — so it reports rather than chatters.
      */}
      <p
        className={cx(styles.status, fixedRun && status === 'failed' && styles.statusFailed)}
        role="status"
        aria-label="APL transform"
      >
        {fixedRun && status === 'running' && 'Running APL…'}
        {fixedRun && status === 'applied' && (lastWasCached ? 'Applied, from cache.' : 'Applied.')}
        {fixedRun && status === 'unchanged' && 'That made no difference to this bar.'}
        {fixedRun && status === 'failed' && error}
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

        {/*
          Rendered only when open. Opening it makes no request and never has — the APL shown is
          built from a template in the browser, so it is available instantly and costs nothing.
        */}
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

              {/*
                Peek leads into Explore, right here, under the expression it is about to let
                somebody edit. A separate panel elsewhere would break the thread: the whole
                argument of the feature is "that line you are reading — you can change it".
              */}
              {!exploreOpen && (
                <button
                  type="button"
                  className={styles.editToggle}
                  onClick={() => {
                    setExploreOpen(true);
                  }}
                  aria-expanded={false}
                  aria-controls={`${ids}-explore`}
                >
                  Edit this APL
                </button>
              )}

              {exploreOpen && (
                <div id={`${ids}-explore`}>
                  <ExploreEditor transform={transform} />
                </div>
              )}
            </div>

            <div className={styles.peekBlock}>
              <h4 className={styles.peekHeading}>
                {target === 'all' ? 'The matrix it works on' : `${targetName(target)}, right now`}
              </h4>
              {/*
                The moment the penny is supposed to drop: the drum pattern really is an array.
                One row when a track is selected, all eight when the operation takes the whole
                matrix — and inside Peek either way, because 128 numbers permanently on screen
                would be clutter rather than insight.
              */}
              <pre className={styles.code}>
                <code>
                  {target === 'all'
                    ? TRACKS.map(
                        (track, index) => `${track.name.padEnd(11)}${rowToAplLiteral(pattern, index)}`,
                      ).join('\n')
                    : rowToAplLiteral(pattern, target)}
                </code>
              </pre>
              <p className={styles.note}>
                {target === 'all'
                  ? `An ${String(TRACKS.length)} × ${String(STEP_COUNT)} matrix of ones and zeros. That is the whole rhythm.`
                  : 'One track, as a vector of ones and zeros.'}
              </p>
            </div>

            <div className={styles.peekBlock}>
              <h4 className={styles.peekHeading}>Full request</h4>
              <pre className={cx(styles.code, styles.codeWrapped)}>
                <code>{source.statements.join('\n')}</code>
              </pre>
              <p className={styles.note}>
                Sent to TryAPL as one line joined with <span className={styles.glyph}>⋄</span>. The first two
                statements set the index origin and write your pattern down as data; only the third is the
                interesting one. <span className={styles.glyph}>⎕IO←0</span> keeps APL counting from zero,
                exactly as the grid does.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
