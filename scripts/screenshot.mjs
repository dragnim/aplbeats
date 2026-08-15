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

/**
 * The Transform panel, as a scope for locators.
 *
 * Stage 6 added a second APL panel with its own "Peek at the APL", so an unscoped locator is now
 * ambiguous. Scoping says which panel is meant.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-return -- Playwright's page is untyped here.
const transformPanel = (page) => page.getByRole('region', { name: 'Transform with APL' });

const outputDirectory = process.argv[2] ?? 'docs';
const url = process.env.SCREENSHOT_URL ?? 'http://localhost:4173/aplbeats/';

mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch();

/** Load the page, optionally press Play, let it settle, and shoot. */
async function capture(
  name,
  { play = false, contextOptions = {}, viewport, peek = false, explore = false, tones = false } = {},
) {
  const context = await browser.newContext({ ...contextOptions });
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);

  await page.goto(url, { waitUntil: 'networkidle' });

  if (tones) {
    /*
     * The melody layer, which is where the Tone samples are first fetched.
     *
     * `networkidle` afterwards, so the shot is of a loaded instrument rather than of one whose
     * status line still says "Loading sound…" — which would be a screenshot of the loading state
     * rather than of the feature.
     */
    await page.getByRole('tablist', { name: 'Layer' }).getByRole('tab', { name: 'Tones' }).click();
    await page.getByRole('group', { name: 'Melody steps' }).waitFor();
    await page.waitForLoadState('networkidle');
  }

  if (peek || explore) {
    /*
     * The Transform workspace, which is a tab rather than a card on the page.
     *
     * Stage 7 made the four panels tabs and only the selected one is rendered, so reaching the
     * Transform panel now means selecting it first. Costs nothing: switching workspaces makes no
     * request, which is exactly the property `workspace.spec.ts` asserts.
     */
    await page.getByRole('tablist', { name: 'Workspace' }).getByRole('tab', { name: 'Transform' }).click();
    await transformPanel(page).waitFor();
  }

  if (peek) {
    /*
     * Opened, not applied.
     *
     * Peek shows the expression that *would* be sent, built from a template in the browser,
     * so this makes no request — which matters here as much as anywhere: taking a screenshot
     * must not become a reason to call TryAPL.
     */
    await transformPanel(page).getByRole('button', { name: 'Peek at the APL' }).click();
    await page.getByText('Core APL').waitFor();
  }

  if (explore) {
    /*
     * Opened, not run. Explore builds its request in the browser, so showing the editor costs
     * nothing — and a screenshot must never become a reason to call TryAPL.
     */
    await transformPanel(page).getByRole('button', { name: 'Peek at the APL' }).click();
    await transformPanel(page).getByRole('button', { name: 'Edit this APL' }).click();
    const editor = page.getByRole('textbox', { name: 'Your APL expression' });
    await editor.waitFor();
    await editor.fill('m[1;]∨2⌽m[1;]');
    await page.getByLabel('Result goes to').selectOption('4');
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
await capture('screenshot-explore', { explore: true, viewport: { width: 1280, height: 1400 } });
await capture('screenshot-tones', { tones: true, play: true, viewport: { width: 1280, height: 860 } });
await capture('screenshot-mobile', { play: true, contextOptions: devices['Pixel 7'] });
await capture('screenshot-reduced-motion', {
  play: true,
  contextOptions: { reducedMotion: 'reduce' },
  viewport: { width: 1280, height: 860 },
});

await browser.close();
