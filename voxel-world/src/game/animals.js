import { AIR, GRASS, LOG, SAND, isLiquid } from './blocks.js';
import { moveBody } from './player.js';
import { APPLE, BERRIES, RAW_MEAT, SEEDS } from './items.js';
import { touching } from './monsters.js';

// 动物（都是原创设计）。不同种类住的地方、爱吃的东西、被打后的反应都不一样：
// - 绒耳兔：草地上，一跳一跳的，爱吃麦种，被打就逃
// - 鬃毛野猪：树林边的草地上，走路，爱吃苹果，被打会冲过来撞人（和平/创造模式下会逃）
// - 圆圆鸭：水边的沙地或草地上，走路、会游泳，爱吃野莓，长大后时不时下一个鸭蛋
// 喂了爱吃的东西的两只同种动物靠在一起会生小动物。

export const SPECIES = {
  rabbit: {
    name: '绒耳兔', babyName: '小绒耳兔', half: 0.3, height: 0.6, health: 6, food: SEEDS,
    gait: 'hop', speed: 1.6, fleeSpeed: 5, meat: [1, 2], temper: 'shy', weight: 3,
  },
  boar: {
    name: '鬃毛野猪', babyName: '小野猪', half: 0.45, height: 0.9, health: 12, food: APPLE,
    gait: 'walk', speed: 1.3, fleeSpeed: 3.4, chaseSpeed: 3.6, meat: [2, 3], temper: 'fierce', damage: 2, weight: 2,
  },
  duck: {
    name: '圆圆鸭', babyName: '小圆圆鸭', half: 0.25, height: 0.55, health: 4, food: BERRIES,
    gait: 'walk', speed: 1.1, fleeSpeed: 3.6, meat: [1, 1], temper: 'shy', lays: true, weight: 3,
  },
};
export const SPECIES_ORDER = ['rabbit', 'boar', 'duck'];

export const ANIMAL_HALF = SPECIES.rabbit.half;
export const ANIMAL_HEIGHT = SPECIES.rabbit.height;
export const ANIMAL_HEALTH = SPECIES.rabbit.health;
export const BABY_SCALE = 0.6;
export const MAX_ANIMALS = 10; // 玩家附近（NEARBY 格内）最多几只野生的会自己出现
export const MAX_TOTAL = 40; // 整个世界最多几只（包括生出来的）
export const NEARBY = 48;
export const SPAWN_MIN = 10;
export const SPAWN_MAX = 28;
export const LURE_DISTANCE = 8;
export const LOVE_SECONDS = 8;
export const BREED_COOLDOWN = 60;
export const GROW_UP_SECONDS = 60;
export const BREED_DISTANCE = 3;
export const ANGER_SECONDS = 8;
export const EGG_MIN = 90;
export const EGG_RANGE = 60;
const JUMP = 8.6;

let nextId = 1;

export function animalName(a) {
  const s = SPECIES[a.species];
  return a.baby ? s.babyName : s.name;
}

export function foodFor(a) {
  return SPECIES[a.species].food;
}

export function createAnimal(pos, { species = 'rabbit', baby = false, rand = Math.random } = {}) {
  const s = SPECIES[species];
  const scale = baby ? BABY_SCALE : 1;
  return {
    id: `a${nextId++}`,
    species,
    pos: [...pos],
    vel: [0, 0, 0],
    half: s.half * scale,
    height: s.height * scale,
    onGround: false,
    inWater: false,
    health: s.health,
    hopTimer: 0.5,
    rest: 0,
    flee: 0,
    anger: 0,
    attackTimer: 0,
    love: 0,
    loveCooldown: 0,
    baby,
    grow: baby ? GROW_UP_SECONDS : 0,
    eggTimer: EGG_MIN + rand() * EGG_RANGE,
    wanderDir: null,
    wanderTime: 0,
    blocked: false,
    hurtFlash: 0,
    dissolve: 0,
    yaw: 0,
  };
}

