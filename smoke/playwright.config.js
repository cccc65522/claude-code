import { defineConfig, devices } from '@playwright/test';

// Serves the site built by scripts/build-site.sh (SITE_DIR, default ../.site) under /claude-code/,
// the path it has on GitHub Pages, and opens it in WebKit with an iPhone 13's screen and touch.
const PORT = 4180;
const SITE_DIR = process.env.SITE_DIR || '../.site';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/claude-code/`,
    trace: 'off'
  },
  projects: [{ name: 'iphone-webkit', use: { ...devices['iPhone 13'] } }],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory ${SITE_DIR}`,
    url: `http://127.0.0.1:${PORT}/claude-code/`,
    reuseExistingServer: !process.env.CI
  }
});
