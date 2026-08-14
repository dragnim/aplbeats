import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_DIRECTORY, DEFAULT_KIT_ID, kitById, KITS, resolveKitId, sampleUrl } from '@/audio/kits/kits';
import {
  allAudioFiles,
  bundledFiles,
  EXCLUDED_PACKS,
  KIT_PROVENANCE,
  provenanceFor,
  RENDER_FORMAT,
  RENDERED_KIT_PROVENANCE,
  RENDERED_UPSTREAM,
  renderedFiles,
  renderedProvenanceFor,
  SAMPLE_FORMAT,
  UPSTREAM,
} from '@/audio/kits/provenance';
import { CALIBRATION_REFERENCE, HEADROOM } from '@/audio/kits/calibration';
import { isSampleKit, SYNTH_KIT_ID } from '@/audio/kits/types';
import { TRACK_IDS } from '@/pattern/tracks';

/*
 * The manifest, checked against the audio actually in the repository.
 *
 * This is the file that stops Stage 4's audio from becoming mystery audio. Every claim the
 * documentation makes — that each kit fills all eight rows, that every bundled sample has a
 * named upstream source, that the bytes are unaltered copies of a pinned commit — is checked
 * here against the filesystem rather than taken on trust. A kit added later without its
 * provenance written down fails these tests, which is the point.
 */

const PUBLIC_AUDIO = join(process.cwd(), 'public', AUDIO_DIRECTORY);
const CHECKSUMS = join(process.cwd(), 'src', 'audio', 'kits', 'checksums.json');

interface Checksums {
  readonly upstream: string;
  readonly commit: string;
  readonly files: Readonly<Record<string, { upstream: string; bytes: number; sha256: string }>>;
}

const checksums = JSON.parse(readFileSync(CHECKSUMS, 'utf8')) as Checksums;

const RENDER_MANIFEST = join(process.cwd(), 'src', 'audio', 'kits', 'tr909-render.json');

interface RenderManifest {
  readonly upstream: { commit: string; licence: string; copyright: string };
  readonly rendering: {
    sampleRate: number;
    format: string;
    lossless: boolean;
    lossyStep: string;
    renderedBy: string;
  };
  readonly voices: Readonly<
    Record<
      string,
      {
        file: string;
        instrument: string;
        dspClass: string;
        resources: readonly string[];
        peak: number;
        bytes: number;
        sha256: string;
      }
    >
  >;
  readonly upstreamFiles: Readonly<Record<string, { bytes: number; sha256: string }>>;
}

const renderManifest = JSON.parse(readFileSync(RENDER_MANIFEST, 'utf8')) as RenderManifest;

/**
 * Which kits are copied recordings, and which are rendered.
 *
 * Both are `isSampleKit` — the audio engine cannot tell them apart and should not be able to —
 * but their provenance obligations differ entirely, so most tests below need to know which
 * kind they are looking at. Derived from the provenance manifests rather than from a list
 * repeated here, so a kit added to one and not the other fails rather than being skipped.
 */
const COPIED_KIT_IDS = new Set(KIT_PROVENANCE.map((entry) => entry.id));
const RENDERED_KIT_IDS = new Set(RENDERED_KIT_PROVENANCE.map((entry) => entry.id));
const copiedKits = () => KITS.filter(isSampleKit).filter((kit) => COPIED_KIT_IDS.has(kit.id));
const renderedKits = () => KITS.filter(isSampleKit).filter((kit) => RENDERED_KIT_IDS.has(kit.id));

/* ------------------------------------------------------------------------- */

