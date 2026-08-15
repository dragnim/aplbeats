import { describe, expect, it, vi } from 'vitest';
import { ToneSampler, type ToneZone } from '@/audio/tones/ToneSampler';
import {
  DEFAULT_TONE_SOUND,
  isToneSoundId,
  TONE_SOUNDS,
  TONE_TARGET_PEAK,
  toneSampleUrl,
  toneSoundById,
} from '@/audio/tones/sounds';
import { ToneLoader, ToneLoadError } from '@/audio/tones/toneLoader';
import { TONE_MAX_MIDI, TONE_MIN_MIDI } from '@/tones/phrase';
import manifest from '@/audio/tones/jupiter4.json';

/*
 * The pitched instrument: how it chooses a recording, how it shifts it, and what it refuses.
 *
 * The arithmetic here is the part that fails silently. A sampler that picks the wrong zone still
 * plays a note — just a note shifted five semitones further than it needed to be, which sounds
 * like a cheap instrument rather than like a bug. So the zone choice and the playback rate are
 * asserted as numbers rather than judged by ear.
 */

const zones = (...roots: number[]): ToneZone[] =>
  roots.map((rootMidi) => ({ rootMidi, buffer: {} as AudioBuffer }));

describe('choosing a recording', () => {
  it('takes the nearest root, not the one below', () => {
    /*
     * The difference is audible on a bass. With roots six semitones apart, "the one below" would
     * shift up to five semitones; nearest never shifts more than three, which is about where a
     * shifted analogue sample stops sounding like a note.
     */
    const sampler = new ToneSampler(zones(48, 54, 60, 66, 72, 78, 84));

    expect(sampler.zoneFor(48)?.rootMidi).toBe(48);
    expect(sampler.zoneFor(50)?.rootMidi).toBe(48);
    expect(sampler.zoneFor(52)?.rootMidi).toBe(54);
    expect(sampler.zoneFor(63)?.rootMidi).toBe(60);
    expect(sampler.zoneFor(64)?.rootMidi).toBe(66);
    expect(sampler.zoneFor(84)?.rootMidi).toBe(84);
  });

  it('never shifts further than half the gap between roots', () => {
    const roots = [48, 54, 60, 66, 72, 78, 84];
    const sampler = new ToneSampler(zones(...roots));

    for (let midi = TONE_MIN_MIDI; midi <= TONE_MAX_MIDI; midi += 1) {
      const zone = sampler.zoneFor(midi);
      expect(zone, String(midi)).not.toBeNull();
      expect(Math.abs((zone?.rootMidi ?? 0) - midi), String(midi)).toBeLessThanOrEqual(3);
    }
  });

  it('has nothing to choose when it holds nothing', () => {
    expect(new ToneSampler([]).zoneFor(60)).toBeNull();
  });
});

describe('shifting a recording', () => {
  it('plays a zone at its own root unshifted', () => {
    expect(ToneSampler.rateFor(60, 60)).toBe(1);
  });

  it('doubles the rate an octave up and halves it an octave down', () => {
    expect(ToneSampler.rateFor(72, 60)).toBeCloseTo(2, 10);
    expect(ToneSampler.rateFor(48, 60)).toBeCloseTo(0.5, 10);
  });

  it('uses equal temperament, so a semitone is the twelfth root of two', () => {
    expect(ToneSampler.rateFor(61, 60)).toBeCloseTo(2 ** (1 / 12), 10);
    expect(ToneSampler.rateFor(67, 60)).toBeCloseTo(2 ** (7 / 12), 10);
  });
});

/* ------------------------------------------------------------------------- */

/**
 * A context that records what the sampler builds, and what it asks of it.
 *
 * Smaller than the shared `Recorder`, because what matters here is one voice: which buffer was
 * started, whether it was told to loop, and whether anything stopped it.
 */
interface Built {
  buffer: AudioBuffer | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  started: number[];
  stopped: number[];
}

