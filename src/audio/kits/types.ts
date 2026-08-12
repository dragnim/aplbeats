/*
 * What a drum machine is, as far as APL Beats is concerned.
 *
 * The important thing this file establishes is that a kit is a *rendering* choice and nothing
 * more. It names eight sounds, one per row, and that is the whole of its authority. It cannot
 * reach the pattern, the generator, the seed, the transport or the APL — so "change the drum
 * machine" can only ever mean "change the sound", which is the one rule Stage 4 exists to
 * keep.
 *
 * There are two kinds. The synthesised kit is code: eight functions that build a graph when
 * asked. A sampled kit is data: eight files, a gain for each, and a note saying where each
 * one came from. Both satisfy the same `Kit` signature by the time the engine sees them, and
 * the scheduler cannot tell which it is holding.
 */

import type { TrackId } from '@/pattern/tracks';

/** Stable identifier for a kit. Persisted, so it may not change once released. */
export type KitId = string;

/** The synthesised kit's identifier, and the fallback whenever anything goes wrong. */
export const SYNTH_KIT_ID = 'synth';

/**
 * Which voices cut each other off.
 *
 * Real drum machines are monophonic per instrument: hitting the bass drum again while it is
 * still ringing restarts it rather than layering a second one, and on almost every machine
 * with two hi-hats the open and closed hat share one circuit, so a closed hat *chokes* an
 * open one. Sampled voices have to be told to do that, because a `BufferSource` will happily
 * play forty overlapping copies.
 *
 * A group name rather than a boolean, so the hats can share one. Voices default to their own
 * row, which gives per-instrument monophony and nothing more.
 */
export type ChokeGroup = string;

/** The hi-hats, which share a group because the hardware shares a circuit. */
export const HAT_CHOKE_GROUP = 'hat';

export interface SampleVoiceDefinition {
  /**
   * The bundled file, relative to the kit's own directory.
   *
   * Named for the role it fills here, not for the file it came from upstream — the original
   * name is recorded in the provenance manifest, which is where that question belongs.
   */
  readonly file: string;
  /**
   * Playback gain, from level calibration.
   *
   * Chosen by measurement, not by ear: the sample is scaled so that at full level it peaks
   * where the synthesised voice for the same row peaks. That keeps the kits comparable to
   * each other and to the balance the project already had, without touching timbre, decay or
   * transient shape — so the character survives and only the loudness is normalised.
   *
   * Several of these are well below 1, because the upstream files are lossy encodes whose
   * decoded peaks run above full scale.
   */
  readonly gain: number;
  /**
   * Playback rate, where a role had to borrow another instrument.
   *
   * Only ever set on a documented substitution — a machine with no hand clap whose snare is
   * standing in, say. Shifting it is what stops the two rows sounding like one instrument
   * played twice. Never exposed as a control; it is part of how the kit was built.
   */
  readonly playbackRate?: number;
  /** Which voices this one cuts off. Defaults to the row's own id. */
  readonly chokeGroup?: ChokeGroup;
}

export type SampleVoices = Readonly<Record<TrackId, SampleVoiceDefinition>>;

export interface KitDefinition {
  readonly id: KitId;
  /** What the selector shows. The machine's name, in text, never a logo. */
  readonly name: string;
  /** One short line, for the selector's title attribute. */
  readonly blurb: string;
  readonly kind: 'synth' | 'sample';
  /**
   * Where the files live under the audio directory, and the eight of them.
   *
   * Absent for the synthesised kit, which has no files.
   */
  readonly directory?: string;
  readonly voices?: SampleVoices;
}

/** A kit that definitely has samples, once `kind` has been narrowed. */
export interface SampleKitDefinition extends KitDefinition {
  readonly kind: 'sample';
  readonly directory: string;
  readonly voices: SampleVoices;
}

export function isSampleKit(kit: KitDefinition): kit is SampleKitDefinition {
  return kit.kind === 'sample' && kit.directory !== undefined && kit.voices !== undefined;
}
