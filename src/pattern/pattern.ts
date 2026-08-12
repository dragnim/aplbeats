/*
 * The pattern: an 8 × 16 Boolean matrix.
 *
 * This shape is the point of APL Beats rather than an implementation detail. A
 * later release will hand this same rectangular array of Booleans to APL and take
 * a transformed one back, so it is stored as exactly that and nothing else — no
 * note objects, no per-cell metadata, no DOM references, no identifiers. Anything
 * a track needs beyond "does it fire on this step?" lives in the track
 * definitions or in the mixer, deliberately alongside rather than inside.
 *
 * Rows are tracks, top to bottom, in the order given by `TRACKS`. Columns are
 * steps, left to right: sixteenth notes across one bar of four-four.
 *
 * Every function here is pure and returns a new matrix. Nothing mutates, which
 * is what lets React compare by reference and what will let undo be a stack of
 * these later on.
 */

export const TRACK_COUNT = 8;
export const STEP_COUNT = 16;

/** One row of the matrix: whether each step in the bar fires. */
export type PatternRow = readonly boolean[];

/** The whole pattern, `TRACK_COUNT` rows of `STEP_COUNT` steps. */
export type Pattern = readonly PatternRow[];

/** An empty pattern of the standard shape: nothing fires anywhere. */
export function createPattern(): Pattern {
  return Array.from({ length: TRACK_COUNT }, () => Array.from({ length: STEP_COUNT }, () => false));
}

/**
 * Whether `track` and `step` name a cell that exists.
 *
 * Callers check this rather than trusting an index, because indices arrive from
 * keyboard navigation, from pointer hit-testing over a grid that may have been
 * resized mid-gesture, and eventually from APL.
 */
export function isInBounds(pattern: Pattern, track: number, step: number): boolean {
  if (!Number.isInteger(track) || !Number.isInteger(step)) return false;
  const row = pattern[track];
  if (row === undefined) return false;
  return step >= 0 && step < row.length;
}

/** Whether a cell fires. Out-of-bounds cells read as silent rather than throwing. */
export function cellAt(pattern: Pattern, track: number, step: number): boolean {
  return pattern[track]?.[step] ?? false;
}

/**
 * `pattern` with one cell set to `value`.
 *
 * Out-of-bounds coordinates return the pattern unchanged, and so does a write
 * that would not alter anything — returning the same reference means a no-op
 * edit costs no re-render.
 */
export function setCell(pattern: Pattern, track: number, step: number, value: boolean): Pattern {
  if (!isInBounds(pattern, track, step)) return pattern;
  if (cellAt(pattern, track, step) === value) return pattern;

  return pattern.map((row, rowIndex) =>
    rowIndex === track ? row.map((cell, cellIndex) => (cellIndex === step ? value : cell)) : row,
  );
}

/** `pattern` with one cell flipped. */
export function toggleCell(pattern: Pattern, track: number, step: number): Pattern {
  if (!isInBounds(pattern, track, step)) return pattern;
  return setCell(pattern, track, step, !cellAt(pattern, track, step));
}

/**
 * Whether two patterns hold the same events.
 *
 * By value, not by reference. Generation always returns a fresh matrix, so a regeneration
 * that happens to land on the bar already playing is indistinguishable from a change
 * unless somebody looks — and a needless new reference is a needless re-render and a
 * needless history entry.
 */
export function patternsEqual(a: Pattern, b: Pattern): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let track = 0; track < a.length; track += 1) {
    const rowA = a[track];
    const rowB = b[track];
    if (rowA === undefined || rowB === undefined || rowA.length !== rowB.length) return false;
    for (let step = 0; step < rowA.length; step += 1) {
      if (rowA[step] !== rowB[step]) return false;
    }
  }

  return true;
}

/** How many cells fire in total. Used by tests and, later, by the density control. */
export function countTriggers(pattern: Pattern): number {
  return pattern.reduce((total, row) => total + row.filter(Boolean).length, 0);
}

/**
 * The pattern as ones and zeros.
 *
 * This is the form APL will exchange, and writing it down now keeps the eventual
 * boundary honest: whatever the interface stores, what crosses to APL is a
 * numeric matrix of the declared shape.
 */
export function toBits(pattern: Pattern): number[][] {
  return pattern.map((row) => row.map((cell) => (cell ? 1 : 0)));
}

/**
 * A pattern built from ones and zeros, padded or trimmed to the standard shape.
 *
 * The forgiving reading is on purpose. An array arriving from outside — a stored
 * pattern from an older version, or one day an APL result — may not be exactly
 * 8 × 16, and silently landing on the standard shape is better than refusing to
 * play. Anything non-zero counts as a trigger.
 */
export function fromBits(bits: readonly (readonly number[])[]): Pattern {
  return Array.from({ length: TRACK_COUNT }, (_unused, track) =>
    Array.from({ length: STEP_COUNT }, (_alsoUnused, step) => (bits[track]?.[step] ?? 0) !== 0),
  );
}
