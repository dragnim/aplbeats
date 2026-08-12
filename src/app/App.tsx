import { useCallback, useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/Logo';
import { Sequencer } from '@/components/Sequencer';
import { TransportBar } from '@/components/TransportBar';
import { createInitialGroove, INITIAL_BPM, INITIAL_SWING } from '@/pattern/initialGroove';
import {
  createMixer,
  effectiveLevel,
  setVolume,
  toggleMute,
  trackIdFor,
  type Mixer,
} from '@/pattern/mixer';
import { setCell, type Pattern } from '@/pattern/pattern';
import { TRACKS } from '@/pattern/tracks';
import { clampBpm, clampSwing } from '@/transport/timing';
import { useTransport } from '@/transport/useTransport';
import { usePageVisibility } from './usePageVisibility';
import styles from './App.module.css';

/*
 * The application.
 *
 * All of the state that survives a render lives here — the pattern, the mixer, the
 * tempo — and it is all plain data. The transport reads it through getters, so it
 * never holds a copy that could go stale and never needs restarting when a cell
 * changes.
 *
 * There is no store and no reducer, on purpose. Four pieces of state and a handful
 * of pure functions over them is the whole model at Stage 1, and the shape it needs
 * for Stage 2 — a stack of these patterns for undo, a seeded generator writing a
 * whole new one — is one it already has.
 */
export function App(): React.JSX.Element {
  const [pattern, setPattern] = useState<Pattern>(createInitialGroove);
  const [mixer, setMixer] = useState<Mixer>(createMixer);
  const [bpm, setBpm] = useState(INITIAL_BPM);
  const [swing, setSwing] = useState(INITIAL_SWING);

  const isVisible = usePageVisibility();

  /*
   * The transport's window onto the current state.
   *
   * Refs rather than the values themselves, because the scheduler asks what the
   * pattern is at the instant it hands a step to Web Audio — which is a hundred
   * milliseconds before that step sounds, and quite possibly between two React
   * renders. Reading through a ref is what makes an edit audible on the next pass
   * of the bar with nothing restarted and no scheduling missed.
   */
  const patternRef = useRef(pattern);
  const mixerRef = useRef(mixer);

  useEffect(() => {
    patternRef.current = pattern;
    mixerRef.current = mixer;
  }, [pattern, mixer]);

  /*
   * Stable getters, so the transport is built once and never rebuilt.
   *
   * `useCallback` with no dependencies is the point: if these identities changed
   * with the pattern, every edit would look to `useTransport` like a new transport
   * was wanted, and every edit would stop the music.
   */
  const getPattern = useCallback(() => patternRef.current, []);
  const getMixer = useCallback(() => mixerRef.current, []);

  const transport = useTransport({ getPattern, getMixer, bpm, swing, isVisible });

  /*
   * Switching a step on plays it.
   *
   * The immediate feedback matters more than it sounds like it should: it is what
   * turns the grid from a form into an instrument, and it means the pattern can be
   * built up by ear while the transport is stopped. Switching one *off* plays
   * nothing, because silence is not a sound to preview.
   */
  const handleSetCell = useCallback(
    (track: number, step: number, value: boolean) => {
      setPattern((current) => setCell(current, track, step, value));

      if (!value || transport.isPlaying) return;
      const trackId = trackIdFor(track);
      if (trackId === undefined) return;
      transport.audition(trackId, effectiveLevel(mixer, track));
    },
    [mixer, transport],
  );

  const handleAuditionTrack = useCallback(
    (track: number) => {
      const trackId = trackIdFor(track);
      if (trackId === undefined) return;
      // Auditioned at the fader's level so it is the same sound at the same weight
      // it will have in the pattern — but never silent, or pressing the name of a
      // muted track would seem broken.
      const level = effectiveLevel(mixer, track);
      transport.audition(trackId, level > 0 ? level : 0.6);
    },
    [mixer, transport],
  );

  const handleToggleMute = useCallback((track: number) => {
    setMixer((current) => toggleMute(current, track));
  }, []);

  const handleVolumeChange = useCallback((track: number, volume: number) => {
    setMixer((current) => setVolume(current, track, volume));
  }, []);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <Logo />
        </h1>
        <p className={styles.tagline}>
          Make beats first. <span className={styles.taglineSecond}>Discover array programming second.</span>
        </p>
      </header>

      <main className={styles.main}>
        <h2 className="visuallyHidden">Transport</h2>
        <TransportBar
          state={transport.state}
          bpm={bpm}
          swing={swing}
          onToggle={transport.toggle}
          onBpmChange={(next) => {
            setBpm(clampBpm(next));
          }}
          onSwingChange={(next) => {
            setSwing(clampSwing(next));
          }}
        />

        <h2 className="visuallyHidden">Pattern</h2>
        <Sequencer
          pattern={pattern}
          mixer={mixer}
          playheadStep={transport.playheadStep}
          isPlaying={transport.isPlaying}
          onSetCell={handleSetCell}
          onToggleMute={handleToggleMute}
          onVolumeChange={handleVolumeChange}
          onAuditionTrack={handleAuditionTrack}
          onEditGesture={transport.prepare}
        />

        {/*
          Spoken, not shown. The Play button's name already changes, but a name
          changes silently for someone who is not on it — and while the tab was
          hidden the transport will have paused itself, which is a change nobody
          asked for and everybody should be told about.
        */}
        <p className="visuallyHidden" role="status">
          {transport.isPlaying ? 'Playing' : 'Paused'}
        </p>
      </main>

      <footer className={styles.footer}>
        <p className={styles.note}>
          An early-stage experiment. Eight tracks, sixteen steps, and an{' '}
          <span className={styles.emphasis}>
            {TRACKS.length} × 16
          </span>{' '}
          Boolean matrix underneath — which is where the APL comes in later.
        </p>
        <a
          className={styles.link}
          href="https://github.com/dragnim/aplbeats"
          rel="noreferrer noopener"
          target="_blank"
        >
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
