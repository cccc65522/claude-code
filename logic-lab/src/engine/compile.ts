// Netlist compiler: flattens a circuit (inlining every chip instance, recursively) into
// primitive components connected by nets. Nets are found with union-find over pins:
// every wire joins its two pins; a chip instance's pins are joined with the matching
// interface pins inside the chip definition.
import { chipInterface, partSpec, pinWidth } from './parts.ts';

/** Keys of the bits of a pin: the pin itself, or "pin#0" … "pin#(w-1)" for a bus. */
export function bitKeys(base: string, width: number): string[] {
  return width === 1 ? [base] : Array.from({ length: width }, (_, i) => `${base}#${i}`);
}

/** Errors that make a circuit impossible to simulate (others just leave a wire unconnected). */
export function isFatal(e: CompileError): boolean {
  return e.kind === 'missing-chip' || e.kind === 'recursive-chip' || e.kind === 'too-large';
}
import type { Circuit, Part, PartKind, Project } from './types.ts';
import { MAIN_ID } from './types.ts';

export type PrimKind = Exclude<PartKind, 'chip' | 'text'>;

export interface Comp {
  /** Unique path through the chip hierarchy, e.g. "p3" or "chip1/p7". */
  path: string;
  kind: PrimKind;
  part: Part;
  /** Net of every input pin, in spec order. */
  ins: number[];
  /** Net of every output pin, in spec order. */
  outs: number[];
  /** First driver slot of this component (output k uses slot outBase + k). */
  outBase: number;
  /** Part belongs to the simulated circuit itself, not to a chip inside it. */
  root: boolean;
}

export interface CompileError {
  kind: 'missing-chip' | 'recursive-chip' | 'too-large' | 'dangling-wire' | 'width-mismatch';
  message: string;
  partId?: string;
}

export interface Netlist {
  comps: Comp[];
  netCount: number;
  /** Per net: driver slots. */
  drivers: number[][];
  /** Per net: indices of components that read it. */
  readers: number[][];
  /** Driver slot → net. */
  slotNet: number[];
  slotCount: number;
  /** Net of every pin, keyed "partId:pin" for the root circuit and "inst/…/partId:pin" inside chips. */
  pinNet: Map<string, number>;
  /** Net of each wire of the root circuit. */
  wireNet: Map<string, number>;
  compByPath: Map<string, number>;
  errors: CompileError[];
}

export const MAX_COMPONENTS = 200_000;

class UnionFind {
  parent: number[] = [];
  rank: number[] = [];
  make(): number {
    const i = this.parent.length;
    this.parent.push(i);
    this.rank.push(0);
    return i;
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
  }
}

export function findCircuit(project: Project, id: string): Circuit | undefined {
  return id === MAIN_ID ? project.main : project.chips.find((c) => c.id === id);
}

interface PendingComp {
  path: string;
  kind: PrimKind;
  part: Part;
  inPins: number[];
  outPins: number[];
  root: boolean;
}

class TooLarge extends Error {}

