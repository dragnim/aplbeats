import { cx } from '@/app/cx';
import { DOMAINS, type Domain } from './workspaces';
import styles from './DomainTabs.module.css';

/*
 * Beats, or Tones.
 *
 * The one new piece of navigation Stage 8 adds, and it sits above everything else because it is
 * the biggest question the interface asks: which layer of the music are you working on? Below it,
 * the whole of Stage 7 continues to work exactly as it did — the rail, the four workspaces, the
 * panel beside the grid — only pointed at a different kind of data.
 *
 * **Switching is free, and that is a guarantee rather than an optimisation.** No request, no
 * fetch, no execution, no transport change. Both layers go on sounding while you look at either
 * one; the drums do not pause because you went to write a melody, and the melody does not stop
 * because you went back to the kick. Anything else would make the tabs a mode, and modes in a
 * musical instrument are how you lose a take.
 *
 * A real tablist, like the rail: `role="tablist"`, `aria-selected`, `aria-controls`, roving
 * `tabindex`, and Left/Right/Home/End. Horizontal in both senses — it is drawn as a horizontal
 * strip at every width, so `aria-orientation` is simply `horizontal` and needs none of the
 * measuring the rail has to do.
 *
 * Each tab carries the APL variable its layer is: `m` for the Boolean matrix, `n` for the numeric
 * vector. Two characters, doing the teaching that a paragraph would otherwise have to.
 */

export interface DomainTabsProps {
  readonly active: Domain;
  readonly onSelect: (domain: Domain) => void;
  /** Prefix for the `aria-controls` ids, so tabs and the region they govern agree. */
  readonly panelIds: string;
}

export function DomainTabs({ active, onSelect, panelIds }: DomainTabsProps): React.JSX.Element {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    const step = keys[event.key];

    let index: number | null = null;
    const at = DOMAINS.findIndex((domain) => domain.id === active);

    if (step !== undefined) index = (at + step + DOMAINS.length) % DOMAINS.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = DOMAINS.length - 1;
    if (index === null) return;

    event.preventDefault();
    const next = DOMAINS[index];
    if (next !== undefined) onSelect(next.id);
  };

  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label="Layer"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
    >
      {DOMAINS.map((domain) => {
        const selected = domain.id === active;
        return (
          <button
            key={domain.id}
            type="button"
            role="tab"
            id={`${panelIds}-domain-tab-${domain.id}`}
            aria-selected={selected}
            aria-controls={`${panelIds}-domain-panel-${domain.id}`}
            tabIndex={selected ? 0 : -1}
            className={cx(styles.tab, selected && styles.tabActive)}
            onClick={() => {
              onSelect(domain.id);
            }}
            title={domain.hint}
          >
            <span className={styles.label}>{domain.label}</span>
            {/*
              Hidden from the reading order rather than announced. "Beats m" is not a name, and a
              screen-reader user meeting it as one would hear a stray letter after every tab. The
              contrast it draws is a visual one, and the README and the panels say it in words.
            */}
            <span aria-hidden="true" className={styles.variable}>
              {domain.variable}
            </span>
          </button>
        );
      })}
    </div>
  );
}
