// Tree-walking evaluator.
//
// References evaluate to RangeMatrix views (a single cell is a 1x1 range), so
// functions can tell "a cell holding text" from "a text literal" exactly like Excel.
// Operators and scalar parameters dereference them with implicit intersection.
//
// Array mode: arguments of SUMPRODUCT (and friends) are evaluated element-wise,
// so =SUMPRODUCT((A1:A9>5)*B1:B9) works the way it does in Excel.

import { ERR, FormulaError, ArrayValue, isError, isMatrix, errorFromCode, toNumber, toText, compareValues, MISSING } from './values.js';
import { RangeMatrix, toScalar } from './range.js';
import { FUNCTIONS } from './functions.js';

export { RangeMatrix, toScalar };

// Broadcast two matrices element-wise (Excel rules: a 1-wide dimension stretches).
function broadcast(a, b, fn) {
  const A = isMatrix(a) ? a : null;
  const B = isMatrix(b) ? b : null;
  const rows = Math.max(A ? A.rows : 1, B ? B.rows : 1);
  const cols = Math.max(A ? A.cols : 1, B ? B.cols : 1);
  const pick = (M, s, i, j) => {
    if (!M) return s;
    const ii = M.rows === 1 ? 0 : i;
    const jj = M.cols === 1 ? 0 : j;
    if (ii >= M.rows || jj >= M.cols) return ERR.NA;
    return M.get(ii, jj);
  };
  const data = [];
  for (let i = 0; i < rows; i++) {
    const row = [];
    for (let j = 0; j < cols; j++) row.push(fn(pick(A, a, i, j), pick(B, b, i, j)));
    data.push(row);
  }
  return new ArrayValue(data);
}

function mapMatrix(m, fn) {
  const data = [];
  for (let i = 0; i < m.rows; i++) {
    const row = [];
    for (let j = 0; j < m.cols; j++) row.push(fn(m.get(i, j)));
    data.push(row);
  }
  return new ArrayValue(data);
}

const finite = n => (Number.isFinite(n) ? n : ERR.NUM);

function binaryScalar(op, a, b) {
  if (isError(a)) return a;
  if (isError(b)) return b;
  try {
    switch (op) {
      case '+': return finite(toNumber(a) + toNumber(b));
      case '-': return finite(toNumber(a) - toNumber(b));
      case '*': return finite(toNumber(a) * toNumber(b));
      case '/': {
        const x = toNumber(a), y = toNumber(b);
        return y === 0 ? ERR.DIV0 : finite(x / y);
      }
      case '^': {
        const x = toNumber(a), y = toNumber(b);
        if (x === 0 && y === 0) return ERR.NUM;
        if (x === 0 && y < 0) return ERR.DIV0;
        return finite(x ** y);
      }
      case '&': return toText(a) + toText(b);
      case '=': return compareValues(a, b) === 0;
      case '<>': return compareValues(a, b) !== 0;
      case '<': return compareValues(a, b) < 0;
      case '>': return compareValues(a, b) > 0;
      case '<=': return compareValues(a, b) <= 0;
      case '>=': return compareValues(a, b) >= 0;
    }
  } catch (e) {
    if (e instanceof FormulaError) return e;
    throw e;
  }
  throw new Error(`unknown operator ${op}`);
}

function unaryScalar(op, v) {
  if (isError(v)) return v;
  try {
    const n = toNumber(v);
    if (op === '-') return -n;
    if (op === '%') return n / 100;
    return n;
  } catch (e) {
    if (e instanceof FormulaError) return e;
    throw e;
  }
}

// ctx: { source, sheetId, row, col, resolveSheet(name) -> id|null, now(), random() }
export function evaluate(node, ctx, arrayMode = false) {
  switch (node.type) {
    case 'number': return node.value;
    case 'string': return node.value;
    case 'bool': return node.value;
    case 'error': return errorFromCode(node.value);
    case 'missing': return MISSING;
    case 'name': return ERR.NAME;
    case 'paren': return evaluate(node.expr, ctx, arrayMode);
    case 'array': return new ArrayValue(node.rows.map(r => r.map(x => (x.type === 'error' ? errorFromCode(x.value) : x.value))));
    case 'ref': {
      const sheetId = node.sheet === null ? ctx.sheetId : ctx.resolveSheet(node.sheet);
      if (sheetId === null) return ERR.REF;
      return new RangeMatrix(ctx.source, sheetId, node.row, node.col, node.row, node.col);
    }
    case 'range': {
      const sheetId = node.sheet === null ? ctx.sheetId : ctx.resolveSheet(node.sheet);
      if (sheetId === null) return ERR.REF;
      const r1 = Math.min(node.start.row, node.end.row), r2 = Math.max(node.start.row, node.end.row);
      const c1 = Math.min(node.start.col, node.end.col), c2 = Math.max(node.start.col, node.end.col);
      return new RangeMatrix(ctx.source, sheetId, r1, c1, r2, c2, node.kind !== 'cells');
    }
    case 'unary': {
      const v = evaluate(node.arg, ctx, arrayMode);
      if (arrayMode && isMatrix(v)) return mapMatrix(v, x => unaryScalar(node.op, x));
      return unaryScalar(node.op, toScalar(v, ctx));
    }
    case 'percent': {
      const v = evaluate(node.arg, ctx, arrayMode);
      if (arrayMode && isMatrix(v)) return mapMatrix(v, x => unaryScalar('%', x));
      return unaryScalar('%', toScalar(v, ctx));
    }
    case 'binary': {
      const a = evaluate(node.left, ctx, arrayMode);
      const b = evaluate(node.right, ctx, arrayMode);
      if (arrayMode && (isMatrix(a) || isMatrix(b))) return broadcast(a, b, (x, y) => binaryScalar(node.op, x, y));
      return binaryScalar(node.op, toScalar(a, ctx), toScalar(b, ctx));
    }
    case 'call': return callFunction(node, ctx, arrayMode);
  }
  throw new Error(`cannot evaluate ${node.type}`);
}

