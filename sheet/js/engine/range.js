// Live views of sheet cells used as formula values, and implicit intersection.

import { ERR, Matrix, ArrayValue, isMatrix, MISSING } from './values.js';

export class RangeMatrix extends Matrix {
  // `source` provides getValue(sheetId, r, c) and usedBounds(sheetId).
  constructor(source, sheetId, r1, c1, r2, c2, clip = false) {
    super();
    this.source = source;
    this.sheetId = sheetId;
    this.r1 = r1;
    this.c1 = c1;
    // Whole-row/column ranges are clipped to the used area so A:A doesn't mean a million cells.
    if (clip) {
      const b = source.usedBounds(sheetId);
      r2 = Math.min(r2, b.maxRow);
      c2 = Math.min(c2, b.maxCol);
    }
    this.r2 = r2;
    this.c2 = c2;
  }
  get rows() { return Math.max(0, this.r2 - this.r1 + 1); }
  get cols() { return Math.max(0, this.c2 - this.c1 + 1); }
  get(i, j) {
    if (i < 0 || j < 0 || i >= this.rows || j >= this.cols) return null;
    return this.source.getValue(this.sheetId, this.r1 + i, this.c1 + j);
  }
  forEachValue(fn) {
    const area = this.rows * this.cols;
    if (area === 0) return;
    const count = this.source.cellCount(this.sheetId);
    if (area > count * 4) {
      // Sparse: walk the sheet's cells instead of the empty grid, in row-major order.
      const hits = [];
      this.source.forEachCellIn(this.sheetId, this.r1, this.c1, this.r2, this.c2, (r, c) => hits.push([r, c]));
      hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [r, c] of hits) {
        const v = this.source.getValue(this.sheetId, r, c);
        if (v !== null) fn(v, r - this.r1, c - this.c1);
      }
      return;
    }
    super.forEachValue(fn);
  }
  sub(i, j, rows, cols) {
    return new RangeMatrix(this.source, this.sheetId, this.r1 + i, this.c1 + j, this.r1 + i + rows - 1, this.c1 + j + cols - 1);
  }
}

// Implicit intersection: turn a matrix into the one value that applies to this cell.
export function toScalar(v, ctx) {
  if (!isMatrix(v)) return v === MISSING ? null : v;
  if (v.rows === 1 && v.cols === 1) return v.get(0, 0);
  if (v instanceof RangeMatrix && ctx && v.sheetId === ctx.sheetId) {
    if (v.cols === 1 && ctx.row >= v.r1 && ctx.row <= v.r2) return v.get(ctx.row - v.r1, 0);
    if (v.rows === 1 && ctx.col >= v.c1 && ctx.col <= v.c2) return v.get(0, ctx.col - v.c1);
  }
  if (v instanceof ArrayValue && v.rows > 0) return v.get(0, 0);
  return ERR.VALUE;
}
