// Formula tokenizer. Input is the formula text without the leading "=".
//
// Reference tokens are fully resolved here (sheet prefix, $ flags, ranges) so the
// parser only deals with operators and calls. Every token carries [start, end)
// offsets into the source; the editor uses them to colour references.

import { nameToCol, MAX_COLS, MAX_ROWS } from './address.js';

export class FormulaSyntaxError extends Error {
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

const ERROR_LITERALS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#CIRC!'];

const RE = {
  space: /\s+/y,
  number: /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y,
  string: /"((?:[^"]|"")*)"/y,
  quotedSheet: /'((?:[^']|'')+)'!/y,
  plainSheet: /([A-Za-z_一-鿿][A-Za-z0-9_.一-鿿]*)!/y,
  cell: /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_.(一-鿿])/y,
  cellRange: /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}):(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_.(一-鿿])/y,
  colRange: /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_.(一-鿿])/y,
  rowRange: /(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![A-Za-z0-9_.(一-鿿])/y,
  ident: /[A-Za-z_一-鿿][A-Za-z0-9_.一-鿿]*/y,
  callParen: /\s*\(/y
};

function match(re, src, pos) {
  re.lastIndex = pos;
  return re.exec(src);
}

function cellPart(colAbs, colName, rowAbs, rowText) {
  const col = nameToCol(colName);
  const row = Number(rowText) - 1;
  if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return null;
  return { row, col, rowAbs: rowAbs === '$', colAbs: colAbs === '$' };
}

// Try to read a reference (optionally sheet-qualified) at pos.
function readReference(src, pos) {
  let sheet = null;
  let p = pos;
  let m = match(RE.quotedSheet, src, p);
  if (m) {
    sheet = m[1].replace(/''/g, "'");
    p += m[0].length;
  } else if ((m = match(RE.plainSheet, src, p))) {
    sheet = m[1];
    p += m[0].length;
  }

  if ((m = match(RE.cellRange, src, p))) {
    const a = cellPart(m[1], m[2], m[3], m[4]);
    const b = cellPart(m[5], m[6], m[7], m[8]);
    if (a && b) return { type: 'range', kind: 'cells', sheet, start: a, end: b, end_: p + m[0].length };
  }
  if ((m = match(RE.cell, src, p))) {
    const a = cellPart(m[1], m[2], m[3], m[4]);
    if (a) return { type: 'ref', sheet, ...a, end_: p + m[0].length };
  }
  if ((m = match(RE.colRange, src, p))) {
    const c1 = nameToCol(m[2]), c2 = nameToCol(m[4]);
    if (c1 < MAX_COLS && c2 < MAX_COLS) {
      return {
        type: 'range', kind: 'cols', sheet,
        start: { row: 0, col: c1, rowAbs: false, colAbs: m[1] === '$' },
        end: { row: MAX_ROWS - 1, col: c2, rowAbs: false, colAbs: m[3] === '$' },
        end_: p + m[0].length
      };
    }
  }
  if ((m = match(RE.rowRange, src, p))) {
    const r1 = Number(m[2]) - 1, r2 = Number(m[4]) - 1;
    if (r1 >= 0 && r2 >= 0 && r1 < MAX_ROWS && r2 < MAX_ROWS) {
      return {
        type: 'range', kind: 'rows', sheet,
        start: { row: r1, col: 0, rowAbs: m[1] === '$', colAbs: false },
        end: { row: r2, col: MAX_COLS - 1, rowAbs: m[3] === '$', colAbs: false },
        end_: p + m[0].length
      };
    }
  }
  if (sheet !== null) {
    // "Sheet1!" not followed by a usable reference.
    if (src.startsWith('#REF!', p)) return { type: 'error', value: '#REF!', end_: p + 5 };
    throw new FormulaSyntaxError('工作表名后面需要单元格引用', p);
  }
  return null;
}

export function tokenize(src) {
  const tokens = [];
  let pos = 0;
  const push = (tok, from, to) => tokens.push({ ...tok, from, to });

  while (pos < src.length) {
    let m = match(RE.space, src, pos);
    if (m) { pos += m[0].length; continue; }
    const ch = src[pos];
    const start = pos;

    if (ch === '"') {
      m = match(RE.string, src, pos);
      if (!m) throw new FormulaSyntaxError('字符串缺少结尾的引号', pos);
      push({ type: 'string', value: m[1].replace(/""/g, '"') }, start, pos + m[0].length);
      pos += m[0].length;
      continue;
    }

    if (ch === '#') {
      const lit = ERROR_LITERALS.find(e => src.substr(pos, e.length).toUpperCase() === e);
      if (!lit) throw new FormulaSyntaxError('无法识别的错误值', pos);
      push({ type: 'error', value: lit }, start, pos + lit.length);
      pos += lit.length;
      continue;
    }

    // References come before numbers (row ranges like 2:5) and identifiers (A1, Sheet1!B2).
    if (ch === "'" || ch === '$' || /[A-Za-z0-9_一-鿿]/.test(ch)) {
      const ref = readReference(src, pos);
      if (ref) {
        const { end_, ...tok } = ref;
        push(tok, start, end_);
        pos = end_;
        continue;
      }
      if (ch === "'") throw new FormulaSyntaxError('工作表名缺少结尾的单引号', pos);
    }

    if (/[0-9.]/.test(ch)) {
      m = match(RE.number, src, pos);
      if (m) {
        push({ type: 'number', value: Number(m[0]) }, start, pos + m[0].length);
        pos += m[0].length;
        continue;
      }
    }

    m = match(RE.ident, src, pos);
    if (m) {
      const name = m[0];
      pos += name.length;
      const paren = match(RE.callParen, src, pos);
      if (paren) {
        push({ type: 'func', value: name.toUpperCase() }, start, pos);
        continue;
      }
      const upper = name.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') push({ type: 'bool', value: upper === 'TRUE' }, start, pos);
      else push({ type: 'name', value: name }, start, pos);
      continue;
    }

    const two = src.substr(pos, 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      push({ type: 'op', value: two }, start, pos + 2);
      pos += 2;
      continue;
    }
    if ('+-*/^&=<>%'.includes(ch)) {
      push({ type: 'op', value: ch }, start, pos + 1);
      pos += 1;
      continue;
    }
    const punct = { '(': 'lparen', ')': 'rparen', ',': 'comma', ';': 'semi', '{': 'lbrace', '}': 'rbrace', ':': 'colon' }[ch];
    if (punct) {
      push({ type: punct, value: ch }, start, pos + 1);
      pos += 1;
      continue;
    }
    throw new FormulaSyntaxError(`无法识别的字符“${ch}”`, pos);
  }
  tokens.push({ type: 'eof', from: src.length, to: src.length });
  return tokens;
}
