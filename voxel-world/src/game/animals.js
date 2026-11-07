import { AIR, GRASS } from './blocks.js';
import { moveBody } from './player.js';
import { RAW_MEAT } from './items.js';

// 绒耳兔：白天在草地上出没的温和小动物。被打会逃跑，拿着麦种会跟着走，
// 喂了麦种的两只靠在一起会生小兔。

export const ANIMAL_HALF = 0.3;
export const ANIMAL_HEIGHT = 0.6;
export const ANIMAL_HEALTH = 6;
export const BABY_SCALE = 0.6;
export const MAX_ANIMALS = 10;
export const SPAWN_MIN = 10;
export const SPAWN_MAX = 28;
export const DESPAWN_DISTANCE = 64;
export const LURE_DISTANCE = 8;
export const LOVE_SECONDS = 8;
export const BREED_COOLDOWN = 60;
export const GROW_UP_SECONDS = 60;
export const BREED_DISTANCE = 3;

let nextId = 1;

export function createAnimal(pos, { baby = false } = {}) {
  const a = {
    id: `a${nextId++}`,
    kind: 'rabbit',
    pos: [...pos],
    vel: [0, 0, 0],
    half: ANIMAL_HALF,
    height: ANIMAL_HEIGHT,
    onGround: false,
    inWater: false,
    health: ANIMAL_HEALTH,
    hopTimer: 0.5,
    rest: 0,
    flee: 0,
    love: 0,
    loveCooldown: 0,
    baby,
    grow: baby ? GROW_UP_SECONDS : 0,
    hurtFlash: 0,
    dissolve: 0,
    yaw: 0,
  };
  if (baby) {
    a.half = ANIMAL_HALF * BABY_SCALE;
    a.height = ANIMAL_HEIGHT * BABY_SCALE;
  }
  return a;
}

// 草方块上面两格空着就能出现
export function canAnimalSpawnAt(world, x, y, z) {
  if (y < 1 || !world.inBounds(x, y, z)) return false;
  if (world.get(x, y - 1, z) !== GRASS) return false;
  return world.get(x, y, z) === AIR && world.get(x, y + 1, z) === AIR;
}

export function trySpawnAnimal(world, animals, player, rand = Math.random) {
  if (animals.length >= MAX_ANIMALS) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const angle = rand() * Math.PI * 2;
    const r = SPAWN_MIN + rand() * (SPAWN_MAX - SPAWN_MIN);
    const x = Math.floor(player.pos[0] + Math.cos(angle) * r);
    const z = Math.floor(player.pos[2] + Math.sin(angle) * r);
    if (!world.inBounds(x, 0, z)) continue;
    const y = world.topY(x, z) + 1;
    if (!canAnimalSpawnAt(world, x, y, z)) continue;
    const a = createAnimal([x + 0.5, y, z + 0.5]);
    a.yaw = rand() * Math.PI * 2;
    animals.push(a);
    return a;
  }
  return null;
}

function hop(a, dirX, dirZ, speed, up) {
  a.vel[0] = dirX * speed;
  a.vel[2] = dirZ * speed;
  a.vel[1] = up;
  a.onGround = false;
  if (Math.abs(dirX) + Math.abs(dirZ) > 1e-6) a.yaw = Math.atan2(dirX, dirZ);
}

/**
 * 推进一只动物。lure: 玩家手里拿着麦种（动物会跟过来）。
 */
export function stepAnimal(world, a, player, dt, { rand = Math.random, lure = false } = {}) {
  a.hurtFlash = Math.max(0, a.hurtFlash - dt);
  a.flee = Math.max(0, a.flee - dt);
  a.love = Math.max(0, a.love - dt);
  a.loveCooldown = Math.max(0, a.loveCooldown - dt);
  if (a.baby) {
    a.grow -= dt;
    if (a.grow <= 0) {
      a.baby = false;
      a.half = ANIMAL_HALF;
      a.height = ANIMAL_HEIGHT;
    }
  }

  const dx = player.pos[0] - a.pos[0];
  const dz = player.pos[2] - a.pos[2];
  const dist = Math.hypot(dx, dz);

  if (a.onGround) {
    const k = Math.max(0, 1 - dt * 12);
    a.vel[0] *= k;
    a.vel[2] *= k;
    a.hopTimer -= dt;
    if (a.hopTimer <= 0 && a.dissolve === 0) {
      if (a.flee > 0 && dist > 0.01) {
        hop(a, -dx / dist, -dz / dist, 5, 7.5); // 被打了：往反方向猛跳
        a.hopTimer = 0.15;
      } else if (lure && dist < LURE_DISTANCE && dist > 1.6) {
        hop(a, dx / dist, dz / dist, 2.4, 6); // 跟着拿麦种的玩家
        a.hopTimer = 0.35;
      } else if (a.rest > 0) {
        a.rest -= 0.5;
        a.hopTimer = 0.5; // 歇一会儿
        if (lure && dist <= 1.6) a.yaw = Math.atan2(dx, dz);
      } else {
        const ang = rand() * Math.PI * 2;
        hop(a, Math.cos(ang), Math.sin(ang), 1.6, 6);
        a.hopTimer = 0.4 + rand() * 0.6;
        if (rand() < 0.25) a.rest = 1 + rand() * 3;
      }
    }
  }
  moveBody(world, a, dt);
}

// 喂麦种：成年、不在冷却里、还没在“想要宝宝”的状态才吃
export function feedAnimal(a) {
  if (a.baby || a.loveCooldown > 0 || a.love > 0 || a.dissolve > 0) return false;
  a.love = LOVE_SECONDS;
  return true;
}

// 两只都喂过、离得够近：生一只小兔。返回新的小兔或 null。
export function breed(animals, rand = Math.random) {
  if (animals.length >= MAX_ANIMALS + 4) return null;
  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    if (a.love <= 0) continue;
    for (let j = i + 1; j < animals.length; j++) {
      const b = animals[j];
      if (b.love <= 0) continue;
      const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
      if (d > BREED_DISTANCE) continue;
      a.love = 0;
      b.love = 0;
      a.loveCooldown = BREED_COOLDOWN;
      b.loveCooldown = BREED_COOLDOWN;
      const baby = createAnimal(
        [(a.pos[0] + b.pos[0]) / 2, Math.max(a.pos[1], b.pos[1]) + 0.1, (a.pos[2] + b.pos[2]) / 2],
        { baby: true },
      );
      baby.yaw = rand() * Math.PI * 2;
      animals.push(baby);
      return baby;
    }
  }
  return null;
}

// 被打：扣血、往后弹、开始逃跑。返回是不是死了。
export function damageAnimal(a, amount, fromPos) {
  a.health -= amount;
  a.hurtFlash = 0.3;
  a.flee = 4;
  a.rest = 0;
  const dx = a.pos[0] - fromPos[0];
  const dz = a.pos[2] - fromPos[2];
  const len = Math.hypot(dx, dz) || 1;
  a.vel[0] = (dx / len) * 5;
  a.vel[2] = (dz / len) * 5;
  a.vel[1] = 5;
  a.onGround = false;
  a.hopTimer = 0.2;
  return a.health <= 0;
}

export function animalDrops(a, rand = Math.random) {
  if (a.baby) return [];
  return [[RAW_MEAT, rand() < 0.5 ? 1 : 2]];
}

export function shouldRemoveAnimal(a, player) {
  if (a.dissolve >= 0.8) return true;
  return Math.hypot(a.pos[0] - player.pos[0], a.pos[2] - player.pos[2]) > DESPAWN_DISTANCE;
}
