import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workbook } from '../../js/engine/workbook.js';
import { History } from '../../js/engine/history.js';
import { book, val, input, text, set, rng, sid } from './helpers.js';

test('changing a cell re-evaluates only its dependents', () => {
  const wb = book({ A1: '1', A2: '=A1*2', A3: '=A2+1', B1: '100', B2: '=B1/4', C1: '=SUM(A1:A3)' });
  assert.equal(val(wb, 'A3'), 3);
  assert.equal(val(wb, 'C1'), 6);
  const before = wb.stats.evaluated;
  set(wb, 'A1', '10');
  assert.equal(wb.stats.evaluated - before, 3, 'A2, A3 and C1 only; B2 untouched');
  assert.equal(val(wb, 'A3'), 21);
  assert.equal(val(wb, 'C1'), 10 + 20 + 21);
});

test('evaluation order respects dependencies regardless of entry order', () => {
  const wb = book({ D1: '=C1+1', C1: '=B1+1', B1: '=A1+1', A1: '5' });
  assert.equal(val(wb, 'D1'), 8);
  set(wb, 'A1', '0');
  assert.equal(val(wb, 'D1'), 3);
});

test('diamond dependencies evaluate each cell once', () => {
  const wb = book({ A1: '1', B1: '=A1+1', B2: '=A1+2', C1: '=B1+B2' });
  const before = wb.stats.evaluated;
  set(wb, 'A1', '2');
  assert.equal(wb.stats.evaluated - before, 3);
  assert.equal(val(wb, 'C1'), 7);
});

test('circular references become #CIRC! and recover when broken', () => {
  const wb = book({ A1: '=B1+1', B1: '=A1+1', C1: '=A1*2', D1: '=IFERROR(C1,"循环")', E1: '=E1', F1: '=SUM(F2:F5,F1)' });
  for (const a of ['A1', 'B1', 'C1', 'E1', 'F1']) assert.equal(val(wb, a), '#CIRC!', a);
  assert.equal(val(wb, 'D1'), '循环', 'cells downstream of a cycle still evaluate');
  set(wb, 'B1', '10');
  assert.equal(val(wb, 'A1'), 11);
  assert.equal(val(wb, 'C1'), 22);
  assert.equal(val(wb, 'D1'), 22);
});

test('a long cycle is found without recursion', () => {
  const cells = { A1: '=A5000+1' };
  for (let i = 2; i <= 5000; i++) cells[`A${i}`] = `=A${i - 1}+1`;
  const wb = book(cells);
  assert.equal(val(wb, 'A2500'), '#CIRC!');
  set(wb, 'A1', '0');
  assert.equal(val(wb, 'A5000'), 4999);
});

test('dynamic references (INDIRECT, OFFSET) read up-to-date values', () => {
  const wb = book({ A1: '1', A2: '=A1*10', B1: '=INDIRECT("A2")+1', B2: '=SUM(OFFSET(A1,0,0,2,1))' });
  assert.equal(val(wb, 'B1'), 11);
  assert.equal(val(wb, 'B2'), 11);
  set(wb, 'A1', '3');
  assert.equal(val(wb, 'B1'), 31);
  assert.equal(val(wb, 'B2'), 33);
});

test('whole-column ranges track cells added later', () => {
  const wb = book({ B1: '=SUM(A:A)', B2: '=COUNT(A:A)' });
  assert.equal(val(wb, 'B1'), 0);
  set(wb, 'A5000', '7');
  set(wb, 'A3', '3');
  assert.equal(val(wb, 'B1'), 10);
  assert.equal(val(wb, 'B2'), 2);
});

test('typed input becomes numbers, dates, percents with a matching format', () => {
  const wb = book({ A1: '12%', A2: '2026-11-08', A3: '¥1,200.5', A4: "'0012", A5: '1,234', A6: 'true', A7: '14:30', A8: '#N/A', A9: '=A2+1', A10: '=A1*2' });
  assert.equal(val(wb, 'A1'), 0.12);
  assert.equal(text(wb, 'A1'), '12%');
  assert.equal(val(wb, 'A2'), 46334);
  assert.equal(text(wb, 'A2'), '2026-11-08');
  assert.equal(val(wb, 'A3'), 1200.5);
  assert.equal(text(wb, 'A3'), '¥1,200.50');
  assert.equal(val(wb, 'A4'), '0012');
  assert.equal(val(wb, 'A5'), 1234);
  assert.equal(text(wb, 'A5'), '1,234');
  assert.equal(val(wb, 'A6'), true);
  assert.equal(text(wb, 'A7'), '14:30');
  assert.equal(val(wb, 'A8'), '#N/A');
  assert.equal(text(wb, 'A9'), '2026-11-09', 'formula result inherits the date format');
  assert.equal(text(wb, 'A10'), '24%');
});

