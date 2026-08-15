/*
 * Fetching a Tone sound, once.
 *
 * The same shape as `kitLoader.ts` and for the same reasons: nothing is downloaded on arrival,
 * one sound is fetched when it is first needed, and a sound already heard is instant and silent.
 * Four sounds at seven recordings each is 2.9 MB — small, but not small enough to send to
 * somebody who came for the drums and never opened Tones.
 *
 * Decoding happens in an `OfflineAudioContext`, which needs no user gesture, so a sound chosen
 * before the first Play is ready by the time Play is pressed.
 *
 * A sound is installed only once *all* of its recordings have decoded. Half a sampler is worse
 * than none: it would play some notes and silently drop the ones whose zone had not arrived,
 * which reads as a broken instrument rather than as a slow one.
 */

import { ToneSampler, type ToneZone } from './ToneSampler';
import { toneSampleUrl, toneSoundById, type ToneSoundId } from './sounds';

export type ToneLoadFailure = 'unknown' | 'offline' | 'unavailable' | 'undecodable' | 'unsupported';

export class ToneLoadError extends Error {
  readonly kind: ToneLoadFailure;

  constructor(kind: ToneLoadFailure, message: string) {
    super(message);
    this.name = 'ToneLoadError';
    this.kind = kind;
  }
}

export interface ToneLoaderOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** Injected by tests, which have no real audio decoder. */
  readonly decode?: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
}

export class ToneLoader {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly decodeImpl: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  private readonly hasOwnDecoder: boolean;

  private readonly ready = new Map<ToneSoundId, ToneSampler>();
  private readonly pending = new Map<ToneSoundId, Promise<ToneSampler>>();

  constructor(options: ToneLoaderOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/';
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.hasOwnDecoder = options.decode !== undefined;
    this.decodeImpl = options.decode ?? ((bytes) => this.decodeWithOfflineContext(bytes));
  }

  /**
   * Whether this browser can decode a sample at all.
   *
   * Checked before fetching rather than after: downloading three megabytes that can never be
   * decoded is three megabytes of somebody's data spent on a certainty.
   */
  get canDecode(): boolean {
    return this.hasOwnDecoder || typeof OfflineAudioContext === 'function';
  }

  /** Whether this sound is ready to play right now. */
  isReady(id: ToneSoundId): boolean {
    return this.ready.has(id);
  }

  /** How many sounds are held in memory. Read by tests. */
  get readyCount(): number {
    return this.ready.size;
  }

  /**
   * The sampler for a sound, fetching and decoding it if this is the first time.
   *
   * Concurrent callers share one in-flight promise, so pressing Play while the Sound selector is
   * still loading does not fetch everything twice. Nothing is cached on failure, so a retry
   * really retries.
   */
  async load(id: ToneSoundId): Promise<ToneSampler> {
    const already = this.ready.get(id);
    if (already !== undefined) return already;

    const inFlight = this.pending.get(id);
    if (inFlight !== undefined) return inFlight;

    if (!this.canDecode) {
      throw new ToneLoadError('unsupported', 'This browser cannot play Tone sounds.');
    }

    const work = this.fetchSound(id);
    this.pending.set(id, work);

    try {
      const sampler = await work;
      this.ready.set(id, sampler);
      return sampler;
    } finally {
      this.pending.delete(id);
    }
  }

  private async fetchSound(id: ToneSoundId): Promise<ToneSampler> {
    const definition = toneSoundById(id);
    if (definition.samples.length === 0) {
      throw new ToneLoadError('unavailable', `${definition.name} has no samples.`);
    }

    if (globalThis.navigator?.onLine === false) {
      throw new ToneLoadError('offline', `Could not load ${definition.name}. You appear to be offline.`);
    }

    const zones = await Promise.all(
      definition.samples.map(async (sample): Promise<ToneZone> => {
        const url = toneSampleUrl(sample.file, this.baseUrl);

        let bytes: ArrayBuffer;
        try {
          const response = await this.fetchImpl(url);
          if (!response.ok) {
            throw new ToneLoadError('unavailable', `Could not load ${definition.name}.`);
          }
          bytes = await response.arrayBuffer();
        } catch (error) {
          if (error instanceof ToneLoadError) throw error;
          throw new ToneLoadError('offline', `Could not load ${definition.name}.`);
        }

        try {
          return { rootMidi: sample.rootMidi, buffer: await this.decodeImpl(bytes) };
        } catch {
          throw new ToneLoadError('undecodable', `Could not read ${definition.name}.`);
        }
      }),
    );

    /*
     * The sound is built with its own working gain, which is where that number finally lands.
     *
     * It was measured, documented and tested from the first day of Stage 8 and applied nowhere,
     * so Noisy Lead — whose recordings peak at 4% of full scale — played some twenty-three times
     * quieter than Petals Piano. Passing it here is the whole fix.
     */
    return new ToneSampler(zones, definition.gain);
  }

  private async decodeWithOfflineContext(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44_100 });
    return context.decodeAudioData(bytes);
  }
}
