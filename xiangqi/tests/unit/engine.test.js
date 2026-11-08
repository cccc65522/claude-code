import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Position, START_FEN, sq, move, RED, BLACK } from '../../js/engine/board.js';
import { toChinese, fromChinese, toIccs, fromIccs, normalizeNotation } from '../../js/engine/notation.js';
import { Game } from '../../js/engine/game.js';
import { buildBook, bookMoves, pickBookMove, LINES } from '../../js/engine/book.js';
import { Searcher, findBestMove, MATE, WIN } from '../../js/engine/search.js';
import { PUZZLES } from '../../js/engine/puzzles.js';
import { mateLength, forcedWin } from './mate-solver.js';

function perft(p, d, bufs) {
  if (d === 0) return 1;
  const buf = bufs[d];
  const n = p.generate(buf);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (!p.makeMove(buf[i])) continue;
    total += perft(p, d - 1, bufs);
    p.undoMove();
  }
  return total;
}

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

const play = (pos, ...texts) => {
  for (const t of texts) {
    const mv = fromChinese(pos, t);
    assert.notEqual(mv, null, `${t} should be legal in ${pos.toFen()}`);
    pos.makeMove(mv);
  }
  return pos;
};

test('perft from the start position matches the published counts', () => {
  const p = new Position();
  const bufs = Array.from({ length: 6 }, () => new Int32Array(128));
  assert.deepEqual([1, 2, 3, 4].map(d => perft(p, d, bufs)), [44, 1920, 79666, 3290240]);
  assert.equal(p.toFen(), START_FEN, 'make/unmake restores the position exactly');
});

test('FEN round-trips and rejects impossible positions', () => {
  const fens = [START_FEN, '3a1k3/4a4/4b4/9/2R6/9/9/4C4/9/3K5 w - - 0 1', '4k4/9/9/9/9/9/9/9/9/3K5 b - - 12 40'];
  for (const f of fens) assert.equal(new Position(f).toFen(), f);
  const bad = {
    '4k4/9/9/9/9/9/9/9/9/9 w - - 0 1': '将帅',
    '4k4/9/9/9/9/9/9/9/9/4KK3 w - - 0 1': '将帅',
    'R3k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1': '不该走棋',
    '4k4/9/9/9/2B6/9/9/9/9/3K5 w - - 0 1': '象',
    '4k4/9/9/9/9/9/P8/P8/9/3K5 w - - 0 1': '兵卒',
    '4k4/9/9/9/9/1P7/9/9/9/3K5 w - - 0 1': '兵卒',
    '4k4/9/9/9/9/9/9/9/9/A2K5 w - - 0 1': '士',
    '4k4/9/9 w': '10 行'
  };
  for (const [fen, msg] of Object.entries(bad)) assert.throws(() => new Position(fen), e => e.message.includes(msg), fen);
});

test('piece movement rules: horse leg, elephant eye, river, cannon screen, palace', () => {
  // A horse blocked by its leg cannot jump.
  let p = new Position('4k4/9/9/9/9/9/9/4C4/4N4/3K5 w - - 0 1');
  const horse = sq(4, 8);
  const horseMoves = p.legalMoves().filter(m => (m & 255) === horse).map(m => toChinese(p, m));
  assert.deepEqual(horseMoves.sort(), ['马五进三', '马五进七', '马五退三', '马五退七'].sort());
  // Elephants can't cross the river or jump over a blocked eye.
  p = new Position('4k4/9/9/9/9/9/9/9/3N5/2BK5 w - - 0 1');
  const bishop = p.legalMoves().filter(m => (m & 255) === sq(2, 9)).map(m => toChinese(p, m));
  assert.deepEqual(bishop, ['相七进九'], 'the eye at d8 blocks 相七进五');
  // A cannon needs exactly one screen to capture.
  p = new Position('3k5/9/9/9/4p4/9/9/4C4/9/5K3 w - - 0 1');
  assert.equal(fromChinese(p, '炮五进三'), null, 'no screen: cannot capture');
  p = new Position('4k4/4a4/9/9/4p4/9/9/4C4/9/3K5 w - - 0 1');
  assert.notEqual(fromChinese(p, '炮五进六'), null, 'one screen: captures');
  // Pawns move sideways only after crossing the river, never backwards.
  p = new Position('4k4/9/9/9/9/2P1P4/9/9/9/3K5 w - - 0 1');
  assert.equal(fromChinese(p, '兵七平六'), null);
  p = new Position('4k4/9/9/9/2P6/9/9/9/9/3K5 w - - 0 1');
  assert.deepEqual(p.legalMoves().filter(m => (m & 255) === sq(2, 4)).map(m => toChinese(p, m)).sort(), ['兵七平八', '兵七平六', '兵七进一'].sort());
  // King and advisors stay in the palace.
  p = new Position('4k4/9/9/9/9/9/9/9/9/5K3 w - - 0 1');
  assert.deepEqual(p.legalMoves().map(m => toChinese(p, m)), ['帅四进一'], '帅四平五 would face the black king');
});

