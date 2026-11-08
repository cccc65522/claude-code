// Alpha-beta search.
//
//   iterative deepening → principal variation search (PVS) with a transposition table,
//   null-move pruning, late-move reductions, check extensions, killer and history
//   move ordering, and a capture-only quiescence search (all moves when in check).
//   Repetitions are scored with Xiangqi rules: perpetual check loses, then perpetual
//   chase (长捉) loses, otherwise draw.
//
// Scores are from the side to move's point of view. MATE - n means "mate in n plies".

import { MVV, LVA } from './eval.js';
import { src, dst } from './board.js';

export const MATE = 10000;
export const WIN = MATE - 100;   // |score| above this is a forced mate
export const BAN = MATE - 200;   // perpetual-check loss found in the tree
const MAX_PLY = 64;
const HASH_ALPHA = 1, HASH_BETA = 2, HASH_PV = 3;

class Timeout extends Error {}

export class Searcher {
  constructor({ ttBits = 20 } = {}) {
    const n = 1 << ttBits;
    this.ttMask = n - 1;
    this.ttLock = new Int32Array(n);
    this.ttMove = new Int32Array(n);
    this.ttValue = new Int16Array(n);
    this.ttDepth = new Int8Array(n);
    this.ttFlag = new Uint8Array(n);
    this.history = new Int32Array(65536);
    this.killers = Array.from({ length: MAX_PLY + 2 }, () => [0, 0]);
    this.moveBufs = Array.from({ length: MAX_PLY + 2 }, () => new Int32Array(128));
    this.scoreBufs = Array.from({ length: MAX_PLY + 2 }, () => new Int32Array(128));
    this.nodes = 0;
  }

  clearHash() {
    this.ttLock.fill(0);
    this.ttFlag.fill(0);
  }

  // ---------- transposition table ----------

  probe(pos, alpha, beta, depth, ply) {
    const i = pos.key & this.ttMask;
    if (this.ttFlag[i] === 0 || this.ttLock[i] !== pos.lock) return null;
    const mv = this.ttMove[i];
    let v = this.ttValue[i];
    if (v > WIN) v -= ply;
    else if (v < -WIN) v += ply;
    const usable = this.ttDepth[i] >= depth || Math.abs(v) > WIN;
    let value = null;
    if (usable) {
      const f = this.ttFlag[i];
      if (f === HASH_PV || (f === HASH_BETA && v >= beta) || (f === HASH_ALPHA && v <= alpha)) value = v;
    }
    return { mv, value };
  }

  store(pos, flag, v, depth, mv, ply) {
    if (v > BAN - 300 && v < WIN) return; // path-dependent repetition scores
    if (v < -(BAN - 300) && v > -WIN) return;
    const i = pos.key & this.ttMask;
    if (this.ttFlag[i] && this.ttLock[i] === pos.lock && this.ttDepth[i] > depth && !mv) return;
    let sv = v;
    if (v > WIN) sv += ply;
    else if (v < -WIN) sv -= ply;
    const sameEntry = this.ttFlag[i] && this.ttLock[i] === pos.lock;
    this.ttMove[i] = mv || (sameEntry ? this.ttMove[i] : 0);
    this.ttLock[i] = pos.lock;
    this.ttValue[i] = sv;
    this.ttDepth[i] = Math.min(depth, 127);
    this.ttFlag[i] = flag;
  }

  // ---------- evaluation helpers ----------

  evaluate(pos) {
    let v = pos.evaluate();
    if (this.noise) {
      // Deterministic per-position noise for the easy levels.
      const h = Math.imul(pos.key ^ this.noiseSeed, 0x9e3779b1) >>> 0;
      v += (h % (2 * this.noise + 1)) - this.noise;
    }
    return v;
  }

