// The physics world: bodies, fixtures, contacts, joints and the time step.
//
// Step = update contacts (narrow phase) → solve (soft step with substeps) → sync shapes → find new pairs
// (broad phase) → put resting islands to sleep.
//
// The solver is "soft step" (Erin Catto, Solver2D / Box2D v3): every 1/60 s step is split into substeps; each
// substep integrates velocities, warm-starts with the accumulated impulses, solves constraints as stiff damped
// springs (so overlap is pushed out smoothly instead of with a kick), integrates positions, then "relaxes" the
// velocities without the position bias so nothing gains energy. Restitution is applied once at the end.

import { cosSin, makeSoft } from './math.js';
import { shapeMass, LINEAR_SLOP, SPECULATIVE } from './shapes.js';
import { DynamicTree } from './tree.js';
import { collide, newManifold, fixtureContains } from './collide.js';
import { RevoluteJoint, DistanceJoint, WeldJoint, MouseJoint } from './joints.js';

export const STATIC = 0;
export const DYNAMIC = 2;

const TIME_TO_SLEEP = 0.5;
const SLEEP_SPEED = 0.05; // m/s at the fastest point of the body
const MAX_LINEAR_SPEED = 100;
const MAX_PUSH = 3; // m/s: how fast overlapping shapes are pushed apart
const RESTITUTION_THRESHOLD = 1; // m/s: slower impacts don't bounce
const IMPACT_SPEED = 0.8; // m/s: reported as an impact event (sounds)
const MAX_SPECULATIVE = 1.5; // m
const ROLLING_RESISTANCE = 0.015;

export class Fixture {
  constructor(body, shape, def) {
    this.body = body;
    this.shape = shape;
    this.density = def.density ?? 1;
    this.friction = def.friction ?? 0.6;
    this.restitution = def.restitution ?? 0;
    this.group = def.group ?? 0; // fixtures with the same negative group never collide
    this.id = 0;
    this.proxy = -1;
    this.minX = this.minY = this.maxX = this.maxY = 0;
    if (shape.type === 'poly') {
      this.wv = new Float64Array(2 * shape.n);
      this.wn = new Float64Array(2 * shape.n);
    } else {
      this.wx = this.wy = 0;
    }
  }

  // World-space vertices/normals or centre, and the tight bounding box.
  sync() {
    const b = this.body, c = b.c, s = b.s, sh = this.shape;
    if (sh.type === 'circle') {
      this.wx = b.x + c * sh.x - s * sh.y;
      this.wy = b.y + s * sh.x + c * sh.y;
      this.minX = this.wx - sh.r; this.maxX = this.wx + sh.r;
      this.minY = this.wy - sh.r; this.maxY = this.wy + sh.r;
      return;
    }
    const { n, vx, vy, nx, ny } = sh, wv = this.wv, wn = this.wn;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = b.x + c * vx[i] - s * vy[i], y = b.y + s * vx[i] + c * vy[i];
      wv[2 * i] = x; wv[2 * i + 1] = y;
      wn[2 * i] = c * nx[i] - s * ny[i]; wn[2 * i + 1] = s * nx[i] + c * ny[i];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    this.minX = minX; this.minY = minY; this.maxX = maxX; this.maxY = maxY;
  }

  contains(x, y) {
    return fixtureContains(this, x, y);
  }
}

export class Body {
  constructor(world, def) {
    this.world = world;
    this.id = 0;
    this.type = def.type === 'static' || def.type === STATIC ? STATIC : DYNAMIC;
    this.x = def.x ?? 0;
    this.y = def.y ?? 0;
    this.angle = def.angle ?? 0;
    this.c = 1; this.s = 0;
    cosSin(this.angle, this);
    this.lcx = 0; this.lcy = 0;
    this.cx = this.x; this.cy = this.y;
    this.vx = def.vx ?? 0; this.vy = def.vy ?? 0; this.w = def.w ?? 0;
    this.fx = 0; this.fy = 0; this.torque = 0;
    this.mass = 0; this.invMass = 0; this.I = 0; this.invI = 0; this.extent = 0;
    this.gravityScale = def.gravityScale ?? 1;
    this.linearDamping = def.linearDamping ?? 0;
    this.angularDamping = def.angularDamping ?? 0.05;
    this.fixtures = [];
    this.contacts = [];
    this.joints = [];
    this.awake = this.type === DYNAMIC && def.awake !== false;
    this.sleepTime = 0;
    this.noSleep = 0;
    this.userData = def.userData ?? null;
    // previous transform, for drawing between steps
    this.px = this.x; this.py = this.y; this.pa = this.angle;
    // solver state
    this.c0x = 0; this.c0y = 0; this.c0 = 1; this.s0 = 0; this.dqc = 1; this.dqs = 0;
    this.uf = -1;
  }

