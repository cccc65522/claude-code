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

painters[TILE.ironOre] = (put, rand) => {
  painters[TILE.stone](put, rand);
  for (let i = 0; i < 6; i++) {
    const cx = 2 + Math.floor(rand() * 11);
    const cy = 2 + Math.floor(rand() * 11);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) put(cx + dx, cy + dy, 214, 162, 120);
  }
};

const STONE_HEAD = [132, 132, 138];
const IRON_HEAD = [218, 222, 228];

function handle(put, rand, from = 3, to = 12) {
  for (let i = from; i <= to; i++) {
    const k = 1 + (rand() - 0.5) * 0.2;
    put(i, 15 - i, 140 * k, 100 * k, 60 * k);
  }
}
function pickaxe(put, rand, [r, g, b]) {
  transparent(put);
  handle(put, rand, 2, 11);
  // 横着的镐头：一道弧
  const head = [[4, 3], [5, 2], [6, 2], [7, 2], [8, 2], [9, 3], [10, 3], [11, 4], [12, 5], [12, 6], [13, 7], [13, 8], [13, 9], [12, 10], [3, 4], [10, 4], [11, 5]];
  for (const [x, y] of head) {
    const k = 1 + (rand() - 0.5) * 0.15;
    put(x, y, r * k, g * k, b * k);
  }
}
painters[TILE.stonePickaxe] = (put, rand) => pickaxe(put, rand, STONE_HEAD);
painters[TILE.ironPickaxe] = (put, rand) => pickaxe(put, rand, IRON_HEAD);
painters[TILE.stoneShovel] = (put, rand) => {
  transparent(put);
  handle(put, rand, 2, 9);
  for (let y = 2; y <= 6; y++) for (let x = 9; x <= 13; x++) {
    if (Math.abs(x - 11) + Math.abs(y - 4) > 3) continue;
    const k = 1 + (rand() - 0.5) * 0.15;
    put(x, y, STONE_HEAD[0] * k, STONE_HEAD[1] * k, STONE_HEAD[2] * k);
  }
};
painters[TILE.stoneAxe] = (put, rand) => {
  transparent(put);
  handle(put, rand, 2, 12);
  for (let y = 2; y <= 7; y++) for (let x = 7; x <= 11; x++) {
    if (x + y < 10 || x - y > 6 || (x > 9 && y > 5)) continue;
    const k = 1 + (rand() - 0.5) * 0.15;
    put(x, y, STONE_HEAD[0] * k, STONE_HEAD[1] * k, STONE_HEAD[2] * k);
  }
};
painters[TILE.ironIngot] = (put, rand) => {
  transparent(put);
  for (let y = 6; y <= 10; y++) for (let x = 2; x <= 13; x++) {
    const inset = 10 - y; // 上窄下宽
    if (x < 2 + inset / 2 || x > 13 - inset / 2) continue;
    const edge = y === 10 || x < 3 + inset / 2 || x > 12 - inset / 2;
    const k = 1 + (rand() - 0.5) * 0.08;
    if (edge) put(x, y, 92, 96, 104);
    else if (y === 6) put(x, y, 226 * k, 230 * k, 236 * k);
    else put(x, y, 168 * k, 174 * k, 184 * k);
  }
};
function bucket(put, rand, water) {
  transparent(put);
  for (let y = 5; y <= 13; y++) {
    const half = 5 - Math.floor((y - 5) / 3);
    for (let x = 8 - half; x < 8 + half; x++) {
      const edge = x === 8 - half || x === 8 + half - 1 || y === 13;
      const k = 1 + (rand() - 0.5) * 0.1;
      if (water && y <= 7 && !edge) put(x, y, 50 * k, 120 * k, 210 * k);
      else if (edge || y === 5) put(x, y, 150 * k, 154 * k, 160 * k);
      else put(x, y, 196 * k, 200 * k, 206 * k);
    }
  }
  for (const [x, y] of [[3, 4], [4, 3], [5, 2], [6, 2], [7, 1], [8, 1], [9, 2], [10, 2], [11, 3], [12, 4]]) put(x, y, 120, 122, 128);
}
painters[TILE.bucket] = (put, rand) => bucket(put, rand, false);
painters[TILE.waterBucket] = (put, rand) => bucket(put, rand, true);

