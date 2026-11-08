import { test, expect } from '@playwright/test';
import { trackErrors, expectNoProblems, open, setView, tool, drag, click, path, bodyCount, jointCount, lastBody, fastForward, toPage } from './helpers.js';
import { buildWorld } from '../../js/engine/scene.js';
import { demo, DEMOS } from '../../js/engine/demos.js';
import { allLevels } from '../../js/engine/levels.js';
import { levelScene, LevelRun, canonical } from '../../js/engine/level-run.js';

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'mouse tests');
});

const VIEW = { x: 0, y: 4, scale: 50 };

test('first visit opens the wrecking-ball demo, and it plays', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page, 'fresh');
  expect(await bodyCount(page)).toBeGreaterThan(90);
  await expect(page.locator('#play')).toHaveAccessibleName('播放');
  const before = await page.evaluate(() => window.__zw.app.world.fingerprint());
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveAccessibleName('暂停');
  await page.waitForTimeout(500);
  await page.locator('#play').click();
  const after = await page.evaluate(() => window.__zw.app.world.fingerprint());
  expect(after).not.toBe(before);
  // reset puts every body back where it started
  await page.locator('[data-cmd="reset"]').click();
  expect(await page.evaluate(() => window.__zw.app.world.fingerprint())).toBe(before);
  expectNoProblems(problems);
});

test('box tool: drag a box, it falls and comes to rest on the floor', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'box');
  await drag(page, [[-1, 6], [1, 4.8]]);
  expect(await bodyCount(page)).toBe(2);
  let b = await lastBody(page);
  expect(b.shape).toBe('box');
  expect(b.y).toBeCloseTo(5.4, 1);
  await fastForward(page, 180);
  b = await lastBody(page);
  expect(b.y).toBeCloseTo(0.6, 1);
  expect(b.awake).toBe(false);
  expectNoProblems(problems);
});

test('pen: a closed loop becomes a solid shape, an open stroke a line; materials and fixed apply', async ({ page }) => {
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'draw');
  await page.locator('#matbar [data-mat="rubber"]').click();
  const loop = [];
  for (let i = 0; i <= 40; i++) loop.push([-3 + 1.2 * Math.cos(i / 40 * 2 * Math.PI), 5 + Math.sin(i / 40 * 2 * Math.PI) * (i % 4 < 2 ? 1.2 : 0.7)]);
  await drag(page, loop, 2);
  let b = await lastBody(page);
  expect(b.shape).toBe('poly');
  expect(b.mat).toBe('rubber');
  await page.locator('#matbar .fixed-toggle').click();
  await drag(page, path([[1, 3], [3, 4], [5, 3]]), 2);
  b = await lastBody(page);
  expect(b.shape).toBe('line');
  expect(b.fixed).toBe(true);
  expect(await bodyCount(page)).toBe(3);
});

test('circle tool: tap for a ball, drag for a size', async ({ page }) => {
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'circle');
  await click(page, 0, 5);
  expect(await page.evaluate(() => window.__zw.app.world.bodies.at(-1).shapeSpec.r)).toBe(0.5);
  await drag(page, [[3, 5], [4.2, 5]]);
  expect(await page.evaluate(() => window.__zw.app.world.bodies.at(-1).shapeSpec.r)).toBeCloseTo(1.2, 1);
});

test('pin a plank to the background: it swings around the pin', async ({ page }) => {
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'box');
  await drag(page, [[-2, 5.15], [2, 4.85]]);
  await tool(page, 'pin');
  await click(page, -1.8, 5);
  expect(await jointCount(page)).toBe(1);
  await fastForward(page, 60);
  const b = await lastBody(page);
  expect(Math.abs(b.angle)).toBeGreaterThan(0.5); // swung down
  const anchor = await page.evaluate(() => window.__zw.app.world.joints[0].worldAnchorB());
  expect(anchor.x).toBeCloseTo(-1.8, 1);
  expect(anchor.y).toBeCloseTo(5, 1);
});

