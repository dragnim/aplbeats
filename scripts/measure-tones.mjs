/*
 * Render a bar with both layers and measure what comes out.
 *
 * Stage 8 puts a second instrument into a master chain that was calibrated with one in it. Whether
 * that clips, and whether the melody is audible against the kit rather than on top of it, is
 * arithmetic rather than judgement — and it is the kind of arithmetic that is invisible until
 * somebody listens on good headphones and wonders why the kick went quiet.
 *
 * Three numbers matter here and each answers a different question:
 *
 *   **peak and clipped** — does adding a melody push the master chain past full scale? The
 *   compressor and limiter should absorb it, and "should" is not a measurement.
 *
 *   **the drums' RMS with and without the melody** — does the melody make the *kit* quieter? It
 *   goes through the same compressor, so a loud melody would duck the drums, and a drum machine
 *   whose kick disappears when you write a tune is a broken drum machine.
 *
 *   **the melody's own RMS** — is it present at all? A layer nobody can hear is not a layer.
 *
 * Drives the Vite dev server so the browser imports the real sampler, the real kit and the real
 * master chain, and fetches the real prepared samples.
 *
 *   npm run dev
 *   npm run measure:tones
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
  const { SYNTH_KIT } = await import('./src/audio/kit.ts');
  const { createNoiseBuffer, resetNoiseCursor, saturator } = await import('./src/audio/dsp.ts');
  const { triggersForStep } = await import('./src/audio/triggers.ts');
  const { createMixer } = await import('./src/pattern/mixer.ts');
  const { createInitialGroove } = await import('./src/pattern/initialGroove.ts');
  const { ToneSampler } = await import('./src/audio/tones/ToneSampler.ts');
  const { TONE_SOUNDS, DEFAULT_TONE_VOLUME, toneSampleUrl } = await import('./src/audio/tones/sounds.ts');
  const { openingPhrase, REST } = await import('./src/tones/phrase.ts');

  const sampleRate = 48_000;
  const mixer = createMixer();
  const pattern = createInitialGroove();
  const phrase = openingPhrase();

  /*
   * Every sound's recordings, decoded once.
   *
   * Through the real URL helper and the real base path, so a sound that would 404 in the browser
   * fails here too rather than being quietly measured from a file that is not the one shipped.
   */
  const base = document.querySelector('base')?.getAttribute('href') ?? '/aplbeats/';
  const decoder = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate });

  const decoded = {};
  for (const sound of TONE_SOUNDS) {
    decoded[sound.id] = [];
    for (const sample of sound.samples) {
      const response = await fetch(toneSampleUrl(sample.file, base));
      if (!response.ok) throw new Error(`${sample.file}: ${String(response.status)}`);
      const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
      decoded[sound.id].push({ rootMidi: sample.rootMidi, buffer });
    }
  }

  /** One bar at 112 BPM through the real master chain, with either layer optional. */
  async function renderBar({ drums, sound, toneVolume }) {
    const secondsPerStep = 60 / 112 / 4;
    const context = new OfflineAudioContext(
      1,
      Math.ceil(sampleRate * (secondsPerStep * 16 + 1.4)),
      sampleRate,
    );

    const master = context.createGain();
    master.gain.value = 0.72;
    const glue = context.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.knee.value = 8;
    glue.ratio.value = 3.2;
    glue.attack.value = 0.004;
    glue.release.value = 0.14;
    master.connect(glue);

    const output = context.createGain();
    output.gain.value = 1;
    glue.connect(saturator(context, 1.25)).connect(output);
    output.connect(context.destination);

    /* The Tone bus, exactly where the engine puts it: into master, before the compressor. */
    const toneBus = context.createGain();
    toneBus.gain.value = toneVolume;
    toneBus.connect(master);

    resetNoiseCursor();
    const voiceContext = { context, destination: master, noise: createNoiseBuffer(context) };

    const sampler = sound === null ? null : new ToneSampler(decoded[sound.id]);

    for (let step = 0; step < 16; step += 1) {
      const time = 0.02 + step * secondsPerStep;

      if (drums) {
        for (const trigger of triggersForStep(pattern, mixer, step)) {
          SYNTH_KIT[trigger.trackId](voiceContext, time, trigger.level);
        }
      }

      if (sampler !== null) {
        const value = phrase[step] ?? REST;
        if (value === REST) sampler.release(context, time);
        else sampler.play({ context, destination: toneBus }, time, value, sound.gain);
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

  const drumsOnly = await renderBar({ drums: true, sound: null, toneVolume: DEFAULT_TONE_VOLUME });

  const rows = [];
  for (const sound of TONE_SOUNDS) {
    rows.push({
      id: sound.id,
      name: sound.name,
      gain: sound.gain,
      alone: await renderBar({ drums: false, sound, toneVolume: DEFAULT_TONE_VOLUME }),
      together: await renderBar({ drums: true, sound, toneVolume: DEFAULT_TONE_VOLUME }),
      loud: await renderBar({ drums: true, sound, toneVolume: 1 }),
    });
  }

  return { drumsOnly, rows, defaultVolume: DEFAULT_TONE_VOLUME };
});

const decibels = (value) => (value <= 0 ? '-inf' : (20 * Math.log10(value)).toFixed(1));

console.log('');
console.log(
  `The opening groove and the opening melody, at 112 BPM, Tone volume ${String(results.defaultVolume)}.`,
);
console.log('');
console.log(
  `drums alone                     peak ${results.drumsOnly.peak.toFixed(3)}  ` +
    `${decibels(results.drumsOnly.peak).padStart(6)} dBFS   RMS ${results.drumsOnly.rms.toFixed(4)}`,
);
console.log('');
console.log('sound   gain    melody alone      both layers               at Tone volume 1');
console.log('               peak     RMS      peak    dBFS     RMS      peak    dBFS   clipped');
console.log('-'.repeat(80));

let clipping = 0;
for (const row of results.rows) {
  clipping += row.together.clipped + row.loud.clipped;
  console.log(
    `${row.name.padEnd(7)} ${row.gain.toFixed(3)}  ` +
      `${row.alone.peak.toFixed(3)}  ${row.alone.rms.toFixed(4)}   ` +
      `${row.together.peak.toFixed(3)}  ${decibels(row.together.peak).padStart(6)}  ${row.together.rms.toFixed(4)}   ` +
      `${row.loud.peak.toFixed(3)}  ${decibels(row.loud.peak).padStart(6)}  ${String(row.loud.clipped).padStart(7)}`,
  );
}

console.log('');
for (const row of results.rows) {
  const change = 20 * Math.log10(row.together.rms / results.drumsOnly.rms);
  console.log(
    `${row.name.padEnd(7)} adds ${change >= 0 ? '+' : ''}${change.toFixed(2)} dB of RMS to the bar`,
  );
}

console.log('');
if (clipping > 0) {
  console.error(`Clipping: ${String(clipping)} samples at or beyond full scale.`);
  process.exitCode = 1;
} else {
  console.log('No clipping, with either layer or both, at any Tone volume.');
}

await browser.close();
