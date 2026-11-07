import { AIR, BLOCKS, isLiquid, isOpaque, isTransparent, waterLevel } from './blocks.js';
import { lightBrightness } from './light.js';
import { panelBox } from './building.js';
import { CHUNK } from './world.js';

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 16; // 4×16 = 64 格；TILE 编号要小于这个数（有测试检查）

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

// 两个块之间的面要不要画（实心方块、玻璃、树叶）
export function faceVisible(block, neighbor) {
  if (neighbor === AIR) return true;
  if (!isTransparent(neighbor)) return false;
  return neighbor !== block; // 玻璃挨着玻璃、树叶挨着树叶时不画中间那层
}

// 水面比方块顶低一点，看起来更像水；流动的水越远越浅
export const WATER_SURFACE = 0.88;

// 一格水的高度（0–1）。上面还有水时是满的。
export function liquidHeight(id, above) {
  if (isLiquid(above)) return 1;
  const level = waterLevel(id);
  if (level >= 8) return WATER_SURFACE;
  return 0.1 + level * 0.1;
}

function makeBuffers() {
  return { positions: [], normals: [], uvs: [], colors: [], light: [], sky: [], indices: [] };
}

// 火把：一根 2/16 粗、10/16 高的小棍，贴图只取图集格子里对应的那一小块
const TORCH_MIN = 7 / 16;
const TORCH_MAX = 9 / 16;
const TORCH_TOP = 10 / 16;

// 庄稼：两片沿对角线交叉的贴图，正反两面都画
const CROSS = [
  [[0.1, 0.1], [0.9, 0.9]],
  [[0.1, 0.9], [0.9, 0.1]],
];
function addCross(b, tile, x, y, z, light, sky = 1) {
  for (const [[ax, az], [bx, bz]] of CROSS) {
    for (const back of [false, true]) {
      const start = b.positions.length / 3;
      const corners = [
        [ax, 0, az, 0, 0],
        [bx, 0, bz, 1, 0],
        [ax, 1, az, 0, 1],
        [bx, 1, bz, 1, 1],
      ];
      for (const [px, py, pz, u, v] of corners) {
        b.positions.push(x + px, y + py, z + pz);
        b.normals.push(0, 1, 0); // 朝上，和地面一样亮
        pushUv(b, tile, u, v);
        b.colors.push(1, 1, 1);
        b.light.push(light);
        b.sky.push(sky);
      }
      if (back) b.indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
      else b.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
    }
  }
}

export const BED_HEIGHT = 0.56;
function addBedBox(b, tiles, x, y, z, light, sky = 1) {
  for (const face of FACES) {
    const [dx, dy, dz] = face.dir;
    const tile = tiles[face.side];
    const start = b.positions.length / 3;
    for (const [px, py, pz, u, v] of face.corners) {
      b.positions.push(x + px, y + (py ? BED_HEIGHT : 0), z + pz);
      b.normals.push(dx, dy, dz);
      // 侧面只取贴图下面一截，免得被压扁
      pushUv(b, tile, u, dy === 0 && v ? BED_HEIGHT : v);
      b.colors.push(1, 1, 1);
      b.light.push(light);
      b.sky.push(sky);
    }
    b.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  }
}

// 一个小盒子（鸭蛋）：整张贴图贴在每个面上
function addBox(b, tile, x, y, z, min, max, light, sky = 1) {
  for (const face of FACES) {
    const [dx, dy, dz] = face.dir;
    const start = b.positions.length / 3;
    for (const [px, py, pz, u, v] of face.corners) {
      b.positions.push(x + (px ? max[0] : min[0]), y + (py ? max[1] : min[1]), z + (pz ? max[2] : min[2]));
      b.normals.push(dx, dy, dz);
      pushUv(b, tile, u, v);
      b.colors.push(1, 1, 1);
      b.light.push(light);
      b.sky.push(sky);
    }
    b.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  }
}

function addTorch(b, tile, x, y, z, sky = 1) {
  for (const face of FACES) {
    const [dx, dy, dz] = face.dir;
    if (dy < 0) continue; // 底面看不到
    const start = b.positions.length / 3;
    for (const [px, py, pz, u, v] of face.corners) {
      const fx = px ? TORCH_MAX : TORCH_MIN;
      const fz = pz ? TORCH_MAX : TORCH_MIN;
      const fy = py ? TORCH_TOP : 0;
      b.positions.push(x + fx, y + fy, z + fz);
      b.normals.push(dx, dy, dz);
      const col = tile % ATLAS_COLS;
      const row = Math.floor(tile / ATLAS_COLS);
      // 侧面：小棍那两列像素，从底到 10/16；顶面：火苗那一块
      const tu = TORCH_MIN + (u ? 2 / 16 : 0);
      const tv = dy > 0 ? 8 / 16 + (v ? 2 / 16 : 0) : v ? TORCH_TOP : 0;
      b.uvs.push((col + tu) / ATLAS_COLS, 1 - (row + 1 - tv) / ATLAS_ROWS);
      b.colors.push(1, 1, 1);
      b.light.push(1); // 火把自己永远是亮的
      b.sky.push(sky);
    }
    b.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  }
}

function finish(b) {
  return {
    positions: new Float32Array(b.positions),
    normals: new Float32Array(b.normals),
    uvs: new Float32Array(b.uvs),
    colors: new Float32Array(b.colors),
    light: new Float32Array(b.light),
    sky: new Float32Array(b.sky),
    indices: new Uint32Array(b.indices),
  };
}

