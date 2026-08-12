/*
 * The look-ahead scheduler.
 *
 * This is the piece that decides when notes happen, and the shape of it is the
 * single most important technical decision in APL Beats. A drum machine that asks
 * "is it time for the next note?" once per animation frame will sound like one: a
 * dropped frame becomes a late snare, and a busy main thread becomes an unsteady
 * beat. So nothing here plays anything.
 *
 * Instead:
 *
 *   a timer wakes about forty times a second
 *   → it looks a tenth of a second into the future
 *   → every step falling inside that window is handed to Web Audio with an exact time
 *   → Web Audio plays it on the audio thread, to the sample
 *
 * The main thread can then stall for eighty milliseconds and the beat does not
 * move, because the notes for that eighty milliseconds were handed over before it
 * happened. This is Chris Wilson's "A Tale of Two Clocks" pattern, and it is the
 * standard answer for good reason.
 *
 * The playhead the interface draws is a *consequence* of what was scheduled, not a
 * cause of it. `playheadStep` reports which step the audio clock has actually
 * reached, so animation reads the same truth the ear does and cannot influence it.
 *
 * Every dependency is injected — the clock, the timer, the tempo — so all of this
 * is testable in milliseconds without a browser, an audio device or a wait.
 */

import {
  clampBpm,
  clampSwing,
  secondsPerStep,
  stepIndexInBar,
  swingDelaySeconds,
  STEPS_PER_BAR,
} from './timing';

/**
 * How far ahead notes are handed to Web Audio, in seconds.
 *
 * The trade-off is stall tolerance against how quickly a change is heard. A tenth
 * of a second absorbs any main-thread hiccup short of a layout catastrophe, and is
 * short enough that switching a cell on lands in the same bar you clicked it.
 */
export const LOOKAHEAD_SECONDS = 0.1;

/**
 * How often the scheduler wakes, in milliseconds.
 *
 * Comfortably more often than the look-ahead window is long, so a late wake-up
 * still finds the window ahead of it rather than behind. Twenty-five milliseconds
 * against a hundred gives four chances to notice; the cost is a callback doing
 * almost nothing forty times a second, which is nothing.
 */
export const TICK_MS = 25;

/**
 * A moment's grace before the first note.
 *
 * Pressing Play cannot schedule a note at the current time: that instant is
 * already inside the buffer the audio thread is filling, so the attack would be
 * clipped or the note dropped. Fifty milliseconds is under the threshold at which
 * a button feels unresponsive and well over the threshold at which a note is safe.
 */
export const START_OFFSET_SECONDS = 0.05;

/** Cancels a pending wake-up. */
export type CancelTimer = () => void;

export interface Tempo {
  readonly bpm: number;
  readonly swing: number;
}

export interface SchedulerOptions {
  /** Now, on the audio clock, in seconds. */
  readonly clock: () => number;
  /** The tempo to use for the *next* step, read fresh every time one is scheduled. */
  readonly getTempo: () => Tempo;
  /** Hand a step to the audio engine. `time` is on the audio clock and in the future. */
  readonly onStep: (step: number, time: number) => void;
  /** Arrange a wake-up. Returns its canceller. Injected so tests can drive time. */
  readonly setTimer?: (callback: () => void, ms: number) => CancelTimer;
}

interface ScheduledStep {
  readonly step: number;
  readonly time: number;
}

function defaultTimer(callback: () => void, ms: number): CancelTimer {
  const handle = setTimeout(callback, ms);
  return () => {
    clearTimeout(handle);
  };
}

export class Scheduler {
  private readonly clock: () => number;
  private readonly getTempo: () => Tempo;
  private readonly onStep: (step: number, time: number) => void;
  private readonly setTimer: (callback: () => void, ms: number) => CancelTimer;

  private cancelTimer: CancelTimer | null = null;

  /**
   * The step to schedule next, counted within the bar.
   *
   * Kept across a pause, which is what makes Pause a pause rather than a stop:
   * resuming carries on from the step the bar had reached.
   */
  private nextStep = 0;

  /**
   * When the next step would sound if swing were zero.
   *
   * Advanced by one step's worth at a time, and swing applied to it rather than
   * accumulated into it. Adding swing to a running total would lengthen the bar a
   * little on every pass, and a bar that grows is a tempo that drifts.
   */
  private nextGridTime = 0;

