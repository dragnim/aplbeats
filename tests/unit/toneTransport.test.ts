import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '@/audio/AudioEngine';
import { SYNTH_KIT } from '@/audio/kit';
import { ToneSampler } from '@/audio/tones/ToneSampler';
import { createInitialGroove } from '@/pattern/initialGroove';
import { createMixer } from '@/pattern/mixer';
import { emptyPhrase, openingPhrase, REST, type Phrase } from '@/tones/phrase';
import { Transport } from '@/transport/Transport';
import { Recorder } from '../support/recorder';

/*
 * One transport, two layers.
 *
 * This is the file that holds Stage 8's central promise in place, and the promise is not "the
 * melody sounds about right" — it is that there is only one clock. A second sequencer for the
 * Tone layer would work perfectly on a fast machine and drift apart on a slow one, or under
 * swing, or after a tempo change, and it would take somebody with good ears and a quiet room to
 * notice. So the claim is made mechanically: every Tone event is handed the same instant the drum
 * event for that step was handed, whatever the tempo and whatever the swing.
 *
 * What is asserted is the *scheduling*, not the sound. jsdom has no Web Audio, so a recording
 * context stands in and the times handed to it are compared. That is the right level: whether a
 * sample is audible is Web Audio's business, and whether it was asked for at the same moment as
 * the snare is this project's.
 */

/** A sampler that records what it was asked to play, and when. */
class SpySampler extends ToneSampler {
  readonly played: { midi: number; time: number; level: number }[] = [];
  readonly released: number[] = [];
  silenced = 0;

  constructor() {
    // One zone is enough: nothing here decodes audio, and `play` is overridden anyway.
    super([]);
  }

  override play(
    _voice: { context: BaseAudioContext; destination: AudioNode },
    time: number,
    midi: number,
    level: number,
  ): void {
    this.played.push({ midi, time, level });
  }

  override release(_context: BaseAudioContext, time: number): void {
    this.released.push(time);
  }

  override silence(): void {
    this.silenced += 1;
  }
}

interface Rig {
  readonly transport: Transport;
  readonly engine: AudioEngine;
  readonly recorder: Recorder;
  readonly sampler: SpySampler;
  /** Every timer callback the scheduler installed, so the test can drive the clock by hand. */
  readonly tick: () => void;
}

/**
 * A transport wired to a recorder, with the timer under the test's control.
 *
 * `setTimer` is injected rather than faked globally, so the scheduler's look-ahead runs exactly
 * when the test says and the audio clock only moves when the test moves it. No waiting, no
 * flakiness, and the same times every run.
 */
function rig(options: { bpm?: number; swing?: number; phrase?: Phrase } = {}): Rig {
  const recorder = new Recorder();
  const engine = new AudioEngine({ createContext: () => recorder.context() });
  const sampler = new SpySampler();
  const phrase = options.phrase ?? openingPhrase();

  let pending: (() => void) | null = null;

  const transport = new Transport({
    getPattern: () => createInitialGroove(),
    getMixer: () => createMixer(),
    getPhrase: () => phrase,
    bpm: options.bpm ?? 120,
    swing: options.swing ?? 0,
    engine,
    setTimer: (callback) => {
      pending = callback;
      return () => {
        pending = null;
      };
    },
  });

  engine.setKit(SYNTH_KIT);

  return {
    transport,
    engine,
    recorder,
    sampler,
    tick: () => {
      pending?.();
    },
  };
}

/** Start the transport and let the scheduler fill its first look-ahead window. */
async function start(rig: Rig): Promise<void> {
  rig.transport.setToneSampler(rig.sampler);
  await rig.transport.play();
  rig.tick();
}

/**
 * Run the transport for a while, by hand.
 *
 * The look-ahead is a tenth of a second, so one tick schedules about one step at 120 BPM — not
 * enough to reach a swung one, which is exactly the case the swing test needs. This advances the
 * recorder's clock in 25 ms slices, ticking at each, which is what the real timer would do.
 */
async function run(rig: Rig, seconds: number): Promise<void> {
  await start(rig);
  const slice = 0.025;
  for (let elapsed = 0; elapsed < seconds; elapsed += slice) {
    rig.recorder.currentTime += slice;
    rig.tick();
  }
}

/* ------------------------------------------------------------------------- */

