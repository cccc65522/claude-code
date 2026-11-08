// CSV / TSV: RFC 4180 parsing with delimiter detection, and serialisation.

export function detectDelimiter(text) {
  const sample = text.slice(0, 10000);
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < sample.length && lines < 20; i++) {
    const ch = sample[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch in counts) counts[ch]++;
      else if (ch === '\n') lines++;
    }
  }
  if (counts['\t'] > 0 && counts['\t'] >= counts[',']) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
}

export function parseCSV(text, delimiter = detectDelimiter(text)) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function toCSV(rows, delimiter = ',') {
  const needs = new RegExp(`["\\r\\n${delimiter === '\t' ? '\\t' : delimiter}]|^\\s|\\s$`);
  return rows.map(r => r.map(v => {
    const s = v ?? '';
    return needs.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(delimiter)).join('\r\n');
}

// Files from Chinese Excel are often GBK; try strict UTF-8 first.
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}
