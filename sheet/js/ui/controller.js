// The app controller: selection, keyboard, clipboard, and every command (each one
// goes through History so it can be undone).

import { formatAddress, formatRange, parseRangeAddress, MAX_ROWS, MAX_COLS } from '../engine/address.js';
import { parseFormula, printFormula } from '../engine/parser.js';
import { shiftRelative } from '../engine/rewrite.js';
import { FORMAT_PRESETS, isDateFormat } from '../engine/format.js';
import { formatGeneralNumber, isError } from '../engine/values.js';
import { serialToParts } from '../engine/dates.js';
import { parseCSV } from '../io/csv.js';
import { Grid } from './grid.js';
import { Editor } from './editor.js';
import { findEdge, autoSumRange, refText } from './assist.js';
import { showMenu, closeMenus, colorPalette, promptText, confirmDialog, toast, esc } from './widgets.js';

const TEXT_COLORS = [null, '#202124', '#5f6368', '#d93025', '#e37400', '#f9ab00', '#188038', '#1a73e8', '#7c3aed', '#c026d3', '#ffffff'];
const FILL_COLORS = [null, '#f1f3f4', '#fde2e1', '#fee6c9', '#fef3c7', '#dcfce7', '#dbeafe', '#ede9fe', '#fce7f3', '#fff7a8', '#c7f0d8', '#bfdbfe'];

export class Controller {
  constructor({ wb, history, els, title = '未命名表格' }) {
    this.wb = wb;
    this.history = history;
    this.els = els;
    this.title = title;
    this.sheetId = wb.sheets[0].id;
    this.anchor = { r: 0, c: 0 };
    this.focus = { r: 0, c: 0 };
    this.clip = null;
    this.listeners = { change: [] };
    this.lastColor = '#d93025';
    this.lastFill = '#fef3c7';
    this.grid = new Grid(this, {
      viewport: els.viewport, canvas: els.canvas, colhdr: els.colhdr, rowhdr: els.rowhdr, layer: els.layer
    });
    this.editor = new Editor(this, {
      cellWrap: els.cellWrap, cellInput: els.cellInput, barWrap: els.barWrap, barInput: els.barInput,
      suggest: els.suggest, arghint: els.arghint, area: els.area
    });
    this._raf = 0;
    this.bind();
  }

  get sheet() { return this.wb.sheetById(this.sheetId) || this.wb.sheets[0]; }
  active() { return { ...this.anchor }; }
  selRange() {
    return {
      r1: Math.min(this.anchor.r, this.focus.r), c1: Math.min(this.anchor.c, this.focus.c),
      r2: Math.max(this.anchor.r, this.focus.r), c2: Math.max(this.anchor.c, this.focus.c)
    };
  }
  inSelection(r, c) {
    const s = this.selRange();
    return r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2;
  }
  on(evt, fn) { this.listeners[evt].push(fn); }
  emit(evt) { for (const fn of this.listeners[evt]) fn(); }

  // ---------- rendering ----------

