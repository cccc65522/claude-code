// Move notation.
//
// Chinese (WXF-style) notation, e.g. 炮二平五, 马8进7, 前车退二, 中兵平四:
//   piece + file (or 前/中/后 when identical pieces share a file) + 进/退/平 + number.
//   Red counts files 一..九 from its right; Black counts 1..9 from its own right.
//   For 进/退 the number is the steps moved for straight-moving pieces and the
//   destination file for 马/相/仕, which move diagonally.
// ICCS coordinates, e.g. h2e2: files a..i from Red's left, ranks 0..9 from Red's side.

import { RED, BLACK, KNIGHT, BISHOP, ADVISOR, PAWN, sideOf, typeOf, src, dst, fileOf, rankOf, sq, move } from './board.js';

const NAMES = [
  ['帅', '仕', '相', '马', '车', '炮', '兵'],
  ['将', '士', '象', '马', '车', '炮', '卒']
];
const CN_DIGITS = '一二三四五六七八九';

const fileNumber = (x, side) => (side === RED ? 9 - x : x + 1);
const numText = (n, side) => (side === RED ? CN_DIGITS[n - 1] : String(n));

export function pieceName(pc) {
  return NAMES[sideOf(pc)][typeOf(pc)];
}

// Pieces identical to `pc` on file x, ordered front (nearest the enemy) to back.
function sameOnFile(pos, pc, x) {
  const list = [];
  for (let y = 0; y < 10; y++) if (pos.squares[sq(x, y)] === pc) list.push(y);
  return sideOf(pc) === RED ? list : list.reverse();
}

function prefixFor(count, index) {
  if (count === 2) return '前后'[index];
  if (count === 3) return '前中后'[index];
  return '一二三四五'[index];
}

export function toChinese(pos, mv) {
  const from = src(mv), to = dst(mv);
  const pc = pos.squares[from];
  if (!pc) throw new Error('起点没有棋子');
  const side = sideOf(pc), t = typeOf(pc);
  const x0 = fileOf(from), y0 = rankOf(from), x1 = fileOf(to), y1 = rankOf(to);
  const name = NAMES[side][t];

  let head = name + numText(fileNumber(x0, side), side);
  const same = sameOnFile(pos, pc, x0);
  if (same.length >= 2) {
    // Identical pieces on one file are told apart by position instead of file.
    head = prefixFor(same.length, same.indexOf(y0)) + name;
    // Two files each holding several pawns: keep the file number too.
    if (t === PAWN) {
      let filesWithTandem = 0;
      for (let x = 0; x < 9; x++) if (sameOnFile(pos, pc, x).length >= 2) filesWithTandem++;
      if (filesWithTandem > 1) head += numText(fileNumber(x0, side), side);
    }
  }

  const forwardMove = side === RED ? y1 < y0 : y1 > y0;
  if (y0 === y1) return `${head}平${numText(fileNumber(x1, side), side)}`;
  const action = forwardMove ? '进' : '退';
  const diagonal = t === KNIGHT || t === BISHOP || t === ADVISOR;
  const n = diagonal ? fileNumber(x1, side) : Math.abs(y1 - y0);
  return `${head}${action}${numText(n, side)}`;
}

// Canonical form for comparing typed notation with generated notation.
const ALIASES = {
  '帥': '将', '帅': '将', '將': '将',
  '仕': '士', '相': '象',
  '俥': '车', '車': '车', '伡': '车',
  '傌': '马', '馬': '马', '码': '马',
  '砲': '炮', '包': '炮', '炮': '炮',
  '兵': '卒',
  '進': '进', '後': '后'
};
export function normalizeNotation(text) {
  let s = text.replace(/\s+/g, '');
  s = s.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  s = s.replace(/[一二三四五六七八九]/g, d => String(CN_DIGITS.indexOf(d) + 1));
  return [...s].map(ch => ALIASES[ch] || ch).join('');
}

// Finds the legal move a notation describes; null if none matches.
export function fromChinese(pos, text) {
  const want = normalizeNotation(text);
  for (const mv of pos.legalMoves()) {
    if (normalizeNotation(toChinese(pos, mv)) === want) return mv;
  }
  return null;
}

export function toIccs(mv) {
  const a = src(mv), b = dst(mv);
  const f = s => 'abcdefghi'[fileOf(s)] + (9 - rankOf(s));
  return f(a) + f(b);
}

export function fromIccs(text) {
  const m = /^([a-i])([0-9])-?([a-i])([0-9])$/i.exec(text.trim());
  if (!m) return null;
  const s = (fl, rk) => sq('abcdefghi'.indexOf(fl.toLowerCase()), 9 - Number(rk));
  return move(s(m[1], m[2]), s(m[3], m[4]));
}

export { RED, BLACK };
