// Challenge levels. Each level is a scene of locked objects with one ball (tag 'ball'); the player adds a few
// shapes and joints so that the ball ends up inside the goal for a second.
//
// Every level ships with a reference solution. The unit tests run each solution through the physics engine and
// check it wins, check that doing nothing loses, and check that nudging the solution a little still wins. Because
// the engine is deterministic across browsers, a solution that passes in Node passes on an iPhone too.
//
// tools: which tools are available. limits: {shapes, pins, motors, ropes, springs, welds}.

import { SceneBuilder, ropePieces, localOf } from './build.js';

const BALL = { m: 'wood', col: '#e5484d', tag: 'ball', lock: true };
const L = { lock: true };
const S = { lock: true, fixed: true, m: 'stone' };

// Player shapes for solutions, written like the editor creates them.
const user = () => new SceneBuilder();

// A rope in a solution, the same way the rope tool makes one. a, b: level body index, 'uN' for the player's
// N-th body, or −1 for the background.
function userRope(scene, u, joints, a, p1, b, p2) {
  const spec = r => (r === -1 ? null : typeof r === 'string' ? u.bodies[Number(r.slice(1))] : scene.bodies[r]);
  const pieces = ropePieces(p1, p2);
  const base = u.bodies.length;
  const rid = 1 + joints.filter(j => j.t === 'rope').length;
  for (const s of pieces.bodies) { s.rid = rid; u.bodies.push(s); }
  const ref = r => (r === 'start' ? a : r === 'end' ? b : 'u' + (base + r));
  for (const j of pieces.joints) {
    const A = ref(j.a), B = ref(j.b);
    if (j.t === 'pin') {
      joints.push({ t: 'pin', a: A, b: B, la: localOf(spec(A), j.p.x, j.p.y), lb: localOf(spec(B), j.p.x, j.p.y), ref: Math.round(((spec(B)?.a || 0) - (spec(A)?.a || 0)) * 1e4) / 1e4, rope: j.rope });
    } else {
      joints.push({ t: 'rope', a: A, b: B, la: localOf(spec(A), j.pa.x, j.pa.y), lb: localOf(spec(B), j.pb.x, j.pb.y), len: j.len, rid });
    }
  }
}

