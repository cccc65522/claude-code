import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, CHUNK } from '../src/game/world.js';
import { AIR, STONE, GLASS, GRASS, BEDROCK } from '../src/game/blocks.js';
import { buildChunkGeometry } from '../src/game/mesher.js';
import { raycast } from '../src/game/raycast.js';
import { createPlayer, stepPlayer, overlapsBlock } from '../src/game/player.js';

const empty = () => new World({ seed: 1, chunks: 2, generate: false });

test('同一个种子生成同样的地形，不同种子不一样', () => {
  const a = new World({ seed: 42, chunks: 2 });
  const b = new World({ seed: 42, chunks: 2 });
  const c = new World({ seed: 43, chunks: 2 });
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, c.data);
});

test('地形底层是基岩，出生点脚下有方块、头上是空气', () => {
  const w = new World({ seed: 7, chunks: 4 });
  assert.equal(w.get(5, 0, 5), BEDROCK);
  const [x, y, z] = w.spawnPoint();
  assert.notEqual(w.get(Math.floor(x), y - 1, Math.floor(z)), AIR);
  assert.equal(w.get(Math.floor(x), y, Math.floor(z)), AIR);
  assert.equal(w.get(Math.floor(x), y + 1, Math.floor(z)), AIR);
});

test('改动会被记录，存档可以还原', () => {
  const w = new World({ seed: 9, chunks: 2 });
  assert.equal(w.set(3, 40, 3, STONE), true);
  assert.equal(w.set(3, 40, 3, STONE), false, '同样的方块不算改动');
  assert.equal(w.set(-1, 5, 0, STONE), false, '越界不改');
  const saved = JSON.parse(JSON.stringify(w.exportEdits()));
  const w2 = new World({ seed: 9, chunks: 2 });
  w2.applyEdits([...saved, ['bad'], [1, 2, 3], [1.5, 2, 3, 1]]);
  assert.equal(w2.get(3, 40, 3), STONE);
  assert.deepEqual(w2.data, w.data);
});

test('区块边上的方块会通知邻居区块重建', () => {
  const w = empty();
  assert.deepEqual(w.affectedChunks(5, 5), [[0, 0]]);
  assert.deepEqual(w.affectedChunks(CHUNK - 1, 5), [[0, 0], [1, 0]]);
  assert.deepEqual(w.affectedChunks(CHUNK, CHUNK), [[1, 1], [0, 1], [1, 0]]);
  assert.deepEqual(w.affectedChunks(0, 0), [[0, 0]], '世界边上没有邻居');
});

test('网格：单个方块 6 个面，两个相邻的方块 10 个面', () => {
  const w = empty();
  w.set(4, 10, 4, STONE);
  let g = buildChunkGeometry(w, 0, 0);
  assert.equal(g.positions.length / 3, 24);
  assert.equal(g.indices.length, 36);
  w.set(5, 10, 4, STONE);
  g = buildChunkGeometry(w, 0, 0);
  assert.equal(g.positions.length / 12, 10);
  assert.equal(buildChunkGeometry(w, 1, 1).indices.length, 0);
});

test('网格：透过玻璃能看到石头的面；贴着石头的玻璃面和玻璃挨玻璃都不画', () => {
  const w = empty();
  w.set(4, 10, 4, STONE);
  w.set(5, 10, 4, GLASS);
  assert.equal(buildChunkGeometry(w, 0, 0).positions.length / 12, 11);
  w.set(4, 10, 4, GLASS);
  assert.equal(buildChunkGeometry(w, 0, 0).positions.length / 12, 10);
});

test('网格：顶面的法线朝上，环境光遮蔽在墙角变暗', () => {
  const w = empty();
  w.set(4, 10, 4, STONE);
  let g = buildChunkGeometry(w, 0, 0);
  assert.ok(g.colors.every((c) => c === 1), '孤立方块不被遮挡');
  w.set(5, 11, 4, STONE); // 在顶面旁边加一块
  g = buildChunkGeometry(w, 0, 0);
  assert.ok(g.colors.some((c) => c < 1));
  for (let i = 0; i < g.normals.length; i += 3) {
    const n = Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]);
    assert.equal(n, 1);
  }
});

test('射线检测：返回碰到的方块和面', () => {
  const w = empty();
  w.set(10, 5, 10, STONE);
  const down = raycast(w, [10.5, 9, 10.5], [0, -1, 0], 6);
  assert.deepEqual(down.hit, [10, 5, 10]);
  assert.deepEqual(down.normal, [0, 1, 0]);
  const side = raycast(w, [7.2, 5.5, 10.5], [1, 0.05, 0], 6);
  assert.deepEqual(side.hit, [10, 5, 10]);
  assert.deepEqual(side.normal, [-1, 0, 0]);
  assert.equal(raycast(w, [10.5, 20, 10.5], [0, -1, 0], 6), null, '太远够不着');
  assert.equal(raycast(w, [10.5, 9, 10.5], [0, 0, 0], 6), null);
});

test('玩家会落到地面上站稳，不会穿过去', () => {
  const w = empty();
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.set(x, 4, z, GRASS);
  const p = createPlayer([8.5, 12, 8.5]);
  for (let i = 0; i < 120; i++) stepPlayer(w, p, {}, 1 / 30);
  assert.ok(Math.abs(p.pos[1] - 5) < 0.01, `落在 y=5，实际 ${p.pos[1]}`);
  assert.equal(p.onGround, true);
  // 一次很大的时间步也不会掉下去
  stepPlayer(w, p, {}, 0.5);
  assert.ok(p.pos[1] > 4.99);
});

test('玩家会被墙挡住，能跳上一格高的台阶', () => {
  const w = empty();
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.set(x, 0, z, STONE);
  for (let z = 0; z < 32; z++) {
    w.set(12, 1, z, STONE);
    w.set(12, 2, z, STONE);
  }
  const p = createPlayer([8.5, 1, 8.5], -Math.PI / 2); // 面朝 +x
  for (let i = 0; i < 90; i++) stepPlayer(w, p, { forward: 1 }, 1 / 30);
  assert.ok(p.pos[0] < 12 - 0.29 && p.pos[0] > 11.6, `停在墙前，实际 x=${p.pos[0]}`);

  w.set(12, 2, 8, AIR);
  for (let z = 0; z < 32; z++) w.set(12, 2, z, AIR);
  for (let i = 0; i < 60; i++) stepPlayer(w, p, { forward: 1, jump: true }, 1 / 30);
  assert.ok(p.pos[0] > 12.3, `跳上台阶，实际 x=${p.pos[0]}`);
  assert.ok(p.pos[1] >= 2 - 0.01);
});

