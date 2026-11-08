// Excel-style number format strings: "0.00", "#,##0", "0%", "¥#,##0.00;[Red]-¥#,##0.00",
// "yyyy-mm-dd hh:mm", "0.00E+00", "@" ... Used for cell display and for TEXT().

import { formatGeneralNumber, isError } from './values.js';
import { serialToParts } from './dates.js';

const cache = new Map();

const COLORS = {
  red: '#d93025', blue: '#1a73e8', green: '#188038', black: null, white: '#ffffff',
  magenta: '#c026d3', cyan: '#0891b2', yellow: '#ca8a04'
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CN_DAYS = ['日', '一', '二', '三', '四', '五', '六'];

// Split into sections on ';' that are not inside quotes or escaped.
function splitSections(fmt) {
  const out = [];
  let cur = '';
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') {
      const j = fmt.indexOf('"', i + 1);
      const end = j < 0 ? fmt.length : j;
      cur += fmt.slice(i, end + 1);
      i = end;
    } else if (ch === '\\') {
      cur += fmt.slice(i, i + 2);
      i++;
    } else if (ch === ';') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// Tokenise one section.
function tokenizeSection(src) {
  const tokens = [];
  let color = null;
  let condition = null;
  let i = 0;
  const lit = text => {
    const last = tokens[tokens.length - 1];
    if (last && last.t === 'lit') last.v += text;
    else tokens.push({ t: 'lit', v: text });
  };
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    let m;
    if (ch === '"') {
      const j = src.indexOf('"', i + 1);
      const end = j < 0 ? src.length : j;
      lit(src.slice(i + 1, end));
      i = end + 1;
    } else if (ch === '\\') {
      lit(src[i + 1] ?? '');
      i += 2;
    } else if (ch === '_') {
      lit(' ');
      i += 2;
    } else if (ch === '*') {
      i += 2; // fill character: ignored
    } else if ((m = /^\[([^\]]*)\]/.exec(rest))) {
      const inner = m[1];
      const lower = inner.toLowerCase();
      if (lower in COLORS) color = COLORS[lower];
      else if (/^[<>=]/.test(inner)) {
        const c = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(inner);
        if (c) condition = { op: c[1], value: Number(c[2]) };
      } else if (/^(h+|m+|s+)$/i.test(inner)) tokens.push({ t: 'elapsed', v: lower });
      // [$-804] locale tags and anything else are ignored.
      i += m[0].length;
    } else if ((m = /^(AM\/PM|A\/P|上午\/下午)/i.exec(rest))) {
      tokens.push({ t: 'ampm', v: m[1] });
      i += m[0].length;
    } else if ((m = /^(y+|m+|d+|h+|s+|a{3,4})/i.exec(rest))) {
      tokens.push({ t: 'date', v: m[1].toLowerCase() });
      i += m[0].length;
    } else if ((m = /^[eE][+-]/.exec(rest))) {
      tokens.push({ t: 'exp', v: m[0][1] });
      i += 2;
    } else if ('0#?'.includes(ch)) {
      tokens.push({ t: 'digit', v: ch });
      i++;
    } else if (ch === '.') {
      tokens.push({ t: 'point' });
      i++;
    } else if (ch === ',') {
      tokens.push({ t: 'comma' });
      i++;
    } else if (ch === '%') {
      tokens.push({ t: 'percent' });
      lit('%');
      i++;
    } else if (ch === '@') {
      tokens.push({ t: 'text' });
      i++;
    } else {
      lit(ch);
      i++;
    }
  }
  // "m" right after an hour or right before a second means minutes.
  const dateIdx = tokens.map((t, k) => (t.t === 'date' || t.t === 'elapsed' ? k : -1)).filter(k => k >= 0);
  dateIdx.forEach((k, n) => {
    const t = tokens[k];
    if (t.t !== 'date' || t.v[0] !== 'm' || t.v.length > 2) return;
    const prev = dateIdx[n - 1] !== undefined ? tokens[dateIdx[n - 1]] : null;
    const next = dateIdx[n + 1] !== undefined ? tokens[dateIdx[n + 1]] : null;
    if ((prev && /^h|^\[?h/.test(prev.v)) || (next && /^s/.test(next.v))) t.v = t.v === 'm' ? 'M' : 'MM';
  });
  const isDate = tokens.some(t => t.t === 'date' || t.t === 'ampm' || t.t === 'elapsed');
  const isText = tokens.some(t => t.t === 'text');
  return { tokens, color, condition, isDate, isText };
}

