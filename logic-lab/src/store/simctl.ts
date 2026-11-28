// Owns the running simulation of the circuit being edited: recompiles when the circuit
// changes (carrying state over), drives the clock, animates gate-by-gate propagation,
// and records the waveform.
import { useSyncExternalStore } from 'react';
import { compile, findCircuit, type Netlist } from '../engine/compile.ts';
import { KIND_NAME, partSpec } from '../engine/parts.ts';
import { Simulator } from '../engine/sim.ts';
import type { PartKind, Project } from '../engine/types.ts';
import { VZ, type Val } from '../engine/values.ts';

export interface WaveSignal {
  id: string;
  label: string;
  kind: PartKind | 'probe';
  pin: string;
  /** Probe on a wire rather than a part. */
  wire?: string;
}

export interface WaveSample {
  /** Clock tick when the sample was taken. */
  t: number;
  /** Delta step within the tick (only in step-by-step mode). */
  d: number;
  v: Record<string, Val>;
}

export const MAX_SAMPLES = 400;
export const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128, 512, 2048];

type Listener = () => void;

const SOURCE_KINDS: PartKind[] = ['in', 'button', 'clock'];
const SINK_KINDS: PartKind[] = ['out', 'led'];

class SimController {
  sim: Simulator;
  nl: Netlist;
  private project: Project | null = null;
  private editing = '';
  private doc = -1;
  running = false;
  speed = 4;
  stepMode = false;
  version = 0;
  signals: WaveSignal[] = [];
  /** Wires shown in the waveform, per circuit id. */
  private probes = new Map<string, Set<string>>();
  samples: WaveSample[] = [];
  /** Delta steps run in the current tick (step mode). */
  private deltaInTick = 0;
  private listeners = new Set<Listener>();
  private raf = 0;
  private lastFrame = 0;
  private carryTicks = 0;
  /** Called when the simulation itself wants the inputs persisted (e.g. after toggles). */
  onInputsChanged: (() => void) | null = null;

