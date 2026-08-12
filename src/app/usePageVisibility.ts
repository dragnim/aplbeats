import { useEffect, useState } from 'react';

/**
 * Whether the document is currently on screen.
 *
 * Everything APL Beats does while playing — a scheduler timer, an animation frame
 * loop, an open audio device — is work the visitor asked for while they are
 * looking at it, and work they did not ask for the moment they are not. This hook
 * is how the rest of the application finds out which.
 */
export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState !== 'hidden';
  });

  useEffect(() => {
    const update = (): void => {
      setIsVisible(document.visibilityState !== 'hidden');
    };

    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return isVisible;
}
