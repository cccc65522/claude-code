import * as THREE from 'three';
import { CHUNK } from './world.js';
import { buildChunkGeometry } from './mesher.js';

function toGeometry(g) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
  geometry.setAttribute('blockLight', new THREE.BufferAttribute(g.light, 1));
  geometry.setAttribute('skyLight', new THREE.BufferAttribute(g.sky, 1));
  geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// 离玩家多远（格）以外的区块不画（反正在雾里看不见）
export const VIEW_DISTANCE = 120;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * 每个区块两个 Mesh：实心方块和半透明的水。
 * 世界很大时一次把所有区块都建好会卡住，所以一开始只建玩家身边的（buildAround），
 * 剩下的每帧按离玩家由近到远建一些（update），直到建完。改方块时只重建受影响的区块。
 */
export class ChunkRenderer {
  constructor(world, material, waterMaterial) {
    this.world = world;
    this.material = material;
    this.waterMaterial = waterMaterial;
    this.group = new THREE.Group();
    this.meshes = new Map();
    this.pending = new Set();
    for (let cz = 0; cz < world.chunks; cz++) {
      for (let cx = 0; cx < world.chunks; cx++) this.pending.add(`${cx},${cz}`);
    }
    this.total = this.pending.size;
  }

  get built() {
    return this.total - this.pending.size;
  }

  // 离 (x,z) 最近的还没建的区块
  nearestPending(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const key of this.pending) {
      const [cx, cz] = key.split(',').map(Number);
      const d = Math.hypot((cx + 0.5) * CHUNK - x, (cz + 0.5) * CHUNK - z);
      if (d < bestD) {
        bestD = d;
        best = key;
      }
    }
    return best;
  }

  // 马上把 (x,z) 周围 radius 个区块以内的都建好（开始游戏前调用，免得脚下是空的）
  buildAround(x, z, radius = 2) {
    const ccx = Math.floor(x / CHUNK);
    const ccz = Math.floor(z / CHUNK);
    for (let cz = ccz - radius; cz <= ccz + radius; cz++) {
      for (let cx = ccx - radius; cx <= ccx + radius; cx++) {
        if (this.pending.has(`${cx},${cz}`)) this.rebuild(cx, cz);
      }
    }
  }

  /**
   * 每帧调用：在 budgetMs 毫秒内由近到远建一些还没建的区块，再按距离决定哪些区块要画。
   * 返回这一帧建了几个。
   */
  update(x, z, budgetMs = 6) {
    let n = 0;
    const start = now();
    while (this.pending.size && (n === 0 || now() - start < budgetMs)) {
      const key = this.nearestPending(x, z);
      const [cx, cz] = key.split(',').map(Number);
      this.rebuild(cx, cz);
      n++;
    }
    for (const [key, pair] of this.meshes) {
      const [cx, cz] = key.split(',').map(Number);
      const visible = Math.hypot((cx + 0.5) * CHUNK - x, (cz + 0.5) * CHUNK - z) < VIEW_DISTANCE + CHUNK;
      pair.solid.visible = visible;
      pair.water.visible = visible;
    }
    return n;
  }

  rebuild(cx, cz) {
    const key = `${cx},${cz}`;
    this.pending.delete(key);
    const g = buildChunkGeometry(this.world, cx, cz);
    const solid = toGeometry(g);
    const water = toGeometry(g.water);

    const old = this.meshes.get(key);
    if (old) {
      old.solid.geometry.dispose();
      old.water.geometry.dispose();
      old.solid.geometry = solid;
      old.water.geometry = water;
      return;
    }
    const pair = {
      solid: new THREE.Mesh(solid, this.material),
      water: new THREE.Mesh(water, this.waterMaterial),
    };
    pair.water.renderOrder = 1; // 先画实心方块，再画水
    for (const mesh of Object.values(pair)) {
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.meshes.set(key, pair);
  }

  // keys: "cx,cz" 的集合（Sim.edit / Sim.tick 的返回值）。还没建的区块不用管，轮到它时会用最新的数据建。
  rebuildKeys(keys) {
    if (!keys) return;
    for (const key of keys) {
      if (this.pending.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number);
      this.rebuild(cx, cz);
    }
  }

  dispose() {
    for (const pair of this.meshes.values()) {
      pair.solid.geometry.dispose();
      pair.water.geometry.dispose();
    }
    this.meshes.clear();
  }
}
