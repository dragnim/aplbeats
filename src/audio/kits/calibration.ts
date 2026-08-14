/*
 * The yardstick every sampled kit is measured against.
 *
 * Stage 4 set one rule: a sampled voice, at full level, should peak where the synthesised
 * voice for the same row peaks. That makes changing the drum machine a change of sound rather
 * than a change of volume. The rule needs a number per row to aim at, and until Stage 5.2 that
 * number was taken by rendering the synthesised kit fresh on every measurement run.
 *
 * That turned out to be the wrong place to keep it.
 *
 * Six of the eight synthesised voices read a slice of the shared noise buffer, and
 * `nextNoiseOffset` asks for a position 64628.55 samples in — a *fraction* of a sample. How a
 * buffer source resolves a sub-sample start offset is left to the implementation, so a
 * Chromium update is free to land the read a sample or two further along. It did. Measured on
 * the engine Stage 4 used and on the one shipping now, the same unchanged code renders the
 * same unchanged voices up to 1.8 dB apart:
 *
 *     row          Stage 4    today    moved
 *     kick          -1.246   -1.245    +0.00
 *     snare         -3.325   -1.827    +1.50
 *     closedHat     -4.779   -6.552    -1.77
 *     openHat       -6.263   -5.174    +1.09
 *     clap          -3.289   -3.873    -0.58
 *     lowPerc       -4.770   -4.783    -0.01
 *     highPerc      -5.257   -4.483    +0.77
 *     rim           -4.619   -4.922    -0.30
 *
 * Kick and lowPerc, the two voices whose peak is set by an oscillator rather than by noise, did
 * not move at all. Shifting the noise slice by a single sample reproduces the rest exactly:
 * ±2.3 dB on the open hat, ±1.1 on the closed, ±0.02 on the kick. `scripts/diagnose-reference.mjs`
 * shows the working.
 *
 * Nothing shipped changed. The sampled kits are fixed files times fixed gains and render
 * bit-identically today to the day they were calibrated; only the yardstick moved, and it took
 * nine innocent kits with it, all reported as mis-calibrated by exactly the same amount on
 * exactly the same four rows. Nine identical deviations across nine unrelated sample packs is
 * not nine faults.
 *
 * So the reference lives here, as data, and stops being re-derived from a rendering whose
 * result an engine update is entitled to change. The numbers are not new: they were read back
 * out of the shipped gains, each of which was set to `filePeak * gain = reference * HEADROOM`.
 * Nine kits give nine independent readings of each row and they agree to within 0.021 dB, so
 * what is written below is what Stage 4 actually calibrated against, recovered rather than
 * chosen.
 *
 * Two consequences worth being explicit about.
 *
 * Every kit added after this — TR-909 first — aims at these numbers. That is what keeps a new
 * kit in step with the nine already shipped, which matters more than agreeing with whatever
 * the synthesised kit happens to peak at on the measuring machine this month.
 *
 * And the synthesised kit is no longer the reference, only compared against it.
 * `measure-kits.mjs` reports its drift as its own line, because it is a real fact about the
 * synthesised kit on the current engine and it should be visible — just not as an accusation
 * against the sampled ones.
 *
 * The root cause is still there: `nextNoiseOffset` returns a fractional sample position, and
 * quantising it to a whole sample would make the synthesised kit reproducible across engines
 * for good. It would also move the synthesised kit's own sound a third time, which is a
 * deliberate change to shipped audio and belongs in a stage that says so, not in a footnote to
 * a kit addition.
 */

import type { TrackId } from '@/pattern/tracks';

/**
 * The peak each row's voice is calibrated to, linear, at 44.1 kHz and full level.
 *
 * Recovered from the shipped Stage 4 gains, not re-measured. See above for why.
 */
export const CALIBRATION_REFERENCE: Readonly<Record<TrackId, number>> = {
  kick: 0.866329, // -1.246 dBFS, from 9 kits, agreeing to 0.008 dB
  snare: 0.681983, // -3.325 dBFS, from 9 kits, agreeing to 0.011 dB
  closedHat: 0.5768, // -4.779 dBFS, from 9 kits, agreeing to 0.007 dB
  openHat: 0.486216, // -6.263 dBFS, from 9 kits, agreeing to 0.017 dB
  clap: 0.684778, // -3.289 dBFS, from 8 kits, agreeing to 0.011 dB
  lowPerc: 0.577448, // -4.770 dBFS, from 9 kits, agreeing to 0.011 dB
  highPerc: 0.545937, // -5.257 dBFS, from 8 kits, agreeing to 0.021 dB
  rim: 0.587579, // -4.619 dBFS, from 8 kits, agreeing to 0.006 dB
};

/**
 * How far below the reference a sampled voice is actually aimed.
 *
 * Matching the reference exactly is the obvious rule and it very nearly worked: every kit
 * landed within a decibel, but two of them put a single sample at full scale in the
 * pathological case of all eight rows firing at once with every fader at the top. The
 * synthesised kit itself measures −0.2 dBFS there, so there was never any headroom in that
 * case to give away.
 *
 * Six tenths of a decibel below, then. Inaudible as a level change — well inside the ±1.5 dB
 * the calibration is checked against — and it is the difference between "no clipped samples"
 * and "one clipped sample", which is worth having as a fact rather than as a nearly.
 */
export const HEADROOM = 0.93;

/** The gain a file needs so that, at full level, it peaks where its row is calibrated to. */
export function calibrationGain(trackId: TrackId, filePeak: number): number {
  if (filePeak <= 0) return 0;
  return (CALIBRATION_REFERENCE[trackId] * HEADROOM) / filePeak;
}
