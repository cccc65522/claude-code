// Grading, question selection, practice sessions and the wrong-question book. Pure functions.

import { normalizeAnswerText, shuffle } from './util.js';

// response: single/multiple/judge -> array of option keys; fill -> string;
// short -> { text, self: true | false } where self is the learner's own verdict.
// Returns true / false, or null when a short answer has not been self-graded yet.
export function grade(question, response) {
  switch (question.type) {
    case 'single':
    case 'multiple':
    case 'judge': {
      const got = [...new Set((Array.isArray(response) ? response : []).map(String))].sort().join(',');
      return got !== '' && got === [...question.answer].sort().join(',');
    }
    case 'fill': {
      const got = normalizeAnswerText(response);
      return got !== '' && question.answer.some(a => normalizeAnswerText(a) === got);
    }
    case 'short':
      return response && typeof response.self === 'boolean' ? response.self : null;
    default:
      return null;
  }
}

export function answerText(question, answer = question.answer) {
  if (question.type === 'fill') return answer.join(' 或 ');
  if (question.type === 'short') return answer[0] ?? '';
  if (question.type === 'judge') return answer[0] === 'T' ? '正确' : '错误';
  return answer.join('');
}

export function responseText(question, response) {
  if (response == null) return '未作答';
  if (question.type === 'fill') return String(response) || '（空）';
  if (question.type === 'short') return response.self === true ? '自评：答对' : response.self === false ? '自评：答错' : '未自评';
  if (!Array.isArray(response) || !response.length) return '未作答';
  if (question.type === 'judge') return response[0] === 'T' ? '正确' : '错误';
  return [...response].sort().join('');
}

// Picks question ids for a session.
//   order: 'random' | 'sequential' (sequential follows import order, field seq)
//   count: 0 means all
//   types: limit to these question types (empty or missing means all)
//   unseen: put questions never answered before (ids in `seenIds`) first
export function pickQuestions(questions, { order = 'random', count = 0, types = null, unseen = false, seenIds = null, rng = Math.random } = {}) {
  let pool = types && types.length ? questions.filter(q => types.includes(q.type)) : questions.slice();
  pool = order === 'sequential' ? pool.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)) : shuffle(pool, rng);
  if (unseen && seenIds) {
    pool = [...pool.filter(q => !seenIds.has(q.id)), ...pool.filter(q => seenIds.has(q.id))];
  }
  if (count > 0) pool = pool.slice(0, count);
  return pool.map(q => q.id);
}

export function createSession({ id, kind = 'practice', title = '练习', bankIds = [], qids, optionOrder = {}, now }) {
  return { id, kind, title, bankIds, qids: qids.slice(), index: 0, answers: {}, optionOrder, startedAt: now, updatedAt: now, finishedAt: null };
}

export function recordAnswer(session, qid, response, correct, now) {
  const answers = { ...session.answers, [qid]: { response, correct, answeredAt: now } };
  const pos = session.qids.indexOf(qid);
  return { ...session, answers, index: Math.max(session.index, pos + 1), updatedAt: now };
}

export function firstUnanswered(session) {
  const i = session.qids.findIndex(qid => !(qid in session.answers));
  return i === -1 ? session.qids.length : i;
}

export function summarize(session) {
  const answered = Object.values(session.answers);
  const correct = answered.filter(a => a.correct === true).length;
  const end = session.finishedAt ?? session.updatedAt;
  return {
    total: session.qids.length,
    answered: answered.length,
    correct,
    wrong: answered.filter(a => a.correct === false).length,
    accuracy: answered.length ? correct / answered.length : null,
    durationMs: Math.max(0, end - session.startedAt),
    wrongIds: session.qids.filter(qid => session.answers[qid]?.correct === false)
  };
}

// Wrong-question book. A wrong answer adds the question (or bumps its count and resets its
// streak); a right answer on a question in the book adds to its streak, and `threshold`
// right answers in a row take it out. Returns { entry, change: 'added' | 'updated' | 'removed' | null }.
export function updateWrongEntry(entry, question, correct, response, now, threshold = 2) {
  if (correct === null || correct === undefined) return { entry: entry ?? null, change: null };
  if (!correct) {
    return {
      entry: {
        qid: question.id,
        bankId: question.bankId,
        wrongCount: (entry?.wrongCount ?? 0) + 1,
        correctStreak: 0,
        addedAt: entry?.addedAt ?? now,
        lastWrongAt: now,
        lastResponse: response ?? null,
        updatedAt: now
      },
      change: entry ? 'updated' : 'added'
    };
  }
  if (!entry) return { entry: null, change: null };
  const streak = (entry.correctStreak ?? 0) + 1;
  if (streak >= threshold) return { entry: null, change: 'removed' };
  return { entry: { ...entry, correctStreak: streak, updatedAt: now }, change: 'updated' };
}