test('motor tool spins a wheel; the inspector changes its speed and direction', async ({ page }) => {
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'circle');
  await drag(page, [[0, 5], [0.8, 5]]);
  await tool(page, 'motor');
  await click(page, 0, 5);
  await fastForward(page, 60);
  const w = await page.evaluate(() => window.__zw.app.world.bodies.at(-1).w);
  expect(w).toBeCloseTo(-6, 1);
  await page.locator('#play').click(); // pause
  await tool(page, 'hand');
  await click(page, 0, 5); // selects the motor glyph at the wheel centre
  await expect(page.locator('#inspector h3')).toContainText('马达');
  await page.locator('#inspector button', { hasText: '改成逆时针' }).click();
  expect(await page.evaluate(() => window.__zw.app.world.joints[0].motorSpeed)).toBeCloseTo(6, 5);
});

test('spring and rope tools; the eraser cuts a rope', async ({ page }) => {
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'box');
  await drag(page, [[-3.5, 3.5], [-2.5, 2.5]]);
  await drag(page, [[2.5, 3.5], [3.5, 2.5]]);
  await tool(page, 'spring');
  await drag(page, [[-3, 6.5], [-3, 3]]);
  expect(await page.evaluate(() => window.__zw.app.world.joints.at(-1).kind)).toBe('spring');
  await tool(page, 'rope');
  await drag(page, [[3, 7], [3, 3]]);
  const links = await page.evaluate(() => window.__zw.app.world.bodies.filter(b => b.tag === 'link').length);
  expect(links).toBeGreaterThan(8);
  expect(await page.evaluate(() => window.__zw.app.world.joints.some(j => j.kind === 'rope'))).toBe(true);
  await fastForward(page, 120);
  // both boxes hang
  const ys = await page.evaluate(() => window.__zw.app.world.bodies.slice(1, 3).map(b => b.y));
  expect(ys[0]).toBeGreaterThan(1.5);
  expect(ys[1]).toBeGreaterThan(1.5);
  await page.locator('#play').click();
  await tool(page, 'eraser');
  const mid = await page.evaluate(() => { const l = window.__zw.app.world.bodies.filter(b => b.tag === 'link')[5]; return [l.x, l.y]; });
  await click(page, ...mid);
  expect(await page.evaluate(() => window.__zw.app.world.joints.some(j => j.kind === 'rope'))).toBe(false);
  await fastForward(page, 120);
  const y = await page.evaluate(() => window.__zw.app.world.bodies[2].y);
  expect(y).toBeLessThan(0.6); // the cut box fell to the floor
});

test('undo and redo, also with the keyboard', async ({ page }) => {
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'circle');
  await click(page, 0, 5);
  await click(page, 2, 5);
  expect(await bodyCount(page)).toBe(3);
  await page.locator('[data-cmd="undo"]:visible').click();
  expect(await bodyCount(page)).toBe(2);
  await page.keyboard.press('Control+z');
  expect(await bodyCount(page)).toBe(1);
  await page.keyboard.press('Control+Shift+z');
  expect(await bodyCount(page)).toBe(2);
  await page.locator('[data-cmd="redo"]:visible').click();
  expect(await bodyCount(page)).toBe(3);
});

test('drag a body while the simulation runs, move one while paused', async ({ page }) => {
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'box');
  await click(page, 0, 0.5);
  await tool(page, 'hand');
  await drag(page, [[0, 0.5], [3, 0.6]]); // paused: moves it
  let b = await lastBody(page);
  expect(b.x).toBeCloseTo(3, 1);
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  const p0 = await toPage(page, 3, 0.5), p1 = await toPage(page, 3, 4);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 5 });
  await page.waitForTimeout(600);
  b = await lastBody(page);
  expect(b.y).toBeGreaterThan(2.5); // lifted by the mouse spring
  await page.mouse.up();
  await page.keyboard.press('Space');
});

