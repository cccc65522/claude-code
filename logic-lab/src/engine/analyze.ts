// Circuit analysis: truth tables, combinational feedback loops, statistics.
import { compile, findCircuit, isFatal, type Netlist } from './compile.ts';
import { chipInterface, isGate, pinLabel, STATEFUL_KINDS } from './parts.ts';
import { minimize, minimizePOS, type Implicant } from './qm.ts';
import { Simulator } from './sim.ts';
import type { Project } from './types.ts';
import { VAL_NAME, type Val } from './values.ts';

export const MAX_TABLE_INPUTS = 10;
export const MAX_MINIMIZE_INPUTS = 8;

export interface Signal {
  id: string;
  label: string;
}

export interface TruthTable {
  inputs: Signal[];
  outputs: Signal[];
  /** rows[r][k] = value of output k when the inputs spell r in binary (first input = MSB). */
  rows: Val[][];
  sequential: boolean;
  notes: string[];
  /** Per output: minimal sum of products / product of sums (when it can be computed). */
  sop: (Implicant[] | null)[];
  pos: (Implicant[] | null)[];
  /** Rows where an output was X/Z/E and treated as "don't care" for minimisation. */
  dontCare: number[][];
}

export type TableResult = { ok: true; table: TruthTable } | { ok: false; error: string };

/**
 * Strongly connected components of the component graph, ignoring paths through
 * flip-flops (which break combinational loops). Returns paths of the parts on a loop.
 */
export function combinationalLoops(nl: Netlist): string[][] {
  const n = nl.comps.length;
  const succ: number[][] = Array.from({ length: n }, () => []);
  nl.comps.forEach((c, i) => {
    if (STATEFUL_KINDS.has(c.kind)) return;
    for (const net of c.outs) for (const r of nl.readers[net]) if (!STATEFUL_KINDS.has(nl.comps[r].kind)) succ[i].push(r);
  });
  // Iterative Tarjan.
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const loops: string[][] = [];
  let counter = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] >= 0) continue;
    const work: [number, number][] = [[s, 0]];
    index[s] = low[s] = counter++;
    stack.push(s);
    onStack[s] = 1;
    while (work.length) {
      const top = work[work.length - 1];
      const [v, k] = top;
      if (k < succ[v].length) {
        top[1]++;
        const w = succ[v][k];
        if (index[w] < 0) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        work.pop();
        if (work.length) {
          const u = work[work.length - 1][0];
          low[u] = Math.min(low[u], low[v]);
        }
        if (low[v] === index[v]) {
          const scc: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            scc.push(w);
          } while (w !== v);
          if (scc.length > 1 || succ[v].includes(v)) loops.push(scc.map((i) => nl.comps[i].path));
        }
      }
    }
  }
  return loops;
}

export function truthTable(project: Project, circuitId: string, maxInputs = MAX_TABLE_INPUTS): TableResult {
  const circuit = findCircuit(project, circuitId);
  if (!circuit) return { ok: false, error: '找不到电路' };
  const { inputs, outputs } = chipInterface(circuit);
  if (outputs.length === 0) return { ok: false, error: '电路里没有“输出引脚”，无法生成真值表。' };
  if (inputs.length > maxInputs) return { ok: false, error: `输入引脚有 ${inputs.length} 个，最多支持 ${maxInputs} 个。` };
  const nl = compile(project, circuitId);
  if (nl.errors.some(isFatal)) return { ok: false, error: nl.errors.find(isFatal)!.message };
  const notes: string[] = [];
  const loops = combinationalLoops(nl);
  const stateful = nl.comps.filter((c) => STATEFUL_KINDS.has(c.kind) && c.kind !== 'button');
  const buttons = nl.comps.filter((c) => c.kind === 'button');
  if (stateful.length) notes.push('电路含触发器或时钟，表中是复位后、不加时钟时的稳定输出。');
  if (loops.length) notes.push('电路含反馈回路（例如锁存器），表中是从“全部未知”的状态出发的结果。');
  if (buttons.length) notes.push('按钮按“未按下”计算。');

  const sim = new Simulator(nl);
  const rows: Val[][] = [];
  const inPaths = inputs.map((p) => p.id);
  const n = inputs.length;
  let oscillated = false;
  for (let r = 0; r < 1 << n; r++) {
    sim.reset();
    inPaths.forEach((path, k) => sim.setInput(path, ((r >> (n - 1 - k)) & 1) as 0 | 1));
    const res = sim.settle();
    if (!res.stable) oscillated = true;
    rows.push(outputs.map((o) => sim.pinValue(o.id, 'i')));
  }
  if (oscillated) notes.push('某些输入组合下电路振荡，无法稳定。');

  const sop: (Implicant[] | null)[] = [];
  const pos: (Implicant[] | null)[] = [];
  const dontCare: number[][] = [];
  outputs.forEach((_, k) => {
    const ones: number[] = [];
    const dcs: number[] = [];
    rows.forEach((row, r) => {
      if (row[k] === 1) ones.push(r);
      else if (row[k] !== 0) dcs.push(r);
    });
    dontCare.push(dcs);
    if (n <= MAX_MINIMIZE_INPUTS && dcs.length < 1 << n) {
      sop.push(minimize(n, ones, dcs));
      pos.push(minimizePOS(n, ones, dcs));
    } else {
      sop.push(null);
      pos.push(null);
    }
  });
  return {
    ok: true,
    table: {
      inputs: inputs.map((p, i) => ({ id: p.id, label: pinLabel(p, i, 'I') })),
      outputs: outputs.map((p, i) => ({ id: p.id, label: pinLabel(p, i, 'O') })),
      rows,
      sequential: stateful.length > 0 || loops.length > 0,
      notes,
      sop,
      pos,
      dontCare
    }
  };
}

