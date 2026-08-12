import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOOKAHEAD_SECONDS,
  Scheduler,
  START_OFFSET_SECONDS,
  TICK_MS,
  type CancelTimer,
} from '@/transport/Scheduler';
import { secondsPerBar, secondsPerStep } from '@/transport/timing';

/*
 * The scheduler, on a clock that does what it is told.
 *
 * Every dependency is injected, so none of this waits: a virtual clock advances in
 * whatever increments the assertions need, and the whole suite runs in
 * milliseconds. That is why the timing is testable at all — a scheduler that read
 * `performance.now` directly could only be checked by waiting for it, and a test
 * that waits for a beat is a test that is flaky on a busy machine.
 */

interface ScheduledStep {
  step: number;
  /** When it should sound. */
  time: number;
  /** When it was handed over. The difference between the two is the lead time. */
  handedOverAt: number;
}

interface Harness {
  readonly scheduler: Scheduler;
  readonly scheduled: ScheduledStep[];
  readonly pendingTimers: () => number;
  now: () => number;
  advanceTo: (seconds: number) => void;
  setTempo: (tempo: { bpm?: number; swing?: number }) => void;
}

function harness(initial: { bpm?: number; swing?: number } = {}): Harness {
  let now = 0;
  let bpm = initial.bpm ?? 120;
  let swing = initial.swing ?? 0;

  const scheduled: ScheduledStep[] = [];
  const timers: { callback: () => void; at: number }[] = [];

  const scheduler = new Scheduler({
    clock: () => now,
    getTempo: () => ({ bpm, swing }),
    onStep: (step, time) => {
      scheduled.push({ step, time, handedOverAt: now });
    },
    setTimer: (callback, ms): CancelTimer => {
      const entry = { callback, at: now + ms / 1000 };
      timers.push(entry);
      return () => {
        const index = timers.indexOf(entry);
        if (index >= 0) timers.splice(index, 1);
      };
    },
  });

  return {
    scheduler,
    scheduled,
    pendingTimers: () => timers.length,
    now: () => now,
    advanceTo(seconds) {
      for (;;) {
        const next = timers[0];
        if (next === undefined || next.at > seconds) break;
        timers.shift();
        now = next.at;
        next.callback();
      }
      now = seconds;
    },
    setTempo(tempo) {
      if (tempo.bpm !== undefined) bpm = tempo.bpm;
      if (tempo.swing !== undefined) swing = tempo.swing;
    },
  };
}

let rig: Harness;
beforeEach(() => {
  rig = harness();
});

describe('while stopped', () => {
  it('does nothing at all', () => {
    // Not merely "makes no sound": no timer either. A stopped drum machine that keeps
    // a callback running forty times a second is a stopped drum machine draining a
    // battery.
    expect(rig.scheduler.isRunning).toBe(false);
    expect(rig.pendingTimers()).toBe(0);
    rig.advanceTo(5);
    expect(rig.scheduled).toHaveLength(0);
    expect(rig.pendingTimers()).toBe(0);
  });

  it('leaves no timer behind after being paused', () => {
    rig.scheduler.start();
    expect(rig.pendingTimers()).toBe(1);
    rig.scheduler.pause();
    expect(rig.pendingTimers()).toBe(0);
  });
});

describe('starting', () => {
  it('schedules the first step a little way ahead of the clock', () => {
    /*
     * Never at the current time. That instant is already inside the buffer the audio
     * thread is filling, so a note placed there is clipped or dropped outright.
     */
    rig.scheduler.start();
    expect(rig.scheduled[0]).toMatchObject({ step: 0, time: START_OFFSET_SECONDS });
    expect(rig.scheduled[0]?.time).toBeGreaterThan(rig.now());
  });

  it('only reaches as far as the look-ahead window', () => {
    rig.scheduler.start();
    for (const event of rig.scheduled) {
      expect(event.time).toBeLessThan(LOOKAHEAD_SECONDS + secondsPerStep(120));
    }
  });

  it('ignores a second start', () => {
    rig.scheduler.start();
    const first = rig.scheduled.length;
    rig.scheduler.start();
    expect(rig.scheduled).toHaveLength(first);
    expect(rig.pendingTimers()).toBe(1);
  });
});

