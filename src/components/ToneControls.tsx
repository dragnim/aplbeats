import { useId } from 'react';
import { cx } from '@/app/cx';
import { TONE_SOUNDS, toneSoundById } from '@/audio/tones/sounds';
import type { TonesApi } from '@/audio/tones/useTones';
import styles from './LayerControls.module.css';

/*
 * What Tones sounds like, and how loud it is.
 *
 * The counterpart of the drum kit, in the same place for the same reason: above the instrument it
 * governs. Until Stage 9 these two controls lived inside the Play *workspace* — the right-hand
 * panel the mode rail switches — which quietly said they were something the APL tools owned. They
 * are not. Which sound is playing is a property of the layer, true whether you are looking at
 * Play, Create, Transform or Explore, and it belongs where the layer is.
 *
 * The same shared stylesheet as the kit, so the two layers' controls are visibly the same kind of
 * thing rather than two designs that happen to sit in the same slot.
 */

export interface ToneControlsProps {
  readonly tones: TonesApi;
}

export function ToneControls({ tones }: ToneControlsProps): React.JSX.Element {
  const id = useId();
  const { soundId, status, volume, setSound, setVolume, retry } = tones;
  const sound = toneSoundById(soundId);

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-sound`}>
          Sound
        </label>
        <select
          id={`${id}-sound`}
          className={styles.select}
          value={soundId}
          onChange={(event) => {
            const next = event.currentTarget.value;
            const known = TONE_SOUNDS.find((option) => option.id === next);
            if (known !== undefined) setSound(known.id);
          }}
        >
          {TONE_SOUNDS.map((option) => (
            <option key={option.id} value={option.id} title={option.blurb}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-volume`}>
          Volume
        </label>
        <input
          id={`${id}-volume`}
          className={styles.slider}
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(volume * 100)}
          onChange={(event) => {
            setVolume(Number(event.currentTarget.value) / 100);
          }}
        />
        <span className={styles.readout}>{Math.round(volume * 100)}</span>
      </div>

      {/*
        One line of status, empty almost always — the same bargain the kit selector makes. Not an
        alert: a sound that will not load is not an emergency, because the drums are still playing
        the bar and every other sound is one selection away.
      */}
      <p
        className={cx(styles.status, status.kind === 'failed' && styles.statusFailed)}
        role="status"
        aria-label="Tone sound"
      >
        {status.kind === 'loading' && 'Loading sound…'}
        {status.kind === 'failed' && (
          <>
            {status.message}{' '}
            <button type="button" className={styles.retry} onClick={retry}>
              Try again
            </button>
          </>
        )}
      </p>

      {/*
        What this sound is and where it came from.

        The selector lists *sounds* rather than upstream's categories, so the category has to
        appear somewhere quietly or the provenance would be true only in the manifest. Last in the
        row and first to be dropped on a narrow screen, because it is worth showing and not worth
        a second line.
      */}
      <p className={styles.provenance}>
        {sound.blurb}{' '}
        <span className={styles.origin}>
          {sound.preset === sound.name ? sound.category : `${sound.category} · ${sound.preset}`}
        </span>
      </p>
    </>
  );
}
