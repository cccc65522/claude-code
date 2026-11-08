// Workbook model: sheets, cells, the dependency graph and incremental recalculation.
//
// Dependency graph
//   Every formula cell registers what it reads: single cells in `cellDeps`
//   (precedent -> dependents) and ranges in a per-sheet row-bucketed RangeIndex.
//   When cells change we collect the transitive set of dirty formulas, then
//   evaluate them in topological order (Kahn). Whatever can't be ordered sits on
//   or behind a cycle: Tarjan's SCC finds the actual cycles, those cells get
//   #CIRC!, and evaluation resumes for everything downstream of them.
//   Dynamic references (INDIRECT, OFFSET) can read cells the static graph doesn't
//   know about, so reading a still-dirty cell evaluates it on demand.

import { MAX_ROWS, MAX_COLS, formatAddress } from './address.js';
import { parseFormula, printFormula, walk, FormulaSyntaxError } from './parser.js';
import { evaluateFormula } from './evaluator.js';
import { FUNCTIONS } from './functions.js';
import { ERR, FormulaError, isError, errorFromCode, compareValues } from './values.js';
import { parseInput } from './input.js';
import { formatValue, isDateFormat } from './format.js';
import { serialFromJsDate } from './dates.js';
import { shiftRelative, adjustStructural, adjustForMove, renameSheetRefs, qualifyRefs } from './rewrite.js';

export const PARSE_ERROR = new FormulaError('#ERROR!');

const SHEET_SPAN = MAX_ROWS * MAX_COLS; // 2^34
const cellKey = (r, c) => r * MAX_COLS + c;
const nodeKey = (sheetId, r, c) => sheetId * SHEET_SPAN + r * MAX_COLS + c;
function unpackNode(k) {
  const sheetId = Math.floor(k / SHEET_SPAN);
  const rem = k - sheetId * SHEET_SPAN;
  return { sheetId, r: Math.floor(rem / MAX_COLS), c: rem % MAX_COLS };
}
const unpackCell = k => ({ r: Math.floor(k / MAX_COLS), c: k % MAX_COLS });

export const DEFAULT_COL_WIDTH = 96;
export const DEFAULT_ROW_HEIGHT = 24;
export const DEFAULT_ROWS = 200;
export const DEFAULT_COLS = 26;

// ---------- range index ----------

const BLOCK_SHIFT = 8; // 256-row buckets
const WIDE_BLOCKS = 16;

class RangeIndex {
  constructor() {
    this.buckets = new Map();
    this.wide = new Set();
    this.size = 0;
  }
  add(e) {
    this.size++;
    const b1 = e.r1 >> BLOCK_SHIFT, b2 = e.r2 >> BLOCK_SHIFT;
    if (b2 - b1 > WIDE_BLOCKS) { this.wide.add(e); return; }
    for (let b = b1; b <= b2; b++) {
      let set = this.buckets.get(b);
      if (!set) this.buckets.set(b, (set = new Set()));
      set.add(e);
    }
  }
  remove(e) {
    this.size--;
    const b1 = e.r1 >> BLOCK_SHIFT, b2 = e.r2 >> BLOCK_SHIFT;
    if (b2 - b1 > WIDE_BLOCKS) { this.wide.delete(e); return; }
    for (let b = b1; b <= b2; b++) {
      const set = this.buckets.get(b);
      if (set) { set.delete(e); if (!set.size) this.buckets.delete(b); }
    }
  }
  query(r, c, fn) {
    const set = this.buckets.get(r >> BLOCK_SHIFT);
    if (set) for (const e of set) if (r >= e.r1 && r <= e.r2 && c >= e.c1 && c <= e.c2) fn(e.owner);
    for (const e of this.wide) if (r >= e.r1 && r <= e.r2 && c >= e.c1 && c <= e.c2) fn(e.owner);
  }
}

// ---------- sheet ----------

export class Sheet {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.cells = new Map();
    this.rowCount = DEFAULT_ROWS;
    this.colCount = DEFAULT_COLS;
    this.colWidths = new Map();
    this.rowHeights = new Map();
    this._bounds = { maxRow: -1, maxCol: -1 };
    this._boundsDirty = false;
  }
  get(r, c) {
    return this.cells.get(cellKey(r, c));
  }
  colWidth(c) {
    return this.colWidths.get(c) ?? DEFAULT_COL_WIDTH;
  }
  rowHeight(r) {
    return this.rowHeights.get(r) ?? DEFAULT_ROW_HEIGHT;
  }
  bounds() {
    if (this._boundsDirty) {
      let maxRow = -1, maxCol = -1;
      for (const [k, cell] of this.cells) {
        if (cell.input === '') continue;
        const { r, c } = unpackCell(k);
        if (r > maxRow) maxRow = r;
        if (c > maxCol) maxCol = c;
      }
      this._bounds = { maxRow, maxCol };
      this._boundsDirty = false;
    }
    return this._bounds;
  }
  _grow(r, c) {
    if (!this._boundsDirty) {
      if (r > this._bounds.maxRow) this._bounds.maxRow = r;
      if (c > this._bounds.maxCol) this._bounds.maxCol = c;
    }
    if (r >= this.rowCount) this.rowCount = Math.min(MAX_ROWS, r + 50);
    if (c >= this.colCount) this.colCount = Math.min(MAX_COLS, c + 5);
  }
}

const SHEET_NAME_BAD = /[\\/?*[\]:]/;

const DATE_RESULT = { DATE: 'yyyy-mm-dd', TODAY: 'yyyy-mm-dd', EDATE: 'yyyy-mm-dd', EOMONTH: 'yyyy-mm-dd', WORKDAY: 'yyyy-mm-dd', DATEVALUE: 'yyyy-mm-dd', NOW: 'yyyy-mm-dd hh:mm', TIME: 'hh:mm' };
const INHERIT_FORMAT = new Set(['SUM', 'MIN', 'MAX', 'AVERAGE', 'MEDIAN', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'SUMIF', 'SUMIFS', 'MAXIFS', 'MINIFS', 'AVERAGEIF', 'AVERAGEIFS', 'LARGE', 'SMALL', 'ABS']);