describe('running', () => {
  it('hands over every step in order, once each', () => {
    rig.scheduler.start();
    rig.advanceTo(4); // two bars at 120 BPM

    expect(rig.scheduled.length).toBeGreaterThan(30);
    rig.scheduled.forEach((event, index) => {
      expect(event.step).toBe(index % 16);
    });
  });

  it('places every step exactly on the grid', () => {
    rig.scheduler.start();
    rig.advanceTo(4);

    const step = secondsPerStep(120);
    rig.scheduled.forEach((event, index) => {
      expect(event.time).toBeCloseTo(START_OFFSET_SECONDS + index * step, 9);
    });
  });

  it('hands every step over well before it is due, and never long before', () => {
    /*
     * The whole point of the look-ahead, stated as the property that matters: how
     * much warning Web Audio gets.
     *
     * A step is handed over at the first wake-up that can see it, so its lead time is
     * somewhere between one window minus one tick and one window. The lower bound is
     * the stall the beat can absorb; the upper bound is how long an edit can take to
     * be heard. Both being bounded is what makes the timing reliable *and* the
     * instrument responsive — and neither is visible in "is the last note in the
     * future", which is not even true at the instant a step lines up with the horizon.
     *
     * The first step is its own case and is checked separately below: pressing Play
     * deliberately gives it only `START_OFFSET_SECONDS`, because the alternative is
     * a button that takes a tenth of a second to do anything.
     */
    rig.scheduler.start();
    rig.advanceTo(6);

    expect(rig.scheduled.length).toBeGreaterThan(40);
    for (const event of rig.scheduled.slice(1)) {
      const lead = event.time - event.handedOverAt;
      expect(lead).toBeGreaterThan(LOOKAHEAD_SECONDS - TICK_MS / 1000 - 1e-9);
      expect(lead).toBeLessThanOrEqual(LOOKAHEAD_SECONDS + 1e-9);
    }
  });

  it('gives the very first step enough warning to survive being the first', () => {
    // Not a full window — that would be a Play button with a visible delay — but
    // comfortably more than the few milliseconds at which an attack starts to clip.
    rig.scheduler.start();
    const first = rig.scheduled[0];
    expect((first?.time ?? 0) - (first?.handedOverAt ?? 0)).toBe(START_OFFSET_SECONDS);
    expect(START_OFFSET_SECONDS).toBeGreaterThanOrEqual(0.02);
    expect(START_OFFSET_SECONDS).toBeLessThan(0.1);
  });

  it('never hands a step over after it was due', () => {
    // A note scheduled in the past is played immediately by Web Audio, which is how a
    // scheduler that has fallen behind sounds: rushed, then late.
    rig.scheduler.start();
    rig.advanceTo(6);
    for (const event of rig.scheduled) {
      expect(event.time).toBeGreaterThan(event.handedOverAt);
    }
  });

  it('survives the main thread stalling for longer than the window', () => {
    // Nothing is skipped and nothing is lost; the tick that eventually arrives simply
    // has more to do. What was already handed over sounds on time regardless.
    rig.scheduler.start();
    rig.advanceTo(0.05);
    const beforeStall = rig.scheduled.length;

    rig.advanceTo(1.5); // one tick's worth of wall clock, forty ticks' worth of time
    expect(rig.scheduled.length).toBeGreaterThan(beforeStall);
    rig.scheduled.forEach((event, index) => {
      expect(event.step).toBe(index % 16);
    });
  });

  it('wakes far more often than the window is long', () => {
    // Four chances to notice the window rather than one, so a late wake-up still
    // finds the window ahead of it rather than behind.
    expect(TICK_MS / 1000).toBeLessThan(LOOKAHEAD_SECONDS / 2);
  });
});

describe('swing while running', () => {
  it('pushes the odd steps late without lengthening the bar', () => {
    const swung = harness({ bpm: 120, swing: 1 });
    swung.scheduler.start();
    swung.advanceTo(6);

    const step = secondsPerStep(120);
    swung.scheduled.forEach((event, index) => {
      const grid = START_OFFSET_SECONDS + index * step;
      const expected = index % 2 === 1 ? grid + step / 2 : grid;
      expect(event.time).toBeCloseTo(expected, 9);
    });

    // And the bar is still a bar: the first step of bar three lands exactly two bars
    // after the first step of bar one, with no accumulated drift.
    const barOne = swung.scheduled[0];
    const barThree = swung.scheduled[32];
    expect(barOne).toBeDefined();
    expect(barThree).toBeDefined();
    expect((barThree?.time ?? 0) - (barOne?.time ?? 0)).toBeCloseTo(secondsPerBar(120) * 2, 9);
  });

  it('takes a change of swing from the next step', () => {
    rig.scheduler.start();
    rig.advanceTo(1);
    const beforeChange = rig.scheduled.length;

    rig.setTempo({ swing: 1 });
    rig.advanceTo(2);

    const after = rig.scheduled.slice(beforeChange);
    expect(after.length).toBeGreaterThan(0);
    // Some of the steps scheduled after the change are now off the straight grid.
    const step = secondsPerStep(120);
    const offGrid = after.filter((event) => Math.abs((event.time / step) % 1) > 1e-6);
    expect(offGrid.length).toBeGreaterThan(0);
  });
});

describe('tempo while running', () => {
  it('takes effect from the next step and does not re-time what is in flight', () => {
    rig.scheduler.start();
    rig.advanceTo(1);

    const alreadyScheduled = [...rig.scheduled];
    rig.setTempo({ bpm: 60 });
    rig.advanceTo(3);

    // Nothing already handed over was rewritten.
    alreadyScheduled.forEach((event, index) => {
      expect(rig.scheduled[index]).toEqual(event);
    });

    // And the steps after the change are spaced for the new tempo.
    const tail = rig.scheduled.slice(alreadyScheduled.length + 1);
    for (let index = 1; index < tail.length; index += 1) {
      const gap = (tail[index]?.time ?? 0) - (tail[index - 1]?.time ?? 0);
      expect(gap).toBeCloseTo(secondsPerStep(60), 6);
    }
  });
});

