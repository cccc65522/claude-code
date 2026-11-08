// Editing tools. Each tool gets pointer events in world coordinates ({x, y}, plus screen {sx, sy}) and works
// through the app's editing API, which takes care of undo, level rules and saving.

import { strokeToShape, centroid } from '../engine/geometry.js';
import { flat } from '../engine/scene.js';

export const TOOL_ORDER = ['hand', 'draw', 'box', 'circle', 'pin', 'motor', 'weld', 'spring', 'rope', 'eraser', 'bomb'];

export const TOOL_INFO = {
  hand: { name: '拖动', tip: '拖动物体；运行时可以抓住物体甩出去。拖空白处移动视图' },
  draw: { name: '画笔', tip: '随手画：首尾相接是实心形状，不闭合是一根线' },
  box: { name: '方块', tip: '拖出一个矩形；点一下放一个 1 米的方块' },
  circle: { name: '圆', tip: '从圆心往外拖；点一下放一个球' },
  pin: { name: '钉子', tip: '点在两个重叠的物体上把它们钉在一起（能转动）；只点一个物体就钉在背景上' },
  motor: { name: '马达', tip: '像钉子一样，但会一直转。点在轮子中心' },
  weld: { name: '粘合', tip: '把两个重叠的物体粘死；只点一个就固定在背景上' },
  spring: { name: '弹簧', tip: '从一点拖到另一点。端点在物体上就连物体，在空白处就连背景' },
  rope: { name: '绳子', tip: '从一点拖到另一点，做一根绳子' },
  eraser: { name: '橡皮', tip: '点或划过要删除的东西；可以剪断绳子' },
  bomb: { name: '爆炸', tip: '点一下，把周围的东西炸开' }
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r4 = x => Math.round(x * 1e4) / 1e4;

export function makeTools(app) {
  const tools = {};
  const scale = () => app.camera.scale;

  tools.hand = {
    down(e) {
      this.mode = null;
      this.moved = false;
      this.last = e;
      const j = app.pickJoint(e.sx, e.sy);
      if (j) {
        app.select({ joint: j });
        this.mode = 'none';
        return;
      }
      const b = app.pickBody(e.x, e.y);
      if (!b) {
        app.select(null);
        this.mode = 'pan';
        return;
      }
      app.select({ body: b });
      if (app.levelRunning) { this.mode = 'pan'; return; }
      if (app.running && !b.isStatic) {
        this.mouse = app.world.createJoint({ type: 'mouse', bodyB: b, localB: b.toLocal(e.x, e.y), target: { x: e.x, y: e.y }, maxForce: 800 * b.mass * Math.max(1, Math.hypot(app.world.gravity.x, app.world.gravity.y) / 10) });
        this.mode = 'drag';
        app.setDragging(true);
      } else if (app.editable(b)) {
        this.mode = 'move';
        this.start = e;
        this.group = app.connectedGroup(b).map(body => ({ body, x: body.x, y: body.y }));
        this.anchors = [];
        for (const { body } of this.group) {
          for (const jt of body.joints) {
            const other = jt.bodyA === body ? jt.bodyB : jt.bodyA;
            if (other === app.world.ground) {
              const local = jt.bodyA === app.world.ground ? jt.localA : jt.localB;
              this.anchors.push({ local, x: local.x, y: local.y });
            }
          }
        }
        app.setDragging(true);
      } else this.mode = 'pan';
    },
    move(e) {
      if (this.mode === 'pan') {
        app.camera.pan(e.sx - this.last.sx, e.sy - this.last.sy);
        app.invalidate();
      } else if (this.mode === 'drag' && this.mouse) {
        this.mouse.target.x = e.x;
        this.mouse.target.y = e.y;
        app.world.wake(this.mouse.bodyB);
      } else if (this.mode === 'move') {
        if (!this.moved) {
          if (Math.hypot(e.sx - this.start.sx, e.sy - this.start.sy) < 3) return;
          app.beginEdit();
          this.moved = true;
        }
        const dx = e.x - this.start.x, dy = e.y - this.start.y;
        for (const g of this.group) g.body.setTransform(g.x + dx, g.y + dy, g.body.angle);
        for (const a of this.anchors) { a.local.x = a.x + dx; a.local.y = a.y + dy; }
        app.invalidate();
      }
      this.last = e;
    },
    up() {
      if (this.mouse) {
        app.world.destroyJoint(this.mouse);
        this.mouse = null;
      }
      if (this.mode === 'move' && this.moved) {
        const problem = app.checkMove(this.group.map(g => g.body));
        if (problem) {
          for (const g of this.group) g.body.setTransform(g.x, g.y, g.body.angle);
          for (const a of this.anchors) { a.local.x = a.x; a.local.y = a.y; }
          app.toast(problem);
          app.dropEdit();
        } else app.committed();
      }
      app.setDragging(false);
      this.mode = null;
    },
    cancel() {
      this.up();
    }
  };

  tools.draw = {
    down(e) {
      this.pts = [{ x: e.x, y: e.y }];
      app.preview = { stroke: this.pts, color: app.shapeColor(), width: 0.2 };
    },
    move(e) {
      if (!this.pts) return;
      const last = this.pts[this.pts.length - 1];
      if (dist(last, e) * scale() < 2.5) return;
      this.pts.push({ x: e.x, y: e.y });
      let length = 0;
      for (let i = 1; i < this.pts.length; i++) length += dist(this.pts[i - 1], this.pts[i]);
      app.preview.closing = length * scale() > 90 && dist(this.pts[0], e) * scale() < 26;
      app.invalidate();
    },
    up() {
      const pts = this.pts;
      this.pts = null;
      app.preview = null;
      if (!pts) return;
      const s = scale();
      const shape = strokeToShape(pts, { tol: 2.5 / s, closeDist: Math.max(26 / s, 0.1), minArea: Math.max(0.01, 60 / (s * s)), minLength: Math.max(0.15, 12 / s) });
      if (!shape) {
        app.toast('画得太小了，再画大一点');
        app.invalidate();
        return;
      }
      let spec;
      if (shape.kind === 'poly') {
        const c = centroid(shape.pts);
        spec = { shape: { t: 'poly', pts: flat(shape.pts.map(p => ({ x: p.x - c.x, y: p.y - c.y }))) }, x: r4(c.x), y: r4(c.y), a: 0 };
        if (shape.hull) app.toast('线条交叉了，按外轮廓做成了凸形');
      } else {
        let cx = 0, cy = 0;
        for (const p of shape.pts) { cx += p.x; cy += p.y; }
        cx /= shape.pts.length; cy /= shape.pts.length;
        spec = { shape: { t: 'line', pts: flat(shape.pts.map(p => ({ x: p.x - cx, y: p.y - cy }))), w: 0.2 }, x: r4(cx), y: r4(cy), a: 0 };
      }
      app.addShape(spec);
    },
    cancel() {
      this.pts = null;
      app.preview = null;
    }
  };

  tools.box = {
    down(e) {
      this.p0 = { x: e.x, y: e.y };
      this.p1 = this.p0;
    },
    move(e) {
      if (!this.p0) return;
      this.p1 = { x: e.x, y: e.y };
      app.preview = { box: { x0: this.p0.x, y0: this.p0.y, x1: e.x, y1: e.y }, color: app.shapeColor() };
      app.invalidate();
    },
    up() {
      const { p0, p1 } = this;
      this.p0 = null;
      app.preview = null;
      if (!p0) return;
      let w = Math.abs(p1.x - p0.x), hgt = Math.abs(p1.y - p0.y);
      let cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
      if (Math.max(w, hgt) * scale() < 8) { w = 1; hgt = 1; cx = p0.x; cy = p0.y; }
      else if (Math.min(w, hgt) < 0.06) { app.toast('太扁了'); app.invalidate(); return; }
      app.addShape({ shape: { t: 'box', w: r4(w), h: r4(hgt) }, x: r4(cx), y: r4(cy), a: 0 });
    },
    cancel() {
      this.p0 = null;
      app.preview = null;
    }
  };

  tools.circle = {
    down(e) {
      this.c = { x: e.x, y: e.y };
      this.r = 0;
    },
    move(e) {
      if (!this.c) return;
      this.r = dist(this.c, e);
      app.preview = { circle: { x: this.c.x, y: this.c.y, r: this.r }, color: app.shapeColor() };
      app.invalidate();
    },
    up() {
      const { c } = this;
      let r = this.r;
      this.c = null;
      app.preview = null;
      if (!c) return;
      if (r * scale() < 8) r = 0.5;
      else if (r < 0.04) { app.toast('太小了'); app.invalidate(); return; }
      app.addShape({ shape: { t: 'circle', r: r4(r) }, x: r4(c.x), y: r4(c.y), a: 0 });
    },
    cancel() {
      this.c = null;
      app.preview = null;
    }
  };

  // Tap tools: act on release if the pointer didn't travel.
  const tap = act => ({
    down(e) { this.start = e; },
    move() {},
    up(e) {
      if (!this.start) return;
      const moved = Math.hypot(e.sx - this.start.sx, e.sy - this.start.sy);
      this.start = null;
      if (moved < 12) act(e);
    },
    cancel() { this.start = null; }
  });

  const pinLike = kind => tap(e => {
    const bodies = app.bodiesAt(e.x, e.y);
    const ground = app.world.ground;
    if (!bodies.length) {
      app.toast(kind === 'weld' ? '点在物体上才能粘' : '点在物体上才能钉');
      return;
    }
    let B = bodies[0], A = bodies[1] || ground;
    if (B.isStatic && !A.isStatic && A !== ground) [A, B] = [B, A];
    if (B.isStatic && (A === ground || A.isStatic)) {
      app.toast('这个物体本来就是固定的');
      return;
    }
    const la = A.toLocal(e.x, e.y), lb = B.toLocal(e.x, e.y);
    const spec = { t: kind === 'weld' ? 'weld' : 'pin', la: [r4(la.x), r4(la.y)], lb: [r4(lb.x), r4(lb.y)], ref: B.angle - A.angle };
    if (kind === 'motor') {
      spec.motor = { s: -6, t: Math.max(10, Math.min(20000, Math.round(25 * (A.mass + B.mass)))) };
    }
    app.addJoint(spec, A, B, kind);
  });

  tools.pin = pinLike('pin');
  tools.motor = pinLike('motor');
  tools.weld = pinLike('weld');

  // Two-point tools.
  const link = kind => ({
    down(e) {
      this.p0 = { x: e.x, y: e.y };
      this.A = app.bodiesAt(e.x, e.y)[0] || app.world.ground;
    },
    move(e) {
      if (!this.p0) return;
      this.p1 = { x: e.x, y: e.y };
      app.preview = { segment: { x0: this.p0.x, y0: this.p0.y, x1: e.x, y1: e.y, dash: kind === 'spring' } };
      app.invalidate();
    },
    up(e) {
      const p0 = this.p0, A = this.A;
      this.p0 = null;
      app.preview = null;
      app.invalidate();
      if (!p0) return;
      const p1 = { x: e.x, y: e.y };
      if (dist(p0, p1) * scale() < 14) {
        app.toast(kind === 'rope' ? '按住从一点拖到另一点来拉一根绳子' : '按住从一点拖到另一点来装弹簧');
        return;
      }
      const B = app.bodiesAt(e.x, e.y)[0] || app.world.ground;
      const ground = app.world.ground;
      if ((A === ground || A.isStatic) && (B === ground || B.isStatic)) {
        app.toast('至少要有一头连在能动的物体上');
        return;
      }
      if (A === B) {
        app.toast('两头连在了同一个物体上');
        return;
      }
      if (kind === 'rope') app.addRope(p0, A, p1, B);
      else {
        const la = A.toLocal(p0.x, p0.y), lb = B.toLocal(p1.x, p1.y);
        app.addJoint({ t: 'spring', la: [r4(la.x), r4(la.y)], lb: [r4(lb.x), r4(lb.y)], len: r4(dist(p0, p1)), hz: 3, z: 0.1 }, A, B, 'spring');
      }
    },
    cancel() {
      this.p0 = null;
      app.preview = null;
    }
  });

  tools.spring = link('spring');
  tools.rope = link('rope');

  tools.eraser = {
    down(e) {
      this.started = false;
      this.erase(e);
    },
    move(e) {
      this.erase(e);
      app.preview = { ring: { x: e.x, y: e.y, r: 10 / scale() } };
      app.invalidate();
    },
    erase(e) {
      const j = app.pickJoint(e.sx, e.sy, true);
      const b = j ? null : app.pickBody(e.x, e.y, true);
      if (!j && !b) return;
      if (!this.started) {
        app.beginEdit();
        this.started = true;
      }
      if (j) app.removeJoint(j);
      else app.removeBody(b);
      app.invalidate();
    },
    up() {
      app.preview = null;
      if (this.started) app.committed();
      this.started = false;
    },
    cancel() {
      this.up();
    }
  };

  tools.bomb = tap(e => app.explode(e.x, e.y));

  return tools;
}
