/*
 * The only thing in APL Beats that makes a network request.
 *
 * Small on purpose. APL Art needs a general execution service with banded transport,
 * truncation detection and adaptive probing, because it renders pictures of unbounded size.
 * APL Beats sends one short expression and expects eight lines back, so all it needs is:
 * post, time out, abort, refuse anything oversized, and hand the lines up.
 *
 * The rules this file exists to enforce:
 *
 *   one request in flight at a time — a second Apply supersedes the first;
 *   a timeout, always;
 *   no retries, ever, of any kind;
 *   nothing sent but the expression.
 *
 * The last is worth being explicit about. The payload is `["", 0, "", expression]` and the
 * expression contains a matrix of ones and zeros and some digits. No mixer settings, no
 * stored session, no identity, no telemetry. There is nothing to send because there is
 * nothing to know.
 */

import { aplConfig } from './config';
import { aplErrorDetail, aplErrorIn, buildRequestPayload, parseWireResponse } from './wire';

/** Why a transform did not happen. Each maps to one sentence the visitor can act on. */
export type AplFailureKind =
  | 'offline'
  | 'timeout'
  | 'cancelled'
  | 'unavailable'
  | 'aplError'
  | 'badResponse'
  | 'tooLarge'
  | 'sourceTooLong';

export interface AplFailure {
  readonly kind: AplFailureKind;
  /** Shown in the interface. One sentence, and always says the beat is unchanged. */
  readonly message: string;
  /** For the console. May carry the raw detail the interface must not show. */
  readonly detail?: string | undefined;
}

export class AplError extends Error implements AplFailure {
  readonly kind: AplFailureKind;
  readonly detail: string | undefined;
  /**
   * What Dyalog said, when Dyalog is the one that objected.
   *
   * Empty for every other kind of failure. This is the part Explore shows to somebody who has
   * written their own expression: the error, the source and the caret, and nothing else.
   */
  readonly aplLines: readonly string[];

  constructor(kind: AplFailureKind, message: string, detail?: string, aplLines: readonly string[] = []) {
    super(detail === undefined ? message : `${message} (${detail})`);
    this.name = 'AplError';
    this.kind = kind;
    this.message = message;
    this.detail = detail;
    this.aplLines = aplLines;
  }
}

/**
 * What each failure says out loud.
 *
 * Every one of them ends by saying the beat was not changed, because that is the only thing
 * the visitor actually needs to know. None of them shows a server response: a wall of raw
 * error text in the middle of an instrument is noise, and the detail goes to the console for
 * whoever wants it.
 */
function failure(kind: AplFailureKind, detail?: string, aplLines: readonly string[] = []): AplError {
  const messages: Record<AplFailureKind, string> = {
    offline: 'You appear to be offline. Your beat was not changed.',
    timeout: 'APL took too long to answer. Your beat was not changed.',
    cancelled: 'That transform was replaced by a newer one.',
    unavailable: 'APL is unavailable right now. Your beat was not changed.',
    aplError: 'APL could not run that. Your beat was not changed.',
    badResponse: 'APL sent something unexpected. Your beat was not changed.',
    tooLarge: 'APL sent more than expected. Your beat was not changed.',
    sourceTooLong: 'That transform is too long to send. Your beat was not changed.',
  };

  return new AplError(kind, messages[kind], detail, aplLines);
}

export interface AplExecution {
  readonly outputLines: readonly string[];
  readonly durationMs: number;
}

export interface AplClient {
  /** Run one expression. Rejects with an `AplError` for every failure. */
  execute(expression: string, signal?: AbortSignal): Promise<AplExecution>;
  /** Abandon whatever is in flight. */
  cancel(): void;
}

