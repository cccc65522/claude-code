// Study-record summaries computed from answer attempts. Pure functions.

import { addDays, dateKey } from './util.js';

export function overview(attempts, now) {
  const today = dateKey(now);
  let correct = 0, todayTotal = 0, todayCorrect = 0;
  const days = new Set();
  for (const a of attempts) {
    const key = dateKey(a.answeredAt);
    days.add(key);
    if (a.correct) correct++;
    if (key === today) { todayTotal++; if (a.correct) todayCorrect++; }
  }
  return {
    total: attempts.length,
    correct,
    accuracy: attempts.length ? correct / attempts.length : null,
    todayTotal,
    todayCorrect,
    todayAccuracy: todayTotal ? todayCorrect / todayTotal : null,
    activeDays: days.size,
    streak: streakFrom(days, today)
  };
}

// Consecutive study days ending today, or ending yesterday if nothing has been done today yet.
export function streak(attempts, now) {
  return streakFrom(new Set(attempts.map(a => dateKey(a.answeredAt))), dateKey(now));
}

function streakFrom(days, today) {
  let key = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(key)) { n++; key = addDays(key, -1); }
  return n;
}

// The last `days` calendar days, oldest first.
export function daily(attempts, days, now) {
  const today = dateKey(now);
  const out = [];
  const index = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const row = { date, total: 0, correct: 0 };
    index.set(date, row);
    out.push(row);
  }
  for (const a of attempts) {
    const row = index.get(dateKey(a.answeredAt));
    if (row) { row.total++; if (a.correct) row.correct++; }
  }
  return out;
}

// Per question: how often it was answered, how often right, and whether the latest try was right.
export function questionStats(attempts) {
  const map = new Map();
  for (const a of attempts) {
    let s = map.get(a.qid);
    if (!s) { s = { count: 0, correct: 0, lastAt: 0, lastCorrect: null }; map.set(a.qid, s); }
    s.count++;
    if (a.correct) s.correct++;
    if (a.answeredAt >= s.lastAt) { s.lastAt = a.answeredAt; s.lastCorrect = a.correct; }
  }
  return map;
}

// Per bank: question count, how many have been tried, how many were right on the latest try,
// and accuracy over all attempts on questions that still exist.
export function bankStats(banks, questions, attempts) {
  const qs = questionStats(attempts);
  return banks.map(bank => {
    const list = questions.filter(q => q.bankId === bank.id);
    let seen = 0, latestRight = 0, tries = 0, right = 0;
    for (const q of list) {
      const s = qs.get(q.id);
      if (!s) continue;
      seen++;
      if (s.lastCorrect) latestRight++;
      tries += s.count;
      right += s.correct;
    }
    return { bankId: bank.id, name: bank.name, total: list.length, seen, latestRight, tries, accuracy: tries ? right / tries : null };
  });
}
