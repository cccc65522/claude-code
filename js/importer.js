// Turns question-bank files (JSON, CSV/TSV, or plain text copied from a document) into
// normalized questions, collecting a readable error for every item that cannot be used.
//
// Normalized question:
//   { type, stem, options: [{ key, text }], answer: [...], explanation, tags: [...] }
//   single / multiple: answer holds option letters, e.g. ['B'] or ['A', 'C']
//   judge:             options are T (正确) / F (错误), answer is ['T'] or ['F']
//   fill:              answer lists every accepted spelling, e.g. ['3.14', '3.140']
//   short:             answer holds the reference answer; the learner grades themself

import { parseCSV } from './csv.js';
import { normalizeAnswerText } from './util.js';

export const TYPES = ['single', 'multiple', 'judge', 'fill', 'short'];
export const TYPE_LABEL = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', short: '简答' };
export const JUDGE_OPTIONS = [{ key: 'T', text: '正确' }, { key: 'F', text: '错误' }];
const LETTERS = 'ABCDEFGH';

const TYPE_ALIASES = {
  single: ['single', 'singlechoice', 'radio', 'sc', '单选', '单项选择', '单选择'],
  multiple: ['multiple', 'multi', 'multiplechoice', 'checkbox', 'mc', '多选', '多项选择', '不定项', '不定项选择'],
  judge: ['judge', 'truefalse', 'tf', 'boolean', 'bool', '判断', '是非'],
  fill: ['fill', 'blank', 'fillblank', 'cloze', '填空'],
  short: ['short', 'essay', 'shortanswer', 'open', '简答', '问答', '主观', '论述', '名词解释']
};
const TRUE_WORDS = ['t', 'true', '对', '正确', '√', '✓', '✔', '是', 'yes', 'y', '1', 'right'];
const FALSE_WORDS = ['f', 'false', '错', '错误', '×', '✗', '✘', 'x', '否', 'no', 'n', '0', 'wrong'];

const FIELD_ALIASES = {
  type: ['type', 'qtype', '题型', '类型', '题目类型'],
  stem: ['stem', 'question', 'title', 'content', '题目', '题干', '问题', '试题', '题目内容'],
  options: ['options', 'choices', '选项'],
  answer: ['answer', 'answers', 'key', 'correct', '答案', '正确答案', '参考答案', '标准答案'],
  explanation: ['explanation', 'analysis', 'explain', 'note', '解析', '答案解析', '分析', '备注', '说明'],
  tags: ['tags', 'tag', 'category', '标签', '分类', '知识点', '章节']
};
const OPTION_COLUMN = /^(?:选项|option|opt|choice)?\s*[_\-\s]?\s*([A-Ha-h])$/i;

function canon(key) {
  return String(key).trim().toLowerCase().replace(/[\s_\-]/g, '');
}

export function normalizeType(value) {
  if (value == null || String(value).trim() === '') return null;
  const k = canon(value).replace(/题$/, '');
  for (const [type, names] of Object.entries(TYPE_ALIASES)) if (names.includes(k)) return type;
  return undefined;
}

export function judgeValue(value) {
  if (typeof value === 'boolean') return value;
  const s = String(value ?? '').normalize('NFKC').trim().toLowerCase();
  if (TRUE_WORDS.includes(s)) return true;
  if (FALSE_WORDS.includes(s)) return false;
  return null;
}

function fieldOf(header) {
  const k = canon(header);
  for (const [field, names] of Object.entries(FIELD_ALIASES)) if (names.map(canon).includes(k)) return field;
  const m = String(header).trim().match(OPTION_COLUMN);
  if (m) return 'option:' + m[1].toUpperCase();
  return null;
}

function pick(raw, field) {
  for (const key of Object.keys(raw)) if (fieldOf(key) === field) return raw[key];
  return undefined;
}

const OPTION_PREFIX = /^\s*([A-Ha-h])\s*[.．、:：)）]\s*/;

function optionTexts(raw) {
  if (raw == null || raw === '') return [];
  let list;
  if (typeof raw === 'string') list = raw.split(/\s*(?:[|｜]|\r?\n)\s*/);
  else if (Array.isArray(raw)) list = raw.map(o => (o && typeof o === 'object') ? (o.text ?? o.label ?? o.value ?? '') : o);
  else if (typeof raw === 'object') list = Object.keys(raw).sort().map(k => raw[k]);
  else list = [raw];
  return list.map((t, i) => {
    let s = String(t ?? '').trim();
    const m = s.match(OPTION_PREFIX);
    if (m && m[1].toUpperCase() === LETTERS[i]) s = s.slice(m[0].length).trim();
    return s;
  });
}

