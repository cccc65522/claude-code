import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { trackErrors, open, value, input, cellPoint, clickCell, typeInto, cell, frame, expectNoProblems } from './helpers.js';

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'mouse & keyboard tests');
});

test('the sample workbook loads and computes across three sheets', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  await expect(page.getByRole('tab')).toHaveText(['家庭账本', '成绩单', '函数演示']);
  await expect(cell(page, 'H8')).toHaveText('¥5,816.50');
  await expect(cell(page, 'I11')).toHaveText('房租');
  await page.getByRole('tab', { name: '函数演示' }).click();
  await expect(cell(page, 'C12')).toHaveText('陈静');
  await expect(cell(page, 'C10')).toHaveText('¥548.30');
  await expectNoProblems(problems);
});

test('editing an amount updates the summaries immediately', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  await clickCell(page, 'D6'); // 房租 3200
  await page.keyboard.type('3000');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'H5')).toHaveText('¥3,238.60');
  await expect(cell(page, 'H8')).toHaveText('¥5,616.50');
  await expect(cell(page, 'H11')).toHaveText('¥3,000.00');
  await expect(page.locator('#namebox')).toHaveValue('D7');
  await expectNoProblems(problems);
});

test('build a formula by typing, pointing and autocomplete', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page, 'blank');
  await typeInto(page, 'A1', '10');
  await typeInto(page, 'A2', '32');
  await clickCell(page, 'A3');
  await page.keyboard.type('=');
  await clickCell(page, 'A1');
  await page.keyboard.type('+');
  await clickCell(page, 'A2');
  await expect(page.locator('.refbox')).toHaveCount(2);
  await page.keyboard.press('Enter');
  expect(await input(page, 'A3')).toBe('=A1+A2');
  await expect(cell(page, 'A3')).toHaveText('42');

  await clickCell(page, 'A4');
  await page.keyboard.type('=su');
  await expect(page.locator('#suggest .sg').first()).toContainText('SUM');
  await page.keyboard.press('Tab');
  await expect(page.locator('#bar-input')).toHaveValue('=SUM(');
  await expect(page.locator('#arghint')).toContainText('数值1');
  const a = await cellPoint(page, 'A1');
  const b = await cellPoint(page, 'A3');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Enter'); // the missing ")" is added automatically
  expect(await input(page, 'A4')).toBe('=SUM(A1:A3)');
  await expect(cell(page, 'A4')).toHaveText('84');
  await expectNoProblems(problems);
});

test('F4 toggles absolute references and Escape cancels', async ({ page }) => {
  await open(page, 'blank');
  await typeInto(page, 'B1', '=A1*2');
  await clickCell(page, 'B1');
  await page.keyboard.press('F2');
  await page.keyboard.press('F4');
  await page.keyboard.press('Enter');
  expect(await input(page, 'B1')).toBe('=$A$1*2');
  await clickCell(page, 'B1');
  await page.keyboard.type('junk');
  await page.keyboard.press('Escape');
  expect(await input(page, 'B1')).toBe('=$A$1*2');
});