  get isStatic() {
    return this.type === STATIC;
  }

  addFixture(shape, def = {}) {
    const f = new Fixture(this, shape, def);
    f.id = ++this.world.fixtureSeq;
    this.fixtures.push(f);
    f.sync();
    this.world.addProxy(f);
    this.resetMass();
    return f;
  }

  resetMass() {
    let mass = 0, cx = 0, cy = 0, I = 0;
    if (this.type === DYNAMIC) {
      for (const f of this.fixtures) {
        const m = shapeMass(f.shape, f.density);
        mass += m.mass;
        cx += m.mass * m.cx;
        cy += m.mass * m.cy;
        I += m.I;
      }
    }
    if (mass > 0) {
      cx /= mass; cy /= mass;
      this.mass = mass; this.invMass = 1 / mass;
      this.I = I - mass * (cx * cx + cy * cy);
      this.invI = this.I > 0 ? 1 / this.I : 0;
    } else {
      this.mass = this.invMass = this.I = this.invI = 0;
      if (this.type === DYNAMIC) { this.mass = 1; this.invMass = 1; }
      cx = cy = 0;
    }
    this.lcx = cx; this.lcy = cy;
    // distance from the centre of mass to the farthest point (for the sleep test)
    let extent = 0;
    for (const f of this.fixtures) {
      const sh = f.shape;
      if (sh.type === 'circle') extent = Math.max(extent, Math.sqrt((sh.x - cx) * (sh.x - cx) + (sh.y - cy) * (sh.y - cy)) + sh.r);
      else for (let i = 0; i < sh.n; i++) extent = Math.max(extent, Math.sqrt((sh.vx[i] - cx) * (sh.vx[i] - cx) + (sh.vy[i] - cy) * (sh.vy[i] - cy)));
    }
    this.extent = extent;
    this.updateCenter();
  }

  updateCenter() {
    this.cx = this.x + this.c * this.lcx - this.s * this.lcy;
    this.cy = this.y + this.s * this.lcx + this.c * this.lcy;
    this.c0x = this.cx; this.c0y = this.cy;
    this.c0 = this.c; this.s0 = this.s;
    this.dqc = 1; this.dqs = 0;
  }

  // Teleport (editor moves). Wakes the body and whatever it touches.
  setTransform(x, y, angle = this.angle) {
    this.x = x; this.y = y; this.angle = angle;
    cosSin(angle, this);
    this.updateCenter();
    this.px = x; this.py = y; this.pa = angle;
    for (const f of this.fixtures) {
      f.sync();
      this.world.moveProxy(f, 0, 0);
    }
    this.world.wake(this);
    this.world.wakeNeighbours(this);
  }

  setType(type) {
    const t = type === 'static' || type === STATIC ? STATIC : DYNAMIC;
    if (t === this.type) return;
    this.world.wakeNeighbours(this);
    this.type = t;
    this.vx = this.vy = this.w = 0;
    this.resetMass();
    for (const c of this.contacts.slice()) this.world.destroyContact(c);
    for (const f of this.fixtures) this.world.moveProxy(f, 0, 0, true);
    this.awake = t === DYNAMIC;
    this.sleepTime = 0;
  }

  applyImpulse(ix, iy, px = this.cx, py = this.cy) {
    if (this.type !== DYNAMIC) return;
    this.world.wake(this);
    this.vx += this.invMass * ix;
    this.vy += this.invMass * iy;
    this.w += this.invI * ((px - this.cx) * iy - (py - this.cy) * ix);
  }

  applyForce(fx, fy) {
    this.fx += fx; this.fy += fy;
  }

  // World point → body-local point.
  toLocal(x, y, out = {}) {
    const dx = x - this.x, dy = y - this.y;
    out.x = this.c * dx + this.s * dy;
    out.y = -this.s * dx + this.c * dy;
    return out;
  }

  toWorld(lx, ly, out = {}) {
    out.x = this.x + this.c * lx - this.s * ly;
    out.y = this.y + this.s * lx + this.c * ly;
    return out;
  }