test('世界边界是墙；飞行时不受重力，落地自动停止飞行', () => {
  const w = empty();
  const p = createPlayer([0.5, 3, 0.5], Math.PI / 2); // 面朝 -x
  p.flying = true;
  for (let i = 0; i < 30; i++) stepPlayer(w, p, { forward: 1 }, 1 / 30);
  assert.ok(p.pos[0] >= 0.3 - 1e-3, `不会走出世界，x=${p.pos[0]}`);
  assert.ok(Math.abs(p.pos[1] - 3) < 0.01, '飞行时高度不变');
  for (let i = 0; i < 60; i++) stepPlayer(w, p, { down: true }, 1 / 30);
  assert.equal(p.flying, false);
  assert.ok(Math.abs(p.pos[1]) < 0.01);
});

test('放方块不能放在自己身上', () => {
  const p = createPlayer([4.5, 5, 4.5]);
  assert.equal(overlapsBlock(p, 4, 5, 4), true);
  assert.equal(overlapsBlock(p, 4, 6, 4), true);
  assert.equal(overlapsBlock(p, 4, 7, 4), false);
  assert.equal(overlapsBlock(p, 4, 4, 4), false);
  assert.equal(overlapsBlock(p, 5, 5, 4), false);
});

// ---------- 水 ----------
import { WATER, SAND as SAND_ID } from '../src/game/blocks.js';
import { SEA_LEVEL } from '../src/game/world.js';
import { WATER_SURFACE } from '../src/game/mesher.js';
import { bodyInWater } from '../src/game/player.js';
import { skyAt, clockText, wrapTime } from '../src/game/daynight.js';

test('地形里低洼的地方灌满水，水不会超过海平面，出生点不在水里', () => {
  let found = null;
  for (let seed = 1; seed < 30 && !found; seed++) {
    const w = new World({ seed, chunks: 4 });
    if (w.data.includes(WATER)) found = w;
  }
  assert.ok(found, '应该能找到有湖的世界');
  const w = found;
  for (let i = 0; i < w.data.length; i++) {
    if (w.data[i] !== WATER) continue;
    const y = Math.floor(i / (w.sizeX * w.sizeZ));
    assert.ok(y <= SEA_LEVEL);
  }
  const [x, y, z] = w.spawnPoint();
  assert.notEqual(w.get(Math.floor(x), y - 1, Math.floor(z)), WATER);
  assert.notEqual(w.get(Math.floor(x), y, Math.floor(z)), WATER);
});

test('水可以穿过、射线会穿过水打到水底', () => {
  const w = empty();
  w.set(5, 3, 5, SAND_ID);
  w.set(5, 4, 5, WATER);
  w.set(5, 5, 5, WATER);
  assert.equal(w.isSolid(5, 4, 5), false);
  const r = raycast(w, [5.5, 8, 5.5], [0, -1, 0], 6);
  assert.deepEqual(r.hit, [5, 3, 5]);
  assert.deepEqual(r.normal, [0, 1, 0], '可以把方块放进水里');
});

test('水单独成网格：只画露在外面的面，水面比方块顶低一点；水底的沙子照样画', () => {
  const w = empty();
  w.set(4, 3, 4, SAND_ID);
  w.set(4, 4, 4, WATER);
  w.set(4, 5, 4, WATER);
  const g = buildChunkGeometry(w, 0, 0);
  assert.equal(g.water.positions.length / 12, 9, '两格水叠起来：中间和贴着沙子的面不画');
  const maxY = Math.max(...g.water.positions.filter((_, i) => i % 3 === 1));
  assert.ok(Math.abs(maxY - (5 + WATER_SURFACE)) < 1e-6);
  assert.equal(g.positions.length / 12, 6, '沙子的顶面挨着水，也要画');
});

test('玩家在水里慢慢下沉，按跳会往上游', () => {
  const w = empty();
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    w.set(x, 0, z, STONE);
    for (let y = 1; y <= 8; y++) w.set(x, y, z, WATER);
  }
  const p = createPlayer([8.5, 5, 8.5]);
  stepPlayer(w, p, {}, 0.5);
  assert.equal(p.inWater, true);
  assert.ok(p.pos[1] < 5 && p.pos[1] > 3.5, `慢慢下沉，y=${p.pos[1]}`);
  const before = p.pos[1];
  for (let i = 0; i < 20; i++) stepPlayer(w, p, { jump: true }, 1 / 30);
  assert.ok(p.pos[1] > before + 0.5, '往上游');
  assert.equal(bodyInWater(w, createPlayer([8.5, 20, 8.5])), false);
});

test('在水里贴着岸按跳能爬上一格高的岸', () => {
  const w = empty();
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) {
    w.set(x, 0, z, STONE);
    if (x < 12) w.set(x, 1, z, WATER);
    else w.set(x, 1, z, STONE);
  }
  const p = createPlayer([10.5, 1, 8.5], -Math.PI / 2); // 面朝 +x，岸在 x=12
  for (let i = 0; i < 90; i++) stepPlayer(w, p, { forward: 1, jump: true }, 1 / 30);
  assert.ok(p.pos[0] > 12.3 && p.pos[1] >= 2 - 0.01, `上岸了，pos=${p.pos}`);
});

test('昼夜：正午最亮，午夜有星星，时间显示正确', () => {
  const noon = skyAt(0.5);
  const midnight = skyAt(0);
  assert.ok(noon.day > 0.99 && noon.sunDir[1] > 0.9);
  assert.ok(midnight.day < 0.01 && midnight.stars > 0.99);
  assert.ok(noon.sunIntensity > midnight.sunIntensity);
  assert.ok(midnight.moonIntensity > noon.moonIntensity);
  assert.ok(noon.sky[2] > midnight.sky[2]);
  assert.ok(skyAt(0.25).dusk > 0.9, '日出时天边发红');
  assert.equal(clockText(0), '00:00');
  assert.equal(clockText(0.5), '12:00');
  assert.equal(clockText(0.75 + 1 / 1440), '18:01');
  assert.equal(wrapTime(1.25), 0.25);
  assert.equal(wrapTime(-0.25), 0.75);
});

