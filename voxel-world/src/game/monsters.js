import { AIR } from './blocks.js';
import { moveBody } from './player.js';

// 夜影：夜里在黑暗的地方出现的怪物，一跳一跳地朝玩家扑过来。
// 火把照亮的地方不会出现。洞穴里够黑的话白天也会有；晒到太阳会慢慢消散。

export const MONSTER_HALF = 0.4;
export const MONSTER_HEIGHT = 0.8;
export const MONSTER_HEALTH = 10;
export const MONSTER_DAMAGE = 3;
export const MAX_MONSTERS = 8;
export const SPAWN_MIN = 16;
export const SPAWN_MAX = 30;
export const DESPAWN_DISTANCE = 56;
export const CHASE_DISTANCE = 28;
export const DARK_ENOUGH = 7; // 火把光照低于这个才会出现
export const CAVE_DARK = 4; // 天光低于这个算“洞里”，白天也会出现
export const SUNLIT = 8; // 天光不低于这个算晒得到太阳
export const CAVE_RANGE = 12; // 洞里的只在玩家上下这么多格内生成
export const DISSOLVE_SECONDS = 1.5;
const HOP_SPEED = 8.6;
const MOVE_SPEED = 3.4;
const ATTACK_COOLDOWN = 1;

let nextId = 1;

export function createMonster(pos) {
  return {
    id: nextId++,
    pos: [...pos],
    vel: [0, 0, 0],
    half: MONSTER_HALF,
    height: MONSTER_HEIGHT,
    onGround: false,
    inWater: false,
    health: MONSTER_HEALTH,
    hopTimer: 0.4,
    attackTimer: 0,
    hurtFlash: 0,
    dissolve: 0,
    yaw: 0,
  };
}

// 能不能在 (x,y,z) 这一格出现：脚下是实心方块，这格和上面一格是空气，而且够黑
export function canSpawnAt(world, x, y, z) {
  if (y < 1 || !world.inBounds(x, y, z)) return false;
  if (!world.isSolidBlock(x, y - 1, z)) return false;
  if (world.get(x, y, z) !== AIR || world.get(x, y + 1, z) !== AIR) return false;
  return world.lightAt(x, y, z) < DARK_ENOUGH;
}

// 在玩家周围找个地方生成一只：夜里在地面上，任何时候都可能在黑暗的洞穴里。返回新怪物或 null。
export function trySpawn(world, monsters, player, rand = Math.random, { night = true } = {}) {
  if (monsters.length >= MAX_MONSTERS) return null;
  // 洞穴：随便挑一列，在玩家上下 CAVE_RANGE 格内找黑暗的洞穴地面（离玩家太远的洞里不生成，免得攒在脚底下）
  for (let attempt = 0; attempt < 4; attempt++) {
    const angle = rand() * Math.PI * 2;
    const r = 8 + rand() * 16;
    const x = Math.floor(player.pos[0] + Math.cos(angle) * r);
    const z = Math.floor(player.pos[2] + Math.sin(angle) * r);
    if (!world.inBounds(x, 0, z)) continue;
    const top = world.topY(x, z);
    const py = Math.floor(player.pos[1]);
    const candidates = [];
    for (let y = Math.max(1, py - CAVE_RANGE); y <= Math.min(top - 1, py + CAVE_RANGE); y++) {
      if (canSpawnAt(world, x, y, z) && world.skyAt(x, y, z) < CAVE_DARK) candidates.push(y);
    }
    if (!candidates.length) continue;
    const y = candidates[Math.floor(rand() * candidates.length)];
    const m = createMonster([x + 0.5, y, z + 0.5]);
    monsters.push(m);
    return m;
  }
  if (!night) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const angle = rand() * Math.PI * 2;
    const r = SPAWN_MIN + rand() * (SPAWN_MAX - SPAWN_MIN);
    const x = Math.floor(player.pos[0] + Math.cos(angle) * r);
    const z = Math.floor(player.pos[2] + Math.sin(angle) * r);
    if (!world.inBounds(x, 0, z)) continue;
    const y = world.topY(x, z) + 1;
    if (!canSpawnAt(world, x, y, z)) continue;
    const m = createMonster([x + 0.5, y, z + 0.5]);
    monsters.push(m);
    return m;
  }
  return null;
}

