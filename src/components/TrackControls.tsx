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
  /** Whether the generator is forbidden from touching this row. */
  readonly locked: boolean;
  readonly onToggleMute: () => void;
  readonly onToggleLock: () => void;
  readonly onVolumeChange: (volume: number) => void;
  /** Play the track on its own, so the fader can be set by ear while stopped. */
  readonly onAudition: () => void;
}

export function TrackControls({
  track,
  mix,
  locked,
  onToggleMute,
  onToggleLock,
  onVolumeChange,
  onAudition,
}: TrackControlsProps): React.JSX.Element {
  const percent = Math.round(mix.volume * 100);

  return (
    <div className={cx(styles.controls, mix.muted && styles.muted, locked && styles.locked)}>
      {/*
        The name is a button, and pressing it plays the sound. Learning what "Low
        Perc" is by tapping it is faster than any label could manage, and it is how
        the fader gets set to something musical while the transport is stopped.

        "Preview", not "Play". Eight buttons called "Play Kick" beside one called
        "Play" is eight chances to press the wrong thing, and for anyone listening to
        a list of buttons rather than looking at them it is worse than that.
      */}
      <button
        type="button"
        className={styles.name}
        onClick={onAudition}
        title={`Preview ${track.name}`}
        aria-label={`Preview ${track.name}`}
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

      {/*
        Lock: the generator may not alter this row.

        Not "the user may not edit it" — a locked track is still fully editable by hand,
        which is the whole point. You keep a kick you like and explore a different preset
        around it.

        A padlock rather than a colour change, and `aria-pressed` for anything listening.
      */}
      <button
        type="button"
        className={styles.lock}
        onClick={onToggleLock}
        aria-pressed={locked}
        aria-label={`Lock ${track.name} against the generator`}
        title={locked ? `${track.name} is locked against the generator` : `Lock ${track.name}`}
      >
        <span aria-hidden="true" className={styles.lockIcon}>
          <svg viewBox="0 0 16 16" width="12" height="12" focusable="false">
            <rect x="3.5" y="7" width="9" height="6.5" rx="1.4" fill="currentColor" />
            {locked ? (
              <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            ) : (
              <path
                d="M5.5 7V5.2a2.5 2.5 0 0 1 4.6-1.3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            )}
          </svg>
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
