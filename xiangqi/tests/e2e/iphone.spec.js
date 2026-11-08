import { test, expect } from '@playwright/test';
import { trackErrors, open, start, point, iccs, clickMove, movetext, waitPlies, mateInOne, expectNoProblems } from './helpers.js';

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'iphone', 'touch tests');
});

test('fits the phone: no sideways scroll, board and controls visible', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  const { doc, win } = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }));
  expect(doc).toBeLessThanOrEqual(win);
  await expect(page.locator('#board')).toBeInViewport();
  await expect(page.locator('#controls')).toBeInViewport();
  const box = await page.locator('#board').boundingBox();
  expect(box.width).toBeGreaterThan(330);
  // pieces are big enough to tap (Apple suggests ~44pt)
  const piece = await page.locator('.piece').first().boundingBox();
  expect(piece.width).toBeGreaterThanOrEqual(34);
  expectNoProblems(problems);
});

test('tap-tap to move, the engine replies', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  await start(page, { mode: 'ai', humanSide: 0, levelId: 'novice' });
  await clickMove(page, 'h2', 'e2', { touch: true });
  await waitPlies(page, 2);
  expect((await movetext(page)).startsWith('1. 炮二平五')).toBe(true);
  expectNoProblems(problems);
});

test('solve a two-move puzzle with taps', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__xq.startPuzzle('p3'));
  // 车七平四, then whatever Black defends with, the mate that follows.
  await clickMove(page, 'c5', 'f5', { touch: true });
  await waitPlies(page, 2);
  const [a, b] = await mateInOne(page);
  await clickMove(page, a, b, { touch: true });
  await expect(page.getByRole('dialog', { name: '成功！' })).toBeVisible();
});
