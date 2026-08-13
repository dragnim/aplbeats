import { cx } from '@/app/cx';
import { BPM_STEP, MAX_BPM, MIN_BPM } from '@/transport/timing';
import type { TransportState } from '@/transport/Transport';
import styles from './TransportBar.module.css';

/*
 * Play, tempo, swing, master volume, and which drum machine.
 *
 * The transport is the second most important object on the page and is allowed to
 * look like it. Stage 4 adds a fourth control and it belongs here rather than in a
 * settings panel: choosing the instrument is what a drum machine's front panel is
 * for, and it sits at the far end of the bar so the one obvious thing to press is
 * still Play.
 */

export interface TransportBarProps {
  readonly state: TransportState;
  readonly bpm: number;
  readonly swing: number;
  readonly onToggle: () => void;
  readonly onBpmChange: (bpm: number) => void;
  readonly onSwingChange: (swing: number) => void;
  /** The listening level, 0 to 1. */
  readonly masterVolume: number;
  readonly onMasterVolumeChange: (volume: number) => void;
  /**
   * The instrument control, at the far end of the bar.
   *
   * A slot rather than a prop for the kit itself, so this component's own props stay about the
   * transport. What goes in it is the drum machine selector: which instrument, then play it.
   */
  readonly instrument?: React.ReactNode;
}

export function TransportBar({
  state,
  bpm,
  swing,
  onToggle,
  onBpmChange,
  onSwingChange,
  masterVolume,
  onMasterVolumeChange,
  instrument,
}: TransportBarProps): React.JSX.Element {
  const isPlaying = state === 'playing';
  const swingPercent = Math.round(swing * 100);
  const volumePercent = Math.round(masterVolume * 100);

  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={cx(styles.play, isPlaying && styles.playing)}
        onClick={onToggle}
        /*
         * The name changes rather than a pressed state being set. "Pause" is what
         * the button will do, which is what a button's name should say; a Play
         * button reporting itself as pressed says what has happened instead.
         */
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        <span className={styles.playIcon} aria-hidden="true">
          {isPlaying ? (
            <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
              <rect x="3.5" y="2.5" width="3.5" height="11" rx="1" fill="currentColor" />
              <rect x="9" y="2.5" width="3.5" height="11" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
              <path
                d="M4 2.6a1 1 0 0 1 1.52-.86l7.2 4.4a1 1 0 0 1 0 1.72l-7.2 4.4A1 1 0 0 1 4 11.4Z"
                fill="currentColor"
              />
            </svg>
          )}
        </span>
        <span className={styles.playLabel}>{isPlaying ? 'Pause' : 'Play'}</span>
      </button>

      <div className={styles.dial}>
        <label className={styles.dialLabel} htmlFor="transport-bpm">
          Tempo
        </label>
        <input
          id="transport-bpm"
          type="range"
          className={styles.slider}
          min={MIN_BPM}
          max={MAX_BPM}
          // From the timing module, not typed in here. The tempo range and its
          // granularity are facts about the transport, and the slider should be the
          // thing that follows them rather than a second place they are decided.
          step={BPM_STEP}
          value={bpm}
          onChange={(event) => {
            onBpmChange(Number(event.currentTarget.value));
          }}
          aria-valuetext={`${String(bpm)} beats per minute`}
        />
        {/*
          `aria-hidden`, because the slider already reports its value. Present for
          the eye, which cannot read a slider's value off its thumb.
        */}
        <output className={styles.readout} htmlFor="transport-bpm" aria-hidden="true">
          {bpm}
          <span className={styles.unit}>BPM</span>
        </output>
      </div>

      <div className={styles.dial}>
        <label className={styles.dialLabel} htmlFor="transport-swing">
          Swing
        </label>
        <input
          id="transport-swing"
          type="range"
          className={styles.slider}
          min={0}
          max={100}
          step={1}
          value={swingPercent}
          onChange={(event) => {
            onSwingChange(Number(event.currentTarget.value) / 100);
          }}
          aria-valuetext={swingPercent === 0 ? 'Straight' : `${String(swingPercent)} per cent`}
        />
        <output className={styles.readout} htmlFor="transport-swing" aria-hidden="true">
          {swingPercent}
          <span className={styles.unit}>%</span>
        </output>
      </div>

      <div className={styles.dial}>
        <label className={styles.dialLabel} htmlFor="transport-master">
          Master
        </label>
        <input
          id="transport-master"
          type="range"
          className={styles.slider}
          min={0}
          max={100}
          step={1}
          value={volumePercent}
          onChange={(event) => {
            onMasterVolumeChange(Number(event.currentTarget.value) / 100);
          }}
          /*
            Named for what it does rather than for what it says on screen: "Master" is enough
            beside a row of transport controls, and is not enough read out on its own.
          */
          aria-label="Master volume"
          aria-valuetext={volumePercent === 0 ? 'Silent' : `${String(volumePercent)} per cent`}
        />
        <output className={styles.readout} htmlFor="transport-master" aria-hidden="true">
          {volumePercent}
          <span className={styles.unit}>%</span>
        </output>
      </div>

      {instrument}
    </div>
  );
}