test('the kings may not face each other (flying general)', () => {
  const p = new Position('3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1');
  assert.equal(fromChinese(p, '帅五平六'), null, 'would face the black king');
  const q = new Position('4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1');
  assert.ok(q.isAttacked(q.kingSq[RED], RED) === false);
  // The only piece between the kings is pinned: it cannot leave the file.
  const r = new Position('4k4/9/9/9/4N4/9/9/9/9/4K4 w - - 0 1');
  assert.deepEqual(r.legalMoves().map(m => toChinese(r, m)).sort(), ['帅五平四', '帅五平六', '帅五进一'].sort());
});

test('Chinese notation formats and parses every legal move in random games', () => {
  const rnd = seeded(5);
  let checked = 0;
  for (let g = 0; g < 40; g++) {
    const p = new Position();
    for (let ply = 0; ply < 120; ply++) {
      const moves = p.legalMoves();
      if (!moves.length) break;
      const seen = new Set();
      for (const m of moves) {
        const text = toChinese(p, m);
        assert.ok(!seen.has(text), `duplicate notation ${text} in ${p.toFen()}`);
        seen.add(text);
        assert.equal(fromChinese(p, text), m, text);
        assert.equal(fromIccs(toIccs(m)), m);
        checked++;
      }
      p.makeMove(moves[Math.floor(rnd() * moves.length)]);
    }
  }
  assert.ok(checked > 100000);
});

test('notation details: 前/后, numbering for each side, aliases', () => {
  let p = new Position();
  assert.equal(toChinese(p, fromIccs('h2e2')), '炮二平五');
  assert.equal(toIccs(fromChinese(p, '马二进三')), 'h0g2');
  play(p, '炮二平五');
  assert.equal(toChinese(p, fromChinese(p, '马8进7')), '马8进7');
  assert.equal(toIccs(fromChinese(p, '马８进７')), 'h9g7', 'full-width digits');
  assert.equal(normalizeNotation('俥一進一'), normalizeNotation('车一进一'));
  // Two rooks on one file: 前车 / 后车.
  p = new Position('4k4/9/9/9/9/9/2R6/9/2R6/3K5 w - - 0 1');
  const names = p.legalMoves().map(m => toChinese(p, m));
  assert.ok(names.includes('前车进六') && names.includes('后车退一') && !names.some(n => n.startsWith('车七')));
  // Three pawns on one file: 前/中/后.
  p = new Position('4k4/9/2P6/2P6/2P6/9/9/9/9/3K5 w - - 0 1');
  const pawnNames = p.legalMoves().map(m => toChinese(p, m));
  assert.ok(pawnNames.includes('前兵进一') && pawnNames.includes('中兵平六') && pawnNames.includes('后兵平八'));
  // Black uses Arabic numerals from its own right.
  p = new Position('4k4/9/9/9/9/9/9/9/9/3K5 b - - 0 1');
  assert.deepEqual(p.legalMoves().map(m => toChinese(p, m)).sort(), ['将5平6', '将5进1'].sort());
});

test('game results: checkmate, 困毙, perpetual check, repetition, 60-move rule', () => {
  let g = new Game('4k4/R8/9/9/9/8R/9/9/9/3K5 w - - 0 1');
  g.play(fromChinese(g.pos, '车一进五'));
  assert.equal(g.result.winner, RED);
  assert.equal(g.result.reason, '绝杀');
  assert.deepEqual(g.legalMoves(), []);

  // Black has no legal move but is not in check: Black loses (困毙).
  g = new Game('3k5/9/3P5/9/9/9/9/9/9/4K4 w - - 0 1');
  assert.equal(g.result, null);
  const mv = g.legalMoves().find(m => {
    g.pos.makeMove(m);
    const stuck = g.pos.legalMoves().length === 0 && !g.pos.inCheck();
    g.pos.undoMove();
    return stuck;
  });
  assert.ok(mv !== undefined, 'there is a stalemating move');
  g.play(mv);
  assert.equal(g.result.reason, '困毙');
  assert.equal(g.result.winner, RED);

  // Red checks forever with a rook while Black shuffles: Red loses by 长将.
  g = new Game('3k5/9/9/9/9/9/9/9/R8/5K3 w - - 0 1');
  g.play(fromChinese(g.pos, '车九平六'));
  const cycle = ['将4平5', '车六平五', '将5平4', '车五平六'];
  for (let i = 0; i < 3 && !g.result; i++) {
    for (const t of cycle) {
      if (g.result) break;
      const m = fromChinese(g.pos, t);
      assert.notEqual(m, null, t);
      g.play(m);
    }
  }
  assert.equal(g.result?.reason, '长将');
  assert.equal(g.result.winner, BLACK);

  // Quiet repetition (no checks) is a draw.
  g = new Game('3k5/9/9/9/9/9/9/9/9/R3K4 w - - 0 1');
  for (let i = 0; i < 3 && !g.result; i++) {
    for (const t of ['车九进一', '将4进1', '车九退一', '将4退1']) if (!g.result) g.play(fromChinese(g.pos, t));
  }
  assert.equal(g.result?.reason, '重复');
  assert.equal(g.result.winner, null);

  // Undo clears a result and restores the position.
  g.undo();
  assert.equal(g.result, null);

  // Only kings and defenders left: draw.
  g = new Game('3ak4/9/9/9/9/9/9/9/9/3A1K3 w - - 0 1');
  g.play(fromChinese(g.pos, '仕六进五'));
  assert.equal(g.result?.reason, '无子');
});

