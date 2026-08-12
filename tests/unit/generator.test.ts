import { describe, expect, it } from 'vitest';
import { GENERATOR_VERSION, generatePattern, type GenerateOptions } from '@/generation/generator';
import { measurePattern, patternDistance } from '@/generation/metrics';
import { PRESET_IDS } from '@/generation/presets';
import { cellAt, countTriggers, STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import { BEAT_STEPS } from '@/generation/weights';

/*
 * The generator, as properties rather than snapshots.
 *
 * Deliberately no fixture patterns. The generator is expected to be tuned again — that is
 * the whole point of the review tooling — and a test that pinned twenty-four bars cell by
 * cell would fail on every improvement and tell nobody anything. What is asserted here is
 * what must stay true whatever the weights become: the shape, the determinism, the locks,
 * and the direction each control moves things in.
 *
 * The statistical ones are sampled over many seeds and assert a direction, not a
 * threshold. A single seed is allowed to disobey; the population is not.
 */

const SEEDS = Array.from({ length: 40 }, (_unused, index) => 1 + index * 6247);

const BASE: Omit<GenerateOptions, 'seed'> = {
  preset: 'straight',
  density: 60,
  complexity: 45,
  syncopation: 30,
};

function build(overrides: Partial<GenerateOptions> & { seed: number }): Pattern {
  return generatePattern({ ...BASE, ...overrides });
}

/** The mean of some measurement over the sample, at these settings. */
function meanOver(
  overrides: Partial<GenerateOptions>,
  pick: (metrics: ReturnType<typeof measurePattern>) => number,
): number {
  const total = SEEDS.reduce((sum, seed) => sum + pick(measurePattern(build({ ...overrides, seed }))), 0);
  return total / SEEDS.length;
}

describe('the generator itself', () => {
  it('declares a version', () => {
    // Part of a groove's identity: tuning the weights changes what a seed means, and
    // stored state has to be able to tell.
    expect(GENERATOR_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(GENERATOR_VERSION)).toBe(true);
  });
});

describe('shape', () => {
  it('is always eight tracks of sixteen Boolean steps', () => {
    for (const preset of PRESET_IDS) {
      for (const density of [0, 35, 70, 100]) {
        for (const seed of SEEDS.slice(0, 8)) {
          const pattern = build({ seed, preset, density });
          expect(pattern).toHaveLength(TRACK_COUNT);
          for (const row of pattern) {
            expect(row).toHaveLength(STEP_COUNT);
            for (const cell of row) expect(typeof cell).toBe('boolean');
          }
        }
      }
    }
  });

  it('never places anything outside the bar', () => {
    // The strategies work with offsets, cycles and rotations, all of which can overrun.
    for (const preset of PRESET_IDS) {
      for (const seed of SEEDS.slice(0, 12)) {
        const pattern = build({ seed, preset, density: 100, complexity: 100, syncopation: 100 });
        expect(countTriggers(pattern)).toBeLessThanOrEqual(TRACK_COUNT * STEP_COUNT);
      }
    }
  });

  it('survives nonsense settings', () => {
    const pattern = generatePattern({
      seed: Number.NaN,
      preset: 'straight',
      density: Number.POSITIVE_INFINITY,
      complexity: -50,
      syncopation: Number.NaN,
    });
    expect(pattern).toHaveLength(TRACK_COUNT);
    expect(countTriggers(pattern)).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('gives the same bar for the same inputs', () => {
    for (const preset of PRESET_IDS) {
      for (const seed of SEEDS.slice(0, 10)) {
        const once = build({ seed, preset });
        const twice = build({ seed, preset });
        expect(twice).toEqual(once);
      }
    }
  });

  it('gives the same bar however many other bars were made in between', () => {
    // The streams are derived from the seed rather than advanced from a shared state, so
    // generating is not order-dependent. Without that, locks and Variation could not work.
    const first = build({ seed: 4242 });
    for (const seed of SEEDS) build({ seed, preset: 'glitch' });
    expect(build({ seed: 4242 })).toEqual(first);
  });

  it('gives different bars for different seeds', () => {
    const fingerprints = new Set(SEEDS.map((seed) => JSON.stringify(build({ seed }))));
    // Not "all forty differ" — two seeds are allowed to collide — but a generator that has
    // collapsed produces a handful of bars for any number of seeds.
    expect(fingerprints.size).toBeGreaterThanOrEqual(SEEDS.length - 1);
  });

  it('keeps two seeds meaningfully apart, not merely unequal', () => {
    for (const preset of PRESET_IDS) {
      let closest = 1;
      for (let i = 0; i < 12; i += 1) {
        for (let j = i + 1; j < 12; j += 1) {
          const a = SEEDS[i];
          const b = SEEDS[j];
          if (a === undefined || b === undefined) continue;
          closest = Math.min(
            closest,
            patternDistance(build({ seed: a, preset }), build({ seed: b, preset })),
          );
        }
      }
      // Two bars differing by one cell in a hundred and twenty-eight are the same bar.
      expect(closest, `${preset} has two nearly identical seeds`).toBeGreaterThan(0.02);
    }
  });
});

describe('density', () => {
  it('adds events as it rises', () => {
    const counts = [0, 20, 40, 60, 80, 100].map((density) =>
      meanOver({ density }, (metrics) => metrics.triggers),
    );

    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i], `density step ${String(i)}`).toBeGreaterThan(counts[i - 1] ?? 0);
    }
    // And the travel is worth having, not a few events either side of the middle.
    expect((counts[counts.length - 1] ?? 0) - (counts[0] ?? 0)).toBeGreaterThan(12);
  });

  it('rises on every preset', () => {
    for (const preset of PRESET_IDS) {
      const low = meanOver({ preset, density: 20 }, (m) => m.triggers);
      const high = meanOver({ preset, density: 85 }, (m) => m.triggers);
      expect(high, `${preset} should get busier`).toBeGreaterThan(low);
    }
  });

  it('does not let the kick run away with it', () => {
    // Density means "more happening", not "more of everything at the same rate". The hats
    // must gain far more than the kick, or a dense pattern is just a fast kick drum.
    const kickLow = meanOver({ density: 20 }, (m) => m.perTrack[0] ?? 0);
    const kickHigh = meanOver({ density: 100 }, (m) => m.perTrack[0] ?? 0);
    const hatLow = meanOver({ density: 20 }, (m) => m.perTrack[2] ?? 0);
    const hatHigh = meanOver({ density: 100 }, (m) => m.perTrack[2] ?? 0);

    expect(kickHigh).toBeGreaterThan(kickLow);
    expect(hatHigh - hatLow).toBeGreaterThan((kickHigh - kickLow) * 1.5);
    expect(kickHigh).toBeLessThanOrEqual(8);
  });

  it('responds to a small move rather than having dead zones', () => {
    /*
     * Rounding counts to nearest gave this control plateaus ten points wide, because all
     * eight tracks crossed their integer boundaries at nearly the same moments. Measured
     * on the whole pattern, because a count that holds while the arrangement moves is not
     * a dead zone.
     */
    for (const seed of SEEDS.slice(0, 10)) {
      let previous = '';
      let run = 0;
      let worst = 0;
      for (let density = 25; density <= 90; density += 1) {
        const fingerprint = JSON.stringify(build({ seed, density }));
        run = fingerprint === previous ? run + 1 : 0;
        worst = Math.max(worst, run);
        previous = fingerprint;
      }
      expect(worst + 1, `seed ${String(seed)} has a wide plateau`).toBeLessThanOrEqual(8);
    }
  });
});

