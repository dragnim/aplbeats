/*
 * What the eight rows are.
 *
 * Kept apart from the pattern matrix so the matrix can stay a plain rectangle of
 * Booleans. A track's identity, its name on screen and how loud it sits in the
 * kit are all properties of the row, not of the cells in it.
 *
 * `id` is the stable key: it names a voice in the audio engine, and it is what a
 * saved or shared pattern would refer to. Names are free to change; identifiers
 * are not.
 */

/** The eight voices, in row order. */
export const TRACK_IDS = [
  'kick',
  'snare',
  'closedHat',
  'openHat',
  'clap',
  'lowPerc',
  'highPerc',
  'rim',
] as const;

export type TrackId = (typeof TRACK_IDS)[number];

export interface TrackDefinition {
  readonly id: TrackId;
  /** The label on screen, and part of every cell's accessible name. */
  readonly name: string;
  /**
   * Where this track's fader starts, 0 to 1.
   *
   * Not all one: a kit is balanced by its quietest parts, and starting the hats
   * and percussion below the kick and snare is what stops the opening groove
   * sounding like eight things shouting at once. The voices are also individually
   * calibrated, so this is the musical balance rather than a level correction.
   */
  readonly defaultVolume: number;
}

export const TRACKS: readonly TrackDefinition[] = [
  { id: 'kick', name: 'Kick', defaultVolume: 0.92 },
  { id: 'snare', name: 'Snare', defaultVolume: 0.72 },
  { id: 'closedHat', name: 'Closed Hat', defaultVolume: 0.5 },
  { id: 'openHat', name: 'Open Hat', defaultVolume: 0.42 },
  { id: 'clap', name: 'Clap', defaultVolume: 0.62 },
  { id: 'lowPerc', name: 'Low Perc', defaultVolume: 0.6 },
  { id: 'highPerc', name: 'High Perc', defaultVolume: 0.52 },
  { id: 'rim', name: 'Rim', defaultVolume: 0.46 },
];
