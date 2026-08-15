import { useId, useState } from 'react';
import { cx } from '@/app/cx';
import { TONE_RECIPES, TONE_ROOTS, TONE_SCALES } from '@/apl/toneGenerators';
import type { TransformApi } from '@/apl/useApl';
import { MAX_SEED, MIN_SEED } from '@/generation/prng';
import { noteName } from '@/tones/phrase';
import styles from './AplPanel.module.css';

/*
 * Create with APL, for the melody.
 *
 * Four controls where the Beats side has two, and the two extra ones are the point. A rhythm
 * recipe decides everything about a bar; a melody recipe decides only its *shape*, because which
 * notes are available is a musical decision somebody should be making rather than a decision
 * baked into four fixed tunes. Root and Scale are that decision, and between them they turn four
 * recipes into four recipes times five scales times twenty-four roots.
 *
 * Everything else is the Beats panel exactly. Changing the recipe, the scale, the root or the
 * seed makes **zero** requests; only Generate does, and only once per press. That is a property
 * of `useToneApl` rather than a promise made by this file.
 */

export interface ToneCreatePanelProps {
  readonly transform: TransformApi;
  /** Whether the Tones side of the shared Explore editor is open. */
  readonly exploreOpen: boolean;
  /** Open that editor, pointing it at this panel's APL if it is free to do so. */
  readonly onEditApl: () => void;
}

export function ToneCreatePanel({
  transform,
  exploreOpen,
  onEditApl,
}: ToneCreatePanelProps): React.JSX.Element {
  const ids = useId();
  const [peekOpen, setPeekOpen] = useState(false);

  const { status, error, lastRun, lastWasCached, lastDomain, tones } = transform;
  const { create, explore } = tones;
  const running = status === 'running';

  /* Whose outcome this is: the melody's Generate, and not the rhythm's. */
  const mine = lastRun === 'generate' && lastDomain === 'tones';

  const exploreHasOwnWork = !explore.isPristine;
  const exploreIsShowingThis = explore.origin === 'create' && explore.isPristine;

  return (
    <section className={styles.panel} aria-label="Create a melody with APL">
      <div className={styles.header}>
        <h3 className={styles.title}>
          Create with <span className={styles.apl}>APL</span>
        </h3>
        <p className={styles.summary}>{create.recipe.blurb}</p>
      </div>

      <div className={styles.controls}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-recipe`}>
            Recipe
          </label>
          <select
            id={`${ids}-recipe`}
            className={styles.select}
            value={create.recipe.id}
            onChange={(event) => {
              create.setRecipe(event.currentTarget.value as typeof create.recipe.id);
            }}
          >
            {TONE_RECIPES.map((recipe) => (
              <option key={recipe.id} value={recipe.id} title={recipe.blurb}>
                {recipe.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-root`}>
            Root
          </label>
          <select
            id={`${ids}-root`}
            className={styles.select}
            value={String(create.root)}
            onChange={(event) => {
              create.setRoot(Number(event.currentTarget.value));
            }}
          >
            {TONE_ROOTS.map((root) => (
              <option key={root.midi} value={String(root.midi)}>
                {root.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-scale`}>
            Scale
          </label>
          <select
            id={`${ids}-scale`}
            className={styles.select}
            value={create.scale.id}
            onChange={(event) => {
              create.setScale(event.currentTarget.value as typeof create.scale.id);
            }}
          >
            {TONE_SCALES.map((scale) => (
              <option key={scale.id} value={scale.id} title={scale.blurb}>
                {scale.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-seed`}>
            Seed
          </label>
          <input
            id={`${ids}-seed`}
            className={styles.number}
            type="number"
            inputMode="numeric"
            min={MIN_SEED}
            max={MAX_SEED}
            step={1}
            value={create.seed}
            onChange={(event) => {
              create.setSeed(event.currentTarget.valueAsNumber);
            }}
          />
        </div>

        <button
          type="button"
          className={styles.secondary}
          onClick={create.newSeed}
          title="Choose another melody seed. Makes no request."
        >
          {/*
            "New melody seed", so that no two seed buttons on this page share an accessible name.
            There are now three — the local generator's, the Beats APL one, and this — and they are
            three genuinely different seeds, so naming them apart is honest as well as necessary.
          */}
          New melody seed
        </button>

        <button
          type="button"
          className={styles.apply}
          onClick={create.generate}
          disabled={running}
          aria-label="Generate a melody with APL"
          aria-busy={running && mine}
        >
          {running && mine ? 'Running APL…' : 'Generate with APL'}
        </button>
      </div>

      <p
        className={cx(styles.status, mine && status === 'failed' && styles.statusFailed)}
        role="status"
        aria-label="APL melody generation"
      >
        {mine && status === 'running' && 'Running APL…'}
        {mine && status === 'applied' && (lastWasCached ? 'Generated, from cache.' : 'Generated.')}
        {mine && status === 'unchanged' && 'That seed made no difference to this melody.'}
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

        {/* Opening this makes no request. The expression is built from a template in the browser. */}
        {peekOpen && (
          <div className={styles.peekBody} id={`${ids}-peek`}>
            <div className={styles.peekBlock}>
              <h4 className={styles.peekHeading}>Core APL</h4>
              <pre className={cx(styles.code, styles.codeWrapped)}>
                <code>{create.source.core}</code>
              </pre>
              <ul className={styles.explanation}>
                {create.recipe.explanation.map((line) => (
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

              {exploreOpen && exploreHasOwnWork && (
                <>
                  <p className={styles.note}>
                    Explore is holding APL you wrote, so it has been left alone. Loading this recipe would
                    replace it.
                  </p>
                  <button
                    type="button"
                    className={styles.editToggle}
                    onClick={() => {
                      explore.loadFrom('create');
                    }}
                  >
                    Load this generator into Explore
                  </button>
                </>
              )}
            </div>

            <div className={styles.peekBlock}>
              <h4 className={styles.peekHeading}>The scale it draws from</h4>
              {/*
                The scale as APL holds it, next to the notes it means.

                Shown because it is the one part of the expression that would otherwise look like
                a magic constant: `0 3 5 7 10` is not obviously C minor pentatonic until you see
                the two written down together.
              */}
              <pre className={styles.code}>
                <code>
                  {create.scale.degrees.join(' ')}
                  {'\n'}
                  {create.scale.degrees.map((degree) => noteName(create.root + degree)).join(' ')}
                </code>
              </pre>
              <p className={styles.note}>
                Semitones above {noteName(create.root)}. The recipe indexes this vector with seeded positions,
                which is why every note it can choose is in key.
              </p>
            </div>

            <div className={styles.peekBlock}>
              <h4 className={styles.peekHeading}>Full request</h4>
              <pre className={cx(styles.code, styles.codeWrapped)}>
                <code>{create.source.statements.join('\n')}</code>
              </pre>
              <p className={styles.note}>
                Sent to TryAPL as one line joined with <span className={styles.glyph}>⋄</span>.{' '}
                <span className={styles.glyph}>⎕IO←0</span> keeps APL counting from zero, and{' '}
                <span className={styles.glyph}>⎕RL←{String(create.seed)} 1</span> fixes the random source to
                your seed using Dyalog’s first generator — which is the whole reason the same seed gives the
                same melody. Your current melody is not sent at all: a recipe does not read it.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
