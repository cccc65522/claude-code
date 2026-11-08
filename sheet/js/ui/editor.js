// Cell editing.
//
// Two synchronised surfaces: the in-cell editor (over the active cell) and the
// formula bar. Each is a transparent-text <textarea> over a highlight layer that
// draws the same text with references coloured to match their boxes on the grid.
//
// On desktop the in-cell textarea keeps focus even while not editing; typing into
// it (including IME composition for Chinese input) starts an edit, the way real
// spreadsheets catch the first keystroke. On touch devices editing happens in the
// formula bar so the iOS keyboard only appears when asked for.

import { FUNCTIONS } from '../engine/functions.js';
import { parseFormula } from '../engine/parser.js';
import {
  formulaContext, suggestFunctions, syntaxParts, activeParam, toggleAbsolute, colorRefs, refText
} from './assist.js';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Editor {
  constructor(ctrl, els) {
    this.ctrl = ctrl;
    this.els = els; // { cellWrap, cellInput, barWrap, barInput, suggest, arghint, area }
    this.editing = false;
    this.state = null;
    this.suggestions = [];
    this.suggestIndex = 0;
    this.measure = document.createElement('canvas').getContext('2d');
    this.bind();
  }

  get coarse() { return this.ctrl.grid.coarse; }

  activeInput() {
    if (!this.editing) return this.coarse ? this.els.barInput : this.els.cellInput;
    return this.state.source === 'bar' ? this.els.barInput : this.els.cellInput;
  }

  // ---------- lifecycle ----------

  // mode 'enter': started by typing, arrows commit; 'edit': F2/double-click, arrows move the caret.
  begin({ text, mode = 'edit', source = this.coarse ? 'bar' : 'cell', caret = null, keepValue = false }) {
    const ctrl = this.ctrl;
    const a = ctrl.active();
    this.editing = true;
    this.state = {
      sheetId: ctrl.sheetId, r: a.r, c: a.c,
      original: ctrl.wb.getInput(ctrl.sheetId, a.r, a.c),
      text, mode, source, point: null
    };
    const { cellInput, barInput } = this.els;
    if (!keepValue) {
      cellInput.value = text;
      barInput.value = text;
    } else {
      barInput.value = text;
    }
    this.els.cellWrap.classList.remove('idle');
    this.els.cellWrap.hidden = false;
    document.body.classList.add('is-editing');
    const input = this.activeInput();
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    const pos = caret ?? text.length;
    if (!keepValue) input.setSelectionRange(pos, pos);
    this.position();
    this.refresh();
    ctrl.onEditStateChange();
  }

  // Leave edit mode without writing.
  cancel() {
    if (!this.editing) return;
    const { sheetId } = this.state;
    this.end();
    if (this.ctrl.sheetId !== sheetId) this.ctrl.showSheet(sheetId);
    this.ctrl.onEditStateChange();
  }

  // Write the edit, then move the selection by (dr, dc). all: Ctrl+Enter fills the selection.
  commit({ dr = 0, dc = 0, all = false } = {}) {
    if (!this.editing) return false;
    const st = this.state;
    let text = st.text;
    if (text.startsWith('=')) text = closeParens(text);
    this.end();
    const changed = text !== st.original || all;
    this.ctrl.commitEdit(st, text, { all, changed });
    if (dr || dc) this.ctrl.moveActive(dr, dc, { withinSelection: true });
    this.ctrl.onEditStateChange();
    return true;
  }

  end() {
    this.editing = false;
    this.state = null;
    this.hidePopups();
    document.body.classList.remove('is-editing');
    const { cellWrap, cellInput, barInput } = this.els;
    cellWrap.classList.add('idle');
    cellInput.value = '';
    barInput.blur();
    if (!this.coarse) cellInput.focus({ preventScroll: true });
    this.renderHighlight(this.els.barWrap, barInput.value);
    this.renderHighlight(cellWrap, '');
  }

  // When not editing: show the active cell's content in the bar, park the sink.
  sync() {
    if (this.editing) { this.position(); return; }
    const ctrl = this.ctrl;
    const a = ctrl.active();
    const text = ctrl.wb.getInput(ctrl.sheetId, a.r, a.c);
    if (document.activeElement !== this.els.barInput) {
      this.els.barInput.value = text;
      this.renderHighlight(this.els.barWrap, text);
    }
    this.position();
  }

  focusSink() {
    if (this.coarse || this.editing) return;
    const el = this.els.cellInput;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  }

  // ---------- layout ----------

  position() {
    const { cellWrap, area } = this.els;
    const ctrl = this.ctrl;
    const st = this.state;
    const a = st ? { r: st.r, c: st.c } : ctrl.active();
    const visible = !st || st.sheetId === ctrl.sheetId;
    const box = ctrl.grid.cellBox(a.r, a.c);
    const grid = ctrl.grid;
    // Keep the editor inside the cell area (not over the headers).
    const left = Math.max(grid.HDR_W, box.left);
    const top = Math.max(grid.HDR_H, box.top);
    let width = box.width, height = box.height;
    if (st) {
      const style = getComputedStyle(this.els.cellInput);
      this.measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const lines = st.text.split('\n');
      const textW = Math.max(...lines.map(l => this.measure.measureText(l).width)) + 14;
      width = Math.min(Math.max(box.width, textW), area.clientWidth - left - 4);
      height = Math.max(box.height, lines.length * 18 + 6);
    }
    cellWrap.style.left = `${left}px`;
    cellWrap.style.top = `${top}px`;
    cellWrap.style.width = `${Math.max(width, 20)}px`;
    cellWrap.style.height = `${height}px`;
    // Hide the in-cell editor when its cell is scrolled out of the cell area.
    const outside = box.top + box.height <= grid.HDR_H || box.left + box.width <= grid.HDR_W
      || box.top >= area.clientHeight || box.left >= area.clientWidth;
    cellWrap.classList.toggle('offsheet', !visible || outside);
    const cell = ctrl.wb.getCell(ctrl.sheetId, a.r, a.c);
    cellWrap.classList.toggle('b', !!cell?.style?.bold);
    cellWrap.classList.toggle('i', !!cell?.style?.italic);
  }

  // ---------- events ----------

  bind() {
    const { cellInput, barInput, suggest } = this.els;
    for (const input of [cellInput, barInput]) {
      input.addEventListener('keydown', e => this.onKeyDown(e, input));
      input.addEventListener('input', e => this.onInput(e, input));
      input.addEventListener('scroll', () => this.syncScroll(input));
      input.addEventListener('select', () => this.refreshPopups());
      input.addEventListener('click', () => { if (this.editing) { this.state.point = null; this.refreshPopups(); } });
    }
    cellInput.addEventListener('compositionstart', () => {
      if (!this.editing) this.begin({ text: '', mode: 'enter', source: 'cell', keepValue: true });
    });
    barInput.addEventListener('focus', () => {
      if (!this.editing) {
        const text = barInput.value;
        this.begin({ text, mode: 'edit', source: 'bar', keepValue: true });
      } else if (this.state.source !== 'bar') {
        this.state.source = 'bar';
        this.position();
      }
    });
    suggest.addEventListener('pointerdown', e => {
      const item = e.target.closest('[data-i]');
      if (!item) return;
      e.preventDefault();
      this.acceptSuggestion(Number(item.dataset.i));
    });
  }

  onInput(e, input) {
    if (!this.editing) {
      // First keystroke into the parked sink starts an edit that replaces the cell.
      if (input === this.els.cellInput) {
        if (e.isComposing) return;
        this.begin({ text: input.value, mode: 'enter', source: 'cell', keepValue: true });
      }
      return;
    }
    this.state.text = input.value;
    this.state.point = null;
    const other = input === this.els.cellInput ? this.els.barInput : this.els.cellInput;
    other.value = input.value;
    this.position();
    this.refresh();
  }

  onKeyDown(e, input) {
    const ctrl = this.ctrl;
    if (!this.editing) {
      // Navigation and commands while a cell is merely selected.
      if (input === this.els.cellInput) ctrl.onGridKey(e);
      else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); input.blur(); }
      return;
    }
    if (e.isComposing || e.keyCode === 229) return;
    const st = this.state;

    if (this.suggestions.length && !this.els.suggest.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.suggestions.length;
        this.suggestIndex = (this.suggestIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.renderSuggest();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        this.acceptSuggestion(this.suggestIndex);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); this.hidePopups(); this.suggestions = []; return; }
    }

    switch (e.key) {
      case 'Enter':
        if (e.altKey) { // new line inside the cell
          e.preventDefault();
          this.insertText('\n');
          return;
        }
        e.preventDefault();
        this.commit({ dr: e.shiftKey ? -1 : 1, all: e.ctrlKey || e.metaKey });
        return;
      case 'Tab':
        e.preventDefault();
        this.commit({ dc: e.shiftKey ? -1 : 1 });
        return;
      case 'Escape':
        e.preventDefault();
        this.cancel();
        return;
      case 'F4': {
        e.preventDefault();
        const r = toggleAbsolute(st.text, input.selectionStart);
        this.setText(r.text, r.caret);
        return;
      }
      case 'F2':
        e.preventDefault();
        st.mode = st.mode === 'enter' ? 'edit' : 'enter';
        ctrl.toast(st.mode === 'edit' ? '编辑模式：方向键移动光标' : '输入模式：方向键选择单元格');
        return;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        if (st.mode !== 'enter' || st.source === 'bar') return;
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
        if (this.canPoint()) {
          e.preventDefault();
          this.pointMove(d[0], d[1], e.shiftKey);
          return;
        }
        e.preventDefault();
        this.commit({ dr: d[0], dc: d[1] });
        return;
      }
    }
  }

  // ---------- text helpers ----------

  setText(text, caret = text.length) {
    const st = this.state;
    st.text = text;
    const { cellInput, barInput } = this.els;
    cellInput.value = text;
    barInput.value = text;
    const input = this.activeInput();
    input.setSelectionRange(caret, caret);
    this.position();
    this.refresh();
  }

  insertText(s) {
    const input = this.activeInput();
    const a = input.selectionStart, b = input.selectionEnd;
    const text = this.state.text.slice(0, a) + s + this.state.text.slice(b);
    this.state.point = null;
    this.setText(text, a + s.length);
  }

  // Keyboard-bar and function-picker entry point.
  type(s) {
    const ctrl = this.ctrl;
    if (!this.editing) {
      const a = ctrl.active();
      const current = ctrl.wb.getInput(ctrl.sheetId, a.r, a.c);
      this.begin({ text: current, mode: 'edit', source: 'bar' });
    }
    this.activeInput().focus({ preventScroll: true });
    this.insertText(s);
  }

  insertFunction(name) {
    if (!this.editing || !this.state.text.startsWith('=')) {
      const ctrl = this.ctrl;
      if (!this.editing) this.begin({ text: '=', mode: 'enter', source: this.coarse ? 'bar' : 'cell' });
      else if (!this.state.text.startsWith('=')) this.setText('=');
    }
    this.activeInput().focus({ preventScroll: true });
    this.insertText(`${name}(`);
  }

  // ---------- pointing at cells ----------

  canPoint() {
    if (!this.editing || !this.state.text.startsWith('=')) return false;
    if (this.state.point) return true;
    const input = this.activeInput();
    if (input.selectionStart !== input.selectionEnd) return false;
    return formulaContext(this.state.text, input.selectionStart).canInsertRef;
  }

  pointSheetName() {
    const ctrl = this.ctrl;
    return ctrl.sheetId === this.state.sheetId ? null : ctrl.sheet.name;
  }

  // Insert (or replace the last pointed) reference for `range`.
  pointAt(range, anchor = { r: range.r1, c: range.c1 }) {
    const st = this.state;
    const input = this.activeInput();
    const ref = refText(range, this.pointSheetName());
    let from, to;
    if (st.point) ({ from, to } = st.point);
    else { from = input.selectionStart; to = input.selectionEnd; }
    const text = st.text.slice(0, from) + ref + st.text.slice(to);
    st.text = text;
    st.point = { from, to: from + ref.length, anchor, cursor: { r: range.r2, c: range.c2 }, range };
    const { cellInput, barInput } = this.els;
    cellInput.value = text;
    barInput.value = text;
    input.focus({ preventScroll: true });
    input.setSelectionRange(from + ref.length, from + ref.length);
    this.position();
    this.refresh();
  }

  pointExtend(cell) {
    const p = this.state.point;
    if (!p) return;
    const range = { r1: Math.min(p.anchor.r, cell.r), c1: Math.min(p.anchor.c, cell.c), r2: Math.max(p.anchor.r, cell.r), c2: Math.max(p.anchor.c, cell.c) };
    this.pointAt(range, p.anchor);
    this.state.point.cursor = cell;
  }

  pointMove(dr, dc, extend) {
    const st = this.state;
    const sheet = this.ctrl.sheet;
    const clamp = (r, c) => ({ r: Math.max(0, Math.min(sheet.rowCount - 1, r)), c: Math.max(0, Math.min(sheet.colCount - 1, c)) });
    if (!st.point) {
      const start = clamp(st.r + dr, st.c + dc);
      this.pointAt({ r1: start.r, c1: start.c, r2: start.r, c2: start.c });
    } else if (extend) {
      const cur = clamp(st.point.cursor.r + dr, st.point.cursor.c + dc);
      this.pointExtend(cur);
    } else {
      const cur = clamp(st.point.cursor.r + dr, st.point.cursor.c + dc);
      this.pointAt({ r1: cur.r, c1: cur.c, r2: cur.r, c2: cur.c });
    }
    this.ctrl.grid.scrollIntoView(st.point.cursor.r, st.point.cursor.c);
  }

  // Coloured boxes for the references in the formula being edited, on the visible sheet.
  highlightRefs() {
    if (!this.editing || !this.state.text.startsWith('=')) return [];
    const ctrl = this.ctrl;
    const home = ctrl.wb.sheetById(this.state.sheetId);
    return colorRefs(this.state.text).filter(s => {
      const id = s.sheet ? ctrl.wb.resolveSheet(s.sheet) : home?.id;
      return id === ctrl.sheetId;
    }).map(s => ({
      ...s,
      range: s.kind === 'cols' ? { ...s.range, r2: ctrl.sheet.rowCount - 1 } : s.kind === 'rows' ? { ...s.range, c2: ctrl.sheet.colCount - 1 } : s.range
    }));
  }

  // ---------- highlight layers ----------

  refresh() {
    const text = this.state?.text ?? '';
    this.renderHighlight(this.els.cellWrap, text);
    this.renderHighlight(this.els.barWrap, text);
    this.refreshPopups();
    this.ctrl.grid.renderOverlays();
  }

  renderHighlight(wrap, text) {
    const hl = wrap.querySelector('.hl');
    if (!text.startsWith('=')) { hl.textContent = text + '​'; return; }
    let html = '';
    let pos = 0;
    for (const s of colorRefs(text)) {
      html += esc(text.slice(pos, s.from)) + `<span style="color:${s.color}">${esc(text.slice(s.from, s.to))}</span>`;
      pos = s.to;
    }
    html += esc(text.slice(pos));
    hl.innerHTML = `<span class="eq">${html.slice(0, 1)}</span>${html.slice(1)}​`;
    const input = wrap.querySelector('textarea');
    this.syncScroll(input);
  }

  syncScroll(input) {
    const hl = input.parentElement.querySelector('.hl');
    hl.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
  }

  // ---------- autocomplete & argument hints ----------

  refreshPopups() {
    if (!this.editing) { this.hidePopups(); return; }
    const input = this.activeInput();
    const text = this.state.text;
    if (!text.startsWith('=')) { this.hidePopups(); return; }
    const ctx = formulaContext(text, input.selectionStart);
    this.suggestions = ctx.prefix ? suggestFunctions(ctx.prefix.text) : [];
    if (this.suggestions.length === 1 && this.suggestions[0].name === ctx.prefix.text.toUpperCase() && text[ctx.prefix.to] === '(') this.suggestions = [];
    this.prefix = ctx.prefix;
    if (this.suggestions.length) {
      this.suggestIndex = Math.min(this.suggestIndex, this.suggestions.length - 1);
      this.renderSuggest();
      this.els.arghint.hidden = true;
    } else {
      this.els.suggest.hidden = true;
      const spec = ctx.call && FUNCTIONS[ctx.call.name];
      if (spec) this.renderArgHint(spec, ctx.call.argIndex);
      else this.els.arghint.hidden = true;
    }
  }

  anchorPopup(el) {
    const input = this.activeInput();
    const area = this.els.area.getBoundingClientRect();
    const r = input.parentElement.getBoundingClientRect();
    const left = Math.max(4, Math.min(r.left - area.left, area.width - 300));
    el.style.left = `${left}px`;
    el.style.top = `${r.bottom - area.top + 2}px`;
    el.style.maxWidth = `${Math.max(200, area.width - left - 4)}px`;
  }

  renderSuggest() {
    const el = this.els.suggest;
    el.innerHTML = this.suggestions.map((f, i) =>
      `<div class="sg${i === this.suggestIndex ? ' on' : ''}" data-i="${i}" role="option" aria-selected="${i === this.suggestIndex}"><b>${f.name}</b><span>${esc(f.desc)}</span></div>`).join('');
    el.hidden = false;
    this.anchorPopup(el);
  }

  renderArgHint(spec, argIndex) {
    const { name, params } = syntaxParts(spec.syntax);
    const k = activeParam(params, argIndex);
    const el = this.els.arghint;
    el.innerHTML = `<div class="sig">${name}(${params.map((p, i) => (i === k ? `<b>${esc(p)}</b>` : esc(p))).join(', ')})</div><div class="desc">${esc(spec.desc)}</div>`;
    el.hidden = false;
    this.anchorPopup(el);
  }

  acceptSuggestion(i) {
    const f = this.suggestions[i];
    if (!f || !this.prefix) return;
    const { from, to } = this.prefix;
    const text = this.state.text;
    const hasParen = text[to] === '(';
    const next = text.slice(0, from) + f.name + (hasParen ? '' : '(') + text.slice(to);
    this.suggestions = [];
    this.setText(next, from + f.name.length + 1);
  }

  hidePopups() {
    this.els.suggest.hidden = true;
    this.els.arghint.hidden = true;
  }
}

// Excel quietly adds missing closing parentheses on Enter.
export function closeParens(text) {
  let depth = 0, inStr = false;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inStr = !inStr;
    else if (!inStr && ch === '(') depth++;
    else if (!inStr && ch === ')') depth--;
  }
  if (depth <= 0 || inStr) return text;
  const fixed = text + ')'.repeat(depth);
  try {
    parseFormula(fixed.slice(1));
    return fixed;
  } catch {
    return text;
  }
}
