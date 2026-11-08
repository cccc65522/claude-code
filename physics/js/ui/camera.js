// World ↔ screen mapping. The world is y-up and in metres; the screen is y-down and in CSS pixels.

export const MIN_SCALE = 4;
export const MAX_SCALE = 400;

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 5;
    this.scale = 40; // pixels per metre
    this.width = 1;
    this.height = 1;
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
  }

  toScreen(wx, wy, out = {}) {
    out.x = (wx - this.x) * this.scale + this.width / 2;
    out.y = this.height / 2 - (wy - this.y) * this.scale;
    return out;
  }

  toWorld(sx, sy, out = {}) {
    out.x = (sx - this.width / 2) / this.scale + this.x;
    out.y = (this.height / 2 - sy) / this.scale + this.y;
    return out;
  }

  // Show a region: centre (x, y) and at least `w` metres wide (and `h` tall when given).
  fit(view, insets = { top: 0, bottom: 0, left: 0, right: 0 }) {
    // a view may carry a separate framing for tall, narrow screens
    const portrait = view.portrait && this.width < this.height;
    const { x, y, w, h } = portrait ? view.portrait : view;
    const availW = Math.max(100, this.width - insets.left - insets.right);
    const availH = Math.max(100, this.height - insets.top - insets.bottom);
    let scale = availW / w;
    if (h) scale = Math.min(scale, availH / h);
    // on a tall phone screen, don't zoom out so far that things become tiny: allow cropping the sides
    const minScale = Math.min(availW, availH) / (w * 0.62);
    if (!portrait && availW < availH && scale < minScale && !h) scale = Math.min(minScale, availH / (w * 0.75));
    this.scale = clampScale(scale);
    // centre within the free area
    const ox = (insets.left - insets.right) / 2 / this.scale, oy = (insets.bottom - insets.top) / 2 / this.scale;
    this.x = x - ox;
    this.y = y - oy;
  }

  zoomAt(sx, sy, factor) {
    const before = this.toWorld(sx, sy);
    this.scale = clampScale(this.scale * factor);
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  pan(dx, dy) {
    this.x -= dx / this.scale;
    this.y += dy / this.scale;
  }

  // Visible world rectangle.
  bounds() {
    const a = this.toWorld(0, this.height), b = this.toWorld(this.width, 0);
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }
}

const clampScale = s => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
