import { BLOCKS, isLiquid, isOpaque } from './blocks.js';

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


// ---------- 天光 ----------
// 方块属性查表（光照要对几万个格子算，查表比每次查 BLOCKS 快很多）
const OPAQUE = new Uint8Array(256);
// 树叶、玻璃、火把这类透明方块：天光穿过时减 1。水不减（不然水一流动，天光就得跟着重算）
const DIMS = new Uint8Array(256);
for (let id = 0; id < 256; id++) {
  OPAQUE[id] = isOpaque(id) ? 1 : 0;
  DIMS[id] = id !== 0 && !OPAQUE[id] && BLOCKS[id] && !isLiquid(id) ? 1 : 0;
}
// 从天上往下照：碰到不透明的方块就照不下去了（树叶、水、玻璃挡一点点，减 1）；
// 再像火把光一样往旁边扩散，每走一格减 1。洞里、屋里、悬崖下面就是暗的。
// （树叶、玻璃挡一点点；水不挡。）
// 天光和昼夜无关：天黑了整个画面会变暗，天光只管“这里能不能看到天”。

function columnSky(world, x, z) {
  const { data, sky } = world;
  const plane = world.sizeX * world.sizeZ;
  let level = MAX_LIGHT;
  let i = world.index(x, world.sizeY - 1, z);
  for (let y = world.sizeY - 1; y >= 0; y--, i -= plane) {
    const id = data[i];
    if (level > 0) {
      if (OPAQUE[id]) level = 0;
      else if (DIMS[id]) level--;
    }
    sky[i] = level;
  }
}

