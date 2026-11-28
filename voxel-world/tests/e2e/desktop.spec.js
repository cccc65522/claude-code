import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

const COORDS = /X [\d.-]+\s+Y [\d.-]+\s+Z [\d.-]+/;

test('the world loads and the game starts', async ({ page }) => {
  await page.goto('./');
  const title = page.getByRole('heading', { name: '方块小镇' });
  await expect(title).toBeVisible();
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await expect(title).toBeHidden();
  await expect(page.locator('body')).toContainText(COORDS);
  const [w, h] = await page.locator('canvas').first().evaluate((c) => [c.width, c.height]);
  expect(w).toBeGreaterThan(0);
  expect(h).toBeGreaterThan(0);
});

test('the start menu does not keep redrawing the 3D view', async ({ page }) => {
  // CPU time the page spends over two seconds on the menu, as a share of one core. Drawing the
  // world every frame keeps a core busy (here the GPU is emulated in software); a still frame
  // costs next to nothing.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const taskTime = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '方块小镇' })).toBeVisible();
  await page.waitForTimeout(1500);
  const before = await taskTime();
  await page.waitForTimeout(2000);
  expect((await taskTime()) - before).toBeLessThan(0.5);
});

test('installable: manifest, icons and service worker', async ({ page }) => {
  await page.goto('./');
  const manifest = await (await page.request.get('./manifest.webmanifest')).json();
  expect(manifest.short_name).toBe('方块小镇');
  for (const icon of manifest.icons) {
    const res = await page.request.get(icon.src);
    expect(res.ok(), icon.src).toBe(true);
  }
  expect((await page.request.get('./apple-touch-icon.png')).ok()).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { timeout: 10000 }).toBe(1);
});

test('works offline after a single visit', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '方块小镇' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await expect(page.locator('body')).toContainText(COORDS);
  await context.setOffline(false);
});

test('only its own caches: other apps on the site keep theirs', async ({ page }) => {
  await page.goto('./manifest.webmanifest');
  await page.evaluate(async () => {
    for (const name of ['review-app-v1', 'mendao-v1', 'voxel-world-v0']) await (await caches.open(name)).put('/x-' + name, new Response('x'));
  });
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).sort())).toEqual(['mendao-v1', 'review-app-v1', 'voxel-world-v1']);
});
