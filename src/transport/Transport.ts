/*
 * The transport: Play, Pause, and the tempo the two of them run at.
 *
 * It owns the scheduler and the audio engine and joins them to the current
 * pattern, which it reaches through getters rather than holding a copy. That
 * indirection is the reason a cell switched on mid-bar is audible on the next pass
 * without restarting anything: the scheduler asks what the pattern is at the moment
 * it schedules a step, and gets whatever the interface last rendered.
 *
 * Nothing here touches the DOM and nothing here re-renders. React observes it
 * through `useTransport`, which is the only file that knows both worlds.
 */

import { AudioEngine } from '@/audio/AudioEngine';
import type { Mixer } from '@/pattern/mixer';
import type { Pattern } from '@/pattern/pattern';
import type { TrackId } from '@/pattern/tracks';
import { Scheduler, type CancelTimer } from './Scheduler';
import { clampBpm, clampSwing } from './timing';

export interface TransportSources {
  /** The pattern as it stands now. Read afresh for every step scheduled. */
  readonly getPattern: () => Pattern;
  /** The mixer as it stands now. */
  readonly getMixer: () => Mixer;
}

export interface TransportOptions extends TransportSources {
  readonly bpm: number;
  readonly swing: number;
  readonly engine?: AudioEngine;
  readonly setTimer?: (callback: () => void, ms: number) => CancelTimer;
}

export type TransportState = 'stopped' | 'starting' | 'playing';

export class Transport {
  private readonly engine: AudioEngine;
  private readonly scheduler: Scheduler;
  private readonly getPattern: () => Pattern;
  private readonly getMixer: () => Mixer;

  private bpm: number;
  private swing: number;
  private state: TransportState = 'stopped';

  /**
   * Which attempt to start we are on.
   *
   * Opening the audio device is asynchronous, so between pressing Play and the
   * clock running there is a window in which Pause can be pressed. This counter is
   * how that is resolved: a start whose number has been superseded abandons itself
   * rather than beginning to play into a transport that has since been stopped.
   */
  private startGeneration = 0;

  private listeners = new Set<(state: TransportState) => void>();

  constructor(options: TransportOptions) {
    this.engine = options.engine ?? new AudioEngine();
    this.getPattern = options.getPattern;
    this.getMixer = options.getMixer;
    this.bpm = clampBpm(options.bpm);
    this.swing = clampSwing(options.swing);

    this.scheduler = new Scheduler({
      clock: () => this.engine.currentTime,
      getTempo: () => ({ bpm: this.bpm, swing: this.swing }),
      onStep: (step, time) => {
        this.engine.playStep(this.getPattern(), this.getMixer(), step, time);
      },
      ...(options.setTimer === undefined ? {} : { setTimer: options.setTimer }),
    });
  }

  get isPlaying(): boolean {
    return this.state === 'playing';
  }

  /** `stopped`, `starting` while the audio device opens, then `playing`. */
  get currentState(): TransportState {
    return this.state;
  }

  /** Where the playhead is, read from the audio clock. Safe to call every frame. */
  playheadStep(): number {
    return this.scheduler.playheadStep();
  }

  /** Watch for transport state changes. Returns an unsubscribe function. */
  subscribe(listener: (state: TransportState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setBpm(bpm: number): void {
    // Applied from the next step scheduled, not retroactively to notes already
    // handed over. A tempo change while playing is therefore heard within a
    // sixteenth and never re-times something already in flight.
    this.bpm = clampBpm(bpm);
  }

  setSwing(swing: number): void {
    this.swing = clampSwing(swing);
  }

  /**
   * Start playing.
   *
   * Must be called from a user gesture, because opening the audio device requires
   * one. Awaiting the unlock before starting the scheduler is not politeness: a
   * suspended context's clock is frozen, so a scheduler started against it would
   * hand a whole window of notes to times in the past.
   */
  async play(): Promise<void> {
    if (this.state !== 'stopped') return;

    const generation = this.startGeneration + 1;
    this.startGeneration = generation;
    this.setState('starting');

    try {
      await this.engine.unlock();
    } catch (error) {
      // A browser that refuses to open an audio device — no output, a policy the
      // gesture did not satisfy — should leave a transport that plainly did not
      // start, not one stuck mid-way.
      console.error('APL Beats could not start audio.', error);
      if (this.startGeneration === generation) this.setState('stopped');
      return;
    }

    if (this.startGeneration !== generation) return;

    this.scheduler.start();
    this.setState('playing');
  }

  /** Stop playing, keeping the position in the bar. */
  pause(): void {
    this.startGeneration += 1;
    this.scheduler.pause();
    this.setState('stopped');
    // Suspending is what makes a stopped transport genuinely idle: no audio thread,
    // no timer, no work. Nothing waits on it, so a rejection is only worth a note.
    void this.engine.suspend().catch((error: unknown) => {
      console.warn('APL Beats could not suspend audio.', error);
    });
  }

  /** Play one voice now, for auditioning an edit while stopped. */
  audition(trackId: TrackId, level: number): void {
    if (!this.engine.isRunning) return;
    this.engine.playVoice(trackId, level);
  }

  /**
   * Open the audio device without starting the transport.
   *
   * Called from the first gesture that edits a cell, so that switching a cell on
   * while stopped can be heard. Failure is silent by design: not being able to
   * audition an edit is a small loss, and a visitor who has not asked to hear
   * anything should not be told off about it.
   */
  async prepare(): Promise<void> {
    try {
      await this.engine.unlock();
    } catch {
      // Deliberately ignored — see above.
    }
  }

  /** Release the audio device. */
  async dispose(): Promise<void> {
    this.scheduler.stop();
    this.listeners.clear();
    await this.engine.close();
  }

  private setState(state: TransportState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
