// Joints, solved with the same soft-step scheme as contacts: each substep warm-starts with the accumulated
// impulse, solves velocities with a soft position-error bias, and a relax pass solves again without bias.
// Anchors are kept relative to the body's centre of mass and rotated by the body's rotation since the start
// of the step, so position error is measured exactly without recomputing transforms.
//
// Bodies used here expose: invMass, invI, vx, vy, w, cx, cy, c0x, c0y (centre at step start), c, s (rotation),
// dqc, dqs (rotation since the start of the step), angle, lcx, lcy (local centre of mass).

import { makeSoft, solve22, clamp } from './math.js';

const tmp = { x: 0, y: 0 };

// Local anchor (relative to the body origin) → anchor relative to the centre of mass, in world orientation.
function anchor(b, lx, ly, out) {
  const x = lx - b.lcx, y = ly - b.lcy;
  out.x = b.c * x - b.s * y;
  out.y = b.s * x + b.c * y;
}

class Joint {
  constructor(type, def) {
    this.type = type;
    this.bodyA = def.bodyA;
    this.bodyB = def.bodyB;
    this.collideConnected = !!def.collideConnected;
    this.userData = def.userData ?? null;
    this.rA = { x: 0, y: 0 };
    this.rB = { x: 0, y: 0 };
    this.dcx = 0; // centre B − centre A at the start of the step
    this.dcy = 0;
    this.id = 0;
  }

  // Current anchors (rotated by the rotation since the start of the step).
  currentAnchors(cur) {
    const A = this.bodyA, B = this.bodyB, rA = this.rA, rB = this.rB;
    cur.ax = A.dqc * rA.x - A.dqs * rA.y;
    cur.ay = A.dqs * rA.x + A.dqc * rA.y;
    cur.bx = B.dqc * rB.x - B.dqs * rB.y;
    cur.by = B.dqs * rB.x + B.dqc * rB.y;
  }

  prepareAnchors() {
    const A = this.bodyA, B = this.bodyB;
    anchor(A, this.localA.x, this.localA.y, this.rA);
    anchor(B, this.localB.x, this.localB.y, this.rB);
    this.dcx = B.cx - A.cx;
    this.dcy = B.cy - A.cy;
  }

  // World positions of the anchors (for drawing and the editor).
  worldAnchorA(out = {}) {
    const b = this.bodyA, l = this.localA;
    out.x = b.x + b.c * l.x - b.s * l.y;
    out.y = b.y + b.s * l.x + b.c * l.y;
    return out;
  }
  worldAnchorB(out = {}) {
    const b = this.bodyB, l = this.localB;
    out.x = b.x + b.c * l.x - b.s * l.y;
    out.y = b.y + b.s * l.x + b.c * l.y;
    return out;
  }
}

const cur = { ax: 0, ay: 0, bx: 0, by: 0 };

// Pin two bodies together at a point; optional motor and angle limits.
export class RevoluteJoint extends Joint {
  constructor(def) {
    super('revolute', def);
    this.localA = { ...def.localA };
    this.localB = { ...def.localB };
    this.referenceAngle = def.referenceAngle ?? this.bodyB.angle - this.bodyA.angle;
    this.enableMotor = !!def.enableMotor;
    this.motorSpeed = def.motorSpeed ?? 0;
    this.maxMotorTorque = def.maxMotorTorque ?? 0;
    this.enableLimit = !!def.enableLimit;
    this.lower = def.lower ?? 0;
    this.upper = def.upper ?? 0;
    this.linearImpulse = { x: 0, y: 0 };
    this.motorImpulse = 0;
    this.lowerImpulse = 0;
    this.upperImpulse = 0;
    this.axialMass = 0;
  }

  prepare(ctx) {
    this.prepareAnchors();
    const k = this.bodyA.invI + this.bodyB.invI;
    this.axialMass = k > 0 ? 1 / k : 0;
    if (!this.enableMotor) this.motorImpulse = 0;
    if (!this.enableLimit) this.lowerImpulse = this.upperImpulse = 0;
  }

  warmStart() {
    const A = this.bodyA, B = this.bodyB;
    this.currentAnchors(cur);
    const P = this.linearImpulse;
    const axial = this.motorImpulse + this.lowerImpulse - this.upperImpulse;
    A.vx -= A.invMass * P.x; A.vy -= A.invMass * P.y;
    A.w -= A.invI * (cur.ax * P.y - cur.ay * P.x + axial);
    B.vx += B.invMass * P.x; B.vy += B.invMass * P.y;
    B.w += B.invI * (cur.bx * P.y - cur.by * P.x + axial);
  }

