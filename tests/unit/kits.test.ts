import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_DIRECTORY, DEFAULT_KIT_ID, kitById, KITS, resolveKitId, sampleUrl } from '@/audio/kits/kits';
import {
  bundledFiles,
  EXCLUDED_PACKS,
  KIT_PROVENANCE,
  provenanceFor,
  SAMPLE_FORMAT,
  UPSTREAM,
} from '@/audio/kits/provenance';
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
        expect(kit.voices[trackId].file, `${kit.id}/${trackId}`).toMatch(/\.m4a$/u);
      }
      expect(Object.keys(kit.voices)).toHaveLength(TRACK_IDS.length);
    }
  });

  it('has a gain on every voice, in a sensible range', () => {
    for (const kit of KITS.filter(isSampleKit)) {
      for (const trackId of TRACK_IDS) {
        const { gain } = kit.voices[trackId];
        expect(Number.isFinite(gain), `${kit.id}/${trackId}`).toBe(true);
        // Below 1 for most, because the lossy upstream files decode above full scale; never
        // absurd in either direction, which would be a calibration mistake rather than taste.
        expect(gain, `${kit.id}/${trackId}`).toBeGreaterThan(0.05);
        expect(gain, `${kit.id}/${trackId}`).toBeLessThan(3);
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

  it('covers every sampled kit in the manifest, and nothing that is not in it', () => {
    const manifest = KITS.filter(isSampleKit)
      .map((kit) => kit.id)
      .sort();
    const documented = KIT_PROVENANCE.map((entry) => entry.id).sort();
    expect(documented).toEqual(manifest);
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
      const documented = new Set(provenanceFor(kit.id)?.files.map((file) => file.file) ?? []);
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
    // A stray file under public/audio is either an unrecorded sample or a leftover, and both
    // are worth failing over: the provenance manifest is supposed to be complete.
    const recorded = new Set(Object.keys(checksums.files));
    for (const kit of KIT_PROVENANCE) {
      const directory = join(PUBLIC_AUDIO, kit.id);
      for (const name of readdirSync(directory)) {
        expect(recorded.has(`${kit.id}/${name}`), `unaccounted for: ${kit.id}/${name}`).toBe(true);
      }
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
     */
    for (const value of ['tr-909', '', 'SYNTH', null, undefined, 42, {}, []]) {
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
