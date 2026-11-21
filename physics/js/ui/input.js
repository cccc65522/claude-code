// Pointer input on the canvas: one finger / the left mouse button drives the current tool; two fingers pan
// and zoom; the mouse wheel zooms (trackpad scrolling pans); right or middle drag, or space + drag, pans.

export class Input {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.pointers = new Map();
    this.active = null; // pointer id driving the tool
    this.pinch = null;
    this.panning = null;
    this.space = false;
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e, true));
    canvas.addEventListener('lostpointercapture', e => { if (this.pointers.has(e.pointerId)) this.up(e, true); });
    canvas.addEventListener('wheel', e => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // Safari's own pinch gestures would zoom the page
    for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, e => e.preventDefault());
    addEventListener('keydown', e => { if (e.code === 'Space' && !isTyping(e)) this.space = true; });
    addEventListener('keyup', e => { if (e.code === 'Space') this.space = false; });
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const w = this.app.camera.toWorld(sx, sy);
    return { sx, sy, x: w.x, y: w.y, pointerType: e.pointerType, shift: e.shiftKey };
  }

  down(e) {
    this.app.sound.unlock();
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      // second finger: cancel whatever the first one started and start a pinch
      if (this.active != null) {
        this.app.toolCancel();
        this.active = null;
      }
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    if (e.button === 1 || e.button === 2 || (this.space && e.pointerType === 'mouse')) {
      this.panning = { id: e.pointerId, sx: p.sx, sy: p.sy };
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.active = e.pointerId;
    this.app.toolDown(p);
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pinch) { this.updatePinch(); return; }
    if (this.panning && this.panning.id === e.pointerId) {
      this.app.camera.pan(p.sx - this.panning.sx, p.sy - this.panning.sy);
      this.panning.sx = p.sx;
      this.panning.sy = p.sy;
      this.app.invalidate();
      return;
    }
    if (this.active === e.pointerId) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (events.length > 1) for (const ce of events) this.app.toolMove(this.local(ce));
      else this.app.toolMove(p);
    }
  }

  up(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    if (this.panning && this.panning.id === e.pointerId) {
      this.panning = null;
      return;
    }
    if (this.active === e.pointerId) {
      this.active = null;
      if (cancelled) this.app.toolCancel();
      else this.app.toolUp(p);
    }
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.pinch = { cx: (a.sx + b.sx) / 2, cy: (a.sy + b.sy) / 2, d: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1 };
  }

  updatePinch() {
    const [a, b] = [...this.pointers.values()];
    const cx = (a.sx + b.sx) / 2, cy = (a.sy + b.sy) / 2, d = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1;
    const cam = this.app.camera;
    cam.pan(cx - this.pinch.cx, cy - this.pinch.cy);
    cam.zoomAt(cx, cy, d / this.pinch.d);
    this.pinch = { cx, cy, d };
    this.app.invalidate();
  }

  wheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const cam = this.app.camera;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    // a mouse wheel scrolls in big integer steps; trackpads scroll in small ones (and pinch with ctrlKey)
    const mouseWheel = e.deltaMode !== 0 || (dx === 0 && Number.isInteger(dy) && Math.abs(dy) >= 50);
    if (e.ctrlKey || mouseWheel) cam.zoomAt(sx, sy, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
    else cam.pan(-dx, -dy);
    this.app.invalidate();
  }
}

export const isTyping = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