  solve(ctx, useBias) {
    const A = this.bodyA, B = this.bodyB;
    const mA = A.invMass, mB = B.invMass, iA = A.invI, iB = B.invI;
    const fixedRotation = iA + iB === 0;
    const soft = ctx.jointSoft;

    if (this.enableMotor && !fixedRotation) {
      const Cdot = B.w - A.w - this.motorSpeed;
      let impulse = -this.axialMass * Cdot;
      const old = this.motorImpulse, max = ctx.h * this.maxMotorTorque;
      this.motorImpulse = clamp(old + impulse, -max, max);
      impulse = this.motorImpulse - old;
      A.w -= iA * impulse;
      B.w += iB * impulse;
    }

    if (this.enableLimit && !fixedRotation) {
      const angle = B.angle - A.angle - this.referenceAngle;
      for (let side = 0; side < 2; side++) {
        const C = side === 0 ? angle - this.lower : this.upper - angle;
        let bias = 0, ms = 1, is = 0;
        if (C > 0) bias = C * ctx.inv_h;
        else if (useBias) { bias = soft.biasRate * C; ms = soft.massScale; is = soft.impulseScale; }
        const Cdot = side === 0 ? B.w - A.w : A.w - B.w;
        const acc = side === 0 ? this.lowerImpulse : this.upperImpulse;
        let impulse = -this.axialMass * ms * (Cdot + bias) - is * acc;
        const next = Math.max(acc + impulse, 0);
        impulse = next - acc;
        if (side === 0) { this.lowerImpulse = next; A.w -= iA * impulse; B.w += iB * impulse; }
        else { this.upperImpulse = next; A.w += iA * impulse; B.w -= iB * impulse; }
      }
    }

    this.currentAnchors(cur);
    const { ax, ay, bx, by } = cur;
    const cdx = B.vx - B.w * by - A.vx + A.w * ay;
    const cdy = B.vy + B.w * bx - A.vy - A.w * ax;
    let biasX = 0, biasY = 0, ms = 1, is = 0;
    if (useBias) {
      const sx = (B.cx - B.c0x) - (A.cx - A.c0x) + bx - ax + this.dcx;
      const sy = (B.cy - B.c0y) - (A.cy - A.c0y) + by - ay + this.dcy;
      biasX = soft.biasRate * sx; biasY = soft.biasRate * sy;
      ms = soft.massScale; is = soft.impulseScale;
    }
    const k11 = mA + mB + ay * ay * iA + by * by * iB;
    const k12 = -ay * ax * iA - by * bx * iB;
    const k22 = mA + mB + ax * ax * iA + bx * bx * iB;
    solve22(k11, k12, k22, cdx + biasX, cdy + biasY, tmp);
    const P = this.linearImpulse;
    const px = -ms * tmp.x - is * P.x, py = -ms * tmp.y - is * P.y;
    P.x += px; P.y += py;
    A.vx -= mA * px; A.vy -= mA * py; A.w -= iA * (ax * py - ay * px);
    B.vx += mB * px; B.vy += mB * py; B.w += iB * (bx * py - by * px);
  }

  jointAngle() {
    return this.bodyB.angle - this.bodyA.angle - this.referenceAngle;
  }
}

// Keeps two anchor points at a distance: rigid rod, spring (hertz > 0), or rope (only a maximum length).
export class DistanceJoint extends Joint {
  constructor(def) {
    super('distance', def);
    this.localA = { ...def.localA };
    this.localB = { ...def.localB };
    this.length = Math.max(def.length, 0.01);
    this.minLength = def.minLength ?? this.length;
    this.maxLength = def.maxLength ?? this.length;
    this.hertz = def.hertz ?? 0;
    this.dampingRatio = def.dampingRatio ?? 0;
    this.impulse = 0;
    this.lowerImpulse = 0;
    this.upperImpulse = 0;
    this.axialMass = 0;
    this.springSoft = null;
  }

  get spring() {
    return this.hertz > 0;
  }

