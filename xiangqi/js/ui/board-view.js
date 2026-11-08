// The board: an SVG drawing underneath, pieces as absolutely positioned buttons on top
// (so moves animate with CSS transitions), and a mark layer for selection, legal-move
// dots, the last move and a hint arrow. Input is tap-tap or drag-and-drop.

import { sq, fileOf, rankOf, sideOf, typeOf, src, dst, RED } from '../engine/board.js';
import { pieceName } from '../engine/notation.js';

const M = 0.6;            // margin around the grid, in cells
const W = 8 + 2 * M;      // 9.2 cells
const H = 9 + 2 * M;      // 10.2 cells
const U = 100;            // SVG units per cell
const NS = 'http://www.w3.org/2000/svg';

function boardSvg() {
  const px = x => (M + x) * U, py = y => (M + y) * U;
  let s = `<svg viewBox="0 0 ${W * U} ${H * U}" class="grid" aria-hidden="true">`;
  s += `<rect x="${px(0) - 14}" y="${py(0) - 14}" width="${8 * U + 28}" height="${9 * U + 28}" class="frame"/>`;
  for (let y = 0; y < 10; y++) s += `<line x1="${px(0)}" y1="${py(y)}" x2="${px(8)}" y2="${py(y)}"/>`;
  for (let x = 0; x < 9; x++) {
    if (x === 0 || x === 8) s += `<line x1="${px(x)}" y1="${py(0)}" x2="${px(x)}" y2="${py(9)}"/>`;
    else s += `<line x1="${px(x)}" y1="${py(0)}" x2="${px(x)}" y2="${py(4)}"/><line x1="${px(x)}" y1="${py(5)}" x2="${px(x)}" y2="${py(9)}"/>`;
  }
  for (const [y0, y1] of [[0, 2], [7, 9]]) {
    s += `<line x1="${px(3)}" y1="${py(y0)}" x2="${px(5)}" y2="${py(y1)}"/><line x1="${px(5)}" y1="${py(y0)}" x2="${px(3)}" y2="${py(y1)}"/>`;
  }
  // Little corner marks where cannons and pawns start.
  const marks = [[1, 2], [7, 2], [1, 7], [7, 7], [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]];
  const g = 8, l = 18;
  for (const [x, y] of marks) {
    for (const dx of [-1, 1]) {
      if ((x === 0 && dx < 0) || (x === 8 && dx > 0)) continue;
      for (const dy of [-1, 1]) {
        const cx = px(x) + dx * g, cy = py(y) + dy * g;
        s += `<polyline points="${cx + dx * l},${cy} ${cx},${cy} ${cx},${cy + dy * l}" class="mark"/>`;
      }
    }
  }
  s += `<text x="${px(2)}" y="${py(4.5)}" class="river">楚 河</text><text x="${px(6)}" y="${py(4.5)}" class="river">漢 界</text>`;
  s += '</svg>';
  return s;
}