export function tableToText(t: TruthTable): string {
  const head = [...t.inputs.map((s) => s.label), '|', ...t.outputs.map((s) => s.label)].join('\t');
  const n = t.inputs.length;
  const lines = t.rows.map((row, r) => {
    const ins = t.inputs.map((_, k) => String((r >> (n - 1 - k)) & 1));
    return [...ins, '|', ...row.map((v) => VAL_NAME[v])].join('\t');
  });
  return [head, ...lines].join('\n');
}

export interface CircuitStats {
  gates: number;
  parts: number;
  wires: number;
  /** Primitive components after flattening every chip. */
  flatComponents: number;
  /** Gates after flattening (counting a gate with n inputs as one gate). */
  flatGates: number;
  depth: number;
}

/** Longest combinational path (in gates) from any source to any sink; loops are skipped. */
export function logicDepth(nl: Netlist): number {
  const n = nl.comps.length;
  const memo = new Int32Array(n).fill(-1);
  const visiting = new Uint8Array(n);
  const depthOf = (i: number): number => {
    if (memo[i] >= 0) return memo[i];
    if (visiting[i]) return 0;
    visiting[i] = 1;
    const c = nl.comps[i];
    let best = 0;
    if (!STATEFUL_KINDS.has(c.kind) && c.kind !== 'in' && c.kind !== 'const') {
      for (const net of c.ins) for (const slot of nl.drivers[net]) {
        const d = slotOwner(nl, slot);
        if (d >= 0) best = Math.max(best, depthOf(d));
      }
    }
    visiting[i] = 0;
    memo[i] = best + (isGate(c.kind) || c.kind === 'tri' || c.kind === 'mux' ? 1 : 0);
    return memo[i];
  };
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, depthOf(i));
  return max;
}

