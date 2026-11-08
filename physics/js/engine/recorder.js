// Records the state of every body each step so the simulation can be scrubbed backwards ("时光倒流").
// Memory is bounded: the number of frames kept shrinks as the number of bodies grows.

const FIELDS = 7; // x, y, angle, vx, vy, w, awake

export class Recorder {
  constructor({ maxFloats = 4e6, every = 2, maxFrames = 1800 } = {}) {
    this.maxFloats = maxFloats;
    this.every = every; // record one frame every N steps
    this.maxFrames = maxFrames;
    this.clear();
  }

  clear() {
    this.bodies = null;
    this.frames = [];
    this.times = [];
    this.tick = 0;
  }

  get length() {
    return this.frames.length;
  }

  capacity(n) {
    return Math.max(30, Math.min(this.maxFrames, Math.floor(this.maxFloats / Math.max(1, n * FIELDS))));
  }

  sameBodies(world) {
    const a = this.bodies, b = world.bodies;
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Call after each world step.
  record(world, force = false) {
    if (!this.sameBodies(world)) {
      this.clear();
      this.bodies = world.bodies.slice();
      force = true;
    }
    if (!force && ++this.tick % this.every !== 0) return;
    const n = this.bodies.length;
    const f = new Float32Array(n * FIELDS);
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i], k = i * FIELDS;
      f[k] = b.x; f[k + 1] = b.y; f[k + 2] = b.angle;
      f[k + 3] = b.vx; f[k + 4] = b.vy; f[k + 5] = b.w; f[k + 6] = b.awake ? 1 : 0;
    }
    this.frames.push(f);
    this.times.push(world.time);
    const cap = this.capacity(n);
    if (this.frames.length > cap) {
      this.frames.splice(0, this.frames.length - cap);
      this.times.splice(0, this.times.length - cap);
    }
  }

  // Put the world back to frame i. Contact and joint impulses are reset (they would be stale).
  restore(world, i) {
    const f = this.frames[i];
    if (!f || !this.sameBodies(world)) return false;
    for (let k = 0; k < this.bodies.length; k++) {
      const b = this.bodies[k], o = k * FIELDS;
      if (!b.isStatic) b.setTransform(f[o], f[o + 1], f[o + 2]);
    }
    // second pass: setTransform wakes neighbours, so the stored sleep state goes last
    for (let k = 0; k < this.bodies.length; k++) {
      const b = this.bodies[k], o = k * FIELDS;
      if (b.isStatic) continue;
      b.vx = f[o + 3]; b.vy = f[o + 4]; b.w = f[o + 5];
      b.awake = f[o + 6] === 1;
      b.sleepTime = 0;
    }
    for (const c of world.contacts) for (const p of c.m.p) { p.ni = 0; p.ti = 0; }
    for (const j of world.joints) {
      if (j.linearImpulse) j.linearImpulse.x = j.linearImpulse.y = 0;
      j.motorImpulse = j.lowerImpulse = j.upperImpulse = j.impulse = j.angularImpulse = 0;
    }
    world.time = this.times[i];
    return true;
  }

  // Forget everything after frame i (when the user resumes from the past).
  truncate(i) {
    this.frames.length = i + 1;
    this.times.length = i + 1;
  }
}
