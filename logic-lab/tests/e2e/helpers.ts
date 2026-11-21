import { expect, type Page } from '@playwright/test';

/** Start from a clean slate: no saved project, progress or UI state. */
export async function fresh(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await expect(page.getByTestId('canvas')).toBeVisible();
}

export async function openExample(page: Page, id: string): Promise<void> {
  await page.getByTestId('file-menu').click();
  await page.getByRole('menuitem', { name: '打开示例…' }).click();
  await page.locator(`[data-example="${id}"]`).click();
  await expect(page.locator('.modal')).toHaveCount(0);
}

export async function newBlank(page: Page): Promise<void> {
  await page.getByTestId('file-menu').click();
  await page.getByRole('menuitem', { name: /新建空白电路|重来这一关/ }).click();
}

export async function pinCenter(page: Page, partId: string, pin: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`[data-pin="${partId}:${pin}"]`).boundingBox();
  if (!box) throw new Error(`pin ${partId}:${pin} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a wire from one pin to another with the mouse. */
export async function dragWire(page: Page, a: [string, string], b: [string, string]): Promise<void> {
  const p = await pinCenter(page, ...a);
  const q = await pinCenter(page, ...b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await page.mouse.move(q.x, q.y, { steps: 4 });
  await page.mouse.up();
}

/** Ids of the parts of a kind, in document order. */
export async function partIds(page: Page, kind: string): Promise<string[]> {
  return page.locator(`.canvas .part.kind-${kind}`).evaluateAll((els) => els.map((e) => e.getAttribute('data-part')!));
}

export async function partByLabel(page: Page, kind: string, label: string): Promise<string> {
  const id = await page
    .locator(`.canvas .part.kind-${kind}`)
    .filter({ has: page.locator('text.part-label', { hasText: new RegExp(`^${label}$`) }) })
    .first()
    .getAttribute('data-part');
  if (!id) throw new Error(`no ${kind} labelled ${label}`);
  return id;
}

/** The 0/1/X/Z/E readout of an input or output pin part. */
export function readout(page: Page, partId: string) {
  return page.locator(`.canvas [data-part="${partId}"] text.io-text`);
}

export async function clickPart(page: Page, partId: string): Promise<void> {
  await page.locator(`.canvas [data-part="${partId}"]`).click();
}

export async function wireCount(page: Page): Promise<number> {
  return page.locator('[data-wire-id]').count();
}