  invalidate() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
    });
  }

  render() {
    if (!this.wb.sheetById(this.sheetId)) this.sheetId = this.wb.sheets[0].id;
    this.grid.render();
    this.editor.sync();
    this.renderToolbar();
    this.renderTabs();
    this.renderStatus();
    if (document.activeElement !== this.els.namebox) {
      const s = this.selRange();
      this.els.namebox.value = s.r1 === s.r2 && s.c1 === s.c2 ? formatAddress(s.r1, s.c1) : formatRange(s);
    }
  }

  onScroll() {
    if (this._scrollRaf) return;
    this._scrollRaf = requestAnimationFrame(() => {
      this._scrollRaf = 0;
      this.grid.render();
      this.editor.position();
      if (this.editor.editing) this.editor.refreshPopups();
    });
  }

  onEditStateChange() {
    const editing = this.editor.editing;
    for (const b of document.querySelectorAll('.bar-btn')) b.hidden = !editing;
    this.els.keybar.hidden = !(editing && this.grid.coarse);
    this.invalidate();
  }

  renderToolbar() {
    const a = this.active();
    const cell = this.wb.getCell(this.sheetId, a.r, a.c);
    const st = cell?.style || {};
    const tb = this.els.toolbar;
    const press = (cmd, on) => tb.querySelector(`[data-cmd="${cmd}"]`)?.setAttribute('aria-pressed', String(!!on));
    press('bold', st.bold);
    press('italic', st.italic);
    press('underline', st.underline);
    press('strike', st.strike);
    press('wrap', st.wrap);
    press('align-left', st.align === 'left');
    press('align-center', st.align === 'center');
    press('align-right', st.align === 'right');
    tb.querySelector('[data-cmd="undo"]').disabled = !this.history.canUndo;
    tb.querySelector('[data-cmd="redo"]').disabled = !this.history.canRedo;
    tb.querySelector('[data-cmd="undo"]').title = this.history.canUndo ? `撤销“${this.history.undoLabel}” (Ctrl+Z)` : '撤销 (Ctrl+Z)';
    tb.querySelector('[data-cmd="redo"]').title = this.history.canRedo ? `重做“${this.history.redoLabel}” (Ctrl+Y)` : '重做 (Ctrl+Y)';
    const fmt = this.wb.effectiveFormat(this.sheetId, a.r, a.c);
    const preset = FORMAT_PRESETS.find(p => p.id === fmt);
    document.getElementById('fmt-btn').textContent = `${preset ? preset.label.split(' ')[0] : fmt === 'General' ? '常规' : '自定义'} ▾`;
    document.getElementById('color-bar').style.background = this.lastColor;
    document.getElementById('fill-bar').style.background = this.lastFill;
  }

  renderTabs() {
    const tabs = this.els.tabs;
    const key = this.wb.sheets.map(s => `${s.id}:${s.name}`).join('|') + `#${this.sheetId}`;
    if (tabs.dataset.key === key) return;
    tabs.dataset.key = key;
    tabs.innerHTML = this.wb.sheets.map(s =>
      `<button class="tab${s.id === this.sheetId ? ' on' : ''}" role="tab" aria-selected="${s.id === this.sheetId}" data-sheet="${s.id}">${esc(s.name)}</button>`).join('');
    tabs.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  renderStatus() {
    const s = this.selRange();
    const el = this.els.status;
    if (s.r1 === s.r2 && s.c1 === s.c2) {
      const cell = this.wb.getCell(this.sheetId, s.r1, s.c1);
      el.textContent = cell?.parseError ? `公式错误：${cell.parseError}` : isError(cell?.value) ? errorHelp(cell.value.code) : '';
      return;
    }
    let sum = 0, nums = 0, count = 0;
    let min = Infinity, max = -Infinity;
    const visit = v => {
      if (v === null || v === '') return;
      count++;
      if (typeof v === 'number') { sum += v; nums++; if (v < min) min = v; if (v > max) max = v; }
    };
    const area = (s.r2 - s.r1 + 1) * (s.c2 - s.c1 + 1);
    if (area > this.sheet.cells.size) {
      this.wb.forEachCellIn(this.sheetId, s.r1, s.c1, s.r2, s.c2, (r, c) => visit(this.wb.getValue(this.sheetId, r, c)));
    } else {
      for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) visit(this.wb.getCell(this.sheetId, r, c)?.value ?? null);
    }
    const f = n => formatGeneralNumber(Number(n.toPrecision(12)));
    el.innerHTML = nums
      ? `<span>求和 <b>${f(sum)}</b></span><span>平均 <b>${f(sum / nums)}</b></span><span class="opt">最小 <b>${f(min)}</b></span><span class="opt">最大 <b>${f(max)}</b></span><span>计数 <b>${count}</b></span>`
      : `<span>计数 <b>${count}</b></span>`;
  }

  // ---------- selection ----------

  clampCell(r, c) {
    return { r: Math.max(0, Math.min(MAX_ROWS - 1, r)), c: Math.max(0, Math.min(MAX_COLS - 1, c)) };
  }

  ensureSize(r, c) {
    const s = this.sheet;
    if (r >= s.rowCount) s.rowCount = Math.min(MAX_ROWS, r + 50);
    if (c >= s.colCount) s.colCount = Math.min(MAX_COLS, c + 5);
  }

  select(r, c, { scroll = true } = {}) {
    ({ r, c } = this.clampCell(r, c));
    this.ensureSize(r, c);
    this.anchor = { r, c };
    this.focus = { r, c };
    this.afterSelect(scroll ? { r, c } : null);
  }

  selectRange(rng, active = { r: rng.r1, c: rng.c1 }) {
    this.ensureSize(rng.r2, rng.c2);
    this.anchor = { ...active };
    // focus is the opposite corner from the active cell
    this.focus = { r: active.r === rng.r1 ? rng.r2 : rng.r1, c: active.c === rng.c1 ? rng.c2 : rng.c1 };
    this.afterSelect(active);
  }

  extendTo(r, c, { scroll = true } = {}) {
    ({ r, c } = this.clampCell(r, c));
    this.ensureSize(r, c);
    this.focus = { r, c };
    this.afterSelect(scroll ? { r, c } : null);
  }

  selectAll() {
    if (this.editor.editing) this.editor.commit();
    const b = this.sheet;
    this.anchor = { r: 0, c: 0 };
    this.focus = { r: b.rowCount - 1, c: b.colCount - 1 };
    this.afterSelect(null);
  }

  afterSelect(scrollTo) {
    if (scrollTo) this.grid.scrollIntoView(scrollTo.r, scrollTo.c);
    this.editor.focusSink();
    this.invalidate();
    this.announce();
    this.emit('change');
  }

  announce() {
    clearTimeout(this._announce);
    this._announce = setTimeout(() => {
      const a = this.active();
      const d = this.wb.getDisplay(this.sheetId, a.r, a.c);
      this.els.live.textContent = `${formatAddress(a.r, a.c)} ${d?.text || '空'}`;
    }, 250);
  }

  // Arrow keys: move (or extend) the selection, Ctrl jumps to data edges.
  moveSel(dr, dc, { extend = false, jump = false } = {}) {
    const from = extend ? this.focus : this.anchor;
    let { r, c } = { r: from.r + dr, c: from.c + dc };
    if (jump) {
      const has = (y, x) => (this.wb.getCell(this.sheetId, y, x)?.input ?? '') !== '';
      ({ r, c } = findEdge(has, from.r, from.c, dr, dc, this.sheet.rowCount - 1, this.sheet.colCount - 1));
    }
    if (extend) this.extendTo(r, c);
    else this.select(r, c);
  }

  // Enter / Tab: move the active cell, cycling inside a multi-cell selection.
  moveActive(dr, dc, { withinSelection = false } = {}) {
    const s = this.selRange();
    const multi = s.r1 !== s.r2 || s.c1 !== s.c2;
    if (!withinSelection || !multi) { this.select(this.anchor.r + dr, this.anchor.c + dc); return; }
    let { r, c } = this.anchor;
    if (dr) {
      r += dr;
      if (r > s.r2) { r = s.r1; c = c + 1 > s.c2 ? s.c1 : c + 1; }
      if (r < s.r1) { r = s.r2; c = c - 1 < s.c1 ? s.c2 : c - 1; }
    } else {
      c += dc;
      if (c > s.c2) { c = s.c1; r = r + 1 > s.r2 ? s.r1 : r + 1; }
      if (c < s.c1) { c = s.c2; r = r - 1 < s.r1 ? s.r2 : r - 1; }
    }
    this.anchor = { r, c };
    this.grid.scrollIntoView(r, c);
    this.editor.focusSink();
    this.invalidate();
    this.announce();
  }

  showSheet(id) {
    if (!this.wb.sheetById(id) || id === this.sheetId) { this.invalidate(); return; }
    const editing = this.editor.editing;
    this.saveView();
    this.sheetId = id;
    const v = this.views?.get(id);
    if (!editing) {
      this.anchor = v ? { ...v.anchor } : { r: 0, c: 0 };
      this.focus = v ? { ...v.focus } : { r: 0, c: 0 };
    }
    this.grid.render();
    this.els.viewport.scrollTop = v?.top ?? 0;
    this.els.viewport.scrollLeft = v?.left ?? 0;
    if (editing) this.editor.activeInput().focus({ preventScroll: true });
    else this.editor.focusSink();
    this.invalidate();
    this.emit('change');
  }

  saveView() {
    this.views ??= new Map();
    this.views.set(this.sheetId, {
      anchor: { ...this.anchor }, focus: { ...this.focus },
      top: this.els.viewport.scrollTop, left: this.els.viewport.scrollLeft
    });
  }

  // ---------- pointer callbacks from the grid ----------

  onCellDown(r, c, e) {
    const ed = this.editor;
    closeMenus();
    if (ed.editing) {
      if (ed.canPoint()) {
        if (e.shiftKey && ed.state.point) ed.pointExtend({ r, c });
        else ed.pointAt({ r1: r, c1: c, r2: r, c2: c });
        return 'point';
      }
      ed.commit();
    }
    if (e.shiftKey) { this.extendTo(r, c, { scroll: false }); return 'select'; }
    this.select(r, c, { scroll: false });
    return 'select';
  }

  onHeaderDown(kind, idx, e) {
    if (this.editor.editing) this.editor.commit();
    closeMenus();
    const s = this.sheet;
    if (kind === 'col') {
      if (e.shiftKey) { this.focus = { r: s.rowCount - 1, c: idx }; this.anchor = { r: 0, c: this.anchor.c }; this.afterSelect(null); }
      else { this.anchor = { r: 0, c: idx }; this.focus = { r: s.rowCount - 1, c: idx }; this.afterSelect(null); }
    } else if (e.shiftKey) { this.focus = { r: idx, c: s.colCount - 1 }; this.anchor = { r: this.anchor.r, c: 0 }; this.afterSelect(null); }
    else { this.anchor = { r: idx, c: 0 }; this.focus = { r: idx, c: s.colCount - 1 }; this.afterSelect(null); }
    return 'select';
  }

  onDrag(mode, cell) {
    if (mode === 'point') { this.editor.pointExtend(cell); return; }
    if (cell.r === this.focus.r && cell.c === this.focus.c) return;
    this.focus = cell;
    this.invalidate();
  }

  onDragEnd() {
    this.editor.focusSink();
    this.announce();
    this.emit('change');
  }

  onCellTap(r, c, { quiet = false } = {}) {
    const ed = this.editor;
    closeMenus();
    if (ed.editing) {
      if (ed.canPoint()) {
        ed.pointAt({ r1: r, c1: c, r2: r, c2: c });
        ed.activeInput().focus({ preventScroll: true });
        return;
      }
      ed.commit();
      this.select(r, c, { scroll: false });
      return;
    }
    const s = this.selRange();
    const single = s.r1 === s.r2 && s.c1 === s.c2;
    if (!quiet && single && r === this.anchor.r && c === this.anchor.c) {
      ed.begin({ text: this.wb.getInput(this.sheetId, r, c), mode: 'edit', source: 'bar' });
      return;
    }
    this.select(r, c, { scroll: false });
  }

  onCellDoubleClick(r, c) {
    if (this.editor.editing) return;
    this.select(r, c, { scroll: false });
    this.editor.begin({ text: this.wb.getInput(this.sheetId, r, c), mode: 'edit' });
  }

  // ---------- keyboard ----------

  onGridKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[key]) {
      e.preventDefault();
      this.moveSel(...arrows[key], { extend: e.shiftKey, jump: mod });
      return;
    }
    const pageRows = Math.max(1, Math.floor((this.els.viewport.clientHeight - this.grid.HDR_H) / this.grid.ROW_H) - 1);
    switch (key) {
      case 'Enter':
        e.preventDefault();
        if (mod) return;
        this.moveActive(e.shiftKey ? -1 : 1, 0, { withinSelection: true });
        return;
      case 'Tab':
        e.preventDefault();
        this.moveActive(0, e.shiftKey ? -1 : 1, { withinSelection: true });
        return;
      case 'PageDown': e.preventDefault(); this.moveSel(pageRows, 0, { extend: e.shiftKey }); return;
      case 'PageUp': e.preventDefault(); this.moveSel(-pageRows, 0, { extend: e.shiftKey }); return;
      case 'Home':
        e.preventDefault();
        if (mod) this.select(0, 0);
        else if (e.shiftKey) this.extendTo(this.focus.r, 0);
        else this.select(this.anchor.r, 0);
        return;
      case 'End':
        if (mod) {
          e.preventDefault();
          const b = this.sheet.bounds();
          this.select(Math.max(0, b.maxRow), Math.max(0, b.maxCol));
        }
        return;
      case 'F2':
        e.preventDefault();
        this.editor.begin({ text: this.wb.getInput(this.sheetId, this.anchor.r, this.anchor.c), mode: 'edit' });
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.clearContents();
        return;
      case 'Escape':
        if (this.clip) { this.clip = null; this.invalidate(); }
        return;
    }
    if (e.altKey && (key === '=' || e.code === 'Equal')) { e.preventDefault(); this.autosum(); return; }
    if (!mod) return;
    const k = key.toLowerCase();
    const cmds = {
      z: () => (e.shiftKey ? this.redo() : this.undo()),
      y: () => this.redo(),
      b: () => this.toggleStyle('bold'),
      i: () => this.toggleStyle('italic'),
      u: () => this.toggleStyle('underline'),
      a: () => this.selectAll(),
      d: () => this.fillDown(),
      r: () => this.fillRight(),
      f: () => this.openFind(),
      h: () => this.openFind(true),
      s: () => toast('已自动保存在本机浏览器里。需要文件可以用“文件 → 导出”。'),
      ';': () => this.insertNow(e.shiftKey ? 'time' : 'date'),
      ':': () => this.insertNow('time')
    };
    if (cmds[k]) {
      e.preventDefault();
      cmds[k]();
    }
  }

  // ---------- commands ----------

  // Run a change through history; selection is restored on undo/redo.
  exec(label, fn, { snapshot = false } = {}) {
    const meta = { sheetId: this.sheetId, before: { anchor: { ...this.anchor }, focus: { ...this.focus } } };
    let result;
    try {
      result = this.history.run(label, fn, { snapshot, meta });
    } catch (err) {
      toast(err.message || String(err));
      this.invalidate();
      return undefined;
    }
    meta.after = { anchor: { ...this.anchor }, focus: { ...this.focus } };
    meta.afterSheet = this.sheetId;
    this.invalidate();
    this.emit('change');
    return result;
  }

  undo() {
    if (this.editor.editing) { this.editor.cancel(); return; }
    const e = this.history.undo();
    if (!e) return;
    this.restoreMeta(e.meta, 'before');
    toast(`已撤销：${e.label}`, { ms: 1500 });
  }

  redo() {
    if (this.editor.editing) return;
    const e = this.history.redo();
    if (!e) return;
    this.restoreMeta(e.meta, 'after');
    toast(`已重做：${e.label}`, { ms: 1500 });
  }

  restoreMeta(meta, side) {
    this.clip = null;
    if (meta) {
      const id = side === 'after' ? meta.afterSheet ?? meta.sheetId : meta.sheetId;
      if (this.wb.sheetById(id)) this.sheetId = id;
      const sel = meta[side] || meta.before;
      this.anchor = { ...sel.anchor };
      this.focus = { ...sel.focus };
      this.grid.scrollIntoView(this.anchor.r, this.anchor.c);
    }
    if (!this.wb.sheetById(this.sheetId)) this.sheetId = this.wb.sheets[0].id;
    this.editor.focusSink();
    this.invalidate();
    this.emit('change');
  }

  commitEdit(st, text, { all, changed }) {
    if (!changed) { this.invalidate(); return; }
    if (this.sheetId !== st.sheetId) this.showSheet(st.sheetId);
    this.anchor = { r: st.r, c: st.c };
    const s = this.selRange();
    const multi = all && (s.r1 !== s.r2 || s.c1 !== s.c2);
    this.exec('输入', () => {
      if (!multi) {
        this.wb.setCells([{ sheetId: st.sheetId, r: st.r, c: st.c, input: text }]);
        return;
      }
      // Ctrl+Enter: the same entry in every selected cell, formulas adjusted per cell.
      let ast = null;
      if (text.startsWith('=')) { try { ast = parseFormula(text.slice(1)); } catch { ast = null; } }
      const list = [];
      for (let r = s.r1; r <= s.r2; r++) {
        for (let c = s.c1; c <= s.c2; c++) {
          const input = ast ? '=' + printFormula(shiftRelative(ast, r - st.r, c - st.c)) : text;
          list.push({ sheetId: st.sheetId, r, c, input });
        }
      }
      this.wb.setCells(list);
    });
    const cell = this.wb.getCell(st.sheetId, st.r, st.c);
    if (cell?.parseError) toast(`公式有误：${cell.parseError}`, { ms: 4000 });
    else if (cell?.value?.code === '#CIRC!') toast('出现了循环引用：公式直接或间接引用了自己', { ms: 4000 });
  }

  clearContents() {
    const s = this.selRange();
    this.exec('清除内容', () => this.wb.clearRange(this.sheetId, s, { contents: true, formats: false }));
  }

  clearFormats() {
    const s = this.selRange();
    this.exec('清除格式', () => this.wb.clearRange(this.sheetId, s, { contents: false, formats: true }));
  }

  clearAll() {
    const s = this.selRange();
    this.exec('全部清除', () => this.wb.clearRange(this.sheetId, s, { contents: true, formats: true }));
  }

  applyStyle(patch, label = '设置格式') {
    if (this.editor.editing) this.editor.commit();
    const s = this.boundedSelection();
    this.exec(label, () => this.wb.setStyle(this.sheetId, s, patch));
  }

  // Whole-column/row selections only style the used part (plus a margin) to stay fast.
  boundedSelection() {
    const s = this.selRange();
    const b = this.sheet.bounds();
    return {
      r1: s.r1, c1: s.c1,
      r2: Math.min(s.r2, Math.max(s.r1, b.maxRow + 100, this.anchor.r)),
      c2: Math.min(s.c2, Math.max(s.c1, b.maxCol + 10, this.anchor.c))
    };
  }

  toggleStyle(key) {
    const a = this.active();
    const on = !!this.wb.getCell(this.sheetId, a.r, a.c)?.style?.[key];
    const names = { bold: '加粗', italic: '倾斜', underline: '下划线', strike: '删除线', wrap: '自动换行' };
    this.applyStyle({ [key]: on ? null : true }, names[key]);
  }

  setAlign(align) {
    const a = this.active();
    const cur = this.wb.getCell(this.sheetId, a.r, a.c)?.style?.align;
    this.applyStyle({ align: cur === align ? null : align }, '对齐');
  }

  setNumFmt(fmt) {
    this.applyStyle({ numFmt: fmt === 'General' ? null : fmt }, '数字格式');
  }

  changeDecimals(delta) {
    const a = this.active();
    let fmt = this.wb.effectiveFormat(this.sheetId, a.r, a.c);
    if (fmt === 'General' || isDateFormat(fmt)) {
      const v = this.wb.getValue(this.sheetId, a.r, a.c);
      const dec = typeof v === 'number' ? Math.min(10, (formatGeneralNumber(v).split('.')[1] || '').length) : 0;
      const n = Math.max(0, dec + delta);
      fmt = n ? `0.${'0'.repeat(n)}` : '0';
    } else {
      fmt = adjustDecimals(fmt, delta);
    }
    this.setNumFmt(fmt);
  }

  insertNow(kind) {
    const now = this.wb.now();
    const p = serialToParts(now);
    const pad = n => String(n).padStart(2, '0');
    const text = kind === 'date' ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : `${pad(p.hour)}:${pad(p.minute)}`;
    const a = this.active();
    this.exec(kind === 'date' ? '插入日期' : '插入时间', () => this.wb.setCells([{ sheetId: this.sheetId, r: a.r, c: a.c, input: text }]));
  }

  // ----- rows & columns -----

  insertRows(where) {
    const s = this.selRange();
    const n = s.r2 - s.r1 + 1;
    const at = where === 'below' ? s.r2 + 1 : s.r1;
    this.exec(`插入 ${n} 行`, () => this.wb.insertRows(this.sheetId, at, n), { snapshot: true });
    if (where === 'below') this.selectRange({ ...s, r1: at, r2: at + n - 1 }, { r: at, c: this.anchor.c });
  }

  insertCols(where) {
    const s = this.selRange();
    const n = s.c2 - s.c1 + 1;
    const at = where === 'right' ? s.c2 + 1 : s.c1;
    this.exec(`插入 ${n} 列`, () => this.wb.insertCols(this.sheetId, at, n), { snapshot: true });
    if (where === 'right') this.selectRange({ ...s, c1: at, c2: at + n - 1 }, { r: this.anchor.r, c: at });
  }

  deleteRows() {
    const s = this.selRange();
    const n = s.r2 - s.r1 + 1;
    this.exec(`删除 ${n} 行`, () => this.wb.deleteRows(this.sheetId, s.r1, n), { snapshot: true });
    this.select(s.r1, this.anchor.c, { scroll: false });
  }

  deleteCols() {
    const s = this.selRange();
    const n = s.c2 - s.c1 + 1;
    this.exec(`删除 ${n} 列`, () => this.wb.deleteCols(this.sheetId, s.c1, n), { snapshot: true });
    this.select(this.anchor.r, s.c1, { scroll: false });
  }

  resizeColumns(c, width) {
    const s = this.selRange();
    const cols = s.r1 === 0 && s.r2 >= this.sheet.rowCount - 1 && c >= s.c1 && c <= s.c2 ? range(s.c1, s.c2) : [c];
    this.exec('调整列宽', () => { for (const k of cols) this.wb.setColWidth(this.sheetId, k, width); });
  }

  resizeRows(r, height) {
    const s = this.selRange();
    const rows = s.c1 === 0 && s.c2 >= this.sheet.colCount - 1 && r >= s.r1 && r <= s.r2 ? range(s.r1, s.r2) : [r];
    this.exec('调整行高', () => { for (const k of rows) this.wb.setRowHeight(this.sheetId, k, height); });
  }

  autoFitColumn(c) {
    this.exec('自动列宽', () => this.wb.setColWidth(this.sheetId, c, this.grid.measureColumn(c)));
  }

  // ----- sort, fill, autosum -----

  // Excel's "current region": the block of data around a cell bounded by empty rows/columns.
  currentRegion(r, c) {
    const has = (y, x) => y >= 0 && x >= 0 && (this.wb.getCell(this.sheetId, y, x)?.input ?? '') !== '';
    let b = { r1: r, c1: c, r2: r, c2: c };
    for (let guard = 0; guard < 10000; guard++) {
      let grown = false;
      const rowHas = y => { for (let x = b.c1 - 1; x <= b.c2 + 1; x++) if (has(y, x)) return true; return false; };
      const colHas = x => { for (let y = b.r1 - 1; y <= b.r2 + 1; y++) if (has(y, x)) return true; return false; };
      if (b.r1 > 0 && rowHas(b.r1 - 1)) { b.r1--; grown = true; }
      if (rowHas(b.r2 + 1)) { b.r2++; grown = true; }
      if (b.c1 > 0 && colHas(b.c1 - 1)) { b.c1--; grown = true; }
      if (colHas(b.c2 + 1)) { b.c2++; grown = true; }
      if (!grown) break;
    }
    return b;
  }

  sort(asc) {
    if (this.editor.editing) this.editor.commit();
    const s = this.selRange();
    const single = s.r1 === s.r2;
    const full = s.r1 === 0 && s.r2 >= this.sheet.rowCount - 1;
    let rng = single || full ? this.currentRegion(this.anchor.r, this.anchor.c) : s;
    if (full) rng = { ...rng, c1: Math.min(rng.c1, s.c1), c2: Math.max(rng.c2, s.c2) };
    if (rng.r1 === rng.r2) { toast('至少需要两行数据才能排序'); return; }
    const header = this.looksLikeHeader(rng);
    const col = Math.max(rng.c1, Math.min(rng.c2, this.anchor.c));
    this.exec(asc ? '升序排序' : '降序排序', () => this.wb.sortRange(this.sheetId, rng, [{ col, asc }], { header }));
    this.selectRange(rng, { r: rng.r1, c: col });
    toast(`已按 ${formatAddress(0, col).replace(/\d+/, '')} 列${asc ? '升序' : '降序'}排序 ${formatRange(rng)}${header ? '（第一行是标题，未参与排序）' : ''}`, { ms: 3500 });
  }

  looksLikeHeader(rng) {
    let allText = true, anyBold = false, belowNumber = false;
    for (let c = rng.c1; c <= rng.c2; c++) {
      const cell = this.wb.getCell(this.sheetId, rng.r1, c);
      if (!cell || typeof cell.value !== 'string' || cell.ast) allText = false;
      if (cell?.style?.bold) anyBold = true;
      const below = this.wb.getCell(this.sheetId, rng.r1 + 1, c);
      if (typeof below?.value === 'number') belowNumber = true;
    }
    return allText && (anyBold || belowNumber);
  }

  fill(src, target) {
    this.exec('填充', () => this.wb.fillRange(this.sheetId, src, target));
    this.selectRange(target, this.active());
  }

  fillDown() {
    const s = this.selRange();
    const src = s.r1 === s.r2 ? { ...s, r1: s.r1 - 1, r2: s.r1 - 1 } : { ...s, r2: s.r1 };
    if (src.r1 < 0) return;
    const target = s.r1 === s.r2 ? s : { ...s, r1: s.r1 + 1 };
    this.exec('向下填充', () => this.wb.pasteRange(this.wb.copyRange(this.sheetId, src), this.sheetId, target));
  }

  fillRight() {
    const s = this.selRange();
    const src = s.c1 === s.c2 ? { ...s, c1: s.c1 - 1, c2: s.c1 - 1 } : { ...s, c2: s.c1 };
    if (src.c1 < 0) return;
    const target = s.c1 === s.c2 ? s : { ...s, c1: s.c1 + 1 };
    this.exec('向右填充', () => this.wb.pasteRange(this.wb.copyRange(this.sheetId, src), this.sheetId, target));
  }

  autosum() {
    if (this.editor.editing) { this.editor.insertFunction('SUM'); return; }
    const s = this.selRange();
    const isNum = (r, c) => typeof this.wb.getCell(this.sheetId, r, c)?.value === 'number';
    if (s.r1 === s.r2 && s.c1 === s.c2) {
      const rng = autoSumRange(isNum, s.r1, s.c1);
      const ref = rng ? refText(rng) : '';
      this.editor.begin({ text: `=SUM(${ref})`, mode: 'enter', caret: 5 + ref.length });
      if (rng) this.editor.state.point = { from: 5, to: 5 + ref.length, anchor: { r: rng.r1, c: rng.c1 }, cursor: { r: rng.r2, c: rng.c2 }, range: rng };
      this.editor.refresh();
      return;
    }
    // Several cells: a total under each selected column.
    const lastRowEmpty = range(s.c1, s.c2).every(c => (this.wb.getCell(this.sheetId, s.r2, c)?.input ?? '') === '');
    const sumRow = lastRowEmpty ? s.r2 : s.r2 + 1;
    const top = s.r1, bottom = lastRowEmpty ? s.r2 - 1 : s.r2;
    if (bottom < top) return;
    const list = [];
    for (let c = s.c1; c <= s.c2; c++) {
      let any = false;
      for (let r = top; r <= bottom && !any; r++) any = isNum(r, c);
      if (any) list.push({ sheetId: this.sheetId, r: sumRow, c, input: `=SUM(${refText({ r1: top, c1: c, r2: bottom, c2: c })})` });
    }
    if (!list.length) { toast('选区里没有数字'); return; }
    this.exec('自动求和', () => this.wb.setCells(list));
    this.selectRange({ r1: s.r1, c1: s.c1, r2: sumRow, c2: s.c2 }, this.active());
  }

  // ----- clipboard -----

  selectionTSV(rng = this.selRange()) {
    const b = this.sheet.bounds();
    const r2 = Math.min(rng.r2, b.maxRow), c2 = Math.min(rng.c2, b.maxCol);
    const rows = [];
    for (let r = rng.r1; r <= Math.max(rng.r1, r2); r++) {
      const row = [];
      for (let c = rng.c1; c <= Math.max(rng.c1, c2); c++) {
        const t = this.wb.getDisplay(this.sheetId, r, c)?.text ?? '';
        row.push(/[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      }
      rows.push(row.join('\t'));
    }
    return { text: rows.join('\n'), range: { r1: rng.r1, c1: rng.c1, r2: Math.max(rng.r1, r2), c2: Math.max(rng.c1, c2) } };
  }

  selectionHTML(rng) {
    let html = '<table>';
    for (let r = rng.r1; r <= rng.r2; r++) {
      html += '<tr>';
      for (let c = rng.c1; c <= rng.c2; c++) {
        const d = this.wb.getDisplay(this.sheetId, r, c);
        const st = d?.style || {};
        const css = [st.bold && 'font-weight:bold', st.italic && 'font-style:italic', st.fill && `background:${st.fill}`, (d?.color || st.color) && `color:${d?.color || st.color}`, d && `text-align:${d.align}`].filter(Boolean).join(';');
        html += `<td${css ? ` style="${css}"` : ''}>${esc(d?.text ?? '')}</td>`;
      }
      html += '</tr>';
    }
    return html + '</table>';
  }

  copySelection(cut = false) {
    const { text, range: rng } = this.selectionTSV();
    this.clip = { sheetId: this.sheetId, range: rng, clip: this.wb.copyRange(this.sheetId, rng), text, cut };
    this.invalidate();
    return { text, html: this.selectionHTML(rng) };
  }

  async copyButton(cut = false) {
    if (this.editor.editing) this.editor.commit();
    const { text } = this.copySelection(cut);
    try { await navigator.clipboard?.writeText(text); } catch { /* the in-app clipboard still works */ }
    toast(cut ? '已剪切，选择目标位置后点“粘贴”' : '已复制', { ms: 1500 });
  }

  async pasteButton() {
    if (this.editor.editing) this.editor.commit();
    let text = null;
    try { text = await navigator.clipboard?.readText(); } catch { text = null; }
    if (text === null || text === undefined) {
      if (!this.clip) { toast('剪贴板是空的'); return; }
      text = this.clip.text;
    }
    this.pasteText(text);
  }

  pasteText(text, { what = 'all' } = {}) {
    const norm = s => s.replace(/\r\n/g, '\n').replace(/\n$/, '');
    const dest = this.selRange();
    if (this.clip && norm(this.clip.text) === norm(text)) {
      const clip = this.clip;
      if (clip.cut && what === 'all') {
        const h = clip.range.r2 - clip.range.r1, w = clip.range.c2 - clip.range.c1;
        this.exec('剪切粘贴', () => this.wb.moveRange(clip.sheetId, clip.range, this.sheetId, dest.r1, dest.c1), { snapshot: true });
        this.clip = null;
        this.selectRange({ r1: dest.r1, c1: dest.c1, r2: dest.r1 + h, c2: dest.c1 + w });
        return;
      }
      const out = this.exec(what === 'values' ? '粘贴值' : what === 'formats' ? '粘贴格式' : '粘贴', () => this.wb.pasteRange(clip.clip, this.sheetId, dest, { what }));
      if (out) this.selectRange(out);
      return;
    }
    // External text: tab-separated rows (Excel, Numbers, web tables) or a single value.
    let rows = parseCSV(norm(text), '\t');
    if (!rows.length) rows = [['']];
    const list = [];
    if (rows.length === 1 && rows[0].length === 1) {
      for (let r = dest.r1; r <= dest.r2; r++) for (let c = dest.c1; c <= dest.c2; c++) list.push({ sheetId: this.sheetId, r, c, input: rows[0][0] });
    } else {
      rows.forEach((row, i) => row.forEach((v, j) => {
        if (dest.r1 + i < MAX_ROWS && dest.c1 + j < MAX_COLS) list.push({ sheetId: this.sheetId, r: dest.r1 + i, c: dest.c1 + j, input: v });
      }));
    }
    this.exec('粘贴', () => this.wb.setCells(list));
    const w = Math.max(...rows.map(r => r.length));
    if (list.length > 1 && !(rows.length === 1 && rows[0].length === 1)) this.selectRange({ r1: dest.r1, c1: dest.c1, r2: dest.r1 + rows.length - 1, c2: dest.c1 + w - 1 });
  }

  // ----- sheets -----

  async addSheet() {
    if (this.editor.editing) this.editor.commit();
    const index = this.wb.sheets.findIndex(s => s.id === this.sheetId) + 1;
    let id;
    this.exec('新建工作表', () => { id = this.wb.addSheet(this.wb.uniqueSheetName(), index).id; }, { snapshot: true });
    this.showSheet(id);
  }

  async renameSheet(id = this.sheetId) {
    const sheet = this.wb.sheetById(id);
    const name = await promptText('重命名工作表', sheet.name, { validate: v => this.wb.validateSheetName(v, id) });
    if (name === null || name.trim() === sheet.name) return;
    this.exec('重命名工作表', () => this.wb.renameSheet(id, name), { snapshot: true });
  }

  async deleteSheet(id = this.sheetId) {
    if (this.wb.sheets.length <= 1) { toast('至少要保留一个工作表'); return; }
    const sheet = this.wb.sheetById(id);
    const ok = sheet.cells.size === 0 || await confirmDialog('删除工作表', `确定删除“${sheet.name}”吗？引用它的公式会变成 #REF!（可以撤销）。`, { okLabel: '删除', danger: true });
    if (!ok) return;
    const idx = this.wb.sheets.indexOf(sheet);
    this.exec('删除工作表', () => this.wb.removeSheet(id), { snapshot: true });
    this.sheetId = this.wb.sheets[Math.max(0, idx - 1)].id;
    this.invalidate();
  }

  duplicateSheet(id = this.sheetId) {
    const data = this.wb.toJSON();
    const src = data.sheets.find(s => s.id === id);
    const base = `${src.name} 副本`.slice(0, 28);
    let name = base;
    for (let k = 2; this.wb.resolveSheet(name) !== null; k++) name = `${base} ${k}`;
    let newId;
    this.exec('复制工作表', () => {
      const idx = this.wb.sheets.findIndex(s => s.id === id) + 1;
      data.sheets.splice(idx, 0, { ...src, id: undefined, name });
      this.wb.load(data);
      newId = this.wb.sheets[idx].id;
    }, { snapshot: true });
    if (newId) this.showSheet(newId);
  }

  moveSheetBy(id, delta) {
    const idx = this.wb.sheets.findIndex(s => s.id === id);
    const to = idx + delta;
    if (to < 0 || to >= this.wb.sheets.length) return;
    this.exec('移动工作表', () => this.wb.moveSheet(id, to), { snapshot: true });
  }

  sheetMenu(id, at) {
    const idx = this.wb.sheets.findIndex(s => s.id === id);
    showMenu([
      { label: '重命名…', action: () => this.renameSheet(id) },
      { label: '复制工作表', action: () => this.duplicateSheet(id) },
      { label: '向左移动', disabled: idx === 0, action: () => this.moveSheetBy(id, -1) },
      { label: '向右移动', disabled: idx === this.wb.sheets.length - 1, action: () => this.moveSheetBy(id, 1) },
      '-',
      { label: '删除工作表', danger: true, disabled: this.wb.sheets.length <= 1, action: () => this.deleteSheet(id) }
    ], at);
  }

  // ---------- menus ----------

  onContextMenu(hit, x, y) {
    if (this.editor.editing) this.editor.commit();
    if (hit.kind === 'cell' && !this.inSelection(hit.r, hit.c)) this.select(hit.r, hit.c, { scroll: false });
    if (hit.kind === 'col' && !(this.inSelection(0, hit.c) && this.selRange().r2 >= this.sheet.rowCount - 1)) this.onHeaderDown('col', hit.c, {});
    if (hit.kind === 'row' && !(this.inSelection(hit.r, 0) && this.selRange().c2 >= this.sheet.colCount - 1)) this.onHeaderDown('row', hit.r, {});
    const s = this.selRange();
    const nr = s.r2 - s.r1 + 1, nc = s.c2 - s.c1 + 1;
    const fullCols = s.r1 === 0 && s.r2 >= this.sheet.rowCount - 1;
    const fullRows = s.c1 === 0 && s.c2 >= this.sheet.colCount - 1;
    const items = [
      { label: '剪切', hint: 'Ctrl+X', action: () => this.copyButton(true) },
      { label: '复制', hint: 'Ctrl+C', action: () => this.copyButton(false) },
      { label: '粘贴', hint: 'Ctrl+V', action: () => this.pasteButton() },
      { label: '仅粘贴值', disabled: !this.clip, action: () => this.clip && this.pasteText(this.clip.text, { what: 'values' }) },
      { label: '仅粘贴格式', disabled: !this.clip, action: () => this.clip && this.pasteText(this.clip.text, { what: 'formats' }) },
      '-'
    ];
    if (!fullRows) items.push({ label: `在左侧插入 ${nc} 列`, action: () => this.insertCols('left') }, { label: `在右侧插入 ${nc} 列`, action: () => this.insertCols('right') });
    if (!fullCols) items.push({ label: `在上方插入 ${nr} 行`, action: () => this.insertRows('above') }, { label: `在下方插入 ${nr} 行`, action: () => this.insertRows('below') });
    if (!fullRows) items.push({ label: `删除第 ${colLabel(s)} 列`, action: () => this.deleteCols() });
    if (!fullCols) items.push({ label: `删除第 ${s.r1 + 1}${nr > 1 ? `–${s.r2 + 1}` : ''} 行`, action: () => this.deleteRows() });
    items.push('-',
      { label: '清除内容', hint: 'Delete', action: () => this.clearContents() },
      { label: '清除格式', action: () => this.clearFormats() },
      '-',
      { label: '升序排序', action: () => this.sort(true) },
      { label: '降序排序', action: () => this.sort(false) });
    if (hit.kind === 'col') items.push('-', { label: '自动调整列宽', action: () => this.autoFitColumn(hit.c) }, { label: '设置列宽…', action: () => this.askColumnWidth(hit.c) });
    if (hit.kind === 'row') items.push('-', { label: '设置行高…', action: () => this.askRowHeight(hit.r) });
    showMenu(items, { x, y });
  }

  async askColumnWidth(c) {
    const v = await promptText('列宽（像素）', String(this.sheet.colWidth(c)), { validate: t => (Number(t) >= 24 && Number(t) <= 800 ? null : '请输入 24 到 800 之间的数字') });
    if (v !== null) this.resizeColumns(c, Number(v));
  }

  async askRowHeight(r) {
    const v = await promptText('行高（像素）', String(this.sheet.rowHeight(r)), { validate: t => (Number(t) >= 16 && Number(t) <= 400 ? null : '请输入 16 到 400 之间的数字') });
    if (v !== null) this.resizeRows(r, Number(v));
  }

  formatMenu(anchor) {
    const a = this.active();
    const cur = this.wb.effectiveFormat(this.sheetId, a.r, a.c);
    showMenu([
      ...FORMAT_PRESETS.map(p => ({ label: p.label, checked: p.id === cur, action: () => this.setNumFmt(p.id) })),
      '-',
      {
        label: '自定义格式…',
        action: async () => {
          const v = await promptText('自定义数字格式', cur === 'General' ? '0.00' : cur, { label: '例如 0.00、#,##0、0%、yyyy-mm-dd、"¥"#,##0.00;[Red]-"¥"#,##0.00' });
          if (v) this.setNumFmt(v.trim());
        }
      }
    ], { anchor });
  }

  colorMenu(anchor, kind) {
    const colors = kind === 'fill' ? FILL_COLORS : TEXT_COLORS;
    const a = this.active();
    const current = this.wb.getCell(this.sheetId, a.r, a.c)?.style?.[kind === 'fill' ? 'fill' : 'color'] ?? null;
    const pal = colorPalette(colors, current, c => {
      if (kind === 'fill') { if (c) this.lastFill = c; this.applyStyle({ fill: c }, '填充颜色'); }
      else { if (c) this.lastColor = c; this.applyStyle({ color: c }, '文字颜色'); }
    });
    const el = showMenu([{ html: pal.html }], { anchor }, { className: 'palette-menu' });
    pal.bind(el);
  }

  insertMenu(anchor) {
    const s = this.selRange();
    const nr = s.r2 - s.r1 + 1, nc = s.c2 - s.c1 + 1;
    showMenu([
      { label: `在上方插入 ${nr} 行`, action: () => this.insertRows('above') },
      { label: `在下方插入 ${nr} 行`, action: () => this.insertRows('below') },
      { label: `在左侧插入 ${nc} 列`, action: () => this.insertCols('left') },
      { label: `在右侧插入 ${nc} 列`, action: () => this.insertCols('right') },
      '-',
      { label: `删除第 ${s.r1 + 1}${nr > 1 ? `–${s.r2 + 1}` : ''} 行`, action: () => this.deleteRows() },
      { label: `删除第 ${colLabel(s)} 列`, action: () => this.deleteCols() },
      '-',
      { label: '向下填充', hint: 'Ctrl+D', action: () => this.fillDown() },
      { label: '向右填充', hint: 'Ctrl+R', action: () => this.fillRight() }
    ], { anchor });
  }

  // ---------- name box ----------

  goTo(text) {
    let t = text.trim();
    let sheetId = this.sheetId;
    const bang = t.lastIndexOf('!');
    if (bang > 0) {
      const name = t.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
      sheetId = this.wb.resolveSheet(name);
      if (sheetId === null) { toast(`没有名为“${name}”的工作表`); return false; }
      t = t.slice(bang + 1);
    }
    const rng = parseRangeAddress(t);
    if (!rng) { toast(`“${text}”不是有效的地址，例如 B5 或 A1:C10`); return false; }
    this.showSheet(sheetId);
    this.selectRange(rng);
    return true;
  }

  // ---------- wiring ----------

  bind() {
    const { toolbar, tabs, namebox } = this.els;
    const run = (cmd, el) => this.command(cmd, el);
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-cmd]');
      if (!b || b.disabled) return;
      run(b.dataset.cmd, b);
    });
    // Toolbar buttons must not steal focus from the editor or the grid.
    for (const el of [toolbar, document.querySelector('.topbar'), document.querySelector('.bottombar'), this.els.keybar, document.querySelector('.fbar')]) {
      el.addEventListener('pointerdown', e => {
        if (e.target.closest('button') && e.pointerType === 'mouse') e.preventDefault();
      });
    }
    this.els.keybar.addEventListener('pointerdown', e => {
      const b = e.target.closest('[data-key]');
      if (!b) return;
      e.preventDefault();
      this.editor.type(b.dataset.key);
    });
    tabs.addEventListener('click', e => {
      const t = e.target.closest('[data-sheet]');
      if (t) this.showSheet(Number(t.dataset.sheet));
    });
    tabs.addEventListener('dblclick', e => {
      const t = e.target.closest('[data-sheet]');
      if (t && !this.editor.editing) this.renameSheet(Number(t.dataset.sheet));
    });
    tabs.addEventListener('contextmenu', e => {
      const t = e.target.closest('[data-sheet]');
      if (!t) return;
      e.preventDefault();
      this.sheetMenu(Number(t.dataset.sheet), { x: e.clientX, y: e.clientY });
    });
    let pressTimer = null;
    tabs.addEventListener('pointerdown', e => {
      const t = e.target.closest('[data-sheet]');
      if (!t || e.pointerType === 'mouse') return;
      pressTimer = setTimeout(() => this.sheetMenu(Number(t.dataset.sheet), { x: e.clientX, y: e.clientY - 200 }), 550);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointermove']) tabs.addEventListener(ev, () => clearTimeout(pressTimer));

    namebox.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (this.goTo(namebox.value)) namebox.blur(); }
      if (e.key === 'Escape') { namebox.blur(); this.invalidate(); }
    });
    namebox.addEventListener('focus', () => namebox.select());
    namebox.addEventListener('blur', () => this.invalidate());

    // If focus ever falls back to <body> (after a dialog, a menu, a click on blank chrome),
    // keystrokes still drive the grid and typing still starts an edit.
    document.addEventListener('keydown', e => {
      if (document.activeElement !== document.body || this.editor.editing || document.querySelector('.modal-back, .menu')) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { this.editor.focusSink(); return; }
      this.onGridKey(e);
    });
    document.addEventListener('copy', e => this.onClipboard(e, 'copy'));
    document.addEventListener('cut', e => this.onClipboard(e, 'cut'));
    document.addEventListener('paste', e => this.onClipboard(e, 'paste'));
    window.addEventListener('resize', () => this.invalidate());
  }

  onClipboard(e, kind) {
    if (this.editor.editing) return;
    const t = e.target;
    const sink = this.els.cellInput;
    if (t && t !== sink && t !== document.body && /INPUT|TEXTAREA/.test(t.tagName)) return;
    if (document.querySelector('.modal-back')) return;
    e.preventDefault();
    if (kind === 'paste') {
      const text = e.clipboardData.getData('text/plain');
      if (text) this.pasteText(text);
      return;
    }
    const { text, html } = this.copySelection(kind === 'cut');
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', html);
  }

  // Toolbar / menu command names -> actions. Panels (file, find, help, functions) are added by app.js.
  command(cmd, el) {
    const map = {
      undo: () => this.undo(),
      redo: () => this.redo(),
      bold: () => this.toggleStyle('bold'),
      italic: () => this.toggleStyle('italic'),
      underline: () => this.toggleStyle('underline'),
      strike: () => this.toggleStyle('strike'),
      wrap: () => this.toggleStyle('wrap'),
      'align-left': () => this.setAlign('left'),
      'align-center': () => this.setAlign('center'),
      'align-right': () => this.setAlign('right'),
      'format-menu': () => this.formatMenu(el),
      'fmt-percent': () => this.setNumFmt('0%'),
      'fmt-dec-more': () => this.changeDecimals(1),
      'fmt-dec-less': () => this.changeDecimals(-1),
      'color-menu': () => this.colorMenu(el, 'color'),
      'fill-menu': () => this.colorMenu(el, 'fill'),
      autosum: () => this.autosum(),
      'sort-asc': () => this.sort(true),
      'sort-desc': () => this.sort(false),
      'insert-menu': () => this.insertMenu(el),
      copy: () => this.copyButton(false),
      cut: () => this.copyButton(true),
      paste: () => this.pasteButton(),
      clear: () => this.clearContents(),
      'add-sheet': () => this.addSheet(),
      'edit-commit': () => this.editor.commit(),
      'edit-cancel': () => this.editor.cancel()
    };
    const extra = this.extraCommands?.[cmd];
    (map[cmd] || extra)?.(el);
  }

  toast(msg, opts) { toast(msg, opts); }
}

