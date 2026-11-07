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

// 水：蓝色带一些亮一点的波纹（透明度由材质控制）
painters[TILE.water] = (put, rand) => {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const wave = (x + Math.floor(y / 2) * 3) % 8 < 2 && y % 4 === 1;
      const k = 1 + (rand() - 0.5) * 0.12;
      if (wave) put(x, y, 120 * k, 180 * k, 236 * k);
      else put(x, y, 44 * k, 108 * k, 196 * k);
    }
  }
};

// 火把：只有中间两列像素有颜色，下面是木棍，上面三行是火苗；其它地方透明
painters[TILE.torch] = (put, rand) => {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) put(x, y, 0, 0, 0, 0);
  }
  for (let y = 6; y < TILE_PX; y++) {
    for (const x of [7, 8]) {
      const k = 1 + (rand() - 0.5) * 0.15;
      if (y === 6) put(x, y, 255, 236, 140);
      else if (y === 7) put(x, y, 255, 196 * k, 70);
      else if (y === 8) put(x, y, 240, 130 * k, 40);
      else put(x, y, 120 * k, 84 * k, 48 * k);
    }
  }
};

painters[TILE.coalOre] = (put, rand) => {
  painters[TILE.stone](put, rand);
  for (let i = 0; i < 6; i++) {
    const cx = 2 + Math.floor(rand() * 11);
    const cy = 2 + Math.floor(rand() * 11);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (rand() < 0.8) put(cx + dx, cy + dy, 34, 34, 38);
    }
  }
};

// 物品图标（不是方块，只在背包和快捷栏里显示）
function transparent(put) {
  for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) put(x, y, 0, 0, 0, 0);
}
painters[TILE.stick] = (put, rand) => {
  transparent(put);
  for (let i = 2; i < 14; i++) {
    const k = 1 + (rand() - 0.5) * 0.2;
    put(i, 15 - i, 140 * k, 100 * k, 60 * k);
    put(i + 1, 15 - i, 104 * k, 72 * k, 42 * k);
  }
};
painters[TILE.coal] = (put, rand) => {
  transparent(put);
  for (let y = 3; y < 13; y++) {
    for (let x = 3; x < 13; x++) {
      const d = Math.hypot(x - 7.5, y - 7.8);
      if (d > 5 + rand() * 0.8) continue;
      const v = 30 + rand() * 30 + (x + y < 13 ? 25 : 0);
      put(x, y, v, v, v + 6);
    }
  }
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
