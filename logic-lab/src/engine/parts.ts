// Part catalogue: size and pin layout of every kind of part, and how pins move when a
// part is rotated. Geometry is in grid units; a pin always sits on a grid point.
import type { Circuit, GateKind, Part, PartKind, Project, Rot } from './types.ts';

export type Side = 'W' | 'E' | 'N' | 'S';

export interface PinSpec {
  name: string;
  dir: 'in' | 'out';
  /** Position in the unrotated local frame. */
  x: number;
  y: number;
  side: Side;
  /** Short text drawn next to the pin (flip-flop D/C/Q, chip pin labels …). */
  label?: string;
}

export interface PartSpec {
  w: number;
  h: number;
  pins: PinSpec[];
}

export const GATE_KINDS: readonly GateKind[] = ['buf', 'not', 'and', 'or', 'xor', 'nand', 'nor', 'xnor'];

export function isGate(kind: PartKind): kind is GateKind {
  return (GATE_KINDS as readonly string[]).includes(kind);
}

export function isMultiInputGate(kind: PartKind): boolean {
  return isGate(kind) && kind !== 'buf' && kind !== 'not';
}

export const MIN_INPUTS = 2;
export const MAX_INPUTS = 8;

export const KIND_NAME: Record<PartKind, string> = {
  in: '输入引脚',
  out: '输出引脚',
  button: '按钮',
  clock: '时钟',
  const: '常量',
  led: '指示灯',
  hex: '十六进制显示',
  seg7: '七段数码管',
  buf: '缓冲器',
  not: '非门',
  and: '与门',
  or: '或门',
  xor: '异或门',
  nand: '与非门',
  nor: '或非门',
  xnor: '同或门',
  tri: '三态门',
  mux: '二选一',
  dff: 'D 触发器',
  jkff: 'JK 触发器',
  tff: 'T 触发器',
  chip: '芯片',
  text: '文字'
};

/** Parts that hold state between ticks (their output depends on history). */
export const STATEFUL_KINDS: ReadonlySet<PartKind> = new Set(['dff', 'jkff', 'tff', 'clock', 'button']);

/** Interface of a chip definition: its `in` parts become input pins, `out` parts output pins, top to bottom. */
export function chipInterface(def: Circuit): { inputs: Part[]; outputs: Part[] } {
  const byPos = (a: Part, b: Part) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1);
  return {
    inputs: def.parts.filter((p) => p.kind === 'in').sort(byPos),
    outputs: def.parts.filter((p) => p.kind === 'out').sort(byPos)
  };
}

export function pinLabel(p: Part, index: number, prefix: string): string {
  return p.label?.trim() || `${prefix}${index + 1}`;
}

function gateInputs(n: number, h: number): PinSpec[] {
  const pins: PinSpec[] = [];
  if (n === 1) {
    pins.push({ name: 'i0', dir: 'in', x: 0, y: h / 2, side: 'W' });
    return pins;
  }
  for (let i = 0; i < n; i++) pins.push({ name: `i${i}`, dir: 'in', x: 0, y: 1 + 2 * i, side: 'W' });
  return pins;
}

export function textSize(text: string): { w: number; h: number } {
  const lines = (text || ' ').split('\n');
  const longest = Math.max(...lines.map((l) => [...l].reduce((s, ch) => s + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1.1), 0)));
  return { w: Math.max(2, Math.ceil(longest * 0.65) + 1), h: Math.max(2, lines.length * 2) };
}

/**
 * Size and pins of a part in its unrotated frame. Chip instances need the project to
 * look up their definition; an unknown chip has no pins.
 */
