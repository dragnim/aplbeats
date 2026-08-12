import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AplError, TryAplClient, type AplClient, type AplExecution } from '@/apl/client';
import { patternToAplLiteral } from '@/apl/matrix';
import { operationById } from '@/apl/operations';
import { CACHE_LIMIT, cacheKey, isStillApplicable, TransformService } from '@/apl/transform';
import { createInitialGroove } from '@/pattern/initialGroove';
import { createPattern, setCell, STEP_COUNT, TRACK_COUNT, type Pattern } from '@/pattern/pattern';

/*
 * The request discipline.
 *
 * TryAPL is somebody else's infrastructure and this project has promised not to treat it as a
 * clock. These tests are how that promise is kept rather than merely stated: that one Apply is
 * at most one request, that an identical question is answered from memory, that nothing
 * retries, and that a reply computed from a bar which no longer exists cannot overwrite the bar
 * that does.
 */

const GROOVE = createInitialGroove();

/** Eight lines of sixteen digits, as the live service formats a Boolean matrix. */
function reply(pattern: Pattern): string[] {
  return pattern.map((row) => row.map((cell) => (cell ? '1' : '0')).join(' '));
}

/** A client that counts its calls and answers with whatever it is told to. */
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

describe('one transform, one request', () => {
  it('asks once', async () => {
    const { client, calls } = fakeClient(() => reply(GROOVE));
    const service = new TransformService(client);

    await service.run({
      operation: operationById('reverse'),
      target: 'all',
      parameters: {},
      pattern: GROOVE,
    });

    expect(calls).toHaveLength(1);
  });

  it('sends the matrix, the origin and the operation, and nothing else', async () => {
    /*
     * The privacy boundary, asserted. There is no mixer state, no stored session, no tempo, no
     * identity and no telemetry in the payload — not because it is stripped out, but because
     * the source builder never had access to any of it.
     */
    const { client, calls } = fakeClient(() => reply(GROOVE));
    const service = new TransformService(client);

    await service.run({
      operation: operationById('rotate'),
      target: 2,
      parameters: { amount: -1 },
      pattern: GROOVE,
    });

    const sent = calls[0] ?? '';
    expect(sent).toBe(`⎕IO←0 ⋄ m←${patternToAplLiteral(GROOVE)} ⋄ m[2;]←¯1⌽m[2;] ⋄ m`);
    expect(sent).not.toMatch(/bpm|swing|volume|mute|seed|preset|density/iu);
  });
});

describe('the cache', () => {
  let service: TransformService;
  let calls: string[];

  beforeEach(() => {
    const fake = fakeClient(() => reply(GROOVE));
    calls = fake.calls;
    service = new TransformService(fake.client);
  });

  const request = {
    operation: operationById('reverse'),
    target: 'all' as const,
    parameters: {},
    pattern: GROOVE,
  };

  it('answers an identical question without asking again', async () => {
    const first = await service.run(request);
    const second = await service.run(request);

    expect(calls).toHaveLength(1);
    expect(second.cached).toBe(true);
    expect(first.cached).toBe(false);
    expect(second.pattern).toEqual(first.pattern);
  });

  it('asks again when the pattern has changed', async () => {
    // The same operation on a different bar is a different question.
    await service.run(request);
    await service.run({ ...request, pattern: setCell(GROOVE, 7, 0, true) });
    expect(calls).toHaveLength(2);
  });

  it('asks again when a parameter has changed', async () => {
    const rotate = operationById('rotate');
    await service.run({ operation: rotate, target: 0, parameters: { amount: -1 }, pattern: GROOVE });
    await service.run({ operation: rotate, target: 0, parameters: { amount: -2 }, pattern: GROOVE });
    expect(calls).toHaveLength(2);
  });

  it('asks again when the target has changed', async () => {
    await service.run({ ...request, target: 0 });
    await service.run({ ...request, target: 1 });
    expect(calls).toHaveLength(2);
  });

  it('treats a parameter the operation ignores as the same question', async () => {
    // Reverse takes no parameters, so a stray one must not defeat the cache.
    await service.run({ ...request, parameters: { amount: 1 } });
    await service.run({ ...request, parameters: { amount: 9 } });
    expect(calls).toHaveLength(1);
  });

  it('is bounded, and forgets the least recently useful', async () => {
    /*
     * Varied by the pattern rather than by a parameter. A parameter cannot produce more than a
     * handful of distinct requests, because every one of them is clamped to the range its
     * operation declares — which is the point of the clamp, and made this test measure eight
     * entries instead of thirty-two the first time it was written.
     */
    const patterns = Array.from({ length: CACHE_LIMIT + 5 }, (_unused, index) =>
      // One distinct bar per entry: an empty grid with cell `index` switched on. Toggling cells
      // of the opening groove would not do — many of them are already on, so `setCell` returns
      // the same pattern and the requests are not distinct at all.
      setCell(createPattern(), Math.floor(index / STEP_COUNT), index % STEP_COUNT, true),
    );

    for (const pattern of patterns) {
      await service.run({ ...request, pattern });
    }

    expect(service.cacheSize).toBe(CACHE_LIMIT);

    // The most recent is still remembered, so asking for it again costs nothing.
    const before = calls.length;
    await service.run({ ...request, pattern: patterns[patterns.length - 1]! });
    expect(calls).toHaveLength(before);

    // The first has been dropped, so asking for it again asks the service.
    await service.run({ ...request, pattern: patterns[0]! });
    expect(calls.length).toBeGreaterThan(before);
  });

  it('keys on the whole pattern rather than a digest of it', () => {
    // A hash collision here would hand back somebody else's rhythm.
    const a = cacheKey({ ...request, pattern: GROOVE });
    const b = cacheKey({ ...request, pattern: setCell(GROOVE, 3, 3, true) });
    expect(a).not.toBe(b);
    expect(a).toContain('reverse');
  });

  it('remembers a failure not at all', async () => {
    const fake = fakeClient(() => new AplError('unavailable', 'nope'));
    const failing = new TransformService(fake.client);

    await expect(failing.run(request)).rejects.toBeInstanceOf(AplError);
    await expect(failing.run(request)).rejects.toBeInstanceOf(AplError);

    // Both asked. A failure is never cached, because the service may simply have been down.
    expect(fake.calls).toHaveLength(2);
    expect(failing.cacheSize).toBe(0);
  });
});

