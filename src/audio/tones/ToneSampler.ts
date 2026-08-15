/*
 * One pitched voice, sampled and monophonic.
 *
 * Small on purpose. A melodic sampler can grow into a whole synthesiser given the chance — zones,
 * velocity layers, round robins, envelopes, filters — and none of that is what Stage 8 is for.
 * This does exactly four things: pick the nearest recording to the pitch asked for, shift it,
 * replace whatever was sounding, and get out of the way.
 *
 * **Pitch shifting.** A sample recorded at MIDI `root` played back at rate `2^((midi-root)/12)`
 * sounds at `midi`. That is the whole of it. Seven recordings six semitones apart mean nothing is
 * ever shifted further than three, which is about where a shifted analogue sample stops sounding
 * like a note and starts sounding like a shifted sample.
 *
 * **Monophonic.** One voice, as the brief asks. A new note releases the previous one rather than
 * layering on it, and a rest releases whatever is sounding. The release is a 12 ms ramp rather
 * than a hard stop, because stopping a source mid-waveform is a click — and a click on every
 * sixteenth is the fastest way to make an instrument sound broken.
 *
 * **No loops.** The prepared recordings are trimmed to 1.2 seconds, which is longer than any note
 * this sequencer can play; upstream's loop points all begin later than that and are documented in
 * the manifest as unused. See `scripts/prepare-jupiter4.mjs`.
 *
 * Everything is scheduled against the audio clock, never against a timer. The sampler is handed a
 * time by the same scheduler that places the drums, so a Tone on step 3 and a snare on step 3
 * land on the same instant — including when swing has moved that instant.
 */

/** How long a released note takes to fall silent. Short enough to feel immediate, long enough not to click. */
const RELEASE_SECONDS = 0.012;

/** How long a starting note takes to reach full level. Just enough to avoid a click at the attack. */
const ATTACK_SECONDS = 0.004;

export interface ToneVoiceContext {
  readonly context: BaseAudioContext;
  /** Where the voice connects. The engine's Tone bus. */
  readonly destination: AudioNode;
}

interface SoundingNote {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  /** When it was told to stop, so a second release does not fight the first. */
  releasedAt: number | null;
}

export interface ToneZone {
  readonly rootMidi: number;
  readonly buffer: AudioBuffer;
}

export class ToneSampler {
  private zones: readonly ToneZone[];
  private sounding: SoundingNote | null = null;

  constructor(zones: readonly ToneZone[]) {
    this.zones = [...zones].sort((a, b) => a.rootMidi - b.rootMidi);
  }

  /** How many recordings this sampler is holding. Read by tests. */
  get zoneCount(): number {
    return this.zones.length;
  }

  /**
   * The recording nearest the wanted pitch.
   *
   * Nearest rather than "the one below", because shifting down three semitones and shifting up
   * three are equally good, and always choosing the lower root would mean shifting up to five —
   * which is audible on a bass.
   */
  zoneFor(midi: number): ToneZone | null {
    let best: ToneZone | null = null;
    let bestDistance = Infinity;

    for (const zone of this.zones) {
      const distance = Math.abs(zone.rootMidi - midi);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = zone;
      }
    }

    return best;
  }

  /** The playback rate that turns a zone's root into the wanted pitch. */
  static rateFor(midi: number, rootMidi: number): number {
    return 2 ** ((midi - rootMidi) / 12);
  }

  /**
   * Sound one pitch at `time`, releasing whatever was playing.
   *
   * `time` is on the audio clock and normally in the near future — the same instant the drums for
   * that step were given. Passing a time that has gone by is not an error; it is the symptom of a
   * scheduler that has fallen behind, which the look-ahead exists to prevent.
   */
  play({ context, destination }: ToneVoiceContext, time: number, midi: number, level: number): void {
    this.release(context, time);
    if (level <= 0) return;

    const zone = this.zoneFor(midi);
    if (zone === null) return;

    const source = context.createBufferSource();
    source.buffer = zone.buffer;
    source.playbackRate.value = ToneSampler.rateFor(midi, zone.rootMidi);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(level, time + ATTACK_SECONDS);

    source.connect(gain).connect(destination);
    source.start(time);

    const note: SoundingNote = { source, gain, releasedAt: null };
    /*
     * Let go of the reference when the buffer runs out on its own.
     *
     * Without this the sampler would hold the last source of every note it ever played, and a
     * `stop()` on an already-finished source is harmless but the node is not garbage while
     * something points at it.
     */
    source.addEventListener('ended', () => {
      source.disconnect();
      gain.disconnect();
      if (this.sounding === note) this.sounding = null;
    });

    this.sounding = note;
  }

  /**
   * Silence whatever is sounding, from `time`.
   *
   * What a rest does, and what a new note does to its predecessor. The ramp runs from the value
   * the gain actually holds at that moment rather than from the note's level, so releasing a note
   * that is still in its four-millisecond attack does not jump it to full volume first.
   */
  release(_context: BaseAudioContext, time: number): void {
    const note = this.sounding;
    if (note === null || note.releasedAt !== null) return;

    note.releasedAt = time;
    const stopAt = time + RELEASE_SECONDS;

    note.gain.gain.cancelScheduledValues(time);
    note.gain.gain.setValueAtTime(note.gain.gain.value, time);
    note.gain.gain.linearRampToValueAtTime(0, stopAt);

    try {
      note.source.stop(stopAt);
    } catch {
      // Already stopped, or never started. Either way there is nothing left to silence.
    }

    this.sounding = null;
  }

  /**
   * Stop everything immediately.
   *
   * Used when the transport stops and when the sound is swapped. Distinct from `release` in that
   * it does not wait for a scheduled moment — the point of stopping is that it has happened.
   */
  silence(context: BaseAudioContext): void {
    this.release(context, context.currentTime);
  }
}
