/*
 * Why does the calibration reference move?
 *
 *   npm run dev
 *   node scripts/diagnose-reference.mjs
 *
 * Stage 4 calibrated every sampled voice against the peak of the synthesised voice for the same
 * row. That reference has to mean the same thing every time it is measured, or the deviation
 * column is measuring the measurement. Stage 5.1 found it had moved by more than a decibel on
 * two rows, with nothing in the repository having changed, so this asks the reference four
 * questions before Stage 5.2 leans on it again:
 *
 *   1. What is actually rendering — engine version, and the rate the context really ran at.
 *   2. Is one render repeatable? Same page, same code, same context settings, ten times.
 *   3. Is it repeatable across a reload, and across a fresh browser process.
 *   4. If it moves, what is it sensitive to — the sample rate, or the noise read offset.
 *
 * Reports only. It changes nothing and calibrates nothing.
 */

/* eslint-disable @typescript-eslint/no-unsafe-return */

import { chromium } from '@playwright/test';

const url = process.env.MEASURE_URL ?? 'http://localhost:5173/aplbeats/';
const ROWS = ['kick', 'snare', 'closedHat', 'openHat', 'clap', 'lowPerc', 'highPerc', 'rim'];

/** Render the eight synthesised voices in one page, and report each peak. */
const probe = async (page, { rate = 44_100, repeats = 1 } = {}) =>
  page.evaluate(
    async ({ rate, repeats, ROWS }) => {
      const { SYNTH_KIT } = await import('./src/audio/kit.ts');
      const { createNoiseBuffer, resetNoiseCursor, nextNoiseOffset } = await import('./src/audio/dsp.ts');

      /** One voice, alone, at full level — exactly as `measure-kits.mjs` renders it. */
      async function renderVoice(trackId) {
        const context = new OfflineAudioContext(1, Math.ceil(rate * 3), rate);
        const master = context.createGain();
        master.gain.value = 1;
        master.connect(context.destination);
        resetNoiseCursor();
        SYNTH_KIT[trackId]({ context, destination: master, noise: createNoiseBuffer(context) }, 0.01, 1);
        const rendered = await context.startRendering();
        const samples = rendered.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const magnitude = Math.abs(samples[i]);
          if (magnitude > peak) peak = magnitude;
        }
        return { peak, actualRate: rendered.sampleRate };
      }

      const runs = [];
      for (let attempt = 0; attempt < repeats; attempt += 1) {
        const peaks = {};
        let actualRate = 0;
        for (const row of ROWS) {
          const result = await renderVoice(row);
          peaks[row] = result.peak;
          actualRate = result.actualRate;
        }
        runs.push({ peaks, actualRate });
      }

      // What the first noise read actually asks for, and whether it lands on a whole sample.
      const scratch = new OfflineAudioContext(1, 128, rate);
      const noise = createNoiseBuffer(scratch);
      resetNoiseCursor();
      const offset = nextNoiseOffset(noise);

      return {
        runs,
        offset,
        offsetInSamples: offset * rate,
        noiseLength: noise.length,
        userAgent: navigator.userAgent,
      };
    },
    { rate, repeats, ROWS },
  );

const dB = (value) => (value <= 0 ? '-inf' : (20 * Math.log10(value)).toFixed(3));
const spread = (values) => {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo <= 0 ? Infinity : 20 * Math.log10(hi / lo);
};

const browser = await chromium.launch();
console.log(`\nEngine: Chromium ${browser.version()}`);

const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });

/* ---- 1 & 2: what ran, and does it repeat in one page ----------------------- */

const first = await probe(page, { repeats: 10 });
console.log(`Agent:  ${first.userAgent}`);
console.log(`Asked for 44100 Hz; the context reported ${String(first.runs[0].actualRate)} Hz.`);
console.log(
  `Noise buffer ${String(first.noiseLength)} samples; first read offset ${first.offset.toFixed(9)} s ` +
    `= ${first.offsetInSamples.toFixed(3)} samples ` +
    `(${Number.isInteger(first.offsetInSamples) ? 'whole' : 'FRACTIONAL'}).`,
);

console.log('\n1. Ten renders in one page, same code, same settings. Peak in dBFS.\n');
console.log(`${'row'.padEnd(12)}${'min'.padStart(10)}${'max'.padStart(10)}${'spread dB'.padStart(12)}`);
console.log('-'.repeat(44));
let worstRepeat = 0;
for (const row of ROWS) {
  const peaks = first.runs.map((run) => run.peaks[row]);
  const range = spread(peaks);
  worstRepeat = Math.max(worstRepeat, range);
  console.log(
    `${row.padEnd(12)}${dB(Math.min(...peaks)).padStart(10)}${dB(Math.max(...peaks)).padStart(10)}` +
      `${range.toFixed(4).padStart(12)}`,
  );
}

