// A small opening book of mainstream lines, written in Chinese notation.
// Built at load time by replaying every line, so a typo fails loudly in the tests.

import { Position, START_FEN } from './board.js';
import { fromChinese } from './notation.js';

export const LINES = [
  ['中炮对屏风马', '炮二平五 马8进7 马二进三 车9平8 车一平二 马2进3 兵七进一 卒7进1 车二进六 炮8平9 车二平三 炮9退1'],
  ['中炮过河车', '炮二平五 马8进7 马二进三 车9平8 车一平二 卒7进1 车二进六 马2进3 兵七进一 炮8平9'],
  ['中炮巡河炮', '炮二平五 马8进7 马二进三 车9平8 车一平二 马2进3 炮八进二 象3进5'],
  ['顺炮直车', '炮二平五 炮8平5 马二进三 马8进7 车一平二 车9平8 马八进七 马2进3'],
  ['列炮', '炮二平五 炮2平5 马二进三 马2进3 车一平二 车1平2'],
  ['中炮对反宫马', '炮二平五 马2进3 马二进三 炮8平6 车一平二 马8进7 兵三进一 车9平8'],
  ['仙人指路对卒底炮', '兵七进一 炮2平3 炮二平五 象7进5 马二进三 马8进7'],
  ['仙人指路', '兵七进一 卒7进1 马八进七 马8进7 马二进三 马2进3'],
  ['仙人指路（右）', '兵三进一 卒3进1 马二进三 马2进3 马八进七 马8进7'],
  ['飞相局', '相三进五 炮8平4 马二进三 马8进7 车一平二 车9平8'],
  ['飞相对进卒', '相三进五 卒7进1 兵七进一 马8进7 马八进七 马2进3'],
  ['起马局', '马八进七 卒7进1 兵七进一 马8进7 马二进三 马2进3'],
  ['过宫炮', '炮二平六 马8进7 马二进三 车9平8 车一平二 马2进3']
];

const keyOf = pos => `${pos.key}:${pos.lock}`;

export function buildBook() {
  const book = new Map();
  for (const [name, line] of LINES) {
    const pos = new Position(START_FEN);
    for (const text of line.split(/\s+/)) {
      const mv = fromChinese(pos, text);
      if (mv === null) throw new Error(`开局库“${name}”里的“${text}”不是合法着法`);
      const k = keyOf(pos);
      if (!book.has(k)) book.set(k, new Map());
      const entry = book.get(k);
      const prev = entry.get(mv);
      entry.set(mv, { mv, name: prev?.name ?? name, weight: (prev?.weight || 0) + 1 });
      pos.makeMove(mv);
    }
  }
  return book;
}

let cached = null;

// Book moves for this position: [{ mv, name, weight }], possibly empty.
export function bookMoves(pos) {
  cached ??= buildBook();
  const entry = cached.get(keyOf(pos));
  return entry ? [...entry.values()] : [];
}

// Weighted random choice; rng() in [0, 1).
export function pickBookMove(pos, rng = Math.random) {
  const list = bookMoves(pos);
  if (!list.length) return null;
  const total = list.reduce((a, b) => a + b.weight, 0);
  let r = rng() * total;
  for (const e of list) {
    r -= e.weight;
    if (r < 0) return e;
  }
  return list[list.length - 1];
}
