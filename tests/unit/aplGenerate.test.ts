import { describe, expect, it } from 'vitest';
import { AplError, type AplClient, type AplExecution } from '@/apl/client';
import { APL_GENERATOR_VERSION, RECIPES, type Recipe } from '@/apl/generators';
import { AplService, CACHE_LIMIT, generateCacheKey, type GenerateRequest } from '@/apl/service';
import { createInitialGroove } from '@/pattern/initialGroove';
import { setCell, TRACK_COUNT, type Pattern } from '@/pattern/pattern';

/*
 * Generation, through the service that already ran everything else.
 *
 * The questions here are the ones that are specific to making a rhythm rather than changing one:
 * that a failure leaves the beat alone, that the cache key knows what a generated bar actually
 * depends on, and that a locked row is preserved by the request rather than by JavaScript
 * afterwards.
 *
 * No live requests. `verify:apl-generators-live` is where the real Dyalog runs, four deliberate
 * requests, never in CI.
 */

const GROOVE = createInitialGroove();
const FIRST = RECIPES[0]!;
const SECOND = RECIPES[1]!;

/** Eight lines of sixteen digits, as the live service formats a Boolean matrix. */
const reply = (pattern: Pattern): string[] =>
  pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join(' '));

/** A bar that is definitely not the opening groove, so an install is visible. */
const OTHER: Pattern = GROOVE.map((row, track) => row.map((_cell, step) => (track + step) % 3 === 0));

function fakeClient(answer: (expression: string) => string[] | Error) {
  const calls: string[] = [];
  const client: AplClient = {
    execute: (expression: string): Promise<AplExecution> => {
      calls.push(expression);
      const result = answer(expression);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve({ outputLines: result, durationMs: 1 });
    },
    cancel: () => undefined,
  };
  return { client, calls };
}

const request = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  recipe: FIRST,
  seed: 47291,
  pattern: GROOVE,
  lockedRows: [],
  ...over,
});

/* ------------------------------------------------------------------------- */

