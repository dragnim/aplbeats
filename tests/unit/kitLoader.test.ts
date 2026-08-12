import { describe, expect, it, vi } from 'vitest';
import { KitLoader, KitLoadError, kitFailureMessage } from '@/audio/kitLoader';
import { KITS } from '@/audio/kits/kits';
import { isSampleKit, SYNTH_KIT_ID } from '@/audio/kits/types';
import { SYNTH_KIT } from '@/audio/kit';
import { TRACK_IDS } from '@/pattern/tracks';

/*
 * Loading a kit, and above all *how often*.
 *
 * jsdom has no Web Audio and no network, which is exactly the environment these promises should
 * be checked in: what matters is the request count, the decode count and what happens when
 * either fails, and none of that needs a sound card. The decoder is injected.
 *
 * The promises, in order of how badly breaking them would show:
 *
 *   nothing is fetched for the synthesised kit, ever;
 *   a kit is fetched and decoded once, however many times it is chosen;
 *   two simultaneous requests for one kit make one round of work;
 *   a kit that fails to arrive does not become a partial kit;
 *   choosing one kit never loads another.
 */

/** A request's URL, however `fetch` was called. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** A buffer-shaped object. jsdom has no AudioBuffer, and nothing here inspects one. */
function fakeBuffer(name: string): AudioBuffer {
  return {
    name,
    length: 1024,
    duration: 0.02,
    numberOfChannels: 1,
    sampleRate: 44_100,
  } as unknown as AudioBuffer;
}

interface Harness {
  readonly loader: KitLoader;
  /** Every URL fetched, in order. Its length is the request count. */
  readonly urls: string[];
  /** How many times the decoder ran. */
  readonly decodes: () => number;
}

function harness(
  options: { readonly fail?: (url: string) => boolean; readonly undecodable?: boolean } = {},
): Harness {
  const urls: string[] = [];
  let decodes = 0;

  const fetchImpl = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = urlOf(input);
    urls.push(url);
    if (options.fail?.(url) === true) {
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' } as unknown as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)),
    } as unknown as Response);
  });

  const decode = (): Promise<AudioBuffer> => {
    decodes += 1;
    if (options.undecodable === true) return Promise.reject(new Error('not audio'));
    return Promise.resolve(fakeBuffer(`buffer-${String(decodes)}`));
  };

  return {
    loader: new KitLoader({ baseUrl: '/aplbeats/', fetchImpl: fetchImpl as unknown as typeof fetch, decode }),
    urls,
    decodes: () => decodes,
  };
}

/** The first sampled kit in the manifest, whichever it is. */
const SAMPLED = KITS.filter(isSampleKit);
const FIRST = SAMPLED[0]!;
const SECOND = SAMPLED[1]!;

/* ------------------------------------------------------------------------- */

describe('the synthesised kit', () => {
  it('is available without a single request', async () => {
    const { loader, urls, decodes } = harness();

    const kit = await loader.load(SYNTH_KIT_ID);

    expect(kit).toBe(SYNTH_KIT);
    expect(urls).toEqual([]);
    expect(decodes()).toBe(0);
  });

  it('is always considered ready, before anything has loaded', () => {
    const { loader } = harness();
    expect(loader.isReady(SYNTH_KIT_ID)).toBe(true);
    expect(loader.readyCount).toBe(0);
  });
});

