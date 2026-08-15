import styles from './UndoButton.module.css';

/*
 * Undo, in the top bar.
 *
 * It used to sit in the generator panel beside Randomise, which was right when that panel was
 * always on the page. Stage 7 put the four workspaces behind tabs, and the moment it did, a
 * button that undoes *any* change to the beat — a Randomise, an APL generation, a transform, a
 * cell you painted — was reachable only from one of the four. Generate a bar on the Create tab
 * and you would have had to leave it to take the bar back.
 *
 * So it moved out to where it always belonged: beside the transport, with the other things that
 * are true of the whole application rather than of one tool.
 *
 * Genuinely disabled rather than merely dimmed, so a keyboard visitor is told there is nothing
 * to undo instead of being sent to a button that does nothing.
 */

export interface UndoButtonProps {
  readonly canUndo: boolean;
  readonly onUndo: () => void;
}

export function UndoButton({ canUndo, onUndo }: UndoButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.undo}
      onClick={onUndo}
      disabled={!canUndo}
      aria-label="Undo"
      title="Undo the last change to the beat"
    >
      <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path
          d="M4 9h7.5a4 4 0 0 1 0 8H8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M7 5.5 3.5 9 7 12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={styles.label}>Undo</span>
    </button>
  );
}
