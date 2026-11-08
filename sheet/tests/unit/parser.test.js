import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula, printFormula, FormulaSyntaxError } from '../../js/engine/parser.js';
import { tokenize } from '../../js/engine/lexer.js';
import { colToName, nameToCol, parseAddress, parseRangeAddress, quoteSheetName } from '../../js/engine/address.js';
import { calc } from './helpers.js';

test('column names round-trip, including the three-letter limit', () => {
  for (const [n, s] of [[0, 'A'], [25, 'Z'], [26, 'AA'], [51, 'AZ'], [52, 'BA'], [701, 'ZZ'], [702, 'AAA'], [16383, 'XFD']]) {
    assert.equal(colToName(n), s);
    assert.equal(nameToCol(s), n);
  }
  assert.deepEqual(parseAddress('$B$3'), { row: 2, col: 1, rowAbs: true, colAbs: true });
  assert.equal(parseAddress('XFE1'), null);
  assert.equal(parseAddress('A0'), null);
  assert.deepEqual(parseRangeAddress('C3:A1'), { r1: 0, c1: 0, r2: 2, c2: 2 });
  assert.equal(parseRangeAddress('B:B').r2, 1048575);
});

test('sheet names are quoted only when they have to be', () => {
  assert.equal(quoteSheetName('Sheet1'), 'Sheet1');
  assert.equal(quoteSheetName('数据'), '数据');
  assert.equal(quoteSheetName('My Sheet'), "'My Sheet'");
  assert.equal(quoteSheetName("Bob's"), "'Bob''s'");
  assert.equal(quoteSheetName('A1'), "'A1'"); // would read as a cell
  assert.equal(quoteSheetName('2024'), "'2024'");
});

test('tokens carry source offsets for editor colouring', () => {
  const toks = tokenize('SUM(A1:B2, Sheet2!C3)');
  const refs = toks.filter(t => t.type === 'ref' || t.type === 'range');
  assert.deepEqual(refs.map(t => [t.from, t.to]), [[4, 9], [11, 20]]);
  assert.equal(refs[1].sheet, 'Sheet2');
});

test('LOG10( is a function call, not cell LOG10', () => {
  const ast = parseFormula('LOG10(100)');
  assert.equal(ast.type, 'call');
  assert.equal(ast.name, 'LOG10');
  assert.equal(parseFormula('LOG10').type, 'ref'); // without parens it is the cell
});

test('operator precedence follows Excel', () => {
  const cases = {
    '1+2*3': 7,
    '(1+2)*3': 9,
    '-2^2': 4, // negation binds tighter than ^
    '2^3^2': 64, // ^ is left-associative
    '2*3%': 0.06,
    '1+2&3': '33',
    '1+1=2': true,
    '"a"&1+1': 'a2',
    '10-2-3': 5,
    '2^-1': 0.5,
    '--"3"': 3
  };
  for (const [f, expected] of Object.entries(cases)) assert.equal(calc(f), expected, f);
});

test('printing is the inverse of parsing', () => {
  const formulas = [
    'SUM(A1:B2)*2',
    '$A$1+B$2+$C3',
    "'My Sheet'!A1:B2",
    'Sheet2!$A:$C',
    'SUM(3:5)',
    'IF(A1>0,"yes","no")',
    'IF(A1,,1)',
    '{1,2;3,4}',
    '"say ""hi"""',
    '-(1+2)%',
    'TRUE<>FALSE',
    '1.5E+30',
    '#N/A',
    'A1:A10'
  ];
  for (const f of formulas) {
    const once = printFormula(parseFormula(f));
    assert.equal(printFormula(parseFormula(once)), once, f);
  }
  assert.equal(printFormula(parseFormula('sum(a1:b2)')), 'SUM(A1:B2)');
  assert.equal(printFormula(parseFormula(' 1 +  2 ')), '1+2');
});

test('syntax errors explain what is wrong and where', () => {
  const bad = { 'SUM(1,2': '缺少右括号', '1+': '公式不完整', '1+2)': '多余的右括号', '"abc': '引号', 'A1 B1': '不能出现' };
  for (const [f, msg] of Object.entries(bad)) {
    assert.throws(() => parseFormula(f), e => e instanceof FormulaSyntaxError && e.message.includes(msg), f);
  }
  try { parseFormula('1+@'); } catch (e) { assert.equal(e.pos, 2); }
});

test('a colon between two sheet-qualified refs builds a range', () => {
  const ast = parseFormula('Sheet1!A1:Sheet1!B2');
  assert.equal(ast.type, 'range');
  assert.equal(ast.sheet, 'Sheet1');
});
