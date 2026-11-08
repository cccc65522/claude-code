// Board representation, move generation and make/unmake for Xiangqi.
//
// The 9×10 board lives inside a 16×16 array (rows 3..12, columns 3..11) so a step
// off the edge lands on a padding square: no bounds arithmetic in the hot loops.
// y = 0 is Black's back rank (top), y = 9 is Red's back rank (bottom), like FEN.
//
// Pieces: side tag (RED = 8, BLACK = 16) + type (0..6). A move is src | dst << 8.

import { pieceSquareValue } from './eval.js';

export const RED = 0;
export const BLACK = 1;
export const KING = 0, ADVISOR = 1, BISHOP = 2, KNIGHT = 3, ROOK = 4, CANNON = 5, PAWN = 6;

export const sideTag = side => 8 + (side << 3);
export const sideOf = pc => (pc & 16 ? BLACK : RED);
export const typeOf = pc => pc & 7;

export const sq = (x, y) => ((y + 3) << 4) + x + 3;
export const fileOf = s => (s & 15) - 3;
export const rankOf = s => (s >> 4) - 3;
export const src = mv => mv & 255;
export const dst = mv => mv >> 8;
export const move = (from, to) => from | (to << 8);

export const IN_BOARD = new Uint8Array(256);
export const IN_PALACE = new Uint8Array(256);
for (let y = 0; y < 10; y++) {
  for (let x = 0; x < 9; x++) {
    IN_BOARD[sq(x, y)] = 1;
    if (x >= 3 && x <= 5 && (y <= 2 || y >= 7)) IN_PALACE[sq(x, y)] = 1;
  }
}
// Which half a square is on (the river lies between y = 4 and y = 5).
export const onRedSide = s => rankOf(s) >= 5;
const homeHalf = (s, side) => (side === RED ? rankOf(s) >= 5 : rankOf(s) <= 4);

// Rough piece values for deciding whether attacking a protected piece still wins material.
const CHASE_VALUE = [0, 1, 1, 3, 5, 3, 1]; // K A B N R C P

// Elephant squares from Red's point of view (Black mirrored).
const BISHOP_SQUARES = new Set(['2,9', '6,9', '0,7', '4,7', '8,7', '2,5', '6,5']);

const ORTHO = [-16, 16, -1, 1];
const DIAG = [-17, -15, 15, 17];
// Knight: for each leg direction, the two destinations beyond it.
const KNIGHT_LEGS = [[-16, -33, -31], [16, 31, 33], [-1, -18, 14], [1, -14, 18]];
const forward = side => (side === RED ? -16 : 16);
const KNIGHT_LEG_OF = new Map();
for (const [leg, a, b] of KNIGHT_LEGS) { KNIGHT_LEG_OF.set(a, leg); KNIGHT_LEG_OF.set(b, leg); }

// ---------- Zobrist hashing (deterministic so books and tests are stable) ----------

function xorshift(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s | 0;
  };
}
const rnd = xorshift(0x9e3779b9);
export const ZKEY = new Int32Array(24 * 256);
export const ZLOCK = new Int32Array(24 * 256);
for (let i = 0; i < ZKEY.length; i++) { ZKEY[i] = rnd(); ZLOCK[i] = rnd(); }
export const ZSIDE_KEY = rnd();
export const ZSIDE_LOCK = rnd();

// ---------- FEN ----------

const FEN_CHARS = { k: KING, a: ADVISOR, b: BISHOP, e: BISHOP, n: KNIGHT, h: KNIGHT, r: ROOK, c: CANNON, p: PAWN };
const FEN_OUT = ['k', 'a', 'b', 'n', 'r', 'c', 'p'];
export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

export class Position {
  constructor(fen = START_FEN) {
    this.squares = new Uint8Array(256);
    this.fromFen(fen);
  }

  clear() {
    this.squares.fill(0);
    this.side = RED;
    this.kingSq = [0, 0];
    this.key = 0;
    this.lock = 0;
    this.vl = [0, 0]; // incremental material + position, per side
    // Stacks for unmake and repetition detection: one entry per ply played.
    this.mvList = [0];
    this.pcList = [0];
    this.keyList = [0];
    this.chkList = [false];
    this.halfmove = 0;
    this.fullmove = 1;
  }