describe('a malformed reply', () => {
  const request = {
    operation: operationById('reverse'),
    target: 'all' as const,
    parameters: {},
    pattern: GROOVE,
  };

  it('is rejected, and nothing is cached', async () => {
    const fake = fakeClient(() => ['1 1 1']);
    const service = new TransformService(fake.client);

    await expect(service.run(request)).rejects.toBeInstanceOf(AplError);
    expect(service.cacheSize).toBe(0);
  });

  it('carries the reason as detail rather than in the message', async () => {
    // The visitor gets one sentence; the console gets the diagnosis.
    const fake = fakeClient(() => ['1 1 1']);
    const service = new TransformService(fake.client);

    await service.run(request).then(
      () => expect.fail('should have rejected'),
      (error: unknown) => {
        expect(error).toBeInstanceOf(AplError);
        if (error instanceof AplError) {
          expect(error.message).toContain('was not changed');
          expect(error.detail).toContain('rows');
        }
      },
    );
  });
});

describe('an impossible request', () => {
  it('never reaches the network', async () => {
    const fake = fakeClient(() => reply(GROOVE));
    const service = new TransformService(fake.client);

    // Euclidean replaces a row, so "all tracks" is refused before a request is built.
    await expect(
      service.run({
        operation: operationById('euclidean'),
        target: 'all',
        parameters: {},
        pattern: GROOVE,
      }),
    ).rejects.toBeInstanceOf(AplError);

    expect(fake.calls).toHaveLength(0);
  });
});

describe('staleness', () => {
  it('accepts a reply when the bar has not moved', () => {
    expect(isStillApplicable(GROOVE, createInitialGroove())).toBe(true);
  });

  it('rejects a reply when the bar has moved', () => {
    expect(isStillApplicable(GROOVE, setCell(GROOVE, 0, 1, true))).toBe(false);
  });

  it('accepts a reply when the bar has moved and come back', () => {
    /*
     * Compared by value rather than by a revision counter, deliberately. If the visitor edited
     * a cell and undid it, the pattern the request was based on is the pattern that exists — so
     * the answer is still correct and there is no reason to throw it away.
     */
    const edited = setCell(GROOVE, 0, 1, true);
    const undone = setCell(edited, 0, 1, false);
    expect(isStillApplicable(GROOVE, undone)).toBe(true);
  });
});

