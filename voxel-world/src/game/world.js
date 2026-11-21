import {
  AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, SNOW, BEDROCK, WATER, COAL_ORE, IRON_ORE, CACTUS, ICE, SANDSTONE, isPassable,
} from './blocks.js';
import { fbm2, hash2, mulberry32 } from './noise.js';
import { biomeAt } from './biomes.js';

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
  constructor({ seed = 1, chunks = 16, generate = true } = {}) {
    this.seed = seed >>> 0;
    this.chunks = chunks;
    this.sizeX = chunks * CHUNK;
    this.sizeZ = chunks * CHUNK;
    this.sizeY = HEIGHT;
    this.data = new Uint8Array(this.sizeX * this.sizeY * this.sizeZ);
    // 火把的光照等级 0–15（见 light.js）
    this.light = new Uint8Array(this.data.length);
    // 天光等级 0–15：阳光（或月光）能照到多少，洞里和屋里是暗的
    this.sky = new Uint8Array(this.data.length);
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

  skyAt(x, y, z) {
    if (y >= this.sizeY) return 15;
    if (!this.inBounds(x, y, z)) return 0;
    return this.sky[this.index(x, y, z)];
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

  biomeAt(x, z) {
    return biomeAt(this.seed, x, z);
  }

  heightAt(x, z) {
    // 分形噪声的值大多挤在 0.5 附近，拉开一些，才会有低于海平面的湖和高出来的雪山
    const n = (fbm2(x / 48, z / 48, this.seed, 4) - 0.5) * 2.4;
    const hills = fbm2(x / 18, z / 18, this.seed + 77, 2) - 0.5;
    return Math.floor(17 + n * 16 + hills * 6);
  }

  oreAt(x, y, z, h) {
    if (y < h - 4 && hash2(x * 31 + y, z * 17 - y, this.seed + 5) < 0.025) return COAL_ORE;
    if (y < h - 6 && hash2(x * 13 - y, z * 29 + y, this.seed + 11) < 0.014) return IRON_ORE;
    return STONE;
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
    const heights = new Int16Array(sizeX * sizeZ);
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        const h = Math.min(this.heightAt(x, z), this.sizeY - 10);
        heights[z * sizeX + x] = h;
        const biome = this.biomeAt(x, z);
        const beach = h <= SEA_LEVEL + 1;
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = BEDROCK;
          else if (biome === 'desert' && y >= h - 6 && y < h - 3) id = SANDSTONE; // 沙漠：沙子下面是砂岩
          // 石头里零星夹着煤矿石，更深的地方有铁矿石
          else if (y < h - 3) id = this.oreAt(x, y, z, h);
          else if (biome === 'desert') id = SAND;
          else if (y < h) id = beach ? SAND : DIRT;
          else if (beach) id = biome === 'snow' ? SNOW : SAND; // 雪原的岸边也盖着雪
          else if (h >= 26 || biome === 'snow') id = SNOW;
          else id = GRASS;
          this.rawSet(x, y, z, id);
        }
      }
    }
    this.carveCaves(heights);
    // 低于海平面的地方灌满水，形成湖和小海湾；雪原里的水面结冰
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        const frozen = this.biomeAt(x, z) === 'snow';
        for (let y = heights[z * sizeX + x] + 1; y <= SEA_LEVEL; y++) {
          this.rawSet(x, y, z, frozen && y === SEA_LEVEL ? ICE : WATER);
        }
      }
    }
    this.plantTrees(heights);
  }

  // 洞穴：一条条弯弯曲曲的“虫子”在地下钻过去，把经过的地方挖空。
  // 碰到地面附近就成了洞口；湖底和海底下面留两层不挖，免得水漏进去。
  carveCaves(heights) {
    const rand = mulberry32(this.seed ^ 0x5eed);
    const worms = Math.round(this.chunks * this.chunks * 0.5);
    for (let w = 0; w < worms; w++) {
      let x = rand() * this.sizeX;
      let z = rand() * this.sizeZ;
      const top = heights[Math.floor(z) * this.sizeX + Math.floor(x)];
      let y = 3 + rand() * Math.max(1, top - 3);
      let yaw = rand() * Math.PI * 2;
      let pitch = (rand() - 0.5) * 0.4;
      const length = 50 + Math.floor(rand() * 80);
      const baseR = 1.2 + rand() * 1.1;
      for (let step = 0; step < length; step++) {
        x += Math.cos(yaw) * Math.cos(pitch);
        z += Math.sin(yaw) * Math.cos(pitch);
        y += Math.sin(pitch);
        yaw += (rand() - 0.5) * 0.5;
        pitch = Math.max(-0.5, Math.min(0.5, pitch + (rand() - 0.5) * 0.25));
        if (y < 3) pitch = Math.abs(pitch);
        const r = baseR + Math.sin(step * 0.3) * 0.4;
        this.carveSphere(x, y, z, r, heights);
      }
    }
  }

  carveSphere(cx, cy, cz, r, heights) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      if (y < 1) continue;
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (!this.inBounds(x, y, z)) continue;
          const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + (z + 0.5 - cz) ** 2;
          if (d > r2) continue;
          const h = heights[z * this.sizeX + x];
          if (h <= SEA_LEVEL + 1 && y >= h - 2) continue; // 湖底、海底不挖穿
          const id = this.get(x, y, z);
          if (id === AIR || id === BEDROCK || id === WATER) continue;
          this.rawSet(x, y, z, AIR);
        }
      }
    }
  }

  // heights：每一列的地面高度（树要种在地面上，旁边的树冠盖过来也没关系）
  plantTrees(heights) {
    const margin = 3;
    for (let z = margin; z < this.sizeZ - margin; z++) {
      for (let x = margin; x < this.sizeX - margin; x++) {
        const biome = this.biomeAt(x, z);
        const chance = { plains: 0.012, forest: 0.08, desert: 0.006, snow: 0.014 }[biome];
        if (hash2(x, z, this.seed + 999) > chance) continue;
        const y = heights ? heights[z * this.sizeX + x] : this.topY(x, z);
        const ground = this.get(x, y, z);
        if (heights && !isPassable(this.get(x, y + 1, z)) && this.get(x, y + 1, z) !== LEAVES) continue;
        const rand = mulberry32(this.seed ^ (x * 73856093) ^ (z * 19349663));
        if (biome === 'desert') {
          if (ground === SAND) this.growCactus(x, y + 1, z, rand);
        } else if (biome === 'snow') {
          if (ground === SNOW || ground === GRASS) this.growSpruce(x, y + 1, z, rand);
        } else if (ground === GRASS) {
          this.growTree(x, y + 1, z, rand);
        }
      }
    }
  }

  // 仙人掌：1–3 格高，四周要空着
  growCactus(x, y, z, rand) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.get(x + dx, y, z + dz) !== AIR) return;
    const h = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < h; i++) this.rawSet(x, y + i, z, CACTUS);
  }

  // 雪松：细高的树干，树冠一层层往上变小，像个尖塔
  growSpruce(x, y, z, rand) {
    const trunk = 6 + Math.floor(rand() * 3);
    if (y + trunk + 2 >= this.sizeY) return;
    this.rawSet(x, y - 1, z, DIRT);
    for (let i = 1; i <= trunk + 1; i++) {
      const fromTop = trunk + 1 - i;
      const r = i <= 2 ? 0 : fromTop <= 1 ? 0 : fromTop <= 3 ? 1 : 2 - ((fromTop % 2) === 0 ? 0 : 1);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
          const ly = y + i;
          if (this.get(x + dx, ly, z + dz) === AIR) this.rawSet(x + dx, ly, z + dz, LEAVES);
        }
      }
    }
    for (let i = 0; i < trunk; i++) this.rawSet(x, y + i, z, LOG);
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
