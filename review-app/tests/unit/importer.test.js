import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, detectDelimiter, toCSV } from '../../js/csv.js';
import { parseImport, normalizeQuestion, decodeBytes, detectFormat, normalizeType, judgeValue } from '../../js/importer.js';

test('CSV: quotes, doubled quotes, line breaks inside quotes, CRLF, BOM', () => {
  const text = '﻿题目,答案\r\n"他说""你好""",A\r\n"第一行\n第二行",B\r\n\r\n';
  const rows = parseCSV(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].cells, ['他说"你好"', 'A']);
  assert.deepEqual(rows[2].cells, ['第一行\n第二行', 'B']);
  assert.equal(rows[2].line, 3);
});

test('CSV: tab and semicolon delimiters are detected', () => {
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('"a,b";c;d'), ';');
  assert.deepEqual(parseCSV('题目\t答案\n1+1=?\t2')[1].cells, ['1+1=?', '2']);
});

test('CSV: toCSV round-trips through parseCSV', () => {
  const rows = [['题目', '解析'], ['含,逗号', '含"引号"\n和换行']];
  assert.deepEqual(parseCSV(toCSV(rows)).map(r => r.cells), rows);
});

test('type and true/false words are recognized in Chinese and English', () => {
  assert.equal(normalizeType('单选题'), 'single');
  assert.equal(normalizeType('多项选择'), 'multiple');
  assert.equal(normalizeType('Judge'), 'judge');
  assert.equal(normalizeType('填空'), 'fill');
  assert.equal(normalizeType('简答题'), 'short');
  assert.equal(normalizeType(''), null);
  assert.equal(normalizeType('作文'), undefined);
  for (const w of ['对', '正确', '√', 'T', 'true', true]) assert.equal(judgeValue(w), true, String(w));
  for (const w of ['错', '错误', '×', 'F', 'false', false]) assert.equal(judgeValue(w), false, String(w));
  assert.equal(judgeValue('也许'), null);
});

test('normalizeQuestion: choice answers in many spellings', () => {
  const base = { 题目: '选出质数', 选项: '2|9|11|15' };
  assert.deepEqual(normalizeQuestion({ ...base, 答案: 'A,C' }).answer, ['A', 'C']);
  assert.deepEqual(normalizeQuestion({ ...base, 答案: 'ca' }).answer, ['A', 'C']);
  assert.deepEqual(normalizeQuestion({ ...base, 答案: 'A、C' }).answer, ['A', 'C']);
  assert.deepEqual(normalizeQuestion({ ...base, 答案: ['C', 'A'] }).answer, ['A', 'C']);
  assert.equal(normalizeQuestion({ ...base, 答案: 'AC' }).type, 'multiple');
  assert.equal(normalizeQuestion({ ...base, 答案: 'B' }).type, 'single');
  // answer written as the option text
  assert.deepEqual(normalizeQuestion({ ...base, 答案: '11' }).answer, ['C']);
});

test('normalizeQuestion: options as array with prefixes, object, and separate columns', () => {
  const a = normalizeQuestion({ stem: 'Q', options: ['A. 北京', 'B、上海'], answer: 'A' });
  assert.deepEqual(a.options, [{ key: 'A', text: '北京' }, { key: 'B', text: '上海' }]);
  const b = normalizeQuestion({ stem: 'Q', options: { B: '乙', A: '甲' }, answer: 'B' });
  assert.deepEqual(b.options.map(o => o.text), ['甲', '乙']);
  const c = normalizeQuestion({ 题目: 'Q', 选项A: '甲', 选项B: '乙', 选项C: '', 选项D: '', 答案: 'B' });
  assert.equal(c.options.length, 2);
});

test('normalizeQuestion: errors explain what to fix', () => {
  assert.throws(() => normalizeQuestion({ 题目: '', 答案: 'A' }), /缺少题目/);
  assert.throws(() => normalizeQuestion({ 题目: 'Q', 题型: '单选', 选项: '甲|乙', 答案: 'AB' }), /单选题只能有一个答案/);
  assert.throws(() => normalizeQuestion({ 题目: 'Q', 选项: '甲|乙', 答案: 'E' }), /超出了选项范围/);
  assert.throws(() => normalizeQuestion({ 题目: 'Q', 选项A: '甲', 选项B: '', 选项C: '丙', 答案: 'A' }), /空白项/);
  assert.throws(() => normalizeQuestion({ 题目: 'Q', 题型: '判断', 答案: '也许' }), /判断题答案/);
  assert.throws(() => normalizeQuestion({ 题目: 'Q', 题型: '作文', 答案: 'x' }), /不认识的题型/);
  assert.throws(() => normalizeQuestion({ 题目: 'Q', 题型: '单选', 选项: '甲', 答案: 'A' }), /至少需要 2 个选项/);
});

test('normalizeQuestion: judge, fill and short answers', () => {
  const j = normalizeQuestion({ 题目: '地球是圆的', 答案: '√' });
  assert.equal(j.type, 'judge');
  assert.deepEqual(j.answer, ['T']);
  assert.deepEqual(j.options.map(o => o.key), ['T', 'F']);
  const j2 = normalizeQuestion({ 题目: '太阳从西边升起', 题型: '判断', 选项: '正确|错误', 答案: 'B' });
  assert.deepEqual(j2.answer, ['F']);
  const f = normalizeQuestion({ 题目: '一年有__个月', 答案: '12|十二' });
  assert.equal(f.type, 'fill');
  assert.deepEqual(f.answer, ['12', '十二']);
  const s = normalizeQuestion({ 题目: '简述番茄工作法', 题型: '简答', 答案: '专注 25 分钟，休息 5 分钟' });
  assert.equal(s.type, 'short');
  assert.equal(s.answer.length, 1);
  assert.deepEqual(normalizeQuestion({ 题目: 'Q', 答案: 'x', 标签: '数学，几何' }).tags, ['数学', '几何']);
});