function buildOptions(texts) {
  let end = texts.length;
  while (end > 0 && texts[end - 1] === '') end--;
  const kept = texts.slice(0, end);
  if (kept.some(t => t === '')) throw new Error('选项中间有空白项，选项需要从 A 开始连续填写');
  if (kept.length > LETTERS.length) throw new Error(`最多支持 ${LETTERS.length} 个选项（A–H）`);
  return kept.map((text, i) => ({ key: LETTERS[i], text }));
}

function choiceAnswer(raw, options) {
  const parts = Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')];
  const joined = parts.join(',').normalize('NFKC').trim();
  if (!joined) throw new Error('缺少答案');
  const compact = joined.toUpperCase().replace(/[\s,，、;；/|和及]+/g, '');
  let letters;
  if (/^[A-H]+$/.test(compact)) {
    letters = [...new Set(compact.split(''))];
  } else {
    // The answer may be written as the option's text instead of its letter.
    const hit = options.find(o => normalizeAnswerText(o.text) === normalizeAnswerText(joined));
    if (!hit) throw new Error(`答案“${joined}”不是选项字母，也和任何选项内容对不上`);
    letters = [hit.key];
  }
  for (const l of letters) {
    if (!options.some(o => o.key === l)) throw new Error(`答案 ${l} 超出了选项范围（只有 ${options.map(o => o.key).join('')}）`);
  }
  return letters.sort();
}

function listOf(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(s => String(s).trim()).filter(Boolean);
  return String(raw).split(/\s*[,，、;；|｜]\s*/).map(s => s.trim()).filter(Boolean);
}

// Accepts a loosely shaped object (JSON item, CSV row, parsed text block) and returns a
// normalized question, or throws an Error whose message says what to fix.
export function normalizeQuestion(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('不是有效的题目对象');
  const stem = String(pick(raw, 'stem') ?? '').trim();
  if (!stem) throw new Error('缺少题目内容');

  const typeRaw = pick(raw, 'type');
  let type = normalizeType(typeRaw);
  if (type === undefined) throw new Error(`不认识的题型“${typeRaw}”，可用：单选、多选、判断、填空、简答`);

  let texts = optionTexts(pick(raw, 'options'));
  if (!texts.length) {
    const cols = Object.keys(raw)
      .map(k => [fieldOf(k), raw[k]])
      .filter(([f]) => f && f.startsWith('option:'))
      .sort((a, b) => a[0].localeCompare(b[0]));
    if (cols.length) {
      const byLetter = Object.fromEntries(cols.map(([f, v]) => [f.slice(7), String(v ?? '').trim()]));
      const last = Math.max(...cols.map(([f]) => LETTERS.indexOf(f.slice(7))));
      texts = LETTERS.slice(0, last + 1).split('').map(l => byLetter[l] ?? '');
    }
  }
  let options = buildOptions(texts);
  const answerRaw = pick(raw, 'answer');
  const answerEmpty = answerRaw == null || (Array.isArray(answerRaw) ? !answerRaw.length : String(answerRaw).trim() === '');

  if (!type) {
    if (options.length >= 2) {
      type = choiceAnswer(answerRaw, options).length > 1 ? 'multiple' : 'single';
    } else if (judgeValue(Array.isArray(answerRaw) ? answerRaw[0] : answerRaw) !== null) {
      type = 'judge';
    } else {
      type = String(answerRaw ?? '').trim().length > 40 ? 'short' : 'fill';
    }
  }

  let answer;
  if (type === 'single' || type === 'multiple') {
    if (options.length < 2) throw new Error(`${TYPE_LABEL[type]}题至少需要 2 个选项`);
    answer = choiceAnswer(answerRaw, options);
    if (type === 'single' && answer.length > 1) throw new Error(`单选题只能有一个答案（现在是 ${answer.join('')}），多个答案请把题型写成“多选”`);
  } else if (type === 'judge') {
    let v = judgeValue(Array.isArray(answerRaw) ? answerRaw[0] : answerRaw);
    if (v === null && options.length) {
      // e.g. options "A. 正确 / B. 错误" with answer "A"
      try {
        const [letter] = choiceAnswer(answerRaw, options);
        v = judgeValue(options.find(o => o.key === letter).text);
      } catch { v = null; }
    }
    if (v === null) throw new Error(`判断题答案“${answerEmpty ? '' : answerRaw}”无法识别，请写 对/错、正确/错误、√/× 或 T/F`);
    options = JUDGE_OPTIONS.map(o => ({ ...o }));
    answer = [v ? 'T' : 'F'];
  } else if (type === 'fill') {
    if (answerEmpty) throw new Error('填空题缺少答案');
    const list = Array.isArray(answerRaw) ? answerRaw : String(answerRaw).split(/\s*[|｜]\s*/);
    answer = list.map(s => String(s).trim()).filter(Boolean);
    options = [];
  } else {
    if (answerEmpty) throw new Error('简答题缺少参考答案');
    answer = [Array.isArray(answerRaw) ? answerRaw.join('\n') : String(answerRaw).trim()];
    options = [];
  }

  return {
    type,
    stem,
    options,
    answer,
    explanation: String(pick(raw, 'explanation') ?? '').trim(),
    tags: listOf(pick(raw, 'tags'))
  };
}

