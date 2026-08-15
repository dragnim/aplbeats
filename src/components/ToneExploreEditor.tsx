import { useCallback, useId, useLayoutEffect, useRef } from 'react';
import { cx } from '@/app/cx';
import { MAX_CUSTOM_LENGTH, toneContract } from '@/apl/custom';
import type { TransformApi } from '@/apl/useApl';
import panel from './AplPanel.module.css';
import styles from './ExploreEditor.module.css';

/*
 * Explore, for the Tone phrase.
 *
 * The same editor as the Beats one, against `n` instead of `m`, and its own draft — which is the
 * whole reason it is a second component rather than the first one with a flag. Somebody halfway
 * through writing `(48⌈84⌊n+7)×0<n` must not lose it because they glanced at the drums, and the
 * two drafts live under two storage keys for exactly that reason.
 *
 * There is no "Result goes to" control. A Tone phrase is one line: the expression's answer becomes the
 * whole of `n`, and a selector offering one option would be a control that never does anything.
 *
 * The glyph strip is a different set, too. `∨` and `∧` are Boolean operations that belong to a
 * rhythm; `+` and `-` and `⌈` and `⌊` are arithmetic that only means something when the values
 * are pitches. A strip carrying the other layer's glyphs would be teaching the wrong vocabulary.
 */

export interface ToneExploreEditorProps {
  readonly transform: TransformApi;
}

/**
 * The glyphs worth having within reach when the data is numbers.
 *
 * Everything the four Tone operations and four Tone recipes actually use, and nothing else. Every
 * one has a name as well as a symbol, because a button whose only label is a glyph is a button a
 * screen reader cannot describe and a newcomer cannot guess.
 */
const GLYPHS: readonly { readonly glyph: string; readonly name: string }[] = [
  { glyph: '¯', name: 'Negative (high minus)' },
  { glyph: '⌽', name: 'Rotate or reverse' },
  { glyph: '⍳', name: 'Index generator' },
  { glyph: '⍴', name: 'Shape or reshape' },
  { glyph: '×', name: 'Times' },
  { glyph: '÷', name: 'Divide' },
  { glyph: '⌈', name: 'Maximum (ceiling)' },
  { glyph: '⌊', name: 'Minimum (floor)' },
  { glyph: '|', name: 'Residue (remainder)' },
  { glyph: '<', name: 'Less than' },
  { glyph: '>', name: 'Greater than' },
  { glyph: '=', name: 'Equals' },
  { glyph: '≠', name: 'Not equal' },
  { glyph: ',', name: 'Join' },
  { glyph: '?', name: 'Roll or Deal (random)' },
];

