// Pratt parser for formulas, plus the inverse printer.
//
// Precedence follows Excel, including its quirks: unary minus binds tighter than ^
// (-2^2 = 4) and ^ is left-associative (2^3^2 = 64).
//
// AST node shapes:
//   { type: 'number' | 'string' | 'bool' | 'error', value }
//   { type: 'ref', sheet, row, col, rowAbs, colAbs }
//   { type: 'range', kind: 'cells'|'cols'|'rows', sheet, start: {row,col,rowAbs,colAbs}, end }
//   { type: 'name', value }                    unknown identifier -> #NAME?
//   { type: 'unary', op, arg } | { type: 'percent', arg }
//   { type: 'binary', op, left, right }
//   { type: 'call', name, args }
//   { type: 'array', rows: AST[][] }
//   { type: 'paren', expr }                    kept so printing preserves the user's parens

import { tokenize, FormulaSyntaxError } from './lexer.js';
import { colToName, quoteSheetName } from './address.js';

export { FormulaSyntaxError };

const BINARY = {
  '=': 10, '<>': 10, '<': 10, '>': 10, '<=': 10, '>=': 10,
  '&': 20,
  '+': 30, '-': 30,
  '*': 40, '/': 40,
  '^': 50
};
const PREFIX_BP = 60;
const PERCENT_BP = 70;
const RANGE_BP = 80;

export function parseFormula(src) {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (type, message) => {
    const t = next();
    if (t.type !== type) throw new FormulaSyntaxError(message, t.from);
    return t;
  };

  function parseExpr(minBp) {
    let left = parsePrefix();
    for (;;) {
      const t = peek();
      if (t.type === 'op' && t.value === '%') {
        if (PERCENT_BP < minBp) break;
        next();
        left = { type: 'percent', arg: left };
        continue;
      }
      if (t.type === 'colon') {
        if (RANGE_BP < minBp) break;
        next();
        const right = parseExpr(RANGE_BP + 1);
        left = joinRange(left, right, t.from);
        continue;
      }
      if (t.type !== 'op' || !(t.value in BINARY)) break;
      const bp = BINARY[t.value];
      if (bp < minBp) break;
      next();
      const right = parseExpr(bp + 1);
      left = { type: 'binary', op: t.value, left, right };
    }
    return left;
  }

  function parsePrefix() {
    const t = next();
    switch (t.type) {
      case 'number': return { type: 'number', value: t.value };
      case 'string': return { type: 'string', value: t.value };
      case 'bool': return { type: 'bool', value: t.value };
      case 'error': return { type: 'error', value: t.value };
      case 'ref': return { type: 'ref', sheet: t.sheet, row: t.row, col: t.col, rowAbs: t.rowAbs, colAbs: t.colAbs };
      case 'range': return { type: 'range', kind: t.kind, sheet: t.sheet, start: t.start, end: t.end };
      case 'name': return { type: 'name', value: t.value };
      case 'op':
        if (t.value === '-' || t.value === '+') return { type: 'unary', op: t.value, arg: parseExpr(PREFIX_BP) };
        break;
      case 'lparen': {
        const expr = parseExpr(0);
        expect('rparen', '缺少右括号');
        return { type: 'paren', expr };
      }
      case 'func': return parseCall(t.value);
      case 'lbrace': return parseArray();
      case 'eof': throw new FormulaSyntaxError('公式不完整', t.from);
    }
    throw new FormulaSyntaxError(`这里不能出现“${t.value ?? t.type}”`, t.from);
  }

  function parseCall(name) {
    expect('lparen', '函数名后需要左括号');
    const args = [];
    if (peek().type === 'rparen') {
      next();
      return { type: 'call', name, args };
    }
    for (;;) {
      // Empty argument, as in IF(A1,,1).
      if (peek().type === 'comma' || peek().type === 'semi' || peek().type === 'rparen') {
        args.push({ type: 'missing' });
      } else {
        args.push(parseExpr(0));
      }
      const t = next();
      if (t.type === 'rparen') break;
      if (t.type !== 'comma' && t.type !== 'semi') throw new FormulaSyntaxError('参数之间需要逗号，或缺少右括号', t.from);
    }
    return { type: 'call', name, args };
  }

  function parseArray() {
    const rows = [[]];
    for (;;) {
      const t = next();
      let item;
      if (t.type === 'number') item = { type: 'number', value: t.value };
      else if (t.type === 'op' && t.value === '-' && peek().type === 'number') item = { type: 'number', value: -next().value };
      else if (t.type === 'string') item = { type: 'string', value: t.value };
      else if (t.type === 'bool') item = { type: 'bool', value: t.value };
      else if (t.type === 'error') item = { type: 'error', value: t.value };
      else throw new FormulaSyntaxError('数组常量里只能放数字、文字、逻辑值', t.from);
      rows[rows.length - 1].push(item);
      const sep = next();
      if (sep.type === 'rbrace') break;
      if (sep.type === 'semi') rows.push([]);
      else if (sep.type !== 'comma') throw new FormulaSyntaxError('数组常量缺少右花括号', sep.from);
    }
    const width = rows[0].length;
    if (rows.some(r => r.length !== width)) throw new FormulaSyntaxError('数组常量每行的元素个数必须相同', 0);
    return { type: 'array', rows };
  }

  const ast = parseExpr(0);
  const t = peek();
  if (t.type !== 'eof') {
    if (t.type === 'rparen') throw new FormulaSyntaxError('多余的右括号', t.from);
    throw new FormulaSyntaxError(`这里不能出现“${t.value ?? t.type}”`, t.from);
  }
  return ast;
}

