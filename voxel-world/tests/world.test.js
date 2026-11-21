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
    assert.ok(y <= Math.min(w.heightAt(x, z), w.sizeY - 10) - 4, '煤矿石埋在地下（按原来的地面算，洞穴可能把地面挖开）');
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
    const usable = out < 100 || used.has(out) || TOOLS[out] || out === BUCKET || foodValue(out) > 0 || canUseCustomSlot(out) || armorOf({ [out]: 1 }) > 0;
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
    assert.ok(y <= Math.min(w.heightAt(x, z), w.sizeY - 10) - 6);
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

// ---------- 动物 ----------
import {
  createAnimal, canAnimalSpawnAt, trySpawnAnimal, stepAnimal, feedAnimal, breed, damageAnimal, animalDrops,
  shouldRemoveAnimal, MAX_ANIMALS, ANIMAL_HEALTH, LOVE_SECONDS, GROW_UP_SECONDS, BREED_COOLDOWN,
  serializeAnimals, deserializeAnimals, nearbyCount, MAX_TOTAL, NEARBY,
} from '../src/game/animals.js';
import { RAW_MEAT, COOKED_MEAT } from '../src/game/items.js';

test('绒耳兔只在草地上出现，最多 10 只', () => {
  const w = farmWorld();
  assert.equal(canAnimalSpawnAt(w, 5, 2, 5), true);
  w.set(5, 1, 5, SAND_B);
  assert.equal(canAnimalSpawnAt(w, 5, 2, 5), false, '沙子上不出现');
  w.set(5, 1, 5, GRASS_ID);
  w.set(5, 3, 5, LEAVES);
  assert.equal(canAnimalSpawnAt(w, 5, 2, 5), false, '头顶要空');
  const big = new World({ seed: 1, chunks: 4, generate: false });
  for (let x = 0; x < big.sizeX; x++) for (let z = 0; z < big.sizeZ; z++) {
    big.rawSet(x, 0, z, STONE);
    big.rawSet(x, 1, z, GRASS_ID);
  }
  const animals = [];
  const player = createPlayer([32.5, 2, 32.5]);
  for (let i = 0; i < 60; i++) trySpawnAnimal(big, animals, player);
  assert.equal(animals.length, MAX_ANIMALS);
  assert.ok(animals.every((a) => a.pos[1] === 2));
});

test('绒耳兔会到处跳；拿着麦种会跟过来；被打了会逃跑', () => {
  const w = farmWorld();
  const player = createPlayer([16.5, 2, 16.5]);
  const a = createAnimal([12.5, 2, 16.5]);
  let s = 3;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 300; i++) stepAnimal(w, a, player, 1 / 30, { rand });
  const wandered = Math.hypot(a.pos[0] - 12.5, a.pos[2] - 16.5);
  assert.ok(wandered > 0.5, `跳动了 ${wandered}`);

  const b = createAnimal([10.5, 2, 16.5]);
  for (let i = 0; i < 300; i++) stepAnimal(w, b, player, 1 / 30, { rand, lure: true });
  assert.ok(Math.hypot(b.pos[0] - 16.5, b.pos[2] - 16.5) < 2.5, '跟到身边');

  const c = createAnimal([14.5, 2, 16.5]);
  assert.equal(damageAnimal(c, 2, player.pos), false);
  for (let i = 0; i < 90; i++) stepAnimal(w, c, player, 1 / 30, { rand });
  assert.ok(c.pos[0] < 11, `逃开了：x=${c.pos[0]}`);
});

test('喂麦种后两只靠近会生小兔，小兔一分钟后长大；有冷却', () => {
  const w = farmWorld();
  const a = createAnimal([5.5, 2, 5.5]);
  const b = createAnimal([7.5, 2, 5.5]);
  const animals = [a, b];
  assert.equal(breed(animals), null, '没喂不生');
  assert.equal(feedAnimal(a), true);
  assert.equal(feedAnimal(a), false, '已经喂过');
  assert.equal(breed(animals), null, '只喂了一只');
  feedAnimal(b);
  const baby = breed(animals);
  assert.ok(baby && baby.baby);
  assert.equal(animals.length, 3);
  assert.ok(baby.height < a.height);
  assert.equal(feedAnimal(baby), false, '小兔不吃');
  assert.equal(feedAnimal(a), false, '刚生完在冷却');
  assert.ok(a.loveCooldown === BREED_COOLDOWN && a.love === 0);
  const player = createPlayer([30.5, 2, 30.5]);
  for (let t = 0; t < GROW_UP_SECONDS + 1; t++) {
    stepAnimal(w, baby, player, 1);
    stepAnimal(w, a, player, 1);
  }
  assert.equal(baby.baby, false, '长大了');
  assert.equal(feedAnimal(a), true, '冷却过了又能喂');
  assert.ok(LOVE_SECONDS > 0);
});

test('打绒耳兔：6 点血，成年掉生肉，小兔不掉；远了会被移走', () => {
  const a = createAnimal([5.5, 2, 5.5]);
  assert.equal(a.health, ANIMAL_HEALTH);
  assert.equal(damageAnimal(a, 2, [3, 2, 5.5]), false);
  assert.equal(damageAnimal(a, 2, [3, 2, 5.5]), false);
  assert.equal(damageAnimal(a, 2, [3, 2, 5.5]), true);
  assert.deepEqual(animalDrops(a, () => 0.2), [[RAW_MEAT, 1]]);
  assert.deepEqual(animalDrops(a, () => 0.8), [[RAW_MEAT, 2]]);
  assert.deepEqual(animalDrops(createAnimal([0, 0, 0], { baby: true })), []);
  assert.equal(shouldRemoveAnimal(createAnimal([200, 2, 200])), false, '离得远也不会消失（会存档）');
  const dead = createAnimal([5, 2, 5]);
  dead.dissolve = 1;
  assert.equal(shouldRemoveAnimal(dead), true, '被打死的消散完才去掉');
  // 准星也能选中动物（和怪物同一个求交函数）
  assert.ok(rayHitMonster([2.5, 2.3, 5.5], [1, 0, 0], 4, [createAnimal([5.5, 2, 5.5])]));
});

test('烤肉：生肉 ×2 + 煤炭 → 烤肉 ×2，烤过的顶饱得多', () => {
  const inv = {};
  addItem(inv, RAW_MEAT, 5);
  addItem(inv, COAL, 1);
  assert.equal(craft(inv, recipe('cookedMeat'), 9), 1);
  assert.equal(countOf(inv, COOKED_MEAT), 2);
  assert.equal(countOf(inv, RAW_MEAT), 3);
  assert.ok(foodValue(COOKED_MEAT) >= foodValue(RAW_MEAT) * 4);
});

test('动物存档：保存后读回来位置、朝向、血量、小兔和冷却都在；坏数据会被丢掉', () => {
  const w = farmWorld();
  const a = createAnimal([5.5, 2, 6.25]);
  a.yaw = 1.234;
  a.health = 4;
  a.loveCooldown = 30.2;
  const baby = createAnimal([8.5, 2, 8.5], { baby: true });
  baby.grow = 12.3;
  const dying = createAnimal([9.5, 2, 9.5]);
  dying.dissolve = 0.2;
  const saved = JSON.parse(JSON.stringify(serializeAnimals([a, baby, dying])));
  assert.equal(saved.length, 2, '正在消散的不存');
  const back = deserializeAnimals([...saved, 'x', [1, 2, 3], [1, 2, 3, 0, 0, 0, 99], [999, 2, 5, 0, 0, 0, 6], [1, 2, NaN, 0, 0, 0, 6]], w);
  assert.equal(back.length, 2);
  const [a2, b2] = back;
  assert.deepEqual(a2.pos, [5.5, 2, 6.25]);
  assert.equal(a2.yaw, 1.23);
  assert.equal(a2.health, 4);
  assert.equal(a2.loveCooldown, 31);
  assert.equal(a2.baby, false);
  assert.equal(b2.baby, true);
  assert.equal(b2.grow, 13);
  assert.ok(b2.height < a2.height, '小兔还是小的');
  assert.ok(a2.id !== a.id, '读回来是新的对象');
  assert.deepEqual(deserializeAnimals(undefined, w), []);
});

