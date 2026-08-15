import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  loadThemeChoice,
  nextThemeChoice,
  resolveTheme,
  saveThemeChoice,
  type ResolvedTheme,
  type ThemeChoice,
} from './theme';

export interface ThemeApi {
  /** What the visitor asked for, including having asked for nothing. */
  readonly choice: ThemeChoice;
  /** What they are actually looking at. */
  readonly resolved: ResolvedTheme;
  /** Swap to the other one, explicitly. */
  readonly toggle: () => void;
  /** Choose outright. Used by tests, and by nothing in the interface yet. */
  readonly set: (choice: ThemeChoice) => void;
}

/**
 * The theme, applied to the document and remembered.
 *
 * Two effects and neither of them polls. The first writes the choice to the root element; the
 * second listens for the operating system changing its mind, and only while the choice is
 * `system` — a visitor who has picked a theme should not have it moved underneath them because
 * their machine got to sunset.
 *
 * The initial state is read synchronously in the initialiser rather than in an effect, so the
 * first render already knows the answer. It does not need to *apply* it that early — the
 * stylesheet's own media query covers the untouched case before any JavaScript runs — but the
 * toggle has to render pointing the right way, and a control that flips a frame after paint
 * reads as a bug.
 */
export function useTheme(): ThemeApi {
  const [choice, setChoice] = useState<ThemeChoice>(() => loadThemeChoice());
  const [system, setSystem] = useState<ResolvedTheme>(() => resolveTheme('system'));

  useEffect(() => {
    applyTheme(choice);
  }, [choice]);

  useEffect(() => {
    if (choice !== 'system') return;

    const query = globalThis.matchMedia?.('(prefers-color-scheme: light)');
    if (query === undefined) return;

    const onChange = (): void => {
      setSystem(resolveTheme('system'));
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, [choice]);

  const set = useCallback((next: ThemeChoice) => {
    setChoice(next);
    saveThemeChoice(next);
  }, []);

  const toggle = useCallback(() => {
    setChoice((current) => {
      const next = nextThemeChoice(current);
      saveThemeChoice(next);
      return next;
    });
  }, []);

  // `system` is in the dependency chain so a change to the OS re-resolves while following it.
  const resolved = choice === 'system' ? system : choice;

  return { choice, resolved, toggle, set };
}
