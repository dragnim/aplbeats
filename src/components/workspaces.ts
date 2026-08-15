/*
 * The four workspaces, as data.
 *
 * Apart from the rail that renders them so that the list can be imported by anything that needs
 * it — the App, the tests — without dragging a component along with it. React Fast Refresh also
 * declines to work on a module that exports both components and constants, which is a small
 * thing but a daily one.
 */

export type WorkspaceId = 'play' | 'create' | 'transform' | 'explore';

export interface Workspace {
  readonly id: WorkspaceId;
  /** The word on the rail. Short, because it sits under a 20px icon. */
  readonly label: string;
  /** One line, for the tooltip. Never the only place the meaning appears. */
  readonly hint: string;
}

/**
 * The four, in the order the product is learned.
 *
 * Play first because that is what somebody is here for; then the two APL tools that make and
 * change a beat; then Explore, which is where the APL stops being ours and starts being theirs.
 */
export const WORKSPACES: readonly Workspace[] = [
  { id: 'play', label: 'Play', hint: 'Randomise, presets and the four macros. All local, all instant.' },
  { id: 'create', label: 'Create', hint: 'Ask Dyalog APL for a whole new rhythm from a recipe and a seed.' },
  {
    id: 'transform',
    label: 'Transform',
    hint: 'Change the rhythm you have with one of four APL operations.',
  },
  { id: 'explore', label: 'Explore', hint: 'Edit the APL yourself and run it.' },
];
