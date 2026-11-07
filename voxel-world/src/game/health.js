// 生命值和摔落伤害（只在生存模式生效）

export const MAX_HEALTH = 20; // 10 颗心，每颗 2 点
export const SAFE_FALL = 3; // 3 格以内摔下来不疼
const REGEN_DELAY = 6; // 受伤后多少秒开始回血
const REGEN_EVERY = 2.5; // 之后每隔多少秒回 1 点
export const REGEN_MIN_HUNGER = 14; // 饱食度至少 7 个鸡腿才会回血
const REGEN_EXHAUSTION = 1.5; // 回 1 点血要消耗的体力

export function fallDamage(distance) {
  // 碰撞时会留出 0.0001 的空隙，加一点余量，免得刚好 12 格算成 11.99 格
  return Math.max(0, Math.floor(distance - SAFE_FALL + 0.01));
}

// 受伤。返回实际扣掉的血量。
export function hurt(p, amount) {
  if (amount <= 0 || p.health <= 0) return 0;
  const before = p.health;
  p.health = Math.max(0, p.health - amount);
  p.sinceHurt = 0;
  p.regen = 0;
  return before - p.health;
}

// 慢慢回血。返回这一步有没有回血。
export function regenerate(p, dt) {
  p.sinceHurt += dt;
  const fed = (p.hunger ?? MAX_HUNGER) >= REGEN_MIN_HUNGER;
  if (p.health <= 0 || p.health >= MAX_HEALTH || p.sinceHurt < REGEN_DELAY || !fed) {
    p.regen = 0;
    return false;
  }
  p.regen += dt;
  if (p.regen < REGEN_EVERY) return false;
  p.regen = 0;
  p.health = Math.min(MAX_HEALTH, p.health + 1);
  addExhaustion(p, REGEN_EXHAUSTION);
  return true;
}

export function sanitizeHealth(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_HEALTH ? value : MAX_HEALTH;
}

// ---------- 溺水 ----------
export const MAX_AIR = 10; // 10 个气泡
const AIR_SECONDS = 1.5; // 每个气泡能撑多久
const AIR_REFILL = 6; // 出水后每秒恢复几个气泡
const DROWN_EVERY = 1; // 没气以后每隔几秒掉一次血
export const DROWN_DAMAGE = 2;

/**
 * 更新氧气。返回这一步溺水造成的伤害（0 或 DROWN_DAMAGE）。
 */
export function updateAir(p, underwater, dt) {
  if (p.air === undefined) p.air = MAX_AIR;
  if (!underwater) {
    p.air = Math.min(MAX_AIR, p.air + dt * AIR_REFILL);
    p.drown = 0;
    return 0;
  }
  p.air = p.air - dt / AIR_SECONDS;
  if (p.air < 1e-6) p.air = 0; // 浮点误差
  if (p.air > 0) return 0;
  p.drown = (p.drown ?? 0) + dt;
  if (p.drown < DROWN_EVERY) return 0;
  p.drown -= DROWN_EVERY;
  return DROWN_DAMAGE;
}

// ---------- 饥饿 ----------
// 做事情会累积“体力消耗”，每满 4 点扣 1 点饱食度（半个鸡腿）。
export const MAX_HUNGER = 20; // 10 个鸡腿
const EXHAUSTION_PER_POINT = 4;
export const EXHAUSTION = {
  idle: 0.04, // 每秒，什么都不做也会慢慢饿
  sprint: 0.25, // 每秒
  swim: 0.1, // 每秒
  jump: 0.15, // 每次
  dig: 0.05, // 每挖一块
  attack: 0.1, // 每打一下
};
const STARVE_EVERY = 4; // 饿到 0 以后每隔几秒掉半颗心
const PEACEFUL_REFILL_EVERY = 2; // 和平模式下每隔几秒回 1 点饱食度

export function addExhaustion(p, amount) {
  p.exhaustion = (p.exhaustion ?? 0) + amount;
  while (p.exhaustion >= EXHAUSTION_PER_POINT) {
    p.exhaustion -= EXHAUSTION_PER_POINT;
    p.hunger = Math.max(0, (p.hunger ?? MAX_HUNGER) - 1);
  }
}

/**
 * 每帧更新饥饿。activity: { sprinting, swimming, jumps, peaceful }。
 * 返回这一步饿肚子造成的伤害（0 或 1）。
 */
export function updateHunger(p, dt, { sprinting = false, swimming = false, jumps = 0, peaceful = false } = {}) {
  if (p.hunger === undefined) p.hunger = MAX_HUNGER;
  if (peaceful) {
    // 和平：不会饿，还会慢慢吃饱
    p.exhaustion = 0;
    p.starve = 0;
    p.refill = (p.refill ?? 0) + dt;
    if (p.refill >= PEACEFUL_REFILL_EVERY) {
      p.refill = 0;
      p.hunger = Math.min(MAX_HUNGER, p.hunger + 1);
    }
    return 0;
  }
  let used = EXHAUSTION.idle * dt + EXHAUSTION.jump * jumps;
  if (sprinting) used += EXHAUSTION.sprint * dt;
  if (swimming) used += EXHAUSTION.swim * dt;
  addExhaustion(p, used);
  if (p.hunger > 0) {
    p.starve = 0;
    return 0;
  }
  p.starve = (p.starve ?? 0) + dt;
  if (p.starve < STARVE_EVERY) return 0;
  p.starve -= STARVE_EVERY;
  return 1;
}

export function sanitizeHunger(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_HUNGER ? value : MAX_HUNGER;
}
