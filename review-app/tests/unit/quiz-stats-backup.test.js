process.env.TZ = 'Asia/Shanghai';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, pickQuestions, createSession, recordAnswer, firstUnanswered, summarize, updateWrongEntry, answerText, responseText } from '../../js/quiz.js';
import { overview, streak, daily, bankStats, questionStats } from '../../js/stats.js';
import { buildBackup, validateBackup, mergeData } from '../../js/backup.js';
import { seededRng, normalizeAnswerText, dateKey, addDays } from '../../js/util.js';

const single = { id: 'q1', bankId: 'b', type: 'single', options: [{ key: 'A' }, { key: 'B' }], answer: ['B'] };
const multi = { id: 'q2', bankId: 'b', type: 'multiple', options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }], answer: ['A', 'C'] };
const judge = { id: 'q3', bankId: 'b', type: 'judge', options: [{ key: 'T' }, { key: 'F' }], answer: ['F'] };
const fill = { id: 'q4', bankId: 'b', type: 'fill', options: [], answer: ['3.14', '三点一四'] };
const short = { id: 'q5', bankId: 'b', type: 'short', options: [], answer: ['参考'] };

test('grade: every question type', () => {
  assert.equal(grade(single, ['B']), true);
  assert.equal(grade(single, ['A']), false);
  assert.equal(grade(single, []), false);
  assert.equal(grade(multi, ['C', 'A']), true);
  assert.equal(grade(multi, ['A']), false, 'partial multiple choice is wrong');
  assert.equal(grade(multi, ['A', 'B', 'C']), false);
  assert.equal(grade(judge, ['F']), true);
  assert.equal(grade(fill, ' 3.14。'), true);
  assert.equal(grade(fill, '３．１４'), true, 'full-width digits count');
  assert.equal(grade(fill, '三点一四'), true);
  assert.equal(grade(fill, '3.1'), false);
  assert.equal(grade(fill, ''), false);
  assert.equal(grade(short, { text: 'x' }), null);
  assert.equal(grade(short, { text: 'x', self: true }), true);
  assert.equal(grade(short, { self: false }), false);
});

test('answer and response text for display', () => {
  assert.equal(answerText(multi), 'AC');
  assert.equal(answerText(judge), '错误');
  assert.equal(answerText(fill), '3.14 或 三点一四');
  assert.equal(responseText(judge, ['T']), '正确');
  assert.equal(responseText(single, []), '未作答');
  assert.equal(responseText(short, { self: true }), '自评：答对');
  assert.equal(normalizeAnswerText('  Hello   World! '), 'hello world');
});

