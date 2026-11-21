// Helpers for making scenes: a builder that produces scene JSON (used by the demos, levels and tests), and the
// rope recipe shared by the builder and the rope tool.

import { cosSin } from './math.js';
import { waterBlock } from './fluid.js';

const r4 = x => Math.round(x * 1e4) / 1e4;
const sq = x => x * x;

// World point → local point of a body spec (or of the background for null).
export function localOf(spec, x, y) {
  if (!spec) return [r4(x), r4(y)];
  const q = cosSin(spec.a || 0, {});
  const dx = x - spec.x, dy = y - spec.y;
  return [r4(q.c * dx + q.s * dy), r4(-q.s * dx + q.c * dy)];
}

export const ROPE_LINK = 0.3;
export const ROPE_WIDTH = 0.08;

// A rope from p1 to p2: link bodies, pins between them, and a length limit from end to end.
// `sag` bends the rope down in the middle (a parabola with that depth). Joint ends refer to 'start', 'end'
// or a link index; the caller maps them to bodies.
export function ropePieces(p1, p2, { sag = 0, link = ROPE_LINK, width = ROPE_WIDTH, mat = 'rope', col = null } = {}) {
  const span = Math.sqrt((p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y));
  if (span < 0.05) return null;
  // sample the curve finely, then cut it into equal-length links
  const curve = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    curve.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t - 4 * sag * t * (1 - t) });
  }
  let length = 0;
  for (let i = 1; i <= N; i++) length += Math.sqrt(sq(curve[i].x - curve[i - 1].x) + sq(curve[i].y - curve[i - 1].y));
  const n = Math.max(2, Math.round(length / link));
  const step = length / n;
  const pts = [curve[0]];
  let need = step, k = 1, prev = curve[0];
  while (pts.length < n && k <= N) {
    const c = curve[k];
    const seg = Math.sqrt(sq(c.x - prev.x) + sq(c.y - prev.y));
    if (seg >= need) {
      const t = need / seg;
      prev = { x: prev.x + (c.x - prev.x) * t, y: prev.y + (c.y - prev.y) * t };
      pts.push(prev);
      need = step;
    } else {
      need -= seg;
      prev = c;
      k++;
    }
  }
  pts.push(curve[N]);
  const bodies = [], joints = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const spec = { shape: { t: 'box', w: r4(l), h: width }, x: r4((a.x + b.x) / 2), y: r4((a.y + b.y) / 2), a: r4(angle), m: mat, tag: 'link' };
    if (col) spec.col = col;
    bodies.push(spec);
  }
  for (let i = 0; i <= bodies.length; i++) {
    const p = pts[i];
    const A = i === 0 ? 'start' : i - 1, B = i === bodies.length ? 'end' : i;
    joints.push({ t: 'pin', a: A, b: B, p, rope: i === 0 ? 2 : true });
  }
  joints.push({ t: 'rope', a: 'start', b: 'end', pa: p1, pb: p2, len: r4(length) });
  return { bodies, joints, length };
}

export class SceneBuilder {
  constructor() {
    this.bodies = [];
    this.joints = [];
  }

  add(spec) {
    spec.x = r4(spec.x);
    spec.y = r4(spec.y);
    spec.a = r4(spec.a || 0);
    this.bodies.push(spec);
    return this.bodies.length - 1;
  }

  box(x, y, w, h, opt = {}) {
    return this.add({ shape: { t: 'box', w, h }, x, y, a: opt.a || 0, m: opt.m || 'wood', ...extra(opt) });
  }

  ball(x, y, r, opt = {}) {
    return this.add({ shape: { t: 'circle', r }, x, y, a: opt.a || 0, m: opt.m || 'wood', ...extra(opt) });
  }

  // Polygon from world points (the body origin is placed at the first point's centroid-ish average).
  poly(points, opt = {}) {
    let cx = 0, cy = 0;
    for (const p of points) { cx += p[0]; cy += p[1]; }
    cx /= points.length; cy /= points.length;
    return this.add({ shape: { t: 'poly', pts: points.flatMap(p => [r4(p[0] - cx), r4(p[1] - cy)]) }, x: r4(cx), y: r4(cy), a: 0, m: opt.m || 'wood', ...extra(opt) });
  }

