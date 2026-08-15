import { describe, expect, it } from 'vitest';
import { type AplClient, type AplExecution } from '@/apl/client';
import { buildCustomSource } from '@/apl/custom';
import { AplService, customCacheKey, customIdentityKey, type CustomRequest } from '@/apl/service';
import { MAX_SEED, MIN_SEED } from '@/generation/prng';
import { createInitialGroove } from '@/pattern/initialGroove';
import { setCell, type Pattern } from '@/pattern/pattern';

/*
 * What makes two custom runs the same run.
 *
 * Stage 6 gave Explore a random seed and then forgot to tell two of the three things that need
 * to know about it. `buildCustomSource` emitted `⎕RL←<seed> 1`, so the seed genuinely changed
 * the request — but `customCacheKey` did not include it, so the same expression at a different
 * seed was answered out of the cache with a bar computed under the old one; and the staleness
 * check compared only the expression, so a reply could land under a target or a seed that was
 * not the one it was computed for.
 *
 * Both were silent. Nothing failed, nothing warned, and the wrong rhythm looked exactly as
 * plausible as the right one.
 *
 * The fix is one function. `customIdentityKey` is what the cache asks and what staleness asks,
 * so the two cannot answer differently — and these tests hold it to that.
 */

const GROOVE = createInitialGroove();

const request = (over: Partial<CustomRequest> = {}): CustomRequest => ({
  core: '?8 16⍴2',
  target: 'all',
  pattern: GROOVE,
  ...over,
});

const reply = (pattern: Pattern): string[] =>
  pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join(' '));

/** A bar unlike the groove, so an install is visible. */
const A: Pattern = GROOVE.map((row, track) => row.map((_c, step) => (track + step) % 3 === 0));
const B: Pattern = GROOVE.map((row, track) => row.map((_c, step) => (track + step) % 4 === 0));

function fakeClient(answer: (expression: string) => string[]) {
  const calls: string[] = [];
  const client: AplClient = {
    execute: (expression: string): Promise<AplExecution> => {
      calls.push(expression);
      return Promise.resolve({ outputLines: answer(expression), durationMs: 1 });
    },
    cancel: () => undefined,
  };
  return { client, calls };
}

/* ------------------------------------------------------------------------- */

describe('the identity of a custom run', () => {
  it('changes with the expression, the target and the seed', () => {
    const base = customIdentityKey({ core: '?8 16⍴2', target: 'all' });

    expect(customIdentityKey({ core: '?8 16⍴3', target: 'all' })).not.toBe(base);
    expect(customIdentityKey({ core: '?8 16⍴2', target: 0 })).not.toBe(base);
    expect(customIdentityKey({ core: '?8 16⍴2', target: 'all', randomSeed: 1 })).not.toBe(base);
  });

  it('gives "no random context" its own value, distinct from any seed', () => {
    /*
     * The specific collision worth naming. An unseeded expression and one seeded at 1 send
     * different APL — the second carries `⎕RL←1 1` — so they are different questions, and a
     * representation that let them share a key would hand one the other's answer.
     */
    const unseeded = customIdentityKey({ core: '?8 16⍴2', target: 'all' });
    const seededOne = customIdentityKey({ core: '?8 16⍴2', target: 'all', randomSeed: 1 });
    const explicitlyNone = customIdentityKey({ core: '?8 16⍴2', target: 'all', randomSeed: null });

    expect(seededOne).not.toBe(unseeded);
    // Absent and explicitly-absent are the same thing, and must not be a third value.
    expect(explicitlyNone).toBe(unseeded);
  });

  it('normalises the seed exactly as the source builder does', () => {
    /*
     * Two requests that would send byte-identical APL must have byte-identical identities, or
     * the cache misses where it should hit. Both sides go through `clampSeed`, and this checks
     * that by comparing against what actually gets sent rather than by restating the rule.
     */
    const pairs: readonly (readonly [number, number])[] = [
      [1e9, MAX_SEED],
      [0, MIN_SEED],
      [-5, MIN_SEED],
      [47291.6, 47292],
      [47291, 123456],
    ];

    for (const [a, b] of pairs) {
      const sourceA = buildCustomSource({ core: '?8 16⍴2', target: 'all', pattern: GROOVE, randomSeed: a });
      const sourceB = buildCustomSource({ core: '?8 16⍴2', target: 'all', pattern: GROOVE, randomSeed: b });
      const sameApl = sourceA.expression === sourceB.expression;

      const keyA = customIdentityKey({ core: '?8 16⍴2', target: 'all', randomSeed: a });
      const keyB = customIdentityKey({ core: '?8 16⍴2', target: 'all', randomSeed: b });

      expect(keyA === keyB, `${String(a)} vs ${String(b)}`).toBe(sameApl);
    }
  });

  it('is what the cache key is built from', () => {
    // Not a re-derivation. If these two ever stop agreeing, that is the bug coming back.
    const identity = customIdentityKey({ core: '?8 16⍴2', target: 0, randomSeed: 47291 });
    expect(customCacheKey(request({ target: 0, randomSeed: 47291 }))).toContain(identity);
  });
});

