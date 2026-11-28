// Safari smoke test: each app opens in WebKit at iPhone size, shows its main screen, answers a tap,
// fits the screen width, and logs no errors. The apps' own test suites run in Chromium; this catches
// what only Safari's engine (JavaScriptCore, WebKit layout) gets wrong.
import { test, expect } from '@playwright/test';

const APPS = [
  {
    name: '复习本', path: '',
    async check(page) {
      await page.getByRole('button', { name: '载入示例题库' }).tap();
      await expect(page.getByRole('heading', { name: '今日复习' })).toBeVisible();
    }
  },
  {
    name: '格算', path: 'sheet/',
    async check(page) {
      await expect(page.locator('[data-addr="A1"]')).toBeVisible();
      await expect(page.locator('.bottombar')).toBeInViewport();
    }
  },
  {
    name: '弈', path: 'xiangqi/',
    async check(page) {
      await expect(page.locator('.piece')).toHaveCount(32);
      await expect(page.locator('#board')).toBeInViewport();
    }
  },
  {
    name: '方块小镇', path: 'voxel-world/',
    async check(page) {
      await page.getByRole('button', { name: '开始', exact: true }).tap();
      await expect(page.locator('body')).toContainText(/X [\d.-]+\s+Y [\d.-]+\s+Z [\d.-]+/);
    }
  },
  {
    name: '造物', path: 'physics/',
    async check(page) {
      await expect(page.locator('#stage')).toBeVisible();
      await page.locator('#play').tap();
      await page.waitForTimeout(500);
    }
  },
  {
    name: '门道', path: 'logic-lab/',
    async check(page) {
      await expect(page.getByTestId('canvas')).toBeVisible();
      await expect(page.locator('.canvas [data-part]')).toHaveCount(7);
    }
  }
];

for (const app of APPS) {
  test(`${app.name} starts in Safari's engine`, async ({ page }) => {
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    await page.goto(app.path);
    await app.check(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no sideways scrolling').toBeLessThanOrEqual(0);
    expect(problems, 'no errors in the page').toEqual([]);
  });
}
