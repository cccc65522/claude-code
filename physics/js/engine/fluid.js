// Water as particles (after Clavet, Beaudoin & Poulin, "Particle-based Viscoelastic Fluid Simulation", 2005).
//
// Each substep: gravity → predict positions → find neighbours with a uniform grid → "double density relaxation"
// (particles that are too crowded push each other apart; a second, near-range pressure keeps them from clumping)
// → push particles out of bodies → velocities from the change in position → a little viscosity.
//
// Two-way coupling: whatever momentum a particle loses against a body is handed to that body as a force for the
// next rigid step. Pressure in the water pushes up on submerged bodies, so wood floats and metal sinks without
// any special buoyancy code. Like the rest of the engine it only uses spec-exact arithmetic, so it is
// deterministic too.

import { fixtureContains } from './collide.js';

export const WATER = {
  h: 0.3, // interaction radius
  spacing: 0.13, // rest distance between particles (also used to lay out blocks of water)
  radius: 0.075, // collision radius against bodies
  density: 1, // kg/m², same units as materials: wood (0.6) floats, stone (2.5) sinks
  max: 2400 // particle budget
};

const SUBSTEPS = 2;
const K = 150; // pressure stiffness
const K_NEAR = 300; // near pressure
const VISCOSITY = 0.08; // XSPH velocity smoothing
const FRICTION = 0.08; // tangential slip against bodies
const MAX_SPEED = 15;

// Rest density of the kernel Σ(1 − r/h)² for particles on a square grid at the rest spacing.
function restDensity() {
  const { h, spacing } = WATER;
  let rho = 0;
  const n = Math.ceil(h / spacing);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (!i && !j) continue;
      const r = Math.sqrt(i * i + j * j) * spacing;
      if (r < h) rho += (1 - r / h) * (1 - r / h);
    }
  }
  return rho;
}

export class Fluid {
  constructor(world) {
    this.world = world;
    this.n = 0;
    this.cap = 0;
    this.maxSpeed = 0; // fastest particle after the last step
    this.sleepers = []; // sleeping bodies the water pressed on this step
    this.rho0 = restDensity();
    this.mass = WATER.density * WATER.spacing * WATER.spacing;
    this.pairs = { i: new Int32Array(1024), j: new Int32Array(1024), w: new Float64Array(1024), nx: new Float64Array(1024), ny: new Float64Array(1024), n: 0 };
    this.walls = { i: [], f: [], w: [], nx: [], ny: [], n: 0 };
    this.grow(256);
  }

  grow(cap) {
    const old = this;
    const make = (A, a) => { const b = new A(cap); if (a) b.set(a.subarray(0, old.n)); return b; };
    this.x = make(Float64Array, this.x); this.y = make(Float64Array, this.y);
    this.vx = make(Float64Array, this.vx); this.vy = make(Float64Array, this.vy);
    this.px = make(Float64Array, this.px); this.py = make(Float64Array, this.py);
    this.rho = new Float64Array(cap); this.rhoN = new Float64Array(cap);
    this.dx = new Float64Array(cap); this.dy = new Float64Array(cap);
    this.cell = new Float64Array(cap); this.order = new Int32Array(cap);
    this.cap = cap;
  }

  get count() {
    return this.n;
  }

  add(x, y, vx = 0, vy = 0) {
    if (this.n >= WATER.max) return false;
    if (this.n >= this.cap) this.grow(Math.min(WATER.max, this.cap * 2));
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    return true;
  }

  addBlock(x0, y0, x1, y1) {
    const flat = waterBlock(x0, y0, x1, y1);
    let added = 0;
    for (let k = 0; k < flat.length; k += 4) {
      if (!this.add(flat[k], flat[k + 1])) break;
      added++;
    }
    return added;
  }

  remove(i) {
    const last = --this.n;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
  }

  removeInCircle(cx, cy, r) {
    let removed = 0;
    for (let i = this.n - 1; i >= 0; i--) {
      const dx = this.x[i] - cx, dy = this.y[i] - cy;
      if (dx * dx + dy * dy <= r * r) { this.remove(i); removed++; }
    }
    return removed;
  }

