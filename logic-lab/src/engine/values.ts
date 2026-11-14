// Signal values. A wire (net) carries one of five values:
//   0, 1  – ordinary logic levels
//   X     – unknown: driven, but the level cannot be determined (e.g. a gate with a floating input)
//   Z     – high impedance: nothing drives the net (floating wire, disabled tri-state buffer)
//   E     – error: two drivers disagree (short circuit between 0 and 1)
export const V0 = 0;
export const V1 = 1;
export const VX = 2;
export const VZ = 3;
export const VE = 4;
export type Val = 0 | 1 | 2 | 3 | 4;

export const VAL_NAME: Record<Val, string> = { 0: '0', 1: '1', 2: 'X', 3: 'Z', 4: 'E' };

/** What a gate input "sees": anything other than a clean 0/1 is unknown. */
export function asLogic(v: Val): 0 | 1 | 2 {
  return v === 0 || v === 1 ? v : VX;
}

export function not(v: Val): Val {
  const a = asLogic(v);
  return a === VX ? VX : ((1 - a) as 0 | 1);
}

export function and(vals: readonly Val[]): Val {
  let unknown = false;
  for (const v of vals) {
    const a = asLogic(v);
    if (a === 0) return V0;
    if (a === VX) unknown = true;
  }
  return unknown ? VX : V1;
}

export function or(vals: readonly Val[]): Val {
  let unknown = false;
  for (const v of vals) {
    const a = asLogic(v);
    if (a === 1) return V1;
    if (a === VX) unknown = true;
  }
  return unknown ? VX : V0;
}

/** n-input XOR is odd parity. Any unknown input makes the result unknown. */
export function xor(vals: readonly Val[]): Val {
  let p = 0;
  for (const v of vals) {
    const a = asLogic(v);
    if (a === VX) return VX;
    p ^= a;
  }
  return p as 0 | 1;
}

/**
 * Resolve the value of a net from the values its drivers put on it.
 * Drivers that output Z do not count. No drivers at all → Z (floating).
 */
export function resolve(drivers: readonly Val[]): Val {
  let seen0 = false;
  let seen1 = false;
  let seenX = false;
  let any = false;
  for (const v of drivers) {
    if (v === VZ) continue;
    any = true;
    if (v === VE) return VE;
    if (v === V0) seen0 = true;
    else if (v === V1) seen1 = true;
    else seenX = true;
  }
  if (!any) return VZ;
  if (seen0 && seen1) return VE;
  if (seenX) return VX;
  return seen1 ? V1 : V0;
}
