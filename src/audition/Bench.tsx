import { useCallback, useEffect, useMemo, useState } from 'react';
import { SYNTH_KIT } from '@/audio/kit';
import { DEFAULT_TONE_VOLUME } from '@/audio/tones/sounds';
import { createInitialGroove } from '@/pattern/initialGroove';
import { createMixer } from '@/pattern/mixer';
import { noteName, REST, type Phrase } from '@/tones/phrase';
import { Transport } from '@/transport/Transport';
import {
  loadManifest,
  samplerFor,
  VARIANT_LABELS,
  variantsOf,
  type AuditionManifest,
  type VariantId,
} from './candidates';
import { AUDITION_PHRASES, OPENING_PHRASE, type AuditionPhraseId } from './phrases';
import styles from './Bench.module.css';

/*
 * The Jupiter-4 audition bench.
 *
 * Temporary, local-only, and built to answer one question: which Lead and which Pad should APL
 * Beats ship? Stage 8 answered it by measurement and shipped a Lead that measured best and sounded
 * worst, so this exists to let the answer be given by ear instead.
 *
 * What it is careful about, in order of importance:
 *
 * **The context is the real one.** The opening drum groove, the opening Tone phrase, 112 BPM, 18%
 * swing, the real master chain, the real Tone bus, the real monophonic sampler. The question is
 * never "is this sample good" — it is "does this sound good as part of APL Beats".
 *
 * **Switching does not restart anything.** Next installs a different sampler between scheduler
 * ticks, exactly as the production Sound selector does. The bar keeps going, the drums keep going,
 * the phrase keeps going, and the only thing that changes is the instrument — which is what makes
 * A against B a fair comparison rather than two separate listens.
 *
 * **Nobody wins by being louder.** Every candidate is brought to the same working peak by the
 * gain the preparation script measured. That is preparation for listening, not a way of choosing.
 *
 * **The neighbours are preloaded.** Three megabytes decodes in a moment, but a moment of silence
 * between A and B is a moment in which the ear forgets what it was comparing. So the next and
 * previous candidates load in the background as soon as the current one is playing.
 */

const GROOVE = createInitialGroove();
const MIXER = createMixer();

/**
 * What the scheduler reads when it places a step.
 *
 * Module scope rather than a React ref, because that is what it honestly is: a value shared with a
 * system outside React, read from a timer a tenth of a second before a note sounds and quite
 * possibly between two renders. The application does the same thing with a ref inside its one hook
 * that knows about both; here there is one bench and one transport, so a holder is plainer.
 */
const live: { phrase: Phrase } = { phrase: OPENING_PHRASE };

type RoleFilter = 'all' | 'lead' | 'pad' | 'reference';

const ROLE_FILTERS: { readonly id: RoleFilter; readonly label: string }[] = [
  { id: 'lead', label: 'Leads' },
  { id: 'pad', label: 'Pads' },
  { id: 'reference', label: 'References' },
  { id: 'all', label: 'Everything' },
];

