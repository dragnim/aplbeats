import type { ResolvedTheme } from '@/app/theme';
import styles from './ThemeToggle.module.css';

/*
 * Dark or light, in one button.
 *
 * Two things it deliberately is not. It is not an icon on its own — the icon says which theme is
 * *coming*, and an icon alone leaves that ambiguous even to somebody who can see it perfectly
 * well, so the accessible name says it in words. And it is not a three-state control cycling
 * through system/dark/light: the middle state would look identical to whichever theme it
 * resolved to, and a control you cannot read the state of is worse than one with fewer states.
 *
 * Following the system is still the starting state and still what a first visit gets; it is just
 * not somewhere this button can return to. See `src/app/theme.ts`.
 */

export interface ThemeToggleProps {
  readonly resolved: ResolvedTheme;
  readonly onToggle: () => void;
}

export function ThemeToggle({ resolved, onToggle }: ThemeToggleProps): React.JSX.Element {
  const next = resolved === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={onToggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {/*
        Drawn rather than fetched, and drawn with `currentColor`, so it costs no request and
        needs no second copy for the other theme. `aria-hidden` because the button's name
        already says what it does; announcing the glyph as well would say it twice.
      */}
      <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        {resolved === 'dark' ? (
          // Going to light: show the sun you would be switching on.
          <>
            <circle cx="10" cy="10" r="4" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="10" y1="1.5" x2="10" y2="3.5" />
              <line x1="10" y1="16.5" x2="10" y2="18.5" />
              <line x1="1.5" y1="10" x2="3.5" y2="10" />
              <line x1="16.5" y1="10" x2="18.5" y2="10" />
              <line x1="4" y1="4" x2="5.4" y2="5.4" />
              <line x1="14.6" y1="14.6" x2="16" y2="16" />
              <line x1="4" y1="16" x2="5.4" y2="14.6" />
              <line x1="14.6" y1="5.4" x2="16" y2="4" />
            </g>
          </>
        ) : (
          // Going to dark: a crescent, cut from one circle by another.
          <path fill="currentColor" d="M15.6 12.6A6.6 6.6 0 0 1 7.4 4.4a6.6 6.6 0 1 0 8.2 8.2Z" />
        )}
      </svg>
      <span className={styles.label}>{resolved === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