// ---------- workbook ----------

export class Workbook {
  constructor({ now, random } = {}) {
    this.sheets = [];
    this.byId = new Map();
    this.nextSheetId = 1;
    this.cellDeps = new Map();
    this.rangeIdx = new Map();
    this.volatile = new Set();
    this.now = now || (() => serialFromJsDate(new Date()));
    this.random = random || Math.random;
    this.stats = { evaluated: 0, recalcs: 0 };
    this.version = 0;
    this._pending = null;
    this._evaluating = new Set();
    this._rec = null;
  }

  static create(opts) {
    const wb = new Workbook(opts);
    wb.addSheet('Sheet1');
    return wb;
  }

  // ----- sheets -----

  sheetById(id) {
    return this.byId.get(id) || null;
  }

  resolveSheet(name) {
    const lower = name.toLowerCase();
    for (const s of this.sheets) if (s.name.toLowerCase() === lower) return s.id;
    return null;
  }

  validateSheetName(name, exceptId = null) {
    const n = name.trim();
    if (!n) return '工作表名不能为空';
    if (n.length > 31) return '工作表名最多 31 个字符';
    if (SHEET_NAME_BAD.test(n)) return '工作表名不能包含 \\ / ? * [ ] :';
    if (/^'|'$/.test(n)) return '工作表名不能以单引号开头或结尾';
    const id = this.resolveSheet(n);
    if (id !== null && id !== exceptId) return '已有同名工作表';
    return null;
  }

  uniqueSheetName(base = 'Sheet') {
    for (let i = this.sheets.length + 1; ; i++) {
      const name = `${base}${i}`;
      if (this.resolveSheet(name) === null) return name;
    }
  }

  addSheet(name = this.uniqueSheetName(), index = this.sheets.length, id = null) {
    const err = this.validateSheetName(name);
    if (err) throw new Error(err);
    const sid = id ?? this.nextSheetId;
    this.nextSheetId = Math.max(this.nextSheetId, sid + 1);
    const sheet = new Sheet(sid, name.trim());
    this.sheets.splice(index, 0, sheet);
    this.byId.set(sid, sheet);
    this.rangeIdx.set(sid, new RangeIndex());
    // Formulas that mentioned this name were #REF!; now they resolve.
    if (this._anyFormulaMentions(sheet.name)) this._rebuildAndRecalc();
    this.version++;
    return sheet;
  }

  _anyFormulaMentions(name) {
    const lower = name.toLowerCase();
    for (const s of this.sheets) {
      for (const cell of s.cells.values()) {
        if (!cell.ast) continue;
        let hit = false;
        walk(cell.ast, n => { if ((n.type === 'ref' || n.type === 'range') && n.sheet && n.sheet.toLowerCase() === lower) hit = true; });
        if (hit) return true;
      }
    }
    return false;
  }

  renameSheet(id, newName) {
    const sheet = this.byId.get(id);
    const err = this.validateSheetName(newName, id);
    if (err) throw new Error(err);
    const old = sheet.name;
    newName = newName.trim();
    if (old === newName) return;
    this._rewriteAll(ast => renameSheetRefs(ast, old, newName));
    sheet.name = newName;
    this._rebuildAndRecalc();
  }

  removeSheet(id) {
    if (this.sheets.length <= 1) throw new Error('至少要保留一个工作表');
    const sheet = this.byId.get(id);
    this.sheets = this.sheets.filter(s => s !== sheet);
    this.byId.delete(id);
    this.rangeIdx.delete(id);
    this._rewriteAll(ast => renameSheetRefs(ast, sheet.name, null));
    this._rebuildAndRecalc();
  }

  moveSheet(id, index) {
    const sheet = this.byId.get(id);
    this.sheets = this.sheets.filter(s => s !== sheet);
    this.sheets.splice(Math.max(0, Math.min(index, this.sheets.length)), 0, sheet);
    this.version++;
  }

  // ----- reading -----

  getCell(sheetId, r, c) {
    return this.byId.get(sheetId)?.get(r, c) || null;
  }

  getInput(sheetId, r, c) {
    return this.getCell(sheetId, r, c)?.input ?? '';
  }

  // Formula-engine source interface (see range.js).
  getValue(sheetId, r, c) {
    const k = nodeKey(sheetId, r, c);
    if (this._evaluating.has(k)) return ERR.CIRC;
    if (this._pending && this._pending.has(k)) this._evalNode(k);
    const cell = this.byId.get(sheetId)?.cells.get(cellKey(r, c));
    return cell ? cell.value : null;
  }
  usedBounds(sheetId) {
    return this.byId.get(sheetId)?.bounds() ?? { maxRow: -1, maxCol: -1 };
  }
  cellCount(sheetId) {
    return this.byId.get(sheetId)?.cells.size ?? 0;
  }
  forEachCellIn(sheetId, r1, c1, r2, c2, fn) {
    const sheet = this.byId.get(sheetId);
    if (!sheet) return;
    for (const k of sheet.cells.keys()) {
      const { r, c } = unpackCell(k);
      if (r >= r1 && r <= r2 && c >= c1 && c <= c2) fn(r, c);
    }
  }

  effectiveFormat(sheetId, r, c, depth = 0) {
    const cell = this.getCell(sheetId, r, c);
    if (!cell) return 'General';
    if (cell.style?.numFmt) return cell.style.numFmt;
    const hint = cell.fmtHint;
    if (!hint || depth > 4) return 'General';
    if (typeof hint === 'string') return hint;
    const inherited = this.effectiveFormat(hint.sheetId, hint.r, hint.c, depth + 1);
    return hint.noDate && isDateFormat(inherited) ? 'General' : inherited;
  }

