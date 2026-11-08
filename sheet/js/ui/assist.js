// Pure helpers behind the formula editor and keyboard navigation (unit-tested).

import { tokenize } from '../engine/lexer.js';
import { FUNCTIONS, FUNCTION_NAMES } from '../engine/functions.js';
import { formatAddress, quoteSheetName } from '../engine/address.js';

const IDENT_CH = /[A-Za-z0-9_.一-鿿]/;
const REF_BEFORE = new Set(['=', '(', ',', ';', '+', '-', '*', '/', '^', '&', '<', '>', ':']);

// What the caret is in, for a formula text that starts with "=".
//   call: innermost function call around the caret and which argument it's in
//   prefix: identifier being typed right before the caret (function autocomplete)
//   canInsertRef: clicking a cell now should insert its address
export function formulaContext(text, caret) {
  if (!text.startsWith('=')) return { call: null, prefix: null, canInsertRef: false };
  const stack = [];
  let inString = false;
  let i = 1;
  while (i < caret) {
    const ch = text[i];
    if (inString) {
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') { inString = true; i++; continue; }
    if (ch === "'") {
      // quoted sheet name
      const j = text.indexOf("'", i + 1);
      i = j < 0 || j >= caret ? caret : j + 1;
      continue;
    }
    if (/[A-Za-z_一-鿿]/.test(ch)) {
      let j = i;
      while (j < text.length && IDENT_CH.test(text[j])) j++;
      let k = j;
      while (k < text.length && text[k] === ' ') k++;
      if (text[k] === '(' && k < caret) {
        stack.push({ name: text.slice(i, j).toUpperCase(), argIndex: 0 });
        i = k + 1;
        continue;
      }
      i = j;
      continue;
    }
    if (ch === '(') stack.push({ name: null, argIndex: 0 });
    else if (ch === ')') stack.pop();
    else if ((ch === ',' || ch === ';') && stack.length) stack[stack.length - 1].argIndex++;
    i++;
  }
  if (inString) return { call: innermostCall(stack), prefix: null, canInsertRef: false };

  let p = caret;
  while (p > 1 && IDENT_CH.test(text[p - 1])) p--;
  let prefix = null;
  if (p < caret && /[A-Za-z_一-鿿]/.test(text[p])) {
    const before = text.slice(0, p).trimEnd();
    const last = before[before.length - 1];
    if (REF_BEFORE.has(last) || before === '=') prefix = { from: p, to: caret, text: text.slice(p, caret) };
  }
  const before = text.slice(0, caret).trimEnd();
  const canInsertRef = REF_BEFORE.has(before[before.length - 1]);
  return { call: innermostCall(stack), prefix, canInsertRef };
}

function innermostCall(stack) {
  for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name) return stack[k];
  return null;
}

// Everyday functions first, so "su" offers SUM before SUBSTITUTE.
const POPULAR = [
  'SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'AVERAGE', 'AVERAGEIF', 'COUNT', 'COUNTA', 'COUNTIF', 'COUNTIFS',
  'IF', 'IFS', 'IFERROR', 'VLOOKUP', 'XLOOKUP', 'INDEX', 'MATCH', 'MAX', 'MIN', 'ROUND', 'TEXT', 'TODAY',
  'NOW', 'DATE', 'LEFT', 'RIGHT', 'MID', 'LEN', 'AND', 'OR', 'CONCAT', 'TEXTJOIN', 'RANK', 'ABS', 'YEAR',
  'MONTH', 'DAY', 'DATEDIF', 'TRIM', 'SUBSTITUTE', 'FIND', 'VALUE', 'INT', 'MOD', 'MEDIAN', 'LARGE', 'SMALL'
];
const POP_RANK = new Map(POPULAR.map((n, i) => [n, i]));
const rank = n => POP_RANK.get(n) ?? 1000 + n.length;

// Functions whose name starts with the typed prefix (then those containing it).
export function suggestFunctions(prefix, limit = 8) {
  const p = prefix.toUpperCase();
  if (!p) return [];
  const byRank = (a, b) => (a === p ? -1 : b === p ? 1 : rank(a) - rank(b) || a.localeCompare(b));
  const starts = FUNCTION_NAMES.filter(n => n.startsWith(p)).sort(byRank);
  const contains = FUNCTION_NAMES.filter(n => !n.startsWith(p) && n.includes(p)).sort(byRank);
  return [...starts, ...contains].slice(0, limit).map(n => FUNCTIONS[n]);
}

// Split "SUMIF(条件区域, 条件, [求和区域])" into name and parameter labels.
export function syntaxParts(syntax) {
  const open = syntax.indexOf('(');
  const name = syntax.slice(0, open);
  const inner = syntax.slice(open + 1, syntax.lastIndexOf(')'));
  const params = inner ? inner.split(/,\s*/) : [];
  return { name, params };
}

// Which parameter label to highlight for argument `argIndex` (repeating "…" tails).
export function activeParam(params, argIndex) {
  if (!params.length) return -1;
  if (argIndex < params.length && params[argIndex] !== '…') return argIndex;
  const ell = params.indexOf('…');
  if (ell > 0) {
    // "数值1, [数值2], …": arguments past the list map onto the last named one
    return ell - 1;
  }
  return params.length - 1;
}

