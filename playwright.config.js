const { defineConfig, devices } = require('@playwright/test');

// BASE_URL lets the same suite run against the local dev server or the
// deployed GitHub Pages site. When it is unset we boot server.js ourselves.
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const usingLocalServer = !process.env.BASE_URL;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Sandboxes/CI images that ship their own Chromium can point at it
        // instead of downloading a matching build.
        ...(process.env.CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: usingLocalServer
    ? {
        command: 'node server.js --port 8080',
        url: 'http://127.0.0.1:8080/index.html',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      }
    : undefined,
});
