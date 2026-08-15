import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveTones, saveToneVolume } from '@/app/persistence';
import type { Phrase } from '@/tones/phrase';
import type { ToneSampler } from './ToneSampler';
import { ToneLoader, ToneLoadError } from './toneLoader';
import { DEFAULT_TONE_SOUND, DEFAULT_TONE_VOLUME, type ToneSoundId } from './sounds';

/*
 * The Tone instrument, in React.
 *
 * The exact shape of `useDrumMachine`, deliberately: one chosen instrument, one loader that
 * remembers what it has already fetched, one status the interface can show, and an installer that
 * hands the finished thing to the transport. Anybody who has read the drum machine hook has read
 * this one.
 *
 * Two things it is careful about, both learned from the kit loader.
 *
 * A reply that arrives after somebody has changed their mind is discarded rather than installed.
 * Three megabytes over a slow connection is long enough to click Bass, change to Pad, and hear the
 * Bass arrive — so every load carries the identity it was asked for, and a load that is no longer
 * the current choice is dropped on arrival.
 *
 * And nothing is fetched until Tones is actually opened. A visitor who came for the drums and
 * never touched the melody should not spend three megabytes of their data on it.
 */

export type ToneStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly soundId: ToneSoundId }
  | { readonly kind: 'ready'; readonly soundId: ToneSoundId }
  | { readonly kind: 'failed'; readonly soundId: ToneSoundId; readonly message: string };

export interface UseTonesOptions {
  /** The sound to start on — from storage, or the default. */
  readonly initialSoundId?: ToneSoundId;
  /** The level to start at — from storage, or the default. */
  readonly initialVolume?: number;
  /**
   * Whether the Tone layer is wanted yet.
   *
   * False until somebody opens Tones for the first time, and true forever afterwards. This is the
   * whole of the lazy-loading policy, and it lives in the caller because only the caller knows
   * which tab is showing.
   */
  readonly enabled: boolean;
  /** Where the decoded sampler goes. The transport's `setToneSampler`. */
  readonly install: (sampler: ToneSampler | null) => void;
  /** Where the level goes. The transport's `setToneVolume`. */
  readonly applyVolume: (volume: number) => void;
  /** The melody, so that changing sound can be persisted alongside it. */
  readonly phrase: Phrase;
  /** Where the samples are served from. Defaults to the published base path. */
  readonly baseUrl?: string;
  /** Injected by tests, which have neither a network nor an audio decoder. */
  readonly loader?: ToneLoader;
}

export interface TonesApi {
  readonly soundId: ToneSoundId;
  readonly status: ToneStatus;
  readonly volume: number;
  readonly setSound: (soundId: ToneSoundId) => void;
  readonly setVolume: (volume: number) => void;
  /** Try the current sound again after a failure. */
  readonly retry: () => void;
}

