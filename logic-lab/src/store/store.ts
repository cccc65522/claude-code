// Editor state: the project being edited, selection, undo/redo history, views and UI
// state. A tiny external store read from React with useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import { emptyProject } from '../engine/builder.ts';
import { findCircuit, placeableChips } from '../engine/compile.ts';
import { boundsOf } from '../engine/expr.ts';
import { checkLevel, levelById, levelCircuit, type CheckResult } from '../engine/levels.ts';
import { bendAxis } from '../engine/geometry.ts';
import { packageParts, PackageError } from '../engine/package.ts';
import { clampInputs, isMultiInputGate, partBounds, partSpec, placedPins } from '../engine/parts.ts';
import { parseProject, projectToJSON } from '../engine/serialize.ts';
import type { Circuit, Part, PartKind, PinRef, Project, Rot, Wire } from '../engine/types.ts';
import { MAIN_ID } from '../engine/types.ts';

export interface View {
  /** Screen position (px) of grid origin. */
  x: number;
  y: number;
  /** Pixels per grid unit. */
  zoom: number;
}

export type Workspace = { mode: 'free' } | { mode: 'level'; id: string };
export type Tab = 'props' | 'table' | 'chips' | 'levels';
export type Dialog = null | 'examples' | 'expr' | 'help';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'ok';
}

export interface EditorState {
  workspace: Workspace;
  project: Project;
  editing: string;
  selParts: string[];
  selWires: string[];
  past: Project[];
  future: Project[];
  views: Record<string, View>;
  tab: Tab;
  waveOpen: boolean;
  sheetOpen: boolean;
  theme: 'auto' | 'light' | 'dark';
  progress: Record<string, number>;
  check: CheckResult | null;
  toast: Toast | null;
  dialog: Dialog;
  /** Pin picked by a tap, waiting for a second tap to finish a wire. */
  pendingPin: PinRef | null;
  /** Bumped whenever a different document is opened (resets the simulation). */
  doc: number;
}

export const DEFAULT_ZOOM = 18;
const HISTORY_LIMIT = 200;
const LS = {
  free: 'mendao.free.v1',
  level: (id: string) => `mendao.level.${id}.v1`,
  progress: 'mendao.progress.v1',
  ui: 'mendao.ui.v1'
};

