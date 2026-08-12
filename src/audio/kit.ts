/*
 * The kit: eight synthesised percussion voices.
 *
 * These are synthesised rather than sampled, and that is a considered choice
 * rather than the easy one. Bundling samples means bundling provenance, and a
 * public repository should not carry audio whose licence anyone has to take on
 * trust. Synthesis has no such problem, adds nothing to the download, and — because
 * a voice is a function of its parameters — is the form a later release can open up
 * to editing.
 *
 * It is not, however, the same as bleeping. Each of these is modelled on how the
 * instrument it is named after actually behaves, and on how the classic drum
 * machines got there: a pitch-swept sine with a saturated top for the kick, tuned
 * noise over two detuned bodies for the snare, a bank of square waves at
 * inharmonic ratios squeezed through a narrow high band for the hats, four
 * overlapping noise bursts for the clap. Every number below was arrived at by
 * listening.
 *
 * Sound design remains provisional all the same, and is expected to be revisited.
 * The `Kit` interface is the seam: a sample-backed kit satisfying the same
 * signature can replace this one without the sequencer, the scheduler or the
 * interface knowing that anything changed.
 */

import { TRACK_IDS, type TrackId } from '@/pattern/tracks';
import {
  chain,
  envelope,
  filter,
  nextNoiseOffset,
  noiseSource,
  oscillator,
  saturator,
  startAndStop,
  startNoise,
} from './dsp';

/** What a voice is given when it is asked to make a sound. */
export interface VoiceContext {
  readonly context: BaseAudioContext;
  /** Where the voice's output goes: the mixer's input, not the speakers. */
  readonly destination: AudioNode;
  /** The shared noise buffer, generated once per context. */
  readonly noise: AudioBuffer;
}

/**
 * A voice: build a graph that sounds once at `time`, at `level`.
 *
 * `time` is on the audio clock and is normally in the future — that is the entire
 * basis of the look-ahead scheduler. A voice must therefore schedule everything
 * with explicit times and never rely on when it happened to be called.
 */
export type Voice = (voiceContext: VoiceContext, time: number, level: number) => void;

export type Kit = Readonly<Record<TrackId, Voice>>;

/* ------------------------------------------------------------------------- */

/**
 * Kick: a sine swept down hard, saturated.
 *
 * The sweep from 165 Hz to 47 Hz over ninety milliseconds is the whole sound — it
 * is what the ear reads as a beater striking a head under tension. The saturation
 * after it matters more than it looks: laptop and phone speakers cannot reproduce
 * 47 Hz at all, and it is the harmonics tanh adds that let them imply it.
 */
const kick: Voice = ({ context, destination, noise }, time, level) => {
  const { node: gain, endTime } = envelope(context, time, {
    peak: level * 0.66,
    attack: 0.004,
    decay: 0.44,
  });

  const body = oscillator(context, 'sine', 165);
  body.frequency.setValueAtTime(165, time);
  body.frequency.exponentialRampToValueAtTime(47, time + 0.09);

  chain(body, gain, saturator(context, 1.7), destination);
  startAndStop(body, time, endTime);

  // The beater itself: a few milliseconds of top end, which is what makes the
  // kick locate in time rather than merely arrive.
  const { node: clickGain, endTime: clickEnd } = envelope(context, time, {
    peak: level * 0.3,
    attack: 0.0005,
    decay: 0.022,
  });
  const click = noiseSource(context, noise);
  chain(click, filter(context, { type: 'bandpass', frequency: 2400, Q: 0.8 }), clickGain, destination);
  startNoise(click, time, clickEnd, nextNoiseOffset(noise));
};

/**
 * Snare: tuned noise over two detuned bodies.
 *
 * The two triangles a fifth-and-a-bit apart are the drum; the noise is the wires
 * underneath it. Their decays differ on purpose — the body dies in ninety
 * milliseconds, the wires ring on for twice that — because a snare where both
 * stop together sounds like a gated sample.
 */
