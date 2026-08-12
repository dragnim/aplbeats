import { useId } from 'react';
import { cx } from '@/app/cx';
import type { MacroName } from '@/app/studio';
import { PRESETS, type PresetId } from '@/generation/presets';
import styles from './GeneratorPanel.module.css';

/*
 * The generative controls.
 *
 * Randomise is the point of this stage and is built to look like it: the one solid,
 * unmissable thing on the panel. Everything else is deliberately quieter — four sliders,
 * a row of presets and a seed — because a first visitor should see one obvious action and
 * discover the rest by using it, not read a control surface first.
 *
 * The labels do the explaining. There is no help text, no tooltips carrying paragraphs,
 * and no descriptions under the sliders: a drum machine that has to explain its own knobs
 * has the wrong knobs.
 */

export interface MacroValues {
  readonly density: number;
  readonly complexity: number;
  readonly syncopation: number;
  readonly variation: number;
}

export interface GeneratorPanelProps {
  readonly preset: PresetId;
  readonly seed: number;
  readonly macros: MacroValues;
  readonly canUndo: boolean;
  readonly onRandomise: () => void;
  readonly onNewSeed: () => void;
  readonly onUndo: () => void;
  readonly onPresetChange: (preset: PresetId) => void;
  /** Live, while a slider moves. Does not regenerate. */
  readonly onMacroChange: (macro: MacroName, value: number) => void;
  /** The end of a slider gesture. Regenerates once. */
  readonly onMacroCommit: () => void;
}

const MACROS: readonly { readonly name: MacroName; readonly label: string; readonly hint: string }[] = [
  { name: 'density', label: 'Density', hint: 'How much is happening' },
  { name: 'complexity', label: 'Complexity', hint: 'How intricate the rhythm is' },
  { name: 'syncopation', label: 'Syncopation', hint: 'How far events lean off the beat' },
  { name: 'variation', label: 'Variation', hint: 'How far Randomise moves from this groove' },
];

export function GeneratorPanel({
  preset,
  seed,
  macros,
  canUndo,
  onRandomise,
  onNewSeed,
  onUndo,
  onPresetChange,
  onMacroChange,
  onMacroCommit,
}: GeneratorPanelProps): React.JSX.Element {
  const macroPrefix = useId();

  return (
    <section className={styles.panel} aria-label="Generator">
      <div className={styles.actions}>
        <button type="button" className={styles.randomise} onClick={onRandomise}>
          <span aria-hidden="true" className={styles.diceIcon}>
            <svg viewBox="0 0 20 20" width="18" height="18" focusable="false">
              <rect
                x="2.5"
                y="2.5"
                width="15"
                height="15"
                rx="4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle cx="7" cy="7" r="1.5" fill="currentColor" />
              <circle cx="13" cy="13" r="1.5" fill="currentColor" />
              <circle cx="10" cy="10" r="1.5" fill="currentColor" />
            </svg>
          </span>
          Randomise
        </button>

        {/*
          Genuinely disabled rather than merely dimmed, so a keyboard visitor is told
          there is nothing to undo instead of being sent to a button that does nothing.
        */}
        <button
          type="button"
          className={styles.secondary}
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo"
        >
          <span aria-hidden="true" className={styles.undoIcon}>
            <svg viewBox="0 0 20 20" width="17" height="17" focusable="false">
              <path
                d="M4 9h7.5a4 4 0 0 1 0 8H8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <path
                d="M7 5.5 3.5 9 7 12.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          Undo
        </button>
      </div>

      {/*
        A radio group rather than a select. Eight presets are worth seeing at once — the
        whole vocabulary of the generator visible without opening anything — and radios
        give arrow-key navigation for free with correct semantics.
      */}
      <fieldset className={styles.presets}>
        <legend className={styles.legend}>Preset</legend>
        <div className={styles.presetRow}>
          {PRESETS.map((option) => (
            <label
              key={option.id}
              className={cx(styles.preset, option.id === preset && styles.presetActive)}
              title={option.blurb}
            >
              <input
                type="radio"
                name="preset"
                className={styles.presetInput}
                value={option.id}
                checked={option.id === preset}
                onChange={() => {
                  onPresetChange(option.id);
                }}
              />
              {option.name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.macros}>
        {MACROS.map(({ name, label, hint }) => {
          const id = `${macroPrefix}-${name}`;
          return (
            <div key={name} className={styles.macro}>
              <label className={styles.macroLabel} htmlFor={id} title={hint}>
                {label}
              </label>
              <input
                id={id}
                type="range"
                className={styles.slider}
                min={0}
                max={100}
                step={1}
                value={macros[name]}
                onChange={(event) => {
                  onMacroChange(name, Number(event.currentTarget.value));
                }}
                /*
                 * Committed when the gesture ends, not on every input event.
                 *
                 * Regenerating while the pointer moves would be a torrent of new bars —
                 * unreadable, and unlistenable while the transport is running. Four
                 * endings are covered because there are four ways to stop: releasing a
                 * pointer, cancelling it, letting go of a key, and leaving the control.
                 */
                onPointerUp={onMacroCommit}
                onPointerCancel={onMacroCommit}
                onKeyUp={onMacroCommit}
                onBlur={onMacroCommit}
                aria-valuetext={`${String(macros[name])} of 100`}
              />
              <output className={styles.readout} htmlFor={id} aria-hidden="true">
                {macros[name]}
              </output>
            </div>
          );
        })}
      </div>

      <div className={styles.seedRow}>
        <span className={styles.seedLabel}>Seed</span>
        <span className={styles.seedValue}>{seed}</span>
        <button
          type="button"
          className={styles.secondary}
          onClick={onNewSeed}
          title="Generate a completely new groove"
        >
          New Seed
        </button>
      </div>
    </section>
  );
}