// ---------------------------------------------------------------------------
// Storage helpers (storage can be unavailable or full: never let it break the app)

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function loadProjectFrom(key: string): Project | null {
  const raw = readLS(key);
  if (!raw) return null;
  try {
    return parseProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

function levelProject(id: string): Project {
  const saved = loadProjectFrom(LS.level(id));
  if (saved) return saved;
  const level = levelById(id);
  const p = emptyProject();
  if (level) p.main = levelCircuit(level);
  return p;
}

// ---------------------------------------------------------------------------

type Listener = () => void;

class Store {
  private state: EditorState;
  private listeners = new Set<Listener>();

  constructor(initial: EditorState) {
    this.state = initial;
  }
  get = (): EditorState => this.state;
  set = (patch: Partial<EditorState>): void => {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  };
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

function initialState(): EditorState {
  let ui: Partial<EditorState> & { workspace?: Workspace } = {};
  try {
    ui = JSON.parse(readLS(LS.ui) ?? '{}');
  } catch {
    ui = {};
  }
  let progress: Record<string, number> = {};
  try {
    progress = JSON.parse(readLS(LS.progress) ?? '{}');
  } catch {
    progress = {};
  }
  const workspace: Workspace = ui.workspace?.mode === 'level' && levelById(ui.workspace.id) ? ui.workspace : { mode: 'free' };
  const project = workspace.mode === 'level' ? levelProject(workspace.id) : loadProjectFrom(LS.free) ?? null;
  return {
    workspace,
    project: project ?? emptyProject(),
    editing: MAIN_ID,
    selParts: [],
    selWires: [],
    past: [],
    future: [],
    views: {},
    tab: ui.tab === 'table' || ui.tab === 'chips' || ui.tab === 'levels' ? ui.tab : workspace.mode === 'level' ? 'levels' : 'props',
    waveOpen: ui.waveOpen ?? false,
    sheetOpen: false,
    theme: ui.theme === 'light' || ui.theme === 'dark' ? ui.theme : 'auto',
    progress,
    check: null,
    toast: null,
    dialog: null,
    pendingPin: null,
    doc: 0
  };
}

export const store = new Store(initialState());
/** Whether the free-mode project was empty at start-up (first visit → show an example). */
export const firstVisit = readLS(LS.free) === null && store.get().workspace.mode === 'free';

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

// ---------------------------------------------------------------------------
// Ids

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1296;
  return `${prefix}${Date.now().toString(36).slice(-5)}${idCounter.toString(36).padStart(2, '0')}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Circuit helpers

export function currentCircuit(s: EditorState = store.get()): Circuit {
  return findCircuit(s.project, s.editing) ?? s.project.main;
}

function replaceCircuit(p: Project, c: Circuit): Project {
  if (c.id === MAIN_ID) return { ...p, main: c };
  return { ...p, chips: p.chips.map((x) => (x.id === c.id ? c : x)) };
}

/** Apply an edit to the circuit being edited, recording it in the undo history. */
export function editCircuit(fn: (c: Circuit) => Circuit | null, extra: Partial<EditorState> = {}): void {
  const s = store.get();
  const before = currentCircuit(s);
  const after = fn(before);
  if (!after || after === before) {
    if (Object.keys(extra).length) store.set(extra);
    return;
  }
  commit(replaceCircuit(s.project, after), extra);
}

export function commit(project: Project, extra: Partial<EditorState> = {}): void {
  const s = store.get();
  const past = [...s.past, s.project];
  if (past.length > HISTORY_LIMIT) past.shift();
  const next = { project, past, future: [], check: null, ...extra };
  // Drop selection of things that no longer exist.
  const c = findCircuit(project, extra.editing ?? s.editing) ?? project.main;
  const partIds = new Set(c.parts.map((p) => p.id));
  const wireIds = new Set(c.wires.map((w) => w.id));
  next.selParts = (extra.selParts ?? s.selParts).filter((id) => partIds.has(id));
  next.selWires = (extra.selWires ?? s.selWires).filter((id) => wireIds.has(id));
  store.set(next);
}

export function undo(): void {
  const s = store.get();
  const prev = s.past[s.past.length - 1];
  if (!prev) return;
  const editing = findCircuit(prev, s.editing) ? s.editing : MAIN_ID;
  store.set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], editing, selParts: [], selWires: [], check: null });
}

export function redo(): void {
  const s = store.get();
  const next = s.future[0];
  if (!next) return;
  const editing = findCircuit(next, s.editing) ? s.editing : MAIN_ID;
  store.set({ project: next, future: s.future.slice(1), past: [...s.past, s.project], editing, selParts: [], selWires: [], check: null });
}

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  store.set({ toast: { id: ++toastId, text, kind } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => store.set({ toast: null }), kind === 'error' ? 4500 : 2600);
}

// ---------------------------------------------------------------------------
// Views

let canvasSize = { w: 800, h: 600 };
export function setCanvasSize(w: number, h: number): void {
  canvasSize = { w, h };
}
export function getCanvasSize() {
  return canvasSize;
}

export function viewFor(s: EditorState, id = s.editing): View {
  return s.views[id] ?? fitView(findCircuit(s.project, id) ?? s.project.main, s.project);
}

export function setView(v: View): void {
  const s = store.get();
  store.set({ views: { ...s.views, [s.editing]: v } });
}

export function fitView(c: Circuit, project: Project): View {
  const { w, h } = canvasSize;
  if (c.parts.length === 0) return { x: Math.round(w * 0.3), y: Math.round(h * 0.3), zoom: DEFAULT_ZOOM };
  const b = circuitBounds(c, project);
  const pad = 3;
  const zoom = Math.max(6, Math.min(32, Math.min(w / (b.w + pad * 2), h / (b.h + pad * 2))));
  return { x: w / 2 - (b.x + b.w / 2) * zoom, y: h / 2 - (b.y + b.h / 2) * zoom, zoom };
}

export function circuitBounds(c: Circuit, project: Project) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of c.parts) {
    const b = partBounds(p, project);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h + (p.label ? 0 : 0));
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0 - 1, w: x1 - x0, h: y1 - y0 + 1 };
}

export function zoomToFit(): void {
  const s = store.get();
  setView(fitView(currentCircuit(s), s.project));
}

/** Grid point at the centre of the visible canvas. */
export function viewCenter(): { x: number; y: number } {
  const s = store.get();
  const v = viewFor(s);
  return { x: Math.round((canvasSize.w / 2 - v.x) / v.zoom), y: Math.round((canvasSize.h / 2 - v.y) / v.zoom) };
}

// ---------------------------------------------------------------------------
// Parts and wires

export function defaultProps(kind: PartKind): Partial<Part> {
  if (isMultiInputGate(kind)) return { n: 2 };
  if (kind === 'clock') return { period: 1 };
  if (kind === 'const') return { value: 1 };
  if (kind === 'led') return { color: 'red' };
  if (kind === 'text') return { text: '双击编辑文字' };
  if (kind === 'tunnel') return { label: 'N1' };
  if (kind === 'rom') return { abits: 4, dbits: 4, data: Array.from({ length: 16 }, (_, i) => i) };
  if (kind === 'ram') return { abits: 4, dbits: 4 };
  if (kind === 'reg') return { dbits: 4 };
  return {};
}

function nextLabel(c: Circuit, kind: 'in' | 'out'): string {
  const used = new Set(c.parts.filter((p) => p.kind === kind).map((p) => p.label));
  const pool = kind === 'in' ? 'ABCDEFGHIJKLMN' : 'YZWVUTSRQPO';
  for (const ch of pool) if (!used.has(ch)) return ch;
  let i = 1;
  while (used.has(`${kind === 'in' ? 'I' : 'O'}${i}`)) i++;
  return `${kind === 'in' ? 'I' : 'O'}${i}`;
}

/** Find a free spot near (x, y) so new parts don't land on top of each other. */
function freeSpot(c: Circuit, project: Project, part: Part): { x: number; y: number } {
  const spec = partSpec(part, project);
  const w = part.rot % 2 ? spec.h : spec.w;
  const h = part.rot % 2 ? spec.w : spec.h;
  const boxes = c.parts.map((p) => partBounds(p, project));
  const hits = (x: number, y: number) => boxes.some((b) => x < b.x + b.w + 1 && b.x < x + w + 1 && y < b.y + b.h + 1 && b.y < y + h + 1);
  for (let r = 0; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = part.x + dx * 2;
        const y = part.y + dy * 2;
        if (!hits(x, y)) return { x, y };
      }
    }
  }
  return { x: part.x, y: part.y };
}

export function addPart(kind: PartKind, x: number, y: number, extra: Partial<Part> = {}, opts: { exact?: boolean } = {}): string {
  const id = newId(kind === 'chip' ? 'c' : 'p');
  const s = store.get();
  editCircuit((c) => {
    const part: Part = { id, kind, x, y, rot: 0, ...defaultProps(kind), ...extra };
    if ((kind === 'in' || kind === 'out') && !part.label) part.label = nextLabel(c, kind);
    const spec = partSpec(part, s.project);
    // Centre on the requested point.
    part.x = Math.round(x - spec.w / 2);
    part.y = Math.round(y - spec.h / 2);
    if (!opts.exact) Object.assign(part, freeSpot(c, s.project, part));
    return { ...c, parts: [...c.parts, part] };
  }, { selParts: [id], selWires: [], pendingPin: null });
  return id;
}

export function addChipInstance(chipId: string, x: number, y: number, exact = false): void {
  const s = store.get();
  if (!placeableChips(s.project, s.editing).some((c) => c.id === chipId)) {
    toast('不能把芯片放进它自己里面', 'error');
    return;
  }
  const def = s.project.chips.find((c) => c.id === chipId);
  addPart('chip', x, y, { chip: chipId, label: def?.name }, { exact });
}

/** Axis of a wire's movable middle segment in a circuit (see geometry.bendAxis). */
export function wireAxis(c: Circuit, project: Project, w: Wire): 'x' | 'y' | null {
  const pin = (ref: PinRef) => {
    const part = c.parts.find((p) => p.id === ref.part);
    return part ? placedPins(part, partSpec(part, project)).find((p) => p.name === ref.pin) : undefined;
  };
  let a = pin(w.a);
  let b = pin(w.b);
  if (!a || !b) return null;
  if (a.dir === 'in' && b.dir === 'out') [a, b] = [b, a];
  return bendAxis([a.wx, a.wy], a.wside, [b.wx, b.wy], b.wside);
}

/** After parts moved or turned, keep manual wire bends meaningful. */
function fixBends(before: Circuit, after: Circuit, project: Project, moved: Set<string>, dx: number, dy: number): Circuit {
  let changed = false;
  const wires = after.wires.map((w) => {
    if (w.bend === undefined || (!moved.has(w.a.part) && !moved.has(w.b.part))) return w;
    const ax0 = wireAxis(before, project, w);
    const ax1 = wireAxis(after, project, w);
    changed = true;
    if (moved.has(w.a.part) && moved.has(w.b.part) && ax0 === ax1 && ax1) return { ...w, bend: w.bend + (ax1 === 'x' ? dx : dy) };
    if (ax0 === ax1) return w;
    const { bend: _bend, ...rest } = w;
    return rest;
  });
  return changed ? { ...after, wires } : after;
}

export function movePartsBy(ids: readonly string[], dx: number, dy: number): void {
  if (!dx && !dy) return;
  const set = new Set(ids);
  const project = store.get().project;
  editCircuit((c) => fixBends(c, { ...c, parts: c.parts.map((p) => (set.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)) }, project, set, dx, dy));
}

export function setWireBend(id: string, bend: number | undefined): void {
  editCircuit((c) => {
    const w = c.wires.find((x) => x.id === id);
    if (!w || w.bend === bend) return null;
    const next: Wire = { id: w.id, a: w.a, b: w.b };
    if (bend !== undefined) next.bend = bend;
    return { ...c, wires: c.wires.map((x) => (x.id === id ? next : x)) };
  });
}

export function updatePart(id: string, patch: Partial<Part>): void {
  editCircuit((c) => {
    const old = c.parts.find((p) => p.id === id);
    if (!old) return null;
    const next = { ...old, ...patch };
    if (patch.n !== undefined) next.n = clampInputs(patch.n);
    let wires = c.wires;
    // Shrinking a gate drops wires on pins that no longer exist.
    if (patch.n !== undefined || patch.chip !== undefined || patch.abits !== undefined || patch.dbits !== undefined) {
      const pins = new Set(partSpec(next, store.get().project).pins.map((p) => p.name));
      wires = wires.filter((w) => !((w.a.part === id && !pins.has(w.a.pin)) || (w.b.part === id && !pins.has(w.b.pin))));
    }
    return { ...c, parts: c.parts.map((p) => (p.id === id ? next : p)), wires };
  });
}

export function rotateSelection(dir: 1 | -1 = 1): void {
  const s = store.get();
  const ids = new Set(s.selParts);
  if (!ids.size) return;
  editCircuit((c) => fixBends(c, {
    ...c,
    parts: c.parts.map((p) => {
      if (!ids.has(p.id)) return p;
      const before = partBounds(p, s.project);
      const rot = (((p.rot + dir) % 4) + 4) % 4 as Rot;
      const after = { ...p, rot };
      const b2 = partBounds(after, s.project);
      // Keep the centre where it was.
      after.x = Math.round(before.x + before.w / 2 - b2.w / 2);
      after.y = Math.round(before.y + before.h / 2 - b2.h / 2);
      return after;
    })
  }, s.project, ids, 0, 0));
}

export function deleteSelection(): void {
  const s = store.get();
  const c = currentCircuit(s);
  const locked = c.parts.filter((p) => p.locked && s.selParts.includes(p.id));
  const parts = new Set(s.selParts.filter((id) => !locked.some((p) => p.id === id)));
  const wires = new Set(s.selWires);
  if (!parts.size && !wires.size) {
    if (locked.length) toast('闯关的输入、输出引脚不能删除', 'error');
    return;
  }
  editCircuit(
    (cc) => ({
      ...cc,
      parts: cc.parts.filter((p) => !parts.has(p.id)),
      wires: cc.wires.filter((w) => !wires.has(w.id) && !parts.has(w.a.part) && !parts.has(w.b.part))
    }),
    { selParts: [], selWires: [] }
  );
}

export function deleteWire(id: string): void {
  editCircuit((c) => ({ ...c, wires: c.wires.filter((w) => w.id !== id) }));
}

export function connect(a: PinRef, b: PinRef): boolean {
  if (a.part === b.part && a.pin === b.pin) return false;
  const c = currentCircuit();
  const same = (x: PinRef, y: PinRef) => x.part === y.part && x.pin === y.pin;
  if (c.wires.some((w) => (same(w.a, a) && same(w.b, b)) || (same(w.a, b) && same(w.b, a)))) {
    toast('这两个引脚已经连上了');
    return false;
  }
  const id = newId('w');
  editCircuit((cc) => ({ ...cc, wires: [...cc.wires, { id, a, b }] }), { pendingPin: null, selWires: [], selParts: [] });
  return true;
}

export function select(parts: string[], wires: string[] = [], additive = false): void {
  const s = store.get();
  if (additive) {
    const toggle = (list: string[], ids: string[]) => {
      const set = new Set(list);
      for (const id of ids) set.has(id) ? set.delete(id) : set.add(id);
      return [...set];
    };
    store.set({ selParts: toggle(s.selParts, parts), selWires: toggle(s.selWires, wires) });
  } else store.set({ selParts: parts, selWires: wires });
}

export function selectAll(): void {
  const c = currentCircuit();
  store.set({ selParts: c.parts.map((p) => p.id), selWires: c.wires.map((w) => w.id) });
}

// ---------------------------------------------------------------------------
// Clipboard

let clipboard: { parts: Part[]; wires: Wire[] } | null = null;
let pasteCount = 0;

export function copySelection(): boolean {
  const s = store.get();
  const c = currentCircuit(s);
  const ids = new Set(s.selParts);
  const parts = c.parts.filter((p) => ids.has(p.id) && !p.locked);
  if (!parts.length) return false;
  const keep = new Set(parts.map((p) => p.id));
  clipboard = { parts, wires: c.wires.filter((w) => keep.has(w.a.part) && keep.has(w.b.part)) };
  pasteCount = 0;
  return true;
}

export function cutSelection(): void {
  if (copySelection()) deleteSelection();
}

/** Insert parts and wires with fresh ids, offset by (dx, dy), and select them. */
export function insertParts(parts: readonly Part[], wires: readonly Wire[], dx: number, dy: number, sel = true): void {
  const s = store.get();
  const allowed = new Set(placeableChips(s.project, s.editing).map((c) => c.id));
  const map = new Map<string, string>();
  const fresh = parts
    .filter((p) => p.kind !== 'chip' || (p.chip && allowed.has(p.chip)))
    .map((p) => {
      const id = newId(p.kind === 'chip' ? 'c' : 'p');
      map.set(p.id, id);
      const { locked: _locked, ...rest } = p;
      return { ...rest, id, x: p.x + dx, y: p.y + dy };
    });
  const freshWires = wires
    .filter((w) => map.has(w.a.part) && map.has(w.b.part))
    .map((w) => ({ id: newId('w'), a: { part: map.get(w.a.part)!, pin: w.a.pin }, b: { part: map.get(w.b.part)!, pin: w.b.pin } }));
  if (fresh.length < parts.length) toast('有芯片不能放进当前电路（会形成递归），已跳过', 'error');
  editCircuit((c) => ({ ...c, parts: [...c.parts, ...fresh], wires: [...c.wires, ...freshWires] }), sel ? { selParts: fresh.map((p) => p.id), selWires: freshWires.map((w) => w.id) } : {});
}

export function paste(): void {
  if (!clipboard) {
    toast('剪贴板是空的');
    return;
  }
  pasteCount++;
  insertParts(clipboard.parts, clipboard.wires, 2 * pasteCount, 2 * pasteCount);
}

export function duplicateSelection(): void {
  if (copySelection()) paste();
}

/** Insert a whole circuit (e.g. a synthesised one) centred in the view. */
export function insertCircuit(c: Circuit): void {
  const b = boundsOf(c.parts);
  const center = viewCenter();
  insertParts(c.parts, c.wires, Math.round(center.x - b.x - b.w / 2), Math.round(center.y - b.y - b.h / 2));
}

// ---------------------------------------------------------------------------
// Chips

export function chipUsage(project: Project, chipId: string): string[] {
  return [project.main, ...project.chips].filter((c) => c.parts.some((p) => p.kind === 'chip' && p.chip === chipId)).map((c) => c.name);
}

export function enterCircuit(id: string): void {
  const s = store.get();
  if (!findCircuit(s.project, id)) return;
  store.set({ editing: id, selParts: [], selWires: [], pendingPin: null, tab: id === MAIN_ID ? s.tab : s.tab === 'levels' ? 'props' : s.tab });
}

function uniqueChipName(project: Project, base: string): string {
  const names = new Set(project.chips.map((c) => c.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export function createChip(from?: Circuit, name = '新芯片', enter = true): string {
  const s = store.get();
  const id = newId('chip');
  let chip: Circuit;
  if (from) {
    chip = { ...structuredClone(from), id, name: uniqueChipName(s.project, name) };
  } else {
    chip = {
      id,
      name: uniqueChipName(s.project, name),
      parts: [
        { id: newId('p'), kind: 'in', x: 0, y: 0, rot: 0, label: 'A' },
        { id: newId('p'), kind: 'in', x: 0, y: 4, rot: 0, label: 'B' },
        { id: newId('p'), kind: 'out', x: 16, y: 2, rot: 0, label: 'Y' },
        { id: newId('p'), kind: 'text', x: 0, y: -5, rot: 0, text: '芯片内部：输入引脚是芯片左边的接口，输出引脚是右边的接口（按上下顺序）。' }
      ],
      wires: []
    };
  }
  commit({ ...s.project, chips: [...s.project.chips, chip] }, enter ? { editing: id, selParts: [], selWires: [] } : {});
  return id;
}

export function renameCircuit(id: string, name: string): void {
  const s = store.get();
  const c = findCircuit(s.project, id);
  const clean = name.trim().slice(0, 40);
  if (!c || !clean || c.name === clean) return;
  let p = replaceCircuit(s.project, { ...c, name: clean });
  if (id !== MAIN_ID) {
    // Instances keep showing the chip's name.
    const relabel = (cc: Circuit): Circuit =>
      cc.parts.some((x) => x.kind === 'chip' && x.chip === id)
        ? { ...cc, parts: cc.parts.map((x) => (x.kind === 'chip' && x.chip === id && (x.label === c.name || !x.label) ? { ...x, label: clean } : x)) }
        : cc;
    p = { ...p, main: relabel(p.main), chips: p.chips.map(relabel) };
  }
  commit(p);
}

export function deleteChip(id: string): void {
  const s = store.get();
  const used = chipUsage(s.project, id);
  if (used.length) {
    toast(`“${used.join('、')}”里还在用这个芯片，先删掉那些实例`, 'error');
    return;
  }
  commit({ ...s.project, chips: s.project.chips.filter((c) => c.id !== id) }, s.editing === id ? { editing: MAIN_ID } : {});
}

// ---------------------------------------------------------------------------
// Projects and workspaces

export function loadProject(p: Project, message?: string): void {
  const s = store.get();
  if (s.workspace.mode === 'level') {
    toast('闯关模式下不能打开项目，先切换到“自由实验”', 'error');
    return;
  }
  commit(p, { editing: MAIN_ID, selParts: [], selWires: [], views: {}, pendingPin: null, doc: s.doc + 1 });
  if (message) toast(message, 'ok');
}

export function newProject(): void {
  const s = store.get();
  if (s.workspace.mode === 'level') {
    resetLevel();
    return;
  }
  loadProject(emptyProject(), '已新建空白电路（可以撤销）');
}

export function switchWorkspace(ws: Workspace, saveCurrent: () => void): void {
  saveCurrent();
  const project = ws.mode === 'level' ? levelProject(ws.id) : loadProjectFrom(LS.free) ?? emptyProject();
  store.set({
    workspace: ws,
    project,
    editing: MAIN_ID,
    past: [],
    future: [],
    selParts: [],
    selWires: [],
    views: {},
    check: null,
    pendingPin: null,
    doc: store.get().doc + 1,
    tab: ws.mode === 'level' ? 'levels' : store.get().tab === 'levels' ? 'props' : store.get().tab
  });
  saveUI();
}

export function resetLevel(): void {
  const s = store.get();
  if (s.workspace.mode !== 'level') return;
  const level = levelById(s.workspace.id);
  if (!level) return;
  commit({ ...emptyProject(), main: levelCircuit(level) }, { selParts: [], selWires: [] });
  toast('已恢复到这一关的初始电路（可以撤销）');
}

export function runCheck(): CheckResult | null {
  const s = store.get();
  if (s.workspace.mode !== 'level') return null;
  const level = levelById(s.workspace.id);
  if (!level) return null;
  const res = checkLevel(level, s.project.main);
  const progress = { ...s.progress };
  if (res.pass && res.stars > (progress[level.id] ?? 0)) {
    progress[level.id] = res.stars;
    writeLS(LS.progress, JSON.stringify(progress));
  }
  store.set({ check: res, progress });
  return res;
}

/** Save the current project (with the live values of input switches) to local storage. */
export function saveProject(inputs: Record<string, 0 | 1>): void {
  const s = store.get();
  const p = withInputValues(s.project, s.editing, inputs);
  writeLS(s.workspace.mode === 'level' ? LS.level(s.workspace.id) : LS.free, projectToJSON(p));
}

export function withInputValues(p: Project, circuitId: string, inputs: Record<string, 0 | 1>): Project {
  const c = findCircuit(p, circuitId);
  if (!c || !c.parts.some((x) => x.kind === 'in' && inputs[x.id] !== undefined && (x.value ?? 0) !== inputs[x.id])) return p;
  return replaceCircuit(p, { ...c, parts: c.parts.map((x) => (x.kind === 'in' && inputs[x.id] !== undefined ? { ...x, value: inputs[x.id] } : x)) });
}

export function saveUI(): void {
  const s = store.get();
  writeLS(LS.ui, JSON.stringify({ workspace: s.workspace, tab: s.tab, waveOpen: s.waveOpen, theme: s.theme }));
}

/** Move the selected logic into a new chip and put an instance of it in its place. */
export function packageSelection(): boolean {
  const s = store.get();
  if (s.workspace.mode === 'level') {
    toast('闯关模式下不能封装芯片', 'error');
    return false;
  }
  try {
    const name = uniqueChipName(s.project, '新芯片');
    const res = packageParts(s.project, s.editing, s.selParts, { chipId: newId('chip'), name, newId });
    commit(res.project, { selParts: [res.instanceId], selWires: [] });
    toast(`已封装为芯片“${name}”：${res.inputs} 个输入、${res.outputs} 个输出。可以在“芯片”页改名`, 'ok');
    return true;
  } catch (e) {
    if (e instanceof PackageError) toast(e.message, 'error');
    else throw e;
    return false;
  }
}
