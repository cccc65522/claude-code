import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosSin, rng } from '../../js/engine/math.js';
import { box, circle, polygon, polygonMass, circleMass, convexHull, LINEAR_SLOP } from '../../js/engine/shapes.js';
import { DynamicTree } from '../../js/engine/tree.js';
import { collide, newManifold } from '../../js/engine/collide.js';
import { World } from '../../js/engine/world.js';
import { groundWorld, run, close } from './helpers.js';

test('cosSin agrees with Math.sin/cos', () => {
  const R = rng(7), out = {};
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const a = (R() - 0.5) * 20;
    cosSin(a, out);
    worst = Math.max(worst, Math.abs(out.c - Math.cos(a)), Math.abs(out.s - Math.sin(a)));
  }
  assert.ok(worst < 5e-16, `worst error ${worst}`);
  let far = 0;
  for (let i = 0; i < 2000; i++) {
    const a = (R() - 0.5) * 2000;
    cosSin(a, out);
    far = Math.max(far, Math.abs(out.c - Math.cos(a)), Math.abs(out.s - Math.sin(a)));
  }
  assert.ok(far < 1e-12, `far error ${far}`);
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 3 * Math.PI / 2]) {
    cosSin(a, out);
    assert.ok(close(out.c, Math.cos(a), 1e-15) && close(out.s, Math.sin(a), 1e-15), `angle ${a}`);
  }
});

test('mass properties of boxes, offset boxes and circles', () => {
  const b = box(1, 0.5);
  const m = polygonMass(b, 2);
  assert.ok(close(m.mass, 4, 1e-12));
  assert.ok(close(m.I, (4 * (4 + 1)) / 12, 1e-12)); // m (w² + h²) / 12
  const off = polygonMass(box(1, 0.5, 3, 0), 2);
  assert.ok(close(off.cx, 3, 1e-12) && close(off.cy, 0, 1e-12));
  assert.ok(close(off.I, m.I + 4 * 9, 1e-9)); // parallel axis theorem
  const c = circleMass(circle(0.5, 1, 0), 1);
  assert.ok(close(c.mass, Math.PI * 0.25, 1e-12));
  assert.ok(close(c.I, c.mass * (0.125 + 1), 1e-12));
});

test('polygons: hull, welding, at most 8 vertices, degenerate input rejected', () => {
  const pts = [];
  for (let i = 0; i < 32; i++) pts.push({ x: Math.cos(i / 32 * 2 * Math.PI), y: Math.sin(i / 32 * 2 * Math.PI) });
  pts.push({ x: 0, y: 0 }, { x: 0.1, y: 0.2 }); // interior points are dropped
  const p = polygon(pts);
  assert.equal(p.n, 8);
  assert.ok(p.area > 2.5 && p.area < Math.PI);
  for (let i = 0; i < p.n; i++) {
    assert.ok(close(p.nx[i] * p.nx[i] + p.ny[i] * p.ny[i], 1, 1e-12));
    const j = (i + 1) % p.n;
    // counter-clockwise: the normal points away from the centroid
    const mx = (p.vx[i] + p.vx[j]) / 2 - p.cx, my = (p.vy[i] + p.vy[j]) / 2 - p.cy;
    assert.ok(mx * p.nx[i] + my * p.ny[i] > 0);
  }
  assert.equal(polygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), null);
  assert.equal(polygon([{ x: 0, y: 0 }, { x: 1e-4, y: 0 }, { x: 0, y: 1e-4 }]), null);
  assert.equal(convexHull([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }, { x: 0, y: 1 }]).length, 4);
});

