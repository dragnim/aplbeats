/*
 * Capture the interface, for looking at.
 *
 * A drum machine is judged by eye and ear, and neither is something a test suite has
 * an opinion about. This drives the built application in a real browser and writes
 * PNGs, so a change to the grid's colours or spacing can be reviewed rather than
 * merely asserted about.
 *
 * Run against an already-running preview server:
 *
 *   npm run build && npm run preview -- --port 4173 --strictPort
 *   npm run screenshot -- docs
 *
 * `localhost` rather than `127.0.0.1`: Vite preview binds to the name, and on a
 * machine that resolves it to `::1` only, the loopback address never answers.
 */

import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const outputDirectory = process.argv[2] ?? 'docs';
const url = process.env.SCREENSHOT_URL ?? 'http://localhost:4173/aplbeats/';

mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch();

/** Load the page, optionally press Play, let it settle, and shoot. */
async function capture(name, { play = false, contextOptions = {}, viewport, peek = false } = {}) {
  const context = await browser.newContext({ ...contextOptions });
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);

  await page.goto(url, { waitUntil: 'networkidle' });

  if (peek) {
    /*
     * Opened, not applied.
     *
     * Peek shows the expression that *would* be sent, built from a template in the browser,
     * so this makes no request — which matters here as much as anywhere: taking a screenshot
     * must not become a reason to call TryAPL.
     */
    await page.getByRole('button', { name: 'Peek at the APL' }).click();
    await page.getByText('Core APL').waitFor();
  }

  if (play) {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    // Far enough into the bar that the playhead is somewhere interesting rather than
    // still on the first step.
    await page.waitForTimeout(900);
  }

  await page.screenshot({ path: `${outputDirectory}/${name}.png`, fullPage: true });
  console.log(`${outputDirectory}/${name}.png`);
  await context.close();
}

await capture('screenshot-stopped', { viewport: { width: 1280, height: 860 } });
await capture('screenshot-playing', { play: true, viewport: { width: 1280, height: 860 } });
await capture('screenshot-narrow', { viewport: { width: 720, height: 900 } });
await capture('screenshot-peek', { peek: true, viewport: { width: 1280, height: 1180 } });
await capture('screenshot-mobile', { play: true, contextOptions: devices['Pixel 7'] });
await capture('screenshot-reduced-motion', {
  play: true,
  contextOptions: { reducedMotion: 'reduce' },
  viewport: { width: 1280, height: 860 },
});

await browser.close();
