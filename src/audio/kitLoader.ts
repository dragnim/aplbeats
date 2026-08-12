/*
 * Fetching and decoding a kit, once.
 *
 * The rules this file exists to enforce, all of them about not wasting somebody's bandwidth
 * or their battery:
 *
 *   nothing is fetched at start-up. The default kit is the synthesised one, which is code, so
 *   a visitor who never opens the selector downloads no audio at all;
 *
 *   choosing a kit loads that kit and no other. There is no preloading, no prefetching and no
 *   speculative decode of the next one along;
 *
 *   a kit is decoded once. The `AudioBuffer`s are kept, so switching back to something already
 *   heard is immediate and silent — no request, no decode;
 *
 *   two selections of the same kit in flight together make one request, not two;
 *
 *   a kit either arrives complete or does not arrive. There is no partial kit, ever, because a
 *   kit with six of its eight rows loaded would play a pattern that looked right and sounded
 *   wrong.
 *
 * Decoding happens in an `OfflineAudioContext`, which needs no user gesture — so a kit can be
 * chosen and made ready before the visitor has pressed Play even once.
 */

import type { Kit } from './kit';
import { SYNTH_KIT } from './kit';
import { kitById, sampleUrl } from './kits/kits';
import { isSampleKit, SYNTH_KIT_ID, type KitId } from './kits/types';
import { createSampleKit } from './sampleKit';

/** Why a kit could not be loaded. One sentence each, all ending the same way. */
export type KitFailureKind = 'unknown' | 'offline' | 'unavailable' | 'undecodable' | 'unsupported';

export class KitLoadError extends Error {
  readonly kind: KitFailureKind;
  readonly kitName: string;
  readonly detail: string | undefined;

  constructor(kind: KitFailureKind, kitName: string, detail?: string) {
    super(`${kitName}: ${kind}${detail === undefined ? '' : ` (${detail})`}`);
    this.name = 'KitLoadError';
    this.kind = kind;
    this.kitName = kitName;
    this.detail = detail;
  }
}

export interface KitLoaderOptions {
  /** The published base path. Samples are served from `<base>/audio/<kit>/<file>`. */
  readonly baseUrl?: string;
  /** Injected by tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Turn encoded bytes into an `AudioBuffer`.
   *
   * Injected by tests, which have no Web Audio at all. In a browser this is an
   * `OfflineAudioContext`, built on first use and reused.
   */
  readonly decode?: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
}

export class KitLoader {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly decodeImpl: (bytes: ArrayBuffer) => Promise<AudioBuffer>;

  /** Kits already built. The cache that makes switching back free. */
  private readonly ready = new Map<KitId, Kit>();
  /** Loads in progress, so two selections of one kit share a request. */
  private readonly pending = new Map<KitId, Promise<Kit>>();
  /** Decoded audio, keyed `kitId/file`, so kits sharing a file decode it once. */
  private readonly buffers = new Map<string, AudioBuffer>();

  private decoder: OfflineAudioContext | null = null;

  /** Whether a decoder was supplied. If not, one has to exist in this browser. */
  private readonly hasOwnDecoder: boolean;

  constructor(options: KitLoaderOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/';
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.hasOwnDecoder = options.decode !== undefined;
    this.decodeImpl = options.decode ?? ((bytes) => this.decodeWithOfflineContext(bytes));
  }

  /**
   * Whether this browser can decode a sample at all.
   *
   * Some builds have no Web Audio whatsoever — Playwright's WebKit is one, and a locked-down
   * or very old browser may be another. Checked *before* fetching rather than after, because
   * downloading fifty kilobytes that can never be decoded is fifty kilobytes of somebody's
   * data spent on a certainty.
   */
  get canDecode(): boolean {
    return this.hasOwnDecoder || typeof OfflineAudioContext === 'function';
  }

  /** Whether this kit is ready to play right now, with no work to do. */
  isReady(id: KitId): boolean {
    return id === SYNTH_KIT_ID || this.ready.has(id);
  }

  /** How many kits are held in memory. Read by tests. */
  get readyCount(): number {
    return this.ready.size;
  }

