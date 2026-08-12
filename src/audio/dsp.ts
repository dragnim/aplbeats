/*
 * The small pieces every voice is built from.
 *
 * Kept in one place because the eight voices in `kit.ts` differ in their tuning
 * and their envelopes rather than in their construction: nearly all of them are
 * some arrangement of a pitched oscillator, a burst of filtered noise and an
 * exponential decay. Writing that arrangement out eight times would hide the
 * differences that matter under the machinery that does not.
 */

/**
 * The floor used wherever a value is ramped exponentially.
 *
 * `exponentialRampToValueAtTime` cannot reach or pass through zero, so silence is
 * approached rather than arrived at. Small enough to be inaudible — about 100 dB
 * down — and large enough that the ramp stays well-conditioned.
 */
const SILENCE = 0.0001;

/**
 * A noise buffer, generated once per audio context and shared by every voice.
 *
 * Two seconds, so that a random read offset gives each hit a slightly different
 * slice. That variation is what stops a repeated hat sounding like the same
 * recording pasted sixteen times, and it costs nothing at playback.
 *
 * The values come from a fixed seed rather than `Math.random`, so the kit is the
 * same kit on every load and in every browser. A drum machine whose hats differ
 * between sessions is not one you can trust your ears about.
 */
export function createNoiseBuffer(context: BaseAudioContext, seconds = 2): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);

  // xorshift32, seeded. Adequate for white noise and short enough to read.
  let state = 0x9e3779b9;
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    samples[i] = (state / 0x80000000) * 0.9;
  }

  return buffer;
}

/**
 * A read position part-way into the noise buffer.
 *
 * Quantised to whole milliseconds and taken from a rolling counter rather than a
 * random source, for the same reason the buffer itself is seeded: the sequence of
 * hats over a bar should be reproducible. It still varies from hit to hit, which
 * is the whole point.
 */
let noiseCursor = 0;
export function nextNoiseOffset(buffer: AudioBuffer): number {
  noiseCursor = (noiseCursor + 977) % 1000;
  return (noiseCursor / 1000) * Math.max(0, buffer.duration - 0.5);
}

/** Reset the noise cursor, so a test can assert on a known sequence. */
export function resetNoiseCursor(): void {
  noiseCursor = 0;
}

export interface EnvelopeOptions {
  /** Level at the top of the attack, before the track's fader is applied. */
  readonly peak: number;
  /** Seconds to reach `peak`. Short but never zero, or the attack clicks. */
  readonly attack?: number;
  /** Seconds from `peak` back to silence. */
  readonly decay: number;
  /** Seconds held at `peak` between attack and decay. Rare; the claps use it. */
  readonly hold?: number;
}

/**
 * A gain node carrying a struck-percussion envelope: fast up, exponential down.
 *
 * Exponential rather than linear because that is how a struck thing actually
 * decays, and a linear fade on a drum sounds like a fade rather than like a drum.
 *
 * Returns the node and the moment it falls silent, which is when the caller should
 * stop whatever is feeding it.
 */
export function envelope(
  context: BaseAudioContext,
  time: number,
  { peak, attack = 0.002, decay, hold = 0 }: EnvelopeOptions,
): { node: GainNode; endTime: number } {
  const node = context.createGain();
  const gain = node.gain;

  const attackEnd = time + Math.max(attack, 0.0005);
  const decayStart = attackEnd + hold;
  const endTime = decayStart + decay;

  gain.setValueAtTime(SILENCE, time);
  gain.exponentialRampToValueAtTime(Math.max(peak, SILENCE * 2), attackEnd);
  if (hold > 0) gain.setValueAtTime(Math.max(peak, SILENCE * 2), decayStart);
  gain.exponentialRampToValueAtTime(SILENCE, endTime);

  return { node, endTime };
}

/*
 * Saturation curves, computed once per shape and reused.
 *
 * A `WaveShaper` curve is a thousand-odd floats. Building one per hit would put
 * that allocation on the path between "the scheduler decided" and "the sound
 * starts", which is exactly where nothing should be allocated if it can be helped.
 */
const curveCache = new Map<number, Float32Array<ArrayBuffer>>();

function saturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const cached = curveCache.get(amount);
  if (cached !== undefined) return cached;

  const length = 1024;
  const curve = new Float32Array(length);
  const scale = Math.tanh(amount);
  for (let i = 0; i < length; i += 1) {
    const x = (i * 2) / (length - 1) - 1;
    curve[i] = Math.tanh(x * amount) / scale;
  }

  curveCache.set(amount, curve);
  return curve;
}

/**
 * A soft-clipping stage: rounds the top off a waveform rather than squaring it.
 *
 * Used on the kick and on the master bus. On the kick it is tone — a hyperbolic
 * tangent adds even harmonics, which is most of what makes a synthesised kick
 * audible on a laptop speaker that cannot reproduce its fundamental at all. On the
 * master bus it is a safety net.
 */
export function saturator(context: BaseAudioContext, amount: number): WaveShaperNode {
  const shaper = context.createWaveShaper();
  shaper.curve = saturationCurve(amount);
  shaper.oversample = '2x';
  return shaper;
}

export interface FilterSpec {
  readonly type: BiquadFilterType;
  readonly frequency: number;
  readonly Q?: number;
  readonly gain?: number;
}

/** A biquad, configured. A one-line helper because the voices use a great many. */
export function filter(context: BaseAudioContext, spec: FilterSpec): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = spec.type;
  node.frequency.value = spec.frequency;
  if (spec.Q !== undefined) node.Q.value = spec.Q;
  if (spec.gain !== undefined) node.gain.value = spec.gain;
  return node;
}

/** Connect a chain of nodes in order and return the last one. */
export function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const from = nodes[i];
    const to = nodes[i + 1];
    if (from !== undefined && to !== undefined) from.connect(to);
  }
  const last = nodes[nodes.length - 1];
  if (last === undefined) throw new Error('A chain needs at least one node.');
  return last;
}

/**
 * Start a source, stop it when its envelope has finished, and let go of the graph.
 *
 * The explicit disconnect is what keeps the node count flat over a long session.
 * A finished source is eligible for collection on its own, but the nodes
 * downstream of it are not until nothing points at them, and an open hat at
 * sixteen hits a bar builds those up faster than it is comfortable to assume a
 * garbage collector will notice.
 */
export function startAndStop(source: AudioScheduledSourceNode, time: number, endTime: number): void {
  source.start(time);
  source.stop(endTime);
  source.addEventListener('ended', () => {
    source.disconnect();
  });
}

/** A source over the shared noise buffer, not yet started. */
export function noiseSource(context: BaseAudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = buffer;
  return source;
}

/**
 * As `startAndStop`, but reading from a varying point in the noise buffer.
 *
 * A separate function because a buffer source's `start` takes an offset and a
 * scheduled source's does not, and burying that difference behind an optional
 * argument would make the common call read as if it had one.
 */
export function startNoise(
  source: AudioBufferSourceNode,
  time: number,
  endTime: number,
  offset: number,
): void {
  source.start(time, offset);
  source.stop(endTime);
  source.addEventListener('ended', () => {
    source.disconnect();
  });
}

/** An oscillator, configured. */
export function oscillator(
  context: BaseAudioContext,
  type: OscillatorType,
  frequency: number,
): OscillatorNode {
  const node = context.createOscillator();
  node.type = type;
  node.frequency.value = frequency;
  return node;
}
