// Mating puzzles, Red to move. Every position's mate length is proven by an exhaustive
// search in the unit tests (tests/unit/mate-solver.js), independent of the engine.
// `moves` is the number of Red moves needed (plies = 2 * moves - 1).

export const PUZZLES = [
  { id: 'p1', name: '双车错', moves: 1, fen: '4k4/R8/9/9/9/8R/9/9/9/3K5 w - - 0 1', hint: '一车封住将门，另一车沉底。' },
  { id: 'p2', name: '马后炮', moves: 1, fen: '4k4/9/9/2N6/9/9/4C4/9/9/3K5 w - - 0 1', hint: '马给炮当炮架，同时看住将的去路。' },
  { id: 'p3', name: '白脸将', moves: 2, fen: '3a1k3/4a4/4b4/9/2R6/9/9/4C4/9/3K5 w - - 0 1', hint: '别忘了将帅不能照面。' },
  { id: 'p4', name: '车马联攻', moves: 3, fen: '2bak4/9/9/9/1N7/9/7R1/9/5K3/9 w - - 0 1', hint: '先用车把将赶上去。' },
  { id: 'p5', name: '兵马破士', moves: 3, fen: '5a3/4k4/5aP2/5N3/9/9/9/9/3K5/9 w - - 0 1', hint: '小兵也能当先锋。' },
  { id: 'p6', name: '车炮抽将', moves: 3, fen: '2ba5/3k5/3ab4/4R4/9/4C4/9/9/2C2K3/9 w - - 0 1', hint: '炮先平到将所在的那一路。' },
  { id: 'p7', name: '双马饮泉', moves: 3, fen: '3a5/3k5/3aR4/9/9/9/9/2N2N3/9/3K5 w - - 0 1', hint: '第一步不将军，先让马靠近。' },
  { id: 'p8', name: '双炮夹马', moves: 3, fen: '2bk2C2/2N6/b4a3/9/9/9/9/9/4K4/2C6 w - - 0 1', hint: '远处的炮先回来。' },
  { id: 'p9', name: '车双炮', moves: 3, fen: '9/4ak3/5C3/9/2b3b1p/9/4R4/9/2C6/5K3 w - - 0 1', hint: '炮退一步，让车有路可走。' }
];