  /**
   * The kit, fetching and decoding it if this is the first time.
   *
   * Rejects with a `KitLoadError` and caches nothing on failure, so the caller can fall back
   * and the visitor can try again.
   */
  async load(id: KitId): Promise<Kit> {
    if (id === SYNTH_KIT_ID) return SYNTH_KIT;

    const already = this.ready.get(id);
    if (already !== undefined) return already;

    const inFlight = this.pending.get(id);
    if (inFlight !== undefined) return inFlight;

    const definition = kitById(id);
    if (definition === undefined || !isSampleKit(definition)) {
      throw new KitLoadError('unknown', id, 'no such kit');
    }

    // Nothing is fetched if nothing could be done with it.
    if (!this.canDecode) {
      throw new KitLoadError('unsupported', definition.name, 'this browser has no Web Audio');
    }

    const work = this.build(definition.directory, definition.name, definition)
      .then((kit) => {
        this.ready.set(id, kit);
        return kit;
      })
      .finally(() => {
        this.pending.delete(id);
      });

    this.pending.set(id, work);
    return work;
  }

  private async build(
    directory: string,
    name: string,
    definition: Parameters<typeof createSampleKit>[0],
  ): Promise<Kit> {
    // Distinct files only. Two rows may share one sample — the SK-1's snare does — and it
    // would be careless to fetch and decode it twice.
    const files = [...new Set(Object.values(definition.voices).map((voice) => voice.file))];

    const decoded: Record<string, AudioBuffer> = {};

    /*
     * All eight at once rather than one after another. Eight small requests in parallel is one
     * round trip's worth of waiting; in series it is eight, which is the difference between a
     * kit that appears to switch and a kit that appears to hang.
     */
    await Promise.all(
      files.map(async (file) => {
        const key = `${directory}/${file}`;
        const cached = this.buffers.get(key);
        if (cached !== undefined) {
          decoded[file] = cached;
          return;
        }

        const bytes = await this.fetchSample(directory, file, name);
        let buffer: AudioBuffer;
        try {
          buffer = await this.decodeImpl(bytes);
        } catch (error) {
          throw new KitLoadError('undecodable', name, `${file}: ${describe(error)}`);
        }

        this.buffers.set(key, buffer);
        decoded[file] = buffer;
      }),
    );

    return createSampleKit(definition, decoded);
  }

  private async fetchSample(directory: string, file: string, name: string): Promise<ArrayBuffer> {
    const url = sampleUrl(directory, file, this.baseUrl);

    // A hint rather than a fact, but it turns a confusing network error into a clear sentence.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new KitLoadError('offline', name);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, { credentials: 'omit' });
    } catch (error) {
      throw new KitLoadError('unavailable', name, `${url}: ${describe(error)}`);
    }

    if (!response.ok) {
      throw new KitLoadError('unavailable', name, `HTTP ${String(response.status)} for ${url}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Decode without opening the audio device.
   *
   * An `OfflineAudioContext` needs no user gesture, so a kit chosen before the first Play is
   * ready by the time Play is pressed. 44.1 kHz because every bundled sample is; a live context
   * running at 48 kHz resamples on playback, which costs nothing audible.
   */
  private async decodeWithOfflineContext(bytes: ArrayBuffer): Promise<AudioBuffer> {
    this.decoder ??= new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44_100 });
    return this.decoder.decodeAudioData(bytes);
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** What to say out loud when a kit will not load. Always names the fallback. */
export function kitFailureMessage(error: unknown): string {
  const name = error instanceof KitLoadError ? error.kitName : 'that kit';

  if (error instanceof KitLoadError) {
    if (error.kind === 'offline') {
      return `You appear to be offline, so ${name} could not load. Using APL Beats Synth.`;
    }
    if (error.kind === 'unsupported') {
      // Not a failure of this kit, and trying another would fail the same way. Say so.
      return 'This browser cannot play sampled kits. Using APL Beats Synth.';
    }
  }

  return `Could not load ${name}. Using APL Beats Synth.`;
}