export function partSpec(part: Part, project?: Project): PartSpec {
  const k = part.kind;
  switch (k) {
    case 'in':
    case 'button':
    case 'const':
      return { w: 2, h: 2, pins: [{ name: 'o', dir: 'out', x: 2, y: 1, side: 'E' }] };
    case 'clock':
      return { w: 3, h: 2, pins: [{ name: 'o', dir: 'out', x: 3, y: 1, side: 'E' }] };
    case 'out':
    case 'led':
      return { w: 2, h: 2, pins: [{ name: 'i', dir: 'in', x: 0, y: 1, side: 'W' }] };
    case 'hex':
      return {
        w: 4,
        h: 6,
        pins: [0, 1, 2, 3].map((i) => ({ name: `d${i}`, dir: 'in' as const, x: 0, y: 1 + i, side: 'W' as const, label: String(1 << i) }))
      };
    case 'seg7':
      return {
        w: 4,
        h: 8,
        pins: 'abcdefg'.split('').map((s, i) => ({ name: s, dir: 'in' as const, x: 0, y: 1 + i, side: 'W' as const, label: s }))
      };
    case 'buf':
    case 'not':
      return { w: 3, h: 2, pins: [...gateInputs(1, 2), { name: 'o', dir: 'out', x: 3, y: 1, side: 'E' }] };
    case 'and':
    case 'or':
    case 'xor':
    case 'nand':
    case 'nor':
    case 'xnor': {
      const n = clampInputs(part.n);
      const h = 2 * n;
      return { w: 4, h, pins: [...gateInputs(n, h), { name: 'o', dir: 'out', x: 4, y: h / 2, side: 'E' }] };
    }
    case 'tri':
      return {
        w: 4,
        h: 4,
        pins: [
          { name: 'i', dir: 'in', x: 0, y: 2, side: 'W' },
          { name: 'en', dir: 'in', x: 2, y: 4, side: 'S', label: 'EN' },
          { name: 'o', dir: 'out', x: 4, y: 2, side: 'E' }
        ]
      };
    case 'mux':
      return {
        w: 4,
        h: 6,
        pins: [
          { name: 'a', dir: 'in', x: 0, y: 2, side: 'W', label: '0' },
          { name: 'b', dir: 'in', x: 0, y: 4, side: 'W', label: '1' },
          { name: 's', dir: 'in', x: 2, y: 6, side: 'S', label: 'S' },
          { name: 'o', dir: 'out', x: 4, y: 3, side: 'E' }
        ]
      };
    case 'dff':
    case 'tff':
      return {
        w: 5,
        h: 6,
        pins: [
          { name: k === 'dff' ? 'd' : 't', dir: 'in', x: 0, y: 1, side: 'W', label: k === 'dff' ? 'D' : 'T' },
          { name: 'c', dir: 'in', x: 0, y: 5, side: 'W', label: '>' },
          { name: 'clr', dir: 'in', x: 2, y: 6, side: 'S', label: 'R' },
          { name: 'q', dir: 'out', x: 5, y: 1, side: 'E', label: 'Q' },
          { name: 'nq', dir: 'out', x: 5, y: 5, side: 'E', label: 'Q̄' }
        ]
      };
    case 'jkff':
      return {
        w: 5,
        h: 6,
        pins: [
          { name: 'j', dir: 'in', x: 0, y: 1, side: 'W', label: 'J' },
          { name: 'c', dir: 'in', x: 0, y: 3, side: 'W', label: '>' },
          { name: 'k', dir: 'in', x: 0, y: 5, side: 'W', label: 'K' },
          { name: 'clr', dir: 'in', x: 2, y: 6, side: 'S', label: 'R' },
          { name: 'q', dir: 'out', x: 5, y: 1, side: 'E', label: 'Q' },
          { name: 'nq', dir: 'out', x: 5, y: 5, side: 'E', label: 'Q̄' }
        ]
      };
    case 'chip': {
      const def = project?.chips.find((c) => c.id === part.chip);
      if (!def) return { w: 6, h: 4, pins: [] };
      const { inputs, outputs } = chipInterface(def);
      const rows = Math.max(1, inputs.length, outputs.length);
      const longest = Math.max(
        0,
        ...inputs.map((p, i) => pinLabel(p, i, 'I').length),
        ...outputs.map((p, i) => pinLabel(p, i, 'O').length)
      );
      const w = Math.max(6, Math.min(14, 2 + 2 * Math.ceil(longest * 0.55) + 2));
      const h = 2 * rows;
      const pins: PinSpec[] = [];
      inputs.forEach((p, i) => pins.push({ name: p.id, dir: 'in', x: 0, y: 1 + 2 * i, side: 'W', label: pinLabel(p, i, 'I') }));
      outputs.forEach((p, i) => pins.push({ name: p.id, dir: 'out', x: w, y: 1 + 2 * i, side: 'E', label: pinLabel(p, i, 'O') }));
      return { w, h: Math.max(h, 2), pins };
    }
    case 'text': {
      const { w, h } = textSize(part.text ?? '');
      return { w, h, pins: [] };
    }
  }
}

export function clampInputs(n: number | undefined): number {
  const v = Math.round(n ?? 2);
  return Math.min(MAX_INPUTS, Math.max(MIN_INPUTS, Number.isFinite(v) ? v : 2));
}

// ---------------------------------------------------------------------------
// Rotation

/** Map a point in the unrotated local frame (w × h box) to the rotated frame. */
export function rotatePoint(x: number, y: number, w: number, h: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0:
      return [x, y];
    case 1:
      return [h - y, x];
    case 2:
      return [w - x, h - y];
    case 3:
      return [y, w - x];
  }
}

const SIDES: Side[] = ['N', 'E', 'S', 'W'];
export function rotateSide(side: Side, rot: Rot): Side {
  return SIDES[(SIDES.indexOf(side) + rot) % 4];
}

export function rotatedSize(spec: { w: number; h: number }, rot: Rot): { w: number; h: number } {
  return rot % 2 === 0 ? { w: spec.w, h: spec.h } : { w: spec.h, h: spec.w };
}

export interface PlacedPin extends PinSpec {
  /** World grid position. */
  wx: number;
  wy: number;
  wside: Side;
}

export function placedPins(part: Part, spec: PartSpec): PlacedPin[] {
  return spec.pins.map((p) => {
    const [rx, ry] = rotatePoint(p.x, p.y, spec.w, spec.h, part.rot);
    return { ...p, wx: part.x + rx, wy: part.y + ry, wside: rotateSide(p.side, part.rot) };
  });
}

export function sideVector(side: Side): [number, number] {
  switch (side) {
    case 'N':
      return [0, -1];
    case 'S':
      return [0, 1];
    case 'E':
      return [1, 0];
    case 'W':
      return [-1, 0];
  }
}

/** Bounding box of a placed part in grid units. */
export function partBounds(part: Part, project?: Project): { x: number; y: number; w: number; h: number } {
  const { w, h } = rotatedSize(partSpec(part, project), part.rot);
  return { x: part.x, y: part.y, w, h };
}
