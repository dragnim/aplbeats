/*
 * Which theme, and how it is decided.
 *
 * Three states, not two, and the third is the important one. A visitor who has never touched the
 * toggle is `system`: their operating system decides, and it goes on deciding if they change it
 * while the tab is open. Pressing the toggle makes the choice `dark` or `light` explicitly, and
 * from then on the system is not consulted again.
 *
 * That distinction is why the stored value is a *choice* rather than a resolved theme. Writing
 * "dark" the moment somebody with a dark system first loads the page would silently opt them
 * out of ever following their system again, which is not something a page they have not
 * interacted with is entitled to do.
 *
 * The CSS does the same three-way decision on its own — `:root` is dark, a light system
 * preference switches it, and `data-theme` overrides both. That duplication is deliberate and
 * load-bearing: the Content-Security-Policy is `script-src 'self'`, so there is no inline script
 * that could set the attribute before first paint. CSS therefore has to get the untouched case
 * right by itself, and this module only ever writes the attribute when there is an explicit
 * choice to write. See `src/styles/tokens.css`.
 *
 * Stored under its own key, like every other preference in this application. Which theme
 * somebody wants has nothing to do with their groove, their drum machine or their APL, and
 * losing it because one of those became invalid would be losing it for no reason.
 */

/** The three states a theme preference can be in. */
export type ThemeChoice = 'system' | 'dark' | 'light';

/** What a choice resolves to once the system has been consulted. */
export type ResolvedTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'aplbeats.theme.v1';
const THEME_SCHEMA_VERSION = 1;

/** The key, exported so tests can assert on it rather than guess it. */
export const THEME_KEY = THEME_STORAGE_KEY;

/**
 * The theme when nothing else has an opinion.
 *
 * Dark, and it is not an arbitrary default: the sequencer's whole active-state language — a lit
 * step, a struck highlight, a cool playhead — was designed against a dark stage. A browser that
 * reports no colour preference gets the interface as it was drawn.
 */
export const DEFAULT_THEME: ResolvedTheme = 'dark';

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'dark' || value === 'light';
}

/**
 * The stored choice, or `system`.
 *
 * Every failure resolves to `system` rather than to a theme. A corrupt value is not a reason to
 * override somebody's operating system.
 */
export function loadThemeChoice(): ThemeChoice {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
    if (raw === null) return 'system';

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return 'system';

    const record = parsed as Record<string, unknown>;
    if (record.schema !== THEME_SCHEMA_VERSION) return 'system';
    return isThemeChoice(record.choice) ? record.choice : 'system';
  } catch {
    return 'system';
  }
}

/** Remember the choice. Touches this key and no other. */
export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') {
      // Back to following the system is the *absence* of a preference, not a third value to
      // store. Removing it means a later visit is indistinguishable from a first one.
      globalThis.localStorage?.removeItem(THEME_STORAGE_KEY);
      return;
    }
    globalThis.localStorage?.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ schema: THEME_SCHEMA_VERSION, choice }),
    );
  } catch {
    // Private browsing, a full quota, storage disabled by policy. Nothing to be done, and the
    // theme still works for this session.
  }
}

/** What the operating system is asking for, or the default if it will not say. */
export function systemTheme(): ResolvedTheme {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches === true
      ? 'light'
      : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

/**
 * Put the choice on the document, or take it off.
 *
 * `system` removes the attribute rather than writing a resolved value, which is what hands the
 * decision back to the media query in the stylesheet. Writing `data-theme="light"` for a
 * light-system visitor would look identical and would then *stay* light if they switched their
 * system to dark with the tab open.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = globalThis.document?.documentElement;
  if (root === undefined) return;

  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/**
 * The choice the toggle should move to next.
 *
 * Two visible states, three internal ones. Somebody following their system and pressing the
 * toggle means "not that one" — so it resolves what they are looking at and gives them the
 * other, explicitly. There is no way back to `system` from the toggle, deliberately: a
 * three-state control whose middle state looks like one of the other two is a control nobody can
 * read. Clearing the stored key restores it, which is what `clearSession` does.
 */
export function nextThemeChoice(choice: ThemeChoice): ResolvedTheme {
  return resolveTheme(choice) === 'dark' ? 'light' : 'dark';
}