// 怪物和玩家挨在一起了（能咬到）
export function touching(m, player) {
  const reach = m.half + 0.3 + 0.15;
  return (
    Math.abs(m.pos[0] - player.pos[0]) < reach &&
    Math.abs(m.pos[2] - player.pos[2]) < reach &&
    m.pos[1] < player.pos[1] + 1.8 &&
    m.pos[1] + m.height > player.pos[1]
  );
}

/**
 * 推进一只怪物。返回它这一步对玩家造成的伤害（0 或 MONSTER_DAMAGE）。
 */
export function stepMonster(world, m, player, dt, { day = false, rand = Math.random } = {}) {
  m.attackTimer = Math.max(0, m.attackTimer - dt);
  m.hurtFlash = Math.max(0, m.hurtFlash - dt);
  if (day) m.dissolve += dt;

  const dx = player.pos[0] - m.pos[0];
  const dz = player.pos[2] - m.pos[2];
  const dist = Math.hypot(dx, dz);
  const chasing = dist < CHASE_DISTANCE && player.health > 0;
  if (chasing && dist > 0.01) m.yaw = Math.atan2(dx, dz);

  // 在地上会很快停下，然后再跳
  if (m.onGround) {
    const k = Math.max(0, 1 - dt * 12);
    m.vel[0] *= k;
    m.vel[2] *= k;
    m.hopTimer -= dt;
    if (m.hopTimer <= 0 && m.dissolve === 0) {
      let dirX;
      let dirZ;
      if (chasing && dist > 0.01) {
        dirX = dx / dist;
        dirZ = dz / dist;
      } else {
        const a = rand() * Math.PI * 2; // 没看到玩家就随便跳跳
        dirX = Math.cos(a) * 0.5;
        dirZ = Math.sin(a) * 0.5;
        m.yaw = Math.atan2(dirX, dirZ);
      }
      m.vel[0] = dirX * MOVE_SPEED;
      m.vel[2] = dirZ * MOVE_SPEED;
      m.vel[1] = HOP_SPEED;
      m.onGround = false;
      m.hopTimer = 0.45 + rand() * 0.5;
    }
  }
  moveBody(world, m, dt);

  if (m.attackTimer === 0 && m.dissolve === 0 && player.health > 0 && touching(m, player)) {
    m.attackTimer = ATTACK_COOLDOWN;
    return MONSTER_DAMAGE;
  }
  return 0;
}

// 被打：扣血、往后弹、闪红。返回是不是被打死了。
export function damageMonster(m, amount, fromPos) {
  m.health -= amount;
  m.hurtFlash = 0.3;
  const dx = m.pos[0] - fromPos[0];
  const dz = m.pos[2] - fromPos[2];
  const len = Math.hypot(dx, dz) || 1;
  m.vel[0] = (dx / len) * 6;
  m.vel[2] = (dz / len) * 6;
  m.vel[1] = 5;
  m.onGround = false;
  m.hopTimer = Math.max(m.hopTimer, 0.7);
  return m.health <= 0;
}

// 该从世界里去掉了吗（离太远、天亮消散完）
export function shouldRemove(m, player) {
  if (m.dissolve >= DISSOLVE_SECONDS) return true;
  const d = Math.hypot(m.pos[0] - player.pos[0], m.pos[2] - player.pos[2]);
  return d > DESPAWN_DISTANCE;
}

// 视线打到哪只怪物（射线和盒子求交）。返回 { monster, distance } 或 null。
export function rayHitMonster(origin, dir, maxDist, monsters) {
  let best = null;
  for (const m of monsters) {
    if (m.dissolve > 0) continue;
    const min = [m.pos[0] - m.half, m.pos[1], m.pos[2] - m.half];
    const max = [m.pos[0] + m.half, m.pos[1] + m.height, m.pos[2] + m.half];
    let t0 = 0;
    let t1 = maxDist;
    let hit = true;
    for (let a = 0; a < 3 && hit; a++) {
      if (Math.abs(dir[a]) < 1e-9) {
        if (origin[a] < min[a] || origin[a] > max[a]) hit = false;
        continue;
      }
      let ta = (min[a] - origin[a]) / dir[a];
      let tb = (max[a] - origin[a]) / dir[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) hit = false;
    }
    if (hit && (!best || t0 < best.distance)) best = { monster: m, distance: t0 };
  }
  return best;
}