export interface TryAplClientOptions {
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly maxSourceLength?: number;
  readonly maxResponseBytes?: number;
  /** Injected by tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export class TryAplClient implements AplClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxSourceLength: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  private inFlight: AbortController | null = null;

  constructor(options: TryAplClientOptions = {}) {
    this.endpoint = options.endpoint ?? aplConfig.endpoint;
    this.timeoutMs = options.timeoutMs ?? aplConfig.timeoutMs;
    this.maxSourceLength = options.maxSourceLength ?? aplConfig.maxSourceLength;
    this.maxResponseBytes = options.maxResponseBytes ?? aplConfig.maxResponseBytes;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  cancel(): void {
    this.inFlight?.abort(new DOMException('Superseded', 'AbortError'));
    this.inFlight = null;
  }

  async execute(expression: string, signal?: AbortSignal): Promise<AplExecution> {
    // Counted in code points, so a source full of APL glyphs is measured the way a person
    // would count it rather than in UTF-16 units.
    const length = [...expression].length;
    if (length > this.maxSourceLength) {
      throw failure(
        'sourceTooLong',
        `${String(length)} characters; the limit is ${String(this.maxSourceLength)}`,
      );
    }

    // A hint rather than a fact — the browser can be wrong both ways — but it turns a
    // confusing network error into a clear sentence when it is right.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw failure('offline');
    }

    // One at a time. A second Apply supersedes the first rather than racing it.
    this.cancel();

    const controller = new AbortController();
    this.inFlight = controller;

    /*
     * Why this request was abandoned, recorded here rather than read off the exception.
     *
     * `controller.abort(reason)` is meant to make `fetch` reject *with that reason*, and in
     * Chromium it does. WebKit rejects with a generic `AbortError` whatever the reason was —
     * so a timeout arrived looking exactly like a supersede, and a visitor on Safari whose
     * request timed out was told nothing at all. Keeping our own note is both simpler and
     * true everywhere.
     */
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Timeout', 'TimeoutError'));
    }, this.timeoutMs);

    const onExternalAbort = (): void => {
      controller.abort(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    const startedAt = Date.now();

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(buildRequestPayload(expression)),
        signal: controller.signal,
        // No cookies, no credentials. There is no account and nothing to authenticate.
        credentials: 'omit',
        mode: 'cors',
      });

      if (!response.ok) {
        throw failure('unavailable', `HTTP ${String(response.status)} ${response.statusText}`);
      }

      const text = await this.readBounded(response);

      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch {
        throw failure('badResponse', `the reply was not valid JSON: ${preview(text)}`);
      }

      const parsed = parseWireResponse(decoded);
      if (!parsed.ok) throw failure('badResponse', parsed.reason);

      /*
       * An APL error arrives as HTTP 200 with the error as ordinary output.
       *
       * This is the single most important thing about the wire format, and the reason a
       * status check is not enough. `LENGTH ERROR` and a caret come back looking exactly
       * like a successful reply as far as HTTP is concerned.
       */
      const aplError = aplErrorIn(parsed.response.outputLines);
      if (aplError !== null) {
        throw failure('aplError', aplError, aplErrorDetail(parsed.response.outputLines));
      }

      return { outputLines: parsed.response.outputLines, durationMs: Date.now() - startedAt };
    } catch (error) {
      throw this.asAplError(error, timedOut);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  /**
   * Read the body, counting bytes, and stop at the limit.
   *
   * Counted in bytes off the stream rather than in characters after decoding, because APL
   * glyphs are two or three bytes each — a reply well past the limit can measure comfortably
   * inside it if you count `String.length`. `Content-Length` is an early rejection when it
   * is honest and is not relied on otherwise.
   */
  private async readBounded(response: Response): Promise<string> {
    const declared = response.headers.get('content-length');
    if (declared !== null) {
      const size = Number(declared);
      if (Number.isFinite(size) && size > this.maxResponseBytes) {
        throw failure('tooLarge', `the service declared ${String(size)} bytes`);
      }
    }

    const body = response.body;
    if (body === null || typeof body.getReader !== 'function') {
      // No stream to read — an environment without streaming bodies. The body has already
      // arrived, so all that can be done now is refuse to hand on more than the limit.
      const text = await response.text();
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > this.maxResponseBytes) throw failure('tooLarge', `${String(bytes)} bytes`);
      return text;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;

        received += value.byteLength;
        if (received > this.maxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          throw failure('tooLarge', `${String(received)} bytes`);
        }

        // Streaming decode, so a multi-byte glyph split across two chunks is rejoined
        // rather than becoming a replacement character.
        text += decoder.decode(value, { stream: true });
      }

      text += decoder.decode();
      return text;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Already released by cancel(), or by the stream ending. Unremarkable.
      }
    }
  }

  /** Whatever went wrong, as one of the named failures. */
  private asAplError(error: unknown, timedOut = false): AplError {
    if (error instanceof AplError) return error;

    // Our own note first, because not every engine hands the abort reason to fetch.
    if (timedOut) return failure('timeout');

    // Abort reasons are DOMExceptions, which are not Error subclasses in a browser, so the
    // name is read rather than tested with instanceof.
    switch (nameOf(error)) {
      case 'TimeoutError':
        return failure('timeout');
      case 'AbortError':
        return failure('cancelled');
      default:
        break;
    }

    // fetch rejects with a TypeError for DNS failure, a refused connection and a CORS
    // rejection alike; the browser deliberately does not say which.
    if (error instanceof TypeError) {
      return failure(
        'unavailable',
        `the request to ${this.endpoint} could not be completed: ${error.message}`,
      );
    }

    return failure('badResponse', error instanceof Error ? error.message : String(error));
  }
}

function nameOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('name' in error)) return '';
  const { name } = error;
  return typeof name === 'string' ? name : '';
}

function preview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}