test('fill handle extends a series and copies formulas', async ({ page }) => {
  await open(page, 'blank');
  await typeInto(page, 'A1', '1');
  await typeInto(page, 'A2', '2');
  await typeInto(page, 'B1', '=A1*10');
  // select A1:A2, drag the handle to A6
  const a1 = await cellPoint(page, 'A1');
  const a2 = await cellPoint(page, 'A2');
  await page.mouse.click(a1.x, a1.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(a2.x, a2.y);
  await page.keyboard.up('Shift');
  await frame(page);
  const h = await page.locator('.fill-handle').boundingBox();
  const a6 = await cellPoint(page, 'A6');
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(a6.x, a6.y, { steps: 6 });
  await expect(page.locator('.fillprev')).toBeVisible();
  await page.mouse.up();
  expect(await value(page, 'A6')).toBe(6);
  await clickCell(page, 'B1');
  await frame(page);
  const hb = await page.locator('.fill-handle').boundingBox();
  const b6 = await cellPoint(page, 'B6');
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(b6.x, b6.y, { steps: 6 });
  await page.mouse.up();
  expect(await input(page, 'B6')).toBe('=A6*10');
  await expect(cell(page, 'B6')).toHaveText('60');
});

test('insert and delete rows rewrite formulas, and undo restores them', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  const row3 = await page.evaluate(() => {
    const g = window.__app.ctrl.grid;
    const area = document.getElementById('grid-area').getBoundingClientRect();
    return { x: area.left + 20, y: area.top + g.HDR_H + g.rowY(2) + 10 };
  });
  await page.mouse.click(row3.x, row3.y, { button: 'right' });
  await page.getByRole('menuitem', { name: '在上方插入 1 行' }).click();
  expect(await input(page, 'H2')).toBe('=SUMIF($B$2:$B$17,G2,$D$2:$D$17)');
  await expect(cell(page, 'H9')).toHaveText('¥5,816.50');

  // Row 4 now holds 地铁月卡 ¥200 on the left and the 交通 summary row on the right;
  // deleting it removes both, so the total loses the whole 交通 category.
  await page.mouse.click(row3.x, row3.y + 24, { button: 'right' });
  await page.getByRole('menuitem', { name: '删除第 4 行' }).click();
  await expect(cell(page, 'H8')).toHaveText('¥5,420.30');
  expect(await input(page, 'H8')).toBe('=SUM(H2:H6)');
  await page.keyboard.press('Control+z');
  await expect(cell(page, 'H9')).toHaveText('¥5,816.50');
  await page.keyboard.press('Control+z');
  expect(await input(page, 'H2')).toBe('=SUMIF($B$2:$B$16,G2,$D$2:$D$16)');
  await expect(page.locator('[data-cmd="redo"]')).toBeEnabled();
  await expectNoProblems(problems);
});

test('copy & paste shifts references; cut & paste moves what formulas point at', async ({ page }) => {
  await open(page, 'blank');
  await typeInto(page, 'A1', '5');
  await typeInto(page, 'A2', '7');
  await typeInto(page, 'B1', '=A1*2');
  await clickCell(page, 'B1');
  await page.keyboard.press('Control+c');
  await expect(page.locator('.marquee')).toBeVisible();
  await clickCell(page, 'B2');
  await page.keyboard.press('Control+v');
  await expect.poll(() => input(page, 'B2')).toBe('=A2*2');
  expect(await value(page, 'B2')).toBe(14);

  await clickCell(page, 'A1');
  await page.keyboard.press('Control+x');
  await clickCell(page, 'D5');
  await page.keyboard.press('Control+v');
  await expect.poll(() => input(page, 'B1')).toBe('=D5*2');
  expect(await value(page, 'B1')).toBe(10);
  expect(await input(page, 'A1')).toBe('');
});

test('pasting tab-separated text from another app fills a block', async ({ page }) => {
  await open(page, 'blank');
  await clickCell(page, 'B2');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '名字\t分数\n甲\t90\n乙\t85\n');
    document.getElementById('cell-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  expect(await value(page, 'C4')).toBe(85);
  expect(await value(page, 'B2')).toBe('名字');
  await expect(page.locator('#namebox')).toHaveValue('B2:C4');
  await expect(page.locator('#status')).toContainText('求和 175');
});

test('pointing at another sheet builds a cross-sheet reference', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: '成绩单' }).click();
  await clickCell(page, 'M1');
  await page.keyboard.type('=');
  await page.getByRole('tab', { name: '家庭账本' }).click();
  await clickCell(page, 'H8');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: '成绩单' })).toHaveAttribute('aria-selected', 'true');
  expect(await input(page, 'M1')).toBe('=家庭账本!H8');
  await expect(cell(page, 'M1')).toHaveText('¥5,816.50');
});

test('circular references are flagged', async ({ page }) => {
  await open(page, 'blank');
  await typeInto(page, 'A1', '=B1+1');
  await typeInto(page, 'B1', '=A1+1');
  await expect(page.locator('#toast')).toContainText('循环引用');
  await expect(cell(page, 'A1')).toHaveText('#CIRC!');
  await clickCell(page, 'A1');
  await expect(page.locator('#status')).toContainText('循环引用');
  await typeInto(page, 'B1', '5');
  await expect(cell(page, 'A1')).toHaveText('6');
});

