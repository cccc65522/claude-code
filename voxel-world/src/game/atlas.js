import { mulberry32 } from './noise.js';
import { TILE } from './blocks.js';
import { ATLAS_COLS, ATLAS_ROWS } from './mesher.js';

// 在 canvas 上逐像素画出 16x16 的原创像素纹理，拼成一张图集。
export const TILE_PX = 16;

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

function painter(img, tile) {
  const ox = (tile % ATLAS_COLS) * TILE_PX;
  const oy = Math.floor(tile / ATLAS_COLS) * TILE_PX;
  const w = img.width;
  return (x, y, r, g, b, a = 255) => {
    const i = ((oy + y) * w + ox + x) * 4;
    img.data[i] = clamp(r);
    img.data[i + 1] = clamp(g);
    img.data[i + 2] = clamp(b);
    img.data[i + 3] = a;
  };
}

function fill(put, rand, [r, g, b], spread) {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const k = 1 + (rand() - 0.5) * spread;
      put(x, y, r * k, g * k, b * k);
    }
  }
}

const DIRT = [134, 96, 67];
const GRASS = [96, 168, 72];
const SNOW = [236, 242, 248];

function dirtWithTop(put, rand, top, depthBase) {
  fill(put, rand, DIRT, 0.35);
  for (let x = 0; x < TILE_PX; x++) {
    const depth = depthBase + Math.floor(rand() * 3);
    for (let y = 0; y < depth; y++) {
      const k = 1 + (rand() - 0.5) * 0.25 - y * 0.03;
      put(x, y, top[0] * k, top[1] * k, top[2] * k);
    }
  }
}

const painters = {
  [TILE.grassTop]: (put, rand) => fill(put, rand, GRASS, 0.3),
  [TILE.grassSide]: (put, rand) => dirtWithTop(put, rand, GRASS, 3),
  [TILE.dirt]: (put, rand) => fill(put, rand, DIRT, 0.35),
  [TILE.stone]: (put, rand) => {
    fill(put, rand, [128, 128, 132], 0.22);
    for (let i = 0; i < 5; i++) {
      let x = Math.floor(rand() * TILE_PX);
      let y = Math.floor(rand() * TILE_PX);
      for (let j = 0; j < 4; j++) {
        put(x, y, 98, 98, 104);
        x = (x + (rand() < 0.5 ? 1 : 0)) % TILE_PX;
        y = (y + (rand() < 0.5 ? 1 : 0)) % TILE_PX;
      }
    }
  },
  [TILE.sand]: (put, rand) => fill(put, rand, [222, 206, 152], 0.14),
  [TILE.logSide]: (put, rand) => {
    for (let x = 0; x < TILE_PX; x++) {
      const stripe = x % 4 === 0 ? 0.78 : 1;
      for (let y = 0; y < TILE_PX; y++) {
        const k = stripe * (1 + (rand() - 0.5) * 0.18);
        put(x, y, 112 * k, 80 * k, 50 * k);
      }
    }
  },
  [TILE.logTop]: (put, rand) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const edge = d > 6.5;
        const ring = Math.floor(d) % 2 === 0 ? 0.88 : 1;
        const k = 1 + (rand() - 0.5) * 0.1;
        if (edge) put(x, y, 104 * k, 74 * k, 46 * k);
        else put(x, y, 184 * ring * k, 146 * ring * k, 94 * ring * k);
      }
    }
  },
  [TILE.leaves]: (put, rand) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (rand() < 0.16) {
          put(x, y, 0, 0, 0, 0); // 透明的小洞
        } else {
          const k = 1 + (rand() - 0.5) * 0.5;
          put(x, y, 58 * k, 132 * k, 52 * k);
        }
      }
    }
  },
  [TILE.planks]: (put, rand) => {
    for (let y = 0; y < TILE_PX; y++) {
      const board = Math.floor(y / 4);
      const seam = y % 4 === 3;
      const shift = board % 2 === 0 ? 3 : 11;
      for (let x = 0; x < TILE_PX; x++) {
        const k = (seam || x === shift ? 0.7 : 1) * (1 + (rand() - 0.5) * 0.12);
        put(x, y, 186 * k, 146 * k, 92 * k);
      }
    }
  },
  [TILE.glass]: (put, rand) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const border = x === 0 || y === 0 || x === TILE_PX - 1 || y === TILE_PX - 1;
        const shine = (x - y === 3 || x - y === 5) && x > 3 && x < 11;
        if (border) put(x, y, 196, 226, 236);
        else if (shine) put(x, y, 236, 248, 252);
        else put(x, y, 0, 0, 0, 0);
      }
    }
    void rand;
  },
  [TILE.brick]: (put, rand) => {
    for (let y = 0; y < TILE_PX; y++) {
      const rowIdx = Math.floor(y / 4);
      const mortarRow = y % 4 === 3;
      const offset = rowIdx % 2 === 0 ? 0 : 4;
      for (let x = 0; x < TILE_PX; x++) {
        const mortar = mortarRow || (x + offset) % 8 === 7;
        const k = 1 + (rand() - 0.5) * 0.18;
        if (mortar) put(x, y, 200 * k, 192 * k, 180 * k);
        else put(x, y, 168 * k, 72 * k, 56 * k);
      }
    }
  },
  [TILE.snowTop]: (put, rand) => fill(put, rand, SNOW, 0.06),
  [TILE.snowSide]: (put, rand) => dirtWithTop(put, rand, SNOW, 4),
  [TILE.bedrock]: (put, rand) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const v = rand() < 0.35 ? 40 : 84 + rand() * 30;
        put(x, y, v, v, v + 4);
      }
    }
  },
};

export function createAtlasCanvas(seed = 2024) {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = ATLAS_ROWS * TILE_PX;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  for (const [tile, paint] of Object.entries(painters)) {
    paint(painter(img, Number(tile)), mulberry32(seed + Number(tile) * 101));
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