  clear() {
    this.n = 0;
    this.maxSpeed = 0;
  }

  explode(cx, cy, radius, strength) {
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i] - cx, dy = this.y[i] - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= radius) continue;
      const k = strength * (1 - d / radius) / Math.max(d, 0.1);
      this.vx[i] += dx * k;
      this.vy[i] += dy * k + 0.2 * strength * (1 - d / radius);
    }
  }

  // Neighbour pairs within h, found through a grid of cells h wide. Particles are sorted by cell so each
  // cell's particles are contiguous; ties keep index order, so the pair list is the same on every machine.
  findPairs() {
    const { n, x, y, cell, order } = this;
    const h = WATER.h, inv = 1 / h;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(x[i] * inv) + 32768, cy = Math.floor(y[i] * inv) + 32768;
      cell[i] = cx * 65536 + cy;
      order[i] = i;
    }
    const ord = Array.from(order.subarray(0, n)).sort((a, b) => cell[a] - cell[b] || a - b);
    const start = new Map();
    for (let k = 0; k < n; k++) {
      const c = cell[ord[k]];
      if (k === 0 || cell[ord[k - 1]] !== c) start.set(c, k);
    }
    const P = this.pairs;
    P.n = 0;
    const h2 = h * h;
    for (let i = 0; i < n; i++) {
      const c = cell[i];
      for (let ox = -65536; ox <= 65536; ox += 65536) {
        for (let oy = -1; oy <= 1; oy++) {
          const k0 = start.get(c + ox + oy);
          if (k0 === undefined) continue;
          const cc = c + ox + oy;
          for (let k = k0; k < n && cell[ord[k]] === cc; k++) {
            const j = ord[k];
            if (j <= i) continue;
            const dx = x[j] - x[i], dy = y[j] - y[i];
            const d2 = dx * dx + dy * dy;
            if (d2 >= h2) continue;
            if (P.n >= P.i.length) this.growPairs();
            const d = Math.sqrt(d2);
            const q = P.n++;
            P.i[q] = i; P.j[q] = j;
            P.w[q] = 1 - d / h;
            if (d > 1e-9) { P.nx[q] = dx / d; P.ny[q] = dy / d; } else { P.nx[q] = 0; P.ny[q] = 1; }
          }
        }
      }
    }
  }

  growPairs() {
    const P = this.pairs, size = P.i.length * 2;
    const g = (A, a) => { const b = new A(size); b.set(a); return b; };
    P.i = g(Int32Array, P.i); P.j = g(Int32Array, P.j); P.w = g(Float64Array, P.w);
    P.nx = g(Float64Array, P.nx); P.ny = g(Float64Array, P.ny);
  }

  step(dt) {
    if (!this.n) return;
    const hs = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.substep(hs, dt);
    this.wakeSleepers();
    // drop particles that fell out of the world
    for (let i = this.n - 1; i >= 0; i--) if (this.y[i] < -200 || Math.abs(this.x[i]) > 5000) this.remove(i);
  }

  substep(hs, dt) {
    const { x, y, vx, vy, px, py, rho, rhoN, dx, dy } = this;
    const n = this.n, g = this.world.gravity;
    for (let i = 0; i < n; i++) {
      vx[i] += hs * g.x;
      vy[i] += hs * g.y;
      px[i] = x[i]; py[i] = y[i];
      x[i] += hs * vx[i];
      y[i] += hs * vy[i];
    }
    this.findPairs();
    const P = this.pairs, m = P.n;

    // double density relaxation (Jacobi: all displacements from the same positions, so order doesn't matter)
    rho.fill(0, 0, n); rhoN.fill(0, 0, n); dx.fill(0, 0, n); dy.fill(0, 0, n);
    for (let q = 0; q < m; q++) {
      const w = P.w[q], w2 = w * w, w3 = w2 * w;
      rho[P.i[q]] += w2; rho[P.j[q]] += w2;
      rhoN[P.i[q]] += w3; rhoN[P.j[q]] += w3;
    }
    this.findWalls();
    const W = this.walls;
    for (let k = 0; k < W.n; k++) {
      const w = W.w[k], w2 = w * w;
      rho[W.i[k]] += w2;
      rhoN[W.i[k]] += w2 * w;
    }
    const h2s = hs * hs;
    for (let q = 0; q < m; q++) {
      const i = P.i[q], j = P.j[q], w = P.w[q];
      const p = K * (rho[i] + rho[j] - 2 * this.rho0) * 0.5;
      const pn = K_NEAR * (rhoN[i] + rhoN[j]) * 0.5;
      const D = h2s * (p * w + pn * w * w) * 0.5;
      const ox = D * P.nx[q], oy = D * P.ny[q];
      dx[j] += ox; dy[j] += oy;
      dx[i] -= ox; dy[i] -= oy;
    }
    // solid walls push back like a mirror image of the particle would, and feel the push themselves:
    // this is what makes the pressure under a submerged body right, so it floats
    const mass = this.mass, kf = mass / (hs * dt);
    for (let k = 0; k < W.n; k++) {
      const i = W.i[k], w = W.w[k];
      const p = Math.max(0, K * (rho[i] - this.rho0));
      const D = h2s * (p * w + K_NEAR * rhoN[i] * w * w) * 0.5;
      dx[i] += D * W.nx[k]; dy[i] += D * W.ny[k];
      const b = W.f[k].body;
      if (b.type !== 2) continue;
      const fx = -D * W.nx[k] * kf, fy = -D * W.ny[k] * kf;
      const rx = x[i] - b.cx, ry = y[i] - b.cy;
      this.push(b, fx, fy, rx * fy - ry * fx);
    }
    // cap the pressure push per substep: particles squeezed into a corner must not be fired out
    const cap = WATER.h * 0.3, cap2 = cap * cap;
    for (let i = 0; i < n; i++) {
      let ex = dx[i], ey = dy[i];
      const l2 = ex * ex + ey * ey;
      if (l2 > cap2) { const k = cap / Math.sqrt(l2); ex *= k; ey *= k; }
      x[i] += ex; y[i] += ey;
    }

    this.collideBodies(hs, dt);

    const inv = 1 / hs;
    for (let i = 0; i < n; i++) {
      let ux = (x[i] - px[i]) * inv, uy = (y[i] - py[i]) * inv;
      const s2 = ux * ux + uy * uy;
      if (s2 > MAX_SPEED * MAX_SPEED) { const f = MAX_SPEED / Math.sqrt(s2); ux *= f; uy *= f; }
      vx[i] = ux; vy[i] = uy;
    }
    // XSPH viscosity: nudge each velocity toward its neighbours' average
    dx.fill(0, 0, n); dy.fill(0, 0, n); rho.fill(0, 0, n);
    for (let q = 0; q < m; q++) {
      const i = P.i[q], j = P.j[q], w = P.w[q];
      const ex = (vx[j] - vx[i]) * w, ey = (vy[j] - vy[i]) * w;
      dx[i] += ex; dy[i] += ey;
      dx[j] -= ex; dy[j] -= ey;
      rho[i] += w; rho[j] += w;
    }
    let fastest = 0;
    for (let i = 0; i < n; i++) {
      if (rho[i] > 0) {
        const k = VISCOSITY / Math.max(1, rho[i]);
        vx[i] += dx[i] * k;
        vy[i] += dy[i] * k;
      }
      const s = vx[i] * vx[i] + vy[i] * vy[i];
      if (s > fastest) fastest = s;
    }
    this.maxSpeed = Math.sqrt(fastest);
  }

  // Is there already a particle within d of (x, y)?
  occupied(x, y, d) {
    const d2 = d * d;
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i] - x, dy = this.y[i] - y;
      if (dx * dx + dy * dy < d2) return true;
    }
    return false;
  }

  // Body surfaces within h/2 of each particle (a mirror image of the particle across the surface would be a
  // neighbour). Fills this.walls with the particle, fixture, outward normal and kernel weight.
  findWalls() {
    const W = this.walls, { x, y } = this;
    const tree = this.world.tree, nodes = tree.nodes, half = WATER.h / 2, h = WATER.h;
    const hit = { nx: 0, ny: 0, sep: 0 };
    W.n = 0;
    for (let i = 0; i < this.n; i++) {
      const xi = x[i], yi = y[i];
      tree.query(xi - half, yi - half, xi + half, yi + half, id => {
        const f = nodes[id].data;
        if (!pointSeparation(f, xi, yi, half, hit)) return;
        const d = Math.max(0, hit.sep + half); // distance to the surface
        const k = W.n++;
        W.i[k] = i; W.f[k] = f; W.w[k] = 1 - 2 * d / h; W.nx[k] = hit.nx; W.ny[k] = hit.ny;
      });
    }
  }

  // A force on a body from the water, for its next step. Sleeping bodies only collect it (see wakeSleepers).
  push(b, fx, fy, torque) {
    if (!b.awake) {
      if (!b.waterHit) { b.waterHit = true; b.wfx = b.wfy = b.wtq = 0; this.sleepers.push(b); }
      b.wfx += fx; b.wfy += fy; b.wtq += torque;
      return;
    }
    b.fx += fx; b.fy += fy; b.torque += torque;
  }

  // Push particles out of bodies; the momentum they lose goes to the body as a force for the next step.
  collideBodies(hs, dt) {
    const { x, y, px, py } = this;
    const world = this.world, tree = world.tree, nodes = tree.nodes;
    const r = WATER.radius, inv = 1 / hs, mass = this.mass;
    const hit = { nx: 0, ny: 0, sep: 0 };
    for (let i = 0; i < this.n; i++) {
      let xi = x[i], yi = y[i];
      tree.query(xi - r, yi - r, xi + r, yi + r, id => {
        const f = nodes[id].data;
        if (!pointSeparation(f, xi, yi, r, hit)) return;
        const b = f.body;
        // particle velocity before the response
        const vx0 = (xi - px[i]) * inv, vy0 = (yi - py[i]) * inv;
        // push out (at most a fraction of the interaction radius per substep, to stay gentle)
        const push = Math.min(-hit.sep, WATER.h * 0.5);
        xi += hit.nx * push;
        yi += hit.ny * push;
        // velocity relative to the body at that point
        const rx = xi - b.cx, ry = yi - b.cy;
        const bvx = b.vx - b.w * ry, bvy = b.vy + b.w * rx;
        let ux = (xi - px[i]) * inv - bvx, uy = (yi - py[i]) * inv - bvy;
        const un = ux * hit.nx + uy * hit.ny;
        if (un < 0) { ux -= un * hit.nx; uy -= un * hit.ny; }
        const ut = ux * -hit.ny + uy * hit.nx;
        ux -= FRICTION * ut * -hit.ny;
        uy -= FRICTION * ut * hit.nx;
        const vx1 = bvx + ux, vy1 = bvy + uy;
        px[i] = xi - vx1 * hs;
        py[i] = yi - vy1 * hs;
        if (b.type === 2) {
          // impulse the particle lost → force on the body over the whole step
          const jx = mass * (vx0 - vx1), jy = mass * (vy0 - vy1);
          const k = 1 / dt;
          // a splash wakes a sleeping body at once; steady pressure is only collected (see wakeSleepers)
          if (!b.awake && (vx0 - bvx) * hit.nx + (vy0 - bvy) * hit.ny < -1.5) world.wake(b);
          this.push(b, jx * k, jy * k, (rx * jy - ry * jx) * k);
        }
      });
      x[i] = xi;
      y[i] = yi;
    }
  }

  // Still water presses on a resting body all the time; it only matters when it can move the body: when the
  // buoyancy is more than its weight (rising water lifts it) or the water pushes it sideways hard enough.
  wakeSleepers() {
    const g = this.world.gravity, gl = Math.sqrt(g.x * g.x + g.y * g.y);
    for (const b of this.sleepers) {
      b.waterHit = false;
      if (b.awake) continue;
      const weight = b.mass * gl * Math.abs(b.gravityScale);
      let up, side;
      if (gl > 0) {
        const ux = -g.x / gl, uy = -g.y / gl;
        up = b.wfx * ux + b.wfy * uy;
        side = Math.abs(b.wfx * -uy + b.wfy * ux);
      } else { up = Infinity; side = 0; }
      if (up > 1.05 * weight || side > 0.3 * weight) {
        this.world.wake(b);
        b.fx += b.wfx;
        b.fy += b.wfy;
        b.torque += b.wtq;
      }
    }
    this.sleepers.length = 0;
  }

  // State for saving: [x, y, vx, vy, …] rounded to millimetres.
  serialize() {
    const out = new Array(this.n * 4);
    const r = v => Math.round(v * 1000) / 1000;
    for (let i = 0; i < this.n; i++) {
      out[4 * i] = r(this.x[i]); out[4 * i + 1] = r(this.y[i]);
      out[4 * i + 2] = r(this.vx[i]); out[4 * i + 3] = r(this.vy[i]);
    }
    return out;
  }

  load(flat) {
    this.n = 0;
    for (let k = 0; k + 3 < flat.length; k += 4) this.add(flat[k], flat[k + 1], flat[k + 2], flat[k + 3]);
  }
}