const REF_AT = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/y;

// F4: cycle A1 -> $A$1 -> A$1 -> $A1 -> A1 for the reference at the caret, or else the
// nearest one before it (like Excel).
export function toggleAbsolute(text, caret) {
  const spans = refSpans(text);
  const at = spans.find(s => caret >= s.from && caret <= s.to) || spans.filter(s => s.to <= caret).pop();
  for (const span of at ? [at] : []) {
    // Within a range, toggle the endpoint the caret is on (or the end if it sits after the range).
    const part = text.slice(span.from, span.to);
    const bang = part.lastIndexOf('!');
    const base = bang < 0 ? span.from : span.from + bang + 1;
    const colon = text.indexOf(':', base);
    const pieces = colon > 0 && colon < span.to ? [[base, colon], [colon + 1, span.to]] : [[base, span.to]];
    const [a, b] = pieces.find(([x, y]) => caret >= x && caret <= y) || pieces[pieces.length - 1];
    REF_AT.lastIndex = a;
    const m = REF_AT.exec(text);
    if (!m || m.index !== a || a + m[0].length !== b) return { text, caret };
    const state = (m[1] ? 2 : 0) + (m[3] ? 1 : 0); // 0 A1, 3 $A$1, 1 A$1, 2 $A1
    const next = { 0: 3, 3: 1, 1: 2, 2: 0 }[state];
    const rep = `${next & 2 ? '$' : ''}${m[2]}${next & 1 ? '$' : ''}${m[4]}`;
    const out = text.slice(0, a) + rep + text.slice(b);
    const delta = rep.length - (b - a);
    return { text: out, caret: Math.max(caret, b) + delta };
  }
  return { text, caret };
}

// Reference tokens in a formula text ("=..."), with offsets into the text.
// Tolerates an unfinished formula by tokenizing up to the first lexical error.
export function refSpans(text) {
  if (!text.startsWith('=')) return [];
  let src = text.slice(1);
  let tokens;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      tokens = tokenize(src);
      break;
    } catch (e) {
      if (typeof e.pos !== 'number' || e.pos >= src.length) return [];
      src = src.slice(0, e.pos);
    }
  }
  if (!tokens) return [];
  return tokens.filter(t => t.type === 'ref' || t.type === 'range').map(t => ({
    from: t.from + 1,
    to: t.to + 1,
    sheet: t.sheet,
    range: t.type === 'ref'
      ? { r1: t.row, c1: t.col, r2: t.row, c2: t.col }
      : {
          r1: Math.min(t.start.row, t.end.row), c1: Math.min(t.start.col, t.end.col),
          r2: Math.max(t.start.row, t.end.row), c2: Math.max(t.start.col, t.end.col)
        },
    kind: t.type === 'range' ? t.kind : 'cell'
  }));
}

export const REF_COLORS = ['#1a73e8', '#d93025', '#7c3aed', '#188038', '#e37400', '#0891b2', '#c026d3', '#5f6368'];

// Same reference text gets the same colour, in order of first appearance.
export function colorRefs(text) {
  const spans = refSpans(text);
  const seen = new Map();
  return spans.map(s => {
    const key = text.slice(s.from, s.to).replace(/\$/g, '').toUpperCase();
    if (!seen.has(key)) seen.set(key, REF_COLORS[seen.size % REF_COLORS.length]);
    return { ...s, color: seen.get(key) };
  });
}

// Address text to insert when pointing at cells while editing.
export function refText(range, sheetName = null) {
  const prefix = sheetName ? `${quoteSheetName(sheetName)}!` : '';
  const a = formatAddress(range.r1, range.c1);
  if (range.r1 === range.r2 && range.c1 === range.c2) return prefix + a;
  return `${prefix}${a}:${formatAddress(range.r2, range.c2)}`;
}

// Ctrl+Arrow: jump to the edge of the current block of data, or to the next data.
export function findEdge(hasData, r, c, dr, dc, maxR, maxC) {
  const inside = (y, x) => y >= 0 && x >= 0 && y <= maxR && x <= maxC;
  let y = r + dr, x = c + dc;
  if (!inside(y, x)) return { r, c };
  if (hasData(r, c) && hasData(y, x)) {
    while (inside(y + dr, x + dc) && hasData(y + dr, x + dc)) { y += dr; x += dc; }
    return { r: y, c: x };
  }
  while (inside(y, x) && !hasData(y, x)) { y += dr; x += dc; }
  if (!inside(y, x)) return { r: Math.max(0, Math.min(maxR, y - dr)), c: Math.max(0, Math.min(maxC, x - dc)) };
  return { r: y, c: x };
}

// AutoSum: the contiguous numbers directly above (or else to the left of) a cell.
export function autoSumRange(isNumber, r, c) {
  let top = r - 1;
  if (top >= 0 && isNumber(top, c)) {
    while (top - 1 >= 0 && isNumber(top - 1, c)) top--;
    return { r1: top, c1: c, r2: r - 1, c2: c };
  }
  let left = c - 1;
  if (left >= 0 && isNumber(r, left)) {
    while (left - 1 >= 0 && isNumber(r, left - 1)) left--;
    return { r1: r, c1: left, r2: r, c2: c - 1 };
  }
  return null;
}
