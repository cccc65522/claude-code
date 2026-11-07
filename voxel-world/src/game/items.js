import {
  AIR, BLOCKS, BRICK, COAL_ORE, DIRT, GLASS, GRASS, LEAVES, LOG, PLANKS, SAND, SNOW, STONE, TILE, TORCH,
} from './blocks.js';

// 物品 = 方块（id < 100）+ 不能放的材料（id >= 100）
export const STICK = 100;
export const COAL = 101;

export const ITEMS = {
  [STICK]: { name: '木棍', icon: TILE.stick },
  [COAL]: { name: '煤炭', icon: TILE.coal },
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

// 生存模式的快捷栏（按 1–9 选择）
export const SURVIVAL_HOTBAR = [DIRT, STONE, SAND, LOG, PLANKS, LEAVES, GLASS, BRICK, TORCH];

// 背包里的显示顺序
export const ITEM_ORDER = [DIRT, STONE, SAND, LOG, PLANKS, STICK, COAL, LEAVES, GLASS, BRICK, TORCH];

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
