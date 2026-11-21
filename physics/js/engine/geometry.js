// Turning hand-drawn strokes into physics shapes.
//
// A stroke is simplified (Ramer–Douglas–Peucker). A closed stroke becomes a polygon; since the solver only
// handles convex pieces, a concave outline is triangulated by ear clipping (choosing the best-shaped ear each
// time, which avoids slivers) and the triangles are merged back into convex pieces of at most 8 vertices
// (Hertel–Mehlhorn). An open stroke becomes a thick line made of boxes with round joints.

import { convexHull, MAX_POLY_VERTS } from './shapes.js';

const d2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
const cross3 = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const k = p.x * q.y - q.x * p.y;
    a += k;
    cx += (p.x + q.x) * k;
    cy += (p.y + q.y) * k;
  }
  if (Math.abs(a) < 1e-12) {
    // degenerate: average of the points
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / pts.length, y: y / pts.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.sqrt(d2(pts[i - 1], pts[i]));
  return l;
}

// Distance from p to segment ab, squared.
function segDist2(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a.x + t * dx - p.x, y = a.y + t * dy - p.y;
  return x * x + y * y;
}

// Ramer–Douglas–Peucker on an open polyline.
export function simplify(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bestD = t2;
    for (let k = i + 1; k < j; k++) {
      const d = segDist2(pts[k], pts[i], pts[j]);
      if (d > bestD) { bestD = d; best = k; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// RDP on a closed outline: split at the point farthest from the first one.
export function simplifyClosed(pts, tol) {
  if (pts.length <= 3) return pts.slice();
  let far = 0, farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = d2(pts[0], pts[i]);
    if (d > farD) { farD = d; far = i; }
  }
  const a = simplify(pts.slice(0, far + 1), tol);
  const b = simplify(pts.slice(far).concat([pts[0]]), tol);
  return removeCollinear(a.slice(0, -1).concat(b.slice(0, -1)), tol * 0.25);
}

export function removeCollinear(pts, tol = 1e-4) {
  let out = pts.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      if (d2(a, b) < tol * tol || segDist2(b, a, c) < tol * tol) {
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}

function segmentsIntersect(a, b, c, d) {
  const d1 = cross3(c, d, a), d2_ = cross3(c, d, b), d3 = cross3(a, b, c), d4 = cross3(a, b, d);
  return ((d1 > 0 && d2_ < 0) || (d1 < 0 && d2_ > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// True if no two non-adjacent edges of the closed outline cross.
export function isSimple(pts) {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(a, b, pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

export function isConvex(pts, eps = 1e-9) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    if (cross3(pts[i], pts[(i + 1) % n], pts[(i + 2) % n]) < -eps) return false;
  }
  return true;
}

function pointInTriangle(p, a, b, c) {
  return cross3(a, b, p) >= 0 && cross3(b, c, p) >= 0 && cross3(c, a, p) >= 0;
}

// Smallest angle of a triangle, as a cosine-free quality score (larger is better): 2·area / longest edge².
function triQuality(a, b, c) {
  const l = Math.max(d2(a, b), d2(b, c), d2(c, a));
  return l > 0 ? cross3(a, b, c) / l : 0;
}

// Ear clipping for a simple counter-clockwise polygon. Returns triangles as index triples.
export function triangulate(pts) {
  const idx = pts.map((_, i) => i);
  const tris = [];
  while (idx.length > 3) {
    let best = -1, bestQ = -Infinity;
    const n = idx.length;
    for (let i = 0; i < n; i++) {
      const ia = idx[(i + n - 1) % n], ib = idx[i], ic = idx[(i + 1) % n];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross3(a, b, c) <= 1e-12) continue; // reflex or flat
      let inside = false;
      for (let k = 0; k < n; k++) {
        const ik = idx[k];
        if (ik === ia || ik === ib || ik === ic) continue;
        const p = pts[ik];
        if ((p.x === a.x && p.y === a.y) || (p.x === b.x && p.y === b.y) || (p.x === c.x && p.y === c.y)) continue;
        if (pointInTriangle(p, a, b, c)) { inside = true; break; }
      }
      if (inside) continue;
      const q = triQuality(a, b, c);
      if (q > bestQ) { bestQ = q; best = i; }
    }
    if (best < 0) {
      // numerically stuck (nearly flat outline): cut the least-reflex corner
      let flat = 0, flatC = -Infinity;
      for (let i = 0; i < n; i++) {
        const c = cross3(pts[idx[(i + n - 1) % n]], pts[idx[i]], pts[idx[(i + 1) % n]]);
        if (c > flatC) { flatC = c; flat = i; }
      }
      idx.splice(flat, 1);
      continue;
    }
    tris.push([idx[(best + n - 1) % n], idx[best], idx[(best + 1) % n]]);
    idx.splice(best, 1);
  }
  if (idx.length === 3 && cross3(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > 1e-12) tris.push(idx.slice());
  return tris;
}

// Merge two index polygons that share the edge (a, b): in p it runs a→b, in q b→a.
function mergeAlong(p, q, a, b) {
  const pi = p.indexOf(b), qi = q.indexOf(a);
  const pr = p.slice(pi).concat(p.slice(0, pi)); // b … a
  const qr = q.slice(qi).concat(q.slice(0, qi)); // a … b
  return pr.concat(qr.slice(1, -1));
}

// Convex decomposition (Hertel–Mehlhorn on the ear-clipping triangulation). Returns arrays of points.
export function decompose(pts, maxVerts = MAX_POLY_VERTS) {
  let poly = pts.slice();
  if (signedArea(poly) < 0) poly.reverse();
  if (poly.length <= maxVerts && isConvex(poly)) return [poly];
  let parts = triangulate(poly);
  const toPts = ip => ip.map(i => poly[i]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      for (let e = 0; e < p.length; e++) {
        const a = p[e], b = p[(e + 1) % p.length];
        for (let j = i + 1; j < parts.length; j++) {
          const q = parts[j];
          const qa = q.indexOf(a), qb = q.indexOf(b);
          if (qa < 0 || qb < 0 || (qb + 1) % q.length !== qa) continue;
          const m = mergeAlong(p, q, a, b);
          const mp = removeCollinear(toPts(m), 1e-6);
          if (mp.length > maxVerts || !isConvex(mp, 1e-9)) continue;
          parts[i] = m;
          parts.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return parts.map(ip => removeCollinear(toPts(ip), 1e-6));
}

// Classify and clean a raw stroke (world points). Returns {kind: 'poly'|'line', pts, hull} or null.
// tol: simplification tolerance (about a few screen pixels in metres).
export function strokeToShape(raw, { tol = 0.04, closeDist = 0.3, minArea = 0.02, minLength = 0.25 } = {}) {
  const pts = [];
  for (const p of raw) {
    if (!pts.length || d2(pts[pts.length - 1], p) > tol * tol * 0.25) pts.push({ x: p.x, y: p.y });
  }
  if (pts.length < 2) return null;
  const length = pathLength(pts);
  const gap = Math.sqrt(d2(pts[0], pts[pts.length - 1]));
  if (gap <= closeDist && length > 4 * closeDist && pts.length >= 3) {
    let poly = simplifyClosed(pts, tol);
    if (poly.length >= 3) {
      if (signedArea(poly) < 0) poly.reverse();
      let hull = false;
      if (!isSimple(poly)) { poly = convexHull(poly); hull = true; }
      if (poly.length >= 3 && signedArea(poly) >= minArea) return { kind: 'poly', pts: poly, hull };
    }
  }
  if (length < minLength) return null;
  return { kind: 'line', pts: simplify(pts, tol) };
}
