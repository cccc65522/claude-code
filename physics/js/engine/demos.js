// Built-in demo scenes. Each one returns scene JSON plus a camera view {x, y, w} (centre and visible width, m).

import { SceneBuilder } from './build.js';
import { rng } from './math.js';

const RAINBOW = ['#ef6461', '#f39c4a', '#f7c948', '#8fcf5f', '#4cb7a5', '#4f9de0', '#7c74e0', '#c86fd0'];

function ground(b, w = 80, y = 0) {
  return b.box(0, y - 0.5, w, 1, { m: 'stone', fixed: true });
}

// A car: chassis with two motor-driven rubber wheels. Returns the chassis index.
export function car(b, x, y, { speed = -6, torque = 60, col = '#4f9de0' } = {}) {
  const chassis = b.poly([[x - 1.6, y], [x + 1.6, y], [x + 1.3, y + 0.5], [x + 0.2, y + 0.55], [x - 0.3, y + 1.0], [x - 1.2, y + 1.0], [x - 1.6, y + 0.5]], { m: 'wood', col });
  for (const dx of [-1.05, 1.05]) {
    const wheel = b.ball(x + dx, y - 0.05, 0.55, { m: 'rubber', col: '#3d4048' });
    b.pin(chassis, wheel, x + dx, y - 0.05, { motor: { s: speed, t: torque } });
  }
  return chassis;
}

function ragdoll(b, x, y, col) {
  const o = { m: 'wood', col };
  const torso = b.box(x, y + 1.0, 0.42, 0.75, o);
  const head = b.ball(x, y + 1.62, 0.24, o);
  b.pin(torso, head, x, y + 1.38, { lim: [-0.6, 0.6] });
  for (const side of [-1, 1]) {
    const ua = b.box(x + side * 0.3, y + 1.1, 0.14, 0.42, o);
    b.pin(torso, ua, x + side * 0.3, y + 1.3, { lim: [-2.6, 2.6] });
    const fa = b.box(x + side * 0.3, y + 0.72, 0.12, 0.4, o);
    b.pin(ua, fa, x + side * 0.3, y + 0.9, { lim: [-2.4, 0.1] });
    const th = b.box(x + side * 0.12, y + 0.4, 0.16, 0.5, o);
    b.pin(torso, th, x + side * 0.12, y + 0.63, { lim: [-1.8, 0.6] });
    const sh = b.box(x + side * 0.12, y - 0.08, 0.14, 0.48, o);
    b.pin(th, sh, x + side * 0.12, y + 0.15, { lim: [-0.1, 2.4] });
  }
  return torso;
}

