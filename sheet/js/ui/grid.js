// Virtualized grid: only the visible window of cells exists in the DOM.
//
// Layout inside the scrolling viewport (native scrolling, so iOS momentum works):
//   .sheet-canvas   full-size box that gives the scrollbars their range
//     .colhdr       position: sticky; top: 0      (column letters + corner)
//     .rowhdr       position: sticky; left: 0     (row numbers)
//     .cells-layer  gridlines, cell divs, selection overlays for the visible window

import { colToName } from '../engine/address.js';
import { DEFAULT_COL_WIDTH } from '../engine/workbook.js';

const OVERSCAN_ROWS = 8;
const OVERSCAN_COLS = 3;

// Dark ink on light fills, light ink on dark ones.
const inkCache = new Map();
function inkFor(hex) {
  let ink = inkCache.get(hex);
  if (ink) return ink;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  ink = L > 0.4 ? '#202124' : '#f1f3f4';
  inkCache.set(hex, ink);
  return ink;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class Grid {
  constructor(ctrl, els) {
    this.ctrl = ctrl;
    this.els = els;
    this.coarse = matchMedia('(pointer: coarse)').matches;
    this.ROW_H = this.coarse ? 28 : 24;
    this.HDR_H = this.coarse ? 28 : 24;
    this.HDR_W = this.coarse ? 40 : 46;
    this._colCache = null;
    this._rowCache = null;
    this.measureCtx = document.createElement('canvas').getContext('2d');
    this.fillDrag = null;
    this.bind();
  }

  // ---------- geometry ----------

  get sheet() { return this.ctrl.sheet; }

  cols() {
    const s = this.sheet;
    const key = `${s.id}|${s.colCount}|${this.ctrl.wb.version}`;
    if (this._colCache?.key === key) return this._colCache;
    const x = new Float64Array(s.colCount + 1);
    for (let c = 0; c < s.colCount; c++) x[c + 1] = x[c] + s.colWidth(c);
    this._colCache = { key, x };
    return this._colCache;
  }

  // Rows have a default height; custom heights are a sparse sorted list with prefix sums.
  rows() {
    const s = this.sheet;
    const key = `${s.id}|${this.ctrl.wb.version}|${this.ROW_H}`;
    if (this._rowCache?.key === key) return this._rowCache;
    const custom = [...s.rowHeights.entries()].sort((a, b) => a[0] - b[0]);
    const idx = custom.map(([r]) => r);
    const extra = new Float64Array(custom.length + 1); // extra[k] = sum of (h - ROW_H) for first k custom rows
    custom.forEach(([, h], k) => { extra[k + 1] = extra[k] + (this.scaleRow(h) - this.ROW_H); });
    const heights = new Map(custom.map(([r, h]) => [r, this.scaleRow(h)]));
    this._rowCache = { key, idx, extra, heights };
    return this._rowCache;
  }

  scaleRow(h) {
    // Stored heights are desktop pixels; touch rows are a bit taller.
    return Math.round(h * (this.ROW_H / 24));
  }

  colX(c) { return this.cols().x[Math.min(c, this.sheet.colCount)] ?? 0; }
  colW(c) { return this.sheet.colWidth(c); }
  rowH(r) { return this.rows().heights.get(r) ?? this.ROW_H; }
  rowY(r) {
    const { idx, extra } = this.rows();
    let lo = 0, hi = idx.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (idx[m] < r) lo = m + 1; else hi = m; }
    return r * this.ROW_H + extra[lo];
  }
  totalW() { return this.colX(this.sheet.colCount); }
  totalH() { return this.rowY(this.sheet.rowCount); }

  colAt(x) {
    const { x: xs } = this.cols();
    const n = this.sheet.colCount;
    if (x <= 0) return 0;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (xs[m] <= x) lo = m; else hi = m - 1; }
    return Math.min(lo, n - 1);
  }
  rowAt(y) {
    if (y <= 0) return 0;
    let lo = 0, hi = this.sheet.rowCount - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.rowY(m) <= y) lo = m; else hi = m - 1; }
    return lo;
  }

  // Cell rectangle relative to the grid area element (for the editor and popups).
  cellBox(r, c) {
    const vp = this.els.viewport;
    return {
      left: this.HDR_W + this.colX(c) - vp.scrollLeft,
      top: this.HDR_H + this.rowY(r) - vp.scrollTop,
      width: this.colW(c),
      height: this.rowH(r)
    };
  }

  scrollIntoView(r, c) {
    const vp = this.els.viewport;
    const x = this.colX(c), w = this.colW(c), y = this.rowY(r), h = this.rowH(r);
    const viewW = vp.clientWidth - this.HDR_W, viewH = vp.clientHeight - this.HDR_H;
    if (x < vp.scrollLeft) vp.scrollLeft = x;
    else if (x + w > vp.scrollLeft + viewW) vp.scrollLeft = Math.min(x, x + w - viewW);
    if (y < vp.scrollTop) vp.scrollTop = y;
    else if (y + h > vp.scrollTop + viewH) vp.scrollTop = Math.min(y, y + h - viewH);
  }

  // Grow the virtual sheet as the user scrolls towards its end.
  maybeGrow() {
    const vp = this.els.viewport;
    const s = this.sheet;
    let grew = false;
    if (vp.scrollTop + vp.clientHeight * 3 > this.totalH() && s.rowCount < 1048576) {
      s.rowCount = Math.min(1048576, s.rowCount + 200);
      grew = true;
    }
    if (vp.scrollLeft + vp.clientWidth * 2 > this.totalW() && s.colCount < 16384) {
      s.colCount = Math.min(16384, s.colCount + 10);
      this._colCache = null;
      grew = true;
    }
    return grew;
  }

  // ---------- rendering ----------

  render() {
    const { viewport, canvas, colhdr, rowhdr, layer } = this.els;
    const ctrl = this.ctrl;
    const sheet = this.sheet;
    const wb = ctrl.wb;
    this.maybeGrow();
    const W = this.totalW(), H = this.totalH();
    canvas.style.width = `${this.HDR_W + W}px`;
    canvas.style.height = `${this.HDR_H + H}px`;
    rowhdr.style.height = `${H}px`;
    layer.style.width = `${W}px`;
    layer.style.height = `${H}px`;
    layer.style.left = `${this.HDR_W}px`;
    layer.style.top = `${this.HDR_H}px`;

    const sl = viewport.scrollLeft, st = viewport.scrollTop;
    const vw = viewport.clientWidth - this.HDR_W, vh = viewport.clientHeight - this.HDR_H;
    const r0 = Math.max(0, this.rowAt(st) - OVERSCAN_ROWS);
    const r1 = Math.min(sheet.rowCount - 1, this.rowAt(st + vh) + OVERSCAN_ROWS);
    const c0 = Math.max(0, this.colAt(sl) - OVERSCAN_COLS);
    const c1 = Math.min(sheet.colCount - 1, this.colAt(sl + vw) + OVERSCAN_COLS);
    this.visible = { r0, r1, c0, c1 };

    const sel = ctrl.selRange();
    const fullCols = sel.r1 === 0 && sel.r2 >= sheet.rowCount - 1;
    const fullRows = sel.c1 === 0 && sel.c2 >= sheet.colCount - 1;

    // headers
    let h = '';
    for (let c = c0; c <= c1; c++) {
      const on = c >= sel.c1 && c <= sel.c2;
      h += `<div class="hc${on ? (fullCols ? ' sel full' : ' sel') : ''}" data-c="${c}" style="left:${this.HDR_W + this.colX(c)}px;width:${this.colW(c)}px">${colToName(c)}<span class="rz" data-rz="${c}"></span></div>`;
    }
    colhdr.querySelector('.hdr-cells').innerHTML = h;
    h = '';
    for (let r = r0; r <= r1; r++) {
      const on = r >= sel.r1 && r <= sel.r2;
      h += `<div class="hr${on ? (fullRows ? ' sel full' : ' sel') : ''}" data-r="${r}" style="top:${this.rowY(r)}px;height:${this.rowH(r)}px">${r + 1}<span class="rzr" data-rzr="${r}"></span></div>`;
    }
    rowhdr.querySelector('.hdr-cells').innerHTML = h;

    // gridlines for the window
    const gx = this.colX(c0), gy = this.rowY(r0);
    const gw = this.colX(c1 + 1) - gx, gh = this.rowY(r1 + 1) - gy;
    let lines = '';
    for (let c = c0; c <= c1; c++) lines += `<i class="vl" style="left:${this.colX(c + 1) - gx - 1}px"></i>`;
    for (let r = r0; r <= r1; r++) lines += `<i class="hl" style="top:${this.rowY(r + 1) - gy - 1}px"></i>`;
    const gl = layer.querySelector('.gridlines');
    gl.style.cssText = `left:${gx}px;top:${gy}px;width:${gw}px;height:${gh}px`;
    gl.innerHTML = lines;

    // cells
    let out = '';
    for (let r = r0; r <= r1; r++) {
      const y = this.rowY(r), rh = this.rowH(r);
      for (let c = c0; c <= c1; c++) {
        const cell = sheet.get(r, c);
        if (!cell) continue;
        const d = wb.getDisplay(sheet.id, r, c);
        const st = d.style || {};
        if (d.text === '' && !st.fill) continue;
        const x = this.colX(c), w = this.colW(c);
        const cls = ['cell', `a-${d.align}`];
        if (st.bold) cls.push('b');
        if (st.italic) cls.push('i');
        if (st.underline) cls.push('u');
        if (st.strike) cls.push('s');
        if (st.wrap) cls.push('wrap');
        if (d.error) cls.push('err');
        let style = `left:${x}px;top:${y}px;width:${w}px;height:${rh}px;`;
        if (st.fill) style += `background:${st.fill};`;
        // Text on a fill keeps its contrast in dark mode too.
        const color = d.color || st.color || (st.fill ? inkFor(st.fill) : null);
        if (color) style += `color:${color};`;
        let text = d.text;
        let spanW = w;
        if (text && !st.wrap) {
          const isNum = typeof cell.value === 'number';
          if (isNum) {
            this.measureCtx.font = `${st.bold ? '600 ' : ''}${st.italic ? 'italic ' : ''}13px ${this.fontFamily()}`;
            if (this.measureCtx.measureText(text).width > w - 6) text = '#'.repeat(Math.max(1, Math.floor((w - 6) / 7)));
          } else if (d.align === 'left') {
            // Text spills into empty neighbours on the right, like Excel.
            for (let k = c + 1; k <= Math.min(sheet.colCount - 1, c1 + 6); k++) {
              const n = sheet.get(r, k);
              if (n && n.input !== '') break;
              spanW += this.colW(k);
              if (spanW > 1600) break;
            }
          }
        }
        if (spanW > w) cls.push('spills');
        const title = d.error ? ` title="${esc(d.error)}"` : '';
        out += `<div class="${cls.join(' ')}" data-addr="${colToName(c)}${r + 1}" style="${style}"${title}><span${spanW > w ? ` class="spill" style="width:${spanW - 6}px"` : ''}>${esc(text)}</span></div>`;
      }
    }
    layer.querySelector('.cells').innerHTML = out;
    this.renderOverlays();
  }

  fontFamily() {
    if (!this._font) this._font = getComputedStyle(this.els.layer).fontFamily || 'sans-serif';
    return this._font;
  }

  // Overlay boxes cover the gridlines on all four sides of the range.
  rectStyle(rng) {
    const x = this.colX(rng.c1), y = this.rowY(rng.r1);
    const w = this.colX(Math.min(rng.c2, this.sheet.colCount - 1) + 1) - x, h = this.rowY(Math.min(rng.r2, this.sheet.rowCount - 1) + 1) - y;
    return `left:${x - 1}px;top:${y - 1}px;width:${w + 1}px;height:${h + 1}px`;
  }

  renderOverlays() {
    const ctrl = this.ctrl;
    const sel = ctrl.selRange();
    let o = '';
    // formula references while editing
    for (const ref of ctrl.editor.highlightRefs()) {
      o += `<div class="refbox" style="${this.rectStyle(ref.range)};--rc:${ref.color}"></div>`;
    }
    if (ctrl.clip && ctrl.clip.sheetId === ctrl.sheetId) {
      o += `<div class="marquee${ctrl.clip.cut ? ' cut' : ''}" style="${this.rectStyle(ctrl.clip.range)}"></div>`;
    }
    const multi = sel.r1 !== sel.r2 || sel.c1 !== sel.c2;
    if (multi) o += `<div class="selbox" style="${this.rectStyle(sel)}"></div>`;
    const a = ctrl.active();
    o += `<div class="active-cell${ctrl.editor.editing ? ' editing' : ''}" style="${this.rectStyle({ r1: a.r, c1: a.c, r2: a.r, c2: a.c })}"></div>`;
    if (this.fillDrag?.target) o += `<div class="fillprev" style="${this.rectStyle(this.fillDrag.target)}"></div>`;
    const layer = this.els.layer.querySelector('.overlays');
    if (!this.dyn) {
      this.dyn = document.createElement('div');
      this.dyn.className = 'ov-dyn';
      // One persistent handle element: re-creating it mid-drag would orphan the touch.
      this.handle = document.createElement('div');
      this.handle.className = `fill-handle${this.coarse ? ' touch' : ''}`;
      this.handle.title = this.coarse ? '拖动扩展选区' : '拖动填充';
      layer.replaceChildren(this.dyn, this.handle);
    }
    this.dyn.innerHTML = o;
    const hx = this.colX(Math.min(sel.c2, this.sheet.colCount - 1) + 1), hy = this.rowY(Math.min(sel.r2, this.sheet.rowCount - 1) + 1);
    this.handle.style.left = `${hx}px`;
    this.handle.style.top = `${hy}px`;
    this.handle.hidden = ctrl.editor.editing && !this.fillDrag;
  }

  // ---------- pointer input ----------

  hit(clientX, clientY) {
    const vp = this.els.viewport;
    const rect = vp.getBoundingClientRect();
    const vx = clientX - rect.left, vy = clientY - rect.top;
    if (vx < 0 || vy < 0 || vx > vp.clientWidth || vy > vp.clientHeight) return { kind: 'outside', vx, vy };
    const x = vx - this.HDR_W + vp.scrollLeft, y = vy - this.HDR_H + vp.scrollTop;
    if (vx < this.HDR_W && vy < this.HDR_H) return { kind: 'corner' };
    if (vy < this.HDR_H) return { kind: 'col', c: this.colAt(x), x };
    if (vx < this.HDR_W) return { kind: 'row', r: this.rowAt(y), y };
    return { kind: 'cell', r: this.rowAt(y), c: this.colAt(x) };
  }

  // Cell under a point, clamped into the sheet (for drags that leave the viewport).
  cellAtClamped(clientX, clientY) {
    const vp = this.els.viewport;
    const rect = vp.getBoundingClientRect();
    const vx = Math.max(this.HDR_W + 1, Math.min(vp.clientWidth - 1, clientX - rect.left));
    const vy = Math.max(this.HDR_H + 1, Math.min(vp.clientHeight - 1, clientY - rect.top));
    return { r: this.rowAt(vy - this.HDR_H + vp.scrollTop), c: this.colAt(vx - this.HDR_W + vp.scrollLeft) };
  }

  bind() {
    const vp = this.els.viewport;
    vp.addEventListener('scroll', () => this.ctrl.onScroll(), { passive: true });
    vp.addEventListener('pointerdown', e => this.onPointerDown(e));
    vp.addEventListener('pointermove', e => this.onHover(e));
    vp.addEventListener('dblclick', e => {
      const t = e.target;
      if (t.dataset?.rz !== undefined) { this.ctrl.autoFitColumn(Number(t.dataset.rz)); return; }
      const h = this.hit(e.clientX, e.clientY);
      if (h.kind === 'cell') this.ctrl.onCellDoubleClick(h.r, h.c);
    });
    vp.addEventListener('contextmenu', e => {
      const h = this.hit(e.clientX, e.clientY);
      if (h.kind === 'outside') return;
      e.preventDefault();
      this.ctrl.onContextMenu(h, e.clientX, e.clientY);
    });
  }

  onHover(e) {
    if (e.pointerType !== 'mouse' || this.drag) return;
    const t = e.target;
    this.els.viewport.style.cursor = t.dataset?.rz !== undefined ? 'col-resize' : t.dataset?.rzr !== undefined ? 'row-resize' : '';
  }

  onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const t = e.target;
    const ctrl = this.ctrl;

    if (t.classList.contains('fill-handle')) {
      e.preventDefault();
      e.stopPropagation();
      this.startFillDrag(e);
      return;
    }
    if (t.dataset?.rz !== undefined) { e.preventDefault(); this.startResize(e, 'col', Number(t.dataset.rz)); return; }
    if (t.dataset?.rzr !== undefined) { e.preventDefault(); this.startResize(e, 'row', Number(t.dataset.rzr)); return; }

    const h = this.hit(e.clientX, e.clientY);
    if (h.kind === 'outside') return;

    if (e.pointerType === 'mouse') {
      e.preventDefault(); // keep focus where the controller wants it
      if (h.kind === 'corner') { ctrl.selectAll(); return; }
      const mode = h.kind === 'cell' ? ctrl.onCellDown(h.r, h.c, e)
        : h.kind === 'col' ? ctrl.onHeaderDown('col', h.c, e) : ctrl.onHeaderDown('row', h.r, e);
      if (!mode) return;
      this.startDrag(e, h.kind, mode);
      return;
    }

    // Touch / pen: wait to see whether this is a tap, a long press, or a scroll.
    // Taps are acted on in touchend: iOS only opens the keyboard for focus() calls made
    // there, and cancelling touchend stops the follow-up mouse events from stealing focus.
    const start = { x: e.clientX, y: e.clientY, t: Date.now(), h };
    let moved = false, pressed = false, tapPending = false, ended = false;
    let clickBlocker = null;
    const unblock = () => { if (clickBlocker) document.removeEventListener('click', clickBlocker, true); };
    const act = () => {
      if (h.kind === 'cell') ctrl.onCellTap(h.r, h.c);
      else if (h.kind === 'corner') ctrl.selectAll();
      else if (h.kind === 'col') ctrl.onHeaderDown('col', h.c, {});
      else if (h.kind === 'row') ctrl.onHeaderDown('row', h.r, {});
    };
    const longPress = setTimeout(() => {
      if (moved) return;
      pressed = true;
      // The menu opens under the finger; the click that ends this press must not pick an item.
      clickBlocker = ev => { ev.preventDefault(); ev.stopPropagation(); unblock(); };
      document.addEventListener('click', clickBlocker, true);
      // A new touch means the press is over, whether or not a click was generated.
      document.addEventListener('pointerdown', unblock, { capture: true, once: true });
      if (h.kind === 'cell' && !ctrl.inSelection(h.r, h.c)) ctrl.onCellTap(h.r, h.c, { quiet: true });
      ctrl.onContextMenu(h, start.x, start.y);
    }, 550);
    const move = ev => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 8) { moved = true; clearTimeout(longPress); }
    };
    const up = () => {
      cleanupPointer();
      if (clickBlocker) setTimeout(unblock, 400);
      // The matching touchend follows immediately; never let these listeners outlive the gesture.
      setTimeout(cleanupTouch, 300);
      if (moved || pressed) return;
      if (e.pointerType === 'pen') act();
      else tapPending = true;
    };
    // touchend goes to the original target even if a re-render detached it, so listen there too.
    const target = e.target;
    const cleanupTouch = () => {
      ended = true;
      window.removeEventListener('touchend', touchEnd, true);
      target.removeEventListener('touchend', touchEnd);
    };
    const touchEnd = ev => {
      if (ended) return;
      cleanupTouch();
      if (pressed) { ev.preventDefault(); return; }
      if (!tapPending) return;
      ev.preventDefault();
      act();
    };
    const cleanupPointer = () => {
      clearTimeout(longPress);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    const cancel = () => { moved = true; cleanupPointer(); setTimeout(cleanupTouch, 300); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    if (e.pointerType === 'touch') {
      window.addEventListener('touchend', touchEnd, { capture: true, passive: false });
      target.addEventListener('touchend', touchEnd, { passive: false });
    }
  }

  // Mouse drag: extend selection, or extend a pointed reference while editing.
  startDrag(e, kind, mode) {
    const ctrl = this.ctrl;
    this.drag = { kind, mode, x: e.clientX, y: e.clientY };
    const update = () => {
      const { x, y } = this.drag;
      const cell = this.cellAtClamped(x, y);
      if (kind === 'col') ctrl.onDrag(mode, { r: ctrl.sheet.rowCount - 1, c: cell.c }, 'col');
      else if (kind === 'row') ctrl.onDrag(mode, { r: cell.r, c: ctrl.sheet.colCount - 1 }, 'row');
      else ctrl.onDrag(mode, cell, 'cell');
    };
    const move = ev => { this.drag.x = ev.clientX; this.drag.y = ev.clientY; update(); };
    const timer = setInterval(() => {
      // auto-scroll while the pointer is beyond the edges
      const vp = this.els.viewport;
      const rect = vp.getBoundingClientRect();
      const { x, y } = this.drag;
      let dx = 0, dy = 0;
      if (x < rect.left + this.HDR_W) dx = -1; else if (x > rect.left + vp.clientWidth) dx = 1;
      if (y < rect.top + this.HDR_H) dy = -1; else if (y > rect.top + vp.clientHeight) dy = 1;
      if (kind === 'col') dy = 0;
      if (kind === 'row') dx = 0;
      if (dx || dy) { vp.scrollLeft += dx * 40; vp.scrollTop += dy * this.ROW_H; update(); }
    }, 50);
    const up = () => {
      clearInterval(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.drag = null;
      ctrl.onDragEnd(mode);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Fill handle (mouse) / selection handle (touch).
  startFillDrag(e) {
    const ctrl = this.ctrl;
    const src = ctrl.selRange();
    const touch = e.pointerType !== 'mouse';
    this.fillDrag = { src, target: null };
    const vp = this.els.viewport;
    vp.style.touchAction = 'none';
    const move = ev => {
      const cell = this.cellAtClamped(ev.clientX, ev.clientY);
      if (touch) {
        ctrl.extendTo(cell.r, cell.c);
        return;
      }
      // Fill extends along one axis: whichever the pointer has gone further in.
      const down = cell.r > src.r2 ? cell.r - src.r2 : cell.r < src.r1 ? cell.r - src.r1 : 0;
      const right = cell.c > src.c2 ? cell.c - src.c2 : cell.c < src.c1 ? cell.c - src.c1 : 0;
      let target = null;
      if (Math.abs(down) >= Math.abs(right) && down) target = down > 0 ? { ...src, r2: cell.r } : { ...src, r1: cell.r };
      else if (right) target = right > 0 ? { ...src, c2: cell.c } : { ...src, c1: cell.c };
      this.fillDrag.target = target;
      this.renderOverlays();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      vp.style.touchAction = '';
      const { target } = this.fillDrag;
      this.fillDrag = null;
      if (target) ctrl.fill(src, target);
      else this.renderOverlays();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  startResize(e, axis, index) {
    const ctrl = this.ctrl;
    const startPos = axis === 'col' ? e.clientX : e.clientY;
    const startSize = axis === 'col' ? this.colW(index) : this.sheet.rowHeights.get(index) ?? 24;
    const scale = axis === 'col' ? 1 : 24 / this.ROW_H;
    let size = startSize;
    const guide = document.createElement('div');
    guide.className = `resize-guide ${axis}`;
    this.els.layer.appendChild(guide);
    const place = () => {
      if (axis === 'col') guide.style.left = `${this.colX(index) + size}px`;
      else guide.style.top = `${this.rowY(index) + size / scale}px`;
    };
    place();
    const move = ev => {
      const d = (axis === 'col' ? ev.clientX : ev.clientY) - startPos;
      size = Math.max(axis === 'col' ? 24 : 16, startSize + d * scale);
      place();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      guide.remove();
      if (Math.round(size) !== Math.round(startSize)) {
        if (axis === 'col') ctrl.resizeColumns(index, size);
        else ctrl.resizeRows(index, size);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Widest displayed text in a column, for double-click auto-fit.
  measureColumn(c) {
    const sheet = this.sheet;
    let max = 0;
    const b = sheet.bounds();
    for (let r = 0; r <= b.maxRow; r++) {
      const cell = sheet.get(r, c);
      if (!cell || cell.input === '') continue;
      const d = this.ctrl.wb.getDisplay(sheet.id, r, c);
      this.measureCtx.font = `${d.style?.bold ? '600 ' : ''}13px ${this.fontFamily()}`;
      max = Math.max(max, this.measureCtx.measureText(d.text).width);
    }
    return max ? Math.ceil(max + 14) : DEFAULT_COL_WIDTH;
  }
}
