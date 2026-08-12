import { describe, expect, it } from 'vitest';
import { createSampleKit } from '@/audio/sampleKit';
import { KITS } from '@/audio/kits/kits';
import { HAT_CHOKE_GROUP, isSampleKit, type SampleKitDefinition } from '@/audio/kits/types';
import type { VoiceContext } from '@/audio/kit';
import { TRACK_IDS } from '@/pattern/tracks';

/*
 * What a sampled voice does when it is asked to sound.
 *
 * Checked against a recording audio context rather than a real one, because every promise worth
 * checking here is about *what was asked of Web Audio*: the time a note was started at, the gain
 * it was given, and whether the previous note in its group was stopped. A real audio device would
 * add nothing and jsdom has none anyway.
 *
 * The one that matters most is the time. A sampled voice must schedule at the moment the
 * scheduler names — not at `currentTime`, not through a `setTimeout` — or Stage 1's look-ahead
 * becomes decoration and the beat wanders.
 */

/* ---- a recording audio context -------------------------------------------- */

interface StartedSource {
  readonly buffer: AudioBuffer;
  readonly startedAt: number;
  readonly playbackRate: number;
  stoppedAt: number | null;
  ended: (() => void) | null;
}

interface GainRecord {
  readonly initial: number;
  /** Ramps scheduled on this gain, as [value, time]. */
  readonly ramps: [number, number][];
  /** Values pinned with setValueAtTime, as [value, time]. */
  readonly holds: [number, number][];
}

class Recorder {
  readonly sources: StartedSource[] = [];
  readonly gains: GainRecord[] = [];
  currentTime = 0;

  /*
   * Built as a method rather than a getter, so the closures below capture `this` lexically
   * instead of needing an alias for it.
   */
  context(): VoiceContext {
    // Arrow-bound, so the object literal below can read the recorder's clock rather than its own.
    const clock = (): number => this.currentTime;

    const createBufferSource = (): AudioBufferSourceNode => {
      const record: StartedSource = {
        buffer: null as unknown as AudioBuffer,
        startedAt: Number.NaN,
        playbackRate: 1,
        stoppedAt: null,
        ended: null,
      };
      const mutable = record as { -readonly [K in keyof StartedSource]: StartedSource[K] };

      const node = {
        set buffer(value: AudioBuffer) {
          mutable.buffer = value;
        },
        playbackRate: {
          set value(rate: number) {
            mutable.playbackRate = rate;
          },
          get value(): number {
            return mutable.playbackRate;
          },
        },
        set onended(handler: () => void) {
          mutable.ended = handler;
        },
        connect: (destination: unknown) => destination,
        start: (when: number) => {
          mutable.startedAt = when;
          this.sources.push(record);
        },
        stop: (when: number) => {
          mutable.stoppedAt = when;
        },
      };
      return node as unknown as AudioBufferSourceNode;
    };

    const createGain = (): GainNode => {
      const record: GainRecord = { initial: Number.NaN, ramps: [], holds: [] };
      const mutable = record as { -readonly [K in keyof GainRecord]: GainRecord[K] };
      let current = 0;

      const node = {
        gain: {
          get value(): number {
            return current;
          },
          set value(next: number) {
            current = next;
            if (Number.isNaN(record.initial)) mutable.initial = next;
          },
          setValueAtTime: (value: number, when: number) => {
            record.holds.push([value, when]);
          },
          linearRampToValueAtTime: (value: number, when: number) => {
            record.ramps.push([value, when]);
          },
        },
        connect: (destination: unknown) => destination,
      };
      this.gains.push(record);
      return node as unknown as GainNode;
    };

    return {
      context: {
        createBufferSource,
        createGain,
        get currentTime(): number {
          return clock();
        },
      } as unknown as BaseAudioContext,
      destination: { name: 'master' } as unknown as AudioNode,
      noise: null as unknown as AudioBuffer,
    };
  }
}

function buffer(name: string): AudioBuffer {
  return {
    name,
    length: 4410,
    duration: 0.1,
    numberOfChannels: 1,
    sampleRate: 44_100,
  } as unknown as AudioBuffer;
}

