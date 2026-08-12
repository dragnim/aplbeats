import { cx } from '@/app/cx';
import type { TrackMix } from '@/pattern/mixer';
import type { TrackDefinition } from '@/pattern/tracks';
import styles from './TrackControls.module.css';

/*
 * One track's name, its mute and its fader.
 *
 * Outside the step buttons rather than among them, and not part of their keyboard
 * model: arrow keys move between steps, and a fader that stole them would make the
 * grid unnavigable. These are reached by Tab, like any other control.
 */

export interface TrackControlsProps {
  readonly track: TrackDefinition;
  readonly mix: TrackMix;
  readonly onToggleMute: () => void;
  readonly onVolumeChange: (volume: number) => void;
  /** Play the track on its own, so the fader can be set by ear while stopped. */
  readonly onAudition: () => void;
}

export function TrackControls({
  track,
  mix,
  onToggleMute,
  onVolumeChange,
  onAudition,
}: TrackControlsProps): React.JSX.Element {
  const percent = Math.round(mix.volume * 100);

  return (
    <div className={cx(styles.controls, mix.muted && styles.muted)}>
      {/*
        The name is a button, and pressing it plays the sound. Learning what "Low
        Perc" is by tapping it is faster than any label could manage, and it is how
        the fader gets set to something musical while the transport is stopped.
      */}
      <button
        type="button"
        className={styles.name}
        onClick={onAudition}
        title={`Play ${track.name}`}
        aria-label={`Play ${track.name}`}
      >
        {track.name}
      </button>

      <button
        type="button"
        className={styles.mute}
        onClick={onToggleMute}
        aria-pressed={mix.muted}
        aria-label={`Mute ${track.name}`}
        title={`Mute ${track.name}`}
      >
        {/*
          A slash, not a colour change. The pressed state is in `aria-pressed` for
          anything listening, in the mark for anything looking, and in the dimmed
          row for anything glancing.
        */}
        <span aria-hidden="true" className={styles.muteMark}>
          {mix.muted ? '–' : 'M'}
        </span>
      </button>

      <input
        type="range"
        className={styles.volume}
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(event) => {
          onVolumeChange(Number(event.currentTarget.value) / 100);
        }}
        aria-label={`${track.name} volume`}
        aria-valuetext={`${String(percent)} per cent`}
      />
    </div>
  );
}
