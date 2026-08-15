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
import type { Kit } from '@/audio/kit';
import type { ToneSampler } from '@/audio/tones/ToneSampler';
import { emptyPhrase, type Phrase } from '@/tones/phrase';
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
  /**
   * The Tone phrase, read at the instant a step is scheduled. Omitted by drum-only callers.
   *
   * A getter rather than a value, for the same reason the pattern is one: the scheduler asks what
   * the phrase is a hundred milliseconds before the step sounds, quite possibly between two React
   * renders. A phrase replaced by APL takes effect on the next unscheduled step, with nothing
   * restarting.
   */
  readonly getPhrase?: () => Phrase;
}

export interface TransportOptions extends TransportSources {
  readonly bpm: number;
  readonly swing: number;
  readonly engine?: AudioEngine;
  readonly setTimer?: (callback: () => void, ms: number) => CancelTimer;
}

export type TransportState = 'stopped' | 'starting' | 'playing';

/**
 * What a transport with no Tone layer plays: sixteen rests.
 *
 * Built once rather than per step. A drum-only caller — every test written before Stage 8, and the
 * audio regression suite that proves the kit still sounds exactly as it did — gets a phrase that
 * schedules nothing, so the Tone layer costs those callers one array lookup and no audio nodes.
 */
const SILENCE = emptyPhrase();
const SILENT_PHRASE = (): Phrase => SILENCE;

export class Transport {
  private readonly engine: AudioEngine;
  private readonly scheduler: Scheduler;
  private readonly getPattern: () => Pattern;
  private readonly getMixer: () => Mixer;
  private readonly getPhrase: () => Phrase;

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
    this.getPhrase = options.getPhrase ?? SILENT_PHRASE;
    this.bpm = clampBpm(options.bpm);
    this.swing = clampSwing(options.swing);

    this.scheduler = new Scheduler({
      clock: () => this.engine.currentTime,
      getTempo: () => ({ bpm: this.bpm, swing: this.swing }),
      onStep: (step, time) => {
        /*
         * One callback, one time, both layers.
         *
         * This is where "one transport" stops being an intention and becomes a fact. The drums
         * and the Tone phrase are handed the *same* number, which the scheduler has already swung, so
         * step 3 of the phrase lands on the instant step 3 of the pattern does. Neither layer has
         * a clock, a timer or a position of its own, so there is nothing that could drift.
         */
        this.engine.playStep(this.getPattern(), this.getMixer(), step, time);
        this.engine.playTone(this.getPhrase(), step, time, 1);
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

  /**
   * Change how loud the Tones are, 0 to 1.
   *
   * Its own bus, so this attenuates the Tone layer and leaves the drums exactly where they were.
   * Like the kit and the master volume, deliberately not a special case for "while playing".
   */
  setToneVolume(volume: number): void {
    this.engine.setToneVolume(volume);
  }

  /**
   * Install the Tone sound, once its recordings have decoded.
   *
   * One assignment, between scheduler ticks, exactly as the kit is swapped — so switching sound
   * cannot restart the bar, move the playhead or interrupt the drums.
   */
  setToneSampler(sampler: ToneSampler | null): void {
    this.engine.setToneSampler(sampler);
  }

  /** Sound one pitch now, for auditioning a step while stopped. */
  previewTone(midi: number, level = 1): void {
    this.engine.playTonePreview(midi, level);
  }

  /**
   * Change the listening level, 0 to 1.
   *
   * Forwarded straight to the engine, which attenuates its finished output. Like the kit, this
   * is deliberately not a special case for "while playing": the transport's state, clock, tempo
   * and position are all untouched, so there is nothing to restart.
   */
  setMasterVolume(volume: number): void {
    this.engine.setMasterVolume(volume);
  }

  /**
   * Change which kit sounds the pattern.
   *
   * Forwarded straight to the engine, which swaps it in one assignment. Deliberately not a
   * special case for "while playing": the transport's state, its clock, its tempo and its
   * position are all untouched, so there is nothing to restart and nothing to reset.
   */
  setKit(kit: Kit): void {
    this.engine.setKit(kit);
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
    /*
     * A drum hit is over before the button is released; a Tone note is not.
     *
     * The sampler holds one sounding voice which may have up to a second of recording left, and
     * suspending the context below would freeze it mid-note rather than end it — so pressing Play
     * again would resume a note from the bar before. Released here, on the ramp, so Stop sounds
     * like an instrument stopping rather than like a tape being cut.
     */
    this.engine.silenceTone();
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