// ---------- helpers ----------

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function colLabel(s) {
  const a = formatAddress(0, s.c1).replace(/\d+/, '');
  const b = formatAddress(0, s.c2).replace(/\d+/, '');
  return a === b ? a : `${a}–${b}`;
}

// Add or remove decimal places in every section of a number format.
export function adjustDecimals(fmt, delta) {
  return fmt.split(';').map(sec => {
    if (/"[^"]*$/.test(sec)) return sec;
    const m = /(\.)([0#?]+)/.exec(sec);
    if (m) {
      const n = Math.max(0, m[2].length + delta);
      return sec.slice(0, m.index) + (n ? '.' + '0'.repeat(n) : '') + sec.slice(m.index + m[0].length);
    }
    if (delta > 0) {
      // insert after the last integer placeholder
      const idx = Math.max(sec.lastIndexOf('0'), sec.lastIndexOf('#'));
      if (idx >= 0) return sec.slice(0, idx + 1) + '.' + '0'.repeat(delta) + sec.slice(idx + 1);
    }
    return sec;
  }).join(';');
}

function errorHelp(code) {
  return {
    '#DIV/0!': '#DIV/0!：除数为零',
    '#VALUE!': '#VALUE!：参数类型不对，比如把文字当成数字计算',
    '#REF!': '#REF!：引用的单元格已经不存在（被删除或超出范围）',
    '#NAME?': '#NAME?：函数名或名称拼写有误',
    '#N/A': '#N/A：没有找到要查找的值',
    '#NUM!': '#NUM!：数值无效或超出范围',
    '#CIRC!': '#CIRC!：循环引用，公式直接或间接引用了自己',
    '#ERROR!': '#ERROR!：公式语法有误'
  }[code] || code;
}