test('formulas are normalised and bad ones are kept with #ERROR!', () => {
  const wb = book({ A1: '=sum( a2:a3 )', A2: '=1+', A3: '2' });
  assert.equal(input(wb, 'A1'), '=SUM(A2:A3)');
  assert.equal(input(wb, 'A2'), '=1+');
  assert.equal(val(wb, 'A2'), '#ERROR!');
  assert.match(wb.getDisplay(wb.sheets[0].id, 1, 0).error, /不完整/);
  assert.equal(val(wb, 'A1'), '#ERROR!');
});

test('copy & paste shifts relative references and keeps absolute ones', () => {
  const wb = book({ A1: '1', A2: '2', B1: '=A1+$A$1+A$1+$A1' });
  const s = sid(wb);
  const clip = wb.copyRange(s, rng('B1'));
  wb.pasteRange(clip, s, rng('C2'));
  assert.equal(input(wb, 'C2'), '=B2+$A$1+B$1+$A2');
  wb.pasteRange(clip, s, rng('B2'));
  assert.equal(input(wb, 'B2'), '=A2+$A$1+A$1+$A2');
  assert.equal(val(wb, 'B2'), 2 + 1 + 1 + 2);
});

test('pasting off the top of the grid gives #REF!', () => {
  const wb = book({ A5: '=A1' });
  const s = sid(wb);
  wb.pasteRange(wb.copyRange(s, rng('A5')), s, rng('A2'));
  assert.equal(input(wb, 'A2'), '=#REF!');
});

test('paste tiles a block over a larger multiple-sized target', () => {
  const wb = book({ A1: 'x', B1: '=ROW()' });
  const s = sid(wb);
  const out = wb.pasteRange(wb.copyRange(s, rng('A1:B1')), s, rng('A2:B5'));
  assert.deepEqual(out, rng('A2:B5'));
  assert.equal(val(wb, 'A4'), 'x');
  assert.equal(val(wb, 'B5'), 5);
});

test('paste values and paste formats', () => {
  const wb = book({ A1: '3', A2: '=A1*2', C2: 'keep' });
  const s = sid(wb);
  wb.setStyle(s, rng('A2'), { bold: true });
  const clip = wb.copyRange(s, rng('A2'));
  wb.pasteRange(clip, s, rng('B2'), { what: 'values' });
  assert.equal(input(wb, 'B2'), '6');
  wb.pasteRange(clip, s, rng('C2'), { what: 'formats' });
  assert.equal(input(wb, 'C2'), 'keep');
  assert.equal(wb.getCell(s, 1, 2).style.bold, true);
});

test('inserting rows moves cells and every reference to them', () => {
  const wb = book({ A1: '1', A2: '2', A3: '3', A4: '=SUM(A1:A3)', B1: '=A3*2', C1: '=$A$2' });
  const s = sid(wb);
  wb.insertRows(s, 1, 2); // two rows above row 2
  assert.equal(input(wb, 'A6'), '=SUM(A1:A5)', 'range grows');
  assert.equal(val(wb, 'A6'), 6);
  assert.equal(input(wb, 'B1'), '=A5*2');
  assert.equal(input(wb, 'C1'), '=$A$4', 'absolute refs move too');
  wb.setRowHeight(s, 6, 50);
  wb.insertRows(s, 0, 1); // above everything
  assert.equal(input(wb, 'A7'), '=SUM(A2:A6)');
  assert.equal(wb.sheets[0].rowHeight(7), 50, 'row heights move with their rows');
});

