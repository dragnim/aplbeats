import { useCallback, useId, useLayoutEffect, useRef } from 'react';
import { cx } from '@/app/cx';
import { customContract, everyTarget, MAX_CUSTOM_LENGTH } from '@/apl/custom';
import { targetName } from '@/apl/operations';
import type { TransformApi } from '@/apl/useApl';
import styles from './ExploreEditor.module.css';

/*
 * Explore: edit the APL, and run it.
 *
 * The third step of the progression the project was built around — play, peek, explore. Peek
 * shows somebody that the rhythm is data and that a line of APL moved it; this is where they
 * get to move it themselves.
 *
 * What makes it approachable is what it does *not* ask for. Nobody declares `m`, writes an
 * index origin, pastes 128 numbers, or learns a wire format: the application still supplies all
 * of that, exactly as it does for the built-in operations. One expression is the whole surface,
 * and it starts as the expression that was already about to run — so the first experiment is
 * changing ¯1 to ¯2 and hearing the kick move, and the second is realising the number was never
 * the only thing that could change.
 *
 * A textarea, deliberately. An editor framework would bring autocomplete, a language server and
 * a minimap to a box that holds one line of APL, and would weigh more than the rest of the
 * application put together. This is an instrument with an APL editor, not an IDE.
 */

export interface ExploreEditorProps {
  readonly transform: TransformApi;
}

/**
 * The glyphs worth having within reach.
 *
 * Not an APL keyboard. These are the primitives the built-in operations already use plus the
 * few that make rhythms out of other rhythms — Boolean combination, the shape and reshape a
 * matrix experiment needs, and the take and drop somebody reaches for when a row is the wrong
 * length. Anyone with an APL keyboard configured can ignore the strip entirely.
 *
 * Every one has a name as well as a symbol, because a button whose only label is a glyph is a
 * button a screen reader cannot describe and a newcomer cannot guess.
 */
const GLYPHS: readonly { readonly glyph: string; readonly name: string }[] = [
  { glyph: '¯', name: 'Negative (high minus)' },
  { glyph: '⌽', name: 'Rotate or reverse' },
  { glyph: '⍳', name: 'Index generator' },
  { glyph: '⍴', name: 'Shape or reshape' },
  { glyph: '⍉', name: 'Transpose' },
  { glyph: '↑', name: 'Take' },
  { glyph: '↓', name: 'Drop' },
  { glyph: '|', name: 'Residue (remainder)' },
  { glyph: '×', name: 'Times' },
  { glyph: '=', name: 'Equals' },
  { glyph: '≠', name: 'Not equal' },
  { glyph: '>', name: 'Greater than' },
  { glyph: '~', name: 'Not, or without' },
  { glyph: '∨', name: 'Or' },
  { glyph: '∧', name: 'And' },
  { glyph: '/', name: 'Replicate or reduce' },
  { glyph: ',', name: 'Join' },
  /*
   * Added in Stage 6, because the shipped generators use it and an expression somebody cannot
   * retype is an expression they cannot really edit.
   *
   * The strip is a way past not owning an APL keyboard, not a substitute for one — so it grows
   * only when the built-in APL grows, and `?` is the one glyph Stage 6 made necessary. `∘.` also
   * appears in three of the four recipes but is two ordinary keyboard characters, so it needs no
   * button.
   */
  { glyph: '?', name: 'Roll or Deal (random)' },
];

export function ExploreEditor({ transform }: ExploreEditorProps): React.JSX.Element {
  const ids = useId();
  const { explore, status, error, aplLines, lastRun, lastWasCached } = transform;

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

  /**
   * Put a glyph where the caret is.
   *
   * Replacing the selection if there is one, exactly as typing would, and leaving the caret
   * after what was inserted so a second glyph lands where the eye expects. Focus returns to the
   * editor, because a strip that sent you back to the mouse for every character would be worse
   * than no strip.
   */
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

  const running = status === 'running' && lastRun === 'custom';
  const mine = lastRun === 'custom';
  const length = [...explore.expression].length;

  return (
    <div className={styles.explore}>
      <div className={styles.intro}>
        <p className={styles.note}>
          <code className={styles.inline}>m</code> is the current {'8 × 16'} rhythm, one row per track. APL
          Beats sets <code className={styles.inline}>⎕IO←0</code>, so tracks and steps count from zero.
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
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-target`}>
            Result goes to
          </label>
          <select
            id={`${ids}-target`}
            className={styles.select}
            value={explore.target === 'all' ? 'all' : String(explore.target)}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              explore.setTarget(raw === 'all' ? 'all' : Number(raw));
            }}
          >
            {everyTarget().map((option) => (
              <option key={String(option)} value={option === 'all' ? 'all' : String(option)}>
                {targetName(option)}
              </option>
            ))}
          </select>
        </div>

        <p className={styles.contract}>{customContract(explore.target)}</p>
      </div>

      {/*
        The strip, above the editor rather than below it, so inserting a glyph does not move the
        box somebody is looking at.
      */}
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
          /*
           * Ctrl or Cmd with Enter runs it. Plain Enter does not — this is a box you write in,
           * and a stray newline should not spend somebody else's compute.
           *
           * Holding the shortcut repeats the keydown, and every repeat calls `run`; the busy
           * guard in `useApl` is what stops that becoming a request storm, and there is a
           * test that holds the key down and counts.
           */
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
        {/*
          The name stays "Run this APL" while it is running; only the label a sighted visitor
          reads changes, and `aria-busy` says the rest. A button whose accessible name changes
          under a screen reader is a button that appears to have been replaced by a different
          one — and here the action has not changed at all, only its progress.
        */}
        <button
          type="button"
          className={styles.run}
          onClick={explore.run}
          disabled={!explore.canRun || status === 'running'}
          aria-label="Run this APL"
          aria-busy={running && mine}
        >
          {running && mine ? 'Running APL…' : 'Run this APL'}
        </button>

        {!explore.isPristine && (
          <button type="button" className={styles.secondary} onClick={explore.loadCurrent}>
            {explore.origin === 'create' ? 'Load current generator' : 'Load current transform'}
          </button>
        )}
      </div>

      {/*
        Explore's own live region, named like the others on the page.

        It reports what *this* control did, which is why it is filtered on `lastRun`: pressing
        Apply with APL above must not put its outcome down here, and vice versa. It changes at
        most twice per run, so it reports rather than chatters — and typing does not touch it at
        all, because a region that spoke on every keystroke would make the editor unusable with a
        screen reader.
      */}
      <p
        className={cx(
          styles.status,
          mine && status === 'failed' && styles.statusFailed,
          explore.problem !== null && styles.statusFailed,
        )}
        role="status"
        aria-label="Explore"
      >
        {explore.problem ?? (
          <>
            {mine && status === 'running' && 'Running APL…'}
            {mine && status === 'applied' && (lastWasCached ? 'Applied, from cache.' : 'Applied.')}
            {mine && status === 'unchanged' && 'That ran, and the rhythm came back the same.'}
            {mine && status === 'failed' && error}
          </>
        )}
      </p>

      {/*
        What Dyalog said, when Dyalog is what objected.

        Stage 3 kept interpreter detail off screen because the application wrote the APL and any
        error was its own bug. Here the error belongs to the person reading it, and "APL could
        not run that" without the word RANK and a caret would be actively unhelpful.
      */}
      {mine && aplLines.length > 0 && (
        <pre className={styles.aplError}>
          <code>{aplLines.join('\n')}</code>
        </pre>
      )}
    </div>
  );
}
