// Piece values and piece-square tables (Red's point of view; Black is mirrored).
// Row 0 is the enemy's back rank, row 9 is our own. Values are in "centipawn-ish"
// units where an unadvanced pawn is 30 and a rook 400.
//
// The tables encode ordinary Xiangqi wisdom: pawns gain value once across the river
// and near the enemy palace; horses want the centre and the enemy's third rank;
// cannons like the central file and home rows; rooks like open, advanced files.

export const BASE = [0, 40, 40, 180, 400, 190, 30]; // K A B N R C P

const T = rows => rows.flat();

const KING = T([
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, -16, -12, -16, 0, 0, 0],
  [0, 0, 0, -8, -6, -8, 0, 0, 0],
  [0, 0, 0, 0, 4, 0, 0, 0, 0]
]);

const ADVISOR = T([
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, -2, 0, -2, 0, 0, 0],
  [0, 0, 0, 0, 4, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0]
]);

const BISHOP = T([
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, -2, 0, 0, 0, -2, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [-3, 0, 0, 0, 5, 0, 0, 0, -3],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 1, 0, 0]
]);

const KNIGHT = T([
  [-4, 4, 6, 10, 4, 10, 6, 4, -4],
  [6, 12, 20, 18, 10, 18, 20, 12, 6],
  [8, 20, 22, 28, 24, 28, 22, 20, 8],
  [8, 24, 22, 28, 26, 28, 22, 24, 8],
  [4, 18, 20, 24, 22, 24, 20, 18, 4],
  [4, 10, 16, 20, 20, 20, 16, 10, 4],
  [2, 8, 12, 10, 12, 10, 12, 8, 2],
  [2, 4, 8, 6, 10, 6, 8, 4, 2],
  [-6, 0, 4, 2, -8, 2, 4, 0, -6],
  [-8, -4, 0, -4, -6, -4, 0, -4, -8]
]);

const ROOK = T([
  [6, 8, 6, 12, 14, 12, 6, 8, 6],
  [8, 12, 10, 14, 20, 14, 10, 12, 8],
  [6, 8, 6, 10, 12, 10, 6, 8, 6],
  [6, 10, 8, 12, 12, 12, 8, 10, 6],
  [8, 12, 12, 14, 14, 14, 12, 12, 8],
  [8, 10, 10, 14, 14, 14, 10, 10, 8],
  [4, 8, 6, 10, 10, 10, 6, 8, 4],
  [-2, 8, 4, 10, 6, 10, 4, 8, -2],
  [2, 8, 4, 8, 0, 8, 4, 8, 2],
  [-4, 6, 4, 8, 2, 8, 4, 6, -4]
]);

const CANNON = T([
  [6, 4, 0, -6, -8, -6, 0, 4, 6],
  [2, 2, 0, -4, -10, -4, 0, 2, 2],
  [2, 2, 0, -6, -4, -6, 0, 2, 2],
  [0, 0, -2, 4, 6, 4, -2, 0, 0],
  [0, 0, 0, 2, 8, 2, 0, 0, 0],
  [-2, 0, 4, 2, 6, 2, 4, 0, -2],
  [0, 0, 0, 2, 4, 2, 0, 0, 0],
  [2, 0, 6, 4, 8, 4, 6, 0, 2],
  [0, 2, 4, 6, 6, 6, 4, 2, 0],
  [0, 0, 2, 6, 6, 6, 2, 0, 0]
]);

const PAWN = T([
  [0, 0, 0, 2, 4, 2, 0, 0, 0],
  [10, 20, 30, 50, 60, 50, 30, 20, 10],
  [10, 20, 30, 40, 46, 40, 30, 20, 10],
  [10, 18, 22, 30, 34, 30, 22, 18, 10],
  [6, 12, 14, 16, 18, 16, 14, 12, 6],
  [0, 0, 4, 0, 6, 0, 4, 0, 0],
  [0, 0, -2, 0, 4, 0, -2, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0]
]);

const TABLES = [KING, ADVISOR, BISHOP, KNIGHT, ROOK, CANNON, PAWN];

// Precomputed value for every (piece code, 16×16 square).
const VALUE = new Int16Array(24 * 256);
for (const tag of [8, 16]) {
  for (let t = 0; t < 7; t++) {
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const ry = tag === 8 ? y : 9 - y; // Black sees the board upside down
        const s = ((y + 3) << 4) + x + 3;
        VALUE[((tag + t) << 8) + s] = BASE[t] + TABLES[t][ry * 9 + x];
      }
    }
  }
}

export function pieceSquareValue(pc, s) {
  return VALUE[(pc << 8) + s];
}

// Most-valuable-victim / least-valuable-attacker weights for capture ordering.
export const MVV = [1000, 20, 20, 40, 90, 45, 10];
export const LVA = [5, 1, 1, 3, 4, 3, 2];
