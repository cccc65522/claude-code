import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import { tableToText, truthTable, type TruthTable } from '../engine/analyze.ts';
import { parseEquations, synthesize } from '../engine/expr.ts';
import { covers, literalCount, literals, sopToText, type Implicant } from '../engine/qm.ts';
import { VAL_NAME } from '../engine/values.ts';
import { createChip, toast, useEditor } from '../store/store.ts';
import { valClass } from './PartShape.tsx';

function Lit({ name, neg }: { name: string; neg: boolean }) {
  return neg ? <span className="neg">{name}</span> : <span>{name}</span>;
}

function SopView({ imps, n, names, onHover }: { imps: Implicant[]; n: number; names: string[]; onHover: (i: Implicant | null) => void }) {
  if (imps.length === 0) return <span className="expr">0</span>;
  if (imps.some((p) => literalCount(p, n) === 0)) return <span className="expr">1</span>;
  return (
    <span className="expr">
      {imps.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="op"> + </span>}
          <span className="term" onMouseEnter={() => onHover(p)} onMouseLeave={() => onHover(null)}>
            {literals(p, n).map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <span className="op">·</span>}
                <Lit name={names[l.v]} neg={l.neg} />
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

function PosView({ imps, n, names }: { imps: Implicant[]; n: number; names: string[] }) {
  if (imps.length === 0) return <span className="expr">1</span>;
  if (imps.some((p) => literalCount(p, n) === 0)) return <span className="expr">0</span>;
  return (
    <span className="expr">
      {imps.map((p, i) => {
        const lits = literals(p, n);
        return (
          <span key={i} className="term">
            {lits.length > 1 && imps.length > 1 && '('}
            {lits.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <span className="op"> + </span>}
                <Lit name={names[l.v]} neg={!l.neg} />
              </Fragment>
            ))}
            {lits.length > 1 && imps.length > 1 && ')'}
          </span>
        );
      })}
    </span>
  );
}

const GRAY = [[0], [0, 1], [0, 1, 3, 2]];

