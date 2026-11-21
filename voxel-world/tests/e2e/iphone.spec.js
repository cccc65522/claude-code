import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('on a phone: tap to start, touch controls show and fit on screen', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '开始', exact: true }).tap();
  await expect(page.locator('body')).toContainText(/X [\d.-]+\s+Y [\d.-]+\s+Z [\d.-]+/);
  const vp = page.viewportSize();
  for (const name of ['挖', '放', '跳', '暂停']) {
    const box = await page.getByText(name, { exact: true }).first().boundingBox();
    expect(box, name).not.toBeNull();
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(vp.width + 1);
    expect(box.y + box.height, name).toBeLessThanOrEqual(vp.height + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});
