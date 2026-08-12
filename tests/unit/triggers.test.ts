import { describe, expect, it } from 'vitest';
import { triggersForStep } from '@/audio/triggers';
import { createMixer, setVolume, toggleMute } from '@/pattern/mixer';
import { createPattern, setCell } from '@/pattern/pattern';

/*
 * The decision the sequencer makes sixteen times a bar, checked without an audio
 * device. This is why it is a pure function rather than a loop inside the engine.
 */

describe('what a step asks for', () => {
  it('is nothing at all on an empty column', () => {
    expect(triggersForStep(createPattern(), createMixer(), 0)).toEqual([]);
  });

  it('names the voice and the level for each firing track', () => {
    const pattern = setCell(createPattern(), 0, 4, true);
    const mixer = setVolume(createMixer(), 0, 0.8);

    expect(triggersForStep(pattern, mixer, 4)).toEqual([{ track: 0, trackId: 'kick', level: 0.8 }]);
  });

  it('reports firing tracks in row order', () => {
    let pattern = createPattern();
    pattern = setCell(pattern, 5, 2, true);
    pattern = setCell(pattern, 1, 2, true);
    pattern = setCell(pattern, 3, 2, true);

    expect(triggersForStep(pattern, createMixer(), 2).map((trigger) => trigger.trackId)).toEqual([
      'snare',
      'openHat',
      'lowPerc',
    ]);
  });

  it('drops a muted track entirely rather than playing it at nothing', () => {
    /*
     * The distinction matters. A voice at zero gain still builds an audio graph, still
     * allocates nodes and still costs the audio thread work for something nobody can
     * hear. Dropping it here is what makes a muted track genuinely free.
     */
    const pattern = setCell(createPattern(), 0, 0, true);
    expect(triggersForStep(pattern, toggleMute(createMixer(), 0), 0)).toEqual([]);
  });

  it('drops a track faded all the way down', () => {
    const pattern = setCell(createPattern(), 2, 0, true);
    expect(triggersForStep(pattern, setVolume(createMixer(), 2, 0), 0)).toEqual([]);
  });

  it('keeps the tracks around a muted one', () => {
    let pattern = createPattern();
    pattern = setCell(pattern, 0, 0, true);
    pattern = setCell(pattern, 1, 0, true);
    pattern = setCell(pattern, 2, 0, true);

    const triggers = triggersForStep(pattern, toggleMute(createMixer(), 1), 0);
    expect(triggers.map((trigger) => trigger.trackId)).toEqual(['kick', 'closedHat']);
  });

  it('asks for nothing on a step outside the bar', () => {
    const pattern = setCell(createPattern(), 0, 0, true);
    expect(triggersForStep(pattern, createMixer(), 16)).toEqual([]);
    expect(triggersForStep(pattern, createMixer(), -1)).toEqual([]);
  });

  it('can ask for the whole kit at once', () => {
    let pattern = createPattern();
    for (let track = 0; track < 8; track += 1) pattern = setCell(pattern, track, 0, true);
    expect(triggersForStep(pattern, createMixer(), 0)).toHaveLength(8);
  });
});