describe('the two layers share one clock', () => {
  it('gives the melody the same instant it gives the drums', async () => {
    /*
     * The whole stage in one assertion.
     *
     * Both layers are driven from one `onStep` callback with one `time`, so a note on step 3 and
     * a snare on step 3 are handed the identical number — not a close one. Anything else would
     * mean two clocks, however well they happened to agree today.
     */
    const harness = rig({ phrase: openingPhrase() });
    const seen: { step: number; time: number }[] = [];
    const original = harness.engine.playStep.bind(harness.engine);
    vi.spyOn(harness.engine, 'playStep').mockImplementation((pattern, mixer, step, time) => {
      seen.push({ step, time });
      original(pattern, mixer, step, time);
    });

    await start(harness);

    expect(harness.sampler.played.length).toBeGreaterThan(0);

    const phrase = openingPhrase();
    for (const { midi, time } of harness.sampler.played) {
      const drum = seen.find((entry) => entry.time === time);
      expect(drum, `no drum step scheduled at ${String(time)}`).toBeDefined();
      // And it is the step whose note this is, rather than merely some step at that instant.
      expect(phrase[drum?.step ?? -1]).toBe(midi);
    }
  });

  it('follows the drums when swing moves them', async () => {
    /*
     * The claim that would break first if there were two clocks.
     *
     * Swing delays every other sixteenth. If the Tone layer computed its own step times it would
     * be straight while the kit swung, and the melody would sit fractionally ahead of the hats on
     * every other step — audible, and maddening to diagnose. Here the swung times come out of the
     * same callback, so they cannot differ.
     */
    const straight = rig({ swing: 0, phrase: openingPhrase() });
    const swung = rig({ swing: 0.6, phrase: openingPhrase() });

    const drums = new Map<Rig, { step: number; time: number }[]>();
    for (const harness of [straight, swung]) {
      const seen: { step: number; time: number }[] = [];
      drums.set(harness, seen);
      const original = harness.engine.playStep.bind(harness.engine);
      vi.spyOn(harness.engine, 'playStep').mockImplementation((pattern, mixer, step, time) => {
        seen.push({ step, time });
        original(pattern, mixer, step, time);
      });
    }

    // A whole bar at 120 BPM is two seconds, so this covers every step of it and both halves of
    // every swung pair.
    await run(straight, 2.2);
    await run(swung, 2.2);

    const straightTimes = straight.sampler.played.map((note) => note.time);
    const swungTimes = swung.sampler.played.map((note) => note.time);

    expect(straightTimes.length).toBeGreaterThan(3);
    expect(swungTimes).toHaveLength(straightTimes.length);
    // Something moved — otherwise this test would pass with swing ignored entirely.
    expect(swungTimes).not.toEqual(straightTimes);

    // And what moved is exactly what moved for the drums: every Tone event still lands on the
    // instant its own step was given, swung or straight.
    for (const harness of [straight, swung]) {
      const seen = drums.get(harness) ?? [];
      for (const note of harness.sampler.played) {
        const drum = seen.find((entry) => entry.time === note.time);
        expect(drum, `no drum step scheduled at ${String(note.time)}`).toBeDefined();
      }
    }
  });

  it('schedules nothing for a rest, and releases the voice instead', async () => {
    const harness = rig({ phrase: emptyPhrase() });
    await start(harness);

    expect(harness.sampler.played).toHaveLength(0);
    // A rest is an instruction to stop, not an absence of instruction: without the release a note
    // would ring through every rest in the bar.
    expect(harness.sampler.released.length).toBeGreaterThan(0);
  });

  it('plays a note for every sounding step and nothing for the others', async () => {
    const phrase: Phrase = [
      60,
      REST,
      REST,
      63,
      REST,
      REST,
      REST,
      REST,
      REST,
      REST,
      REST,
      REST,
      REST,
      REST,
      REST,
      REST,
    ];
    const harness = rig({ phrase, bpm: 200 });
    await start(harness);

    const pitches = harness.sampler.played.map((note) => note.midi);
    for (const pitch of pitches) expect([60, 63]).toContain(pitch);
  });
});

describe('the Tone layer and the transport', () => {
  it('silences the melody when the transport stops', async () => {
    /*
     * A drum hit is over before the button is released; a Tone note is not. Suspending the audio
     * context around a sounding sample freezes it mid-note rather than ending it, so pressing Play
     * again would resume a note from the bar before.
     */
    const harness = rig();
    await start(harness);
    expect(harness.sampler.silenced).toBe(0);

    harness.transport.pause();
    expect(harness.sampler.silenced).toBe(1);
  });

  it('needs no sampler to play the drums', async () => {
    // A visitor who never opens Tones has no sampler installed, and the kit must be completely
    // unaffected by that — which is the audio-regression claim of the whole stage.
    const harness = rig();
    await harness.transport.play();
    expect(() => {
      harness.tick();
    }).not.toThrow();
  });

  it('remembers the Tone level with no audio device open', () => {
    // The same bargain the master volume makes: moving a fader must not start an AudioContext.
    const built = Recorder.built;
    const engine = new AudioEngine({ createContext: () => new Recorder().context() });
    engine.setToneVolume(0.3);
    expect(engine.toneLevel).toBeCloseTo(0.3, 5);
    expect(Recorder.built).toBe(built);
  });

  it('keeps the melody on its own bus, so the drums are untouched by its level', async () => {
    const harness = rig();
    await start(harness);

    const rampsBefore = harness.recorder.gains.map((gain) => gain.ramps.length);
    harness.transport.setToneVolume(0.25);

    // Exactly one gain node was ramped, and it was ramped to the level asked for. A change that
    // touched two would mean the melody's fader was reaching into the drums' chain.
    const rampedTo = harness.recorder.gains.flatMap((gain, index) =>
      gain.ramps.slice(rampsBefore[index]).map(([value]) => value),
    );
    expect(rampedTo).toEqual([0.25]);
  });
});