  // { text, align, color, style, error } for rendering.
  getDisplay(sheetId, r, c) {
    const cell = this.getCell(sheetId, r, c);
    if (!cell) return null;
    const fmt = this.effectiveFormat(sheetId, r, c);
    const f = formatValue(cell.value, fmt);
    return {
      text: f.text,
      align: cell.style?.align || f.align,
      color: f.color,
      style: cell.style,
      error: isError(cell.value) ? (cell.parseError || cell.value.code) : null
    };
  }

  // ----- writing -----

  // Batch of { sheetId, r, c, input, style? }. `style` (if present) replaces the cell style;
  // otherwise the existing style is kept and typed values may pick up a number format.
  setCells(list, { autoFormat = true } = {}) {
    const changed = [];
    for (const item of list) {
      const sheet = this.byId.get(item.sheetId);
      if (!sheet) continue;
      this._record(sheet, item.r, item.c);
      const existing = sheet.get(item.r, item.c);
      const style = 'style' in item ? item.style : existing?.style ?? null;
      this._writeCell(sheet, item.r, item.c, item.input ?? '', style, autoFormat && !('style' in item));
      changed.push(nodeKey(sheet.id, item.r, item.c));
    }
    this._recalc(changed);
    this.version++;
  }

  setCell(sheetId, r, c, input) {
    this.setCells([{ sheetId, r, c, input }]);
  }