// ---------- 火把和光照 ----------
import { TORCH, flowId, isFlowing } from '../src/game/blocks.js';
import { computeLight, lightBrightness } from '../src/game/light.js';
import { Sim } from '../src/game/sim.js';
import { desiredFluid, Fluids } from '../src/game/fluid.js';

function floorWorld(chunks = 2) {
  const w = new World({ seed: 1, chunks, generate: false });
  for (let x = 0; x < w.sizeX; x++) for (let z = 0; z < w.sizeZ; z++) w.rawSet(x, 0, z, STONE);
  return w;
}

test('火把发光：离得越远越暗，墙会挡光', () => {
  const w = floorWorld();
  w.set(10, 1, 10, TORCH);
  computeLight(w);
  assert.equal(w.lightAt(10, 1, 10), 14);
  assert.equal(w.lightAt(11, 1, 10), 13);
  assert.equal(w.lightAt(15, 1, 10), 9);
  assert.equal(w.lightAt(10, 0, 10), 0, '石头里面没有光');
  assert.ok(lightBrightness(14) === 1 && lightBrightness(7) < lightBrightness(10) && lightBrightness(0) === 0);
  // 用一堵墙把 x>=12 的一边整个挡住（墙够高，绕不过去）
  for (let y = 1; y < w.sizeY; y++) for (let z = 0; z < w.sizeZ; z++) w.set(12, y, z, STONE);
  computeLight(w);
  assert.equal(w.lightAt(13, 1, 10), 0);
  assert.equal(w.lightAt(11, 1, 10), 13);
});

test('Sim：放火把会照亮周围的区块；脚下方块挖掉后火把掉落、光消失', () => {
  const w = floorWorld();
  const sim = new Sim(w);
  const dirty = sim.edit(15, 1, 15, TORCH); // 区块角上，光会照进 4 个区块
  assert.ok(dirty.has('0,0') && dirty.has('1,1') && dirty.has('1,0') && dirty.has('0,1'));
  assert.ok(w.lightAt(17, 1, 15) > 0);
  sim.edit(15, 0, 15, AIR);
  assert.equal(w.get(15, 1, 15), AIR, '火把掉了');
  assert.equal(w.lightAt(17, 1, 15), 0);
});

test('网格：火把是一根小棍，自己是亮的；被照到的地面顶点更亮', () => {
  const w = floorWorld(1);
  const sim = new Sim(w);
  sim.edit(8, 1, 8, TORCH);
  const g = buildChunkGeometry(w, 0, 0);
  // 找火把的顶点：x 在 7/16..9/16 之间、高度 1..1.625
  let torchVerts = 0;
  for (let i = 0; i < g.positions.length; i += 3) {
    const [x, y] = [g.positions[i], g.positions[i + 1]];
    if (x > 8.4 && x < 8.6 && y >= 1 && y <= 1 + 10 / 16 + 1e-6 && g.light[i / 3] === 1) torchVerts++;
  }
  assert.equal(torchVerts, 20, '5 个面 × 4 个顶点');
  // 地面顶面（y=1）：靠近火把的顶点比远处的亮
  let near = 0;
  let far = 1;
  for (let i = 0; i < g.positions.length; i += 3) {
    if (g.positions[i + 1] !== 1 || g.normals[i + 1] !== 1) continue;
    const d = Math.hypot(g.positions[i] - 8.5, g.positions[i + 2] - 8.5);
    if (d < 1) near = Math.max(near, g.light[i / 3]);
    if (d > 7) far = Math.min(far, g.light[i / 3]);
  }
  assert.ok(near > 0.7 && far < near, `near=${near} far=${far}`);
});

// ---------- 流动的水 ----------
function runFluids(sim, steps = 200) {
  for (let i = 0; i < steps && sim.fluids.busy; i++) sim.tick();
  return sim;
}

test('水在平地上往四周流 7 格，越远越浅', () => {
  const w = floorWorld();
  const sim = new Sim(w);
  sim.edit(16, 1, 16, WATER);
  runFluids(sim);
  assert.equal(w.get(16, 1, 16), WATER);
  assert.equal(w.get(17, 1, 16), flowId(7));
  assert.equal(w.get(22, 1, 16), flowId(2));
  assert.equal(w.get(23, 1, 16), flowId(1));
  assert.equal(w.get(24, 1, 16), AIR, '流不到第 8 格');
  assert.equal(w.get(19, 1, 19), flowId(2), '斜着走要多绕几格');
  assert.equal(w.get(16, 2, 16), AIR, '不会往上流');
});

test('水会先往下流，流到底再散开；挖掉水源后流水会退掉', () => {
  const w = floorWorld();
  // 一个台子：x<16 的地面在 y=5，水源放在台子边上
  for (let x = 0; x < 16; x++) for (let z = 0; z < w.sizeZ; z++) for (let y = 1; y <= 5; y++) w.rawSet(x, y, z, STONE);
  const sim = new Sim(w);
  sim.edit(15, 6, 10, WATER);
  runFluids(sim);
  assert.equal(w.get(16, 6, 10), flowId(7), '流出台子边');
  for (let y = 1; y <= 5; y++) assert.ok(isFlowing(w.get(16, y, 10)), `y=${y} 是往下落的水`);
  assert.equal(w.get(16, 5, 10), flowId(7));
  assert.equal(w.get(17, 6, 10), AIR, '悬空的水不往旁边流');
  assert.equal(w.get(17, 1, 10), flowId(6), '落地后散开');

  sim.edit(15, 6, 10, AIR);
  runFluids(sim, 400);
  let left = 0;
  for (const v of w.data) if (v === WATER || isFlowing(v)) left++;
  assert.equal(left, 0, '水全部退掉了');
});

