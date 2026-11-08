import { expect } from '@playwright/test';

export function trackErrors(page) {
  const problems = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  return problems;
}

export async function open(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__xq);
  await page.evaluate(() => localStorage.clear());
}

// Start a game directly (faster than clicking through the dialog).
export async function start(page, opts) {
  await page.evaluate(o => window.__xq.startGame(o), opts);
}

// Page coordinates of board point (x, y) in board terms (x 0..8 from Red's left, y 0..9 from Black's side).
export function point(page, x, y) {
  return page.evaluate(([x, y]) => {
    const { board } = window.__xq;
    const r = document.getElementById('board').getBoundingClientRect();
    const dx = board.flipped ? 8 - x : x, dy = board.flipped ? 9 - y : y;
    return { x: r.left + (r.width * (0.6 + dx)) / 9.2, y: r.top + (r.height * (0.6 + dy)) / 10.2 };
  }, [x, y]);
}

// ICCS square like "h2" -> board x, y.
export function iccs(sq) {
  return ['abcdefghi'.indexOf(sq[0]), 9 - Number(sq[1])];
}

export async function clickMove(page, from, to, { touch = false } = {}) {
  for (const s of [from, to]) {
    const p = await point(page, ...iccs(s));
    if (touch) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
  }
}

export const plies = page => page.evaluate(() => window.__xq.app.game.records.length);
export const movetext = page => page.evaluate(() => window.__xq.app.game.movetext());

export async function waitPlies(page, n, timeout = 20000) {
  await page.waitForFunction(k => window.__xq.app.game.records.length >= k && !window.__xq.app.thinking, n, { timeout });
}

export function expectNoProblems(problems) {
  expect(problems, 'no errors in the page').toEqual([]);
}

// The move (as ICCS from/to) that mates right now, found from the app's own rules engine.
export function mateInOne(page) {
  return page.evaluate(() => {
    const pos = window.__xq.app.game.pos;
    for (const m of pos.legalMoves()) {
      pos.makeMove(m);
      const mated = pos.legalMoves().length === 0;
      pos.undoMove();
      if (mated) {
        const f = s => 'abcdefghi'[(s & 15) - 3] + (9 - ((s >> 4) - 3));
        return [f(m & 255), f(m >> 8)];
      }
    }
    return null;
  });
}