describe('the playhead', () => {
  it('reports the last step the audio clock has passed', () => {
    rig.scheduler.start();
    expect(rig.scheduler.playheadStep()).toBe(0);

    // Nothing has sounded yet: the first step is scheduled ahead of the clock.
    rig.advanceTo(START_OFFSET_SECONDS - 0.001);
    expect(rig.scheduler.playheadStep()).toBe(0);

    rig.advanceTo(START_OFFSET_SECONDS + secondsPerStep(120) * 3 + 0.001);
    expect(rig.scheduler.playheadStep()).toBe(3);

    rig.advanceTo(START_OFFSET_SECONDS + secondsPerStep(120) * 17 + 0.001);
    expect(rig.scheduler.playheadStep()).toBe(1);
  });

  it('gives the same answer twice in one step', () => {
    // Which is what lets the interface re-render only when this changes, rather than
    // once per animation frame.
    rig.scheduler.start();
    rig.advanceTo(0.5);
    expect(rig.scheduler.playheadStep()).toBe(rig.scheduler.playheadStep());
  });

  it('is read from the clock, so a frame drawn late shows where the music is', () => {
    /*
     * The property that keeps animation out of the timing. Ask at 0.5 seconds and
     * again at 2.5 having asked nothing in between, and the answer is where the
     * music got to — not the next step along from wherever the last frame was.
     */
    rig.scheduler.start();
    rig.advanceTo(2.5);
    const expected = Math.floor((2.5 - START_OFFSET_SECONDS) / secondsPerStep(120)) % 16;
    expect(rig.scheduler.playheadStep()).toBe(expected);
  });

  it('stops moving when the transport does', () => {
    rig.scheduler.start();
    rig.advanceTo(0.5);
    const resting = rig.scheduler.playheadStep();

    rig.scheduler.pause();
    rig.advanceTo(3);
    expect(rig.scheduler.playheadStep()).toBe(resting);
  });
});

describe('pausing and resuming', () => {
  it('carries on from the step the bar had reached', () => {
    rig.scheduler.start();
    rig.advanceTo(0.5);
    rig.scheduler.pause();

    const resumeFrom = rig.scheduler.position;
    rig.scheduled.length = 0;
    rig.scheduler.start();

    expect(rig.scheduled[0]?.step).toBe(resumeFrom);
  });

  it('does not swallow the steps it had run ahead on', () => {
    /*
     * The bug this guards against is quiet and specific.
     *
     * At any moment the scheduler is a step or two ahead of the ear. Pausing without
     * giving those back would resume from where the *scheduler* had got to, silently
     * eating the sixteenths in between — which is only ever noticed later, as "it
     * doesn't quite loop right".
     */
    rig.scheduler.start();
    rig.advanceTo(0.5);
    const heard = rig.scheduler.playheadStep();
    rig.scheduler.pause();

    rig.scheduled.length = 0;
    rig.scheduler.start();
    expect(rig.scheduled[0]?.step).toBe((heard + 1) % 16);
  });

  it('resumes without skipping, over many pauses', () => {
    // Pausing and resuming repeatedly must still produce every step in order. A
    // rewind that were off by one would show up here as a step repeated or dropped.
    const seen: number[] = [];
    rig.scheduler.start();

    for (let pause = 0; pause < 6; pause += 1) {
      rig.advanceTo(rig.now() + 0.37);
      const heardSoFar = rig.scheduler.playheadStep();
      rig.scheduler.pause();

      for (const event of rig.scheduled) {
        if (event.step === heardSoFar) {
          seen.push(event.step);
          break;
        }
      }
      rig.scheduled.length = 0;
      rig.scheduler.start();
    }

    expect(seen.length).toBe(6);
  });

  it('returns to the top of the bar when stopped rather than paused', () => {
    rig.scheduler.start();
    rig.advanceTo(0.9);
    rig.scheduler.stop();

    expect(rig.scheduler.position).toBe(0);
    expect(rig.scheduler.playheadStep()).toBe(0);

    rig.scheduled.length = 0;
    rig.scheduler.start();
    expect(rig.scheduled[0]?.step).toBe(0);
  });
});

describe('nonsense tempos', () => {
  it('cannot hang the scheduler', () => {
    /*
     * A tempo of zero would make a step infinitely long and the beat would simply
     * never arrive — a hang, not a wrong note. The clamp in `readTempo` is the
     * defence and this is the proof; the bounded loop in `tick` is the second one.
     */
    const broken = harness({ bpm: 0, swing: Number.NaN });
    broken.scheduler.start();
    broken.advanceTo(2);

    expect(broken.scheduled.length).toBeGreaterThan(0);
    for (const event of broken.scheduled) {
      expect(Number.isFinite(event.time)).toBe(true);
    }
  });
});