test('两个水源中间托得住的空格会变成新水源；水会冲掉火把', () => {
  const w = floorWorld();
  const sim = new Sim(w);
  sim.edit(10, 1, 10, WATER);
  sim.edit(12, 1, 10, WATER);
  runFluids(sim);
  assert.equal(w.get(11, 1, 10), WATER);

  const w2 = floorWorld();
  const sim2 = new Sim(w2);
  sim2.edit(5, 1, 5, TORCH);
  assert.ok(w2.lightAt(5, 1, 5) > 0);
  sim2.edit(3, 1, 5, WATER);
  runFluids(sim2);
  assert.ok(isFlowing(w2.get(5, 1, 5)), '火把被冲掉了');
  assert.equal(w2.lightAt(5, 1, 5), 0);
});

test('湖岸是封闭的：刚生成的世界里水不会自己流动', () => {
  const w = new World({ seed: 1, chunks: 4 });
  const fl = new Fluids(w);
  let changes = 0;
  for (let i = 0; i < w.data.length; i++) {
    if (w.data[i] !== WATER) continue;
    const [x, y, z] = w.coords(i);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (!w.inBounds(nx, ny, nz)) continue;
      if (desiredFluid(w, nx, ny, nz) !== w.get(nx, ny, nz)) changes++;
    }
  }
  assert.equal(changes, 0);
  assert.equal(fl.busy, false);
});

test('流动的水也能游泳，网格高度跟着水位变', () => {
  const w = floorWorld(1);
  w.set(5, 1, 5, flowId(3));
  const g = buildChunkGeometry(w, 0, 0);
  const maxY = Math.max(...g.water.positions.filter((_, i) => i % 3 === 1));
  assert.ok(Math.abs(maxY - (1 + 0.1 + 0.3)) < 1e-6);
  assert.equal(bodyInWater(w, createPlayer([5.5, 0.8, 5.5])), true);
  assert.equal(w.isSolid(5, 1, 5), false);
});

// ---------- 合成 ----------
import { COAL_ORE, LOG, PLANKS, GLASS as GLASS_ID, GRASS as GRASS_ID, DIRT as DIRT_ID, BEDROCK as BEDROCK_ID } from '../src/game/blocks.js';
import { COAL, STICK, dropFor, addItem, takeItem, countOf, sanitizeInventory, itemName } from '../src/game/items.js';
import { RECIPES, craft, maxCrafts } from '../src/game/crafting.js';
const recipe = (id) => RECIPES.find((r) => r.id === id);

test('挖方块掉落：草变泥土，煤矿石掉煤炭，基岩和水什么都不掉', () => {
  assert.equal(dropFor(GRASS_ID), DIRT_ID);
  assert.equal(dropFor(COAL_ORE), COAL);
  assert.equal(dropFor(LOG), LOG);
  assert.equal(dropFor(TORCH), TORCH);
  assert.equal(dropFor(BEDROCK_ID), null);
  assert.equal(dropFor(WATER), null);
  assert.equal(dropFor(flowId(3)), null);
  assert.equal(itemName(STICK), '木棍');
});

test('地下的石头里有煤矿石，地表没有', () => {
  const w = new World({ seed: 3, chunks: 4 });
  let ore = 0;
  for (let i = 0; i < w.data.length; i++) {
    if (w.data[i] !== COAL_ORE) continue;
    ore++;
    const [x, y, z] = w.coords(i);
    assert.ok(y <= w.topY(x, z) - 4, '煤矿石埋在地下');
  }
  assert.ok(ore > 50, `有一些煤矿石：${ore}`);
});

test('背包加减物品，数量不够时不扣', () => {
  const inv = {};
  addItem(inv, LOG, 3);
  assert.equal(countOf(inv, LOG), 3);
  assert.equal(takeItem(inv, LOG, 5), false);
  assert.equal(countOf(inv, LOG), 3);
  assert.equal(takeItem(inv, LOG, 3), true);
  assert.deepEqual(inv, {}, '用完的物品从背包里去掉');
});

test('合成：原木 → 木板 → 木棍，加煤炭做火把；材料不够做不了', () => {
  const inv = {};
  addItem(inv, LOG, 2);
  assert.equal(maxCrafts(inv, recipe('torch')), 0);
  assert.equal(craft(inv, recipe('torch')), 0);
  assert.equal(craft(inv, recipe('planks'), 99), 2, '材料只够做 2 次');
  assert.equal(countOf(inv, PLANKS), 8);
  assert.equal(countOf(inv, LOG), 0);
  craft(inv, recipe('sticks'));
  assert.equal(countOf(inv, STICK), 4);
  assert.equal(countOf(inv, PLANKS), 6);
  addItem(inv, COAL, 1);
  assert.equal(maxCrafts(inv, recipe('torch')), 1);
  craft(inv, recipe('torch'));
  assert.equal(countOf(inv, TORCH), 4);
  assert.equal(countOf(inv, COAL), 0);
  assert.equal(countOf(inv, STICK), 3);
});

test('每个配方的产物都能放或者能用来合成别的', () => {
  const used = new Set(RECIPES.flatMap((r) => r.inputs.map(([id]) => id)));
  for (const r of RECIPES) {
    const [out, n] = r.output;
    assert.ok(n > 0);
    const usable = out < 100 || used.has(out) || TOOLS[out] || out === BUCKET || foodValue(out) > 0;
    assert.ok(usable, `${itemName(out)} 有用处`);
  }
  const inv = {};
  addItem(inv, SAND_ID, 4);
  addItem(inv, COAL, 1);
  assert.equal(craft(inv, recipe('glass'), 5), 1, '煤炭只够 1 次');
  assert.equal(countOf(inv, GLASS_ID), 2);
});

test('读档时背包里不认识的东西和坏数据会被丢掉', () => {
  const inv = sanitizeInventory({ 5: 3, 100: 2, 999: 1, abc: 4, 7: -1, 8: 1.5, 101: 1e9 });
  assert.deepEqual(inv, { 5: 3, 100: 2, 101: 9999 });
  assert.deepEqual(sanitizeInventory(null), {});
});

// ---------- 工具和水桶 ----------
import { IRON_ORE, STONE as STONE_B, DIRT as DIRT_B, SAND as SAND_B } from '../src/game/blocks.js';
import { STONE_PICKAXE, IRON_PICKAXE, STONE_SHOVEL, IRON_INGOT, BUCKET } from '../src/game/items.js';
import { digInfo, bestTool, TOOLS } from '../src/game/tools.js';