test('动物读档时如果原地被方块占了，会放到这一列最上面', () => {
  const w = farmWorld();
  w.set(5, 2, 5, STONE);
  w.set(5, 3, 5, STONE);
  const [a] = deserializeAnimals([[5.5, 2, 5.5, 0, 0, 0, 6]], w);
  assert.equal(a.pos[1], 4);
});

test('野生的只在附近不够 10 只时出现，整个世界最多 40 只', () => {
  const big = new World({ seed: 1, chunks: 8, generate: false });
  for (let x = 0; x < big.sizeX; x++) for (let z = 0; z < big.sizeZ; z++) {
    big.rawSet(x, 0, z, STONE);
    big.rawSet(x, 1, z, GRASS_ID);
  }
  // 远处（另一个角落）已经有 20 只：不影响玩家身边出现新的
  const animals = [];
  for (let i = 0; i < 20; i++) animals.push(createAnimal([120.5, 2, 120.5 - i * 0.1]));
  const player = createPlayer([20.5, 2, 20.5]);
  assert.equal(nearbyCount(animals, player), 0);
  for (let i = 0; i < 80; i++) trySpawnAnimal(big, animals, player);
  assert.equal(nearbyCount(animals, player), MAX_ANIMALS);
  assert.equal(animals.length, 20 + MAX_ANIMALS);
  // 全世界到上限就不再出现，也不再生小兔
  while (animals.length < MAX_TOTAL) animals.push(createAnimal([120.5, 2, 100.5]));
  const far = createPlayer([64.5, 2, 64.5]);
  assert.equal(trySpawnAnimal(big, animals, far), null);
  const [p1, p2] = [animals[0], animals[1]];
  feedAnimal(p1);
  feedAnimal(p2);
  assert.equal(breed(animals), null);
  assert.ok(NEARBY > 0);
});

// ---------- 更多动物 ----------
import { SPECIES, habitatAt, animalName, foodFor, EGG_MIN, EGG_RANGE, ANGER_SECONDS } from '../src/game/animals.js';
import { EGG, LOG as LOG_B, SAND as SAND_BLOCK } from '../src/game/blocks.js';
import { DUCK_EGG, EGG_PANCAKE } from '../src/game/items.js';

test('每种动物住的地方：野猪在树林边，圆圆鸭在水边的沙地或草地', () => {
  const w = farmWorld();
  assert.deepEqual(habitatAt(w, 16, 2, 16), ['rabbit']);
  w.set(19, 2, 16, LOG_B);
  assert.deepEqual(habitatAt(w, 16, 2, 16), ['rabbit', 'boar']);
  w.set(16, 1, 20, WATER);
  assert.deepEqual(habitatAt(w, 16, 2, 16), ['rabbit', 'boar', 'duck']);
  w.set(16, 1, 16, SAND_BLOCK);
  assert.deepEqual(habitatAt(w, 16, 2, 16), ['duck'], '沙地上只有鸭子');
  assert.equal(canAnimalSpawnAt(w, 16, 2, 16, 'duck'), true);
  assert.equal(canAnimalSpawnAt(w, 16, 2, 16, 'rabbit'), false);
});

test('生成时按住的地方挑种类，三种都会出现', () => {
  const big = new World({ seed: 1, chunks: 4, generate: false });
  for (let x = 0; x < big.sizeX; x++) for (let z = 0; z < big.sizeZ; z++) {
    big.rawSet(x, 0, z, STONE);
    big.rawSet(x, 1, z, GRASS_ID);
  }
  // 到处都有树和水，三种都合适
  for (let x = 2; x < big.sizeX; x += 8) for (let z = 2; z < big.sizeZ; z += 8) {
    big.rawSet(x, 2, z, LOG_B);
    big.rawSet(x + 3, 1, z + 3, WATER);
  }
  const seen = new Set();
  for (let round = 0; round < 20; round++) {
    const animals = [];
    const player = createPlayer([32.5, 2, 32.5]);
    for (let i = 0; i < 30; i++) trySpawnAnimal(big, animals, player);
    animals.forEach((a) => seen.add(a.species));
  }
  assert.deepEqual([...seen].sort(), ['boar', 'duck', 'rabbit']);
});

test('鬃毛野猪：被打后（生存模式）会冲过来撞人；和平或创造模式下会逃跑', () => {
  const w = farmWorld();
  const player = createPlayer([16.5, 2, 16.5]);
  const boar = createAnimal([12.5, 2, 16.5], { species: 'boar' });
  assert.equal(boar.health, 12);
  damageAnimal(boar, 2, player.pos, { hostile: true });
  assert.equal(boar.anger, ANGER_SECONDS);
  let damage = 0;
  for (let i = 0; i < 150; i++) damage += stepAnimal(w, boar, player, 1 / 30, { hostile: true }).damage;
  assert.ok(damage >= SPECIES.boar.damage, `撞了 ${damage}`);

  const calm = createAnimal([12.5, 2, 16.5], { species: 'boar' });
  damageAnimal(calm, 2, player.pos, { hostile: false });
  assert.equal(calm.anger, 0);
  let hits = 0;
  for (let i = 0; i < 90; i++) hits += stepAnimal(w, calm, player, 1 / 30).damage;
  assert.equal(hits, 0);
  assert.ok(calm.pos[0] < 11, `逃开了：${calm.pos[0]}`);
});

test('走路的动物会跳上一格高的台阶', () => {
  const w = farmWorld();
  for (let x = 14; x < 32; x++) for (let z = 0; z < 32; z++) w.rawSet(x, 2, z, GRASS_ID);
  const player = createPlayer([24.5, 3, 10.5]);
  const boar = createAnimal([8.5, 2, 10.5], { species: 'boar' });
  boar.anger = 99; // 生气的野猪会一直追过来
  for (let i = 0; i < 300; i++) stepAnimal(w, boar, player, 1 / 30, { hostile: true });
  assert.ok(boar.pos[0] > 14 && boar.pos[1] >= 3 - 0.01, `pos=${boar.pos}`);
});

test('圆圆鸭会游泳（浮在水上）、长大后会下蛋；小鸭不下蛋', () => {
  const w = farmWorld();
  for (let x = 4; x < 12; x++) for (let z = 4; z < 12; z++) {
    w.rawSet(x, 1, z, STONE);
    w.rawSet(x, 2, z, WATER);
    w.rawSet(x, 3, z, WATER);
  }
  const swimmer = createAnimal([8.5, 2, 8.5], { species: 'duck' });
  const player = createPlayer([30.5, 2, 30.5]);
  let top = 0;
  for (let i = 0; i < 120; i++) {
    stepAnimal(w, swimmer, player, 1 / 30, { rand: seq(0.3, 0.8, 0.5) });
    if (i > 60) top = Math.max(top, swimmer.pos[1]);
  }
  assert.ok(top > 3.4 && swimmer.pos[1] > 2.5, `浮在水面附近：最高 y=${top}`);

  const duck = createAnimal([20.5, 2, 20.5], { species: 'duck', rand: () => 0 });
  assert.equal(duck.eggTimer, EGG_MIN);
  let egg = null;
  for (let t = 0; t < EGG_MIN + EGG_RANGE + 2 && !egg; t += 0.5) egg = stepAnimal(w, duck, player, 0.5, { rand: () => 0 }).egg;
  assert.deepEqual(egg, [Math.floor(duck.pos[0]), 2, Math.floor(duck.pos[2])]);
  const duckling = createAnimal([20.5, 2, 20.5], { species: 'duck', baby: true, rand: () => 0 });
  let babyEgg = null;
  for (let t = 0; t < 50; t += 0.5) babyEgg = babyEgg || stepAnimal(w, duckling, player, 0.5, { rand: () => 0 }).egg;
  assert.equal(babyEgg, null);
});

