// Scenes as plain JSON, and conversion to and from a live World.
//
// A scene stores what the user made (shape outlines, materials, joints) rather than the solver's internal
// pieces; loading rebuilds the convex pieces deterministically. Numbers are rounded when saving, and every run
// of a level starts from the saved JSON, so a run is a pure function of the JSON and replays identically.
//
//   body:  { shape: {t:'circle', r} | {t:'box', w, h} | {t:'poly', pts:[x,y,…]} | {t:'line', pts:[x,y,…], w},
//            x, y, a, v:[vx,vy], w, m: 'wood', fixed, tag, lock }
//   joint: { t:'pin'|'spring'|'rod'|'rope'|'weld', a, b (body index, −1 = background), la:[x,y], lb:[x,y],
//            ref, motor:{s,t}, lim:[lo,hi], len, hz, z }
//   water: [x, y, vx, vy, …] for every water particle

import { World, STATIC } from './world.js';
import { circle, box, polygon, convexHull } from './shapes.js';
import { decompose } from './geometry.js';
import { material } from './materials.js';

export const SCENE_VERSION = 1;

const r4 = x => Math.round(x * 1e4) / 1e4;
const r6 = x => Math.round(x * 1e6) / 1e6;

export function pairs(flat) {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

export function flat(pts, round = r4) {
  const out = [];
  for (const p of pts) out.push(round(p.x), round(p.y));
  return out;
}

// Physics shapes (body-local) for a shape spec.
export function shapesFor(spec) {
  switch (spec.t) {
    case 'circle': return [circle(spec.r)];
    case 'box': return [box(spec.w / 2, spec.h / 2)];
    case 'poly': {
      const pts = pairs(spec.pts);
      const out = [];
      for (const piece of decompose(pts)) {
        const p = polygon(piece);
        if (p) out.push(p);
      }
      if (!out.length) {
        const p = polygon(convexHull(pts));
        if (p) out.push(p);
      }
      return out;
    }
    case 'line': {
      const pts = pairs(spec.pts), hw = spec.w / 2, out = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.sqrt(dx * dx + dy * dy);
        if (l < 1e-4) continue;
        const nx = -dy / l * hw, ny = dx / l * hw;
        const p = polygon([{ x: a.x + nx, y: a.y + ny }, { x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny }, { x: b.x + nx, y: b.y + ny }]);
        if (p) out.push(p);
      }
      for (const p of pts) out.push(circle(hw, p.x, p.y));
      return out;
    }
    default: throw new Error(`unknown shape ${spec.t}`);
  }
}

export function addBody(world, spec) {
  const mat = material(spec.m);
  const b = world.createBody({
    type: spec.fixed ? 'static' : 'dynamic',
    x: spec.x, y: spec.y, angle: spec.a || 0,
    vx: spec.v ? spec.v[0] : 0, vy: spec.v ? spec.v[1] : 0, w: spec.w || 0,
    gravityScale: mat.gravityScale ?? 1,
    linearDamping: mat.gravityScale < 0 ? 1.2 : 0,
    awake: spec.sleep ? false : undefined
  });
  b.shapeSpec = spec.shape;
  b.mat = spec.m || 'wood';
  b.tag = spec.tag || null;
  b.locked = !!spec.lock;
  b.color = spec.col || null;
  b.group = spec.grp ?? 0;
  b.ropeId = spec.rid || 0;
  for (const s of shapesFor(spec.shape)) {
    b.addFixture(s, { density: mat.density, friction: mat.friction, restitution: mat.restitution, group: spec.grp ?? (spec.tag === 'link' ? -1 : 0) });
  }
  return b;
}

// Change the material of an existing body in place.
export function setMaterial(world, b, key) {
  const mat = material(key);
  b.mat = key;
  b.gravityScale = mat.gravityScale ?? 1;
  b.linearDamping = mat.gravityScale < 0 ? 1.2 : 0;
  for (const f of b.fixtures) {
    f.density = mat.density;
    f.friction = mat.friction;
    f.restitution = mat.restitution;
  }
  b.resetMass();
  for (const c of b.contacts) {
    c.friction = Math.sqrt(c.fA.friction * c.fB.friction);
    c.restitution = Math.max(c.fA.restitution, c.fB.restitution);
  }
  world.wake(b);
}

const bodyAt = (world, list, i) => (i < 0 ? world.ground : list[i]);

export function addJoint(world, spec, bodies) {
  return addJointBetween(world, spec, bodyAt(world, bodies, spec.a), bodyAt(world, bodies, spec.b));
}