describe('loading a sampled kit', () => {
  it('fetches exactly the files that kit needs, and no others', async () => {
    const { loader, urls } = harness();

    await loader.load(FIRST.id);

    const wanted = new Set(TRACK_IDS.map((id) => FIRST.voices[id].file));
    expect(urls).toHaveLength(wanted.size);
    for (const url of urls) {
      expect(url.startsWith(`/aplbeats/audio/${FIRST.directory}/`), url).toBe(true);
    }
    expect(new Set(urls.map((url) => url.split('/').pop()))).toEqual(wanted);
  });

  it('produces a voice for every row', async () => {
    const { loader } = harness();
    const kit = await loader.load(FIRST.id);
    for (const id of TRACK_IDS) expect(typeof kit[id], id).toBe('function');
  });

  it('does not load any other kit', async () => {
    const { loader, urls } = harness();

    await loader.load(FIRST.id);

    for (const other of SAMPLED) {
      if (other.id === FIRST.id) continue;
      expect(
        urls.some((url) => url.includes(`/${other.directory}/`)),
        other.id,
      ).toBe(false);
    }
    expect(loader.readyCount).toBe(1);
  });

  it('fetches a shared sample once, not once per row', async () => {
    /*
     * The SK-1 uses its snare for two rows, having no hand clap. Fetching and decoding the same
     * file twice would be careless rather than wrong, which is precisely the sort of thing that
     * goes unnoticed without a count.
     */
    const shared = SAMPLED.find((kit) => {
      const files = TRACK_IDS.map((id) => kit.voices[id].file);
      return new Set(files).size < files.length;
    });
    expect(shared, 'no kit shares a sample; this test has lost its subject').toBeDefined();

    const { loader, urls, decodes } = harness();
    await loader.load(shared!.id);

    const distinct = new Set(TRACK_IDS.map((id) => shared!.voices[id].file));
    expect(urls).toHaveLength(distinct.size);
    expect(decodes()).toBe(distinct.size);
    expect(distinct.size).toBeLessThan(TRACK_IDS.length);
  });
});

describe('the cache', () => {
  it('decodes a kit once, however many times it is chosen', async () => {
    const { loader, urls, decodes } = harness();

    const first = await loader.load(FIRST.id);
    const requestsAfterFirst = urls.length;
    const decodesAfterFirst = decodes();

    const second = await loader.load(FIRST.id);
    const third = await loader.load(FIRST.id);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(urls).toHaveLength(requestsAfterFirst);
    expect(decodes()).toBe(decodesAfterFirst);
  });

  it('reports a loaded kit as ready, so the interface need not say "loading"', async () => {
    const { loader } = harness();
    expect(loader.isReady(FIRST.id)).toBe(false);
    await loader.load(FIRST.id);
    expect(loader.isReady(FIRST.id)).toBe(true);
  });

  it('keeps every kit it has loaded, so switching back is free', async () => {
    const { loader, urls } = harness();

    await loader.load(FIRST.id);
    await loader.load(SECOND.id);
    const after = urls.length;

    await loader.load(FIRST.id);
    await loader.load(SECOND.id);

    expect(urls).toHaveLength(after);
    expect(loader.readyCount).toBe(2);
  });

  it('shares one round of work between two simultaneous requests', async () => {
    // Two clicks in quick succession, or a restored session racing a selection.
    const { loader, urls, decodes } = harness();

    const [a, b] = await Promise.all([loader.load(FIRST.id), loader.load(FIRST.id)]);

    expect(a).toBe(b);
    expect(urls).toHaveLength(new Set(TRACK_IDS.map((id) => FIRST.voices[id].file)).size);
    expect(decodes()).toBe(urls.length);
  });
});