/* ------------------------------------------------------------------------- */

describe('the custom cache key', () => {
  it('hits for the same expression, target, pattern and seed', () => {
    expect(customCacheKey(request({ randomSeed: 47291 }))).toBe(
      customCacheKey(request({ randomSeed: 47291 })),
    );
  });

  it('misses for a different seed', () => {
    expect(customCacheKey(request({ randomSeed: 47291 }))).not.toBe(
      customCacheKey(request({ randomSeed: 123456 })),
    );
  });

  it('does not let a seeded and an unseeded run collide', () => {
    expect(customCacheKey(request({ randomSeed: 1 }))).not.toBe(customCacheKey(request()));
  });

  it('still changes with the bar, the target and the expression', () => {
    const base = customCacheKey(request({ randomSeed: 47291 }));
    const edited = setCell(GROOVE, 2, 5, !(GROOVE[2]?.[5] ?? false));

    expect(customCacheKey(request({ randomSeed: 47291, pattern: edited }))).not.toBe(base);
    expect(customCacheKey(request({ randomSeed: 47291, target: 0 }))).not.toBe(base);
    expect(customCacheKey(request({ randomSeed: 47291, core: '?8 16⍴3' }))).not.toBe(base);
  });

  it('cannot collide with a transform or a generation', () => {
    expect(customCacheKey(request({ randomSeed: 47291 })).startsWith('custom|')).toBe(true);
  });
});

/* ------------------------------------------------------------------------- */

describe('the service, running the same expression at two seeds', () => {
  it('asks again rather than replaying the first answer', async () => {
    /*
     * The bug as somebody would have met it: write a generator in Explore, run it, change the
     * seed, run it again — and get the first bar back, instantly, with the new seed on screen.
     */
    const { client, calls } = fakeClient((expression) => reply(expression.includes('⎕RL←47291 1') ? A : B));
    const service = new AplService(client);

    const first = await service.runCustom(request({ randomSeed: 47291 }));
    const second = await service.runCustom(request({ randomSeed: 123456 }));

    expect(calls).toHaveLength(2);
    expect(second.cached).toBe(false);
    expect(first.pattern).toEqual(A);
    expect(second.pattern).toEqual(B);
  });

  it('still answers a genuine repeat from the cache', async () => {
    const { client, calls } = fakeClient(() => reply(A));
    const service = new AplService(client);

    await service.runCustom(request({ randomSeed: 47291 }));
    const again = await service.runCustom(request({ randomSeed: 47291 }));

    expect(calls).toHaveLength(1);
    expect(again.cached).toBe(true);
  });

  it('survives the seed A → run → undo → seed B → run flow', async () => {
    /*
     * The practical version, with the bar moving back and forth as Undo moves it. Every request
     * here is against the same groove, so only the seed separates them — which is exactly the
     * case the old key could not see.
     */
    const { client, calls } = fakeClient((expression) => reply(expression.includes('⎕RL←47291 1') ? A : B));
    const service = new AplService(client);

    // Seed A, run.
    const runA = await service.runCustom(request({ randomSeed: 47291 }));
    expect(runA.pattern).toEqual(A);

    // Undo: the bar is the groove again, which is what the next request runs against.
    // Seed B, run. This must execute B, not hand back A.
    const runB = await service.runCustom(request({ randomSeed: 123456 }));

    expect(calls).toHaveLength(2);
    expect(runB.cached).toBe(false);
    expect(runB.pattern).toEqual(B);
    expect(runB.pattern).not.toEqual(runA.pattern);

    // And going back to seed A is a cache hit, because it really is the same question again.
    const againA = await service.runCustom(request({ randomSeed: 47291 }));
    expect(calls).toHaveLength(2);
    expect(againA.cached).toBe(true);
    expect(againA.pattern).toEqual(A);
  });

  it('sends the seed it was given, and nothing when it was given none', async () => {
    const { client, calls } = fakeClient(() => reply(A));
    const service = new AplService(client);

    await service.runCustom(request({ randomSeed: 47291 }));
    await service.runCustom(request({ core: '2⌽m' }));

    expect(calls[0]).toContain('⎕RL←47291 1');
    expect(calls[1]).not.toContain('⎕RL');
  });
});
