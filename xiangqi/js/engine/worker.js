// Web Worker: runs the search off the main thread so the board stays responsive.
// The transposition table survives between searches in the same game.
//
//   in:  { id, startFen, moves: [iccs...], level: { timeMs, maxDepth, noise, book } }
//   out: { id, type: 'info', depth, score, nodes, timeMs, pv: [iccs...] }   per iteration
//        { id, type: 'done', mv, score, depth, nodes, timeMs, pv, book? }

import { Position } from './board.js';
import { fromIccs, toIccs } from './notation.js';
import { Searcher } from './search.js';
import { pickBookMove } from './book.js';

const searcher = new Searcher({ ttBits: 20 });
let lastStart = null;

self.onmessage = e => {
  const { id, startFen, moves = [], level = {} } = e.data;
  try {
    if (startFen !== lastStart) { searcher.clearHash(); lastStart = startFen; }
    const pos = new Position(startFen);
    for (const m of moves) {
      if (!pos.makeMove(fromIccs(m))) throw new Error(`illegal move ${m}`);
    }
    if (level.book) {
      const b = pickBookMove(pos);
      if (b) {
        self.postMessage({ id, type: 'done', mv: toIccs(b.mv), score: 0, depth: 0, nodes: 0, timeMs: 0, pv: [toIccs(b.mv)], book: b.name });
        return;
      }
    }
    const r = searcher.search(pos, {
      timeMs: level.timeMs ?? 1000,
      maxDepth: level.maxDepth ?? 64,
      noise: level.noise ?? 0,
      onInfo: info => self.postMessage({ id, type: 'info', depth: info.depth, score: info.score, nodes: info.nodes, timeMs: info.timeMs, pv: info.pv.map(toIccs) })
    });
    self.postMessage({ id, type: 'done', mv: r.mv ? toIccs(r.mv) : null, score: r.score, depth: r.depth, nodes: r.nodes, timeMs: r.timeMs, pv: (r.pv || []).map(toIccs) });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err && err.message || err) });
  }
};
