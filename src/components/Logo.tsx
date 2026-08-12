import styles from './Logo.module.css';

/*
 * A typographic identity, and deliberately only that.
 *
 * "APL" in the accent, "BEATS" in the text colour, letterspaced, in whatever
 * grotesque the device already has. There is no mark yet because there is nothing
 * yet for a mark to stand for: designing one before the instrument exists would be
 * designing it for a guess.
 */
export function Logo(): React.JSX.Element {
  return (
    <span className={styles.logo}>
      <span className={styles.apl}>APL</span>
      {/*
        A real space, not only the flex gap. The gap separates the words for the eye;
        without this the name reads "APLBEATS" to anything speaking it, and to anything
        indexing it. Whitespace-only text between flex items is not rendered, so the
        layout is unaffected.
      */}{' '}
      <span className={styles.beats}>BEATS</span>
    </span>
  );
}
