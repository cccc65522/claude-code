import {
  AIR, BLOCKS, BRICK, COAL_ORE, DIRT, FARMLAND, GLASS, GRASS, IRON_ORE, LEAVES, LOG, PLANKS, SAND, SNOW, STONE, TILE, TORCH, isCrop,
} from './blocks.js';

// 物品 = 方块（id < 100）+ 不能放的材料（id >= 100）
export const STICK = 100;
export const COAL = 101;
export const STONE_PICKAXE = 102;
export const STONE_SHOVEL = 103;
export const STONE_AXE = 104;
export const IRON_PICKAXE = 105;
export const IRON_INGOT = 106;
export const BUCKET = 107;
export const WATER_BUCKET = 108;
export const APPLE = 109;
export const BERRIES = 110;
export const PIE = 111;
export const SEEDS = 112;
export const WHEAT = 113;
export const BREAD = 114;
export const STONE_HOE = 115;
export const RAW_MEAT = 116;
export const COOKED_MEAT = 117;

export const ITEMS = {
  [STICK]: { name: '木棍', icon: TILE.stick },
  [COAL]: { name: '煤炭', icon: TILE.coal },
  [IRON_INGOT]: { name: '铁锭', icon: TILE.ironIngot },
  [STONE_PICKAXE]: { name: '石镐', icon: TILE.stonePickaxe },
  [STONE_SHOVEL]: { name: '石铲', icon: TILE.stoneShovel },
  [STONE_AXE]: { name: '石斧', icon: TILE.stoneAxe },
  [IRON_PICKAXE]: { name: '铁镐', icon: TILE.ironPickaxe },
  [BUCKET]: { name: '空桶', icon: TILE.bucket },
  [WATER_BUCKET]: { name: '水桶', icon: TILE.waterBucket },
  [APPLE]: { name: '苹果', icon: TILE.apple, food: 4 },
  [BERRIES]: { name: '野莓', icon: TILE.berries, food: 2 },
  [PIE]: { name: '果派', icon: TILE.pie, food: 10 },
  [SEEDS]: { name: '麦种', icon: TILE.seeds },
  [WHEAT]: { name: '小麦', icon: TILE.wheatItem },
  [BREAD]: { name: '面包', icon: TILE.bread, food: 6 },
  [STONE_HOE]: { name: '石锄', icon: TILE.stoneHoe },
  [RAW_MEAT]: { name: '生肉', icon: TILE.rawMeat, food: 2 },
  [COOKED_MEAT]: { name: '烤肉', icon: TILE.cookedMeat, food: 8 },
};

export function itemName(id) {
  return BLOCKS[id]?.name ?? ITEMS[id]?.name ?? '?';
}

export function itemIcon(id) {
  return BLOCKS[id]?.tiles.side ?? ITEMS[id]?.icon ?? 0;
}

export function isPlaceable(id) {
  return BLOCKS[id] !== undefined && id !== AIR;
}

// 挖掉一个方块得到什么（null = 什么都没有）
export function dropFor(blockId) {
  if (blockId === GRASS || blockId === SNOW || blockId === FARMLAND) return DIRT;
  if (isCrop(blockId)) return null; // 庄稼的收获见 farming.js 的 cropDrops
  if (blockId === COAL_ORE) return COAL;
  const def = BLOCKS[blockId];
  if (!def || def.unbreakable || def.liquid) return null;
  return blockId;
}

// 生存模式的快捷栏（1–9 选方块，0 空桶，- 水桶，= 麦种）。工具不用选，挖的时候自动用。
export const SURVIVAL_HOTBAR = [DIRT, STONE, SAND, LOG, PLANKS, LEAVES, GLASS, BRICK, TORCH, BUCKET, WATER_BUCKET, SEEDS];

// 背包里的显示顺序
export const ITEM_ORDER = [
  DIRT, STONE, SAND, LOG, PLANKS, STICK, COAL, IRON_ORE, IRON_INGOT, LEAVES, GLASS, BRICK, TORCH,
  STONE_PICKAXE, IRON_PICKAXE, STONE_SHOVEL, STONE_AXE, STONE_HOE, BUCKET, WATER_BUCKET,
  SEEDS, WHEAT, APPLE, BERRIES, BREAD, PIE, RAW_MEAT, COOKED_MEAT,
];

// ---------- 食物 ----------
export const FOODS = [APPLE, BERRIES, RAW_MEAT, BREAD, COOKED_MEAT, PIE];

export function foodValue(id) {
  return ITEMS[id]?.food ?? 0;
}

// 挖方块时额外掉的东西（有几率）：树叶掉苹果，草方块里挖出野莓或麦种
export function bonusDrop(blockId, rand = Math.random) {
  if (blockId === LEAVES) return rand() < 0.1 ? APPLE : null;
  if (blockId === GRASS) {
    const r = rand();
    if (r < 0.15) return BERRIES;
    if (r < 0.4) return SEEDS;
  }
  return null;
}

// 自动挑一样吃的：尽量不浪费——先找吃了不会超过上限的里面最顶饱的，没有就挑最小的
export function bestFood(inv, hunger, max = 20) {
  const owned = FOODS.filter((id) => countOf(inv, id) > 0);
  if (!owned.length) return null;
  const missing = max - hunger;
  const fits = owned.filter((id) => foodValue(id) <= missing).sort((a, b) => foodValue(b) - foodValue(a));
  if (fits.length) return fits[0];
  return owned.sort((a, b) => foodValue(a) - foodValue(b))[0];
}

/**
 * 吃东西。返回 { ok, gained, reason }。
 */
export function eat(inv, p, id, max = 20) {
  if (!foodValue(id)) return { ok: false, reason: '这个不能吃' };
  if (p.hunger >= max) return { ok: false, reason: '已经吃饱了' };
  if (!takeItem(inv, id)) return { ok: false, reason: `没有${itemName(id)}` };
  const before = p.hunger;
  p.hunger = Math.min(max, p.hunger + foodValue(id));
  return { ok: true, gained: p.hunger - before };
}

export function countOf(inv, id) {
  return inv[id] ?? 0;
}

export function addItem(inv, id, n = 1) {
  inv[id] = countOf(inv, id) + n;
}

export function takeItem(inv, id, n = 1) {
  if (countOf(inv, id) < n) return false;
  inv[id] -= n;
  if (inv[id] === 0) delete inv[id];
  return true;
}

export const MAX_STACK = 9999;

// 读档：只留下认识的物品和合理的数量
export function sanitizeInventory(raw) {
  const inv = {};
  if (!raw || typeof raw !== 'object') return inv;
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key);
    if (!Number.isInteger(id) || !Number.isInteger(value) || value <= 0) continue;
    if (!BLOCKS[id] && !ITEMS[id]) continue;
    inv[id] = Math.min(value, MAX_STACK);
  }
  return inv;
}
