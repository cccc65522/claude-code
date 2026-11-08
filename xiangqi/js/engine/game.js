// A game: a Position plus its move record and the rules that end a game.
//
//   绝杀 checkmate                  → the side to move loses
//   困毙 no legal move, not in check → the side to move also loses (unlike chess)
//   On the third occurrence of a position, the last repetition cycle is judged:
//   长将 perpetual check            → the side that kept checking loses
//   长捉 perpetual chase (incl. 一将一捉) → the side that kept chasing one piece loses
//     (长将 outranks 长捉; if both sides break the same rule it is a draw)
//   重复局面 any other repetition    → draw
//   60 回合自然限着 120 plies without a capture → draw
//   双方无进攻子力 no rooks/knights/cannons/pawns left → draw

import { Position, START_FEN, RED, BLACK, sideOf, src, dst } from './board.js';
import { toChinese, toIccs } from './notation.js';

export const SIDE_NAME = ['红方', '黑方'];

// { loser, reason } for a repetition cycle, or null for a draw.
export function judgeRepetition({ check, chase }) {
  if (check[RED] !== check[BLACK]) return { loser: check[RED] ? RED : BLACK, reason: '长将' };
  if (check[RED]) return null; // both kept checking
  if (chase[RED] !== chase[BLACK]) return { loser: chase[RED] ? RED : BLACK, reason: '长捉' };
  return null;
}

export class Game {
  constructor(fen = START_FEN) {
    this.startFen = new Position(fen).toFen();
    this.pos = new Position(this.startFen);
    this.records = [];
    this.result = null;
  }

  get side() { return this.pos.side; }

  legalMoves() {
    return this.result ? [] : this.pos.legalMoves();
  }

  // Plays a legal move and returns its record, or null when the move is illegal.
  play(mv) {
    if (this.result) return null;
    const notation = toChinese(this.pos, mv);
    const fenBefore = this.pos.toFen();
    const mover = this.pos.side;
    const captured = this.pos.squares[dst(mv)];
    if (!this.pos.makeMove(mv)) return null;
    const rec = {
      mv, notation, iccs: toIccs(mv), mover, captured,
      check: this.pos.inCheck(), fenBefore, fenAfter: this.pos.toFen()
    };
    this.records.push(rec);
    this.result = this.computeResult();
    return rec;
  }

  undo() {
    if (!this.records.length) return null;
    const rec = this.records.pop();
    this.pos.undoMove();
    this.result = null;
    return rec;
  }

  // Plies since the last capture (for the 60-move rule).
  quietPlies() {
    let n = 0;
    for (let i = this.records.length - 1; i >= 0 && !this.records[i].captured; i--) n++;
    return n;
  }

  computeResult() {
    const pos = this.pos;
    const side = pos.side;
    if (pos.legalMoves().length === 0) {
      return pos.inCheck()
        ? { winner: side ^ 1, reason: '绝杀', text: `${SIDE_NAME[side ^ 1]}胜（绝杀）` }
        : { winner: side ^ 1, reason: '困毙', text: `${SIDE_NAME[side ^ 1]}胜（困毙：${SIDE_NAME[side]}无子可动）` };
    }
    // Third occurrence of the position with the same side to move: judge the last cycle.
    if (pos.repStatus(2)) {
      const verdict = judgeRepetition(pos.cycleStatus(pos.repCycle()));
      if (verdict) {
        const { loser, reason } = verdict;
        return { winner: loser ^ 1, reason, text: `${SIDE_NAME[loser ^ 1]}胜（${SIDE_NAME[loser]}${reason}判负）` };
      }
      return { winner: null, reason: '重复', text: '和棋（局面重复三次）' };
    }
    if (this.quietPlies() >= 120) return { winner: null, reason: '限着', text: '和棋（60 回合未吃子）' };
    if (pos.attackers(RED) === 0 && pos.attackers(BLACK) === 0) return { winner: null, reason: '无子', text: '和棋（双方都没有进攻子力）' };
    return null;
  }

  resign(side) {
    if (this.result) return;
    this.result = { winner: side ^ 1, reason: '认输', text: `${SIDE_NAME[side ^ 1]}胜（${SIDE_NAME[side]}认输）` };
  }

  agreeDraw() {
    if (!this.result) this.result = { winner: null, reason: '议和', text: '和棋（双方议和）' };
  }

  // Move list as text, two plies per line: "1. 炮二平五 马8进7".
  movetext() {
    const lines = [];
    let num = 1;
    let line = '';
    this.records.forEach((r, i) => {
      if (r.mover === RED) { line = `${num}. ${r.notation}`; }
      else {
        line = line ? `${line} ${r.notation}` : `${num}. …… ${r.notation}`;
        lines.push(line);
        line = '';
        num++;
      }
      if (i === this.records.length - 1 && line) lines.push(line);
    });
    return lines.join('\n');
  }

  toJSON() {
    return { startFen: this.startFen, moves: this.records.map(r => r.iccs), result: this.result };
  }

  static fromJSON(data) {
    const g = new Game(data.startFen || START_FEN);
    for (const iccs of data.moves || []) {
      const mv = g.legalMoves().find(m => toIccs(m) === iccs);
      if (mv === undefined || !g.play(mv)) break;
    }
    if (data.result && !g.result && (data.result.reason === '认输' || data.result.reason === '议和')) g.result = data.result;
    return g;
  }
}

export { sideOf, src, dst };
