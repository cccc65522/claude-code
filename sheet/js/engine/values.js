// Runtime values.
//   number | string | boolean | null (blank) | FormulaError | Matrix (ranges and array constants)
//
// Coercion helpers throw a FormulaError; the evaluator catches it at the nearest
// function call or operator, so function bodies can be written without plumbing.

import { parseDateText } from './dates.js';

export class FormulaError {
  constructor(code) {
    this.code = code;
  }
  toString() {
    return this.code;
  }
}

export const ERR = {
  NULL: new FormulaError('#NULL!'),
  DIV0: new FormulaError('#DIV/0!'),
  VALUE: new FormulaError('#VALUE!'),
  REF: new FormulaError('#REF!'),
  NAME: new FormulaError('#NAME?'),
  NUM: new FormulaError('#NUM!'),
  NA: new FormulaError('#N/A'),
  CIRC: new FormulaError('#CIRC!')
};
const BY_CODE = new Map(Object.values(ERR).map(e => [e.code, e]));
export const errorFromCode = code => BY_CODE.get(code) || ERR.VALUE;
export const isError = v => v instanceof FormulaError;

// A 2-D block of values: either a live view of sheet cells or a literal array.
export class Matrix {
  get rows() { return 0; }
  get cols() { return 0; }
  get() { return null; }
  // Visit every cell, including blanks, row-major.
  forEach(fn) {
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.cols; j++) fn(this.get(i, j), i, j);
  }
  // Visit non-blank cells only; sheet ranges override this to skip empty space quickly.
  forEachValue(fn) {
    this.forEach((v, i, j) => { if (v !== null) fn(v, i, j); });
  }
  toArray() {
    const out = [];
    for (let i = 0; i < this.rows; i++) {
      const row = [];
      for (let j = 0; j < this.cols; j++) row.push(this.get(i, j));
      out.push(row);
    }
    return out;
  }
}

export class ArrayValue extends Matrix {
  constructor(data) {
    super();
    this.data = data;
  }
  get rows() { return this.data.length; }
  get cols() { return this.data[0]?.length ?? 0; }
  get(i, j) { return this.data[i]?.[j] ?? null; }
}

export const isMatrix = v => v instanceof Matrix;

// ---------- coercion ----------

const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function textToNumber(s) {
  const t = s.trim().replace(/,(?=\d{3}(?:\D|$))/g, '');
  if (NUMERIC_TEXT.test(t)) return Number(t);
  const pct = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))%$/.exec(t);
  if (pct) return Number(pct[1]) / 100;
  return null;
}

export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    if (v === '') return 0;
    const n = textToNumber(v);
    if (n !== null) return n;
    // Like Excel, date and time text counts as its serial number: ="2026-01-05"+1 is 46028.
    const d = parseDateText(v);
    if (d) return d.serial;
    throw ERR.VALUE;
  }
  if (isError(v)) throw v;
  throw ERR.VALUE;
}

export function toText(v) {
  if (typeof v === 'string') return v;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return formatGeneralNumber(v);
  if (isError(v)) throw v;
  throw ERR.VALUE;
}

export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null) return false;
  if (typeof v === 'string') {
    const u = v.toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
    throw ERR.VALUE;
  }
  if (isError(v)) throw v;
  throw ERR.VALUE;
}

// Excel's "General" display for numbers: up to 15 significant digits, no float noise,
// scientific notation only for very large or very small magnitudes.
export function formatGeneralNumber(n) {
  if (!Number.isFinite(n)) return '#NUM!';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-9) {
    const [m, e] = n.toExponential(10).split('e');
    const mant = m.replace(/\.?0+$/, '');
    const exp = Number(e);
    return `${mant}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  const s = Number(n.toPrecision(15)).toString();
  return s.includes('e') ? n.toFixed(Math.min(20, 15 - Math.floor(Math.log10(abs)))).replace(/\.?0+$/, '') : s;
}

// Excel ordering for mixed types: numbers < text < booleans; text is case-insensitive.
const typeRank = v => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);

export function compareValues(a, b) {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'string') {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function valuesEqual(a, b) {
  return compareValues(a, b) === 0;
}

// An argument slot left empty, as in IF(A1,,1). Distinct from an omitted argument (undefined).
export const MISSING = Symbol('missing');