  // Score a repeated position by the rules: perpetual check loses (both sides: draw);
  // without checks, the side that kept chasing a piece (长捉) loses; otherwise a draw.
  repValue(pos, rep, ply) {
    if (rep & 6) {
      let v = 0;
      if (rep & 2) v += ply - BAN;   // we have been checking perpetually: we lose
      if (rep & 4) v += BAN - ply;   // the opponent has: we win
      return v;
    }
    const { chase } = pos.cycleStatus(pos.repCycle());
    const self = pos.side;
    if (chase[self] && !chase[self ^ 1]) return ply - BAN;
    if (chase[self ^ 1] && !chase[self]) return BAN - ply;
    return 0;
  }

  tick() {
    if ((++this.nodes & 2047) === 0 && performance.now() > this.deadline) throw new Timeout();
  }

  // ---------- move ordering ----------

  scoreMoves(pos, buf, scores, n, hashMv, ply) {
    const sq_ = pos.squares;
    const [k1, k2] = this.killers[ply];
    for (let i = 0; i < n; i++) {
      const mv = buf[i];
      const victim = sq_[dst(mv)];
      if (mv === hashMv) scores[i] = 1 << 30;
      else if (victim) scores[i] = (1 << 28) + MVV[victim & 7] * 16 - LVA[sq_[src(mv)] & 7];
      else if (mv === k1) scores[i] = (1 << 27) + 2;
      else if (mv === k2) scores[i] = (1 << 27) + 1;
      else scores[i] = Math.min(this.history[mv], (1 << 27) - 1);
    }
  }

  // Selection sort step: bring the best remaining move to position i.
  pick(buf, scores, i, n) {
    let best = i;
    for (let j = i + 1; j < n; j++) if (scores[j] > scores[best]) best = j;
    if (best !== i) {
      const m = buf[i]; buf[i] = buf[best]; buf[best] = m;
      const s = scores[i]; scores[i] = scores[best]; scores[best] = s;
    }
    return buf[i];
  }

  // ---------- quiescence ----------

  quiesce(pos, alpha, beta, ply) {
    this.tick();
    // mate distance pruning
    let v = ply - MATE;
    if (v >= beta) return v;
    const rep = pos.repStatus(1);
    if (rep) return this.repValue(pos, rep, ply);
    if (ply >= MAX_PLY) return this.evaluate(pos);

    const inCheck = pos.lastMoveGaveCheck();
    let best;
    const buf = this.moveBufs[ply], scores = this.scoreBufs[ply];
    let n;
    if (inCheck) {
      best = ply - MATE;
      n = pos.generate(buf);
      this.scoreMoves(pos, buf, scores, n, 0, ply);
    } else {
      best = this.evaluate(pos);
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
      n = pos.generate(buf, true);
      const sq_ = pos.squares;
      for (let i = 0; i < n; i++) scores[i] = MVV[sq_[dst(buf[i])] & 7] * 16 - LVA[sq_[src(buf[i])] & 7];
    }
    for (let i = 0; i < n; i++) {
      const mv = this.pick(buf, scores, i, n);
      if (!pos.makeMove(mv)) continue;
      v = -this.quiesce(pos, -beta, -alpha, ply + 1);
      pos.undoMove();
      if (v > best) {
        best = v;
        if (v >= beta) return v;
        if (v > alpha) alpha = v;
      }
    }
    return best;
  }

  // ---------- main search ----------

