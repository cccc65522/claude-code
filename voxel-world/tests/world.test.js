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
