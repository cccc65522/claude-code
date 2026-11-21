import { defineConfig, devices } from '@playwright/test';

const PORT = 4177;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    // Headless Chromium has no GPU here: render WebGL in software.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
  },
  projects: [
    { name: 'desktop', testMatch: /desktop\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      // iPhone 13 screen size, touch and user agent, rendered by Chromium (WebKit is not installed here).
      name: 'iphone',
      testMatch: /iphone\.spec\.js/,
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
