import { AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, SNOW, BEDROCK, WATER, COAL_ORE, isPassable } from './blocks.js';
import { fbm2, hash2, mulberry32 } from './noise.js';

export const CHUNK = 16;
export const HEIGHT = 48;
export const SEA_LEVEL = 12;

export class World {
  /**
   * @param {object} opts
   * @param {number} opts.seed 世界种子
   * @param {number} [opts.chunks] 每条边有几个区块
   * @param {boolean} [opts.generate] false 时得到一个空世界（测试用）
   */
  constructor({ seed = 1, chunks = 8, generate = true } = {}) {
    this.seed = seed >>> 0;
    this.chunks = chunks;
    this.sizeX = chunks * CHUNK;
    this.sizeZ = chunks * CHUNK;
    this.sizeY = HEIGHT;
    this.data = new Uint8Array(this.sizeX * this.sizeY * this.sizeZ);
    // 火把的光照等级 0–15（见 light.js）
    this.light = new Uint8Array(this.data.length);
    // 玩家改动过的方块："x,y,z" -> id。只存改动，存档很小。
    this.edits = new Map();
    if (generate) this.generate();
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  index(x, y, z) {
    return (y * this.sizeZ + z) * this.sizeX + x;
  }

  coords(i) {
    const x = i % this.sizeX;
    const z = Math.floor(i / this.sizeX) % this.sizeZ;
    const y = Math.floor(i / (this.sizeX * this.sizeZ));
    return [x, y, z];
  }

  lightAt(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.light[this.index(x, y, z)];
  }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return AIR;
    return this.data[this.index(x, y, z)];
  }

  // 只改数据，不记作玩家改动（生成地形用）
  rawSet(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.index(x, y, z)] = id;
  }

  // 玩家改方块。返回 false 表示没改（越界或者本来就是这个方块）。
  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    if (this.data[i] === id) return false;
    this.data[i] = id;
    this.edits.set(`${x},${y},${z}`, id);
    return true;
  }

  // 物理碰撞用：世界边界外面当作墙，脚下当作地板；水和火把可以穿过
  isSolid(x, y, z) {
    if (y < 0) return true;
    if (y >= this.sizeY) return false;
    if (x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return true;
    return !isPassable(this.data[this.index(x, y, z)]);
  }

  // 世界里真实存在的实心方块（火把要立在这种方块上）
  isSolidBlock(x, y, z) {
    return this.inBounds(x, y, z) && !isPassable(this.get(x, y, z));
  }

  heightAt(x, z) {
    // 分形噪声的值大多挤在 0.5 附近，拉开一些，才会有低于海平面的湖和高出来的雪山
    const n = (fbm2(x / 48, z / 48, this.seed, 4) - 0.5) * 2.4;
    const hills = fbm2(x / 18, z / 18, this.seed + 77, 2) - 0.5;
    return Math.floor(17 + n * 16 + hills * 6);
  }

  // 某一列最高的非空气方块的 y，没有就返回 -1
  topY(x, z) {
    for (let y = this.sizeY - 1; y >= 0; y--) {
      if (this.get(x, y, z) !== AIR) return y;
    }
    return -1;
  }

  generate() {
    const { sizeX, sizeZ } = this;
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        const h = Math.min(this.heightAt(x, z), this.sizeY - 10);
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = BEDROCK;
          // 石头里零星夹着煤矿石
          else if (y < h - 3) id = y < h - 4 && hash2(x * 31 + y, z * 17 - y, this.seed + 5) < 0.025 ? COAL_ORE : STONE;
          else if (y < h) id = h <= SEA_LEVEL + 1 ? SAND : DIRT;
          else if (h <= SEA_LEVEL + 1) id = SAND;
          else if (h >= 26) id = SNOW;
          else id = GRASS;
          this.rawSet(x, y, z, id);
        }
        // 低于海平面的地方灌满水，形成湖和小海湾
        for (let y = h + 1; y <= SEA_LEVEL; y++) this.rawSet(x, y, z, WATER);
      }
    }
    this.plantTrees();
  }

  plantTrees() {
    const margin = 3;
    for (let z = margin; z < this.sizeZ - margin; z++) {
      for (let x = margin; x < this.sizeX - margin; x++) {
        if (hash2(x, z, this.seed + 999) > 0.012) continue;
        const y = this.topY(x, z);
        if (this.get(x, y, z) !== GRASS) continue;
        this.growTree(x, y + 1, z, mulberry32(this.seed ^ (x * 73856093) ^ (z * 19349663)));
      }
    }
  }

  growTree(x, y, z, rand) {
    const trunk = 4 + Math.floor(rand() * 3);
    if (y + trunk + 2 >= this.sizeY) return;
    this.rawSet(x, y - 1, z, DIRT);
    const top = y + trunk;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy >= 0 ? 1 : 2;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          // 把四个角削掉一些，树冠更圆
          if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 1 || rand() < 0.5)) continue;
          const lx = x + dx;
          const ly = top + dy;
          const lz = z + dz;
          if (this.get(lx, ly, lz) === AIR) this.rawSet(lx, ly, lz, LEAVES);
        }
      }
    }
    for (let i = 0; i < trunk; i++) this.rawSet(x, y + i, z, LOG);
  }

  // 出生点：离地图中间最近的、不在水里的地面
  spawnPoint() {
    const cx = Math.floor(this.sizeX / 2);
    const cz = Math.floor(this.sizeZ / 2);
    const maxR = Math.max(this.sizeX, this.sizeZ);
    for (let r = 0; r < maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (!this.inBounds(x, 0, z)) continue;
          const y = this.topY(x, z);
          if (y >= 0 && this.get(x, y, z) !== WATER) return [x + 0.5, y + 1, z + 0.5];
        }
      }
    }
    return [cx + 0.5, this.topY(cx, cz) + 1, cz + 0.5];
  }

  // 修改 (x,z) 处方块后需要重建网格的区块（在区块边上时连邻居一起）
  affectedChunks(x, z) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const list = [[cx, cz]];
    const lx = x - cx * CHUNK;
    const lz = z - cz * CHUNK;
    if (lx === 0 && cx > 0) list.push([cx - 1, cz]);
    if (lx === CHUNK - 1 && cx < this.chunks - 1) list.push([cx + 1, cz]);
    if (lz === 0 && cz > 0) list.push([cx, cz - 1]);
    if (lz === CHUNK - 1 && cz < this.chunks - 1) list.push([cx, cz + 1]);
    return list;
  }

  exportEdits() {
    const out = [];
    for (const [key, id] of this.edits) {
      const [x, y, z] = key.split(',').map(Number);
      out.push([x, y, z, id]);
    }
    return out;
  }

  // 读回存档里的改动，忽略格式不对的条目
  applyEdits(list) {
    if (!Array.isArray(list)) return 0;
    let n = 0;
    for (const e of list) {
      if (!Array.isArray(e) || e.length !== 4 || !e.every(Number.isInteger)) continue;
      const [x, y, z, id] = e;
      if (id < 0 || id > 255) continue;
      if (this.set(x, y, z, id)) n++;
    }
    return n;
  }
}