test('pickQuestions: sequential, random (seeded), count, types, unseen first', () => {
  const qs = [
    { id: 'a', type: 'single', seq: 3 }, { id: 'b', type: 'judge', seq: 1 }, { id: 'c', type: 'single', seq: 2 }, { id: 'd', type: 'fill', seq: 4 }
  ];
  assert.deepEqual(pickQuestions(qs, { order: 'sequential' }), ['b', 'c', 'a', 'd']);
  assert.deepEqual(pickQuestions(qs, { order: 'sequential', count: 2 }), ['b', 'c']);
  assert.deepEqual(pickQuestions(qs, { order: 'sequential', types: ['single'] }), ['c', 'a']);
  const r1 = pickQuestions(qs, { rng: seededRng(7) });
  const r2 = pickQuestions(qs, { rng: seededRng(7) });
  assert.deepEqual(r1, r2);
  assert.deepEqual([...r1].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(pickQuestions(qs, { order: 'sequential', unseen: true, seenIds: new Set(['b', 'c']) }), ['a', 'd', 'b', 'c']);
});

test('session: record answers, resume point, summary', () => {
  let s = createSession({ id: 's', qids: ['q1', 'q2', 'q3'], now: 1000 });
  assert.equal(firstUnanswered(s), 0);
  s = recordAnswer(s, 'q1', ['B'], true, 2000);
  s = recordAnswer(s, 'q2', ['A'], false, 3000);
  assert.equal(firstUnanswered(s), 2);
  const sum = summarize({ ...s, finishedAt: 61000 });
  assert.deepEqual([sum.total, sum.answered, sum.correct, sum.wrong], [3, 2, 1, 1]);
  assert.equal(sum.accuracy, 0.5);
  assert.equal(sum.durationMs, 60000);
  assert.deepEqual(sum.wrongIds, ['q2']);
});

test('wrong book: added on a miss, removed after N right answers in a row, reset on a new miss', () => {
  let r = updateWrongEntry(undefined, single, false, ['A'], 1, 2);
  assert.equal(r.change, 'added');
  assert.equal(r.entry.wrongCount, 1);
  r = updateWrongEntry(r.entry, single, true, ['B'], 2, 2);
  assert.equal(r.change, 'updated');
  assert.equal(r.entry.correctStreak, 1);
  const missAgain = updateWrongEntry(r.entry, single, false, ['A'], 3, 2);
  assert.equal(missAgain.entry.correctStreak, 0);
  assert.equal(missAgain.entry.wrongCount, 2);
  assert.equal(missAgain.entry.addedAt, 1);
  r = updateWrongEntry(r.entry, single, true, ['B'], 4, 2);
  assert.equal(r.change, 'removed');
  assert.equal(r.entry, null);
  assert.equal(updateWrongEntry(undefined, single, true, ['B'], 5, 2).change, null, 'right answer on a question not in the book');
  assert.equal(updateWrongEntry(undefined, single, false, ['A'], 6, 1).change, 'added');
  assert.equal(updateWrongEntry({ qid: 'q1', correctStreak: 0, wrongCount: 1 }, single, true, ['B'], 7, 1).change, 'removed');
});

test('stats: overview, streak across days, daily buckets in local time', () => {
  const now = new Date('2026-10-23T10:00:00+08:00').getTime();
  const day = 86400000;
  const at = (offsetDays, correct, hour = 9) => ({ qid: 'q', answeredAt: new Date(`2026-10-${23 - offsetDays}T0${hour}:00:00+08:00`).getTime(), correct });
  const attempts = [at(0, true), at(0, false), at(1, true), at(2, true), at(4, false)];
  const o = overview(attempts, now);
  assert.equal(o.total, 5);
  assert.equal(o.correct, 3);
  assert.equal(o.todayTotal, 2);
  assert.equal(o.todayCorrect, 1);
  assert.equal(o.activeDays, 4);
  assert.equal(o.streak, 3);
  assert.equal(streak([at(1, true), at(2, true)], now), 2, 'no study yet today keeps yesterday\'s streak');
  assert.equal(streak([at(2, true)], now), 0);
  const d = daily(attempts, 7, now);
  assert.equal(d.length, 7);
  assert.equal(d[6].date, '2026-10-23');
  assert.equal(d[6].total, 2);
  assert.equal(d[2].total, 1);
  // 00:30 local time belongs to that local day even though it is the previous day in UTC
  assert.equal(dateKey(new Date('2026-10-23T00:30:00+08:00').getTime()), '2026-10-23');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  void day;
});

test('stats: per bank and per question', () => {
  const banks = [{ id: 'b1', name: '甲' }, { id: 'b2', name: '乙' }];
  const questions = [{ id: 'x', bankId: 'b1' }, { id: 'y', bankId: 'b1' }, { id: 'z', bankId: 'b2' }];
  const attempts = [
    { qid: 'x', correct: false, answeredAt: 1 }, { qid: 'x', correct: true, answeredAt: 2 },
    { qid: 'y', correct: false, answeredAt: 3 }, { qid: 'gone', correct: true, answeredAt: 4 }
  ];
  const [b1, b2] = bankStats(banks, questions, attempts);
  assert.deepEqual([b1.total, b1.seen, b1.latestRight, b1.tries], [2, 2, 1, 3]);
  assert.equal(b1.accuracy, 1 / 3);
  assert.equal(b2.accuracy, null);
  const qs = questionStats(attempts);
  assert.deepEqual(qs.get('x'), { count: 2, correct: 1, lastAt: 2, lastCorrect: true });
});

const sample = () => ({
  banks: [{ id: 'b1', name: '甲', createdAt: 1, updatedAt: 1 }],
  questions: [{ id: 'q1', bankId: 'b1', type: 'single', stem: 's', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: ['A'], updatedAt: 1 }],
  attempts: [{ id: 'a1', qid: 'q1', correct: false, answeredAt: 5 }],
  sessions: [{ id: 's1', qids: ['q1'], answers: {}, startedAt: 4 }],
  wrong: [{ qid: 'q1', wrongCount: 1, updatedAt: 5 }],
  settings: { masterThreshold: 3 }
});

test('backup: build and validate round trip', () => {
  const b = buildBackup(sample(), Date.UTC(2026, 0, 2));
  assert.equal(b.schema, 'review-app-backup');
  assert.equal(b.counts.questions, 1);
  const v = validateBackup(JSON.parse(JSON.stringify(b)));
  assert.equal(v.ok, true);
  assert.deepEqual(v.warnings, []);
  assert.equal(v.data.settings.masterThreshold, 3);
});

test('backup: rejects wrong files and drops broken or orphaned records with warnings', () => {
  assert.equal(validateBackup(null).ok, false);
  assert.match(validateBackup([{ stem: 'x' }]).errors[0], /不是备份对象/);
  assert.match(validateBackup({ schema: 'other' }).errors[0], /不是本应用/);
  assert.match(validateBackup({ schema: 'review-app-backup', version: 99, data: {} }).errors[0], /版本/);
  assert.match(validateBackup({ schema: 'review-app-backup', version: 1, data: { banks: 'x' } }).errors[0], /题库部分格式不对/);
  const data = sample();
  data.questions.push({ id: 'q2', bankId: 'missing', type: 'single', stem: 's', options: [], answer: ['A'] });
  data.questions.push({ id: 'q3', bankId: 'b1', type: 'essay', stem: 's', options: [], answer: [] });
  data.wrong.push({ qid: 'q2', wrongCount: 1 });
  const v = validateBackup({ schema: 'review-app-backup', version: 1, data });
  assert.equal(v.ok, true);
  assert.equal(v.data.questions.length, 1);
  assert.equal(v.data.wrong.length, 1);
  assert.equal(v.warnings.length, 3, v.warnings.join('|'));
});

test('backup: merge keeps both sides and the newer copy of shared records', () => {
  const cur = sample();
  const inc = sample();
  inc.banks = [{ id: 'b1', name: '甲（新）', createdAt: 1, updatedAt: 9 }, { id: 'b2', name: '乙', createdAt: 2, updatedAt: 2 }];
  inc.attempts = [{ id: 'a2', qid: 'q1', correct: true, answeredAt: 8 }];
  inc.wrong = [{ qid: 'q1', wrongCount: 1, updatedAt: 1 }];
  inc.settings = { masterThreshold: 5, shuffleOptions: true };
  const m = mergeData(cur, inc);
  assert.deepEqual(m.banks.map(b => b.name).sort(), ['乙', '甲（新）']);
  assert.equal(m.attempts.length, 2);
  assert.equal(m.wrong[0].updatedAt, 5, 'older incoming wrong entry does not overwrite');
  assert.deepEqual(m.settings, { masterThreshold: 3, shuffleOptions: true });
});
