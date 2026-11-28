// The circuit editor canvas: pan/zoom, placing and dragging parts, drawing wires,
// selection, and interacting with switches and buttons while the simulation runs.
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent as RPointerEvent, type ReactElement } from 'react';
import { findCircuit } from '../engine/compile.ts';
import { bendAxis, pathD, route, type Pt } from '../engine/geometry.ts';
import { memBits, partBounds, partSpec, pinWidth, placedPins, type PartSpec, type PlacedPin } from '../engine/parts.ts';
import type { Part, PartKind, PinRef, Project } from '../engine/types.ts';
import { busNumber, busSummary, type Val } from '../engine/values.ts';
import { simctl, useSimVersion } from '../store/simctl.ts';
import {
  addChipInstance,
  addPart,
  connect,
  enterInstance,
  livePrefix,
  fitView,
  movePartsBy,
  select,
  setWireBend,
  wireAxis,
  setCanvasSize,
  setView,
  store,
  useEditor,
  type View
} from '../store/store.ts';
import { PartView, valClass } from './PartShape.tsx';

// Cache specs per part object so memoised part views stay cheap.
const specCache = new WeakMap<Part, { def: unknown; spec: PartSpec }>();
export function specOf(part: Part, project: Project): PartSpec {
  const def = part.kind === 'chip' ? project.chips.find((c) => c.id === part.chip) : null;
  const hit = specCache.get(part);
  if (hit && hit.def === def) return hit.spec;
  const spec = partSpec(part, project);
  specCache.set(part, { def, spec });
  return spec;
}

type Interaction =
  | { type: 'none' }
  | { type: 'pan'; sx: number; sy: number; view: View; moved: boolean }
  | { type: 'part'; id: string; sx: number; sy: number; wx: number; wy: number; moved: boolean; additive: boolean; wasSelected: boolean }
  | { type: 'button'; id: string; sx: number; sy: number }
  | { type: 'wire'; from: PinRef; sx: number; sy: number; moved: boolean }
  | { type: 'bend'; id: string; axis: 'x' | 'y'; sx: number; sy: number; moved: boolean }
  | { type: 'box'; wx: number; wy: number; additive: boolean }
  | { type: 'pinch'; d0: number; mx: number; my: number; view: View };

const DRAG_THRESHOLD = 5;

