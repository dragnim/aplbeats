/*
 * Enough AIFF to read the Jupiter-4 recordings, and no more.
 *
 * The upstream audio is AIFF: 44.1 kHz, 24-bit, stereo, with `MARK` and `INST` chunks carrying
 * the sustain loop the SFZ mappings also describe. Node has no AIFF reader, and pulling in a
 * library to parse four chunk types would be a dependency to keep up to date for the sake of
 * about ninety lines.
 *
 * Deliberately narrow: it reads 16- and 24-bit big-endian PCM and refuses anything else rather
 * than guessing. Guessing here would mean shipping a sample that sounds subtly wrong, which is
 * the hardest kind of fault to notice later.
 *
 * The loop is read from `INST` + `MARK` — `INST` names two marker ids for the sustain loop and
 * `MARK` gives each marker's frame position. That is checked against the SFZ's own loop numbers
 * by the preparation script, because two independent sources agreeing is worth more than either.
 */

/** Decode an AIFF buffer to interleaved-free float channels plus its metadata. */
export function readAiff(buffer) {
  if (buffer.subarray(0, 4).toString('latin1') !== 'FORM') throw new Error('not an AIFF: no FORM');
  const kind = buffer.subarray(8, 12).toString('latin1');
  if (kind !== 'AIFF' && kind !== 'AIFC') throw new Error(`unsupported FORM type ${kind}`);

  let channels = 0;
  let frames = 0;
  let bits = 0;
  let sampleRate = 0;
  /** @type {Buffer | null} */
  let sound = null;
  /** @type {Map<number, number>} */
  const markers = new Map();
  let loop = null;

  let at = 12;
  while (at + 8 <= buffer.length) {
    const id = buffer.subarray(at, at + 4).toString('latin1');
    const size = buffer.readUInt32BE(at + 4);
    const body = at + 8;

    if (id === 'COMM') {
      channels = buffer.readUInt16BE(body);
      frames = buffer.readUInt32BE(body + 2);
      bits = buffer.readUInt16BE(body + 6);
      sampleRate = readExtended(buffer, body + 8);
    } else if (id === 'SSND') {
      // The first two longs are an offset and a block size; the samples follow.
      const soundOffset = buffer.readUInt32BE(body);
      sound = buffer.subarray(body + 8 + soundOffset, body + size);
    } else if (id === 'MARK') {
      const count = buffer.readUInt16BE(body);
      let scan = body + 2;
      for (let index = 0; index < count; index += 1) {
        const markerId = buffer.readInt16BE(scan);
        const position = buffer.readUInt32BE(scan + 2);
        const nameLength = buffer.readUInt8(scan + 6);
        markers.set(markerId, position);
        // A pascal string, padded to an even total length.
        scan += 7 + nameLength + ((nameLength + 1) % 2);
      }
    } else if (id === 'INST') {
      const playMode = buffer.readInt16BE(body + 8);
      const begin = buffer.readInt16BE(body + 10);
      const end = buffer.readInt16BE(body + 12);
      if (playMode !== 0) loop = { playMode, beginId: begin, endId: end };
    }

    at = body + size + (size % 2);
  }

  if (sound === null) throw new Error('no SSND chunk');
  if (bits !== 16 && bits !== 24) throw new Error(`unsupported bit depth ${String(bits)}`);

  const data = decodePcm(sound, channels, frames, bits);

  let loopFrames = null;
  if (loop !== null) {
    const start = markers.get(loop.beginId);
    const end = markers.get(loop.endId);
    if (start !== undefined && end !== undefined && end > start) loopFrames = { start, end };
  }

  return { channels, frames, bits, sampleRate, data, loop: loopFrames };
}

/** Big-endian PCM to one float array per channel, in [-1, 1]. */
function decodePcm(sound, channels, frames, bits) {
  const bytes = bits / 8;
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  const scale = 1 / (1 << (bits - 1));

  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const at = (frame * channels + channel) * bytes;
      if (at + bytes > sound.length) break;

      let value;
      if (bits === 16) value = sound.readInt16BE(at);
      else {
        // 24-bit big-endian, sign-extended by hand.
        const raw = (sound[at] << 16) | (sound[at + 1] << 8) | sound[at + 2];
        value = raw >= 0x800000 ? raw - 0x1000000 : raw;
      }
      out[channel][frame] = value * scale;
    }
  }

  return out;
}

/** The 80-bit IEEE extended float AIFF uses for its sample rate. */
function readExtended(buffer, at) {
  const exponent = buffer.readUInt16BE(at);
  const high = buffer.readUInt32BE(at + 2);
  const low = buffer.readUInt32BE(at + 6);
  return (high * 2 ** 32 + low) * 2 ** (exponent - 16383 - 63);
}

/**
 * Mono, by averaging.
 *
 * The Jupiter-4 is a monophonic-per-voice analogue synth and every SFZ region here is centred
 * (`pan=50`), so the two channels are a stereo *treatment* rather than two different signals.
 * Averaging halves the payload and loses nothing a single pitched line needs — and APL Beats
 * plays one Tone voice at a time through one gain, so there was nowhere for the width to go.
 */
export function toMono(channels) {
  /*
   * `channels` comes from `decodePcm` above, which builds it, so this is never really `any` —
   * but a `.mjs` file has no types to prove that with, and asserting the shape here is cheaper
   * and more honest than turning the rule off for the file.
   *
   * @type {Float32Array | undefined}
   */
  const first = channels[0];
  if (first === undefined) throw new Error('no channels to mix down');
  if (channels.length === 1) return new Float32Array(first);

  const frames = first.length;
  const out = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[frame];
    out[frame] = sum / channels.length;
  }
  return out;
}

/** A mono Float32Array as a 16-bit PCM WAV. */
export function writeWav(samples, sampleRate) {
  const header = Buffer.alloc(44);
  const bytes = samples.length * 2;

  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(bytes, 40);

  const body = Buffer.alloc(bytes);
  for (let index = 0; index < samples.length; index += 1) {
    // Rounded, clamped, no dither — the one lossy step, and it is stated in the manifest.
    const value = Math.max(-1, Math.min(1, samples[index]));
    body.writeInt16LE(Math.round(value * 32767), index * 2);
  }

  return Buffer.concat([header, body]);
}
