// Event-driven simulator with a unit delay per component.
//
// One "delta" step: every component whose inputs changed in the previous step is
// re-evaluated against the current net values; then the nets those components drive are
// re-resolved, and the readers of every net that changed are scheduled for the next step.
// Because all components in a step see the same net values, glitches, races and
// oscillation behave the way they do in real gate-level hardware with equal delays.
//
// A "tick" advances every clock by one unit and then settles the circuit (runs delta
// steps until nothing changes). A circuit that does not settle within a step limit is
// reported as oscillating.
import type { Comp, Netlist } from './compile.ts';
import { memBits } from './parts.ts';
import { and, asLogic, not, or, resolve, V0, V1, VX, VZ, xor, type Val } from './values.ts';

function memSize(c: Comp): number {
  const { a, d } = memBits(c.part);
  return c.kind === 'ram' ? (1 << a) * d : d;
}

export const DEFAULT_SETTLE_LIMIT = 1000;

export interface SettleResult {
  stable: boolean;
  deltas: number;
}

export class Simulator {
  readonly nl: Netlist;
  readonly netVal: Uint8Array;
  readonly slotVal: Uint8Array;
  /** Per component: stored bit (flip-flop Q, switch value, button state, clock level). */
  readonly q: Uint8Array;
  /** Per component: previous clock-input level, for edge detection. */
  readonly prevClk: Uint8Array;
  /** Per component: clock tick counter. */
  readonly cnt: Int32Array;
  /** Storage of registers (one value per bit) and RAMs (word-major), by component index. */
  readonly mem = new Map<number, Uint8Array>();
  time = 0;
  /** True when the last settle hit the step limit. */
  oscillating = false;
  /** Nets that were still changing when the last settle gave up. */
  unstableNets = new Set<number>();
  /** Delta steps taken since the simulator was created (for statistics). */
  totalDeltas = 0;

  /**
   * Delta steps allowed before a settle counts as oscillation. Proportional to the
   * circuit size so that a long (but finite) chain of gates is never mistaken for one.
   */
  readonly settleLimit: number;

  private queued: Uint8Array;
  private queue: number[] = [];

  constructor(nl: Netlist, carry?: Simulator) {
    this.nl = nl;
    const nc = nl.comps.length;
    this.netVal = new Uint8Array(nl.netCount).fill(VZ);
    this.slotVal = new Uint8Array(nl.slotCount).fill(VX);
    this.q = new Uint8Array(nc);
    this.prevClk = new Uint8Array(nc).fill(VX);
    this.cnt = new Int32Array(nc);
    this.queued = new Uint8Array(nc);
    this.settleLimit = Math.max(DEFAULT_SETTLE_LIMIT, 2 * nc + 16);

    nl.comps.forEach((c, i) => {
      if (c.kind === 'in') this.q[i] = c.part.value === 1 ? 1 : 0;
      if (c.kind === 'reg' || c.kind === 'ram') this.mem.set(i, new Uint8Array(memSize(c)));
      const old = carry ? carry.nl.compByPath.get(c.path) : undefined;
      if (carry && old !== undefined && carry.nl.comps[old].kind === c.kind) {
        this.q[i] = carry.q[old];
        this.prevClk[i] = carry.prevClk[old];
        this.cnt[i] = carry.cnt[old];
        const oldMem = carry.mem.get(old);
        if (oldMem && oldMem.length === memSize(c)) this.mem.set(i, oldMem.slice());
        const oc = carry.nl.comps[old];
        for (let k = 0; k < c.outs.length && k < oc.outs.length; k++) this.slotVal[c.outBase + k] = carry.slotVal[oc.outBase + k];
      }
    });
    if (carry) this.time = carry.time;
    this.primeSources();
    for (let n = 0; n < nl.netCount; n++) this.netVal[n] = this.resolveNet(n);
    for (let i = 0; i < nc; i++) this.schedule(i);
  }

  /** Clear all state: flip-flops to 0, clocks to the start of their cycle, gates unknown. */
  reset(): void {
    this.nl.comps.forEach((c, i) => {
      if (c.kind !== 'in') this.q[i] = 0;
      this.prevClk[i] = VX;
      this.cnt[i] = 0;
    });
    for (const m of this.mem.values()) m.fill(0);
    this.slotVal.fill(VX);
    this.primeSources();
    for (let n = 0; n < this.nl.netCount; n++) this.netVal[n] = this.resolveNet(n);
    this.time = 0;
    this.oscillating = false;
    this.unstableNets.clear();
    for (let i = 0; i < this.nl.comps.length; i++) this.schedule(i);
  }

  /** Sources (switches, constants, clocks, buttons) are known from the start, not unknown. */
  private primeSources(): void {
    this.nl.comps.forEach((c, i) => {
      if (c.kind === 'in' || c.kind === 'button' || c.kind === 'clock') this.slotVal[c.outBase] = this.q[i];
      else if (c.kind === 'const') this.slotVal[c.outBase] = c.part.value === 1 ? V1 : V0;
    });
  }