function voice(): { context: BaseAudioContext; destination: AudioNode; built: Built[] } {
  const built: Built[] = [];

  const param = () => ({
    value: 1,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    cancelScheduledValues: () => undefined,
  });

  const context = {
    currentTime: 0,
    createBufferSource: () => {
      const record: Built = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        started: [],
        stopped: [],
      };
      built.push(record);
      return {
        set buffer(value: AudioBuffer) {
          record.buffer = value;
        },
        get buffer(): AudioBuffer | null {
          return record.buffer;
        },
        set loop(value: boolean) {
          record.loop = value;
        },
        get loop(): boolean {
          return record.loop;
        },
        set loopStart(value: number) {
          record.loopStart = value;
        },
        set loopEnd(value: number) {
          record.loopEnd = value;
        },
        playbackRate: param(),
        start: (when: number) => record.started.push(when),
        stop: (when: number) => record.stopped.push(when),
        connect: (target: unknown) => target,
        disconnect: () => undefined,
        addEventListener: () => undefined,
      };
    },
    createGain: () => ({
      gain: param(),
      connect: (target: unknown) => target,
      disconnect: () => undefined,
    }),
  } as unknown as BaseAudioContext;

  return { context, destination: {} as AudioNode, built };
}

describe('one monophonic voice', () => {
  /*
   * The four rules the runtime actually follows, pinned as tests.
   *
   * Worth pinning because the first version had one of them the other way round: it released on
   * every rest, which made each note exactly one step long and turned a slow patch into a click. The
   * documentation said so too, for a while after the code stopped doing it.
   */
  const zones = [{ rootMidi: 60, buffer: {} as AudioBuffer }];

  it('starts a note when asked for a pitch', () => {
    const sampler = new ToneSampler(zones);
    const rig = voice();

    sampler.play(rig, 1, 60, 1);
    expect(rig.built).toHaveLength(1);
    expect(rig.built[0]?.started).toEqual([1]);
  });

  it('lets a new pitch take the voice from the one ringing', () => {
    const sampler = new ToneSampler(zones);
    const rig = voice();

    sampler.play(rig, 1, 60, 1);
    sampler.play(rig, 2, 67, 1);

    expect(rig.built).toHaveLength(2);
    // The first was stopped — monophonic — and the second is running.
    expect(rig.built[0]?.stopped.length).toBe(1);
    expect(rig.built[1]?.stopped).toEqual([]);
  });

  it('does not stop anything when nothing asks it to', () => {
    /*
     * A rest never reaches this class at all: `AudioEngine.playTone` returns early. So the
     * sampler's own behaviour is that a note keeps ringing until something takes the voice, which
     * is what makes a sparse phrase legato.
     */
    const sampler = new ToneSampler(zones);
    const rig = voice();

    sampler.play(rig, 1, 60, 1);
    expect(rig.built[0]?.stopped).toEqual([]);
  });

  it('releases the voice when the transport stops', () => {
    const sampler = new ToneSampler(zones);
    const rig = voice();

    sampler.play(rig, 1, 60, 1);
    sampler.silence(rig.context);

    expect(rig.built[0]?.stopped.length).toBe(1);
  });

  it('applies the sound’s working gain to every note', () => {
    /*
     * The bug the listening pass found. `ToneSoundDefinition.gain` was measured, documented and
     * tested from the first day of Stage 8 and applied *nowhere*: the loader built zones from raw
     * buffers, the transport passed level 1, and the sampler played each buffer as it was. The six
     * sounds' source peaks run from 0.044 to 1.000, so the quietest was arriving some twenty-three
     * times below the loudest.
     */
    const rig = voice();
    const ramped: number[] = [];
    const original = rig.context.createGain.bind(rig.context);
    vi.spyOn(rig.context, 'createGain').mockImplementation(() => {
      const node = original();
      vi.spyOn(node.gain, 'linearRampToValueAtTime').mockImplementation((value: number) => {
        ramped.push(value);
        return node.gain;
      });
      return node;
    });

    new ToneSampler(zones, 5).play(rig, 1, 60, 0.5);
    expect(ramped[0]).toBeCloseTo(2.5, 6);
  });

  it('plays at the level asked for when a sound has no gain of its own', () => {
    const rig = voice();
    const ramped: number[] = [];
    const original = rig.context.createGain.bind(rig.context);
    vi.spyOn(rig.context, 'createGain').mockImplementation(() => {
      const node = original();
      vi.spyOn(node.gain, 'linearRampToValueAtTime').mockImplementation((value: number) => {
        ramped.push(value);
        return node.gain;
      });
      return node;
    });

    new ToneSampler(zones).play(rig, 1, 60, 0.5);
    expect(ramped[0]).toBeCloseTo(0.5, 6);
  });

  it('plays a recording once and lets it decay, rather than looping it', () => {
    /*
     * No fake sustain.
     *
     * Looping a 1.2-second recording is the cheap way to make a slow patch hold a note, and it is
     * the wrong way: it turns a recording of an instrument into a recording of a loop. Upstream's
     * own sustain points all begin seconds after where these files end, and a note here is stopped
     * by the next note long before either matters. Measured, not assumed — see `ToneSampler`.
     */
    const sampler = new ToneSampler(zones);
    const rig = voice();

    sampler.play(rig, 1, 60, 1);
    expect(rig.built[0]?.loop).toBe(false);
  });
});

