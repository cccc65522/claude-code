// Small helper for building circuits in code (examples, challenges, tests, synthesis).
import { partSpec } from './parts.ts';
import type { Circuit, Part, PartKind, Project, Rot } from './types.ts';

export type PartOpts = Partial<Omit<Part, 'id' | 'kind' | 'x' | 'y'>> & { id?: string };

export class CircuitBuilder {
  readonly parts: Part[] = [];
  readonly wires: Circuit['wires'] = [];
  private counter = 0;
  private readonly id: string;
  private readonly name: string;
  private readonly project?: Project;
  private readonly prefix: string;

  constructor(id: string, name: string, opts: { project?: Project; prefix?: string } = {}) {
    this.id = id;
    this.name = name;
    this.project = opts.project;
    this.prefix = opts.prefix ?? 'p';
  }

  add(kind: PartKind, x: number, y: number, opts: PartOpts = {}): string {
    const { id, ...rest } = opts;
    const pid = id ?? `${this.prefix}${++this.counter}`;
    this.parts.push({ id: pid, kind, x, y, rot: (rest.rot ?? 0) as Rot, ...rest });
    return pid;
  }

  /**
   * Connect two pins. A pin is written "partId.pin"; a bare "partId" means the part's
   * first output pin (or, for parts without outputs, its first input pin).
   */
  wire(a: string, b: string, bend?: number): this {
    const w: Circuit['wires'][number] = { id: `w${this.wires.length + 1}_${this.prefix}`, a: this.ref(a), b: this.ref(b) };
    if (bend !== undefined) w.bend = bend;
    this.wires.push(w);
    return this;
  }

  private ref(s: string): { part: string; pin: string } {
    const dot = s.indexOf('.');
    if (dot >= 0) return { part: s.slice(0, dot), pin: s.slice(dot + 1) };
    const part = this.parts.find((p) => p.id === s);
    if (!part) throw new Error(`unknown part ${s}`);
    const pins = partSpec(part, this.project).pins;
    const pin = pins.find((p) => p.dir === 'out') ?? pins[0];
    if (!pin) throw new Error(`part ${s} has no pins`);
    return { part: s, pin: pin.name };
  }

  build(): Circuit {
    return { id: this.id, name: this.name, parts: this.parts, wires: this.wires };
  }
}

export function emptyProject(): Project {
  return { version: 1, main: { id: 'main', name: '主电路', parts: [], wires: [] }, chips: [] };
}
