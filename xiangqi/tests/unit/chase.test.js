import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Position, RED, BLACK, fileOf, rankOf } from '../../js/engine/board.js';
import { fromChinese, toChinese } from '../../js/engine/notation.js';
import { Game, judgeRepetition } from '../../js/engine/game.js';
import { Searcher, WIN } from '../../js/engine/search.js';

const iccsSq = s => 'abcdefghi'[fileOf(s)] + (9 - rankOf(s));

// Squares chased by playing `text` in `fen`.
function chased(fen, text) {
  const p = new Position(fen);
  const mv = fromChinese(p, text);
  assert.notEqual(mv, null, `${text} is legal in ${fen}`);
  const before = p.capturePairs(p.side);
  p.makeMove(mv);
  return p.chasedBy(mv, before).map(iccsSq).sort();
}

test('a new threat to an unprotected piece is a chase', () => {
  assert.deepEqual(chased('4k4/9/n8/9/9/9/2R6/9/9/3K5 w - - 0 1', '车七平九'), ['a7']);
  // Black chasing works the same way.
  assert.deepEqual(chased('4k4/9/9/9/9/9/2N6/9/r8/3K5 b - - 0 1', '车1平3'), ['c3']);
});

test('attacking a protected piece is not a chase, unless the target is worth more', () => {
  assert.deepEqual(chased('r3k4/9/n8/9/9/9/2R6/9/9/3K5 w - - 0 1', '车七平九'), [], 'the black rook guards the horse');
  assert.deepEqual(chased('2r1k4/9/9/2r6/9/9/5N3/9/9/3K5 w - - 0 1', '马四进五'), ['c6'], 'a horse attacking a protected rook still wins material');
});

test('exceptions: exchanges (兑), king and pawn attackers, unmoved pawns as targets', () => {
  assert.deepEqual(chased('4k4/9/9/9/r8/9/9/9/2R6/3K5 w - - 0 1', '车七平九'), [], 'rook facing rook is an offer to exchange');
  assert.deepEqual(chased('4k4/9/n8/1P7/9/9/9/9/9/3K5 w - - 0 1', '兵八进一'), [], 'pawns may threaten freely');
  assert.deepEqual(chased('4k4/9/9/p8/9/9/9/9/2R6/3K5 w - - 0 1', '车七平九'), [], 'a pawn that has not crossed the river may be attacked');
  assert.deepEqual(chased('4k4/9/9/9/9/9/p8/9/2R6/3K5 w - - 0 1', '车七平九'), ['a3'], 'a crossed pawn may not');
});

test('discovered threats count; threats that already existed do not', () => {
  assert.deepEqual(chased('4k4/9/c8/9/9/N8/9/9/R8/3K5 w - - 0 1', '马九进七'), ['a7'], 'the horse uncovers the rook');
  assert.deepEqual(chased('4k4/9/n8/9/9/9/R8/9/9/3K5 w - - 0 1', '帅六进一'), [], 'the rook was already attacking');
});

function playCycles(fen, cycle, rounds = 3) {
  const g = new Game(fen);
  for (let i = 0; i < rounds && !g.result; i++) {
    for (const t of cycle) {
      if (g.result) break;
      const mv = fromChinese(g.pos, t);
      assert.notEqual(mv, null, t);
      g.play(mv);
    }
  }
  return g;
}

const CHASE_FEN = '4k4/9/n8/9/9/9/2R6/9/9/3K5 w - - 0 1';
const CHASE_CYCLE = ['车七平九', '马1进3', '车九平七', '马3退1'];

test('perpetually chasing one unprotected piece loses (长捉判负)', () => {
  const g = playCycles(CHASE_FEN, CHASE_CYCLE);
  assert.equal(g.records.length, 8, 'judged on the third occurrence');
  assert.equal(g.result.reason, '长捉');
  assert.equal(g.result.winner, BLACK);
  assert.equal(g.result.text, '黑方胜（红方长捉判负）');
  assert.deepEqual(g.pos.cycleStatus(g.pos.repCycle()), { check: [false, false], chase: [true, false] });
});

test('the same dance against a piece that is protected on one square is a draw', () => {
  const g = playCycles('r3k4/9/n8/9/9/9/2R6/9/9/3K5 w - - 0 1', CHASE_CYCLE);
  assert.equal(g.result.reason, '重复');
  assert.equal(g.result.winner, null);
});

test('rule hierarchy: perpetual check outranks perpetual chase; equal offences draw', () => {
  const v = (check, chase) => judgeRepetition({ check, chase });
  assert.deepEqual(v([true, false], [false, true]), { loser: RED, reason: '长将' });
  assert.deepEqual(v([false, true], [false, false]), { loser: BLACK, reason: '长将' });
  assert.equal(v([true, true], [false, false]), null);
  assert.deepEqual(v([false, false], [false, true]), { loser: BLACK, reason: '长捉' });
  assert.equal(v([false, false], [true, true]), null);
  assert.equal(v([false, false], [false, false]), null);
});

test('analysing a cycle leaves the position exactly as it was', () => {
  const g = playCycles(CHASE_FEN, CHASE_CYCLE.slice(0, 3).concat(['马3退1', '车七平九', '马1进3']), 1);
  const fen = g.pos.toFen(), key = g.pos.key, plies = g.pos.mvList.length;
  g.pos.cycleStatus(4);
  assert.equal(g.pos.toFen(), fen);
  assert.equal(g.pos.key, key);
  assert.equal(g.pos.mvList.length, plies);
});

test('the engine knows the rule: it completes a repetition that makes the chaser lose', () => {
  const g = new Game(CHASE_FEN);
  for (const t of [...CHASE_CYCLE, ...CHASE_CYCLE.slice(0, 3)]) g.play(fromChinese(g.pos, t));
  assert.equal(g.result, null);
  // Black to move: 马3退1 repeats the position a third time and Red loses by 长捉.
  const r = new Searcher({ ttBits: 16 }).search(g.pos, { timeMs: 600 });
  assert.equal(toChinese(g.pos, r.mv), '马3退1');
  assert.ok(r.score > 9000 && r.score < WIN, `scored as a win by rule (${r.score}), not as a draw`);
});