  // Merge a style patch into every cell of a range ({ bold: true }, { numFmt: '0.00' }, { fill: null }...).
  setStyle(sheetId, range, patch) {
    const sheet = this.byId.get(sheetId);
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        this._record(sheet, r, c);
        const cell = sheet.get(r, c);
        const next = { ...(cell?.style || {}), ...patch };
        for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined || next[k] === false) delete next[k];
        const style = Object.keys(next).length ? next : null;
        if (cell) {
          cell.style = style;
          if (!style && cell.input === '') sheet.cells.delete(cellKey(r, c));
        } else if (style) {
          sheet.cells.set(cellKey(r, c), this._emptyCell(style));
        }
      }
    }
    this.version++;
  }

  clearRange(sheetId, range, { contents = true, formats = false } = {}) {
    const sheet = this.byId.get(sheetId);
    const list = [];
    for (const k of [...sheet.cells.keys()]) {
      const { r, c } = unpackCell(k);
      if (r < range.r1 || r > range.r2 || c < range.c1 || c > range.c2) continue;
      const cell = sheet.cells.get(k);
      list.push({
        sheetId, r, c,
        input: contents ? '' : cell.input,
        style: formats ? null : cell.style
      });
    }
    if (list.length) this.setCells(list, { autoFormat: false });
  }

  setColWidth(sheetId, col, width) {
    const sheet = this.byId.get(sheetId);
    this._recordLayout(sheet);
    if (width === null || width === DEFAULT_COL_WIDTH) sheet.colWidths.delete(col);
    else sheet.colWidths.set(col, Math.max(24, Math.min(800, Math.round(width))));
    this.version++;
  }

  setRowHeight(sheetId, row, height) {
    const sheet = this.byId.get(sheetId);
    this._recordLayout(sheet);
    if (height === null || Math.round(height) === DEFAULT_ROW_HEIGHT) sheet.rowHeights.delete(row);
    else sheet.rowHeights.set(row, Math.max(16, Math.min(400, Math.round(height))));
    this.version++;
  }

  _recordLayout(sheet) {
    if (this._rec && !this._rec.layout.has(sheet.id)) {
      this._rec.layout.set(sheet.id, { cols: new Map(sheet.colWidths), rows: new Map(sheet.rowHeights) });
    }
  }

  _emptyCell(style) {
    return { input: '', value: null, ast: null, parseError: null, style, volatile: false, deps: null, fmtHint: null };
  }

  _writeCell(sheet, r, c, input, style, autoFormat) {
    const key = cellKey(r, c);
    const owner = nodeKey(sheet.id, r, c);
    let cell = sheet.cells.get(key);
    if (cell?.deps) this._unlink(owner, cell);

    const parsed = parseInput(input);
    if (parsed.kind === 'empty') {
      if (style) {
        sheet.cells.set(key, this._emptyCell(style));
      } else {
        sheet.cells.delete(key);
      }
      sheet._boundsDirty = true;
      return;
    }

    cell = this._emptyCell(style);
    sheet.cells.set(key, cell);
    sheet._grow(r, c);

    if (parsed.kind === 'formula') {
      try {
        cell.ast = parseFormula(parsed.text);
        cell.input = '=' + printFormula(cell.ast);
        this._link(sheet, r, c, cell);
        cell.value = null; // filled in by recalc
      } catch (e) {
        if (!(e instanceof FormulaSyntaxError)) throw e;
        cell.input = input;
        cell.parseError = e.message;
        cell.value = PARSE_ERROR;
      }
      return;
    }

    cell.input = input;
    cell.value = literalValue(parsed.value);
    if (autoFormat && parsed.format && !cell.style?.numFmt) {
      cell.style = { ...(cell.style || {}), numFmt: parsed.format };
    }
  }

  _link(sheet, r, c, cell) {
    const owner = nodeKey(sheet.id, r, c);
    const deps = [];
    let firstRef = null;
    walk(cell.ast, node => {
      if (node.type === 'ref') {
        const sid = node.sheet === null ? sheet.id : this.resolveSheet(node.sheet);
        if (sid === null) return;
        const k = nodeKey(sid, node.row, node.col);
        let set = this.cellDeps.get(k);
        if (!set) this.cellDeps.set(k, (set = new Set()));
        set.add(owner);
        deps.push({ k });
        if (!firstRef) firstRef = { sheetId: sid, r: node.row, c: node.col };
      } else if (node.type === 'range') {
        const sid = node.sheet === null ? sheet.id : this.resolveSheet(node.sheet);
        if (sid === null) return;
        const entry = {
          sheetId: sid, owner,
          r1: Math.min(node.start.row, node.end.row), r2: Math.max(node.start.row, node.end.row),
          c1: Math.min(node.start.col, node.end.col), c2: Math.max(node.start.col, node.end.col)
        };
        this.rangeIdx.get(sid).add(entry);
        deps.push({ entry });
        if (!firstRef) firstRef = { sheetId: sid, r: entry.r1, c: entry.c1 };
      } else if (node.type === 'call' && FUNCTIONS[node.name]?.volatile) {
        cell.volatile = true;
      }
    });
    cell.deps = deps;
    if (cell.volatile) this.volatile.add(owner);
    cell.fmtHint = this._formatHint(cell.ast, firstRef);
  }

  _formatHint(ast, firstRef) {
    let top = ast;
    while (top.type === 'paren') top = top.expr;
    if (top.type === 'call' && DATE_RESULT[top.name]) return DATE_RESULT[top.name];
    if (!firstRef) return null;
    if (top.type === 'ref') return firstRef;
    if (top.type === 'binary' && '+-*/'.includes(top.op)) {
      let left = top.left;
      while (left.type === 'paren') left = left.expr;
      // A date times two is not a date; a percentage or an amount still is.
      if (left.type === 'ref') return top.op === '+' || top.op === '-' ? firstRef : { ...firstRef, noDate: true };
    }
    if (top.type === 'call' && INHERIT_FORMAT.has(top.name)) return firstRef;
    return null;
  }

  _unlink(owner, cell) {
    for (const d of cell.deps) {
      if (d.k !== undefined) {
        const set = this.cellDeps.get(d.k);
        if (set) { set.delete(owner); if (!set.size) this.cellDeps.delete(d.k); }
      } else {
        this.rangeIdx.get(d.entry.sheetId)?.remove(d.entry);
      }
    }
    cell.deps = null;
    this.volatile.delete(owner);
  }

  _dependents(k, fn) {
    const set = this.cellDeps.get(k);
    if (set) for (const o of set) fn(o);
    const { sheetId, r, c } = unpackNode(k);
    this.rangeIdx.get(sheetId)?.query(r, c, fn);
  }

  _isFormulaNode(k) {
    const { sheetId, r, c } = unpackNode(k);
    return !!this.byId.get(sheetId)?.cells.get(cellKey(r, c))?.ast;
  }

  // ----- recalculation -----

  _recalc(changed) {
    this.stats.recalcs++;
    const dirty = new Set();
    const adj = new Map();
    const stack = [];
    const seen = new Set();
    const markDirty = k => {
      if (!dirty.has(k)) { dirty.add(k); stack.push(k); }
    };
    for (const k of changed) {
      if (this._isFormulaNode(k)) markDirty(k);
      else stack.push(k);
    }
    for (const k of this.volatile) markDirty(k);

    while (stack.length) {
      const k = stack.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      const out = new Set();
      this._dependents(k, d => out.add(d));
      for (const d of out) markDirty(d);
      if (dirty.has(k)) adj.set(k, out);
    }
    if (!dirty.size) return;

    const indeg = new Map();
    for (const k of dirty) indeg.set(k, 0);
    for (const out of adj.values()) for (const d of out) indeg.set(d, indeg.get(d) + 1);

    this._pending = new Set(dirty);
    const queue = [];
    for (const [k, n] of indeg) if (n === 0) queue.push(k);
    const done = new Set();
    const release = k => {
      done.add(k);
      const out = adj.get(k);
      if (!out) return;
      for (const d of out) {
        if (done.has(d)) continue;
        const n = indeg.get(d) - 1;
        indeg.set(d, n);
        if (n === 0) queue.push(d);
      }
    };

    try {
      for (;;) {
        while (queue.length) {
          const k = queue.pop();
          if (done.has(k)) continue;
          if (this._pending.has(k)) this._evalNode(k);
          release(k);
        }
        if (done.size >= dirty.size) break;
        const remaining = [...dirty].filter(k => !done.has(k));
        const cyclic = findCycles(remaining, adj);
        if (!cyclic.length) {
          // Shouldn't happen; evaluate the rest on demand rather than hang.
          for (const k of remaining) { if (this._pending.has(k)) this._evalNode(k); done.add(k); }
          break;
        }
        for (const k of cyclic) {
          this._setValue(k, ERR.CIRC);
          this._pending.delete(k);
          done.add(k);
        }
        for (const k of cyclic) {
          for (const d of adj.get(k) || []) {
            if (done.has(d)) continue;
            const n = indeg.get(d) - 1;
            indeg.set(d, n);
            if (n === 0) queue.push(d);
          }
        }
      }
    } finally {
      this._pending = null;
    }
  }

  recalcAll() {
    const all = [];
    for (const s of this.sheets) for (const [k, cell] of s.cells) if (cell.ast) all.push(s.id * SHEET_SPAN + k);
    this._recalc(all);
    this.version++;
  }

  _setValue(k, v) {
    const { sheetId, r, c } = unpackNode(k);
    const cell = this.byId.get(sheetId)?.cells.get(cellKey(r, c));
    if (cell) cell.value = v;
  }

  _evalNode(k) {
    this._pending.delete(k);
    const { sheetId, r, c } = unpackNode(k);
    const cell = this.byId.get(sheetId)?.cells.get(cellKey(r, c));
    if (!cell || !cell.ast) return;
    this._evaluating.add(k);
    let v;
    try {
      v = evaluateFormula(cell.ast, {
        source: this,
        sheetId, row: r, col: c,
        resolveSheet: name => this.resolveSheet(name),
        now: this.now,
        random: this.random
      });
    } catch (e) {
      if (e instanceof RangeError) v = ERR.NUM; // e.g. stack overflow in a pathological INDIRECT chain
      else throw e;
    } finally {
      this._evaluating.delete(k);
    }
    cell.value = v;
    this.stats.evaluated++;
  }

  _rebuildAndRecalc() {
    this.cellDeps.clear();
    this.volatile.clear();
    for (const s of this.sheets) this.rangeIdx.set(s.id, new RangeIndex());
    for (const s of this.sheets) {
      for (const [k, cell] of s.cells) {
        if (!cell.ast) continue;
        const { r, c } = unpackCell(k);
        cell.volatile = false;
        this._link(s, r, c, cell);
      }
    }
    this.recalcAll();
  }

  // Apply fn(ast, sheet) to every formula; write back the ones that changed.
  _rewriteAll(fn) {
    for (const s of this.sheets) {
      for (const cell of s.cells.values()) {
        if (!cell.ast) continue;
        const next = fn(cell.ast, s);
        if (next !== cell.ast) {
          cell.ast = next;
          cell.input = '=' + printFormula(next);
        }
      }
    }
  }

  // Does a reference node (found in a formula living on `home`) point at sheet `sheetId`?
  _refTargets(node, home, sheetId) {
    return (node.sheet === null ? home.id : this.resolveSheet(node.sheet)) === sheetId;
  }

  // ----- structure -----

  insertRows(sheetId, at, count = 1) { this._structural(sheetId, { axis: 'row', at, count, kind: 'insert' }); }
  deleteRows(sheetId, at, count = 1) { this._structural(sheetId, { axis: 'row', at, count, kind: 'delete' }); }
  insertCols(sheetId, at, count = 1) { this._structural(sheetId, { axis: 'col', at, count, kind: 'insert' }); }
  deleteCols(sheetId, at, count = 1) { this._structural(sheetId, { axis: 'col', at, count, kind: 'delete' }); }

  _structural(sheetId, op) {
    const sheet = this.byId.get(sheetId);
    this._rewriteAll((ast, home) => adjustStructural(ast, node => this._refTargets(node, home, sheetId), op));

    const { axis, at, count, kind } = op;
    const limit = axis === 'row' ? MAX_ROWS : MAX_COLS;
    const moved = new Map();
    for (const [k, cell] of sheet.cells) {
      let { r, c } = unpackCell(k);
      let v = axis === 'row' ? r : c;
      if (kind === 'insert') {
        if (v >= at) v += count;
        if (v >= limit) continue;
      } else {
        if (v >= at && v < at + count) continue;
        if (v >= at + count) v -= count;
      }
      if (axis === 'row') r = v; else c = v;
      moved.set(cellKey(r, c), cell);
    }
    sheet.cells = moved;
    sheet._boundsDirty = true;

    if (axis === 'col') {
      const widths = new Map();
      for (const [c, w] of sheet.colWidths) {
        if (kind === 'insert') widths.set(c >= at ? c + count : c, w);
        else if (c < at) widths.set(c, w);
        else if (c >= at + count) widths.set(c - count, w);
      }
      sheet.colWidths = widths;
      sheet.colCount = Math.max(1, Math.min(MAX_COLS, sheet.colCount + (kind === 'insert' ? count : -count)));
    } else {
      const heights = new Map();
      for (const [r, h] of sheet.rowHeights) {
        if (kind === 'insert') { if (r + (r >= at ? count : 0) < MAX_ROWS) heights.set(r >= at ? r + count : r, h); }
        else if (r < at) heights.set(r, h);
        else if (r >= at + count) heights.set(r - count, h);
      }
      sheet.rowHeights = heights;
      sheet.rowCount = Math.max(1, Math.min(MAX_ROWS, sheet.rowCount + (kind === 'insert' ? count : -count)));
    }
    this._rebuildAndRecalc();
  }

  // ----- clipboard -----

  copyRange(sheetId, range) {
    const sheet = this.byId.get(sheetId);
    const cells = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const row = [];
      for (let c = range.c1; c <= range.c2; c++) {
        const cell = sheet.get(r, c);
        row.push(cell ? { input: cell.input, style: cell.style, ast: cell.ast, value: cell.value } : null);
      }
      cells.push(row);
    }
    return { sheetId, range: { ...range }, cells };
  }

  // Paste a copied block. A destination that is a whole multiple of the block is tiled.
  // what: 'all' | 'values' | 'formats'. Returns the range written.
  pasteRange(clip, sheetId, dest, { what = 'all' } = {}) {
    const h = clip.cells.length, w = clip.cells[0].length;
    const dh = dest.r2 - dest.r1 + 1, dw = dest.c2 - dest.c1 + 1;
    const rows = dh > h && dh % h === 0 ? dh : h;
    const cols = dw > w && dw % w === 0 ? dw : w;
    const sheet = this.byId.get(sheetId);
    const list = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const r = dest.r1 + i, c = dest.c1 + j;
        if (r >= MAX_ROWS || c >= MAX_COLS) continue;
        const src = clip.cells[i % h][j % w];
        const existing = sheet.get(r, c);
        const srcR = clip.range.r1 + (i % h), srcC = clip.range.c1 + (j % w);
        if (what === 'formats') {
          list.push({ sheetId, r, c, input: existing?.input ?? '', style: src?.style ?? null });
          continue;
        }
        let input = '';
        if (src) {
          if (what === 'values') input = valueToInput(src.value);
          else if (src.ast) input = '=' + printFormula(shiftRelative(src.ast, r - srcR, c - srcC));
          else input = src.input;
        }
        list.push({ sheetId, r, c, input, style: what === 'values' ? existing?.style ?? null : src?.style ?? null });
      }
    }
    this.setCells(list, { autoFormat: false });
    return { r1: dest.r1, c1: dest.c1, r2: dest.r1 + rows - 1, c2: dest.c1 + cols - 1 };
  }

  // Cut & paste: cells move, and every formula that pointed at them follows.
  moveRange(srcSheetId, src, dstSheetId, dstRow, dstCol) {
    const dr = dstRow - src.r1, dc = dstCol - src.c1;
    if (dr === 0 && dc === 0 && srcSheetId === dstSheetId) return;
    const srcSheet = this.byId.get(srcSheetId), dstSheet = this.byId.get(dstSheetId);
    const h = src.r2 - src.r1, w = src.c2 - src.c1;
    if (dstRow + h >= MAX_ROWS || dstCol + w >= MAX_COLS) throw new Error('超出表格范围');

    const movedKeys = new Set();
    const moving = [];
    for (const [k, cell] of srcSheet.cells) {
      const { r, c } = unpackCell(k);
      if (r >= src.r1 && r <= src.r2 && c >= src.c1 && c <= src.c2) {
        moving.push({ r, c, cell });
        movedKeys.add(k);
      }
    }
    const sameSheet = srcSheetId === dstSheetId;
    const moveSpec = (home, destSheet) => ({
      src, dr, dc, destSheet,
      targetsSource: node => this._refTargets(node, home, srcSheetId),
      targetsDest: node => this._refTargets(node, home, dstSheetId)
    });
    // Formulas that stay put: refs into the block follow it to the destination.
    for (const s of this.sheets) {
      const spec = moveSpec(s, node => (sameSheet ? node.sheet : s.id === dstSheetId ? null : dstSheet.name));
      for (const [k, cell] of s.cells) {
        if (!cell.ast || (s === srcSheet && movedKeys.has(k))) continue;
        const next = adjustForMove(cell.ast, spec);
        if (next !== cell.ast) { cell.ast = next; cell.input = '=' + printFormula(next); }
      }
    }
    // Moving formulas keep reading the same cells; across sheets that means qualifying
    // their refs with the old sheet first, then dropping qualifiers that name the new home.
    const movingSpec = moveSpec(srcSheet, node => (sameSheet ? node.sheet : dstSheet.name));
    for (const m of moving) {
      if (!m.cell.ast) continue;
      let ast = m.cell.ast;
      if (!sameSheet) ast = qualifyRefs(ast, srcSheet.name);
      ast = adjustForMove(ast, movingSpec);
      if (!sameSheet) ast = unqualifyHome(ast, dstSheet.name);
      m.cell.ast = ast;
      m.cell.input = '=' + printFormula(ast);
    }
    for (const k of movedKeys) srcSheet.cells.delete(k);
    for (let r = src.r1 + dr; r <= src.r2 + dr; r++) for (let c = src.c1 + dc; c <= src.c2 + dc; c++) dstSheet.cells.delete(cellKey(r, c));
    for (const m of moving) {
      dstSheet.cells.set(cellKey(m.r + dr, m.c + dc), m.cell);
      dstSheet._grow(m.r + dr, m.c + dc);
    }
    srcSheet._boundsDirty = true;
    dstSheet._boundsDirty = true;
    this._rebuildAndRecalc();
  }

  // ----- fill & sort -----

  // Extend `src` to cover `target` (which contains src and extends it in one direction).
  fillRange(sheetId, src, target) {
    const sheet = this.byId.get(sheetId);
    let dir;
    if (target.r2 > src.r2) dir = 'down';
    else if (target.r1 < src.r1) dir = 'up';
    else if (target.c2 > src.c2) dir = 'right';
    else if (target.c1 < src.c1) dir = 'left';
    else return;
    const vertical = dir === 'down' || dir === 'up';
    const lines = vertical ? range(src.c1, src.c2) : range(src.r1, src.r2);
    const list = [];
    for (const line of lines) {
      const seq = (vertical ? range(src.r1, src.r2) : range(src.c1, src.c2)).map(i => {
        const r = vertical ? i : line, c = vertical ? line : i;
        return { r, c, cell: sheet.get(r, c) };
      });
      if (dir === 'up' || dir === 'left') seq.reverse();
      const n = seq.length;
      const series = detectSeries(seq.map(s => s.cell), this, sheetId, seq);
      const targets = vertical
        ? (dir === 'down' ? range(src.r2 + 1, target.r2) : range(target.r1, src.r1 - 1).reverse())
        : (dir === 'right' ? range(src.c2 + 1, target.c2) : range(target.c1, src.c1 - 1).reverse());
      targets.forEach((pos, k) => {
        const r = vertical ? pos : line, c = vertical ? line : pos;
        const from = seq[k % n];
        const step = k + n; // position in the extended sequence
        let input = '';
        if (series) input = series(step);
        else if (from.cell?.ast) input = '=' + printFormula(shiftRelative(from.cell.ast, r - from.r, c - from.c));
        else if (from.cell) input = from.cell.input;
        list.push({ sheetId, r, c, input, style: from.cell?.style ?? null });
      });
    }
    this.setCells(list, { autoFormat: false });
  }

  // Sort the rows of `rng` by keys [{ col, asc }]. Formulas move like copy/paste.
  sortRange(sheetId, rng, keys, { header = false } = {}) {
    const sheet = this.byId.get(sheetId);
    const r1 = rng.r1 + (header ? 1 : 0);
    if (r1 >= rng.r2) return;
    const rows = [];
    for (let r = r1; r <= rng.r2; r++) {
      const cells = [];
      for (let c = rng.c1; c <= rng.c2; c++) cells.push(sheet.get(r, c) || null);
      rows.push({ r, cells, keys: keys.map(k => sheet.get(r, k.col)?.value ?? null) });
    }
    const cmp = (a, b) => {
      for (let i = 0; i < keys.length; i++) {
        const x = a.keys[i], y = b.keys[i];
        const xb = x === null || x === '', yb = y === null || y === '';
        if (xb || yb) { if (xb && yb) continue; return xb ? 1 : -1; } // blanks last either way
        const xe = isError(x), ye = isError(y);
        if (xe || ye) { if (xe && ye) continue; return xe ? 1 : -1; }
        const c = compareValues(x, y);
        if (c) return keys[i].asc === false ? -c : c;
      }
      return a.r - b.r;
    };
    const sorted = rows.slice().sort(cmp);
    const list = [];
    sorted.forEach((row, i) => {
      const r = r1 + i;
      row.cells.forEach((cell, j) => {
        const c = rng.c1 + j;
        let input = cell ? cell.input : '';
        if (cell?.ast) input = '=' + printFormula(shiftRelative(cell.ast, r - row.r, 0));
        list.push({ sheetId, r, c, input, style: cell?.style ?? null });
      });
    });
    this.setCells(list, { autoFormat: false });
  }

  // ----- undo support -----

  beginRecording() {
    this._rec = { cells: new Map(), layout: new Map() };
  }

  _record(sheet, r, c) {
    if (!this._rec) return;
    const k = nodeKey(sheet.id, r, c);
    if (this._rec.cells.has(k)) return;
    const cell = sheet.get(r, c);
    this._rec.cells.set(k, { sheetId: sheet.id, r, c, before: cell ? { input: cell.input, style: cell.style } : null });
  }

  endRecording() {
    const rec = this._rec;
    this._rec = null;
    if (!rec) return null;
    const cells = [];
    for (const item of rec.cells.values()) {
      const cell = this.getCell(item.sheetId, item.r, item.c);
      const after = cell ? { input: cell.input, style: cell.style } : null;
      if (sameState(item.before, after)) continue;
      cells.push({ ...item, after });
    }
    const layout = [];
    for (const [sheetId, before] of rec.layout) {
      const sheet = this.byId.get(sheetId);
      if (sheet) layout.push({ sheetId, before, after: { cols: new Map(sheet.colWidths), rows: new Map(sheet.rowHeights) } });
    }
    return cells.length || layout.length ? { cells, layout } : null;
  }

  applyPatch(patch, side) {
    const list = patch.cells.map(p => {
      const s = p[side];
      return { sheetId: p.sheetId, r: p.r, c: p.c, input: s ? s.input : '', style: s ? s.style : null };
    });
    if (list.length) this.setCells(list, { autoFormat: false });
    for (const l of patch.layout) {
      const sheet = this.byId.get(l.sheetId);
      if (!sheet) continue;
      sheet.colWidths = new Map(l[side].cols);
      sheet.rowHeights = new Map(l[side].rows);
    }
    this.version++;
  }

  // ----- serialisation -----

  toJSON() {
    const styles = [];
    const styleIndex = new Map();
    const internStyle = st => {
      if (!st) return -1;
      const key = JSON.stringify(st, Object.keys(st).sort());
      if (!styleIndex.has(key)) { styleIndex.set(key, styles.length); styles.push(st); }
      return styleIndex.get(key);
    };
    return {
      app: 'gesuan',
      version: 1,
      sheets: this.sheets.map(s => {
        const cells = [];
        const keys = [...s.cells.keys()].sort((a, b) => a - b);
        for (const k of keys) {
          const cell = s.cells.get(k);
          const { r, c } = unpackCell(k);
          const si = internStyle(cell.style);
          cells.push(si >= 0 ? [r, c, cell.input, si] : [r, c, cell.input]);
        }
        return {
          id: s.id,
          name: s.name,
          rowCount: s.rowCount,
          colCount: s.colCount,
          colWidths: Object.fromEntries(s.colWidths),
          rowHeights: Object.fromEntries(s.rowHeights),
          cells
        };
      }),
      styles
    };
  }

  load(data) {
    if (!data || !Array.isArray(data.sheets) || !data.sheets.length) throw new Error('文件里没有工作表');
    this.sheets = [];
    this.byId.clear();
    this.rangeIdx.clear();
    this.cellDeps.clear();
    this.volatile.clear();
    this.nextSheetId = 1;
    const styles = Array.isArray(data.styles) ? data.styles : [];
    const used = new Set();
    const ids = data.sheets.map(sd => {
      const ok = Number.isInteger(sd.id) && sd.id > 0 && !used.has(sd.id);
      if (ok) used.add(sd.id);
      return ok ? sd.id : null;
    });
    let nextId = Math.max(0, ...used) + 1;
    data.sheets.forEach((sd, i) => {
      let name = String(sd.name ?? '').trim() || this.uniqueSheetName();
      if (this.validateSheetName(name)) name = this.uniqueSheetName();
      const sheet = this.addSheet(name, this.sheets.length, ids[i] ?? nextId++);
      sheet.rowCount = Math.max(DEFAULT_ROWS, Math.min(MAX_ROWS, Number(sd.rowCount) || 0));
      sheet.colCount = Math.max(DEFAULT_COLS, Math.min(MAX_COLS, Number(sd.colCount) || 0));
      for (const [c, w] of Object.entries(sd.colWidths || {})) {
        if (Number.isFinite(Number(w)) && Number(c) >= 0 && Number(c) < MAX_COLS) sheet.colWidths.set(Number(c), Number(w));
      }
      for (const [r, h] of Object.entries(sd.rowHeights || {})) {
        if (Number.isFinite(Number(h)) && Number(r) >= 0 && Number(r) < MAX_ROWS) sheet.rowHeights.set(Number(r), Number(h));
      }
      for (const entry of sd.cells || []) {
        const [r, c, input, si] = entry;
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= MAX_ROWS || c >= MAX_COLS) continue;
        const style = si !== undefined && styles[si] ? { ...styles[si] } : null;
        this._writeCellNoLink(sheet, r, c, String(input ?? ''), style);
      }
    });
    this._rebuildAndRecalc();
  }

  // Load path: parse without linking; _rebuildAndRecalc links everything once at the end.
  _writeCellNoLink(sheet, r, c, input, style) {
    const parsed = parseInput(input);
    const key = cellKey(r, c);
    if (parsed.kind === 'empty') {
      if (style) sheet.cells.set(key, this._emptyCell(style));
      return;
    }
    const cell = this._emptyCell(style);
    sheet.cells.set(key, cell);
    sheet._grow(r, c);
    if (parsed.kind === 'formula') {
      try {
        cell.ast = parseFormula(parsed.text);
        cell.input = '=' + printFormula(cell.ast);
      } catch (e) {
        if (!(e instanceof FormulaSyntaxError)) throw e;
        cell.input = input;
        cell.parseError = e.message;
        cell.value = PARSE_ERROR;
      }
    } else {
      cell.input = input;
      cell.value = literalValue(parsed.value);
    }
  }

  static fromJSON(data, opts) {
    const wb = new Workbook(opts);
    wb.load(data);
    return wb;
  }

  // Formula precedents of a cell, for highlighting.
  precedentsOf(sheetId, r, c) {
    const cell = this.getCell(sheetId, r, c);
    if (!cell?.ast) return [];
    const out = [];
    const sheet = this.byId.get(sheetId);
    walk(cell.ast, node => {
      if (node.type !== 'ref' && node.type !== 'range') return;
      const sid = node.sheet === null ? sheet.id : this.resolveSheet(node.sheet);
      if (sid === null) return;
      if (node.type === 'ref') out.push({ sheetId: sid, r1: node.row, c1: node.col, r2: node.row, c2: node.col });
      else out.push({ sheetId: sid, r1: Math.min(node.start.row, node.end.row), c1: Math.min(node.start.col, node.end.col), r2: Math.max(node.start.row, node.end.row), c2: Math.max(node.start.col, node.end.col) });
    });
    return out;
  }

  address(sheetId, r, c) {
    return formatAddress(r, c);
  }
}

