import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDB } from '../../js/db.js';
import { createStore } from '../../js/store.js';
import { parseImport } from '../../js/importer.js';
import { SAMPLE_BANK } from '../../js/sample.js';
import { seededRng } from '../../js/util.js';

async function freshStore(db = createMemoryDB()) {
  let t = Date.UTC(2026, 9, 23, 2);
  const store = createStore(db, { now: () => (t += 1000), rng: seededRng(1) });
  await store.init();
  return { store, db };
}

function correctResponse(q) {
  if (q.type === 'fill') return q.answer[0];
  if (q.type === 'short') return { text: '', self: true };
  return q.answer.slice();
}
function wrongResponse(q) {
  if (q.type === 'fill') return '不是这个';
  if (q.type === 'short') return { text: '', self: false };
  const other = q.options.find(o => !q.answer.includes(o.key));
  return [other.key];
}

test('sample bank parses cleanly and covers every question type', () => {
  const r = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
  assert.deepEqual(r.errors, []);
  assert.equal(r.questions.length, SAMPLE_BANK.questions.length);
  assert.deepEqual([...new Set(r.questions.map(q => q.type))].sort(), ['fill', 'judge', 'multiple', 'short', 'single']);
});

test('import into a new bank, then again into the same bank skips duplicates', async () => {
  const { store } = await freshStore();
  const parsed = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
  const first = await store.importQuestions({ bankName: parsed.bankName, questions: parsed.questions });
  assert.equal(first.added, parsed.questions.length);
  const again = await store.importQuestions({ bankId: first.bank.id, questions: parsed.questions });
  assert.equal(again.added, 0);
  assert.equal(again.skipped, parsed.questions.length);
  assert.equal(store.questionsOf(first.bank.id).length, parsed.questions.length);
  const other = await store.importQuestions({ bankName: '另一份', questions: parsed.questions.slice(0, 2) });
  assert.equal(other.added, 2, 'same questions are allowed in a different bank');
});

test('practice flow: answers are recorded, wrong book fills and empties, data survives a reload', async () => {
  const db = createMemoryDB();
  const { store } = await freshStore(db);
  const parsed = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
  const { bank } = await store.importQuestions({ bankName: 'S', questions: parsed.questions });

  const s = await store.startSession({ bankId: bank.id, order: 'sequential', count: 0 });
  assert.equal(s.qids.length, parsed.questions.length);
  assert.equal(store.activeSession().id, s.id);

  const qs = s.qids.map(id => store.state.questions.get(id));
  // get the first three wrong, the rest right
  for (const [i, q] of qs.entries()) {
    const res = await store.answer(s.id, q.id, i < 3 ? wrongResponse(q) : correctResponse(q));
    assert.equal(res.correct, i >= 3);
  }
  const repeat = await store.answer(s.id, qs[0].id, correctResponse(qs[0]));
  assert.equal(repeat.repeated, true);
  assert.equal(repeat.correct, false, 'second answer to the same question is ignored');
  const sum = await store.finishSession(s.id);
  assert.equal(sum.correct, qs.length - 3);
  assert.equal(sum.wrong, 3);
  assert.equal(store.state.wrong.size, 3);
  assert.equal(store.activeSession(), null);
  assert.equal(store.state.attempts.length, qs.length);

  // re-practice the wrong book: two right answers in a row (default threshold) clear it
  for (let round = 0; round < 2; round++) {
    const w = await store.startSession({ source: 'wrong', order: 'sequential' });
    assert.equal(w.kind, 'wrong');
    for (const id of w.qids) await store.answer(w.id, id, correctResponse(store.state.questions.get(id)));
    await store.finishSession(w.id);
  }
  assert.equal(store.state.wrong.size, 0);

  // a new store on the same database sees the same data
  const reloaded = createStore(db);
  await reloaded.init();
  assert.equal(reloaded.state.attempts.length, store.state.attempts.length);
  assert.equal(reloaded.state.banks.length, 1);
  assert.equal(reloaded.state.sessions.size, 3);
});

test('resume: an unfinished session is still active after a reload', async () => {
  const db = createMemoryDB();
  const { store } = await freshStore(db);
  const parsed = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
  await store.importQuestions({ bankName: 'S', questions: parsed.questions });
  const s = await store.startSession({ order: 'sequential', count: 5 });
  await store.answer(s.id, s.qids[0], correctResponse(store.state.questions.get(s.qids[0])));
  const reloaded = createStore(db);
  await reloaded.init();
  const active = reloaded.activeSession();
  assert.equal(active.id, s.id);
  assert.equal(Object.keys(active.answers).length, 1);
  await reloaded.abandonSession(s.id);
  assert.equal(reloaded.activeSession(), null);
});

test('short answers need a self-grade; starting with no matching questions fails clearly', async () => {
  const { store } = await freshStore();
  const parsed = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
  await store.importQuestions({ bankName: 'S', questions: parsed.questions });
  const s = await store.startSession({ types: ['short'] });
  await assert.rejects(store.answer(s.id, s.qids[0], { text: '写了点' }), /判断自己是否答对/);
  await assert.rejects(store.startSession({ source: 'wrong' }), /没有符合条件的题目/);
});