export function Bench(): React.JSX.Element {
  const [manifest, setManifest] = useState<AuditionManifest | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const [role, setRole] = useState<RoleFilter>('lead');
  const [at, setAt] = useState(0);
  const [variant, setVariant] = useState<VariantId>('trim');
  const [phraseId, setPhraseId] = useState<AuditionPhraseId>('opening');
  const [toneVolume, setToneVolume] = useState(DEFAULT_TONE_VOLUME);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('');
  /* Bumped whenever a candidate finishes decoding, so `isReady` is re-read during render. */
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    loadManifest().then(setManifest, (error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error));
    });
  }, []);

  const candidates = useMemo(() => {
    const all = manifest?.candidates ?? [];
    return role === 'all' ? [...all] : all.filter((candidate) => candidate.role === role);
  }, [manifest, role]);

  const candidate = candidates[Math.min(at, Math.max(0, candidates.length - 1))] ?? null;

  /*
   * The phrase, behind a ref.
   *
   * The transport reads it when it schedules a step, exactly as the application's does, so
   * changing phrase mid-bar takes effect on the next unscheduled step without restarting anything.
   */
  const phrase = AUDITION_PHRASES.find((entry) => entry.id === phraseId) ?? AUDITION_PHRASES[0]!;
  useEffect(() => {
    live.phrase = phrase.phrase;
  }, [phrase]);

  /*
   * One transport, built once, in a lazy initialiser.
   *
   * The same settings the application opens on — 112 BPM, 18% swing, the opening groove, the real
   * master chain — because the whole question is how a candidate sounds *there* rather than on its
   * own. It opens no audio device until Play is pressed.
   */
  const [transport] = useState(
    () =>
      new Transport({
        getPattern: () => GROOVE,
        getMixer: () => MIXER,
        getPhrase: () => live.phrase,
        bpm: 112,
        swing: 0.18,
      }),
  );

  useEffect(() => {
    transport.setKit(SYNTH_KIT);
    const unsubscribe = transport.subscribe((state) => {
      setPlaying(state === 'playing');
    });
    return () => {
      unsubscribe();
      void transport.dispose();
    };
  }, [transport]);

  useEffect(() => {
    transport.setToneVolume(toneVolume);
  }, [transport, toneVolume]);

  /* A candidate that has no such variant falls back to the one every candidate has. */
  const available = candidate === null ? [] : variantsOf(candidate);
  const chosen: VariantId = available.includes(variant) ? variant : (available[0] ?? 'trim');

  /*
   * Install the current candidate, without disturbing anything that is playing.
   *
   * `setToneSampler` is one assignment between scheduler ticks — the same call the production
   * Sound selector makes — so the bar, the drums and the phrase carry on untouched.
   *
   * Every state change here happens *after* an await, in a promise callback. That is not a style
   * preference: a synchronous `setState` inside an effect body cascades renders, and the linter is
   * right to refuse it. `loaded` is bumped so that `isReady` — which reads a module-level map
   * rather than React state — is re-read once a candidate has finished decoding.
   */
  useEffect(() => {
    if (candidate === null) return;
    // Named `current` rather than `live`, which is the module-level phrase holder above.
    let current = true;

    samplerFor(candidate, chosen).then(
      (sampler) => {
        if (!current) return;
        transport.setToneSampler(sampler);
        setLoaded((count) => count + 1);
        setStatus('');
      },
      (error: unknown) => {
        if (!current) return;
        setStatus(error instanceof Error ? error.message : String(error));
      },
    );

    return () => {
      // A candidate switched away from mid-load must not install over the one now selected.
      current = false;
    };
  }, [candidate, chosen, transport]);

  /*
   * The neighbours, quietly, once the current one is in.
   *
   * Only ever fetches and decodes — `samplerFor` remembers, and nothing is installed — so Next is
   * instant and the comparison stays in the ear rather than across a pause.
   */
  useEffect(() => {
    if (candidate === null || candidates.length < 2) return;

    const neighbours = [
      candidates[(at + 1) % candidates.length],
      candidates[(at - 1 + candidates.length) % candidates.length],
    ];
    for (const neighbour of neighbours) {
      if (neighbour === undefined) continue;
      const shape = variantsOf(neighbour).includes(chosen) ? chosen : (variantsOf(neighbour)[0] ?? 'trim');
      void samplerFor(neighbour, shape).catch(() => undefined);
    }
  }, [candidate, candidates, at, chosen, loaded]);

  const step = useCallback(
    (by: number) => {
      setAt((current) => {
        if (candidates.length === 0) return 0;
        return (current + by + candidates.length) % candidates.length;
      });
    },
    [candidates.length],
  );

  /* Left and Right move; Space plays. The whole point is that comparing is one key away. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && /^(INPUT|SELECT|TEXTAREA)$/u.test(target.tagName)) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === ' ') {
        event.preventDefault();
        if (transport.currentState === 'stopped') void transport.play();
        else transport.pause();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [step, transport]);

  if (failure !== null) {
    return (
      <main className={styles.bench}>
        <h1 className={styles.title}>Jupiter-4 audition</h1>
        <p className={styles.failure}>{failure}</p>
        <pre className={styles.code}>npm run prepare:audition</pre>
      </main>
    );
  }

  if (manifest === null || candidate === null) {
    return (
      <main className={styles.bench}>
        <h1 className={styles.title}>Jupiter-4 audition</h1>
        <p className={styles.note}>Reading the candidate manifest…</p>
      </main>
    );
  }

  const sample = candidate.variants[chosen]?.samples?.[0];
  const kb = (candidate.variants[chosen]?.bytes ?? 0) / 1024;

  return (
    <main className={styles.bench}>
      <header className={styles.head}>
        <h1 className={styles.title}>Jupiter-4 audition</h1>
        <p className={styles.note}>
          The opening groove, the real master chain, the real sampler. <kbd>←</kbd> <kbd>→</kbd> to move
          between candidates, <kbd>Space</kbd> to play. Switching never restarts the bar.
        </p>
      </header>

      <section className={styles.transport}>
        <button
          type="button"
          className={styles.play}
          onClick={() => {
            if (transport.currentState === 'stopped') void transport.play();
            else transport.pause();
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>

        <div className={styles.field}>
          <label htmlFor="phrase">Phrase</label>
          <select
            id="phrase"
            value={phraseId}
            onChange={(event) => {
              setPhraseId(event.currentTarget.value as AuditionPhraseId);
            }}
          >
            {AUDITION_PHRASES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="tone-volume">Tone volume</label>
          <input
            id="tone-volume"
            type="range"
            min={0}
            max={100}
            value={Math.round(toneVolume * 100)}
            onChange={(event) => {
              setToneVolume(Number(event.currentTarget.value) / 100);
            }}
          />
          <span className={styles.readout}>{Math.round(toneVolume * 100)}</span>
        </div>

        <p className={styles.phraseLine}>
          {phrase.phrase.map((value) => (value === REST ? '·' : noteName(value))).join(' ')}
        </p>
      </section>

      <section className={styles.chooser}>
        <div className={styles.roles} role="group" aria-label="Role">
          {ROLE_FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === role ? styles.roleOn : styles.role}
              onClick={() => {
                setRole(entry.id);
                setAt(0);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className={styles.pager}>
          <button
            type="button"
            className={styles.step}
            onClick={() => {
              step(-1);
            }}
          >
            ← Previous
          </button>

          <select
            className={styles.candidate}
            value={candidate.id}
            onChange={(event) => {
              const index = candidates.findIndex((entry) => entry.id === event.currentTarget.value);
              if (index >= 0) setAt(index);
            }}
          >
            {candidates.map((entry, index) => (
              <option key={entry.id} value={entry.id}>
                {index + 1}/{candidates.length} — {entry.preset}
                {entry.production === undefined ? '' : '  (shipping)'}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={styles.step}
            onClick={() => {
              step(1);
            }}
          >
            Next →
          </button>
        </div>

        {available.length > 1 && (
          <div className={styles.variants} role="group" aria-label="Variant">
            {available.map((entry) => (
              <button
                key={entry}
                type="button"
                className={entry === chosen ? styles.variantOn : styles.variant}
                onClick={() => {
                  setVariant(entry);
                }}
              >
                {VARIANT_LABELS[entry]}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.detail}>
        <h2 className={styles.preset}>
          {candidate.preset}
          {candidate.production === undefined ? null : (
            <span className={styles.badge}>shipping as {candidate.production}</span>
          )}
        </h2>
        <p className={styles.character}>{candidate.character}</p>
        <p className={styles.why}>{candidate.note}</p>

        <dl className={styles.facts}>
          <dt>Upstream</dt>
          <dd>
            {candidate.category} / {candidate.folder}
          </dd>
          <dt>Auditioning as</dt>
          <dd>{candidate.role}</dd>
          <dt>SFZ mapping</dt>
          <dd>{candidate.sfz ?? 'none in the repository'}</dd>
          <dt>Roots</dt>
          <dd>
            {candidate.roots.join(' ')} — at most {candidate.maxShiftSemitones} semitones of shift
          </dd>
          <dt>Variant</dt>
          <dd>
            {VARIANT_LABELS[chosen]}
            {sample === undefined ? '' : ` — ${sample.seconds.toFixed(2)} s per root`}
          </dd>
          <dt>Sustain</dt>
          <dd>
            {sample?.loop == null
              ? 'natural decay, no loop'
              : `upstream loop ${sample.loop.start.toFixed(2)}–${sample.loop.end.toFixed(2)} s (${String(sample.loopSource)}${sample.loopCorroboratedBySfz === true ? ', corroborated by SFZ' : ''})`}
          </dd>
          <dt>Prepared</dt>
          <dd>
            {kb.toFixed(0)} KB across {String(candidate.variants[chosen]?.samples?.length ?? 0)} roots
          </dd>
          <dt>Source peak</dt>
          <dd>
            {candidate.sourcePeak.toFixed(3)} — played at gain {candidate.gain.toFixed(3)} so nothing wins by
            being louder
          </dd>
          {candidate.shape === undefined ? null : (
            <>
              <dt>Attack</dt>
              <dd>
                {candidate.shape.attackMs.toFixed(0)} ms to reach full — and this phrase gives a note{' '}
                {String(phrase.longestHoldMs)} ms at most
                {candidate.shape.attackMs > phrase.longestHoldMs * 0.6
                  ? '. Most of what you hear is the attack.'
                  : ''}
              </dd>
              <dt>Holds</dt>
              <dd>
                {candidate.shape.at500ms.toFixed(2)} / {candidate.shape.at1s.toFixed(2)} /{' '}
                {candidate.shape.at2s.toFixed(2)} at ½s, 1s, 2s · {String(candidate.shape.brightnessHz)} Hz ·
                source {candidate.shape.sourceSeconds.toFixed(1)} s
              </dd>
            </>
          )}
        </dl>

        {/*
          The measured answer to the question the brief asked about pads.

          Shown here rather than left to be discovered, because a listener who clicks all three
          variants and hears nothing will reasonably conclude the bench is broken. It is not: a note
          is stopped by the *next note*, and neither audition phrase lets one hold for 1.2 s.
        */}
        {available.length > 1 && (
          <p className={styles.unavailable}>
            With this phrase a note holds {String(phrase.longestHoldMs)} ms at most, so the three variants are
            identical to five decimal places — the trim is never reached. It bites only on phrases sparser
            than these; upstream&rsquo;s loops sit at 4.7–9.1 s and no phrase this instrument can play ever
            reaches them. <code>npm run measure:audition</code> is the measurement.
          </p>
        )}

        {Object.entries(candidate.variants)
          .filter(([, entry]) => !entry.available)
          .map(([name, entry]) => (
            <p key={name} className={styles.unavailable}>
              <strong>{VARIANT_LABELS[name as VariantId]}:</strong> {entry.why}
            </p>
          ))}
      </section>

      <p className={styles.status} role="status">
        {status}
      </p>
    </main>
  );
}
