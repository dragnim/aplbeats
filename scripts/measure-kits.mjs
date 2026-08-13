/*
 * Measure every drum machine, and check the calibration.
 *
 *   npm run dev
 *   npm run measure:kits
 *   npm run measure:kits -- --gains     print the gains the measurements imply
 *
 * `measure:kit` measures the synthesised voices. This measures all of them, and answers the
 * question Stage 4 has to answer before it can claim the kits are comparable: does changing
 * the drum machine change the volume?
 *
 * The rule being checked is one sentence. Every sample is scaled so that at full level it peaks
 * where the synthesised voice for the same row peaks. That leaves timbre, decay and transient
 * shape completely alone — so an 808 kick still booms and an SK-1 snare is still a toy — while
 * removing the arbitrary level differences between one stranger's sample pack and another's.
 * Several upstream files decode above full scale, being lossy encodes, so this is not a
 * refinement: without it, choosing a kit would be a way of clipping the master bus.
 *
 * Three things are measured: each voice alone, the opening groove through the real master
 * chain, and the worst case of all eight rows on one step with every fader up.
 *
 * Advisory rather than a gate, except for clipping and silence, which are failures.
 */

/*
 * `page.evaluate` hands back `any` — the browser is the other side of a serialisation boundary
 * and there is nothing this side can know about what crossed it. Every read of it below is a
 * number going into a `toFixed`, so the unsafety is real but bounded and local to this script.
 */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { chromium } from '@playwright/test';

const url = process.env.MEASURE_URL ?? 'http://localhost:5173/aplbeats/';
const showGains = process.argv.includes('--gains');

/*
 * How far below the synthesised reference a sampled voice is aimed.
 *
 * Matching the synth peak exactly is the obvious rule and it very nearly worked: every kit
 * landed within a decibel, but two of them put a single sample at full scale in the
 * pathological case of all eight rows firing at once with every fader at the top. The
 * synthesised kit itself measures −0.2 dBFS there, so there was never any headroom in that
 * case to give away.
 *
 * Six tenths of a decibel below, then. It is inaudible as a level change — well inside the
 * ±1.5 dB the calibration is checked against — and it is the difference between "no clipped
 * samples" and "one clipped sample", which is worth having as a fact rather than as a nearly.
 */
const HEADROOM = 0.93;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => {
  console.error(`page error: ${error.message}`);
});

await page.goto(url, { waitUntil: 'networkidle' });

