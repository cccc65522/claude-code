import { AIR, TORCH, WATER, FLOW_MAX, flowId, isCrop, isFlowing, isLiquid, waterLevel } from './blocks.js';

// 流动的水，规则和常见的方块游戏类似（自己实现的简化版）：
// - 水源（WATER）永远不变，除非被玩家挖掉或者放方块替换
// - 上面有水的格子是“下落的水”，水位最满
// - 一格水只有在不能往下流时（下面是实心方块或者水源）才会往四周流，每流一格水位减 1
// - 两个以上水源夹着、下面又托得住的格子会变成新的水源
// - 失去来源的流动水会一步步退掉
// 每次 tick 先算出所有待更新格子的新状态，再统一写回，结果和更新顺序无关。

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NEIGHBORS = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// 水能流进去的格子
export function canFlowInto(id) {
  return id === AIR || id === TORCH || isCrop(id) || isFlowing(id);
}

// 某一格水应该变成什么（不是水能占的格子就原样返回）
export function desiredFluid(world, x, y, z) {
  const id = world.get(x, y, z);
  if (id === WATER || !canFlowInto(id)) return id;

  const below = world.get(x, y - 1, z);
  const supported = y > 0 && !canFlowInto(below); // 下面托得住（实心或水源）

  let level = 0;
  if (isLiquid(world.get(x, y + 1, z))) level = FLOW_MAX;

  let sources = 0;
  for (const [dx, dz] of SIDES) {
    const n = world.get(x + dx, y, z + dz);
    if (!isLiquid(n)) continue;
    if (n === WATER) sources++;
    // 邻居要先往下流，流不下去才会往旁边流
    if (canFlowInto(world.get(x + dx, y - 1, z + dz))) continue;
    level = Math.max(level, waterLevel(n) - 1);
  }

  if (sources >= 2 && supported) return WATER;
  // 没有水流过来：火把和庄稼保持原样
  if (level <= 0) return id === TORCH || isCrop(id) ? id : AIR;
  return flowId(Math.min(level, FLOW_MAX));
}

export class Fluids {
  constructor(world) {
    this.world = world;
    this.pending = new Set();
  }

  // 某格变了：它自己和六个邻居都要重新算
  schedule(x, y, z) {
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (this.world.inBounds(nx, ny, nz)) this.pending.add(this.world.index(nx, ny, nz));
    }
  }

  get busy() {
    return this.pending.size > 0;
  }

  /**
   * 推进一步。返回 { changed: 变化格子的下标, removedTorches: 被冲掉的火把所在的格子下标 }。
   */
  tick(limit = 4000) {
    const world = this.world;
    const batch = [];
    for (const i of this.pending) {
      batch.push(i);
      this.pending.delete(i);
      if (batch.length >= limit) break;
    }
    const updates = [];
    for (const i of batch) {
      const [x, y, z] = world.coords(i);
      const next = desiredFluid(world, x, y, z);
      if (next !== world.data[i]) updates.push([i, x, y, z, next]);
    }
    const removedTorches = [];
    const changed = [];
    for (const [i, x, y, z, next] of updates) {
      if (world.data[i] === TORCH) removedTorches.push(i);
      world.set(x, y, z, next);
      changed.push(i);
      this.schedule(x, y, z);
    }
    return { changed, removedTorches };
  }
}
