// Narrow phase: contact manifolds between pairs of fixtures, computed in world space from each fixture's cached
// world vertices. A manifold has a normal pointing from A to B and up to two points; each point carries the
// separation (negative when overlapping) and a feature id so impulses can be carried over to the next step.
// Points are kept while still SPECULATIVE apart, which lets the solver stop fast bodies right at the surface.

import { SPECULATIVE, LINEAR_SLOP } from './shapes.js';

export function newManifold() {
  return { nx: 0, ny: 0, count: 0, p: [{ x: 0, y: 0, sep: 0, id: 0 }, { x: 0, y: 0, sep: 0, id: 0 }] };
}

// Dispatches on the shape types. `spec` is how far apart shapes may still be to get (speculative) points;
// the world widens it for fast bodies, so they are stopped at the surface instead of tunnelling through.
export function collide(fA, fB, m, spec = SPECULATIVE) {
  m.count = 0;
  if (fA.shape.type === 'circle') {
    if (fB.shape.type === 'circle') collideCircles(fA, fB, m, spec);
    else { collidePolygonCircle(fB, fA, m, spec); m.nx = -m.nx; m.ny = -m.ny; }
  } else if (fB.shape.type === 'circle') collidePolygonCircle(fA, fB, m, spec);
  else collidePolygons(fA, fB, m, spec);
  return m;
}

export function collideCircles(fA, fB, m, spec) {
  const ra = fA.shape.r, rb = fB.shape.r;
  const dx = fB.wx - fA.wx, dy = fB.wy - fA.wy;
  const d = Math.sqrt(dx * dx + dy * dy);
  const sep = d - ra - rb;
  if (sep > spec) return;
  let nx = 0, ny = 1;
  if (d > 1e-12) { nx = dx / d; ny = dy / d; }
  m.nx = nx; m.ny = ny; m.count = 1;
  const p = m.p[0];
  p.x = fA.wx + nx * (ra + 0.5 * sep);
  p.y = fA.wy + ny * (ra + 0.5 * sep);
  p.sep = sep;
  p.id = 0;
}

export function collidePolygonCircle(fA, fB, m, spec) {
  const poly = fA.shape, n = poly.n, v = fA.wv, nrm = fA.wn;
  const cx = fB.wx, cy = fB.wy, r = fB.shape.r;
  let sepMax = -Infinity, edge = 0;
  for (let i = 0; i < n; i++) {
    const s = nrm[2 * i] * (cx - v[2 * i]) + nrm[2 * i + 1] * (cy - v[2 * i + 1]);
    if (s > sepMax) { sepMax = s; edge = i; }
  }
  if (sepMax - r > spec) return;
  const i1 = edge, i2 = edge + 1 < n ? edge + 1 : 0;
  const v1x = v[2 * i1], v1y = v[2 * i1 + 1], v2x = v[2 * i2], v2y = v[2 * i2 + 1];
  let nx, ny, sep;
  if (sepMax < 1e-9) {
    // centre inside the polygon: push out through the nearest face
    nx = nrm[2 * edge]; ny = nrm[2 * edge + 1]; sep = sepMax - r;
  } else {
    const u1 = (cx - v1x) * (v2x - v1x) + (cy - v1y) * (v2y - v1y);
    const u2 = (cx - v2x) * (v1x - v2x) + (cy - v2y) * (v1y - v2y);
    if (u1 <= 0 || u2 <= 0) {
      const vx = u1 <= 0 ? v1x : v2x, vy = u1 <= 0 ? v1y : v2y;
      const dx = cx - vx, dy = cy - vy;
      const d = Math.sqrt(dx * dx + dy * dy);
      sep = d - r;
      if (sep > spec) return;
      if (d < 1e-12) { nx = nrm[2 * edge]; ny = nrm[2 * edge + 1]; } else { nx = dx / d; ny = dy / d; }
    } else {
      nx = nrm[2 * edge]; ny = nrm[2 * edge + 1]; sep = sepMax - r;
    }
  }
  m.nx = nx; m.ny = ny; m.count = 1;
  const p = m.p[0];
  p.x = cx - nx * (r + 0.5 * sep);
  p.y = cy - ny * (r + 0.5 * sep);
  p.sep = sep;
  p.id = 0;
}

