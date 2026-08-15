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

/* ------------------------------------------------------------------------- */

/**
 * The two layers, and the tabs above the rail that choose between them.
 *
 * Stage 8's one structural addition. Beats is the eight-track Boolean matrix APL Beats has always
 * been; Tones is a single line of sixteen numbers played by one pitched instrument. Two layers of
 * one piece of music, not two applications — which is why switching between them is a change of
 * *view* and nothing else: the transport does not stop, the bar does not restart, both layers keep
 * sounding, and nothing is fetched or executed.
 *
 * The same four workspaces on both sides, because they mean the same four things: play it, have
 * APL create one, have APL change the one you have, write the APL yourself. Only the hints differ,
 * and they differ because `⌽m` and `⌽n` are genuinely different sentences about different data —
 * which is the whole reason Tones exists.
 */
export type Domain = 'beats' | 'tones';

export interface DomainDefinition {
  readonly id: Domain;
  readonly label: string;
  readonly hint: string;
  /** What its APL variable is called, shown wherever the two are contrasted. */
  readonly variable: string;
}

export const DOMAINS: readonly DomainDefinition[] = [
  {
    id: 'beats',
    label: 'Beats',
    hint: 'Eight drum tracks, sixteen steps. A Boolean matrix.',
    variable: 'm',
  },
  {
    id: 'tones',
    label: 'Tones',
    hint: 'One Tone phrase, sixteen steps. A numeric vector.',
    variable: 'n',
  },
];

/** The workspaces offered on the Tones side. Same four ideas, different data. */
const TONE_WORKSPACES: readonly Workspace[] = [
  { id: 'play', label: 'Play', hint: 'Write the phrase by hand, and choose the sound.' },
  { id: 'create', label: 'Create', hint: 'Ask Dyalog APL for a whole new phrase from a recipe and a seed.' },
  {
    id: 'transform',
    label: 'Transform',
    hint: 'Change the phrase you have with one of four APL operations.',
  },
  { id: 'explore', label: 'Explore', hint: 'Edit the APL yourself and run it against the phrase.' },
];

export function workspacesFor(domain: Domain): readonly Workspace[] {
  return domain === 'tones' ? TONE_WORKSPACES : WORKSPACES;
}

export function isDomain(value: unknown): value is Domain {
  return value === 'beats' || value === 'tones';
}