// ---------- helpers ----------

const ERROR_LITERAL = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)$/;
// Typed "#N/A" is the error value itself, as in Excel.
function literalValue(v) {
  return typeof v === 'string' && ERROR_LITERAL.test(v) ? errorFromCode(v) : v;
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function sameState(a, b) {
  if (a === null || b === null) return a === b;
  return a.input === b.input && JSON.stringify(a.style) === JSON.stringify(b.style);
}

// A value written back as typed input that reproduces it exactly.
export function valueToInput(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (isError(v)) return v === PARSE_ERROR ? '' : v.code;
  const parsed = parseInput(v);
  return parsed.kind === 'value' && parsed.value === v && !parsed.format ? v : `'${v}`;
}

function unqualifyHome(ast, homeName) {
  const lower = homeName.toLowerCase();
  return mapSheet(ast, s => (s && s.toLowerCase() === lower ? null : s));
}

function mapSheet(ast, fn) {
  const visit = node => {
    switch (node.type) {
      case 'ref': case 'range': {
        const s = fn(node.sheet);
        return s === node.sheet ? node : { ...node, sheet: s };
      }
      case 'unary': case 'percent': return { ...node, arg: visit(node.arg) };
      case 'binary': return { ...node, left: visit(node.left), right: visit(node.right) };
      case 'paren': return { ...node, expr: visit(node.expr) };
      case 'call': return { ...node, args: node.args.map(visit) };
      default: return node;
    }
  };
  return visit(ast);
}

// Iterative Tarjan restricted to `nodes`; returns nodes that lie on a cycle.
function findCycles(nodes, adj) {
  const inSet = new Set(nodes);
  const index = new Map(), low = new Map(), onStack = new Set();
  const stack = [];
  const cyclic = [];
  let counter = 0;
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work = [[root, null]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v] = frame;
      if (frame[1] === null) {
        index.set(v, counter);
        low.set(v, counter);
        counter++;
        stack.push(v);
        onStack.add(v);
        frame[1] = [...(adj.get(v) || [])].filter(w => inSet.has(w))[Symbol.iterator]();
      }
      const next = frame[1].next();
      if (!next.done) {
        const w = next.value;
        if (!index.has(w)) work.push([w, null]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
      if (low.get(v) === index.get(v)) {
        const comp = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1 || adj.get(v)?.has(v)) cyclic.push(...comp);
      }
    }
  }
  return cyclic;
}