// A rectangle of water at the rest spacing (a slightly staggered grid so it doesn't stand in columns), as the
// flat [x, y, vx, vy, …] list scenes store.
export function waterBlock(x0, y0, x1, y1) {
  const s = WATER.spacing, out = [];
  const r = v => Math.round(v * 1000) / 1000;
  const rows = Math.floor((y1 - y0) / s), cols = Math.floor((x1 - x0) / s - 0.25);
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < cols; c++) out.push(r(x0 + s / 2 + (row % 2) * s * 0.25 + c * s), r(y0 + s / 2 + row * s), 0, 0);
  }
  return out;
}

// Separation of a particle (circle of radius r) from a fixture: fills hit.{nx, ny, sep} (normal pointing out of the
// fixture) and returns true when they overlap.
export function pointSeparation(f, x, y, r, hit) {
  const sh = f.shape;
  if (sh.type === 'circle') {
    const dx = x - f.wx, dy = y - f.wy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const sep = d - sh.r - r;
    if (sep >= 0) return false;
    if (d > 1e-9) { hit.nx = dx / d; hit.ny = dy / d; } else { hit.nx = 0; hit.ny = 1; }
    hit.sep = sep;
    return true;
  }
  const n = sh.n, v = f.wv, nrm = f.wn;
  let best = -Infinity, edge = 0;
  for (let i = 0; i < n; i++) {
    const s = nrm[2 * i] * (x - v[2 * i]) + nrm[2 * i + 1] * (y - v[2 * i + 1]);
    if (s > best) { best = s; edge = i; }
  }
  if (best - r >= 0) return false;
  if (best > 0) {
    // outside the polygon: the nearest feature may be a vertex
    const i2 = edge + 1 < n ? edge + 1 : 0;
    const v1x = v[2 * edge], v1y = v[2 * edge + 1], v2x = v[2 * i2], v2y = v[2 * i2 + 1];
    const u1 = (x - v1x) * (v2x - v1x) + (y - v1y) * (v2y - v1y);
    const u2 = (x - v2x) * (v1x - v2x) + (y - v2y) * (v1y - v2y);
    if (u1 <= 0 || u2 <= 0) {
      const vx = u1 <= 0 ? v1x : v2x, vy = u1 <= 0 ? v1y : v2y;
      const dx = x - vx, dy = y - vy, d = Math.sqrt(dx * dx + dy * dy);
      if (d - r >= 0) return false;
      if (d > 1e-9) { hit.nx = dx / d; hit.ny = dy / d; } else { hit.nx = nrm[2 * edge]; hit.ny = nrm[2 * edge + 1]; }
      hit.sep = d - r;
      return true;
    }
  }
  hit.nx = nrm[2 * edge];
  hit.ny = nrm[2 * edge + 1];
  hit.sep = best - r;
  return true;
}

export { fixtureContains };