test('dynamic tree stays valid and answers queries like brute force', () => {
  const R = rng(3);
  const tree = new DynamicTree();
  const live = new Map();
  const randBox = () => {
    const x = R() * 100, y = R() * 100, w = R() * 3, h = R() * 3;
    return [x, y, x + w, y + h];
  };
  for (let i = 0; i < 400; i++) {
    const b = randBox();
    live.set(tree.createProxy(...b, i), b);
  }
  for (let round = 0; round < 2000; round++) {
    const ids = [...live.keys()];
    const id = ids[Math.floor(R() * ids.length)];
    const r = R();
    if (r < 0.6) {
      const [x0, y0, x1, y1] = live.get(id);
      const dx = (R() - 0.5) * 2, dy = (R() - 0.5) * 2;
      const b = [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
      tree.moveProxy(id, ...b, dx, dy);
      live.set(id, b);
    } else if (r < 0.8) {
      tree.destroyProxy(id);
      live.delete(id);
    } else {
      const b = randBox();
      live.set(tree.createProxy(...b, round), b);
    }
  }
  assert.equal(tree.validate(), live.size);
  assert.ok(tree.height() <= 2.5 * Math.log2(live.size) + 2, `height ${tree.height()} for ${live.size}`);
  // every overlapping tight box is reported (fat boxes may add a few extra)
  for (let q = 0; q < 50; q++) {
    const [x0, y0, x1, y1] = randBox();
    const found = new Set();
    tree.query(x0, y0, x1, y1, id => { found.add(id); });
    for (const [id, b] of live) {
      if (b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1) assert.ok(found.has(id));
    }
  }
});

function fixtureAt(world, shape, x, y, angle = 0) {
  const b = world.createBody({ x, y, angle });
  return b.addFixture(shape);
}

test('narrow phase: box on box, circle on corner, separated shapes', () => {
  const w = new World();
  const a = fixtureAt(w, box(1, 1), 0, 0);
  const b = fixtureAt(w, box(0.5, 0.5), 0.2, 1.49);
  const m = collide(a, b, newManifold());
  assert.equal(m.count, 2);
  assert.ok(close(m.nx, 0, 1e-12) && close(m.ny, 1, 1e-12));
  for (let i = 0; i < 2; i++) assert.ok(close(m.p[i].sep, -0.01, 1e-9));
  // the same pair the other way round has the opposite normal
  const m2 = collide(b, a, newManifold());
  assert.ok(close(m2.ny, -1, 1e-12));
  // circle near the corner: normal from the corner to the centre
  const c = fixtureAt(w, circle(0.5), 1.3, 1.3);
  const m3 = collide(a, c, newManifold());
  assert.equal(m3.count, 1);
  assert.ok(close(m3.nx, Math.SQRT1_2, 1e-12) && close(m3.ny, Math.SQRT1_2, 1e-12));
  assert.ok(close(m3.p[0].sep, Math.sqrt(0.18) - 0.5, 1e-12));
  // far apart: nothing
  const d = fixtureAt(w, box(0.5, 0.5), 5, 0);
  assert.equal(collide(a, d, newManifold()).count, 0);
  // rotated box resting on a corner: one point
  const e = fixtureAt(w, box(0.5, 0.5), 0, 1 + Math.SQRT2 * 0.5 - 0.01, Math.PI / 4);
  const m4 = collide(a, e, newManifold());
  assert.equal(m4.count, 1);
  assert.ok(close(m4.p[0].sep, -0.01, 1e-9));
});

test('free fall follows y = y0 − g t² / 2', () => {
  const w = new World();
  const b = w.createBody({ y: 100 });
  b.addFixture(circle(0.5));
  run(w, 1);
  assert.ok(close(b.y, 100 - 5, 0.03), `y = ${b.y}`);
  assert.ok(close(b.vy, -10, 1e-9));
});

test('a box comes to rest on the ground, barely sinks, and falls asleep', () => {
  const { world } = groundWorld();
  const b = world.createBody({ y: 3 });
  b.addFixture(box(0.5, 0.5));
  let slept = -1;
  run(world, 5, i => { if (slept < 0 && !b.awake) slept = i; });
  assert.ok(slept > 0 && slept < 180, `slept at step ${slept}`);
  assert.ok(b.y > 0.5 - 2 * LINEAR_SLOP && b.y < 0.5 + LINEAR_SLOP, `y = ${b.y}`);
  assert.ok(Math.abs(b.angle) < 1e-5 && Math.abs(b.x) < 1e-3);
});

test('a 20-row pyramid (210 boxes) stands still and sleeps', () => {
  const { world } = groundWorld();
  const start = [];
  for (let r = 0; r < 20; r++) {
    for (let i = 0; i < 20 - r; i++) {
      const b = world.createBody({ x: i - (20 - r) / 2 + 0.5, y: 0.5 + r });
      b.addFixture(box(0.5, 0.5), { density: 1, friction: 0.6 });
      start.push([b, b.x, b.y]);
    }
  }
  run(world, 8);
  let drift = 0;
  for (const [b, x, y] of start) drift = Math.max(drift, Math.abs(b.x - x), Math.abs(b.y - y));
  assert.ok(drift < 0.05, `max drift ${drift}`);
  assert.ok(start.every(([b]) => !b.awake), 'all asleep');
});

function slope(world, angle, friction) {
  const ramp = world.createBody({ type: 'static', angle });
  ramp.addFixture(box(20, 0.5, 0, -0.5), { friction });
  const c = Math.cos(angle), s = Math.sin(angle);
  const b = world.createBody({ x: -s * 0.5, y: c * 0.5, angle });
  b.addFixture(box(0.5, 0.5), { friction });
  return b;
}

test('friction: a box holds on a slope below the friction angle and slides on ice', () => {
  const angle = 20 * Math.PI / 180;
  const w1 = new World();
  const held = slope(w1, angle, 0.6);
  const x0 = held.x;
  run(w1, 3);
  assert.ok(Math.abs(held.x - x0) < 0.01, `moved ${held.x - x0}`);

  const w2 = new World();
  const slid = slope(w2, angle, 0.02);
  const p0 = { x: slid.x, y: slid.y };
  run(w2, 1);
  const d = Math.sqrt((slid.x - p0.x) ** 2 + (slid.y - p0.y) ** 2);
  const expected = 0.5 * 10 * (Math.sin(angle) - 0.02 * Math.cos(angle)); // a t² / 2 with t = 1
  assert.ok(close(d, expected, 0.05 * expected), `slid ${d}, expected ${expected}`);
});

test('restitution: a rubber ball bounces back to about e² of the drop height', () => {
  const { world, ground } = groundWorld();
  ground.fixtures[0].restitution = 0.8;
  const b = world.createBody({ y: 2.5 });
  b.addFixture(circle(0.5), { restitution: 0.8 });
  let bounced = false, peak = 0, wasFalling = false;
  run(world, 4, () => {
    if (b.vy < -1) wasFalling = true;
    if (wasFalling && b.vy > 0) bounced = true;
    if (bounced) peak = Math.max(peak, b.y - 0.5);
  });
  assert.ok(bounced);
  const expected = 2 * 0.64;
  assert.ok(close(peak, expected, 0.15 * expected), `peak ${peak}`);
});

test('pendulum period matches 2π√(L/g) and keeps its energy', () => {
  const w = new World();
  const L = 2, theta = 10 * Math.PI / 180;
  const bob = w.createBody({ x: L * Math.sin(theta), y: 5 - L * Math.cos(theta) });
  bob.addFixture(circle(0.1), { density: 10 });
  w.createJoint({ type: 'distance', bodyB: bob, localA: { x: 0, y: 5 }, localB: { x: 0, y: 0 }, length: L });
  const crossings = [];
  let prev = bob.x, maxLate = 0;
  run(w, 30, i => {
    if (prev > 0 && bob.x <= 0) crossings.push((i + 1) / 60 - bob.x / bob.vx * 0); // step granularity is fine
    prev = bob.x;
    if (i > 60 * 25) maxLate = Math.max(maxLate, bob.x);
  });
  const periods = crossings.slice(1).map((t, k) => t - crossings[k]);
  const T = periods.reduce((a, b) => a + b) / periods.length;
  const expected = 2 * Math.PI * Math.sqrt(L / 10) * (1 + theta * theta / 16);
  assert.ok(close(T, expected, 0.01 * expected), `period ${T} vs ${expected}`);
  assert.ok(maxLate > 0.97 * L * Math.sin(theta), `amplitude after 25 s: ${maxLate}`);
});

test('a revolute motor spins a wheel at the set speed', () => {
  const { world } = groundWorld();
  const wheel = world.createBody({ y: 3 });
  wheel.addFixture(circle(0.5));
  world.createJoint({ type: 'revolute', bodyB: wheel, localA: { x: 0, y: 3 }, localB: { x: 0, y: 0 }, enableMotor: true, motorSpeed: -4, maxMotorTorque: 50 });
  run(world, 2);
  assert.ok(close(wheel.w, -4, 1e-3), `w = ${wheel.w}`);
  assert.ok(close(wheel.y, 3, 0.01) && wheel.awake);
});

test('revolute limits stop a falling arm', () => {
  const w = new World();
  const arm = w.createBody({ x: 1, y: 5 });
  arm.addFixture(box(1, 0.1));
  const j = w.createJoint({ type: 'revolute', bodyB: arm, localA: { x: 0, y: 5 }, localB: { x: -1, y: 0 }, enableLimit: true, lower: -0.5, upper: 0.5 });
  let lowest = 0;
  run(w, 3, () => { lowest = Math.min(lowest, j.jointAngle()); });
  assert.ok(lowest > -0.55, `went to ${lowest}`);
  assert.ok(close(j.jointAngle(), -0.5, 0.02), `rests at ${j.jointAngle()}`);
});

function chain(world, n, linkL, weightRatio) {
  let prev = world.ground, prevLocal = { x: 0, y: 10 };
  const links = [];
  for (let i = 0; i < n; i++) {
    const b = world.createBody({ x: (i + 0.5) * linkL, y: 10 });
    b.addFixture(box(linkL / 2, 0.03), { density: 1, group: -1 });
    world.createJoint({ type: 'revolute', bodyA: prev, bodyB: b, localA: prevLocal, localB: { x: -linkL / 2, y: 0 } });
    prev = b; prevLocal = { x: linkL / 2, y: 0 };
    links.push(b);
  }
  const weight = world.createBody({ x: n * linkL + 0.3, y: 10 });
  weight.addFixture(circle(0.3), { density: weightRatio * links[0].mass / (Math.PI * 0.09) });
  world.createJoint({ type: 'revolute', bodyA: prev, bodyB: weight, localA: prevLocal, localB: { x: -0.3, y: 0 } });
  return weight;
}

test('a swinging chain of 30 links with a 10× heavier weight stretches only a little', () => {
  const w = new World();
  const weight = chain(w, 30, 0.25, 10);
  let maxHang = 0;
  run(w, 8, () => { maxHang = Math.max(maxHang, 10 - weight.y); });
  assert.ok(maxHang > 7.5 && maxHang < 7.8 * 1.07, `max hang ${maxHang}`);
});

test('a rope (chain plus a length limit) holds a weight 1500× heavier than a link', () => {
  const w = new World();
  const weight = chain(w, 30, 0.25, 1500);
  // the rope tool adds this: a maximum-distance joint from the anchor to the end
  w.createJoint({ type: 'distance', bodyB: weight, localA: { x: 0, y: 10 }, localB: { x: -0.3, y: 0 }, length: 7.5, minLength: 0, maxLength: 7.5 });
  let maxHang = 0;
  run(w, 8, () => { maxHang = Math.max(maxHang, 10 - weight.y); });
  assert.ok(maxHang > 7.5 && maxHang < 7.8 * 1.01, `max hang ${maxHang}`);
  assert.ok(w.bodies.every(b => Math.abs(b.w) < 50), 'no link spins out of control');
});

test('welded boxes move as one rigid body', () => {
  const { world } = groundWorld();
  const a = world.createBody({ x: 0, y: 3 });
  a.addFixture(box(0.5, 0.5));
  const b = world.createBody({ x: 1, y: 3.5 });
  b.addFixture(box(0.5, 0.5));
  world.createJoint({ type: 'weld', bodyA: a, bodyB: b, localA: { x: 0.5, y: 0.25 }, localB: { x: -0.5, y: -0.25 } });
  b.applyImpulse(3, 4, b.cx + 0.5, b.cy);
  let worst = 0;
  run(world, 4, () => {
    const dx = b.x - a.x, dy = b.y - a.y;
    worst = Math.max(worst, Math.abs(b.angle - a.angle), Math.abs(Math.sqrt(dx * dx + dy * dy) - Math.sqrt(1.25)));
  });
  assert.ok(worst < 0.01, `deformed by ${worst}`);
});

test('a spring oscillates at its frequency', () => {
  const w = new World({ gravity: { x: 0, y: 0 } });
  const b = w.createBody({ x: 2.5, y: 0 });
  b.addFixture(circle(0.2));
  w.createJoint({ type: 'distance', bodyB: b, localA: { x: 0, y: 0 }, localB: { x: 0, y: 0 }, length: 2, minLength: 0, maxLength: 100, hertz: 1, dampingRatio: 0 });
  const crossings = [];
  let prev = b.x;
  run(w, 6, i => {
    if (prev > 2 && b.x <= 2) crossings.push(i / 60);
    prev = b.x;
  });
  const T = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
  assert.ok(close(T, 1, 0.03), `period ${T}`);
});

test('a fast ball does not tunnel through a thin wall', () => {
  const w = new World({ gravity: { x: 0, y: 0 } });
  const wall = w.createBody({ type: 'static', x: 5 });
  wall.addFixture(box(0.05, 3));
  const ball = w.createBody({ x: 0, vx: 80 });
  ball.addFixture(circle(0.1), { restitution: 0 });
  run(w, 1);
  assert.ok(ball.x < 5, `ball at ${ball.x}`);
  const flat = w.createBody({ x: 0, y: 1, vx: 60, angle: 0.3 });
  flat.addFixture(box(0.3, 0.05));
  run(w, 1);
  assert.ok(flat.x < 5, `box at ${flat.x}`);
});

test('sleeping bodies wake when hit, and when their support is removed', () => {
  const { world, ground } = groundWorld();
  const a = world.createBody({ y: 0.5 });
  a.addFixture(box(0.5, 0.5));
  const top = world.createBody({ y: 1.5 });
  top.addFixture(box(0.5, 0.5));
  run(world, 2);
  assert.ok(!a.awake && !top.awake);
  const ball = world.createBody({ x: 0, y: 6 });
  ball.addFixture(circle(0.3), { density: 5 });
  run(world, 1.5, () => !(a.awake && top.awake));
  assert.ok(a.awake && top.awake, 'the stack woke up');
  run(world, 4);
  assert.ok(!a.awake);
  world.destroyBody(ground);
  assert.ok(a.awake && top.awake, 'removing the floor wakes the stack');
  run(world, 1);
  assert.ok(a.y < -3);
});

test('the simulation is deterministic', () => {
  const make = () => {
    const { world } = groundWorld();
    const R = rng(11);
    for (let i = 0; i < 80; i++) {
      const b = world.createBody({ x: R() * 6 - 3, y: 1 + i * 0.4, angle: R() * 3 });
      if (i % 3) b.addFixture(box(0.2 + R() * 0.3, 0.2 + R() * 0.2), { restitution: 0.2 });
      else b.addFixture(circle(0.2 + R() * 0.2));
    }
    return world;
  };
  const a = make(), b = make();
  run(a, 5);
  run(b, 5);
  assert.equal(a.fingerprint(), b.fingerprint());
  run(a, 0.1);
  assert.notEqual(a.fingerprint(), b.fingerprint());
});

test('explosions push bodies away', () => {
  const { world } = groundWorld();
  const left = world.createBody({ x: -1, y: 0.5 });
  left.addFixture(box(0.5, 0.5));
  const right = world.createBody({ x: 1, y: 0.5 });
  right.addFixture(box(0.5, 0.5));
  run(world, 1);
  world.explode(0, 0.5, 4, 10);
  assert.ok(left.vx < -1 && right.vx > 1 && left.awake);
});
