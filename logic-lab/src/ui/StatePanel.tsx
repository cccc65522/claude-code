import { useDeferredValue, useMemo } from 'react';
import { stateTable, type StateTable } from '../engine/analyze.ts';
import { VAL_NAME } from '../engine/values.ts';
import { simctl, useSimVersion } from '../store/simctl.ts';
import { useEditor } from '../store/store.ts';
import { valClass } from './PartShape.tsx';

const bits = (v: number, n: number) => (n ? v.toString(2).padStart(n, '0') : '');

/** State currently held by the running simulation, or -1. */
function liveState(t: StateTable): number {
  let s = 0;
  for (const [k, f] of t.flops.entries()) {
    const i = simctl.sim.compIndex(f.id);
    const q = i === undefined ? 2 : simctl.sim.q[i];
    if (q > 1) return -1;
    s |= q << (t.flops.length - 1 - k);
  }
  return s;
}

function Diagram({ t, current }: { t: StateTable; current: number }) {
  const nf = t.flops.length;
  const ni = t.inputs.length;
  const total = 1 << nf;
  const shown = total <= 16 ? [...Array(total).keys()] : t.reachable;
  if (shown.length > 24) return <p className="tip">可达状态太多（{shown.length} 个），只显示状态表。</p>;
  const R = Math.max(60, shown.length * 15);
  const size = 2 * R + 90;
  const c = size / 2;
  const pos = new Map(shown.map((s, k) => [s, { x: c + R * Math.sin((2 * Math.PI * k) / shown.length), y: c - R * Math.cos((2 * Math.PI * k) / shown.length) }]));
  const nodeR = 19;
  // Edges grouped by (from, to), labelled with the inputs that take them.
  const edges = new Map<string, { from: number; to: number; inputs: number[] }>();
  for (const r of t.rows) {
    if (r.next < 0 || !pos.has(r.state) || !pos.has(r.next)) continue;
    const key = `${r.state}>${r.next}`;
    const e = edges.get(key) ?? { from: r.state, to: r.next, inputs: [] };
    e.inputs.push(r.input);
    edges.set(key, e);
  }
  const label = (inputs: number[]) => (ni === 0 || inputs.length === 1 << ni ? '' : inputs.map((i) => bits(i, ni)).join(','));
  const outOf = (s: number) => t.rows.find((r) => r.state === s)?.out ?? [];
  return (
    <svg className="fsm" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="状态图" data-testid="state-diagram">
      <defs>
        <marker id="fsm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="fsm-arrowhead" />
        </marker>
      </defs>
      {[...edges.values()].map((e) => {
        const a = pos.get(e.from)!;
        const b = pos.get(e.to)!;
        const text = label(e.inputs);
        if (e.from === e.to) {
          // Self loop on the outside of the circle.
          const dx = a.x - c;
          const dy = a.y - c;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const lx = a.x + ux * (nodeR + 12);
          const ly = a.y + uy * (nodeR + 12);
          return (
            <g key={`${e.from}>${e.to}`} className="fsm-edge">
              <circle cx={lx} cy={ly} r={12} />
              {text && (
                <text x={a.x + ux * (nodeR + 34)} y={a.y + uy * (nodeR + 34) + 4}>
                  {text}
                </text>
              )}
            </g>
          );
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // Bend sideways so A→B and B→A don't overlap.
        const bend = edges.has(`${e.to}>${e.from}`) ? 18 : 8;
        const mx = (a.x + b.x) / 2 - uy * bend;
        const my = (a.y + b.y) / 2 + ux * bend;
        const sx = a.x + ux * nodeR;
        const sy = a.y + uy * nodeR;
        const ex = b.x - ux * (nodeR + 2);
        const ey = b.y - uy * (nodeR + 2);
        return (
          <g key={`${e.from}>${e.to}`} className="fsm-edge">
            <path d={`M${sx} ${sy} Q${mx} ${my} ${ex} ${ey}`} markerEnd="url(#fsm-arrow)" />
            {text && (
              <text x={mx - uy * 8} y={my + ux * 8 + 4}>
                {text}
              </text>
            )}
          </g>
        );
      })}
      {shown.map((s) => {
        const p = pos.get(s)!;
        const reach = t.reachable.includes(s);
        return (
          <g key={s} className={`fsm-node${s === current ? ' current' : ''}${reach ? '' : ' unreachable'}`} data-state={bits(s, nf)}>
            <circle cx={p.x} cy={p.y} r={nodeR} />
            <text x={p.x} y={p.y + (t.moore && t.outputs.length ? -1 : 4)} className="fsm-bits">
              {bits(s, nf)}
            </text>
            {t.moore && t.outputs.length > 0 && (
              <text x={p.x} y={p.y + 12} className="fsm-out">
                {outOf(s)
                  .map((v) => VAL_NAME[v])
                  .join('')}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function StatePanel() {
  useSimVersion();
  const project = useDeferredValue(useEditor((s) => s.project));
  const editing = useEditor((s) => s.editing);
  const result = useMemo(() => stateTable(project, editing), [project, editing]);
  if (!result.ok) return <p className="tip">{result.error}</p>;
  const t = result.table;
  const nf = t.flops.length;
  const ni = t.inputs.length;
  const current = liveState(t);
  return (
    <div className="state-panel">
      <p className="tip">
        状态由 {t.flops.map((f) => f.label).join('、')} 组成（按这个顺序读成二进制）。次态是经过一个完整时钟周期（{2 * t.period} 拍）之后的状态。
        {t.moore ? '输出只取决于状态（摩尔型），写在圆圈里。' : '输出还取决于输入（米利型），见下表。'}
        {ni > 0 && ' 箭头上标的是输入 ' + t.inputs.map((s) => s.label).join('') + '。'}
        {current >= 0 && ' 当前状态高亮显示。'}
      </p>
      {t.reachable.length < 1 << nf && <p className="tip">从全 0 的复位状态出发，只能到达 {t.reachable.length} 个状态（其余的淡色显示）。</p>}
      <Diagram t={t} current={current} />
      <div className="table-scroll">
        <table className="tt" data-testid="state-table">
          <thead>
            <tr>
              <th colSpan={nf}>现态</th>
              {ni > 0 && <th colSpan={ni}>输入</th>}
              <th colSpan={nf}>次态</th>
              {t.outputs.length > 0 && <th colSpan={t.outputs.length}>输出</th>}
            </tr>
            <tr>
              {t.flops.map((f) => (
                <th key={`s${f.id}`}>{f.label}</th>
              ))}
              {t.inputs.map((s) => (
                <th key={s.id}>{s.label}</th>
              ))}
              {t.flops.map((f) => (
                <th key={`n${f.id}`}>{f.label}</th>
              ))}
              {t.outputs.map((s) => (
                <th key={s.id}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={`${r.state}-${r.input}`} className={r.state === current ? 'hit' : t.reachable.includes(r.state) ? '' : 'faded'}>
                {bits(r.state, nf)
                  .split('')
                  .map((b, k) => (
                    <td key={`s${k}`} className="in">
                      {b}
                    </td>
                  ))}
                {bits(r.input, ni)
                  .split('')
                  .map((b, k) => (
                    <td key={`i${k}`} className="in">
                      {b}
                    </td>
                  ))}
                {(r.next < 0 ? 'X'.repeat(nf) : bits(r.next, nf)).split('').map((b, k) => (
                  <td key={`n${k}`} className={b === '1' ? 'v1' : b === 'X' ? 'vx' : ''}>
                    {b}
                  </td>
                ))}
                {r.out.map((v, k) => (
                  <td key={`o${k}`} className={valClass(v)}>
                    {VAL_NAME[v]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