  fromFen(fen) {
    this.clear();
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split('/');
    if (rows.length !== 10) throw new Error('FEN 需要 10 行');
    rows.forEach((row, y) => {
      let x = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { x += Number(ch); continue; }
        const t = FEN_CHARS[ch.toLowerCase()];
        if (t === undefined || x > 8) throw new Error(`FEN 里有无法识别的字符“${ch}”`);
        this.addPiece(sq(x, y), (ch === ch.toUpperCase() ? 8 : 16) + t);
        x++;
      }
      if (x !== 9) throw new Error(`FEN 第 ${y + 1} 行不是 9 列`);
    });
    if (parts[1] === 'b') this.changeSide();
    this.halfmove = Number(parts[4]) || 0;
    this.fullmove = Number(parts[5]) || 1;
    this.keyList[0] = this.key;
    this.chkList[0] = this.inCheck();
    this.validate();
    return this;
  }

  // Basic sanity: one king each, pieces on squares they can legally reach.
  validate() {
    const count = new Map();
    for (let s = 0; s < 256; s++) {
      const pc = this.squares[s];
      if (!pc) continue;
      count.set(pc, (count.get(pc) || 0) + 1);
      const side = sideOf(pc), t = typeOf(pc);
      const x = fileOf(s), y = rankOf(s), ry = side === RED ? y : 9 - y; // ry: rank from Red's view
      if (t === KING && !(IN_PALACE[s] && homeHalf(s, side))) throw new Error('将帅只能在九宫里');
      if (t === ADVISOR && !(IN_PALACE[s] && homeHalf(s, side) && (x + ry) % 2 === 0)) throw new Error('士的位置不对');
      if (t === BISHOP && !BISHOP_SQUARES.has(`${x},${ry}`)) throw new Error('象的位置不对');
      if (t === PAWN && (ry > 6 || (ry >= 5 && x % 2 === 1))) throw new Error('兵卒的位置不对');
    }
    for (const side of [RED, BLACK]) {
      const tag = sideTag(side);
      if (count.get(tag + KING) !== 1) throw new Error('双方必须各有一个将帅');
      const limits = [1, 2, 2, 2, 2, 2, 5];
      limits.forEach((n, t) => { if ((count.get(tag + t) || 0) > n) throw new Error('棋子数量超过上限'); });
    }
    if (this.isAttacked(this.kingSq[this.side ^ 1], this.side ^ 1)) throw new Error('局面不合法：不该走棋的一方正被将军');
  }

  toFen() {
    let out = '';
    for (let y = 0; y < 10; y++) {
      let empty = 0;
      for (let x = 0; x < 9; x++) {
        const pc = this.squares[sq(x, y)];
        if (!pc) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        const ch = FEN_OUT[typeOf(pc)];
        out += sideOf(pc) === RED ? ch.toUpperCase() : ch;
      }
      if (empty) out += empty;
      if (y < 9) out += '/';
    }
    return `${out} ${this.side === RED ? 'w' : 'b'} - - ${this.halfmove} ${this.fullmove}`;
  }

  clone() {
    const p = new Position(this.toFen());
    return p;
  }

  // ---------- incremental updates ----------

  addPiece(s, pc) {
    this.squares[s] = pc;
    const side = sideOf(pc);
    this.vl[side] += pieceSquareValue(pc, s);
    this.key ^= ZKEY[(pc << 8) + s];
    this.lock ^= ZLOCK[(pc << 8) + s];
    if (typeOf(pc) === KING) this.kingSq[side] = s;
  }

  delPiece(s, pc) {
    this.squares[s] = 0;
    this.vl[sideOf(pc)] -= pieceSquareValue(pc, s);
    this.key ^= ZKEY[(pc << 8) + s];
    this.lock ^= ZLOCK[(pc << 8) + s];
  }

  changeSide() {
    this.side ^= 1;
    this.key ^= ZSIDE_KEY;
    this.lock ^= ZSIDE_LOCK;
  }

  // Static evaluation from the side to move's point of view (a small tempo bonus included).
  evaluate() {
    return this.vl[this.side] - this.vl[this.side ^ 1] + 3;
  }

  // ---------- make / unmake ----------

  movePiece(mv) {
    const from = src(mv), to = dst(mv);
    const captured = this.squares[to];
    if (captured) this.delPiece(to, captured);
    const pc = this.squares[from];
    this.delPiece(from, pc);
    this.addPiece(to, pc);
    return captured;
  }

  undoMovePiece(mv, captured) {
    const from = src(mv), to = dst(mv);
    const pc = this.squares[to];
    this.delPiece(to, pc);
    this.addPiece(from, pc);
    if (captured) this.addPiece(to, captured);
  }

  // Plays mv if legal; returns false (and leaves the position unchanged) if it would
  // leave the mover's king in check or facing the other king.
  makeMove(mv) {
    const key = this.key;
    const captured = this.movePiece(mv);
    if (this.inCheck()) {
      this.undoMovePiece(mv, captured);
      return false;
    }
    this.changeSide();
    this.mvList.push(mv);
    this.pcList.push(captured);
    this.keyList.push(key);
    this.chkList.push(this.inCheck());
    return true;
  }

  undoMove() {
    const mv = this.mvList.pop();
    const captured = this.pcList.pop();
    this.keyList.pop();
    this.chkList.pop();
    this.changeSide();
    this.undoMovePiece(mv, captured);
  }

  // Null move for search pruning: pass the turn.
  nullMove() {
    const key = this.key;
    this.changeSide();
    this.mvList.push(0);
    this.pcList.push(0);
    this.keyList.push(key);
    this.chkList.push(false);
  }

  undoNullMove() {
    this.mvList.pop();
    this.pcList.pop();
    this.keyList.pop();
    this.chkList.pop();
    this.changeSide();
  }

  lastMoveGaveCheck() { return this.chkList[this.chkList.length - 1]; }
  get ply() { return this.mvList.length - 1; }

  // ---------- attack detection ----------

  // Is the side to move in check? (Also true when the two kings face each other.)
  inCheck() {
    return this.isAttacked(this.kingSq[this.side], this.side);
  }

  // Is square s (holding `side`'s king) attacked by the other side?
  isAttacked(s, side) {
    const sq_ = this.squares;
    const opp = sideTag(side ^ 1);
    // Pawns: from straight ahead (towards us) or from the sides (only crossed pawns
    // can be beside a king, since kings never leave their palace).
    const fwd = forward(side);
    if (sq_[s + fwd] === opp + PAWN || sq_[s - 1] === opp + PAWN || sq_[s + 1] === opp + PAWN) return true;
    // Knights: each diagonal neighbour is the leg for two knight positions.
    for (const d of DIAG) {
      if (sq_[s + d]) continue;
      const v = d < 0 ? -16 : 16, h = d - v;
      if (sq_[s + d + v] === opp + KNIGHT || sq_[s + d + h] === opp + KNIGHT) return true;
    }
    // Rooks, cannons and the flying general along the four lines.
    for (const d of ORTHO) {
      let t = s + d;
      while (IN_BOARD[t] && !sq_[t]) t += d;
      if (!IN_BOARD[t]) continue;
      const p1 = sq_[t];
      if (p1 === opp + ROOK) return true;
      if (p1 === opp + KING && (d === 16 || d === -16)) return true;
      t += d;
      while (IN_BOARD[t] && !sq_[t]) t += d;
      if (IN_BOARD[t] && sq_[t] === opp + CANNON) return true;
    }
    return false;
  }

  // ---------- move generation (pseudo-legal; makeMove rejects the illegal ones) ----------

  // Fills `out` with moves; captures only when capturesOnly. Returns the count.
  generate(out, capturesOnly = false) {
    const sq_ = this.squares;
    const side = this.side;
    const self = sideTag(side), opp = sideTag(side ^ 1);
    let n = 0;
    const add = (from, to) => {
      const target = sq_[to];
      if (target & self) return;
      if (capturesOnly && !target) return;
      out[n++] = from | (to << 8);
    };
    for (let s = 51; s < 205; s++) {
      const pc = sq_[s];
      if (!(pc & self)) continue;
      switch (pc & 7) {
        case KING:
          for (const d of ORTHO) if (IN_PALACE[s + d]) add(s, s + d);
          break;
        case ADVISOR:
          for (const d of DIAG) if (IN_PALACE[s + d]) add(s, s + d);
          break;
        case BISHOP:
          for (const d of DIAG) {
            const t = s + d + d;
            if (IN_BOARD[t] && homeHalf(t, side) && !sq_[s + d]) add(s, t);
          }
          break;
        case KNIGHT:
          for (const [leg, a, b] of KNIGHT_LEGS) {
            if (sq_[s + leg]) continue;
            if (IN_BOARD[s + a]) add(s, s + a);
            if (IN_BOARD[s + b]) add(s, s + b);
          }
          break;
        case ROOK:
          for (const d of ORTHO) {
            let t = s + d;
            while (IN_BOARD[t]) {
              const p = sq_[t];
              if (!p) { if (!capturesOnly) out[n++] = s | (t << 8); }
              else { if (p & opp) out[n++] = s | (t << 8); break; }
              t += d;
            }
          }
          break;
        case CANNON:
          for (const d of ORTHO) {
            let t = s + d;
            while (IN_BOARD[t] && !sq_[t]) {
              if (!capturesOnly) out[n++] = s | (t << 8);
              t += d;
            }
            t += d; // jump the screen
            while (IN_BOARD[t]) {
              const p = sq_[t];
              if (p) { if (p & opp) out[n++] = s | (t << 8); break; }
              t += d;
            }
          }
          break;
        case PAWN: {
          const f = s + forward(side);
          if (IN_BOARD[f]) add(s, f);
          if (!homeHalf(s, side)) {
            if (IN_BOARD[s - 1]) add(s, s - 1);
            if (IN_BOARD[s + 1]) add(s, s + 1);
          }
          break;
        }
      }
    }
    return n;
  }

  // All legal moves (slow path for the UI and rules; search uses generate + makeMove).
  legalMoves() {
    const buf = new Int32Array(128);
    const n = this.generate(buf);
    const out = [];
    for (let i = 0; i < n; i++) {
      if (this.makeMove(buf[i])) { this.undoMove(); out.push(buf[i]); }
    }
    return out;
  }

  isLegal(mv) {
    return this.legalMoves().includes(mv);
  }

  // Can this pseudo-legal-looking move even be generated here? (Used to validate TT moves.)
  isPseudoLegal(mv) {
    const from = src(mv), to = dst(mv);
    const pc = this.squares[from];
    if (!(pc & sideTag(this.side)) || !IN_BOARD[to]) return false;
    const buf = new Int32Array(128);
    const n = this.generate(buf);
    for (let i = 0; i < n; i++) if (buf[i] === mv) return true;
    return false;
  }

  // Geometry-and-blocking check for a move from the TT, without generating moves.
  isPseudoLegalFast(mv) {
    const from = src(mv), to = dst(mv);
    const sq_ = this.squares;
    const self = sideTag(this.side);
    const pc = sq_[from];
    if (!(pc & self) || !IN_BOARD[to] || (sq_[to] & self) || from === to) return false;
    const d = to - from;
    switch (pc & 7) {
      case KING: return IN_PALACE[to] === 1 && (d === 1 || d === -1 || d === 16 || d === -16);
      case ADVISOR: return IN_PALACE[to] === 1 && (d === 15 || d === -15 || d === 17 || d === -17);
      case BISHOP: return (d === 30 || d === -30 || d === 34 || d === -34) && !sq_[from + d / 2] && homeHalf(to, this.side);
      case KNIGHT: {
        const leg = KNIGHT_LEG_OF.get(d);
        return leg !== undefined && !sq_[from + leg];
      }
      case ROOK: case CANNON: {
        let step;
        if (rankOf(from) === rankOf(to)) step = d > 0 ? 1 : -1;
        else if (fileOf(from) === fileOf(to)) step = d > 0 ? 16 : -16;
        else return false;
        let between = 0;
        for (let t = from + step; t !== to; t += step) if (sq_[t]) between++;
        if ((pc & 7) === ROOK) return between === 0;
        return sq_[to] ? between === 1 : between === 0;
      }
      case PAWN: {
        if (d === forward(this.side)) return true;
        return (d === 1 || d === -1) && !homeHalf(from, this.side);
      }
    }
    return false;
  }

  // ---------- repetition ----------

  // Looks back through reversible moves for the current position. Returns 0 if not
  // repeated, else a bitmask: 1 = repeated, 2 = the side to move checked on every one
  // of its moves in the cycle (perpetual check by us), 4 = the opponent did.
  repStatus(recur = 1) {
    let selfSide = false;
    let perpSelf = true, perpOpp = true;
    let i = this.mvList.length - 1;
    while (i > 0 && this.mvList[i] && !this.pcList[i]) {
      if (selfSide) {
        perpSelf = perpSelf && this.chkList[i];
        if (this.keyList[i] === this.key) {
          if (--recur === 0) return 1 + (perpSelf ? 2 : 0) + (perpOpp ? 4 : 0);
        }
      } else {
        perpOpp = perpOpp && this.chkList[i];
      }
      selfSide = !selfSide;
      i--;
    }
    return 0;
  }

  // Length in plies of the most recent repetition cycle (0 if the position hasn't repeated).
  repCycle() {
    let selfSide = false;
    let i = this.mvList.length - 1;
    while (i > 0 && this.mvList[i] && !this.pcList[i]) {
      if (selfSide && this.keyList[i] === this.key) return this.mvList.length - i;
      selfSide = !selfSide;
      i--;
    }
    return 0;
  }

  // ---------- chasing (捉) ----------
  //
  // A move "chases" an opponent piece when it creates a new, real threat to win it:
  //   - the threat is new: made by the moved piece, or discovered by moving out of the way;
  //   - kings and pawns may threaten freely (their attacks never count as chasing);
  //   - the king and pawns that haven't crossed the river may be attacked freely;
  //   - the threat must win material: the target is unprotected, or worth more than the
  //     attacker (a horse attacking a protected rook still counts);
  //   - attacking an equal piece that can capture you back is an offer to exchange (兑), not a chase.

  // Legal captures available to `side` right now, as move numbers.
  capturePairs(side) {
    const flip = this.side !== side;
    if (flip) this.changeSide();
    const buf = new Int32Array(64);
    const n = this.generate(buf, true);
    const out = new Set();
    for (let i = 0; i < n; i++) {
      if (this.makeMove(buf[i])) { this.undoMove(); out.add(buf[i]); }
    }
    if (flip) this.changeSide();
    return out;
  }

  // After the chaser takes on t with the piece on a, can the side to move recapture on t?
  isProtected(a, t) {
    this.changeSide(); // the chaser plays the capture
    if (!this.makeMove(a | (t << 8))) { this.changeSide(); return true; }
    let protectedSq = false;
    for (const c of this.capturePairs(this.side)) if (dst(c) === t) { protectedSq = true; break; }
    this.undoMove();
    this.changeSide();
    return protectedSq;
  }

  // Squares of the side-to-move's pieces chased by the move just played (`mv`).
  // `before` = capturePairs(chaser) taken before that move was made.
  chasedBy(mv, before) {
    const victim = this.side;
    const after = this.capturePairs(victim ^ 1);
    const counter = this.capturePairs(victim);
    const out = new Set();
    for (const cap of after) {
      const a = src(cap), t = dst(cap);
      if (a !== dst(mv) && before.has(cap)) continue; // threat already existed
      const at = this.squares[a] & 7, tt = this.squares[t] & 7;
      if (at === KING || at === PAWN || tt === KING) continue;
      if (tt === PAWN && homeHalf(t, victim)) continue;
      if (CHASE_VALUE[tt] === CHASE_VALUE[at] && counter.has(t | (a << 8))) continue; // mutual: 兑
      if (CHASE_VALUE[tt] > CHASE_VALUE[at] || !this.isProtected(a, t)) out.add(t);
    }
    return [...out];
  }

  // Replays the last `plies` moves (one repetition cycle) and reports, per side, whether
  // every one of its moves gave check (长将), and whether it kept attacking — every move a
  // check or a chase, at least one chase, and one piece chased throughout (长捉 / 一将一捉).
  cycleStatus(plies) {
    plies = Math.min(plies, this.mvList.length - 1);
    const moves = [];
    for (let i = 0; i < plies; i++) {
      moves.unshift(this.mvList[this.mvList.length - 1]);
      this.undoMove();
    }
    const recs = [];
    for (const mv of moves) {
      const mover = this.side;
      const before = this.capturePairs(mover);
      this.makeMove(mv);
      const check = this.lastMoveGaveCheck();
      recs.push({ mover, mv, check, chased: check ? [] : this.chasedBy(mv, before) });
    }
    const status = { check: [false, false], chase: [false, false] };
    for (const side of [RED, BLACK]) {
      const own = recs.filter(r => r.mover === side);
      if (!own.length) continue;
      status.check[side] = own.every(r => r.check);
      let targets = null, anyChase = false, ok = true;
      for (const r of recs) {
        if (r.mover !== side) {
          // The chased piece runs away: follow it.
          if (targets?.has(src(r.mv))) { targets.delete(src(r.mv)); targets.add(dst(r.mv)); }
          continue;
        }
        if (r.check) continue;
        if (!r.chased.length) { ok = false; break; }
        anyChase = true;
        targets = targets === null ? new Set(r.chased) : new Set(r.chased.filter(s => targets.has(s)));
        if (!targets.size) { ok = false; break; }
      }
      status.chase[side] = ok && anyChase;
    }
    return status;
  }

  // Enough material on the side to move for null-move pruning to be safe.
  nullOkay() {
    return this.vl[this.side] > 400 + 2 * 200; // a rook plus a bit beyond the king guards
  }

  // Count of attacking pieces (rooks, knights, cannons, pawns) per side.
  attackers(side) {
    const tag = sideTag(side);
    let n = 0;
    for (let s = 51; s < 205; s++) {
      const pc = this.squares[s];
      if (pc & tag) {
        const t = pc & 7;
        if (t === ROOK || t === KNIGHT || t === CANNON || t === PAWN) n++;
      }
    }
    return n;
  }
}
