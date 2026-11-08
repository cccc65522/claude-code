import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompose, triangulate, signedArea, isConvex, isSimple, strokeToShape, simplify, centroid } from '../../js/engine/geometry.js';
import { polygon } from '../../js/engine/shapes.js';
import { rng } from '../../js/engine/math.js';
import { buildWorld, saveScene, shapesFor, addBody } from '../../js/engine/scene.js';
import { World } from '../../js/engine/world.js';
import { run } from './helpers.js';

const P = arr => arr.map(([x, y]) => ({ x, y }));

function checkDecomposition(pts, label) {
  const area = Math.abs(signedArea(pts));
  const parts = decompose(pts);
  let sum = 0;
  for (const part of parts) {
    assert.ok(part.length >= 3 && part.length <= 8, `${label}: piece with ${part.length} vertices`);
    assert.ok(isConvex(part, 1e-9), `${label}: concave piece`);
    const a = signedArea(part);
    assert.ok(a > 0, `${label}: piece not counter-clockwise`);
    sum += a;
    assert.ok(polygon(part), `${label}: piece rejected by the physics polygon`);
  }
  assert.ok(Math.abs(sum - area) < 1e-9 * Math.max(1, area), `${label}: pieces cover ${sum}, outline ${area}`);
  return parts;
}

