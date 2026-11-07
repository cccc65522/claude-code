// 生命值和摔落伤害（只在生存模式生效）

export const MAX_HEALTH = 20; // 10 颗心，每颗 2 点
export const SAFE_FALL = 3; // 3 格以内摔下来不疼
const REGEN_DELAY = 6; // 受伤后多少秒开始回血
const REGEN_EVERY = 2.5; // 之后每隔多少秒回 1 点

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
  if (p.health <= 0 || p.health >= MAX_HEALTH || p.sinceHurt < REGEN_DELAY) {
    p.regen = 0;
    return false;
  }
  p.regen += dt;
  if (p.regen < REGEN_EVERY) return false;
  p.regen = 0;
  p.health = Math.min(MAX_HEALTH, p.health + 1);
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