  contains(x, y) {
    for (const f of this.fixtures) if (f.contains(x, y)) return true;
    return false;
  }

  bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of this.fixtures) {
      if (f.minX < minX) minX = f.minX; if (f.minY < minY) minY = f.minY;
      if (f.maxX > maxX) maxX = f.maxX; if (f.maxY > maxY) maxY = f.maxY;
    }
    return { minX, minY, maxX, maxY };
  }
}

class Contact {
  constructor(fA, fB, key) {
    this.fA = fA; this.fB = fB;
    this.bA = fA.body; this.bB = fB.body;
    this.key = key;
    this.index = -1;
    this.touching = false;
    this.friction = Math.sqrt(fA.friction * fB.friction);
    this.restitution = Math.max(fA.restitution, fB.restitution);
    this.soft = null;
    // rolling resistance for round shapes: a torque limit proportional to the normal force
    const rA = fA.shape.type === 'circle' ? fA.shape.r : 0, rB = fB.shape.type === 'circle' ? fB.shape.r : 0;
    this.rolling = ROLLING_RESISTANCE * (rA && rB ? Math.min(rA, rB) : rA || rB);
    this.ri = 0;
    this.rollMass = 0;
    const m = newManifold();
    for (const p of m.p) Object.assign(p, { ni: 0, ti: 0, maxNi: 0, rax: 0, ray: 0, rbx: 0, rby: 0, nm: 0, tm: 0, adj: 0, relVel: 0 });
    this.m = m;
  }
}

const scratch = newManifold();

export class World {
  constructor({ gravity = { x: 0, y: -10 }, substeps = 4 } = {}) {
    this.gravity = { ...gravity };
    this.substeps = substeps;
    this.bodies = [];
    this.joints = [];
    this.contacts = [];
    this.contactMap = new Map();
    this.tree = new DynamicTree();
    this.moveBuffer = [];
    this.bodySeq = 0;
    this.fixtureSeq = 0;
    this.jointSeq = 0;
    this.time = 0;
    this.stepCount = 0;
    this.impacts = [];
    this.ground = new Body(this, { type: 'static' });
    this.ground.id = 0;
    this.stats = { contacts: 0, awake: 0, ms: 0 };
  }

  // ----- bodies -----

  createBody(def = {}) {
    const b = new Body(this, def);
    b.id = ++this.bodySeq;
    this.bodies.push(b);
    return b;
  }

  destroyBody(b) {
    const i = this.bodies.indexOf(b);
    if (i < 0) return;
    for (const j of b.joints.slice()) this.destroyJoint(j);
    this.wakeNeighbours(b);
    for (const c of b.contacts.slice()) this.destroyContact(c);
    for (const f of b.fixtures) this.removeProxy(f);
    this.bodies.splice(i, 1);
    b.world = null;
  }

  addProxy(f) {
    f.proxy = this.tree.createProxy(f.minX, f.minY, f.maxX, f.maxY, f);
    this.tree.nodes[f.proxy].moved = true;
    this.moveBuffer.push(f.proxy);
  }

  removeProxy(f) {
    if (f.proxy < 0) return;
    const node = this.tree.nodes[f.proxy];
    if (node.moved) {
      node.moved = false;
      const k = this.moveBuffer.indexOf(f.proxy);
      if (k >= 0) this.moveBuffer.splice(k, 1);
    }
    this.tree.destroyProxy(f.proxy);
    f.proxy = -1;
  }

  moveProxy(f, dx, dy, force = false) {
    if (f.proxy < 0) return;
    let moved = this.tree.moveProxy(f.proxy, f.minX, f.minY, f.maxX, f.maxY, dx, dy);
    if (force && !moved) moved = true;
    const node = this.tree.nodes[f.proxy];
    if (moved && !node.moved) {
      node.moved = true;
      this.moveBuffer.push(f.proxy);
    }
  }

  // ----- joints -----

