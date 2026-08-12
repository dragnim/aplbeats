/// <reference types="vite/client" />

/**
 * The build-time environment APL Beats reads.
 *
 * Declared so `import.meta.env` is typed rather than `any` — which matters here more than it
 * usually would, because the one variable in it decides where APL runs. An untyped read of an
 * endpoint is exactly the sort of thing that should not be possible.
 *
 * Only `src/apl/config.ts` and `vite.config.ts` read these.
 */
interface ImportMetaEnv {
  /** Where APL is executed. Defaults to https://tryapl.org/Exec. HTTPS, or loopback. */
  readonly VITE_APL_EXEC_ENDPOINT?: string;
  /** How long one transform may take before it is abandoned, in milliseconds. */
  readonly VITE_APL_TIMEOUT_MS?: string;
  /** The published base path, set by the Pages workflow. */
  readonly VITE_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
