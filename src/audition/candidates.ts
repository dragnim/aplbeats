import { ToneSampler, type ToneZone } from '@/audio/tones/ToneSampler';

/*
 * The candidate manifest, and loading one candidate's audio.
 *
 * The manifest is written by `scripts/prepare-audition.mjs` and served by a dev-only Vite plugin
 * from `.audition/`, which is gitignored and outside `public/`. Nothing here can run in a build,
 * because the page that imports it is not one of the build's entry points.
 *
 * Loading is deliberately the same shape as `toneLoader.ts`: fetch every root, decode every root,
 * install nothing until all of them are ready. A half-loaded candidate would drop notes and read
 * as a bad patch rather than as a slow one, which is exactly the wrong answer to get from an
 * audition.
 */

export interface AuditionSample {
  readonly file: string;
  readonly rootMidi: number;
  readonly sourceKey: number;
  readonly upstreamPath: string;
  readonly upstreamSha256: string;
  readonly upstreamBytes: number;
  readonly sampleRate: number;
  readonly frames: number;
  readonly seconds: number;
  readonly peak: number;
  readonly bytes: number;
  readonly loop: { readonly start: number; readonly end: number } | null;
  readonly loopSource: string | null;
  readonly loopCorroboratedBySfz: boolean | null;
}

export interface AuditionVariant {
  readonly available: boolean;
  readonly why?: string;
  readonly loops?: boolean;
  readonly seconds?: number | null;
  readonly bytes?: number;
  readonly samples?: readonly AuditionSample[];
}

export interface AuditionCandidate {
  readonly id: string;
  readonly preset: string;
  /** The upstream category the recordings actually came from, whatever role it is auditioning for. */
  readonly category: string;
  readonly folder: string;
  readonly character: string;
  readonly note: string;
  readonly role: 'lead' | 'pad' | 'reference';
  /** Which production sound this already is, if it is one. */
  readonly production?: string;
  readonly sfz: string | null;
  readonly roots: readonly number[];
  readonly maxShiftSemitones: number;
  readonly sourcePeak: number;
  readonly gain: number;
  readonly variants: Readonly<Record<string, AuditionVariant>>;
}

export interface AuditionManifest {
  readonly upstream: string;
  readonly roots: readonly number[];
  readonly maxShiftSemitones: number;
  readonly targetPeak: number;
  readonly candidates: readonly AuditionCandidate[];
}

export type VariantId = 'trim' | 'natural' | 'loop';

export const VARIANT_LABELS: Record<VariantId, string> = {
  trim: '1.2 s trimmed (production)',
  natural: '4 s natural',
  loop: 'upstream sustain loop',
};

const MANIFEST_URL = `${import.meta.env.BASE_URL}audition-manifest.json`;

export async function loadManifest(): Promise<AuditionManifest> {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`No audition manifest (HTTP ${String(response.status)}). Run: npm run prepare:audition`);
  }
  return (await response.json()) as AuditionManifest;
}

/**
 * One candidate's samplers, built once and remembered.
 *
 * Keyed by candidate and variant, because switching between the trimmed and looped versions of the
 * same pad has to be as instant as switching between two pads — that comparison is half the reason
 * the bench exists.
 */
const built = new Map<string, ToneSampler>();
const inFlight = new Map<string, Promise<ToneSampler>>();

export function isReady(candidate: AuditionCandidate, variant: VariantId): boolean {
  return built.has(`${candidate.id}/${variant}`);
}

/**
 * Decoded in an `OfflineAudioContext`, exactly as `toneLoader.ts` does it.
 *
 * Decoding needs no user gesture and no playback device, so a candidate can be ready before the
 * transport has ever been started — which is what makes the first Play instant and the second
 * candidate instant after that.
 */
const decoder = (): BaseAudioContext =>
  new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44_100 });

export async function samplerFor(candidate: AuditionCandidate, variant: VariantId): Promise<ToneSampler> {
  const key = `${candidate.id}/${variant}`;
  const already = built.get(key);
  if (already !== undefined) return already;

  const pending = inFlight.get(key);
  if (pending !== undefined) return pending;

  const shape = candidate.variants[variant];
  if (shape === undefined || !shape.available || shape.samples === undefined) {
    throw new Error(shape?.why ?? `${candidate.preset} has no ${variant} variant.`);
  }

  const work = (async (): Promise<ToneSampler> => {
    const zones = await Promise.all(
      shape.samples!.map(async (sample): Promise<ToneZone> => {
        const url = `${import.meta.env.BASE_URL}audio/audition/${sample.file}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${sample.file}: HTTP ${String(response.status)}`);
        const buffer = await decoder().decodeAudioData(await response.arrayBuffer());

        return sample.loop === null
          ? { rootMidi: sample.rootMidi, buffer }
          : { rootMidi: sample.rootMidi, buffer, loop: sample.loop };
      }),
    );

    // The same working gain production applies, so no candidate wins by being louder.
    return new ToneSampler(zones, candidate.gain);
  })();

  inFlight.set(key, work);
  try {
    const sampler = await work;
    built.set(key, sampler);
    return sampler;
  } finally {
    inFlight.delete(key);
  }
}

/** Which variants a candidate actually has, in the order the bench offers them. */
export function variantsOf(candidate: AuditionCandidate): VariantId[] {
  return (['trim', 'natural', 'loop'] as const).filter(
    (variant) => candidate.variants[variant]?.available === true,
  );
}
