// Cell addresses: 0-based (row, col) internally, "A1" style for people.

export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;

export function colToName(col) {
  let s = '';
  let n = col + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function nameToCol(name) {
  let n = 0;
  for (const ch of name.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return -1;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

export function formatAddress(row, col, rowAbs = false, colAbs = false) {
  return `${colAbs ? '$' : ''}${colToName(col)}${rowAbs ? '$' : ''}${row + 1}`;
}

const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;

// "B$3" -> { row: 2, col: 1, rowAbs: true, colAbs: false }; null when invalid or off-grid.
export function parseAddress(text) {
  const m = CELL_RE.exec(text.trim());
  if (!m) return null;
  const col = nameToCol(m[2]);
  const row = Number(m[4]) - 1;
  if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return null;
  return { row, col, rowAbs: m[3] === '$', colAbs: m[1] === '$' };
}

// "A1:C3", "A1", "C:C", "2:5" -> { r1, c1, r2, c2 } normalised; null when invalid.
export function parseRangeAddress(text) {
  const t = text.trim().replace(/\$/g, '');
  const parts = t.split(':');
  if (parts.length === 1) {
    const a = parseAddress(parts[0]);
    return a && { r1: a.row, c1: a.col, r2: a.row, c2: a.col };
  }
  if (parts.length !== 2) return null;
  const [p, q] = parts;
  if (/^[A-Za-z]{1,3}$/.test(p) && /^[A-Za-z]{1,3}$/.test(q)) {
    const c1 = nameToCol(p), c2 = nameToCol(q);
    if (c1 >= MAX_COLS || c2 >= MAX_COLS) return null;
    return { r1: 0, c1: Math.min(c1, c2), r2: MAX_ROWS - 1, c2: Math.max(c1, c2) };
  }
  if (/^\d+$/.test(p) && /^\d+$/.test(q)) {
    const r1 = Number(p) - 1, r2 = Number(q) - 1;
    if (r1 < 0 || r2 < 0 || r1 >= MAX_ROWS || r2 >= MAX_ROWS) return null;
    return { r1: Math.min(r1, r2), c1: 0, r2: Math.max(r1, r2), c2: MAX_COLS - 1 };
  }
  const a = parseAddress(p), b = parseAddress(q);
  if (!a || !b) return null;
  return normRange({ r1: a.row, c1: a.col, r2: b.row, c2: b.col });
}

export function normRange({ r1, c1, r2, c2 }) {
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}

export function formatRange({ r1, c1, r2, c2 }) {
  if (r1 === r2 && c1 === c2) return formatAddress(r1, c1);
  return `${formatAddress(r1, c1)}:${formatAddress(r2, c2)}`;
}

export function inRange(range, row, col) {
  return row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2;
}

// Sheet names that need quoting in formulas: anything but a plain identifier.
export function quoteSheetName(name) {
  if (/^[A-Za-z_一-鿿][A-Za-z0-9_.一-鿿]*$/.test(name) && !CELL_RE.test(name) && !/^(TRUE|FALSE)$/i.test(name)) {
    return name;
  }
  return `'${name.replace(/'/g, "''")}'`;
}
