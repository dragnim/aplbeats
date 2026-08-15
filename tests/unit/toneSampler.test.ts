import { describe, expect, it } from 'vitest';
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

describe('the four sounds', () => {
  it('offers one preset from each upstream category', () => {
    expect(TONE_SOUNDS).toHaveLength(4);
    expect(TONE_SOUNDS.map((sound) => sound.id).sort()).toEqual(['bass', 'keys', 'lead', 'pad']);
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
     * The recordings arrive at wildly different levels — the Pad peaks around 6% of full scale
     * and the Lead at 100% — and a Sound selector that changed how loud the melody was would be a
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
    // The synthesised kit's loudest voice peaks around −1.2 dBFS. A melody at a third of that is
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
  const impl = ((input: RequestInfo | URL) => {
    const url = String(input);
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

    const first = await loader.load('lead');
    const fetched = calls.length;
    const again = await loader.load('lead');

    expect(first.zoneCount).toBe(toneSoundById('lead').samples.length);
    // A sound heard once is instant ever after: no second fetch, no second decode.
    expect(again).toBe(first);
    expect(calls).toHaveLength(fetched);
    expect(loader.isReady('lead')).toBe(true);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const { impl, calls } = fakeFetch({});
    const loader = new ToneLoader({ fetchImpl: impl, decode });

    const [a, b] = await Promise.all([loader.load('bass'), loader.load('bass')]);

    expect(a).toBe(b);
    expect(calls).toHaveLength(toneSoundById('bass').samples.length);
  });

  it('installs nothing when one recording is missing', async () => {
    /*
     * All or nothing, on purpose. Half a sampler would play some notes and silently drop the ones
     * whose zone had not arrived, which reads as a broken instrument rather than as a slow one.
     */
    const url = toneSampleUrl(toneSoundById('keys').samples[2]!.file, '/');
    const { impl } = fakeFetch({ [url]: false });
    const loader = new ToneLoader({ fetchImpl: impl, decode });

    await expect(loader.load('keys')).rejects.toBeInstanceOf(ToneLoadError);
    expect(loader.isReady('keys')).toBe(false);
    expect(loader.readyCount).toBe(0);
  });

  it('lets a retry really retry', async () => {
    let failing = true;
    const impl = ((input: RequestInfo | URL) =>
      Promise.resolve({
        ok: !(failing && String(input).endsWith('-48.wav')),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as Response)) as typeof fetch;

    const loader = new ToneLoader({ fetchImpl: impl, decode });
    await expect(loader.load('pad')).rejects.toBeInstanceOf(ToneLoadError);

    failing = false;
    // Nothing was cached on failure, so this is a genuine second attempt rather than the first
    // one's rejection handed back again.
    await expect(loader.load('pad')).resolves.toBeInstanceOf(ToneSampler);
  });

  it('refuses to spend three megabytes on a browser that cannot decode', async () => {
    const { impl, calls } = fakeFetch({});
    const loader = new ToneLoader({ fetchImpl: impl });

    // No decoder injected and no `OfflineAudioContext` in jsdom, so this browser cannot play a
    // sampled sound at all. Downloading first and finding out afterwards would be somebody's data
    // spent on a certainty.
    expect(loader.canDecode).toBe(false);
    await expect(loader.load('lead')).rejects.toMatchObject({ kind: 'unsupported' });
    expect(calls).toHaveLength(0);
  });

  it('says which sound failed, in a sentence', async () => {
    const url = toneSampleUrl(toneSoundById('lead').samples[0]!.file, '/');
    const { impl } = fakeFetch({ [url]: false });
    const loader = new ToneLoader({ fetchImpl: impl, decode });

    await expect(loader.load('lead')).rejects.toThrow(/Lead/u);
  });
});
