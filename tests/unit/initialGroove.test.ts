import { describe, expect, it } from 'vitest';
import { createInitialGroove, INITIAL_BPM, INITIAL_SWING } from '@/pattern/initialGroove';
import { cellAt, countTriggers, STEP_COUNT, TRACK_COUNT } from '@/pattern/pattern';
import { MAX_BPM, MIN_BPM } from '@/transport/timing';

/*
 * The opening groove is written out by hand as a grid of ones and zeros, which makes
 * it readable and makes it mistypable. These are the assertions that keep it honest —
 * not about taste, which no test can hold an opinion on, but about the handful of
 * properties that make it a groove rather than a demonstration.
 */

const groove = createInitialGroove();

/** Which steps a track fires on, counted from one the way a musician would. */
function stepsFor(track: number): number[] {
  const steps: number[] = [];
  for (let step = 0; step < STEP_COUNT; step += 1) {
    if (cellAt(groove, track, step)) steps.push(step + 1);
  }
  return steps;
}

describe('shape', () => {
  it('is the standard eight by sixteen', () => {
    expect(groove).toHaveLength(TRACK_COUNT);
    for (const row of groove) expect(row).toHaveLength(STEP_COUNT);
  });

  it('is a fresh pattern every time, so editing it cannot spoil the default', () => {
    expect(createInitialGroove()).not.toBe(createInitialGroove());
    expect(createInitialGroove()).toEqual(groove);
  });
});

describe('tempo', () => {
  it('opens at a tempo you can nod to', () => {
    expect(INITIAL_BPM).toBe(112);
    expect(INITIAL_BPM).toBeGreaterThanOrEqual(MIN_BPM);
    expect(INITIAL_BPM).toBeLessThanOrEqual(MAX_BPM);
  });

  it('opens with a little shuffle rather than none and rather than lots', () => {
    expect(INITIAL_SWING).toBeGreaterThan(0);
    expect(INITIAL_SWING).toBeLessThan(0.35);
  });
});

describe('the groove', () => {
  it('has something on every track', () => {
    // Eight tracks and a silent one is a row that looks broken on a first visit.
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      expect(stepsFor(track).length).toBeGreaterThan(0);
    }
  });

  it('is dense enough to sound finished and sparse enough to read', () => {
    const triggers = countTriggers(groove);
    expect(triggers).toBe(32);
    // A quarter of the grid. Enough to be music; not so much that it is a wall.
    expect(triggers / (TRACK_COUNT * STEP_COUNT)).toBeLessThan(0.35);
  });

  it('is not four-on-the-floor', () => {
    /*
     * The one thing the brief was explicit about. A kick on all four beats is the
     * sound of a programming demonstration, so the kick lands on beat one and then
     * only off the beat: the "and" of two, three and four.
     */
    expect(stepsFor(0)).toEqual([1, 7, 11, 15]);

    const onBeats = [1, 5, 9, 13].filter((step) => cellAt(groove, 0, step - 1));
    expect(onBeats).toEqual([1]);
  });

  it('keeps a backbeat, so there is something to hang the syncopation on', () => {
    // Snare on two and four. Broken kicks over a straight backbeat is a groove;
    // broken everything is a mess.
    const snare = stepsFor(1);
    expect(snare).toContain(5);
    expect(snare).toContain(13);
  });

  it('widens the backbeat with a clap rather than duplicating a part', () => {
    expect(stepsFor(4)).toEqual([5, 13, 16]);
    for (const beat of [5, 13]) {
      expect(cellAt(groove, 1, beat - 1)).toBe(true);
      expect(cellAt(groove, 4, beat - 1)).toBe(true);
    }
  });

  it('answers the closed hat with the open hat on the offbeats it leaves', () => {
    /*
     * The hat figure, and the reason it does not sound typed in. Closed hats fill
     * every sixteenth except the four offbeat eighths; two of those get an open hat
     * and two are left silent — and the two left silent are exactly where the kick
     * pushes.
     */
    const closed = stepsFor(2);
    const open = stepsFor(3);
    const offbeatEighths = [3, 7, 11, 15];

    for (const step of offbeatEighths) expect(closed).not.toContain(step);
    expect(closed).toHaveLength(12);
    expect(open).toEqual([3, 11]);

    const silentOffbeats = offbeatEighths.filter((step) => !open.includes(step));
    expect(silentOffbeats).toEqual([7, 15]);
    for (const step of silentOffbeats) expect(cellAt(groove, 0, step - 1)).toBe(true);
  });

  it('never stacks the low tom on the kick', () => {
    // Two things in the same register at the same instant is mud, not weight.
    for (const step of stepsFor(5)) {
      expect(cellAt(groove, 0, step - 1)).toBe(false);
    }
  });

  it('puts something on the last sixteenth, so the bar leans into the next one', () => {
    const lastStep = Array.from({ length: TRACK_COUNT }, (_unused, track) =>
      cellAt(groove, track, STEP_COUNT - 1),
    );
    expect(lastStep.some(Boolean)).toBe(true);
  });

  it('starts on the downbeat', () => {
    // A groove whose first audible thing is halfway through the bar is a groove that
    // sounds broken the instant Play is pressed.
    expect(cellAt(groove, 0, 0)).toBe(true);
  });
});
