import { useId } from 'react';
import { cx } from '@/app/cx';
import { TONE_SOUNDS } from '@/audio/tones/sounds';
import type { TonesApi } from '@/audio/tones/useTones';
import { noteCount, phraseToAplLiteral, type Phrase } from '@/tones/phrase';
import panel from './AplPanel.module.css';
import styles from './TonePanel.module.css';

/*
 * The Tones instrument panel.
 *
 * What the generator panel is to Beats: the controls beside the thing you are editing. Which
 * instrument plays the melody, how loud it sits under the drums, and — quietly at the bottom —
 * the melody itself as APL would write it.
 *
 * That last line is the whole reason Tones exists, and it is here rather than in a Peek because
 * it costs nothing to show. `n` is sixteen numbers. Anybody can read it, nobody has to, and
 * seeing `0 60 0 63` line up with the pads they just edited is the moment the array stops being
 * an abstraction. The Beats side needs `8 16⍴` and a Peek to show the same thing; the melody
 * needs neither, and the contrast is the lesson.
 *
 * The canonical workspace card, from `AplPanel.module.css`, so this sits beside Create,
 * Transform and Explore without a fourth copy of the surface treatment.
 */

export interface TonePanelProps {
  readonly tones: TonesApi;
  readonly phrase: Phrase;
}

export function TonePanel({ tones, phrase }: TonePanelProps): React.JSX.Element {
  const id = useId();
  const { soundId, status, volume, setSound, setVolume, retry } = tones;

  const sounding = noteCount(phrase);

  return (
    <section className={panel.panel} aria-label="Tones">
      <div className={panel.header}>
        <h2 className={panel.title}>Tones</h2>
        <p className={panel.summary}>
          {sounding === 0
            ? 'Sixteen rests. Give a step a note to begin.'
            : `${String(sounding)} of 16 steps sounding.`}
        </p>
      </div>

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
            const known = TONE_SOUNDS.find((sound) => sound.id === next);
            if (known !== undefined) setSound(known.id);
          }}
        >
          {TONE_SOUNDS.map((sound) => (
            <option key={sound.id} value={sound.id} title={sound.blurb}>
              {sound.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-volume`}>
          Tone volume
        </label>
        <div className={styles.sliderRow}>
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
      </div>

      {/*
        One line of status, and empty almost always — the same bargain the drum machine selector
        makes. Not an alert: a sound that will not load is not an emergency, because the drums are
        still playing the bar and every other sound is still one selection away.
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

      <div className={styles.vector}>
        <p className={styles.vectorLabel}>
          The melody, as APL holds it — a numeric vector <code className={styles.variable}>n</code>, where 0
          is a rest.
        </p>
        <output className={styles.vectorValue}>{phraseToAplLiteral(phrase)}</output>
      </div>
    </section>
  );
}
