import { isLiquid } from './blocks.js';

// 玩家物理：一个 0.6 x 1.8 x 0.6 的盒子，分轴移动并和方块做碰撞。

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
const HALF = PLAYER_WIDTH / 2;
const GRAVITY = 28;
const JUMP_SPEED = 8.6;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 7.2;
const FLY_SPEED = 11;
const SWIM_SPEED = 3;
const SWIM_UP = 4.2;
const SINK_SPEED = 2.2;

export function createPlayer(position, yaw = 0, pitch = 0) {
  return {
    pos: [...position], // 脚底中心
    vel: [0, 0, 0],
    yaw,
    pitch,
    onGround: false,
    flying: false,
    inWater: false,
    fallStartY: null, // 开始往下掉时的高度，用来算摔落距离
    health: 20,
    hunger: 20, // 饱食度，0–20
    exhaustion: 0, // 消耗累计到 4 扣 1 点饱食度
    jumps: 0, // 跳了几次（算饥饿用，由调用的人清零）
    sinceHurt: 99, // 距离上次受伤的秒数
    regen: 0,
  };
}

// 身体（腰部）是否在水里
export function bodyInWater(world, p) {
  return isLiquid(world.get(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 0.6), Math.floor(p.pos[2])));
}

// 眼睛是否在水下（用来切换水下的画面）
export function eyeInWater(world, p) {
  return isLiquid(world.get(Math.floor(p.pos[0]), Math.floor(p.pos[1] + EYE_HEIGHT), Math.floor(p.pos[2])));
}

// 玩家盒子和某个方块格子是否重叠（放方块时用来防止把自己埋住）
export function overlapsBlock(player, bx, by, bz) {
  const [x, y, z] = player.pos;
  return (
    x + HALF > bx && x - HALF < bx + 1 &&
    y + PLAYER_HEIGHT > by && y < by + 1 &&
    z + HALF > bz && z - HALF < bz + 1
  );
}

// 身体尺寸：玩家用默认值，怪物等别的身体自己带 half / height
const halfOf = (b) => b.half ?? HALF;
const heightOf = (b) => b.height ?? PLAYER_HEIGHT;

function collides(world, pos, half, height) {
  const minX = Math.floor(pos[0] - half);
  const maxX = Math.floor(pos[0] + half - 1e-6);
  const minY = Math.floor(pos[1]);
  const maxY = Math.floor(pos[1] + height - 1e-6);
  const minZ = Math.floor(pos[2] - half);
  const maxZ = Math.floor(pos[2] + half - 1e-6);
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (world.isSolid(x, y, z)) return true;
      }
    }
  }
  return false;
}

// 沿一个轴移动，撞到方块就贴着方块停下
function moveAxis(world, p, axis, amount) {
  if (amount === 0) return false;
  const half = halfOf(p);
  const height = heightOf(p);
  p.pos[axis] += amount;
  if (!collides(world, p.pos, half, height)) return false;
  const size = axis === 1 ? height : half;
  if (amount > 0) {
    const edge = p.pos[axis] + size;
    p.pos[axis] = Math.floor(edge) - size - 1e-4;
  } else {
    const edge = axis === 1 ? p.pos[axis] : p.pos[axis] - half;
    p.pos[axis] = Math.floor(edge) + 1 + (axis === 1 ? 0 : half) + 1e-4;
  }
  // 推出去以后还卡着（例如出生在方块里），就退回原位
  if (collides(world, p.pos, half, height)) p.pos[axis] -= amount;
  p.vel[axis] = 0;
  return true;
}

/**
 * 不受玩家操作的身体（怪物）：重力、在水里往上浮、和方块碰撞。
 * 水平速度由调用的人设置。返回有没有撞到墙。
 */