test('a saved game replays from its move list', () => {
  const g = new Game();
  for (const t of ['炮二平五', '马8进7', '马二进三', '车9平8']) g.play(fromChinese(g.pos, t));
  const copy = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert.equal(copy.pos.toFen(), g.pos.toFen());
  assert.equal(copy.movetext(), '1. 炮二平五 马8进7\n2. 马二进三 车9平8');
});

test('opening book lines are all legal and give choices at the root', () => {
  const book = buildBook();
  assert.ok(book.size > 40);
  const root = bookMoves(new Position()).map(e => e.name);
  assert.ok(root.includes('中炮对屏风马') && root.includes('飞相局'));
  const rnd = seeded(9);
  const picks = new Set(Array.from({ length: 50 }, () => toChinese(new Position(), pickBookMove(new Position(), rnd).mv)));
  assert.ok(picks.size >= 3, 'weighted random choice varies');
  assert.equal(LINES.length, 13);
});

test('the search finds proven mates in every puzzle, with the right length', () => {
  for (const pz of PUZZLES) {
    const pos = new Position(pz.fen);
    assert.equal(mateLength(pos, 2 * pz.moves - 1), 2 * pz.moves - 1, `${pz.name}: brute force proves mate in ${pz.moves}`);
    if (pz.moves > 1) assert.equal(forcedWin(pos, 2 * pz.moves - 3), false, `${pz.name}: no shorter mate`);
    const r = findBestMove(pos, { timeMs: 3000 });
    assert.equal(MATE - r.score, 2 * pz.moves - 1, `${pz.name}: engine finds the mate (${r.score})`);
    // Playing the engine's line actually mates.
    const g = new Game(pz.fen);
    for (const m of r.pv) g.play(m);
    assert.equal(g.result?.winner, RED, `${pz.name}: PV ends in mate`);
  }
});

test('the search wins free material and avoids hanging its own', () => {
  // Black rook hangs to the red cannon jumping the pawn screen.
  let p = new Position('5k3/9/9/4r4/4p4/9/9/4C4/9/3K5 w - - 0 1');
  let r = findBestMove(p, { timeMs: 500 });
  assert.equal(toChinese(p, r.mv), '炮五进四');
  assert.ok(r.score > 100, `wins the rook (${r.score})`);
  // Red rook attacked by a black horse should step away (or be defended), not stay en prise.
  p = new Position('3k5/9/9/9/9/4n4/2R6/9/9/4K4 w - - 0 1');
  r = findBestMove(p, { timeMs: 500 });
  p.makeMove(r.mv);
  const reply = findBestMove(p, { timeMs: 500 });
  assert.ok(reply.score < 150, 'Black cannot win the rook afterwards');
});

test('the engine avoids a perpetual check that would lose and takes a repetition win', () => {
  // Black king alone vs red rook: perpetual checks would lose for Red; the engine must not
  // play into a third repetition with all checks. Simulate a history of checks.
  const g = new Game('3k5/9/9/9/9/9/9/9/R8/5K3 w - - 0 1');
  for (const t of ['车九平六', '将4平5', '车六平五', '将5平4', '车五平六', '将4平5', '车六平五', '将5平4']) g.play(fromChinese(g.pos, t));
  assert.equal(g.result, null);
  const r = new Searcher({ ttBits: 16 }).search(g.pos, { timeMs: 800 });
  const g2 = Game.fromJSON(g.toJSON());
  g2.play(r.mv);
  assert.notEqual(g2.result?.reason, '长将', `engine move ${toChinese(g.pos, r.mv)} must not lose by perpetual check`);
});

test('iterative deepening reports progress and respects the time budget', () => {
  const infos = [];
  const t = performance.now();
  const r = new Searcher({ ttBits: 16 }).search(new Position(), { timeMs: 400, onInfo: i => infos.push(i.depth) });
  const elapsed = performance.now() - t;
  assert.ok(r.depth >= 4, `reached depth ${r.depth}`);
  assert.deepEqual(infos, infos.map((_, i) => i + 1));
  assert.ok(elapsed < 1200, `took ${elapsed | 0}ms`);
  assert.ok(new Position().isLegal(r.mv));
});

test('make/unmake keeps hash keys and evaluation incremental', () => {
  const rnd = seeded(77);
  const p = new Position();
  for (let i = 0; i < 300; i++) {
    const moves = p.legalMoves();
    if (!moves.length) break;
    p.makeMove(moves[Math.floor(rnd() * moves.length)]);
    const fresh = new Position(p.toFen());
    assert.equal(p.key, fresh.key);
    assert.equal(p.lock, fresh.lock);
    assert.deepEqual(p.vl, fresh.vl);
  }
});