describe('complexity', () => {
  it('does not simply add events', () => {
    // The separation from Density, and the property most easily lost when tuning. A few
    // events either way is fine; a systematic climb is Density wearing another name.
    const low = meanOver({ complexity: 5 }, (m) => m.triggers);
    const high = meanOver({ complexity: 95 }, (m) => m.triggers);
    expect(Math.abs(high - low)).toBeLessThan(3);
  });

  it('opens up the sixteenth grid', () => {
    const low = meanOver({ complexity: 5 }, (m) => m.sixteenth);
    const mid = meanOver({ complexity: 50 }, (m) => m.sixteenth);
    const high = meanOver({ complexity: 95 }, (m) => m.sixteenth);

    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    expect(high).toBeGreaterThan(low * 1.8);
  });

  it('makes the bar repeat itself less', () => {
    // The other half of what Complexity means, and the audible half: a groove built from a
    // four-step figure repeated four times is simple however many notes are in it.
    const low = meanOver({ complexity: 5 }, (m) => m.selfSimilarity);
    const high = meanOver({ complexity: 95 }, (m) => m.selfSimilarity);
    expect(low).toBeGreaterThan(high);
  });

  it('can be high on a sparse bar and low on a dense one', () => {
    /*
     * The two controls are independent, and this is the honest way to establish it.
     *
     * Compared as a *share* of the events rather than as a count. A bar with twelve hats in
     * sixteen positions must use sixteenths whatever Complexity says — there is nowhere else
     * for them to go — so the absolute count of sixteenths in a dense simple bar can exceed
     * that of a sparse complex one without Complexity having failed at anything. What must
     * hold is that the sparse-but-complex bar spends a larger *proportion* of its events on
     * the sixteenth grid than the dense-but-simple one does.
     */
    const sparseComplex = meanOver({ density: 22, complexity: 95 }, (m) =>
      m.triggers === 0 ? 0 : m.sixteenth / m.triggers,
    );
    const denseSimple = meanOver({ density: 85, complexity: 5 }, (m) =>
      m.triggers === 0 ? 0 : m.sixteenth / m.triggers,
    );
    expect(sparseComplex).toBeGreaterThan(denseSimple);

    // And the dense one still has far more events, which is Density's business.
    expect(meanOver({ density: 85, complexity: 5 }, (m) => m.triggers)).toBeGreaterThan(
      meanOver({ density: 22, complexity: 95 }, (m) => m.triggers) * 1.5,
    );
  });
});

