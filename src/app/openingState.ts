/*
 * What APL Beats opens on.
 *
 * The pattern is the hand-written groove from Stage 1, and that is a decision rather than
 * an omission. It would be architecturally better for the opening bar to be something the
 * generator produced — one seed, one preset, three macro values — so that everything a
 * visitor touches afterwards speaks the same language as what they arrived on.
 *
 * A search over thirty thousand seeds and every preset found nothing good enough. The
 * closest match reproduced the curated hat and open-hat rows exactly and its kick almost
 * exactly, but with a third fewer triggers and thin percussion. The only bars that
 * reproduced the curated kick row — the downbeat and then three pushes off the beat, which
 * is the most characterful thing about the groove — came from Glitch, differed by nineteen
 * per cent of their cells and were measurably messier. A strong first Play matters more
 * than the elegance of a generated one.
 *
 * So the seed, preset and macros below are the *starting point for generating*, not a
 * recipe that produces the opening bar. That distinction is already unavoidable — a
 * visitor who edits three cells has a pattern their seed did not produce either — and it
 * is documented in the README rather than hidden.
 *
 * The macro values are chosen so that the first Randomise press lands somewhere related to
 * what was playing: Straight at a moderate density, a little under half complexity, light
 * syncopation, and Variation high enough that the first press is clearly a new take rather
 * than a nudge.
 */

import { createInitialGroove } from '@/pattern/initialGroove';
import { noLocks, type CreativeState } from './studio';

/** The seed the first generation starts from. */
export const INITIAL_SEED = 16_998;

export const INITIAL_CREATIVE_STATE: CreativeState = {
  pattern: createInitialGroove(),
  seed: INITIAL_SEED,
  preset: 'straight',
  density: 62,
  complexity: 45,
  syncopation: 30,
  /*
   * High, on purpose.
   *
   * The first press of Randomise has to be exciting or nobody presses it a second time,
   * and at a low Variation it would move two cells. Sixty-five is a clear remix — plainly
   * a new groove, plainly related to the settings that made it. Anyone who wants to evolve
   * a bar gently has the control right there to do it with.
   */
  variation: 65,
  locks: noLocks(),
};
