// 方块定义。id 0 是空气。tiles 是纹理图集里的格子编号（见 atlas.js）。
export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const LOG = 5;
export const LEAVES = 6;
export const PLANKS = 7;
export const GLASS = 8;
export const BRICK = 9;
export const SNOW = 10;
export const BEDROCK = 11;

// 图集格子编号
export const TILE = {
  grassTop: 0,
  grassSide: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
  logSide: 5,
  logTop: 6,
  leaves: 7,
  planks: 8,
  glass: 9,
  brick: 10,
  snowTop: 11,
  snowSide: 12,
  bedrock: 13,
};

const all = (t) => ({ top: t, side: t, bottom: t });

export const BLOCKS = {
  [GRASS]: { name: '草方块', tiles: { top: TILE.grassTop, side: TILE.grassSide, bottom: TILE.dirt } },
  [DIRT]: { name: '泥土', tiles: all(TILE.dirt) },
  [STONE]: { name: '石头', tiles: all(TILE.stone) },
  [SAND]: { name: '沙子', tiles: all(TILE.sand) },
  [LOG]: { name: '原木', tiles: { top: TILE.logTop, side: TILE.logSide, bottom: TILE.logTop } },
  [LEAVES]: { name: '树叶', tiles: all(TILE.leaves), transparent: true },
  [PLANKS]: { name: '木板', tiles: all(TILE.planks) },
  [GLASS]: { name: '玻璃', tiles: all(TILE.glass), transparent: true },
  [BRICK]: { name: '砖块', tiles: all(TILE.brick) },
  [SNOW]: { name: '雪地', tiles: { top: TILE.snowTop, side: TILE.snowSide, bottom: TILE.dirt } },
  [BEDROCK]: { name: '基岩', tiles: all(TILE.bedrock), unbreakable: true },
};

// 快捷栏里能放的方块（按 1-9 选择）
export const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, GLASS, BRICK];

export function isTransparent(id) {
  return id === AIR || BLOCKS[id]?.transparent === true;
}

// 会挡住光线、用来算环境光遮蔽的方块
export function isOpaque(id) {
  return id !== AIR && !BLOCKS[id]?.transparent;
}
