import {
  AIR, BLOCKS, BRICK, COAL_ORE, DIRT, GLASS, GRASS, IRON_ORE, LEAVES, LOG, PLANKS, SAND, SNOW, STONE, TILE, TORCH,
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
  if (blockId === GRASS || blockId === SNOW) return DIRT;
  if (blockId === COAL_ORE) return COAL;
  const def = BLOCKS[blockId];
  if (!def || def.unbreakable || def.liquid) return null;
  return blockId;
}

// 生存模式的快捷栏（1–9 选方块，0 空桶，- 水桶）。工具不用选，挖的时候自动用。
export const SURVIVAL_HOTBAR = [DIRT, STONE, SAND, LOG, PLANKS, LEAVES, GLASS, BRICK, TORCH, BUCKET, WATER_BUCKET];

// 背包里的显示顺序
export const ITEM_ORDER = [
  DIRT, STONE, SAND, LOG, PLANKS, STICK, COAL, IRON_ORE, IRON_INGOT, LEAVES, GLASS, BRICK, TORCH,
  STONE_PICKAXE, IRON_PICKAXE, STONE_SHOVEL, STONE_AXE, BUCKET, WATER_BUCKET,
];

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
