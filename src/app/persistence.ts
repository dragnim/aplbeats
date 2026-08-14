/*
 * Remembering a session.
 *
 * Coming back to APL Beats and finding the groove you left is worth a good deal, and it
 * costs one small object in `localStorage`. Nothing here is required for the application
 * to work: every read is treated as untrusted, every failure is silent, and a browser
 * with storage disabled or full simply starts fresh.
 *
 * Two versions are recorded and both are checked. The schema version guards the shape of
 * this file; the generator version guards the *meaning* of a seed. Tuning the generator
 * changes what a seed produces, so a stored seed from an older generator would restore a
 * groove nobody had ever heard and blame it on the seed. Rather than silently regenerate
 * something else, a mismatched session is discarded — the pattern is stored outright, so
 * nothing has to be regenerated to restore it anyway.
 */

import { APL_GENERATOR_VERSION, isRecipeId, type RecipeId } from '@/apl/generators';
import type { Target } from '@/apl/operations';
import { resolveKitId } from '@/audio/kits/kits';
import { SYNTH_KIT_ID, type KitId } from '@/audio/kits/types';
import { GENERATOR_VERSION } from '@/generation/version';
import { isPresetId, type PresetId } from '@/generation/presets';
import { clampSeed } from '@/generation/prng';
import { createMixer, clampVolume, type Mixer } from '@/pattern/mixer';
import { fromBits, toBits, TRACK_COUNT, type Pattern } from '@/pattern/pattern';
import { clampBpm, clampSwing } from '@/transport/timing';
import { clampMacro, noLocks, type CreativeState } from './studio';

const STORAGE_KEY = 'aplbeats.session.v1';
const SCHEMA_VERSION = 1;

/*
 * The drum machine, stored under its own key.
 *
 * Separate from the session above, and deliberately so. The session is discarded whenever the
 * generator version changes, because a stored seed means something different after the
 * generator is tuned — but which drum machine somebody likes has nothing to do with the
 * generator, and losing it on a generator bump would be losing it for no reason. It is also
 * not part of the creative state at all: choosing a kit is a listening decision, like moving a
 * fader, and it is not in Undo.
 */
const KIT_STORAGE_KEY = 'aplbeats.kit.v1';
const KIT_SCHEMA_VERSION = 1;

/*
 * The Explore draft, under its own key again, and for the same reason.
 *
 * Somebody halfway through writing an expression should not lose it to a refresh — but an
 * unfinished experiment has nothing to do with the generator's version, and coupling it to the
 * session would throw it away every time the generator was tuned. It is never executed on
 * restore; it is text in a box until somebody presses Run.
 */
const EXPLORE_STORAGE_KEY = 'aplbeats.explore.v1';
const EXPLORE_SCHEMA_VERSION = 1;

/*
 * The listening level, under its own key for the third time and the same reason.
 *
 * How loud somebody wants their speakers is a fact about their room, not about their groove. It
 * has nothing to do with the generator's version, and losing it because a stored bar became
 * invalid would be losing it for no reason at all.
 */
const VOLUME_STORAGE_KEY = 'aplbeats.master-volume.v1';
const VOLUME_SCHEMA_VERSION = 1;

/*
 * The Create with APL controls, under their own key for the fifth time.
 *
 * Which recipe and which seed somebody was working with is tool state, like the drum machine
 * and the Explore draft: worth finding again after a refresh, and nothing to do with the local
 * generator's version, so it must not be discarded when that changes.
 *
 * The APL generator's own version *is* stored, and is checked, for the reason the session
 * checks the local one: recipe plus seed describes a rhythm, so a seed stored under an older
 * set of recipe expressions would mean a different rhythm than it did. Restoring it is
 * harmless — nothing is executed on load, ever — but restoring it and implying it would
 * reproduce what somebody heard last time would not be, so a mismatch falls back to defaults.
 */
const CREATE_STORAGE_KEY = 'aplbeats.apl-create.v1';
const CREATE_SCHEMA_VERSION = 1;

/** How much hand-written APL is worth remembering. Comfortably past the editor's own limit. */
const MAX_DRAFT_LENGTH = 1000;

