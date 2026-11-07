import { AIR, BLOCKS, isOpaque, isTransparent } from './blocks.js';
import { CHUNK } from './world.js';

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 4;

// 每个面的四个角。三角形用 (0,1,2)(2,1,3)，从外面看是逆时针。
// uv 的 v=1 是贴图上方，所以侧面的草在上面。
const FACES = [
  { dir: [-1, 0, 0], side: 'side', corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], side: 'side', corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], side: 'bottom', corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], side: 'top', corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], side: 'side', corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], side: 'side', corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

// 环境光遮蔽亮度：0 = 最暗（墙角），3 = 不被遮挡
const AO_LEVELS = [0.45, 0.62, 0.8, 1];

// 两个块之间的面要不要画
export function faceVisible(block, neighbor) {
  if (neighbor === AIR) return true;
  if (!isTransparent(neighbor)) return false;
  return neighbor !== block; // 玻璃挨着玻璃、树叶挨着树叶时不画中间那层
}

/**
 * 给一个区块生成几何数据（只用类型化数组，不依赖 three.js）。
 * 返回的顶点坐标是世界坐标。
 */
export function buildChunkGeometry(world, cx, cz) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const eps = 0.001;
  const ao = [0, 0, 0, 0];

  for (let y = 0; y < world.sizeY; y++) {
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let x = x0; x < x0 + CHUNK; x++) {
        const block = world.get(x, y, z);
        if (block === AIR) continue;
        const def = BLOCKS[block];
        if (!def) continue;

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const neighbor = world.get(x + dx, y + dy, z + dz);
          if (!faceVisible(block, neighbor)) continue;

          const tile = def.tiles[face.side];
          const col = tile % ATLAS_COLS;
          const row = Math.floor(tile / ATLAS_COLS);
          const start = positions.length / 3;

          // 面的法线方向之外的两个轴
          const axes = [0, 1, 2].filter((a) => face.dir[a] === 0);
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;

          for (let i = 0; i < 4; i++) {
            const [px, py, pz, u, v] = face.corners[i];
            positions.push(x + px, y + py, z + pz);
            normals.push(dx, dy, dz);
            uvs.push(
              (col + (u ? 1 - eps : eps)) / ATLAS_COLS,
              1 - (row + (v ? eps : 1 - eps)) / ATLAS_ROWS,
            );

            // 角落的两个侧面方块和对角方块
            const p = [px, py, pz];
            const o1 = [0, 0, 0];
            const o2 = [0, 0, 0];
            o1[axes[0]] = p[axes[0]] * 2 - 1;
            o2[axes[1]] = p[axes[1]] * 2 - 1;
            const s1 = isOpaque(world.get(nx + o1[0], ny + o1[1], nz + o1[2])) ? 1 : 0;
            const s2 = isOpaque(world.get(nx + o2[0], ny + o2[1], nz + o2[2])) ? 1 : 0;
            const c = isOpaque(world.get(nx + o1[0] + o2[0], ny + o1[1] + o2[1], nz + o1[2] + o2[2])) ? 1 : 0;
            ao[i] = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
            const b = AO_LEVELS[ao[i]];
            colors.push(b, b, b);
          }

          // 沿亮度差更小的对角线切开，避免奇怪的明暗条纹
          if (ao[0] + ao[3] > ao[1] + ao[2]) {
            indices.push(start, start + 1, start + 3, start, start + 3, start + 2);
          } else {
            indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
          }
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