  searchFull(pos, alpha, beta, depth, ply, noNull) {
    if (ply > 0) {
      let v = ply - MATE;
      if (v >= beta) return v;
      const rep = pos.repStatus(1);
      if (rep) return this.repValue(pos, rep, ply);
    }
    if (depth <= 0 || ply >= MAX_PLY) return this.quiesce(pos, alpha, beta, ply);
    this.tick();

    const pvNode = beta - alpha > 1;
    const hit = this.probe(pos, alpha, beta, depth, ply);
    if (hit && hit.value !== null && !pvNode) return hit.value;
    const hashMv = hit ? hit.mv : 0;
    const inCheck = pos.lastMoveGaveCheck();

    // Null move: if passing still fails high, this node is good enough.
    if (!noNull && !pvNode && !inCheck && depth >= 2 && pos.nullOkay()) {
      pos.nullMove();
      const v = -this.searchFull(pos, -beta, 1 - beta, depth - 3, ply + 1, true);
      pos.undoNullMove();
      if (v >= beta) return v > WIN ? beta : v;
    }

    const buf = this.moveBufs[ply], scores = this.scoreBufs[ply];
    const n = pos.generate(buf);
    this.scoreMoves(pos, buf, scores, n, hashMv, ply);

    let best = -MATE, bestMv = 0, flag = HASH_ALPHA, legal = 0;
    for (let i = 0; i < n; i++) {
      const mv = this.pick(buf, scores, i, n);
      const capture = pos.squares[dst(mv)] !== 0;
      if (!pos.makeMove(mv)) continue;
      legal++;
      const givesCheck = pos.lastMoveGaveCheck();
      const newDepth = givesCheck ? depth : depth - 1;
      let v;
      if (legal === 1) {
        v = -this.searchFull(pos, -beta, -alpha, newDepth, ply + 1, false);
      } else {
        // Late move reduction for quiet, non-checking moves far down the list.
        let r = 0;
        if (depth >= 3 && legal > 4 && !capture && !givesCheck && !inCheck && scores[i] < (1 << 27)) r = legal > 12 ? 2 : 1;
        v = -this.searchFull(pos, -alpha - 1, -alpha, newDepth - r, ply + 1, false);
        if (r && v > alpha) v = -this.searchFull(pos, -alpha - 1, -alpha, newDepth, ply + 1, false);
        if (v > alpha && v < beta) v = -this.searchFull(pos, -beta, -alpha, newDepth, ply + 1, false);
      }
      pos.undoMove();
      if (v > best) {
        best = v;
        if (v >= beta) { flag = HASH_BETA; bestMv = mv; break; }
        if (v > alpha) { alpha = v; flag = HASH_PV; bestMv = mv; }
      }
    }
    if (legal === 0) return ply - MATE; // mated, or no legal move (困毙): both lose
    this.store(pos, flag, best, depth, bestMv, ply);
    if (bestMv && !pos.squares[dst(bestMv)]) {
      this.history[bestMv] += depth * depth;
      const k = this.killers[ply];
      if (k[0] !== bestMv) { k[1] = k[0]; k[0] = bestMv; }
    }
    return best;
  }

  // Root search for one depth; root moves are kept ordered by the previous iteration.
  searchRoot(pos, depth, rootMoves) {
    let alpha = -MATE, beta = MATE;
    let best = -MATE, bestMv = 0;
    for (let i = 0; i < rootMoves.length; i++) {
      const mv = rootMoves[i];
      pos.makeMove(mv);
      const newDepth = pos.lastMoveGaveCheck() ? depth : depth - 1;
      let v;
      if (i === 0) v = -this.searchFull(pos, -beta, -alpha, newDepth, 1, false);
      else {
        v = -this.searchFull(pos, -alpha - 1, -alpha, newDepth, 1, false);
        if (v > alpha) v = -this.searchFull(pos, -beta, -alpha, newDepth, 1, false);
      }
      pos.undoMove();
      if (v > best) {
        best = v;
        bestMv = mv;
        this.partial = { mv, score: v }; // usable if time runs out mid-iteration
        if (v > alpha) alpha = v;
        // move to the front so the next iteration searches it first
        rootMoves.splice(i, 1);
        rootMoves.unshift(mv);
      }
    }
    this.store(pos, HASH_PV, best, depth, bestMv, 0);
    return { mv: bestMv, score: best };
  }

