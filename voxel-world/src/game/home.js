import { BED, BLOCKS, CHEST } from './blocks.js';
import { SEEDS, addItem, countOf, itemName, sanitizeInventory, takeItem } from './items.js';

// 家：床（睡觉、重生点）、箱子（存东西）、快捷栏最后一格（自选）。

export const SLEEP_MONSTER_RADIUS = 8;

/**
 * 能不能睡觉。day: 天亮程度 0–1；monsters：怪物列表；pos：床的位置。
 * 返回 { ok, reason }。
 */
export function sleepCheck(day, monsters, pos) {
  if (day >= 0.5) return { ok: false, reason: '现在是白天，睡不着' };
  const near = monsters.some(
    (m) => m.dissolve === 0 && Math.hypot(m.pos[0] - pos[0] - 0.5, m.pos[2] - pos[2] - 0.5) < SLEEP_MONSTER_RADIUS,
  );
  if (near) return { ok: false, reason: '附近有夜影，睡不着' };
  return { ok: true };
}

/**
 * 重生在哪：床还在就在床上，不然回出生点。
 * 返回 { pos, lostBed }。
 */
export function respawnPoint(world, spawn) {
  if (Array.isArray(spawn) && spawn.length === 3 && world.get(...spawn) === BED) {
    const [x, y, z] = spawn;
    return { pos: [x + 0.5, y + 1, z + 0.5], lostBed: false };
  }
  return { pos: world.spawnPoint(), lostBed: Array.isArray(spawn) };
}

// 快捷栏最后一格能放什么：能放的方块（不包括水和基岩）和麦种
export function canUseCustomSlot(id) {
  if (id === SEEDS) return true;
  const def = BLOCKS[id];
  return Boolean(def) && !def.liquid && !def.unbreakable && def.shape !== 'crop' && id !== 0;
}

// 创造模式的方块选择器里列出的东西
export function creativePalette() {
  const ids = Object.keys(BLOCKS).map(Number).filter(canUseCustomSlot);
  return [...ids.sort((a, b) => a - b), SEEDS];
}

// ---------- 箱子 ----------
export const chestKey = (x, y, z) => `${x},${y},${z}`;

// 在两个“背包”（物品 → 数量）之间搬东西，返回实际搬了多少
export function transfer(from, to, id, n) {
  const moved = Math.min(n, countOf(from, id));
  if (moved <= 0) return 0;
  takeItem(from, id, moved);
  addItem(to, id, moved);
  return moved;
}

// 箱子被挖掉：里面的东西全部倒进背包。返回倒出来的件数。
export function emptyChestInto(chests, key, inventory) {
  const box = chests.get(key);
  chests.delete(key);
  if (!box) return 0;
  let n = 0;
  for (const [id, count] of Object.entries(box)) {
    addItem(inventory, Number(id), count);
    n += count;
  }
  return n;
}

export function serializeChests(chests) {
  const out = {};
  for (const [key, box] of chests) if (Object.keys(box).length) out[key] = box;
  return out;
}

// 读档：只留下世界里确实还是箱子的位置
export function deserializeChests(raw, world) {
  const chests = new Map();
  if (!raw || typeof raw !== 'object') return chests;
  for (const [key, box] of Object.entries(raw)) {
    const parts = key.split(',').map(Number);
    if (parts.length !== 3 || !parts.every(Number.isInteger)) continue;
    if (world.get(...parts) !== CHEST) continue;
    chests.set(chestKey(...parts), sanitizeInventory(box));
  }
  return chests;
}

export function describeChest(box) {
  const ids = Object.keys(box);
  if (!ids.length) return '空的';
  return ids.map((id) => `${itemName(Number(id))} ×${box[id]}`).join('、');
}

