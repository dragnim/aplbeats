/*
 * Render generated bars and measure what comes out.
 *
 * The generator can now produce bars with thirty-odd triggers and five voices landing on
 * one sixteenth, which the hand-written opening groove never did. Whether that clips, and
 * whether the compressor is being asked to do too much, is arithmetic rather than
 * judgement — and it is the kind of arithmetic that is invisible until somebody listens on
 * good headphones and wonders why the kick disappeared.
 *
 * Drives the Vite dev server so the browser imports the real generator and the real kit,
 * then renders a whole bar through the real master chain in an OfflineAudioContext.
 *
 *   npm run dev
 *   npm run measure:generated
 */

import { chromium } from '@playwright/test';

const url = process.env.MEASURE_URL ?? 'http://localhost:5173/aplbeats/';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => {
  console.error(`page error: ${error.message}`);
});

await page.goto(url, { waitUntil: 'networkidle' });

const results = await page.evaluate(async () => {
  const { generatePattern } = await import('./src/generation/generator.ts');
  const { PRESET_IDS } = await import('./src/generation/presets.ts');
  const { measurePattern } = await import('./src/generation/metrics.ts');
  const { SYNTH_KIT } = await import('./src/audio/kit.ts');
  const { createNoiseBuffer, resetNoiseCursor, saturator } = await import('./src/audio/dsp.ts');
  const { TRACKS } = await import('./src/pattern/tracks.ts');
  const { triggersForStep } = await import('./src/audio/triggers.ts');
  const { createMixer } = await import('./src/pattern/mixer.ts');

  const sampleRate = 48_000;
  const mixer = createMixer();

  /** One bar of a pattern at 112 BPM, rendered through the real master chain. */
  async function renderBar(pattern) {
    const secondsPerStep = 60 / 112 / 4;
    const context = new OfflineAudioContext(1, Math.ceil(sampleRate * (secondsPerStep * 16 + 1)), sampleRate);

    const master = context.createGain();
    master.gain.value = 0.72;
    const glue = context.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.knee.value = 8;
    glue.ratio.value = 3.2;
    glue.attack.value = 0.004;
    glue.release.value = 0.14;
    master.connect(glue);
    glue.connect(saturator(context, 1.25)).connect(context.destination);

    resetNoiseCursor();
    const voiceContext = { context, destination: master, noise: createNoiseBuffer(context) };

    for (let step = 0; step < 16; step += 1) {
      const time = 0.02 + step * secondsPerStep;
      for (const trigger of triggersForStep(pattern, mixer, step)) {
        SYNTH_KIT[trigger.trackId](voiceContext, time, trigger.level);
      }
    }

    const rendered = await context.startRendering();
    const samples = rendered.getChannelData(0);

    let peak = 0;
    let clipped = 0;
    let sumOfSquares = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const magnitude = Math.abs(samples[i]);
      if (magnitude > peak) peak = magnitude;
      if (magnitude >= 0.999) clipped += 1;
      sumOfSquares += samples[i] * samples[i];
    }

    return { peak, clipped, rms: Math.sqrt(sumOfSquares / samples.length) };
  }

  const perPreset = [];
  for (const preset of PRESET_IDS) {
    let worstPeak = 0;
    let totalClipped = 0;
    let loudestRms = 0;
    let busiest = 0;
    let biggestStack = 0;

    // The worst case a visitor can reach: everything turned up.
    for (let index = 0; index < 8; index += 1) {
      const pattern = generatePattern({
        seed: 1000 + index * 7919,
        preset,
        density: 100,
        complexity: 70,
        syncopation: 50,
      });

      const metrics = measurePattern(pattern);
      busiest = Math.max(busiest, metrics.triggers);
      biggestStack = Math.max(biggestStack, metrics.maxStack);

      const measured = await renderBar(pattern);
      worstPeak = Math.max(worstPeak, measured.peak);
      totalClipped += measured.clipped;
      loudestRms = Math.max(loudestRms, measured.rms);
    }

    perPreset.push({ preset, worstPeak, totalClipped, loudestRms, busiest, biggestStack });
  }

  return { perPreset, trackCount: TRACKS.length };
});

const decibels = (value) => (value <= 0 ? '-inf' : (20 * Math.log10(value)).toFixed(1));

console.log('');
console.log('At Density 100, eight seeds each, every fader at its default:');
console.log('preset          triggers  stack   peak     dBFS    RMS      clipped');
console.log('-----------------------------------------------------------------------');

let anyClipping = 0;
for (const row of results.perPreset) {
  anyClipping += row.totalClipped;
  console.log(
    `${row.preset.padEnd(15)} ${String(row.busiest).padStart(6)}  ${String(row.biggestStack).padStart(5)}  ` +
      `${row.worstPeak.toFixed(3).padStart(6)}  ${decibels(row.worstPeak).padStart(6)}  ` +
      `${row.loudestRms.toFixed(4).padStart(7)}  ${String(row.totalClipped).padStart(7)}`,
  );
}

console.log('');
if (anyClipping > 0) {
  console.error(`Clipping: ${String(anyClipping)} samples at or beyond full scale.`);
  process.exitCode = 1;
} else {
  console.log('No clipping anywhere, at any preset, at full density.');
}

await browser.close();
