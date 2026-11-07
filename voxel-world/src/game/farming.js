import { AIR, DIRT, FARMLAND, GRASS, WHEAT_BASE, WHEAT_STAGES, cropStage, isCrop, isLiquid } from './blocks.js';
import { SEEDS, WHEAT } from './items.js';

// 耕种：种子种在耕地上，一步步长大；附近有水长得快。

export const WET_RADIUS = 4; // 耕地周围 4 格内有水就算湿润
export const GROW_STEP = 1; // 每隔几秒判断一次要不要长
export const GROW_CHANCE_DRY = 1 / 30;
export const GROW_CHANCE_WET = 1 / 12;

// 植物要靠什么托着
export function supportedBy(plant, below) {
  if (isCrop(plant)) return below === FARMLAND;
  return true;
}

// 对着 hit 这一格用种子：能不能种，需不需要先翻土
export function plantTarget(world, hit) {
  const [x, y, z] = hit;
  const base = world.get(x, y, z);
  if (base !== GRASS && base !== DIRT && base !== FARMLAND) {
    return { error: '种子要种在草地、泥土或耕地上' };
  }
  if (world.get(x, y + 1, z) !== AIR) return { error: '上面要空着才能种' };
  return { till: base !== FARMLAND, base: [x, y, z], above: [x, y + 1, z] };
}

// 耕地 (x,y,z) 附近（同一层和上一层，4 格以内）有没有水
export function isWet(world, x, y, z) {
  for (let dy = 0; dy <= 1; dy++) {
    for (let dz = -WET_RADIUS; dz <= WET_RADIUS; dz++) {
      for (let dx = -WET_RADIUS; dx <= WET_RADIUS; dx++) {
        if (isLiquid(world.get(x + dx, y + dy, z + dz))) return true;
      }
    }
  }
  return false;
}

/**
 * 让一批庄稼按概率长一阶。crops 是庄稼所在格子的下标集合（会顺手去掉已经不是庄稼的）。
 * 返回长了的格子下标。
 */
export function growCrops(world, crops, rand = Math.random) {
  const grown = [];
  for (const i of crops) {
    const id = world.data[i];
    if (!isCrop(id)) {
      crops.delete(i);
      continue;
    }
    const stage = cropStage(id);
    if (stage >= WHEAT_STAGES - 1) continue;
    const [x, y, z] = world.coords(i);
    const chance = isWet(world, x, y - 1, z) ? GROW_CHANCE_WET : GROW_CHANCE_DRY;
    if (rand() >= chance) continue;
    world.set(x, y, z, WHEAT_BASE + stage + 1);
    grown.push(i);
  }
  return grown;
}

// 收割：成熟的给小麦和 1–2 颗种子，没熟的只把种子还回来
export function cropDrops(id, rand = Math.random) {
  if (!isCrop(id)) return [];
  if (cropStage(id) < WHEAT_STAGES - 1) return [[SEEDS, 1]];
  return [[WHEAT, 1], [SEEDS, rand() < 0.5 ? 1 : 2]];
}
