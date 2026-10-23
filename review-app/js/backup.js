// Whole-app backup files: building, checking and merging. Pure functions.

import { TYPES } from './importer.js';

export const BACKUP_SCHEMA = 'review-app-backup';
export const BACKUP_VERSION = 1;
export const DATA_KEYS = ['banks', 'questions', 'attempts', 'sessions', 'wrong'];

export function buildBackup(data, now) {
  const out = { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), counts: {}, data: {} };
  for (const k of DATA_KEYS) {
    out.data[k] = data[k] ?? [];
    out.counts[k] = out.data[k].length;
  }
  out.data.settings = data.settings ?? {};
  return out;
}

const isStr = v => typeof v === 'string' && v.length > 0;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const CHECKS = {
  banks: b => isStr(b.id) && typeof b.name === 'string',
  questions: q => isStr(q.id) && isStr(q.bankId) && TYPES.includes(q.type) && isStr(q.stem) && Array.isArray(q.answer) && Array.isArray(q.options),
  attempts: a => isStr(a.id) && isStr(a.qid) && isNum(a.answeredAt) && typeof a.correct === 'boolean',
  sessions: s => isStr(s.id) && Array.isArray(s.qids) && s.answers && typeof s.answers === 'object' && isNum(s.startedAt),
  wrong: w => isStr(w.qid) && isNum(w.wrongCount)
};
const LABELS = { banks: '题库', questions: '题目', attempts: '答题记录', sessions: '练习记录', wrong: '错题' };

// Returns { ok, errors, warnings, data } where data only keeps records that pass the checks
// and still point at an existing bank / question.
export function validateBackup(obj) {
  const errors = [];
  const warnings = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['文件内容不是备份对象'], warnings, data: null };
  if (obj.schema !== BACKUP_SCHEMA) return { ok: false, errors: ['这不是本应用导出的备份文件（如果是题库文件，请到“题库”页导入）'], warnings, data: null };
  if (!isNum(obj.version) || obj.version > BACKUP_VERSION) return { ok: false, errors: [`备份文件版本 ${obj.version} 比当前应用新，请先更新应用`], warnings, data: null };
  const src = obj.data && typeof obj.data === 'object' ? obj.data : null;
  if (!src) return { ok: false, errors: ['备份文件里没有 data 部分'], warnings, data: null };

  const data = {};
  for (const k of DATA_KEYS) {
    const list = src[k] == null ? [] : src[k];
    if (!Array.isArray(list)) { errors.push(`${LABELS[k]}部分格式不对`); continue; }
    data[k] = list.filter(item => item && typeof item === 'object' && CHECKS[k](item));
    const dropped = list.length - data[k].length;
    if (dropped) warnings.push(`跳过了 ${dropped} 条格式不对的${LABELS[k]}`);
  }
  if (errors.length) return { ok: false, errors, warnings, data: null };

  const bankIds = new Set(data.banks.map(b => b.id));
  const orphanQ = data.questions.filter(q => !bankIds.has(q.bankId)).length;
  if (orphanQ) {
    data.questions = data.questions.filter(q => bankIds.has(q.bankId));
    warnings.push(`跳过了 ${orphanQ} 道找不到所属题库的题目`);
  }
  const qids = new Set(data.questions.map(q => q.id));
  const orphanW = data.wrong.filter(w => !qids.has(w.qid)).length;
  if (orphanW) {
    data.wrong = data.wrong.filter(w => qids.has(w.qid));
    warnings.push(`跳过了 ${orphanW} 条找不到题目的错题`);
  }
  data.settings = src.settings && typeof src.settings === 'object' && !Array.isArray(src.settings) ? src.settings : {};
  return { ok: true, errors, warnings, data };
}

function stamp(r) {
  return r.updatedAt ?? r.finishedAt ?? r.createdAt ?? r.startedAt ?? r.answeredAt ?? 0;
}

function unionBy(current, incoming, key) {
  const map = new Map(current.map(r => [r[key], r]));
  for (const r of incoming) {
    const old = map.get(r[key]);
    if (!old || stamp(r) > stamp(old)) map.set(r[key], r);
  }
  return [...map.values()];
}

// Merge keeps everything from both sides; when the same record exists in both, the newer one wins.
// The current device's settings are kept.
export function mergeData(current, incoming) {
  return {
    banks: unionBy(current.banks, incoming.banks, 'id'),
    questions: unionBy(current.questions, incoming.questions, 'id'),
    attempts: unionBy(current.attempts, incoming.attempts, 'id'),
    sessions: unionBy(current.sessions, incoming.sessions, 'id'),
    wrong: unionBy(current.wrong, incoming.wrong, 'qid'),
    settings: { ...incoming.settings, ...current.settings }
  };
}