function slotOwner(nl: Netlist, slot: number): number {
  // Components are stored in slot order, so binary search on outBase.
  let lo = 0;
  let hi = nl.comps.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = nl.comps[mid];
    if (slot < c.outBase) hi = mid - 1;
    else if (slot >= c.outBase + c.outs.length) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function circuitStats(project: Project, circuitId: string, nl?: Netlist): CircuitStats {
  const c = findCircuit(project, circuitId);
  const net = nl ?? compile(project, circuitId);
  return {
    gates: c ? c.parts.filter((p) => isGate(p.kind)).length : 0,
    parts: c ? c.parts.length : 0,
    wires: c ? c.wires.length : 0,
    flatComponents: net.comps.length,
    flatGates: net.comps.filter((x) => isGate(x.kind)).length,
    depth: logicDepth(net)
  };
}

// ---------------------------------------------------------------------------
// State machines: state transition table of a clocked circuit

export const MAX_FLOPS = 6;
export const MAX_FSM_INPUTS = 4;

export interface StateRow {
  state: number;
  input: number;
  /** Next state after one clock cycle, or -1 when it is not fully known. */
  next: number;
  /** Outputs during this state with these inputs (before the clock edge). */
  out: Val[];
}

export interface StateTable {
  flops: Signal[];
  inputs: Signal[];
  outputs: Signal[];
  rows: StateRow[];
  /** States reachable from the reset state (all flip-flops 0). */
  reachable: number[];
  /** Outputs depend only on the state (Moore machine). */
  moore: boolean;
  period: number;
}

export type StateResult = { ok: true; table: StateTable } | { ok: false; error: string };

export function stateTable(project: Project, circuitId: string): StateResult {
  const circuit = findCircuit(project, circuitId);
  if (!circuit) return { ok: false, error: '找不到电路' };
  const nl = compile(project, circuitId);
  if (nl.errors.some(isFatal)) return { ok: false, error: nl.errors.find(isFatal)!.message };
  // State bits: flip-flops of this circuit top to bottom, then those inside chips.
  const flops = nl.comps
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.kind === 'dff' || c.kind === 'jkff' || c.kind === 'tff')
    .sort((a, b) => Number(b.c.root) - Number(a.c.root) || (a.c.root ? a.c.part.y - b.c.part.y || a.c.part.x - b.c.part.x : a.i - b.i));
  const clocks = nl.comps.filter((c) => c.kind === 'clock');
  if (!flops.length) return { ok: false, error: '电路里没有触发器。' };
  if (flops.length > MAX_FLOPS) return { ok: false, error: `触发器有 ${flops.length} 个，最多支持 ${MAX_FLOPS} 个。` };
  if (!clocks.length) return { ok: false, error: '电路里没有时钟元件，无法推算下一个状态。' };
  const periods = new Set(clocks.map((c) => Math.max(1, Math.round(c.part.period ?? 1))));
  if (periods.size > 1) return { ok: false, error: '电路里有几个周期不同的时钟，无法确定“一个时钟周期”。' };
  const period = [...periods][0];
  const { inputs, outputs } = chipInterface(circuit);
  if (inputs.length > MAX_FSM_INPUTS) return { ok: false, error: `输入引脚有 ${inputs.length} 个，状态表最多支持 ${MAX_FSM_INPUTS} 个。` };
  const outs = [...outputs, ...circuit.parts.filter((p) => p.kind === 'led')];

  const sim = new Simulator(nl);
  const nf = flops.length;
  const ni = inputs.length;
  const rows: StateRow[] = [];
  for (let state = 0; state < 1 << nf; state++) {
    for (let input = 0; input < 1 << ni; input++) {
      sim.reset();
      flops.forEach(({ i }, k) => (sim.q[i] = (state >> (nf - 1 - k)) & 1));
      inputs.forEach((p, k) => sim.setInput(p.id, ((input >> (ni - 1 - k)) & 1) as 0 | 1));
      sim.settle();
      const out = outs.map((p) => sim.pinValue(p.id, 'i'));
      // One full clock cycle: the clock rises after `period` ticks and falls after another `period`.
      for (let t = 0; t < 2 * period; t++) sim.tick();
      let next = 0;
      for (const [k, { i }] of flops.entries()) {
        const q = sim.q[i];
        if (q > 1) {
          next = -1;
          break;
        }
        next |= q << (nf - 1 - k);
      }
      rows.push({ state, input, next, out });
    }
  }
  const reachable = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const s = queue.shift()!;
    for (const r of rows) if (r.state === s && r.next >= 0 && !reachable.has(r.next)) {
      reachable.add(r.next);
      queue.push(r.next);
    }
  }
  const moore = rows.every((r) => {
    const first = rows.find((x) => x.state === r.state)!;
    return r.out.every((v, k) => v === first.out[k]);
  });
  const flopLabel = (c: (typeof flops)[number]['c'], k: number) => c.part.label?.trim() || `F${k + 1}`;
  return {
    ok: true,
    table: {
      flops: flops.map(({ c }, k) => ({ id: c.path, label: flopLabel(c, k) })),
      inputs: inputs.map((p, i) => ({ id: p.id, label: pinLabel(p, i, 'I') })),
      outputs: outs.map((p, i) => ({ id: p.id, label: p.label?.trim() || (p.kind === 'led' ? `灯${i + 1}` : `O${i + 1}`) })),
      rows,
      reachable: [...reachable].sort((a, b) => a - b),
      moore,
      period
    }
  };
}
