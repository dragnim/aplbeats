/*
 * One pitched voice, sampled and monophonic.
 *
 * Small on purpose. A pitched sampler can grow into a whole synthesiser given the chance — zones,
 * velocity layers, round robins, envelopes, filters — and none of that is what Stage 8 is for.
 * This does exactly four things: pick the nearest recording to the pitch asked for, shift it,
 * replace whatever was sounding, and get out of the way.
 *
 * **Pitch shifting.** A sample recorded at MIDI `root` played back at rate `2^((midi-root)/12)`
 * sounds at `midi`. That is the whole of it. Seven recordings six semitones apart mean nothing is
 * ever shifted further than three, which is about where a shifted analogue sample stops sounding
 * like a note and starts sounding like a shifted sample.
 *
 * **Monophonic.** One voice. A new note takes it from whatever was ringing, and that is the only
 * thing that does: **a rest strikes nothing and cuts nothing.** The note that was sounding carries
 * on and decays on its own.
 *
 * That is a deliberate change from the first version, which released on every rest and so made
 * every note exactly one step long — 134 ms at the opening tempo. A bright lead survives that; a
 * slow patch whose attack alone is 78 ms arrives as a click. See `AudioEngine.playTone`, which is
 * where the decision lives; this class only does what it is told.
 *
 * The stop, when something does ask for one, is a 12 ms ramp rather than a hard stop, because
 * stopping a source mid-waveform is a click. Two things ask: `silence`, when the transport stops
 * or the sound is swapped, and `play`, taking the voice for a new note.
 *
 * **No loops.** Every recording plays once and decays. Upstream's own sustain loops begin between
 * 4.7 and 9.1 seconds in, and a note here is stopped by the next note rather than by the end of
 * its buffer, so the Tone phrase would have to hold a single note for some thirty-five steps to reach
 * one. That was measured rather than assumed during the sound curation pass: against either shipped
 * phrase, a trimmed sample, a four-second sample and a looped one are identical to five decimal
 * places. See `scripts/prepare-jupiter4.mjs`.
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

  /**
   * The sound's working gain, applied to every note.
   *
   * This is where `ToneSoundDefinition.gain` finally lands, and until the sound curation pass it
   * landed nowhere at all: the gains were measured, documented and tested, and then the sampler
   * played every buffer at the level asked for. The six sounds' source peaks run from **0.044** to
   * **1.000**, so the quietest was arriving some twenty-three times below the loudest — which is
   * most of why one sound seemed shrill and another seemed absent.
   *
   * Exactly how a sampled drum kit does it: the file is not touched, the level is.
   */
  private readonly gain: number;

  constructor(zones: readonly ToneZone[], gain = 1) {
    this.zones = [...zones].sort((a, b) => a.rootMidi - b.rootMidi);
    this.gain = Number.isFinite(gain) && gain > 0 ? gain : 1;
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

    /*
     * The note level and the sound's working gain, multiplied here.
     *
     * The caller says how hard the note was struck; the sound says how loud its recordings are
     * relative to every other sound. Keeping them separate up to this point is what lets the
     * Sound selector change timbre without changing level.
     */
    const gain = context.createGain();
    const target = level * this.gain;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(target, time + ATTACK_SECONDS);

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
   * **Not what a rest does.** A rest strikes nothing and leaves the ringing note alone; this is
   * called by `play`, taking the voice for a new note, and by `silence`, when the transport stops
   * or the sound is swapped. Those are the only two.
   *
   * The ramp runs from the value the gain actually holds at that moment rather than from the
   * note's level, so stopping a note that is still in its four-millisecond attack does not jump it
   * to full volume first.
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