// Fill-series detection. Returns step -> input text, or null to copy cells cyclically.
const LISTS = [
  ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'],
  ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
  ['第一季度', '第二季度', '第三季度', '第四季度'],
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
];

function detectSeries(cells, wb, sheetId, seq) {
  if (!cells.length || cells.some(c => !c || c.ast || c.input === '')) return null;
  const vals = cells.map(c => c.value);
  const n = vals.length;
  if (vals.every(v => typeof v === 'number')) {
    const isDate = isDateFormat(wb.effectiveFormat(sheetId, seq[0].r, seq[0].c));
    if (n === 1 && !isDate) return null;
    const step = n === 1 ? 1 : (vals[n - 1] - vals[0]) / (n - 1);
    // Only extend when the given values are evenly spaced; otherwise copy.
    if (n > 2 && vals.some((v, i) => Math.abs(v - (vals[0] + step * i)) > 1e-9 * Math.max(1, Math.abs(v)))) return null;
    return k => String(Number((vals[0] + step * k).toPrecision(15)));
  }
  if (vals.every(v => typeof v === 'string')) {
    for (const list of LISTS) {
      const idx = vals.map(v => list.indexOf(v));
      if (idx.every(i => i >= 0)) {
        const step = n === 1 ? 1 : (idx[n - 1] - idx[0]) / (n - 1);
        if (!Number.isInteger(step) || idx.some((v, i) => v !== idx[0] + step * i)) return null;
        const L = list.length;
        return k => list[(((idx[0] + step * k) % L) + L) % L];
      }
    }
    const parts = vals.map(v => /^(.*?)(\d+)(\D*)$/.exec(v));
    if (parts.every(p => p && p[1] === parts[0][1] && p[3] === parts[0][3])) {
      const nums = parts.map(p => Number(p[2]));
      const step = n === 1 ? 1 : (nums[n - 1] - nums[0]) / (n - 1);
      if (!Number.isInteger(step) || nums.some((v, i) => v !== nums[0] + step * i)) return null;
      const width = parts[0][2].length;
      const pad = parts[0][2].startsWith('0') ? width : 0;
      return k => {
        const v = nums[0] + step * k;
        return parts[0][1] + (v < 0 ? String(v) : String(v).padStart(pad, '0')) + parts[0][3];
      };
    }
  }
  return null;
}