const snare: Voice = ({ context, destination, noise }, time, level) => {
  const { node: bodyGain, endTime: bodyEnd } = envelope(context, time, {
    peak: level * 0.42,
    attack: 0.001,
    decay: 0.095,
  });
  chain(bodyGain, filter(context, { type: 'highpass', frequency: 220 }), destination);

  for (const frequency of [186, 278]) {
    const partial = oscillator(context, 'triangle', frequency);
    partial.frequency.setValueAtTime(frequency, time);
    partial.frequency.exponentialRampToValueAtTime(frequency * 0.86, time + 0.07);
    partial.connect(bodyGain);
    startAndStop(partial, time, bodyEnd);
  }

  const { node: rattleGain, endTime: rattleEnd } = envelope(context, time, {
    peak: level * 0.62,
    attack: 0.0008,
    decay: 0.185,
  });
  const rattle = noiseSource(context, noise);
  chain(
    rattle,
    filter(context, { type: 'highpass', frequency: 420 }),
    filter(context, { type: 'bandpass', frequency: 1750, Q: 0.55 }),
    rattleGain,
    destination,
  );
  startNoise(rattle, time, rattleEnd, nextNoiseOffset(noise));
};

/*
 * The hat metal.
 *
 * Six square waves at these ratios of a 40 Hz base, listened to through a narrow
 * band up at nine kilohertz: the design the TR-808 used, and the reason its hats
 * sound like metal rather than like filtered hiss. None of the ratios is a whole
 * multiple of another, so nothing lines up into a pitch — which is what
 * distinguishes a cymbal from a bell.
 */
const HAT_BASE_HZ = 40;
const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21] as const;

function hat(
  { context, destination, noise }: VoiceContext,
  time: number,
  level: number,
  decay: number,
  brightness: number,
): void {
  const { node: gain, endTime } = envelope(context, time, {
    peak: level * 1.3,
    attack: 0.0008,
    decay,
  });

  chain(
    gain,
    filter(context, { type: 'bandpass', frequency: 9200 * brightness, Q: 0.7 }),
    filter(context, { type: 'highpass', frequency: 6800 }),
    destination,
  );

  const metal = context.createGain();
  metal.gain.value = 0.34;
  metal.connect(gain);
  for (const ratio of HAT_RATIOS) {
    const partial = oscillator(context, 'square', HAT_BASE_HZ * ratio);
    partial.connect(metal);
    startAndStop(partial, time, endTime);
  }

  // Air over the metal. The 808 has none of this and sounds like the 808; a
  // little of it is what stops these reading as synthetic on good headphones.
  const air = context.createGain();
  air.gain.value = 0.5;
  air.connect(gain);
  const hiss = noiseSource(context, noise);
  chain(hiss, air);
  startNoise(hiss, time, endTime, nextNoiseOffset(noise));
}

/** Closed hat: the metal, choked. Forty-five milliseconds and gone. */
const closedHat: Voice = (voiceContext, time, level) => {
  hat(voiceContext, time, level, 0.046, 1.05);
};

/**
 * Open hat: the same metal left to ring.
 *
 * Slightly darker as well as longer, because an open cymbal's low partials are
 * audible where a choked one's never get the chance.
 */
const openHat: Voice = (voiceContext, time, level) => {
  hat(voiceContext, time, level * 0.78, 0.42, 0.92);
};

/**
 * Clap: three fast bursts and a tail.
 *
 * A clap is several hands not quite together, so this is one noise source whose
 * gain is stepped three times eleven milliseconds apart before being allowed to
 * decay properly. The stagger is the sound; a single burst through the same filter
 * is a snare with the body missing.
 */
const clap: Voice = ({ context, destination, noise }, time, level) => {
  const BURST_GAP = 0.011;
  const BURSTS = 3;
  const tailDecay = 0.19;
  const endTime = time + BURST_GAP * BURSTS + tailDecay;

  const gain = context.createGain();
  const peak = level * 1.4;
  gain.gain.setValueAtTime(0.0001, time);

  for (let burst = 0; burst < BURSTS; burst += 1) {
    const at = time + burst * BURST_GAP;
    gain.gain.setValueAtTime(peak * (0.62 + burst * 0.19), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + BURST_GAP * 0.92);
  }

  const tailStart = time + BURST_GAP * BURSTS;
  gain.gain.setValueAtTime(peak, tailStart);
  gain.gain.exponentialRampToValueAtTime(0.0001, tailStart + tailDecay);

  const source = noiseSource(context, noise);
  chain(
    source,
    filter(context, { type: 'bandpass', frequency: 1150, Q: 1.0 }),
    filter(context, { type: 'peaking', frequency: 2100, Q: 1.4, gain: 6 }),
    gain,
    destination,
  );
  startNoise(source, time, endTime, nextNoiseOffset(noise));
};

