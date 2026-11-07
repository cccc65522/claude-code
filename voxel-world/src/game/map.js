import {
  AIR, BED, BRICK, CHEST, COAL_ORE, DIRT, EGG, FARMLAND, GLASS, GRASS, IRON_ORE, LEAVES, LOG, PLANKS, SAND, SNOW,
  STONE, TORCH, isCrop, isLiquid,
} from './blocks.js';
import { CHUNK } from './world.js';

// 地图：每一列从上往下第一个看得见的方块决定颜色，再按高低加一点明暗（看得出山）。
// 只显示走过的地方（explored），没去过的是空白。这个文件不碰 DOM，可以在 Node 里测试。

export const EXPLORE_RADIUS = 40;
const UNEXPLORED = [222, 214, 190]; // 像旧纸一样的底色

const BASE = {
  [GRASS]: [104, 168, 76],
  [DIRT]: [134, 98, 66],
  [FARMLAND]: [110, 76, 48],
  [SAND]: [222, 206, 150],
  [SNOW]: [240, 244, 248],
  [STONE]: [132, 132, 136],
  [COAL_ORE]: [110, 110, 116],
  [IRON_ORE]: [150, 128, 112],
  [BRICK]: [168, 76, 60],
  [LOG]: [112, 82, 52],
  [PLANKS]: [186, 146, 92],
  [CHEST]: [168, 116, 62],
  [BED]: [196, 56, 60],
  [LEAVES]: [56, 120, 50],
  [GLASS]: [190, 220, 230],
  [TORCH]: [250, 200, 80],
  [EGG]: [236, 236, 222],
};
for (let id = 32; id < 52; id++) BASE[id] = [160, 112, 64]; // 门和梯子：木头色

// 这一列地图上显示的方块和高度（跳过空气；水显示成水，记下水有多深）
export function surfaceOf(world, x, z) {
  let depth = 0;
  for (let y = world.sizeY - 1; y >= 0; y--) {
    const id = world.get(x, y, z);
    if (id === AIR) continue;
    if (isLiquid(id)) {
      // 往下数水有多深
      let d = 0;
      while (y - d >= 0 && isLiquid(world.get(x, y - d, z))) d++;
      depth = d;
      return { id, y, depth };
    }
    return { id, y, depth };
  }
  return { id: AIR, y: -1, depth: 0 };
}

export function columnColor(world, x, z) {
  const s = surfaceOf(world, x, z);
  if (s.id === AIR) return [20, 20, 24];
  let rgb;
  if (isLiquid(s.id)) {
    const k = Math.min(1, s.depth / 8);
    rgb = [70 - 40 * k, 130 - 50 * k, 210 - 50 * k]; // 越深越暗
  } else if (isCrop(s.id)) {
    rgb = [150, 170, 70];
  } else {
    rgb = BASE[s.id] ?? [140, 140, 140];
  }
  if (!isLiquid(s.id)) {
    // 明暗：和西北边那一列比，高了就亮一点，低了就暗一点
    const nw = surfaceOf(world, Math.max(0, x - 1), Math.max(0, z - 1));
    const shade = Math.max(-0.25, Math.min(0.25, (s.y - nw.y) * 0.1));
    // 越高越亮一点点
    const height = (s.y - 16) * 0.008;
    rgb = rgb.map((c) => c * (1 + shade + height));
  }
  return rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))));
}

export class MapData {
  constructor(world, explored = null) {
    this.world = world;
    this.w = world.sizeX;
    this.h = world.sizeZ;
    this.colors = new Uint8ClampedArray(this.w * this.h * 3);
    this.explored = explored && explored.length === this.w * this.h ? explored : new Uint8Array(this.w * this.h);
    this.pixels = new Uint8ClampedArray(this.w * this.h * 4); // 合成好的 RGBA（没去过的是底色）
    this.dirtyChunks = new Set();
    this.version = 0; // 每次图有变化就加 1，画图的组件据此决定要不要重画
    for (let z = 0; z < this.h; z++) for (let x = 0; x < this.w; x++) this.updateColumn(x, z);
  }

  updateColumn(x, z) {
    const i = z * this.w + x;
    const c = columnColor(this.world, x, z);
    this.colors.set(c, i * 3);
    this.paint(i);
  }

  paint(i) {
    const c = this.explored[i] ? this.colors.subarray(i * 3, i * 3 + 3) : UNEXPLORED;
    this.pixels[i * 4] = c[0];
    this.pixels[i * 4 + 1] = c[1];
    this.pixels[i * 4 + 2] = c[2];
    this.pixels[i * 4 + 3] = 255;
  }

  // 区块改过了：等下一次 flush 时重算这个区块里的列（以及东南边一列，因为明暗看西北边）
  markChunk(cx, cz) {
    this.dirtyChunks.add(`${cx},${cz}`);
  }

  flush() {
    if (!this.dirtyChunks.size) return false;
    for (const key of this.dirtyChunks) {
      const [cx, cz] = key.split(',').map(Number);
      for (let z = cz * CHUNK; z <= Math.min(this.h - 1, cz * CHUNK + CHUNK); z++) {
        for (let x = cx * CHUNK; x <= Math.min(this.w - 1, cx * CHUNK + CHUNK); x++) this.updateColumn(x, z);
      }
    }
    this.dirtyChunks.clear();
    this.version++;
    return true;
  }

  // 把玩家周围 radius 格标成去过。返回新点亮了多少格。
  explore(px, pz, radius = EXPLORE_RADIUS) {
    let n = 0;
    const r2 = radius * radius;
    for (let z = Math.max(0, Math.floor(pz - radius)); z <= Math.min(this.h - 1, Math.ceil(pz + radius)); z++) {
      for (let x = Math.max(0, Math.floor(px - radius)); x <= Math.min(this.w - 1, Math.ceil(px + radius)); x++) {
        if ((x + 0.5 - px) ** 2 + (z + 0.5 - pz) ** 2 > r2) continue;
        const i = z * this.w + x;
        if (this.explored[i]) continue;
        this.explored[i] = 1;
        this.paint(i);
        n++;
      }
    }
    if (n) this.version++;
    return n;
  }

  exploredFraction() {
    let n = 0;
    for (const v of this.explored) n += v;
    return n / this.explored.length;
  }
}

// ---------- 探索记录的存档：每格一位，打包成 base64 ----------
export function packExplored(explored) {
  const bytes = new Uint8Array(Math.ceil(explored.length / 8));
  for (let i = 0; i < explored.length; i++) if (explored[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

export function unpackExplored(text, size) {
  if (typeof text !== 'string' || !text) return null;
  let s;
  try {
    s = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('binary');
  } catch {
    return null;
  }
  if (s.length !== Math.ceil(size / 8)) return null;
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
}