export function moveBody(world, b, dt) {
  const steps = Math.ceil(dt / 0.02);
  const h = dt / steps;
  let hitWall = false;
  for (let i = 0; i < steps; i++) {
    const mid = Math.floor(b.pos[1] + heightOf(b) * 0.5);
    b.inWater = isLiquid(world.get(Math.floor(b.pos[0]), mid, Math.floor(b.pos[2])));
    if (b.inWater) b.vel[1] = Math.min(b.vel[1] + 14 * h, 2.5);
    else b.vel[1] = Math.max(b.vel[1] - GRAVITY * h, -50);
    if (moveAxis(world, b, 0, b.vel[0] * h)) hitWall = true;
    if (moveAxis(world, b, 2, b.vel[2] * h)) hitWall = true;
    const falling = b.vel[1] < 0;
    b.onGround = moveAxis(world, b, 1, b.vel[1] * h) && falling;
  }
  return hitWall;
}

/**
 * input: { forward, right（-1..1，摇杆或按键）, jump, down, sprint }
 * 返回这一帧落地时摔下来的高度（没落地是 0），用来算摔落伤害。
 */
export function stepPlayer(world, p, input, dt) {
  // 帧率很低时拆成小步，防止穿墙
  const steps = Math.ceil(dt / 0.02);
  const h = dt / steps;
  let landed = 0;
  for (let i = 0; i < steps; i++) landed = Math.max(landed, step(world, p, input, h));
  return landed;
}

function step(world, p, input, dt) {
  const y0 = p.pos[1]; // 这一步移动前的高度（从这里开始算掉落）
  p.inWater = !p.flying && bodyInWater(world, p);
  const speed = p.flying ? FLY_SPEED : p.inWater ? SWIM_SPEED : input.sprint ? SPRINT_SPEED : WALK_SPEED;
  let f = input.forward || 0;
  let r = input.right || 0;
  const mag = Math.hypot(f, r);
  if (mag > 1) {
    f /= mag;
    r /= mag;
  }
  // yaw = 0 时面朝 -z
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  const wantX = (-sin * f + cos * r) * speed;
  const wantZ = (-cos * f - sin * r) * speed;

  // 地上转向很快，空中稍微慢一点
  const accel = p.onGround || p.flying || p.inWater ? 1 : 0.25;
  const k = Math.min(1, dt * 18 * accel);
  p.vel[0] += (wantX - p.vel[0]) * k;
  p.vel[2] += (wantZ - p.vel[2]) * k;

  if (p.flying) {
    const wantY = ((input.jump ? 1 : 0) - (input.down ? 1 : 0)) * speed;
    p.vel[1] += (wantY - p.vel[1]) * Math.min(1, dt * 12);
  } else if (p.inWater) {
    // 水里：浮力很大，慢慢下沉；按跳往上游，按下蹲往下潜
    if (input.jump) p.vel[1] = Math.min(SWIM_UP, p.vel[1] + 20 * dt);
    else if (input.down) p.vel[1] = Math.max(-SWIM_UP, p.vel[1] - 20 * dt);
    else p.vel[1] = Math.max(-SINK_SPEED, p.vel[1] - 6 * dt);
  } else {
    if (input.jump && p.onGround) {
      p.vel[1] = JUMP_SPEED;
      p.onGround = false;
      p.jumps++;
    }
    p.vel[1] = Math.max(p.vel[1] - GRAVITY * dt, -50);
  }

  const hitX = moveAxis(world, p, 0, p.vel[0] * dt);
  const hitZ = moveAxis(world, p, 2, p.vel[2] * dt);
  // 在水里贴着岸边按跳，可以爬上岸
  if (p.inWater && input.jump && (hitX || hitZ)) p.vel[1] = Math.max(p.vel[1], 6.5);
  const falling = p.vel[1] < 0;
  const hitY = moveAxis(world, p, 1, p.vel[1] * dt);
  p.onGround = hitY && falling;
  if (p.onGround && p.flying) p.flying = false;

  // 记录掉落：飞行或者掉进水里就重新算，落地时返回掉了多高
  let landed = 0;
  if (p.flying || p.inWater || bodyInWater(world, p)) {
    p.fallStartY = null;
  } else if (p.onGround) {
    if (p.fallStartY !== null) landed = Math.max(0, p.fallStartY - p.pos[1]);
    p.fallStartY = null;
  } else {
    p.fallStartY = Math.max(p.fallStartY ?? y0, y0, p.pos[1]);
  }
  return landed;
}