test('挖方块的时间：空手慢，有对应工具快，铁镐比石镐快', () => {
  const inv = {};
  const hand = digInfo(STONE_B, inv);
  assert.ok(hand.time > 1 && hand.tool === null);
  addItem(inv, STONE_PICKAXE);
  const stone = digInfo(STONE_B, inv);
  assert.equal(stone.tool, STONE_PICKAXE);
  assert.ok(Math.abs(stone.time - hand.time / 4) < 1e-9);
  addItem(inv, IRON_PICKAXE);
  assert.equal(bestTool(inv, 'pickaxe'), IRON_PICKAXE);
  assert.ok(digInfo(STONE_B, inv).time < stone.time);
  assert.equal(digInfo(DIRT_B, inv).tool, null, '镐不帮着挖泥土');
  addItem(inv, STONE_SHOVEL);
  assert.equal(digInfo(SAND_B, inv).tool, STONE_SHOVEL);
  assert.equal(digInfo(TORCH, {}).time, 0, '火把一碰就掉');
  assert.equal(digInfo(BEDROCK_ID, inv).time, Infinity);
  assert.equal(digInfo(WATER, inv).time, Infinity);
});

test('铁矿石只能用镐挖；铁矿石埋得比煤更深', () => {
  const none = digInfo(IRON_ORE, {});
  assert.equal(none.time, Infinity);
  assert.equal(none.needs, 'pickaxe');
  assert.ok(Number.isFinite(digInfo(IRON_ORE, { [STONE_PICKAXE]: 1 }).time));
  const w = new World({ seed: 3, chunks: 4 });
  let iron = 0;
  for (let i = 0; i < w.data.length; i++) {
    if (w.data[i] !== IRON_ORE) continue;
    iron++;
    const [x, y, z] = w.coords(i);
    assert.ok(y <= w.topY(x, z) - 6);
  }
  assert.ok(iron > 20, `有一些铁矿石：${iron}`);
  assert.equal(dropFor(IRON_ORE), IRON_ORE);
});

test('从石头到水桶的合成路线；工具只能做一把', () => {
  const inv = {};
  addItem(inv, STONE_B, 6);
  addItem(inv, STICK, 4);
  assert.equal(maxCrafts(inv, recipe('stonePickaxe')), 1, '材料够两把，但只能做一把');
  assert.equal(craft(inv, recipe('stonePickaxe'), 5), 1);
  assert.equal(maxCrafts(inv, recipe('stonePickaxe')), 0, '已经有了');
  assert.equal(countOf(inv, STONE_B), 3);
  addItem(inv, IRON_ORE, 3);
  addItem(inv, COAL, 3);
  assert.equal(craft(inv, recipe('ironIngot'), 99), 3);
  assert.equal(countOf(inv, IRON_INGOT), 3);
  assert.equal(craft(inv, recipe('bucket')), 1);
  assert.equal(countOf(inv, BUCKET), 1);
  assert.equal(countOf(inv, IRON_INGOT), 0);
});

test('射线：默认穿过水，liquids 模式下停在水面', () => {
  const w = empty();
  w.set(5, 3, 5, SAND_B);
  w.set(5, 4, 5, WATER);
  w.set(5, 5, 5, flowId(4));
  assert.deepEqual(raycast(w, [5.5, 8, 5.5], [0, -1, 0], 6).hit, [5, 3, 5]);
  const r = raycast(w, [5.5, 8, 5.5], [0, -1, 0], 6, { liquids: true });
  assert.deepEqual(r.hit, [5, 5, 5]);
  assert.equal(r.block, flowId(4));
});

// ---------- 生命值和摔落 ----------
import { fallDamage, hurt, regenerate, sanitizeHealth, MAX_HEALTH } from '../src/game/health.js';

function dropPlayer(w, from, input = {}) {
  const p = createPlayer(from);
  let landed = 0;
  for (let i = 0; i < 200; i++) landed = Math.max(landed, stepPlayer(w, p, input, 1 / 30));
  return { p, landed };
}

test('摔落伤害：3 格以内不疼，之后每多 1 格扣 1 点', () => {
  assert.equal(fallDamage(0), 0);
  assert.equal(fallDamage(3), 0);
  assert.equal(fallDamage(3.9), 0);
  assert.equal(fallDamage(4), 1);
  assert.equal(fallDamage(12.4), 9);
});

test('从高处掉到地上会算出掉了多高', () => {
  const w = floorWorld();
  const { p, landed } = dropPlayer(w, [8.5, 13, 8.5]);
  assert.ok(Math.abs(landed - 12) < 0.05, `掉了 ${landed}`);
  assert.ok(p.onGround);
  assert.equal(fallDamage(landed), 9);
  // 从静止开始掉，起点高度要算移动之前的
  assert.equal(fallDamage(dropPlayer(w, [8.5, 11, 8.5]).landed), 7);
});

test('原地跳、走下一格台阶都不会受伤', () => {
  const w = floorWorld();
  const p = createPlayer([8.5, 1, 8.5]);
  for (let i = 0; i < 5; i++) stepPlayer(w, p, {}, 1 / 30);
  let worst = 0;
  for (let i = 0; i < 60; i++) worst = Math.max(worst, stepPlayer(w, p, { jump: true }, 1 / 30));
  assert.ok(worst > 0.5 && worst < 1.5, `跳起来又落下：${worst}`);
  assert.equal(fallDamage(worst), 0);
});

test('掉进水里、飞着下降不会摔伤', () => {
  const w = floorWorld();
  for (let x = 4; x < 12; x++) for (let z = 4; z < 12; z++) w.rawSet(x, 1, z, WATER);
  assert.equal(dropPlayer(w, [8.5, 20, 8.5]).landed, 0, '掉进只有一格深的水里');
  const f = createPlayer([20.5, 20, 20.5]);
  f.flying = true;
  let landed = 0;
  for (let i = 0; i < 200; i++) landed = Math.max(landed, stepPlayer(w, f, { down: true }, 1 / 30));
  assert.equal(f.flying, false, '落地时自动停止飞行');
  assert.equal(landed, 0);
});

