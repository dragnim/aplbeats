/*
 * A recording audio context.
 *
 * jsdom has no Web Audio, so the tests that care about the audio graph record it rather than hear
 * it: what is asserted is what was built and what was asked of it. Complete enough for the
 * synthesised voices and the Tone sampler to build themselves, because those tests genuinely play
 * — a fake that only supported the methods one control happens to use would fail the moment a
 * kick was scheduled through it, which is the case worth testing.
 *
 * Shared rather than copied. It was local to the master-volume tests until Stage 8 needed the same
 * graph to prove that a melody and a drum land on the same instant, and two recorders drifting
 * apart would mean two different ideas of what Web Audio does.
 */

export interface RecordedNode {
  readonly kind: string;
  /** What this node is connected to, in order. */
  readonly outputs: RecordedNode[];
  gainValue: number;
  /** Ramps scheduled on a gain, as [value, time]. */
  readonly ramps: [number, number][];
  readonly holds: [number, number][];
  cancelled: number[];
}

export class Recorder {
  readonly nodes: RecordedNode[] = [];
  currentTime = 0;
  state: AudioContextState = 'suspended';
  /** How many contexts have been constructed. Zero is the interesting number. */
  static built = 0;

  private readonly make = (kind: string): RecordedNode => {
    const node: RecordedNode = {
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
  private readonly param = (node: RecordedNode, isGain: boolean): unknown => {
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
  private readonly wrap = (node: RecordedNode): unknown => {
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
      connect: (target: { __node?: RecordedNode }) => {
        node.outputs.push(target.__node ?? this.destinationNode);
        return target;
      },
      disconnect: () => undefined,
    };
  };

  readonly destinationNode: RecordedNode = {
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
  get gains(): RecordedNode[] {
    return this.nodes.filter((node) => node.kind === 'gain');
  }

  /** Whatever is connected directly to the speakers. */
  get feedingDestination(): RecordedNode[] {
    return this.nodes.filter((node) => node.outputs.includes(this.destinationNode));
  }
}