  createJoint(def) {
    const bodyA = def.bodyA ?? this.ground;
    const d = { ...def, bodyA };
    let j;
    switch (def.type) {
      case 'revolute': j = new RevoluteJoint(d); break;
      case 'distance': j = new DistanceJoint(d); break;
      case 'weld': j = new WeldJoint(d); break;
      case 'mouse': j = new MouseJoint(d); break;
      default: throw new Error(`unknown joint ${def.type}`);
    }
    j.id = ++this.jointSeq;
    this.joints.push(j);
    j.bodyA.joints.push(j);
    j.bodyB.joints.push(j);
    if (j.type === 'mouse' || (j.type === 'revolute' && j.enableMotor)) j.bodyB.noSleep++;
    if (j.type === 'revolute' && j.enableMotor) j.bodyA.noSleep++;
    if (!j.collideConnected) {
      for (const c of j.bodyB.contacts.slice()) {
        if ((c.bA === j.bodyA && c.bB === j.bodyB) || (c.bA === j.bodyB && c.bB === j.bodyA)) this.destroyContact(c);
      }
    }
    this.wake(j.bodyA);
    this.wake(j.bodyB);
    return j;
  }

  destroyJoint(j) {
    const i = this.joints.indexOf(j);
    if (i < 0) return;
    this.joints.splice(i, 1);
    for (const b of [j.bodyA, j.bodyB]) {
      const k = b.joints.indexOf(j);
      if (k >= 0) b.joints.splice(k, 1);
    }
    if (j.type === 'mouse' || (j.type === 'revolute' && j.enableMotor)) j.bodyB.noSleep--;
    if (j.type === 'revolute' && j.enableMotor) j.bodyA.noSleep--;
    this.wake(j.bodyA);
    this.wake(j.bodyB);
    // the bodies may collide again now: let the broad phase look at them
    for (const b of [j.bodyA, j.bodyB]) for (const f of b.fixtures) this.moveProxy(f, 0, 0, true);
  }

  setMotor(j, enable, speed = j.motorSpeed, torque = j.maxMotorTorque) {
    if (j.enableMotor !== enable) {
      const d = enable ? 1 : -1;
      j.bodyA.noSleep += d;
      j.bodyB.noSleep += d;
      j.enableMotor = enable;
    }
    j.motorSpeed = speed;
    j.maxMotorTorque = torque;
    this.wake(j.bodyA);
    this.wake(j.bodyB);
  }

  // ----- sleeping -----

  // Wake a body and everything connected to it by touching contacts and joints.
  wake(b) {
    if (b.type !== DYNAMIC) return;
    b.sleepTime = 0;
    if (b.awake) return;
    const stack = [b];
    while (stack.length) {
      const x = stack.pop();
      if (x.awake || x.type !== DYNAMIC) continue;
      x.awake = true;
      x.sleepTime = 0;
      for (const c of x.contacts) if (c.touching) stack.push(c.bA === x ? c.bB : c.bA);
      for (const j of x.joints) stack.push(j.bodyA === x ? j.bodyB : j.bodyA);
    }
  }

  wakeNeighbours(b) {
    for (const c of b.contacts) this.wake(c.bA === b ? c.bB : c.bA);
    for (const j of b.joints) this.wake(j.bodyA === b ? j.bodyB : j.bodyA);
  }

  wakeAll() {
    for (const b of this.bodies) if (b.type === DYNAMIC) { b.awake = true; b.sleepTime = 0; }
  }

  setGravity(x, y) {
    if (x === this.gravity.x && y === this.gravity.y) return;
    this.gravity.x = x;
    this.gravity.y = y;
    this.wakeAll();
  }

  // ----- contacts -----

  shouldCollide(fA, fB) {
    const a = fA.body, b = fB.body;
    if (a === b) return false;
    if (a.type !== DYNAMIC && b.type !== DYNAMIC) return false;
    if (fA.group !== 0 && fA.group === fB.group && fA.group < 0) return false;
    const joints = a.joints.length < b.joints.length ? a.joints : b.joints;
    for (const j of joints) {
      if (!j.collideConnected && ((j.bodyA === a && j.bodyB === b) || (j.bodyA === b && j.bodyB === a))) return false;
    }
    return true;
  }

  updatePairs() {
    const tree = this.tree, nodes = tree.nodes;
    for (const id of this.moveBuffer) {
      const node = nodes[id];
      if (!node.moved) continue;
      const fA = node.data;
      tree.query(node.minX, node.minY, node.maxX, node.maxY, other => {
        if (other === id) return;
        const on = nodes[other];
        if (on.moved && other < id) return; // that proxy will find this pair itself
        this.addPair(fA, on.data);
      });
    }
    for (const id of this.moveBuffer) if (nodes[id]) nodes[id].moved = false;
    this.moveBuffer.length = 0;
  }