export function compileFormat(fmt) {
  let compiled = cache.get(fmt);
  if (compiled) return compiled;
  if (!fmt || /^general$/i.test(fmt) || fmt === '常规') {
    compiled = { general: true, sections: [] };
  } else {
    compiled = { general: false, sections: splitSections(fmt).map(tokenizeSection) };
  }
  cache.set(fmt, compiled);
  return compiled;
}

export function isDateFormat(fmt) {
  const c = compileFormat(fmt);
  return !c.general && c.sections[0]?.isDate;
}

function pickSection(sections, n) {
  const withCond = sections.filter(s => s.condition);
  if (withCond.length) {
    for (const s of sections) {
      if (!s.condition) return { section: s, abs: false };
      const { op, value } = s.condition;
      const ok = op === '<' ? n < value : op === '>' ? n > value : op === '=' ? n === value
        : op === '<=' ? n <= value : op === '>=' ? n >= value : n !== value;
      if (ok) return { section: s, abs: n < 0 };
    }
    return { section: sections[sections.length - 1], abs: false };
  }
  const numeric = sections.filter(s => !s.isText || s.tokens.some(t => t.t === 'digit'));
  if (n < 0 && numeric.length >= 2) return { section: numeric[1], abs: true };
  if (n === 0 && numeric.length >= 3) return { section: numeric[2], abs: true };
  return { section: numeric[0] || sections[0], abs: false };
}

