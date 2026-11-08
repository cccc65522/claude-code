import { test, expect } from '@playwright/test';
import { trackErrors, open, value, input, cellPoint, tapCell, longPress, cell, frame, expectNoProblems } from './helpers.js';

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'iphone', 'touch tests');
});

test('layout fits the phone without sideways page scroll', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  const { doc, win } = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(doc).toBeLessThanOrEqual(win);
  await expect(page.locator('.bottombar')).toBeInViewport();
  await expect(page.locator('.fbar')).toBeInViewport();
  // inputs are at least 16px so Safari doesn't zoom on focus
  const size = await page.locator('#bar-input').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
  await expectNoProblems(problems);
});

test('tap selects, a second tap edits in the formula bar', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page, 'blank');
  await tapCell(page, 'B2');
  await expect(page.locator('#namebox')).toHaveValue('B2');
  await expect(page.locator('#keybar')).toBeHidden();
  await tapCell(page, 'B2');
  await expect(page.locator('#bar-input')).toBeFocused();
  await expect(page.locator('#keybar')).toBeVisible();
  await page.keyboard.type('123');
  await page.locator('[data-cmd="edit-commit"]').tap();
  expect(await value(page, 'B2')).toBe(123);
  await expect(page.locator('#keybar')).toBeHidden();
  await expectNoProblems(problems);
});

// Tap to select, tap again to edit (one tap is enough when the cell is already active).
async function editCell(page, a) {
  await tapCell(page, a);
  if (!await page.evaluate(() => window.__app.ctrl.editor.editing)) await tapCell(page, a);
  await expect(page.locator('#bar-input')).toBeFocused();
}

test('tapping cells while typing a formula inserts references', async ({ page }) => {
  await open(page, 'blank');
  for (const [a, v] of [['A1', '4'], ['A2', '6']]) {
    await editCell(page, a);
    await page.keyboard.type(v);
    await page.keyboard.press('Enter');
  }
  await editCell(page, 'A3');
  await page.locator('#keybar [data-key="="]').tap();
  await tapCell(page, 'A1');
  await page.locator('#keybar [data-key="*"]').tap();
  await tapCell(page, 'A2');
  await expect(page.locator('#bar-input')).toHaveValue('=A1*A2');
  await page.keyboard.press('Enter');
  expect(await input(page, 'A3')).toBe('=A1*A2');
  await expect(cell(page, 'A3')).toHaveText('24');
});

test('long press opens the cell menu', async ({ page }) => {
  await open(page);
  const p = await cellPoint(page, 'B3');
  await longPress(page, p.x, p.y);
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.locator('#namebox')).toHaveValue('B3');
  await page.getByRole('menuitem', { name: '清除内容' }).tap();
  expect(await value(page, 'B3')).toBe(null);
  // 交通 lost one entry
  expect(await value(page, 'J3')).toBe(2); // off-screen on a phone, so read the model
});

test('the selection handle extends the selection by dragging', async ({ page }) => {
  await open(page);
  await tapCell(page, 'A2');
  await frame(page);
  const h = await page.locator('.fill-handle').boundingBox();
  const target = await cellPoint(page, 'A5');
  const cdp = await page.context().newCDPSession(page);
  const start = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + ((target.x - start.x) * i) / 6, y: start.y + ((target.y - start.y) * i) / 6 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect(page.locator('#namebox')).toHaveValue('A2:A5');
  // the dates are numbers, so the status bar sums them
  await expect(page.locator('#status')).toContainText('计数 4');
});

test('function picker works from the symbol bar', async ({ page }) => {
  await open(page, 'blank');
  await tapCell(page, 'A1');
  await tapCell(page, 'A1');
  await page.locator('#keybar [data-cmd="functions"]').tap();
  await page.getByRole('button', { name: '日期', exact: true }).tap();
  await page.locator('.fn-item', { hasText: 'TODAY()' }).tap();
  await expect(page.locator('#bar-input')).toHaveValue('=TODAY(');
  await page.locator('[data-cmd="edit-commit"]').tap();
  expect(await input(page, 'A1')).toBe('=TODAY()');
  await expect(cell(page, 'A1')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
});
