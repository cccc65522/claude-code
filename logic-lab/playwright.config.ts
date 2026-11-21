import { defineConfig, devices } from '@playwright/test';

const PORT = 4176;

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
    { name: 'desktop', testMatch: /desktop\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 } } },
    {
      // iPhone 13 screen size, touch and user agent, rendered by Chromium (WebKit is not installed here).
      name: 'iphone',
      testMatch: /iphone\.spec\.ts/,
      use: { ...devices['iPhone 13'], browserName: 'chromium' }
    }
  ],
  webServer: {
    // Tests run against the production build: `npm run test:e2e` builds first.
    command: `npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI
  }
});
