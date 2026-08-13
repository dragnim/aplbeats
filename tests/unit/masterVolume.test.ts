import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '@/audio/AudioEngine';
import { Transport } from '@/transport/Transport';
import { loadMasterVolume, saveMasterVolume } from '@/app/persistence';
import { createMixer } from '@/pattern/mixer';
import { createInitialGroove } from '@/pattern/initialGroove';
import { SYNTH_KIT } from '@/audio/kit';

/*
 * The master volume, and the two things about it that could quietly go wrong.
 *
 * The first is *where* it sits. It has to be the last node before the speakers, after the
 * compressor and the limiter — because anywhere earlier it would change how hard the compressor
 * is driven, which is part of how the instrument sounds and part of the gain staging every
 * sampled kit was calibrated against in Stage 4. A volume control that recalibrated the kits
 * every time somebody turned it down would be a bug it took months to notice.
 *
 * The second is that moving it must not open an audio device. A page that started an
 * `AudioContext` because somebody touched a fader would be a page that made noise nobody asked
 * for, which is the one thing every stage of this project has refused to do.
 *
 * jsdom has no Web Audio, so the graph is recorded rather than heard: what is asserted is what
 * was built and what was asked of it.
 */

/* ---- a recording audio context -------------------------------------------- */

interface Node {
  readonly kind: string;
  /** What this node is connected to, in order. */
  readonly outputs: Node[];
  gainValue: number;
  /** Ramps scheduled on a gain, as [value, time]. */
  readonly ramps: [number, number][];
  readonly holds: [number, number][];
  cancelled: number[];
}

class Recorder {
  readonly nodes: Node[] = [];
  currentTime = 0;
  state: AudioContextState = 'suspended';
  /** How many contexts have been constructed. Zero is the interesting number. */
  static built = 0;

  private readonly make = (kind: string): Node => {
    const node: Node = {
      kind,
      outputs: [],
      gainValue: 1,
      ramps: [],
      holds: [],
      cancelled: [],
    };
    this.nodes.push(node);
    return node;
  };

  /**
   * An `AudioParam` that records what was asked of it.
   *
   * Complete enough for the synthesised voices to build themselves, because the transport tests
   * genuinely play — a fake that only supported the methods the volume control happens to use
   * would fail the moment a kick was scheduled through it, which is the case worth testing.
   */
  private readonly param = (node: Node, isGain: boolean): unknown => {
    return {
      get value(): number {
        return isGain ? node.gainValue : 0;
      },
      set value(next: number) {
        if (isGain) node.gainValue = next;
      },
      setValueAtTime: (value: number, when: number) => {
        if (isGain) node.holds.push([value, when]);
      },
      linearRampToValueAtTime: (value: number, when: number) => {
        if (isGain) node.ramps.push([value, when]);
      },
      exponentialRampToValueAtTime: () => undefined,
      setTargetAtTime: () => undefined,
      setValueCurveAtTime: () => undefined,
      cancelScheduledValues: (when: number) => {
        if (isGain) node.cancelled.push(when);
      },
      cancelAndHoldAtTime: () => undefined,
    };
  };

  /** A node dressed up enough for the engine and its voices to use it. */
  private readonly wrap = (node: Node): unknown => {
    return {
      __node: node,
      gain: this.param(node, true),
      frequency: this.param(node, false),
      detune: this.param(node, false),
      Q: this.param(node, false),
      playbackRate: this.param(node, false),
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      type: 'sine',
      curve: null,
      oversample: 'none',
      buffer: null,
      onended: null,
      start: () => undefined,
      stop: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      connect: (target: { __node?: Node }) => {
        node.outputs.push(target.__node ?? this.destinationNode);
        return target;
      },
      disconnect: () => undefined,
    };
  };

  readonly destinationNode: Node = {
    kind: 'destination',
    outputs: [],
    gainValue: 1,
    ramps: [],
    holds: [],
    cancelled: [],
  };