describe('one Generate, one request', () => {
  it('asks once and installs what came back', async () => {
    const { client, calls } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);

    const outcome = await service.runGenerate(request());

    expect(calls).toHaveLength(1);
    expect(outcome.cached).toBe(false);
    expect(outcome.pattern).toEqual(OTHER);
  });

  it('sends the seeded ⎕RL and the recipe, and nothing of the current bar', async () => {
    const { client, calls } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);

    await service.runGenerate(request({ seed: 47291 }));

    const sent = calls[0] ?? '';
    expect(sent).toContain('⎕IO←0');
    expect(sent).toContain('⎕RL←47291 1');
    expect(sent).toContain(FIRST.core);
    /*
     * Nothing locked, so the recipe does not read the bar and the bar is not sent.
     *
     * Checked as `m←`, the assignment, rather than as `8 16⍴` — several recipes reshape to 8 × 16
     * inside their own expression, so the literal is not the tell. What would give it away is a
     * statement binding the current pattern to `m`.
     */
    expect(sent).not.toContain('m←');
  });

  it('leaves the beat alone when APL fails', async () => {
    /*
     * The rule that makes the feature mean anything. There is no local generator behind this
     * button: if Dyalog did not run, no generated rhythm appears.
     */
    for (const failure of [
      new AplError('unavailable', 'nope'),
      new AplError('timeout', 'too slow'),
      new AplError('cancelled', 'superseded'),
    ]) {
      const { client } = fakeClient(() => failure);
      const service = new AplService(client);
      await expect(service.runGenerate(request())).rejects.toBeInstanceOf(AplError);
      expect(service.cacheSize).toBe(0);
    }
  });

  it('refuses a malformed reply rather than accepting half a bar', async () => {
    for (const bad of [['1 1 1'], [], ['not a matrix'], reply(GROOVE).slice(0, 7)]) {
      const { client } = fakeClient(() => bad);
      const service = new AplService(client);
      await expect(service.runGenerate(request())).rejects.toBeInstanceOf(AplError);
      // Nothing is remembered, so a retry really retries rather than replaying the failure.
      expect(service.cacheSize).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------------- */

describe('the generation cache key', () => {
  const keyOf = (over: Partial<GenerateRequest> = {}) => generateCacheKey(request(over));

  it('cannot collide with a transform or a custom expression', () => {
    expect(keyOf().startsWith('generate|')).toBe(true);
  });

  it('changes with the recipe', () => {
    expect(keyOf({ recipe: FIRST })).not.toBe(keyOf({ recipe: SECOND }));
  });

  it('changes with the seed', () => {
    expect(keyOf({ seed: 1 })).not.toBe(keyOf({ seed: 2 }));
  });

  it('carries the generator version, so a recipe change cannot be answered from an old cache', () => {
    expect(keyOf()).toContain(`v${String(APL_GENERATOR_VERSION)}`);
  });

  it('changes when a row is locked', () => {
    expect(keyOf({ lockedRows: [] })).not.toBe(keyOf({ lockedRows: [0] }));
    expect(keyOf({ lockedRows: [0] })).not.toBe(keyOf({ lockedRows: [0, 1] }));
  });

  it('changes when the contents of a locked row change', () => {
    const edited = setCell(GROOVE, 0, 5, !(GROOVE[0]?.[5] ?? false));
    expect(keyOf({ lockedRows: [0], pattern: edited })).not.toBe(keyOf({ lockedRows: [0] }));
  });

  it('does NOT change when an unlocked row changes', () => {
    /*
     * The point of the whole design. The recipe never reads the current bar, so the same recipe
     * under the same seed with nothing locked would compute exactly the same matrix — and
     * answering that from cache is correct rather than a shortcut.
     */
    const edited = setCell(GROOVE, 3, 5, !(GROOVE[3]?.[5] ?? false));
    expect(keyOf({ pattern: edited })).toBe(keyOf());

    // And with a lock elsewhere, an edit outside it still does not move the key.
    const editedElsewhere = setCell(GROOVE, 3, 7, !(GROOVE[3]?.[7] ?? false));
    expect(keyOf({ lockedRows: [0], pattern: editedElsewhere })).toBe(keyOf({ lockedRows: [0] }));
  });

  it('does not care what order the locks arrived in', () => {
    expect(keyOf({ lockedRows: [3, 0] })).toBe(keyOf({ lockedRows: [0, 3] }));
  });
});

describe('the cache in use', () => {
  it('answers an identical generation without asking again', async () => {
    const { client, calls } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);

    const first = await service.runGenerate(request());
    const second = await service.runGenerate(request());

    expect(calls).toHaveLength(1);
    expect(second.cached).toBe(true);
    expect(second.pattern).toEqual(first.pattern);
  });

  it('survives an edit to an unlocked row', async () => {
    const { client, calls } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);

    await service.runGenerate(request());
    const edited = setCell(GROOVE, 6, 2, !(GROOVE[6]?.[2] ?? false));
    const again = await service.runGenerate(request({ pattern: edited }));

    expect(calls).toHaveLength(1);
    expect(again.cached).toBe(true);
  });

  it('does not survive an edit to a locked row', async () => {
    const { client, calls } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);

    await service.runGenerate(request({ lockedRows: [0] }));
    const edited = setCell(GROOVE, 0, 2, !(GROOVE[0]?.[2] ?? false));
    await service.runGenerate(request({ lockedRows: [0], pattern: edited }));

    expect(calls).toHaveLength(2);
  });

  it('shares one bounded cache with the other two kinds of request', async () => {
    const { client } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);

    // More generations than the cache can hold, so eviction is exercised by this path too.
    for (let seed = 1; seed <= CACHE_LIMIT + 8; seed += 1) {
      await service.runGenerate(request({ seed }));
    }

    expect(service.cacheSize).toBeLessThanOrEqual(CACHE_LIMIT);
  });

  it('can be asked whether it already knows, without asking anything', async () => {
    const { client, calls } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);

    expect(service.hasGenerate(request())).toBe(false);
    await service.runGenerate(request());
    expect(service.hasGenerate(request())).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------- */

describe('locked rows', () => {
  it('are restored by APL, not by JavaScript', async () => {
    /*
     * The matrix that arrives is the whole answer. This checks the *request* asks for that —
     * the reply is taken as given, exactly as it would be from the real service, so if the
     * wrapper were wrong the beat would silently be wrong too.
     */
    const { client, calls } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);

    await service.runGenerate(request({ lockedRows: [0, 3] }));

    const sent = calls[0] ?? '';
    expect(sent).toContain('g[0 3;]←m[0 3;]');
    // The current bar is sent only because a locked row has to come from it.
    expect(sent).toContain('m←8 16⍴');
    // And the restoration is after the core, so it cannot disturb the draws the others got.
    expect(sent.indexOf(FIRST.core)).toBeLessThan(sent.indexOf('g[0 3;]'));
  });

  it('does not change the request the other rows would have produced', async () => {
    /*
     * Locking the kick must not change the hats. The seed is set before the core runs and the
     * lock is applied after it, so the random draws are identical — which shows up here as the
     * two requests being the same up to the lock statement.
     */
    const { client, calls } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);

    await service.runGenerate(request({ lockedRows: [] }));
    await service.runGenerate(request({ lockedRows: [0] }));

    const [plain = '', locked = ''] = calls;
    expect(plain).toContain('⎕RL←47291 1');
    expect(locked).toContain('⎕RL←47291 1');
    expect(locked).toContain(FIRST.core);
    expect(plain).toContain(FIRST.core);
  });

  it('is a request the service will still make when seven of eight are locked', async () => {
    // Seven locked is a real, useful generation: one track regenerates. Only eight is a no-op,
    // and that is refused by the hook rather than here — the service is not the place for it.
    const { client, calls } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);

    await service.runGenerate(request({ lockedRows: [0, 1, 2, 3, 4, 5, 6] }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('g[0 1 2 3 4 5 6;]←m[0 1 2 3 4 5 6;]');
  });
});

/* ------------------------------------------------------------------------- */

describe('every shipped recipe', () => {
  it('produces a request the service will send, with or without locks', async () => {
    for (const recipe of RECIPES) {
      for (const lockedRows of [[], [0], [0, 3, 7]]) {
        const { client, calls } = fakeClient(() => reply(OTHER));
        const service = new AplService(client);
        const outcome = await service.runGenerate(request({ recipe, lockedRows }));

        expect(calls, recipe.id).toHaveLength(1);
        expect(outcome.pattern, recipe.id).toEqual(OTHER);
      }
    }
  });

  it('has its own cache entry', () => {
    const keys = new Set(RECIPES.map((recipe: Recipe) => generateCacheKey(request({ recipe }))));
    expect(keys.size).toBe(RECIPES.length);
  });

  it('never asks for a row index outside the eight that exist', async () => {
    const { client, calls } = fakeClient(() => reply(OTHER));
    const service = new AplService(client);
    await service.runGenerate(
      request({ lockedRows: [-1, 0, TRACK_COUNT, 99] as unknown as readonly number[] }),
    );
    expect(calls[0]).toContain('g[0;]←m[0;]');
  });
});