test('deleting rows shrinks ranges and turns deleted refs into #REF!', () => {
  const wb = book({ A1: '1', A2: '2', A3: '3', A4: '4', B1: '=SUM(A1:A4)', B2: '=A2', B3: '=A4' });
  const s = sid(wb);
  wb.deleteRows(s, 1, 2); // rows 2-3
  assert.equal(input(wb, 'B1'), '=SUM(A1:A2)');
  assert.equal(val(wb, 'B1'), 5);
  assert.equal(input(wb, 'A2'), '4');
  // B2 and B3 were deleted along with their rows; B1 survives
  assert.equal(input(wb, 'B2'), '');
  const wb2 = book({ A1: '1', A2: '2', C1: '=A2+A1' });
  wb2.deleteRows(sid(wb2), 1, 1);
  assert.equal(input(wb2, 'C1'), '=#REF!+A1');
  assert.equal(val(wb2, 'C1'), '#REF!');
});

test('deleting a whole range makes it #REF!', () => {
  const wb = book({ A2: '1', A3: '2', A10: '=SUM(A2:A3)' });
  wb.deleteRows(sid(wb), 1, 2);
  assert.equal(input(wb, 'A8'), '=SUM(#REF!)');
});

test('inserting and deleting columns, with column widths following', () => {
  const wb = book({ A1: '1', B1: '2', C1: '=A1+B1', D1: '=SUM(A1:C1)' });
  const s = sid(wb);
  wb.setColWidth(s, 1, 150);
  wb.insertCols(s, 1, 1);
  assert.equal(input(wb, 'D1'), '=A1+C1');
  assert.equal(input(wb, 'E1'), '=SUM(A1:D1)');
  assert.equal(wb.sheets[0].colWidth(2), 150);
  wb.deleteCols(s, 0, 1);
  assert.equal(input(wb, 'C1'), '=#REF!+B1');
  assert.equal(input(wb, 'D1'), '=SUM(A1:C1)');
});

test('structural edits update references from other sheets only when they point here', () => {
  const wb = book({ A1: '5', A2: '6' });
  const s1 = sid(wb);
  const s2 = wb.addSheet('汇总').id;
  wb.setCell(s2, 0, 0, '=Sheet1!A2*2');
  wb.setCell(s2, 1, 0, '=A2');
  wb.insertRows(s1, 0, 3);
  assert.equal(input(wb, '汇总!A1'), '=Sheet1!A5*2');
  assert.equal(input(wb, '汇总!A2'), '=A2', 'unqualified refs on another sheet are not touched');
  assert.equal(val(wb, '汇总!A1'), 12);
});

test('cut & paste moves cells and retargets formulas that pointed at them', () => {
  const wb = book({ A1: '10', A2: '=A1*2', B1: '=A1+A2', C1: '=SUM(A1:A2)', D1: '99', E1: '=D1' });
  const s = sid(wb);
  wb.moveRange(s, rng('A1:A2'), s, 3, 3); // to D4:D5
  assert.equal(input(wb, 'A1'), '');
  assert.equal(input(wb, 'D5'), '=D4*2', 'moved formula follows its moved input');
  assert.equal(input(wb, 'B1'), '=D4+D5');
  assert.equal(input(wb, 'C1'), '=SUM(D4:D5)');
  assert.equal(val(wb, 'C1'), 30);
  // Pasting over cells someone referenced invalidates those references, like Excel.
  wb.moveRange(s, rng('D4'), s, 0, 3); // onto D1, which E1 reads
  assert.equal(input(wb, 'E1'), '=#REF!');
  assert.equal(input(wb, 'B1'), '=D1+D5');
});

test('cut & paste to another sheet keeps formulas reading the original cells', () => {
  const wb = book({ A1: '3', B1: '=A1*2', C1: '=B1+1' });
  const s1 = sid(wb);
  const s2 = wb.addSheet('Sheet2').id;
  wb.moveRange(s1, rng('B1'), s2, 0, 0);
  assert.equal(input(wb, 'Sheet2!A1'), '=Sheet1!A1*2');
  assert.equal(input(wb, 'C1'), '=Sheet2!A1+1');
  assert.equal(val(wb, 'C1'), 7);
  wb.moveRange(s2, rng('A1'), s1, 4, 1); // back to B5 on Sheet1
  assert.equal(input(wb, 'B5'), '=A1*2');
  assert.equal(input(wb, 'C1'), '=B5+1');
});