/* ---- 3: across a reload, and across a fresh browser process ---------------- */

await page.reload({ waitUntil: 'networkidle' });
const reloaded = await probe(page);
await browser.close();

const second = await chromium.launch();
const fresh = await second.newPage();
await fresh.goto(url, { waitUntil: 'networkidle' });
const other = await probe(fresh);
await second.close();

console.log('\n2. The same render after a reload, and in a second browser process.\n');
console.log(
  `${'row'.padEnd(12)}${'first'.padStart(10)}${'reload'.padStart(10)}${'fresh'.padStart(10)}${'max drift'.padStart(12)}`,
);
console.log('-'.repeat(54));
let worstDrift = 0;
for (const row of ROWS) {
  const values = [first.runs[0].peaks[row], reloaded.runs[0].peaks[row], other.runs[0].peaks[row]];
  const drift = spread(values);
  worstDrift = Math.max(worstDrift, drift);
  console.log(
    `${row.padEnd(12)}${values.map((value) => dB(value).padStart(10)).join('')}${drift.toFixed(4).padStart(12)}`,
  );
}

/* ---- 4: what the reference is sensitive to -------------------------------- */

const third = await chromium.launch();
const rates = {};
for (const rate of [44_100, 48_000, 96_000]) {
  const context = await third.newPage();
  await context.goto(url, { waitUntil: 'networkidle' });
  rates[rate] = (await probe(context, { rate })).runs[0].peaks;
  await context.close();
}
await third.close();

console.log('\n3. Sensitivity to the rendering sample rate. dBFS, and the shift from 44.1 kHz.\n');
console.log(
  `${'row'.padEnd(12)}${'44.1 kHz'.padStart(10)}${'48 kHz'.padStart(10)}${'shift'.padStart(9)}${'96 kHz'.padStart(10)}${'shift'.padStart(9)}`,
);
console.log('-'.repeat(60));
for (const row of ROWS) {
  const base = rates[44_100][row];
  const cells = [48_000, 96_000].flatMap((rate) => [
    dB(rates[rate][row]).padStart(10),
    (20 * Math.log10(rates[rate][row] / base)).toFixed(2).padStart(9),
  ]);
  console.log(`${row.padEnd(12)}${dB(base).padStart(10)}${cells.join('')}`);
}

/* ---- 4: how sharply does the peak depend on where the noise is read? ------- */

const fourth = await chromium.launch();
const sweepPage = await fourth.newPage();
await sweepPage.goto(url, { waitUntil: 'networkidle' });

const sweep = await sweepPage.evaluate(async () => {
  const { SYNTH_KIT } = await import('./src/audio/kit.ts');
  const { createNoiseBuffer, resetNoiseCursor } = await import('./src/audio/dsp.ts');

  const RATE = 44_100;

  /*
   * The same render, but with the noise buffer rotated by a whole number of samples first.
   *
   * `nextNoiseOffset` asks for 64628.55 samples, and a buffer source given a sub-sample start
   * offset is free to resolve it however it likes. Rather than try to reach inside that, this
   * moves the buffer under a fixed offset, which reaches the same place: it shows how much the
   * peak of a voice changes when the slice of noise it reads shifts by a sample or two.
   */
  async function peakWithShift(trackId, shift) {
    const context = new OfflineAudioContext(1, Math.ceil(RATE * 3), RATE);
    const master = context.createGain();
    master.gain.value = 1;
    master.connect(context.destination);

    const original = createNoiseBuffer(context);
    const source = original.getChannelData(0);
    const rotated = context.createBuffer(1, original.length, original.sampleRate);
    const target = rotated.getChannelData(0);
    for (let i = 0; i < original.length; i += 1) {
      target[i] = source[(i + shift + original.length) % original.length];
    }

    resetNoiseCursor();
    SYNTH_KIT[trackId]({ context, destination: master, noise: rotated }, 0.01, 1);
    const rendered = await context.startRendering();
    const samples = rendered.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const magnitude = Math.abs(samples[i]);
      if (magnitude > peak) peak = magnitude;
    }
    return peak;
  }

  const shifts = [-2, -1, 0, 1, 2];
  const rows = {};
  for (const row of ['kick', 'snare', 'closedHat', 'openHat', 'clap', 'lowPerc', 'highPerc', 'rim']) {
    rows[row] = [];
    for (const shift of shifts) rows[row].push(await peakWithShift(row, shift));
  }
  return { shifts, rows };
});
await fourth.close();