  /**
   * Steps handed over but not yet heard, oldest first.
   *
   * Only ever a couple of entries long — the look-ahead window divided by the
   * length of a step — and it is the entire mechanism by which the interface knows
   * where the playhead is. Not a copy of the schedule; the schedule itself, being
   * consumed as the audio clock passes each entry.
   */
  private pending: ScheduledStep[] = [];

  /** The step the audio clock has most recently passed. */
  private reachedStep = 0;

  private running = false;

  constructor(options: SchedulerOptions) {
    this.clock = options.clock;
    this.getTempo = options.getTempo;
    this.onStep = options.onStep;
    this.setTimer = options.setTimer ?? defaultTimer;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** The step the next note will be scheduled from. Survives a pause. */
  get position(): number {
    return this.nextStep;
  }

  /**
   * Begin scheduling, from wherever the bar was left.
   *
   * The caller must already have an audio clock that is running: a suspended
   * context's clock does not advance, so every step in the first window would be
   * scheduled for a time that had passed by the moment it resumed.
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.nextGridTime = this.clock() + START_OFFSET_SECONDS;
    this.pending = [];
    this.tick();
  }

  /**
   * Stop scheduling, keeping the position in the bar.
   *
   * Notes already handed to Web Audio are its business now; the engine suspends the
   * context, which drops them. What matters here is that the timer stops, because
   * a timer running with nothing to do is exactly the idle cost this project has
   * promised not to have.
   */
  pause(): void {
    if (this.running) {
      /*
       * Give back the steps that were handed over but never heard.
       *
       * At any moment the scheduler is a step or two ahead of the ear. Pausing
       * without rewinding would resume from where the *scheduler* had got to and
       * silently swallow the steps in between — a pause that eats a sixteenth is
       * the kind of fault that is only ever noticed as "it doesn't quite loop
       * right".
       */
      this.playheadStep();
      this.nextStep = stepIndexInBar(this.nextStep - this.pending.length);
    }

    this.running = false;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.pending = [];
  }

  /** Stop, and return to the top of the bar. */
  stop(): void {
    this.pause();
    this.nextStep = 0;
    this.reachedStep = 0;
  }

  /** Jump to a step without starting or stopping. */
  seek(step: number): void {
    this.nextStep = stepIndexInBar(Math.trunc(step));
    this.reachedStep = this.nextStep;
    this.pending = [];
    if (this.running) {
      this.nextGridTime = this.clock() + START_OFFSET_SECONDS;
    }
  }

  /**
   * Which step the playhead should be drawn on.
   *
   * Reads the audio clock and reports the last step it has passed, so a frame drawn
   * late shows where the music is rather than where it was when the frame was
   * asked for. Two frames arriving in the same step return the same answer, which
   * is what lets the interface re-render only when this changes.
   */
  playheadStep(): number {
    if (this.running) {
      const now = this.clock();
      for (;;) {
        const next = this.pending[0];
        if (next === undefined || next.time > now) break;
        this.pending.shift();
        this.reachedStep = next.step;
      }
    }
    return this.reachedStep;
  }

  /**
   * One wake-up: schedule everything inside the window, then arrange the next.
   *
   * The loop is bounded rather than trusting its own arithmetic to terminate. It
   * cannot run away while the tempo is clamped above zero, but a scheduler is a
   * poor place to find out one is wrong about that, and a bounded loop drops a note
   * where an unbounded one would lock the tab.
   */
  private tick = (): void => {
    if (!this.running) return;

    const horizon = this.clock() + LOOKAHEAD_SECONDS;
    let scheduled = 0;

    while (this.nextGridTime < horizon && scheduled < STEPS_PER_BAR * 2) {
      const { bpm, swing } = this.readTempo();
      const step = this.nextStep;
      const time = this.nextGridTime + swingDelaySeconds(step, bpm, swing);

      this.onStep(step, time);
      this.pending.push({ step, time });

      this.nextGridTime += secondsPerStep(bpm);
      this.nextStep = stepIndexInBar(step + 1);
      scheduled += 1;
    }

    this.cancelTimer = this.setTimer(this.tick, TICK_MS);
  };

  /**
   * The tempo, sanitised.
   *
   * Clamped here as well as in the interface, because this is the last point before
   * the numbers become divisions. A tempo of zero reaching the loop above would
   * make `secondsPerStep` infinite and the beat would simply never arrive.
   */
  private readTempo(): Tempo {
    const { bpm, swing } = this.getTempo();
    return { bpm: clampBpm(bpm), swing: clampSwing(swing) };
  }
}