export function dedupeKey(q) {
  return [q.type, normalizeAnswerText(q.stem), ...q.options.map(o => normalizeAnswerText(o.text))].join('\u0001');
}

// ---------------------------------------------------------------- decoding

// Excel on Chinese Windows saves "CSV" as GB18030/GBK; everything else is usually UTF-8.
export function decodeBytes(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    try { return new TextDecoder('gb18030').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
  }
}

// ---------------------------------------------------------------- formats

export function detectFormat(text, filename = '') {
  const ext = (filename.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (ext === 'json') return 'json';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  const t = text.replace(/^﻿/, '').trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  const first = parseCSV(t.split(/\r?\n/, 1)[0] || '')[0];
  if (first && first.cells.length >= 2 && first.cells.some(c => fieldOf(c) === 'stem')) return 'csv';
  return 'text';
}

function parseJSONItems(text) {
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`JSON 格式有误：${e.message}`);
  }
  if (data && data.schema === 'review-app-backup') throw new Error('这是整份数据备份，请到“数据”页用“恢复数据”导入');
  let items = data;
  let bankName = '';
  if (!Array.isArray(data)) {
    if (!data || typeof data !== 'object') throw new Error('JSON 里需要是题目数组，或带 questions 数组的对象');
    items = data.questions || data.items || data.data;
    bankName = String(data.name || data.title || data.bank || '').trim();
    if (!Array.isArray(items)) throw new Error('JSON 对象里没有找到 questions 数组');
  }
  return { bankName, items: items.map((raw, i) => ({ raw, where: `第 ${i + 1} 题` })) };
}

function parseCSVItems(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('文件是空的');
  const header = rows[0].cells.map(c => c.trim());
  const fields = header.map(fieldOf);
  if (!fields.includes('stem')) throw new Error('第一行需要是表头，并包含“题目”列（也可以叫 题干 / question）');
  if (!fields.includes('answer')) throw new Error('表头里缺少“答案”列');
  return {
    bankName: '',
    items: rows.slice(1).map(r => {
      const raw = {};
      header.forEach((h, i) => { if (fields[i]) raw[h] = r.cells[i] ?? ''; });
      return { raw, where: `第 ${r.line} 行` };
    })
  };
}

const NUMBERED = /^\s*(\d{1,4})\s*[.．、)）](?!\d)\s*/;
const TYPE_TAG = /^[【\[(（]\s*(单选|单项选择|多选|多项选择|不定项选择?|判断|填空|简答|问答)题?\s*[】\])）]\s*/;
const SECTION = /^[一二三四五六七八九十]+\s*[、.．]\s*(单项选择|单选|多项选择|多选|不定项选择?|判断|填空|简答|问答)/;
const LABEL = (words) => new RegExp(`^(?:【\\s*(?:${words})\\s*】|\\[\\s*(?:${words})\\s*\\]|(?:${words})\\s*[:：])\\s*`);
const ANSWER_LINE = LABEL('正确答案|参考答案|答案');
const EXPLAIN_LINE = LABEL('答案解析|解析|分析');
const TAGS_LINE = LABEL('标签|知识点');
const TYPE_LINE = LABEL('题型');
const OPTION_LINE = /^([A-Ha-h])\s*[.．、:：)）]\s*(.*)$/;

function splitInlineOptions(line) {
  // "A. 北京  B. 上海  C. 广州" -> three options
  const marks = [];
  const re = /(^|\s)([A-H])\s*[.．、:：)）]/g;
  let m;
  while ((m = re.exec(line))) marks.push({ letter: m[2], at: m.index + m[1].length, body: m.index + m[0].length });
  const seq = [];
  for (const mk of marks) {
    const expect = seq.length ? String.fromCharCode(seq[seq.length - 1].letter.charCodeAt(0) + 1) : marks[0].letter;
    if (mk.letter === expect) seq.push(mk);
  }
  if (seq.length < 2) return null;
  return seq.map((mk, i) => ({ letter: mk.letter, text: line.slice(mk.body, i + 1 < seq.length ? seq[i + 1].at : undefined).trim() }));
}