export function ToneExploreEditor({ transform }: ToneExploreEditorProps): React.JSX.Element {
  const ids = useId();
  const { status, error, aplLines, lastRun, lastWasCached, lastDomain } = transform;
  const explore = transform.tones.explore;

  const area = useRef<HTMLTextAreaElement | null>(null);
  /** Where the caret should be after a glyph insertion re-renders the box. */
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    area.current?.setSelectionRange(caret, caret);
    area.current?.focus();
  });

  const insert = useCallback(
    (glyph: string) => {
      const box = area.current;
      const value = explore.expression;
      const from = box?.selectionStart ?? value.length;
      const to = box?.selectionEnd ?? value.length;

      pendingCaret.current = from + glyph.length;
      explore.setExpression(`${value.slice(0, from)}${glyph}${value.slice(to)}`);
    },
    [explore],
  );

  /* This editor's own outcome: a custom run, on the Tone phrase. */
  const mine = lastRun === 'custom' && lastDomain === 'tones';
  const running = status === 'running' && mine;
  const length = [...explore.expression].length;

  return (
    <section className={panel.panel} aria-label="Explore the Tone APL">
      <div className={panel.header}>
        <h3 className={panel.title}>
          Explore the <span className={panel.apl}>APL</span>
        </h3>
        <p className={panel.summary}>Edit the expression yourself, then run it on your Tone phrase.</p>
      </div>

      <div className={styles.explore}>
        <div className={styles.intro}>
          <p className={styles.note}>
            <code className={styles.inline}>n</code> is the current Tone phrase: sixteen numbers, where 0 is a
            rest and everything else is a MIDI note. <code className={styles.inline}>0&lt;n</code> is the mask
            of sounding notes, which is how you leave the rests alone. APL Beats sets{' '}
            <code className={styles.inline}>⎕IO←0</code>, so steps count from zero.
            {explore.randomSeed !== null && (
              <>
                {' '}
                It also fixes <code className={styles.inline}>⎕RL</code> to seed{' '}
                <code className={styles.inline}>{String(explore.randomSeed)}</code>, so{' '}
                <code className={styles.inline}>?</code> gives the same answers every time you run this.
              </>
            )}{' '}
            Write one expression; everything around it is still provided for you.
          </p>
        </div>

        <div className={styles.controls}>
          <p className={styles.contract}>{toneContract()}</p>
        </div>

        <div className={styles.glyphs} role="group" aria-label="Insert an APL glyph">
          {GLYPHS.map(({ glyph, name }) => (
            <button
              key={glyph}
              type="button"
              className={styles.glyph}
              onClick={() => {
                insert(glyph);
              }}
              aria-label={`Insert ${glyph} — ${name}`}
              title={`${glyph} — ${name}`}
            >
              <span aria-hidden="true">{glyph}</span>
            </button>
          ))}
        </div>

        <label className={styles.label} htmlFor={`${ids}-code`}>
          Your APL expression
        </label>
        <textarea
          id={`${ids}-code`}
          ref={area}
          className={styles.editor}
          value={explore.expression}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          rows={2}
          aria-describedby={`${ids}-help`}
          onChange={(event) => {
            explore.setExpression(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            // Ctrl or Cmd with Enter runs it; plain Enter does not. The busy guard in `useApl` is
            // what stops a held shortcut becoming a request storm — the same one the Beats editor
            // relies on, because it is the same lane.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              explore.run();
            }
          }}
        />

        <div className={styles.footer}>
          <p className={styles.help} id={`${ids}-help`}>
            {explore.isPristine
              ? 'This is the APL the controls above would run. Change it and it becomes yours.'
              : 'Your expression.'}{' '}
            Press <kbd className={styles.kbd}>Ctrl</kbd>
            <span aria-hidden="true"> / </span>
            <span className="visuallyHidden">or</span> <kbd className={styles.kbd}>Cmd</kbd> +{' '}
            <kbd className={styles.kbd}>Enter</kbd> to run.
          </p>
          <span className={cx(styles.count, length > MAX_CUSTOM_LENGTH && styles.countOver)}>
            {length} / {MAX_CUSTOM_LENGTH}
          </span>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.run}
            onClick={explore.run}
            disabled={!explore.canRun || status === 'running'}
            aria-label="Run this APL"
            aria-busy={running}
          >
            {running ? 'Running APL…' : 'Run this APL'}
          </button>

          {!explore.isPristine && (
            <button type="button" className={styles.secondary} onClick={explore.loadCurrent}>
              {explore.origin === 'create' ? 'Load current generator' : 'Load current transform'}
            </button>
          )}
        </div>

        <p
          className={cx(
            styles.status,
            mine && status === 'failed' && styles.statusFailed,
            explore.problem !== null && styles.statusFailed,
          )}
          role="status"
          aria-label="Explore the Tone phrase"
        >
          {explore.problem ?? (
            <>
              {mine && status === 'running' && 'Running APL…'}
              {mine && status === 'applied' && (lastWasCached ? 'Applied, from cache.' : 'Applied.')}
              {mine && status === 'unchanged' && 'That ran, and the Tone phrase came back the same.'}
              {mine && status === 'failed' && error}
            </>
          )}
        </p>

        {mine && aplLines.length > 0 && (
          <pre className={styles.aplError}>
            <code>{aplLines.join('\n')}</code>
          </pre>
        )}
      </div>
    </section>
  );
}
