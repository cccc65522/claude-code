// Brute-force "is there a forced mate within n plies" over all legal moves.
// Independent of the search engine (no pruning, no tables), used to prove puzzle answers.
// Xiangqi rule: a side with no legal move loses, in check or not.

export function forcedWin(pos, plies) {
  // Side to move wins within `plies` plies (odd numbers: our move last).
  if (plies <= 0) return false;
  for (const mv of pos.legalMoves()) {
    pos.makeMove(mv);
    const win = opponentLost(pos, plies - 1);
    pos.undoMove();
    if (win) return true;
  }
  return false;
}

function opponentLost(pos, plies) {
  const replies = pos.legalMoves();
  if (replies.length === 0) return true;
  if (plies <= 0) return false;
  for (const mv of replies) {
    pos.makeMove(mv);
    const ok = forcedWin(pos, plies - 1);
    pos.undoMove();
    if (!ok) return false;
  }
  return true;
}

// Smallest odd n ≤ max with a forced win in n plies, or null.
export function mateLength(pos, max = 5) {
  for (let n = 1; n <= max; n += 2) if (forcedWin(pos, n)) return n;
  return null;
}