  private resolveNet(n: number): Val {
    const ds = this.nl.drivers[n];
    if (ds.length === 1) return this.slotVal[ds[0]] as Val;
    const vals: Val[] = [];
    for (const s of ds) vals.push(this.slotVal[s] as Val);
    return resolve(vals);
  }

  schedule(i: number): void {
    if (!this.queued[i]) {
      this.queued[i] = 1;
      this.queue.push(i);
    }
  }

  get pending(): boolean {
    return this.queue.length > 0;
  }

  // -------------------------------------------------------------------------
  // Inputs

  compIndex(path: string): number | undefined {
    return this.nl.compByPath.get(path);
  }

  /** Set an input switch (or press/release a button). Does not settle. */
  setInput(path: string, v: 0 | 1): boolean {
    const i = this.nl.compByPath.get(path);
    if (i === undefined) return false;
    const c = this.nl.comps[i];
    if (c.kind !== 'in' && c.kind !== 'button') return false;
    if (this.q[i] !== v) {
      this.q[i] = v;
      this.schedule(i);
    }
    return true;
  }

  getInput(path: string): 0 | 1 | undefined {
    const i = this.nl.compByPath.get(path);
    return i === undefined ? undefined : (this.q[i] as 0 | 1);
  }

  /** Values of all root-level input switches, keyed by part id. */
  inputValues(): Record<string, 0 | 1> {
    const out: Record<string, 0 | 1> = {};
    this.nl.comps.forEach((c, i) => {
      if (c.root && c.kind === 'in') out[c.part.id] = this.q[i] as 0 | 1;
    });
    return out;
  }

  pinValue(partId: string, pin: string): Val {
    const n = this.nl.pinNet.get(`${partId}:${pin}`);
    return n === undefined ? VZ : (this.netVal[n] as Val);
  }

  // -------------------------------------------------------------------------
  // Time

  /** Run one delta step. Returns the number of nets that changed. */
  stepDelta(): number {
    const nl = this.nl;
    const batch = this.queue;
    this.queue = [];
    const touched: number[] = [];
    for (const i of batch) {
      this.queued[i] = 0;
      const c = nl.comps[i];
      if (c.outs.length === 0) continue;
      this.evaluate(i, c, touched);
    }
    let changed = 0;
    const seen = new Set<number>();
    for (const slot of touched) {
      const n = nl.slotNet[slot];
      if (seen.has(n)) continue;
      seen.add(n);
      const v = this.resolveNet(n);
      if (v !== this.netVal[n]) {
        this.netVal[n] = v;
        changed++;
        if (this.oscillating) this.unstableNets.add(n);
        for (const r of nl.readers[n]) this.schedule(r);
      }
    }
    this.totalDeltas++;
    return changed;
  }

  /** Run delta steps until the circuit is stable or the limit is reached. */
  settle(limit = this.settleLimit): SettleResult {
    let deltas = 0;
    this.unstableNets.clear();
    this.oscillating = false;
    while (this.queue.length > 0) {
      if (deltas >= limit) {
        // Record which nets keep changing, then report.
        this.oscillating = true;
        for (let k = 0; k < 8 && this.queue.length > 0; k++) this.stepDelta();
        return { stable: false, deltas };
      }
      this.stepDelta();
      deltas++;
    }
    return { stable: true, deltas };
  }

  /** Advance every clock by one tick (without settling). */
  advanceClocks(): void {
    this.time++;
    this.nl.comps.forEach((c, i) => {
      if (c.kind !== 'clock') return;
      const period = Math.max(1, Math.round(c.part.period ?? 1));
      this.cnt[i]++;
      if (this.cnt[i] >= period) {
        this.cnt[i] = 0;
        this.q[i] ^= 1;
        this.schedule(i);
      }
    });
  }

  /** One clock tick followed by settling. */
  tick(limit = this.settleLimit): SettleResult {
    this.advanceClocks();
    return this.settle(limit);
  }

  hasClocks(): boolean {
    return this.nl.comps.some((c) => c.kind === 'clock');
  }

  // -------------------------------------------------------------------------

  private out(c: Comp, k: number, v: Val, touched: number[]): void {
    const slot = c.outBase + k;
    if (this.slotVal[slot] !== v) {
      this.slotVal[slot] = v;
      touched.push(slot);
    }
  }

  private inVal(c: Comp, k: number): Val {
    return this.netVal[c.ins[k]] as Val;
  }