describe('the kit list', () => {
  it('opens on the synthesised kit, which needs no download', () => {
    expect(DEFAULT_KIT_ID).toBe(SYNTH_KIT_ID);
    expect(KITS[0]?.id).toBe(SYNTH_KIT_ID);
    expect(KITS[0]?.kind).toBe('synth');
  });

  it('keeps the synthesised kit available rather than replacing it', () => {
    // Stage 4 adds machines; it does not remove the one that works offline and always will.
    const synth = kitById(SYNTH_KIT_ID);
    expect(synth).toBeDefined();
    expect(synth?.kind).toBe('synth');
  });

  it('has no duplicate identifiers', () => {
    const ids = KITS.map((kit) => kit.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names every kit in words, with a one-line description', () => {
    for (const kit of KITS) {
      expect(kit.name.length, kit.id).toBeGreaterThan(1);
      expect(kit.blurb.length, kit.id).toBeGreaterThan(10);
    }
  });

  it('offers more than one sampled machine, which is the whole point of a selector', () => {
    expect(KITS.filter(isSampleKit).length).toBeGreaterThan(1);
  });
});

describe('every sampled kit', () => {
  it('maps all eight rows', () => {
    for (const kit of KITS.filter(isSampleKit)) {
      for (const trackId of TRACK_IDS) {
        expect(kit.voices[trackId], `${kit.id}/${trackId}`).toBeDefined();
      }
      expect(Object.keys(kit.voices)).toHaveLength(TRACK_IDS.length);
    }
  });

  it('uses the format its provenance says it does', () => {
    /*
     * Two formats, and which one a kit uses is not a detail: `.m4a` means "copied from a lossy
     * upstream that publishes nothing better", and `.wav` means "rendered here, losslessly
     * enough to be checked byte-for-byte". A kit with the wrong extension for its kind is a
     * kit whose provenance story has come apart from what actually shipped.
     */
    for (const kit of copiedKits()) {
      for (const trackId of TRACK_IDS) {
        expect(kit.voices[trackId].file, `${kit.id}/${trackId}`).toMatch(/\.m4a$/u);
      }
    }
    for (const kit of renderedKits()) {
      for (const trackId of TRACK_IDS) {
        expect(kit.voices[trackId].file, `${kit.id}/${trackId}`).toMatch(/\.wav$/u);
      }
    }
    expect(SAMPLE_FORMAT.extension).toBe('.m4a');
    expect(RENDER_FORMAT.extension).toBe('.wav');
  });

  it('has a gain on every voice, in a sensible range', () => {
    for (const kit of KITS.filter(isSampleKit)) {
      for (const trackId of TRACK_IDS) {
        const { gain } = kit.voices[trackId];
        expect(Number.isFinite(gain), `${kit.id}/${trackId}`).toBe(true);
        /*
         * The bounds are wide because the two kinds sit on opposite sides of unity, and for
         * reasons that are known rather than mysterious. The copied files are lossy encodes
         * that decode above full scale, so their gains cut. The rendered files come out of the
         * DSP well below full scale — the rim shot peaks at −17 dBFS — so theirs boost, the
         * largest by about four. What is being caught here is an absurd number in either
         * direction, which would be a calibration mistake rather than taste.
         */
        expect(gain, `${kit.id}/${trackId}`).toBeGreaterThan(0.05);
        expect(gain, `${kit.id}/${trackId}`).toBeLessThan(6);
      }
    }
  });

  it('cuts the copied files and boosts the rendered ones, as their formats imply', () => {
    // The specific claim the loose bounds above give up on, made narrowly where it is true.
    for (const kit of copiedKits()) {
      for (const trackId of TRACK_IDS) {
        expect(kit.voices[trackId].gain, `${kit.id}/${trackId}`).toBeLessThan(1.2);
      }
    }
    for (const kit of renderedKits()) {
      for (const trackId of TRACK_IDS) {
        expect(kit.voices[trackId].gain, `${kit.id}/${trackId}`).toBeGreaterThan(1);
      }
    }
  });

  it('only shifts playback rate where the provenance records a substitution', () => {
    /*
     * A rate shift is how a borrowed sound is stopped from being the same instrument twice —
     * the SK-1's snare standing in for its missing hand clap, say. If one appears without a
     * substitution note, the manifest has started making a claim the documentation does not.
     */
    for (const kit of KITS.filter(isSampleKit)) {
      const notes = provenanceFor(kit.id)?.substitutions ?? [];
      for (const trackId of TRACK_IDS) {
        const rate = kit.voices[trackId].playbackRate;
        if (rate === undefined) continue;
        expect(rate, `${kit.id}/${trackId}`).toBeGreaterThan(0.25);
        expect(rate, `${kit.id}/${trackId}`).toBeLessThan(4);
        expect(
          notes.length,
          `${kit.id}/${trackId} has a rate shift but no substitution note`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('puts the two hats in one choke group, as the hardware does', () => {
    for (const kit of KITS.filter(isSampleKit)) {
      expect(kit.voices.closedHat.chokeGroup, kit.id).toBeDefined();
      expect(kit.voices.openHat.chokeGroup, kit.id).toBe(kit.voices.closedHat.chokeGroup);
    }
  });

  it('does not let any other row into the hats’ choke group', () => {
    /*
     * The 808 Mini's rim is a hi-hat sample, which makes this tempting and wrong: sharing the
     * group would let the rim row cut off the hats, and those are independent musical parts.
     */
    for (const kit of KITS.filter(isSampleKit)) {
      const hatGroup = kit.voices.closedHat.chokeGroup;
      for (const trackId of TRACK_IDS) {
        if (trackId === 'closedHat' || trackId === 'openHat') continue;
        expect(kit.voices[trackId].chokeGroup, `${kit.id}/${trackId}`).not.toBe(hatGroup);
      }
    }
  });
});

/* ------------------------------------------------------------------------- */

describe('provenance', () => {
  it('pins an exact upstream commit rather than a branch', () => {
    expect(UPSTREAM.commit).toMatch(/^[0-9a-f]{40}$/u);
    expect(UPSTREAM.url).toBe('https://github.com/smpldsnds/drum-machines');
  });

  it('agrees with the checksum file about which commit was used', () => {
    expect(checksums.commit).toBe(UPSTREAM.commit);
  });

  it('records a source and a licence basis for every kit', () => {
    for (const entry of KIT_PROVENANCE) {
      expect(entry.upstreamPath.length, entry.id).toBeGreaterThan(0);
      expect(entry.provenanceNote.length, entry.id).toBeGreaterThan(40);
      expect(entry.licenceBasis.length, entry.id).toBeGreaterThan(20);
      expect(entry.machine.length, entry.id).toBeGreaterThan(2);
    }
  });

  it('covers every sampled kit in one manifest or the other, and nothing that is not shipped', () => {
    /*
     * Two manifests, and between them they must account for every kit that plays a file —
     * exactly once. A kit in both would be claiming to be a copy and a render at the same
     * time; a kit in neither is the mystery audio this file exists to prevent.
     */
    const shipped = KITS.filter(isSampleKit)
      .map((kit) => kit.id)
      .sort();
    const documented = [...COPIED_KIT_IDS, ...RENDERED_KIT_IDS].sort();
    expect(documented).toEqual(shipped);
    expect(documented.length, 'a kit is documented as both copied and rendered').toBe(
      new Set(documented).size,
    );
  });

  it('names the upstream file behind every bundled file', () => {
    for (const entry of KIT_PROVENANCE) {
      for (const file of entry.files) {
        expect(file.upstream.length, `${entry.id}/${file.file}`).toBeGreaterThan(0);
        expect(file.instrument.length, `${entry.id}/${file.file}`).toBeGreaterThan(2);
      }
    }
  });

  it('accounts for every file the manifest plays', () => {
    /*
     * The join between the two files. A voice pointing at a sample with no provenance entry is
     * exactly the mystery audio this stage is meant not to create.
     */
    for (const kit of KITS.filter(isSampleKit)) {
      const documented = new Set([
        ...(provenanceFor(kit.id)?.files.map((file) => file.file) ?? []),
        ...(renderedProvenanceFor(kit.id)?.voices.map((voice) => voice.file) ?? []),
      ]);
      for (const trackId of TRACK_IDS) {
        expect(documented.has(kit.voices[trackId].file), `${kit.id}/${trackId}`).toBe(true);
      }
    }
  });

  it('records what was excluded, and why', () => {
    expect(EXCLUDED_PACKS.length).toBeGreaterThan(0);
    for (const pack of EXCLUDED_PACKS) {
      expect(pack.reason.length, pack.upstreamPath).toBeGreaterThan(40);
      // Nothing excluded here was excluded for licensing, and the reason should say so plainly
      // rather than leaving the reader to assume the worst about somebody's work.
      expect(pack.reason.toLowerCase(), pack.upstreamPath).toContain('provenance');
    }
  });

  it('does not document a pack that is also shipped', () => {
    const shipped = new Set(KITS.map((kit) => kit.id));
    for (const pack of EXCLUDED_PACKS) {
      expect(shipped.has(pack.upstreamPath.toLowerCase())).toBe(false);
    }
  });

  it('states the format honestly, given upstream ships no WAV at all', () => {
    expect(SAMPLE_FORMAT.extension).toBe('.m4a');
    expect(SAMPLE_FORMAT.processing).toContain('none');
  });
});

/* ------------------------------------------------------------------------- */

describe('the rendered kit', () => {
  /*
   * A kit computed from somebody's source rather than copied from their recordings needs
   * different evidence, and this is it: the code it came from, pinned; the licence it came
   * under; what each voice was built by; and a checksum per file so that "deterministic" is a
   * claim anyone can check rather than one they have to take on faith.
   */

  it('pins an exact upstream commit rather than a branch', () => {
    expect(RENDERED_UPSTREAM.commit).toMatch(/^[0-9a-f]{40}$/u);
    expect(RENDERED_UPSTREAM.url).toBe('https://github.com/andremichelle/tr-909');
  });

  it('agrees with the render manifest about which commit was used', () => {
    expect(renderManifest.upstream.commit).toBe(RENDERED_UPSTREAM.commit);
  });

  it('records the licence and the copyright holder MIT requires be carried', () => {
    expect(RENDERED_UPSTREAM.licence).toBe('MIT');
    expect(RENDERED_UPSTREAM.copyright).toContain('André Michelle');
    expect(renderManifest.upstream.licence).toBe('MIT');
    expect(renderManifest.upstream.copyright).toBe(RENDERED_UPSTREAM.copyright);
  });

  it('records the one part of that project which is not used', () => {
    /*
     * Upstream's only third-party carve-out is the logo artwork credited to Isaac Cotec. It is
     * not used, and the manifest has to say so — an audit that finds a carve-out and then does
     * not write it down is indistinguishable from one that never looked.
     */
    expect(RENDERED_UPSTREAM.excludedFromUse).toMatch(/logo/iu);
    expect(RENDERED_UPSTREAM.acknowledgement.length).toBeGreaterThan(20);
  });

  it('fills all eight rows from real instruments, with no substitution', () => {
    for (const entry of RENDERED_KIT_PROVENANCE) {
      expect(entry.voices).toHaveLength(TRACK_IDS.length);
      expect(new Set(entry.voices.map((voice) => voice.file)).size).toBe(TRACK_IDS.length);
      expect(entry.mappingNote).toMatch(/no.*substitution|not.*substitution/iu);

      // Every row is a different instrument. Two rows sharing one would be a substitution.
      const instruments = entry.voices.map((voice) => voice.instrument);
      expect(new Set(instruments).size, entry.id).toBe(instruments.length);
    }
  });

  it('never shifts playback rate, because it never needs to', () => {
    // A rate shift is how a *borrowed* sound is disguised. This kit borrows nothing.
    for (const kit of renderedKits()) {
      for (const trackId of TRACK_IDS) {
        expect(kit.voices[trackId].playbackRate, `${kit.id}/${trackId}`).toBeUndefined();
      }
    }
  });

  it('names the DSP class and the wavetables behind every rendered file', () => {
    for (const entry of RENDERED_KIT_PROVENANCE) {
      for (const voice of entry.voices) {
        expect(voice.dspClass.length, voice.file).toBeGreaterThan(4);
        expect(voice.dspSource, voice.file).toMatch(/\.ts$/u);
        expect(voice.resources.length, voice.file).toBeGreaterThan(0);
        for (const resource of voice.resources) {
          expect(resource, voice.file).toMatch(/^resources\/.+\.raw$/u);
        }
      }
    }
  });

  it('agrees with the render manifest, voice for voice', () => {
    const documented = renderedProvenanceFor('tr-909');
    expect(documented).toBeDefined();
    for (const voice of documented?.voices ?? []) {
      const row = Object.entries(renderManifest.voices).find(([, entry]) => entry.file === voice.file);
      expect(row, voice.file).toBeDefined();
      const rendered = row?.[1];
      expect(rendered?.instrument, voice.file).toBe(voice.instrument);
      expect(rendered?.dspClass, voice.file).toBe(voice.dspClass);
      expect([...(rendered?.resources ?? [])].sort(), voice.file).toEqual([...voice.resources].sort());
    }
  });

  it('is honest that quantising to sixteen bits is not lossless', () => {
    /*
     * The DSP computes in float and the files are 16-bit PCM, so there is exactly one lossy
     * step. Claiming otherwise would be a small lie in the one document meant to be relied on.
     */
    expect(RENDER_FORMAT.lossless).toBe(false);
    expect(RENDER_FORMAT.lossyStep).toMatch(/16-bit/u);
    expect(renderManifest.rendering.lossless).toBe(false);
    expect(renderManifest.rendering.format).toMatch(/16-bit PCM WAV/u);
    expect(renderManifest.rendering.sampleRate).toBe(44_100);
  });

  it('says how the files can be produced again', () => {
    expect(renderManifest.rendering.renderedBy).toBe('scripts/render-tr909.mjs');
    expect(existsSync(join(process.cwd(), renderManifest.rendering.renderedBy))).toBe(true);
    for (const entry of RENDERED_KIT_PROVENANCE) {
      expect(entry.renderingNote, entry.id).toMatch(/determinis/iu);
      expect(entry.licenceBasis.length, entry.id).toBeGreaterThan(40);
    }
  });

  it('checksums the upstream files the render read, so a changed input is visible', () => {
    const upstreamFiles = Object.entries(renderManifest.upstreamFiles);
    expect(upstreamFiles.length).toBeGreaterThan(8);
    for (const [path, entry] of upstreamFiles) {
      expect(entry.sha256, path).toMatch(/^[0-9a-f]{64}$/u);
      expect(entry.bytes, path).toBeGreaterThan(0);
    }
    // Every wavetable a voice claims to read must be one of the files that were checksummed.
    const checked = new Set(Object.keys(renderManifest.upstreamFiles));
    for (const entry of RENDERED_KIT_PROVENANCE) {
      for (const voice of entry.voices) {
        for (const resource of voice.resources) {
          expect(checked.has(resource), `${voice.file} reads unchecksummed ${resource}`).toBe(true);
        }
      }
    }
  });

  it('ships exactly the bytes the manifest says it rendered', () => {
    /*
     * The determinism claim, checked against the filesystem. If someone re-renders on a machine
     * that produces different output, or edits a file by hand, this is what notices.
     */
    for (const [row, voice] of Object.entries(renderManifest.voices)) {
      const path = join(PUBLIC_AUDIO, 'tr-909', voice.file);
      expect(existsSync(path), `${row}: ${voice.file}`).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.length, voice.file).toBe(voice.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), voice.file).toBe(voice.sha256);
    }
  });

  it('is calibrated to the same targets as every other kit', () => {
    /*
     * The point of the whole exercise. A new kit that peaked somewhere else would make
     * "changing drum machine changes the sound, not the volume" false the moment it was
     * chosen, however good the samples were.
     */
    for (const kit of renderedKits()) {
      for (const trackId of TRACK_IDS) {
        const rendered = renderManifest.voices[trackId];
        expect(rendered, `${kit.id}/${trackId}`).toBeDefined();
        const played = (rendered?.peak ?? 0) * kit.voices[trackId].gain;
        const target = CALIBRATION_REFERENCE[trackId] * HEADROOM;
        // A twentieth of a decibel, which is the rounding in the gains themselves and nothing more.
        expect(20 * Math.log10(played / target), `${kit.id}/${trackId}`).toBeCloseTo(0, 1);
      }
    }
  });

  it('never renders anything loud enough to clip on its own', () => {
    for (const kit of renderedKits()) {
      for (const trackId of TRACK_IDS) {
        const peak = (renderManifest.voices[trackId]?.peak ?? 0) * kit.voices[trackId].gain;
        expect(peak, `${kit.id}/${trackId}`).toBeGreaterThan(0.01);
        expect(peak, `${kit.id}/${trackId}`).toBeLessThan(1);
      }
    }
  });
});

/* ------------------------------------------------------------------------- */

describe('the bundled audio', () => {
  it('exists for every file the manifest names', () => {
    for (const kit of KITS.filter(isSampleKit)) {
      for (const trackId of TRACK_IDS) {
        const path = join(PUBLIC_AUDIO, kit.directory, kit.voices[trackId].file);
        expect(existsSync(path), `missing: ${path}`).toBe(true);
        expect(statSync(path).size, path).toBeGreaterThan(500);
      }
    }
  });

  it('exists for every file the provenance names', () => {
    for (const entry of bundledFiles()) {
      const path = join(PUBLIC_AUDIO, entry.kitId, entry.file);
      expect(existsSync(path), `missing: ${path}`).toBe(true);
    }
  });

  it('matches the recorded checksums byte for byte', () => {
    /*
     * What makes "bundled unaltered, from this commit" a checkable claim rather than a sentence
     * in a README. If a sample is ever re-encoded, cropped or normalised on the way in, this
     * fails and the documentation has to be corrected.
     */
    for (const [key, expected] of Object.entries(checksums.files)) {
      const path = join(PUBLIC_AUDIO, key);
      expect(existsSync(path), `missing: ${path}`).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.length, key).toBe(expected.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), key).toBe(expected.sha256);
    }
  });

  it('ships the one upstream notice that exists, beside the audio it describes', () => {
    const withNotice = KIT_PROVENANCE.filter((entry) => entry.noticeFile !== undefined);
    expect(withNotice.length).toBeGreaterThan(0);

    for (const entry of withNotice) {
      const path = join(PUBLIC_AUDIO, entry.id, entry.noticeFile!);
      expect(existsSync(path), `missing notice: ${path}`).toBe(true);
      const text = readFileSync(path, 'utf8');
      // The notice must be the real one, not a summary of it.
      expect(text.length).toBeGreaterThan(2000);
      expect(text).toContain('Michael Fischer');
      expect(text).toContain('ABSOLUTELY FREE');
    }
  });

  it('carries nothing that is not accounted for', () => {
    /*
     * A stray file under public/audio is either unrecorded audio or a leftover, and both are
     * worth failing over: between them the two manifests are supposed to be complete.
     *
     * Every directory is walked, not just the ones a manifest names — otherwise a whole kit
     * could be dropped in and go unnoticed, which is exactly the failure this is for. Stage 5.2
     * added a directory and found this test would have said nothing about it.
     */
    const recorded = new Set([
      ...Object.keys(checksums.files),
      ...Object.values(renderManifest.voices).map((voice) => `tr-909/${voice.file}`),
    ]);
    for (const directory of readdirSync(PUBLIC_AUDIO)) {
      const path = join(PUBLIC_AUDIO, directory);
      if (!statSync(path).isDirectory()) continue;
      for (const name of readdirSync(path)) {
        expect(recorded.has(`${directory}/${name}`), `unaccounted for: ${directory}/${name}`).toBe(true);
      }
    }
  });

  it('serves a directory for every kit, and a kit for every directory', () => {
    const shipped = new Set(KITS.filter(isSampleKit).map((kit) => kit.directory));
    const onDisk = readdirSync(PUBLIC_AUDIO).filter((name) =>
      statSync(join(PUBLIC_AUDIO, name)).isDirectory(),
    );
    expect([...onDisk].sort()).toEqual([...shipped].sort());
  });

  it('is listed in full by the combined file helper', () => {
    // What `allAudioFiles` is for: the questions that do not care how a file got here.
    const listed = allAudioFiles();
    expect(listed.length).toBe(bundledFiles().length + renderedFiles().length);
    for (const entry of listed) {
      const path = join(PUBLIC_AUDIO, entry.kitId, entry.file);
      expect(existsSync(path), `missing: ${path}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------------- */

describe('the calibration reference', () => {
  /*
   * Stage 5.2 moved these numbers out of a rendering and into a file, because rendering them
   * turned out to depend on which Chromium was doing the rendering: six of the synthesised
   * voices read the noise buffer at a fractional sample offset, and where that read lands is
   * the implementation's business. `src/audio/kits/calibration.ts` tells the whole story.
   *
   * What is checked here is the property that made it worth pinning — that every shipped gain
   * still resolves to the same target — because if that ever stops being true, the reference has
   * been edited to fit rather than the kits recalibrated to match.
   */

  it('has a target for all eight rows, at a sane level', () => {
    for (const trackId of TRACK_IDS) {
      const target = CALIBRATION_REFERENCE[trackId];
      expect(Number.isFinite(target), trackId).toBe(true);
      // Between −12 dBFS and full scale: a voice outside that is not a calibration, it is a bug.
      expect(target, trackId).toBeGreaterThan(0.25);
      expect(target, trackId).toBeLessThan(1);
    }
    expect(Object.keys(CALIBRATION_REFERENCE)).toHaveLength(TRACK_IDS.length);
  });

  it('leaves six tenths of a decibel of headroom', () => {
    expect(20 * Math.log10(HEADROOM)).toBeCloseTo(-0.6, 1);
  });

  it('has not moved since it was recovered', () => {
    /*
     * A deliberate snapshot, and the only test here that is meant to be annoying.
     *
     * These eight numbers are what seventy-two shipped gains were derived from. Editing one is
     * not a tweak: it silently mis-calibrates every kit that was aimed at it, and it does so
     * without changing a single audible thing at the moment of the edit, which is the worst
     * kind of change to make quietly. Anyone with a real reason to move them — a decision to
     * re-aim the whole instrument — has to recalibrate every kit and update this line, and that
     * is the correct amount of friction.
     *
     * Recovered from the shipped gains at 44.1 kHz, nine kits agreeing to within 0.021 dB.
     */
    expect(CALIBRATION_REFERENCE).toEqual({
      kick: 0.866329,
      snare: 0.681983,
      closedHat: 0.5768,
      openHat: 0.486216,
      clap: 0.684778,
      lowPerc: 0.577448,
      highPerc: 0.545937,
      rim: 0.587579,
    });
    expect(HEADROOM).toBe(0.93);
  });

  it('is what every rendered gain was actually derived from', () => {
    /*
     * The copied kits cannot be checked here — their peaks are inside `.m4a` files and Node has
     * no decoder — so that half of the claim is checked by `npm run measure:kits`, in a browser,
     * where all nine currently read ±0.0 dB. The rendered kit's peaks are in its manifest, so
     * this half can be checked properly, and is.
     */
    const kit = renderedKits()[0];
    expect(kit, 'no rendered kit to check').toBeDefined();
    for (const trackId of TRACK_IDS) {
      const peak = renderManifest.voices[trackId]?.peak ?? 0;
      const gain = kit?.voices[trackId].gain ?? 0;
      expect(peak * gain, trackId).toBeCloseTo(CALIBRATION_REFERENCE[trackId] * HEADROOM, 3);
    }
  });
});

/* ------------------------------------------------------------------------- */

describe('resolving a stored kit identifier', () => {
  it('accepts every kit that exists', () => {
    for (const kit of KITS) expect(resolveKitId(kit.id)).toBe(kit.id);
  });

  it('falls back to the synthesised kit for anything it does not recognise', () => {
    /*
     * The whole reason this function exists. A kit withdrawn in a later release must not turn a
     * returning visitor's stored session into a startup failure or a silent instrument.
     *
     * The stand-in used to be `tr-909`, which stopped being an unknown kit the moment Stage 5.2
     * added one. An identifier that is obviously not a drum machine cannot be overtaken that way.
     */
    for (const value of ['kit-that-was-withdrawn', '', 'SYNTH', null, undefined, 42, {}, []]) {
      expect(resolveKitId(value)).toBe(SYNTH_KIT_ID);
    }
  });
});

describe('where a sample is fetched from', () => {
  it('honours the published base path', () => {
    expect(sampleUrl('tr-808', 'kick.m4a', '/aplbeats/')).toBe('/aplbeats/audio/tr-808/kick.m4a');
  });

  it('copes with a base path that has no trailing slash', () => {
    expect(sampleUrl('lm-2', 'snare.m4a', '/aplbeats')).toBe('/aplbeats/audio/lm-2/snare.m4a');
  });

  it('builds a root-relative URL rather than an absolute one', () => {
    // No host is ever named. The samples are served from wherever the application is, which is
    // what makes the upstream repository a source rather than a runtime dependency.
    expect(sampleUrl('rz-1', 'clap.m4a', '/')).not.toMatch(/^https?:/u);
  });
});
