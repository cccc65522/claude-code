import {
  BRICK, COAL_ORE, DIRT, GLASS, GRASS, IRON_ORE, LEAVES, LOG, PLANKS, SAND, SNOW, STONE, TORCH, BLOCKS,
} from './blocks.js';
import { IRON_PICKAXE, STONE_AXE, STONE_PICKAXE, STONE_SHOVEL, countOf } from './items.js';

// 生存模式挖方块要花时间（秒，空手）。没写的方块默认 1 秒。
export const HARDNESS = {
  [GRASS]: 0.6, [DIRT]: 0.5, [SAND]: 0.5, [SNOW]: 0.5,
  [LEAVES]: 0.25, [LOG]: 1.6, [PLANKS]: 1.4,
  [STONE]: 1.8, [COAL_ORE]: 2.2, [IRON_ORE]: 2.8, [BRICK]: 1.8,
  [GLASS]: 0.35, [TORCH]: 0,
};

// 每种方块用什么工具挖更快
export const TOOL_KIND = {
  [GRASS]: 'shovel', [DIRT]: 'shovel', [SAND]: 'shovel', [SNOW]: 'shovel',
  [LOG]: 'axe', [PLANKS]: 'axe', [LEAVES]: 'axe',
  [STONE]: 'pickaxe', [COAL_ORE]: 'pickaxe', [IRON_ORE]: 'pickaxe', [BRICK]: 'pickaxe', [GLASS]: 'pickaxe',
};

// 没有对应工具就挖不动的方块
export const NEEDS_TOOL = { [IRON_ORE]: 'pickaxe' };

export const TOOLS = {
  [STONE_PICKAXE]: { kind: 'pickaxe', speed: 4 },
  [IRON_PICKAXE]: { kind: 'pickaxe', speed: 8 },
  [STONE_SHOVEL]: { kind: 'shovel', speed: 4 },
  [STONE_AXE]: { kind: 'axe', speed: 4 },
};

const KIND_NAME = { pickaxe: '镐', shovel: '铲', axe: '斧' };
export function toolKindName(kind) {
  return KIND_NAME[kind] ?? '';
}

// 背包里某一类最好的工具（没有就是 null）
export function bestTool(inv, kind) {
  let best = null;
  for (const [id, tool] of Object.entries(TOOLS)) {
    if (tool.kind !== kind || countOf(inv, Number(id)) <= 0) continue;
    if (!best || tool.speed > TOOLS[best].speed) best = Number(id);
  }
  return best;
}

/**
 * 生存模式挖一个方块要几秒；挖不动返回 Infinity。
 * 返回 { time, tool }，tool 是用到的工具（空手为 null）。
 */
export function digInfo(blockId, inv) {
  const def = BLOCKS[blockId];
  if (!def || def.unbreakable || def.liquid) return { time: Infinity, tool: null };
  const base = HARDNESS[blockId] ?? 1;
  const kind = TOOL_KIND[blockId];
  const tool = kind ? bestTool(inv, kind) : null;
  if (NEEDS_TOOL[blockId] && !tool) return { time: Infinity, tool: null, needs: NEEDS_TOOL[blockId] };
  return { time: tool ? base / TOOLS[tool].speed : base, tool };
}


// 打怪的伤害：空手 2，有石镐 3，有石斧 4，有铁镐 5（自动用最好的）
export function attackDamage(inv) {
  if (countOf(inv, IRON_PICKAXE) > 0) return 5;
  if (countOf(inv, STONE_AXE) > 0) return 4;
  if (countOf(inv, STONE_PICKAXE) > 0) return 3;
  return 2;
}
