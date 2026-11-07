import { AIR, WATER } from './blocks.js';

/**
 * 体素射线检测（逐格步进）。
 * 水会被穿过（能隔着水挖水底的方块）。
 * 返回第一个碰到的方块坐标 hit、碰到的那个面的法线 normal（放方块的位置 = hit + normal）。
 */
export function raycast(world, origin, dir, maxDist = 6) {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (len === 0) return null;
  const d = [dir[0] / len, dir[1] / len, dir[2] / len];
  const pos = [Math.floor(origin[0]), Math.floor(origin[1]), Math.floor(origin[2])];
  const step = [0, 0, 0];
  const tMax = [Infinity, Infinity, Infinity];
  const tDelta = [Infinity, Infinity, Infinity];

  for (let a = 0; a < 3; a++) {
    if (d[a] > 0) {
      step[a] = 1;
      tDelta[a] = 1 / d[a];
      tMax[a] = (pos[a] + 1 - origin[a]) / d[a];
    } else if (d[a] < 0) {
      step[a] = -1;
      tDelta[a] = -1 / d[a];
      tMax[a] = (origin[a] - pos[a]) / -d[a];
    }
  }

  const normal = [0, 0, 0];
  let t = 0;
  while (t <= maxDist) {
    const id = world.get(pos[0], pos[1], pos[2]);
    if (id !== AIR && id !== WATER) {
      return { hit: [...pos], normal: [...normal], block: id, distance: t };
    }
    let axis = 0;
    if (tMax[1] < tMax[axis]) axis = 1;
    if (tMax[2] < tMax[axis]) axis = 2;
    t = tMax[axis];
    pos[axis] += step[axis];
    tMax[axis] += tDelta[axis];
    normal[0] = normal[1] = normal[2] = 0;
    normal[axis] = -step[axis];
  }
  return null;
}