console.log('\n4. Peak when the noise slice shifts by a sample or two. dB relative to no shift.\n');
console.log(
  `${'row'.padEnd(12)}${sweep.shifts.map((shift) => `${shift >= 0 ? '+' : ''}${String(shift)}`.padStart(9)).join('')}${'range'.padStart(9)}`,
);
console.log('-'.repeat(66));
for (const row of ROWS) {
  const peaks = sweep.rows[row];
  const middle = peaks[sweep.shifts.indexOf(0)];
  const cells = peaks.map((peak) => (20 * Math.log10(peak / middle)).toFixed(2).padStart(9));
  console.log(`${row.padEnd(12)}${cells.join('')}${spread(peaks).toFixed(2).padStart(9)}`);
}

/* ---- 5: what did Stage 4 actually calibrate against? ---------------------- */

const recovered = await (async () => {
  const page = await (await chromium.launch()).newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const { KITS, sampleUrl } = await import('./src/audio/kits/kits.ts');
    const { isSampleKit } = await import('./src/audio/kits/types.ts');
    const base = new URL('.', location.href).pathname;
    const decoder = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44_100 });

    /*
     * Every shipped gain was set to `synthPeak * HEADROOM / filePeak`. The file peaks are still
     * here and the gains are still in the repository, so the reference Stage 4 used can be read
     * back out of them: `filePeak * gain / HEADROOM`. Nine kits give nine independent readings
     * of the same eight numbers, which is what makes this worth doing.
     */
    const HEADROOM = 0.93;
    const implied = {};
    for (const definition of KITS) {
      if (!isSampleKit(definition)) continue;
      const peaks = {};
      for (const [row, voice] of Object.entries(definition.voices)) {
        if ((voice.playbackRate ?? 1) !== 1) continue; // resampled; the gain cannot be inverted
        const response = await fetch(sampleUrl(definition.directory, voice.file, base));
        const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
        let filePeak = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
          const data = buffer.getChannelData(channel);
          for (let i = 0; i < data.length; i += 1) {
            const magnitude = Math.abs(data[i]);
            if (magnitude > filePeak) filePeak = magnitude;
          }
        }
        peaks[row] = (filePeak * voice.gain) / HEADROOM;
      }
      implied[definition.id] = peaks;
    }
    return implied;
  });
  await page.context().browser().close();
  return result;
})();

console.log('\n5. The reference Stage 4 calibrated against, read back out of the shipped gains.\n');
console.log(
  `${'row'.padEnd(12)}${'Stage 4'.padStart(10)}${'agreement'.padStart(11)}${'today'.padStart(10)}${'moved'.padStart(9)}${'kits'.padStart(6)}`,
);
console.log('-'.repeat(58));
let worstMove = 0;
for (const row of ROWS) {
  const readings = Object.values(recovered)
    .map((kit) => kit[row])
    .filter((value) => typeof value === 'number');
  if (readings.length === 0) {
    console.log(`${row.padEnd(12)}${'(all resampled)'.padStart(10)}`);
    continue;
  }
  const mean = readings.reduce((total, value) => total + value, 0) / readings.length;
  const now = first.runs[0].peaks[row];
  const moved = 20 * Math.log10(now / mean);
  if (Math.abs(moved) > Math.abs(worstMove)) worstMove = moved;
  console.log(
    `${row.padEnd(12)}${dB(mean).padStart(10)}${`±${spread(readings).toFixed(2)}`.padStart(11)}` +
      `${dB(now).padStart(10)}${(moved >= 0 ? `+${moved.toFixed(2)}` : moved.toFixed(2)).padStart(9)}` +
      `${String(readings.length).padStart(6)}`,
  );
}

if (process.argv.includes('--emit')) {
  console.log('\nThe recovered reference, in the form `src/audio/kits/calibration.ts` wants.\n');
  for (const row of ROWS) {
    const readings = Object.values(recovered)
      .map((kit) => kit[row])
      .filter((value) => typeof value === 'number');
    const mean = readings.reduce((total, value) => total + value, 0) / readings.length;
    console.log(
      `  ${row}: ${mean.toFixed(6)},`.padEnd(30) +
        `// ${dB(mean)} dBFS, from ${String(readings.length)} kits, spread ${spread(readings).toFixed(3)} dB`,
    );
  }
}

/* ---- verdict --------------------------------------------------------------- */

console.log('');
console.log(`Worst move in the reference since Stage 4: ${worstMove.toFixed(2)} dB.`);
console.log(`Worst spread over ten renders in one page: ${worstRepeat.toFixed(4)} dB.`);
console.log(`Worst drift across reload and a fresh process: ${worstDrift.toFixed(4)} dB.`);
if (worstDrift < 0.01 && worstRepeat < 0.01) {
  console.log('The reference is reproducible on this engine at this rate.');
} else {
  console.log('The reference is NOT reproducible. Do not calibrate against it.');
  process.exitCode = 1;
}