describe('when a kit will not load', () => {
  it('rejects rather than returning a kit with a silent row', async () => {
    /*
     * The failure that must never be partial. Seven rows of an 808 and one of nothing would look
     * completely correct on screen and be audibly wrong, which is the worst kind of bug to ship.
     */
    const { loader } = harness({ fail: (url) => url.endsWith('snare.m4a') });

    await expect(loader.load(FIRST.id)).rejects.toBeInstanceOf(KitLoadError);
    expect(loader.isReady(FIRST.id)).toBe(false);
    expect(loader.readyCount).toBe(0);
  });

  it('reports an unreachable file as unavailable', async () => {
    const { loader } = harness({ fail: () => true });

    await loader.load(FIRST.id).then(
      () => expect.fail('should have rejected'),
      (error: unknown) => {
        expect(error).toBeInstanceOf(KitLoadError);
        if (error instanceof KitLoadError) {
          expect(error.kind).toBe('unavailable');
          expect(error.kitName).toBe(FIRST.name);
        }
      },
    );
  });

  it('reports bytes that are not audio as undecodable', async () => {
    // A truncated or corrupt asset, or a browser without the codec: the same outcome either way.
    const { loader } = harness({ undecodable: true });

    await loader.load(FIRST.id).then(
      () => expect.fail('should have rejected'),
      (error: unknown) => {
        expect(error).toBeInstanceOf(KitLoadError);
        if (error instanceof KitLoadError) expect(error.kind).toBe('undecodable');
      },
    );
  });

  it('rejects an identifier it does not know', async () => {
    const { loader, urls } = harness();

    await loader.load('tr-909').then(
      () => expect.fail('should have rejected'),
      (error: unknown) => {
        expect(error).toBeInstanceOf(KitLoadError);
        if (error instanceof KitLoadError) expect(error.kind).toBe('unknown');
      },
    );
    expect(urls).toEqual([]);
  });

  it('can be retried, and succeeds once the file is there', async () => {
    let broken = true;
    const urls: string[] = [];
    const loader = new KitLoader({
      baseUrl: '/aplbeats/',
      fetchImpl: ((input: RequestInfo | URL) => {
        urls.push(urlOf(input));
        if (broken) {
          return Promise.resolve({ ok: false, status: 503, statusText: 'Down' } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)),
        } as unknown as Response);
      }) as unknown as typeof fetch,
      decode: () => Promise.resolve(fakeBuffer('ok')),
    });

    await expect(loader.load(FIRST.id)).rejects.toBeInstanceOf(KitLoadError);
    broken = false;
    const kit = await loader.load(FIRST.id);

    for (const id of TRACK_IDS) expect(typeof kit[id], id).toBe('function');
    expect(loader.isReady(FIRST.id)).toBe(true);
  });

  it('refuses before fetching when the browser has no decoder at all', async () => {
    /*
     * Some builds have no Web Audio whatsoever — Playwright's WebKit is one, and it is how this
     * path was found. Downloading fifty kilobytes that could never be decoded would be spending
     * somebody's data on a certainty, so the refusal comes first and the network is never used.
     */
    const urls: string[] = [];
    const loader = new KitLoader({
      baseUrl: '/aplbeats/',
      fetchImpl: ((input: RequestInfo | URL) => {
        urls.push(urlOf(input));
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        } as unknown as Response);
      }) as unknown as typeof fetch,
      // No `decode`, and jsdom has no OfflineAudioContext.
    });

    expect(loader.canDecode).toBe(false);
    await loader.load(FIRST.id).then(
      () => expect.fail('should have rejected'),
      (error: unknown) => {
        expect(error).toBeInstanceOf(KitLoadError);
        if (error instanceof KitLoadError) expect(error.kind).toBe('unsupported');
      },
    );

    expect(urls).toEqual([]);
  });

  it('considers itself able to decode when a decoder was supplied', () => {
    const { loader } = harness();
    expect(loader.canDecode).toBe(true);
  });

  it('blames the browser rather than the kit when there is no decoder', () => {
    // Trying another machine would fail identically, so the message must not suggest it might not.
    const message = kitFailureMessage(new KitLoadError('unsupported', 'TR-808'));
    expect(message).toContain('cannot play sampled kits');
    expect(message).toContain('APL Beats Synth');
    expect(message).not.toContain('TR-808');
  });

  it('says which kit failed, and that the synthesised one is playing instead', () => {
    const message = kitFailureMessage(new KitLoadError('unavailable', 'TR-808'));
    expect(message).toContain('TR-808');
    expect(message).toContain('APL Beats Synth');
  });

  it('says so plainly when the browser reports being offline', () => {
    const message = kitFailureMessage(new KitLoadError('offline', 'LinnDrum LM-2'));
    expect(message).toContain('offline');
    expect(message).toContain('APL Beats Synth');
  });
});