test('鸭蛋放在地上：一碰就捡起来；下面的方块没了蛋也没了', () => {
  const w = farmWorld();
  const sim = new Sim(w);
  sim.edit(5, 2, 5, EGG);
  assert.equal(w.isSolid(5, 2, 5), false);
  assert.equal(dropFor(EGG), DUCK_EGG);
  assert.equal(digInfo(EGG, {}).time, 0);
  sim.edit(5, 1, 5, AIR);
  assert.equal(w.get(5, 2, 5), AIR);
  w.set(6, 2, 6, EGG);
  const g = buildChunkGeometry(w, 0, 0);
  const ys = [];
  for (let i = 1; i < g.positions.length; i += 3) if (g.positions[i - 1] > 6 && g.positions[i - 1] < 7 && g.positions[i + 1] > 6 && g.positions[i + 1] < 7) ys.push(g.positions[i]);
  assert.ok(ys.length >= 20 && Math.max(...ys) < 2.5, '小小的一个');
});

test('喂食：每种动物爱吃的不一样，不同种不会生小动物', () => {
  const r = createAnimal([5.5, 2, 5.5]);
  const b = createAnimal([6.5, 2, 5.5], { species: 'boar' });
  const d = createAnimal([7.5, 2, 5.5], { species: 'duck' });
  assert.equal(foodFor(r), SEEDS);
  assert.equal(foodFor(b), APPLE);
  assert.equal(foodFor(d), BERRIES);
  assert.equal(animalName(b), '鬃毛野猪');
  assert.equal(animalName(createAnimal([0, 0, 0], { species: 'duck', baby: true })), '小圆圆鸭');
  feedAnimal(r);
  feedAnimal(b);
  assert.equal(breed([r, b]), null, '兔子和野猪不会生小动物');
  const b2 = createAnimal([7, 2, 6], { species: 'boar' });
  feedAnimal(b2);
  const piglet = breed([r, b, b2]);
  assert.equal(piglet.species, 'boar');
  assert.equal(piglet.baby, true);
  b.anger = 5;
  assert.equal(feedAnimal(createAnimal([0, 0, 0], { species: 'boar' })), true);
});

test('掉落：野猪 2–3 块肉，鸭子 1 块；存档记住种类，老存档当成绒耳兔', () => {
  const b = createAnimal([5.5, 2, 5.5], { species: 'boar' });
  assert.deepEqual(animalDrops(b, () => 0), [[RAW_MEAT, 2]]);
  assert.deepEqual(animalDrops(b, () => 0.99), [[RAW_MEAT, 3]]);
  assert.deepEqual(animalDrops(createAnimal([0, 0, 0], { species: 'duck' }), () => 0.99), [[RAW_MEAT, 1]]);

  const w = farmWorld();
  const saved = JSON.parse(JSON.stringify(serializeAnimals([b, createAnimal([7.5, 2, 7.5], { species: 'duck', baby: true })])));
  assert.equal(saved[0].length, 8);
  const back = deserializeAnimals([...saved, [3.5, 2, 3.5, 0, 0, 0, 6], [3.5, 2, 3.5, 0, 0, 0, 6, 9], [3.5, 2, 3.5, 0, 0, 0, 12]], w);
  assert.deepEqual(back.map((a) => a.species), ['boar', 'duck', 'rabbit'], '老存档是兔子；未知种类和超出血量的丢掉');
  assert.equal(back[0].health, 12);
  assert.equal(back[1].baby, true);
});

test('蛋饼：鸭蛋 ×2 + 小麦 + 煤炭 → 蛋饼 ×2', () => {
  const inv = {};
  addItem(inv, DUCK_EGG, 4);
  addItem(inv, WHEAT, 1);
  addItem(inv, COAL, 3);
  assert.equal(craft(inv, recipe('eggPancake'), 9), 1);
  assert.equal(countOf(inv, EGG_PANCAKE), 2);
  assert.equal(foodValue(EGG_PANCAKE), 6);
});

// ---------- 床和箱子 ----------
import { BED, CHEST } from '../src/game/blocks.js';
import {
  sleepCheck, respawnPoint, canUseCustomSlot, creativePalette, transfer, emptyChestInto,
  serializeChests, deserializeChests, chestKey, describeChest,
} from '../src/game/home.js';
import { BED_HEIGHT } from '../src/game/mesher.js';

test('睡觉：只能在晚上，附近 8 格有夜影睡不着', () => {
  assert.equal(sleepCheck(0.9, [], [5, 2, 5]).ok, false);
  assert.ok(sleepCheck(0.9, [], [5, 2, 5]).reason.includes('白天'));
  assert.equal(sleepCheck(0.1, [], [5, 2, 5]).ok, true);
  const near = createMonster([9.5, 2, 5.5]);
  assert.equal(sleepCheck(0.1, [near], [5, 2, 5]).ok, false);
  const far = createMonster([20.5, 2, 5.5]);
  assert.equal(sleepCheck(0.1, [far], [5, 2, 5]).ok, true);
  near.dissolve = 0.5;
  assert.equal(sleepCheck(0.1, [near], [5, 2, 5]).ok, true, '正在消散的不算');
});

test('重生点：床还在就在床上，床没了回出生点', () => {
  const w = farmWorld();
  w.set(5, 2, 5, BED);
  assert.deepEqual(respawnPoint(w, [5, 2, 5]), { pos: [5.5, 3, 5.5], lostBed: false });
  w.set(5, 2, 5, AIR);
  const r = respawnPoint(w, [5, 2, 5]);
  assert.equal(r.lostBed, true);
  assert.deepEqual(r.pos, w.spawnPoint());
  assert.equal(respawnPoint(w, null).lostBed, false);
});

test('床和箱子的配方；床是矮的一格，箱子是实心方块', () => {
  const inv = {};
  addItem(inv, PLANKS, 11);
  addItem(inv, LEAVES, 4);
  assert.equal(craft(inv, recipe('bed')), 1);
  assert.equal(craft(inv, recipe('chest')), 1);
  assert.equal(countOf(inv, BED), 1);
  assert.equal(countOf(inv, CHEST), 1);
  assert.equal(countOf(inv, PLANKS), 0);
  const w = farmWorld();
  w.set(5, 2, 5, BED);
  w.set(7, 2, 5, CHEST);
  const g = buildChunkGeometry(w, 0, 0);
  let bedTop = 0;
  for (let i = 1; i < g.positions.length; i += 3) if (Math.abs(g.positions[i] - (2 + BED_HEIGHT)) < 1e-6 && g.normals[i] === 1) bedTop++;
  assert.equal(bedTop, 4, '床的顶面在 0.56 高');
  assert.equal(w.isSolid(7, 2, 5), true);
  assert.equal(dropFor(BED), BED);
  assert.equal(dropFor(CHEST), CHEST);
});