test('convex outlines stay in one piece, concave ones are split into convex pieces', () => {
  assert.equal(checkDecomposition(P([[0, 0], [2, 0], [2, 1], [0, 1]]), 'box').length, 1);
  assert.equal(checkDecomposition(P([[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]), 'L').length, 2);
  checkDecomposition(P([[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]]), 'U');
  const star = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.4 : 1, a = i / 10 * 2 * Math.PI;
    star.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  assert.ok(checkDecomposition(star, 'star').length >= 4); // at least ⌈reflex / 2⌉ + 1
  // a clockwise outline is accepted too
  checkDecomposition(P([[0, 0], [0, 3], [1, 3], [1, 1], [3, 1], [3, 0]]), 'L clockwise');
  // a big circle-like outline is cut into ≤ 8-vertex pieces
  const round = [];
  for (let i = 0; i < 40; i++) round.push({ x: Math.cos(i / 40 * 2 * Math.PI), y: Math.sin(i / 40 * 2 * Math.PI) });
  assert.ok(checkDecomposition(round, 'round').length >= 6);
});

test('random simple outlines (300 of them) decompose exactly', () => {
  const R = rng(5);
  for (let k = 0; k < 300; k++) {
    const n = 5 + Math.floor(R() * 30);
    const angles = [];
    for (let i = 0; i < n; i++) angles.push(R() * 2 * Math.PI);
    angles.sort((a, b) => a - b);
    const pts = angles.map(a => {
      const r = 0.3 + R() * 2;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
    if (!isSimple(pts) || Math.abs(signedArea(pts)) < 0.05) continue;
    checkDecomposition(pts, `random #${k}`);
    const tris = triangulate(signedArea(pts) > 0 ? pts : pts.slice().reverse());
    assert.equal(tris.length, n - 2, `random #${k}: ${tris.length} triangles for ${n} points`);
  }
});

test('self-intersection test', () => {
  assert.ok(isSimple(P([[0, 0], [1, 0], [1, 1], [0, 1]])));
  assert.ok(!isSimple(P([[0, 0], [1, 1], [1, 0], [0, 1]]))); // bow tie
});

test('strokes: closed loops become polygons, open strokes lines, scribbles hulls, dots nothing', () => {
  const loop = [];
  for (let i = 0; i <= 60; i++) loop.push({ x: Math.cos(i / 60 * 2 * Math.PI), y: Math.sin(i / 60 * 2 * Math.PI) });
  const a = strokeToShape(loop);
  assert.equal(a.kind, 'poly');
  assert.ok(a.pts.length >= 8 && a.pts.length <= 40);
  assert.ok(signedArea(a.pts) > 2.9);

  const line = [];
  for (let i = 0; i <= 50; i++) line.push({ x: i * 0.1, y: Math.sin(i * 0.1) * 0.5 });
  const b = strokeToShape(line);
  assert.equal(b.kind, 'line');
  assert.ok(b.pts.length >= 3 && b.pts.length < 20);

  const eight = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80 * 2 * Math.PI;
    eight.push({ x: Math.sin(t), y: Math.sin(t) * Math.cos(t) });
  }
  const c = strokeToShape(eight);
  assert.equal(c.kind, 'poly');
  assert.ok(c.hull);

  assert.equal(strokeToShape([{ x: 0, y: 0 }, { x: 0.01, y: 0.01 }]), null);
});

test('simplify keeps corners and drops noise', () => {
  const pts = [];
  for (let i = 0; i <= 20; i++) pts.push({ x: i / 10, y: (i % 2) * 0.001 });
  for (let i = 1; i <= 20; i++) pts.push({ x: 2, y: i / 10 });
  const s = simplify(pts, 0.01);
  assert.equal(s.length, 3);
  assert.deepEqual(s[1], { x: 2, y: 0 });
});

test('centroid of a polygon', () => {
  const c = centroid(P([[0, 0], [4, 0], [4, 2], [0, 2]]));
  assert.ok(Math.abs(c.x - 2) < 1e-12 && Math.abs(c.y - 1) < 1e-12);
});

test('line shapes are boxes with round joints', () => {
  const shapes = shapesFor({ t: 'line', pts: [0, 0, 1, 0, 1, 1], w: 0.2 });
  assert.equal(shapes.filter(s => s.type === 'poly').length, 2);
  assert.equal(shapes.filter(s => s.type === 'circle').length, 3);
});

const SCENE = {
  v: 1,
  g: [0, -10],
  bodies: [
    { shape: { t: 'box', w: 40, h: 1 }, x: 0, y: -0.5, a: 0, m: 'stone', fixed: true },
    { shape: { t: 'box', w: 1, h: 1 }, x: 0, y: 3, a: 0.3, m: 'wood' },
    { shape: { t: 'circle', r: 0.4 }, x: 1, y: 5, a: 0, m: 'rubber', v: [1, 0] },
    { shape: { t: 'poly', pts: [0, 0, 2, 0, 2, 0.5, 0.5, 0.5, 0.5, 2, 0, 2] }, x: -3, y: 2, a: 0, m: 'metal' },
    { shape: { t: 'line', pts: [-1, 0, 0, 0.2, 1, 0], w: 0.2 }, x: 3, y: 4, a: 0, m: 'ice' },
    { shape: { t: 'box', w: 2, h: 0.2 }, x: 3, y: 6, a: 0, m: 'wood' },
    { shape: { t: 'circle', r: 0.3 }, x: 3.9, y: 6, a: 0, m: 'balloon' }
  ],
  joints: [
    { t: 'pin', a: -1, b: 5, la: [2, 6], lb: [-1, 0], ref: 0, motor: { s: 2, t: 30 } },
    { t: 'spring', a: 1, b: 2, la: [0, 0.5], lb: [0, 0], len: 2, hz: 2, z: 0.2 },
    { t: 'weld', a: 5, b: 6, la: [0.9, 0], lb: [0, 0], ref: 0 }
  ]
};

test('scenes survive save → load → save unchanged', () => {
  const world = buildWorld(SCENE);
  assert.equal(world.bodies.length, 7);
  assert.equal(world.joints.length, 3);
  const saved = saveScene(world);
  const again = saveScene(buildWorld(saved));
  assert.deepEqual(again, saved);
  assert.deepEqual(saved.bodies[1], SCENE.bodies[1]);
  assert.deepEqual(saved.joints[0], SCENE.joints[0]);
});

test('a run is a pure function of the scene JSON', () => {
  const a = buildWorld(SCENE), b = buildWorld(JSON.parse(JSON.stringify(SCENE)));
  run(a, 4);
  run(b, 4);
  assert.equal(a.fingerprint(), b.fingerprint());
  // and a mid-run save restarts identically too
  const mid = saveScene(a);
  const c = buildWorld(mid), d = buildWorld(mid);
  run(c, 2);
  run(d, 2);
  assert.equal(c.fingerprint(), d.fingerprint());
});

test('balloons float up, metal sinks', () => {
  const world = new World();
  const balloon = addBody(world, { shape: { t: 'circle', r: 0.5 }, x: 0, y: 0, m: 'balloon' });
  const metal = addBody(world, { shape: { t: 'circle', r: 0.5 }, x: 3, y: 0, m: 'metal' });
  run(world, 1);
  assert.ok(balloon.y > 3 && metal.y < -4);
});
