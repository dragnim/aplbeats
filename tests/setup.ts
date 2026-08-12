import '@testing-library/jest-dom/vitest';

/*
 * jsdom has no Web Audio, no layout and no animation frames worth the name, so the
 * tests that run here are the ones that do not need them: the pattern model, the
 * mixer, the timing arithmetic, the scheduler driven by an injected clock, and the
 * grid's interaction and accessibility behaviour.
 *
 * What is left over — that the kit sounds good, and that Web Audio places the notes
 * where the scheduler asked — is verified in a real browser. The first of those is
 * a judgement no test can make; the second is checked by the end-to-end suite
 * loading the application and by listening.
 */

// `matchMedia` is used for reduced motion and pointer type and is absent in jsdom.
// A stub that reports no preference is the right default: it is what a plain
// desktop browser reports, and any test that cares overrides it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
