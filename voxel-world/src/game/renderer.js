import * as THREE from 'three';
import { buildChunkGeometry } from './mesher.js';

// 每个区块一个 Mesh。改方块时只重建受影响的区块。
export class ChunkRenderer {
  constructor(world, material) {
    this.world = world;
    this.material = material;
    this.group = new THREE.Group();
    this.meshes = new Map();
    for (let cz = 0; cz < world.chunks; cz++) {
      for (let cx = 0; cx < world.chunks; cx++) this.rebuild(cx, cz);
    }
  }

  rebuild(cx, cz) {
    const key = `${cx},${cz}`;
    const g = buildChunkGeometry(this.world, cx, cz);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
    geometry.computeBoundingSphere();

    const old = this.meshes.get(key);
    if (old) {
      old.geometry.dispose();
      old.geometry = geometry;
      return;
    }
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.matrixAutoUpdate = false;
    this.meshes.set(key, mesh);
    this.group.add(mesh);
  }

  rebuildAround(x, z) {
    for (const [cx, cz] of this.world.affectedChunks(x, z)) this.rebuild(cx, cz);
  }

  dispose() {
    for (const mesh of this.meshes.values()) mesh.geometry.dispose();
    this.meshes.clear();
  }
}