test('受伤和回血：受伤后一段时间才开始慢慢回血', () => {
  const p = createPlayer([0, 0, 0]);
  assert.equal(p.health, MAX_HEALTH);
  assert.equal(hurt(p, 5), 5);
  assert.equal(p.health, 15);
  for (let i = 0; i < 50; i++) regenerate(p, 0.1); // 5 秒
  assert.equal(p.health, 15, '还没开始回血');
  for (let i = 0; i < 40; i++) regenerate(p, 0.1); // 再 4 秒
  assert.equal(p.health, 16);
  assert.equal(hurt(p, 99), 16, '最多扣到 0');
  assert.equal(p.health, 0);
  assert.equal(hurt(p, 1), 0, '死了不再扣');
  for (let i = 0; i < 200; i++) regenerate(p, 0.1);
  assert.equal(p.health, 0, '死了不会回血');
  assert.equal(sanitizeHealth(7), 7);
  assert.equal(sanitizeHealth(0), MAX_HEALTH);
  assert.equal(sanitizeHealth('x'), MAX_HEALTH);
});

// ---------- 溺水 ----------
import { updateAir, MAX_AIR, DROWN_DAMAGE } from '../src/game/health.js';

test('溺水：气泡大约 15 秒用完，之后每秒掉 1 颗心；出水后很快恢复', () => {
  const p = createPlayer([0, 0, 0]);
  let dmg = 0;
  for (let i = 0; i < 140; i++) dmg += updateAir(p, true, 0.1); // 14 秒
  assert.equal(dmg, 0);
  assert.ok(p.air > 0 && p.air < 1);
  for (let i = 0; i < 10; i++) dmg += updateAir(p, true, 0.1); // 15 秒，没气了
  assert.equal(p.air, 0);
  for (let i = 0; i < 31; i++) dmg += updateAir(p, true, 0.1); // 又过 3 秒
  assert.equal(dmg, DROWN_DAMAGE * 3);
  for (let i = 0; i < 20; i++) updateAir(p, false, 0.1);
  assert.equal(p.air, MAX_AIR, '2 秒内回满');
});

// ---------- 怪物 ----------
import {
  createMonster, canSpawnAt, trySpawn, stepMonster, damageMonster, rayHitMonster, shouldRemove, touching,
  MAX_MONSTERS, MONSTER_DAMAGE, MONSTER_HEALTH, SPAWN_MIN, SPAWN_MAX,
} from '../src/game/monsters.js';
import { attackDamage } from '../src/game/tools.js';

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('怪物只在黑暗、脚下有实心方块的空地上出现；火把附近不会出现', () => {
  const w = floorWorld();
  computeLight(w);
  assert.equal(canSpawnAt(w, 10, 1, 10), true);
  assert.equal(canSpawnAt(w, 10, 2, 10), false, '悬空');
  w.rawSet(10, 0, 10, WATER);
  assert.equal(canSpawnAt(w, 10, 1, 10), false, '脚下是水');
  w.rawSet(10, 0, 10, STONE);
  w.rawSet(10, 2, 10, STONE);
  assert.equal(canSpawnAt(w, 10, 1, 10), false, '头顶没空间');
  w.rawSet(10, 2, 10, AIR);
  w.set(12, 1, 10, TORCH);
  computeLight(w);
  assert.equal(canSpawnAt(w, 10, 1, 10), false, '火把照着');
  assert.equal(canSpawnAt(w, 25, 1, 10), true, '离火把够远');
});

test('怪物在玩家周围 16–30 格出现，最多 8 只', () => {
  const w = floorWorld(4);
  computeLight(w);
  const player = createPlayer([32.5, 1, 32.5]);
  const monsters = [];
  for (let i = 0; i < 50; i++) trySpawn(w, monsters, player);
  assert.equal(monsters.length, MAX_MONSTERS);
  for (const m of monsters) {
    const d = Math.hypot(m.pos[0] - player.pos[0], m.pos[2] - player.pos[2]);
    assert.ok(d > SPAWN_MIN - 1.5 && d < SPAWN_MAX + 1.5, `距离 ${d}`);
    assert.equal(m.pos[1], 1);
  }
});

test('怪物跳着追玩家，挨到了就咬，咬一口要等 1 秒', () => {
  const w = floorWorld();
  const player = createPlayer([20.5, 1, 10.5]);
  const m = createMonster([10.5, 1, 10.5]);
  let total = 0;
  let firstBite = -1;
  for (let i = 0; i < 300; i++) {
    const d = stepMonster(w, m, player, 1 / 30, { rand: seq(0.3, 0.7) });
    if (d && firstBite < 0) firstBite = i;
    total += d;
  }
  assert.ok(firstBite > 0, '追上并咬到了');
  assert.ok(total >= MONSTER_DAMAGE * 3 && total <= MONSTER_DAMAGE * 8, `10 秒内咬了 ${total / MONSTER_DAMAGE} 口`);
  assert.ok(touching(m, player) || Math.hypot(m.pos[0] - 20.5, m.pos[2] - 10.5) < 2);
});

test('怪物能跳上一格高的台阶', () => {
  const w = floorWorld();
  for (let x = 14; x < 32; x++) for (let z = 0; z < 32; z++) w.rawSet(x, 1, z, STONE);
  const player = createPlayer([24.5, 2, 10.5]);
  const m = createMonster([8.5, 1, 10.5]);
  for (let i = 0; i < 240; i++) stepMonster(w, m, player, 1 / 30, { rand: seq(0.5) });
  assert.ok(m.pos[0] > 14 && m.pos[1] >= 2 - 0.01, `pos=${m.pos}`);
});

test('打怪：会被打退、打 5 下（空手）才死；工具伤害更高', () => {
  const m = createMonster([10.5, 1, 10.5]);
  assert.equal(attackDamage({}), 2);
  assert.equal(attackDamage({ [STONE_PICKAXE]: 1 }), 3);
  assert.equal(attackDamage({ [IRON_PICKAXE]: 1, [STONE_PICKAXE]: 1 }), 5);
  let hits = 0;
  while (!damageMonster(m, attackDamage({}), [8.5, 1, 10.5])) hits++;
  assert.equal(hits + 1, MONSTER_HEALTH / 2);
  assert.ok(m.vel[0] > 0 && m.vel[1] > 0, '往后、往上弹');
});