  prepare(ctx) {
    this.prepareAnchors();
    const A = this.bodyA, B = this.bodyB, rA = this.rA, rB = this.rB;
    let dx = this.dcx + rB.x - rA.x, dy = this.dcy + rB.y - rA.y;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l > 1e-9) { dx /= l; dy /= l; } else { dx = 0; dy = 1; }
    const crA = rA.x * dy - rA.y * dx, crB = rB.x * dy - rB.y * dx;
    const k = A.invMass + B.invMass + A.invI * crA * crA + B.invI * crB * crB;
    this.axialMass = k > 0 ? 1 / k : 0;
    this.springSoft = makeSoft(this.hertz, this.dampingRatio, ctx.h);
    if (!this.spring) this.impulse = this.minLength < this.maxLength ? 0 : this.impulse;
  }

  warmStart() {
    const A = this.bodyA, B = this.bodyB;
    this.currentAnchors(cur);
    let dx = (B.cx - B.c0x) - (A.cx - A.c0x) + this.dcx + cur.bx - cur.ax;
    let dy = (B.cy - B.c0y) - (A.cy - A.c0y) + this.dcy + cur.by - cur.ay;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l > 1e-9) { dx /= l; dy /= l; } else { dx = 0; dy = 1; }
    const total = this.impulse + this.lowerImpulse - this.upperImpulse;
    const px = total * dx, py = total * dy;
    A.vx -= A.invMass * px; A.vy -= A.invMass * py; A.w -= A.invI * (cur.ax * py - cur.ay * px);
    B.vx += B.invMass * px; B.vy += B.invMass * py; B.w += B.invI * (cur.bx * py - cur.by * px);
  }

  apply(A, B, impulse, nx, ny) {
    const px = impulse * nx, py = impulse * ny;
    A.vx -= A.invMass * px; A.vy -= A.invMass * py; A.w -= A.invI * (cur.ax * py - cur.ay * px);
    B.vx += B.invMass * px; B.vy += B.invMass * py; B.w += B.invI * (cur.bx * py - cur.by * px);
  }

  solve(ctx, useBias) {
    const A = this.bodyA, B = this.bodyB;
    this.currentAnchors(cur);
    let dx = (B.cx - B.c0x) - (A.cx - A.c0x) + this.dcx + cur.bx - cur.ax;
    let dy = (B.cy - B.c0y) - (A.cy - A.c0y) + this.dcy + cur.by - cur.ay;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 1e-9) { dx /= length; dy /= length; } else { dx = 0; dy = 1; }
    const relVel = () => (B.vx - B.w * cur.by - A.vx + A.w * cur.ay) * dx + (B.vy + B.w * cur.bx - A.vy - A.w * cur.ax) * dy;
    const soft = ctx.jointSoft;

    if (this.minLength < this.maxLength) {
      if (this.spring) {
        // a physical spring: always applied, not just as error correction
        const C = length - this.length;
        const s = this.springSoft;
        const impulse = -s.massScale * this.axialMass * (relVel() + s.biasRate * C) - s.impulseScale * this.impulse;
        this.impulse += impulse;
        this.apply(A, B, impulse, dx, dy);
      }
      // lower and upper limits (a rope only has the upper one in practice)
      for (let side = 0; side < 2; side++) {
        const C = side === 0 ? length - this.minLength : this.maxLength - length;
        let bias = 0, ms = 1, is = 0;
        if (C > 0) bias = C * ctx.inv_h;
        else if (useBias) { bias = soft.biasRate * C; ms = soft.massScale; is = soft.impulseScale; }
        const vr = side === 0 ? relVel() : -relVel();
        const acc = side === 0 ? this.lowerImpulse : this.upperImpulse;
        let impulse = -ms * this.axialMass * (vr + bias) - is * acc;
        const next = Math.max(0, acc + impulse);
        impulse = next - acc;
        if (side === 0) { this.lowerImpulse = next; this.apply(A, B, impulse, dx, dy); }
        else { this.upperImpulse = next; this.apply(A, B, -impulse, dx, dy); }
      }
    } else {
      const C = length - this.length;
      let bias = 0, ms = 1, is = 0;
      if (useBias) { bias = soft.biasRate * C; ms = soft.massScale; is = soft.impulseScale; }
      const impulse = -ms * this.axialMass * (relVel() + bias) - is * this.impulse;
      this.impulse += impulse;
      this.apply(A, B, impulse, dx, dy);
    }
  }

  currentLength() {
    const a = this.worldAnchorA(), b = this.worldAnchorB();
    return Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
  }
}

// Glue two bodies together rigidly.
export class WeldJoint extends Joint {
  constructor(def) {
    super('weld', def);
    this.localA = { ...def.localA };
    this.localB = { ...def.localB };
    this.referenceAngle = def.referenceAngle ?? this.bodyB.angle - this.bodyA.angle;
    this.linearImpulse = { x: 0, y: 0 };
    this.angularImpulse = 0;
    this.axialMass = 0;
  }

  prepare() {
    this.prepareAnchors();
    const k = this.bodyA.invI + this.bodyB.invI;
    this.axialMass = k > 0 ? 1 / k : 0;
  }

  warmStart() {
    const A = this.bodyA, B = this.bodyB;
    this.currentAnchors(cur);
    const P = this.linearImpulse;
    A.vx -= A.invMass * P.x; A.vy -= A.invMass * P.y;
    A.w -= A.invI * (cur.ax * P.y - cur.ay * P.x + this.angularImpulse);
    B.vx += B.invMass * P.x; B.vy += B.invMass * P.y;
    B.w += B.invI * (cur.bx * P.y - cur.by * P.x + this.angularImpulse);
  }

