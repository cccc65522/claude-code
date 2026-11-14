// SVG drawing of every kind of part, in grid units. The body is drawn in the part's
// local (unrotated) frame and rotated; labels and readouts are drawn upright on top.
import { memo, type ReactNode } from 'react';
import { KIND_NAME, type PartSpec } from '../engine/parts.ts';
import type { Part } from '../engine/types.ts';
import { VAL_NAME, type Val } from '../engine/values.ts';

export const valClass = (v: Val | undefined): string => (v === undefined ? 'vz' : ['v0', 'v1', 'vx', 'vz', 've'][v]);

export function rotationTransform(rot: number, w: number, h: number): string | undefined {
  switch (rot) {
    case 1:
      return `translate(${h} 0) rotate(90)`;
    case 2:
      return `translate(${w} ${h}) rotate(180)`;
    case 3:
      return `translate(0 ${w}) rotate(270)`;
    default:
      return undefined;
  }
}

const BUBBLE_R = 0.22;

function gateBody(kind: string, w: number, h: number): ReactNode {
  const negated = kind === 'nand' || kind === 'nor' || kind === 'xnor' || kind === 'not';
  const x0 = kind === 'xor' || kind === 'xnor' ? 0.9 : 0.5;
  const x1 = negated ? w - 0.5 - 2 * BUBBLE_R : w - 0.5;
  const y0 = 0.15;
  const y1 = h - 0.15;
  const hm = h / 2;
  let d: string;
  if (kind === 'and' || kind === 'nand') {
    const rx = Math.min((x1 - x0) * 0.6, hm + 0.5);
    const a = x1 - rx;
    d = `M${x0} ${y0} H${a} A${rx} ${hm - y0} 0 0 1 ${a} ${y1} H${x0} Z`;
  } else if (kind === 'or' || kind === 'nor' || kind === 'xor' || kind === 'xnor') {
    const c = x0 + (x1 - x0) * 0.55;
    d = `M${x0} ${y0} Q${c} ${y0} ${x1} ${hm} Q${c} ${y1} ${x0} ${y1} Q${x0 + 0.7} ${hm} ${x0} ${y0} Z`;
  } else {
    d = `M${x0} ${y0} L${x1} ${hm} L${x0} ${y1} Z`;
  }
  const inputs: number[] = [];
  if (kind === 'not' || kind === 'buf') inputs.push(hm);
  else for (let y = 1; y < h; y += 2) inputs.push(y);
  return (
    <>
      {inputs.map((y) => (
        <line key={y} className="stub" x1={0} y1={y} x2={x0 + 0.5} y2={y} />
      ))}
      <line className="stub" x1={x1} y1={hm} x2={w} y2={hm} />
      {(kind === 'xor' || kind === 'xnor') && <path className="body-line" d={`M0.4 ${y0} Q${1.1} ${hm} 0.4 ${y1}`} />}
      <path className="body" d={d} />
      {negated && <circle className="body" cx={x1 + BUBBLE_R} cy={hm} r={BUBBLE_R} />}
    </>
  );
}

const SEGMENT_POLYS: Record<string, string> = {
  a: '1.2,0.9 1.45,0.65 2.85,0.65 3.1,0.9 2.85,1.15 1.45,1.15',
  b: '3.15,0.95 3.4,1.2 3.4,3.6 3.15,3.85 2.9,3.6 2.9,1.2',
  c: '3.15,4.15 3.4,4.4 3.4,6.8 3.15,7.05 2.9,6.8 2.9,4.4',
  d: '1.2,7.1 1.45,6.85 2.85,6.85 3.1,7.1 2.85,7.35 1.45,7.35',
  e: '1.15,4.15 1.4,4.4 1.4,6.8 1.15,7.05 0.9,6.8 0.9,4.4',
  f: '1.15,0.95 1.4,1.2 1.4,3.6 1.15,3.85 0.9,3.6 0.9,1.2',
  g: '1.2,4.0 1.45,3.75 2.85,3.75 3.1,4.0 2.85,4.25 1.45,4.25'
};

export interface PartViewProps {
  part: Part;
  spec: PartSpec;
  selected: boolean;
  /** Values of the part's pins, in spec order. */
  vals: Val[];
  /** Stored state for display: button pressed. */
  pressed?: boolean;
  chipName?: string;
  missing?: boolean;
  dragging?: boolean;
  dx?: number;
  dy?: number;
}