function groupThousands(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatNumberSection(section, n) {
  const { tokens } = section;
  if (section.isDate) return formatDate(tokens, n);

  const percents = tokens.filter(t => t.t === 'percent').length;
  let value = n * 100 ** percents;

  const expIdx = tokens.findIndex(t => t.t === 'exp');
  const mantTokens = expIdx >= 0 ? tokens.slice(0, expIdx) : tokens;
  const pointIdx = mantTokens.findIndex(t => t.t === 'point');
  const intTokens = pointIdx >= 0 ? mantTokens.slice(0, pointIdx) : mantTokens;
  const fracTokens = pointIdx >= 0 ? mantTokens.slice(pointIdx + 1) : [];
  const intDigits = intTokens.filter(t => t.t === 'digit');
  const fracDigits = fracTokens.filter(t => t.t === 'digit');

  // Trailing commas right after the last integer digit scale by 1000 each ("#,##0,").
  let scale = 0;
  const lastDigit = intTokens.map(t => t.t).lastIndexOf('digit');
  for (let k = lastDigit + 1; k < intTokens.length && intTokens[k].t === 'comma'; k++) scale++;
  value /= 1000 ** scale;
  const thousands = intTokens.some((t, k) => t.t === 'comma' && intTokens.slice(0, k).some(x => x.t === 'digit') && intTokens.slice(k + 1).some(x => x.t === 'digit'));

  let exponent = 0;
  let expText = '';
  if (expIdx >= 0) {
    if (value !== 0) {
      const intCount = Math.max(1, intDigits.length);
      exponent = Math.floor(Math.log10(Math.abs(value)));
      // Engineering-style when there are several integer placeholders ("##0.0E+0").
      if (intCount > 1) exponent = Math.floor(exponent / intCount) * intCount;
      value /= 10 ** exponent;
      const rounded = Number(Math.abs(value).toFixed(fracDigits.length));
      if (rounded >= 10 ** Math.max(1, intCount)) {
        value /= 10 ** intCount;
        exponent += intCount;
      }
    }
    const expDigits = tokens.slice(expIdx + 1).filter(t => t.t === 'digit').length;
    const sign = exponent < 0 ? '-' : tokens[expIdx].v === '+' ? '+' : '';
    expText = 'E' + sign + String(Math.abs(exponent)).padStart(expDigits, '0');
  }

  const negative = value < 0;
  const abs = Math.abs(value);
  const fixed = abs.toFixed(Math.min(fracDigits.length, 20));
  let [intPart, fracPart = ''] = fixed.split('.');

  // Fraction: '0' must show, '#' and '?' trailing zeros are dropped ('?' becomes a space).
  let frac = fracPart.split('');
  for (let k = frac.length - 1; k >= 0 && frac[k] === '0' && fracDigits[k].v !== '0'; k--) {
    frac[k] = fracDigits[k].v === '?' ? ' ' : '';
  }
  frac = frac.join('');

  const minInt = intDigits.filter(t => t.v === '0').length;
  if (intPart === '0' && minInt === 0) intPart = '';
  intPart = intPart.padStart(minInt, '0');
  if (thousands) intPart = groupThousands(intPart);

  // Lay the digits back into the pattern: the integer block goes where the first
  // integer placeholder is, extra placeholders are consumed.
  let out = '';
  let intPlaced = false;
  let fracPlaced = false;
  const firstIntDigit = intTokens.findIndex(t => t.t === 'digit');
  intTokens.forEach((t, k) => {
    if (t.t === 'lit') out += t.v;
    else if (t.t === 'digit' && !intPlaced && (k === firstIntDigit)) { out += intPart; intPlaced = true; }
  });
  if (!intPlaced) out += intPart;
  if (pointIdx >= 0) {
    out += frac.length || fracDigits.length === 0 ? '.' : '';
    fracTokens.forEach(t => {
      if (t.t === 'lit') out += t.v;
      else if (t.t === 'digit' && !fracPlaced) { out += frac; fracPlaced = true; }
    });
    if (out.endsWith('.') && frac === '') out = out.slice(0, -1);
  }
  if (expIdx >= 0) {
    out += expText;
    for (const t of tokens.slice(expIdx + 1)) if (t.t === 'lit') out += t.v;
  }
  return { text: out, negative };
}

function formatDate(tokens, serial) {
  if (serial < 0) return { text: '#'.repeat(8), negative: false };
  const p = serialToParts(serial);
  const hasAmPm = tokens.some(t => t.t === 'ampm');
  let out = '';
  for (const t of tokens) {
    if (t.t === 'lit') { out += t.v; continue; }
    if (t.t === 'ampm') {
      const pm = p.hour >= 12;
      out += t.v.includes('上午') ? (pm ? '下午' : '上午') : t.v.toUpperCase() === 'A/P' ? (pm ? 'P' : 'A') : pm ? 'PM' : 'AM';
      continue;
    }
    if (t.t === 'elapsed') {
      const total = Math.round(serial * 86400);
      const v = t.v[0] === 'h' ? Math.floor(total / 3600) : t.v[0] === 'm' ? Math.floor(total / 60) : total;
      out += String(v).padStart(t.v.length, '0');
      continue;
    }
    if (t.t === 'comma') { out += ','; continue; }
    if (t.t === 'digit' || t.t === 'point') {
      if (t.t === 'point') out += '.';
      continue;
    }
    if (t.t !== 'date') continue;
    const v = t.v;
    switch (v[0]) {
      case 'y': out += v.length <= 2 ? String(p.year % 100).padStart(2, '0') : String(p.year); break;
      case 'm':
        if (v.length === 1) out += p.month;
        else if (v.length === 2) out += String(p.month).padStart(2, '0');
        else if (v.length === 3) out += MONTHS[p.month - 1].slice(0, 3);
        else out += MONTHS[p.month - 1];
        break;
      case 'M': out += v === 'M' ? p.minute : String(p.minute).padStart(2, '0'); break;
      case 'd':
        if (v.length === 1) out += p.day;
        else if (v.length === 2) out += String(p.day).padStart(2, '0');
        else if (v.length === 3) out += DAYS[p.weekday].slice(0, 3);
        else out += DAYS[p.weekday];
        break;
      case 'a': out += (v.length === 4 ? '星期' : '') + CN_DAYS[p.weekday]; break;
      case 'h': {
        let h = p.hour;
        if (hasAmPm) h = h % 12 || 12;
        out += v.length === 1 ? h : String(h).padStart(2, '0');
        break;
      }
      case 's': out += v.length === 1 ? p.second : String(p.second).padStart(2, '0'); break;
    }
  }
  return { text: out, negative: false };
}

// Format any cell value. Returns { text, color, align } where align is the natural
// alignment for the value type (numbers right, text left, booleans/errors centre).
export function formatValue(value, fmt = 'General', { precision = 10 } = {}) {
  if (value === null || value === undefined) return { text: '', color: null, align: 'left' };
  if (isError(value)) return { text: value.code, color: null, align: 'center' };
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE', color: null, align: 'center' };

  const c = compileFormat(fmt);
  if (typeof value === 'string') {
    if (c.general) return { text: value, color: null, align: 'left' };
    const textSection = c.sections.find(s => s.isText) || (c.sections.length >= 4 ? c.sections[3] : null);
    if (!textSection) return { text: value, color: null, align: 'left' };
    let out = '';
    for (const t of textSection.tokens) {
      if (t.t === 'lit') out += t.v;
      else if (t.t === 'text') out += value;
    }
    return { text: out, color: textSection.color, align: 'left' };
  }

  if (c.general) {
    return { text: generalDisplay(value, precision), color: null, align: 'right' };
  }
  const { section, abs } = pickSection(c.sections, value);
  if (section.isText && !section.tokens.some(t => t.t === 'digit')) {
    return { text: generalDisplay(value, precision), color: null, align: 'right' };
  }
  const { text, negative } = formatNumberSection(section, abs ? Math.abs(value) : value);
  // A single-section format shows its own minus sign; explicit negative sections don't.
  const sign = negative && !abs && !section.isDate && /[1-9]/.test(text) ? '-' : '';
  return { text: sign + text, color: section.color, align: 'right' };
}

function generalDisplay(n, precision) {
  if (!Number.isFinite(n)) return '#NUM!';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) {
    const [m, e] = n.toExponential(5).split('e');
    const exp = Number(e);
    return `${m.replace(/\.?0+$/, '')}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return formatGeneralNumber(Number(n.toPrecision(precision)));
}

// Presets offered in the toolbar.
export const FORMAT_PRESETS = [
  { id: 'General', label: '常规' },
  { id: '0', label: '整数 1235' },
  { id: '0.00', label: '两位小数 1234.57' },
  { id: '#,##0.00', label: '千分位 1,234.57' },
  { id: '¥#,##0.00;[Red]-¥#,##0.00', label: '货币 ¥1,234.57' },
  { id: '0%', label: '百分比 12%' },
  { id: '0.00%', label: '百分比 12.34%' },
  { id: 'yyyy-mm-dd', label: '日期 2026-11-08' },
  { id: 'yyyy"年"m"月"d"日"', label: '日期 2026年11月8日' },
  { id: 'yyyy-mm-dd hh:mm', label: '日期时间 2026-11-08 14:30' },
  { id: 'hh:mm:ss', label: '时间 14:30:00' },
  { id: '0.00E+00', label: '科学计数 1.23E+03' },
  { id: '@', label: '文本' }
];