test('准星能打到怪物；天亮后怪物消散，离太远的会被移走', () => {
  const a = createMonster([10.5, 1, 10.5]);
  const b = createMonster([12.5, 1, 10.5]);
  const hit = rayHitMonster([7.5, 1.5, 10.5], [1, 0, 0], 4, [b, a]);
  assert.equal(hit.monster, a, '打到近的那只');
  assert.ok(Math.abs(hit.distance - 2.6) < 1e-6);
  assert.equal(rayHitMonster([7.5, 5, 10.5], [1, 0, 0], 4, [a]), null, '从头顶上方经过');
  assert.equal(rayHitMonster([0.5, 1.5, 10.5], [1, 0, 0], 4, [a]), null, '太远');

  const w = floorWorld();
  const player = createPlayer([10.5, 1, 20.5]);
  for (let i = 0; i < 60; i++) stepMonster(w, a, player, 1 / 30, { day: true });
  assert.equal(shouldRemove(a, player), true);
  assert.equal(stepMonster(w, createMonster([10.5, 1, 20.8]), player, 1 / 30, { day: true }) > 0, false, '消散中的不咬人');
  assert.equal(shouldRemove(createMonster([100, 1, 100]), player), true);
});

// ---------- 饥饿 ----------
import { updateHunger, addExhaustion, sanitizeHunger, MAX_HUNGER, REGEN_MIN_HUNGER, EXHAUSTION } from '../src/game/health.js';
import { APPLE, BERRIES, PIE, foodValue, bonusDrop, bestFood, eat } from '../src/game/items.js';
import { LEAVES } from '../src/game/blocks.js';

test('饥饿：闲着大约半小时饿一半，跑步、跳跃饿得更快', () => {
  const idle = createPlayer([0, 0, 0]);
  for (let i = 0; i < 1000; i++) updateHunger(idle, 1); // 1000 秒
  assert.equal(idle.hunger, MAX_HUNGER - 10);
  const runner = createPlayer([0, 0, 0]);
  for (let i = 0; i < 100; i++) updateHunger(runner, 1, { sprinting: true, jumps: 1 }); // 100 秒边跑边跳
  assert.ok(runner.hunger <= MAX_HUNGER - 10, `跑跳 100 秒：${runner.hunger}`);
  const p = createPlayer([0, 0, 0]);
  addExhaustion(p, 4 * 3 + 1);
  assert.equal(p.hunger, MAX_HUNGER - 3);
  assert.ok(Math.abs(p.exhaustion - 1) < 1e-9);
  assert.ok(EXHAUSTION.sprint > EXHAUSTION.idle);
});

test('饿到 0 以后每 4 秒掉半颗心；和平模式不会饿还会慢慢吃饱', () => {
  const p = createPlayer([0, 0, 0]);
  p.hunger = 0;
  let dmg = 0;
  for (let i = 0; i < 120; i++) dmg += updateHunger(p, 0.1); // 12 秒
  assert.equal(dmg, 3);
  const q = createPlayer([0, 0, 0]);
  q.hunger = 4;
  for (let i = 0; i < 100; i++) assert.equal(updateHunger(q, 0.1, { peaceful: true, sprinting: true }), 0);
  assert.equal(q.hunger, 9, '10 秒回 5 点');
  assert.equal(sanitizeHunger(0), 0);
  assert.equal(sanitizeHunger(25), MAX_HUNGER);
  assert.equal(sanitizeHunger(undefined), MAX_HUNGER);
});

test('饱食度不够时不回血，回血会消耗饱食度', () => {
  const p = createPlayer([0, 0, 0]);
  hurt(p, 10);
  p.hunger = REGEN_MIN_HUNGER - 1;
  for (let i = 0; i < 200; i++) regenerate(p, 0.1);
  assert.equal(p.health, 10, '饿着不回血');
  p.hunger = MAX_HUNGER;
  for (let i = 0; i < 400; i++) regenerate(p, 0.1); // 40 秒
  assert.ok(p.health > 10);
  assert.ok(p.hunger < MAX_HUNGER || p.exhaustion > 0, '回血花了体力');
});

test('食物：树叶有时掉苹果、草方块有时挖出野莓；吃东西不浪费', () => {
  assert.equal(bonusDrop(LEAVES, () => 0.05), APPLE);
  assert.equal(bonusDrop(LEAVES, () => 0.5), null);
  assert.equal(bonusDrop(GRASS_ID, () => 0.1), BERRIES);
  assert.equal(bonusDrop(STONE, () => 0), null);
  assert.ok(foodValue(PIE) > foodValue(APPLE) && foodValue(APPLE) > foodValue(BERRIES));

  const inv = {};
  assert.equal(bestFood(inv, 10), null);
  addItem(inv, APPLE, 1);
  addItem(inv, BERRIES, 1);
  addItem(inv, PIE, 1);
  assert.equal(bestFood(inv, 5), PIE, '饿得厉害吃果派');
  assert.equal(bestFood(inv, 15), APPLE, '差 5 点吃苹果正好');
  assert.equal(bestFood(inv, 19), BERRIES, '差 1 点吃最小的');

  const p = createPlayer([0, 0, 0]);
  p.hunger = 18;
  const r = eat(inv, p, APPLE);
  assert.ok(r.ok);
  assert.equal(r.gained, 2, '最多吃到满');
  assert.equal(p.hunger, MAX_HUNGER);
  assert.equal(eat(inv, p, BERRIES).ok, false, '吃饱了');
  assert.equal(countOf(inv, BERRIES), 1, '没吃就不扣');
  assert.equal(eat(inv, { hunger: 0 }, STONE).ok, false);
});

test('果派的配方', () => {
  const inv = {};
  addItem(inv, APPLE, 2);
  addItem(inv, BERRIES, 3);
  addItem(inv, COAL, 1);
  assert.equal(craft(inv, recipe('pie')), 1);
  assert.equal(countOf(inv, PIE), 1);
  assert.deepEqual(Object.keys(inv), [String(PIE)]);
});

// ---------- 耕种 ----------
import { FARMLAND, WHEAT_BASE, WHEAT_STAGES, isCrop, cropStage } from '../src/game/blocks.js';
import { SEEDS, WHEAT, BREAD, STONE_HOE } from '../src/game/items.js';
import { plantTarget, isWet, growCrops, cropDrops } from '../src/game/farming.js';

function farmWorld() {
  const w = floorWorld();
  for (let x = 0; x < w.sizeX; x++) for (let z = 0; z < w.sizeZ; z++) w.rawSet(x, 1, z, GRASS_ID);
  return w;
}