// 食物图标
painters[TILE.apple] = (put, rand) => {
  transparent(put);
  for (let y = 4; y < 15; y++) for (let x = 2; x < 14; x++) {
    const d = Math.hypot((x - 7.5) / 5.5, (y - 9.5) / 5.2);
    if (d > 1) continue;
    const k = 1 + (rand() - 0.5) * 0.12;
    const shine = x < 6 && y < 8;
    put(x, y, (shine ? 250 : 210) * k, (shine ? 110 : 40) * k, (shine ? 100 : 40) * k);
  }
  put(8, 3, 110, 76, 40);
  put(8, 2, 110, 76, 40);
  put(9, 2, 80, 160, 60);
  put(10, 2, 80, 160, 60);
  put(10, 1, 80, 160, 60);
};
painters[TILE.berries] = (put, rand) => {
  transparent(put);
  for (const [cx, cy] of [[5, 6], [10, 6], [7.5, 10], [4, 11], [11, 11]]) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (Math.hypot(x - cx, y - cy) > 2.3) continue;
      const k = 1 + (rand() - 0.5) * 0.15;
      const shine = x < cx && y < cy;
      put(x, y, (shine ? 150 : 110) * k, (shine ? 80 : 30) * k, (shine ? 200 : 150) * k);
    }
  }
  for (const [x, y] of [[7, 2], [8, 2], [8, 3], [6, 3]]) put(x, y, 70, 140, 60);
};
painters[TILE.pie] = (put, rand) => {
  transparent(put);
  for (let y = 6; y <= 12; y++) for (let x = 1; x <= 14; x++) {
    const top = y <= 8;
    const inset = top ? 9 - y : 0;
    if (x < 1 + inset || x > 14 - inset) continue;
    const k = 1 + (rand() - 0.5) * 0.12;
    if (y === 12) put(x, y, 150 * k, 100 * k, 50 * k);
    else if (top && (x + y) % 3 === 0) put(x, y, 170 * k, 40 * k, 70 * k); // 露出来的果酱
    else put(x, y, 222 * k, 168 * k, 96 * k);
  }
};

// ---------- 耕种 ----------
painters[TILE.farmland] = (put, rand) => {
  for (let y = 0; y < TILE_PX; y++) {
    const furrow = y % 4 === 0 || y % 4 === 1;
    for (let x = 0; x < TILE_PX; x++) {
      const k = (furrow ? 0.72 : 1) * (1 + (rand() - 0.5) * 0.25);
      put(x, y, 104 * k, 70 * k, 44 * k);
    }
  }
};

// 小麦四个阶段：越来越高，最后变成金黄色、顶上有麦穗
function wheat(stage) {
  return (put, rand) => {
    transparent(put);
    const height = [4, 7, 11, 14][stage];
    const stems = [1, 4, 7, 10, 13];
    for (const sx of stems) {
      const h = height - Math.floor(rand() * 2);
      for (let i = 0; i < h; i++) {
        const y = 15 - i;
        const x = sx + (i > h / 2 && sx % 2 ? 1 : 0);
        const k = 1 + (rand() - 0.5) * 0.2;
        if (stage === 3) {
          const head = i >= h - 4;
          if (head) {
            put(x, y, 226 * k, 186 * k, 84 * k);
            if (x + 1 < TILE_PX) put(x + 1, y, 200 * k, 160 * k, 64 * k);
          } else {
            put(x, y, 190 * k, 170 * k, 80 * k);
          }
        } else {
          const g = stage === 2 && i >= h - 3 ? [120, 170, 60] : [70, 150, 50];
          put(x, y, g[0] * k, g[1] * k, g[2] * k);
        }
      }
    }
  };
}
for (let s = 0; s < 4; s++) painters[TILE.wheat0 + s] = wheat(s);

painters[TILE.seeds] = (put, rand) => {
  transparent(put);
  for (const [x, y] of [[4, 6], [8, 4], [11, 7], [6, 10], [10, 11], [3, 12], [12, 3]]) {
    const k = 1 + (rand() - 0.5) * 0.2;
    put(x, y, 120 * k, 160 * k, 60 * k);
    put(x + 1, y, 90 * k, 130 * k, 40 * k);
  }
};
painters[TILE.wheatItem] = (put, rand) => {
  transparent(put);
  for (let i = 0; i < 12; i++) {
    for (const off of [-2, 0, 2]) {
      const x = 7 + off + Math.round((i - 6) * 0.12 * off);
      const y = 14 - i;
      if (x < 0 || x >= TILE_PX) continue;
      const k = 1 + (rand() - 0.5) * 0.2;
      const head = i > 6;
      put(x, y, (head ? 230 : 200) * k, (head ? 190 : 176) * k, (head ? 80 : 90) * k);
    }
  }
};
painters[TILE.bread] = (put, rand) => {
  transparent(put);
  for (let y = 5; y <= 12; y++) for (let x = 1; x <= 14; x++) {
    const d = Math.hypot((x - 7.5) / 6.8, (y - 9) / 4);
    if (d > 1) continue;
    const k = 1 + (rand() - 0.5) * 0.1;
    const crust = y <= 7 || d > 0.8;
    const cut = y <= 8 && (x === 4 || x === 8 || x === 12);
    if (cut) put(x, y, 240 * k, 210 * k, 150 * k);
    else if (crust) put(x, y, 180 * k, 110 * k, 50 * k);
    else put(x, y, 214 * k, 150 * k, 80 * k);
  }
};
painters[TILE.stoneHoe] = (put, rand) => {
  transparent(put);
  handle(put, rand, 2, 11);
  for (const [x, y] of [[9, 2], [10, 2], [11, 2], [12, 2], [12, 3], [13, 3], [13, 4], [10, 3], [11, 3]]) {
    const k = 1 + (rand() - 0.5) * 0.15;
    put(x, y, STONE_HEAD[0] * k, STONE_HEAD[1] * k, STONE_HEAD[2] * k);
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
