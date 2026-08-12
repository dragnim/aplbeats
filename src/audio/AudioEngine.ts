/*
 * The audio engine: the only thing in APL Beats that owns an `AudioContext`.
 *
 * Everything above it — the pattern, the mixer, the transport, the interface —
 * deals in numbers and times. This is where those become sound, and it is
 * deliberately the narrowest part of the application: build a context, keep a
 * master chain, hand a trigger to a voice at a stated moment on the audio clock.
 *
 * Two rules it exists to enforce.
 *
 * The context is created only in response to something the visitor did. Browsers
 * will not start audio otherwise, and quite right too — a page that begins making
 * noise on load is a page that gets closed. So construction is cheap and silent,
 * and `unlock` is what actually opens the audio device.
 *
 * And it is suspended the moment it has nothing to do. A running `AudioContext`
 * keeps an audio thread awake whether or not anything is connected to it, which on
 * a laptop is a fan and on a phone is battery. Stopped means stopped.
 */

import type { Mixer } from '@/pattern/mixer';
import type { Pattern } from '@/pattern/pattern';
import type { TrackId } from '@/pattern/tracks';
import { createNoiseBuffer, saturator } from './dsp';
import { SYNTH_KIT, type Kit, type VoiceContext } from './kit';
import { triggersForStep } from './triggers';

/**
 * How much of the way up the master fader is comfortable.
 *
 * Eight percussion voices can land on the same step, and the compressor below
 * catches that, but leaving headroom is better than relying on it.
 */
const MASTER_GAIN = 0.72;

export interface AudioEngineOptions {
  /** Swap the kit. Present so a sample-backed kit can be dropped in, and for tests. */
  readonly kit?: Kit;
  /** Build the context. Present so tests can supply their own. */
  readonly createContext?: () => AudioContext;
}

interface Graph {
  readonly context: AudioContext;
  readonly voiceContext: VoiceContext;
}

export class AudioEngine {
  private kit: Kit;
  private readonly createContext: () => AudioContext;
  private graph: Graph | null = null;

  constructor(options: AudioEngineOptions = {}) {
    this.kit = options.kit ?? SYNTH_KIT;
    this.createContext =
      options.createContext ??
      (() => {
        /*
         * `interactive` asks for the smallest buffer the device will give, which
         * is what makes a tapped pad feel connected to the finger that tapped it.
         * It costs a little more power than `playback` would; for an instrument
         * that is the right way round.
         */
        return new AudioContext({ latencyHint: 'interactive' });
      });
  }

  /** Whether the audio device is open and the clock is running. */
  get isRunning(): boolean {
    return this.graph?.context.state === 'running';
  }

  /**
   * Swap the kit, in one assignment.
   *
   * Atomic on purpose, and it is the whole of Stage 4's "never half one machine and half
   * another": the eight voices are replaced by one reference change, between scheduler ticks,
   * so no step can ever be sounded from a mixture. Notes already handed to Web Audio play out
   * on the kit that scheduled them, which is correct — they were promised at a time and with a
   * sound, and rewriting the past is neither possible nor desirable.
   *
   * It cannot reach the pattern, the transport or the clock. Changing kit while playing is
   * therefore not a special case that has to be handled; it is the ordinary case.
   */
  setKit(kit: Kit): void {
    this.kit = kit;
  }

  /**
   * Now, on the audio clock.
   *
   * Zero before the context exists. Callers schedule relative to this and never
   * to `Date.now` or to a frame time: the audio clock is the only one that runs on
   * the thread that will actually play the notes.
   */
  get currentTime(): number {
    return this.graph?.context.currentTime ?? 0;
  }

  /**
   * Open the audio device, building the graph on first use.
   *
   * Must be called from a user gesture — a click, a key press, a tap. Resolves once
   * the clock is genuinely running, which is why the transport awaits it before
   * scheduling anything: starting the scheduler against a suspended clock would
   * queue a bar of notes at times that had already passed by the time it woke up.
   */
  async unlock(): Promise<void> {
    const graph = this.graph ?? this.build();

    if (graph.context.state === 'suspended') {
      await graph.context.resume();
    }
  }

  /**
   * Put the audio device back to sleep.
   *
   * Called when the transport stops and when the tab is hidden. Anything already
   * scheduled is dropped, which is what makes stopping feel immediate rather than
   * playing out the last hundred milliseconds of look-ahead.
   */
  async suspend(): Promise<void> {
    const context = this.graph?.context;
    if (context === undefined || context.state !== 'running') return;
    await context.suspend();
  }

  /**
   * Sound one column of the pattern at `time`.
   *
   * `time` is expected to be in the near future. Passing a time that has already
   * gone by is not an error — Web Audio plays such an event immediately — but it
   * is the symptom of a scheduler that has fallen behind, which is what the
   * look-ahead window exists to prevent.
   */
  playStep(pattern: Pattern, mixer: Mixer, step: number, time: number): void {
    const graph = this.graph;
    if (graph === null) return;

    for (const trigger of triggersForStep(pattern, mixer, step)) {
      this.kit[trigger.trackId](graph.voiceContext, time, trigger.level);
    }
  }

  /**
   * Sound one voice straight away, for auditioning.
   *
   * Used when a cell is switched on, so editing a pattern while stopped still
   * tells you what you just added. A small `time` offset ahead of the clock keeps
   * the attack intact: scheduling at exactly `currentTime` can clip the first
   * milliseconds, because that moment may already be inside the buffer being
   * filled.
   */
  playVoice(trackId: TrackId, level: number): void {
    const graph = this.graph;
    if (graph === null || level <= 0) return;
    this.kit[trackId](graph.voiceContext, graph.context.currentTime + 0.01, level);
  }

  /** Close the audio device for good. */
  async close(): Promise<void> {
    const graph = this.graph;
    if (graph === null) return;
    this.graph = null;
    if (graph.context.state !== 'closed') {
      await graph.context.close();
    }
  }

  /**
   * The master chain, built once.
   *
   * Gain, then a compressor, then a soft limiter. The compressor is not a mastering
   * affectation: eight percussion voices with independent envelopes sum
   * unpredictably, and a shared compressor is what makes them sound like one kit in
   * one room rather than eight things that happen to be playing at once. The
   * limiter after it is the guarantee that a full pattern with every fader up
   * cannot clip.
   */
  private build(): Graph {
    const context = this.createContext();

    const master = context.createGain();
    master.gain.value = MASTER_GAIN;

    const glue = context.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.knee.value = 8;
    glue.ratio.value = 3.2;
    glue.attack.value = 0.004;
    glue.release.value = 0.14;

    master.connect(glue);
    glue.connect(saturator(context, 1.25)).connect(context.destination);

    const graph: Graph = {
      context,
      voiceContext: {
        context,
        destination: master,
        noise: createNoiseBuffer(context),
      },
    };

    this.graph = graph;
    return graph;
  }
}
