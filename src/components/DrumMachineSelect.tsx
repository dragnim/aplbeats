import { useId } from 'react';
import { cx } from '@/app/cx';
import type { DrumMachineApi } from '@/audio/useDrumMachine';
import styles from './LayerControls.module.css';

/*
 * Which drum machine plays the pattern.
 *
 * It sits with Beats, above the grid it changes. Until Stage 9 it was in the global transport,
 * which was defensible while there was one layer and became a lie the moment there were two: a
 * kit is a fact about Beats, and a global control that only affects one layer teaches somebody
 * that the application is a drum machine with a tab bolted on.
 *
 * Labelled "Kit" rather than "Drum machine" now that it lives under a heading that says BEATS.
 * The longer name was carrying the context the layout now carries.
 *
 * One select and one line of status, and the status line is empty almost all of the time. A kit
 * takes a few tens of kilobytes and a moment to decode; saying so is worth one line, and
 * keeping a spinner on screen afterwards would not be.
 */

export interface DrumMachineSelectProps {
  readonly drumMachine: DrumMachineApi;
}

export function DrumMachineSelect({ drumMachine }: DrumMachineSelectProps): React.JSX.Element {
  const id = useId();
  const { kitId, kits, status, error, select } = drumMachine;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={`${id}-kit`}>
        Kit
      </label>

      <select
        id={`${id}-kit`}
        className={styles.select}
        value={kitId}
        onChange={(event) => {
          select(event.currentTarget.value);
        }}
      >
        {kits.map((kit) => (
          <option key={kit.id} value={kit.id} title={kit.blurb}>
            {kit.name}
          </option>
        ))}
      </select>

      {/*
        Named, because it is the page's third live region — the other two are playback and the
        APL transform. It changes at most twice per selection: loading, then nothing, or the one
        sentence that says which kit is actually playing instead.

        Not an alert: a kit that will not load is not an emergency. The rhythm is untouched and
        the synthesised kit is already playing it.
      */}
      <p
        className={cx(styles.status, status === 'failed' && styles.statusFailed)}
        role="status"
        aria-label="Kit"
      >
        {status === 'loading' && 'Loading kit…'}
        {status === 'failed' && error}
      </p>
    </div>
  );
}
