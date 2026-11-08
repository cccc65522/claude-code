import { test, expect } from '@playwright/test';
import { trackErrors, open, start, point, iccs, clickMove, plies, movetext, waitPlies, expectNoProblems } from './helpers.js';

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'mouse & keyboard tests');
});

test('play a move by clicking and the engine answers', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  await start(page, { mode: 'ai', humanSide: 0, levelId: 'novice' });
  await expect(page.locator('.piece')).toHaveCount(32);
  // select the cannon: legal targets appear
  const p = await point(page, ...iccs('h2'));
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.marks .target')).toHaveCount(12);
  await page.mouse.click(p.x, p.y); // clicking it again deselects
  await expect(page.locator('.marks .target')).toHaveCount(0);
  await clickMove(page, 'h2', 'e2');
  await waitPlies(page, 2);
  expect((await movetext(page)).startsWith('1. 炮二平五 ')).toBe(true);
  await expect(page.locator('#moves .mv')).toHaveCount(2);
  await expect(page.locator('.marks .last')).toHaveCount(2);
  await expect(page.locator('.status.turn')).toHaveText('轮到你');
  expectNoProblems(problems);
});

test('drag and drop, typed notation, and illegal moves are explained', async ({ page }) => {
  await open(page);
  await start(page, { mode: 'pvp' });
  const a = await point(page, ...iccs('b0'));
  const b = await point(page, ...iccs('c2'));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  expect(await movetext(page)).toBe('1. 马八进七');
  await page.locator('#move-text').fill('马8进7');
  await page.locator('#move-text').press('Enter');
  await page.locator('#move-text').fill('h2-e2');
  await page.locator('#move-text').press('Enter');
  expect(await movetext(page)).toBe('1. 马八进七 马8进7\n2. 炮二平五');
  await page.locator('#move-text').fill('车1进9');
  await page.locator('#move-text').press('Enter');
  await expect(page.locator('#toast')).toContainText('不是合法着法');
  // Moving the black king sideways would face the red king on an open file? Not here — try a pinned-style case:
  await page.evaluate(() => window.__xq.startGame({ mode: 'pvp', fen: '4k4/9/9/9/4N4/9/9/9/9/4K4 w - - 0 1' }));
  await clickMove(page, 'e5', 'c6');
  await expect(page.locator('#toast')).toContainText('将帅照面');
  expect(await plies(page)).toBe(0);
});

test('undo takes back your move and the engine reply; hint draws an arrow', async ({ page }) => {
  await open(page);
  await start(page, { mode: 'ai', humanSide: 0, levelId: 'novice' });
  await clickMove(page, 'b0', 'c2');
  await waitPlies(page, 2);
  await page.click('[data-cmd=undo]');
  expect(await plies(page)).toBe(0);
  await expect(page.locator('.piece')).toHaveCount(32);
  await page.click('[data-cmd=hint]');
  await expect(page.locator('.marks .hint')).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator('#toast')).toContainText('建议');
  await expect(page.locator('#analysis-body')).not.toBeEmpty();
});

test('playing Black: the engine opens and the board is flipped', async ({ page }) => {
  await open(page);
  await start(page, { mode: 'ai', humanSide: 1, levelId: 'easy' });
  await waitPlies(page, 1);
  expect(await page.evaluate(() => window.__xq.board.flipped)).toBe(true);
  await expect(page.locator('#player-bottom')).toContainText('你（黑方）');
  // a black horse move from Black's perspective
  await clickMove(page, 'h9', 'g7');
  await waitPlies(page, 3);
  expect((await movetext(page)).split('\n')[0]).toMatch(/马8进7$/);
  await page.click('[data-cmd=flip]');
  expect(await page.evaluate(() => window.__xq.board.flipped)).toBe(false);
});

test('review mode steps through the game and returns', async ({ page }) => {
  await open(page);
  await start(page, { mode: 'pvp' });
  for (const [a, b] of [['h2', 'e2'], ['h9', 'g7'], ['h0', 'g2'], ['i9', 'h9']]) await clickMove(page, a, b);
  await page.locator('#moves .mv').first().click();
  await expect(page.locator('#review')).toBeVisible();
  await expect(page.locator('#review-label')).toHaveText('第 1 / 4 手');
  await page.click('[data-cmd=review-next]');
  await expect(page.locator('#review-label')).toHaveText('第 2 / 4 手');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#review-label')).toHaveText('开局');
  await expect(page.locator('.marks .last')).toHaveCount(0);
  await page.click('[data-cmd=review-exit]');
  await expect(page.locator('#controls')).toBeVisible();
  expect(await plies(page)).toBe(4);
});

test('a puzzle: solve it, see success, progress is remembered', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  await page.click('[data-cmd=puzzles]');
  await page.locator('.puzzle-item').first().click();
  await expect(page.locator('.title')).toContainText('双车错');
  await clickMove(page, 'i4', 'i9'); // 车一进五
  await expect(page.getByRole('dialog', { name: '成功！' })).toBeVisible();
  await page.getByRole('button', { name: '下一题' }).click();
  await expect(page.locator('.title')).toContainText('马后炮');
  await page.reload();
  await page.waitForFunction(() => window.__xq);
  await page.click('[data-cmd=puzzles]');
  await expect(page.locator('.puzzle-item').first().locator('.done')).toHaveText('✓');
  expectNoProblems(problems);
});

test('a failed puzzle offers the solution, which the engine demonstrates', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__xq.startPuzzle('p3'));
  // two quiet moves instead of the mate
  await clickMove(page, 'e2', 'e1');
  await waitPlies(page, 2);
  await clickMove(page, 'e1', 'e2');
  await expect(page.getByRole('dialog', { name: '再试一次？' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: '看答案' }).click();
  await page.waitForFunction(() => window.__xq.app.game.result, null, { timeout: 20000 });
  expect(await page.evaluate(() => window.__xq.app.game.result.winner)).toBe(0);
  await expect(page.locator('#toast')).toContainText('答案演示完毕');
});

test('checkmating the engine ends the game with a dialog', async ({ page }) => {
  await open(page);
  await start(page, { mode: 'ai', humanSide: 0, levelId: 'medium', fen: '4k4/R8/9/9/9/8R/9/9/9/3K5 w - - 0 1' });
  await clickMove(page, 'i4', 'i9');
  await expect(page.getByRole('dialog', { name: '你赢了！' })).toBeVisible();
  await expect(page.locator('.title')).toContainText('红方胜（绝杀）');
  await page.getByRole('button', { name: '复盘' }).click();
  await expect(page.locator('#review')).toBeVisible();
});

test('the game survives a reload, and the new-game dialog works', async ({ page }) => {
  await open(page);
  await start(page, { mode: 'pvp' });
  await clickMove(page, 'h2', 'e2');
  await page.reload();
  await page.waitForFunction(() => window.__xq);
  expect(await movetext(page)).toBe('1. 炮二平五');
  await page.click('[data-cmd=new]');
  const dlg = page.getByRole('dialog', { name: '新局' });
  await dlg.getByText('电脑', { exact: true }).click();
  await dlg.getByText('黑方', { exact: true }).click();
  await dlg.getByText('入门', { exact: true }).click();
  await expect(page.locator('#level-note')).toContainText('两步');
  await dlg.getByRole('button', { name: '开始' }).click();
  await waitPlies(page, 1);
  await expect(page.locator('#player-top')).toContainText('电脑 · 入门');
});
