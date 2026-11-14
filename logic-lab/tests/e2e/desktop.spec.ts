import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { clickPart, dragWire, fresh, newBlank, openExample, partByLabel, partIds, pinCenter, readout, wireCount } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('first visit shows the half adder, and it works', async ({ page }) => {
  await fresh(page);
  const a = await partByLabel(page, 'in', 'A');
  const b = await partByLabel(page, 'in', 'B');
  const s = await partByLabel(page, 'out', 'S');
  const c = await partByLabel(page, 'out', 'C');
  await expect(readout(page, s)).toHaveText('0');
  await clickPart(page, a);
  await expect(readout(page, s)).toHaveText('1');
  await expect(readout(page, c)).toHaveText('0');
  await clickPart(page, b);
  await expect(readout(page, s)).toHaveText('0');
  await expect(readout(page, c)).toHaveText('1');
});

test('build an XOR-driven LED from scratch: place, wire by dragging, wire by tapping, toggle', async ({ page }) => {
  await fresh(page);
  await newBlank(page);
  await expect(page.locator('.canvas .part')).toHaveCount(0);
  await page.locator('.palette-item[data-kind="in"]').click();
  await page.locator('.palette-item[data-kind="in"]').click();
  await page.locator('.palette-item[data-kind="xor"]').click();
  await page.locator('.palette-item[data-kind="led"]').click();
  const [a, b] = await partIds(page, 'in');
  const [x] = await partIds(page, 'xor');
  const [led] = await partIds(page, 'led');
  // New input pins get the next free name.
  await expect(page.locator(`.canvas [data-part="${a}"] .part-label`)).toHaveText('A');
  await expect(page.locator(`.canvas [data-part="${b}"] .part-label`)).toHaveText('B');

  await dragWire(page, [a, 'o'], [x, 'i0']);
  await dragWire(page, [b, 'o'], [x, 'i1']);
  expect(await wireCount(page)).toBe(2);
  // Tap-tap wiring: click a pin, then another.
  const p = await pinCenter(page, x, 'o');
  const q = await pinCenter(page, led, 'i');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.pin.active')).toHaveCount(1);
  await page.mouse.click(q.x, q.y);
  expect(await wireCount(page)).toBe(3);

  const ledCircle = page.locator(`.canvas [data-part="${led}"] circle.led`);
  await expect(ledCircle).toHaveClass(/v0/);
  await clickPart(page, a);
  await expect(ledCircle).toHaveClass(/v1/);
  await clickPart(page, b);
  await expect(ledCircle).toHaveClass(/v0/);
  // Duplicate wires are refused.
  await dragWire(page, [a, 'o'], [x, 'i0']);
  await expect(page.getByTestId('toast')).toContainText('已经连上');
  expect(await wireCount(page)).toBe(3);
});