const measurements = await page.evaluate(async () => {
  const { SYNTH_KIT } = await import('./src/audio/kit.ts');
  const { createSampleKit } = await import('./src/audio/sampleKit.ts');
  const { KITS, sampleUrl } = await import('./src/audio/kits/kits.ts');
  const { isSampleKit } = await import('./src/audio/kits/types.ts');
  const { createNoiseBuffer, resetNoiseCursor, saturator } = await import('./src/audio/dsp.ts');
  const { TRACKS } = await import('./src/pattern/tracks.ts');
  const { createInitialGroove } = await import('./src/pattern/initialGroove.ts');
  const { triggersForStep } = await import('./src/audio/triggers.ts');
  const { createMixer } = await import('./src/pattern/mixer.ts');

  /*
   * 44.1 kHz, which is the rate every bundled sample is at.
   *
   * Not an arbitrary choice. Rendering at 48 kHz resamples the buffers on playback, and
   * resampling flattens a sharp transient — a hi-hat, being almost entirely transient, loses
   * around two decibels of peak that way while a conga loses almost none. Measuring at the
   * source rate takes that out of the comparison, so what the deviation column shows is the
   * calibration rather than the interpolator.
   *
   * It is also the more conservative clipping test, for the same reason: peaks are highest
   * when nothing has been smoothed.
   *
   * A visitor's device may well run at 48 kHz, and there the sharpest voices will sit a
   * decibel or two below these figures. That is inaudible, and it is in the safe direction.
   */
  const RATE = 44_100;
  const base = new URL('.', location.href).pathname;

  /** Describe a rendered buffer. */
  function describe(samples, sampleRate, from = 0) {
    let peak = 0;
    let sumOfSquares = 0;
    let lastAudible = 0;
    let clipped = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const magnitude = Math.abs(samples[i]);
      if (magnitude > peak) peak = magnitude;
      if (magnitude >= 0.999) clipped += 1;
      sumOfSquares += samples[i] * samples[i];
      if (magnitude > 0.005) lastAudible = i;
    }
    return {
      peak,
      rms: Math.sqrt(sumOfSquares / samples.length),
      lengthMs: Math.max(0, (lastAudible / sampleRate - from) * 1000),
      clipped,
    };
  }

  /** The master chain, exactly as `AudioEngine` builds it. */
  function masterChain(context) {
    const master = context.createGain();
    master.gain.value = 0.72;
    const glue = context.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.knee.value = 8;
    glue.ratio.value = 3.2;
    glue.attack.value = 0.004;
    glue.release.value = 0.14;
    master.connect(glue);
    /*
     * The master volume node, always at 1.
     *
     * Included so this chain is the one the engine really builds, and pinned at full output
     * so that what is measured is the instrument rather than whatever level happens to be
     * stored in somebody's browser. A gain of 1 is arithmetically a no-op, so these figures —
     * and the Stage 4 kit calibration derived from them — are unaffected by the control
     * existing.
     */
    const output = context.createGain();
    output.gain.value = 1;
    glue.connect(saturator(context, 1.25)).connect(output);
    output.connect(context.destination);
    return master;
  }

  /* ---- decode every sampled kit ------------------------------------------- */

  const decoder = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44_100 });

  /** kitId → { kit, rawPeaks } */
  const built = new Map();
  for (const definition of KITS) {
    if (!isSampleKit(definition)) continue;

    const files = [...new Set(Object.values(definition.voices).map((voice) => voice.file))];
    const buffers = {};
    const rawPeaks = {};

    for (const file of files) {
      const response = await fetch(sampleUrl(definition.directory, file, base));
      const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
      buffers[file] = buffer;

      // The peak of the file itself, before any gain: what the calibration divides into.
      let peak = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i += 1) {
          const magnitude = Math.abs(data[i]);
          if (magnitude > peak) peak = magnitude;
        }
      }
      rawPeaks[file] = peak;
    }

    built.set(definition.id, { definition, kit: createSampleKit(definition, buffers), buffers, rawPeaks });
  }

  /* ---- one voice at a time ------------------------------------------------ */

  /**
   * Render one voice at full level, with no master chain.
   *
   * Full level rather than the track's default volume, because what is being compared is the
   * voice itself; the faders are the musical balance and are the same for every kit.
   */
  async function renderVoice(kit, trackId) {
    const context = new OfflineAudioContext(1, RATE * 3, RATE);
    const master = context.createGain();
    master.gain.value = 1;
    master.connect(context.destination);
    resetNoiseCursor();
    kit[trackId]({ context, destination: master, noise: createNoiseBuffer(context) }, 0.01, 1);
    const rendered = await context.startRendering();
    return describe(rendered.getChannelData(0), RATE, 0.01);
  }

  const synthVoices = {};
  for (const track of TRACKS) synthVoices[track.id] = await renderVoice(SYNTH_KIT, track.id);

  const perKit = [];
  for (const [id, entry] of built) {
    const voices = {};
    for (const track of TRACKS) voices[track.id] = await renderVoice(entry.kit, track.id);
    perKit.push({
      id,
      name: entry.definition.name,
      voices,
      rawPeaks: entry.rawPeaks,
      definition: entry.definition,
    });
  }

  /* ---- the groove, and the worst case ------------------------------------- */

  const groove = createInitialGroove();
  const mixer = createMixer();

  /** The opening groove through the real master chain, at the opening tempo. */
  async function renderGroove(kit) {
    const seconds = 2.2;
    const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
    const master = masterChain(context);
    resetNoiseCursor();
    const voiceContext = { context, destination: master, noise: createNoiseBuffer(context) };

    // 112 BPM, straight: a sixteenth is 60 / 112 / 4 seconds.
    const step = 60 / 112 / 4;
    for (let index = 0; index < 16; index += 1) {
      for (const trigger of triggersForStep(groove, mixer, index)) {
        kit[trigger.trackId](voiceContext, 0.02 + index * step, trigger.level);
      }
    }

    const rendered = await context.startRendering();
    return describe(rendered.getChannelData(0), RATE);
  }

  /** Every row on one step, every fader at the top, through the real master chain. */
  async function renderWorstCase(kit) {
    const context = new OfflineAudioContext(1, RATE * 2, RATE);
    const master = masterChain(context);
    resetNoiseCursor();
    const voiceContext = { context, destination: master, noise: createNoiseBuffer(context) };
    for (const track of TRACKS) kit[track.id](voiceContext, 0.02, 1);
    const rendered = await context.startRendering();
    return describe(rendered.getChannelData(0), RATE);
  }

  const synthGroove = await renderGroove(SYNTH_KIT);
  const synthWorst = await renderWorstCase(SYNTH_KIT);

  for (const entry of perKit) {
    const kit = built.get(entry.id).kit;
    entry.groove = await renderGroove(kit);
    entry.worst = await renderWorstCase(kit);
  }

  return { synthVoices, synthGroove, synthWorst, perKit };
});

/* ---- report ---------------------------------------------------------------- */

const dB = (value) => (value <= 0 ? '-inf' : (20 * Math.log10(value)).toFixed(1));
const ROWS = ['kick', 'snare', 'closedHat', 'openHat', 'clap', 'lowPerc', 'highPerc', 'rim'];

