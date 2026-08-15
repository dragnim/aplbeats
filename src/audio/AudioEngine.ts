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
import { REST, type Phrase } from '@/tones/phrase';
import type { ToneSampler } from './tones/ToneSampler';

/**
 * How hard the mix bus drives the master processing.
 *
 * Eight percussion voices can land on the same step, and the compressor below
 * catches that, but leaving headroom is better than relying on it.
 *
 * This is **not** the volume control, and the distinction matters more than the
 * name suggests. It sits *before* the compressor, so it decides how hard that
 * compressor is driven — which is part of how the instrument sounds, and part of
 * the gain staging every sampled kit was calibrated against in Stage 4. Turning it
 * down would quietly recalibrate the whole instrument. Master Volume is a separate
 * node at the very end of the chain; see `build`.
 */
const MIX_BUS_GAIN = 0.72;

/**
 * How long the output gain takes to reach a new setting.
 *
 * Twenty milliseconds: short enough that a slider feels connected to the sound,
 * long enough that the jump does not arrive as a click. A gain that moves
 * instantaneously is a step discontinuity in the waveform, and a step
 * discontinuity is a click — audible precisely when somebody is reaching for the
 * volume because it is already too loud.
 */
const VOLUME_RAMP_SECONDS = 0.02;

export interface AudioEngineOptions {
  /** Swap the kit. Present so a sample-backed kit can be dropped in, and for tests. */
  readonly kit?: Kit;
  /** Build the context. Present so tests can supply their own. */
  readonly createContext?: () => AudioContext;
}

interface Graph {
  readonly context: AudioContext;
  readonly voiceContext: VoiceContext;
  /**
   * Where the Tone sampler connects.
   *
   * Into the mix bus, *before* the compressor and the limiter — so a Tone is glued to the drums
   * by the same processing rather than sitting outside it. That is the one place it could go that
   * makes Beats and Tones sound like one instrument instead of two things playing at once.
   *
   * Its own gain, so Tone Volume attenuates the Tones and nothing else. When no Tone is sounding
   * this node passes silence, which is why adding it left the drum-only output measurably
   * unchanged: a gain node with nothing connected to it contributes nothing.
   */
  readonly toneBus: GainNode;
  /**
   * The last node before the speakers.
   *
   * Everything else in the chain is finished by the time signal arrives here: the
   * mix is balanced, the compressor has glued it together and the limiter has
   * caught the peaks. This only makes the result quieter.
   */
  readonly output: GainNode;
}

export class AudioEngine {
  private kit: Kit;
  private readonly createContext: () => AudioContext;
  /**
   * The listening level, 0 to 1, held whether or not a graph exists.
   *
   * Kept here rather than only on the node so that a volume chosen while the
   * machine is stopped is already in place when the audio device is finally
   * opened. Moving the slider must never open one by itself: a page that started
   * an `AudioContext` because somebody touched a fader would be a page that made
   * noise nobody asked for.
   */
  private masterVolume = 1;
  /** The Tone layer’s level, held whether or not a graph exists. */
  private toneVolume = 0.7;
  /** The installed Tone sound, or nothing. Null until a sound has been loaded. */
  private toneSampler: ToneSampler | null = null;
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

  /** The listening level, 0 to 1. */
  get volume(): number {
    return this.masterVolume;
  }