describe('the six sounds', () => {
  it('offers six sounds, named for themselves rather than for categories', () => {
    /*
     * The shape of this list is a product decision, not an accident. Four category slots — Lead,
     * Bass, Keys, Pad — meant the Pad slot had to be filled by something, and it was, by the least
     * unsuitable pad in the library. Six sounds under their own names have no slot to fill.
     */
    expect(TONE_SOUNDS).toHaveLength(6);
    expect(TONE_SOUNDS.map((sound) => sound.id)).toEqual([
      'petals-piano',
      'chunky',
      'gone-away-forever',
      'noisy-lead',
      'fake-flute',
      'four-bass',
    ]);

    // No name is a bare category label. That is the whole point of the rename.
    for (const sound of TONE_SOUNDS) {
      expect(['Lead', 'Bass', 'Keys', 'Pad'], sound.id).not.toContain(sound.name);
    }
  });

  it('ships nothing from Pads, and says so rather than leaving a hole', () => {
    // Fourteen were auditioned by ear and none was worth shipping. Recorded as a test because the
    // temptation to fill the category again will outlive the memory of why it is empty.
    expect(TONE_SOUNDS.map((sound) => sound.category)).not.toContain('Pads');
    expect(new Set(TONE_SOUNDS.map((sound) => sound.category))).toEqual(
      new Set(['Keys', 'Lead', 'Misc', 'Bass']),
    );
  });

  it('records where each recording actually came from', () => {
    // Provenance survives the rename: the selector shows a preset name, the manifest keeps the
    // category, and the notices are generated from the same source.
    expect(toneSoundById('fake-flute').category).toBe('Misc');
    expect(toneSoundById('fake-flute').preset).toBe('jp4 - Fake Flute');
    expect(toneSoundById('four-bass').category).toBe('Bass');
    expect(toneSoundById('petals-piano').category).toBe('Keys');
  });

  it('starts on one that exists', () => {
    expect(isToneSoundId(DEFAULT_TONE_SOUND)).toBe(true);
    expect(toneSoundById(DEFAULT_TONE_SOUND).id).toBe(DEFAULT_TONE_SOUND);
  });

  it('falls back rather than failing on an identifier that is not one', () => {
    // The same rule the kit list follows: a sound withdrawn or misspelt becomes the first one
    // rather than a startup failure or a silent instrument.
    expect(toneSoundById('trombone').id).toBe(TONE_SOUNDS[0]!.id);
    expect(isToneSoundId('trombone')).toBe(false);
  });

  it('names every sound in words, with a line about what it is for', () => {
    for (const sound of TONE_SOUNDS) {
      expect(sound.name.length, sound.id).toBeGreaterThan(1);
      expect(sound.blurb.length, sound.id).toBeGreaterThan(10);
    }
  });

  it('brings every sound to the same working peak, so the selector is not a volume control', () => {
    /*
     * The recordings arrive at wildly different levels — Noisy Lead peaks at about 4% of full
     * scale and Petals Piano at 100% — and a Sound selector that changed how loud the phrase was
     * would be a
     * volume control pretending to be an instrument control.
     */
    for (const sound of TONE_SOUNDS) {
      const peaks = (manifest.sounds[sound.id]?.samples ?? []).map((sample) => sample.peak ?? 0);
      const loudest = Math.max(...peaks);
      expect(loudest, sound.id).toBeGreaterThan(0);
      expect(loudest * sound.gain, sound.id).toBeCloseTo(TONE_TARGET_PEAK, 2);
    }
  });

  it('sits below the drums, which is the whole promise of the layer', () => {
    // The synthesised kit's loudest voice peaks around −1.2 dBFS. A phrase at a third of that is
    // present without becoming the loudest thing in the bar.
    expect(TONE_TARGET_PEAK).toBeLessThan(0.5);
  });

  it('serves every sample from the published base path', () => {
    // The bug this catches is a real one and it cost seven 404s: APL Beats is published under
    // /aplbeats/, and a loader defaulting to / asks for files that are not there.
    expect(toneSampleUrl('lead-48.wav', '/aplbeats/')).toBe('/aplbeats/audio/tones/lead-48.wav');
    expect(toneSampleUrl('lead-48.wav', '/aplbeats')).toBe('/aplbeats/audio/tones/lead-48.wav');
    expect(toneSampleUrl('lead-48.wav', '/')).toBe('/audio/tones/lead-48.wav');
  });

  it('covers the whole playable range with its zones', () => {
    for (const sound of TONE_SOUNDS) {
      const roots = sound.samples.map((sample) => sample.rootMidi);
      expect(Math.min(...roots), sound.id).toBeLessThanOrEqual(TONE_MIN_MIDI);
      // The top zone need only be within three semitones of the top note; that is what nearest-
      // zone selection guarantees, and asking for a root *at* the top would waste a recording.
      expect(TONE_MAX_MIDI - Math.max(...roots), sound.id).toBeLessThanOrEqual(3);
    }
  });
});