export interface Session {
  readonly creative: CreativeState;
  readonly bpm: number;
  readonly swing: number;
  readonly mixer: Mixer;
}

/**
 * Read a stored session, or nothing.
 *
 * Every field is validated and clamped rather than trusted. `localStorage` is editable by
 * anyone with the developer tools open, and a `NaN` tempo reaching the scheduler is a beat
 * that never arrives.
 */
export function loadSession(): Session | null {
  const raw = readRaw();
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.schema !== SCHEMA_VERSION) return null;
    if (parsed.generator !== GENERATOR_VERSION) return null;

    const creative = readCreative(parsed.creative);
    if (creative === null) return null;

    return {
      creative,
      bpm: clampBpm(asNumber(parsed.bpm, 112)),
      swing: clampSwing(asNumber(parsed.swing, 0.18)),
      mixer: readMixer(parsed.mixer),
    };
  } catch {
    // Malformed JSON, a quota error on read, a locked-down browser. Start fresh.
    return null;
  }
}

/** Write a session. Failure is ignored: this is a convenience, not a feature. */
export function saveSession(session: Session): void {
  try {
    const payload = {
      schema: SCHEMA_VERSION,
      generator: GENERATOR_VERSION,
      creative: {
        bits: toBits(session.creative.pattern),
        seed: session.creative.seed,
        preset: session.creative.preset,
        density: session.creative.density,
        complexity: session.creative.complexity,
        syncopation: session.creative.syncopation,
        variation: session.creative.variation,
        locks: [...session.creative.locks],
      },
      bpm: session.bpm,
      swing: session.swing,
      mixer: session.mixer.map((mix) => ({ muted: mix.muted, volume: mix.volume })),
    };

    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private browsing, a full quota, storage disabled by policy. Nothing to be done and
    // nothing worth telling anyone about.
  }
}

/** Forget the stored session. */
export function clearSession(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    globalThis.localStorage?.removeItem(KIT_STORAGE_KEY);
    globalThis.localStorage?.removeItem(EXPLORE_STORAGE_KEY);
    globalThis.localStorage?.removeItem(VOLUME_STORAGE_KEY);
    globalThis.localStorage?.removeItem(CREATE_STORAGE_KEY);
  } catch {
    // See above.
  }
}

/**
 * The drum machine last chosen, or the synthesised one.
 *
 * `resolveKitId` is what makes this safe across releases: an identifier that no longer exists
 * — a kit withdrawn because its provenance turned out to be doubtful, say — becomes the
 * synthesised kit rather than a startup failure or a silent instrument.
 */
export function loadKitChoice(): KitId {
  try {
    const raw = globalThis.localStorage?.getItem(KIT_STORAGE_KEY) ?? null;
    if (raw === null) return SYNTH_KIT_ID;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return SYNTH_KIT_ID;
    if (parsed.schema !== KIT_SCHEMA_VERSION) return SYNTH_KIT_ID;

    return resolveKitId(parsed.kitId);
  } catch {
    return SYNTH_KIT_ID;
  }
}

/**
 * The execution context a draft needs to mean what it meant.
 *
 * Stage 5 drafts had none, and needed none: a transform expression run against the same bar
 * gives the same answer whenever you run it. A *generator* expression does not — it uses `?`,
 * and without the seed it ran under it produces a different rhythm every time.
 *
 * So an expression loaded from Create carries the seed APL Beats fixed `⎕RL` to, and Explore
 * runs it under exactly that. Otherwise pressing Run on an unedited generator would give a
 * different bar than the button that produced it, and Peek would be a lie.
 *
 * Optional, and that is the migration. A stored Stage 5 draft has no `context` field at all and
 * must load exactly as it always did rather than being discarded for missing something that did
 * not exist when it was written — which is why this did not get a new schema version.
 */
export interface ExploreContext {
  /** The seed `⎕RL` is fixed to. Absent for an expression that does not need one. */
  readonly randomSeed?: number;
}

export interface ExploreDraft {
  readonly expression: string;
  readonly target: Target;
  readonly context?: ExploreContext;
}

