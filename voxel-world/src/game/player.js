import { WATER } from './blocks.js';

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
  };
}

// 身体（腰部）是否在水里
export function bodyInWater(world, p) {
  return world.get(Math.floor(p.pos[0]), Math.floor(p.pos[1] + 0.6), Math.floor(p.pos[2])) === WATER;
}

// 眼睛是否在水下（用来切换水下的画面）
export function eyeInWater(world, p) {
  return world.get(Math.floor(p.pos[0]), Math.floor(p.pos[1] + EYE_HEIGHT), Math.floor(p.pos[2])) === WATER;
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

function collides(world, pos) {
  const minX = Math.floor(pos[0] - HALF);
  const maxX = Math.floor(pos[0] + HALF - 1e-6);
  const minY = Math.floor(pos[1]);
  const maxY = Math.floor(pos[1] + PLAYER_HEIGHT - 1e-6);
  const minZ = Math.floor(pos[2] - HALF);
  const maxZ = Math.floor(pos[2] + HALF - 1e-6);
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
  p.pos[axis] += amount;
  if (!collides(world, p.pos)) return false;
  const size = axis === 1 ? PLAYER_HEIGHT : HALF;
  if (amount > 0) {
    const edge = p.pos[axis] + size;
    p.pos[axis] = Math.floor(edge) - size - 1e-4;
  } else {
    const edge = axis === 1 ? p.pos[axis] : p.pos[axis] - HALF;
    p.pos[axis] = Math.floor(edge) + 1 + (axis === 1 ? 0 : HALF) + 1e-4;
  }
  // 推出去以后还卡着（例如出生在方块里），就退回原位
  if (collides(world, p.pos)) p.pos[axis] -= amount;
  p.vel[axis] = 0;
  return true;
}

/**
 * input: { forward, right（-1..1，摇杆或按键）, jump, down, sprint }
 */
export function stepPlayer(world, p, input, dt) {
  // 帧率很低时拆成小步，防止穿墙
  const steps = Math.ceil(dt / 0.02);
  const h = dt / steps;
  for (let i = 0; i < steps; i++) step(world, p, input, h);
}

function step(world, p, input, dt) {
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
}