/* ------------------------------------------------------------------------- */

/** A fetch that answers from a table, and counts what it was asked for. */
function fakeFetch(answers: Record<string, boolean>): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = ((input: string) => {
    const url = input;
    calls.push(url);
    const ok = answers[url] ?? true;
    return Promise.resolve({
      ok,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as Response);
  }) as typeof fetch;

  return { impl, calls };
}

const decode = (): Promise<AudioBuffer> => Promise.resolve({} as AudioBuffer);

describe('loading a sound', () => {
  it('fetches every zone once and remembers the result', async () => {
    const { impl, calls } = fakeFetch({});
    const loader = new ToneLoader({ fetchImpl: impl, decode });

    const first = await loader.load('chunky');
    const fetched = calls.length;
    const again = await loader.load('chunky');

    expect(first.zoneCount).toBe(toneSoundById('chunky').samples.length);
    // A sound heard once is instant ever after: no second fetch, no second decode.
    expect(again).toBe(first);
    expect(calls).toHaveLength(fetched);
    expect(loader.isReady('chunky')).toBe(true);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const { impl, calls } = fakeFetch({});
    const loader = new ToneLoader({ fetchImpl: impl, decode });

    const [a, b] = await Promise.all([loader.load('four-bass'), loader.load('four-bass')]);

    expect(a).toBe(b);
    expect(calls).toHaveLength(toneSoundById('four-bass').samples.length);
  });

  it('installs nothing when one recording is missing', async () => {
    /*
     * All or nothing, on purpose. Half a sampler would play some notes and silently drop the ones
     * whose zone had not arrived, which reads as a broken instrument rather than as a slow one.
     */
    const url = toneSampleUrl(toneSoundById('petals-piano').samples[2]!.file, '/');
    const { impl } = fakeFetch({ [url]: false });
    const loader = new ToneLoader({ fetchImpl: impl, decode });

    await expect(loader.load('petals-piano')).rejects.toBeInstanceOf(ToneLoadError);
    expect(loader.isReady('petals-piano')).toBe(false);
    expect(loader.readyCount).toBe(0);
  });

  it('lets a retry really retry', async () => {
    let failing = true;
    const impl = ((input: string) =>
      Promise.resolve({
        ok: !(failing && input.endsWith('-48.wav')),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as Response)) as typeof fetch;

    const loader = new ToneLoader({ fetchImpl: impl, decode });
    await expect(loader.load('fake-flute')).rejects.toBeInstanceOf(ToneLoadError);

    failing = false;
    // Nothing was cached on failure, so this is a genuine second attempt rather than the first
    // one's rejection handed back again.
    await expect(loader.load('fake-flute')).resolves.toBeInstanceOf(ToneSampler);
  });

  it('refuses to spend three megabytes on a browser that cannot decode', async () => {
    const { impl, calls } = fakeFetch({});
    const loader = new ToneLoader({ fetchImpl: impl });

    // No decoder injected and no `OfflineAudioContext` in jsdom, so this browser cannot play a
    // sampled sound at all. Downloading first and finding out afterwards would be somebody's data
    // spent on a certainty.
    expect(loader.canDecode).toBe(false);
    await expect(loader.load('chunky')).rejects.toMatchObject({ kind: 'unsupported' });
    expect(calls).toHaveLength(0);
  });

  it('says which sound failed, in a sentence', async () => {
    const url = toneSampleUrl(toneSoundById('chunky').samples[0]!.file, '/');
    const { impl } = fakeFetch({ [url]: false });
    const loader = new ToneLoader({ fetchImpl: impl, decode });

    await expect(loader.load('chunky')).rejects.toThrow(/Chunky/u);
  });
});