  addPair(f1, f2) {
    const fA = f1.id < f2.id ? f1 : f2, fB = fA === f1 ? f2 : f1;
    const key = fA.id * 2097152 + fB.id;
    if (this.contactMap.has(key)) return;
    if (!this.shouldCollide(fA, fB)) return;
    const c = new Contact(fA, fB, key);
    c.index = this.contacts.length;
    this.contacts.push(c);
    this.contactMap.set(key, c);
    fA.body.contacts.push(c);
    fB.body.contacts.push(c);
  }

  destroyContact(c) {
    if (c.index < 0) return;
    const last = this.contacts.pop();
    if (last !== c) {
      this.contacts[c.index] = last;
      last.index = c.index;
    }
    c.index = -1;
    this.contactMap.delete(c.key);
    for (const b of [c.bA, c.bB]) {
      const k = b.contacts.indexOf(c);
      if (k >= 0) b.contacts.splice(k, 1);
    }
  }

  // Narrow phase for every contact whose fat boxes still overlap and that has an awake body.
  updateContacts(dt) {
    const nodes = this.tree.nodes;
    for (let i = this.contacts.length - 1; i >= 0; i--) {
      const c = this.contacts[i];
      const bA = c.bA, bB = c.bB;
      const activeA = bA.awake && bA.type === DYNAMIC, activeB = bB.awake && bB.type === DYNAMIC;
      if (!activeA && !activeB) continue;
      const a = nodes[c.fA.proxy], b = nodes[c.fB.proxy];
      if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) {
        this.destroyContact(c);
        continue;
      }
      const old = c.m;
      // fast bodies get a wider speculative margin: about how far they can close in one step
      let spec = SPECULATIVE + dt * (Math.abs(bA.vx) + Math.abs(bA.vy) + Math.abs(bB.vx) + Math.abs(bB.vy) +
        bA.extent * Math.abs(bA.w) + bB.extent * Math.abs(bB.w));
      if (spec > MAX_SPECULATIVE) spec = MAX_SPECULATIVE;
      collide(c.fA, c.fB, scratch, spec);
      // carry accumulated impulses over by feature id (warm starting)
      let n0i = 0, n0t = 0, n1i = 0, n1t = 0;
      for (let k = 0; k < scratch.count; k++) {
        const id = scratch.p[k].id;
        let ni = 0, ti = 0;
        for (let q = 0; q < old.count; q++) {
          if (old.p[q].id === id) { ni = old.p[q].ni; ti = old.p[q].ti; break; }
        }
        if (k === 0) { n0i = ni; n0t = ti; } else { n1i = ni; n1t = ti; }
      }
      old.nx = scratch.nx; old.ny = scratch.ny; old.count = scratch.count;
      for (let k = 0; k < scratch.count; k++) {
        const p = old.p[k], s = scratch.p[k];
        p.x = s.x; p.y = s.y; p.sep = s.sep; p.id = s.id;
        p.ni = k === 0 ? n0i : n1i;
        p.ti = k === 0 ? n0t : n1t;
      }
      c.touching = scratch.count > 0;
      if (!c.touching) c.ri = 0;
      if (c.touching) {
        if (!activeA && bA.type === DYNAMIC) this.wake(bA);
        if (!activeB && bB.type === DYNAMIC) this.wake(bB);
      }
    }
  }

  // ----- stepping -----

  step(dt = 1 / 60) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.impacts.length = 0;
    if (this.moveBuffer.length) this.updatePairs();
    this.updateContacts(dt);
    this.solve(dt);
    this.updatePairs();
    this.time += dt;
    this.stepCount++;
    if (t0) this.stats.ms = performance.now() - t0;
  }

  solve(dt) {
    const substeps = this.substeps;
    const h = dt / substeps, inv_h = 1 / h;
    const contactHertz = Math.min(30, 0.25 * substeps / dt);
    const ctx = {
      h, inv_h,
      contactSoft: makeSoft(contactHertz, 10, h),
      staticSoft: makeSoft(2 * contactHertz, 10, h),
      jointSoft: makeSoft(2 * contactHertz, 2, h)
    };
    const gx = this.gravity.x, gy = this.gravity.y;

    const bodies = [];
    for (const b of this.bodies) {
      if (b.type !== DYNAMIC || !b.awake) continue;
      bodies.push(b);
      b.px = b.x; b.py = b.y; b.pa = b.angle;
      b.c0x = b.cx; b.c0y = b.cy; b.c0 = b.c; b.s0 = b.s; b.dqc = 1; b.dqs = 0;
    }
    const contacts = [];
    for (const c of this.contacts) {
      if (!c.touching) continue;
      if ((c.bA.awake && c.bA.type === DYNAMIC) || (c.bB.awake && c.bB.type === DYNAMIC)) contacts.push(c);
    }
    const joints = [];
    for (const j of this.joints) {
      const a = j.bodyA, b = j.bodyB;
      if ((a.awake && a.type === DYNAMIC) || (b.awake && b.type === DYNAMIC)) joints.push(j);
    }
    this.stats.contacts = contacts.length;
    this.stats.awake = bodies.length;

    for (const j of joints) j.prepare(ctx);
    this.prepareContacts(contacts, ctx);

    for (let sub = 0; sub < substeps; sub++) {
      for (const b of bodies) {
        const damp = 1 / (1 + h * b.linearDamping);
        b.vx = (b.vx + h * (b.invMass * b.fx + gx * b.gravityScale)) * damp;
        b.vy = (b.vy + h * (b.invMass * b.fy + gy * b.gravityScale)) * damp;
        b.w = (b.w + h * b.invI * b.torque) * (1 / (1 + h * b.angularDamping));
        const v2 = b.vx * b.vx + b.vy * b.vy;
        if (v2 > MAX_LINEAR_SPEED * MAX_LINEAR_SPEED) {
          const f = MAX_LINEAR_SPEED / Math.sqrt(v2);
          b.vx *= f; b.vy *= f;
        }
        const maxW = 0.25 * Math.PI * inv_h;
        if (b.w > maxW) b.w = maxW; else if (b.w < -maxW) b.w = -maxW;
      }
      for (const j of joints) j.warmStart(ctx);
      this.warmStartContacts(contacts);
      for (const j of joints) j.solve(ctx, true);
      this.solveContacts(contacts, ctx, true);
      for (const b of bodies) {
        b.cx += h * b.vx;
        b.cy += h * b.vy;
        b.angle += h * b.w;
        cosSin(b.angle, b);
        b.dqc = b.c * b.c0 + b.s * b.s0;
        b.dqs = b.s * b.c0 - b.c * b.s0;
      }
      for (const j of joints) j.solve(ctx, false);
      this.solveContacts(contacts, ctx, false);
    }
    this.applyRestitution(contacts);

    for (const b of bodies) {
      b.fx = b.fy = b.torque = 0;
      b.x = b.cx - (b.c * b.lcx - b.s * b.lcy);
      b.y = b.cy - (b.s * b.lcx + b.c * b.lcy);
      const dx = b.cx - b.c0x, dy = b.cy - b.c0y;
      for (const f of b.fixtures) {
        f.sync();
        this.moveProxy(f, dx, dy);
      }
    }
    this.updateSleep(bodies, contacts, joints, dt);
  }

  prepareContacts(contacts, ctx) {
    for (const c of contacts) {
      const A = c.bA, B = c.bB, m = c.m;
      const mA = A.invMass, iA = A.invI, mB = B.invMass, iB = B.invI;
      const nx = m.nx, ny = m.ny, tx = ny, ty = -nx;
      c.soft = mA === 0 || mB === 0 ? ctx.staticSoft : ctx.contactSoft;
      if (c.rolling > 0) c.rollMass = iA + iB > 0 ? 1 / (iA + iB) : 0;
      let impact = 0, ix = 0, iy = 0;
      for (let i = 0; i < m.count; i++) {
        const p = m.p[i];
        const rax = p.x - A.cx, ray = p.y - A.cy, rbx = p.x - B.cx, rby = p.y - B.cy;
        p.rax = rax; p.ray = ray; p.rbx = rbx; p.rby = rby;
        p.adj = p.sep - ((rbx - rax) * nx + (rby - ray) * ny);
        const rnA = rax * ny - ray * nx, rnB = rbx * ny - rby * nx;
        const kn = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
        p.nm = kn > 0 ? 1 / kn : 0;
        const rtA = rax * ty - ray * tx, rtB = rbx * ty - rby * tx;
        const kt = mA + mB + iA * rtA * rtA + iB * rtB * rtB;
        p.tm = kt > 0 ? 1 / kt : 0;
        const dvx = B.vx - B.w * rby - A.vx + A.w * ray;
        const dvy = B.vy + B.w * rbx - A.vy - A.w * rax;
        p.relVel = dvx * nx + dvy * ny;
        p.maxNi = 0;
        if (-p.relVel > impact) { impact = -p.relVel; ix = p.x; iy = p.y; }
      }
      if (impact > IMPACT_SPEED) this.impacts.push({ x: ix, y: iy, speed: impact, a: c.fA, b: c.fB });
    }
  }

  warmStartContacts(contacts) {
    for (const c of contacts) {
      const A = c.bA, B = c.bB, m = c.m;
      const mA = A.invMass, iA = A.invI, mB = B.invMass, iB = B.invI;
      const nx = m.nx, ny = m.ny, tx = ny, ty = -nx;
      for (let i = 0; i < m.count; i++) {
        const p = m.p[i];
        const Px = p.ni * nx + p.ti * tx, Py = p.ni * ny + p.ti * ty;
        A.w -= iA * (p.rax * Py - p.ray * Px);
        A.vx -= mA * Px; A.vy -= mA * Py;
        B.w += iB * (p.rbx * Py - p.rby * Px);
        B.vx += mB * Px; B.vy += mB * Py;
      }
      if (c.ri !== 0) { A.w -= iA * c.ri; B.w += iB * c.ri; }
    }
  }

  solveContacts(contacts, ctx, useBias) {
    const inv_h = ctx.inv_h;
    for (const c of contacts) {
      const A = c.bA, B = c.bB, m = c.m, soft = c.soft;
      const mA = A.invMass, iA = A.invI, mB = B.invMass, iB = B.invI;
      const nx = m.nx, ny = m.ny, tx = ny, ty = -nx;
      const dpx = (B.cx - B.c0x) - (A.cx - A.c0x), dpy = (B.cy - B.c0y) - (A.cy - A.c0y);
      const qac = A.dqc, qas = A.dqs, qbc = B.dqc, qbs = B.dqs;
      for (let i = 0; i < m.count; i++) {
        const p = m.p[i];
        const rax = p.rax, ray = p.ray, rbx = p.rbx, rby = p.rby;
        // current separation from the motion since the start of the step
        const prax = qac * rax - qas * ray, pray = qas * rax + qac * ray;
        const prbx = qbc * rbx - qbs * rby, prby = qbs * rbx + qbc * rby;
        const s = (dpx + prbx - prax) * nx + (dpy + prby - pray) * ny + p.adj;
        let bias = 0, ms = 1, is = 0;
        if (s > 0) bias = s * inv_h; // speculative: allow closing the gap exactly
        else if (useBias) {
          bias = Math.max(soft.biasRate * s, -MAX_PUSH);
          ms = soft.massScale; is = soft.impulseScale;
        }
        const dvx = B.vx - B.w * rby - A.vx + A.w * ray;
        const dvy = B.vy + B.w * rbx - A.vy - A.w * rax;
        const vn = dvx * nx + dvy * ny;
        let impulse = -p.nm * ms * (vn + bias) - is * p.ni;
        const next = Math.max(p.ni + impulse, 0);
        impulse = next - p.ni;
        p.ni = next;
        if (impulse > p.maxNi) p.maxNi = impulse;
        const Px = impulse * nx, Py = impulse * ny;
        A.vx -= mA * Px; A.vy -= mA * Py; A.w -= iA * (rax * Py - ray * Px);
        B.vx += mB * Px; B.vy += mB * Py; B.w += iB * (rbx * Py - rby * Px);
      }
      const friction = c.friction;
      for (let i = 0; i < m.count; i++) {
        const p = m.p[i];
        const rax = p.rax, ray = p.ray, rbx = p.rbx, rby = p.rby;
        const dvx = B.vx - B.w * rby - A.vx + A.w * ray;
        const dvy = B.vy + B.w * rbx - A.vy - A.w * rax;
        const vt = dvx * tx + dvy * ty;
        let impulse = -p.tm * vt;
        const max = friction * p.ni;
        const next = Math.max(-max, Math.min(p.ti + impulse, max));
        impulse = next - p.ti;
        p.ti = next;
        const Px = impulse * tx, Py = impulse * ty;
        A.vx -= mA * Px; A.vy -= mA * Py; A.w -= iA * (rax * Py - ray * Px);
        B.vx += mB * Px; B.vy += mB * Py; B.w += iB * (rbx * Py - rby * Px);
      }
      if (c.rolling > 0) {
        let total = 0;
        for (let i = 0; i < m.count; i++) total += m.p[i].ni;
        const max = c.rolling * total;
        const old = c.ri;
        c.ri = Math.max(-max, Math.min(old - c.rollMass * (B.w - A.w), max));
        const d = c.ri - old;
        A.w -= iA * d;
        B.w += iB * d;
      }
    }
  }

  applyRestitution(contacts) {
    for (const c of contacts) {
      const e = c.restitution;
      if (e === 0) continue;
      const A = c.bA, B = c.bB, m = c.m;
      const mA = A.invMass, iA = A.invI, mB = B.invMass, iB = B.invI;
      const nx = m.nx, ny = m.ny;
      for (let i = 0; i < m.count; i++) {
        const p = m.p[i];
        if (p.relVel > -RESTITUTION_THRESHOLD || p.maxNi === 0) continue;
        const dvx = B.vx - B.w * p.rby - A.vx + A.w * p.ray;
        const dvy = B.vy + B.w * p.rbx - A.vy - A.w * p.rax;
        const vn = dvx * nx + dvy * ny;
        let impulse = -p.nm * (vn + e * p.relVel);
        const next = Math.max(p.ni + impulse, 0);
        impulse = next - p.ni;
        p.ni = next;
        if (impulse > p.maxNi) p.maxNi = impulse;
        const Px = impulse * nx, Py = impulse * ny;
        A.vx -= mA * Px; A.vy -= mA * Py; A.w -= iA * (p.rax * Py - p.ray * Px);
        B.vx += mB * Px; B.vy += mB * Py; B.w += iB * (p.rbx * Py - p.rby * Px);
      }
    }
  }

  // Islands (bodies linked by touching contacts or joints) fall asleep together once all are still.
  updateSleep(bodies, contacts, joints, dt) {
    const n = bodies.length;
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      b.uf = i;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy) + b.extent * Math.abs(b.w);
      if (b.noSleep > 0 || speed > SLEEP_SPEED) b.sleepTime = 0;
      else b.sleepTime += dt;
    }
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = i => {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    const link = (a, b) => {
      if (a.type !== DYNAMIC || b.type !== DYNAMIC || !a.awake || !b.awake) return;
      const ra = find(a.uf), rb = find(b.uf);
      if (ra !== rb) parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
    };
    for (const c of contacts) link(c.bA, c.bB);
    for (const j of joints) link(j.bodyA, j.bodyB);
    const minSleep = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (bodies[i].sleepTime < minSleep[r]) minSleep[r] = bodies[i].sleepTime;
    }
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (minSleep[find(i)] >= TIME_TO_SLEEP) {
        b.awake = false;
        b.vx = b.vy = b.w = 0;
        b.px = b.x; b.py = b.y; b.pa = b.angle;
      }
      b.uf = -1;
    }
  }

  // ----- queries -----

  // Bodies whose shapes contain the point, topmost (most recently created) first.
  bodiesAt(x, y, filter) {
    const out = new Set();
    this.tree.query(x, y, x, y, id => {
      const f = this.tree.nodes[id].data;
      if (f.contains(x, y) && (!filter || filter(f.body))) out.add(f.body);
    });
    return [...out].sort((a, b) => b.id - a.id);
  }

  queryBox(minX, minY, maxX, maxY, fn) {
    this.tree.query(minX, minY, maxX, maxY, id => fn(this.tree.nodes[id].data));
  }

  // Push dynamic bodies away from a point, stronger close to it.
  explode(x, y, radius, strength) {
    for (const b of this.bodies) {
      if (b.type !== DYNAMIC) continue;
      const dx = b.cx - x, dy = b.cy - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= radius) continue;
      const k = strength * b.mass * (1 - d / radius) / Math.max(d, 0.1);
      b.applyImpulse(dx * k, dy * k + 0.2 * strength * b.mass * (1 - d / radius));
    }
  }

  // A compact fingerprint of the dynamic state (positions and velocities). Equal fingerprints mean the
  // simulations are bit-for-bit identical.
  fingerprint() {
    const buf = new Float64Array(6);
    const bytes = new Uint8Array(buf.buffer);
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (const b of this.bodies) {
      buf[0] = b.x; buf[1] = b.y; buf[2] = b.angle; buf[3] = b.vx; buf[4] = b.vy; buf[5] = b.w;
      for (let i = 0; i < bytes.length; i++) {
        h1 = Math.imul(h1 ^ bytes[i], 16777619) >>> 0;
        h2 = Math.imul(h2 + bytes[i], 2246822519) >>> 0;
      }
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }
}

export { LINEAR_SLOP };