describe('syncopation', () => {
  it('moves events off the beat', () => {
    const shares = [0, 25, 50, 75, 100].map((syncopation) =>
      meanOver({ syncopation }, (metrics) => metrics.offbeatShare),
    );

    expect(shares[shares.length - 1] ?? 0).toBeGreaterThan((shares[0] ?? 0) + 0.05);
    // Monotone at the ends rather than at every step: the middle of the control is where
    // preset anchors and the metrical blend argue with each other.
    expect(shares[2] ?? 0).toBeGreaterThan(shares[0] ?? 0);
  });

  it('takes events off the beats, measurably', () => {
    /*
     * The complement of the test above, and the sharper of the two.
     *
     * A share can rise because events were added elsewhere; this asserts that the beats
     * themselves are given up. It is also the test that caught the fault it now guards
     * against: the anchor bonus was added at full strength whatever Syncopation asked for,
     * so at the top of the control *more* events landed on the beat than at the bottom.
     */
    for (const preset of ['broken', 'syncopated', 'glitch'] as const) {
      const straight = meanOver({ preset, syncopation: 0 }, (m) => m.onBeat);
      const pushed = meanOver({ preset, syncopation: 100 }, (m) => m.onBeat);
      expect(pushed, `${preset} should give up beats`).toBeLessThan(straight * 0.85);
    }

    // Every preset moves in the same direction, even the ones built to resist it.
    for (const preset of PRESET_IDS) {
      const straight = meanOver({ preset, syncopation: 0 }, (m) => m.onBeat);
      const pushed = meanOver({ preset, syncopation: 100 }, (m) => m.onBeat);
      expect(pushed, `${preset} moved the wrong way`).toBeLessThan(straight);
    }
  });

  it('lowers the mean metrical strength of what is played', () => {
    const straightMean = meanOver({ syncopation: 0 }, (m) => m.meanStrength);
    const syncopatedMean = meanOver({ syncopation: 100 }, (m) => m.meanStrength);
    expect(syncopatedMean).toBeLessThan(straightMean);
  });

  it('leaves a pulse standing even at full', () => {
    /*
     * Not an inversion of the metrical weights. Maximum Syncopation should sound like a
     * rhythm fighting a pulse, not like one that never had a pulse — so the beats keep a
     * real share of the events, and a kick keeps its downbeat.
     */
    let barsWithADownbeatKick = 0;
    for (const seed of SEEDS) {
      const pattern = build({ seed, syncopation: 100 });
      if (cellAt(pattern, 0, 0)) barsWithADownbeatKick += 1;

      const metrics = measurePattern(pattern);
      expect(metrics.onBeat).toBeGreaterThan(0);
    }
    expect(barsWithADownbeatKick).toBeGreaterThan(SEEDS.length * 0.8);
  });
});

describe('locks', () => {
  const locked = [true, false, true, false, false, false, false, true];

  it('leave a locked row bit for bit unchanged', () => {
    const current = build({ seed: 999, preset: 'straight' });

    for (const preset of PRESET_IDS) {
      for (const seed of SEEDS.slice(0, 10)) {
        const next = generatePattern({
          ...BASE,
          preset,
          seed,
          density: 90,
          complexity: 80,
          syncopation: 70,
          lockedTracks: locked,
          currentPattern: current,
        });

        locked.forEach((isLocked, track) => {
          if (!isLocked) return;
          for (let step = 0; step < STEP_COUNT; step += 1) {
            expect(
              cellAt(next, track, step),
              `${preset} seed ${String(seed)} track ${String(track)} step ${String(step)}`,
            ).toBe(cellAt(current, track, step));
          }
        });
      }
    }
  });

  it('still let the unlocked rows change', () => {
    const current = build({ seed: 999 });
    const next = generatePattern({
      ...BASE,
      seed: 12_345,
      lockedTracks: locked,
      currentPattern: current,
    });
    expect(patternDistance(current, next)).toBeGreaterThan(0);
  });

  it('can protect the whole kit', () => {
    const current = build({ seed: 999 });
    const everything = Array.from({ length: TRACK_COUNT }, () => true);
    const next = generatePattern({
      ...BASE,
      seed: 55_555,
      lockedTracks: everything,
      currentPattern: current,
    });
    expect(next).toEqual(current);
  });
});