test('种地：草地、泥土要先翻土，耕地直接种；上面要空着', () => {
  const w = farmWorld();
  assert.deepEqual(plantTarget(w, [5, 1, 5]).till, true);
  w.set(5, 1, 5, FARMLAND);
  assert.equal(plantTarget(w, [5, 1, 5]).till, false);
  assert.deepEqual(plantTarget(w, [5, 1, 5]).above, [5, 2, 5]);
  assert.ok(plantTarget(w, [5, 0, 5]).error, '石头上不能种');
  w.set(5, 2, 5, WHEAT_BASE);
  assert.ok(plantTarget(w, [5, 1, 5]).error, '已经种了');
  assert.equal(digInfo(WHEAT_BASE, {}).time, 0, '庄稼一碰就掉');
  assert.equal(w.isSolid(5, 2, 5), false, '庄稼能穿过');
});

test('耕地 4 格内有水算湿润；湿润的长得快很多', () => {
  const w = farmWorld();
  assert.equal(isWet(w, 10, 1, 10), false);
  w.set(14, 1, 10, WATER);
  assert.equal(isWet(w, 10, 1, 10), true);
  assert.equal(isWet(w, 9, 1, 10), false, '5 格远就不算');

  const crops = new Set();
  for (let z = 4; z < 12; z++) {
    w.set(11, 1, z, FARMLAND);
    w.set(11, 2, z, WHEAT_BASE); // 靠水
    w.set(2, 1, z, FARMLAND);
    w.set(2, 2, z, WHEAT_BASE); // 干地
    crops.add(w.index(11, 2, z));
    crops.add(w.index(2, 2, z));
  }
  let s = 7;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let t = 0; t < 40; t++) growCrops(w, crops, rand); // 40 秒
  let wet = 0;
  let dry = 0;
  for (let z = 4; z < 12; z++) {
    wet += cropStage(w.get(11, 2, z));
    dry += cropStage(w.get(2, 2, z));
  }
  assert.ok(wet > dry * 1.5, `湿 ${wet} 干 ${dry}`);
  for (let t = 0; t < 2000; t++) growCrops(w, crops, rand);
  assert.equal(w.get(2, 2, 4), WHEAT_BASE + WHEAT_STAGES - 1, '最终都会成熟');
  assert.equal(w.get(2, 2, 4), WHEAT_BASE + 3);
});

test('收割：成熟的给小麦和种子，没熟的退回种子', () => {
  assert.deepEqual(cropDrops(WHEAT_BASE + 1), [[SEEDS, 1]]);
  assert.deepEqual(cropDrops(WHEAT_BASE + 3, () => 0.2), [[WHEAT, 1], [SEEDS, 1]]);
  assert.deepEqual(cropDrops(WHEAT_BASE + 3, () => 0.8), [[WHEAT, 1], [SEEDS, 2]]);
  assert.deepEqual(cropDrops(STONE), []);
  assert.equal(dropFor(FARMLAND), DIRT_ID);
  assert.equal(dropFor(WHEAT_BASE + 3), null);
  assert.equal(bonusDrop(GRASS_ID, () => 0.3), SEEDS, '草方块里挖出麦种');
});

test('Sim：挖掉耕地上面的庄稼会没了；水流过会冲掉庄稼；庄稼会被记住用来生长', () => {
  const w = farmWorld();
  const sim = new Sim(w);
  sim.edit(8, 1, 8, FARMLAND);
  sim.edit(8, 2, 8, WHEAT_BASE);
  assert.ok(sim.crops.has(w.index(8, 2, 8)));
  sim.edit(8, 1, 8, DIRT_ID);
  assert.equal(w.get(8, 2, 8), AIR, '耕地变回泥土，庄稼没了');

  sim.edit(8, 1, 8, FARMLAND);
  sim.edit(8, 2, 8, WHEAT_BASE + 2);
  runFluids(sim);
  assert.equal(w.get(8, 2, 8), WHEAT_BASE + 2, '没有水时庄稼不会被水流逻辑动到');
  sim.edit(6, 2, 8, WATER);
  runFluids(sim);
  assert.ok(isFlowing(w.get(8, 2, 8)), '被水冲掉了');

  // 读档时会找到已有的庄稼
  const w2 = farmWorld();
  w2.set(3, 1, 3, FARMLAND);
  w2.set(3, 2, 3, WHEAT_BASE);
  const sim2 = new Sim(w2);
  assert.equal(sim2.crops.size, 1);
  let grown = null;
  for (let i = 0; i < 500 && !grown; i++) grown = sim2.grow(() => 0);
  assert.ok(grown.has('0,0'));
  assert.equal(w2.get(3, 2, 3), WHEAT_BASE + 1);
});

test('网格：庄稼是两片交叉的贴图（正反面），不挡住下面耕地的顶面', () => {
  const w = floorWorld(1);
  w.set(5, 1, 5, FARMLAND);
  w.set(5, 2, 5, WHEAT_BASE + 3);
  const g = buildChunkGeometry(w, 0, 0);
  let cropVerts = 0;
  let farmTop = 0;
  for (let i = 0; i < g.positions.length; i += 3) {
    const [x, y, z] = [g.positions[i], g.positions[i + 1], g.positions[i + 2]];
    if (y > 2 && y <= 3 && x > 5 && x < 6 && z > 5 && z < 6) cropVerts++;
    if (y === 2 && g.normals[i + 1] === 1 && x >= 5 && x <= 6 && z >= 5 && z <= 6) farmTop++;
  }
  assert.equal(cropVerts, 8, '两片 × 正反两面 × 上面两个顶点');
  assert.ok(farmTop >= 4, '耕地顶面还在');
});

test('锄头和面包的配方', () => {
  const inv = {};
  addItem(inv, STONE_B, 2);
  addItem(inv, STICK, 2);
  assert.equal(craft(inv, recipe('stoneHoe')), 1);
  assert.equal(countOf(inv, STONE_HOE), 1);
  addItem(inv, WHEAT, 7);
  assert.equal(craft(inv, recipe('bread'), 9), 2);
  assert.equal(countOf(inv, BREAD), 2);
  assert.ok(foodValue(BREAD) > foodValue(APPLE));
  assert.ok(isCrop(WHEAT_BASE) && !isCrop(FARMLAND));
});