export class BoardView {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers; // { onTap(square), onDrop(from, to) -> bool, canDrag(square) -> bool }
    this.flipped = false;
    this.pieces = new Map(); // square -> element
    root.innerHTML = `${boardSvg()}<svg class="marks" viewBox="0 0 ${W * U} ${H * U}" aria-hidden="true"></svg><div class="pieces"></div>`;
    this.marks = root.querySelector('.marks');
    this.layer = root.querySelector('.pieces');
    this.state = { selected: null, targets: [], lastMove: 0, hint: 0, check: null };
    this.bindInput();
  }

  // Display coordinates for a board square (flipped when Black is at the bottom).
  disp(s) {
    const x = fileOf(s), y = rankOf(s);
    return this.flipped ? { x: 8 - x, y: 9 - y } : { x, y };
  }

  square(dx, dy) {
    return this.flipped ? sq(8 - dx, 9 - dy) : sq(dx, dy);
  }

  setFlipped(f) {
    if (this.flipped === f) return;
    this.flipped = f;
    this.root.classList.toggle('flipped', f);
    for (const [s, el] of this.pieces) this.place(el, s);
    this.renderMarks();
  }

  place(el, s) {
    const { x, y } = this.disp(s);
    el.style.setProperty('--x', x);
    el.style.setProperty('--y', y);
    el.dataset.sq = s;
  }

  makePiece(pc, s) {
    const el = document.createElement('div');
    el.className = `piece ${sideOf(pc) === RED ? 'red' : 'black'}`;
    el.dataset.pc = pc;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${sideOf(pc) === RED ? '红' : '黑'}${pieceName(pc)}`);
    el.innerHTML = `<span>${pieceName(pc)}</span>`;
    this.place(el, s);
    return el;
  }

  // Show `pos`. When `mv` is the move that led here, slide that piece instead of redrawing.
  setPosition(pos, { mv = 0, animate = true } = {}) {
    const squares = pos.squares;
    if (mv && animate && this.pieces.has(src(mv))) {
      const el = this.pieces.get(src(mv));
      const victim = this.pieces.get(dst(mv));
      if (victim) {
        victim.classList.add('captured');
        setTimeout(() => victim.remove(), 260);
      }
      this.pieces.delete(src(mv));
      this.pieces.set(dst(mv), el);
      el.classList.add('moving');
      this.place(el, dst(mv));
      setTimeout(() => el.classList.remove('moving'), 260);
    }
    // Reconcile with the real position (handles undo, review, new games).
    let consistent = true;
    for (const [s, el] of this.pieces) if (squares[s] !== Number(el.dataset.pc)) { consistent = false; break; }
    if (consistent) for (let s = 0; s < 256; s++) if (squares[s] && !this.pieces.has(s)) { consistent = false; break; }
    if (!consistent) {
      this.layer.querySelectorAll('.piece:not(.captured)').forEach(el => el.remove());
      this.pieces.clear();
      for (let s = 0; s < 256; s++) {
        if (squares[s]) {
          const el = this.makePiece(squares[s], s);
          this.layer.appendChild(el);
          this.pieces.set(s, el);
        }
      }
    }
    for (const [s, el] of this.pieces) el.classList.toggle('in-check', s === this.state.check);
  }

  setMarks({ selected = null, targets = [], lastMove = 0, hint = 0, check = null } = {}) {
    this.state = { selected, targets, lastMove, hint, check };
    for (const [s, el] of this.pieces) {
      el.classList.toggle('selected', s === selected);
      el.classList.toggle('in-check', s === check);
    }
    this.renderMarks();
  }

  renderMarks() {
    const { selected, targets, lastMove, hint } = this.state;
    const c = s => { const { x, y } = this.disp(s); return [(M + x) * U, (M + y) * U]; };
    let h = '';
    if (lastMove) {
      for (const s of [src(lastMove), dst(lastMove)]) {
        const [x, y] = c(s);
        h += `<g class="last" transform="translate(${x},${y})">${corners()}</g>`;
      }
    }
    if (selected !== null) {
      const [x, y] = c(selected);
      h += `<circle class="sel-ring" cx="${x}" cy="${y}" r="47"/>`;
    }
    for (const t of targets) {
      const [x, y] = c(t.sq);
      h += t.capture ? `<circle class="target capture" cx="${x}" cy="${y}" r="46"/>` : `<circle class="target" cx="${x}" cy="${y}" r="13"/>`;
    }
    if (hint) {
      const [x1, y1] = c(src(hint)), [x2, y2] = c(dst(hint));
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      h += `<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="hint-head"/></marker></defs>`;
      h += `<line class="hint" x1="${x1 + ux * 30}" y1="${y1 + uy * 30}" x2="${x2 - ux * 34}" y2="${y2 - uy * 34}" marker-end="url(#arrowhead)"/>`;
    }
    this.marks.innerHTML = h;
  }

  // ---------- input ----------

  hit(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    const fx = ((clientX - r.left) / r.width) * W - M;
    const fy = ((clientY - r.top) / r.height) * H - M;
    const dx = Math.round(fx), dy = Math.round(fy);
    if (dx < 0 || dx > 8 || dy < 0 || dy > 9) return null;
    if (Math.hypot(fx - dx, fy - dy) > 0.55) return null;
    return this.square(dx, dy);
  }

  bindInput() {
    let drag = null;
    this.root.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const s = this.hit(e.clientX, e.clientY);
      if (s === null) return;
      e.preventDefault();
      const el = this.pieces.get(s);
      drag = { s, x: e.clientX, y: e.clientY, el, active: false, id: e.pointerId, draggable: !!el && this.handlers.canDrag(s) };
      try { this.root.setPointerCapture(e.pointerId); } catch { /* not all pointers */ }
    });
    this.root.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      if (!drag.active && drag.draggable && dist > 8) {
        drag.active = true;
        drag.el.classList.add('dragging');
        this.handlers.onDragStart?.(drag.s);
      }
      if (drag.active) {
        drag.el.style.translate = `${e.clientX - drag.x}px ${e.clientY - drag.y}px`;
      }
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (d.active) {
        d.el.classList.remove('dragging');
        d.el.style.translate = '';
        const to = this.hit(e.clientX, e.clientY);
        if (to !== null && to !== d.s && this.handlers.onDrop(d.s, to)) return;
        this.handlers.onDragCancel?.();
        return;
      }
      if (e.type === 'pointerup') this.handlers.onTap(d.s);
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
  }
}

function corners() {
  const a = 44, l = 14;
  let s = '';
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
    s += `<polyline points="${dx * a},${dy * (a - l)} ${dx * a},${dy * a} ${dx * (a - l)},${dy * a}"/>`;
  }
  return s;
}

export { typeOf };