test('number formats, bold and sorting from the toolbar', async ({ page }) => {
  await open(page, 'blank');
  await typeInto(page, 'A1', '0.256');
  await clickCell(page, 'A1');
  await page.locator('[data-cmd="format-menu"]').click();
  await page.getByRole('menuitem', { name: /百分比 12\.34%/ }).click();
  await expect(cell(page, 'A1')).toHaveText('25.60%');
  await page.locator('[data-cmd="fmt-dec-less"]').click();
  await expect(cell(page, 'A1')).toHaveText('25.6%');
  await page.keyboard.press('Control+b');
  await expect(cell(page, 'A1')).toHaveClass(/\bb\b/);
  await expect(page.locator('[data-cmd="bold"]')).toHaveAttribute('aria-pressed', 'true');

  for (const [a, v] of [['C1', '分数'], ['C2', '70'], ['C3', '95'], ['C4', '80']]) await typeInto(page, a, v);
  await clickCell(page, 'C2');
  await page.locator('[data-cmd="sort-desc"]').click();
  expect([await value(page, 'C1'), await value(page, 'C2'), await value(page, 'C3'), await value(page, 'C4')]).toEqual(['分数', 95, 80, 70]);
});

test('find and replace across sheets', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+h');
  await page.locator('.f-find').fill('微信');
  // 7 payments + the 微信支付占比 label + two cells on the 函数演示 sheet
  await expect(page.locator('.f-count')).toHaveText('10 处');
  await page.locator('.f-find').press('Enter');
  await expect(page.locator('#namebox')).toHaveValue('E2');
  await page.locator('.f-rep').fill('WeChat');
  await page.getByRole('button', { name: '全部替换' }).click();
  expect(await value(page, 'E2')).toBe('WeChat');
  // the criterion inside the formula was replaced too, so the share is unchanged
  expect(await input(page, 'H13')).toBe('=SUMIF(E2:E16,"WeChat",D2:D16)/H8');
  await expect(cell(page, 'H13')).toHaveText('11.5%');
  await page.keyboard.press('Escape');
  await expect(page.locator('.findbar')).toHaveCount(0);
});

test('work survives a reload', async ({ page }) => {
  await open(page, 'blank');
  await typeInto(page, 'A1', '持久化');
  await typeInto(page, 'B1', '=LEN(A1)');
  await expect(page.locator('#save-state')).toHaveText('已保存');
  await page.goto('/');
  await page.waitForFunction(() => window.__app);
  expect(await value(page, 'A1')).toBe('持久化');
  expect(await value(page, 'B1')).toBe(3);
});

test('export to xlsx and open it again', async ({ page }, info) => {
  await open(page);
  await clickCell(page, 'D2');
  await page.keyboard.type('99');
  await page.keyboard.press('Enter');
  await page.locator('[data-cmd="menu-file"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: '导出为 Excel (.xlsx)' }).click()
  ]);
  // (Headless Chromium reports non-ASCII download names as "download", so only check the extension when it's kept.)
  expect(download.suggestedFilename()).toMatch(/\.xlsx$|^download$/);
  const file = info.outputPath('book.xlsx');
  await download.saveAs(file);
  expect(fs.readFileSync(file).subarray(0, 2).toString()).toBe('PK');

  await page.locator('[data-cmd="menu-file"]').click();
  await page.getByRole('menuitem', { name: '新建空白表格' }).click();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveText(['Sheet1']);

  await page.locator('[data-cmd="menu-file"]').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: /打开文件/ }).click()
  ]);
  await chooser.setFiles(file);
  await expect(page.getByRole('tab')).toHaveText(['家庭账本', '成绩单', '函数演示']);
  await expect(cell(page, 'H8')).toHaveText('¥5,897.50');
  expect(await input(page, 'H2')).toBe('=SUMIF($B$2:$B$16,G2,$D$2:$D$16)');
  // opening a file is undoable
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('tab')).toHaveText(['Sheet1']);
});

test('function picker inserts a function into the editor', async ({ page }) => {
  await open(page, 'blank');
  await clickCell(page, 'B2');
  await page.locator('[data-cmd="functions"]').first().click();
  await page.getByRole('searchbox', { name: '搜索函数' }).fill('vlookup');
  await page.locator('.fn-item').first().click();
  await expect(page.locator('#bar-input')).toHaveValue('=VLOOKUP(');
  await expect(page.locator('#arghint')).toContainText('查找值');
});
