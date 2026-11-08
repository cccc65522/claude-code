import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, toCSV, detectDelimiter, decodeText } from '../../js/io/csv.js';
import { crc32, writeZip, readZip } from '../../js/io/zip.js';
import { parseXml, textOf, child } from '../../js/io/xml.js';
import { exportXlsx, importXlsx } from '../../js/io/xlsx.js';
import { formatValue } from '../../js/engine/format.js';
import { parseInput } from '../../js/engine/input.js';
import { Workbook } from '../../js/engine/workbook.js';
import { book, val, input, text, rng, sid } from './helpers.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

test('CSV parsing handles quotes, embedded newlines, CRLF and BOM', () => {
  const rows = parseCSV('﻿名字,备注\r\n"张三","说""你好"""\r\n李四,"两\n行"\r\n');
  assert.deepEqual(rows, [['名字', '备注'], ['张三', '说"你好"'], ['李四', '两\n行']]);
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('"x,y";b\n1;2'), ';', 'delimiters inside quotes do not count');
  assert.deepEqual(parseCSV('a,,c'), [['a', '', 'c']]);
});

test('CSV serialisation quotes only what needs it and round-trips', () => {
  const rows = [['a', 'b,c', 'say "hi"'], [' lead', 'multi\nline', '']];
  const csv = toCSV(rows);
  assert.equal(csv, 'a,"b,c","say ""hi"""\r\n" lead","multi\nline",');
  assert.deepEqual(parseCSV(csv), rows);
});

test('GBK-encoded text from Chinese Excel is decoded', () => {
  const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]); // 你好
  assert.equal(decodeText(gbk), '你好');
  assert.equal(decodeText(new TextEncoder().encode('你好')), '你好');
});

test('CRC-32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip write/read round-trip, stored and deflated', async () => {
  const big = 'abc'.repeat(1000);
  for (const compress of [false, true]) {
    const bytes = await writeZip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/中文.xml', data: big }], { compress });
    const files = await readZip(bytes);
    assert.equal(new TextDecoder().decode(files.get('a.txt')), 'hello');
    assert.equal(new TextDecoder().decode(files.get('dir/中文.xml')), big);
    if (compress) assert.ok(bytes.length < big.length / 4, 'deflate actually compresses');
  }
  await assert.rejects(() => readZip(new Uint8Array(100)), /不是有效/);
});

test('XML parser handles entities, CDATA, self-closing tags and prefixes', () => {
  const doc = parseXml('<?xml version="1.0"?><x:root a="1 &amp; 2"><t>&lt;b&gt;&#x4E2D;</t><e/><![CDATA[<raw>]]></x:root>');
  const root = child(doc, 'root');
  assert.equal(root.attrs.a, '1 & 2');
  assert.equal(textOf(root), '<b>中');
  assert.equal(root.children.length, 2);
  assert.equal(root.text, '<raw>');
});

test('xlsx export -> import keeps formulas, values, styles, widths and sheets', async () => {
  const wb = book({ A1: '名称', B1: '金额', A2: '苹果', B2: '¥12.5', A3: '香蕉', B3: '8', B4: '=SUM(B2:B3)', C1: "'007", C2: '=TEXTJOIN("、",TRUE,A2:A3)', C3: '2026-11-08', D1: 'TRUE', D2: '=1/0' });
  const s = sid(wb);
  wb.setStyle(s, rng('A1:B1'), { bold: true, italic: true, fill: '#fde68a', align: 'center', color: '#1d4ed8' });
  wb.setColWidth(s, 0, 160);
  wb.setRowHeight(s, 0, 36);
  const s2 = wb.addSheet('汇总 表').id;
  wb.setCell(s2, 0, 0, "=Sheet1!B4*2");
  const bytes = await exportXlsx(wb, { activeSheetId: s2 });
  const back = Workbook.fromJSON(await importXlsx(bytes));
  assert.deepEqual(back.sheets.map(x => x.name), ['Sheet1', '汇总 表']);
  assert.equal(input(back, 'B4'), '=SUM(B2:B3)');
  assert.equal(val(back, 'B4'), 20.5);
  assert.equal(val(back, 'C1'), '007');
  assert.equal(val(back, 'C2'), '苹果、香蕉', '_xlfn prefix is added on export and stripped on import');
  assert.equal(text(back, 'C3'), '2026-11-08');
  assert.equal(text(back, 'B2'), '¥12.50');
  assert.equal(val(back, 'D1'), true);
  assert.equal(val(back, 'D2'), '#DIV/0!');
  assert.equal(val(back, '汇总 表!A1'), 41);
  const st = back.getCell(back.sheets[0].id, 0, 0).style;
  assert.deepEqual(st, { bold: true, italic: true, color: '#1d4ed8', fill: '#fde68a', align: 'center' });
  assert.equal(back.sheets[0].colWidth(0), 160);
  assert.equal(back.sheets[0].rowHeight(0), 36);
});

