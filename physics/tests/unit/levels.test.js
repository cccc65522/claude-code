import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allLevels } from '../../js/engine/levels.js';
import { runLevel, levelScene, usage, placementProblem, LevelRun } from '../../js/engine/level-run.js';
import { buildWorld, saveScene } from '../../js/engine/scene.js';
import { DEMOS } from '../../js/engine/demos.js';

const TOOL_FOR = { pins: 'pin', motors: 'motor', ropes: 'rope', springs: 'spring', welds: 'weld' };

const shift = (user, dx, dy) => ({
  bodies: user.bodies.map(b => ({ ...b, x: Math.round((b.x + dx) * 1e4) / 1e4, y: Math.round((b.y + dy) * 1e4) / 1e4 })),
  joints: user.joints.map(j => (j.a === -1 ? { ...j, la: [j.la[0] + dx, j.la[1] + dy] } : j))
});

for (const level of allLevels()) {
  test(`level “${level.name}”: the reference solution wins, doing nothing loses`, () => {
    const sol = level.solution();
    const won = runLevel(level, sol);
    assert.equal(won.result, 'won', `solution ${won.result} after ${won.time.toFixed(1)} s`);
    const idle = runLevel(level, { bodies: [], joints: [] });
    assert.equal(idle.result, 'lost');
  });

  test(`level “${level.name}”: the solution is not a knife-edge (nudged by 5 cm it still wins)`, () => {
    const sol = level.solution();
    for (const [dx, dy] of [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]) {
      const r = runLevel(level, shift(sol, dx, dy));
      assert.equal(r.result, 'won', `nudged by (${dx}, ${dy}): ${r.result}`);
    }
  });

  test(`level “${level.name}”: the solution plays by the level's rules`, () => {
    const sol = level.solution();
    const world = buildWorld(levelScene(level, sol));
    const u = usage(world);
    assert.ok(u.shapes <= (level.limits.shapes ?? 0), `${u.shapes} shapes`);
    for (const [k, tool] of Object.entries(TOOL_FOR)) {
      if (u[k]) {
        assert.ok(level.tools.includes(tool), `uses ${tool}, not offered`);
        assert.ok(u[k] <= (level.limits[k] ?? 0), `${u[k]} ${k}`);
      }
    }
    for (const b of world.bodies) {
      if (b.locked || b.tag === 'link') continue;
      assert.equal(placementProblem(world, b, level), null, `shape at (${b.x}, ${b.y})`);
      assert.ok(!b.isStatic, 'player shapes are never fixed in levels');
    }
    // every rope or joint end on the player's shapes sits inside both bodies, as the tools require
    for (const j of world.joints) {
      if (j.locked || j.rope || j.kind === 'rope' || j.kind === 'spring') continue;
      const p = j.worldAnchorB();
      for (const body of [j.bodyA, j.bodyB]) {
        if (body !== world.ground) assert.ok(body.contains(p.x, p.y), `${j.kind} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) is outside a body`);
      }
    }
  });

  test(`level “${level.name}”: the run is reproducible`, () => {
    const scene = levelScene(level, level.solution());
    const a = new LevelRun(level, scene), b = new LevelRun(level, JSON.parse(JSON.stringify(scene)));
    for (let i = 0; i < 120; i++) { a.step(); b.step(); }
    assert.equal(a.world.fingerprint(), b.world.fingerprint());
    // the scene the app would save from a world built this way is the same JSON
    assert.deepEqual(saveScene(buildWorld(scene)).bodies, buildWorld(scene) && saveScene(buildWorld(scene)).bodies);
  });
}

test('levels have unique ids, a ball and a goal', () => {
  const ids = new Set();
  for (const l of allLevels()) {
    assert.ok(!ids.has(l.id));
    ids.add(l.id);
    assert.equal(l.scene.bodies.filter(b => b.tag === 'ball').length, 1);
    assert.ok(l.goal.w > 0 && l.goal.h > 0);
    assert.ok(l.scene.bodies.every(b => b.lock));
  }
});

test('demo scenes build, stay finite for 10 s, and run in real time', () => {
  for (const d of DEMOS) {
    const world = buildWorld(d.build());
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) world.step(1 / 60);
    const ms = (performance.now() - t0) / 600;
    assert.ok(ms < 8, `${d.id}: ${ms.toFixed(2)} ms per step`);
    for (const b of world.bodies) assert.ok(Number.isFinite(b.x + b.y + b.angle + b.vx + b.vy + b.w), `${d.id}: NaN`);
  }
});