function near(world, x, y, z, radius, dys, test) {
  for (const dy of dys) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (test(world.get(x + dx, y + dy, z + dz))) return true;
      }
    }
  }
  return false;
}

// (x,y,z) 这一格适合哪些动物住（脚下的方块 + 周围环境）
export function habitatAt(world, x, y, z) {
  const below = world.get(x, y - 1, z);
  const out = [];
  if (below === GRASS) out.push('rabbit');
  if (below === GRASS && near(world, x, y, z, 5, [0, 1, 2, 3], (id) => id === LOG)) out.push('boar');
  if ((below === SAND || below === GRASS) && near(world, x, y, z, 5, [-1, 0], isLiquid)) out.push('duck');
  return out;
}

// 能不能在 (x,y,z) 生成某种动物：上面两格空着，而且是它住的地方
export function canAnimalSpawnAt(world, x, y, z, species = 'rabbit') {
  if (y < 1 || !world.inBounds(x, y, z)) return false;
  if (world.get(x, y, z) !== AIR || world.get(x, y + 1, z) !== AIR) return false;
  return habitatAt(world, x, y, z).includes(species);
}

export function nearbyCount(animals, player, radius = NEARBY) {
  let n = 0;
  for (const a of animals) if (Math.hypot(a.pos[0] - player.pos[0], a.pos[2] - player.pos[2]) <= radius) n++;
  return n;
}

