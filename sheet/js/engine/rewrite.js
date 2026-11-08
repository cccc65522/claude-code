// Formula reference rewriting. All transforms return a new AST (or the same object
// when nothing changed) and turn references that stop existing into #REF!.

import { mapAst } from './parser.js';
import { MAX_ROWS, MAX_COLS } from './address.js';

const REF_ERROR = { type: 'error', value: '#REF!' };

// fn(ref) gets a normalised view and returns a replacement node, the same node, or null (#REF!).
function mapRefs(ast, fn) {
  let changed = false;
  const out = mapAst(ast, node => {
    if (node.type !== 'ref' && node.type !== 'range') return node;
    const r = fn(node);
    if (r === node) return node;
    changed = true;
    return r === null ? REF_ERROR : r;
  });
  return changed ? out : ast;
}

const inGrid = (row, col) => row >= 0 && row < MAX_ROWS && col >= 0 && col < MAX_COLS;

// Copy/paste and fill: relative parts move by (dr, dc), absolute parts stay.
export function shiftRelative(ast, dr, dc) {
  if (dr === 0 && dc === 0) return ast;
  return mapRefs(ast, node => {
    if (node.type === 'ref') {
      const row = node.rowAbs ? node.row : node.row + dr;
      const col = node.colAbs ? node.col : node.col + dc;
      if (!inGrid(row, col)) return null;
      return row === node.row && col === node.col ? node : { ...node, row, col };
    }
    const move = p => ({
      ...p,
      row: node.kind === 'cols' || p.rowAbs ? p.row : p.row + dr,
      col: node.kind === 'rows' || p.colAbs ? p.col : p.col + dc
    });
    const start = move(node.start), end = move(node.end);
    if (!inGrid(start.row, start.col) || !inGrid(end.row, end.col)) return null;
    return { ...node, start, end };
  });
}

// Inserting or deleting rows/columns on one sheet. `targets(node)` says whether a
// reference points at that sheet. Structural changes move absolute refs too.
//   op: { axis: 'row' | 'col', at, count, kind: 'insert' | 'delete' }
export function adjustStructural(ast, targets, op) {
  const { axis, at, count, kind } = op;
  const key = axis === 'row' ? 'row' : 'col';
  const limit = axis === 'row' ? MAX_ROWS : MAX_COLS;
  const wholeKind = axis === 'row' ? 'cols' : 'rows'; // ranges spanning the full axis aren't affected

  return mapRefs(ast, node => {
    if (!targets(node)) return node;
    if (node.type === 'ref') {
      const v = node[key];
      if (kind === 'insert') {
        if (v < at) return node;
        const nv = v + count;
        return nv >= limit ? null : { ...node, [key]: nv };
      }
      if (v < at) return node;
      if (v < at + count) return null;
      return { ...node, [key]: v - count };
    }
    if (node.kind === wholeKind) return node;
    let s = Math.min(node.start[key], node.end[key]);
    let e = Math.max(node.start[key], node.end[key]);
    const flipped = node.start[key] > node.end[key];
    if (kind === 'insert') {
      if (s >= at) s += count;
      if (e >= at) e += count;
      if (s >= limit) return null;
      e = Math.min(e, limit - 1);
    } else {
      const delEnd = at + count - 1;
      if (s >= at && e <= delEnd) return null;
      const ns = s < at ? s : s > delEnd ? s - count : at;
      const ne = e < at ? e : e > delEnd ? e - count : at - 1;
      s = ns;
      e = ne;
    }
    const a = { ...node.start, [key]: flipped ? e : s };
    const b = { ...node.end, [key]: flipped ? s : e };
    if (a[key] === node.start[key] && b[key] === node.end[key]) return node;
    return { ...node, start: a, end: b };
  });
}

// Cut & paste: references into the moved block follow it; references to cells that
// the paste overwrote become #REF!, like Excel.
//   move: { targetsSource(node), targetsDest(node), src: {r1,c1,r2,c2}, dr, dc, destSheet }
export function adjustForMove(ast, move) {
  const { src, dr, dc } = move;
  const dst = { r1: src.r1 + dr, c1: src.c1 + dc, r2: src.r2 + dr, c2: src.c2 + dc };
  const inside = (b, row, col) => row >= b.r1 && row <= b.r2 && col >= b.c1 && col <= b.c2;
  return mapRefs(ast, node => {
    const fromSource = move.targetsSource(node);
    const toDest = move.targetsDest(node);
    if (!fromSource && !toDest) return node;
    if (node.type === 'ref') {
      if (fromSource && inside(src, node.row, node.col)) {
        return { ...node, sheet: move.destSheet(node), row: node.row + dr, col: node.col + dc };
      }
      if (toDest && inside(dst, node.row, node.col)) return null;
      return node;
    }
    if (node.kind !== 'cells') return node;
    const r1 = Math.min(node.start.row, node.end.row), r2 = Math.max(node.start.row, node.end.row);
    const c1 = Math.min(node.start.col, node.end.col), c2 = Math.max(node.start.col, node.end.col);
    if (fromSource && r1 >= src.r1 && r2 <= src.r2 && c1 >= src.c1 && c2 <= src.c2) {
      return {
        ...node,
        sheet: move.destSheet(node),
        start: { ...node.start, row: node.start.row + dr, col: node.start.col + dc },
        end: { ...node.end, row: node.end.row + dr, col: node.end.col + dc }
      };
    }
    // A range wholly inside the overwritten block points at cells that are gone.
    if (toDest && r1 >= dst.r1 && r2 <= dst.r2 && c1 >= dst.c1 && c2 <= dst.c2 && !(fromSource && overlaps(src, { r1, c1, r2, c2 }))) {
      return null;
    }
    return node;
  });
}

function overlaps(a, b) {
  return a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
}

// Sheet renamed / deleted.
export function renameSheetRefs(ast, oldName, newName) {
  const lower = oldName.toLowerCase();
  return mapRefs(ast, node => {
    if (node.sheet === null || node.sheet.toLowerCase() !== lower) return node;
    return newName === null ? null : { ...node, sheet: newName };
  });
}

// For a formula moving from its own sheet to another, unqualified refs keep pointing home.
export function qualifyRefs(ast, homeSheetName) {
  return mapRefs(ast, node => (node.sheet === null ? { ...node, sheet: homeSheetName } : node));
}
