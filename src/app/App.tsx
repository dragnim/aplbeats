import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApl, type ExploreOrigin } from '@/apl/useApl';
import type { ToneExploreOrigin } from '@/apl/useToneApl';
import { useDrumMachine } from '@/audio/useDrumMachine';
import { DrumMachineSelect } from '@/components/DrumMachineSelect';
import { GeneratorPanel } from '@/components/GeneratorPanel';
import { CreatePanel } from '@/components/CreatePanel';
import { ExploreEditor } from '@/components/ExploreEditor';
import { TransformPanel } from '@/components/TransformPanel';
import { Logo } from '@/components/Logo';
import { Sequencer } from '@/components/Sequencer';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UndoButton } from '@/components/UndoButton';
import { TransportBar } from '@/components/TransportBar';
import { WorkspaceRail } from '@/components/WorkspaceRail';
import { DomainTabs } from '@/components/DomainTabs';
import { ToneStrip } from '@/components/ToneStrip';
import { TonePanel } from '@/components/TonePanel';
import { ToneCreatePanel } from '@/components/ToneCreatePanel';
import { ToneTransformPanel } from '@/components/ToneTransformPanel';
import { ToneExploreEditor } from '@/components/ToneExploreEditor';
import type { Domain, WorkspaceId } from '@/components/workspaces';
import { INITIAL_BPM, INITIAL_SWING } from '@/pattern/initialGroove';
import { createMixer, effectiveLevel, setVolume, toggleMute, trackIdFor, type Mixer } from '@/pattern/mixer';
import { TRACKS } from '@/pattern/tracks';
import { clampBpm, clampSwing } from '@/transport/timing';
import { useTransport } from '@/transport/useTransport';
import { useTones } from '@/audio/tones/useTones';
import {
  loadMasterVolume,
  loadSession,
  loadTones,
  loadToneVolume,
  saveMasterVolume,
  saveSession,
  saveTones,
} from './persistence';
import { INITIAL_CREATIVE_STATE } from './openingState';
import { usePageVisibility } from './usePageVisibility';
import { useStudio } from './useStudio';
import { useTheme } from './useTheme';
import styles from './App.module.css';

/*
 * The application.
 *
 * Three pieces of state, and the split between them is the design. The *creative* state —
 * pattern, seed, preset, macros, locks — lives in `useStudio` behind an undo history,
 * because it is what a visitor makes and would be sorry to lose. Tempo, swing and the
 * mixer live here as plain state: they are how you listen to what you made, not part of
 * it, and putting them in the history would mean an Undo after nudging a fader threw away
 * the groove you had been building.
 *
 * The order on the page is transport, sequencer, generator: how you listen, what you
 * hear, how you make it. Play first because on a phone the grid is most of a screen tall,
 * and having to scroll past all eight tracks to reach Play is a poor first minute. The
 * document order and the visual order are the same on every width — no CSS reordering —
 * so what a keyboard walks through is what the eye sees.
 *
 * The transport reads the pattern through a getter, so a generated bar takes effect at
 * once without anything restarting. Which is worth being explicit about: a new pattern
 * replaces the old one **immediately**, not on the next bar line. The matrix is
 * immutable, so the swap is atomic — a step already handed to Web Audio played from a
 * complete bar and the next one plays from a complete bar. Bar-quantising it would mean
 * the grid showing one pattern while another played for up to two seconds, and would put
 * a deadline inside the scheduler that Stage 1 deliberately keeps clear.
 */
