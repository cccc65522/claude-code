import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneBuilder } from '../../js/engine/build.js';
import { buildWorld, saveScene } from '../../js/engine/scene.js';
import { WATER } from '../../js/engine/fluid.js';
import { run } from './helpers.js';

// A 6 m wide tank with water 2 m deep, and optional boxes dropped in.
function tank(materials = []) {
  const b = new SceneBuilder();
  b.box(0, -0.5, 20, 1, { m: 'stone', fixed: true });
  b.box(-3.2, 3, 0.4, 6, { m: 'stone', fixed: true });
  b.box(3.2, 3, 0.4, 6, { m: 'stone', fixed: true });
  const ids = materials.map((m, k) => b.box(-1.5 + k * 1.5, 3.5, 1, 1, { m }));
  const world = buildWorld(b.scene());
  world.fluid.addBlock(-3, 0, 3, 2);
  return { world, boxes: ids.map(i => world.bodies[i]) };
}

const surface = f => {
  const ys = Array.from(f.y.subarray(0, f.n)).sort((a, b) => b - a);
  return ys[Math.floor(f.n * 0.02)];
};

test('a block of water settles in a tank: stays inside, keeps its volume, comes to rest', () => {
  const { world } = tank();
  const f = world.fluid, n = f.n;
  const before = surface(f);
  run(world, 8);
  assert.equal(f.n, n);
  for (let i = 0; i < f.n; i++) {
    assert.ok(f.x[i] > -3 && f.x[i] < 3 && f.y[i] > 0, `particle ${i} escaped to (${f.x[i]}, ${f.y[i]})`);
  }
  const after = surface(f);
  assert.ok(after > before * 0.85 && after < before * 1.05, `surface ${before.toFixed(2)} → ${after.toFixed(2)}`);
  let fast = 0;
  for (let i = 0; i < f.n; i++) if (f.vx[i] * f.vx[i] + f.vy[i] * f.vy[i] > 0.3 * 0.3) fast++;
  assert.ok(fast < f.n * 0.05, `${fast} particles still moving`);
});

test('buoyancy: wood floats about 60% under, stone and metal sink', () => {
  const { world, boxes: [wood, stone, metal] } = tank(['wood', 'stone', 'metal']);
  run(world, 10);
  const level = surface(world.fluid);
  const under = (level - (wood.y - 0.5)) / 1; // submerged fraction of a 1 m box
  assert.ok(under > 0.45 && under < 0.8, `wood ${(under * 100).toFixed(0)}% under water`);
  assert.ok(stone.y < 0.9 && metal.y < 0.9, `stone ${stone.y.toFixed(2)}, metal ${metal.y.toFixed(2)}`);
});

test('water pours through a gap and flows downhill', () => {
  const b = new SceneBuilder();
  b.box(0, -0.5, 30, 1, { m: 'stone', fixed: true });
  b.line([[-6, 6], [-6, 3], [-2.3, 3]], 0.2, { fixed: true });
  b.line([[-1.7, 3], [-1.7, 6]], 0.2, { fixed: true });
  const world = buildWorld(b.scene());
  world.fluid.addBlock(-5.9, 3.1, -1.8, 5);
  const n = world.fluid.n;
  run(world, 6);
  let below = 0;
  for (let i = 0; i < world.fluid.n; i++) if (world.fluid.y[i] < 2.8) below++;
  assert.ok(below > n * 0.5, `${below} of ${n} particles drained`);
});

test('water is deterministic and survives save → load', () => {
  const a = tank(['wood']).world, b = tank(['wood']).world;
  run(a, 3);
  run(b, 3);
  assert.equal(a.fingerprint(), b.fingerprint());
  const mid = saveScene(a);
  assert.equal(mid.water.length, a.fluid.n * 4);
  const c = buildWorld(mid), d = buildWorld(JSON.parse(JSON.stringify(mid)));
  assert.equal(c.fluid.n, a.fluid.n);
  run(c, 2);
  run(d, 2);
  assert.equal(c.fingerprint(), d.fingerprint());
});

test('explosions splash water; particles can be erased; the budget is enforced', () => {
  const { world } = tank();
  run(world, 1);
  world.explode(0, 0.5, 2, 10);
  let up = 0;
  for (let i = 0; i < world.fluid.n; i++) if (world.fluid.vy[i] > 2) up++;
  assert.ok(up > 20);
  const n = world.fluid.n;
  const removed = world.fluid.removeInCircle(0, 1, 0.5);
  assert.ok(removed > 10 && world.fluid.n === n - removed);
  world.fluid.clear();
  let added = 0;
  while (world.fluid.add(0, 10)) added++;
  assert.equal(added, WATER.max);
});
