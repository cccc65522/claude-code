// Canvas renderer: grid, bodies (drawn from their outlines, not the convex pieces), joints, tool previews,
// level overlays, little effects, and an optional debug view of the engine's internals.

import { material } from '../engine/materials.js';

const TAU = Math.PI * 2;

export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return {
    bg: v('--stage-bg'), grid: v('--grid'), gridMajor: v('--grid-major'), ink: v('--ink'), muted: v('--muted'),
    static: v('--static'), staticEdge: v('--static-edge'), accent: v('--accent'), goal: v('--goal'), water: v('--water'),
    nodraw: v('--nodraw'), joint: v('--joint'), jointFill: v('--joint-fill'), dark: document.documentElement.dataset.theme === 'dark' ||
      (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  };
}

// Darken a #rrggbb colour.
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.dpr = 1;
    this.theme = null;
    this.effects = [];
    this.debug = false;
    this.edgeCache = new Map();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.camera.resize(r.width, r.height);
  }

  edgeColor(b) {
    if (!b.color) return material(b.mat).edge;
    let c = this.edgeCache.get(b.color);
    if (!c) { c = shade(b.color, 0.62); this.edgeCache.set(b.color, c); }
    return c;
  }

  // Transform the context so drawing happens in a body's local coordinates (interpolated between steps).
  bodyTransform(b, alpha) {
    const cam = this.camera, ctx = this.ctx;
    const x = b.px + (b.x - b.px) * alpha, y = b.py + (b.y - b.py) * alpha, a = b.pa + (b.angle - b.pa) * alpha;
    const s = cam.scale;
    const c = Math.cos(a), sn = Math.sin(a);
    const sx = (x - cam.x) * s + cam.width / 2, sy = cam.height / 2 - (y - cam.y) * s;
    // local (lx, ly) → screen: [c −s; −s −c]·(lx, ly)·scale + (sx, sy), with y flipped
    ctx.setTransform(this.dpr * s * c, -this.dpr * s * sn, -this.dpr * s * sn, -this.dpr * s * c, this.dpr * sx, this.dpr * sy);
  }

  shapePath(spec) {
    const ctx = this.ctx;
    ctx.beginPath();
    switch (spec.t) {
      case 'circle': ctx.arc(0, 0, spec.r, 0, TAU); break;
      case 'box': ctx.rect(-spec.w / 2, -spec.h / 2, spec.w, spec.h); break;
      case 'poly': {
        const p = spec.pts;
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.closePath();
        break;
      }
      case 'line': {
        const p = spec.pts;
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        break;
      }
    }
  }

  drawBody(b, alpha, highlight) {
    const ctx = this.ctx, th = this.theme, spec = b.shapeSpec;
    const px = 1 / this.camera.scale; // one screen pixel in local units
    this.bodyTransform(b, alpha);
    const mat = material(b.mat);
    const fill = b.isStatic ? th.static : b.color || mat.color;
    const edge = b.isStatic ? th.staticEdge : this.edgeColor(b);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (b.tag === 'link' && spec.t === 'box' && spec.h <= 0.15) {
      // thin rope links: draw as one continuous cord
      ctx.beginPath();
      ctx.moveTo(-spec.w / 2, 0);
      ctx.lineTo(spec.w / 2, 0);
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.max(spec.h * 1.15, 2.2 * px);
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(spec.h * 0.6, 1.2 * px);
      ctx.stroke();
      if (highlight) this.highlightPath(spec, px, b);
      return;
    }
    if (spec.t === 'line') {
      this.shapePath(spec);
      ctx.strokeStyle = edge;
      ctx.lineWidth = spec.w;
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(spec.w - 3 * px, spec.w * 0.4);
      ctx.stroke();
    } else {
      this.shapePath(spec);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.min(1.6 * px, 0.08);
      ctx.stroke();
      if (spec.t === 'circle') {
        // a mark so rotation is visible
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(spec.r * 0.92, 0);
        ctx.lineWidth = Math.min(1.6 * px, spec.r * 0.15);
        ctx.stroke();
      }
      if (b.mat === 'ice' && !b.isStatic) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        const r = spec.t === 'circle' ? spec.r * 0.55 : Math.min(spec.w || 1, spec.h || 1) * 0.3;
        ctx.moveTo(-r, r * 0.4); ctx.lineTo(-r * 0.3, r);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (b.tag === 'ball') {
      // the level's ball gets a face so it's easy to spot
      ctx.fillStyle = '#ffffff';
      const r = spec.r || 0.3;
      ctx.beginPath();
      ctx.arc(r * 0.32, r * 0.25, r * 0.2, 0, TAU);
      ctx.arc(-r * 0.32, r * 0.25, r * 0.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2a2a30';
      ctx.beginPath();
      ctx.arc(r * 0.36, r * 0.22, r * 0.09, 0, TAU);
      ctx.arc(-r * 0.28, r * 0.22, r * 0.09, 0, TAU);
      ctx.fill();
    }
    if (highlight) this.highlightPath(spec, px, b);
  }

  highlightPath(spec, px, b) {
    const ctx = this.ctx;
    if (b.tag === 'link' && spec.t === 'box') {
      ctx.beginPath();
      ctx.rect(-spec.w / 2, -spec.h / 2, spec.w, spec.h);
    } else this.shapePath(spec);
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = (spec.t === 'line' ? spec.w + 5 * px : 3 * px);
    ctx.globalAlpha = spec.t === 'line' ? 0.45 : 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  screenTransform() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  // Joint anchor positions in screen space (interpolated with the bodies).
  anchorScreen(j, which, alpha) {
    const b = which === 'a' ? j.bodyA : j.bodyB, l = which === 'a' ? j.localA : j.localB;
    const x = b.px + (b.x - b.px) * alpha, y = b.py + (b.y - b.py) * alpha, a = b.pa + (b.angle - b.pa) * alpha;
    const c = Math.cos(a), s = Math.sin(a);
    return this.camera.toScreen(x + c * l.x - s * l.y, y + s * l.x + c * l.y);
  }

  drawJoint(j, alpha, selected, time) {
    if (j.kind === 'rope') return;
    if (j.rope) {
      // a rope end tied to the background or to something fixed gets a small anchor
      if (j.bodyA.isStatic || j.bodyB.isStatic) {
        const p = this.anchorScreen(j, 'b', alpha);
        this.ctx.fillStyle = this.theme.jointFill;
        this.ctx.strokeStyle = this.theme.joint;
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath(); this.ctx.arc(p.x, p.y, 3.5, 0, TAU); this.ctx.fill(); this.ctx.stroke();
      }
      return;
    }
    const ctx = this.ctx, th = this.theme;
    if (j.type === 'mouse') {
      const a = this.anchorScreen(j, 'b', alpha), t = this.camera.toScreen(j.target.x, j.target.y);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = th.accent;
      ctx.beginPath(); ctx.arc(t.x, t.y, 3, 0, TAU); ctx.fill();
      return;
    }
    const a = this.anchorScreen(j, 'a', alpha), b = this.anchorScreen(j, 'b', alpha);
    if (j.kind === 'spring') {
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l, coils = 10, amp = Math.max(3, Math.min(8, this.camera.scale * 0.12));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      const lead = Math.min(10, l * 0.1);
      ctx.lineTo(a.x + dx / l * lead, a.y + dy / l * lead);
      for (let i = 0; i < coils * 2; i++) {
        const t = (lead + (l - 2 * lead) * (i + 0.5) / (coils * 2)) / l, side = i % 2 ? -1 : 1;
        ctx.lineTo(a.x + dx * t + nx * amp * side, a.y + dy * t + ny * amp * side);
      }
      ctx.lineTo(b.x - dx / l * lead, b.y - dy / l * lead);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = selected ? th.accent : th.joint;
      ctx.lineWidth = selected ? 2.5 : 1.6;
      ctx.stroke();
      this.dot(a, 3); this.dot(b, 3);
      return;
    }
    if (j.kind === 'rod') {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = selected ? th.accent : th.joint;
      ctx.lineWidth = selected ? 2.5 : 1.4;
      ctx.stroke();
      this.dot(a, 2.5);
      return;
    }
    const r = Math.max(4, Math.min(7, this.camera.scale * 0.1));
    if (j.kind === 'weld') {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(-(j.bodyB.angle));
      ctx.fillStyle = th.jointFill;
      ctx.strokeStyle = selected ? th.accent : th.joint;
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.beginPath(); ctx.rect(-r, -r, 2 * r, 2 * r); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.6); ctx.lineTo(r * 0.6, r * 0.6); ctx.moveTo(r * 0.6, -r * 0.6); ctx.lineTo(-r * 0.6, r * 0.6); ctx.stroke();
      ctx.restore();
      return;
    }
    // pin / motor
    ctx.fillStyle = th.jointFill;
    ctx.strokeStyle = selected ? th.accent : th.joint;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.35, 0, TAU); ctx.fillStyle = selected ? th.accent : th.joint; ctx.fill();
    if (j.enableMotor) {
      // a spinning arrow, in the direction of the motor (y flips the sense on screen)
      const dir = j.motorSpeed >= 0 ? -1 : 1, R = r + 5;
      const start = (time * Math.min(Math.abs(j.motorSpeed), 8) * dir) % TAU;
      ctx.beginPath();
      ctx.arc(b.x, b.y, R, start, start + dir * 4.2, dir < 0);
      ctx.strokeStyle = selected ? th.accent : '#e07b39';
      ctx.lineWidth = 2;
      ctx.stroke();
      const end = start + dir * 4.2;
      const ex = b.x + Math.cos(end) * R, ey = b.y + Math.sin(end) * R;
      const tx = -Math.sin(end) * dir, ty = Math.cos(end) * dir;
      ctx.beginPath();
      ctx.moveTo(ex + tx * 5, ey + ty * 5);
      ctx.lineTo(ex - ty * 3.5, ey + tx * 3.5);
      ctx.lineTo(ex + ty * 3.5, ey - tx * 3.5);
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
  }

  // Water: every drop as a disc, all in one path, filled once so overlaps merge into one body of water.
  drawWater(f, view) {
    if (!f || !f.n) return;
    const ctx = this.ctx, cam = this.camera, s = cam.scale;
    const R = Math.max(1.6, 0.85 * 0.13 * s), m = R / s;
    const ox = cam.width / 2 - cam.x * s, oy = cam.height / 2 + cam.y * s;
    ctx.beginPath();
    for (let i = 0; i < f.n; i++) {
      const x = f.x[i], y = f.y[i];
      if (x < view.minX - m || x > view.maxX + m || y < view.minY - m || y > view.maxY + m) continue;
      const sx = x * s + ox, sy = oy - y * s;
      ctx.moveTo(sx + R, sy);
      ctx.arc(sx, sy, R, 0, TAU);
    }
    ctx.fillStyle = this.theme.water;
    ctx.globalAlpha = 0.72;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  dot(p, r) {
    const ctx = this.ctx;
    ctx.fillStyle = this.theme.joint;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  }

  drawGrid() {
    const ctx = this.ctx, cam = this.camera, th = this.theme;
    const { minX, minY, maxX, maxY } = cam.bounds();
    let step = 1;
    while (step * cam.scale < 14) step *= 5;
    const major = step * 5;
    ctx.lineWidth = 1;
    for (const [s, color] of [[step, th.grid], [major, th.gridMajor]]) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = Math.ceil(minX / s) * s; x <= maxX; x += s) {
        const sx = Math.round(cam.toScreen(x, 0).x) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, cam.height);
      }
      for (let y = Math.ceil(minY / s) * s; y <= maxY; y += s) {
        const sy = Math.round(cam.toScreen(0, y).y) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(cam.width, sy);
      }
      ctx.stroke();
    }
  }

  // Rectangle in world coordinates → screen rect.
  rect(r) {
    const a = this.camera.toScreen(r.x - r.w / 2, r.y + r.h / 2);
    return { x: a.x, y: a.y, w: r.w * this.camera.scale, h: r.h * this.camera.scale };
  }

  drawLevel(level, time) {
    const ctx = this.ctx, th = this.theme;
    for (const z of level.noDraw || []) {
      const r = this.rect(z);
      ctx.save();
      ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      ctx.fillStyle = th.nodraw;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = th.nodraw;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let d = -r.h; d < r.w; d += 10) { ctx.moveTo(r.x + d, r.y + r.h); ctx.lineTo(r.x + d + r.h, r.y); }
      ctx.stroke();
      ctx.restore();
    }
    const g = level.goal;
    if (g) {
      const r = this.rect(g);
      const pulse = 0.5 + 0.5 * Math.sin(time * 3);
      ctx.fillStyle = th.goal;
      ctx.globalAlpha = 0.1 + 0.08 * pulse;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = th.goal;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.setLineDash([]);
      this.star(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.22, th.goal);
      ctx.globalAlpha = 1;
    }
  }

  star(cx, cy, R, color) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? R * 0.45 : R, a = -Math.PI / 2 + i * Math.PI / 5;
      ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Tool previews, in world coordinates.
  drawPreview(pv) {
    if (!pv) return;
    const ctx = this.ctx, cam = this.camera, th = this.theme;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const col = pv.color || th.ink;
    if (pv.stroke && pv.stroke.length) {
      ctx.beginPath();
      for (let i = 0; i < pv.stroke.length; i++) {
        const p = cam.toScreen(pv.stroke[i].x, pv.stroke[i].y);
        if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      }
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = Math.max(3, (pv.width || 0.2) * cam.scale);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (pv.closing) {
        const p = cam.toScreen(pv.stroke[0].x, pv.stroke[0].y);
        ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, TAU);
        ctx.strokeStyle = th.accent; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    if (pv.box) {
      const { x0, y0, x1, y1 } = pv.box;
      const a = cam.toScreen(Math.min(x0, x1), Math.max(y0, y1));
      ctx.fillStyle = col; ctx.globalAlpha = 0.5;
      ctx.fillRect(a.x, a.y, Math.abs(x1 - x0) * cam.scale, Math.abs(y1 - y0) * cam.scale);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5;
      ctx.strokeRect(a.x, a.y, Math.abs(x1 - x0) * cam.scale, Math.abs(y1 - y0) * cam.scale);
      this.label(`${Math.abs(x1 - x0).toFixed(1)} × ${Math.abs(y1 - y0).toFixed(1)} 米`, a.x, a.y - 8);
    }
    if (pv.circle) {
      const { x, y, r } = pv.circle;
      const c = cam.toScreen(x, y);
      ctx.beginPath(); ctx.arc(c.x, c.y, r * cam.scale, 0, TAU);
      ctx.fillStyle = col; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5; ctx.stroke();
      this.label(`半径 ${r.toFixed(2)} 米`, c.x - 30, c.y - r * cam.scale - 8);
    }
    if (pv.segment) {
      const a = cam.toScreen(pv.segment.x0, pv.segment.y0), b = cam.toScreen(pv.segment.x1, pv.segment.y1);
      ctx.setLineDash(pv.segment.dash ? [6, 5] : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
      ctx.setLineDash([]);
      this.dot(a, 4); this.dot(b, 4);
    }
    if (pv.ring) {
      const c = cam.toScreen(pv.ring.x, pv.ring.y);
      ctx.beginPath(); ctx.arc(c.x, c.y, pv.ring.r * cam.scale, 0, TAU);
      ctx.strokeStyle = col; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    }
  }

  label(text, x, y) {
    const ctx = this.ctx;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = this.theme.ink;
    ctx.globalAlpha = 0.8;
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1;
  }

  addEffect(e) {
    e.t0 = performance.now();
    this.effects.push(e);
    if (this.effects.length > 80) this.effects.shift();
  }

  drawEffects(now) {
    const ctx = this.ctx, cam = this.camera;
    this.effects = this.effects.filter(e => now - e.t0 < e.life);
    for (const e of this.effects) {
      const t = (now - e.t0) / e.life;
      const c = cam.toScreen(e.x, e.y);
      if (e.kind === 'boom') {
        ctx.beginPath();
        ctx.arc(c.x, c.y, e.r * cam.scale * (0.2 + 0.8 * t), 0, TAU);
        ctx.strokeStyle = '#f39c4a';
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 6 * (1 - t) + 1;
        ctx.stroke();
        ctx.fillStyle = '#f7c948';
        ctx.globalAlpha = 0.25 * (1 - t);
        ctx.fill();
      } else if (e.kind === 'spark') {
        ctx.fillStyle = e.color || '#f7c948';
        ctx.globalAlpha = 1 - t;
        for (let i = 0; i < e.n; i++) {
          const a = e.dir + (i - (e.n - 1) / 2) * 0.5;
          const d = (6 + 22 * t) * e.size;
          ctx.beginPath();
          ctx.arc(c.x + Math.cos(a) * d, c.y - Math.sin(a) * d, 2 * (1 - t) + 0.5, 0, TAU);
          ctx.fill();
        }
      } else if (e.kind === 'win') {
        for (let i = 0; i < 24; i++) {
          const a = i / 24 * TAU, d = 20 + 160 * t;
          ctx.fillStyle = ['#ef6461', '#f7c948', '#4f9de0', '#8fcf5f'][i % 4];
          ctx.globalAlpha = 1 - t;
          ctx.fillRect(c.x + Math.cos(a + t) * d, c.y + Math.sin(a + t) * d + 80 * t * t, 6, 6);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  drawDebug(world) {
    const ctx = this.ctx, cam = this.camera;
    ctx.lineWidth = 1;
    // convex pieces
    ctx.strokeStyle = 'rgba(80,140,255,0.7)';
    for (const b of world.bodies) {
      for (const f of b.fixtures) {
        ctx.beginPath();
        if (f.shape.type === 'circle') {
          const c = cam.toScreen(f.wx, f.wy);
          ctx.arc(c.x, c.y, f.shape.r * cam.scale, 0, TAU);
        } else {
          for (let i = 0; i < f.shape.n; i++) {
            const p = cam.toScreen(f.wv[2 * i], f.wv[2 * i + 1]);
            if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
          }
          ctx.closePath();
        }
        ctx.stroke();
      }
      if (!b.isStatic) {
        const c = cam.toScreen(b.cx, b.cy);
        ctx.fillStyle = b.awake ? '#2fbf71' : '#8a8f99';
        ctx.fillRect(c.x - 2, c.y - 2, 4, 4);
      }
    }
    // broad phase tree (fat boxes of the leaves)
    ctx.strokeStyle = 'rgba(200,120,255,0.35)';
    const nodes = world.tree.nodes;
    for (const n of nodes) {
      if (n.height !== 0 || !n.data) continue;
      const a = cam.toScreen(n.minX, n.maxY);
      ctx.strokeRect(a.x, a.y, (n.maxX - n.minX) * cam.scale, (n.maxY - n.minY) * cam.scale);
    }
    // contact points and normals
    for (const c of world.contacts) {
      if (!c.touching) continue;
      const m = c.m;
      for (let i = 0; i < m.count; i++) {
        const p = cam.toScreen(m.p[i].x, m.p[i].y);
        ctx.fillStyle = m.p[i].sep > 0.005 ? '#f7c948' : '#ef4444';
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
        ctx.strokeStyle = '#ef4444';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + m.nx * 10, p.y - m.ny * 10); ctx.stroke();
      }
    }
  }

  render(state) {
    const { world, alpha = 1, selection, preview, level, time = 0 } = state;
    if (!this.theme) this.theme = readTheme();
    const ctx = this.ctx, th = this.theme;
    this.screenTransform();
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, this.camera.width, this.camera.height);
    this.drawGrid();
    if (level) this.drawLevel(level, time);
    const view = this.camera.bounds();
    const pad = 2;
    for (const b of world.bodies) {
      if (b.fixtures.length) {
        const bb = b.bounds();
        if (bb.maxX < view.minX - pad || bb.minX > view.maxX + pad || bb.maxY < view.minY - pad || bb.minY > view.maxY + pad) continue;
      }
      this.drawBody(b, b.awake ? alpha : 1, selection && selection.body === b);
    }
    this.screenTransform();
    this.drawWater(world.fluid, view);
    for (const j of world.joints) this.drawJoint(j, alpha, selection && selection.joint === j, time);
    if (this.debug) this.drawDebug(world);
    this.drawPreview(preview);
    this.drawEffects(performance.now());
  }
}

