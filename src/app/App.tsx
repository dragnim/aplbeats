import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTransform } from '@/apl/useTransform';
import { useDrumMachine } from '@/audio/useDrumMachine';
import { DrumMachineSelect } from '@/components/DrumMachineSelect';
import { GeneratorPanel } from '@/components/GeneratorPanel';
import { TransformPanel } from '@/components/TransformPanel';
import { Logo } from '@/components/Logo';
import { Sequencer } from '@/components/Sequencer';
import { TransportBar } from '@/components/TransportBar';
import { INITIAL_BPM, INITIAL_SWING } from '@/pattern/initialGroove';
import { createMixer, effectiveLevel, setVolume, toggleMute, trackIdFor, type Mixer } from '@/pattern/mixer';
import { TRACKS } from '@/pattern/tracks';
import { clampBpm, clampSwing } from '@/transport/timing';
import { useTransport } from '@/transport/useTransport';
import { loadMasterVolume, loadSession, saveMasterVolume, saveSession } from './persistence';
import { INITIAL_CREATIVE_STATE } from './openingState';
import { usePageVisibility } from './usePageVisibility';
import { useStudio } from './useStudio';
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

  const studio = useStudio(restored?.creative ?? INITIAL_CREATIVE_STATE);
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

  const isVisible = usePageVisibility();
  const { pattern, locks } = studio.state;

  /*
   * The transport's window onto the current state.
   *
   * Refs rather than the values themselves, because the scheduler asks what the pattern
   * is at the instant it hands a step to Web Audio — a hundred milliseconds before that
   * step sounds, and quite possibly between two React renders.
   */
  const patternRef = useRef(pattern);
  const mixerRef = useRef(mixer);

  useEffect(() => {
    patternRef.current = pattern;
    mixerRef.current = mixer;
  }, [pattern, mixer]);

  const getPattern = useCallback(() => patternRef.current, []);
  const getMixer = useCallback(() => mixerRef.current, []);

  const transport = useTransport({ getPattern, getMixer, bpm, swing, isVisible });

  /*
   * APL transforms.
   *
   * The only part of the application that touches the network, and it is reached from one
   * button. Nothing here runs on a timer, on playback, or as a control moves — see
   * `useTransform` for the rules and why they are all in one file.
   */
  const transform = useTransform({ pattern, onApply: studio.applyTransform });

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
    }, 500);
    return () => {
      clearTimeout(handle);
    };
  }, [studio.state, bpm, swing, mixer]);

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
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <Logo />
        </h1>
        <p className={styles.tagline}>
          Make beats first. <span className={styles.taglineSecond}>Discover array programming second.</span>
        </p>
      </header>

      <main className={styles.main}>
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

        <TransformPanel transform={transform} pattern={pattern} />

        <h2 className="visuallyHidden">Generator</h2>
        <GeneratorPanel
          preset={studio.state.preset}
          seed={studio.state.seed}
          macros={studio.state}
          canUndo={studio.canUndo}
          onRandomise={handleRandomise}
          onNewSeed={studio.newSeed}
          onUndo={studio.undo}
          onPresetChange={studio.setPreset}
          onMacroChange={studio.setMacro}
          onMacroCommit={studio.commitMacro}
        />

        {/*
          Spoken, not shown. The Play button's name changes, but a name changes silently for
          someone who is not on it — and while the tab was hidden the transport will have paused
          itself, which is a change nobody asked for.

          Named, because there are now two live regions on the page: this one and the APL panel's.
          Two are legitimate — playback and transformation are different concerns and either can
          change without the other — but an unnamed pair is two anonymous voices, and a reader
          arriving at one has no way to know which is speaking.
        */}
        <p className="visuallyHidden" role="status" aria-label="Playback">
          {transport.isPlaying ? 'Playing' : 'Paused'}
        </p>
      </main>

      <footer className={styles.footer}>
        <p className={styles.note}>
          Eight tracks, sixteen steps, and an <span className={styles.emphasis}>{TRACKS.length} × 16</span>{' '}
          Boolean matrix underneath. The generator and the timing are local; the transformations are executed
          by Dyalog APL, through TryAPL, one whole pattern at a time.
        </p>

        {/*
          The audio credits, in the interface rather than only in the repository.

          Two sources, and the sentence keeps them apart, because they are owed different
          things. "Selected" for the collection, because nine of its ten packs are included and
          one is not, so "samples from" on its own would overstate what is here. André Michelle
          is named rather than only his repository, because MIT asks for the copyright holder
          and a person who wrote a drum machine deserves better than a URL.

          "Rendered from" rather than "samples from" for the TR-909, since no recording of one
          is involved and saying otherwise in the one place most visitors will read would be
          the wrong thing to be loose about.

          `rel="noreferrer noopener"` on external links as everywhere else, and neither
          sentence implies that either author had anything to do with APL Beats.
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
          , © 2022 André Michelle, MIT licensed. APL Beats is an independent project and is not affiliated
          with or endorsed by the manufacturers of the drum machines named in it.
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
