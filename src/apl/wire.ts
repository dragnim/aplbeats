/*
 * The TryAPL `Exec` wire format.
 *
 * Verified against the live service. A request is a JSON array whose fourth item is the
 * expression; the reply is a JSON array whose fourth item is an array of output lines:
 *
 *     -->  ["", 0, "", "3 3⍴⍳9"]
 *     <--  ["<state>", 4834, "<blob>", ["1 2 3", "4 5 6", "7 8 9"]]
 *
 * Items 1 and 2 are opaque. Item 0 is the session state, and sending an empty string starts
 * a clean workspace — which is what every request here does, because sending a returned
 * state back answers `CORRUPT WS: Workspace was reset`. Nothing can be assigned in one
 * request and read in the next, which suits this application exactly: a transform carries
 * its own matrix and needs no memory.
 *
 * The one thing worth knowing above all others: **an APL error arrives as HTTP 200.** It
 * comes back as ordinary output lines — `LENGTH ERROR`, the echoed source, a caret — so
 * failure is detected by reading the output, never by the status code.
 *
 * Everything here treats the reply as untrusted input.
 */

/** A clean workspace. */
export const FRESH_STATE = '';

/** Statement separator. Diamond, not the similar-looking lozenge. */
export const DIAMOND = '⋄';

export type RequestPayload = readonly [state: string, sequence: number, reserved: string, expression: string];

/**
 * The payload for one expression.
 *
 * TryAPL evaluates exactly one expression per request, so a transform's several statements
 * are joined with `⋄` before they get here. See `buildTransformSource`.
 */
export function buildRequestPayload(expression: string): RequestPayload {
  return [FRESH_STATE, 0, '', expression];
}

export interface WireResponse {
  readonly state: string;
  readonly outputLines: readonly string[];
}

export type WireParseResult =
  { readonly ok: true; readonly response: WireResponse } | { readonly ok: false; readonly reason: string };

/**
 * Validates and narrows a decoded JSON reply.
 *
 * Nothing about the shape is assumed. A reply that does not match is a stated failure
 * rather than an exception thrown from somewhere further in.
 */
export function parseWireResponse(payload: unknown): WireParseResult {
  if (!Array.isArray(payload)) {
    return { ok: false, reason: `expected a JSON array, received ${describe(payload)}` };
  }

  if (payload.length < 4) {
    return { ok: false, reason: `expected at least 4 items, received ${String(payload.length)}` };
  }

  const state: unknown = payload[0];
  const output: unknown = payload[3];

  if (typeof state !== 'string') {
    return { ok: false, reason: `expected item 0 to be the state string, received ${describe(state)}` };
  }

  // Normally an array of lines. A bare string is tolerated in case the service ever
  // collapses single-line output.
  if (typeof output === 'string') {
    return { ok: true, response: { state, outputLines: output.split('\n') } };
  }

  if (!Array.isArray(output)) {
    return { ok: false, reason: `expected item 3 to be the output lines, received ${describe(output)}` };
  }

  const outputLines: string[] = [];
  for (const line of output) {
    if (typeof line !== 'string') {
      return { ok: false, reason: `expected every output line to be a string, found ${describe(line)}` };
    }
    outputLines.push(line);
  }

  return { ok: true, response: { state, outputLines } };
}

/**
 * The APL errors this application could plausibly provoke.
 *
 * Detected by name rather than by scanning for anything alarming, because the *data* coming
 * back is digits and a false positive would reject a perfectly good rhythm. If a transform
 * ever produces an error outside this list it will be reported as a malformed reply, which
 * is the correct outcome either way — the matrix could not be read.
 */
const APL_ERRORS = [
  'SYNTAX ERROR',
  'DOMAIN ERROR',
  'LENGTH ERROR',
  'RANK ERROR',
  'INDEX ERROR',
  'VALUE ERROR',
  'WS FULL',
  'LIMIT ERROR',
  'NONCE ERROR',
  'CORRUPT WS',
  'NOT SUPPORTED',
] as const;

/** The APL error named in this output, if it is an error at all. */
export function aplErrorIn(outputLines: readonly string[]): string | null {
  for (const line of outputLines) {
    const trimmed = line.trim();
    for (const name of APL_ERRORS) {
      if (trimmed.startsWith(name)) return trimmed;
    }
  }
  return null;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${String(value.length)}`;
  return typeof value;
}