test('快捷栏最后一格：能放麦种和一般方块，不能放水、基岩、庄稼、工具', () => {
  assert.equal(canUseCustomSlot(SEEDS), true);
  assert.equal(canUseCustomSlot(BED), true);
  assert.equal(canUseCustomSlot(CHEST), true);
  assert.equal(canUseCustomSlot(IRON_ORE), true);
  assert.equal(canUseCustomSlot(WATER), false);
  assert.equal(canUseCustomSlot(flowId(3)), false);
  assert.equal(canUseCustomSlot(BEDROCK_ID), false);
  assert.equal(canUseCustomSlot(WHEAT_BASE), false);
  assert.equal(canUseCustomSlot(STONE_PICKAXE), false);
  const palette = creativePalette();
  assert.ok(palette.includes(BED) && palette.includes(CHEST) && palette.includes(SEEDS));
  assert.ok(!palette.includes(WATER) && !palette.includes(WHEAT_BASE + 3));
});

test('箱子：存取东西、挖掉后东西倒进背包、存档只留还在的箱子', () => {
  const bag = {};
  const box = {};
  addItem(bag, STONE_B, 10);
  assert.equal(transfer(bag, box, STONE_B, 4), 4);
  assert.equal(transfer(bag, box, STONE_B, 99), 6, '最多搬现有的');
  assert.equal(transfer(bag, box, STONE_B, 1), 0);
  assert.deepEqual(bag, {});
  assert.equal(describeChest(box), '石头 ×10');
  assert.equal(describeChest({}), '空的');

  const w = farmWorld();
  w.set(3, 2, 3, CHEST);
  w.set(4, 2, 3, CHEST);
  const chests = new Map([[chestKey(3, 2, 3), box], [chestKey(4, 2, 3), {}], [chestKey(9, 2, 9), { 5: 1 }]]);
  const saved = JSON.parse(JSON.stringify(serializeChests(chests)));
  assert.deepEqual(Object.keys(saved).sort(), ['3,2,3', '9,2,9'], '空箱子不存');
  const back = deserializeChests({ ...saved, 'bad': { 1: 1 }, '1,2': {} }, w);
  assert.deepEqual([...back.keys()], ['3,2,3'], '9,2,9 那里已经不是箱子了');
  assert.equal(countOf(back.get('3,2,3'), STONE_B), 10);

  const inv = {};
  assert.equal(emptyChestInto(back, '3,2,3', inv), 10);
  assert.equal(countOf(inv, STONE_B), 10);
  assert.equal(back.size, 0);
  assert.equal(emptyChestInto(back, '7,7,7', inv), 0);
});

// ---------- 洞穴和天光 ----------
import { computeSkyLight, updateSkyLight } from '../src/game/light.js';
import { CAVE_DARK } from '../src/game/monsters.js';

test('洞穴：地下有挖空的隧道，湖底不会被挖穿，基岩不动', () => {
  const w = new World({ seed: 1 });
  let caveAir = 0;
  for (let z = 0; z < w.sizeZ; z++) for (let x = 0; x < w.sizeX; x++) {
    assert.equal(w.get(x, 0, z), BEDROCK_ID);
    const h = Math.min(w.heightAt(x, z), w.sizeY - 10);
    for (let y = 1; y < h - 3; y++) if (w.get(x, y, z) === AIR) caveAir++;
    if (h <= SEA_LEVEL + 1) {
      for (let y = Math.max(1, h - 2); y <= h; y++) assert.notEqual(w.get(x, y, z), AIR, `湖底 ${x},${y},${z}`);
    }
  }
  assert.ok(caveAir > 3000, `洞穴里的空格子：${caveAir}`);
  assert.deepEqual(new World({ seed: 1 }).data, w.data, '同一个种子洞穴一样');
});

test('天光：露天是 15，屋顶下面暗下去，封死的洞里是 0', () => {
  const w = floorWorld();
  // 一个 9×9 的平顶棚，下面四面敞开
  for (let x = 4; x <= 12; x++) for (let z = 4; z <= 12; z++) w.rawSet(x, 5, z, STONE);
  // 一个封死的小屋子
  for (let x = 20; x <= 24; x++) for (let y = 1; y <= 5; y++) for (let z = 20; z <= 24; z++) {
    const wall = x === 20 || x === 24 || y === 1 || y === 5 || z === 20 || z === 24;
    if (wall) w.rawSet(x, y, z, STONE);
  }
  computeSkyLight(w);
  assert.equal(w.skyAt(2, 1, 2), 15);
  assert.equal(w.skyAt(8, 6, 8), 15, '屋顶上面');
  assert.equal(w.skyAt(8, 1, 8), 15 - 5, '棚子正中间离边 5 格');
  assert.equal(w.skyAt(4, 1, 8), 15 - 1);
  assert.equal(w.skyAt(22, 3, 22), 0, '封死的屋子里一点天光都没有');
  w.rawSet(22, 5, 22, GLASS);
  computeSkyLight(w);
  assert.equal(w.skyAt(22, 4, 22), 14, '玻璃天窗挡一点点');
});

test('天光的局部更新和整个重算的结果一样', () => {
  const w = new World({ seed: 5 });
  computeSkyLight(w);
  let s = 11;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 25; k++) {
    const x = Math.floor(rand() * w.sizeX);
    const z = Math.floor(rand() * w.sizeZ);
    const y = w.topY(x, z);
    if (rand() < 0.5) w.rawSet(x, y, z, AIR);
    else w.rawSet(x, y + 1, z, STONE);
    updateSkyLight(w, x, z);
  }
  const partial = w.sky.slice();
  computeSkyLight(w);
  assert.deepEqual(partial, w.sky);
});

test('网格：洞里的面天光是暗的，露天的面是亮的；Sim 改方块时会更新天光', () => {
  const w = floorWorld(1);
  for (let x = 2; x <= 8; x++) for (let y = 1; y <= 5; y++) for (let z = 2; z <= 8; z++) {
    const wall = x === 2 || x === 8 || y === 5 || z === 2 || z === 8;
    if (wall) w.rawSet(x, y, z, STONE);
  }
  const sim = new Sim(w);
  const skyOfFloor = () => {
    const g = buildChunkGeometry(w, 0, 0);
    let inside = -1;
    let outside = -1;
    for (let i = 0; i < g.positions.length; i += 3) {
      if (g.positions[i + 1] !== 1 || g.normals[i + 1] !== 1) continue;
      const [x, z] = [g.positions[i], g.positions[i + 2]];
      if (x > 4 && x < 6 && z > 4 && z < 6) inside = Math.max(inside, g.sky[i / 3]);
      if (x > 12) outside = Math.max(outside, g.sky[i / 3]);
    }
    return [inside, outside];
  };
  let [inside, outside] = skyOfFloor();
  assert.equal(outside, 1);
  assert.ok(inside < 0.05, `屋里 ${inside}`);
  const dirty = sim.edit(5, 5, 5, AIR); // 屋顶开个洞
  assert.ok(dirty.has('0,0'));
  [inside, outside] = skyOfFloor();
  assert.ok(inside > 0.9, `开了天窗：${inside}`);
});

test('洞里的夜影：白天在黑暗的洞里也会出现，露天的白天不会', () => {
  const w = floorWorld(4);
  // 地面在 y=10，下面 y=1..4 挖一个大洞（封死）
  for (let x = 0; x < w.sizeX; x++) for (let z = 0; z < w.sizeZ; z++) for (let y = 1; y <= 10; y++) w.rawSet(x, y, z, STONE);
  for (let x = 10; x < 54; x++) for (let z = 10; z < 54; z++) for (let y = 1; y <= 4; y++) w.rawSet(x, y, z, AIR);
  computeSkyLight(w);
  computeLight(w);
  assert.ok(w.skyAt(30, 2, 30) < CAVE_DARK);
  const player = createPlayer([32.5, 11, 32.5]);
  const monsters = [];
  for (let i = 0; i < 80 && monsters.length < 3; i++) trySpawn(w, monsters, player, Math.random, { night: false });
  assert.ok(monsters.length >= 1, '洞里出现了');
  assert.ok(monsters.every((m) => m.pos[1] < 5), '都在洞里');

  const open = floorWorld(4);
  computeSkyLight(open);
  const none = [];
  for (let i = 0; i < 80; i++) trySpawn(open, none, createPlayer([32.5, 1, 32.5]), Math.random, { night: false });
  assert.equal(none.length, 0, '露天的白天没有');

  // 玩家在很高的地方（离洞 12 格以上）：洞里也不生成
  const high = [];
  for (let i = 0; i < 80; i++) trySpawn(w, high, createPlayer([32.5, 30, 32.5]), Math.random, { night: false });
  assert.equal(high.length, 0);
});

