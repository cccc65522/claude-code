import { expect } from '@playwright/test';

export function trackErrors(page) {
  const problems = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  return problems;
}

export function expectNoProblems(problems) {
  expect(problems, 'no errors in the page').toEqual([]);
}

export async function open(page, query = 'fresh&blank') {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__zw && window.__zw.app.world);
}

// Page coordinates of a world point.
export function toPage(page, x, y) {
  return page.evaluate(([x, y]) => {
    const { app } = window.__zw;
    const r = app.canvas.getBoundingClientRect();
    const p = app.camera.toScreen(x, y);
    return { x: r.left + p.x, y: r.top + p.y };
  }, [x, y]);
}

export async function setView(page, view) {
  await page.evaluate(v => { const { app } = window.__zw; Object.assign(app.camera, v); app.invalidate(); }, view);
}

export async function tool(page, id) {
  await page.locator(`.tool[data-tool="${id}"]`).click();
}

// Mouse drag through world points.
export async function drag(page, points, steps = 4) {
  const pts = [];
  for (const [x, y] of points) pts.push(await toPage(page, x, y));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i].x, pts[i].y, { steps });
  await page.mouse.up();
}

export async function click(page, x, y) {
  const p = await toPage(page, x, y);
  await page.mouse.click(p.x, p.y);
}

// Real touch events through the DevTools protocol (Playwright's touchscreen can only tap).
export async function touch(page, strokes) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  for (const stroke of strokes) {
    const pts = [];
    for (const [x, y] of stroke) pts.push(await toPage(page, x, y));
    frames.push(pts);
  }
  const n = Math.max(...frames.map(f => f.length));
  const at = i => frames.map((f, id) => ({ x: f[Math.min(i, f.length - 1)].x, y: f[Math.min(i, f.length - 1)].y, id }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i < n; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

// Interpolated polyline (so drags have many intermediate points).
export function path(points, per = 6) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    for (let k = 1; k <= per; k++) out.push([ax + (bx - ax) * k / per, ay + (by - ay) * k / per]);
  }
  return out;
}

export const bodyCount = page => page.evaluate(() => window.__zw.app.world.bodies.length);
export const jointCount = page => page.evaluate(() => window.__zw.app.world.joints.length);
export const lastBody = page => page.evaluate(() => {
  const b = window.__zw.app.world.bodies.at(-1);
  return { x: b.x, y: b.y, angle: b.angle, shape: b.shapeSpec.t, mat: b.mat, fixed: b.isStatic, awake: b.awake };
});

// Run the simulation for n fixed steps without waiting for real time.
export function fastForward(page, n) {
  return page.evaluate(n => {
    const { app } = window.__zw;
    if (!app.running) app.play();
    for (let i = 0; i < n && (app.running || app.levelPhase === 'run'); i++) app.stepOnce();
    app.invalidate();
  }, n);
}
