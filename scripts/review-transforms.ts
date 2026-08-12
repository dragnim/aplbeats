/*
 * Look at what the transformations actually do to a beat.
 *
 *   npm run review:transforms                  every operation, on the opening groove
 *   npm run review:transforms -- --generated   and on generated bars from each preset
 *   npm run review:transforms -- --stagger     Stagger across its whole range
 *   npm run review:transforms -- --locks       what happens to a row the visitor locked
 *
 * Stage 3's acceptance is musical, not arithmetical: the operations are already proved
 * correct by tests, and correct is not the same as worth having. A transformation that
 * reliably ruins a beat is a bug in the product even when the APL is impeccable — so this
 * prints the before and the after side by side, with the few numbers that say whether a
 * rhythm still has a spine.
 *
 * No scores and no thresholds. The numbers are here to make forty bars comparable so a
 * person can see which operations are worth pressing twice.
 */

import { OPERATIONS, targetName, type Operation, type Parameters, type Target } from '@/apl/operations';
import { applyReferenceTransform } from '@/apl/reference';
import { createInitialGroove } from '@/pattern/initialGroove';
import { STEP_COUNT, type Pattern } from '@/pattern/pattern';
import { TRACKS } from '@/pattern/tracks';
import { generatePattern } from '@/generation/generator';
import { PRESETS } from '@/generation/presets';

const argv = process.argv.slice(2);
const wants = (flag: string): boolean => argv.includes(flag);

/* ------------------------------------------------------------------------- */

const KICK = 0;
const SNARE = 1;

/** Where the beats are, under ⎕IO←0: steps 0, 4, 8 and 12. */
const BEATS = [0, 4, 8, 12];
/** The backbeat: 2 and 4 of the bar. */
const BACKBEATS = [4, 12];

interface Spine {
  /** Is there a kick on the downbeat? Almost everything else can move if this does not. */
  readonly kickOnOne: boolean;
  /** How many of the four beats have a kick or a snare on them. */
  readonly beatsAnchored: number;
  /** Is the snare on 2 or 4? */
  readonly backbeat: boolean;
  /** Share of all onsets that fall between the sixteenths of the beat grid. */
  readonly offGrid: number;
  readonly onsets: number;
}

function spineOf(pattern: Pattern): Spine {
  const kick = pattern[KICK] ?? [];
  const snare = pattern[SNARE] ?? [];

  let onsets = 0;
  let offGrid = 0;
  for (const row of pattern) {
    for (const [step, cell] of row.entries()) {
      if (!cell) continue;
      onsets += 1;
      if (step % 4 !== 0) offGrid += 1;
    }
  }

  return {
    kickOnOne: kick[0] === true,
    beatsAnchored: BEATS.filter((beat) => kick[beat] === true || snare[beat] === true).length,
    backbeat: BACKBEATS.some((beat) => snare[beat] === true),
    offGrid: onsets === 0 ? 0 : offGrid / onsets,
    onsets,
  };
}

function rowText(row: readonly boolean[] | undefined): string {
  return (row ?? []).map((cell, step) => (cell ? '●' : step % 4 === 0 ? '·' : ' ')).join('');
}

function gridText(pattern: Pattern, changed: readonly boolean[]): string[] {
  return TRACKS.map((track, index) => {
    const mark = changed[index] === true ? '›' : ' ';
    return `  ${mark} ${track.name.padEnd(11)}|${rowText(pattern[index])}|`;
  });
}

function changedRows(before: Pattern, after: Pattern): boolean[] {
  return TRACKS.map((_track, index) => rowText(before[index]) !== rowText(after[index]));
}

function spineText(spine: Spine): string {
  return [
    `onsets ${String(spine.onsets).padStart(3)}`,
    `kick on 1 ${spine.kickOnOne ? 'yes' : 'no '}`,
    `beats anchored ${String(spine.beatsAnchored)}/4`,
    `backbeat ${spine.backbeat ? 'yes' : 'no '}`,
    `off-grid ${(spine.offGrid * 100).toFixed(0).padStart(3)}%`,
  ].join('   ');
}

/* ------------------------------------------------------------------------- */

interface Case {
  readonly operation: Operation;
  readonly target: Target;
  readonly parameters: Parameters;
  readonly note: string;
}