test('xlsx files written by other software import (shared strings, styles)', async () => {
  // Created with openpyxl: shared strings, bold+italic font, a percent format, a column width.
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURES, 'openpyxl.xlsx')));
  const wb = Workbook.fromJSON(await importXlsx(bytes));
  assert.equal(wb.sheets[0].name, '外部');
  assert.equal(val(wb, 'A1'), '数量');
  assert.equal(input(wb, 'B3'), '=A3*10');
  assert.equal(val(wb, 'B3'), 40);
  assert.equal(val(wb, 'C1'), true);
  assert.equal(text(wb, 'D1'), '25%');
  assert.deepEqual(wb.getCell(wb.sheets[0].id, 0, 0).style, { bold: true, italic: true });
  assert.ok(Math.abs(wb.sheets[0].colWidth(0) - 145) <= 2);
});

test('xlsx shared formulas are expanded relative to their master cell', async () => {
  const sheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2</f><v>2</v></c></row>'
    + '<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>4</v></c></row>'
    + '<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>6</v></c></row>'
    + '</sheetData></worksheet>';
  const files = [
    { name: '_rels/.rels', data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/s.xml"/></Relationships>' },
    { name: 'xl/worksheets/s.xml', data: sheet }
  ];
  const wb = Workbook.fromJSON(await importXlsx(await writeZip(files)));
  assert.equal(input(wb, 'B3'), '=A3*2');
  assert.equal(val(wb, 'B3'), 6);
});

test('number formats', () => {
  const cases = [
    [1234.567, '#,##0.00', '1,234.57'],
    [-1234.5, '#,##0.00', '-1,234.50'],
    [1234567, '#,##0,', '1,235'],
    [0.1234, '0.0%', '12.3%'],
    [-5, '¥#,##0.00;[Red]-¥#,##0.00', '-¥5.00'],
    [0, '0;-0;"零"', '零'],
    [3.5, '0.##', '3.5'],
    [3, '0.##', '3'],
    [12345.678, '0.00E+00', '1.23E+04'],
    [0.000123, '0.0E+0', '1.2E-4'],
    [5, '000', '005'],
    [5, '"第"0"名"', '第5名'],
    [46334.6, 'yyyy/m/d h:mm', '2026/11/8 14:24'],
    [46334, 'ddd, mmm d', 'Sun, Nov 8'],
    [0.5625, 'h:mm AM/PM', '1:30 PM'],
    [1.25, '[h]:mm', '30:00'],
    [46334, 'yyyy"年"m"月"d"日" aaa', '2026年11月8日 日'],
    ['abc', '"文本："@', '文本：abc'],
    [0.1 + 0.2, 'General', '0.3'],
    [123456789012, 'General', '1.23457E+11'],
    [1 / 3, 'General', '0.3333333333']
  ];
  for (const [v, fmt, expected] of cases) assert.equal(formatValue(v, fmt).text, expected, `${v} ${fmt}`);
  assert.equal(formatValue(-3, '0.00;[Red]0.00').color, '#d93025');
});

test('input parsing', () => {
  assert.deepEqual(parseInput('=A1'), { kind: 'formula', text: 'A1' });
  assert.deepEqual(parseInput('='), { kind: 'value', value: '=' });
  assert.deepEqual(parseInput('-1.5e3'), { kind: 'value', value: -1500, format: undefined });
  assert.deepEqual(parseInput('-12.5%'), { kind: 'value', value: -0.125, format: '0.00%' });
  assert.equal(parseInput('$-3').value, -3);
  assert.equal(parseInput('2026/2/30').value, '2026/2/30', 'an impossible date stays text');
  assert.equal(parseInput('25:00').value, '25:00');
  assert.equal(parseInput('1,23').value, '1,23', 'misplaced separators are text');
  assert.equal(parseInput('  ').value, '  ');
});