  constructor() {
    this.nl = compile({ version: 1, main: { id: 'main', name: '', parts: [], wires: [] }, chips: [] });
    this.sim = new Simulator(this.nl);
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;

  private notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Recompile if the project or the edited circuit changed. */
  sync(project: Project, editing: string, doc = 0): void {
    if (project === this.project && editing === this.editing && doc === this.doc) return;
    const sameCircuit = editing === this.editing && doc === this.doc;
    this.doc = doc;
    const prevCircuit = this.project ? findCircuit(this.project, this.editing) : undefined;
    const nextCircuit = findCircuit(project, editing);
    this.project = project;
    this.editing = editing;
    // Chip definitions may have changed even if this circuit didn't, so always recompile.
    this.nl = compile(project, editing);
    this.sim = new Simulator(this.nl, sameCircuit ? this.sim : undefined);
    if (!sameCircuit || prevCircuit?.id !== nextCircuit?.id) {
      this.samples = [];
      this.deltaInTick = 0;
    }
    this.refreshSignals();
    this.settleNow();
    this.notify();
  }

  private refreshSignals(): void {
    const roots = this.nl.comps.filter((c) => c.root && (SOURCE_KINDS.includes(c.kind) || SINK_KINDS.includes(c.kind)));
    const pos = (a: (typeof roots)[number], b: (typeof roots)[number]) => a.part.y - b.part.y || a.part.x - b.part.x;
    const sources = roots.filter((c) => SOURCE_KINDS.includes(c.kind)).sort(pos);
    const sinks = roots.filter((c) => SINK_KINDS.includes(c.kind)).sort(pos);
    this.signals = [...sources, ...sinks].map((c) => ({
      id: c.part.id,
      kind: c.kind,
      label: c.part.label?.trim() || KIND_NAME[c.kind],
      pin: SOURCE_KINDS.includes(c.kind) ? 'o' : 'i'
    }));
    const circuit = this.project ? findCircuit(this.project, this.editing) : undefined;
    const probes = this.probes.get(this.editing);
    if (!circuit || !probes) return;
    let k = 0;
    for (const w of circuit.wires) {
      if (!probes.has(w.id) || !this.nl.wireNet.has(w.id)) continue;
      // Name the probe after the part driving the wire.
      const ends = [w.a, w.b].map((r) => ({ r, part: circuit.parts.find((p) => p.id === r.part) }));
      const project = this.project!;
      const src = ends.find((e) => e.part && partSpec(e.part, project).pins.find((p) => p.name === e.r.pin)?.dir === 'out') ?? ends[0];
      const name = src.part ? src.part.label?.trim() || KIND_NAME[src.part.kind] : '导线';
      this.signals.push({ id: `probe:${w.id}`, kind: 'probe', label: `${name}·${++k}`, pin: '', wire: w.id });
    }
  }

  isProbed(wireId: string): boolean {
    return this.probes.get(this.editing)?.has(wireId) ?? false;
  }

  toggleProbe(wireId: string): void {
    let set = this.probes.get(this.editing);
    if (!set) this.probes.set(this.editing, (set = new Set()));
    if (set.has(wireId)) set.delete(wireId);
    else set.add(wireId);
    this.refreshSignals();
    this.sample();
    this.notify();
  }

  private sample(): void {
    const v: Record<string, Val> = {};
    for (const s of this.signals) v[s.id] = s.wire ? this.wireValue(s.wire) : this.sim.pinValue(s.id, s.pin);
    const last = this.samples[this.samples.length - 1];
    if (last && last.t === this.sim.time && last.d === this.deltaInTick && this.signals.every((s) => last.v[s.id] === v[s.id])) return;
    this.samples.push({ t: this.sim.time, d: this.deltaInTick, v });
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  /** Settle immediately, or (in step mode) start animating the propagation. */
  private settleNow(): void {
    if (this.stepMode) {
      this.ensureLoop();
      this.sample();
      return;
    }
    this.sim.settle();
    this.sample();
  }

  pinValue(partId: string, pin: string): Val {
    return this.sim.pinValue(partId, pin);
  }

  wireValue(wireId: string): Val {
    const n = this.nl.wireNet.get(wireId);
    return n === undefined ? VZ : (this.sim.netVal[n] as Val);
  }

  netOfWire(wireId: string): number | undefined {
    return this.nl.wireNet.get(wireId);
  }

  toggleInput(partId: string): void {
    const v = this.sim.getInput(partId);
    if (v === undefined) return;
    this.sim.setInput(partId, v ? 0 : 1);
    this.deltaInTick = 0;
    this.settleNow();
    this.notify();
    this.onInputsChanged?.();
  }

  /** Set a number input (masked to its width). */
  setNumber(partId: string, value: number): void {
    if (!this.sim.setInput(partId, Math.max(0, Math.floor(value)))) return;
    this.deltaInTick = 0;
    this.settleNow();
    this.notify();
    this.onInputsChanged?.();
  }

  /** Bits of a pin of the circuit on screen: one value for a plain pin, one per bit for a bus. */
  pinBits(path: string, pin: string, width: number): Val[] {
    return width === 1 ? [this.sim.pinValue(path, pin)] : this.sim.busValue(path, pin, width);
  }

  setButton(partId: string, down: boolean): void {
    if (!this.sim.setInput(partId, down ? 1 : 0)) return;
    this.deltaInTick = 0;
    this.settleNow();
    this.notify();
  }

  inputValues(): Record<string, number> {
    return this.sim.inputValues();
  }

  /** One clock tick (normal mode), or one delta step / next tick (step mode). */
  step(): void {
    if (this.stepMode) {
      if (this.sim.pending) {
        this.sim.stepDelta();
        this.deltaInTick++;
      } else {
        this.sim.advanceClocks();
        this.deltaInTick = 0;
        if (!this.sim.pending) {
          this.sample();
          this.notify();
          return;
        }
        this.sim.stepDelta();
        this.deltaInTick = 1;
      }
      this.sample();
      this.notify();
      return;
    }
    this.sim.tick();
    this.deltaInTick = 0;
    this.sample();
    this.notify();
  }

  reset(): void {
    this.sim.reset();
    this.samples = [];
    this.deltaInTick = 0;
    this.settleNow();
    this.notify();
  }

  clearWave(): void {
    this.samples = [];
    this.sample();
    this.notify();
  }

  setRunning(on: boolean): void {
    this.running = on;
    if (on) this.ensureLoop();
    this.notify();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.notify();
  }

  setStepMode(on: boolean): void {
    this.stepMode = on;
    if (!on && this.sim.pending) {
      this.sim.settle();
      this.sample();
    }
    if (on) this.ensureLoop();
    this.notify();
  }

  get busy(): boolean {
    return this.sim.pending;
  }

  private ensureLoop(): void {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return;
    this.lastFrame = performance.now();
    this.carryTicks = 0;
    const frame = (now: number) => {
      this.raf = 0;
      const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      let changed = false;
      if (this.stepMode) {
        // Propagation is animated at a fixed, watchable pace.
        if (this.running || this.sim.pending) {
          this.carryTicks += dt * Math.min(20, Math.max(4, this.speed * 2));
          let n = Math.floor(this.carryTicks);
          this.carryTicks -= n;
          while (n-- > 0) {
            if (!this.running && !this.sim.pending) break;
            this.step();
            changed = true;
          }
        }
      } else if (this.running) {
        this.carryTicks += dt * this.speed;
        let n = Math.min(4096, Math.floor(this.carryTicks));
        this.carryTicks -= n;
        while (n-- > 0) {
          this.sim.tick();
          this.sample();
          changed = true;
        }
      }
      if (changed) this.notify();
      if (this.running || (this.stepMode && this.sim.pending)) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
}

export const simctl = new SimController();

export function useSimVersion(): number {
  return useSyncExternalStore(simctl.subscribe, simctl.getVersion);
}