export function useTones(options: UseTonesOptions): TonesApi {
  const { enabled, install, applyVolume, phrase } = options;

  const [soundId, setSoundId] = useState<ToneSoundId>(options.initialSoundId ?? DEFAULT_TONE_SOUND);
  const [volume, setVolumeState] = useState(() => clamp(options.initialVolume ?? DEFAULT_TONE_VOLUME));
  const [status, setStatus] = useState<ToneStatus>({ kind: 'idle' });

  /*
   * One loader for the life of the page, so a sound heard once is instant ever after.
   *
   * The base path matters and is easy to get wrong: APL Beats is published under /aplbeats/, so a
   * loader defaulting to / asks for /audio/tones/lead-48.wav and gets seven 404s and a sound that
   * will not play. The drum machine passes the same value for the same reason.
   */
  const baseUrl = options.baseUrl;
  const fallbackLoader = useMemo(() => new ToneLoader(baseUrl === undefined ? {} : { baseUrl }), [baseUrl]);
  const loader = options.loader ?? fallbackLoader;

  /*
   * The melody, behind a ref.
   *
   * Only read when the *sound* changes, to write both into storage together. Holding it as a
   * dependency instead would rewrite that record on every note edit — which the App already does,
   * from the one effect that owns it.
   */
  const phraseRef = useRef(phrase);
  useEffect(() => {
    phraseRef.current = phrase;
  }, [phrase]);

  /** Read when a load resolves, rather than captured, so a stale reply cannot install. */
  const installRef = useRef(install);
  useEffect(() => {
    installRef.current = install;
  }, [install]);

  /**
   * Which selection is the current one.
   *
   * Incremented by every choice. A sound that finishes decoding after the visitor has moved on is
   * dropped: it must not become the playing instrument, and it must not overwrite a newer
   * sound's "ready". The same ticket the drum machine uses, for the same reason.
   */
  const selection = useRef(0);

  const begin = useCallback(
    (id: ToneSoundId, ticket: number) => {
      /*
       * Already decoded: no round trip through "loading".
       *
       * Which is what makes going back to a sound already heard feel instantaneous — no request,
       * no decode, and no flicker of a loading line under the selector.
       */
      if (loader.isReady(id)) {
        void loader.load(id).then((sampler) => {
          if (selection.current !== ticket) return;
          installRef.current(sampler);
          setStatus({ kind: 'ready', soundId: id });
        });
        return;
      }

      setStatus({ kind: 'loading', soundId: id });
      void loader.load(id).then(
        (sampler) => {
          // Somebody changed their mind while this was in flight. Installing it now would swap
          // their instrument back to one they had already rejected.
          if (selection.current !== ticket) return;
          installRef.current(sampler);
          setStatus({ kind: 'ready', soundId: id });
        },
        (error: unknown) => {
          if (selection.current !== ticket) return;
          /*
           * No fallback instrument, deliberately — unlike the drum machine, which drops back to
           * the synthesised kit. There is nothing to drop back to: every Tone sound is a set of
           * recordings, and a synthesised stand-in would be a different instrument wearing the
           * name of the one that failed. The melody, the drums and the transport are all
           * untouched; one line says so and offers to try again.
           */
          console.warn('[tones]', error);
          setStatus({ kind: 'failed', soundId: id, message: messageFor(error) });
        },
      );
    },
    [loader],
  );

  /** The current choice, read by the effect below without making it a dependency. */
  const soundRef = useRef(soundId);
  useEffect(() => {
    soundRef.current = soundId;
  }, [soundId]);

  /*
   * The first load, when Tones is first opened.
   *
   * The only load not caused by a click — and it is caused by the visitor all the same, by
   * opening the tab. Everything afterwards goes through `setSound` or `retry`, which own their
   * own tickets, so this deliberately watches `enabled` and nothing else.
   */
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    begin(soundRef.current, selection.current);
  }, [enabled, begin]);

  const setSound = useCallback(
    (next: ToneSoundId) => {
      const ticket = selection.current + 1;
      selection.current = ticket;

      setSoundId(next);
      saveTones({ phrase: phraseRef.current, soundId: next });
      if (enabled) begin(next, ticket);
    },
    [enabled, begin],
  );

  const setVolume = useCallback(
    (next: number) => {
      const safe = clamp(next);
      setVolumeState(safe);
      applyVolume(safe);
      saveToneVolume(safe);
    },
    [applyVolume],
  );

  const retry = useCallback(() => {
    const ticket = selection.current + 1;
    selection.current = ticket;
    begin(soundRef.current, ticket);
  }, [begin]);

  // The stored level, pushed into the engine once on mount. The engine remembers it with no
  // audio device open, so this costs nothing until Play is pressed.
  useEffect(() => {
    applyVolume(volume);
    // Deliberately mount-only: every later change goes through `setVolume`, which applies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(
    () => ({ soundId, status, volume, setSound, setVolume, retry }),
    [soundId, status, volume, setSound, setVolume, retry],
  );
}

function clamp(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_TONE_VOLUME;
  return Math.min(1, Math.max(0, volume));
}

/**
 * What to tell somebody when a sound will not load.
 *
 * The loader's own message, which names the sound and says what went wrong, or a plain sentence
 * for anything that reached here without being a `ToneLoadError` at all.
 */
function messageFor(error: unknown): string {
  if (error instanceof ToneLoadError) return error.message;
  return 'Could not load this sound.';
}