// u、v 是这一格贴图里的位置（0–1，v=1 是贴图上边），稍微往里收一点免得采到隔壁的贴图
function pushUv(b, tile, u, v) {
  const eps = 0.001;
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  const cu = Math.min(1 - eps, Math.max(eps, Number(u)));
  const cv = Math.min(1 - eps, Math.max(eps, Number(v)));
  b.uvs.push((col + cu) / ATLAS_COLS, 1 - (row + 1 - cv) / ATLAS_ROWS);
}

/**
 * 给一个区块生成几何数据（只用类型化数组，不依赖 three.js）。
 * 顶层字段是实心方块的网格，water 是单独的半透明水面网格。
 * 顶点坐标是世界坐标。
 */
export function buildChunkGeometry(world, cx, cz) {
  const solid = makeBuffers();
  const water = makeBuffers();
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const ao = [0, 0, 0, 0];

  for (let y = 0; y < world.sizeY; y++) {
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let x = x0; x < x0 + CHUNK; x++) {
        const block = world.get(x, y, z);
        if (block === AIR) continue;
        const def = BLOCKS[block];
        if (!def) continue;

        if (def.liquid) {
          const above = world.get(x, y + 1, z);
          const h = liquidHeight(block, above);
          const lit = lightBrightness(world.lightAt(x, y, z));
          const litSky = lightBrightness(world.skyAt(x, y, z));
          for (const face of FACES) {
            const [dx, dy, dz] = face.dir;
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            const neighbor = world.get(nx, ny, nz);
            if (isOpaque(neighbor)) continue;
            let bottom = 0;
            if (dy > 0) {
              if (isLiquid(neighbor)) continue;
            } else if (dy < 0) {
              if (isLiquid(neighbor)) continue;
            } else if (isLiquid(neighbor)) {
              // 旁边的水更低时，只画高出来的那一截
              bottom = liquidHeight(neighbor, world.get(nx, ny + 1, nz));
              if (bottom >= h) continue;
            }
            const start = water.positions.length / 3;
            for (const [px, py, pz, u, v] of face.corners) {
              water.positions.push(x + px, y + (py ? h : bottom), z + pz);
              water.normals.push(dx, dy, dz);
              pushUv(water, def.tiles[face.side], u, v);
              water.colors.push(1, 1, 1);
              water.light.push(lit);
              water.sky.push(litSky);
            }
            water.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
          }
          continue;
        }

        if (def.shape === 'crop') {
          addCross(solid, def.tiles.side, x, y, z, lightBrightness(world.lightAt(x, y, z)), lightBrightness(world.skyAt(x, y, z)));
          continue;
        }

        if (def.shape === 'bed') {
          // 矮矮的一格：顶面是被子，侧面是木框
          addBedBox(solid, def.tiles, x, y, z, lightBrightness(world.lightAt(x, y + 1, z)), lightBrightness(world.skyAt(x, y + 1, z)));
          continue;
        }

        if (def.shape === 'door' || def.shape === 'ladder') {
          // 薄薄的一块板：门（关着贴在一边，开着转到旁边那一面）或者贴墙的梯子
          const [min, max] = panelBox(block);
          addBox(solid, def.tiles.side, x, y, z, min, max, lightBrightness(world.lightAt(x, y, z)), lightBrightness(world.skyAt(x, y, z)));
          continue;
        }

        if (def.shape === 'egg') {
          // 下面宽、上面窄的两块，看起来像个蛋
          const eggLight = lightBrightness(world.lightAt(x, y, z));
          const eggSky = lightBrightness(world.skyAt(x, y, z));
          addBox(solid, def.tiles.side, x, y, z, [0.35, 0, 0.35], [0.65, 0.24, 0.65], eggLight, eggSky);
          addBox(solid, def.tiles.side, x, y, z, [0.39, 0.24, 0.39], [0.61, 0.4, 0.61], eggLight, eggSky);
          continue;
        }

        if (def.shape === 'torch') {
          addTorch(solid, def.tiles.side, x, y, z, lightBrightness(world.skyAt(x, y, z)));
          continue;
        }

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const neighbor = world.get(x + dx, y + dy, z + dz);
          if (!faceVisible(block, neighbor)) continue;

          const tile = def.tiles[face.side];
          const start = solid.positions.length / 3;

          // 面的法线方向之外的两个轴
          const axes = [0, 1, 2].filter((a) => face.dir[a] === 0);
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;

          for (let i = 0; i < 4; i++) {
            const [px, py, pz, u, v] = face.corners[i];
            solid.positions.push(x + px, y + py, z + pz);
            solid.normals.push(dx, dy, dz);
            pushUv(solid, tile, u, v);

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
            solid.colors.push(b, b, b);

            // 火把光和天光：取这个角周围（不被挡住的）几格的平均，光照边缘更柔和
            let sum = lightBrightness(world.lightAt(nx, ny, nz));
            let skySum = lightBrightness(world.skyAt(nx, ny, nz));
            let count = 1;
            const sample = (ax, ay, az) => {
              sum += lightBrightness(world.lightAt(ax, ay, az));
              skySum += lightBrightness(world.skyAt(ax, ay, az));
              count++;
            };
            if (!s1) sample(nx + o1[0], ny + o1[1], nz + o1[2]);
            if (!s2) sample(nx + o2[0], ny + o2[1], nz + o2[2]);
            if (!c && !(s1 && s2)) sample(nx + o1[0] + o2[0], ny + o1[1] + o2[1], nz + o1[2] + o2[2]);
            solid.light.push(sum / count);
            solid.sky.push(skySum / count);
          }

          // 沿亮度差更小的对角线切开，避免奇怪的明暗条纹
          if (ao[0] + ao[3] > ao[1] + ao[2]) {
            solid.indices.push(start, start + 1, start + 3, start, start + 3, start + 2);
          } else {
            solid.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
          }
        }
      }
    }
  }

  return { ...finish(solid), water: finish(water) };
}