/**
 * The Explore draft, or nothing.
 *
 * Every field validated: the target must be one this application has, and the expression must
 * be a string of sensible length. A stored draft from a future version, or one somebody has
 * edited by hand in the developer tools, is discarded rather than trusted — it would otherwise
 * be a way to put arbitrary text into an editor that has a Run button next to it.
 */
export function loadExploreDraft(): ExploreDraft | null {
  try {
    const raw = globalThis.localStorage?.getItem(EXPLORE_STORAGE_KEY) ?? null;
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.schema !== EXPLORE_SCHEMA_VERSION) return null;

    const { expression, target } = parsed;
    if (typeof expression !== 'string' || expression.length === 0) return null;
    if (expression.length > MAX_DRAFT_LENGTH) return null;

    /*
     * The context, if there is one.
     *
     * Read leniently and validated strictly: an absent field is a Stage 5 draft and perfectly
     * good, a malformed one is dropped while the expression it accompanied is kept. Losing
     * somebody's APL because the optional half of the record was corrupt would be the wrong
     * trade — and the seed goes through `clampSeed`, so nothing outside 1–999999 can reach ⎕RL
     * by way of storage.
     */
    const context = readExploreContext(parsed.context);

    const withContext = (draft: ExploreDraft): ExploreDraft =>
      context === null ? draft : { ...draft, context };

    if (target === 'all') return withContext({ expression, target: 'all' });
    if (typeof target === 'number' && Number.isInteger(target) && target >= 0 && target < TRACK_COUNT) {
      return withContext({ expression, target });
    }
    return null;
  } catch {
    return null;
  }
}

/** Remember the Explore draft. Failure is ignored, as everywhere else in this file. */
export function saveExploreDraft(draft: ExploreDraft | null): void {
  try {
    if (draft === null) {
      // This one key, and no other. Every save function here touches only what it is named for;
      // `clearSession` is the only thing entitled to reach across them.
      globalThis.localStorage?.removeItem(EXPLORE_STORAGE_KEY);
      return;
    }
    globalThis.localStorage?.setItem(
      EXPLORE_STORAGE_KEY,
      JSON.stringify({
        schema: EXPLORE_SCHEMA_VERSION,
        expression: draft.expression.slice(0, MAX_DRAFT_LENGTH),
        target: draft.target,
        // Written only when there is one, so a transform draft stays byte-identical to what
        // Stage 5 wrote and an older build could still read it.
        ...(draft.context === undefined ? {} : { context: draft.context }),
      }),
    );
  } catch {
    // See above.
  }
}

/** A stored Explore context, validated, or nothing. */
function readExploreContext(raw: unknown): ExploreContext | null {
  if (!isRecord(raw)) return null;
  const { randomSeed } = raw;
  if (typeof randomSeed !== 'number' || !Number.isFinite(randomSeed)) return null;
  return { randomSeed: clampSeed(randomSeed) };
}

/* ------------------------------------------------------------------------- */

export interface CreateSettings {
  readonly recipeId: RecipeId;
  readonly seed: number;
}

/**
 * The Create with APL controls, or nothing.
 *
 * Loading this **never executes anything**. It restores a selector and a number, and that is the
 * whole of it — there is no code path from here to a request, which is what makes it safe for a
 * refresh to bring back the recipe and seed somebody was working with.
 */
export function loadCreateSettings(): CreateSettings | null {
  try {
    const raw = globalThis.localStorage?.getItem(CREATE_STORAGE_KEY) ?? null;
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.schema !== CREATE_SCHEMA_VERSION) return null;
    // Recipe plus seed describes a rhythm. Under a different set of recipe expressions it would
    // describe a different one, so the pair is not restored across a version change.
    if (parsed.aplGeneratorVersion !== APL_GENERATOR_VERSION) return null;

    const { recipeId, seed } = parsed;
    if (!isRecipeId(recipeId)) return null;
    if (typeof seed !== 'number' || !Number.isFinite(seed)) return null;

    return { recipeId, seed: clampSeed(seed) };
  } catch {
    return null;
  }
}