test('settings: threshold 1 removes a wrong question after one right answer; values are clamped', async () => {
  const { store } = await freshStore();
  const parsed = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
  await store.importQuestions({ bankName: 'S', questions: parsed.questions });
  assert.equal((await store.updateSettings({ masterThreshold: 9 })).masterThreshold, 5);
  await store.updateSettings({ masterThreshold: 1 });
  const s = await store.startSession({ types: ['single'], count: 1 });
  const q = store.state.questions.get(s.qids[0]);
  await store.answer(s.id, q.id, wrongResponse(q));
  assert.equal(store.state.wrong.size, 1);
  const w = await store.startSession({ source: 'wrong' });
  const res = await store.answer(w.id, q.id, correctResponse(q));
  assert.equal(res.change, 'removed');
  assert.equal(store.state.wrong.size, 0);
});

test('settings changed in quick succession are all kept, also after a reload', async () => {
  const db = createMemoryDB();
  const { store } = await freshStore(db);
  // Both saves start before either has finished, as when two settings are changed right after each other.
  await Promise.all([store.updateSettings({ masterThreshold: 1 }), store.updateSettings({ instantSingle: false })]);
  assert.equal(store.state.settings.masterThreshold, 1);
  assert.equal(store.state.settings.instantSingle, false);
  const { store: reloaded } = await freshStore(db);
  assert.equal(reloaded.state.settings.masterThreshold, 1);
  assert.equal(reloaded.state.settings.instantSingle, false);
});

test('a settings save that fails leaves the previous settings in place', async () => {
  const db = createMemoryDB();
  const { store } = await freshStore(db);
  const before = store.state.settings;
  const batch = db.batch;
  db.batch = async () => { throw new Error('disk full'); };
  await assert.rejects(store.updateSettings({ masterThreshold: 4 }), /disk full/);
  db.batch = batch;
  assert.deepEqual(store.state.settings, before);
});

test('shuffled options keep the original keys so grading is unaffected', async () => {
  const { store } = await freshStore();
  const parsed = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
  await store.importQuestions({ bankName: 'S', questions: parsed.questions });
  await store.updateSettings({ shuffleOptions: true });
  const s = await store.startSession({ types: ['single', 'multiple'] });
  for (const id of s.qids) {
    const q = store.state.questions.get(id);
    assert.deepEqual([...s.optionOrder[id]].sort(), q.options.map(o => o.key).sort());
    assert.equal((await store.answer(s.id, id, correctResponse(q))).correct, true);
  }
});

test('backup and restore: replace and merge, on a different device', async () => {
  const { store } = await freshStore();
  const parsed = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
  const { bank } = await store.importQuestions({ bankName: 'S', questions: parsed.questions });
  const s = await store.startSession({ bankId: bank.id, order: 'sequential', count: 4 });
  for (const id of s.qids) await store.answer(s.id, id, wrongResponse(store.state.questions.get(id)));
  await store.finishSession(s.id);
  await store.updateSettings({ masterThreshold: 3 });

  const backup = JSON.parse(JSON.stringify(await store.exportBackup()));
  assert.ok(store.state.lastBackupAt);

  // another device with its own data
  const { store: other } = await freshStore();
  await other.importQuestions({ bankName: '本机题库', questions: parsed.questions.slice(0, 2) });

  const merged = await other.restoreBackup(backup, 'merge');
  assert.equal(other.state.banks.length, 2);
  assert.equal(merged.counts.attempts, 4);
  assert.equal(other.state.wrong.size, 4);
  assert.equal(other.state.settings.masterThreshold, 2, 'merge keeps this device\'s settings');

  const replaced = await other.restoreBackup(backup, 'replace');
  assert.equal(other.state.banks.length, 1);
  assert.equal(other.state.banks[0].name, 'S');
  assert.equal(replaced.counts.questions, parsed.questions.length);
  assert.equal(other.state.settings.masterThreshold, 3);

  // importing more after a restore keeps sequence numbers increasing
  const more = await other.importQuestions({ bankId: other.state.banks[0].id, questions: [{ ...parsed.questions[0], stem: '新题' }] });
  const maxSeq = Math.max(...[...other.state.questions.values()].map(q => q.seq));
  assert.equal(more.added, 1);
  assert.equal(other.questionsOf(other.state.banks[0].id).at(-1).seq, maxSeq);

  await assert.rejects(other.restoreBackup({ schema: 'nope' }), /不是本应用/);
  await other.clearAll();
  assert.equal(other.state.questions.size, 0);
  assert.equal(other.state.attempts.length, 0);
});

test('deleting a bank removes its questions and wrong entries but keeps answer history', async () => {
  const { store } = await freshStore();
  const parsed = parseImport(JSON.stringify(SAMPLE_BANK), 'sample.json');
  const { bank } = await store.importQuestions({ bankName: 'S', questions: parsed.questions });
  const s = await store.startSession({ count: 2 });
  for (const id of s.qids) await store.answer(s.id, id, wrongResponse(store.state.questions.get(id)));
  await store.deleteBank(bank.id);
  assert.equal(store.state.questions.size, 0);
  assert.equal(store.state.wrong.size, 0);
  assert.equal(store.state.attempts.length, 2);
});