/**
 * Low percussion: a low tom, tuned under the snare and clear of the kick.
 *
 * 148 Hz falling to 92 Hz. High enough that it does not fight the kick's
 * fundamental, low enough that it still reads as a drum rather than as a bongo.
 */
const lowPerc: Voice = ({ context, destination, noise }, time, level) => {
  const { node: gain, endTime } = envelope(context, time, {
    peak: level * 0.48,
    attack: 0.002,
    decay: 0.3,
  });

  const body = oscillator(context, 'triangle', 148);
  body.frequency.setValueAtTime(148, time);
  body.frequency.exponentialRampToValueAtTime(92, time + 0.085);
  chain(body, gain, saturator(context, 1.2), destination);
  startAndStop(body, time, endTime);

  const { node: skinGain, endTime: skinEnd } = envelope(context, time, {
    peak: level * 0.14,
    attack: 0.0005,
    decay: 0.016,
  });
  const skin = noiseSource(context, noise);
  chain(skin, filter(context, { type: 'bandpass', frequency: 1400, Q: 0.9 }), skinGain, destination);
  startNoise(skin, time, skinEnd, nextNoiseOffset(noise));
};

/**
 * High percussion: the same drum struck near the rim, an octave and a half up.
 *
 * Shorter, brighter and with more of the strike in it, so it answers the low tom
 * rather than repeating it.
 */
const highPerc: Voice = ({ context, destination, noise }, time, level) => {
  const { node: gain, endTime } = envelope(context, time, {
    peak: level * 0.58,
    attack: 0.0015,
    decay: 0.16,
  });

  const body = oscillator(context, 'triangle', 392);
  body.frequency.setValueAtTime(392, time);
  body.frequency.exponentialRampToValueAtTime(322, time + 0.035);
  chain(body, gain, destination);
  startAndStop(body, time, endTime);

  const { node: skinGain, endTime: skinEnd } = envelope(context, time, {
    peak: level * 0.3,
    attack: 0.0005,
    decay: 0.024,
  });
  const skin = noiseSource(context, noise);
  chain(skin, filter(context, { type: 'bandpass', frequency: 2800, Q: 1.1 }), skinGain, destination);
  startNoise(skin, time, skinEnd, nextNoiseOffset(noise));
};

/**
 * Rim: a rimshot. Almost all attack and no sustain at all.
 *
 * Two oscillators far apart through one narrow band, over in thirty
 * milliseconds. Its job in the groove is to place an accent precisely, so
 * anything that rang would defeat it.
 */
const rim: Voice = ({ context, destination, noise }, time, level) => {
  const { node: gain, endTime } = envelope(context, time, {
    peak: level * 0.72,
    attack: 0.0005,
    decay: 0.032,
  });

  chain(gain, filter(context, { type: 'bandpass', frequency: 1900, Q: 4.5 }), destination);

  for (const [type, frequency] of [
    ['square', 1720],
    ['triangle', 468],
  ] as const) {
    const partial = oscillator(context, type, frequency);
    partial.connect(gain);
    startAndStop(partial, time, endTime);
  }

  const { node: tickGain, endTime: tickEnd } = envelope(context, time, {
    peak: level * 0.26,
    attack: 0.0004,
    decay: 0.01,
  });
  const tick = noiseSource(context, noise);
  chain(tick, filter(context, { type: 'highpass', frequency: 3200 }), tickGain, destination);
  startNoise(tick, time, tickEnd, nextNoiseOffset(noise));
};

/* ------------------------------------------------------------------------- */

/**
 * The kit, keyed by track identifier.
 *
 * A record rather than an array so the engine looks a voice up by name. The row a
 * voice sits on is the interface's business, and one day APL's; which sound it is
 * belongs here.
 */
export const SYNTH_KIT: Kit = {
  kick,
  snare,
  closedHat,
  openHat,
  clap,
  lowPerc,
  highPerc,
  rim,
};

/*
 * Every track has a voice. Cheap to check at import time, and it fails loudly on
 * the one mistake this file invites: adding a ninth track and forgetting the sound.
 */
for (const id of TRACK_IDS) {
  if (typeof SYNTH_KIT[id] !== 'function') {
    throw new Error(`The kit has no voice for the "${id}" track.`);
  }
}