// A1:B2 written with an explicit colon between two refs (e.g. Sheet1!A1:Sheet1!B2).
function joinRange(left, right, pos) {
  if (left.type === 'ref' && right.type === 'ref' && (right.sheet === null || right.sheet === left.sheet)) {
    const a = { row: left.row, col: left.col, rowAbs: left.rowAbs, colAbs: left.colAbs };
    const b = { row: right.row, col: right.col, rowAbs: right.rowAbs, colAbs: right.colAbs };
    return { type: 'range', kind: 'cells', sheet: left.sheet, start: a, end: b };
  }
  throw new FormulaSyntaxError('冒号两边必须是单元格引用', pos);
}

// ---------- printing ----------

function printNumber(n) {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  return String(n).toUpperCase();
}

function printCellPart(p, kind) {
  const col = `${p.colAbs ? '$' : ''}${colToName(p.col)}`;
  const row = `${p.rowAbs ? '$' : ''}${p.row + 1}`;
  if (kind === 'cols') return col;
  if (kind === 'rows') return row;
  return col + row;
}

function sheetPrefix(sheet) {
  return sheet === null || sheet === undefined ? '' : `${quoteSheetName(sheet)}!`;
}

export function printFormula(ast) {
  switch (ast.type) {
    case 'number': return printNumber(ast.value);
    case 'string': return `"${ast.value.replace(/"/g, '""')}"`;
    case 'bool': return ast.value ? 'TRUE' : 'FALSE';
    case 'error': return ast.value;
    case 'missing': return '';
    case 'name': return ast.value;
    case 'ref': return sheetPrefix(ast.sheet) + printCellPart(ast, 'cells');
    case 'range': {
      const a = printCellPart(ast.start, ast.kind);
      const b = printCellPart(ast.end, ast.kind);
      return `${sheetPrefix(ast.sheet)}${a}:${b}`;
    }
    case 'unary': return ast.op + printFormula(ast.arg);
    case 'percent': return printFormula(ast.arg) + '%';
    case 'binary': return printFormula(ast.left) + ast.op + printFormula(ast.right);
    case 'paren': return `(${printFormula(ast.expr)})`;
    case 'call': return `${ast.name}(${ast.args.map(printFormula).join(',')})`;
    case 'array': return `{${ast.rows.map(r => r.map(printFormula).join(',')).join(';')}}`;
  }
  throw new Error(`unknown node ${ast.type}`);
}

// Walk every node; used for collecting references and function names.
export function walk(ast, visit) {
  visit(ast);
  switch (ast.type) {
    case 'unary': case 'percent': walk(ast.arg, visit); break;
    case 'binary': walk(ast.left, visit); walk(ast.right, visit); break;
    case 'paren': walk(ast.expr, visit); break;
    case 'call': for (const a of ast.args) walk(a, visit); break;
  }
}

// Structural copy with a node-level transform applied bottom-up.
export function mapAst(ast, fn) {
  let node;
  switch (ast.type) {
    case 'unary': node = { ...ast, arg: mapAst(ast.arg, fn) }; break;
    case 'percent': node = { ...ast, arg: mapAst(ast.arg, fn) }; break;
    case 'binary': node = { ...ast, left: mapAst(ast.left, fn), right: mapAst(ast.right, fn) }; break;
    case 'paren': node = { ...ast, expr: mapAst(ast.expr, fn) }; break;
    case 'call': node = { ...ast, args: ast.args.map(a => mapAst(a, fn)) }; break;
    default: node = ast;
  }
  return fn(node);
}
