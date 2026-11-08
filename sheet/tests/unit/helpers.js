import { Workbook } from '../../js/engine/workbook.js';
import { parseAddress, parseRangeAddress } from '../../js/engine/address.js';

// A fixed clock (2026-11-08 12:00) and a deterministic RNG keep volatile functions testable.
export const NOW = 46334.5;

export function book(cells = {}, opts = {}) {
  let seed = 42;
  const wb = Workbook.create({
    now: () => NOW,
    random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
    ...opts
  });
  const sheetId = wb.sheets[0].id;
  wb.setCells(Object.entries(cells).map(([a, input]) => {
    const p = parseAddress(a);
    return { sheetId, r: p.row, c: p.col, input };
  }));
  return wb;
}

export function sid(wb, name) {
  if (!name) return wb.sheets[0].id;
  const id = wb.resolveSheet(name);
  if (id === null) throw new Error(`no sheet ${name}`);
  return id;
}

function split(ref) {
  const i = ref.lastIndexOf('!');
  return i < 0 ? [null, ref] : [ref.slice(0, i), ref.slice(i + 1)];
}

// Plain JS value of a cell: numbers, strings, booleans, null, or the error code string.
export function val(wb, ref) {
  const [sheet, a] = split(ref);
  const p = parseAddress(a);
  const v = wb.getValue(sid(wb, sheet), p.row, p.col);
  return v && typeof v === 'object' && 'code' in v ? v.code : v;
}

export function input(wb, ref) {
  const [sheet, a] = split(ref);
  const p = parseAddress(a);
  return wb.getInput(sid(wb, sheet), p.row, p.col);
}

export function text(wb, ref) {
  const [sheet, a] = split(ref);
  const p = parseAddress(a);
  return wb.getDisplay(sid(wb, sheet), p.row, p.col)?.text ?? '';
}

export function set(wb, ref, value) {
  const [sheet, a] = split(ref);
  const p = parseAddress(a);
  wb.setCell(sid(wb, sheet), p.row, p.col, value);
}

export const rng = a => parseRangeAddress(a);

// Evaluate one formula against some cells.
export function calc(formula, cells = {}) {
  const wb = book({ ...cells, Z1000: formula.startsWith('=') ? formula : '=' + formula });
  return val(wb, 'Z1000');
}