  /**
   * Set the listening level.
   *
   * Attenuation only: 1 is the output APL Beats has always had, and there is no
   * setting above it. A volume control that could add gain would be a volume
   * control that could clip, and the headroom at the top of this chain was
   * measured rather than guessed.
   *
   * Ramped rather than assigned, because an instantaneous gain change is a step in
   * the waveform and a step is a click. Any automation already scheduled is
   * cancelled first and the current value pinned, so dragging the slider quickly
   * cannot queue a tail of ramps fighting each other.
   *
   * Creates nothing. With no graph this only remembers the number, which is what
   * makes moving the fader while stopped genuinely free.
   */
  setMasterVolume(volume: number): void {
    const wanted = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    this.masterVolume = wanted;

    const graph = this.graph;
    if (graph === null) return;

    const { gain } = graph.output;
    const now = graph.context.currentTime;

    /*
     * `cancelScheduledValues` then `setValueAtTime` rather than
     * `cancelAndHoldAtTime`, which not every engine has — the same reason the
     * sampled voices choke the way they do.
     */
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(wanted, now + VOLUME_RAMP_SECONDS);
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
   * Sound one step of the Tone phrase, at the same instant.
   *
   * Called from the same `onStep` callback as `playStep`, with the same `time` — which is what
   * makes "one transport" true rather than merely intended. Swing has already been applied to
   * that number, so a Tone on step 3 is swung exactly as the snare on step 3 is, and neither can
   * drift from the other because neither has a clock of its own.
   *
   * **A rest strikes nothing; it does not cut what is ringing.** That is the one decision here
   * with a musical consequence, and the first version had it the other way round.
   *
   * Cutting on a rest makes every note exactly one step long — 134 ms at the opening tempo. The
   * Lead survives that, because it is a blip anyway. The Pad does not: its attack alone is 78 ms,
   * so a one-step note is an attack and nothing else, and the sound advertised as "sustained and
   * airy" arrives as a click. The opening phrase, six notes with gaps, became six disconnected
   * sixteenths instead of a line.
   *
   * Letting the note ring is also what the data says. `0` is a rest in the sense a step sequencer
   * means it — *no trigger on this step* — and `0<n` is still exactly the mask of struck notes,
   * which is what every Tone expression is written against. Nothing about the APL changes.
   *
   * The note ends on its own: the recordings are trimmed to 1.2 s with a fade at the boundary, so
   * a phrase of one note and fifteen rests decays and stops rather than droning. A new note takes
   * the voice from the old one, because the sampler is monophonic — which is what makes a dense
   * phrase articulate and a sparse one legato, from the same sixteen numbers.
   */
  playTone(phrase: Phrase, step: number, time: number, level: number): void {
    const graph = this.graph;
    const sampler = this.toneSampler;
    if (graph === null || sampler === null) return;

    const value = phrase[step] ?? REST;
    if (value === REST || level <= 0) return;

    sampler.play({ context: graph.context, destination: graph.toneBus }, time, value, level);
  }

  /**
   * Install the Tone sampler, or take it away.
   *
   * Atomic: the caller has already loaded and decoded every recording, so this is one assignment
   * and the next step plays the new sound. Whatever the old sampler was holding is silenced
   * first, because a swap that left the previous note ringing would sound like a fault.
   */
  setToneSampler(sampler: ToneSampler | null): void {
    const graph = this.graph;
    if (graph !== null && this.toneSampler !== null) this.toneSampler.silence(graph.context);
    this.toneSampler = sampler;
  }

  /** Whether a Tone sound is installed and could sound. */
  get hasTone(): boolean {
    return this.toneSampler !== null;
  }

  /**
   * How loud the Tones are, 0 to 1.
   *
   * Its own gain on its own bus, so it attenuates the Tone layer and leaves the drums exactly
   * where they were. Held here whether or not a graph exists, so a level chosen before the audio
   * device opened is the level it opens at — and reading it never creates a context.
   */
  setToneVolume(volume: number): void {
    const wanted = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    this.toneVolume = wanted;

    const graph = this.graph;
    if (graph === null) return;

    const { gain } = graph.toneBus;
    const now = graph.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(wanted, now + VOLUME_RAMP_SECONDS);
  }

  get toneLevel(): number {
    return this.toneVolume;
  }

  /**
   * Sound one pitch straight away, for auditioning.
   *
   * Used when a step's pitch is chosen, so editing a phrase while stopped still tells you what
   * you just wrote. The small offset ahead of the clock keeps the attack intact.
   */
  playTonePreview(midi: number, level: number): void {
    const graph = this.graph;
    const sampler = this.toneSampler;
    if (graph === null || sampler === null || level <= 0) return;

    sampler.play(
      { context: graph.context, destination: graph.toneBus },
      graph.context.currentTime + 0.01,
      midi,
      level,
    );
  }

  /** Silence the Tone layer now. Called when the transport stops. */
  silenceTone(): void {
    const graph = this.graph;
    if (graph === null || this.toneSampler === null) return;
    this.toneSampler.silence(graph.context);
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
    master.gain.value = MIX_BUS_GAIN;

    const glue = context.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.knee.value = 8;
    glue.ratio.value = 3.2;
    glue.attack.value = 0.004;
    glue.release.value = 0.14;

    /*
     * The volume control, last of all.
     *
     * After the compressor and the limiter rather than before them, which is the
     * whole point: attenuating a finished signal changes how loud it is and
     * nothing else. Put anywhere earlier it would change how hard the compressor
     * is driven, and turning the volume down would quietly alter the instrument's
     * character and invalidate Stage 4's kit calibration along with it.
     *
     * It starts at whatever was last chosen, so a graph built after the slider
     * moved opens at the right level rather than jumping to it.
     */
    const output = context.createGain();
    output.gain.value = this.masterVolume;

    /*
     * The Tone bus, joining the mix before the glue.
     *
     * Opens at whatever level was last chosen, for the same reason the output gain does: a graph
     * built after the slider moved should open at the right level rather than jump to it.
     */
    const toneBus = context.createGain();
    toneBus.gain.value = this.toneVolume;
    toneBus.connect(master);

    master.connect(glue);
    glue.connect(saturator(context, 1.25)).connect(output);
    output.connect(context.destination);

    const graph: Graph = {
      context,
      output,
      toneBus,
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