/** Buffers for every distinct file a kit needs. */
function buffersFor(definition: SampleKitDefinition): Record<string, AudioBuffer> {
  const files = new Set(TRACK_IDS.map((id) => definition.voices[id].file));
  return Object.fromEntries([...files].map((file) => [file, buffer(file)]));
}

const TR808 = KITS.filter(isSampleKit).find((kit) => kit.id === 'tr-808')!;

/* ------------------------------------------------------------------------- */

describe('building a sampled kit', () => {
  it('gives every row a voice', () => {
    const kit = createSampleKit(TR808, buffersFor(TR808));
    for (const id of TRACK_IDS) expect(typeof kit[id], id).toBe('function');
  });

  it('refuses to build with a buffer missing, rather than leaving a row silent', () => {
    const buffers = buffersFor(TR808);
    delete buffers[TR808.voices.snare.file];

    expect(() => createSampleKit(TR808, buffers)).toThrow(/snare/u);
  });

  it('builds every kit in the manifest', () => {
    for (const definition of KITS.filter(isSampleKit)) {
      expect(() => createSampleKit(definition, buffersFor(definition)), definition.id).not.toThrow();
    }
  });
});

describe('sounding a voice', () => {
  it('starts at the time the scheduler named, not at the clock', () => {
    /*
     * The whole basis of Stage 1's timing, and the one thing a sampled voice could quietly
     * break. `time` is in the future; a voice that ignored it and played at `currentTime` would
     * put every note a look-ahead window early.
     */
    const recorder = new Recorder();
    recorder.currentTime = 4;
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.kick(recorder.context(), 12.75, 1);

    expect(recorder.sources).toHaveLength(1);
    expect(recorder.sources[0]?.startedAt).toBe(12.75);
  });

  it('scales the level by the voice’s calibrated gain', () => {
    const recorder = new Recorder();
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.kick(recorder.context(), 1, 0.5);

    expect(recorder.gains[0]?.initial).toBeCloseTo(0.5 * TR808.voices.kick.gain, 6);
  });

  it('plays the file the manifest names for that row', () => {
    const recorder = new Recorder();
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.rim(recorder.context(), 1, 1);

    expect((recorder.sources[0]?.buffer as unknown as { name: string }).name).toBe(TR808.voices.rim.file);
  });

  it('makes no sound at all at zero level', () => {
    // A muted row must cost nothing: no node, no graph, no work for the audio thread.
    const recorder = new Recorder();
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.kick(recorder.context(), 1, 0);

    expect(recorder.sources).toEqual([]);
    expect(recorder.gains).toEqual([]);
  });

  it('leaves playback rate alone unless the kit shifts it', () => {
    const recorder = new Recorder();
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.kick(recorder.context(), 1, 1);

    expect(recorder.sources[0]?.playbackRate).toBe(1);
  });

  it('applies the rate a substitution asks for', () => {
    const shifted = KITS.filter(isSampleKit).find((kit) =>
      TRACK_IDS.some((id) => (kit.voices[id].playbackRate ?? 1) !== 1),
    );
    expect(shifted, 'no kit shifts a rate; this test has lost its subject').toBeDefined();

    const row = TRACK_IDS.find((id) => (shifted!.voices[id].playbackRate ?? 1) !== 1)!;
    const recorder = new Recorder();
    const kit = createSampleKit(shifted!, buffersFor(shifted!));

    kit[row](recorder.context(), 1, 1);

    expect(recorder.sources[0]?.playbackRate).toBe(shifted!.voices[row].playbackRate);
  });
});

