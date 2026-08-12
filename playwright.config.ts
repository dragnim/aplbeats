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
    baseURL: 'http://127.0.0.1:4173/aplbeats/',
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],

  webServer: {
    // The preview server, not the dev server: it serves the built bundle from
    // the same base path Pages uses, so what the tests drive is what deploys.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/aplbeats/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