/** Remember the Create controls. Failure is ignored, as everywhere else in this file. */
export function saveCreateSettings(settings: CreateSettings): void {
  try {
    globalThis.localStorage?.setItem(
      CREATE_STORAGE_KEY,
      JSON.stringify({
        schema: CREATE_SCHEMA_VERSION,
        aplGeneratorVersion: APL_GENERATOR_VERSION,
        recipeId: settings.recipeId,
        seed: clampSeed(settings.seed),
      }),
    );
  } catch {
    // See above.
  }
}

/**
 * The listening level, or full volume.
 *
 * Every failure resolves to 1 rather than to silence. A stored value that cannot be read is a
 * reason to be loud, not a reason to be inaudible: somebody arriving at a silent drum machine
 * has no way of telling it apart from a broken one.
 */
export function loadMasterVolume(): number {
  try {
    const raw = globalThis.localStorage?.getItem(VOLUME_STORAGE_KEY) ?? null;
    if (raw === null) return 1;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return 1;
    if (parsed.schema !== VOLUME_SCHEMA_VERSION) return 1;

    const { volume } = parsed;
    if (typeof volume !== 'number' || !Number.isFinite(volume)) return 1;
    return Math.min(1, Math.max(0, volume));
  } catch {
    return 1;
  }
}

/** Remember the listening level. Failure is ignored, as everywhere else in this file. */
export function saveMasterVolume(volume: number): void {
  try {
    const safe = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    globalThis.localStorage?.setItem(
      VOLUME_STORAGE_KEY,
      JSON.stringify({ schema: VOLUME_SCHEMA_VERSION, volume: safe }),
    );
  } catch {
    // See above.
  }
}

/** Remember the drum machine. Failure is ignored, as everywhere else in this file. */
export function saveKitChoice(kitId: KitId): void {
  try {
    globalThis.localStorage?.setItem(
      KIT_STORAGE_KEY,
      JSON.stringify({ schema: KIT_SCHEMA_VERSION, kitId: resolveKitId(kitId) }),
    );
  } catch {
    // See above.
  }
}

/* ------------------------------------------------------------------------- */

function readRaw(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readCreative(value: unknown): CreativeState | null {
  if (!isRecord(value)) return null;

  const pattern = readPattern(value.bits);
  if (pattern === null) return null;

  const preset: PresetId = isPresetId(value.preset) ? value.preset : 'straight';

  return {
    pattern,
    seed: clampSeed(asNumber(value.seed, 1)),
    preset,
    density: clampMacro(asNumber(value.density, 62)),
    complexity: clampMacro(asNumber(value.complexity, 45)),
    syncopation: clampMacro(asNumber(value.syncopation, 30)),
    variation: clampMacro(asNumber(value.variation, 45)),
    locks: readLocks(value.locks),
  };
}

/**
 * A pattern from stored ones and zeros.
 *
 * `fromBits` already pads and trims to the standard shape and reads anything non-zero as
 * a trigger, so the only thing to establish here is that this was an array of arrays at
 * all. Anything else is somebody else's edit of our storage.
 */
function readPattern(value: unknown): Pattern | null {
  if (!Array.isArray(value)) return null;

  const rows: number[][] = [];
  for (const row of value) {
    if (!Array.isArray(row)) return null;
    rows.push(row.map((cell) => (typeof cell === 'number' && cell !== 0 ? 1 : 0)));
  }

  return fromBits(rows);
}

function readLocks(value: unknown): boolean[] {
  const locks = noLocks();
  if (!Array.isArray(value)) return locks;
  for (let track = 0; track < TRACK_COUNT; track += 1) {
    locks[track] = value[track] === true;
  }
  return locks;
}

function readMixer(value: unknown): Mixer {
  const defaults = createMixer();
  if (!Array.isArray(value)) return defaults;

  return defaults.map((fallback, index) => {
    const stored: unknown = value[index];
    if (!isRecord(stored)) return fallback;
    return {
      muted: stored.muted === true,
      volume: clampVolume(asNumber(stored.volume, fallback.volume)),
    };
  });
}