test('rewind: scrubbing back restores an earlier moment', async ({ page }) => {
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'circle');
  await click(page, 0, 8);
  // step by hand (not in real time) and remember where the ball was at one moment
  const mid = await page.evaluate(() => {
    const { app } = window.__zw;
    app.play();
    app.running = false;
    let mid = null;
    for (let i = 1; i <= 100; i++) {
      app.stepOnce();
      if (i === 41) { const b = app.world.bodies.at(-1); mid = { t: app.world.time, y: b.y }; } // frames are kept every other step
    }
    app.updateChrome();
    return mid;
  });
  await expect(page.locator('#timeline')).toBeVisible();
  const idx = await page.evaluate(t => window.__zw.app.recorder.times.findIndex(x => Math.abs(x - t) < 1e-9), mid.t);
  expect(idx).toBeGreaterThan(0);
  await page.locator('#scrub').evaluate((el, i) => { el.value = String(i); el.dispatchEvent(new Event('input', { bubbles: true })); }, idx);
  const back = await lastBody(page);
  expect(back.y).toBeCloseTo(mid.y, 4);
  await expect(page.locator('#scrub-time')).toContainText('秒');
  // playing on from the past drops the future
  await page.locator('#play').click();
  await page.locator('#play').click();
  expect(await page.evaluate(() => window.__zw.app.recorder.length)).toBeLessThan(idx + 40);
});

test('share link opens the same scene in a new page', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'box');
  await drag(page, [[-1, 3], [1, 2]]);
  await tool(page, 'circle');
  await click(page, 3, 4);
  await page.locator('[data-cmd="menu"]').click();
  await page.getByRole('menuitem', { name: '分享链接' }).click();
  const url = await page.locator('.share-link').textContent();
  expect(url).toContain('#s=');
  const want = await page.evaluate(() => JSON.stringify(window.__zw.app.world.bodies.map(b => [b.shapeSpec.t, Math.round(b.x * 100), Math.round(b.y * 100)])));
  const other = await context.newPage();
  await other.goto(url);
  await other.waitForFunction(() => window.__zw && window.__zw.app.world.bodies.length === 3);
  const got = await other.evaluate(() => JSON.stringify(window.__zw.app.world.bodies.map(b => [b.shapeSpec.t, Math.round(b.x * 100), Math.round(b.y * 100)])));
  expect(got).toBe(want);
});

test('the canvas is saved and comes back after a reload', async ({ page }) => {
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'box');
  await drag(page, [[-1, 3], [1, 2]]);
  await page.evaluate(() => window.__zw.app.saveNow());
  await page.goto('/');
  await page.waitForFunction(() => window.__zw && window.__zw.app.world);
  expect(await bodyCount(page)).toBe(2);
});

test('every demo loads from the scenes dialog and runs', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  await page.locator('[data-cmd="scenes"]').click();
  await expect(page.locator('.card')).toHaveCount(DEMOS.length);
  await page.locator('.card', { hasText: '高尔顿板' }).click();
  expect(await bodyCount(page)).toBeGreaterThan(300);
  await fastForward(page, 120);
  expectNoProblems(problems);
});

test('the browser simulates bit-for-bit like Node', async ({ page }) => {
  await open(page);
  const scene = demo('mixer').build();
  const nodeWorld = buildWorld(scene);
  for (let i = 0; i < 240; i++) nodeWorld.step(1 / 60);
  const browser = await page.evaluate(async scene => {
    const { buildWorld } = await import('/js/engine/scene.js');
    const w = buildWorld(scene);
    for (let i = 0; i < 240; i++) w.step(1 / 60);
    return w.fingerprint();
  }, scene);
  expect(browser).toBe(nodeWorld.fingerprint());
});

test('level 1: draw a bridge with the mouse and win', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page, 'fresh&level=bridge');
  await expect(page.locator('#level-hud')).toBeVisible();
  await expect(page.locator('#hud-name')).toContainText('搭桥');
  // drawing in the hatched area is refused
  await tool(page, 'box');
  await drag(page, [[-8, 7], [-7, 6]]);
  await expect(page.locator('#toast')).toContainText('斜线');
  expect(await bodyCount(page)).toBe(3);
  await tool(page, 'draw');
  await drag(page, path([[-2.6, 2.3], [2.2, 2.3]], 10), 2);
  expect(await bodyCount(page)).toBe(4);
  await expect(page.locator('#hud-usage')).toContainText('形状 1/2');
  await page.locator('#play').click(); // 开始
  await expect(page.getByRole('dialog', { name: '过关：搭桥' })).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zaowu:progress')).bridge.done)).toBe(true);
  expectNoProblems(problems);
});

