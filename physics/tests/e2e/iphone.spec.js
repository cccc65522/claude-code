import { test, expect } from '@playwright/test';
import { trackErrors, expectNoProblems, open, setView, touch, path, bodyCount, lastBody } from './helpers.js';

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'iphone', 'touch tests');
});

test('fits the phone: no sideways scroll, controls reachable and big enough to tap', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page, 'fresh');
  const { doc, win } = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }));
  expect(doc).toBeLessThanOrEqual(win);
  await expect(page.locator('#play')).toBeInViewport();
  await expect(page.locator('#toolbar')).toBeInViewport();
  for (const sel of ['#play', '.tool >> nth=0', '[data-cmd="menu"]', '[data-cmd="undo"]:visible']) {
    const box = await page.locator(sel).boundingBox();
    expect(box.height, sel).toBeGreaterThanOrEqual(40);
  }
  // toolbar sits at the bottom, above the home indicator area
  const tb = await page.locator('#toolbar').boundingBox();
  const vh = await page.evaluate(() => innerHeight);
  expect(tb.y + tb.height).toBeLessThanOrEqual(vh + 1);
  expect(tb.y).toBeGreaterThan(vh * 0.8);
  expectNoProblems(problems);
});

test('draw a box with a finger, and it falls', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  await setView(page, { x: 0, y: 3, scale: 40 });
  await page.locator('.tool[data-tool="box"]').tap();
  await touch(page, [path([[-1.5, 5], [1.5, 3.8]], 8)]);
  expect(await bodyCount(page)).toBe(2);
  const b = await lastBody(page);
  expect(b.shape).toBe('box');
  await page.waitForTimeout(400); // let Chromium's touch gesture detector settle before the next tap
  await page.locator('#play').tap();
  await page.waitForTimeout(1500);
  expect((await lastBody(page)).y).toBeLessThan(1);
  expectNoProblems(problems);
});

test('two fingers zoom and pan instead of drawing', async ({ page }) => {
  await open(page);
  await setView(page, { x: 0, y: 3, scale: 40 });
  await page.locator('.tool[data-tool="draw"]').tap();
  const before = await page.evaluate(() => window.__zw.app.camera.scale);
  await touch(page, [path([[-1, 3], [-3, 3]], 8), path([[1, 3], [3, 3]], 8)]);
  const after = await page.evaluate(() => window.__zw.app.camera.scale);
  expect(after).toBeGreaterThan(before * 1.6);
  expect(await bodyCount(page)).toBe(1);
});

test('play a level with touch: draw the bridge, win', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page, 'fresh&level=bridge');
  await expect(page.locator('#level-hud')).toBeInViewport();
  await page.locator('.tool[data-tool="draw"]').tap();
  await touch(page, [path([[-2.6, 2.3], [2.2, 2.3]], 12)]);
  expect(await bodyCount(page)).toBe(4);
  await page.locator('#play').tap();
  await expect(page.getByRole('dialog', { name: '过关：搭桥' })).toBeVisible({ timeout: 15000 });
  expectNoProblems(problems);
});

test('the menu and dialogs fit on the phone', async ({ page }) => {
  await open(page, 'fresh');
  await page.locator('[data-cmd="menu"]').tap();
  await expect(page.locator('#menu')).toBeInViewport({ ratio: 1 });
  await page.locator('[data-cmd="menu"]').tap();
  await page.locator('[data-cmd="levels"]').tap();
  const dlg = await page.locator('.dialog').boundingBox();
  const vw = await page.evaluate(() => innerWidth);
  expect(dlg.width).toBeLessThanOrEqual(vw);
  await expect(page.locator('.card')).toHaveCount(9);
});