function operation(id: string): Operation {
  const found = OPERATIONS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No operation called ${id}`);
  return found;
}

/** The cases the brief asked to be tried, in musical terms. */
function musicalCases(): Case[] {
  return [
    {
      operation: operation('rotate'),
      target: KICK,
      parameters: { amount: -1 },
      note: 'a kick pushed one sixteenth late — the classic',
    },
    {
      operation: operation('rotate'),
      target: KICK,
      parameters: { amount: -2 },
      note: 'and two, which is an eighth: a different feel, not a broken one',
    },
    {
      operation: operation('rotate'),
      target: 'all',
      parameters: { amount: 3 },
      note: 'the whole bar rotated: same rhythm, different starting point',
    },
    {
      operation: operation('reverse'),
      target: 6,
      parameters: {},
      note: 'auxiliary percussion, backwards',
    },
    {
      operation: operation('reverse'),
      target: 'all',
      parameters: {},
      note: 'everything backwards',
    },
    {
      operation: operation('periodic'),
      target: 2,
      parameters: { period: 4, rotation: 0 },
      note: 'a closed hat on the four beats',
    },
    {
      operation: operation('periodic'),
      target: 2,
      parameters: { period: 3, rotation: 0 },
      note: 'every third sixteenth: a 3-against-4 cross rhythm, with a stumble at 15→0',
    },
    {
      operation: operation('euclidean'),
      target: 3,
      parameters: { pulses: 5, rotation: 0 },
      note: '5 in 16 on the open hat',
    },
    {
      operation: operation('euclidean'),
      target: 3,
      parameters: { pulses: 5, rotation: 3 },
      note: 'the same five hits, shifted — the Shift control',
    },
    {
      operation: operation('euclidean'),
      target: 7,
      parameters: { pulses: 7, rotation: 0 },
      note: '7 in 16, which is where Euclidean stops sounding like a metronome',
    },
  ];
}

function show(title: string, before: Pattern, cases: readonly Case[]): void {
  console.log('');
  console.log(`══ ${title}`);
  console.log('');
  console.log('    before');
  for (const line of gridText(
    before,
    TRACKS.map(() => false),
  ))
    console.log(line);
  console.log(`    ${spineText(spineOf(before))}`);

  for (const item of cases) {
    const after = applyReferenceTransform(item.operation, item.target, item.parameters, before);
    const parameters = Object.entries(item.parameters)
      .map(([key, value]) => `${key} ${String(value)}`)
      .join(', ');

    console.log('');
    console.log(
      `  ── ${item.operation.name} → ${targetName(item.target)}${parameters === '' ? '' : `  (${parameters})`}`,
    );
    console.log(`     ${item.note}`);
    for (const line of gridText(after, changedRows(before, after))) console.log(line);
    console.log(`    ${spineText(spineOf(after))}`);
  }
  console.log('');
}

/* ------------------------------------------------------------------------- */

/**
 * Stagger: the operation that was built, reviewed, and removed.
 *
 * `(s×⍳8)⌽m` gives ⌽ a *vector* left argument, so all eight rows rotate by their own amount
 * in one glyph, with no loop and no index. It is the best APL in the project and it did not
 * survive this review, so it is computed here rather than shipped — the judgement should stay
 * reproducible, and a claim that an operation was rejected is worth nothing without the grid
 * that rejected it.
 *
 * Read the kick column first. It never changes, at any amount, because row 0's rotation is
 * `s×0` — so the control's promise, "shift each track a little further than the one above",
 * is not what happens to the track the visitor cares about most.
 */
function staggerRows(pattern: Pattern, amount: number): Pattern {
  return pattern.map((row, track) => {
    const length = row.length;
    const shift = (((amount * track) % length) + length) % length;
    return Array.from({ length }, (_unused, step) => row[(step + shift) % length] === true);
  });
}

function staggerSweep(before: Pattern): void {
  console.log('');
  console.log('══ Stagger, every amount  (built, reviewed, removed — see src/apl/operations.ts)');
  console.log('');
  console.log('   step   kick             snare            spine');
  console.log(
    `     ·    ${rowText(before[KICK]).padEnd(17)}${rowText(before[SNARE]).padEnd(17)}${spineText(spineOf(before))}`,
  );

  for (const amount of [-4, -3, -2, -1, 1, 2, 3, 4]) {
    const after = staggerRows(before, amount);
    console.log(
      `${String(amount).padStart(6)}    ${rowText(after[KICK]).padEnd(17)}${rowText(after[SNARE]).padEnd(17)}${spineText(spineOf(after))}`,
    );
  }

  console.log('');
  console.log('   rotation applied per track:');
  for (const amount of [1, 2]) {
    const rotations = TRACKS.map((_track, track) => (amount * track) % STEP_COUNT);
    console.log(`     amount ${String(amount)}: ${rotations.map((r) => String(r).padStart(3)).join('')}`);
  }

  console.log('');
  console.log('   The three findings that removed it:');
  console.log('     1. the kick never moves, at any amount — its rotation is amount × 0;');
  console.log('     2. the backbeat is lost at seven of the eight amounts;');
  console.log('     3. ¯1 and 3 smear by the same degree, so the control does not intensify');
  console.log('        anything — it reshuffles, and every press has the same character.');
  console.log('');
}

/** A row the visitor locked, and what each operation does to it. */
function lockReview(before: Pattern): void {
  console.log('');
  console.log('══ Locks and transforms');
  console.log('');
  console.log('  Locks belong to the generator: they hold a row against Randomise, which is a');
  console.log('  request for a different bar. A transform is a request to change *this* bar, and');
  console.log('  the visitor names the row it applies to. So a transform is not blocked by a lock,');
  console.log('  and the only case worth checking is the one where it cannot be: an operation on');
  console.log('  the whole matrix, which touches a locked row without being asked to.');
  console.log('');

  for (const op of OPERATIONS) {
    if (!op.allowsAllTracks) continue;
    const after = applyReferenceTransform(op, 'all', { amount: 2 }, before);
    const touched = changedRows(before, after).filter(Boolean).length;
    console.log(
      `  ${op.name.padEnd(9)} on all tracks changes ${String(touched)} of ${String(TRACKS.length)} rows.`,
    );
  }
  console.log('');
}

/* ------------------------------------------------------------------------- */

const groove = createInitialGroove();

if (wants('--stagger')) {
  staggerSweep(groove);
} else if (wants('--locks')) {
  lockReview(groove);
} else {
  show('The opening groove', groove, musicalCases());

  if (wants('--generated')) {
    for (const preset of PRESETS) {
      const generated = generatePattern({
        seed: 20_260_812,
        preset: preset.id,
        density: 55,
        complexity: 55,
        syncopation: 45,
      });
      show(`Generated: ${preset.name}`, generated, musicalCases().slice(0, 6));
    }
  }
}
