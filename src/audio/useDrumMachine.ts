import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadKitChoice, saveKitChoice } from '@/app/persistence';
import type { Kit } from './kit';
import { SYNTH_KIT } from './kit';
import { KitLoader, kitFailureMessage } from './kitLoader';
import { kitById, KITS } from './kits/kits';
import { SYNTH_KIT_ID, type KitDefinition, type KitId } from './kits/types';

/*
 * Choosing a drum machine.
 *
 * This is the whole of Stage 4's state, and it is deliberately tiny, because the rule the
 * stage exists to keep is a rule about what this file *cannot* reach. It holds one identifier.
 * It cannot see the pattern, the seed, the presets, the macros, the locks, the APL settings,
 * the tempo, the swing, the mixer or the playhead — so "change the drum machine" cannot
 * change the rhythm, not by policy but by construction.
 *
 * Nor is it part of Undo. Undo is for things done to the Boolean matrix; picking a different
 * instrument to play it on is a listening decision, like moving a fader, and an Undo that
 * silently swapped the kit back instead of restoring the last edit would be answering a
 * question nobody asked.
 *
 * The one genuinely fiddly thing here is that loading takes time, and in that time the visitor
 * may choose again. So a load that is no longer the current choice is discarded rather than
 * applied — the same staleness rule the APL transforms use, for the same reason.
 */

export type KitStatus = 'ready' | 'loading' | 'failed';

export interface DrumMachineApi {
  /** What the selector shows: the kit the visitor has chosen. */
  readonly kitId: KitId;
  readonly kit: KitDefinition;
  /** Every kit on offer, in selector order. */
  readonly kits: readonly KitDefinition[];
  readonly status: KitStatus;
  /** One sentence, when a kit could not be loaded. Cleared by the next selection. */
  readonly error: string | null;
  readonly select: (id: KitId) => void;
}

export interface UseDrumMachineOptions {
  /** Hand a built kit to the audio engine. The only thing this hook does to the world. */
  readonly onKitReady: (kit: Kit) => void;
  /** Swapped for a fake in tests, which have no Web Audio and no network. */
  readonly loader?: KitLoader;
  /** Where the samples are served from. Defaults to the published base path. */
  readonly baseUrl?: string;
  /** The kit to start on. Defaults to whatever was last chosen. */
  readonly initialKitId?: KitId;
}

export function useDrumMachine({
  onKitReady,
  loader,
  baseUrl,
  initialKitId,
}: UseDrumMachineOptions): DrumMachineApi {
  /*
   * The restored choice, read once.
   *
   * In a lazy initialiser rather than an effect, so the selector never flashes "Synth" before
   * settling on what the visitor actually left it on.
   */
  const [kitId, setKitId] = useState<KitId>(() => initialKitId ?? loadKitChoice());
  const [status, setStatus] = useState<KitStatus>(() =>
    (initialKitId ?? loadKitChoice()) === SYNTH_KIT_ID ? 'ready' : 'loading',
  );
  const [error, setError] = useState<string | null>(null);

  const loaderRef = useRef<KitLoader | null>(null);
  if (loaderRef.current === null) {
    loaderRef.current = loader ?? new KitLoader(baseUrl === undefined ? {} : { baseUrl });
  }

  /** Read when a load resolves, rather than captured, so a stale reply cannot install. */
  const readyRef = useRef(onKitReady);
  useEffect(() => {
    readyRef.current = onKitReady;
  }, [onKitReady]);

  /**
   * Which selection is the current one.
   *
   * Incremented by every `select`. A kit that finishes decoding after the visitor has moved on
   * is dropped: it must not become the active kit, and it must not overwrite a newer kit's
   * "ready".
   */
  const selection = useRef(0);

  const install = useCallback((id: KitId, ticket: number) => {
    const activeLoader = loaderRef.current;
    if (activeLoader === null) return;

    if (id === SYNTH_KIT_ID) {
      readyRef.current(SYNTH_KIT);
      setStatus('ready');
      return;
    }

    /*
     * Already decoded: install it without a state round-trip through "loading".
     *
     * Which is what makes switching back to a kit already heard feel instantaneous rather than
     * merely fast — there is no request, no decode, and no flicker of a loading line.
     */
    if (activeLoader.isReady(id)) {
      void activeLoader.load(id).then((kit) => {
        if (selection.current !== ticket) return;
        readyRef.current(kit);
        setStatus('ready');
      });
      return;
    }

    setStatus('loading');
    void activeLoader.load(id).then(
      (kit) => {
        if (selection.current !== ticket) return; // Superseded; the newer choice wins.
        readyRef.current(kit);
        setStatus('ready');
      },
      (failure: unknown) => {
        if (selection.current !== ticket) return;

        /*
         * Fall back to the kit that cannot fail, and say so.
         *
         * The selector moves back to Synth as well, because it must show what is actually
         * playing — an interface naming TR-808 while the synthesised kit sounds would be the
         * audio equivalent of the thing Stage 3 refused to do with APL. The stored choice moves
         * too, so a kit that has stopped being available does not greet the visitor with the
         * same error on every reload.
         */
        console.warn('[kit]', failure);
        readyRef.current(SYNTH_KIT);
        setKitId(SYNTH_KIT_ID);
        saveKitChoice(SYNTH_KIT_ID);
        setError(kitFailureMessage(failure));
        setStatus('failed');
      },
    );
  }, []);

  /*
   * The restored kit, loaded once on mount.
   *
   * This is the only load that is not caused by a click, and it is caused by the visitor all
   * the same — they chose it last time. It fetches exactly one kit, around fifty kilobytes;
   * nothing else is preloaded, and a visitor on the default synthesised kit downloads no audio
   * at all.
   */
  useEffect(() => {
    install(kitId, selection.current);
    // Deliberately once. Later changes come through `select`, which owns its own ticket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback(
    (id: KitId) => {
      if (id === kitId && status !== 'failed') return;

      const ticket = selection.current + 1;
      selection.current = ticket;

      setKitId(id);
      setError(null);
      saveKitChoice(id);
      install(id, ticket);
    },
    [kitId, status, install],
  );

  const kit = kitById(kitId) ?? KITS[0]!;

  return useMemo(
    () => ({ kitId, kit, kits: KITS, status, error, select }),
    [kitId, kit, status, error, select],
  );
}
