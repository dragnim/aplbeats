import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  DEFAULT_THEME,
  loadThemeChoice,
  nextThemeChoice,
  resolveTheme,
  saveThemeChoice,
  systemTheme,
  THEME_KEY,
} from '@/app/theme';

/*
 * Which theme, and who decided.
 *
 * The subtle part is the three states. A visitor who has never pressed the toggle is `system` and
 * must *stay* `system` — writing "dark" for somebody whose machine happens to be dark would opt
 * them out of ever following it again, silently, on a page they had not interacted with.
 *
 * The other half of the design lives in CSS: `:root` is dark, a light system preference switches
 * it, and `data-theme` overrides both. That split exists because the Content-Security-Policy
 * forbids an inline script, so nothing can set the attribute before first paint and the
 * stylesheet has to get the untouched case right on its own.
 */

/** Drive `prefers-color-scheme` the way a browser would. */
function systemPrefers(scheme: 'dark' | 'light'): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('light') && scheme === 'light',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------------- */

describe('the default', () => {
  it('is dark', () => {
    /*
     * Not arbitrary. The sequencer's whole active-state language — a lit step, a struck
     * highlight, a cool playhead — was designed against a dark stage.
     */
    expect(DEFAULT_THEME).toBe('dark');
  });

  it('is what a browser with no colour preference gets', () => {
    systemPrefers('dark');
    expect(systemTheme()).toBe('dark');
    expect(resolveTheme('system')).toBe('dark');
  });

  it('gives way to a system that asks for light', () => {
    systemPrefers('light');
    expect(systemTheme()).toBe('light');
    expect(resolveTheme('system')).toBe('light');
  });

  it('survives a browser with no matchMedia at all', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(systemTheme()).toBe('dark');
  });
});

describe('a first visit', () => {
  it('has no stored choice, and follows the system', () => {
    expect(loadThemeChoice()).toBe('system');
  });

  it('writes nothing to storage merely by being resolved', () => {
    systemPrefers('light');
    expect(resolveTheme(loadThemeChoice())).toBe('light');
    // The important half: resolving is not choosing.
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('leaves the document alone, so the stylesheet decides', () => {
    /*
     * `system` removes the attribute rather than writing a resolved value. Writing
     * `data-theme="light"` for a light-system visitor would look identical and would then *stay*
     * light if they switched their system to dark with the tab open.
     */
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('an explicit choice', () => {
  it('round-trips', () => {
    saveThemeChoice('light');
    expect(loadThemeChoice()).toBe('light');
    saveThemeChoice('dark');
    expect(loadThemeChoice()).toBe('dark');
  });

  it('overrides the system in both directions', () => {
    systemPrefers('light');
    expect(resolveTheme('dark')).toBe('dark');
    systemPrefers('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it('goes on the document, where the stylesheet can see it', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('is removed, not recorded, when it goes back to following the system', () => {
    saveThemeChoice('light');
    saveThemeChoice('system');
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    expect(loadThemeChoice()).toBe('system');
  });
});

describe('the toggle', () => {
  it('gives the other one, whichever way round it starts', () => {
    expect(nextThemeChoice('dark')).toBe('light');
    expect(nextThemeChoice('light')).toBe('dark');
  });

  it('resolves the system first, so pressing it means "not that one"', () => {
    systemPrefers('light');
    expect(nextThemeChoice('system')).toBe('dark');
    systemPrefers('dark');
    expect(nextThemeChoice('system')).toBe('light');
  });
});

describe('a stored value that cannot be trusted', () => {
  it('falls back to following the system rather than to a theme', () => {
    // A corrupt value is not a reason to override somebody's operating system.
    for (const raw of [
      'not json',
      'null',
      '[]',
      JSON.stringify({ schema: 99, choice: 'light' }),
      JSON.stringify({ schema: 1, choice: 'sepia' }),
      JSON.stringify({ schema: 1 }),
    ]) {
      window.localStorage.setItem(THEME_KEY, raw);
      expect(loadThemeChoice(), raw).toBe('system');
    }
  });
});

describe('its own key', () => {
  it('is the one it is named for, and no other', () => {
    /*
     * Five keys before this and a bug in Stage 5.1 where one save reached into another's. Which
     * theme somebody wants has nothing to do with their groove, their kit or their APL.
     */
    window.localStorage.setItem('aplbeats.session.v1', 'session');
    window.localStorage.setItem('aplbeats.master-volume.v1', 'volume');
    window.localStorage.setItem('aplbeats.explore.v1', 'draft');

    saveThemeChoice('light');
    saveThemeChoice('system');

    expect(window.localStorage.getItem('aplbeats.session.v1')).toBe('session');
    expect(window.localStorage.getItem('aplbeats.master-volume.v1')).toBe('volume');
    expect(window.localStorage.getItem('aplbeats.explore.v1')).toBe('draft');
  });

  it('is the documented one', () => {
    expect(THEME_KEY).toBe('aplbeats.theme.v1');
  });
});
