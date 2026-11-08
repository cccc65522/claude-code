// What a typed entry means: "=SUM(A1:A3)" is a formula, "12%" is 0.12 shown as a percent,
// "2026-11-08" is a date serial shown as a date, "'007" is the text 007.

import { parseDateText } from './dates.js';

const NUM = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function plainNumber(t) {
  if (!/\d/.test(t) || !NUM.test(t)) return null;
  return Number(t.replace(/,/g, ''));
}

// Returns { kind: 'empty' } | { kind: 'formula', text } | { kind: 'value', value, format? }
// `format` is a suggested number format when the cell doesn't already have one.
export function parseInput(raw) {
  if (raw === null || raw === undefined || raw === '') return { kind: 'empty' };
  if (raw[0] === '=' && raw.length > 1) return { kind: 'formula', text: raw.slice(1) };
  if (raw[0] === "'") return { kind: 'value', value: raw.slice(1) };

  const t = raw.trim();
  if (t === '') return { kind: 'value', value: raw };

  const upper = t.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') return { kind: 'value', value: upper === 'TRUE' };

  let n = plainNumber(t);
  if (n !== null) return { kind: 'value', value: n, format: /,/.test(t) ? (/\./.test(t) ? '#,##0.00' : '#,##0') : undefined };

  let m = /^([+-]?)([^%]+)%$/.exec(t);
  if (m && (n = plainNumber(m[2])) !== null) {
    const v = (m[1] === '-' ? -n : n) / 100;
    return { kind: 'value', value: v, format: /\./.test(m[2]) ? '0.00%' : '0%' };
  }

  m = /^([+-]?)[¥￥$]\s*(.+)$/.exec(t) || /^[¥￥$]\s*([+-]?)(.+)$/.exec(t);
  if (m && (n = plainNumber(m[2])) !== null) {
    const symbol = t.includes('$') ? '$' : '¥';
    return { kind: 'value', value: m[1] === '-' ? -n : n, format: `${symbol}#,##0.00;[Red]-${symbol}#,##0.00` };
  }

  const d = parseDateText(t);
  if (d) {
    const format = d.kind === 'date' ? 'yyyy-mm-dd'
      : d.kind === 'datetime' ? 'yyyy-mm-dd hh:mm'
      : d.kind === 'time-s' ? 'hh:mm:ss' : 'hh:mm';
    return { kind: 'value', value: d.serial, format };
  }

  return { kind: 'value', value: raw };
}
