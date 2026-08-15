import { useId, useState } from 'react';
import { cx } from '@/app/cx';
import type { TransformApi } from '@/apl/useApl';
import { RECIPES } from '@/apl/generators';
import { MAX_SEED, MIN_SEED } from '@/generation/prng';
import styles from './AplPanel.module.css';

/*
 * Create with APL.
 *
 * The distinction this panel exists to keep visible: **Randomise is not this**. Randomise is
 * instant, local, deterministic and works with the network unplugged, and it stays exactly that.
 * This is a deliberate act — choose a recipe, choose a seed, ask Dyalog for a bar — and the
 * layout is meant to make that obvious rather than to hide it behind a second dice button.
 *
 * Which is why the panel is arranged the way it is. Recipe and Seed sit together and cost
 * nothing; the button that spends a request is separate, named for what it does, and the only
 * control here that can reach the network. Changing the recipe, typing a seed and pressing New
 * seed all make **zero** requests, and that is a property of `useApl` rather than a promise made
 * by this file.
 *
 * Peek is the same progressive disclosure the Transform panel has, and shows the same three
 * things: the expression that generates, what its glyphs are doing, and the whole request
 * including the seeded ⎕RL. The seed is deliberately *not* hidden from Peek — it is most of the
 * reason the result can be reproduced at all.
 */

export interface CreatePanelProps {
  readonly transform: TransformApi;
  /** Whether the shared Explore editor is open, so this panel can offer to open it. */
  readonly exploreOpen: boolean;
  /** Open the one Explore editor, pointing it at this panel's APL if that is free to do. */
  readonly onEditApl: () => void;
}

export function CreatePanel({ transform, exploreOpen, onEditApl }: CreatePanelProps): React.JSX.Element {
  const ids = useId();
  const [peekOpen, setPeekOpen] = useState(false);

  const { create, explore, status, error, lastRun, lastWasCached } = transform;
  const running = status === 'running';

  /*
   * Whose outcome this is.
   *
   * All three ways into APL share one execution lane and therefore one status, but each must
   * only report what it did. "Generated." appearing here because Explore succeeded would be the
   * interface claiming something it did not do.
   */
  const mine = lastRun === 'generate';

  /*
   * Whether "Edit this APL" would actually land on this recipe.
   *
   * If Explore is holding somebody's own writing, it must not be silently replaced because a
   * Peek was opened. In that case the panel says so and offers an explicit load instead, which
   * is a better answer than a modal asking whether they meant it.
   */
  const exploreHasOwnWork = !explore.isPristine;
  const exploreIsShowingThis = explore.origin === 'create' && explore.isPristine;

  return (
    <section className={styles.panel} aria-label="Create with APL">
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
            {RECIPES.map((recipe) => (
              <option key={recipe.id} value={recipe.id} title={recipe.blurb}>
                {recipe.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-seed`}>
            Seed
          </label>
          {/*
            A real number input, and the same 1–999999 vocabulary the local generator uses. Not a
            second idea of what a seed is — but its own value, so changing this one cannot
            regenerate the other system's bar.
          */}
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
          title="Choose another APL seed. Makes no request."
        >
          {/*
            "New APL seed", not "New seed".

            The local generator has its own New Seed button, and two controls whose accessible
            names differ only in capitalisation are two controls a screen reader cannot tell
            apart. They are also genuinely different seeds — changing one must not regenerate the
            other system's bar — so naming them apart is honest as well as necessary.
          */}
          New APL seed
        </button>
        {/*
          A stable accessible name, with `aria-busy` for the progress — the same treatment Apply
          and Run have. A button whose name changes to "Generating…" is a button a screen reader
          announces as a different control every time it is pressed.
        */}
        <button
          type="button"
          className={styles.apply}
          onClick={create.generate}
          disabled={running || !create.canGenerate}
          aria-label="Generate with APL"
          aria-busy={running && mine}
        >
          {running && mine ? 'Running APL…' : 'Generate with APL'}
        </button>
      </div>

      <p
        className={cx(styles.status, mine && status === 'failed' && styles.statusFailed)}
        role="status"
        aria-label="APL generation"
      >
        {create.blockedReason !== null && create.blockedReason}
        {create.blockedReason === null && mine && status === 'running' && 'Running APL…'}
        {create.blockedReason === null &&
          mine &&
          status === 'applied' &&
          (lastWasCached ? 'Generated, from cache.' : 'Generated.')}
        {create.blockedReason === null &&
          mine &&
          status === 'unchanged' &&
          'That seed made no difference to this beat.'}
        {create.blockedReason === null && mine && status === 'failed' && error}
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

        {/* Opening this makes no request. The expression is a constant in this repository. */}
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

              {/*
                The same thread the Transform panel has: the line you are reading is the line you
                can change. What differs is what happens when the editor is already busy with
                somebody's own APL — see `exploreHasOwnWork`.
              */}
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
              <h4 className={styles.peekHeading}>Full request</h4>
              <pre className={cx(styles.code, styles.codeWrapped)}>
                <code>{create.source.statements.join('\n')}</code>
              </pre>
              <p className={styles.note}>
                Sent to TryAPL as one line joined with <span className={styles.glyph}>⋄</span>.{' '}
                <span className={styles.glyph}>⎕IO←0</span> keeps APL counting from zero, and{' '}
                <span className={styles.glyph}>⎕RL←{String(create.seed)} 1</span> fixes the random source to
                your seed using Dyalog’s first generator — which is the whole reason the same seed gives the
                same beat.{' '}
                {create.source.statements.length > 3
                  ? 'The locked tracks are copied back from your current bar in APL, after the recipe has run, so locking one cannot change what the others generated.'
                  : 'With nothing locked, your current bar is not sent at all — the recipe does not read it.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