describe('the client itself', () => {
  /** A minimal Response, since jsdom has no streaming bodies worth using here. */
  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: new Headers({ 'content-length': '100' }),
      body: null,
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
  }

  const expression = '⎕IO←0 ⋄ 1';

  it('posts the expression to the endpoint and reads the lines back', async () => {
    /*
     * Given fetch's own parameters, so the recorded call can be read back.
     *
     * `vi.fn(() => …)` records calls of type `[]`, and destructuring one is a type error
     * rather than a value the test can assert on.
     */
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(['', 0, '', ['1 0', '0 1']])),
    );
    const client = new TryAplClient({ endpoint: 'https://example.test/Exec', fetchImpl });

    const result = await client.execute(expression);
    expect(result.outputLines).toEqual(['1 0', '0 1']);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://example.test/Exec');
    expect((init as RequestInit).method).toBe('POST');
    // No cookies, because there is no account and nothing to authenticate.
    expect((init as RequestInit).credentials).toBe('omit');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(['', 0, '', expression]);
  });

  it('reports an APL error that arrived with HTTP 200', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(['', 0, '', ['SYNTAX ERROR', '      ⌽⌽', '      ∧']])),
    );
    const client = new TryAplClient({ fetchImpl });

    await client.execute(expression).then(
      () => expect.fail('should have rejected'),
      (error: unknown) => {
        expect(error).toBeInstanceOf(AplError);
        if (error instanceof AplError) expect(error.kind).toBe('aplError');
      },
    );
  });

  it('reports an HTTP failure as the service being unavailable', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({}, 503)));
    const client = new TryAplClient({ fetchImpl });

    await client.execute(expression).then(
      () => expect.fail('should have rejected'),
      (error: unknown) => {
        if (error instanceof AplError) expect(error.kind).toBe('unavailable');
      },
    );
  });

  it('reports a network failure without guessing at the cause', async () => {
    // fetch rejects with a TypeError for DNS failure, a refused connection and a CORS
    // rejection alike; the browser deliberately does not say which.
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const client = new TryAplClient({ fetchImpl });

    await client.execute(expression).then(
      () => expect.fail('should have rejected'),
      (error: unknown) => {
        if (error instanceof AplError) expect(error.kind).toBe('unavailable');
      },
    );
  });

  it('times out rather than waiting for ever', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              // Chromium's behaviour: fetch rejects with whatever the signal was aborted with.
              const reason: unknown = init.signal?.reason;
              reject(reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError'));
            });
          }),
      );
      const client = new TryAplClient({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 50 });

      // The rejection handler is attached *before* the clock moves. Advancing timers first
      // would let the rejection happen with nothing listening, which Vitest reports as an
      // unhandled error rather than as the assertion it is.
      const settled = client.execute(expression).then(
        () => 'resolved' as const,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(60);

      const outcome = await settled;
      expect(outcome).toBeInstanceOf(AplError);
      if (outcome instanceof AplError) expect(outcome.kind).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still reports a timeout on an engine that drops the abort reason', async () => {
    /*
     * WebKit's behaviour, and a real defect this caught.
     *
     * `controller.abort(reason)` is supposed to make `fetch` reject *with that reason*.
     * Chromium does; WebKit rejects with a bare `AbortError` however it was aborted. Reading
     * the reason off the exception therefore made a timeout indistinguishable from a
     * supersede — and a supersede is deliberately silent, so a Safari visitor whose request
     * timed out was shown nothing at all. Found by the end-to-end suite on mobile-webkit.
     */
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              // The reason is deliberately ignored, exactly as WebKit ignores it.
              reject(new DOMException('Fetch is aborted', 'AbortError'));
            });
          }),
      );
      const client = new TryAplClient({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 50 });

      const settled = client.execute(expression).then(
        () => 'resolved' as const,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(60);

      const outcome = await settled;
      expect(outcome).toBeInstanceOf(AplError);
      if (outcome instanceof AplError) {
        expect(outcome.kind).toBe('timeout');
        expect(outcome.message).toContain('too long');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('a supersede on that same engine is still a supersede, not a timeout', async () => {
    // The other half of the pair: cancelling must stay silent, or every replaced transform
    // would put an error on screen.
    let abortHandler: (() => void) | null = null;
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          abortHandler = () => {
            reject(new DOMException('Fetch is aborted', 'AbortError'));
          };
          init?.signal?.addEventListener('abort', abortHandler);
        }),
    );
    const client = new TryAplClient({ fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 5000 });

    const settled = client.execute(expression).then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );
    client.cancel();

    const outcome = await settled;
    expect(outcome).toBeInstanceOf(AplError);
    if (outcome instanceof AplError) expect(outcome.kind).toBe('cancelled');
  });

  it('never retries', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const client = new TryAplClient({ fetchImpl });

    await client.execute(expression).catch(() => undefined);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses a source longer than the limit before sending anything', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(['', 0, '', ['1']])));
    const client = new TryAplClient({ fetchImpl, maxSourceLength: 10 });

    await client.execute('⌽'.repeat(50)).catch((error: unknown) => {
      if (error instanceof AplError) expect(error.kind).toBe('sourceTooLong');
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a reply larger than the limit', async () => {
    const huge = ['', 0, '', [Array.from({ length: 5000 }, () => '1').join(' ')]];
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: null,
        text: () => Promise.resolve(JSON.stringify(huge)),
      } as unknown as Response),
    );
    const client = new TryAplClient({ fetchImpl, maxResponseBytes: 100 });

    await client.execute(expression).then(
      () => expect.fail('should have rejected'),
      (error: unknown) => {
        if (error instanceof AplError) expect(error.kind).toBe('tooLarge');
      },
    );
  });

  it('reports invalid JSON without pasting the whole body into the message', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        body: null,
        text: () => Promise.resolve('<html>not json at all</html>'),
      } as unknown as Response),
    );
    const client = new TryAplClient({ fetchImpl });

    await client.execute(expression).then(
      () => expect.fail('should have rejected'),
      (error: unknown) => {
        expect(error).toBeInstanceOf(AplError);
        if (error instanceof AplError) {
          expect(error.kind).toBe('badResponse');
          expect(error.message).not.toContain('<html>');
        }
      },
    );
  });
});

describe('the shape of a pattern is never assumed', () => {
  it('is always eight by sixteen coming back', () => {
    expect(TRACK_COUNT).toBe(8);
    expect(STEP_COUNT).toBe(16);
  });
});