test('a failed level run goes back to the editing state', async ({ page }) => {
  await open(page, 'fresh&level=bridge');
  await page.locator('#play').click();
  await expect(page.locator('#toast')).toContainText('没成功', { timeout: 10000 });
  await expect(page.locator('#play')).toHaveAccessibleName('开始', { timeout: 5000 });
  expect(await page.evaluate(() => window.__zw.app.world.bodies.find(b => b.tag === 'ball').y)).toBeGreaterThan(5);
});

test('in the browser, every level’s answer wins exactly as in Node', async ({ page }) => {
  await open(page);
  for (const lvl of allLevels()) {
    const nodeRun = new LevelRun(lvl, canonical(levelScene(lvl, lvl.solution())));
    const r = nodeRun.run();
    const got = await page.evaluate(async id => {
      const { app } = window.__zw;
      app.enterLevel(id);
      const { level } = app;
      const { levelScene } = await import('/js/engine/level-run.js');
      const { buildWorld } = await import('/js/engine/scene.js');
      app.setWorld(buildWorld(levelScene(level, level.solution())));
      app.levelStart();
      app.running = false; // step by hand, not in real time
      let result = null;
      while (!result) result = app.levelRun.step();
      const steps = app.levelRun.steps, fp = app.world.fingerprint();
      app.levelStop();
      return { result, steps, fp };
    }, lvl.id);
    expect(got.result, lvl.name).toBe('won');
    expect(got.steps, lvl.name).toBe(Math.round(r.time * 60));
    expect(got.fp, lvl.name).toBe(r.world.fingerprint());
  }
});

test('level answer button and level select', async ({ page }) => {
  await open(page, 'fresh&level=nails');
  await page.locator('[data-cmd="level-hint"]').click();
  await page.getByRole('button', { name: '看答案' }).last().click();
  await expect(page.locator('#hud-usage')).toContainText('形状 1/1');
  await expect(page.locator('#hud-usage')).toContainText('钉子 2/2');
  await page.locator('#play').click();
  await expect(page.getByRole('dialog', { name: '过关：钉住' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '下一关' }).click();
  await expect(page.locator('#hud-name')).toContainText('造车');
  await page.locator('[data-cmd="levels"]').click();
  await expect(page.locator('.card .badge')).toHaveCount(1);
  await page.locator('[data-close]').click();
  await page.locator('[data-cmd="level-exit"]').click();
  await expect(page.locator('#level-hud')).toBeHidden();
});

test('water: pour into a cup while paused, it settles when played; erase and undo', async ({ page }) => {
  const problems = trackErrors(page);
  await open(page);
  await setView(page, VIEW);
  await tool(page, 'draw');
  await page.locator('#matbar .fixed-toggle').click();
  await drag(page, path([[-2, 4.5], [-2, 1], [2, 1], [2, 4.5]], 8), 2);
  await tool(page, 'water');
  await drag(page, path([[-1.4, 3], [1.4, 3], [1.4, 3.6], [-1.4, 3.6]], 12), 2);
  const n = await page.evaluate(() => window.__zw.app.world.fluid.n);
  expect(n).toBeGreaterThan(40);
  await expect(page.locator('#toolbar [data-tool="water"]')).toHaveAttribute('aria-pressed', 'true');
  await fastForward(page, 150);
  const inCup = await page.evaluate(() => {
    const f = window.__zw.app.world.fluid;
    let inside = 0;
    for (let i = 0; i < f.n; i++) if (f.x[i] > -2 && f.x[i] < 2 && f.y[i] > 1 && f.y[i] < 2.6) inside++;
    return inside / f.n;
  });
  expect(inCup).toBeGreaterThan(0.95);
  await page.locator('#play').click();
  await tool(page, 'eraser');
  await click(page, 0, 1.3);
  const after = await page.evaluate(() => window.__zw.app.world.fluid.n);
  expect(after).toBeLessThan(n);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__zw.app.world.fluid.n)).toBe(n);
  expectNoProblems(problems);
});