  // Follow the transposition table to reconstruct the expected line of play.
  principalVariation(pos, first, maxLen = 12) {
    const pv = [];
    const seen = new Set();
    let mv = first;
    while (mv && pv.length < maxLen) {
      if (!pos.isPseudoLegalFast(mv) || !pos.makeMove(mv)) break;
      pv.push(mv);
      const k = `${pos.key}:${pos.lock}`;
      if (seen.has(k)) break;
      seen.add(k);
      const i = pos.key & this.ttMask;
      mv = this.ttLock[i] === pos.lock && this.ttFlag[i] ? this.ttMove[i] : 0;
    }
    for (let i = 0; i < pv.length; i++) pos.undoMove();
    return pv;
  }

  // Search `pos` (which keeps its game history for repetition rules).
  //   timeMs: budget; maxDepth: depth cap; noise: random eval jitter for easy levels;
  //   onInfo({ depth, score, mv, pv, nodes, timeMs }) after each completed iteration.
  search(pos, { timeMs = 1000, maxDepth = 32, noise = 0, onInfo = null } = {}) {
    const start = performance.now();
    this.deadline = start + timeMs;
    this.rootPly = pos.mvList.length - 1;
    this.nodes = 0;
    this.noise = noise;
    this.noiseSeed = (Math.random() * 0x7fffffff) | 0;
    this.history.fill(0);
    for (const k of this.killers) { k[0] = 0; k[1] = 0; }

    const rootMoves = pos.legalMoves();
    if (!rootMoves.length) return { mv: 0, score: -MATE, depth: 0, nodes: 0, pv: [] };
    // Initial order: captures first, then by a shallow guess.
    const sq_ = pos.squares;
    rootMoves.sort((a, b) => (MVV[sq_[dst(b)] & 7] * (sq_[dst(b)] ? 1 : 0)) - (MVV[sq_[dst(a)] & 7] * (sq_[dst(a)] ? 1 : 0)));
    let result = { mv: rootMoves[0], score: 0, depth: 0, nodes: 0, pv: [rootMoves[0]] };
    if (rootMoves.length === 1) {
      return { ...result, pv: [rootMoves[0]], timeMs: 0, only: true };
    }

    for (let depth = 1; depth <= maxDepth; depth++) {
      this.partial = null;
      let r;
      try {
        r = this.searchRoot(pos, depth, rootMoves);
      } catch (e) {
        if (!(e instanceof Timeout)) throw e;
        // Unwind the moves made inside the aborted search.
        while (pos.mvList.length - 1 > this.rootPly) pos.mvList[pos.mvList.length - 1] ? pos.undoMove() : pos.undoNullMove();
        if (this.partial && this.partial.mv !== result.mv && this.partial.score > result.score) {
          result = { ...result, mv: this.partial.mv, score: this.partial.score, pv: [this.partial.mv] };
        }
        break;
      }
      const elapsed = performance.now() - start;
      result = { mv: r.mv, score: r.score, depth, nodes: this.nodes, timeMs: Math.round(elapsed), pv: this.principalVariation(pos, r.mv) };
      onInfo?.(result);
      if (Math.abs(r.score) > WIN && depth > MATE - Math.abs(r.score)) break; // mate found and proven
      if (elapsed > timeMs * 0.45) break; // the next iteration would not finish in time
    }
    result.nodes = this.nodes;
    result.timeMs = Math.round(performance.now() - start);
    return result;
  }
}

// Convenience: search with a fresh searcher (tests, one-off hints).
export function findBestMove(pos, opts) {
  const s = new Searcher({ ttBits: 18 });
  return s.search(pos, opts);
}

// Engine strength presets.
export const LEVELS = [
  { id: 'novice', name: '入门', timeMs: 300, maxDepth: 2, noise: 80, book: false },
  { id: 'easy', name: '初级', timeMs: 500, maxDepth: 4, noise: 25, book: true },
  { id: 'medium', name: '中级', timeMs: 1200, maxDepth: 64, noise: 0, book: true },
  { id: 'hard', name: '高级', timeMs: 3000, maxDepth: 64, noise: 0, book: true },
  { id: 'master', name: '大师', timeMs: 8000, maxDepth: 64, noise: 0, book: true }
];