/** Compile the circuit `rootId` of `project` into a flat netlist. */
export function compile(project: Project, rootId: string = MAIN_ID): Netlist {
  const uf = new UnionFind();
  const pinIndex = new Map<string, number>();
  const pin = (key: string): number => {
    let i = pinIndex.get(key);
    if (i === undefined) {
      i = uf.make();
      pinIndex.set(key, i);
    }
    return i;
  };
  const errors: CompileError[] = [];
  const pending: PendingComp[] = [];
  const chipById = new Map(project.chips.map((c) => [c.id, c]));

  const flatten = (circuit: Circuit, prefix: string, stack: string[]): void => {
    const depth = stack.length - 1;
    const partById = new Map<string, Part>();
    // Tunnels with the same label are one connection (within this circuit only).
    const tunnels = new Map<string, number>();
    for (const part of circuit.parts) {
      partById.set(part.id, part);
      const key = (p: string) => `${prefix}${part.id}:${p}`;
      if (part.kind === 'text') continue;
      if (part.kind === 'tunnel') {
        const me = pin(key('p'));
        const name = part.label?.trim();
        if (name) {
          const first = tunnels.get(name);
          if (first === undefined) tunnels.set(name, me);
          else uf.union(first, me);
        }
        continue;
      }
      if (part.kind === 'chip') {
        const def = part.chip ? chipById.get(part.chip) : undefined;
        if (!def) {
          if (depth === 0) errors.push({ kind: 'missing-chip', message: `找不到芯片“${part.label ?? part.chip}”`, partId: part.id });
          continue;
        }
        if (stack.includes(def.id)) {
          if (depth === 0) errors.push({ kind: 'recursive-chip', message: `芯片“${def.name}”直接或间接包含了自己`, partId: part.id });
          continue;
        }
        const inner = `${prefix}${part.id}/`;
        flatten(def, inner, [...stack, def.id]);
        const { inputs, outputs } = chipInterface(def);
        for (const p of inputs) uf.union(pin(key(p.id)), pin(`${inner}${p.id}:o`));
        for (const p of outputs) uf.union(pin(key(p.id)), pin(`${inner}${p.id}:i`));
        continue;
      }
      const spec = partSpec(part, project);
      if (part.kind === 'split') {
        // A splitter is pure wiring: bit i of the bus pin is the same net as pin b<i>.
        spec.pins.forEach((s, i) => i > 0 && uf.union(pin(key(`bus#${i - 1}`)), pin(key(s.name))));
        continue;
      }
      // Make sure every pin exists, even unconnected ones. A bus pin is one pin per bit.
      const ins: number[] = [];
      const outs: number[] = [];
      for (const s of spec.pins) for (const k of bitKeys(key(s.name), pinWidth(s))) (s.dir === 'in' ? ins : outs).push(pin(k));
      // Interface pins of a chip are just connection points.
      if (depth > 0 && (part.kind === 'in' || part.kind === 'out')) continue;
      if (pending.length >= MAX_COMPONENTS) throw new TooLarge();
      pending.push({ path: `${prefix}${part.id}`, kind: part.kind, part, inPins: ins, outPins: outs, root: depth === 0 });
    }
    for (const w of circuit.wires) {
      const pa = partById.get(w.a.part);
      const pb = partById.get(w.b.part);
      if (!pa || !pb) {
        if (depth === 0) errors.push({ kind: 'dangling-wire', message: '有连线的一端没有元件' });
        continue;
      }
      const sa = partSpec(pa, project).pins.find((s) => s.name === w.a.pin);
      const sb = partSpec(pb, project).pins.find((s) => s.name === w.b.pin);
      if (!sa || !sb) {
        if (depth === 0) errors.push({ kind: 'dangling-wire', message: '有连线接在已不存在的引脚上（芯片接口改过？）' });
        continue;
      }
      if (pinWidth(sa) !== pinWidth(sb)) {
        if (depth === 0) errors.push({ kind: 'width-mismatch', message: `有连线两端位宽不同（${pinWidth(sa)} 位和 ${pinWidth(sb)} 位），没有接通` });
        continue;
      }
      const ka = bitKeys(`${prefix}${w.a.part}:${w.a.pin}`, pinWidth(sa));
      const kb = bitKeys(`${prefix}${w.b.part}:${w.b.pin}`, pinWidth(sb));
      ka.forEach((k, i) => uf.union(pin(k), pin(kb[i])));
    }
  };

  const root = findCircuit(project, rootId);
  if (root) {
    try {
      flatten(root, '', [rootId]);
    } catch (e) {
      if (!(e instanceof TooLarge)) throw e;
      errors.push({ kind: 'too-large', message: `电路展开后超过 ${MAX_COMPONENTS.toLocaleString()} 个元件，无法仿真` });
      pending.length = 0;
    }
  }

  // Number the nets.
  const netOfRoot = new Map<number, number>();
  const netOf = (pinIdx: number): number => {
    const r = uf.find(pinIdx);
    let n = netOfRoot.get(r);
    if (n === undefined) {
      n = netOfRoot.size;
      netOfRoot.set(r, n);
    }
    return n;
  };

  const comps: Comp[] = [];
  const slotNet: number[] = [];
  for (const p of pending) {
    const outBase = slotNet.length;
    const outs = p.outPins.map(netOf);
    for (const n of outs) slotNet.push(n);
    comps.push({ path: p.path, kind: p.kind, part: p.part, ins: p.inPins.map(netOf), outs, outBase, root: p.root });
  }

  const pinNet = new Map<string, number>();
  for (const [key, idx] of pinIndex) pinNet.set(key, netOf(idx));
  const wireNet = new Map<string, number>();
  if (root) {
    for (const w of root.wires) {
      const n = pinNet.get(`${w.a.part}:${w.a.pin}`);
      if (n !== undefined && pinNet.has(`${w.b.part}:${w.b.pin}`)) wireNet.set(w.id, n);
    }
  }

  const netCount = netOfRoot.size;
  const drivers: number[][] = Array.from({ length: netCount }, () => []);
  const readers: number[][] = Array.from({ length: netCount }, () => []);
  slotNet.forEach((n, slot) => drivers[n].push(slot));
  comps.forEach((c, i) => {
    for (const n of new Set(c.ins)) readers[n].push(i);
  });

  return {
    comps,
    netCount,
    drivers,
    readers,
    slotNet,
    slotCount: slotNet.length,
    pinNet,
    wireNet,
    compByPath: new Map(comps.map((c, i) => [c.path, i])),
    errors
  };
}

/** Chips used (directly or indirectly) by a circuit, so a chip can't be placed inside itself. */
export function chipDependencies(project: Project, circuitId: string): Set<string> {
  const out = new Set<string>();
  const visit = (id: string) => {
    const c = findCircuit(project, id);
    if (!c) return;
    for (const p of c.parts) {
      if (p.kind === 'chip' && p.chip && !out.has(p.chip)) {
        out.add(p.chip);
        visit(p.chip);
      }
    }
  };
  visit(circuitId);
  return out;
}

/** Chips that may be placed while editing `circuitId` (no recursion). */
export function placeableChips(project: Project, circuitId: string): Circuit[] {
  if (circuitId === MAIN_ID) return project.chips;
  return project.chips.filter((c) => c.id !== circuitId && !chipDependencies(project, c.id).has(circuitId));
}