export function trySpawnAnimal(world, animals, player, rand = Math.random) {
  if (animals.length >= MAX_TOTAL || nearbyCount(animals, player) >= MAX_ANIMALS) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const angle = rand() * Math.PI * 2;
    const r = SPAWN_MIN + rand() * (SPAWN_MAX - SPAWN_MIN);
    const x = Math.floor(player.pos[0] + Math.cos(angle) * r);
    const z = Math.floor(player.pos[2] + Math.sin(angle) * r);
    if (!world.inBounds(x, 0, z)) continue;
    const y = world.topY(x, z) + 1;
    if (y < 1 || world.get(x, y, z) !== AIR || world.get(x, y + 1, z) !== AIR) continue;
    const options = habitatAt(world, x, y, z);
    if (!options.length) continue;
    // 按权重挑一种
    const total = options.reduce((s, k) => s + SPECIES[k].weight, 0);
    let pick = rand() * total;
    let species = options[0];
    for (const k of options) {
      pick -= SPECIES[k].weight;
      if (pick < 0) {
        species = k;
        break;
      }
    }
    const a = createAnimal([x + 0.5, y, z + 0.5], { species, rand });
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
 * 推进一只动物。
 * lure(species): 玩家现在能不能引这种动物（拿着麦种那一格、背包里有它爱吃的）。
 * hostile: 野猪被打后会不会反击（生存模式、不是和平）。
 * 返回 { damage, egg }：这一步撞了玩家多少血、要不要在哪一格下个蛋。
 */
export function stepAnimal(world, a, player, dt, { rand = Math.random, lure = false, hostile = false } = {}) {
  const s = SPECIES[a.species];
  const events = { damage: 0, egg: null };
  a.hurtFlash = Math.max(0, a.hurtFlash - dt);
  a.flee = Math.max(0, a.flee - dt);
  a.anger = hostile ? Math.max(0, a.anger - dt) : 0;
  a.attackTimer = Math.max(0, a.attackTimer - dt);
  a.love = Math.max(0, a.love - dt);
  a.loveCooldown = Math.max(0, a.loveCooldown - dt);
  if (a.baby) {
    a.grow -= dt;
    if (a.grow <= 0) {
      a.baby = false;
      a.half = s.half;
      a.height = s.height;
    }
  }
  // 下蛋
  if (s.lays && !a.baby && a.dissolve === 0) {
    a.eggTimer -= dt;
    if (a.eggTimer <= 0) {
      a.eggTimer = EGG_MIN + rand() * EGG_RANGE;
      if (a.onGround && !a.inWater) events.egg = [Math.floor(a.pos[0]), Math.floor(a.pos[1]), Math.floor(a.pos[2])];
    }
  }

  const dx = player.pos[0] - a.pos[0];
  const dz = player.pos[2] - a.pos[2];
  const dist = Math.hypot(dx, dz) || 1e-6;
  const lured = (typeof lure === 'function' ? lure(a.species) : lure) && dist < LURE_DISTANCE && dist > 1.6;

  // 这一步想往哪走、多快
  let dir = null;
  let speed = 0;
  if (a.dissolve > 0) {
    dir = null;
  } else if (a.anger > 0 && player.health > 0) {
    dir = [dx / dist, dz / dist];
    speed = s.chaseSpeed;
  } else if (a.flee > 0) {
    dir = [-dx / dist, -dz / dist];
    speed = s.fleeSpeed;
  } else if (lured) {
    dir = [dx / dist, dz / dist];
    speed = s.speed * 1.6;
  }

  if (s.gait === 'hop') {
    if (a.onGround) {
      const k = Math.max(0, 1 - dt * 12);
      a.vel[0] *= k;
      a.vel[2] *= k;
      a.hopTimer -= dt;
      if (a.hopTimer <= 0 && a.dissolve === 0) {
        if (dir) {
          hop(a, dir[0], dir[1], speed, a.flee > 0 ? 7.5 : 6);
          a.hopTimer = a.flee > 0 ? 0.15 : 0.35;
        } else if (a.rest > 0) {
          a.rest -= 0.5;
          a.hopTimer = 0.5; // 歇一会儿
        } else {
          const ang = rand() * Math.PI * 2;
          hop(a, Math.cos(ang), Math.sin(ang), s.speed, 6);
          a.hopTimer = 0.4 + rand() * 0.6;
          if (rand() < 0.25) a.rest = 1 + rand() * 3;
        }
      }
    }
    moveBody(world, a, dt);
  } else {
    // 走路：没事干就随便走走、停停
    if (!dir && a.dissolve === 0) {
      a.wanderTime -= dt;
      if (a.wanderTime <= 0) {
        if (rand() < 0.4) a.wanderDir = null;
        else {
          const ang = rand() * Math.PI * 2;
          a.wanderDir = [Math.cos(ang), Math.sin(ang)];
        }
        a.wanderTime = 1.5 + rand() * 3;
      }
      if (a.wanderDir) {
        dir = a.wanderDir;
        speed = s.speed;
      }
    }
    if (dir) {
      a.yaw = Math.atan2(dir[0], dir[1]);
      const k = Math.min(1, dt * 10 * (a.onGround || a.inWater ? 1 : 0.3));
      a.vel[0] += (dir[0] * speed - a.vel[0]) * k;
      a.vel[2] += (dir[1] * speed - a.vel[2]) * k;
      // 被一格高的方块挡住就跳上去
      if (a.blocked && a.onGround) {
        a.vel[1] = JUMP;
        a.onGround = false;
      }
    } else if (a.onGround) {
      const k = Math.max(0, 1 - dt * 10);
      a.vel[0] *= k;
      a.vel[2] *= k;
    }
    a.blocked = moveBody(world, a, dt);
  }

  // 生气的野猪撞人
  if (a.anger > 0 && s.damage && a.attackTimer === 0 && player.health > 0 && touching(a, player)) {
    a.attackTimer = 1;
    events.damage = s.damage;
  }
  return events;
}

// 喂爱吃的东西：成年、不在冷却里、还没在“想要宝宝”的状态才吃
export function feedAnimal(a) {
  if (a.baby || a.loveCooldown > 0 || a.love > 0 || a.dissolve > 0) return false;
  a.love = LOVE_SECONDS;
  a.anger = 0;
  return true;
}

// 两只同种、都喂过、离得够近：生一只小的。返回新的小动物或 null。
export function breed(animals, rand = Math.random) {
  if (animals.length >= MAX_TOTAL) return null;
  for (let i = 0; i < animals.length; i++) {
    const a = animals[i];
    if (a.love <= 0) continue;
    for (let j = i + 1; j < animals.length; j++) {
      const b = animals[j];
      if (b.love <= 0 || b.species !== a.species) continue;
      const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
      if (d > BREED_DISTANCE) continue;
      a.love = 0;
      b.love = 0;
      a.loveCooldown = BREED_COOLDOWN;
      b.loveCooldown = BREED_COOLDOWN;
      const baby = createAnimal(
        [(a.pos[0] + b.pos[0]) / 2, Math.max(a.pos[1], b.pos[1]) + 0.1, (a.pos[2] + b.pos[2]) / 2],
        { species: a.species, baby: true, rand },
      );
      baby.yaw = rand() * Math.PI * 2;
      animals.push(baby);
      return baby;
    }
  }
  return null;
}

// 被打：扣血、往后弹；胆小的逃跑，野猪（hostile 时）生气冲过来。返回是不是死了。
export function damageAnimal(a, amount, fromPos, { hostile = false } = {}) {
  a.health -= amount;
  a.hurtFlash = 0.3;
  a.rest = 0;
  a.love = 0;
  if (SPECIES[a.species].temper === 'fierce' && hostile && !a.baby) {
    a.anger = ANGER_SECONDS;
    a.flee = 0;
  } else {
    a.flee = 4;
  }
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
  const [min, max] = SPECIES[a.species].meat;
  return [[RAW_MEAT, min + Math.floor(rand() * (max - min + 1))]];
}

// 动物会存档，所以不会因为离得远就消失，只有被打死才去掉
export function shouldRemoveAnimal(a) {
  return a.dissolve >= 0.8;
}

// ---------- 存档 ----------
const r2 = (v) => Math.round(v * 100) / 100;

// [x, y, z, 朝向, 小的还要几秒长大（成年是 0）, 繁殖冷却秒数, 血量, 种类编号]
export function serializeAnimals(animals) {
  return animals
    .filter((a) => a.dissolve === 0 && a.health > 0)
    .map((a) => [
      r2(a.pos[0]), r2(a.pos[1]), r2(a.pos[2]), r2(a.yaw),
      a.baby ? Math.ceil(a.grow) : 0, Math.ceil(a.loveCooldown), a.health, SPECIES_ORDER.indexOf(a.species),
    ]);
}

// 读档：丢掉坏数据；没有种类编号的老存档都是绒耳兔；原地被方块占了就放到这一列最上面
export function deserializeAnimals(list, world) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    if (out.length >= MAX_TOTAL) break;
    if (!Array.isArray(e) || (e.length !== 7 && e.length !== 8) || !e.every(Number.isFinite)) continue;
    const [x, y, z, yaw, grow, cooldown, health] = e;
    const species = e.length === 8 ? SPECIES_ORDER[e[7]] : 'rabbit';
    if (!species) continue;
    if (!world.inBounds(Math.floor(x), 0, Math.floor(z)) || y < 0 || y >= world.sizeY) continue;
    if (!Number.isInteger(health) || health < 1 || health > SPECIES[species].health) continue;
    const baby = grow > 0;
    const a = createAnimal([x, y, z], { species, baby });
    a.yaw = yaw;
    a.grow = baby ? Math.min(grow, GROW_UP_SECONDS) : 0;
    a.loveCooldown = Math.max(0, Math.min(cooldown, BREED_COOLDOWN));
    a.health = health;
    if (world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z))) {
      a.pos[1] = world.topY(Math.floor(x), Math.floor(z)) + 1;
    }
    out.push(a);
  }
  return out;
}
