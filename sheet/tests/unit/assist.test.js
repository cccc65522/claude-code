import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formulaContext, suggestFunctions, syntaxParts, activeParam, toggleAbsolute,
  refSpans, colorRefs, refText, findEdge, autoSumRange
} from '../../js/ui/assist.js';

test('formula context: current call, argument index and autocomplete prefix', () => {
  let ctx = formulaContext('=SUM(A1,', 8);
  assert.deepEqual(ctx.call, { name: 'SUM', argIndex: 1 });
  assert.equal(ctx.canInsertRef, true);
  ctx = formulaContext('=IF(A1>0,ROUND(B1,', 18);
  assert.deepEqual(ctx.call, { name: 'ROUND', argIndex: 1 });
  ctx = formulaContext('=IF(A1>0,ROUND(B1,2),', 21);
  assert.deepEqual(ctx.call, { name: 'IF', argIndex: 2 });
  ctx = formulaContext('=1+vlo', 6);
  assert.deepEqual(ctx.prefix, { from: 3, to: 6, text: 'vlo' });
  assert.equal(ctx.canInsertRef, false);
  ctx = formulaContext('=IF(A1="a,b', 11);
  assert.deepEqual(ctx.call, { name: 'IF', argIndex: 0 }, 'commas inside strings are not separators');
  assert.equal(ctx.prefix, null);
  assert.equal(formulaContext('hello', 3).call, null);
  assert.equal(formulaContext("='My, Sheet'!A1+", 16).canInsertRef, true);
});

test('function suggestions put prefix matches first', () => {
  const names = suggestFunctions('sum').map(f => f.name);
  assert.deepEqual(names.slice(0, 5), ['SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'SUMSQ']);
  assert.ok(suggestFunctions('LOOKUP').some(f => f.name === 'VLOOKUP'));
  assert.equal(suggestFunctions('su')[0].name, 'SUM', 'common functions outrank alphabetical order');
  assert.equal(suggestFunctions('if')[0].name, 'IF');
  assert.deepEqual(suggestFunctions(''), []);
});

test('syntax hint highlights the right parameter, including repeating tails', () => {
  const { name, params } = syntaxParts('SUM(数值1, [数值2], …)');
  assert.equal(name, 'SUM');
  assert.deepEqual(params, ['数值1', '[数值2]', '…']);
  assert.equal(activeParam(params, 0), 0);
  assert.equal(activeParam(params, 1), 1);
  assert.equal(activeParam(params, 5), 1);
  assert.equal(activeParam(syntaxParts('PI()').params, 0), -1);
});

test('F4 cycles reference anchoring', () => {
  let r = toggleAbsolute('=A1+B2', 3);
  assert.equal(r.text, '=$A$1+B2');
  r = toggleAbsolute(r.text, r.caret);
  assert.equal(r.text, '=A$1+B2');
  r = toggleAbsolute(r.text, r.caret);
  assert.equal(r.text, '=$A1+B2');
  r = toggleAbsolute(r.text, r.caret);
  assert.equal(r.text, '=A1+B2');
  assert.equal(toggleAbsolute('=SUM(A1:B5)', 10).text, '=SUM(A1:$B$5)');
  assert.equal(toggleAbsolute('=SUM(A1:B5)', 6).text, '=SUM($A$1:B5)');
  assert.equal(toggleAbsolute('=Sheet2!C3', 10).text, '=Sheet2!$C$3');
  assert.equal(toggleAbsolute('=1+2', 2).text, '=1+2');
  assert.equal(toggleAbsolute('=A1*2', 5).text, '=$A$1*2', 'caret past the ref: the nearest one to the left');
});

test('reference spans survive unfinished formulas and share colours', () => {
  const spans = refSpans('=SUM(A1:B2)+Sheet2!C3+"x');
  assert.deepEqual(spans.map(s => [s.from, s.to]), [[5, 10], [12, 21]]);
  assert.deepEqual(spans[1].range, { r1: 2, c1: 2, r2: 2, c2: 2 });
  const colored = colorRefs('=A1+B1+$A$1');
  assert.equal(colored[0].color, colored[2].color);
  assert.notEqual(colored[0].color, colored[1].color);
  assert.deepEqual(refSpans('plain'), []);
});

test('pointing inserts addresses, qualified on other sheets', () => {
  assert.equal(refText({ r1: 0, c1: 0, r2: 0, c2: 0 }), 'A1');
  assert.equal(refText({ r1: 1, c1: 1, r2: 4, c2: 2 }, '数据 表'), "'数据 表'!B2:C5");
});

test('Ctrl+Arrow edges', () => {
  const data = new Set(['0,0', '1,0', '2,0', '6,0']);
  const has = (r, c) => data.has(`${r},${c}`);
  assert.deepEqual(findEdge(has, 0, 0, 1, 0, 99, 25), { r: 2, c: 0 }, 'to end of block');
  assert.deepEqual(findEdge(has, 2, 0, 1, 0, 99, 25), { r: 6, c: 0 }, 'jump to next data');
  assert.deepEqual(findEdge(has, 6, 0, 1, 0, 99, 25), { r: 99, c: 0 }, 'past the last data to the edge');
  assert.deepEqual(findEdge(has, 0, 0, -1, 0, 99, 25), { r: 0, c: 0 });
});

test('AutoSum finds the numbers above, else to the left', () => {
  const nums = new Set(['1,0', '2,0', '3,0', '5,1', '5,2']);
  const isNum = (r, c) => nums.has(`${r},${c}`);
  assert.deepEqual(autoSumRange(isNum, 4, 0), { r1: 1, c1: 0, r2: 3, c2: 0 });
  assert.deepEqual(autoSumRange(isNum, 5, 3), { r1: 5, c1: 1, r2: 5, c2: 2 });
  assert.equal(autoSumRange(isNum, 9, 9), null);
});