  private evaluate(i: number, c: Comp, touched: number[]): void {
    switch (c.kind) {
      case 'in':
      case 'button':
      case 'clock':
        this.out(c, 0, this.q[i] as Val, touched);
        return;
      case 'const':
        this.out(c, 0, c.part.value === 1 ? V1 : V0, touched);
        return;
      case 'buf':
        this.out(c, 0, asLogic(this.inVal(c, 0)), touched);
        return;
      case 'not':
        this.out(c, 0, not(this.inVal(c, 0)), touched);
        return;
      case 'and':
      case 'nand':
      case 'or':
      case 'nor':
      case 'xor':
      case 'xnor': {
        const vals = c.ins.map((n) => this.netVal[n] as Val);
        const base = c.kind === 'and' || c.kind === 'nand' ? and(vals) : c.kind === 'or' || c.kind === 'nor' ? or(vals) : xor(vals);
        this.out(c, 0, c.kind === 'nand' || c.kind === 'nor' || c.kind === 'xnor' ? not(base) : base, touched);
        return;
      }
      case 'tri': {
        const en = asLogic(this.inVal(c, 1));
        this.out(c, 0, en === 1 ? asLogic(this.inVal(c, 0)) : en === 0 ? VZ : VX, touched);
        return;
      }
      case 'mux': {
        const s = asLogic(this.inVal(c, 2));
        const a = asLogic(this.inVal(c, 0));
        const b = asLogic(this.inVal(c, 1));
        this.out(c, 0, s === 0 ? a : s === 1 ? b : a === b ? a : VX, touched);
        return;
      }
      case 'dff':
      case 'tff':
      case 'jkff': {
        // Pins: dff/tff = [d|t, c, clr], jkff = [j, c, k, clr]
        const isJK = c.kind === 'jkff';
        const clk = asLogic(this.inVal(c, 1));
        const clr = this.inVal(c, isJK ? 3 : 2);
        const rising = this.prevClk[i] === 0 && clk === 1;
        this.prevClk[i] = clk;
        let q = this.q[i] as 0 | 1 | 2;
        // The clear pin is optional: only a clean 1 clears (floating or unknown is ignored).
        if (clr === V1) q = 0;
        else if (rising) {
          if (c.kind === 'dff') q = asLogic(this.inVal(c, 0));
          else if (c.kind === 'tff') {
            const t = asLogic(this.inVal(c, 0));
            q = t === 0 ? q : t === 1 ? (q === VX ? VX : ((1 - q) as 0 | 1)) : VX;
          } else {
            const j = asLogic(this.inVal(c, 0));
            const k = asLogic(this.inVal(c, 2));
            if (j === VX || k === VX) q = VX;
            else if (j === 1 && k === 1) q = q === VX ? VX : ((1 - q) as 0 | 1);
            else if (j === 1) q = 1;
            else if (k === 1) q = 0;
          }
        }
        this.q[i] = q;
        this.out(c, 0, q, touched);
        this.out(c, 1, not(q), touched);
        return;
      }
      case 'rom': {
        const { a, d } = memBits(c.part);
        const addr = this.address(c, 0, a);
        const word = addr < 0 ? -1 : (c.part.data?.[addr] ?? 0);
        for (let k = 0; k < d; k++) this.out(c, k, word < 0 ? VX : (((word >> k) & 1) as Val), touched);
        return;
      }
      case 'reg': {
        // Pins: d0..d(n-1), c, en, clr
        const { d } = memBits(c.part);
        const m = this.mem.get(i)!;
        const clk = asLogic(this.inVal(c, d));
        const en = this.inVal(c, d + 1);
        const clr = this.inVal(c, d + 2);
        const rising = this.prevClk[i] === 0 && clk === 1;
        this.prevClk[i] = clk;
        if (clr === V1) m.fill(0);
        else if (rising && en !== V0) {
          // Enable is optional: floating counts as enabled; unknown makes the result unknown.
          for (let k = 0; k < d; k++) m[k] = en === VZ || en === V1 ? asLogic(this.inVal(c, k)) : VX;
        }
        for (let k = 0; k < d; k++) this.out(c, k, m[k] as Val, touched);
        return;
      }
      case 'ram': {
        // Pins: a0..a(A-1), i0..i(D-1), we, c
        const { a, d } = memBits(c.part);
        const m = this.mem.get(i)!;
        const clk = asLogic(this.inVal(c, a + d + 1));
        const we = asLogic(this.inVal(c, a + d));
        const rising = this.prevClk[i] === 0 && clk === 1;
        this.prevClk[i] = clk;
        const addr = this.address(c, 0, a);
        if (rising && we !== 0) {
          if (addr >= 0 && we === 1) for (let k = 0; k < d; k++) m[addr * d + k] = asLogic(this.inVal(c, a + k));
        }
        for (let k = 0; k < d; k++) this.out(c, k, addr < 0 ? VX : (m[addr * d + k] as Val), touched);
        return;
      }
      case 'out':
      case 'led':
      case 'hex':
      case 'seg7':
        return;
    }
  }

  /** Binary number on input pins [from, from + n), or -1 if any bit is not 0/1. */
  private address(c: Comp, from: number, n: number): number {
    let addr = 0;
    for (let k = 0; k < n; k++) {
      const v = asLogic(this.inVal(c, from + k));
      if (v === VX) return -1;
      addr |= v << k;
    }
    return addr;
  }

  /** Current contents of a register or RAM (by part id at the top level), for display. */
  memory(partId: string): Uint8Array | undefined {
    const i = this.nl.compByPath.get(partId);
    return i === undefined ? undefined : this.mem.get(i);
  }
}
