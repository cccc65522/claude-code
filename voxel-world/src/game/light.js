import { BLOCKS, isOpaque } from './blocks.js';

// 火把光照：从每个火把出发做广度优先扩散，每走一格亮度减 1，
// 实心不透明的方块会挡光（水、玻璃、树叶不挡）。
export const MAX_LIGHT = 15;

// 光照等级 → 亮度（0–1），越远衰减越快
const CURVE = Array.from({ length: MAX_LIGHT + 1 }, (_, l) => (l === 0 ? 0 : Math.pow(0.8, 14 - Math.min(l, 14))));
export function lightBrightness(level) {
  return CURVE[level] ?? 0;
}

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function computeLight(world) {
  const { data, light } = world;
  light.fill(0);
  const queue = [];
  for (let i = 0; i < data.length; i++) {
    const level = BLOCKS[data[i]]?.light;
    if (level) {
      light[i] = level;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const level = light[i] - 1;
    if (level <= 0) continue;
    const [x, y, z] = world.coords(i);
    for (const [dx, dy, dz] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (!world.inBounds(nx, ny, nz)) continue;
      const n = world.index(nx, ny, nz);
      if (light[n] >= level || isOpaque(data[n])) continue;
      light[n] = level;
      queue.push(n);
    }
  }
}

// 重算光照，返回光照有变化的格子下标
export function relight(world) {
  const old = world.light.slice();
  computeLight(world);
  const changed = [];
  const { light } = world;
  for (let i = 0; i < light.length; i++) if (light[i] !== old[i]) changed.push(i);
  return changed;
}