export function Canvas() {
  const project = useEditor((s) => s.project);
  const editing = useEditor((s) => s.editing);
  const selParts = useEditor((s) => s.selParts);
  const selWires = useEditor((s) => s.selWires);
  const pendingPin = useEditor((s) => s.pendingPin);
  /** Netlist path prefix when looking inside a chip instance of the running circuit. */
  const prefix = useEditor(livePrefix);
  const views = useEditor((s) => s.views);
  useSimVersion();
  const circuit = findCircuit(project, editing) ?? project.main;
  const svgRef = useRef<SVGSVGElement>(null);
  // 0 until the ResizeObserver has measured the canvas: fitting the first view to a guessed
  // size made it too big on phones and too small on wide screens.
  const [size, setSize] = useState({ w: 0, h: 0 });
  const view = views[editing] ?? null;
  const v: View = view ?? { x: size.w * 0.3, y: size.h * 0.3, zoom: 18 };

  const inter = useRef<Interaction>({ type: 'none' });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [drag, setDrag] = useState<{ ids: Set<string>; dx: number; dy: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [wireFrom, setWireFrom] = useState<PinRef | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [bendPreview, setBendPreview] = useState<{ id: string; value: number } | null>(null);

  // Track canvas size; give each circuit an initial fitted view.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
      setCanvasSize(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!view && size.w > 0) {
      const s = store.get();
      const c = findCircuit(s.project, s.editing) ?? s.project.main;
      setView(fitView(c, s.project));
    }
  }, [view, size.w, editing]);

  const selPartSet = useMemo(() => new Set(selParts), [selParts]);
  const selWireSet = useMemo(() => new Set(selWires), [selWires]);

  // Pin positions (with the drag offset applied to parts being moved).
  const pins = useMemo(() => {
    const map = new Map<string, PlacedPin & { part: Part }>();
    for (const part of circuit.parts) {
      const moving = drag?.ids.has(part.id);
      const p = moving ? { ...part, x: part.x + drag!.dx, y: part.y + drag!.dy } : part;
      for (const pin of placedPins(p, specOf(part, project))) map.set(`${part.id}:${pin.name}`, { ...pin, part });
    }
    return map;
  }, [circuit, project, drag]);

  const connected = useMemo(() => {
    const set = new Set<string>();
    for (const w of circuit.wires) {
      set.add(`${w.a.part}:${w.a.pin}`);
      set.add(`${w.b.part}:${w.b.pin}`);
    }
    return set;
  }, [circuit]);

  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  };

  const nearestPin = (wx: number, wy: number, exclude?: PinRef): PinRef | null => {
    let best: PinRef | null = null;
    let bestD = 0.9;
    for (const [key, p] of pins) {
      const d = Math.hypot(p.wx - wx, p.wy - wy);
      if (d < bestD && !(exclude && key === `${exclude.part}:${exclude.pin}`)) {
        bestD = d;
        best = { part: p.part.id, pin: p.name };
      }
    }
    return best;
  };

  // Wheel zoom (non-passive so the page doesn't scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = store.get();
      const cur = s.views[s.editing];
      if (!cur) return;
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const scale = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const zoom = Math.max(4, Math.min(80, cur.zoom * scale));
        const k = zoom / cur.zoom;
        setView({ x: mx - (mx - cur.x) * k, y: my - (my - cur.y) * k, zoom });
      } else {
        setView({ ...cur, x: cur.x - e.deltaX, y: cur.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** The pin to connect to when a new wire is dropped onto an existing one (same signal). */
  const wireAnchor = (wireId: string, from: PinRef): PinRef | null => {
    const wire = circuit.wires.find((x) => x.id === wireId);
    if (!wire) return null;
    const fromDir = pins.get(`${from.part}:${from.pin}`)?.dir;
    const aDir = pins.get(`${wire.a.part}:${wire.a.pin}`)?.dir;
    // An input joins the wire at its driver; an output joins at the far end.
    const wantDir = fromDir === 'out' ? 'in' : 'out';
    const pick = aDir === wantDir ? wire.a : wire.b;
    return pick.part === from.part && pick.pin === from.pin ? (pick === wire.a ? wire.b : wire.a) : pick;
  };
  const wireAnchorAt = (clientX: number, clientY: number, from: PinRef): PinRef | null => {
    const id = document.elementFromPoint(clientX, clientY)?.closest('[data-wire]')?.getAttribute('data-wire');
    return id ? wireAnchor(id, from) : null;
  };

  const startPinch = () => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const r = svgRef.current!.getBoundingClientRect();
    inter.current = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, view: v };
    setDrag(null);
    setWireFrom(null);
    setBox(null);
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svgRef.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      if (inter.current.type === 'button') simctl.setButton(prefix + inter.current.id, false);
      setPressed(null);
      startPinch();
      return;
    }
    if (pointers.current.size > 2) return;
    const target = (e.target as Element).closest('[data-pin],[data-part],[data-wire]');
    const w = toWorld(e.clientX, e.clientY);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (e.button === 1 || e.button === 2) {
      inter.current = { type: 'pan', sx: e.clientX, sy: e.clientY, view: v, moved: true };
      return;
    }
    const pinAttr = target?.getAttribute('data-pin');
    if (pinAttr) {
      const [part, pin] = pinAttr.split(':');
      inter.current = { type: 'wire', from: { part, pin }, sx: e.clientX, sy: e.clientY, moved: false };
      return;
    }
    const partId = target?.getAttribute('data-part');
    if (partId) {
      const part = circuit.parts.find((p) => p.id === partId);
      if (!part) return;
      const wasSelected = selPartSet.has(partId);
      if (!wasSelected) select([partId], [], additive);
      if (part.kind === 'button') {
        simctl.setButton(prefix + partId, true);
        setPressed(partId);
        inter.current = { type: 'button', id: partId, sx: e.clientX, sy: e.clientY };
        return;
      }
      inter.current = { type: 'part', id: partId, sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y, moved: false, additive, wasSelected };
      return;
    }
    const wireId = target?.getAttribute('data-wire');
    const pp = store.get().pendingPin;
    if (wireId && pp) {
      // Tap-tap wiring onto an existing wire joins its signal.
      const anchor = wireAnchor(wireId, pp);
      if (anchor) connect(pp, anchor);
      inter.current = { type: 'none' };
      return;
    }
    if (wireId) {
      select([], [wireId], additive);
      const wire = circuit.wires.find((x) => x.id === wireId);
      const axis = wire ? wireAxis(circuit, project, wire) : null;
      inter.current = axis ? { type: 'bend', id: wireId, axis, sx: e.clientX, sy: e.clientY, moved: false } : { type: 'none' };
      return;
    }
    if (additive) {
      inter.current = { type: 'box', wx: w.x, wy: w.y, additive };
      setBox({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
      return;
    }
    inter.current = { type: 'pan', sx: e.clientX, sy: e.clientY, view: v, moved: false };
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const it = inter.current;
    const w = toWorld(e.clientX, e.clientY);
    if (it.type === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const r = svgRef.current!.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      const zoom = Math.max(4, Math.min(80, (it.view.zoom * d) / it.d0));
      const k = zoom / it.view.zoom;
      setView({ x: mx - (it.mx - it.view.x) * k, y: my - (it.my - it.view.y) * k, zoom });
      return;
    }
    const far = (sx: number, sy: number) => Math.hypot(e.clientX - sx, e.clientY - sy) > DRAG_THRESHOLD;
    switch (it.type) {
      case 'pan':
        if (!it.moved && !far(it.sx, it.sy)) return;
        it.moved = true;
        setView({ ...it.view, x: it.view.x + e.clientX - it.sx, y: it.view.y + e.clientY - it.sy });
        return;
      case 'part': {
        if (!it.moved && !far(it.sx, it.sy)) return;
        it.moved = true;
        const ids = new Set(store.get().selParts);
        ids.add(it.id);
        setDrag({ ids, dx: Math.round(w.x - it.wx), dy: Math.round(w.y - it.wy) });
        return;
      }
      case 'button':
        return;
      case 'bend':
        if (!it.moved && !far(it.sx, it.sy)) return;
        it.moved = true;
        setBendPreview({ id: it.id, value: Math.round((it.axis === 'x' ? w.x : w.y) * 2) / 2 });
        return;
      case 'wire':
        if (!it.moved && !far(it.sx, it.sy)) return;
        it.moved = true;
        setWireFrom(it.from);
        setCursor(w);
        return;
      case 'box':
        setBox({ x0: it.wx, y0: it.wy, x1: w.x, y1: w.y });
        return;
      default:
        if (pendingPin) setCursor(w);
    }
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const it = inter.current;
    if (it.type === 'pinch') {
      if (pointers.current.size === 0) inter.current = { type: 'none' };
      return;
    }
    inter.current = { type: 'none' };
    const w = toWorld(e.clientX, e.clientY);
    switch (it.type) {
      case 'part': {
        const part = circuit.parts.find((p) => p.id === it.id);
        if (it.moved && drag) {
          movePartsBy([...drag.ids], drag.dx, drag.dy);
        } else if (part) {
          if (part.kind === 'in') simctl.toggleInput(prefix + part.id);
          if (part.kind === 'bin') {
            // Click counts up; Shift+click (or Alt+click) counts down.
            const size = 1 << memBits(part).d;
            const cur = simctl.sim.getInput(prefix + part.id) ?? 0;
            simctl.setNumber(prefix + part.id, (cur + (e.shiftKey || e.altKey ? size - 1 : 1)) % size);
          }
          if (it.additive && it.wasSelected) select([part.id], [], true);
          else if (!it.additive) select([part.id]);
        }
        setDrag(null);
        return;
      }
      case 'button':
        simctl.setButton(prefix + it.id, false);
        setPressed(null);
        return;
      case 'bend':
        if (it.moved && bendPreview) setWireBend(it.id, bendPreview.value);
        setBendPreview(null);
        return;
      case 'wire': {
        setWireFrom(null);
        if (it.moved) {
          const to = nearestPin(w.x, w.y, it.from) ?? wireAnchorAt(e.clientX, e.clientY, it.from);
          if (to) connect(it.from, to);
          store.set({ pendingPin: null });
        } else {
          // Tap-tap wiring.
          const pp = store.get().pendingPin;
          if (pp && !(pp.part === it.from.part && pp.pin === it.from.pin)) connect(pp, it.from);
          else store.set({ pendingPin: pp ? null : it.from });
          setCursor(w);
        }
        return;
      }
      case 'box': {
        if (box) {
          const x0 = Math.min(box.x0, box.x1);
          const x1 = Math.max(box.x0, box.x1);
          const y0 = Math.min(box.y0, box.y1);
          const y1 = Math.max(box.y0, box.y1);
          const inside = circuit.parts
            .filter((p) => {
              const b = partBounds(p, project);
              return b.x >= x0 && b.y >= y0 && b.x + b.w <= x1 && b.y + b.h <= y1;
            })
            .map((p) => p.id);
          const set = new Set(inside);
          const wires = circuit.wires.filter((wi) => set.has(wi.a.part) && set.has(wi.b.part)).map((wi) => wi.id);
          if (it.additive) {
            const s = store.get();
            select([...new Set([...s.selParts, ...inside])], [...new Set([...s.selWires, ...wires])]);
          } else select(inside, wires);
        }
        setBox(null);
        return;
      }
      case 'pan':
        if (!it.moved) {
          select([], []);
          store.set({ pendingPin: null });
        }
        return;
    }
  };

  const onDoubleClick = (e: MouseEvent) => {
    // Pointer capture retargets click events to the <svg>, so look up what is under the pointer.
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-pin],[data-part],[data-wire]');
    const wireId = hit?.getAttribute('data-wire');
    if (wireId) {
      setWireBend(wireId, undefined); // back to automatic routing
      return;
    }
    const id = hit?.getAttribute('data-part');
    const part = id ? circuit.parts.find((p) => p.id === id) : undefined;
    if (part?.kind === 'chip' && part.chip) enterInstance(part.id);
    else if (part?.kind === 'text') {
      store.set({ tab: 'props', sheetOpen: true, selParts: [part.id], selWires: [] });
      setTimeout(() => (document.querySelector('#prop-text') as HTMLTextAreaElement | null)?.focus(), 50);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-mendao');
    if (!raw) return;
    try {
      const { kind, chip } = JSON.parse(raw) as { kind: PartKind; chip?: string };
      const w = toWorld(e.clientX, e.clientY);
      if (kind === 'chip' && chip) addChipInstance(chip, w.x, w.y, true);
      else addPart(kind, w.x, w.y, {}, { exact: true });
    } catch {
      /* ignore */
    }
  };

  // ------------------------------------------------------------------ render
  const sim = simctl;
  const unstable = sim.sim.unstableNets;
  const wireViews = circuit.wires.map((wire) => {
    let a = pins.get(`${wire.a.part}:${wire.a.pin}`);
    let b = pins.get(`${wire.b.part}:${wire.b.pin}`);
    if (!a || !b) return null;
    if (a.dir === 'in' && b.dir === 'out') [a, b] = [b, a];
    let bend = bendPreview?.id === wire.id ? bendPreview.value : wire.bend;
    if (bend !== undefined && drag && drag.ids.has(wire.a.part) && drag.ids.has(wire.b.part)) {
      bend += bendAxis([a.wx, a.wy], a.wside, [b.wx, b.wy], b.wside) === 'x' ? drag.dx : drag.dy;
    }
    const pts = route([a.wx, a.wy], a.wside, [b.wx, b.wy], b.wside, bend);
    // Both ends of a wire are on the same net(s); read it through the first end so this
    // also works inside a chip instance (prefixed netlist paths).
    const width = pinWidth(a);
    const bits = sim.pinBits(prefix + wire.a.part, wire.a.pin, width);
    const val = width > 1 ? busSummary(bits) : bits[0];
    const net = sim.nl.pinNet.get(`${prefix}${wire.a.part}:${wire.a.pin}${width > 1 ? '#0' : ''}`);
    const osc = net !== undefined && unstable.has(net);
    const sel = selWireSet.has(wire.id);
    const d = pathD(pts);
    const word = width > 1 ? busNumber(bits) : null;
    return (
      <g key={wire.id} className={`wire ${valClass(val)}${width > 1 ? ' bus' : ''}${sel ? ' selected' : ''}${osc ? ' osc' : ''}`} data-wire-id={wire.id}>
        <path className="wire-hit" d={d} data-wire={wire.id} />
        {sel && <path className="wire-halo" d={d} />}
        <path className="wire-line" d={d} />
        {width > 1 && (
          <text className="bus-label" x={(pts[0][0] + pts[1][0]) / 2} y={(pts[0][1] + pts[1][1]) / 2 - 0.35}>
            {word === null ? `${width}位` : word.toString(16).toUpperCase()}
          </text>
        )}
      </g>
    );
  });

  const partViews = circuit.parts.map((part) => {
    const spec = specOf(part, project);
    const vals: Val[] = spec.pins.map((p) => {
      const bits = sim.pinBits(prefix + part.id, p.name, pinWidth(p));
      return bits.length > 1 ? busSummary(bits) : bits[0];
    });
    let word: string | undefined;
    if (part.kind === 'bin') word = (sim.sim.getInput(prefix + part.id) ?? part.num ?? 0).toString(16).toUpperCase();
    else if (part.kind === 'num') {
      const n = busNumber(sim.pinBits(prefix + part.id, 'i', pinWidth(spec.pins[0])));
      word = n === null ? '' : `${n.toString(16).toUpperCase()}|${n}`;
    }
    const def = part.kind === 'chip' ? project.chips.find((c) => c.id === part.chip) : undefined;
    const moving = drag?.ids.has(part.id);
    return (
      <PartView
        key={part.id}
        part={part}
        spec={spec}
        selected={selPartSet.has(part.id)}
        vals={vals}
        pressed={pressed === part.id || (part.kind === 'button' && sim.sim.getInput(prefix + part.id) === 1)}
        chipName={def?.name}
        missing={part.kind === 'chip' && !def}
        word={word}
        dx={moving ? drag!.dx : 0}
        dy={moving ? drag!.dy : 0}
        dragging={moving}
      />
    );
  });

  const pinViews: ReactElement[] = [];
  for (const [key, p] of pins) {
    const pbits = sim.pinBits(prefix + p.part.id, p.name, pinWidth(p));
    const val = pbits.length > 1 ? busSummary(pbits) : pbits[0];
    const isPending = pendingPin && `${pendingPin.part}:${pendingPin.pin}` === key;
    const isFrom = wireFrom && `${wireFrom.part}:${wireFrom.pin}` === key;
    pinViews.push(
      <g key={key} className={`pin ${p.dir} ${valClass(val)}${pinWidth(p) > 1 ? ' bus' : ''}${connected.has(key) ? ' connected' : ''}${isPending || isFrom ? ' active' : ''}`}>
        <circle className="pin-dot" cx={p.wx} cy={p.wy} r={0.2} />
        <circle className="pin-hit" cx={p.wx} cy={p.wy} r={0.6} data-pin={key}>
          <title>{p.label ? `${p.label}（${p.dir === 'in' ? '输入' : '输出'}）` : p.dir === 'in' ? '输入引脚' : '输出引脚'}</title>
        </circle>
      </g>
    );
  }

  // Rubber band for a wire being drawn.
  let rubber: ReactElement | null = null;
  const from = wireFrom ?? pendingPin;
  if (from && cursor) {
    const a = pins.get(`${from.part}:${from.pin}`);
    if (a) {
      const target = nearestPin(cursor.x, cursor.y, from);
      const tp = target ? pins.get(`${target.part}:${target.pin}`) : undefined;
      const end: Pt = tp ? [tp.wx, tp.wy] : [cursor.x, cursor.y];
      const pts = tp ? route([a.wx, a.wy], a.wside, end, tp.wside) : [[a.wx, a.wy] as Pt, end];
      rubber = (
        <g className="rubber">
          <path d={pathD(pts)} />
          {tp && <circle cx={tp.wx} cy={tp.wy} r={0.45} />}
        </g>
      );
    }
  }

  const gridStep = v.zoom >= 10 ? 1 : 5;
  const gs = gridStep * v.zoom;
  return (
    <svg
      ref={svgRef}
      className={`canvas${drag ? ' is-dragging' : ''}${pendingPin ? ' is-wiring' : ''}`}
      data-testid="canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <defs>
        <pattern id="grid" width={gs} height={gs} patternUnits="userSpaceOnUse" x={v.x % gs} y={v.y % gs}>
          <circle cx={0.5} cy={0.5} r={Math.max(0.6, Math.min(1.2, v.zoom / 16))} className="grid-dot" />
        </pattern>
      </defs>
      <rect className="grid-bg" width="100%" height="100%" fill="url(#grid)" />
      <g transform={`translate(${v.x} ${v.y}) scale(${v.zoom})`}>
        <g className="layer-wires">{wireViews}</g>
        <g className="layer-parts">{partViews}</g>
        <g className="layer-pins">{pinViews}</g>
        {rubber}
        {box && (
          <rect
            className="box-select"
            x={Math.min(box.x0, box.x1)}
            y={Math.min(box.y0, box.y1)}
            width={Math.abs(box.x1 - box.x0)}
            height={Math.abs(box.y1 - box.y0)}
          />
        )}
      </g>
    </svg>
  );
}
