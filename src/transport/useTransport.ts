import { useCallback, useEffect, useRef, useState } from 'react';
import type { Kit } from '@/audio/kit';
import type { Mixer } from '@/pattern/mixer';
import type { Pattern } from '@/pattern/pattern';
import type { TrackId } from '@/pattern/tracks';
import { Transport, type TransportState } from './Transport';

/*
 * The one file that knows both React and the audio clock.
 *
 * The two do not mix well and are kept apart everywhere else. React re-renders when
 * it likes; the beat may not. So the transport lives in a ref, outside the render
 * cycle entirely, and the only thing that crosses back into React is the playhead
 * position — one small integer, updated at most sixteen times a bar.
 *
 * Which is the point worth being explicit about: the animation frame loop below
 * *reads* the audio clock and never sets it. If frames stop arriving, the playhead
 * stops moving and the music does not, and when frames resume the playhead jumps to
 * where the music actually is. There is no queue of missed updates to replay,
 * because there is no queue.
 */

export interface UseTransportOptions {
  /** Read the pattern at the moment a step is scheduled. Must not be memoised stale. */
  readonly getPattern: () => Pattern;
  readonly getMixer: () => Mixer;
  readonly bpm: number;
  readonly swing: number;
  /** False while the tab is hidden: the transport pauses and the playhead stops. */
  readonly isVisible: boolean;
}

export interface TransportApi {
  readonly state: TransportState;
  readonly isPlaying: boolean;
  /** Which column the playhead is on. Meaningful while playing; the resume point when not. */
  readonly playheadStep: number;
  readonly play: () => void;
  readonly pause: () => void;
  readonly toggle: () => void;
  /** Sound one voice now, if the audio device is already open. */
  readonly audition: (trackId: TrackId, level: number) => void;
  /** Open the audio device from a gesture, so a later audition can be heard. */
  readonly prepare: () => void;
  /**
   * Swap the drum machine.
   *
   * Safe at any time, playing or stopped: it replaces eight voices and touches nothing else.
   */
  readonly setKit: (kit: Kit) => void;
  /**
   * Set the listening level, 0 to 1.
   *
   * Safe at any time, and it opens nothing: with no audio device yet the engine simply
   * remembers the number, so moving the fader while stopped costs nothing at all.
   */
  readonly setMasterVolume: (volume: number) => void;
}

export function useTransport(options: UseTransportOptions): TransportApi {
  const { getPattern, getMixer, bpm, swing, isVisible } = options;

  /*
   * The getters, behind refs.
   *
   * The transport is built once and must not be rebuilt when the pattern changes,
   * so it cannot close over the getters directly. It closes over these instead,
   * which each commit brings up to date — that is the whole mechanism by which a
   * cell switched on mid-bar is heard on the next pass without the transport
   * restarting.
   *
   * Updated in an effect rather than during render, which is both what React asks
   * for and harmless here: the scheduler reads these from a timer a tenth of a
   * second before a note sounds, and the gap between a commit and its effects is a
   * fraction of a frame.
   */
  const patternSource = useRef(getPattern);
  const mixerSource = useRef(getMixer);

  useEffect(() => {
    patternSource.current = getPattern;
    mixerSource.current = getMixer;
  }, [getPattern, getMixer]);

  const transportRef = useRef<Transport | null>(null);
  const [state, setState] = useState<TransportState>('stopped');
  const [playheadStep, setPlayheadStep] = useState(0);

  const getTransport = useCallback((): Transport => {
    transportRef.current ??= new Transport({
      getPattern: () => patternSource.current(),
      getMixer: () => mixerSource.current(),
      bpm,
      swing,
    });
    return transportRef.current;
    // bpm and swing seed the transport once; afterwards the effect below pushes
    // changes into it, so they are deliberately not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build on mount and release on unmount, which also releases the audio device.
  useEffect(() => {
    const transport = getTransport();
    const unsubscribe = transport.subscribe(setState);

    return () => {
      unsubscribe();
      transportRef.current = null;
      void transport.dispose();
    };
  }, [getTransport]);

  useEffect(() => {
    getTransport().setBpm(bpm);
  }, [bpm, getTransport]);

  useEffect(() => {
    getTransport().setSwing(swing);
  }, [swing, getTransport]);

  const play = useCallback(() => {
    void getTransport().play();
  }, [getTransport]);

  const pause = useCallback(() => {
    getTransport().pause();
  }, [getTransport]);

  const toggle = useCallback(() => {
    const transport = getTransport();
    if (transport.currentState === 'stopped') {
      void transport.play();
    } else {
      transport.pause();
    }
  }, [getTransport]);

  /*
   * Leaving the tab pauses the transport.
   *
   * Not merely because timers are throttled in a hidden tab — they are, to once a
   * second, which would shred the beat — but because a page that carries on
   * drumming after you have gone somewhere else is a page that gets muted and then
   * closed. Stopping is both the responsible behaviour and the expected one, and it
   * means there is nothing to catch up on when the tab comes back.
   */
  useEffect(() => {
    if (isVisible) return;
    getTransport().pause();
  }, [isVisible, getTransport]);

  /*
   * The playhead loop.
   *
   * Runs only while playing and only while the tab is visible; there is no frame
   * loop at all otherwise, which is what "low idle cost" has to mean in practice.
   * State is set only when the step number actually changes, so a sixty-hertz frame
   * loop causes about eleven re-renders a second at 112 BPM rather than sixty.
   */
  const isPlaying = state === 'playing';
  useEffect(() => {
    if (!isPlaying || !isVisible) return;

    const transport = getTransport();
    let frame = 0;
    let lastStep = -1;

    const tick = (): void => {
      const step = transport.playheadStep();
      if (step !== lastStep) {
        lastStep = step;
        setPlayheadStep(step);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isPlaying, isVisible, getTransport]);

  // When the transport stops, show where it will resume from rather than wherever
  // the last frame happened to land.
  useEffect(() => {
    if (isPlaying) return;
    setPlayheadStep(getTransport().playheadStep());
  }, [isPlaying, getTransport]);

  const audition = useCallback(
    (trackId: TrackId, level: number) => {
      getTransport().audition(trackId, level);
    },
    [getTransport],
  );

  const setKit = useCallback(
    (kit: Kit) => {
      // Builds the transport if it does not exist yet, which is silent: no AudioContext is
      // opened until the visitor presses Play.
      getTransport().setKit(kit);
    },
    [getTransport],
  );

  const setMasterVolume = useCallback(
    (volume: number) => {
      getTransport().setMasterVolume(volume);
    },
    [getTransport],
  );

  const prepare = useCallback(() => {
    void getTransport().prepare();
  }, [getTransport]);

  return {
    state,
    isPlaying,
    playheadStep,
    play,
    pause,
    toggle,
    audition,
    prepare,
    setKit,
    setMasterVolume,
  };
}
