/*
 * Measure the kit.
 *
 * Whether a drum sounds good is a judgement no program can make. Whether it makes any
 * sound at all, how loud it is next to the others, how long it rings and whether the
 * eight of them together clip is arithmetic — and arithmetic is worth checking, because
 * every one of those is a way for a voice to be quietly wrong. A hat whose bandpass
 * sits above its own harmonics is silent; a kick whose envelope outlives its oscillator
 * is a click; a kit balanced by guesswork has one voice nobody can hear.
 *
 * The real voices are rendered, not a copy of them: this drives the Vite dev server so
 * the browser imports `src/audio/kit.ts` itself, through an `OfflineAudioContext` that
 * renders faster than real time and hands back the samples.
 *
 *   npm run dev
 *   npm run measure:kit
 *
 * Advisory rather than a gate. It is a listening aid with numbers.
 */

import { chromium } from '@playwright/test';

const url = process.env.MEASURE_URL ?? 'http://localhost:5173/aplbeats/';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => {
  console.error(`page error: ${error.message}`);
});

await page.goto(url, { waitUntil: 'networkidle' });

const measurements = await page.evaluate(async () => {
  const { SYNTH_KIT } = await import('./src/audio/kit.ts');
  const { createNoiseBuffer, resetNoiseCursor } = await import('./src/audio/dsp.ts');
  const { TRACKS } = await import('./src/pattern/tracks.ts');

  /** Render one voice on its own and describe what came out. */
  async function renderVoice(id, level) {
    const sampleRate = 48_000;
    const context = new OfflineAudioContext(1, sampleRate * 2, sampleRate);
    const master = context.createGain();
    master.gain.value = 1;
    master.connect(context.destination);

    resetNoiseCursor();
    SYNTH_KIT[id]({ context, destination: master, noise: createNoiseBuffer(context) }, 0.01, level);

    const rendered = await context.startRendering();
    const samples = rendered.getChannelData(0);

    let peak = 0;
    let sumOfSquares = 0;
    let lastAudible = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const magnitude = Math.abs(samples[i]);
      if (magnitude > peak) peak = magnitude;
      sumOfSquares += samples[i] * samples[i];
      // Half a per cent of full scale: about -46 dB, which is where a decay stops
      // being part of the sound and starts being part of the noise floor.
      if (magnitude > 0.005) lastAudible = i;
    }

    return {
      id,
      peak,
      rms: Math.sqrt(sumOfSquares / samples.length),
      // Milliseconds from the trigger to the last audible sample.
      lengthMs: Math.max(0, (lastAudible / sampleRate - 0.01) * 1000),
    };
  }

  const perVoice = [];
  for (const track of TRACKS) {
    perVoice.push(await renderVoice(track.id, track.defaultVolume));
  }

  /*
   * And the worst case: every voice on the same step, through the real master chain,
   * with every fader at the top. If that clips, a full pattern clips.
   */
  const sampleRate = 48_000;
  const context = new OfflineAudioContext(1, sampleRate, sampleRate);
  const master = context.createGain();
  master.gain.value = 0.72;
  const glue = context.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.knee.value = 8;
  glue.ratio.value = 3.2;
  glue.attack.value = 0.004;
  glue.release.value = 0.14;
  master.connect(glue);

  const { saturator } = await import('./src/audio/dsp.ts');
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

  resetNoiseCursor();
  const voiceContext = { context, destination: master, noise: createNoiseBuffer(context) };
  for (const track of TRACKS) SYNTH_KIT[track.id](voiceContext, 0.01, 1);

  const together = await context.startRendering();
  const mixed = together.getChannelData(0);
  let mixPeak = 0;
  let clipped = 0;
  for (let i = 0; i < mixed.length; i += 1) {
    const magnitude = Math.abs(mixed[i]);
    if (magnitude > mixPeak) mixPeak = magnitude;
    if (magnitude >= 0.999) clipped += 1;
  }

  return { perVoice, mixPeak, clipped };
});

const decibels = (value) => (value <= 0 ? '-inf' : (20 * Math.log10(value)).toFixed(1));

console.log('\nVoice            peak      dBFS     RMS      length');
console.log('------------------------------------------------------');
for (const voice of measurements.perVoice) {
  console.log(
    `${voice.id.padEnd(15)} ${voice.peak.toFixed(3).padStart(6)}  ${decibels(voice.peak).padStart(7)}  ` +
      `${voice.rms.toFixed(4).padStart(7)}  ${Math.round(voice.lengthMs).toString().padStart(4)} ms`,
  );
}

console.log(
  `\nWhole kit on one step, every fader up: peak ${measurements.mixPeak.toFixed(3)} ` +
    `(${decibels(measurements.mixPeak)} dBFS), ${String(measurements.clipped)} clipped samples`,
);

const silent = measurements.perVoice.filter((voice) => voice.peak < 0.01);
if (silent.length > 0) {
  console.error(`\nSilent or near-silent: ${silent.map((voice) => String(voice.id)).join(', ')}`);
  process.exitCode = 1;
}
if (measurements.clipped > 0) {
  console.error('\nThe kit clips with every fader up.');
  process.exitCode = 1;
}

await browser.close();