export const LEVELS = [
  {
    id: 'bridge',
    name: '搭桥',
    hint: '小球会从坡上滚下来，掉进坑里。画一块木板搭在坑上。',
    tools: ['draw', 'box'],
    limits: { shapes: 2 },
    time: 15,
    view: { x: -1.5, y: 3, w: 22, h: 8 },
    goal: { x: 6, y: 2.4, w: 2.4, h: 1.6 },
    noDraw: [{ x: -7.5, y: 5.5, w: 7, h: 5 }, { x: 5.5, y: 3, w: 5, h: 3 }],
    build() {
      const b = new SceneBuilder();
      b.poly([[-12, -6], [-2, -6], [-2, 2], [-4, 2], [-9, 5], [-12, 5]], S);
      b.poly([[1.5, -6], [8.5, -6], [8.5, 4], [7.5, 4], [7.5, 1.6], [1.5, 2]], S);
      b.ball(-8.7, 5.55, 0.35, BALL);
      return b.scene();
    },
    solution() {
      const u = user();
      u.line([[-2.6, 2.25], [2.2, 2.25]], 0.2, { m: 'wood' });
      return { bodies: u.bodies, joints: [] };
    }
  },
  {
    id: 'stop',
    name: '刹车',
    hint: '这次是个铁球，平台又是冰做的。放一个够重的东西挡住它——试试别的材料。',
    tools: ['box', 'circle', 'draw'],
    limits: { shapes: 1 },
    time: 15,
    view: { x: -2, y: 3.5, w: 22, h: 9 },
    goal: { x: 5.2, y: 1.8, w: 3.6, h: 1.6 },
    noDraw: [{ x: -6, y: 6, w: 10, h: 8 }, { x: 9.5, y: 3, w: 5, h: 10 }],
    build() {
      const b = new SceneBuilder();
      b.poly([[-12, -4], [-1, -4], [-1, 1], [-11, 7], [-12, 7]], S);
      b.box(3.5, -1.5, 9, 5, { ...S, m: 'ice' });
      b.ball(-10.4, 7.0, 0.4, { ...BALL, m: 'metal' });
      return b.scene();
    },
    solution() {
      const u = user();
      u.box(6.2, 2.0, 1.2, 1.4, { m: 'metal' });
      return { bodies: u.bodies, joints: [] };
    }
  },
  {
    id: 'seesaw',
    name: '跷跷板',
    hint: '在跷跷板翘起的那头上方画一个重东西，让它砸下去，把小球抛上右边的高台。',
    tools: ['box', 'circle', 'draw'],
    limits: { shapes: 1 },
    time: 15,
    view: { x: 6, y: 5, w: 22, h: 11 },
    goal: { x: 11.6, y: 4.9, w: 5.4, h: 1.8 },
    noDraw: [{ x: -2, y: 2.5, w: 3, h: 5 }, { x: 11.5, y: 6, w: 8, h: 8 }],
    build() {
      const b = new SceneBuilder();
      b.box(0, -0.5, 60, 1, S);
      const stand = b.poly([[-0.6, 0], [0.6, 0], [0, 1.3]], S);
      const th = Math.asin(1.3 / 3.05), c = Math.cos(th), s = Math.sin(th);
      const at = (lx, ly) => [lx * c - ly * s, 1.4 + lx * s + ly * c];
      const plank = b.box(0, 1.4, 6, 0.2, { ...L, m: 'wood', a: th });
      b.pin(stand, plank, 0, 1.4);
      const [sx, sy] = at(-2.9, 0.35);
      const stop = b.box(sx, sy, 0.2, 0.5, { ...L, m: 'wood', a: th });
      b.weld(plank, stop, ...at(-2.9, 0.1));
      const [bx, by] = at(-2.45, 0.46);
      b.ball(bx, by, 0.35, BALL);
      b.poly([[8.5, 0], [14.5, 0], [14.5, 4], [8.5, 4]], S);
      b.box(14.9, 4, 0.8, 8, S);
      return b.scene();
    },
    solution() {
      const u = user();
      u.box(2.4, 8.5, 1.2, 1.2, { m: 'metal' });
      return { bodies: u.bodies, joints: [] };
    }
  },
  {
    id: 'domino',
    name: '多米诺',
    hint: '推倒第一块骨牌，最后一块会把小球推下台子。在左边的坡上画个能滚的东西。',
    tools: ['circle', 'box', 'draw'],
    limits: { shapes: 1 },
    time: 15,
    view: { x: -4, y: 3.5, w: 16, h: 8 },
    goal: { x: 1.5, y: 0.8, w: 2.2, h: 1.4 },
    noDraw: [{ x: -2.8, y: 5, w: 6.4, h: 4 }, { x: 2, y: 2.5, w: 4, h: 5 }],
    build() {
      const b = new SceneBuilder();
      b.box(0, -0.5, 40, 1, S);
      b.poly([[-11, 0], [0.3, 0], [0.3, 3], [-6.2, 3], [-6.2, 4.3], [-9, 6], [-11, 6]], S);
      for (let i = 0; i < 6; i++) b.box(-5.5 + i * 0.8, 3.7, 0.25, 1.4, { ...L, m: 'wood', col: ['#4f9de0', '#4cb7a5', '#8fcf5f', '#f7c948', '#f39c4a', '#c86fd0'][i] });
      b.box(-0.55, 3.4, 0.3, 0.8, S);
      b.ball(-0.55, 4.15, 0.35, BALL);
      b.box(5, -0.5, 14, 1, S);
      b.line([[0.4, 0.1], [2.8, 0.1], [2.9, 1.8]], 0.2, S);
      return b.scene();
    },
    solution() {
      const u = user();
      u.ball(-8.4, 6.6, 0.4, { m: 'stone' });
      return { bodies: u.bodies, joints: [] };
    }
  },
  {
    id: 'balloon',
    name: '升空',
    hint: '画一个气球材料的圆，再用绳子把它和小球连起来。',
    tools: ['circle', 'draw', 'rope'],
    limits: { shapes: 1, ropes: 1 },
    time: 15,
    view: { x: 0, y: 5.3, w: 10, h: 12 },
    goal: { x: 0, y: 8.5, w: 3.6, h: 3.4 },
    noDraw: [{ x: 0, y: 9.5, w: 4.6, h: 2.6 }],
    build() {
      const b = new SceneBuilder();
      b.box(0, -0.5, 30, 1, S);
      b.box(-1.5, 1, 0.4, 2, S);
      b.box(1.5, 1, 0.4, 2, S);
      b.line([[-2, 8.6], [-2, 10.6], [2, 10.6], [2, 8.6]], 0.3, S);
      b.ball(0, 0.35, 0.35, BALL);
      return b.scene();
    },
    solution() {
      const u = user(), joints = [];
      u.ball(0, 2.6, 0.9, { m: 'balloon' });
      userRope(this.scene, u, joints, 4, { x: 0, y: 0.68 }, 'u0', { x: 0, y: 1.72 });
      return { bodies: u.bodies, joints };
    }
  },
  {
    id: 'nails',
    name: '钉住',
    hint: '小球会直直掉下去。画一条斜坡，用两颗钉子把它钉在背景上。',
    tools: ['draw', 'box', 'pin'],
    limits: { shapes: 1, pins: 2 },
    time: 15,
    view: { x: 0.5, y: 5.5, w: 19, h: 14 },
    goal: { x: 6.4, y: 0, w: 2.8, h: 1.4 },
    noDraw: [{ x: -6.4, y: 9.5, w: 2.4, h: 4 }, { x: 4, y: 1.5, w: 10, h: 3 }],
    build() {
      const b = new SceneBuilder();
      b.poly([[-3, -2], [8.6, -2], [8.6, 2.4], [7.8, 2.4], [7.8, -0.7], [5, -0.7], [5, 0], [-3, 0]], S);
      b.box(-7.1, 10, 0.2, 3, S);
      b.box(-5.7, 10, 0.2, 3, S);
      b.ball(-6.4, 10.6, 0.35, BALL);
      return b.scene();
    },
    solution() {
      const u = user();
      const ramp = u.line([[-7.4, 7.2], [-1.6, 3.4]], 0.2, { m: 'wood' });
      const s = u.bodies[ramp];
      const joints = [[-6.6, 6.67], [-2.4, 3.92]].map(([x, y]) => ({ t: 'pin', a: -1, b: 'u0', la: localOf(null, x, y), lb: localOf(s, x, y), ref: 0 }));
      return { bodies: u.bodies, joints };
    }
  },
  {
    id: 'car',
    name: '造车',
    hint: '画车身和两个轮子（轮子和车身要叠在一起），再用马达工具点轮子中心。车头做低一点，不然车会从球上压过去。',
    tools: ['box', 'circle', 'draw', 'motor'],
    limits: { shapes: 4, motors: 2 },
    time: 20,
    view: { x: 0, y: 0.5, w: 25, h: 8 },
    goal: { x: 9.6, y: -1.0, w: 2.8, h: 2.0 },
    noDraw: [{ x: 5.5, y: 3, w: 14, h: 8 }],
    build() {
      const b = new SceneBuilder();
      b.poly([[-12, -3], [8.2, -3], [8.2, 0], [-12, 0]], S);
      b.box(9.6, -2.5, 3, 1, S);
      b.box(11.3, -0.5, 0.4, 5, S);
      b.ball(0, 0.4, 0.4, BALL);
      return b.scene();
    },
    solution() {
      const u = user();
      // a chassis with a low bumper in front, so the car pushes the ball instead of climbing over it
      const chassis = u.poly([[-5.4, 0.35], [-2.4, 0.35], [-2.4, 0.1], [-2.0, 0.1], [-2.0, 1.0], [-5.4, 0.85]], { m: 'wood' });
      const w1 = u.ball(-4.6, 0.5, 0.5, { m: 'rubber' });
      const w2 = u.ball(-3.0, 0.5, 0.5, { m: 'rubber' });
      const joints = [w1, w2].map(w => ({ t: 'pin', a: 'u' + chassis, b: 'u' + w, la: localOf(u.bodies[chassis], u.bodies[w].x, 0.5), lb: [0, 0], ref: 0, motor: { s: -6, t: 60 } }));
      return { bodies: u.bodies, joints };
    }
  },
  {
    id: 'trampoline',
    name: '蹦床',
    hint: '画一块向右下斜的板，用两根弹簧把它吊在背景上，让小球弹过墙。木头弹不高，试试橡胶。',
    tools: ['draw', 'box', 'spring'],
    limits: { shapes: 1, springs: 2 },
    time: 15,
    view: { x: 1, y: 6.5, w: 16, h: 14 },
    goal: { x: 3.8, y: 0.8, w: 6.4, h: 1.6 },
    noDraw: [{ x: 3.5, y: 5, w: 9, h: 12 }, { x: -4, y: 11.5, w: 2, h: 3.4 }],
    build() {
      const b = new SceneBuilder();
      b.box(-0.5, -0.5, 18, 1, S);
      b.box(0, 1.3, 0.4, 2.6, S);
      b.box(7.2, 3, 0.4, 6, S);
      b.box(-4.7, 11.5, 0.2, 3, S);
      b.box(-3.3, 11.5, 0.2, 3, S);
      b.ball(-4, 12, 0.35, BALL);
      return b.scene();
    },
    solution() {
      const u = user();
      const p = u.line([[-5.5, 3.6], [-2.5, 2.4]], 0.2, { m: 'rubber' });
      const s = u.bodies[p];
      const joints = [[-4.9, 3.36], [-3.1, 2.64]].map(([x, y]) => ({ t: 'spring', a: -1, b: 'u0', la: localOf(null, x, y + 2.5), lb: localOf(s, x, y), len: 2.5, hz: 3, z: 0.1 }));
      return { bodies: u.bodies, joints };
    }
  },
  {
    id: 'pendulum',
    name: '摆锤',
    hint: '在左上方画一个重物，用绳子把它挂到小球上方的背景上。松手后它会荡下来撞球。',
    tools: ['circle', 'box', 'draw', 'rope'],
    limits: { shapes: 1, ropes: 1 },
    time: 15,
    view: { x: 2, y: 5, w: 16, h: 11 },
    goal: { x: 6.4, y: 0.9, w: 3.2, h: 1.8 },
    noDraw: [{ x: 4, y: 4.2, w: 9, h: 8.4 }],
    build() {
      const b = new SceneBuilder();
      b.box(0, -0.5, 30, 1, S);
      b.box(2.2, 1.6, 2.4, 3.2, S);
      b.ball(2.6, 3.55, 0.35, BALL);
      b.line([[8.2, 2.4], [8.1, 0.1]], 0.2, S);
      return b.scene();
    },
    solution() {
      const u = user(), joints = [];
      u.ball(-3.0, 8.6, 0.6, { m: 'metal' });
      userRope(this.scene, u, joints, -1, { x: 1.6, y: 8.6 }, 'u0', { x: -2.4, y: 8.6 });
      return { bodies: u.bodies, joints };
    }
  }
];

function prepare(l) {
  if (!l.scene) {
    l.scene = l.build();
    for (const j of l.scene.joints) j.lock = true;
    for (const b of l.scene.bodies) b.lock = true;
  }
  return l;
}

export const level = id => {
  const l = LEVELS.find(x => x.id === id);
  return l ? prepare(l) : null;
};

export function allLevels() {
  return LEVELS.map(prepare);
}

