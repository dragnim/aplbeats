/*
 * Does the 1.2-second trim actually take anything away from a pad?
 *
 *   npm run dev
 *   npm run measure:audition
 *
 * The brief asks the question directly, and it deserves a measurement rather than an opinion: the
 * Stage 8 pipeline trims every recording to 1.2 s and ignores upstream's sustain loops, and it is
 * entirely plausible that this is what stops the pads sounding like pads.
 *
 * So each pad candidate is rendered three ways — the production trim, a four-second natural
 * length, and upstream's own sustain loop — through the real sampler at the real tempo, and the
 * three are compared.
 *
 * **The render is four bars long and only bars two and three are measured.** That is the whole
 * methodology, and getting it wrong gives the opposite answer: a single-bar render leaves the
 * final note ringing into silence with nothing to stop it, so the longer variants look louder by
 * several decibels for a reason that never happens in playback. In a looping bar every note is
 * stopped by the next one, including across the bar line.
 *
 * Three phrases, because the answer depends entirely on how long a note is allowed to hold:
 * the shipped opening phrase, the denser audition reference, and a deliberately extreme
 * one-note-per-bar phrase that holds for a full 2.1 seconds.
 */

import { chromium } from '@playwright/test';

const url = process.env.MEASURE_URL ?? 'http://localhost:5173/aplbeats/audition.html';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => {
  console.error(`page error: ${error.message}`);
});

await page.goto(url, { waitUntil: 'networkidle' });

const results = await page.evaluate(async () => {
  const { ToneSampler } = await import('/aplbeats/src/audio/tones/ToneSampler.ts');
  const manifest = await (await fetch('/aplbeats/audition-manifest.json')).json();

  const PHRASES = [
    { id: 'opening', phrase: [60, 0, 0, 63, 0, 67, 0, 0, 65, 0, 0, 63, 0, 60, 0, 0], holdMs: 402 },
    { id: 'dense', phrase: [60, 63, 65, 63, 67, 0, 65, 63, 60, 63, 65, 67, 70, 0, 67, 65], holdMs: 268 },
    { id: 'one-note', phrase: [60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], holdMs: 2143 },
  ];

  const RATE = 44_100;
  const SECONDS_PER_STEP = 60 / 112 / 4;
  const BARS = 4;

  async function zonesFor(candidate, variant) {
    const shape = candidate.variants[variant];
    if (shape === undefined || !shape.available) return null;

    const decoder = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: RATE });
    return Promise.all(
      shape.samples.map(async (sample) => {
        const response = await fetch(`/aplbeats/audio/audition/${sample.file}`);
        const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
        return sample.loop === null
          ? { rootMidi: sample.rootMidi, buffer }
          : { rootMidi: sample.rootMidi, buffer, loop: sample.loop };
      }),
    );
  }

  async function render(candidate, variant, phrase) {
    const zones = await zonesFor(candidate, variant);
    if (zones === null) return null;

    const context = new OfflineAudioContext(1, Math.ceil(RATE * (SECONDS_PER_STEP * 16 * BARS + 0.5)), RATE);
    const bus = context.createGain();
    bus.gain.value = 0.7;
    bus.connect(context.destination);

    const sampler = new ToneSampler(zones, candidate.gain);
    for (let step = 0; step < 16 * BARS; step += 1) {
      const value = phrase[step % 16];
      if (value !== 0) {
        sampler.play({ context, destination: bus }, 0.02 + step * SECONDS_PER_STEP, value, 1);
      }
    }

    const rendered = await context.startRendering();
    const data = rendered.getChannelData(0);

    /* Bars two and three: every note in them is stopped by the note after it. */
    const from = Math.round((0.02 + 16 * SECONDS_PER_STEP) * RATE);
    const to = Math.round((0.02 + 48 * SECONDS_PER_STEP) * RATE);

    let peak = 0;
    let sum = 0;
    for (let at = from; at < to; at += 1) {
      const magnitude = Math.abs(data[at]);
      if (magnitude > peak) peak = magnitude;
      sum += data[at] * data[at];
    }

    return { peak, rms: Math.sqrt(sum / (to - from)) };
  }

  const rows = [];
  for (const candidate of manifest.candidates.filter((entry) => entry.role === 'pad')) {
    for (const { id, phrase, holdMs } of PHRASES) {
      const trim = await render(candidate, 'trim', phrase);
      const natural = await render(candidate, 'natural', phrase);
      const loop = await render(candidate, 'loop', phrase);
      rows.push({ preset: candidate.preset, phrase: id, holdMs, trim, natural, loop });
    }
  }

  return rows;
});

await browser.close();

const decibels = (a, b) => (a === null || b === null || b.rms === 0 ? null : 20 * Math.log10(a.rms / b.rms));

console.log('\nDoes the 1.2 s trim take anything away from a pad?');
console.log('RMS over bars two and three of a four-bar render, so every note is stopped by the next.\n');
console.log(
  `${'pad'.padEnd(20)}${'phrase'.padEnd(10)}${'hold'.padStart(7)}` +
    `${'trim'.padStart(11)}${'natural'.padStart(11)}${'loop'.padStart(11)}` +
    `${'nat−trim'.padStart(10)}${'loop−nat'.padStart(10)}`,
);
console.log('-'.repeat(90));

let anyDifference = 0;
for (const row of results) {
  const naturalDelta = decibels(row.natural, row.trim);
  const loopDelta = decibels(row.loop, row.natural);
  if (naturalDelta !== null && Math.abs(naturalDelta) > 0.01) anyDifference += 1;

  console.log(
    `${row.preset.padEnd(20)}${row.phrase.padEnd(10)}${`${String(row.holdMs)}ms`.padStart(7)}` +
      `${(row.trim?.rms.toFixed(5) ?? '—').padStart(11)}` +
      `${(row.natural?.rms.toFixed(5) ?? '—').padStart(11)}` +
      `${(row.loop?.rms.toFixed(5) ?? '—').padStart(11)}` +
      `${(naturalDelta === null ? '—' : `${naturalDelta >= 0 ? '+' : ''}${naturalDelta.toFixed(2)}`).padStart(10)}` +
      `${(loopDelta === null ? '—' : `${loopDelta >= 0 ? '+' : ''}${loopDelta.toFixed(2)}`).padStart(10)}`,
  );
}

console.log('');
console.log(
  `Rows where the longer sample changed anything at all: ${String(anyDifference)} of ${String(results.length)}.`,
);
console.log(
  'A note is cut by the next note, not by the end of its buffer — so the trim only bites when a\n' +
    'note is allowed to hold longer than 1.2 s, which needs a phrase sparser than the one we ship.',
);