export const DEMOS = [
  {
    id: 'tower',
    name: '拆楼',
    desc: '78 块积木的金字塔，左边吊着一个大铁球。按播放看它荡下来。',
    view: { x: -1, y: 8, w: 40, portrait: { x: -4, y: 8, w: 27 } },
    build() {
      const b = new SceneBuilder();
      ground(b);
      const rows = 12;
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < rows - r; i++) b.box(-3.5 + i + r * 0.5 + 0.5, 0.5 + r, 0.98, 1, { m: 'wood', col: RAINBOW[r % RAINBOW.length], sleep: true });
      }
      const ball = b.ball(-15.5, 17, 1.2, { m: 'metal' });
      b.rope(-1, -3, 17, ball, -14.3, 17, { link: 0.5, width: 0.12 });
      return b.scene();
    }
  },
  {
    id: 'domino',
    name: '多米诺',
    desc: '每块骨牌比前一块大 15%，最后一块有 6 米多高。小球滚下来推倒第一块。',
    view: { x: 1, y: 4, w: 36 },
    build() {
      const b = new SceneBuilder();
      ground(b);
      b.line([[-17, 5], [-15.5, 4.7], [-12.2, 0.75], [-10.4, 0.6]], 0.3, { fixed: true });
      b.ball(-16.3, 5.5, 0.35, { m: 'wood' });
      let x = -9.6, h = 0.8;
      for (let i = 0; i < 15; i++) {
        const w = h * 0.2;
        b.box(x, h / 2, w, h, { m: 'wood', col: RAINBOW[i % RAINBOW.length], sleep: true });
        x += h * 0.55;
        h *= 1.15;
      }
      return b.scene();
    }
  },
  {
    id: 'car',
    name: '小车',
    desc: '两个轮子装了马达。选中轮子上的马达可以改转速和方向。',
    view: { x: -6, y: 3, w: 34 },
    build() {
      const b = new SceneBuilder();
      b.line([[-24, 0], [-12, 0], [-8, 1.5], [-5, 0.6], [-1, 0.6], [3.5, 2.6], [4.5, 2.7]], 0.4, { fixed: true });
      b.line([[6.6, 1.7], [10, 0.4], [40, 0.4]], 0.4, { fixed: true });
      b.box(6.5, -1.5, 30, 1, { m: 'stone', fixed: true });
      car(b, -18, 1.0, { speed: -9 });
      for (let i = 0; i < 4; i++) for (let k = 0; k < 4 - i; k++) b.box(20 + k * 0.82 + i * 0.41, 1.0 + i * 0.8, 0.8, 0.8, { m: 'wood', sleep: true });
      return b.scene();
    }
  },
  {
    id: 'catapult',
    name: '跷跷板投石',
    desc: '铁块砸在跷跷板一头，另一头的石球被抛过头顶，砸向右边的木塔。',
    view: { x: 6, y: 6, w: 34 },
    build() {
      const b = new SceneBuilder();
      ground(b);
      const stand = b.poly([[-0.7, 0], [0.7, 0], [0, 1.6]], { m: 'stone', fixed: true });
      const angle = Math.asin(1.5 / 4);
      const c = Math.cos(angle), s = Math.sin(angle);
      const at = (lx, ly) => [lx * c - ly * s, 1.6 + lx * s + ly * c]; // plank-local → world
      // plank tilted with its left end on the ground
      const plank = b.box(0, 1.6, 8, 0.24, { m: 'wood', a: angle });
      b.pin(stand, plank, 0, 1.6);
      const [cx, cy] = at(-3.9, 0.37);
      const cup = b.box(cx, cy, 0.2, 0.5, { m: 'wood', a: angle });
      b.weld(plank, cup, ...at(-3.9, 0.12));
      const [bx, by] = at(-3.45, 0.45);
      b.ball(bx, by, 0.32, { m: 'stone' });
      b.box(at(3.3, 0)[0], 12, 1.4, 1.4, { m: 'metal' });
      // target: a tower on a platform
      b.box(16, 1.5, 3, 3, { m: 'stone', fixed: true });
      for (let i = 0; i < 7; i++) {
        b.box(15.4, 3.5 + i, 0.5, 1, { m: 'wood', col: RAINBOW[i], sleep: true });
        b.box(16.6, 3.5 + i, 0.5, 1, { m: 'wood', col: RAINBOW[(i + 3) % 8], sleep: true });
      }
      return b.scene();
    }
  },
  {
    id: 'bridge',
    name: '吊桥',
    desc: '木板用绳子连成吊桥，小车开过去，东西从天上掉下来。用橡皮擦掉一段桥试试。',
    view: { x: 0, y: 4, w: 34 },
    build() {
      const b = new SceneBuilder();
      const left = b.poly([[-24, -6], [-6, -6], [-6, 4], [-24, 4]], { m: 'stone', fixed: true });
      const right = b.poly([[6, -6], [24, -6], [24, 4], [6, 4]], { m: 'stone', fixed: true });
      b.box(0, -6.5, 60, 1, { m: 'stone', fixed: true });
      b.rope(left, -6, 3.9, right, 6, 3.9, { link: 0.8, width: 0.2, mat: 'wood', sag: 0.5 });
      car(b, -12, 5.0, { speed: -4, torque: 40, col: '#ef6461' });
      b.box(-2, 9, 1, 1, { m: 'wood' });
      b.ball(1, 12, 0.5, { m: 'metal' });
      b.box(3, 15, 1.2, 0.8, { m: 'stone' });
      b.ball(-1, 18, 0.7, { m: 'rubber' });
      return b.scene();
    }
  },
  {
    id: 'pendulums',
    name: '谐波摆',
    desc: '12 个单摆挂在同一点，摆长不同，周期正好排成等差。看它们散开、又在 40 秒后重新排成一条线。',
    view: { x: 0, y: 8.4, w: 6, h: 3.6 },
    build() {
      const b = new SceneBuilder();
      const px = 0, py = 9.5, theta = 0.45;
      b.ball(px, py, 0.12, { m: 'metal', fixed: true, col: '#5b6778' });
      for (let k = 0; k < 12; k++) {
        const T = 40 / (16 + k);
        const L = 10 * (T / (2 * Math.PI)) * (T / (2 * Math.PI));
        const x = px + L * Math.sin(theta), y = py - L * Math.cos(theta);
        const bob = b.ball(x, y, 0.13, { m: 'metal', col: RAINBOW[k % RAINBOW.length], grp: -2 });
        b.rod(-1, px, py, bob, x, y);
      }
      return b.scene();
    }
  },
  {
    id: 'ragdolls',
    name: '滚楼梯',
    desc: '三个关节带角度限制的布娃娃从楼梯上摔下去。',
    view: { x: 0, y: 5, w: 30 },
    build() {
      const b = new SceneBuilder();
      ground(b);
      const pts = [[-14, 0], [-14, 10]];
      let x = -14, y = 10;
      for (let i = 0; i < 9; i++) {
        x += 1.7;
        pts.push([x, y]);
        y -= 1;
        pts.push([x, y]);
      }
      pts.push([x, 0]);
      b.poly(pts.slice().reverse(), { m: 'stone', fixed: true });
      ragdoll(b, -13, 10.15, '#ef6461');
      ragdoll(b, -11.4, 9.15, '#4f9de0');
      ragdoll(b, -9.8, 8.15, '#8fcf5f');
      b.ball(-13.6, 12.5, 0.3, { m: 'metal', v: [6, 0] });
      return b.scene();
    }
  },
  {
    id: 'galton',
    name: '高尔顿板',
    desc: '300 颗小球穿过钉阵落进格子里，堆出正态分布的钟形。',
    view: { x: 0, y: 11.5, w: 11, h: 23 },
    build() {
      const b = new SceneBuilder();
      ground(b, 20);
      b.box(-4.6, 9, 0.2, 18, { m: 'stone', fixed: true });
      b.box(4.6, 9, 0.2, 18, { m: 'stone', fixed: true });
      b.line([[-4.5, 15.2], [-0.42, 12.4]], 0.16, { fixed: true });
      b.line([[4.5, 15.2], [0.42, 12.4]], 0.16, { fixed: true });
      const rows = 12, gap = 0.62;
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i <= r + 1; i++) {
          const x = (i - (r + 1) / 2) * gap;
          if (Math.abs(x) > 4.3) continue;
          b.ball(x, 11.7 - r * 0.56, 0.07, { m: 'stone', fixed: true, col: '#5b6778' });
        }
      }
      for (let k = -7; k <= 7; k++) b.box(k * gap, 2, 0.06, 4, { m: 'stone', fixed: true });
      const R = rng(4);
      let n = 0;
      for (let row = 0; row < 30 && n < 300; row++) {
        for (let i = 0; i < 14 && n < 300; i++) {
          const x = -3.25 + i * 0.5 + (row % 2) * 0.25, y = 15.5 + row * 0.33;
          if (Math.abs(x) > 4.2) continue;
          b.ball(x + (R() - 0.5) * 0.02, y, 0.11, { m: 'stone', col: RAINBOW[n % RAINBOW.length] });
          n++;
        }
      }
      return b.scene();
    }
  },
  {
    id: 'balloons',
    name: '气球',
    desc: '三个气球吊着木箱，一根绳子把箱子拴在地上。用橡皮擦断它。',
    view: { x: 0, y: 5.5, w: 18, h: 12 },
    build() {
      const b = new SceneBuilder();
      ground(b);
      const crate = b.box(0, 2.6, 1.6, 1.4, { m: 'wood' });
      const balloons = [[-2.2, 8.5], [0, 9.6], [2.2, 8.5]];
      for (const [x, y] of balloons) {
        const ball = b.ball(x, y, 0.9, { m: 'balloon', col: RAINBOW[(x + 3) | 0] });
        b.rope(crate, x * 0.3, 3.3, ball, x, y - 0.9, { link: 0.35, width: 0.05 });
      }
      b.rope(-1, 0, 0, crate, 0, 1.9, { link: 0.3, width: 0.06 });
      for (let i = 0; i < 5; i++) b.box(-7 + i * 0.25, 0.5 + i, 1, 1, { m: 'wood', col: RAINBOW[i] });
      return b.scene();
    }
  },
  {
    id: 'mixer',
    name: '搅拌机',
    desc: '马达带着十字转子，搅动 150 个各种材料的小东西。',
    view: { x: 0, y: 5, w: 18 },
    build() {
      const b = new SceneBuilder();
      ground(b);
      b.line([[-6, 9.5], [-6, 2], [-4.5, 0.6], [4.5, 0.6], [6, 2], [6, 9.5]], 0.3, { fixed: true });
      const r = 3.6, t = 0.18;
      const rotor = b.poly([[-r, -t], [-t, -t], [-t, -r], [t, -r], [t, -t], [r, -t], [r, t], [t, t], [t, r], [-t, r], [-t, t], [-r, t]].map(([x, y]) => [x, y + 4.6]), { m: 'metal' });
      b.pin(-1, rotor, 0, 4.6, { motor: { s: 1.2, t: 4000 } });
      const R = rng(9), mats = ['wood', 'rubber', 'ice', 'stone', 'metal'];
      for (let i = 0; i < 150; i++) {
        const x = -5 + (i % 15) * 0.7 + R() * 0.1, y = 9.5 + Math.floor(i / 15) * 0.7;
        const m = mats[i % mats.length], s = 0.18 + R() * 0.12;
        if (i % 3 === 0) b.ball(x, y, s, { m });
        else if (i % 3 === 1) b.box(x, y, 2 * s, 2 * s, { m, a: R() * 3 });
        else b.poly([[x - s, y - s], [x + s, y - s], [x, y + s]], { m });
      }
      return b.scene();
    }
  }
];

