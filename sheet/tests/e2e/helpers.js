import { expect } from '@playwright/test';

export function trackErrors(page) {
  const problems = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  return problems;
}

export async function open(page, query = 'fresh') {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__app);
}

const parse = a => {
  const m = /^([A-Z]+)(\d+)$/.exec(a);
  let c = 0;
  for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
  return { r: Number(m[2]) - 1, c: c - 1 };
};

// Value of a cell on the visible sheet (errors as their code).
export function value(page, a) {
  const { r, c } = parse(a);
  return page.evaluate(([r, c]) => {
    const { wb, ctrl } = window.__app;
    const v = wb.getValue(ctrl.sheetId, r, c);
    return v && typeof v === 'object' && 'code' in v ? v.code : v;
  }, [r, c]);
}

export function input(page, a) {
  const { r, c } = parse(a);
  return page.evaluate(([r, c]) => window.__app.wb.getInput(window.__app.ctrl.sheetId, r, c), [r, c]);
}

// Page coordinates of a cell's centre (scrolling it into view first).
export async function cellPoint(page, a) {
  const { r, c } = parse(a);
  return page.evaluate(([r, c]) => {
    const g = window.__app.ctrl.grid;
    g.scrollIntoView(r, c);
    g.render();
    const b = g.cellBox(r, c);
    const area = document.getElementById('grid-area').getBoundingClientRect();
    return { x: area.left + b.left + b.width / 2, y: area.top + b.top + b.height / 2 };
  }, [r, c]);
}

export async function clickCell(page, a, opts) {
  const p = await cellPoint(page, a);
  await page.mouse.click(p.x, p.y, opts);
}

export async function tapCell(page, a) {
  const p = await cellPoint(page, a);
  await page.touchscreen.tap(p.x, p.y);
}

// Long press with real touch events (Playwright has no built-in long press).
export async function longPress(page, x, y, ms = 700) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export async function typeInto(page, a, text) {
  await clickCell(page, a);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

export const cell = (page, a) => page.locator(`.cells [data-addr="${a}"]`);

export async function expectNoProblems(problems) {
  expect(problems, 'no errors in the page').toEqual([]);
}

// Wait for the next rendered frame (the grid repaints in requestAnimationFrame).
export function frame(page) {
  return page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