describe('presets', () => {
  it('are all deterministic', () => {
    for (const preset of PRESET_IDS) {
      expect(build({ seed: 31_337, preset })).toEqual(build({ seed: 31_337, preset }));
    }
  });

  it('produce structurally different bars from one seed', () => {
    /*
     * The same seed under two presets should sound like two different drummers. Compared
     * pairwise so that a preset which has quietly become a copy of its neighbour is caught,
     * which is the failure the review tooling exists to watch for.
     */
    for (let i = 0; i < PRESET_IDS.length; i += 1) {
      for (let j = i + 1; j < PRESET_IDS.length; j += 1) {
        const a = PRESET_IDS[i];
        const b = PRESET_IDS[j];
        if (a === undefined || b === undefined) continue;

        let differing = 0;
        for (const seed of SEEDS.slice(0, 12)) {
          if (patternDistance(build({ seed, preset: a }), build({ seed, preset: b })) > 0.05) {
            differing += 1;
          }
        }
        expect(differing, `${a} and ${b} are too alike`).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('keep every track in use, and none of them silent throughout', () => {
    // A preset where one track never fires has a broken profile; one where a track fires
    // in every bar at every setting is not a part, it is a drone.
    for (const preset of PRESET_IDS) {
      for (let track = 0; track < TRACK_COUNT; track += 1) {
        const appearances = SEEDS.filter(
          (seed) => (measurePattern(build({ seed, preset, density: 75 })).perTrack[track] ?? 0) > 0,
        ).length;
        expect(appearances, `${preset} track ${String(track)} never fires`).toBeGreaterThan(0);
      }
    }
  });

  it('give Four on Floor a kick on all four beats', () => {
    // The one preset whose name is a testable promise.
    for (const seed of SEEDS.slice(0, 20)) {
      const pattern = build({ seed, preset: 'fourFloor' });
      for (const beat of BEAT_STEPS) {
        expect(cellAt(pattern, 0, beat), `seed ${String(seed)} beat ${String(beat)}`).toBe(true);
      }
    }
  });

  it('keep Sparse sparser than everything else', () => {
    const sparse = meanOver({ preset: 'sparse', density: 60 }, (m) => m.triggers);
    for (const preset of PRESET_IDS) {
      if (preset === 'sparse') continue;
      expect(meanOver({ preset, density: 60 }, (m) => m.triggers)).toBeGreaterThan(sparse);
    }
  });

  it('keep the kick disciplined even in Glitch', () => {
    // Glitch is structured disruption, not static. A kick made of random bursts removes the
    // last thing holding the bar together.
    const kicks = meanOver({ preset: 'glitch', density: 100 }, (m) => m.perTrack[0] ?? 0);
    expect(kicks).toBeLessThanOrEqual(7);
  });

  it('never put an open hat on a closed hat', () => {
    /*
     * The commonest way a generated kit sounds wrong, and cheap to make impossible: the
     * closed hat gives way wherever the open hat lands.
     */
    for (const preset of PRESET_IDS) {
      for (const seed of SEEDS.slice(0, 15)) {
        const pattern = build({ seed, preset, density: 90 });
        for (let step = 0; step < STEP_COUNT; step += 1) {
          const both = cellAt(pattern, 2, step) && cellAt(pattern, 3, step);
          expect(both, `${preset} seed ${String(seed)} step ${String(step)}`).toBe(false);
        }
      }
    }
  });

  it('respect the run limit on the kick', () => {
    // Three consecutive sixteenths on a kick is a machine gun.
    for (const preset of PRESET_IDS) {
      for (const seed of SEEDS.slice(0, 15)) {
        const pattern = build({ seed, preset, density: 100, complexity: 100 });
        let run = 0;
        for (let step = 0; step < STEP_COUNT; step += 1) {
          run = cellAt(pattern, 0, step) ? run + 1 : 0;
          expect(run, `${preset} seed ${String(seed)}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});
