// Running a level: the start state is the level's scene plus the player's shapes and joints, serialised to
// JSON and rebuilt, so a run depends only on that JSON. The ball has to stay inside the goal for a second.

import { buildWorld, saveScene } from './scene.js';
import { collide, newManifold } from './collide.js';

export const HOLD_STEPS = 60; // 1 s inside the goal
export const DT = 1 / 60;

// Scene JSON for a run: level bodies first, then the player's bodies (indices shift by the level's count).
// Player joints refer to level bodies by index, to player bodies by 'u' + index, and to the background by −1.
export function levelScene(level, user = { bodies: [], joints: [] }) {
  const base = level.scene.bodies.length;
  const ref = r => (typeof r === 'string' && r[0] === 'u' ? base + Number(r.slice(1)) : r);
  const scene = {
    ...level.scene,
    bodies: [...level.scene.bodies, ...user.bodies],
    joints: [...(level.scene.joints || []), ...(user.joints || []).map(j => ({ ...j, a: ref(j.a), b: ref(j.b) }))]
  };
  const water = [...(level.scene.water || []), ...(user.water || [])];
  if (water.length) scene.water = water;
  return scene;
}

// The scene exactly as the app would save it (numbers rounded the same way), which is what a run starts from.
export function canonical(scene) {
  return saveScene(buildWorld(scene));
}

export function ballIndex(scene) {
  return scene.bodies.findIndex(b => b.tag === 'ball');
}

export function inGoal(level, ball) {
  const g = level.goal;
  return Math.abs(ball.x - g.x) <= g.w / 2 && Math.abs(ball.y - g.y) <= g.h / 2;
}

// A stepper usable both by the app (one step per frame) and by tests (run to the end).
export class LevelRun {
  constructor(level, scene) {
    this.level = level;
    this.world = buildWorld(scene);
    this.ball = this.world.bodies[ballIndex(scene)];
    this.steps = 0;
    this.held = 0;
    this.result = null; // 'won' | 'lost'
    this.limit = Math.round((level.time || 20) / DT);
  }

  step() {
    if (this.result) return this.result;
    this.world.step(DT);
    this.steps++;
    this.update();
    return this.result;
  }

  // Judge the current state (the app steps the world itself and calls this).
  update() {
    if (this.result) return this.result;
    if (inGoal(this.level, this.ball)) {
      if (++this.held >= HOLD_STEPS) this.result = 'won';
    } else this.held = 0;
    if (!this.result && (this.ball.y < (this.level.floor ?? -15) || this.steps >= this.limit)) this.result = 'lost';
    // everything has come to rest outside the goal: nothing more will happen
    if (!this.result && this.steps > 30 && this.held === 0 && this.world.stats.awake === 0 && this.world.fluid.maxSpeed < 0.3) this.result = 'lost';
    return this.result;
  }

  run() {
    while (!this.result) this.step();
    return { result: this.result, time: this.steps * DT, world: this.world };
  }
}

export function runLevel(level, user) {
  return new LevelRun(level, canonical(levelScene(level, user))).run();
}

// What the player has used so far (for the level's limits).
export function usage(world, level = null) {
  const u = { shapes: 0, pins: 0, motors: 0, ropes: 0, springs: 0, welds: 0 };
  u.water = world.fluid.n - (level?.scene.water ? level.scene.water.length / 4 : 0);
  for (const b of world.bodies) if (!b.locked && b.tag !== 'link') u.shapes++;
  for (const j of world.joints) {
    if (j.locked || !j.kind) continue;
    if (j.rope === 2) u.ropes++;
    else if (j.rope || j.kind === 'rope') continue;
    else if (j.kind === 'pin') u[j.enableMotor ? 'motors' : 'pins']++;
    else if (j.kind === 'spring') u.springs++;
    else if (j.kind === 'weld') u.welds++;
  }
  return u;
}

const scratch = newManifold();

// Why a new player shape can't go where it is (or null if it can): inside a no-draw zone, or overlapping
// something that belongs to the level. Overlapping the player's own shapes is fine (wheels on a car body).
export function placementProblem(world, body, level) {
  for (const f of body.fixtures) {
    for (const z of level.noDraw || []) {
      if (f.maxX > z.x - z.w / 2 && f.minX < z.x + z.w / 2 && f.maxY > z.y - z.h / 2 && f.minY < z.y + z.h / 2) return '不能画在斜线区域里';
    }
  }
  let hit = false;
  for (const f of body.fixtures) {
    world.queryBox(f.minX, f.minY, f.maxX, f.maxY, g => {
      if (g.body === body || !g.body.locked) return;
      collide(f, g, scratch, 0);
      for (let i = 0; i < scratch.count; i++) if (scratch.p[i].sep < -0.01) { hit = true; return false; }
    });
    if (hit) return '不能和关卡里的东西重叠';
  }
  return null;
}