test('dragging parts, undo/redo, rotate, delete and copy/paste with the keyboard', async ({ page }) => {
  await fresh(page);
  await newBlank(page);
  await page.locator('.palette-item[data-kind="and"]').click();
  const [g] = await partIds(page, 'and');
  const part = page.locator(`.canvas [data-part="${g}"]`);
  const before = await part.getAttribute('transform');
  const box = (await part.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  const after = await part.getAttribute('transform');
  expect(after).not.toBe(before);
  await page.keyboard.press('Control+z');
  await expect(part).toHaveAttribute('transform', before!);
  await page.keyboard.press('Control+y');
  await expect(part).toHaveAttribute('transform', after!);

  await clickPart(page, g);
  await page.keyboard.press('r');
  await expect(part.locator('g[transform*="rotate(90)"]')).toHaveCount(1);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.locator('.canvas .part.kind-and')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('.canvas .part.kind-and')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.canvas .part.kind-and')).toHaveCount(2);
});

test('inspector: gate input count, labels, constants', async ({ page }) => {
  await fresh(page);
  await newBlank(page);
  await page.locator('.palette-item[data-kind="or"]').click();
  await expect(page.getByTestId('input-count')).toHaveText('2');
  await page.getByRole('button', { name: '增加输入' }).click();
  await page.getByRole('button', { name: '增加输入' }).click();
  await expect(page.getByTestId('input-count')).toHaveText('4');
  const [g] = await partIds(page, 'or');
  await expect(page.locator(`[data-pin="${g}:i3"]`)).toHaveCount(1);
  await page.locator('.field input').fill('总开关');
  await page.locator('.field input').press('Enter');
  await expect(page.locator(`.canvas [data-part="${g}"] .part-label`)).toHaveText('总开关');
});

test('expression → circuit → truth table with minimised expression and K-map', async ({ page }) => {
  await fresh(page);
  await newBlank(page);
  await page.getByTestId('file-menu').click();
  await page.getByRole('menuitem', { name: '由表达式或真值表生成电路…' }).click();
  await page.getByTestId('expr-input').fill('Y = A B');
  await expect(page.getByRole('alert')).toContainText('缺少运算符');
  await page.getByTestId('expr-input').fill("Y = A & B | A & C | B & C | A & B & C'");
  await page.getByTestId('expr-insert').click();
  await expect(page.locator('.canvas .part.kind-in')).toHaveCount(3);
  await page.getByRole('tab', { name: '真值表' }).click();
  const rows = page.getByTestId('truth-table').locator('tbody tr');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(3).locator('td').last()).toHaveText('1');
  await expect(rows.nth(4).locator('td').last()).toHaveText('0');
  // The redundant term is gone: majority = AB + AC + BC.
  await expect(page.getByTestId('min-exprs')).toContainText('Y = A·B + A·C + B·C');
  await expect(page.locator('.kmap td.v1')).toHaveCount(4);
  await page.locator('.expr .term').first().hover();
  await expect(page.locator('.kmap td.hit')).toHaveCount(2);
  // Build the minimal version as a chip.
  await page.getByRole('button', { name: '生成最简电路' }).click();
  await expect(page.locator('.palette .chip-item')).toHaveCount(1);
});

test('chips: open the 4-bit adder, add numbers, go inside a chip and back', async ({ page }) => {
  await fresh(page);
  await openExample(page, 'adder4');
  for (const label of ['A0', 'A1', 'A3', 'B0', 'B3']) await clickPart(page, await partByLabel(page, 'in', label));
  // 11 + 9 = 20 = 0x14: display shows 4, carry lit.
  await expect(page.locator('.canvas .hex-digit')).toHaveText('4');
  await expect(page.locator('.canvas .part.kind-led circle.led')).toHaveClass(/v1/);
  const chip = page.locator('.canvas .part.kind-chip').first();
  await chip.dblclick();
  await expect(page.getByTestId('breadcrumb')).toContainText('全加器');
  await expect(page.locator('.canvas .part.kind-xor')).toHaveCount(2);
  await page.getByRole('tab', { name: '真值表' }).click();
  await expect(page.getByTestId('truth-table').locator('tbody tr')).toHaveCount(8);
  await page.getByTestId('breadcrumb').getByRole('button', { name: '主电路' }).click();
  await expect(page.locator('.canvas .part.kind-chip')).toHaveCount(4);
  // The chip list knows where the chip is used, and refuses to delete it.
  await page.getByRole('tab', { name: '芯片' }).click();
  await expect(page.locator('.chip-list li')).toContainText('用在：4 位加法器');
  await expect(page.locator('.chip-list li').getByRole('button', { name: '删除' })).toBeDisabled();
});

