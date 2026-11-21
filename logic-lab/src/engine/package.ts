// "Package as chip": move a group of parts into a new chip definition, give the chip one
// interface pin per connection that crossed the group's boundary, and put an instance
// of the chip where the group was, wired up the same way.
import { findCircuit } from './compile.ts';
import { partBounds, partSpec, placedPins } from './parts.ts';
import type { Circuit, Part, PartKind, PinRef, Project, Wire } from './types.ts';

/** Switches, lamps and displays stay outside: they are how you use a chip, not part of it. */
const STAYS_OUTSIDE: ReadonlySet<PartKind> = new Set(['in', 'out', 'button', 'clock', 'led', 'hex', 'seg7', 'text', 'tunnel']);

export interface PackageResult {
  project: Project;
  chipId: string;
  instanceId: string;
  inputs: number;
  outputs: number;
}

export class PackageError extends Error {}

const key = (r: PinRef) => `${r.part}:${r.pin}`;

export function packageParts(
  project: Project,
  circuitId: string,
  ids: readonly string[],
  opts: { chipId: string; name: string; newId: (prefix: string) => string }
): PackageResult {
  const circuit = findCircuit(project, circuitId);
  if (!circuit) throw new PackageError('找不到电路');
  const wanted = new Set(ids);
  const inside = circuit.parts.filter((p) => wanted.has(p.id) && !p.locked && !STAYS_OUTSIDE.has(p.kind));
  if (inside.length === 0) throw new PackageError('请先选中要封装的逻辑门、触发器或芯片（开关、指示灯、显示器会留在外面）');
  const inSet = new Set(inside.map((p) => p.id));
  const partById = new Map(circuit.parts.map((p) => [p.id, p]));
  const pinDir = (r: PinRef) => partSpec(partById.get(r.part)!, project).pins.find((p) => p.name === r.pin)?.dir;

  const internal: Wire[] = [];
  const keepOutside: Wire[] = [];
  // Boundary groups. Inputs are grouped by the outside pin that feeds them (one chip
  // input per outside source); outputs by the inside pin that drives them.
  const inGroups = new Map<string, { outer: PinRef; inner: PinRef[] }>();
  const outGroups = new Map<string, { inner: PinRef; outer: PinRef[] }>();
  for (const w of circuit.wires) {
    const aIn = inSet.has(w.a.part);
    const bIn = inSet.has(w.b.part);
    if (aIn && bIn) internal.push(w);
    else if (!aIn && !bIn) keepOutside.push(w);
    else {
      const inner = aIn ? w.a : w.b;
      const outer = aIn ? w.b : w.a;
      if (pinDir(inner) === 'out') {
        const g = outGroups.get(key(inner)) ?? { inner, outer: [] };
        g.outer.push(outer);
        outGroups.set(key(inner), g);
      } else {
        const g = inGroups.get(key(outer)) ?? { outer, inner: [] };
        g.inner.push(inner);
        inGroups.set(key(outer), g);
      }
    }
  }

  // Where things are, to lay out the interface pins next to what they connect to.
  const pinY = (r: PinRef): number => {
    const part = partById.get(r.part)!;
    return placedPins(part, partSpec(part, project)).find((p) => p.name === r.pin)?.wy ?? part.y;
  };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of inside) {
    const b = partBounds(p, project);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }

  const label = (r: PinRef, fallback: string): string => {
    const p = partById.get(r.part);
    if (p && (p.kind === 'in' || p.kind === 'out' || p.kind === 'led' || p.kind === 'clock' || p.kind === 'button') && p.label) return p.label;
    return fallback;
  };
  const used = new Set<string>();
  const unique = (s: string) => {
    let name = s;
    for (let i = 2; used.has(name); i++) name = `${s}${i}`;
    used.add(name);
    return name;
  };
  const spread = (ys: number[]): number[] => {
    // Keep the order, but at least 4 grid units apart.
    const out: number[] = [];
    for (const y of ys) out.push(out.length ? Math.max(y, out[out.length - 1] + 4) : y);
    return out;
  };

  // Chip contents: the moved parts, shifted so the chip's origin is near (0, 0).
  const dx = 8 - x0;
  const dy = 2 - y0;
  const chipParts: Part[] = inside.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  const chipWires: Wire[] = internal.map((w) => ({ ...w }));

  const inList = [...inGroups.values()]
    .map((g) => ({ g, y: Math.round(g.inner.reduce((s, r) => s + pinY(r), 0) / g.inner.length) }))
    .sort((a, b) => a.y - b.y);
  const inYs = spread(inList.map((x) => x.y + dy - 1));
  const inPins = inList.map(({ g }, i) => {
    const id = opts.newId('p');
    chipParts.push({ id, kind: 'in', x: 0, y: inYs[i], rot: 0, label: unique(label(g.outer, `I${i + 1}`)) });
    for (const r of g.inner) chipWires.push({ id: opts.newId('w'), a: { part: id, pin: 'o' }, b: r });
    return { id, g };
  });
  const outList = [...outGroups.values()].map((g) => ({ g, y: Math.round(pinY(g.inner)) })).sort((a, b) => a.y - b.y);
  const outYs = spread(outList.map((x) => x.y + dy - 1));
  const outPins = outList.map(({ g }, i) => {
    const id = opts.newId('p');
    chipParts.push({ id, kind: 'out', x: x1 + dx + 6, y: outYs[i], rot: 0, label: unique(label(g.outer[0], `O${i + 1}`)) });
    chipWires.push({ id: opts.newId('w'), a: g.inner, b: { part: id, pin: 'i' } });
    return { id, g };
  });
  const chip: Circuit = { id: opts.chipId, name: opts.name, parts: chipParts, wires: chipWires };

  // The instance replaces the group, centred where it was.
  const instanceId = opts.newId('c');
  const withChip: Project = { ...project, chips: [...project.chips, chip] };
  const instance: Part = { id: instanceId, kind: 'chip', chip: chip.id, label: chip.name, x: 0, y: 0, rot: 0 };
  const spec = partSpec(instance, withChip);
  instance.x = Math.round((x0 + x1) / 2 - spec.w / 2);
  instance.y = Math.round((y0 + y1) / 2 - spec.h / 2);
  const newWires: Wire[] = [...keepOutside];
  for (const { id, g } of inPins) newWires.push({ id: opts.newId('w'), a: g.outer, b: { part: instanceId, pin: id } });
  for (const { id, g } of outPins) for (const r of g.outer) newWires.push({ id: opts.newId('w'), a: { part: instanceId, pin: id }, b: r });
  const parent: Circuit = {
    ...circuit,
    parts: [...circuit.parts.filter((p) => !inSet.has(p.id)), instance],
    wires: newWires
  };
  const project2: Project =
    circuitId === withChip.main.id && circuit === project.main
      ? { ...withChip, main: parent }
      : { ...withChip, chips: withChip.chips.map((c) => (c.id === circuitId ? parent : c)) };
  return { project: project2, chipId: chip.id, instanceId, inputs: inPins.length, outputs: outPins.length };
}
