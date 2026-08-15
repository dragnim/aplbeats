import { useLayoutEffect, useRef, useState } from 'react';
import { cx } from '@/app/cx';
import { WORKSPACES, type WorkspaceId } from './workspaces';
import styles from './WorkspaceRail.module.css';

/*
 * The four workspaces, and how you get between them.
 *
 * Stage 6 left APL Beats as four stacked cards on a long page: the local generator, Create,
 * Transform, and the Explore editor, each below the last, with the sequencer at the top and the
 * APL a scroll away from the beat it changes. This is what replaced that. One of the four is
 * open at a time, beside the grid rather than beneath it, and this rail is how you choose.
 *
 * **Not mystery meat.** Every button carries its word, not only its glyph — on the desktop rail
 * the label sits under the icon, and on mobile the same components become a scrolling tab strip
 * with the words still there. The icons are drawn from `currentColor` rather than fetched, so
 * they cost nothing and need no second set for the light theme.
 *
 * The tab semantics are the real ones: `role="tablist"`, `role="tab"`, `aria-selected`, and
 * `aria-controls` pointing at the panel each opens. Arrow keys move between tabs the way the
 * pattern says they should, because a tablist that only responds to Tab is a tablist in costume.
 * Selection is never signalled by colour alone: the active tab gets a bar, a filled surface and
 * `aria-selected`, any one of which would be enough on its own.
 */

/** The icons, drawn rather than fetched. Each says something about its workspace. */
function Icon({ id }: { readonly id: WorkspaceId }): React.JSX.Element {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {id === 'play' && (
        /* Four pads: the grid, and the thing you press. */
        <g fill="currentColor">
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="3" width="8" height="8" rx="2" opacity="0.45" />
          <rect x="3" y="13" width="8" height="8" rx="2" opacity="0.45" />
          <rect x="13" y="13" width="8" height="8" rx="2" />
        </g>
      )}
      {id === 'create' && (
        /* A spark: something where there was nothing. */
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <path d="M6.4 6.4 9 9M15 15l2.6 2.6M17.6 6.4 15 9M9 15l-2.6 2.6" opacity="0.5" />
          <circle cx="12" cy="12" r="3.1" fill="currentColor" stroke="none" />
        </g>
      )}
      {id === 'transform' && (
        /* Two arrows round a cycle: the same thing, moved. */
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9a8 8 0 0 1 13.3-3.3L20 8" />
          <path d="M20 15a8 8 0 0 1-13.3 3.3L4 16" />
          <path d="M20 4v4h-4M4 20v-4h4" />
        </g>
      )}
      {id === 'explore' && (
        /* Angle brackets: somebody else's code becoming yours. */
        <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="m8.5 8-4.5 4 4.5 4" />
          <path d="m15.5 8 4.5 4-4.5 4" />
          <path d="M13.2 5.5 10.8 18.5" opacity="0.55" />
        </g>
      )}
    </svg>
  );
}

/**
 * Which way the rail is actually lying, according to the stylesheet.
 *
 * `aria-orientation` is a claim about what is on screen, and until this existed the rail claimed
 * `vertical` in both of its shapes — including on a phone, where the CSS turns it into a
 * horizontal strip. That is the sort of mismatch a screen-reader user meets as arrow keys behaving
 * unlike every other tab strip they have used.
 *
 * The obvious fix is to `matchMedia` the same width in React. This does not, deliberately: two
 * copies of `61.9375rem` in two languages is a value that drifts the first time somebody adjusts
 * one of them. Instead the stylesheet declares `--rail-orientation` inside the same media query
 * that turns the flex direction, and this reads it back — so the ARIA and the layout cannot
 * disagree, because there is only one decision.
 *
 * A `ResizeObserver` rather than a resize listener: crossing the breakpoint always changes the
 * rail's own box, and observing the element means no work at all while nothing moves. Where the
 * observer is missing the value is read once and stays — never wrong, just not live.
 */
function useRenderedOrientation(element: React.RefObject<HTMLElement | null>): 'horizontal' | 'vertical' {
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('vertical');

  useLayoutEffect(() => {
    const node = element.current;
    if (node === null) return;

    const read = (): void => {
      const declared = getComputedStyle(node).getPropertyValue('--rail-orientation').trim();
      setOrientation(declared === 'horizontal' ? 'horizontal' : 'vertical');
    };

    read();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [element]);

  return orientation;
}

export interface WorkspaceRailProps {
  readonly active: WorkspaceId;
  readonly onSelect: (id: WorkspaceId) => void;
  /** Prefix for the `aria-controls` ids, so tabs and panels agree. */
  readonly panelIds: string;
}

export function WorkspaceRail({ active, onSelect, panelIds }: WorkspaceRailProps): React.JSX.Element {
  const rail = useRef<HTMLDivElement | null>(null);
  const orientation = useRenderedOrientation(rail);

  /**
   * Arrow keys, as a tablist is supposed to.
   *
   * Wrapping at both ends, and Home/End for the ends themselves. Selection follows focus, which
   * is the right choice here because switching costs nothing — no request, no work, just a
   * different panel — so making somebody press Enter as well would be ceremony.
   *
   * Both axes work in both orientations, deliberately. The tab pattern pairs up/down with a
   * vertical list and left/right with a horizontal one, and narrowing this to match
   * `aria-orientation` would be *correct* and would also mean the rail stopped responding to keys
   * it had been responding to a moment earlier, at whatever width the window happened to cross.
   * Accepting the other axis as well costs nothing and surprises nobody.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    const step = keys[event.key];

    let index: number | null = null;
    const at = WORKSPACES.findIndex((workspace) => workspace.id === active);

    if (step !== undefined) index = (at + step + WORKSPACES.length) % WORKSPACES.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = WORKSPACES.length - 1;
    if (index === null) return;

    event.preventDefault();
    const next = WORKSPACES[index];
    if (next !== undefined) onSelect(next.id);
  };

  return (
    <div
      ref={rail}
      className={styles.rail}
      role="tablist"
      aria-label="Workspace"
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
    >
      {WORKSPACES.map((workspace) => {
        const selected = workspace.id === active;
        return (
          <button
            key={workspace.id}
            type="button"
            role="tab"
            id={`${panelIds}-tab-${workspace.id}`}
            aria-selected={selected}
            aria-controls={`${panelIds}-panel-${workspace.id}`}
            /*
             * Only the selected tab is in the tab order; the arrow keys reach the others. That
             * is the roving-tabindex the tablist pattern asks for, and it is why Tab from the
             * transport lands on the workspace rather than walking four buttons first.
             */
            tabIndex={selected ? 0 : -1}
            className={cx(styles.tab, selected && styles.tabActive)}
            onClick={() => {
              onSelect(workspace.id);
            }}
            title={workspace.hint}
          >
            <span aria-hidden="true" className={styles.marker} />
            <Icon id={workspace.id} />
            <span className={styles.label}>{workspace.label}</span>
          </button>
        );
      })}
    </div>
  );
}