  context(): AudioContext {
    Recorder.built += 1;
    this.nodes.push(this.destinationNode);

    /*
     * Arrow-bound reads, so the object literal reports the recorder's clock and state rather
     * than its own — and so nothing has to alias `this` to get at them.
     */
    const clock = (): number => this.currentTime;
    const state = (): AudioContextState => this.state;

    return {
      get currentTime(): number {
        return clock();
      },
      get state(): AudioContextState {
        return state();
      },
      sampleRate: 44_100,
      destination: { __node: this.destinationNode, connect: () => undefined },
      createGain: () => this.wrap(this.make('gain')),
      createDynamicsCompressor: () => this.wrap(this.make('compressor')),
      createWaveShaper: () => this.wrap(this.make('shaper')),
      createBuffer: (channels: number, length: number, rate: number) => ({
        length,
        numberOfChannels: channels,
        sampleRate: rate,
        getChannelData: () => new Float32Array(length),
      }),
      createBufferSource: () => this.wrap(this.make('source')),
      createOscillator: () => this.wrap(this.make('oscillator')),
      createBiquadFilter: () => this.wrap(this.make('filter')),
      resume: () => {
        this.state = 'running';
        return Promise.resolve();
      },
      suspend: () => {
        this.state = 'suspended';
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    } as unknown as AudioContext;
  }

  /** The gain nodes, in the order the engine created them. */
  get gains(): Node[] {
    return this.nodes.filter((node) => node.kind === 'gain');
  }

  /** Whatever is connected directly to the speakers. */
  get feedingDestination(): Node[] {
    return this.nodes.filter((node) => node.outputs.includes(this.destinationNode));
  }
}

/** An engine wired to a recorder, with the audio device opened. */
async function running(): Promise<{ engine: AudioEngine; recorder: Recorder }> {
  const recorder = new Recorder();
  const engine = new AudioEngine({ createContext: () => recorder.context() });
  await engine.unlock();
  return { engine, recorder };
}

/* ------------------------------------------------------------------------- */

describe('where the volume sits in the chain', () => {
  it('is the last node before the speakers', async () => {
    /*
     * The assertion the whole feature rests on. Exactly one node reaches the destination, and it
     * is a gain — so the signal arriving at the speakers has already been compressed and limited,
     * and this only makes it quieter.
     */
    const { recorder } = await running();

    const feeding = recorder.feedingDestination;
    expect(feeding).toHaveLength(1);
    expect(feeding[0]?.kind).toBe('gain');
  });

  it('is fed by the limiter, not by the mix bus', async () => {
    // Mix bus → compressor → limiter → volume → speakers, in that order and no other.
    const { recorder } = await running();

    const volume = recorder.feedingDestination[0];
    const feedsVolume = recorder.nodes.filter((node) => node.outputs.includes(volume!));
    expect(feedsVolume).toHaveLength(1);
    expect(feedsVolume[0]?.kind).toBe('shaper');

    const feedsLimiter = recorder.nodes.filter((node) => node.outputs.includes(feedsVolume[0]!));
    expect(feedsLimiter[0]?.kind).toBe('compressor');
  });

  it('leaves the internal gain staging exactly as it was', async () => {
    /*
     * 0.72 on the mix bus, before the compressor, unchanged and not user-controlled. That number
     * decides how hard the compressor is driven; it is part of how the instrument sounds and part
     * of what every sampled kit was calibrated against. Turning the volume down must not touch it.
     */
    const { engine, recorder } = await running();

    const mixBus = recorder.nodes.find((node) => node.kind === 'gain');
    expect(mixBus?.gainValue).toBeCloseTo(0.72, 6);

    engine.setMasterVolume(0.2);
    expect(mixBus?.gainValue).toBeCloseTo(0.72, 6);
  });

  it('starts at full output, so nothing sounds different by default', async () => {
    const { engine, recorder } = await running();

    expect(engine.volume).toBe(1);
    expect(recorder.feedingDestination[0]?.gainValue).toBe(1);
  });
});

describe('setting the volume', () => {
  it('clamps below zero and above one', () => {
    const engine = new AudioEngine({ createContext: () => new Recorder().context() });

    engine.setMasterVolume(-3);
    expect(engine.volume).toBe(0);

    // Attenuation only. A volume that could add gain could clip, and the headroom at the top of
    // this chain was measured rather than guessed.
    engine.setMasterVolume(4);
    expect(engine.volume).toBe(1);
  });

  it('accepts the ends of the range', () => {
    const engine = new AudioEngine({ createContext: () => new Recorder().context() });
    engine.setMasterVolume(0);
    expect(engine.volume).toBe(0);
    engine.setMasterVolume(1);
    expect(engine.volume).toBe(1);
  });

  it('falls back to full output for a number that is not one', () => {
    // Silence would be the worse failure: nobody can tell a silent drum machine from a broken one.
    const engine = new AudioEngine({ createContext: () => new Recorder().context() });
    engine.setMasterVolume(Number.NaN);
    expect(engine.volume).toBe(1);
    engine.setMasterVolume(Number.POSITIVE_INFINITY);
    expect(engine.volume).toBe(1);
  });

  it('reaches zero, and means it', async () => {
    const { engine, recorder } = await running();
    engine.setMasterVolume(0);

    const volume = recorder.feedingDestination[0];
    expect(volume?.ramps.at(-1)?.[0]).toBe(0);
  });
});

describe('changing it while the machine is stopped', () => {
  it('opens no audio device', () => {
    /*
     * The rule every stage of this project has kept: nothing opens an `AudioContext` except a
     * gesture that asks for sound. A fader is not one.
     */
    Recorder.built = 0;
    const engine = new AudioEngine({
      createContext: () => {
        throw new Error('the engine built a context to change the volume');
      },
    });

    expect(() => {
      engine.setMasterVolume(0.4);
    }).not.toThrow();
    expect(engine.volume).toBe(0.4);
    expect(Recorder.built).toBe(0);
  });

  it('remembers the level, so a graph built later opens at it', async () => {
    const recorder = new Recorder();
    const engine = new AudioEngine({ createContext: () => recorder.context() });

    engine.setMasterVolume(0.5);
    expect(recorder.nodes).toHaveLength(0);

    await engine.unlock();

    // Set on the node when it was created, not ramped to afterwards: a graph that opened loud
    // and then faded would be a click at the start of every session.
    const volume = recorder.feedingDestination[0];
    expect(volume?.gainValue).toBe(0.5);
    expect(volume?.ramps).toEqual([]);
  });
});

describe('changing it while it is playing', () => {
  it('ramps rather than jumping, so the change does not click', async () => {
    const { engine, recorder } = await running();
    recorder.currentTime = 4;

    engine.setMasterVolume(0.25);

    const volume = recorder.feedingDestination[0];
    // Pinned at the current value, then moved to the new one over a short, finite time.
    expect(volume?.holds.at(-1)?.[1]).toBe(4);
    expect(volume?.ramps.at(-1)?.[0]).toBe(0.25);

    const arrivesAt = volume?.ramps.at(-1)?.[1] ?? 0;
    expect(arrivesAt).toBeGreaterThan(4);
    // Short enough to feel immediate, and nothing like a seconds-long tail.
    expect(arrivesAt).toBeLessThanOrEqual(4.05);
  });

  it('cancels what was already scheduled, so a dragged fader cannot queue a tail', async () => {
    const { engine, recorder } = await running();
    const volume = recorder.feedingDestination[0];

    for (const step of [0.9, 0.7, 0.5, 0.3, 0.1]) {
      recorder.currentTime += 0.01;
      engine.setMasterVolume(step);
    }

    // One cancel per change, and the last ramp is to where the fader actually ended up.
    expect(volume?.cancelled).toHaveLength(5);
    expect(volume?.ramps.at(-1)?.[0]).toBe(0.1);
    expect(engine.volume).toBe(0.1);
  });

  it('survives a kit change', async () => {
    // The two are unrelated, and neither may reach into the other.
    const { engine, recorder } = await running();
    engine.setMasterVolume(0.37);

    engine.setKit({ ...SYNTH_KIT });

    expect(engine.volume).toBe(0.37);
    expect(recorder.feedingDestination[0]?.ramps.at(-1)?.[0]).toBe(0.37);
  });
});

/* ------------------------------------------------------------------------- */

describe('the transport boundary', () => {
  /** A transport wired to a recorder, without React anywhere near it. */
  function transport(): { transport: Transport; recorder: Recorder; engine: AudioEngine } {
    const recorder = new Recorder();
    const engine = new AudioEngine({ createContext: () => recorder.context() });
    return {
      recorder,
      engine,
      transport: new Transport({
        getPattern: () => createInitialGroove(),
        getMixer: () => createMixer(),
        bpm: 112,
        swing: 0.18,
        engine,
        setTimer: () => () => undefined,
      }),
    };
  }

  it('forwards the level to the engine', () => {
    /*
     * React never touches the audio graph. The chain is App → useTransport → Transport →
     * AudioEngine, and Stage 5.1 adds one narrow forward rather than a shortcut past it.
     */
    const { transport: player, engine } = transport();

    player.setMasterVolume(0.4);
    expect(engine.volume).toBe(0.4);
  });

  it('does not start the transport, or open a device', () => {
    const { transport: player, recorder } = transport();

    player.setMasterVolume(0.3);

    expect(player.currentState).toBe('stopped');
    expect(recorder.nodes).toHaveLength(0);
  });

  it('leaves tempo, swing and position alone', async () => {
    const { transport: player, engine } = transport();
    await player.play();

    const before = player.playheadStep();
    player.setMasterVolume(0.1);

    expect(player.currentState).toBe('playing');
    expect(player.playheadStep()).toBe(before);
    expect(engine.volume).toBe(0.1);

    player.pause();
  });

  it('is unaffected by a kit change, and does not affect one', () => {
    const { transport: player, engine } = transport();

    player.setMasterVolume(0.37);
    player.setKit({ ...SYNTH_KIT });

    expect(engine.volume).toBe(0.37);
  });
});

describe('remembering the level', () => {
  it('is full volume when nothing is stored', () => {
    window.localStorage.clear();
    expect(loadMasterVolume()).toBe(1);
  });

  it('round-trips the values somebody might actually choose', () => {
    for (const volume of [0, 0.37, 0.5, 1]) {
      window.localStorage.clear();
      saveMasterVolume(volume);
      expect(loadMasterVolume()).toBe(volume);
    }
  });

  it('keeps silence, rather than treating it as absent', () => {
    // 0 is a real choice and must survive a reload. Falsy is not the same as missing.
    window.localStorage.clear();
    saveMasterVolume(0);
    expect(loadMasterVolume()).toBe(0);
  });

  it('ignores anything it cannot trust', () => {
    for (const stored of [
      'not json at all',
      JSON.stringify({ schema: 99, volume: 0.4 }),
      JSON.stringify({ schema: 1, volume: 'loud' }),
      JSON.stringify({ schema: 1, volume: null }),
      JSON.stringify({ schema: 1 }),
      JSON.stringify({ volume: 0.4 }),
      JSON.stringify([0.4]),
      JSON.stringify(0.4),
    ]) {
      window.localStorage.clear();
      window.localStorage.setItem('aplbeats.master-volume.v1', stored);
      expect(loadMasterVolume(), stored).toBe(1);
    }
  });

  it('brings an out-of-range value back into range rather than discarding it', () => {
    window.localStorage.clear();
    window.localStorage.setItem('aplbeats.master-volume.v1', JSON.stringify({ schema: 1, volume: 5 }));
    expect(loadMasterVolume()).toBe(1);

    window.localStorage.setItem('aplbeats.master-volume.v1', JSON.stringify({ schema: 1, volume: -2 }));
    expect(loadMasterVolume()).toBe(0);
  });

  it('is written under its own key, not inside the session', () => {
    /*
     * How loud somebody wants their speakers is a fact about their room, not about their groove.
     * Coupling it to the session would throw it away whenever a generator version invalidated a
     * stored bar, which would be losing it for no reason.
     */
    window.localStorage.clear();
    saveMasterVolume(0.42);

    expect(window.localStorage.getItem('aplbeats.master-volume.v1')).not.toBeNull();
    expect(window.localStorage.getItem('aplbeats.session.v1')).toBeNull();
  });

  it('survives a storage that refuses to be written to', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => {
      saveMasterVolume(0.5);
    }).not.toThrow();
    setItem.mockRestore();
  });
});
