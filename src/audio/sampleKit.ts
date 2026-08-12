/*
 * A sampled kit, built from eight decoded buffers.
 *
 * The whole point of this file is that what comes out of it is an ordinary `Kit` — eight
 * functions with the same signature the synthesised voices have. The scheduler asks "play row
 * N at time T" and has no way of telling whether the answer is an oscillator or a WAV, which
 * is what keeps Stage 1's timing work untouched by Stage 4.
 *
 * The one behaviour a sampled kit needs that a synthesised one does not is *choking*.
 *
 * Real drum machines are monophonic per instrument. Hitting the bass drum again while it is
 * still ringing restarts it; it does not add a second one. And on nearly every machine with
 * two hi-hats, the open and closed hat share one circuit, so a closed hat cuts an open one
 * off. A `BufferSourceNode` will do neither of those on its own: it will happily play forty
 * overlapping copies of a 1.7-second open hat, which is not a hi-hat pattern but a wash.
 *
 * So voices choke by group, the hats share a group, and everything else is monophonic in its
 * own row. That also keeps the peaks honest — eight rows that cannot stack copies of
 * themselves are eight rows the master chain can actually hold.
 */

import { TRACK_IDS, type TrackId } from '@/pattern/tracks';
import type { Kit, Voice, VoiceContext } from './kit';
import type { SampleKitDefinition, SampleVoiceDefinition } from './kits/types';

/**
 * How long a choked voice takes to get out of the way.
 *
 * Five milliseconds: long enough that cutting the sample does not click, short enough that it
 * reads as the new hit replacing the old one rather than as a fade.
 */
const CHOKE_SECONDS = 0.005;

/** What is currently sounding in one choke group. */
interface Sounding {
  readonly source: AudioBufferSourceNode;
  readonly amp: GainNode;
}

export interface SampleBuffers {
  readonly [file: string]: AudioBuffer;
}

/**
 * Build a playable kit from a definition and its decoded audio.
 *
 * Throws if a buffer is missing, rather than returning a kit with a silent row. A kit that is
 * seven-eighths present must never become the active kit — the pattern would look right and
 * be audibly wrong, which is the one failure mode this stage must not have.
 */
export function createSampleKit(definition: SampleKitDefinition, buffers: SampleBuffers): Kit {
  /*
   * Shared between the eight voices, which is why it lives out here: choking is the one thing
   * a voice needs to know about its neighbours.
   */
  const sounding = new Map<string, Sounding>();

  const voices = {} as Record<TrackId, Voice>;

  for (const trackId of TRACK_IDS) {
    const voice = definition.voices[trackId];
    const buffer = buffers[voice.file];
    if (buffer === undefined) {
      throw new Error(`The "${definition.name}" kit is missing ${voice.file} for the "${trackId}" row.`);
    }
    voices[trackId] = sampleVoice(buffer, voice, voice.chokeGroup ?? trackId, sounding);
  }

  return voices;
}

function sampleVoice(
  buffer: AudioBuffer,
  definition: SampleVoiceDefinition,
  group: string,
  sounding: Map<string, Sounding>,
): Voice {
  const { gain, playbackRate = 1 } = definition;

  return ({ context, destination }: VoiceContext, time: number, level: number): void => {
    if (level <= 0) return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    if (playbackRate !== 1) source.playbackRate.value = playbackRate;

    const amp = context.createGain();
    amp.gain.value = level * gain;

    source.connect(amp);
    amp.connect(destination);

    /*
     * Cut whatever this group is still playing, at the moment the new hit lands — not now.
     * `time` is in the future; a choke applied at `currentTime` would silence a note that has
     * not been heard yet, which with a hundred milliseconds of look-ahead is most of them.
     */
    choke(sounding.get(group), time);

    source.start(time);
    sounding.set(group, { source, amp });

    source.onended = (): void => {
      // Only clear the slot if nothing newer has claimed it.
      if (sounding.get(group)?.source === source) sounding.delete(group);
    };
  };
}

/** Fade a sounding voice out over five milliseconds and stop it. */
function choke(previous: Sounding | undefined, time: number): void {
  if (previous === undefined) return;

  try {
    /*
     * `setValueAtTime` first, so the ramp starts from the level the voice is actually at.
     * Nothing else automates this gain — it is set once when the voice is built — so there is
     * no scheduled curve to cancel and `cancelAndHoldAtTime`, which not every engine has, is
     * not needed.
     */
    previous.amp.gain.setValueAtTime(previous.amp.gain.value, time);
    previous.amp.gain.linearRampToValueAtTime(0, time + CHOKE_SECONDS);
    previous.source.stop(time + CHOKE_SECONDS);
  } catch {
    /*
     * The node belonged to a context that has since been closed, or it has already stopped.
     * Either way there is nothing left to silence and nothing worth reporting.
     */
  }
}