test('fill handle series and copies', () => {
  const wb = book({ A1: '1', A2: '3', B1: '周一', C1: '第1组', D1: '=A1*10', E1: '2026-11-08', F1: '5', G1: '一月', G2: '三月' });
  const s = sid(wb);
  wb.fillRange(s, rng('A1:A2'), rng('A1:A5'));
  assert.deepEqual(['A3', 'A4', 'A5'].map(a => val(wb, a)), [5, 7, 9]);
  wb.fillRange(s, rng('B1'), rng('B1:B8'));
  assert.equal(val(wb, 'B7'), '周日');
  assert.equal(val(wb, 'B8'), '周一');
  wb.fillRange(s, rng('C1'), rng('C1:C3'));
  assert.equal(val(wb, 'C3'), '第3组');
  wb.fillRange(s, rng('D1'), rng('D1:D3'));
  assert.equal(input(wb, 'D3'), '=A3*10');
  wb.fillRange(s, rng('E1'), rng('E1:E3'));
  assert.equal(text(wb, 'E3'), '2026-11-10');
  wb.fillRange(s, rng('F1'), rng('F1:H1'));
  assert.deepEqual([val(wb, 'G1'), val(wb, 'H1')], [5, 5], 'a single number is copied');
  const wb2 = book({ A3: '10', A4: '20' });
  wb2.fillRange(sid(wb2), rng('A3:A4'), rng('A1:A4'));
  assert.deepEqual([val(wb2, 'A1'), val(wb2, 'A2')], [-10, 0], 'filling up continues the series backwards');
});

test('sort reorders rows, keeps a header, puts blanks last and adjusts formulas', () => {
  const wb = book({
    A1: '名字', B1: '分数', C1: '翻倍',
    A2: '乙', B2: '80', C2: '=B2*2',
    A3: '甲', B3: '95', C3: '=B3*2',
    A4: '丙', B4: '', C4: '=B4*2',
    A5: '丁', B5: '60', C5: '=B5*2'
  });
  wb.sortRange(sid(wb), rng('A1:C5'), [{ col: 1, asc: false }], { header: true });
  assert.deepEqual(['A2', 'A3', 'A4', 'A5'].map(a => val(wb, a)), ['甲', '乙', '丁', '丙']);
  assert.equal(input(wb, 'C2'), '=B2*2');
  assert.equal(val(wb, 'C2'), 190);
  assert.equal(val(wb, 'A1'), '名字');
});

test('renaming a sheet rewrites formulas; deleting one leaves #REF!', () => {
  const wb = book({ A1: '1' });
  const s2 = wb.addSheet('数据').id;
  wb.setCell(s2, 0, 0, '42');
  set(wb, 'B1', '=数据!A1+1');
  set(wb, 'B2', "='新 名字'!A1");
  assert.equal(val(wb, 'B2'), '#REF!');
  wb.renameSheet(s2, '新 名字');
  assert.equal(input(wb, 'B1'), "='新 名字'!A1+1");
  assert.equal(val(wb, 'B1'), 43);
  assert.equal(val(wb, 'B2'), 42, 'a formula naming a missing sheet starts working once it exists');
  assert.throws(() => wb.renameSheet(s2, 'sheet1'), /同名/);
  assert.throws(() => wb.renameSheet(s2, 'a/b'), /不能包含/);
  wb.removeSheet(s2);
  assert.equal(input(wb, 'B1'), '=#REF!+1');
  assert.throws(() => wb.removeSheet(wb.sheets[0].id), /至少/);
});

test('undo and redo cell edits, formats and widths', () => {
  const wb = book({ A1: '1', A2: '=A1+1' });
  const s = sid(wb);
  const h = new History(wb);
  h.run('输入', () => set(wb, 'A1', '5'));
  h.run('加粗', () => wb.setStyle(s, rng('A1:A2'), { bold: true }));
  h.run('列宽', () => { wb.setColWidth(s, 0, 200); wb.setRowHeight(s, 3, 40); });
  assert.equal(val(wb, 'A2'), 6);
  h.undo();
  assert.equal(wb.sheets[0].colWidth(0), 96);
  assert.equal(wb.sheets[0].rowHeight(3), 24);
  h.undo();
  assert.equal(wb.getCell(s, 0, 0).style, null);
  h.undo();
  assert.equal(val(wb, 'A2'), 2);
  assert.equal(h.canUndo, false);
  h.redo();
  h.redo();
  assert.equal(val(wb, 'A2'), 6);
  assert.equal(wb.getCell(s, 1, 0).style.bold, true);
  h.run('清除', () => wb.clearRange(s, rng('A1:A2')));
  assert.equal(h.canRedo, false, 'a new change drops the redo stack');
  h.undo();
  assert.equal(input(wb, 'A2'), '=A1+1');
});