// Create a joint from a spec between two live bodies (world.ground for the background).
export function addJointBetween(world, spec, bodyA, bodyB) {
  if (!bodyA || !bodyB || bodyA === bodyB) return null;
  const localA = { x: spec.la[0], y: spec.la[1] }, localB = { x: spec.lb[0], y: spec.lb[1] };
  let j;
  switch (spec.t) {
    case 'pin':
      j = world.createJoint({
        type: 'revolute', bodyA, bodyB, localA, localB, referenceAngle: spec.ref,
        enableMotor: !!spec.motor, motorSpeed: spec.motor ? spec.motor.s : 0, maxMotorTorque: spec.motor ? spec.motor.t : 0,
        enableLimit: !!spec.lim, lower: spec.lim ? spec.lim[0] : 0, upper: spec.lim ? spec.lim[1] : 0
      });
      break;
    case 'spring':
      j = world.createJoint({ type: 'distance', bodyA, bodyB, localA, localB, length: spec.len, minLength: 0, maxLength: spec.len * 4 + 5, hertz: spec.hz ?? 2, dampingRatio: spec.z ?? 0.2, collideConnected: true });
      break;
    case 'rod':
      j = world.createJoint({ type: 'distance', bodyA, bodyB, localA, localB, length: spec.len, collideConnected: true });
      break;
    case 'rope': // only a maximum length: keeps chains of light links from stretching under heavy loads
      j = world.createJoint({ type: 'distance', bodyA, bodyB, localA, localB, length: spec.len, minLength: 0, maxLength: spec.len, collideConnected: true });
      break;
    case 'weld':
      j = world.createJoint({ type: 'weld', bodyA, bodyB, localA, localB, referenceAngle: spec.ref });
      break;
    default: throw new Error(`unknown joint ${spec.t}`);
  }
  j.kind = spec.t;
  j.rope = spec.rope || false; // true for pins inside a rope, 2 for the pin where a rope starts
  j.locked = !!spec.lock;
  j.ropeId = spec.rid || 0;
  return j;
}

export function loadScene(world, scene) {
  const bodies = scene.bodies.map(s => addBody(world, s));
  const joints = (scene.joints || []).map(s => addJoint(world, s, bodies)).filter(Boolean);
  if (Array.isArray(scene.water)) world.fluid.load(scene.water);
  return { bodies, joints };
}

export function buildWorld(scene) {
  const g = scene.g || [0, -10];
  const world = new World({ gravity: { x: g[0], y: g[1] } });
  loadScene(world, scene);
  world.updatePairs();
  return world;
}

export function bodySpec(b) {
  const s = { shape: roundShape(b.shapeSpec), x: r4(b.x), y: r4(b.y), a: r6(b.angle), m: b.mat };
  if (b.vx || b.vy) s.v = [r4(b.vx), r4(b.vy)];
  if (b.w) s.w = r4(b.w);
  if (b.type === STATIC) s.fixed = true;
  if (b.tag) s.tag = b.tag;
  if (b.locked) s.lock = true;
  if (b.color) s.col = b.color;
  if (b.group) s.grp = b.group;
  if (b.ropeId) s.rid = b.ropeId;
  if (b.type !== STATIC && !b.awake) s.sleep = true;
  return s;
}

function roundShape(sh) {
  switch (sh.t) {
    case 'circle': return { t: 'circle', r: r4(sh.r) };
    case 'box': return { t: 'box', w: r4(sh.w), h: r4(sh.h) };
    case 'poly': return { t: 'poly', pts: sh.pts.map(r4) };
    case 'line': return { t: 'line', pts: sh.pts.map(r4), w: r4(sh.w) };
    default: return sh;
  }
}

export function jointSpec(j, index) {
  const ia = j.bodyA === j.bodyA.world?.ground ? -1 : index.get(j.bodyA);
  const ib = j.bodyB === j.bodyB.world?.ground ? -1 : index.get(j.bodyB);
  if (ia === undefined || ib === undefined) return null;
  const s = { t: j.kind, a: ia, b: ib, la: [r4(j.localA.x), r4(j.localA.y)], lb: [r4(j.localB.x), r4(j.localB.y)] };
  if (j.kind === 'pin') {
    s.ref = r6(j.referenceAngle);
    if (j.enableMotor) s.motor = { s: r4(j.motorSpeed), t: r4(j.maxMotorTorque) };
    if (j.enableLimit) s.lim = [r6(j.lower), r6(j.upper)];
  } else if (j.kind === 'weld') s.ref = r6(j.referenceAngle);
  else if (j.kind === 'spring') { s.len = r4(j.length); s.hz = j.hertz; s.z = j.dampingRatio; }
  else if (j.kind === 'rod' || j.kind === 'rope') s.len = r4(j.length);
  if (j.rope) s.rope = j.rope;
  if (j.locked) s.lock = true;
  if (j.ropeId) s.rid = j.ropeId;
  return s;
}

// World → scene JSON. Mouse joints (dragging) are not saved.
export function saveScene(world, extra = {}) {
  const index = new Map();
  world.bodies.forEach((b, i) => index.set(b, i));
  const joints = [];
  for (const j of world.joints) {
    if (!j.kind) continue;
    const s = jointSpec(j, index);
    if (s) joints.push(s);
  }
  const scene = { v: SCENE_VERSION, g: [world.gravity.x, world.gravity.y], bodies: world.bodies.map(bodySpec), joints, ...extra };
  if (world.fluid && world.fluid.n) scene.water = world.fluid.serialize();
  return scene;
}