  solve(ctx, useBias) {
    const A = this.bodyA, B = this.bodyB;
    const mA = A.invMass, mB = B.invMass, iA = A.invI, iB = B.invI;
    const soft = ctx.jointSoft;
    {
      let bias = 0, ms = 1, is = 0;
      if (useBias) {
        bias = soft.biasRate * (B.angle - A.angle - this.referenceAngle);
        ms = soft.massScale; is = soft.impulseScale;
      }
      const impulse = -this.axialMass * ms * (B.w - A.w + bias) - is * this.angularImpulse;
      this.angularImpulse += impulse;
      A.w -= iA * impulse;
      B.w += iB * impulse;
    }
    this.currentAnchors(cur);
    const { ax, ay, bx, by } = cur;
    const cdx = B.vx - B.w * by - A.vx + A.w * ay;
    const cdy = B.vy + B.w * bx - A.vy - A.w * ax;
    let biasX = 0, biasY = 0, ms = 1, is = 0;
    if (useBias) {
      const sx = (B.cx - B.c0x) - (A.cx - A.c0x) + bx - ax + this.dcx;
      const sy = (B.cy - B.c0y) - (A.cy - A.c0y) + by - ay + this.dcy;
      biasX = soft.biasRate * sx; biasY = soft.biasRate * sy;
      ms = soft.massScale; is = soft.impulseScale;
    }
    const k11 = mA + mB + ay * ay * iA + by * by * iB;
    const k12 = -ay * ax * iA - by * bx * iB;
    const k22 = mA + mB + ax * ax * iA + bx * bx * iB;
    solve22(k11, k12, k22, cdx + biasX, cdy + biasY, tmp);
    const P = this.linearImpulse;
    const px = -ms * tmp.x - is * P.x, py = -ms * tmp.y - is * P.y;
    P.x += px; P.y += py;
    A.vx -= mA * px; A.vy -= mA * py; A.w -= iA * (ax * py - ay * px);
    B.vx += mB * px; B.vy += mB * py; B.w += iB * (bx * py - by * px);
  }
}

// Pulls a point on body B towards a target with a soft spring (dragging with the mouse or a finger).
export class MouseJoint extends Joint {
  constructor(def) {
    super('mouse', def);
    this.localA = { x: 0, y: 0 };
    this.localB = { ...def.localB };
    this.target = { ...def.target };
    this.hertz = def.hertz ?? 5;
    this.dampingRatio = def.dampingRatio ?? 0.7;
    this.maxForce = def.maxForce ?? 1000 * this.bodyB.mass;
    this.linearImpulse = { x: 0, y: 0 };
    this.soft = null;
  }

  prepare(ctx) {
    const B = this.bodyB;
    anchor(B, this.localB.x, this.localB.y, this.rB);
    this.rA.x = this.rA.y = 0;
    this.dcx = B.cx - this.target.x;
    this.dcy = B.cy - this.target.y;
    this.soft = makeSoft(this.hertz, this.dampingRatio, ctx.h);
  }

  warmStart() {
    const B = this.bodyB, P = this.linearImpulse;
    const bx = B.dqc * this.rB.x - B.dqs * this.rB.y, by = B.dqs * this.rB.x + B.dqc * this.rB.y;
    B.vx += B.invMass * P.x; B.vy += B.invMass * P.y;
    B.w += B.invI * (bx * P.y - by * P.x);
  }

  solve(ctx) {
    const B = this.bodyB, mB = B.invMass, iB = B.invI, s = this.soft;
    // a little angular damping so a dragged body doesn't spin forever
    B.w *= 1 / (1 + ctx.h * 2);
    const bx = B.dqc * this.rB.x - B.dqs * this.rB.y, by = B.dqs * this.rB.x + B.dqc * this.rB.y;
    const cdx = B.vx - B.w * by, cdy = B.vy + B.w * bx;
    const sx = (B.cx - B.c0x) + bx + this.dcx, sy = (B.cy - B.c0y) + by + this.dcy;
    const k11 = mB + by * by * iB, k12 = -by * bx * iB, k22 = mB + bx * bx * iB;
    solve22(k11, k12, k22, cdx + s.biasRate * sx, cdy + s.biasRate * sy, tmp);
    const P = this.linearImpulse;
    const ox = P.x, oy = P.y;
    let nx = ox - s.massScale * tmp.x - s.impulseScale * ox, ny = oy - s.massScale * tmp.y - s.impulseScale * oy;
    const max = ctx.h * this.maxForce, l2 = nx * nx + ny * ny;
    if (l2 > max * max) { const f = max / Math.sqrt(l2); nx *= f; ny *= f; }
    P.x = nx; P.y = ny;
    const px = nx - ox, py = ny - oy;
    B.vx += mB * px; B.vy += mB * py; B.w += iB * (bx * py - by * px);
  }
}