test('a chip edited inside updates every instance', async ({ page }) => {
  await fresh(page);
  await newBlank(page);
  await page.getByRole('tab', { name: '芯片' }).click();
  await page.getByRole('button', { name: '＋ 新建芯片' }).click();
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  // The new chip has inputs A, B and output Y; wire A straight to Y.
  const a = await partByLabel(page, 'in', 'A');
  const y = await partByLabel(page, 'out', 'Y');
  await dragWire(page, [a, 'o'], [y, 'i']);
  await page.getByTestId('breadcrumb').getByRole('button', { name: '← 返回' }).click();
  await page.locator('.palette .chip-item').click();
  await page.locator('.palette-item[data-kind="in"]').click();
  await page.locator('.palette-item[data-kind="out"]').click();
  const [chip] = await partIds(page, 'chip');
  const [inp] = await partIds(page, 'in');
  const [out] = await partIds(page, 'out');
  const chipPins = await page.locator(`[data-pin^="${chip}:"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-pin')!));
  expect(chipPins).toHaveLength(3);
  await dragWire(page, [inp, 'o'], chipPins[0].split(':') as [string, string]);
  await dragWire(page, chipPins[2].split(':') as [string, string], [out, 'i']);
  await clickPart(page, inp);
  await expect(readout(page, out)).toHaveText('1');
});

test('challenge mode: solve the first level, earn stars, move on', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('levels-mode').click();
  await expect(page.getByTestId('level-card')).toContainText('第一根导线');
  // Only text is allowed in the palette for this level.
  await expect(page.locator('.palette-item[data-kind="and"]')).toHaveCount(0);
  await page.getByTestId('check').click();
  await expect(page.getByTestId('check-result')).toContainText('应为');
  await dragWire(page, ['in_A', 'o'], ['out_Y', 'i']);
  await page.getByTestId('check').click();
  await expect(page.getByTestId('check-result')).toContainText('通过');
  await expect(page.getByTestId('check-result').locator('.stars .on')).toHaveCount(3);
  // Locked pins can't be deleted.
  await clickPart(page, 'in_A');
  await page.keyboard.press('Delete');
  await expect(page.locator('.canvas [data-part="in_A"]')).toHaveCount(1);
  await page.getByRole('button', { name: /下一关/ }).click();
  await expect(page.getByTestId('level-card')).toContainText('与非门做非门');
  await expect(page.locator('.palette-item[data-kind="nand"]')).toHaveCount(1);
  await expect(page.locator('.palette-item[data-kind="not"]')).toHaveCount(0);
  // Solve it with one NAND.
  await page.locator('.palette-item[data-kind="nand"]').click();
  const [n] = await partIds(page, 'nand');
  await dragWire(page, ['in_A', 'o'], [n, 'i0']);
  await dragWire(page, ['in_A', 'o'], [n, 'i1']);
  await dragWire(page, [n, 'o'], ['out_Y', 'i']);
  await page.getByTestId('check').click();
  await expect(page.getByTestId('check-result')).toContainText('达到最少');
  // Progress survives a reload, and the level list shows it.
  await page.reload();
  await expect(page.locator('[data-level="not-from-nand"] .stars .on')).toHaveCount(3);
  await expect(page.locator('[data-level="wire"] .stars .on')).toHaveCount(3);
});

test('clock, counter and waveform', async ({ page }) => {
  await fresh(page);
  await openExample(page, 'counter4');
  await page.getByTestId('wave-toggle').click();
  await expect(page.getByTestId('waveform')).toContainText('CLK');
  await expect(page.locator('.canvas .hex-digit')).toHaveText('0');
  for (let i = 0; i < 6; i++) await page.getByTestId('step').click();
  await expect(page.locator('.canvas .hex-digit')).toHaveText('3');
  await expect(page.getByTestId('status')).toContainText('第 6 拍');
  await page.getByTestId('run').click();
  await expect(page.locator('.canvas .hex-digit')).not.toHaveText('3', { timeout: 5000 });
  await page.getByTestId('run').click();
  await expect(page.getByTestId('waveform').locator('.wave-row')).toHaveCount(5);
  await page.getByRole('button', { name: /复位/ }).click();
  await expect(page.locator('.canvas .hex-digit')).toHaveText('0');
});

test('step-by-step propagation reveals the glitch; oscillation is reported', async ({ page }) => {
  await fresh(page);
  await openExample(page, 'hazard');
  await page.getByTestId('step-mode').check();
  const a = await partByLabel(page, 'in', 'A');
  await clickPart(page, a);
  // Wait for the propagation animation to finish and look for the 1-delay pulse on Y.
  await expect(page.getByTestId('status')).not.toContainText('信号传播中', { timeout: 5000 });
  const glitch = await page.evaluate(() => {
    const m = (globalThis as unknown as { mendao: { simctl: { samples: { v: Record<string, number> }[]; signals: { id: string; label: string }[] } } }).mendao;
    const y = m.simctl.signals.find((s) => s.label === 'Y')!.id;
    return m.simctl.samples.map((s) => s.v[y]);
  });
  expect(glitch).toContain(1);
  expect(glitch[glitch.length - 1]).toBe(0);
  await page.getByTestId('step-mode').uncheck();

  await openExample(page, 'ring');
  await expect(page.getByTestId('osc-warning')).toHaveCount(0);
  await clickPart(page, await partByLabel(page, 'in', 'EN'));
  await expect(page.getByTestId('osc-warning')).toBeVisible();
  // The wires that keep changing are marked.
  expect(await page.locator('.wire.osc').count()).toBeGreaterThanOrEqual(3);
});

test('tri-state bus shows high impedance and short circuits', async ({ page }) => {
  await fresh(page);
  await openExample(page, 'tristate');
  const bus = page.locator('.canvas .part.kind-led circle.led');
  await expect(bus).toHaveClass(/v1/);
  await clickPart(page, await partByLabel(page, 'in', 'EN1'));
  await expect(bus).toHaveClass(/vz/);
  await clickPart(page, await partByLabel(page, 'in', 'EN2'));
  await expect(bus).toHaveClass(/v0/);
  await clickPart(page, await partByLabel(page, 'in', 'EN1'));
  await expect(bus).toHaveClass(/ve/);
  await expect(page.locator('.wire.ve').first()).toBeVisible();
});

test('the circuit and input values survive a reload', async ({ page }) => {
  await fresh(page);
  await openExample(page, 'sr-latch');
  await newBlank(page);
  await page.locator('.palette-item[data-kind="in"]').click();
  await page.locator('.palette-item[data-kind="out"]').click();
  const [i] = await partIds(page, 'in');
  const [o] = await partIds(page, 'out');
  await dragWire(page, [i, 'o'], [o, 'i']);
  await clickPart(page, i);
  await expect(readout(page, o)).toHaveText('1');
  await page.waitForTimeout(600); // autosave debounce
  await page.reload();
  await expect(readout(page, o)).toHaveText('1');
  expect(await wireCount(page)).toBe(1);
});

test('share link opens the same circuit elsewhere; export downloads a file', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fresh(page);
  await openExample(page, 'decimal');
  await page.getByTestId('file-menu').click();
  await page.getByRole('menuitem', { name: '复制分享链接' }).click();
  await expect(page.getByTestId('toast')).toContainText('分享链接已复制');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('#c=z');
  const other = await browser.newPage();
  await other.goto(url);
  await expect(other.getByTestId('toast')).toContainText('已打开分享的电路');
  await expect(other.locator('.canvas .part.kind-seg7')).toHaveCount(1);
  await expect(other.locator('.palette .chip-item')).toHaveCount(1);
  await other.close();

  await page.getByTestId('file-menu').click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: '导出文件' }).click();
  const file = await download;
  // (Headless Chromium drops non-ASCII download names, so check the content.)
  const json = JSON.parse(readFileSync((await file.path())!, 'utf8'));
  expect(json.app).toBe('mendao');
  expect(json.main.name).toBe('十进制计数器');
  expect(json.chips).toHaveLength(1);
});

test('dark theme and help dialog', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: '切换深浅色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(13, 19, 27)');
  await page.getByRole('button', { name: '使用说明' }).click();
  await expect(page.getByRole('dialog')).toContainText('快捷键');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a wire bend can be dragged and reset by double-click', async ({ page }) => {
  await fresh(page);
  await newBlank(page);
  await page.locator('.palette-item[data-kind="in"]').click();
  await page.locator('.palette-item[data-kind="led"]').click();
  const [i] = await partIds(page, 'in');
  const [l] = await partIds(page, 'led');
  // Move the LED down so the wire has a vertical middle segment.
  await clickPart(page, l);
  for (let k = 0; k < 6; k++) await page.keyboard.press('ArrowDown');
  await dragWire(page, [i, 'o'], [l, 'i']);
  const line = page.locator('.wire-line').first();
  const d0 = await line.getAttribute('d');
  // Screen position of the middle of the wire (which lies on its middle segment).
  const middle = () =>
    line.evaluate((el) => {
      const path = el as SVGPathElement;
      const pt = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM()!;
      return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
    });
  const m0 = await middle();
  await page.mouse.move(m0.x, m0.y);
  await page.mouse.down();
  await page.mouse.move(m0.x + 40, m0.y + 40, { steps: 5 });
  await page.mouse.up();
  const d1 = await line.getAttribute('d');
  expect(d1).not.toBe(d0);
  const m1 = await middle();
  await page.mouse.dblclick(m1.x, m1.y);
  await expect(line).toHaveAttribute('d', d0!);
});

test('package a selection as a chip with Ctrl+G; the circuit keeps working', async ({ page }) => {
  await fresh(page);
  const a = await partByLabel(page, 'in', 'A');
  const b = await partByLabel(page, 'in', 'B');
  const s = await partByLabel(page, 'out', 'S');
  const c = await partByLabel(page, 'out', 'C');
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await expect(page.getByTestId('toast')).toContainText('2 个输入、2 个输出');
  await expect(page.locator('.canvas .part.kind-xor')).toHaveCount(0);
  await expect(page.locator('.canvas .part.kind-chip')).toHaveCount(1);
  // The chip's pins are named after the switches and outputs they connect to.
  await expect(page.locator('.canvas .part.kind-chip .pin-label')).toHaveText(['A', 'B', 'S', 'C']);
  await clickPart(page, a);
  await clickPart(page, b);
  await expect(readout(page, s)).toHaveText('0');
  await expect(readout(page, c)).toHaveText('1');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.canvas .part.kind-xor')).toHaveCount(1);
});

test('truth table designer builds the circuit for a table', async ({ page }) => {
  await fresh(page);
  await newBlank(page);
  await page.getByTestId('file-menu').click();
  await page.getByRole('menuitem', { name: '由表达式或真值表生成电路…' }).click();
  await page.getByTestId('mode-table').click();
  await page.getByTestId('tt-inputs').fill('P Q');
  await page.getByTestId('tt-outputs').fill('F');
  // F = 1 for rows 01 and 10 (XOR), don't care for 11.
  await page.locator('[data-cell="F:1"]').click();
  await page.locator('[data-cell="F:2"]').click();
  await page.locator('[data-cell="F:3"]').click();
  await page.locator('[data-cell="F:3"]').click();
  await expect(page.locator('[data-cell="F:3"]')).toHaveText('×');
  await expect(page.getByTestId('tt-equations')).toHaveText('F = P | Q');
  await page.getByTestId('tt-inputs').fill('P P');
  await expect(page.getByRole('alert')).toContainText('重复');
  await page.getByTestId('tt-inputs').fill('P Q');
  await page.getByTestId('expr-insert').click();
  await page.getByRole('tab', { name: '真值表' }).click();
  const rows = page.getByTestId('truth-table').locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator('td').last()).toHaveText('0');
  await expect(rows.nth(1).locator('td').last()).toHaveText('1');
});

test('a new wire dropped onto an existing wire joins its signal; probes show in the waveform', async ({ page }) => {
  await fresh(page);
  await newBlank(page);
  await page.locator('.palette-item[data-kind="in"]').click();
  await page.locator('.palette-item[data-kind="led"]').click();
  await page.locator('.palette-item[data-kind="out"]').click();
  const [i] = await partIds(page, 'in');
  const [l] = await partIds(page, 'led');
  const [o] = await partIds(page, 'out');
  await dragWire(page, [i, 'o'], [l, 'i']);
  // Drag from the output pin's input onto the middle of the existing wire.
  const line = page.locator('.wire-line').first();
  const mid = await line.evaluate((el) => {
    const path = el as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM()!;
    return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
  });
  const start = await pinCenter(page, o, 'i');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 6 });
  await page.mouse.up();
  expect(await wireCount(page)).toBe(2);
  await clickPart(page, i);
  await expect(readout(page, o)).toHaveText('1');
  // Probe the first wire.
  await page.mouse.click(mid.x, mid.y);
  await page.getByTestId('probe').click();
  await expect(page.getByTestId('waveform').locator('.wave-row.kind-probe')).toHaveCount(1);
});

test('keyboard keys toggle inputs', async ({ page }) => {
  await fresh(page);
  const a = await partByLabel(page, 'in', 'A');
  const s = await partByLabel(page, 'out', 'S');
  await clickPart(page, a);
  await clickPart(page, a); // back to 0, and selected
  const field = page.locator('.field', { hasText: '键盘按键' }).locator('input');
  await field.fill('1');
  await field.press('Enter');
  await expect(page.locator(`.canvas [data-part="${a}"] .key-badge`)).toHaveText('1');
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('1');
  await expect(readout(page, s)).toHaveText('1');
  await page.keyboard.press('1');
  await expect(readout(page, s)).toHaveText('0');
});

test('new challenge: four-way multiplexer from three 2:1 muxes', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('levels-mode').click();
  await page.locator('[data-level="mux4"]').click();
  await expect(page.getByTestId('level-card')).toContainText('四选一');
  for (let k = 0; k < 3; k++) await page.locator('.palette-item[data-kind="mux"]').click();
  const [m0, m1, m] = await partIds(page, 'mux');
  await dragWire(page, ['in_D0', 'o'], [m0, 'a']);
  await dragWire(page, ['in_D1', 'o'], [m0, 'b']);
  await dragWire(page, ['in_S0', 'o'], [m0, 's']);
  await dragWire(page, ['in_D2', 'o'], [m1, 'a']);
  await dragWire(page, ['in_D3', 'o'], [m1, 'b']);
  await dragWire(page, ['in_S0', 'o'], [m1, 's']);
  await dragWire(page, [m0, 'o'], [m, 'a']);
  await dragWire(page, [m1, 'o'], [m, 'b']);
  await dragWire(page, ['in_S1', 'o'], [m, 's']);
  await dragWire(page, [m, 'o'], ['out_Y', 'i']);
  await page.getByTestId('check').click();
  await expect(page.getByTestId('check-result')).toContainText('达到最少');
});

test('the built app is installable: manifest and service worker', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.short_name).toBe('门道');
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { timeout: 10000 }).toBe(1);
});

test('state diagram of the traffic light follows the running machine', async ({ page }) => {
  await fresh(page);
  await openExample(page, 'traffic');
  await page.locator('.tabs').getByRole('tab', { name: '真值表' }).click();
  await page.getByTestId('fsm-tab').click();
  await expect(page.getByTestId('state-table').locator('tbody tr')).toHaveCount(8);
  await expect(page.locator('.fsm-node')).toHaveCount(8);
  await expect(page.locator('.fsm-node.current')).toHaveAttribute('data-state', '000');
  // CLK flips every 2 ticks: one full cycle is 4 ticks.
  for (let i = 0; i < 4; i++) await page.getByTestId('step').click();
  await expect(page.locator('.fsm-node.current')).toHaveAttribute('data-state', '001');
  await expect(page.locator('.canvas .part.kind-led circle.led-green')).toHaveClass(/v1/);
  for (let i = 0; i < 12; i++) await page.getByTestId('step').click();
  await expect(page.locator('.fsm-node.current')).toHaveAttribute('data-state', '100');
  await expect(page.locator('.canvas .part.kind-led circle.led-amber')).toHaveClass(/v1/);
});
