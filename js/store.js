// App data layer: keeps everything in memory for fast screens and writes each change through
// to the storage adapter (IndexedDB in the browser, memory in tests).

import { uid, shuffle } from './util.js';
import { dedupeKey } from './importer.js';
import { grade, pickQuestions, createSession, recordAnswer, updateWrongEntry, summarize } from './quiz.js';
import { buildBackup, validateBackup, mergeData } from './backup.js';

export const DEFAULT_SETTINGS = {
  masterThreshold: 2,   // right answers in a row that take a question out of the wrong book
  shuffleOptions: false,
  instantSingle: true,  // single-choice and true/false are graded as soon as an option is tapped
  defaultCount: 20
};

export function createStore(db, { now = () => Date.now(), rng = Math.random } = {}) {
  const state = {
    banks: [],
    questions: new Map(),
    attempts: [],
    sessions: new Map(),
    wrong: new Map(),
    settings: { ...DEFAULT_SETTINGS },
    activeSessionId: null,
    lastBackupAt: null,
    seq: 0
  };

  const meta = (key, value) => ({ type: 'put', store: 'meta', value: { key, value } });

  function load(records) {
    state.banks = (records.banks || []).slice().sort((a, b) => a.createdAt - b.createdAt);
    state.questions = new Map((records.questions || []).map(q => [q.id, q]));
    state.attempts = (records.attempts || []).slice().sort((a, b) => a.answeredAt - b.answeredAt);
    state.sessions = new Map((records.sessions || []).map(s => [s.id, s]));
    state.wrong = new Map((records.wrong || []).map(w => [w.qid, w]));
    const m = Object.fromEntries((records.meta || []).map(r => [r.key, r.value]));
    state.settings = { ...DEFAULT_SETTINGS, ...(m.settings || {}) };
    state.activeSessionId = m.activeSessionId ?? null;
    state.lastBackupAt = m.lastBackupAt ?? null;
    let maxSeq = 0;
    for (const q of state.questions.values()) maxSeq = Math.max(maxSeq, q.seq ?? 0);
    state.seq = Math.max(m.seq ?? 0, maxSeq);
  }

  async function init() {
    const names = ['banks', 'questions', 'attempts', 'sessions', 'wrong', 'meta'];
    const lists = await Promise.all(names.map(n => db.getAll(n)));
    load(Object.fromEntries(names.map((n, i) => [n, lists[i]])));
  }

  // ------------------------------------------------------------ banks and questions

  const questionsOf = bankId => [...state.questions.values()].filter(q => q.bankId === bankId).sort((a, b) => a.seq - b.seq);
  const bank = id => state.banks.find(b => b.id === id) || null;

  async function createBank(name) {
    const t = now();
    const b = { id: uid('b'), name: name.trim() || '未命名题库', createdAt: t, updatedAt: t };
    await db.batch([{ type: 'put', store: 'banks', value: b }]);
    state.banks.push(b);
    return b;
  }

  // Adds parsed questions to an existing bank (bankId) or a new one (bankName).
  // Questions already in that bank (same type, stem and options) are skipped.
  async function importQuestions({ bankId = null, bankName = '', questions }) {
    const t = now();
    let b = bankId ? bank(bankId) : null;
    if (bankId && !b) throw new Error('找不到要导入的题库');
    const isNew = !b;
    if (!b) b = { id: uid('b'), name: bankName.trim() || '未命名题库', createdAt: t, updatedAt: t };
    const existing = new Set(isNew ? [] : questionsOf(b.id).map(dedupeKey));
    const added = [];
    let skipped = 0;
    for (const q of questions) {
      const key = dedupeKey(q);
      if (existing.has(key)) { skipped++; continue; }
      existing.add(key);
      added.push({ ...q, id: uid('q'), bankId: b.id, seq: ++state.seq, createdAt: t, updatedAt: t });
    }
    b = { ...b, updatedAt: t };
    await db.batch([
      { type: 'put', store: 'banks', value: b },
      ...added.map(q => ({ type: 'put', store: 'questions', value: q })),
      meta('seq', state.seq)
    ]);
    if (isNew) state.banks.push(b); else state.banks = state.banks.map(x => x.id === b.id ? b : x);
    for (const q of added) state.questions.set(q.id, q);
    return { bank: b, added: added.length, skipped };
  }

  async function renameBank(id, name) {
    const b = bank(id);
    if (!b) throw new Error('找不到这个题库');
    const next = { ...b, name: name.trim() || b.name, updatedAt: now() };
    await db.batch([{ type: 'put', store: 'banks', value: next }]);
    state.banks = state.banks.map(x => x.id === id ? next : x);
    return next;
  }

  // Removes the bank, its questions and their wrong-book entries. Answer history is kept so
  // the study record still counts past work.
  async function deleteBank(id) {
    const qs = questionsOf(id);
    const ops = [{ type: 'delete', store: 'banks', key: id }];
    for (const q of qs) {
      ops.push({ type: 'delete', store: 'questions', key: q.id });
      if (state.wrong.has(q.id)) ops.push({ type: 'delete', store: 'wrong', key: q.id });
    }
    await db.batch(ops);
    state.banks = state.banks.filter(b => b.id !== id);
    for (const q of qs) { state.questions.delete(q.id); state.wrong.delete(q.id); }
  }

  async function deleteQuestion(qid) {
    const ops = [{ type: 'delete', store: 'questions', key: qid }];
    if (state.wrong.has(qid)) ops.push({ type: 'delete', store: 'wrong', key: qid });
    await db.batch(ops);
    state.questions.delete(qid);
    state.wrong.delete(qid);
  }

  // ------------------------------------------------------------ practice

  function poolFor({ source = 'all', bankId = null }) {
    let pool = [...state.questions.values()];
    if (bankId) pool = pool.filter(q => q.bankId === bankId);
    if (source === 'wrong') pool = pool.filter(q => state.wrong.has(q.id));
    if (source === 'unseen') {
      const seen = new Set(state.attempts.map(a => a.qid));
      pool = pool.filter(q => !seen.has(q.id));
    }
    return pool;
  }

  function activeSession() {
    const s = state.activeSessionId ? state.sessions.get(state.activeSessionId) : null;
    return s && !s.finishedAt ? s : null;
  }

  // opts: { source: 'all' | 'wrong' | 'unseen', bankId, order, count, types, qids, title, kind }
  async function startSession(opts = {}) {
    const qids = opts.qids
      ? opts.qids.filter(id => state.questions.has(id))
      : pickQuestions(poolFor(opts), { order: opts.order, count: opts.count, types: opts.types, rng });
    if (!qids.length) throw new Error('没有符合条件的题目');
    const optionOrder = {};
    if (state.settings.shuffleOptions) {
      for (const id of qids) {
        const q = state.questions.get(id);
        if (q.type === 'single' || q.type === 'multiple') optionOrder[id] = shuffle(q.options.map(o => o.key), rng);
      }
    }
    const kind = opts.kind || (opts.source === 'wrong' ? 'wrong' : 'practice');
    const bankName = opts.bankId ? bank(opts.bankId)?.name : '全部题库';
    const title = opts.title || (kind === 'wrong' ? `错题重练 · ${bankName}` : `${bankName}`);
    const s = createSession({ id: uid('s'), kind, title, bankIds: opts.bankId ? [opts.bankId] : [], qids, optionOrder, now: now() });
    await db.batch([{ type: 'put', store: 'sessions', value: s }, meta('activeSessionId', s.id)]);
    state.sessions.set(s.id, s);
    state.activeSessionId = s.id;
    return s;
  }

  // Grades one answer, stores the attempt, updates the wrong book and the session.
  // Answering the same question twice in a session returns the first result unchanged.
  async function answer(sessionId, qid, response) {
    const s = state.sessions.get(sessionId);
    if (!s) throw new Error('练习不存在');
    const q = state.questions.get(qid);
    if (!q) throw new Error('这道题已被删除');
    if (s.answers[qid]) return { correct: s.answers[qid].correct, question: q, change: null, repeated: true };
    const correct = grade(q, response);
    if (correct === null) throw new Error('请先判断自己是否答对');
    const t = now();
    const attempt = { id: uid('a'), qid, bankId: q.bankId, sessionId, kind: s.kind, correct, response, answeredAt: t };
    const { entry, change } = updateWrongEntry(state.wrong.get(qid), q, correct, response, t, state.settings.masterThreshold);
    const next = recordAnswer(s, qid, response, correct, t);
    const ops = [{ type: 'put', store: 'attempts', value: attempt }, { type: 'put', store: 'sessions', value: next }];
    if (change === 'removed') ops.push({ type: 'delete', store: 'wrong', key: qid });
    else if (entry && change) ops.push({ type: 'put', store: 'wrong', value: entry });
    await db.batch(ops);
    state.attempts.push(attempt);
    state.sessions.set(sessionId, next);
    if (change === 'removed') state.wrong.delete(qid);
    else if (entry && change) state.wrong.set(qid, entry);
    return { correct, question: q, change };
  }

  async function finishSession(sessionId) {
    const s = state.sessions.get(sessionId);
    if (!s) throw new Error('练习不存在');
    const done = s.finishedAt ? s : { ...s, finishedAt: now(), updatedAt: now() };
    const ops = [{ type: 'put', store: 'sessions', value: done }];
    if (state.activeSessionId === sessionId) ops.push(meta('activeSessionId', null));
    await db.batch(ops);
    state.sessions.set(sessionId, done);
    if (state.activeSessionId === sessionId) state.activeSessionId = null;
    return summarize(done);
  }

  // Leaves a session unfinished in the history but no longer offers to resume it.
  async function abandonSession(sessionId) {
    const s = state.sessions.get(sessionId);
    if (!s) return;
    const ops = [];
    if (!Object.keys(s.answers).length) { ops.push({ type: 'delete', store: 'sessions', key: s.id }); }
    if (state.activeSessionId === sessionId) ops.push(meta('activeSessionId', null));
    await db.batch(ops);
    if (!Object.keys(s.answers).length) state.sessions.delete(s.id);
    if (state.activeSessionId === sessionId) state.activeSessionId = null;
  }

  // ------------------------------------------------------------ wrong book

  async function removeWrong(qid) {
    await db.batch([{ type: 'delete', store: 'wrong', key: qid }]);
    state.wrong.delete(qid);
  }

  async function clearWrong(bankId = null) {
    const ids = [...state.wrong.values()].filter(w => !bankId || w.bankId === bankId).map(w => w.qid);
    await db.batch(ids.map(key => ({ type: 'delete', store: 'wrong', key })));
    for (const id of ids) state.wrong.delete(id);
    return ids.length;
  }

  // ------------------------------------------------------------ settings, backup, restore

  async function updateSettings(patch) {
    const prev = state.settings;
    const next = { ...prev, ...patch };
    next.masterThreshold = Math.min(5, Math.max(1, Math.round(Number(next.masterThreshold) || DEFAULT_SETTINGS.masterThreshold)));
    next.defaultCount = Math.max(0, Math.round(Number(next.defaultCount) || 0));
    // Update the state before the write, so a second change made while this one is still
    // being saved builds on it instead of overwriting it with the old value.
    state.settings = next;
    try {
      await db.batch([meta('settings', next)]);
    } catch (e) {
      if (state.settings === next) state.settings = prev;
      throw e;
    }
    return next;
  }

  function snapshot() {
    return {
      banks: state.banks.slice(),
      questions: [...state.questions.values()],
      attempts: state.attempts.slice(),
      sessions: [...state.sessions.values()],
      wrong: [...state.wrong.values()],
      settings: { ...state.settings }
    };
  }

  async function exportBackup() {
    const t = now();
    const backup = buildBackup(snapshot(), t);
    await db.batch([meta('lastBackupAt', t)]);
    state.lastBackupAt = t;
    return backup;
  }

  function checkBackup(obj) {
    return validateBackup(obj);
  }

  // mode: 'replace' wipes current data first; 'merge' keeps both (newer copy of a record wins).
  async function restoreBackup(obj, mode = 'replace') {
    const v = validateBackup(obj);
    if (!v.ok) throw new Error(v.errors.join('；'));
    const data = mode === 'merge' ? mergeData(snapshot(), v.data) : v.data;
    const settings = { ...DEFAULT_SETTINGS, ...(mode === 'merge' ? state.settings : data.settings) };
    const keepActive = mode === 'merge' && state.activeSessionId && data.sessions.some(s => s.id === state.activeSessionId);
    let seq = 0;
    for (const q of data.questions) seq = Math.max(seq, q.seq ?? 0);
    const records = {
      banks: data.banks, questions: data.questions, attempts: data.attempts, sessions: data.sessions, wrong: data.wrong,
      meta: [
        { key: 'settings', value: settings },
        { key: 'activeSessionId', value: keepActive ? state.activeSessionId : null },
        { key: 'lastBackupAt', value: state.lastBackupAt },
        { key: 'seq', value: seq }
      ]
    };
    await db.replaceAll(records);
    load(records);
    return { warnings: v.warnings, counts: Object.fromEntries(['banks', 'questions', 'attempts', 'sessions', 'wrong'].map(k => [k, data[k].length])) };
  }

  async function clearAll() {
    await db.replaceAll({});
    load({});
  }

  return {
    state, init, bank, questionsOf, poolFor,
    createBank, importQuestions, renameBank, deleteBank, deleteQuestion,
    activeSession, startSession, answer, finishSession, abandonSession,
    removeWrong, clearWrong,
    updateSettings, snapshot, exportBackup, checkBackup, restoreBackup, clearAll
  };
}