console.log('\nPer-voice peak at full level, dBFS. The synthesised kit is the reference.\n');
const header = `${'kit'.padEnd(17)}${ROWS.map((row) => row.slice(0, 7).padStart(8)).join('')}`;
console.log(header);
console.log('-'.repeat(header.length));
console.log(
  `${'synth'.padEnd(17)}${ROWS.map((row) => dB(measurements.synthVoices[row].peak).padStart(8)).join('')}`,
);
for (const kit of measurements.perKit) {
  console.log(`${kit.name.padEnd(17)}${ROWS.map((row) => dB(kit.voices[row].peak).padStart(8)).join('')}`);
}

console.log('\nDeviation from the synthesised reference, dB. Anything past ±1.5 is a mis-calibration.\n');
console.log(header);
console.log('-'.repeat(header.length));
let worstDeviation = 0;
const offenders = [];
for (const kit of measurements.perKit) {
  const cells = ROWS.map((row) => {
    const reference = measurements.synthVoices[row].peak;
    const measured = kit.voices[row].peak;
    const delta = 20 * Math.log10(measured / reference);
    if (Math.abs(delta) > Math.abs(worstDeviation)) worstDeviation = delta;

    /*
     * A little more room for a voice played fast.
     *
     * The three substitutions that use `playbackRate` — the SK-1's clap and high percussion,
     * the MFB-512's rim — are resampled on the way out, and resampling a transient costs a
     * fraction of a decibel of peak that the gain cannot predict. Understood, unavoidable, and
     * in the safe direction.
     */
    const rateShifted = (kit.definition.voices[row].playbackRate ?? 1) !== 1;
    const tolerance = rateShifted ? 2 : 1.5;
    if (Math.abs(delta) > tolerance) {
      offenders.push(`${kit.name} ${row} ${delta.toFixed(1)} dB`);
    }
    return (delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)).padStart(8);
  });
  console.log(`${kit.name.padEnd(17)}${cells.join('')}`);
}

console.log('\nThe opening groove, and the worst case, through the real master chain.\n');
console.log('kit                groove peak    groove RMS    all-eight peak    clipped');
console.log('-'.repeat(76));
const line = (name, groove, worst) =>
  `${name.padEnd(17)} ${dB(groove.peak).padStart(11)}  ${groove.rms.toFixed(4).padStart(12)}  ` +
  `${dB(worst.peak).padStart(16)}  ${String(groove.clipped + worst.clipped).padStart(9)}`;
console.log(line('synth', measurements.synthGroove, measurements.synthWorst));
for (const kit of measurements.perKit) console.log(line(kit.name, kit.groove, kit.worst));

console.log('\nSample length, ms. Long open hats are why the hats choke each other.\n');
console.log(header);
console.log('-'.repeat(header.length));
for (const kit of measurements.perKit) {
  console.log(
    `${kit.name.padEnd(17)}${ROWS.map((row) => Math.round(kit.voices[row].lengthMs).toString().padStart(8)).join('')}`,
  );
}

if (showGains) {
  console.log('\nThe gains these measurements imply, for src/audio/kits/kits.ts.\n');
  for (const kit of measurements.perKit) {
    console.log(`  ${kit.id}:`);
    for (const row of ROWS) {
      const file = kit.definition.voices[row].file;
      const raw = kit.rawPeaks[file];
      const target = measurements.synthVoices[row].peak * HEADROOM;
      const rate = kit.definition.voices[row].playbackRate ?? 1;
      console.log(
        `    ${row.padEnd(10)} gain: ${(target / raw).toFixed(3)}` +
          `${rate === 1 ? '' : `, playbackRate: ${String(rate)}`}   (file peak ${raw.toFixed(3)})`,
      );
    }
  }
}

/* ---- verdicts -------------------------------------------------------------- */

const silent = [];
for (const kit of measurements.perKit) {
  for (const row of ROWS) {
    if (kit.voices[row].peak < 0.01) silent.push(`${kit.name} ${row}`);
  }
}

const clipping = [
  ...(measurements.synthGroove.clipped + measurements.synthWorst.clipped > 0 ? ['synth'] : []),
  ...measurements.perKit.filter((kit) => kit.groove.clipped + kit.worst.clipped > 0).map((kit) => kit.name),
];

console.log('');
if (silent.length > 0) {
  console.error(`Silent or near-silent: ${silent.join(', ')}`);
  process.exitCode = 1;
}
if (clipping.length > 0) {
  console.error(`Clipping: ${clipping.join(', ')}`);
  process.exitCode = 1;
}
if (offenders.length > 0) {
  console.log(`Outside ±1.5 dB of the target: ${offenders.join('; ')}`);
}
if (silent.length === 0 && clipping.length === 0) {
  console.log(
    `No clipping anywhere, nothing silent, worst calibration deviation ${worstDeviation.toFixed(1)} dB.`,
  );
}

await browser.close();