// ---------- 音效（纯计算部分） ----------
import { soundMaterial, spatial, stepFootsteps, clampVolume, HEAR_DISTANCE } from '../src/game/sound.js';

test('音效：方块按材质分类', () => {
  assert.equal(soundMaterial(STONE), 'stone');
  assert.equal(soundMaterial(IRON_ORE), 'stone');
  assert.equal(soundMaterial(LOG), 'wood');
  assert.equal(soundMaterial(CHEST), 'wood');
  assert.equal(soundMaterial(GRASS_ID), 'dirt');
  assert.equal(soundMaterial(SAND_B), 'sand');
  assert.equal(soundMaterial(LEAVES), 'leaves');
  assert.equal(soundMaterial(WHEAT_BASE + 2), 'leaves');
  assert.equal(soundMaterial(GLASS_ID), 'glass');
  assert.equal(soundMaterial(WATER), 'water');
});

test('音效：越远越小，太远听不见；右边的声音在右声道', () => {
  const me = [0, 0, 0];
  const near = spatial(me, 0, [1, 0, 0]);
  const far = spatial(me, 0, [12, 0, 0]);
  assert.ok(near.gain > far.gain && far.gain > 0);
  assert.equal(spatial(me, 0, [HEAR_DISTANCE + 1, 0, 0]).gain, 0);
  assert.ok(near.pan > 0.5, '面朝 -z 时 +x 在右边');
  assert.ok(spatial(me, 0, [-5, 0, 0]).pan < -0.5, '-x 在左边');
  assert.ok(Math.abs(spatial(me, 0, [0, 0, -5]).pan) < 0.01, '正前方居中');
  assert.ok(spatial(me, Math.PI, [5, 0, 0]).pan < -0.5, '转过身来左右就反了');
  assert.deepEqual(spatial(me, 0, null), { gain: 1, pan: 0 }, '没有位置的（受伤、吃东西）不衰减');
});

test('音效：走路每 1.7 格响一下脚步，跑步步子大一点，在空中不响', () => {
  const st = {};
  let steps = 0;
  for (let i = 0; i < 100; i++) if (stepFootsteps(st, 0.1, { onGround: true })) steps++;
  assert.equal(steps, 5, '走 10 格');
  let running = 0;
  const runSt = {};
  for (let i = 0; i < 100; i++) if (stepFootsteps(runSt, 0.1, { onGround: true, sprinting: true })) running++;
  assert.ok(running < steps);
  assert.equal(stepFootsteps(st, 5, { onGround: false }), false);
  assert.equal(clampVolume('x'), 0.7);
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(-1), 0);
});

// ---------- 大世界 ----------
import { updateBlockLight } from '../src/game/light.js';
import { ChunkRenderer, VIEW_DISTANCE } from '../src/game/renderer.js';

test('世界默认 256×256；火把光的局部更新和整个重算的结果一样', () => {
  const w = new World({ seed: 7 });
  assert.equal(w.sizeX, 256);
  assert.equal(w.sizeZ, 256);
  computeLight(w);
  let s = 3;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 30; k++) {
    // 在一小片区域里反复放火把、挖方块、放石头，让光互相影响
    const x = 100 + Math.floor(rand() * 30);
    const z = 100 + Math.floor(rand() * 30);
    const y = w.topY(x, z);
    const r = rand();
    if (r < 0.4) w.rawSet(x, y + 1, z, TORCH);
    else if (r < 0.7) w.rawSet(x, y, z, AIR);
    else w.rawSet(x, y + 1, z, STONE);
    updateBlockLight(w, x, z);
  }
  const partial = w.light.slice();
  computeLight(w);
  assert.deepEqual(partial, w.light);
});

test('Sim 改方块只重算附近的光，很快', () => {
  const w = new World({ seed: 2 });
  const sim = new Sim(w);
  const times = [];
  for (let k = 0; k < 20; k++) {
    const x = 60 + k * 6;
    const z = 128;
    const t0 = performance.now();
    sim.edit(x, w.topY(x, z) + 1, z, TORCH);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[10] < 25, `中位数 ${times[10].toFixed(1)} ms`);
});

test('区块渲染：一开始只建身边的，之后由近到远补齐；远处的不画；没建的区块改了也不用重建', () => {
  const w = new World({ seed: 1, chunks: 8 });
  const r = new ChunkRenderer(w, null, null);
  assert.equal(r.built, 0);
  r.buildAround(8, 8, 1); // 角落里：只有 2×2 个区块在范围内
  assert.equal(r.built, 4);
  const first = r.nearestPending(8, 8);
  assert.ok(['2,0', '0,2', '2,1', '1,2', '2,2'].includes(first), `下一个最近的：${first}`);
  r.rebuildKeys(new Set(['7,7'])); // 还没建：跳过
  assert.equal(r.meshes.has('7,7'), false);
  while (r.pending.size) r.update(8, 8, 1000);
  assert.equal(r.built, r.total);
  assert.equal(r.meshes.get('0,0').solid.visible, true);
  r.update(8, 8, 0);
  const farKey = [...r.meshes.keys()].find((k) => {
    const [cx, cz] = k.split(',').map(Number);
    return Math.hypot((cx + 0.5) * 16 - 8, (cz + 0.5) * 16 - 8) > VIEW_DISTANCE + 16;
  });
  assert.ok(farKey, '有离得很远的区块');
  assert.equal(r.meshes.get(farKey).solid.visible, false);
});

// ---------- 地图 ----------
import { columnColor, surfaceOf, MapData, packExplored, unpackExplored, EXPLORE_RADIUS } from '../src/game/map.js';
import { SNOW as SNOW_ID } from '../src/game/blocks.js';

test('地图颜色：草地绿、沙子黄、水蓝而且越深越暗、雪白；高的地方亮', () => {
  const w = floorWorld();
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.rawSet(x, 1, z, GRASS_ID);
  w.rawSet(5, 1, 5, SAND_B);
  w.rawSet(6, 1, 6, SNOW_ID);
  for (let y = 1; y <= 2; y++) w.rawSet(10, y, 10, WATER);
  for (let y = 1; y <= 8; y++) w.rawSet(12, y, 12, WATER);
  const [r, g, b] = columnColor(w, 20, 20);
  assert.ok(g > r && g > b, '草地偏绿');
  const sand = columnColor(w, 5, 5);
  assert.ok(sand[0] > 180 && sand[1] > 170, '沙子浅黄');
  assert.ok(columnColor(w, 6, 6).every((c) => c > 200), '雪白');
  const shallow = columnColor(w, 10, 10);
  const deep = columnColor(w, 12, 12);
  assert.ok(shallow[2] > shallow[0] && deep[2] < shallow[2], '水是蓝的，深水更暗');
  assert.deepEqual(surfaceOf(w, 12, 12), { id: WATER, y: 8, depth: 8 });
  w.rawSet(25, 2, 25, GRASS_ID);
  w.rawSet(25, 1, 25, DIRT_ID);
  assert.ok(columnColor(w, 25, 25)[1] > columnColor(w, 20, 20)[1], '高出来的地方亮一点');
});

