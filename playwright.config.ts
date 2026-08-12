import { defineConfig, devices } from '@playwright/test';

/*
 * The end-to-end suite drives the real application in a real browser, which is
 * the only place several Stage 1 promises can actually be checked: that the grid
 * is reachable by keyboard, that a pointer drag paints rather than toggles, and
 * that loading the page produces no console errors.
 *
 * It deliberately does not assert on sound. Headless browsers will build an
 * audio graph but there is no output device to listen to, so audio is verified
 * by unit tests over the scheduling logic and by hand in a browser.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker on CI, where a shared runner's timing is nobody's friend.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:4173/aplbeats/',
    trace: 'on-first-retry',
  },

  /*
   * Three browsers, because no one of them can answer everything.
   *
   * `mobile-webkit` is the phone layout on the engine phones actually run, which is
   * where the sticky track-name column and the scroll snapping have to work.
   * Playwright's WebKit build has Web Audio compiled out entirely — there is no
   * `AudioContext` on the window at all — so it cannot say anything about playback.
   * That is a limitation of this build and not of Safari, and it is why there is a
   * `mobile-chromium` as well: a phone-sized viewport with touch, on an engine that
   * can make a sound.
   *
   * The audio tests check for `AudioContext` and skip themselves rather than being
   * excluded by name here, so adding a browser cannot silently drop coverage.
   */
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],

  webServer: {
    /*
     * The preview server, not the dev server: it serves the built bundle from the
     * same base path Pages uses, so what the tests drive is what deploys.
     *
     * `localhost` rather than `127.0.0.1`, which matters more than it should. Vite
     * preview binds to the name, and on a machine that resolves `localhost` to `::1`
     * only, the loopback address never answers — the suite times out waiting for a
     * server that is running perfectly well.
     */
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/aplbeats/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