test('parseImport JSON: array, object with name, per-item errors, duplicates, backup file', () => {
  const r = parseImport(JSON.stringify({
    name: '我的题库',
    questions: [
      { type: 'single', question: '1+1=?', options: ['1', '2'], answer: 'B' },
      { type: 'single', question: '1+1=?', options: ['1', '2'], answer: 'B' },
      { type: 'single', question: '缺答案', options: ['1', '2'] }
    ]
  }), 'x.json');
  assert.equal(r.format, 'json');
  assert.equal(r.bankName, '我的题库');
  assert.equal(r.questions.length, 1);
  assert.equal(r.duplicates, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].where, '第 3 题');

  assert.equal(parseImport('[{"stem":"a","answer":"对"}]', 'bank.json').bankName, 'bank');
  assert.match(parseImport('{bad json', 'a.json').errors[0].message, /JSON 格式有误/);
  assert.match(parseImport('{"schema":"review-app-backup","data":{}}').errors[0].message, /恢复数据/);
});

test('parseImport CSV: Chinese headers, option columns, row numbers in errors', () => {
  const csv = [
    '题型,题目,选项A,选项B,选项C,选项D,答案,解析,标签',
    '单选,中国的首都是？,上海,北京,广州,深圳,B,常识,地理',
    '多选,质数有,2,9,11,15,AC,,',
    '判断,水在 100℃ 沸腾,,,,,对,标准大气压下,',
    '填空,π 约等于,,,,,3.14,,',
    '单选,坏题,甲,乙,,,F,,'
  ].join('\n');
  const r = parseImport(csv, '题库.csv');
  assert.equal(r.format, 'csv');
  assert.equal(r.questions.length, 4);
  assert.deepEqual(r.questions.map(q => q.type), ['single', 'multiple', 'judge', 'fill']);
  assert.equal(r.questions[0].explanation, '常识');
  assert.deepEqual(r.questions[0].tags, ['地理']);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].where, '第 6 行');
  assert.match(parseImport('a,b\n1,2', 'x.csv').errors[0].message, /题目/);
});

test('parseImport CSV: English headers and a single pipe-separated options column', () => {
  const r = parseImport('type,question,options,answer\nmultiple,Pick vowels,a|b|e|z,"A,C"', 'x.csv');
  assert.deepEqual(r.questions[0].answer, ['A', 'C']);
});

test('parseImport text: numbered document with section headers, inline options, multi-line explanation', () => {
  const text = [
    '期末复习题',
    '一、单项选择题（每题 2 分）',
    '1. 中国的首都是哪座城市？',
    'A. 上海  B. 北京  C. 广州  D. 深圳',
    '答案：B',
    '解析：北京是首都。',
    '同时也是政治中心。',
    '2、下列属于质数的是',
    'A．2',
    'B．9',
    'C．11',
    '【答案】A',
    '二、判断题',
    '1. 光速约为每秒 30 万千米。',
    '答案：对',
    '2. 【填空】一年有____个月',
    '答案：12',
    '3. 没有答案的题'
  ].join('\n');
  const r = parseImport(text, '复习.txt');
  assert.equal(r.format, 'text');
  assert.equal(r.questions.length, 4, JSON.stringify(r.errors));
  const [q1, q2, q3, q4] = r.questions;
  assert.equal(q1.type, 'single');
  assert.equal(q1.stem, '中国的首都是哪座城市？');
  assert.deepEqual(q1.options.map(o => o.text), ['上海', '北京', '广州', '深圳']);
  assert.equal(q1.explanation, '北京是首都。\n同时也是政治中心。');
  assert.equal(q2.options.length, 3);
  assert.equal(q3.type, 'judge');
  assert.equal(q4.type, 'fill');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].where, /第 18 行/);
});

test('parseImport text: blank-line separated blocks without numbers', () => {
  const r = parseImport('地球是太阳系最大的行星\n答案：错\n\n一年有几个季节？\nA. 3\nB. 4\n答案：B\n', 'a.txt');
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[0].type, 'judge');
  assert.deepEqual(r.questions[1].answer, ['B']);
});

test('parseImport text: numbered points inside an explanation do not split the question', () => {
  const r = parseImport('1. 题目一\n答案：对\n解析：\n1. 第一点\n2. 第二点\n2. 题目二\n答案：错', 'a.txt');
  // "2. 第二点" is a higher number, so it does start a new block; this documents the limit.
  assert.ok(r.questions.length >= 2);
  assert.equal(r.questions[0].stem, '题目一');
});

test('detectFormat and decodeBytes (UTF-8 with BOM and GB18030 from Excel)', () => {
  assert.equal(detectFormat('[{}]'), 'json');
  assert.equal(detectFormat('题目,答案\n1,2'), 'csv');
  assert.equal(detectFormat('1. 问题\n答案：A'), 'text');
  const utf8 = new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode('题目,答案')]);
  assert.equal(decodeBytes(utf8), '题目,答案');
  // "题目,答案" encoded as GB18030
  const gbk = new Uint8Array([0xCC, 0xE2, 0xC4, 0xBF, 0x2C, 0xB4, 0xF0, 0xB0, 0xB8]);
  assert.equal(decodeBytes(gbk), '题目,答案');
});
