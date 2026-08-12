/*
 * Turning a column of the pattern into a list of sounds to make.
 *
 * Deliberately a pure function rather than a loop inside the audio engine. It is
 * the decision the sequencer makes sixteen times a bar — which voices fire, and
 * how loud — and it can be checked exhaustively by test, whereas anything holding
 * an `AudioContext` cannot.
 *
 * The engine's remaining job is then only to hand each of these to a voice at a
 * given moment on the audio clock.
 */

import { cellAt, type Pattern } from '@/pattern/pattern';
import { effectiveLevel, type Mixer } from '@/pattern/mixer';
import { TRACKS, type TrackId } from '@/pattern/tracks';

export interface StepTrigger {
  /** Which row fired, for anything that wants to answer back to the interface. */
  readonly track: number;
  /** Which voice to sound. */
  readonly trackId: TrackId;
  /** How loud, 0 exclusive to 1 inclusive. */
  readonly level: number;
}

/**
 * The sounds column `step` asks for, given the current mixer.
 *
 * Muted and fully-faded tracks are dropped here rather than passed on at zero
 * gain: a voice that would be inaudible should not build an audio graph at all.
 * That is what keeps a muted track genuinely free.
 */
export function triggersForStep(pattern: Pattern, mixer: Mixer, step: number): StepTrigger[] {
  const triggers: StepTrigger[] = [];

  for (let track = 0; track < TRACKS.length; track += 1) {
    if (!cellAt(pattern, track, step)) continue;

    const level = effectiveLevel(mixer, track);
    if (level <= 0) continue;

    const definition = TRACKS[track];
    if (definition === undefined) continue;

    triggers.push({ track, trackId: definition.id, level });
  }

  return triggers;
}