export function App(): React.JSX.Element {
  /*
   * A stored session, read once.
   *
   * `useMemo` rather than an effect, so the first paint is already the restored groove
   * rather than the default one replaced a frame later.
   */
  const restored = useMemo(() => loadSession(), []);

  /*
   * The Tone layer, restored from its own key.
   *
   * Read separately from the session on purpose, and this is the visible consequence of that
   * decision: a session discarded because the drum generator's version moved takes the pattern
   * with it, and leaves the melody exactly where it was. See `persistence.ts`.
   */
  const restoredTones = useMemo(() => loadTones(), []);
  const restoredToneVolume = useMemo(() => loadToneVolume(), []);

  const studio = useStudio(
    useMemo(
      () => ({
        ...(restored?.creative ?? INITIAL_CREATIVE_STATE),
        phrase: restoredTones?.phrase ?? INITIAL_CREATIVE_STATE.phrase,
      }),
      // Both are read once, before the first paint, and neither can change afterwards.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    ),
  );
  const [mixer, setMixer] = useState<Mixer>(() => restored?.mixer ?? createMixer());
  const [bpm, setBpm] = useState(() => restored?.bpm ?? INITIAL_BPM);
  const [swing, setSwing] = useState(() => restored?.swing ?? INITIAL_SWING);
  /*
   * How loud, which is listening state and nothing else.
   *
   * Not in the session with the pattern, not in Undo, and not part of the mix: the eight track
   * faders decide the balance between the voices, and this decides how loud the finished result
   * is. Moving it changes one number and one gain node.
   */
  const [masterVolume, setMasterVolume] = useState(() => loadMasterVolume());

  const theme = useTheme();

  /*
   * Which layer is on screen, and which of the four workspaces is open beside it.
   *
   * Stage 7 made the workspaces tabs: the local generator, Create, Transform and Explore used to
   * be four cards stacked down a long page, with the APL a scroll away from the beat it changed;
   * now one of them is open at a time, next to the sequencer. Stage 8 put a second tablist above
   * that one, choosing which music those tools act on.
   *
   * Two workspace states rather than one, because the tools mean different things on the two
   * sides: somebody deep in an APL melody transform who glances at the drums and comes back
   * should find the transform, not be returned to Play. So each domain remembers its own tab.
   *
   * `play` first on both, and Beats first of the two, because that is what somebody is here for.
   * None of the three is persisted, deliberately: which layer and which tool you had open is a
   * fact about the last thirty seconds, not a preference, and a returning visitor should land on
   * the instrument rather than wherever they happened to stop.
   */
  const [domain, setDomain] = useState<Domain>('beats');
  /*
   * Whether the Tone instrument is wanted yet.
   *
   * Latched on by the first visit to Tones and never off again. This is the whole of the lazy
   * loading policy: a visitor who came for the drums and never opened Tones fetches none of its
   * three megabytes, and one who opened it once does not fetch them a second time for glancing
   * back at the kick.
   */
  const [tonesWanted, setTonesWanted] = useState(false);
  const selectDomain = useCallback((next: Domain) => {
    setDomain(next);
    if (next === 'tones') setTonesWanted(true);
  }, []);
  const [beatsWorkspace, setBeatsWorkspace] = useState<WorkspaceId>('play');
  const [tonesWorkspace, setTonesWorkspace] = useState<WorkspaceId>('play');
  const workspace = domain === 'tones' ? tonesWorkspace : beatsWorkspace;
  const setWorkspace = domain === 'tones' ? setTonesWorkspace : setBeatsWorkspace;
  const workspaceIds = useId();

  /*
   * Whether Explore has been opened at all.
   *
   * The Create and Transform panels use this to decide whether to offer "Edit this APL" or to
   * explain that the editor is already holding somebody's own work. It is *visited*, not
   * *visible*: with tabs, Explore is one click away rather than below, and a panel that offered
   * to open an editor which already contains an edited draft would be offering to lose it.
   */
  const [exploreVisited, setExploreVisited] = useState(false);
  /*
   * And the same for the Tones side, which is a separate editor with a separate draft.
   *
   * Two flags rather than one, because the question each panel asks is about *its own* editor:
   * a Beats Peek offering to load into an editor that is holding a melody would be offering to
   * lose the wrong work.
   */
  const [toneExploreVisited, setToneExploreVisited] = useState(false);

  /*
   * How far down the sticky columns must start.
   *
   * Measured rather than guessed. The top bar is two rows whose height changes with the width —
   * the tagline disappears on a phone, the transport wraps on a narrow laptop — and a hard-coded
   * offset would leave the rail either overlapping the transport or floating below it at exactly
   * the widths nobody tests. One `ResizeObserver`, no polling, and it writes a CSS custom
   * property so the rest of the arithmetic stays in the stylesheet.
   */
  const shell = useRef<HTMLDivElement | null>(null);
  const topBar = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const bar = topBar.current;
    const root = shell.current;
    if (bar === null || root === null) return;
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      root.style.setProperty('--sticky-top', `${String(bar.offsetHeight + 12)}px`);
    });
    observer.observe(bar);
    return () => {
      observer.disconnect();
    };
  }, []);

  const isVisible = usePageVisibility();
  const { pattern, phrase, locks } = studio.state;

  /*
   * The transport's window onto the current state.
   *
   * Refs rather than the values themselves, because the scheduler asks what the pattern
   * is at the instant it hands a step to Web Audio — a hundred milliseconds before that
   * step sounds, and quite possibly between two React renders.
   */
  const patternRef = useRef(pattern);
  const mixerRef = useRef(mixer);
  const phraseRef = useRef(phrase);

  useEffect(() => {
    patternRef.current = pattern;
    mixerRef.current = mixer;
    phraseRef.current = phrase;
  }, [pattern, mixer, phrase]);

  const getPattern = useCallback(() => patternRef.current, []);
  const getMixer = useCallback(() => mixerRef.current, []);
  const getPhrase = useCallback(() => phraseRef.current, []);

  const transport = useTransport({ getPattern, getMixer, getPhrase, bpm, swing, isVisible });

  /*
   * The Tone instrument.
   *
   * `enabled` is what keeps the promise that a visitor who never opens Tones pays nothing for it:
   * the samples are fetched the first time the Tones tab is opened, and never before. Once opened
   * it stays enabled, so switching back to Beats does not throw the instrument away — switching
   * tabs is a change of view and must never touch what is playing.
   */
  const tones = useTones({
    ...(restoredTones === null ? {} : { initialSoundId: restoredTones.soundId }),
    initialVolume: restoredToneVolume,
    enabled: tonesWanted,
    baseUrl: import.meta.env.BASE_URL,
    install: transport.setToneSampler,
    applyVolume: transport.setToneVolume,
    phrase,
  });

  /*
   * APL transforms.
   *
   * The only part of the application that touches the network, and it is reached from one
   * button. Nothing here runs on a timer, on playback, or as a control moves — see
   * `useApl` for the rules and why they are all in one file.
   */
  /*
   * Locks are handed in as row indices, because that is what APL is given.
   *
   * They mean "the generator may not change this": Create respects them, the built-in
   * transforms deliberately ignore them, and that asymmetry is the existing rule rather than a
   * new one — Rotate refusing to rotate a locked kick would be absurd.
   */
  const lockedRows = useMemo(() => locks.flatMap((locked, index) => (locked ? [index] : [])), [locks]);

  const transform = useApl({
    pattern,
    lockedRows,
    onApply: studio.applyTransform,
    phrase,
    onApplyPhrase: studio.applyPhrase,
  });

  /**
   * Open the editor, pointed at whichever panel asked.
   *
   * `follow` is deliberately non-destructive: it moves the editor onto another source only when
   * there is nothing to lose. An edited draft stays exactly as it is, and the panel that asked
   * offers an explicit load instead — because somebody's writing must not vanish because they
   * opened a Peek.
   */
  const openExplore = useCallback(
    (origin: ExploreOrigin) => {
      transform.explore.follow(origin);
      setExploreVisited(true);
      // "Edit this APL" now means "show me that, in Explore" — so it moves the workspace too.
      // Explicitly the Beats one: this is only ever called from the Beats Create and Transform
      // panels, and reaching through the domain-dependent setter would make a stable callback
      // depend on which tab happened to be open.
      setBeatsWorkspace('explore');
    },
    [transform.explore],
  );

  /** The same, for the melody's editor and the melody's workspace. */
  const openToneExplore = useCallback(
    (origin: ToneExploreOrigin) => {
      transform.tones.explore.follow(origin);
      setToneExploreVisited(true);
      setTonesWorkspace('explore');
    },
    [transform.tones.explore],
  );

  /*
   * Which drum machine plays it.
   *
   * A rendering choice, and nothing but: this hook holds one identifier and hands the engine
   * eight voices. It cannot see the pattern, the seed, the macros, the locks, the transform
   * settings, the tempo or the mixer — so changing the machine changes the sound and cannot
   * change the rhythm, by construction rather than by care.
   *
   * `transport.setKit` swaps the kit in one assignment, so this behaves identically whether the
   * transport is stopped or halfway through a bar.
   */
  /*
   * The listening level, applied to the engine and remembered.
   *
   * Written straight through rather than debounced: a gain change is one assignment and one
   * short ramp, which is far cheaper than the serialise a debounce exists to avoid. The storage
   * write is cheap too, and a volume nobody kept because they closed the tab quickly would be a
   * small thing to lose for no reason.
   */
  const handleMasterVolumeChange = useCallback(
    (next: number) => {
      const clamped = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 1;
      setMasterVolume(clamped);
      transport.setMasterVolume(clamped);
      saveMasterVolume(clamped);
    },
    [transport],
  );

  /*
   * The restored level, handed to the engine once.
   *
   * The engine remembers it whether or not a graph exists, so this simply makes sure a session
   * that opened at 37% is at 37% the moment the audio device opens — without opening one.
   */
  useEffect(() => {
    transport.setMasterVolume(masterVolume);
    // Deliberately once: later changes go through `handleMasterVolumeChange`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drumMachine = useDrumMachine({
    onKitReady: transport.setKit,
    baseUrl: import.meta.env.BASE_URL,
  });

  /*
   * Save, a moment after things settle.
   *
   * Debounced because every cell of a drag and every value of a slider would otherwise be
   * a serialise and a write. Half a second is well below the time it takes to reach for a
   * tab and long enough that a gesture is one write.
   */
  useEffect(() => {
    const handle = setTimeout(() => {
      saveSession({ creative: studio.state, bpm, swing, mixer });
      // Under its own key, on the same debounce. Two writes rather than one, which is the price
      // of the melody surviving a generator version bump — see `persistence.ts`.
      saveTones({ phrase, soundId: tones.soundId });
    }, 500);
    return () => {
      clearTimeout(handle);
    };
  }, [studio.state, bpm, swing, mixer, phrase, tones.soundId]);

  /*
   * Switching a step on plays it.
   *
   * What turns the grid from a form into an instrument, and what lets a pattern be built
   * by ear while the transport is stopped. Switching one *off* plays nothing, because
   * silence is not a sound to preview.
   */
  const handleSetCell = useCallback(
    (track: number, step: number, value: boolean) => {
      studio.setCell(track, step, value);

      if (!value || transport.isPlaying) return;
      const trackId = trackIdFor(track);
      if (trackId === undefined) return;
      transport.audition(trackId, effectiveLevel(mixer, track));
    },
    [mixer, studio, transport],
  );

  /*
   * Moving a note plays it.
   *
   * The Tone counterpart of auditioning a drum step, with one difference: it previews while the
   * transport is *running* as well as while it is stopped. A drum step you switch on is heard a
   * fraction of a bar later anyway, but a note moved from G to A♭ might not sound again for
   * fifteen steps — and choosing a pitch by ear means hearing the pitch when you choose it. The
   * sampler is monophonic, so the preview simply takes the voice, exactly as the next scheduled
   * note would.
   */
  const handlePreviewTone = useCallback(
    (midi: number) => {
      transport.previewTone(midi);
    },
    [transport],
  );

  const handleAuditionTrack = useCallback(
    (track: number) => {
      const trackId = trackIdFor(track);
      if (trackId === undefined) return;
      const level = effectiveLevel(mixer, track);
      transport.audition(trackId, level > 0 ? level : 0.6);
    },
    [mixer, transport],
  );

  const handleToggleMute = useCallback((track: number) => {
    setMixer((current) => toggleMute(current, track));
  }, []);

  const handleVolumeChange = useCallback((track: number, volume: number) => {
    setMixer((current) => setVolume(current, track, volume));
  }, []);

  /*
   * Editing needs the audio device open, and so does Randomise.
   *
   * Both are user gestures, and both are chances to unlock audio — so pressing Randomise
   * first and Play second still hears the very first bar rather than a silent one.
   */
  const beginEdit = useCallback(() => {
    transport.prepare();
    studio.beginEdit();
  }, [studio, transport]);

  const handleRandomise = useCallback(() => {
    transport.prepare();
    studio.randomise();
  }, [studio, transport]);

  return (
    <div className={styles.app} ref={shell}>
      {/*
        The top bar: who this is, how it is playing, and how it looks.

        Two thin rows rather than one wide band. Squeezing the brand, the transport, the kit, the
        master volume and the theme toggle onto a single line would have put the Stage 5.1
        transport layout back under pressure at exactly the widths it was fixed for, and the
        second row costs about forty pixels.
      */}
      <header className={styles.topBar} ref={topBar}>
        <div className={styles.brandRow}>
          <h1 className={styles.title}>
            <Logo />
          </h1>
          <p className={styles.tagline}>
            Make music first. <span className={styles.taglineSecond}>Discover array programming second.</span>
          </p>
          <UndoButton canUndo={studio.canUndo} onUndo={studio.undo} />
          <ThemeToggle resolved={theme.resolved} onToggle={theme.toggle} />
        </div>

        <h2 className="visuallyHidden">Transport</h2>
        <TransportBar
          state={transport.state}
          bpm={bpm}
          swing={swing}
          onToggle={transport.toggle}
          onBpmChange={(next) => {
            setBpm(clampBpm(next));
          }}
          onSwingChange={(next) => {
            setSwing(clampSwing(next));
          }}
          masterVolume={masterVolume}
          onMasterVolumeChange={handleMasterVolumeChange}
          instrument={<DrumMachineSelect drumMachine={drumMachine} />}
        />
      </header>

      {/*
        Beats or Tones, above everything the choice governs.

        Switching is visual and nothing else: no request, no fetch, no execution, and above all no
        transport change. Both layers go on sounding either way — the drums do not pause because
        somebody went to write a melody. See `DomainTabs`.
      */}
      <DomainTabs active={domain} onSelect={selectDomain} panelIds={workspaceIds} />

      <div
        className={styles.body}
        role="tabpanel"
        id={`${workspaceIds}-domain-panel-${domain}`}
        aria-labelledby={`${workspaceIds}-domain-tab-${domain}`}
      >
        <div className={styles.railColumn}>
          <WorkspaceRail active={workspace} onSelect={setWorkspace} panelIds={workspaceIds} domain={domain} />
        </div>

        <main className={styles.main}>
          {domain === 'beats' ? (
            <>
              <h2 className="visuallyHidden">Pattern</h2>
              <Sequencer
                pattern={pattern}
                mixer={mixer}
                locks={locks}
                playheadStep={transport.playheadStep}
                isPlaying={transport.isPlaying}
                onSetCell={handleSetCell}
                onToggleMute={handleToggleMute}
                onToggleLock={studio.toggleLock}
                onVolumeChange={handleVolumeChange}
                onAuditionTrack={handleAuditionTrack}
                onEditGesture={beginEdit}
              />
            </>
          ) : (
            <>
              <h2 className="visuallyHidden">Melody</h2>
              <ToneStrip
                phrase={phrase}
                playheadStep={transport.playheadStep}
                isPlaying={transport.isPlaying}
                onEditGesture={studio.beginNoteEdit}
                onSetNote={studio.setNote}
                onPreview={handlePreviewTone}
              />
            </>
          )}
        </main>

        {/*
          The APL column, and the reason for the whole layout.

          One workspace at a time, beside the grid rather than beneath it. Each is a real tab
          panel — `role="tabpanel"`, labelled by its tab — and only the selected one is rendered,
          which is why switching costs nothing: no work to do, and certainly no request.

          Rendering only the active one has one consequence worth stating plainly: an Explore
          draft survives being switched away from, because the draft lives in `useApl` and not in
          the editor component. Unmounting the textarea does not unmake what somebody wrote.
        */}
        <div className={styles.aplColumn}>
          <div
            className={styles.aplPanel}
            role="tabpanel"
            id={`${workspaceIds}-panel-${workspace}`}
            aria-labelledby={`${workspaceIds}-tab-${workspace}`}
            tabIndex={-1}
          >
            {workspace === 'play' && domain === 'tones' && <TonePanel tones={tones} phrase={phrase} />}

            {workspace === 'play' && domain === 'beats' && (
              <GeneratorPanel
                preset={studio.state.preset}
                seed={studio.state.seed}
                macros={studio.state}
                onRandomise={handleRandomise}
                onNewSeed={studio.newSeed}
                onPresetChange={studio.setPreset}
                onMacroChange={studio.setMacro}
                onMacroCommit={studio.commitMacro}
              />
            )}

            {workspace === 'create' && domain === 'beats' && (
              <CreatePanel
                transform={transform}
                exploreOpen={exploreVisited}
                onEditApl={() => {
                  openExplore('create');
                }}
              />
            )}

            {workspace === 'transform' && domain === 'beats' && (
              <TransformPanel
                transform={transform}
                pattern={pattern}
                exploreOpen={exploreVisited}
                onEditApl={() => {
                  openExplore('transform');
                }}
              />
            )}

            {workspace === 'explore' && domain === 'beats' && <ExploreEditor transform={transform} />}

            {workspace === 'create' && domain === 'tones' && (
              <ToneCreatePanel
                transform={transform}
                exploreOpen={toneExploreVisited}
                onEditApl={() => {
                  openToneExplore('create');
                }}
              />
            )}

            {workspace === 'transform' && domain === 'tones' && (
              <ToneTransformPanel
                transform={transform}
                phrase={phrase}
                exploreOpen={toneExploreVisited}
                onEditApl={() => {
                  openToneExplore('transform');
                }}
              />
            )}

            {workspace === 'explore' && domain === 'tones' && <ToneExploreEditor transform={transform} />}
          </div>
        </div>
      </div>

      {/*
        Spoken, not shown. The Play button's name changes, but a name changes silently for
        someone who is not on it — and while the tab was hidden the transport will have paused
        itself, which is a change nobody asked for.

        Named, because there are several live regions on the page — playback, the transform, the
        generation and Explore. Several are legitimate, since any of them can change without the
        others, but an unnamed set is anonymous voices and a reader arriving at one has no way to
        know which is speaking.
      */}
      <p className="visuallyHidden" role="status" aria-label="Playback">
        {transport.isPlaying ? 'Playing' : 'Paused'}
      </p>

      <footer className={styles.footer}>
        <p className={styles.note}>
          Eight drum tracks and one melody line, sixteen steps each — an{' '}
          <span className={styles.emphasis}>{TRACKS.length} × 16</span> Boolean matrix and a{' '}
          <span className={styles.emphasis}>16</span> numeric vector underneath. The instant generator and the
          timing are local; the APL tools create and transform both in Dyalog APL, through TryAPL, one whole
          pattern or melody at a time and only when you ask.
        </p>

        {/*
          The audio credits, in the interface rather than only in the repository.

          Three sources, and the sentence keeps them apart, because they are owed different
          things. "Selected" for the collection, because nine of its ten packs are included and
          one is not, so "samples from" on its own would overstate what is here. André Michelle
          is named rather than only his repository, because MIT asks for the copyright holder
          and a person who wrote a drum machine deserves better than a URL.

          "Rendered from" rather than "samples from" for the TR-909, because that is what
          happened: the files here are the output of running his DSP, not a pack of finished
          samples copied across. It says what was done rather than making a claim about what
          upstream's own audio resources are, which upstream does not document.

          The Tone sounds get "samples from" plainly, because that is what they are: recordings
          of a synthesiser, copied from a public-domain release and trimmed. The dedication asks
          for no credit at all; this is given because it is owed in the ordinary sense.

          "Instruments" rather than "drum machines" in the last sentence, since Stage 8 there is
          a synthesiser named here too, and the disclaimer has to cover it.

          `rel="noreferrer noopener"` on external links as everywhere else, and no sentence
          implies that any of the three had anything to do with APL Beats.
        */}
        <p className={styles.note}>
          Selected drum machine samples from{' '}
          <a
            className={styles.link}
            href="https://github.com/smpldsnds/drum-machines"
            rel="noreferrer noopener"
            target="_blank"
          >
            smpldsnds/drum-machines
          </a>
          , a public-domain collection. The TR-909 is rendered from{' '}
          <a
            className={styles.link}
            href="https://github.com/andremichelle/tr-909"
            rel="noreferrer noopener"
            target="_blank"
          >
            andremichelle/tr-909
          </a>
          , © 2022 André Michelle, MIT licensed. The Tone sounds are Roland Jupiter-4 samples from{' '}
          <a
            className={styles.link}
            href="https://github.com/publicsamples/Roland-Jupiter-4"
            rel="noreferrer noopener"
            target="_blank"
          >
            publicsamples/Roland-Jupiter-4
          </a>
          , released into the public domain. APL Beats is an independent project and is not affiliated with or
          endorsed by the manufacturers of the instruments named in it.
        </p>

        <a
          className={styles.link}
          href="https://github.com/dragnim/aplbeats"
          rel="noreferrer noopener"
          target="_blank"
        >
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