function parseTextItems(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  // Numbered documents ("1. ...", "2、...") are split on the numbers; otherwise on blank lines.
  const numbered = lines.some(l => NUMBERED.test(l));
  const blocks = [];
  let cur = null;
  let sectionType = null;
  const open = (lineNo, num) => {
    cur = { start: lineNo, lines: [], type: sectionType, num, answered: false, explaining: false };
    blocks.push(cur);
  };

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const t = rawLine.trim();
    const sec = t.match(SECTION);
    if (sec && !ANSWER_LINE.test(t)) { sectionType = normalizeType(sec[1]); cur = null; return; }
    if (!t) { if (!numbered) cur = null; return; }
    if (numbered) {
      const n = t.match(NUMBERED);
      if (n) {
        const num = Number(n[1]);
        // A smaller number inside a question is usually a numbered point in its stem or
        // explanation; it starts a new question only after a finished, unexplained answer.
        const next = !cur || cur.num == null || num > cur.num || (cur.answered && !cur.explaining);
        if (next) open(lineNo, num);
      } else if (TYPE_TAG.test(t)) {
        open(lineNo, cur ? cur.num : null);
      } else if (!cur) {
        return; // a title or note before the first question
      }
    } else if (!cur) {
      open(lineNo, null);
    }
    if (ANSWER_LINE.test(t)) cur.answered = true;
    if (EXPLAIN_LINE.test(t)) cur.explaining = true;
    cur.lines.push(t);
  });

  return {
    bankName: '',
    items: blocks.map(b => {
      const raw = { type: b.type || '', stem: '', options: [], answer: '', explanation: '', tags: '' };
      const stem = [];
      const explanation = [];
      const answer = [];
      let field = 'stem';
      b.lines.forEach((line, idx) => {
        let l = line;
        if (idx === 0) {
          l = l.replace(NUMBERED, '');
          const tag = l.match(TYPE_TAG);
          if (tag) { raw.type = normalizeType(tag[1]); l = l.slice(tag[0].length); }
        }
        let m;
        if ((m = l.match(ANSWER_LINE))) { field = 'answer'; answer.push(l.slice(m[0].length)); return; }
        if ((m = l.match(EXPLAIN_LINE))) { field = 'explanation'; explanation.push(l.slice(m[0].length)); return; }
        if ((m = l.match(TAGS_LINE))) { raw.tags = l.slice(m[0].length); return; }
        if ((m = l.match(TYPE_LINE))) { raw.type = normalizeType(l.slice(m[0].length)) ?? l.slice(m[0].length); return; }
        if (field === 'stem' || field === 'option') {
          const inline = splitInlineOptions(l);
          const single = l.match(OPTION_LINE);
          if (inline && inline[0].letter === String.fromCharCode(65 + raw.options.length)) {
            inline.forEach(o => raw.options.push(o.text)); field = 'option'; return;
          }
          if (single && single[1].toUpperCase() === String.fromCharCode(65 + raw.options.length)) {
            raw.options.push(single[2].trim()); field = 'option'; return;
          }
        }
        if (field === 'stem') stem.push(l);
        else if (field === 'option') raw.options[raw.options.length - 1] += '\n' + l;
        else if (field === 'answer') answer.push(l);
        else explanation.push(l);
      });
      raw.stem = stem.join('\n').trim();
      raw.answer = answer.join('\n').trim();
      raw.explanation = explanation.join('\n').trim();
      if (!raw.type) delete raw.type;
      return { raw, where: `第 ${b.start} 行开始的题目` };
    })
  };
}

// Main entry: returns { format, bankName, questions, errors: [{ where, message }], duplicates }.
export function parseImport(text, filename = '') {
  const format = detectFormat(text, filename);
  let parsed;
  try {
    parsed = format === 'json' ? parseJSONItems(text) : format === 'csv' ? parseCSVItems(text) : parseTextItems(text);
  } catch (e) {
    return { format, bankName: '', questions: [], errors: [{ where: '整个文件', message: e.message }], duplicates: 0 };
  }
  const questions = [];
  const errors = [];
  const seen = new Set();
  let duplicates = 0;
  for (const { raw, where } of parsed.items) {
    try {
      const q = normalizeQuestion(raw);
      const key = dedupeKey(q);
      if (seen.has(key)) { duplicates++; continue; }
      seen.add(key);
      questions.push(q);
    } catch (e) {
      errors.push({ where, message: e.message });
    }
  }
  if (!parsed.items.length) errors.push({ where: '整个文件', message: '没有找到题目' });
  const fromName = filename.replace(/\.[^.]+$/, '').trim();
  return { format, bankName: parsed.bankName || fromName, questions, errors, duplicates };
}
