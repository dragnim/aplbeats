/*
 * Where APL runs, and the limits placed on it.
 *
 * One module reads `import.meta.env`; nothing else in the application knows the endpoint
 * exists. That matters more here than it would elsewhere, because "how many places can
 * reach TryAPL from" is a question this project has promised to be able to answer.
 */

/** The TryAPL execution endpoint. Overridable so a proxy can be developed against. */
const DEFAULT_ENDPOINT = 'https://tryapl.org/Exec';

/**
 * How long one transform may take before it is abandoned.
 *
 * Measured round trips to TryAPL are 35–175 ms. Six seconds is therefore not a
 * performance budget but a patience limit: past it, something is wrong and the visitor
 * should be told rather than left watching.
 */
const DEFAULT_TIMEOUT_MS = 6_000;

/**
 * Ceiling on the source sent, in code points.
 *
 * A transform is a serialised 8 × 16 matrix and one short expression — about three hundred
 * characters. Two thousand is far more than that and far less than anything that could be
 * mistaken for an attempt to smuggle a program through.
 */
const MAX_SOURCE_LENGTH = 2_000;

/**
 * Ceiling on the reply, in bytes.
 *
 * The matrix itself is eight lines of sixteen digits — under four hundred bytes — but a real
 * reply measures about five kilobytes, because item 0 is an opaque session-state blob of
 * some four thousand characters that this application never uses and never sends back.
 * Sixty-four kilobytes therefore leaves a comfortable margin over what is actually observed
 * while still refusing to buffer anything unreasonable from an endpoint that is not ours.
 */
const MAX_RESPONSE_BYTES = 65_536;

export interface AplConfig {
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly maxSourceLength: number;
  readonly maxResponseBytes: number;
}

const env: Partial<ImportMetaEnv> = typeof import.meta.env === 'undefined' ? {} : import.meta.env;

/**
 * A configured endpoint, or the default.
 *
 * HTTPS only, because the site is served over HTTPS and a plain-HTTP endpoint would be
 * blocked as mixed content — better to refuse it here with a reason than to have the
 * browser refuse it later without one. Loopback is allowed so a local proxy can be worked
 * on.
 */
function readEndpoint(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return DEFAULT_ENDPOINT;

  try {
    const url = new URL(raw);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !loopback) {
      console.warn(`[apl] The execution endpoint must use HTTPS; using ${DEFAULT_ENDPOINT}.`);
      return DEFAULT_ENDPOINT;
    }
    return url.toString();
  } catch {
    console.warn(`[apl] The execution endpoint is not a valid URL; using ${DEFAULT_ENDPOINT}.`);
    return DEFAULT_ENDPOINT;
  }
}

function readPositive(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`[apl] Ignoring invalid numeric value ${JSON.stringify(raw)}; using ${String(fallback)}.`);
    return fallback;
  }
  return value;
}

export const aplConfig: AplConfig = Object.freeze({
  endpoint: readEndpoint(env.VITE_APL_EXEC_ENDPOINT),
  timeoutMs: readPositive(env.VITE_APL_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  maxSourceLength: MAX_SOURCE_LENGTH,
  maxResponseBytes: MAX_RESPONSE_BYTES,
});
