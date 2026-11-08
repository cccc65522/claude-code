// Collision shapes: circles and convex polygons (at most 8 vertices), in body-local coordinates.

import { cosSin } from './math.js';

export const MAX_POLY_VERTS = 8;
export const LINEAR_SLOP = 0.005; // m: allowed penetration, also the welding distance for vertices
export const SPECULATIVE = 4 * LINEAR_SLOP; // contacts are created this far before touching

export function circle(r, x = 0, y = 0) {
  return { type: 'circle', r, x, y };
}

export function box(hw, hh, cx = 0, cy = 0, angle = 0) {
  const { c, s } = cosSin(angle, {});
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: cx + c * x - s * y, y: cy + s * x + c * y }));
  return polygon(pts);
}

// Convex hull (Andrew's monotone chain), counter-clockwise, without collinear points.
export function convexHull(points) {
  const pts = points.map(p => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const turn = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Build a convex polygon from any points (the hull is taken). Returns null for degenerate input.
export function polygon(points) {
  // weld points closer than the slop, so there are no tiny edges with unstable normals
  const welded = [];
  for (const p of points) {
    if (!welded.some(q => (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y) < 0.25 * LINEAR_SLOP * LINEAR_SLOP)) welded.push(p);
  }
  let hull = convexHull(welded);
  if (hull.length < 3) return null;
  if (hull.length > MAX_POLY_VERTS) hull = reduceHull(hull, MAX_POLY_VERTS);
  const n = hull.length;
  const vx = new Float64Array(n), vy = new Float64Array(n), nx = new Float64Array(n), ny = new Float64Array(n);
  for (let i = 0; i < n; i++) { vx[i] = hull[i].x; vy[i] = hull[i].y; }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = vx[j] - vx[i], ey = vy[j] - vy[i];
    const l = Math.sqrt(ex * ex + ey * ey);
    if (l < LINEAR_SLOP * 0.25) return null;
    nx[i] = ey / l;
    ny[i] = -ex / l;
  }
  const poly = { type: 'poly', n, vx, vy, nx, ny, cx: 0, cy: 0, area: 0 };
  const m = polygonMass(poly, 1);
  if (!(m.area > 1e-6)) return null;
  poly.cx = m.cx;
  poly.cy = m.cy;
  poly.area = m.area;
  return poly;
}

// Drop the vertices that change the area the least until the hull is small enough.
function reduceHull(hull, max) {
  const h = hull.slice();
  while (h.length > max) {
    let best = 0, bestArea = Infinity;
    for (let i = 0; i < h.length; i++) {
      const a = h[(i + h.length - 1) % h.length], b = h[i], c = h[(i + 1) % h.length];
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (area < bestArea) { bestArea = area; best = i; }
    }
    h.splice(best, 1);
  }
  return h;
}

// Mass, centroid and rotational inertia (about the local origin) for a given density.
export function polygonMass(poly, density) {
  const { n, vx, vy } = poly;
  const ox = vx[0], oy = vy[0];
  let area = 0, cx = 0, cy = 0, I = 0;
  for (let i = 1; i < n - 1; i++) {
    const e1x = vx[i] - ox, e1y = vy[i] - oy, e2x = vx[i + 1] - ox, e2y = vy[i + 1] - oy;
    const D = e1x * e2y - e1y * e2x;
    const tri = 0.5 * D;
    area += tri;
    cx += tri * (e1x + e2x) / 3;
    cy += tri * (e1y + e2y) / 3;
    const intx2 = e1x * e1x + e2x * e1x + e2x * e2x;
    const inty2 = e1y * e1y + e2y * e1y + e2y * e2y;
    I += (0.25 / 3) * D * (intx2 + inty2);
  }
  const mass = density * area;
  cx /= area;
  cy /= area;
  // I is about vertex 0: shift to the centroid, then to the local origin
  const Ic = density * I - mass * (cx * cx + cy * cy);
  const gx = ox + cx, gy = oy + cy;
  return { area, mass, cx: gx, cy: gy, I: Ic + mass * (gx * gx + gy * gy) };
}

export function circleMass(c, density) {
  const area = Math.PI * c.r * c.r;
  const mass = density * area;
  return { area, mass, cx: c.x, cy: c.y, I: mass * (0.5 * c.r * c.r + c.x * c.x + c.y * c.y) };
}

export const shapeMass = (s, density) => (s.type === 'circle' ? circleMass(s, density) : polygonMass(s, density));