test('地图：只显示去过的地方；改了方块，flush 后那一列颜色跟着变', () => {
  const w = floorWorld();
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.rawSet(x, 1, z, GRASS_ID);
  const map = new MapData(w);
  const px = (x, z) => [...map.pixels.subarray((z * w.sizeX + x) * 4, (z * w.sizeX + x) * 4 + 3)];
  const before = px(8, 8);
  assert.notEqual(before[1] > before[0] + 30, true, '还没去过：是底色不是草绿');
  const lit = map.explore(8.5, 8.5, 5);
  assert.ok(lit > 60 && lit < 100, `点亮了 ${lit} 格`);
  assert.ok(px(8, 8)[1] > px(8, 8)[0], '去过了：显示草地');
  assert.deepEqual(px(20, 20), before, '远处还没去过');
  assert.equal(map.explore(8.5, 8.5, 5), 0, '再走一遍不重复点亮');

  w.rawSet(8, 1, 8, SAND_B);
  assert.ok(px(8, 8)[1] > px(8, 8)[0], 'flush 之前还是旧颜色');
  map.markChunk(0, 0);
  assert.equal(map.flush(), true);
  assert.ok(px(8, 8)[0] > 180, '变成沙子的颜色');
  assert.equal(map.flush(), false, '没有要更新的');
  assert.ok(EXPLORE_RADIUS >= 30);
});

test('地图：探索记录打包存档后能原样读回来，坏数据返回 null', () => {
  const size = 256 * 256;
  const e = new Uint8Array(size);
  for (let i = 0; i < size; i += 7) e[i] = 1;
  e[size - 1] = 1;
  const text = packExplored(e);
  assert.ok(text.length < 12000, `存档大小 ${text.length} 字`);
  assert.deepEqual(unpackExplored(text, size), e);
  assert.equal(unpackExplored('abc', size), null);
  assert.equal(unpackExplored(null, size), null);
  assert.equal(unpackExplored(packExplored(new Uint8Array(64)), size), null, '大小不对');
});

// ---------- 门和梯子 ----------
import { DOOR_BASE, LADDER_BASE, doorId, isDoor, isLadder } from '../src/game/blocks.js';
import { DOOR_ITEM, LADDER_ITEM } from '../src/game/items.js';
import { facingFromYaw, doorPlacement, toggleDoor, ladderPlacement, ladderWall, panelBox } from '../src/game/building.js';
import { onLadder } from '../src/game/player.js';

test('门：放在两格高的空地上，门板朝着玩家面对的方向；开着能过、关着挡路', () => {
  assert.equal(facingFromYaw(0), 0, '面朝 -z 是北');
  assert.equal(facingFromYaw(-Math.PI / 2), 1, '面朝 +x 是东');
  assert.equal(facingFromYaw(Math.PI), 2);
  assert.equal(facingFromYaw(Math.PI / 2), 3);
  const w = floorWorld();
  const r = doorPlacement(w, 5, 1, 5, 0);
  assert.deepEqual(r.cells, [[5, 1, 5, doorId(0, false, 0)], [5, 2, 5, doorId(1, false, 0)]]);
  assert.ok(doorPlacement(w, 5, 2, 5, 0).error, '悬空不行');
  w.set(6, 2, 6, STONE);
  assert.ok(doorPlacement(w, 6, 1, 6, 0).error, '上面没空');
  for (const [x, y, z, id] of r.cells) w.set(x, y, z, id);
  assert.equal(w.isSolid(5, 1, 5), true, '关着的门挡路');
  const open = toggleDoor(w, 5, 2, 5); // 点上半也行
  assert.deepEqual(open, [[5, 1, 5, doorId(0, true, 0)], [5, 2, 5, doorId(1, true, 0)]]);
  for (const [x, y, z, id] of open) w.set(x, y, z, id);
  assert.equal(w.isSolid(5, 1, 5), false, '开着能过');
  assert.equal(toggleDoor(w, 7, 1, 7), null);
  const [min, max] = panelBox(doorId(0, false, 0));
  assert.deepEqual([min, max], [[0, 0, 0], [1, 1, 3 / 16]], '关着：贴在北边');
  const [omin, omax] = panelBox(doorId(0, true, 0));
  assert.deepEqual([omin, omax], [[1 - 3 / 16, 0, 0], [1, 1, 1]], '开着：转到东边');
  assert.equal(dropFor(doorId(1, true, 2)), DOOR_ITEM);
  assert.ok(isDoor(DOOR_BASE + 15) && !isDoor(DOOR_BASE + 16));
});

test('门：拆掉一半另一半也没了，只掉一扇；脚下挖空门会掉；夜影进不了关着的门', () => {
  const w = floorWorld();
  const sim = new Sim(w);
  for (const [x, y, z, id] of doorPlacement(w, 5, 1, 5, 0).cells) sim.edit(x, y, z, id);
  sim.edit(5, 2, 5, AIR); // 拆上半
  assert.equal(w.get(5, 1, 5), AIR);
  assert.deepEqual(sim.lastRemoved, [], '另一半不算掉落（挖的那一半自己掉一扇门）');

  for (const [x, y, z, id] of doorPlacement(w, 8, 1, 8, 0).cells) sim.edit(x, y, z, id);
  sim.edit(8, 0, 8, AIR); // 挖掉脚下
  assert.equal(w.get(8, 1, 8), AIR);
  assert.equal(w.get(8, 2, 8), AIR);
  assert.deepEqual(sim.lastRemoved.map(dropFor), [DOOR_ITEM], '掉一扇门');

  // 一堵墙中间一扇关着的门：夜影过不去
  for (let z = 0; z < 32; z++) for (let y = 1; y <= 3; y++) w.rawSet(16, y, z, STONE);
  w.rawSet(16, 1, 10, doorId(0, false, 1));
  w.rawSet(16, 2, 10, doorId(1, false, 1));
  const player = createPlayer([20.5, 1, 10.5]);
  const m = createMonster([12.5, 1, 10.5]);
  for (let i = 0; i < 300; i++) stepMonster(w, m, player, 1 / 30, { rand: seq(0.5) });
  assert.ok(m.pos[0] < 16, `被门挡住：x=${m.pos[0]}`);
});

test('梯子：贴在墙的侧面，墙没了梯子掉；站在梯子上往前走会往上爬、不摔伤', () => {
  const w = floorWorld();
  for (let y = 1; y <= 8; y++) w.rawSet(10, y, 10, STONE); // 一根 8 格高的柱子
  assert.ok(ladderPlacement(w, [10, 3, 10], [0, 1, 0]).error, '不能放在顶面');
  const r = ladderPlacement(w, [10, 3, 10], [0, 0, 1]); // 点中柱子的南面
  assert.deepEqual(r.cell, [10, 3, 11, LADDER_BASE + 0], '梯子在柱子南边一格，墙在它北边');
  assert.deepEqual(ladderWall(r.cell[3], 10, 3, 11), [10, 3, 10]);
  const [min, max] = panelBox(r.cell[3]);
  assert.deepEqual(max[2], 1 / 16);
  assert.equal(dropFor(r.cell[3]), LADDER_ITEM);

  const sim = new Sim(w);
  for (let y = 1; y <= 8; y++) sim.edit(10, y, 11, LADDER_BASE + 0);
  assert.equal(w.isSolid(10, 4, 11), false, '梯子能穿过');
  sim.edit(10, 5, 10, AIR); // 挖掉柱子中间一块
  assert.equal(w.get(10, 5, 11), AIR, '那一格的梯子掉了');
  assert.deepEqual(sim.lastRemoved.map(dropFor), [LADDER_ITEM]);
  sim.edit(10, 5, 10, STONE);
  sim.edit(10, 5, 11, LADDER_BASE + 0);

  const p = createPlayer([10.5, 1, 11.5], 0); // 面朝北（柱子）
  for (let i = 0; i < 5; i++) stepPlayer(w, p, {}, 1 / 30);
  assert.equal(onLadder(w, p), true);
  for (let i = 0; i < 60; i++) stepPlayer(w, p, { forward: 1 }, 1 / 30);
  assert.ok(p.pos[1] > 6, `爬上去了：y=${p.pos[1]}`);
  // 从梯子上松手慢慢滑下来，不会摔伤
  let landed = 0;
  for (let i = 0; i < 300; i++) landed = Math.max(landed, stepPlayer(w, p, {}, 1 / 30));
  assert.ok(p.pos[1] < 1.1, '滑到底了');
  assert.equal(fallDamage(landed), 0);
  assert.ok(isLadder(LADDER_BASE + 3) && !isLadder(LADDER_BASE + 4));
});

