import { defineConfig, devices } from '@playwright/test';

const PORT = 4175;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      // iPhone 13 screen size, touch and user agent, rendered by Chromium (WebKit is not installed here).
      name: 'iphone',
      use: { ...devices['iPhone 13'], browserName: 'chromium' }
    }
  ],
  webServer: {
    command: `node scripts/serve.js --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI
  }
});