function KMap({ table, k, hover }: { table: TruthTable; k: number; hover: Implicant | null }) {
  const n = table.inputs.length;
  const rowVars = Math.floor(n / 2);
  const colVars = n - rowVars;
  const rows = GRAY[rowVars];
  const cols = GRAY[colVars];
  const names = table.inputs.map((s) => s.label);
  const bits = (v: number, len: number) => v.toString(2).padStart(len, '0');
  return (
    <table className="kmap" aria-label="卡诺图">
      <thead>
        <tr>
          <th className="corner">
            {names.slice(0, rowVars).join('')}
            {rowVars > 0 && '＼'}
            {names.slice(rowVars).join('')}
          </th>
          {cols.map((c) => (
            <th key={c}>{bits(c, colVars)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <th>{rowVars ? bits(r, rowVars) : ''}</th>
            {cols.map((c) => {
              const m = (r << colVars) | c;
              const v = table.rows[m][k];
              const hit = hover && covers(hover, m);
              return (
                <td key={c} className={`${valClass(v)}${hit ? ' hit' : ''}`} title={`m${m}`}>
                  {v === 0 || v === 1 ? v : '×'}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TruthPanel() {
  const project = useDeferredValue(useEditor((s) => s.project));
  const editing = useEditor((s) => s.editing);
  const workspace = useEditor((s) => s.workspace);
  const result = useMemo(() => truthTable(project, editing), [project, editing]);
  const [sel, setSel] = useState(0);
  const [hover, setHover] = useState<Implicant | null>(null);

  if (!result.ok) {
    return (
      <div className="panel-body">
        <h2>真值表</h2>
        <p className="tip">{result.error}</p>
        <p className="tip">真值表按“输入引脚”和“输出引脚”生成（按从上到下的顺序）。开关、按钮、指示灯不算。</p>
      </div>
    );
  }
  const t = result.table;
  const n = t.inputs.length;
  const names = t.inputs.map((s) => s.label);
  const k = Math.min(sel, t.outputs.length - 1);

  const copyTable = async () => {
    try {
      await navigator.clipboard.writeText(tableToText(t));
      toast('已复制真值表（制表符分隔，可粘贴到电子表格）', 'ok');
    } catch {
      toast('无法访问剪贴板', 'error');
    }
  };
  const sopText = (i: number) => (t.sop[i] ? `${t.outputs[i].label} = ${sopToText(t.sop[i]!, n, names)}` : '');
  const copyExpr = async () => {
    const text = t.outputs.map((_, i) => sopText(i)).filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制最简与或式', 'ok');
    } catch {
      toast('无法访问剪贴板', 'error');
    }
  };
  const buildMinimal = () => {
    const src = t.outputs.map((_, i) => sopText(i)).join('\n');
    try {
      const eqs = parseEquations(src);
      const { circuit, gateCount } = synthesize(eqs, { inputOrder: names });
      const name = `${editing === 'main' ? '电路' : project.chips.find((c) => c.id === editing)?.name ?? '电路'}（最简）`;
      createChip(circuit, name, false);
      toast(`已生成芯片“${name}”，${gateCount} 个门。在左侧“我的芯片”里可以放置`, 'ok');
    } catch (e) {
      toast(`生成失败：${(e as Error).message}`, 'error');
    }
  };

  return (
    <div className="panel-body truth">
      <div className="panel-head">
        <h2>真值表</h2>
        <button className="btn small" onClick={copyTable}>
          复制
        </button>
      </div>
      {t.notes.map((note) => (
        <p key={note} className="tip warn">
          {note}
        </p>
      ))}
      <div className="table-scroll">
        <table className="tt" data-testid="truth-table">
          <thead>
            <tr>
              {t.inputs.map((s) => (
                <th key={s.id}>{s.label}</th>
              ))}
              <th className="sep" />
              {t.outputs.map((s, i) => (
                <th key={s.id} className={i === k ? 'out sel' : 'out'} onClick={() => setSel(i)}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row, r) => (
              <tr key={r} className={hover && covers(hover, r) ? 'hit' : ''}>
                {t.inputs.map((s, i) => (
                  <td key={s.id} className="in">
                    {(r >> (n - 1 - i)) & 1}
                  </td>
                ))}
                <td className="sep" />
                {row.map((v, i) => (
                  <td key={i} className={`${valClass(v)}${i === k ? ' sel' : ''}`}>
                    {VAL_NAME[v]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>最简表达式</h3>
      {t.sop.every((s) => s === null) ? (
        <p className="tip">输入超过 8 个时不做化简。</p>
      ) : (
        <div className="exprs" data-testid="min-exprs">
          {t.outputs.map((s, i) =>
            t.sop[i] ? (
              <div key={s.id} className={`expr-row${i === k ? ' sel' : ''}`} onClick={() => setSel(i)}>
                <div>
                  <b>{s.label}</b> = <SopView imps={t.sop[i]!} n={n} names={names} onHover={setHover} />
                </div>
                <div className="pos">
                  或与式：<PosView imps={t.pos[i]!} n={n} names={names} />
                </div>
                {t.dontCare[i].length > 0 && <div className="tip">输出为 X/Z 的 {t.dontCare[i].length} 行按无关项处理。</div>}
              </div>
            ) : null
          )}
          <div className="row">
            <button className="btn small" onClick={copyExpr}>
              复制表达式
            </button>
            {workspace.mode === 'free' && (
              <button className="btn small" onClick={buildMinimal} title="按最简与或式重新生成一个芯片">
                生成最简电路
              </button>
            )}
          </div>
          <p className="tip">鼠标移到某一项上，会在真值表和卡诺图里标出它覆盖的格子。</p>
        </div>
      )}
      {n >= 2 && n <= 4 && t.sop[k] && (
        <>
          <h3>卡诺图：{t.outputs[k].label}</h3>
          <KMap table={t} k={k} hover={hover} />
        </>
      )}
    </div>
  );
}
