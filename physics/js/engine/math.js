// Small math kit for the physics engine.
//
// Determinism: the engine only uses + − × ÷, Math.sqrt (correctly rounded by the spec), Math.round, min/max/abs,
// and the cosSin below. Math.sin/cos/atan2/hypot are implementation-defined in JavaScript and can differ in the
// last bit between Chrome, Safari and Node, which is enough for a chaotic simulation to diverge. With only
// spec-exact operations, the same scene gives bit-identical results on every browser.

const PIO2_HI = 1.5707963267948966; // π/2 rounded to double
const PIO2_LO = 6.123233995736766e-17; // π/2 − PIO2_HI
const TWO_OVER_PI = 0.6366197723675814;

// fdlibm kernel coefficients, valid on [−π/4, π/4].
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

// Writes cos(a) and sin(a) into out.c / out.s.
export function cosSin(a, out) {
  const k = Math.round(a * TWO_OVER_PI);
  const r = (a - k * PIO2_HI) - k * PIO2_LO;
  const z = r * r;
  const s = r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
  const c = 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  switch (k & 3) {
    case 0: out.c = c; out.s = s; break;
    case 1: out.c = -s; out.s = c; break;
    case 2: out.c = -c; out.s = -s; break;
    default: out.c = s; out.s = -c;
  }
  return out;
}

const tmp = { c: 1, s: 0 };
export const cos = a => cosSin(a, tmp).c;
export const sin = a => cosSin(a, tmp).s;

export const PI = Math.PI;
export const TAU = 2 * Math.PI;

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const len = (x, y) => Math.sqrt(x * x + y * y);
export const dist = (ax, ay, bx, by) => len(bx - ax, by - ay);
export const cross = (ax, ay, bx, by) => ax * by - ay * bx;

// Soft constraint coefficients (Erin Catto, "Solver2D"): a constraint behaves like a damped spring of the given
// frequency, solved implicitly so it stays stable at any stiffness.
export function makeSoft(hertz, zeta, h) {
  if (hertz === 0) return { biasRate: 0, massScale: 1, impulseScale: 0 };
  const omega = TAU * hertz;
  const a1 = 2 * zeta + h * omega;
  const a2 = h * omega * a1;
  const a3 = 1 / (1 + a2);
  return { biasRate: omega / a1, massScale: a2 * a3, impulseScale: a3 };
}

// Solve the symmetric 2×2 system [a b; b d] x = (ux, uy). Returns into out.
export function solve22(a, b, d, ux, uy, out) {
  let det = a * d - b * b;
  if (det !== 0) det = 1 / det;
  out.x = det * (d * ux - b * uy);
  out.y = det * (a * uy - b * ux);
  return out;
}

// Small seeded PRNG (mulberry32) for scene generation, so demos look the same everywhere.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