// A wheel with six paddles (one concave outline, cut into convex pieces by the engine).
function paddleWheel(b, cx, cy, L, t, opt) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3, c = Math.cos(a), s = Math.sin(a);
    pts.push([cx + L * c + t * s, cy + L * s - t * c], [cx + L * c - t * s, cy + L * s + t * c]);
    const m = a + Math.PI / 6;
    pts.push([cx + 2 * t * Math.cos(m), cy + 2 * t * Math.sin(m)]);
  }
  return b.poly(pts, opt);
}

DEMOS.push(
  {
    id: 'dam',
    name: '决堤',
    desc: '一大块水突然放开，冲向下游的木头小屋。木头会浮起来，石头沉底。',
    view: { x: 0, y: 3.5, w: 21, h: 9 },
    build() {
      const b = new SceneBuilder();
      b.line([[-9.6, 7], [-9.6, 0], [9.6, 0], [9.6, 4]], 0.4, { fixed: true });
      b.water(-9.4, 0.2, -5.6, 4.8);
      for (let r = 0; r < 3; r++) for (let i = 0; i < 3 - r; i++) b.box(3 + i * 0.85 + r * 0.42, 0.62 + r * 0.82, 0.8, 0.8, { m: 'wood', col: RAINBOW[(r + i) % 8], sleep: true });
      b.box(6.8, 0.75, 0.9, 1.1, { m: 'stone', sleep: true });
      b.poly([[-1.6, 0.2], [0.6, 0.2], [1, 0.75], [-2, 0.75]], { m: 'wood', col: '#c86fd0', sleep: true });
      b.ball(-3.5, 0.6, 0.4, { m: 'rubber', sleep: true });
      return b.scene();
    }
  },
  {
    id: 'waterwheel',
    name: '水车',
    desc: '水从上面的水箱流下来，冲着水车转。水车的轴是一个能自由转动的钉子。',
    view: { x: 0, y: 5.5, w: 16, h: 12 },
    build() {
      const b = new SceneBuilder();
      b.line([[-5.2, 12], [-5.2, 8.6], [0.7, 7.4]], 0.24, { fixed: true });
      b.line([[1.7, 7.4], [1.7, 12]], 0.24, { fixed: true });
      b.water(-5, 8.8, 1.55, 11.2);
      const wheel = paddleWheel(b, 0, 4, 2.4, 0.13, { m: 'wood', col: '#c98a4b', grp: -3 }); // same group as the axle: they don't collide
      b.pin(-1, wheel, 0, 4);
      b.ball(0, 4, 0.12, { m: 'metal', fixed: true, col: '#5b6778', grp: -3 });
      b.line([[-6.5, 1.8], [-6.5, 0], [6.5, 0], [6.5, 1.8]], 0.3, { fixed: true });
      return b.scene();
    }
  }
);

export const demo = id => DEMOS.find(d => d.id === id);