test('undo of structural edits restores formulas exactly', () => {
  const wb = book({ A1: '1', A2: '2', B1: '=A2*3' });
  const s = sid(wb);
  const h = new History(wb);
  h.run('删除行', () => wb.deleteRows(s, 1, 1), { snapshot: true });
  assert.equal(input(wb, 'B1'), '=#REF!*3');
  h.undo();
  assert.equal(input(wb, 'B1'), '=A2*3');
  assert.equal(val(wb, 'B1'), 6);
  assert.equal(wb.sheets[0].id, s, 'sheet ids survive snapshots');
  h.redo();
  assert.equal(input(wb, 'B1'), '=#REF!*3');
});

test('no-op edits do not create undo entries', () => {
  const wb = book({ A1: 'x' });
  const h = new History(wb);
  h.run('输入', () => set(wb, 'A1', 'x'));
  assert.equal(h.canUndo, false);
});

test('serialisation round-trips inputs, styles, widths and sheet order', () => {
  const wb = book({ A1: '12%', B1: '=A1*2', C1: "'007" });
  const s = sid(wb);
  wb.setStyle(s, rng('A1:B1'), { bold: true, fill: '#fff3c4' });
  wb.setColWidth(s, 2, 180);
  wb.setRowHeight(s, 4, 60);
  const s2 = wb.addSheet('第二页').id;
  wb.setCell(s2, 0, 0, '=Sheet1!B1');
  wb.moveSheet(s2, 0);
  const data = JSON.parse(JSON.stringify(wb.toJSON()));
  assert.equal(data.styles.length, 2, 'identical styles are shared');
  const copy = Workbook.fromJSON(data);
  assert.deepEqual(copy.sheets.map(x => x.name), ['第二页', 'Sheet1']);
  assert.equal(val(copy, '第二页!A1'), 0.24);
  assert.equal(text(copy, 'Sheet1!A1'), '12%');
  assert.equal(val(copy, 'Sheet1!C1'), '007');
  assert.equal(copy.sheetById(s).colWidth(2), 180);
  assert.equal(copy.sheetById(s).rowHeight(4), 60);
  assert.deepEqual(copy.toJSON(), data);
});

test('loading rejects garbage and repairs bad sheet names', () => {
  assert.throws(() => Workbook.fromJSON({}), /没有工作表/);
  const wb = Workbook.fromJSON({ sheets: [{ name: 'a/b', cells: [[0, 0, '1'], [-1, 0, 'bad'], ['x', 0, 'bad']] }, { name: 'A/B' }] });
  assert.equal(wb.sheets.length, 2);
  assert.ok(wb.sheets.every(s => !wb.validateSheetName(s.name, s.id)));
  assert.equal(wb.sheets[0].cells.size, 1);
});

test('performance: 20,000-cell chain and 50,000-row aggregates', () => {
  const wb = Workbook.create();
  const s = wb.sheets[0].id;
  const list = [{ sheetId: s, r: 0, c: 0, input: '1' }];
  for (let i = 1; i < 20000; i++) list.push({ sheetId: s, r: i, c: 0, input: `=A${i}+1` });
  for (let i = 0; i < 50000; i++) list.push({ sheetId: s, r: i, c: 1, input: String(i % 100) });
  list.push({ sheetId: s, r: 0, c: 2, input: '=SUM(B:B)' }, { sheetId: s, r: 1, c: 2, input: '=COUNTIF(B1:B50000,">=50")' });
  let t = performance.now();
  wb.setCells(list);
  const build = performance.now() - t;
  assert.equal(wb.getValue(s, 19999, 0), 20000);
  assert.equal(wb.getValue(s, 0, 2), 50000 * 49.5);
  assert.equal(wb.getValue(s, 1, 2), 25000);
  t = performance.now();
  wb.setCell(s, 0, 0, '100');
  const chain = performance.now() - t;
  assert.equal(wb.getValue(s, 19999, 0), 20099);
  t = performance.now();
  wb.setCell(s, 7, 1, '1000');
  const agg = performance.now() - t;
  assert.equal(wb.getValue(s, 0, 2), 50000 * 49.5 - 7 + 1000);
  assert.ok(build < 3000 && chain < 1000 && agg < 200, `build ${build | 0}ms chain ${chain | 0}ms agg ${agg | 0}ms`);
});