// 下面几个函数会对几万个格子跑，所以直接用下标运算，不调用 world.get / coords
function spreadSky(world, queue, x0 = 0, x1 = world.sizeX - 1, z0 = 0, z1 = world.sizeZ - 1) {
  const { data, sky, sizeX: SX, sizeY: SY, sizeZ: SZ } = world;
  const plane = SX * SZ;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const level = sky[i] - 1;
    if (level <= 0) continue;
    const x = i % SX;
    const rest = (i - x) / SX;
    const z = rest % SZ;
    const y = (rest - z) / SZ;
    let n;
    if (x > x0 && sky[(n = i - 1)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
    if (x < x1 && sky[(n = i + 1)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
    if (z > z0 && sky[(n = i - SX)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
    if (z < z1 && sky[(n = i + SX)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
    if (y > 0 && sky[(n = i - plane)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
    if (y < SY - 1 && sky[(n = i + plane)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
  }
}

// 只有能往旁边照亮别人的格子才需要放进队列：它的某个邻居比它暗 2 级以上
function needsSpread(world, i, x, y, z) {
  const { data, sky, sizeX: SX, sizeY: SY, sizeZ: SZ } = world;
  const plane = SX * SZ;
  const limit = sky[i] - 1;
  let n;
  return (
    (x > 0 && sky[(n = i - 1)] < limit && !OPAQUE[data[n]]) ||
    (x < SX - 1 && sky[(n = i + 1)] < limit && !OPAQUE[data[n]]) ||
    (z > 0 && sky[(n = i - SX)] < limit && !OPAQUE[data[n]]) ||
    (z < SZ - 1 && sky[(n = i + SX)] < limit && !OPAQUE[data[n]]) ||
    (y > 0 && sky[(n = i - plane)] < limit && !OPAQUE[data[n]]) ||
    (y < SY - 1 && sky[(n = i + plane)] < limit && !OPAQUE[data[n]])
  );
}

export function computeSkyLight(world) {
  const { sizeX: SX, sizeY: SY, sizeZ: SZ, sky } = world;
  for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) columnSky(world, x, z);
  const queue = [];
  for (let y = 0; y < SY; y++) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const i = (y * SZ + z) * SX + x;
        if (sky[i] > 1 && needsSpread(world, i, x, y, z)) queue.push(i);
      }
    }
  }
  spreadSky(world, queue);
}

export const SKY_REGION = 15;

/**
 * 改了 (x,z) 附近的方块以后，只重算周围 SKY_REGION 格内的天光（够覆盖这次改动能影响到的范围）。
 * 返回天光有变化的格子下标。
 */
export function updateSkyLight(world, x, z, radius = SKY_REGION) {
  const { sizeX: SX, sizeY: SY, sizeZ: SZ, sky } = world;
  const x0 = Math.max(0, x - radius);
  const x1 = Math.min(SX - 1, x + radius);
  const z0 = Math.max(0, z - radius);
  const z1 = Math.min(SZ - 1, z + radius);
  const rx = x1 - x0 + 1;
  const rz = z1 - z0 + 1;
  const old = new Uint8Array(rx * rz * SY);
  for (let y = 0; y < SY; y++) {
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) old[(y * rz + (cz - z0)) * rx + (cx - x0)] = sky[(y * SZ + cz) * SX + cx];
    }
  }
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) columnSky(world, cx, cz);

  // 区域里能往外照的格子，加上紧挨着区域的外面一圈（光从外面照进来）
  const queue = [];
  for (let y = 0; y < SY; y++) {
    for (let cz = Math.max(0, z0 - 1); cz <= Math.min(SZ - 1, z1 + 1); cz++) {
      for (let cx = Math.max(0, x0 - 1); cx <= Math.min(SX - 1, x1 + 1); cx++) {
        const i = (y * SZ + cz) * SX + cx;
        if (sky[i] <= 1) continue;
        const edge = cx < x0 || cx > x1 || cz < z0 || cz > z1;
        if (edge || needsSpread(world, i, cx, y, cz)) queue.push(i);
      }
    }
  }
  // 外面那一圈只当光源，不改它们：先把它们的扩散限制在区域里
  spreadRegion(world, sky, queue, x0, x1, z0, z1);

  const changed = [];
  for (let y = 0; y < SY; y++) {
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = (y * SZ + cz) * SX + cx;
        if (sky[i] !== old[(y * rz + (cz - z0)) * rx + (cx - x0)]) changed.push(i);
      }
    }
  }
  return changed;
}

// 和 spreadSky 一样，但只往区域 [x0,x1]×[z0,z1] 里面照（区域外面的格子保持不变）。
// arr 是要扩散的光（world.sky 或 world.light）
function spreadRegion(world, arr, queue, x0, x1, z0, z1) {
  const { data, sizeX: SX, sizeY: SY, sizeZ: SZ } = world;
  const sky = arr;
  const plane = SX * SZ;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const level = sky[i] - 1;
    if (level <= 0) continue;
    const x = i % SX;
    const rest = (i - x) / SX;
    const z = rest % SZ;
    const y = (rest - z) / SZ;
    const inX = x >= x0 && x <= x1;
    const inZ = z >= z0 && z <= z1;
    let n;
    // 往 x 方向：目标的 z 要在区域里；往 z 方向：目标的 x 要在区域里；上下：自己要在区域里
    if (inZ && x - 1 >= x0 && x - 1 <= x1 && sky[(n = i - 1)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
    if (inZ && x + 1 >= x0 && x + 1 <= x1 && sky[(n = i + 1)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
    if (inX && z - 1 >= z0 && z - 1 <= z1 && sky[(n = i - SX)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
    if (inX && z + 1 >= z0 && z + 1 <= z1 && sky[(n = i + SX)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
    if (inX && inZ && y > 0 && sky[(n = i - plane)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
    if (inX && inZ && y < SY - 1 && sky[(n = i + plane)] < level && !OPAQUE[data[n]]) { sky[n] = level; queue.push(n); }
  }
}

// ---------- 火把光的局部更新 ----------
const EMIT = new Uint8Array(256);
for (let id = 0; id < 256; id++) EMIT[id] = BLOCKS[id]?.light ?? 0;

/**
 * 改了 (x,z) 附近的方块以后，只重算周围 radius 格内的火把光：
 * 先把区域里的光清掉、重新放上区域里的火把，再让紧挨着区域的外面一圈把光照进来。
 * （一次改动最多影响 14 格远，区域外面的光不会变。）返回火把光有变化的格子下标。
 */
export function updateBlockLight(world, x, z, radius = SKY_REGION) {
  const { sizeX: SX, sizeY: SY, sizeZ: SZ, light, data } = world;
  const x0 = Math.max(0, x - radius);
  const x1 = Math.min(SX - 1, x + radius);
  const z0 = Math.max(0, z - radius);
  const z1 = Math.min(SZ - 1, z + radius);
  const rx = x1 - x0 + 1;
  const rz = z1 - z0 + 1;
  const old = new Uint8Array(rx * rz * SY);
  const queue = [];
  for (let y = 0; y < SY; y++) {
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = (y * SZ + cz) * SX + cx;
        old[(y * rz + (cz - z0)) * rx + (cx - x0)] = light[i];
        light[i] = EMIT[data[i]];
        if (light[i] > 1) queue.push(i);
      }
    }
  }
  for (let y = 0; y < SY; y++) {
    for (let cz = Math.max(0, z0 - 1); cz <= Math.min(SZ - 1, z1 + 1); cz++) {
      for (let cx = Math.max(0, x0 - 1); cx <= Math.min(SX - 1, x1 + 1); cx++) {
        if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1) continue;
        const i = (y * SZ + cz) * SX + cx;
        if (light[i] > 1) queue.push(i);
      }
    }
  }
  spreadRegion(world, light, queue, x0, x1, z0, z1);
  const changed = [];
  for (let y = 0; y < SY; y++) {
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = (y * SZ + cz) * SX + cx;
        if (light[i] !== old[(y * rz + (cz - z0)) * rx + (cx - x0)]) changed.push(i);
      }
    }
  }
  return changed;
}
