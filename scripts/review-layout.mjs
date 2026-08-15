/*
 * Look at the workspace, at every width that matters, in both themes.
 *
 *   npm run build && npm run preview
 *   node scripts/review-layout.mjs
 *   node scripts/review-layout.mjs --shots docs/review    also write screenshots
 *
 * A redesign is the one kind of change a test suite is worst at judging. What this does is the
 * part that *can* be checked mechanically and is tedious to check by hand: at each width and in
 * each theme, does the page scroll sideways, is the grid whole, are the transport and the rail
 * where they should be, and does the APL sit beside the sequencer or beneath it.
 *
 * It replaces none of the looking. It just means the looking starts from a page that is not
 * already broken.
 */

import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const url = process.env.REVIEW_URL ?? 'http://localhost:4173/aplbeats/';
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt !== null && shotsAt !== undefined) mkdirSync(shotsAt, { recursive: true });

/** The widths the brief asks to be reviewed, plus the two folds either side. */
const WIDTHS = [
  { width: 1600, height: 1000, name: '1600' },
  { width: 1440, height: 900, name: '1440' },
  { width: 1280, height: 860, name: '1280' },
  { width: 1024, height: 820, name: '1024' },
  { width: 834, height: 1112, name: '834' },
  { width: 390, height: 844, name: 'phone-portrait' },
  { width: 844, height: 390, name: 'phone-landscape' },
];

const browser = await chromium.launch();
const problems = [];

console.log(`\nReviewing ${url}\n`);
console.log(
  `${'width'.padEnd(17)}${'theme'.padEnd(7)}${'overflow'.padStart(9)}${'cells'.padStart(7)}` +
    `${'layout'.padStart(11)}${'grid px'.padStart(9)}${'apl px'.padStart(8)}`,
);
console.log('-'.repeat(68));

for (const size of WIDTHS) {
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate((choice) => {
      window.localStorage.setItem('aplbeats.theme.v1', JSON.stringify({ schema: 1, choice }));
    }, theme);
    await page.reload({ waitUntil: 'networkidle' });

    const seen = await page.evaluate(() => {
      const doc = document.documentElement;
      const grid = document.querySelector('button[data-track][data-step]')?.closest('main');
      // Two tabpanels since Stage 8: the layer panel wraps the whole workspace, and the
      // workspace panel is the APL column inside it. The APL one is the one without 'domain'.
      const apl = document.querySelector('[role="tabpanel"]:not([id*="domain"])');
      const gridBox = grid?.getBoundingClientRect();
      const aplBox = apl?.getBoundingClientRect();

      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        cells: document.querySelectorAll('button[data-track][data-step]').length,
        theme: doc.getAttribute('data-theme'),
        rail: document.querySelector('[role="tablist"]') !== null,
        transport: [...document.querySelectorAll('input[type="range"]')].some((input) =>
          (input.labels?.[0]?.textContent ?? input.getAttribute('aria-label') ?? '').includes('Tempo'),
        ),
        gridWidth: Math.round(gridBox?.width ?? 0),
        aplWidth: Math.round(aplBox?.width ?? 0),
        // Beside, if the APL panel starts to the right of where the grid ends.
        beside: (aplBox?.left ?? 0) >= (gridBox?.right ?? 0) - 4,
        background: getComputedStyle(document.body).backgroundColor,
      };
    });

    const layout = seen.beside ? 'beside' : 'stacked';
    console.log(
      `${size.name.padEnd(17)}${theme.padEnd(7)}${String(seen.overflow).padStart(9)}` +
        `${String(seen.cells).padStart(7)}${layout.padStart(11)}` +
        `${String(seen.gridWidth).padStart(9)}${String(seen.aplWidth).padStart(8)}`,
    );

    const where = `${size.name}/${theme}`;
    if (seen.overflow > 1) problems.push(`${where}: page scrolls sideways by ${String(seen.overflow)}px`);
    if (seen.cells !== 128) problems.push(`${where}: ${String(seen.cells)} step cells, expected 128`);
    if (seen.theme !== theme) problems.push(`${where}: document says data-theme="${String(seen.theme)}"`);
    if (!seen.rail) problems.push(`${where}: no workspace tablist`);
    if (!seen.transport) problems.push(`${where}: no transport`);
    if (errors.length > 0) problems.push(`${where}: ${errors.join('; ')}`);
    // Above 1280 the whole point of the stage is that the two are side by side.
    if (size.width >= 1600 && !seen.beside) {
      problems.push(`${where}: the APL is stacked under the grid at ${String(size.width)}px`);
    }

    if (shotsAt !== null && shotsAt !== undefined) {
      await page.screenshot({ path: `${shotsAt}/${size.name}-${theme}.png`, fullPage: false });
    }

    /*
     * The same page again, with Tones open.
     *
     * Stage 8 added a second thing to look at, and it has its own ways of being wrong: sixteen
     * pads that must all stay on screen, an editor row that must not push the page sideways, and
     * a panel that must still sit beside the strip rather than under it on a wide monitor.
     *
     * Switching layers is a click and nothing else — no request, no reload — so this costs one
     * click per width and theme rather than a second page load.
     */
    await page.getByRole('tab', { name: 'Tones' }).click();

    const tones = await page.evaluate(() => {
      const doc = document.documentElement;
      const strip = document.querySelector('[aria-label="Tone steps"]');
      const apl = document.querySelector('[role="tabpanel"]:not([id*="domain"])');
      const stripBox = strip?.getBoundingClientRect();
      const aplBox = apl?.getBoundingClientRect();

      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        pads: strip?.querySelectorAll('button').length ?? 0,
        beside: (aplBox?.left ?? 0) >= (stripBox?.right ?? 0) - 4,
      };
    });

    console.log(
      `${`${size.name} · tones`.padEnd(17)}${theme.padEnd(7)}${String(tones.overflow).padStart(9)}` +
        `${String(tones.pads).padStart(7)}${(tones.beside ? 'beside' : 'stacked').padStart(11)}`,
    );

    if (tones.overflow > 1) {
      problems.push(`${where} · tones: page scrolls sideways by ${String(tones.overflow)}px`);
    }
    if (tones.pads !== 16) problems.push(`${where} · tones: ${String(tones.pads)} pads, expected 16`);
    if (size.width >= 1600 && !tones.beside) {
      problems.push(`${where} · tones: the APL is stacked under the Tone strip at ${String(size.width)}px`);
    }
    if (errors.length > 0) problems.push(`${where} · tones: ${errors.join('; ')}`);

    if (shotsAt !== null && shotsAt !== undefined) {
      await page.screenshot({ path: `${shotsAt}/${size.name}-${theme}-tones.png`, fullPage: false });
    }

    await page.close();
  }
}

await browser.close();

console.log('');
if (problems.length === 0) {
  console.log('No structural problems at any reviewed width, in either theme.');
} else {
  console.log('Problems:');
  for (const problem of problems) console.log(`  ${problem}`);
  process.exitCode = 1;
}