  // Thick polyline from world points.
  line(points, w = 0.2, opt = {}) {
    let cx = 0, cy = 0;
    for (const p of points) { cx += p[0]; cy += p[1]; }
    cx /= points.length; cy /= points.length;
    return this.add({ shape: { t: 'line', pts: points.flatMap(p => [r4(p[0] - cx), r4(p[1] - cy)]), w }, x: r4(cx), y: r4(cy), a: 0, m: opt.m || 'stone', ...extra(opt) });
  }

  spec(i) {
    return i < 0 ? null : this.bodies[i];
  }

  pin(a, b, x, y, opt = {}) {
    const j = { t: 'pin', a, b, la: localOf(this.spec(a), x, y), lb: localOf(this.spec(b), x, y), ref: r4((this.spec(b)?.a || 0) - (this.spec(a)?.a || 0)) };
    if (opt.motor) j.motor = opt.motor;
    if (opt.lim) j.lim = opt.lim;
    if (opt.rope) j.rope = opt.rope;
    this.joints.push(j);
    return j;
  }

  weld(a, b, x, y) {
    this.joints.push({ t: 'weld', a, b, la: localOf(this.spec(a), x, y), lb: localOf(this.spec(b), x, y), ref: r4((this.spec(b)?.a || 0) - (this.spec(a)?.a || 0)) });
  }

  spring(a, ax, ay, b, bx, by, opt = {}) {
    const len = opt.len ?? Math.sqrt(sq(bx - ax) + sq(by - ay));
    this.joints.push({ t: 'spring', a, b, la: localOf(this.spec(a), ax, ay), lb: localOf(this.spec(b), bx, by), len: r4(len), hz: opt.hz ?? 2, z: opt.z ?? 0.2 });
  }

  rod(a, ax, ay, b, bx, by) {
    const len = Math.sqrt(sq(bx - ax) + sq(by - ay));
    this.joints.push({ t: 'rod', a, b, la: localOf(this.spec(a), ax, ay), lb: localOf(this.spec(b), bx, by), len: r4(len) });
  }

  // Rope between two points on bodies a and b (−1 = background).
  rope(a, ax, ay, b, bx, by, opt = {}) {
    const pieces = ropePieces({ x: ax, y: ay }, { x: bx, y: by }, opt);
    const base = this.bodies.length;
    const rid = this.ropes = (this.ropes || 0) + 1;
    for (const s of pieces.bodies) { s.rid = rid; this.bodies.push(s); }
    const ref = r => (r === 'start' ? a : r === 'end' ? b : base + r);
    for (const j of pieces.joints) {
      const A = ref(j.a), B = ref(j.b);
      if (j.t === 'pin') this.pin(A, B, j.p.x, j.p.y, { rope: j.rope });
      else if (!(A < 0 && B < 0) && !(this.spec(A)?.fixed && this.spec(B)?.fixed) && !(A < 0 && this.spec(B)?.fixed) && !(B < 0 && this.spec(A)?.fixed)) {
        this.joints.push({ t: 'rope', a: A, b: B, la: localOf(this.spec(A), j.pa.x, j.pa.y), lb: localOf(this.spec(B), j.pb.x, j.pb.y), len: j.len, rid });
      }
    }
    return base;
  }

  // A rectangle filled with water.
  water(x0, y0, x1, y1) {
    this.drops = (this.drops || []).concat(waterBlock(x0, y0, x1, y1));
  }

  scene(extra = {}) {
    const s = { v: 1, g: [0, -10], bodies: this.bodies, joints: this.joints, ...extra };
    if (this.drops && this.drops.length) s.water = this.drops;
    return s;
  }
}

function extra(opt) {
  const o = {};
  if (opt.fixed) o.fixed = true;
  if (opt.tag) o.tag = opt.tag;
  if (opt.lock) o.lock = true;
  if (opt.col) o.col = opt.col;
  if (opt.v) o.v = opt.v;
  if (opt.w) o.w = opt.w;
  if (opt.sleep) o.sleep = true;
  if (opt.grp) o.grp = opt.grp;
  return o;
}
