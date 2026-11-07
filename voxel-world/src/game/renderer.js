import * as THREE from 'three';
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

// 每个区块两个 Mesh：实心方块和半透明的水。改方块时只重建受影响的区块。
export class ChunkRenderer {
  constructor(world, material, waterMaterial) {
    this.world = world;
    this.material = material;
    this.waterMaterial = waterMaterial;
    this.group = new THREE.Group();
    this.meshes = new Map();
    for (let cz = 0; cz < world.chunks; cz++) {
      for (let cx = 0; cx < world.chunks; cx++) this.rebuild(cx, cz);
    }
  }

  rebuild(cx, cz) {
    const key = `${cx},${cz}`;
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

  // keys: "cx,cz" 的集合（Sim.edit / Sim.tick 的返回值）
  rebuildKeys(keys) {
    if (!keys) return;
    for (const key of keys) {
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
