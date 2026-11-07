import { AIR, BLOCKS, LADDER_BASE, SIDES, doorId, isDoor, isLadder } from './blocks.js';

// 门和梯子的规则（纯计算，可以在 Node 里测试）

// 玩家朝向 yaw 时面对的方向（0 北 1 东 2 南 3 西）
export function facingFromYaw(yaw) {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
  return dz > 0 ? 2 : 0;
}

/**
 * 在格子 (x,y,z) 放一扇门（这一格是下半，上面一格是上半）。门板放在玩家面对的那一边。
 * 返回 { cells: [[x,y,z,id],[x,y+1,z,id]] } 或 { error }。
 */
export function doorPlacement(world, x, y, z, yaw) {
  if (world.get(x, y, z) !== AIR || world.get(x, y + 1, z) !== AIR) return { error: '门要两格高的空地方' };
  if (!world.isSolidBlock(x, y - 1, z)) return { error: '门要放在实心方块上' };
  const facing = facingFromYaw(yaw);
  return { cells: [[x, y, z, doorId(0, false, facing)], [x, y + 1, z, doorId(1, false, facing)]] };
}

// 开关门：返回两半的新方块 [[x,y,z,id], ...]（点上半下半都行）
export function toggleDoor(world, x, y, z) {
  const def = BLOCKS[world.get(x, y, z)];
  if (!def?.door) return null;
  const by = def.door.half ? y - 1 : y;
  const { open, facing } = def.door;
  const out = [[x, by, z, doorId(0, !open, facing)]];
  if (isDoor(world.get(x, by + 1, z))) out.push([x, by + 1, z, doorId(1, !open, facing)]);
  return out;
}

/**
 * 梯子贴在被点中的那面墙上：hit 是墙，normal 是点中的面朝哪边。
 * 返回 { cell: [x,y,z,id] } 或 { error }。
 */
export function ladderPlacement(world, hit, normal) {
  if (normal[1] !== 0) return { error: '梯子要贴在墙的侧面' };
  const x = hit[0] + normal[0];
  const y = hit[1];
  const z = hit[2] + normal[2];
  if (world.get(x, y, z) !== AIR) return { error: '这里放不下梯子' };
  if (!world.isSolidBlock(...hit)) return { error: '梯子要贴在实心方块上' };
  // 墙在梯子格子的哪一边：和点中的面的方向相反
  const facing = SIDES.findIndex(([sx, sz]) => sx === -normal[0] && sz === -normal[2]);
  return { cell: [x, y, z, LADDER_BASE + facing] };
}

// 梯子贴着的墙在哪一格
export function ladderWall(id, x, y, z) {
  const [sx, sz] = SIDES[id - LADDER_BASE];
  return [x + sx, y, z + sz];
}

// 门板 / 梯子在格子里的位置（mesher 用）：返回 [min, max]
export function panelBox(id) {
  const thin = (side, t) => {
    const [sx, sz] = SIDES[side];
    const min = [0, 0, 0];
    const max = [1, 1, 1];
    if (sx === 1) min[0] = 1 - t;
    if (sx === -1) max[0] = t;
    if (sz === 1) min[2] = 1 - t;
    if (sz === -1) max[2] = t;
    return [min, max];
  };
  if (isLadder(id)) return thin(id - LADDER_BASE, 1 / 16);
  const d = BLOCKS[id].door;
  // 开着的门转了 90 度，贴到旁边那一面
  return thin(d.open ? (d.facing + 1) % 4 : d.facing, 3 / 16);
}
