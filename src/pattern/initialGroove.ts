import { fromBits, STEP_COUNT, TRACK_COUNT, type Pattern } from './pattern';
import { TRACKS } from './tracks';

/*
 * The groove APL Beats opens on.
 *
 * A visitor arrives, presses Play, and has about two seconds to decide whether
 * this is a toy or an instrument. So this is not a demonstration pattern. It is
 * a groove, written to be worth listening to on its own and worth pulling apart
 * afterwards.
 *
 * Counted as sixteenth notes across one bar of four-four, where beat 1 is step 1,
 * beat 2 is step 5, beat 3 is step 9 and beat 4 is step 13:
 *
 *   Kick        1, 2&, 3&, 4&      the downbeat, then three pushes off the beat.
 *                                  Deliberately not four-on-the-floor: the only
 *                                  kick that lands on a beat is the first one,
 *                                  and the one at 4& leans into the next bar.
 *   Snare       2, 3e, 4           the backbeat, with one ghost note early in
 *                                  beat 3 that the swing control drags late.
 *   Closed Hat  fills, minus 8ths  every sixteenth except the offbeat eighths,
 *                                  which is where the open hat answers.
 *   Open Hat    1&, 3&             the lift. Two of them, not eight.
 *   Clap        2, 4, 4a           doubling the snare so the backbeat has width,
 *                                  plus a pickup on the last sixteenth.
 *   Low Perc    1a, 2e, 4e         low tom in the holes the kick leaves. Never
 *                                  on a kick step: two things in the same
 *                                  register at once is mud, not weight.
 *   High Perc   1e, 3, 4a          brighter answers, above the snare.
 *   Rim         2a, 3a             two dry accents, one per half-bar.
 *
 * Thirty-two triggers. Dense enough to sound finished, and the hat row's four
 * gaps fall exactly where the kick pushes, so the grid on screen reads as a
 * rhythm rather than as a wall.
 */

/*
 * Written out as a grid because that is what it is, and because a row of ones and
 * zeros can be read, checked and edited the way a drum machine's own display is.
 * `fromBits` turns it into the Boolean matrix the application actually holds.
 */
// prettier-ignore
const GROOVE_BITS: readonly number[][] = [
  //         1  .  .  .  2  .  .  .  3  .  .  .  4  .  .  .
  /* Kick */ [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  /* Snar */ [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
  /* CHat */ [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1],
  /* OHat */ [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  /* Clap */ [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  /* LowP */ [0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
  /* HighP*/ [0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1],
  /* Rim  */ [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
];

/** The tempo the groove was written at. */
export const INITIAL_BPM = 112;

/**
 * A little shuffle, not a lot.
 *
 * The groove works straight, but a touch of swing is what stops the sixteenth-note
 * hats sounding typed in. Low enough that the playhead still moves evenly to the
 * eye, high enough to hear.
 */
export const INITIAL_SWING = 0.18;

/** The pattern APL Beats starts with. */
export function createInitialGroove(): Pattern {
  return fromBits(GROOVE_BITS);
}

/*
 * A grid written by hand is a grid that can be mistyped, and a row one step short
 * would go unnoticed because `fromBits` pads it. This runs at import time in every
 * environment, so a typo fails the test run, the build and the browser alike
 * rather than quietly shortening the bar.
 */
if (GROOVE_BITS.length !== TRACK_COUNT) {
  throw new Error(`The opening groove needs ${String(TRACK_COUNT)} rows, one per track.`);
}
GROOVE_BITS.forEach((row, index) => {
  if (row.length !== STEP_COUNT) {
    const name = TRACKS[index]?.name ?? `row ${String(index)}`;
    throw new Error(`The opening groove's ${name} row has ${String(row.length)} steps, not 16.`);
  }
});