// Parameter type codes (see functions.js): n number, s text, b logical, v any value
// (errors propagate), e any value including errors, r raw (ranges allowed), R reference.
function coerceArg(type, v, ctx) {
  if (v === undefined) return undefined; // omitted optional argument
  if (type === 'r') return v === MISSING ? null : v;
  if (type === 'R') {
    if (v instanceof RangeMatrix) return v;
    if (isError(v)) throw v;
    throw ERR.VALUE;
  }
  const s = v === MISSING ? null : toScalar(v, ctx);
  if (type === 'e') return s;
  if (isError(s)) throw s;
  if (type === 'n') return toNumber(s);
  if (type === 's') return toText(s);
  if (type === 'b') return toBoolArg(s);
  return s; // 'v'
}

function toBoolArg(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null) return false;
  if (typeof v === 'string') {
    const u = v.toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
  }
  throw ERR.VALUE;
}

function paramType(spec, index) {
  const { params } = spec;
  if (index < params.length) return params[index];
  return params[params.length - 1]; // repeating tail
}

function callFunction(node, ctx, arrayMode) {
  const spec = FUNCTIONS[node.name];
  if (!spec) return ERR.NAME;
  const argc = node.args.length;
  if (argc < spec.min || argc > spec.max) return ERR.VALUE;
  if (spec.volatile) ctx.touchedVolatile = true;

  const inner = spec.arrayArgs || arrayMode;
  try {
    if (spec.lazy) {
      const ev = (n, mode = inner) => evaluate(n, ctx, mode);
      return spec.fn(node.args, ev, ctx, arrayMode);
    }
    const raw = node.args.map(a => evaluate(a, ctx, inner));

    // Lift scalar parameters over arrays when evaluating element-wise.
    if (arrayMode && !spec.arrayArgs) {
      let shape = null;
      raw.forEach((v, i) => {
        const t = paramType(spec, i);
        if (t !== 'r' && t !== 'R' && isMatrix(v) && (v.rows > 1 || v.cols > 1)) shape = shape || v;
      });
      if (shape) return liftCall(spec, raw, ctx);
    }
    const args = raw.map((v, i) => coerceArg(paramType(spec, i), v, ctx));
    const out = spec.fn(args, ctx);
    return typeof out === 'number' && !Number.isFinite(out) ? ERR.NUM : out;
  } catch (e) {
    if (e instanceof FormulaError) return e;
    throw e;
  }
}

function liftCall(spec, raw, ctx) {
  let rows = 1, cols = 1;
  raw.forEach((v, i) => {
    const t = paramType(spec, i);
    if (t !== 'r' && t !== 'R' && isMatrix(v)) {
      rows = Math.max(rows, v.rows);
      cols = Math.max(cols, v.cols);
    }
  });
  const data = [];
  for (let i = 0; i < rows; i++) {
    const row = [];
    for (let j = 0; j < cols; j++) {
      try {
        const args = raw.map((v, k) => {
          const t = paramType(spec, k);
          if (t === 'r' || t === 'R' || !isMatrix(v)) return coerceArg(t, v, ctx);
          const ii = v.rows === 1 ? 0 : i, jj = v.cols === 1 ? 0 : j;
          const x = ii < v.rows && jj < v.cols ? v.get(ii, jj) : ERR.NA;
          return coerceArg(t, x, null);
        });
        const out = spec.fn(args, ctx);
        row.push(typeof out === 'number' && !Number.isFinite(out) ? ERR.NUM : out);
      } catch (e) {
        if (e instanceof FormulaError) row.push(e);
        else throw e;
      }
    }
    data.push(row);
  }
  return new ArrayValue(data);
}

// Evaluate a whole formula for a cell: the final value is always a scalar.
export function evaluateFormula(ast, ctx) {
  const v = evaluate(ast, ctx, false);
  const s = toScalar(v, ctx);
  if (s === null || s === MISSING) return 0;
  if (typeof s === 'number' && !Number.isFinite(s)) return ERR.NUM;
  return s;
}
