import { expect, test } from '@playwright/test';
import { fresh, newBlank, partByLabel, partIds, pinCenter, readout } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('fits the phone screen without horizontal scrolling', async ({ page }) => {
  await fresh(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // The toolbar takes at most two rows.
  const h = await page.locator('.topbar').evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeLessThan(110);
  // Side panels are hidden until asked for.
  await expect(page.locator('.palette-item[data-kind="and"]')).not.toBeInViewport();
  await page.locator('.mobile-nav').getByRole('button', { name: '元件' }).click();
  await expect(page.locator('.palette-item[data-kind="and"]')).toBeInViewport();
});

test('the first circuit and its note fit across the phone screen', async ({ page }) => {
  await fresh(page);
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  const items = page.locator('.canvas text.note, .canvas [data-part]');
  expect(await items.count()).toBeGreaterThan(5);
  for (const el of await items.all()) {
    const b = (await el.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(canvas.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
  }
  // Fitted to the real canvas, not a guessed size: the circuit uses a good part of the width.
  const parts = await page.locator('.canvas [data-part]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  const span = Math.max(...parts.map((r) => r.right)) - Math.min(...parts.map((r) => r.left));
  expect(span).toBeGreaterThan(canvas.width * 0.6);
});

test('tap a switch in the half adder', async ({ page }) => {
  await fresh(page);
  const a = await partByLabel(page, 'in', 'A');
  const s = await partByLabel(page, 'out', 'S');
  await page.locator(`.canvas [data-part="${a}"]`).tap();
  await expect(readout(page, s)).toHaveText('1');
});

test('build a circuit with taps only', async ({ page }) => {
  await fresh(page);
  await newBlank(page);
  const nav = page.locator('.mobile-nav');
  await nav.getByRole('button', { name: '元件' }).click();
  await page.locator('.palette-item[data-kind="in"]').tap();
  // Placing a part closes the sheet so the canvas is visible.
  await expect(page.locator('.palette-item[data-kind="in"]')).not.toBeInViewport();
  await nav.getByRole('button', { name: '元件' }).click();
  await page.locator('.palette-item[data-kind="not"]').tap();
  await nav.getByRole('button', { name: '元件' }).click();
  await page.locator('.palette-item[data-kind="out"]').tap();
  const [i] = await partIds(page, 'in');
  const [n] = await partIds(page, 'not');
  const [o] = await partIds(page, 'out');
  const tapPin = async (id: string, pin: string) => {
    const p = await pinCenter(page, id, pin);
    await page.touchscreen.tap(p.x, p.y);
  };
  await tapPin(i, 'o');
  await tapPin(n, 'i0');
  await tapPin(n, 'o');
  await tapPin(o, 'i');
  await expect(page.locator('[data-wire-id]')).toHaveCount(2);
  await expect(readout(page, o)).toHaveText('1');
  await page.locator(`.canvas [data-part="${i}"]`).tap();
  await expect(readout(page, o)).toHaveText('0');
  // The floating action deletes the selection.
  await page.locator(`.canvas [data-part="${n}"]`).tap();
  await page.getByRole('button', { name: '删除所选' }).tap();
  await expect(page.locator('.canvas .part.kind-not')).toHaveCount(0);
  await expect(readout(page, o)).toHaveText('Z');
});

test('challenge panel opens as a sheet', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('levels-mode').tap();
  await page.locator('.mobile-nav').getByRole('button', { name: '关卡' }).tap();
  await expect(page.getByTestId('level-card')).toBeInViewport();
  await expect(page.getByTestId('level-card')).toContainText('第一根导线');
});