function hexDigit(vals: Val[]): string {
  if (vals.some((v) => v !== 0 && v !== 1)) return vals.some((v) => v === 4) ? 'E' : '-';
  return (vals[0] + 2 * vals[1] + 4 * vals[2] + 8 * vals[3]).toString(16).toUpperCase();
}

function PartViewImpl({ part, spec, selected, vals, pressed, chipName, missing, dx = 0, dy = 0, dragging }: PartViewProps) {
  const { w, h } = spec;
  const W = part.rot % 2 ? h : w;
  const H = part.rot % 2 ? w : h;
  const k = part.kind;
  const outVal = vals[spec.pins.findIndex((p) => p.dir === 'out')];
  const inVal = vals[0];
  let body: ReactNode = null;
  let upright: ReactNode = null;

  switch (k) {
    case 'in':
      body = <rect className={`body io ${valClass(outVal)}`} x={0.2} y={0.2} width={1.6} height={1.6} rx={0.3} />;
      upright = <text className={`io-text ${valClass(outVal)}`} x={W / 2} y={H / 2 + 0.35}>{VAL_NAME[outVal ?? 3]}</text>;
      break;
    case 'out':
      body = <rect className={`body io out ${valClass(inVal)}`} x={0.2} y={0.2} width={1.6} height={1.6} rx={0.8} />;
      upright = <text className={`io-text ${valClass(inVal)}`} x={W / 2} y={H / 2 + 0.35}>{VAL_NAME[inVal ?? 3]}</text>;
      break;
    case 'button':
      body = (
        <>
          <rect className="body" x={0.2} y={0.2} width={1.6} height={1.6} rx={0.25} />
          <circle className={`button-cap ${pressed ? 'pressed' : ''}`} cx={1} cy={1} r={pressed ? 0.5 : 0.6} />
        </>
      );
      break;
    case 'clock':
      body = (
        <>
          <rect className={`body clock ${valClass(outVal)}`} x={0.2} y={0.2} width={2.6} height={1.6} rx={0.25} />
          <path className="clock-wave" d="M0.6 1.4 H1.1 V0.6 H1.7 V1.4 H2.3 V0.6 H2.5" />
        </>
      );
      break;
    case 'const':
      body = <rect className="body const" x={0.3} y={0.3} width={1.4} height={1.4} rx={0.15} />;
      upright = <text className="const-text" x={W / 2} y={H / 2 + 0.35}>{part.value === 1 ? '1' : '0'}</text>;
      break;
    case 'led': {
      const color = part.color ?? 'red';
      body = (
        <>
          <line className="stub" x1={0} y1={1} x2={0.3} y2={1} />
          <circle className={`led led-${color} ${valClass(inVal)}`} cx={1} cy={1} r={0.75} />
        </>
      );
      break;
    }
    case 'hex':
      body = (
        <>
          {spec.pins.map((p) => (
            <line key={p.name} className="stub" x1={0} y1={p.y} x2={0.5} y2={p.y} />
          ))}
          <rect className="display" x={0.5} y={0.2} width={3.3} height={5.6} rx={0.3} />
        </>
      );
      upright = <text className={`hex-digit ${vals.some((v) => v === 4) ? 've' : ''}`} x={part.rot % 2 ? W / 2 : W / 2 + 0.15} y={H / 2 + 1.25}>{hexDigit(vals)}</text>;
      break;
    case 'seg7':
      body = (
        <>
          {spec.pins.map((p) => (
            <line key={p.name} className="stub" x1={0} y1={p.y} x2={0.5} y2={p.y} />
          ))}
          <rect className="display" x={0.5} y={0.2} width={3.3} height={7.6} rx={0.3} />
          {spec.pins.map((p, i) => (
            <polygon key={p.name} className={`segment ${vals[i] === 1 ? 'lit' : vals[i] === 4 ? 've' : ''}`} points={SEGMENT_POLYS[p.name]} transform="translate(0.15 0)" />
          ))}
        </>
      );
      break;
    case 'buf':
    case 'not':
    case 'and':
    case 'or':
    case 'xor':
    case 'nand':
    case 'nor':
    case 'xnor':
      body = gateBody(k, w, h);
      break;
    case 'tri':
      body = (
        <>
          <line className="stub" x1={0} y1={2} x2={0.6} y2={2} />
          <line className="stub" x1={3.4} y1={2} x2={4} y2={2} />
          <line className="stub" x1={2} y1={4} x2={2} y2={2.7} />
          <path className="body" d="M0.5 0.6 L3.5 2 L0.5 3.4 Z" />
        </>
      );
      break;
    case 'mux':
      body = (
        <>
          <line className="stub" x1={0} y1={2} x2={0.6} y2={2} />
          <line className="stub" x1={0} y1={4} x2={0.6} y2={4} />
          <line className="stub" x1={3.4} y1={3} x2={4} y2={3} />
          <line className="stub" x1={2} y1={6} x2={2} y2={5} />
          <path className="body" d="M0.5 0.5 L3.5 1.5 L3.5 4.5 L0.5 5.5 Z" />
          <text className="pin-label" x={1.0} y={2.3}>0</text>
          <text className="pin-label" x={1.0} y={4.3}>1</text>
        </>
      );
      break;
    case 'dff':
    case 'jkff':
    case 'tff':
      body = (
        <>
          {spec.pins.map((p) =>
            p.side === 'W' ? (
              <line key={p.name} className="stub" x1={0} y1={p.y} x2={0.5} y2={p.y} />
            ) : p.side === 'E' ? (
              <line key={p.name} className="stub" x1={4.5} y1={p.y} x2={5} y2={p.y} />
            ) : (
              <line key={p.name} className="stub" x1={p.x} y1={5.7} x2={p.x} y2={6} />
            )
          )}
          <rect className="body" x={0.5} y={0.3} width={4} height={5.4} rx={0.2} />
          {spec.pins.map((p) =>
            p.name === 'c' ? (
              <path key={p.name} className="body-line" d={`M0.5 ${p.y - 0.45} L1.1 ${p.y} L0.5 ${p.y + 0.45}`} />
            ) : (
              <text
                key={p.name}
                className="pin-label"
                x={p.side === 'W' ? 0.8 : p.side === 'E' ? 4.2 : p.x}
                y={p.side === 'S' ? 5.4 : p.y + 0.3}
                textAnchor={p.side === 'W' ? 'start' : p.side === 'E' ? 'end' : 'middle'}
              >
                {p.label}
              </text>
            )
          )}
          <text className="ff-title" x={2.5} y={3.35}>
            {k === 'dff' ? 'D' : k === 'tff' ? 'T' : 'JK'}
          </text>
        </>
      );
      break;
    case 'chip':
      body = (
        <>
          {spec.pins.map((p) => (
            <line key={p.name} className="stub" x1={p.x === 0 ? 0 : w - 0.5} y1={p.y} x2={p.x === 0 ? 0.5 : w} y2={p.y} />
          ))}
          <rect className={`body chip ${missing ? 'missing' : ''}`} x={0.5} y={0.15} width={w - 1} height={h - 0.3} rx={0.3} />
          {spec.pins.map((p) => (
            <text key={p.name} className="pin-label" x={p.x === 0 ? 0.8 : w - 0.8} y={p.y + 0.3} textAnchor={p.x === 0 ? 'start' : 'end'}>
              {p.label}
            </text>
          ))}
        </>
      );
      break;
    case 'text':
      upright = (
        <text className="note" x={0} y={1.2}>
          {(part.text ?? '').split('\n').map((line, i) => (
            <tspan key={i} x={0} dy={i ? 1.6 : 0}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      );
      break;
  }

  const showLabel = part.label && k !== 'chip' && k !== 'text';
  const transform = rotationTransform(part.rot, w, h);
  return (
    <g
      className={`part kind-${k}${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
      transform={`translate(${part.x + dx} ${part.y + dy})`}
      data-part={part.id}
    >
      <rect className="hit" x={0} y={0} width={W} height={H} />
      {selected && <rect className="sel-box" x={-0.35} y={-0.35} width={W + 0.7} height={H + 0.7} rx={0.4} />}
      <g transform={transform}>{body}</g>
      {upright}
      {k === 'chip' && (
        <text className="chip-name" x={W / 2} y={part.rot % 2 ? H / 2 : -0.45}>
          {missing ? '（芯片已删除）' : chipName ?? part.label ?? KIND_NAME.chip}
        </text>
      )}
      {showLabel && (
        <text className="part-label" x={W / 2} y={-0.45}>
          {part.label}
        </text>
      )}
    </g>
  );
}

export const PartView = memo(PartViewImpl, (a, b) => {
  if (a.part !== b.part || a.spec !== b.spec || a.selected !== b.selected || a.pressed !== b.pressed) return false;
  if (a.chipName !== b.chipName || a.missing !== b.missing || a.dx !== b.dx || a.dy !== b.dy || a.dragging !== b.dragging) return false;
  if (a.vals.length !== b.vals.length) return false;
  for (let i = 0; i < a.vals.length; i++) if (a.vals[i] !== b.vals[i]) return false;
  return true;
});