// Largest separation of B from any edge of A (the separating axis test).
function maxSeparation(fA, fB, out) {
  const nA = fA.shape.n, vA = fA.wv, nrm = fA.wn, nB = fB.shape.n, vB = fB.wv;
  let best = -Infinity, bestEdge = 0;
  for (let i = 0; i < nA; i++) {
    const nx = nrm[2 * i], ny = nrm[2 * i + 1], px = vA[2 * i], py = vA[2 * i + 1];
    let si = Infinity;
    for (let j = 0; j < nB; j++) {
      const s = nx * (vB[2 * j] - px) + ny * (vB[2 * j + 1] - py);
      if (s < si) si = s;
    }
    if (si > best) { best = si; bestEdge = i; }
  }
  out.edge = bestEdge;
  return best;
}

const sepA = { edge: 0 }, sepB = { edge: 0 };
const clip = [{ x: 0, y: 0, k: 0 }, { x: 0, y: 0, k: 0 }];

export function collidePolygons(fA, fB, m, spec) {
  const sa = maxSeparation(fA, fB, sepA);
  if (sa > spec) return;
  const sb = maxSeparation(fB, fA, sepB);
  if (sb > spec) return;

  let ref, inc, edge, flip;
  if (sb > sa + 0.1 * LINEAR_SLOP) { ref = fB; inc = fA; edge = sepB.edge; flip = 1; }
  else { ref = fA; inc = fB; edge = sepA.edge; flip = 0; }

  const rn = ref.shape.n, rv = ref.wv, rnrm = ref.wn;
  const nx = rnrm[2 * edge], ny = rnrm[2 * edge + 1];
  // incident edge: the edge of the other polygon most anti-parallel to the reference normal
  const inN = inc.shape.n, iv = inc.wv, inrm = inc.wn;
  let minDot = Infinity, ie = 0;
  for (let i = 0; i < inN; i++) {
    const d = nx * inrm[2 * i] + ny * inrm[2 * i + 1];
    if (d < minDot) { minDot = d; ie = i; }
  }
  const i1 = ie, i2 = ie + 1 < inN ? ie + 1 : 0;
  clip[0].x = iv[2 * i1]; clip[0].y = iv[2 * i1 + 1]; clip[0].k = i1;
  clip[1].x = iv[2 * i2]; clip[1].y = iv[2 * i2 + 1]; clip[1].k = i2;

  const r2 = edge + 1 < rn ? edge + 1 : 0;
  const v11x = rv[2 * edge], v11y = rv[2 * edge + 1], v12x = rv[2 * r2], v12y = rv[2 * r2 + 1];
  const tx = -ny, ty = nx; // edge direction
  // keep the part of the incident edge between the reference edge's side planes
  if (!clipSegment(-tx, -ty, -(tx * v11x + ty * v11y))) return;
  if (!clipSegment(tx, ty, tx * v12x + ty * v12y)) return;

  const front = nx * v11x + ny * v11y;
  m.nx = flip ? -nx : nx;
  m.ny = flip ? -ny : ny;
  let count = 0;
  for (let i = 0; i < 2; i++) {
    const c = clip[i];
    const sep = nx * c.x + ny * c.y - front;
    if (sep > spec) continue;
    const p = m.p[count++];
    p.x = c.x - 0.5 * sep * nx;
    p.y = c.y - 0.5 * sep * ny;
    p.sep = sep;
    p.id = (flip << 12) | (edge << 6) | (c.k << 1) | i;
  }
  m.count = count;
}

// Clip the two points in `clip` to the half plane dot(n, p) <= offset (Sutherland–Hodgman for a segment).
function clipSegment(nx, ny, offset) {
  const a = clip[0], b = clip[1];
  const da = nx * a.x + ny * a.y - offset;
  const db = nx * b.x + ny * b.y - offset;
  if (da <= 0 && db <= 0) return true;
  if (da > 0 && db > 0) return false;
  const t = da / (da - db);
  const x = a.x + t * (b.x - a.x), y = a.y + t * (b.y - a.y);
  if (da > 0) { a.x = x; a.y = y; } else { b.x = x; b.y = y; }
  return true;
}

// Point containment test in world space.
export function fixtureContains(f, x, y) {
  if (f.shape.type === 'circle') {
    const dx = x - f.wx, dy = y - f.wy;
    return dx * dx + dy * dy <= f.shape.r * f.shape.r;
  }
  const n = f.shape.n, v = f.wv, nrm = f.wn;
  for (let i = 0; i < n; i++) {
    if (nrm[2 * i] * (x - v[2 * i]) + nrm[2 * i + 1] * (y - v[2 * i + 1]) > 0) return false;
  }
  return true;
}
