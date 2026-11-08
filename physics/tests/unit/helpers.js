import { World } from '../../js/engine/world.js';
import { box } from '../../js/engine/shapes.js';

export function groundWorld(opts) {
  const world = new World(opts);
  const ground = world.createBody({ type: 'static' });
  ground.addFixture(box(50, 0.5, 0, -0.5), { friction: 0.6 });
  return { world, ground };
}

export function run(world, seconds, each) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    world.step(1 / 60);
    if (each && each(i) === false) return i;
  }
  return n;
}

export const close = (a, b, tol) => Math.abs(a - b) <= tol;
