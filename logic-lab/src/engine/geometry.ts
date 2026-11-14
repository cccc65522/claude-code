// Wire routing: an orthogonal path between two pins that leaves and enters each pin
// in the direction the pin faces.
import { sideVector, type Side } from './parts.ts';

export type Pt = [number, number];

const horizontal = (s: Side) => s === 'E' || s === 'W';

function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/**
 * Which coordinate a wire's movable middle segment has: 'x' for a vertical middle
 * segment, 'y' for a horizontal one, null when the route has a single bend.
 */
export function bendAxis(p0: Pt, s0: Side, p1: Pt, s1: Side): 'x' | 'y' | null {
  const [dx0, dy0] = sideVector(s0);
  const [dx1, dy1] = sideVector(s1);
  if (horizontal(s0) && horizontal(s1)) return dx0 * (p1[0] - p0[0]) > 0 && dx1 * (p0[0] - p1[0]) > 0 ? 'x' : 'y';
  if (!horizontal(s0) && !horizontal(s1)) return dy0 * (p1[1] - p0[1]) > 0 && dy1 * (p0[1] - p1[1]) > 0 ? 'y' : 'x';
  return null;
}

/**
 * Route from pin p0 (facing s0) to pin p1 (facing s1). Coordinates are grid units;
 * the result may contain half-grid coordinates at the middle bend. `bend` moves the
 * middle segment (see bendAxis).
 */
export function route(p0: Pt, s0: Side, p1: Pt, s1: Side, bend?: number): Pt[] {
  const [dx0, dy0] = sideVector(s0);
  const [dx1, dy1] = sideVector(s1);
  const a: Pt = [p0[0] + dx0, p0[1] + dy0];
  const b: Pt = [p1[0] + dx1, p1[1] + dy1];
  if (horizontal(s0) && horizontal(s1)) {
    // Forward when the source faces the target and the target faces back.
    const forward = dx0 * (p1[0] - p0[0]) > 0 && dx1 * (p0[0] - p1[0]) > 0;
    if (forward) {
      if (p0[1] === p1[1] && bend === undefined) return [p0, p1];
      const mx = bend ?? (p0[0] + p1[0]) / 2;
      return simplify([p0, [mx, p0[1]], [mx, p1[1]], p1]);
    }
    const my = bend ?? (p0[1] === p1[1] ? p0[1] - 2 : (p0[1] + p1[1]) / 2);
    return simplify([p0, a, [a[0], my], [b[0], my], b, p1]);
  }
  if (!horizontal(s0) && !horizontal(s1)) {
    const forward = dy0 * (p1[1] - p0[1]) > 0 && dy1 * (p0[1] - p1[1]) > 0;
    if (forward) {
      if (p0[0] === p1[0] && bend === undefined) return [p0, p1];
      const my = bend ?? (p0[1] + p1[1]) / 2;
      return simplify([p0, [p0[0], my], [p1[0], my], p1]);
    }
    const mx = bend ?? (p0[0] === p1[0] ? p0[0] + 2 : (p0[0] + p1[0]) / 2);
    return simplify([p0, a, [mx, a[1]], [mx, b[1]], b, p1]);
  }
  // One horizontal, one vertical: a single bend if it lies in front of both pins.
  if (horizontal(s0)) {
    const corner: Pt = [p1[0], p0[1]];
    if (dx0 * (corner[0] - p0[0]) >= 0 && dy1 * (corner[1] - p1[1]) >= 0) return simplify([p0, corner, p1]);
    return simplify([p0, a, [a[0], b[1]], b, p1]);
  }
  const corner: Pt = [p0[0], p1[1]];
  if (dy0 * (corner[1] - p0[1]) >= 0 && dx1 * (corner[0] - p1[0]) >= 0) return simplify([p0, corner, p1]);
  return simplify([p0, a, [b[0], a[1]], b, p1]);
}

export function pathD(points: readonly Pt[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
}

/** Distance from point to an axis-aligned polyline. */
export function distToPolyline(x: number, y: number, pts: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = Math.max(Math.min(x, Math.max(x0, x1)), Math.min(x0, x1));
    const cy = Math.max(Math.min(y, Math.max(y0, y1)), Math.min(y0, y1));
    best = Math.min(best, Math.hypot(x - cx, y - cy));
  }
  return best;
}
