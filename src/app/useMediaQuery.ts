import { useEffect, useState } from 'react';

/**
 * Whether a media query matches, kept in step with the browser.
 *
 * `useState` with a function initialiser rather than an effect that sets state on
 * mount, so the very first render is already correct. A component that renders
 * animated and then corrects itself has already animated.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const list = window.matchMedia(query);
    const update = (): void => {
      setMatches(list.matches);
    };

    update();
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);

  return matches;
}

/**
 * Whether the visitor has asked for less movement.
 *
 * Consulted by the sequencer rather than left entirely to CSS, because reduced
 * motion here is not only about turning transitions off: the playhead still has to
 * be unmistakable without moving, which is a different design rather than the same
 * one held still.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** Whether the primary pointer is a finger. Used to size targets and to skip hover affordances. */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