test('门和梯子的配方；能放到快捷栏最后一格，方块选择器里有', () => {
  const inv = {};
  addItem(inv, PLANKS, 6);
  addItem(inv, STICK, 7);
  assert.equal(craft(inv, recipe('door')), 1);
  assert.equal(craft(inv, recipe('ladder')), 1);
  assert.equal(countOf(inv, DOOR_ITEM), 1);
  assert.equal(countOf(inv, LADDER_ITEM), 3);
  assert.equal(canUseCustomSlot(DOOR_ITEM), true);
  assert.equal(canUseCustomSlot(LADDER_ITEM), true);
  assert.equal(canUseCustomSlot(doorId(0, false, 0)), false, '单独的门方块不列出来');
  const palette = creativePalette();
  assert.ok(palette.includes(DOOR_ITEM) && palette.includes(LADDER_ITEM));
  assert.ok(!palette.some((id) => isDoor(id) || isLadder(id)));
});

import { ATLAS_COLS as ATLAS_COLS_T, ATLAS_ROWS as ATLAS_ROWS_T } from '../src/game/mesher.js';
import { TILE as TILE_T } from '../src/game/blocks.js';

test('所有贴图编号都在图集范围内（超出会采到错的贴图）', () => {
  const size = ATLAS_COLS_T * ATLAS_ROWS_T;
  for (const [name, tile] of Object.entries(TILE_T)) assert.ok(tile < size, `${name} = ${tile}，图集只有 ${size} 格`);
  const tiles = Object.values(TILE_T);
  assert.equal(new Set(tiles).size, tiles.length, '没有两个贴图共用一个编号');
});

// ---------- 生物群系 ----------
import { biomeAt, BIOMES } from '../src/game/biomes.js';
import { CACTUS, ICE, SANDSTONE } from '../src/game/blocks.js';
import { touchesBlock } from '../src/game/player.js';

test('生物群系：同一个种子同一个地方结果一样；一个世界里四种都有', () => {
  assert.equal(biomeAt(1, 50, 60), biomeAt(1, 50, 60));
  const w = new World({ seed: 1 });
  const count = { plains: 0, forest: 0, desert: 0, snow: 0 };
  for (let z = 0; z < 256; z += 4) for (let x = 0; x < 256; x += 4) count[w.biomeAt(x, z)]++;
  for (const [k, v] of Object.entries(count)) assert.ok(v > 100, `${BIOMES[k].name} 占了 ${v} 个采样点`);
});

test('生物群系：沙漠是沙子下面砂岩、长仙人掌不长树；雪原地面是雪、湖面结冰、长雪松；森林的树比平原多', () => {
  const w = new World({ seed: 1 });
  const stat = { desert: { sand: 0, n: 0, cactus: 0, logs: 0, sandstone: 0 }, snow: { snowTop: 0, n: 0, ice: 0, water: 0 }, forest: { logs: 0, n: 0 }, plains: { logs: 0, n: 0 } };
  for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) {
    const b = w.biomeAt(x, z);
    const h = Math.min(w.heightAt(x, z), w.sizeY - 10);
    const top = w.topY(x, z);
    const topId = w.get(x, top, z);
    if (b === 'desert') {
      stat.desert.n++;
      if (w.get(x, h, z) === SAND_B) stat.desert.sand++;
      if (h > 8 && w.get(x, h - 5, z) === SANDSTONE) stat.desert.sandstone++;
      if (topId === CACTUS) stat.desert.cactus++;
      // 树干（边界旁边的树冠可能伸进沙漠，所以只数树干）
      for (let y = h + 1; y <= top; y++) if (w.get(x, y, z) === LOG) { stat.desert.logs++; break; }
    } else if (b === 'snow') {
      stat.snow.n++;
      if (topId === SNOW_ID || topId === LEAVES || topId === LOG) stat.snow.snowTop++;
      if (topId === ICE) stat.snow.ice++;
      if (topId === WATER) stat.snow.water++;
    } else {
      stat[b].n++;
      for (let y = top; y > top - 10 && y > 0; y--) if (w.get(x, y, z) === LOG) { stat[b].logs++; break; }
    }
  }
  assert.ok(stat.desert.sand / stat.desert.n > 0.9, '沙漠的地面几乎都是沙子');
  assert.ok(stat.desert.sandstone / stat.desert.n > 0.5, '沙子下面有砂岩');
  assert.ok(stat.desert.cactus > 20, `沙漠里有仙人掌：${stat.desert.cactus}`);
  assert.equal(stat.desert.logs, 0, '沙漠里不长树（没有树干）');
  assert.ok(stat.snow.snowTop / stat.snow.n > 0.6, '雪原大多是雪');
  assert.ok(stat.snow.ice > 0 && stat.snow.water === 0, '雪原的湖面都结冰了');
  assert.ok(stat.forest.logs / stat.forest.n > (stat.plains.logs / stat.plains.n) * 2, '森林的树多得多');
});

test('仙人掌：碰到会被扎；沙子没了整根倒下；冰上很滑', () => {
  const w = floorWorld();
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.rawSet(x, 1, z, SAND_B);
  const sim = new Sim(w);
  for (let y = 2; y <= 4; y++) sim.edit(10, y, 10, CACTUS);
  assert.equal(w.isSolid(10, 3, 10), true);
  const near = createPlayer([11.31, 2, 10.5]); // 贴着仙人掌东边
  const far = createPlayer([13.5, 2, 10.5]);
  assert.equal(touchesBlock(w, near, CACTUS), true);
  assert.equal(touchesBlock(w, far, CACTUS), false);
  sim.edit(10, 1, 10, AIR); // 挖掉下面的沙子
  for (let y = 2; y <= 4; y++) assert.equal(w.get(10, y, 10), AIR, `y=${y} 倒了`);
  assert.equal(sim.lastRemoved.filter((id) => id === CACTUS).length, 3, '三段仙人掌都能捡回来');
  assert.equal(dropFor(CACTUS), CACTUS);

  // 冰上：同样往前走 1 秒再松手，在冰上会多滑出一段
  const slide = (floor) => {
    const g = floorWorld();
    for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) g.rawSet(x, 0, z, floor);
    const p = createPlayer([4.5, 1, 16.5], -Math.PI / 2);
    for (let i = 0; i < 30; i++) stepPlayer(g, p, { forward: 1 }, 1 / 30);
    const x0 = p.pos[0];
    for (let i = 0; i < 60; i++) stepPlayer(g, p, {}, 1 / 30);
    return p.pos[0] - x0;
  };
  const onStone = slide(STONE);
  const onIce = slide(ICE);
  assert.ok(onIce > onStone * 3, `松手后滑行：冰 ${onIce.toFixed(2)} 格，石头 ${onStone.toFixed(2)} 格`);
  assert.equal(dropFor(ICE), null, '冰不掉东西（挖开变成水）');
});

