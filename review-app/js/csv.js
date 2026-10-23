// RFC 4180 style CSV reader: quoted fields, doubled quotes, line breaks inside quotes,
// CRLF or LF, an optional UTF-8 BOM, and comma / tab / semicolon delimiters.

export function detectDelimiter(text) {
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  let best = ',';
  for (const d of Object.keys(counts)) if (counts[d] > counts[best]) best = d;
  return best;
}

// Returns [{ cells: [...], line }] where line is the 1-based line the row starts on.
// Rows whose cells are all blank are dropped.
export function parseCSV(input, delimiter) {
  const text = String(input).replace(/^﻿/, '');
  const sep = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; continue; }
    if (ch === sep) { row.push(field); field = ''; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push({ cells: row, line: rowLine });
      row = []; field = '';
      line++; rowLine = line;
      continue;
    }
    field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push({ cells: row, line: rowLine });
  }
  return rows.filter(r => r.cells.some(c => c.trim() !== ''));
}

export function toCSV(rows) {
  return rows.map(cells => cells.map(cell => {
    const s = String(cell ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}
