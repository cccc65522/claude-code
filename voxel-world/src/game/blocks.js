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
export const WATER = 12; // 水源
export const TORCH = 13;
export const COAL_ORE = 14;
export const IRON_ORE = 15;
export const FARMLAND = 16;
export const EGG = 17; // 圆圆鸭下的蛋，放在地上
export const BED = 18;
export const CHEST = 31;
// 门：32–47。下半 / 上半 × 关 / 开 × 4 个朝向（见 doorId）
export const DOOR_BASE = 32;
// 梯子：48–51，4 个朝向（贴在哪一面墙上）
export const LADDER_BASE = 48;
export const CACTUS = 52;
export const ICE = 53;
export const SANDSTONE = 54;
// 朝向：0 = 北（-z），1 = 东（+x），2 = 南（+z），3 = 西（-x）
export const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// 小麦：27–30，四个生长阶段（30 成熟）
export const WHEAT_BASE = 27;
export const WHEAT_STAGES = 4;
// 流动的水：20–26，水位 1–7（7 最满，离水源最近）
export const FLOW_BASE = 19;
export const FLOW_MAX = 7;

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
  water: 14,
  torch: 15,
  coalOre: 16,
  stick: 17,
  coal: 18,
  ironOre: 19,
  ironIngot: 20,
  bucket: 21,
  waterBucket: 22,
  stonePickaxe: 23,
  stoneShovel: 24,
  stoneAxe: 25,
  ironPickaxe: 26,
  apple: 27,
  berries: 28,
  pie: 29,
  farmland: 30,
  wheat0: 31,
  wheat1: 32,
  wheat2: 33,
  wheat3: 34,
  seeds: 35,
  wheatItem: 36,
  bread: 37,
  stoneHoe: 38,
  rawMeat: 39,
  cookedMeat: 40,
  duckEgg: 41,
  eggPancake: 42,
  eggBlock: 43,
  bedTop: 44,
  bedSide: 45,
  chestTop: 46,
  chestSide: 47,
  doorBottom: 48,
  doorTop: 49,
  ladder: 50,
  cactusSide: 51,
  cactusTop: 52,
  ice: 53,
  sandstoneSide: 54,
  sandstoneTop: 55,
  scale: 56,
  scaleArmor: 57,
  ironArmor: 58,
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
  [COAL_ORE]: { name: '煤矿石', tiles: all(TILE.coalOre) },
  [IRON_ORE]: { name: '铁矿石', tiles: all(TILE.ironOre) },
  // 床：矮矮的一格，右键睡觉、设重生点
  [BED]: { name: '床', tiles: { top: TILE.bedTop, side: TILE.bedSide, bottom: TILE.planks }, transparent: true, shape: 'bed', interact: 'sleep' },
  // 箱子：右键打开存东西
  [CHEST]: { name: '箱子', tiles: { top: TILE.chestTop, side: TILE.chestSide, bottom: TILE.chestTop }, interact: 'chest' },
  // 仙人掌：长在沙子上，碰到会扎人；底下没了支撑整根倒
  [CACTUS]: { name: '仙人掌', tiles: { top: TILE.cactusTop, side: TILE.cactusSide, bottom: TILE.cactusTop }, transparent: true, shape: 'cactus' },
  // 冰：雪原里的湖面结的冰，上面很滑；挖开会变回水
  [ICE]: { name: '冰', tiles: all(TILE.ice), slippery: true },
  [SANDSTONE]: { name: '砂岩', tiles: { top: TILE.sandstoneTop, side: TILE.sandstoneSide, bottom: TILE.sandstoneTop } },
  [EGG]: { name: '鸭蛋', tiles: all(TILE.eggBlock), transparent: true, passable: true, shape: 'egg' },
  [FARMLAND]: { name: '耕地', tiles: { top: TILE.farmland, side: TILE.dirt, bottom: TILE.dirt } },
  // 水源：半透明、能穿过、能游泳；会往低处和四周流
  [WATER]: { name: '水', tiles: all(TILE.water), transparent: true, liquid: true, passable: true },
  // 火把：只能立在实心方块上，会发光
  [TORCH]: { name: '火把', tiles: all(TILE.torch), transparent: true, passable: true, shape: 'torch', light: 14 },
};

// 小麦：交叉的两片贴图，能穿过，一碰就掉，只能长在耕地上
// 门：一块薄木板，关着挡路、开着能过；上下两半各是一个方块
for (let half = 0; half < 2; half++) {
  for (let open = 0; open < 2; open++) {
    for (let facing = 0; facing < 4; facing++) {
      BLOCKS[DOOR_BASE + half * 8 + open * 4 + facing] = {
        name: '门',
        tiles: all(half ? TILE.doorTop : TILE.doorBottom),
        transparent: true,
        passable: open === 1,
        shape: 'door',
        door: { half, open: open === 1, facing },
        interact: 'door',
      };
    }
  }
}

// 梯子：贴在墙上的一层，能穿过，站在上面能爬
for (let facing = 0; facing < 4; facing++) {
  BLOCKS[LADDER_BASE + facing] = { name: '梯子', tiles: all(TILE.ladder), transparent: true, passable: true, shape: 'ladder', ladder: facing };
}

for (let stage = 0; stage < WHEAT_STAGES; stage++) {
  BLOCKS[WHEAT_BASE + stage] = {
    name: stage === WHEAT_STAGES - 1 ? '成熟的小麦' : '小麦苗',
    tiles: all(TILE.wheat0 + stage),
    transparent: true,
    passable: true,
    shape: 'crop',
    stage,
  };
}

for (let level = 1; level <= FLOW_MAX; level++) {
  BLOCKS[FLOW_BASE + level] = {
    name: '流动的水',
    tiles: all(TILE.water),
    transparent: true,
    liquid: true,
    passable: true,
    level,
  };
}

// 快捷栏里能放的方块（按 1-9、0 选择）
// 第 12 格（=）是麦种（物品 112，定义在 items.js）
export const HOTBAR = [GRASS, DIRT, STONE, SAND, LOG, PLANKS, LEAVES, GLASS, BRICK, TORCH, WATER, 112];

// 快捷栏每格对应的按键
export const HOTBAR_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

export function isLiquid(id) {
  return BLOCKS[id]?.liquid === true;
}

export function isFlowing(id) {
  return id > FLOW_BASE && id <= FLOW_BASE + FLOW_MAX;
}

export function flowId(level) {
  return FLOW_BASE + level;
}

// 水位：水源 8，流动的水 1–7，其它 0
export function waterLevel(id) {
  if (id === WATER) return 8;
  return isFlowing(id) ? id - FLOW_BASE : 0;
}

// 人能不能穿过（空气、水、火把）
export function doorId(half, open, facing) {
  return DOOR_BASE + half * 8 + (open ? 4 : 0) + facing;
}

export function isDoor(id) {
  return id >= DOOR_BASE && id < DOOR_BASE + 16;
}

export function isLadder(id) {
  return id >= LADDER_BASE && id < LADDER_BASE + 4;
}

export function isCrop(id) {
  return id >= WHEAT_BASE && id < WHEAT_BASE + WHEAT_STAGES;
}

export function cropStage(id) {
  return isCrop(id) ? id - WHEAT_BASE : -1;
}

export function isPassable(id) {
  return id === AIR || BLOCKS[id]?.passable === true;
}

export function isTransparent(id) {
  return id === AIR || BLOCKS[id]?.transparent === true;
}

// 会挡住光线、用来算环境光遮蔽的方块
export function isOpaque(id) {
  return id !== AIR && !BLOCKS[id]?.transparent;
}