test('砂岩的配方；兔子在雪原也会出现，夜影不会生在仙人掌上', () => {
  const inv = {};
  addItem(inv, SAND_B, 9);
  assert.equal(craft(inv, recipe('sandstone'), 9), 2);
  assert.equal(countOf(inv, SANDSTONE), 2);
  const w = floorWorld();
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.rawSet(x, 1, z, SNOW_ID);
  assert.ok(habitatAt(w, 5, 2, 5).includes('rabbit'));
  w.rawSet(8, 2, 8, CACTUS);
  computeLight(w);
  assert.equal(canSpawnAt(w, 8, 3, 8), false);
});

// ---------- 天气 ----------
import { createWeather, stepWeather, setWeather, precipitationAt, sheltered, sanitizeWeather } from '../src/game/weather.js';

test('天气：晴天和下雨轮流来，强度慢慢变化', () => {
  const w = createWeather(() => 0);
  assert.equal(w.state, 'clear');
  assert.equal(w.intensity, 0);
  let switched = 0;
  for (let t = 0; t < 301; t++) if (stepWeather(w, 1, () => 0)) switched++;
  assert.equal(w.state, 'rain', '晴了 300 秒以后开始下雨');
  assert.equal(switched, 1);
  assert.ok(w.intensity > 0 && w.intensity < 0.3, '刚开始下，还很小');
  for (let t = 0; t < 10; t++) stepWeather(w, 1, () => 0);
  assert.equal(w.intensity, 1, '十秒内下大');
  for (let t = 0; t < 85; t++) stepWeather(w, 1, () => 0);
  assert.equal(w.state, 'clear', '下 90 秒雨停了');
  setWeather(w, 'rain');
  assert.equal(w.state, 'rain');
  assert.equal(sanitizeWeather({ state: 'rain', timer: 50 }).intensity, 1);
  assert.equal(sanitizeWeather({ state: 'storm', timer: 50 }).state, 'clear', '不认识的天气当成晴天');
  assert.equal(sanitizeWeather(null).state, 'clear');
});

test('天气：沙漠不下、雪原下雪、其它地方下雨；屋顶下面淋不到', () => {
  const big = new World({ seed: 1 });
  const kinds = new Set();
  for (let z = 0; z < 256; z += 8) for (let x = 0; x < 256; x += 8) {
    const p = precipitationAt(big, x, z);
    const b = big.biomeAt(x, z);
    if (b === 'desert') assert.equal(p, null);
    if (b === 'snow') assert.equal(p, 'snow');
    if (b === 'plains' || b === 'forest') assert.equal(p, 'rain');
    kinds.add(p);
  }
  assert.deepEqual([...kinds].sort(), [null, 'rain', 'snow'].sort());
  const w = floorWorld();
  assert.equal(sheltered(w, 5.5, 1, 5.5), false);
  w.rawSet(5, 4, 5, STONE);
  assert.equal(sheltered(w, 5.5, 1, 5.5), true);
});

test('下雨时露天的庄稼长得和有水的一样快，屋里的不受影响', () => {
  const grow = (raining, roofed) => {
    const w = farmWorld();
    const crops = new Set();
    for (let z = 4; z < 28; z++) {
      w.set(16, 1, z, FARMLAND);
      w.set(16, 2, z, WHEAT_BASE);
      if (roofed) w.rawSet(16, 4, z, STONE);
      crops.add(w.index(16, 2, z));
    }
    computeSkyLight(w);
    let s = 9;
    const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let t = 0; t < 30; t++) growCrops(w, crops, rand, raining);
    let total = 0;
    for (let z = 4; z < 28; z++) total += cropStage(w.get(16, 2, z));
    return total;
  };
  const dry = grow(false, false);
  const rain = grow(true, false);
  const roof = grow(true, true);
  assert.ok(rain > dry * 1.6, `淋雨 ${rain}，不下雨 ${dry}`);
  assert.ok(roof < rain * 0.8, `屋顶下 ${roof}`);
});

// ---------- 沙丘蜥和护甲 ----------
import { SCALE, SCALE_ARMOR, IRON_ARMOR, armorOf, armoredDamage } from '../src/game/items.js';

test('沙丘蜥：只住在沙漠的沙子上，爱吃仙人掌，掉肉和鳞片', () => {
  const big = new World({ seed: 1 });
  // 找一块沙漠和一块海边沙滩
  let desert = null;
  let beach = null;
  for (let z = 0; z < 256 && (!desert || !beach); z += 2) for (let x = 0; x < 256 && (!desert || !beach); x += 2) {
    const y = big.topY(x, z);
    if (big.get(x, y, z) !== SAND_B || big.get(x, y + 1, z) !== AIR) continue;
    if (big.biomeAt(x, z) === 'desert') desert = desert ?? [x, y + 1, z];
    else beach = beach ?? [x, y + 1, z];
  }
  assert.ok(habitatAt(big, ...desert).includes('lizard'));
  assert.ok(!habitatAt(big, ...beach).includes('lizard'), '普通的沙滩上没有');
  const liz = createAnimal([5.5, 2, 5.5], { species: 'lizard' });
  assert.equal(foodFor(liz), CACTUS);
  assert.equal(animalName(liz), '沙丘蜥');
  assert.deepEqual(animalDrops(liz, () => 0), [[RAW_MEAT, 1]], '运气不好没有鳞片');
  assert.deepEqual(animalDrops(liz, () => 0.99), [[RAW_MEAT, 1], [SCALE, 2]]);
  const back = deserializeAnimals(JSON.parse(JSON.stringify(serializeAnimals([liz]))), farmWorld());
  assert.equal(back[0].species, 'lizard', '存档记得是沙丘蜥');
});

test('沙丘蜥一阵一阵地跑，被打了逃得很快', () => {
  const w = floorWorld();
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) w.rawSet(x, 0, z, SAND_B);
  const player = createPlayer([16.5, 1, 16.5]);
  const liz = createAnimal([12.5, 1, 16.5], { species: 'lizard' });
  const rabbit = createAnimal([12.5, 1, 16.5]);
  damageAnimal(liz, 1, player.pos);
  damageAnimal(rabbit, 1, player.pos);
  for (let i = 0; i < 45; i++) {
    stepAnimal(w, liz, player, 1 / 30, { rand: seq(0.5) });
    stepAnimal(w, rabbit, player, 1 / 30, { rand: seq(0.5) });
  }
  const dl = Math.hypot(liz.pos[0] - 16.5, liz.pos[2] - 16.5);
  const dr = Math.hypot(rabbit.pos[0] - 16.5, rabbit.pos[2] - 16.5);
  assert.ok(dl > dr, `1.5 秒后：沙丘蜥离玩家 ${dl.toFixed(1)} 格，兔子 ${dr.toFixed(1)} 格`);
});

test('护甲：放在背包里就生效，用最好的一件；只能做一件；伤害至少 1 点', () => {
  assert.equal(armorOf({}), 0);
  assert.equal(armorOf({ [SCALE_ARMOR]: 1 }), 0.25);
  assert.equal(armorOf({ [SCALE_ARMOR]: 1, [IRON_ARMOR]: 1 }), 0.45);
  assert.equal(armoredDamage(3, 0), 3);
  assert.equal(armoredDamage(3, 0.25), 2);
  assert.equal(armoredDamage(3, 0.45), 2);
  assert.equal(armoredDamage(2, 0.45), 1);
  assert.equal(armoredDamage(1, 0.45), 1, '至少 1 点');
  assert.equal(armoredDamage(0, 0.45), 0);
  const inv = {};
  addItem(inv, SCALE, 12);
  addItem(inv, IRON_INGOT, 5);
  assert.equal(craft(inv, recipe('scaleArmor'), 5), 1, '护甲只做一件');
  assert.equal(craft(inv, recipe('ironArmor')), 1);
  assert.equal(countOf(inv, SCALE), 6);
  assert.equal(armorOf(inv), 0.45);
});