describe('choking', () => {
  it('cuts the previous hit on the same row', () => {
    /*
     * Per-instrument monophony, which is what the hardware does: hitting a drum again restarts
     * it rather than layering a second copy. It is also what keeps a dense pattern from stacking
     * forty overlapping tails into a peak the master chain cannot hold.
     */
    const recorder = new Recorder();
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.kick(recorder.context(), 1, 1);
    kit.kick(recorder.context(), 1.5, 1);

    const [first, second] = recorder.sources;
    expect(first?.stoppedAt).toBeGreaterThan(1.5);
    expect(first?.stoppedAt).toBeLessThan(1.52);
    expect(second?.stoppedAt).toBeNull();
  });

  it('fades rather than cutting dead, so the choke does not click', () => {
    const recorder = new Recorder();
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.kick(recorder.context(), 1, 1);
    kit.kick(recorder.context(), 2, 1);

    const gain = recorder.gains[0]!;
    // Held at its current value at the moment of the choke, then ramped to nothing.
    expect(gain.holds[0]?.[1]).toBe(2);
    expect(gain.ramps[0]?.[0]).toBe(0);
    expect(gain.ramps[0]?.[1]).toBeGreaterThan(2);
  });

  it('chokes at the new note’s time, not at the current clock', () => {
    /*
     * Subtle and important. With a hundred milliseconds of look-ahead, choking at `currentTime`
     * would silence notes that have been scheduled but not yet heard — most of them.
     */
    const recorder = new Recorder();
    recorder.currentTime = 10;
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.kick(recorder.context(), 10.2, 1);
    kit.kick(recorder.context(), 10.4, 1);

    expect(recorder.gains[0]?.holds[0]?.[1]).toBe(10.4);
    expect(recorder.sources[0]?.stoppedAt).toBeGreaterThanOrEqual(10.4);
  });

  it('lets a closed hat cut an open one, as one circuit would', () => {
    const recorder = new Recorder();
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.openHat(recorder.context(), 1, 1);
    kit.closedHat(recorder.context(), 1.25, 1);

    expect(TR808.voices.openHat.chokeGroup).toBe(HAT_CHOKE_GROUP);
    expect(recorder.sources[0]?.stoppedAt).toBeGreaterThanOrEqual(1.25);
  });

  it('lets an open hat cut a closed one, the same way round', () => {
    const recorder = new Recorder();
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.closedHat(recorder.context(), 1, 1);
    kit.openHat(recorder.context(), 1.25, 1);

    expect(recorder.sources[0]?.stoppedAt).toBeGreaterThanOrEqual(1.25);
  });

  it('does not let one row cut another that is unrelated', () => {
    // A kick must not silence a hat. Choking is per instrument, not per kit.
    const recorder = new Recorder();
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.openHat(recorder.context(), 1, 1);
    kit.kick(recorder.context(), 1.25, 1);
    kit.snare(recorder.context(), 1.3, 1);
    kit.rim(recorder.context(), 1.4, 1);

    expect(recorder.sources[0]?.stoppedAt).toBeNull();
  });

  it('does not cut a row that shares a sample but not a group', () => {
    /*
     * The SK-1 plays its snare on both the snare and the clap rows. They must not choke each
     * other: they are two parts that happen to be the same recording, and a clap silencing the
     * snare it is doubling would be a bug you could hear on every backbeat.
     */
    const sk1 = KITS.filter(isSampleKit).find((kit) => kit.id === 'sk-1');
    expect(sk1).toBeDefined();
    expect(sk1!.voices.clap.file).toBe(sk1!.voices.snare.file);

    const recorder = new Recorder();
    const kit = createSampleKit(sk1!, buffersFor(sk1!));

    kit.snare(recorder.context(), 1, 1);
    kit.clap(recorder.context(), 1, 1);

    expect(recorder.sources).toHaveLength(2);
    expect(recorder.sources[0]?.stoppedAt).toBeNull();
  });

  it('forgets a voice once it has ended, so a stale node is never stopped', () => {
    const recorder = new Recorder();
    const kit = createSampleKit(TR808, buffersFor(TR808));

    kit.kick(recorder.context(), 1, 1);
    recorder.sources[0]?.ended?.();
    kit.kick(recorder.context(), 2, 1);

    // Nothing was choked, because nothing was still sounding.
    expect(recorder.gains[0]?.ramps).toEqual([]);
  });
});
