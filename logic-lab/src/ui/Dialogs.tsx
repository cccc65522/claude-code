import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EXAMPLES } from '../engine/examples.ts';
import { checkNames, ExprError, parseEquations, synthesize, tableToEquations, variables, type Cell, type Equation } from '../engine/expr.ts';
import { createChip, insertCircuit, loadProject, store, toast, useEditor } from '../store/store.ts';

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('textarea, input, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const close = () => store.set({ dialog: null });

export function ExamplesDialog() {
  return (
    <Modal title="示例电路" onClose={close} wide>
      <p className="tip">打开示例会替换当前电路，之后可以用“撤销”回来。</p>
      <div className="example-grid">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            className="example"
            data-example={ex.id}
            onClick={() => {
              loadProject(ex.build(), `已打开示例“${ex.title}”`);
              close();
            }}
          >
            <b>{ex.title}</b>
            <span>{ex.desc}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

const SAMPLE = `# 每行一个输出，例如一位全加器：
S = A ^ B ^ Cin
Cout = A & B | Cin & (A ^ B)`;

type Parsed = { ok: true; eqs: Equation[]; vars: string[] } | { ok: false; error: string };

function parseSource(src: string): Parsed {
  try {
    const eqs = parseEquations(src);
    return { ok: true, eqs, vars: variables(eqs) };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: `第 ${e.line} 行第 ${e.col} 列：${e.message}` };
    return { ok: false, error: String(e) };
  }
}

const splitNames = (s: string) =>
  s
    .split(/[\s,，、;；]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Truth table editor: click output cells to cycle 0 → 1 → × (don't care). */
function TableDesigner({ onChange }: { onChange: (src: string | null, inputs: string[], error: string | null) => void }) {
  const [inNames, setInNames] = useState('A B C');
  const [outNames, setOutNames] = useState('Y');
  const [cells, setCells] = useState<Record<string, Cell[]>>({});
  const inputs = splitNames(inNames);
  const outputs = splitNames(outNames);
  const n = inputs.length;
  const nameError = n > 6 ? '最多 6 个输入' : outputs.length > 8 ? '最多 8 个输出' : checkNames(inputs, outputs);
  const rows = nameError ? 0 : 1 << n;
  const valuesOf = (name: string): Cell[] => {
    const v = cells[name] ?? [];
    return Array.from({ length: rows }, (_, r) => v[r] ?? 0);
  };
  const src = nameError ? null : tableToEquations(inputs, outputs.map((name) => ({ name, values: valuesOf(name) })));
  // `inputs` is rebuilt every render; the text it comes from is the real dependency.
  useEffect(() => onChange(src, inputs, nameError), [src, nameError, inNames]);
  const cycle = (name: string, r: number) => {
    const v = valuesOf(name);
    v[r] = v[r] === 0 ? 1 : v[r] === 1 ? 'x' : 0;
    setCells({ ...cells, [name]: v });
  };
  const fill = (name: string, value: Cell) => setCells({ ...cells, [name]: Array.from({ length: rows }, () => value) });
  return (
    <div className="designer">
      <div className="row">
        <label className="field grow">
          <span>输入（空格分隔，最多 6 个）</span>
          <input value={inNames} onChange={(e) => setInNames(e.target.value)} data-testid="tt-inputs" />
        </label>
        <label className="field grow">
          <span>输出</span>
          <input value={outNames} onChange={(e) => setOutNames(e.target.value)} data-testid="tt-outputs" />
        </label>
      </div>
      {nameError ? (
        <p className="tip warn" role="alert">
          {nameError}
        </p>
      ) : (
        <div className="table-scroll designer-table">
          <table className="tt">
            <thead>
              <tr>
                {inputs.map((v) => (
                  <th key={v}>{v}</th>
                ))}
                <th className="sep" />
                {outputs.map((o) => (
                  <th key={o} className="out">
                    {o}
                    <span className="fill">
                      <button onClick={() => fill(o, 0)} title="全部填 0">0</button>
                      <button onClick={() => fill(o, 1)} title="全部填 1">1</button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, r) => (
                <tr key={r}>
                  {inputs.map((v, i) => (
                    <td key={v} className="in">
                      {(r >> (n - 1 - i)) & 1}
                    </td>
                  ))}
                  <td className="sep" />
                  {outputs.map((o) => {
                    const v = valuesOf(o)[r];
                    return (
                      <td key={o} className={v === 1 ? 'v1' : v === 'x' ? 'vx' : ''}>
                        <button className="cell" onClick={() => cycle(o, r)} data-cell={`${o}:${r}`}>
                          {v === 'x' ? '×' : v}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tip">点输出格在 0、1、×（无关项，化简时随意取）之间切换。</p>
      {src && <pre className="code preview" data-testid="tt-equations">{src}</pre>}
    </div>
  );
}

export function ExprDialog() {
  const workspace = useEditor((s) => s.workspace);
  const [mode, setMode] = useState<'expr' | 'table'>('expr');
  const [src, setSrc] = useState(SAMPLE);
  const [table, setTable] = useState<{ src: string | null; inputs: string[]; error: string | null }>({ src: null, inputs: [], error: null });
  const [fan, setFan] = useState(4);
  const parsed = useMemo<Parsed>(() => {
    if (mode === 'expr') return parseSource(src);
    if (!table.src) return { ok: false, error: table.error ?? '' };
    return parseSource(table.src);
  }, [mode, src, table]);
  const disabled = workspace.mode === 'level';
  const make = (asChip: boolean) => {
    if (!parsed.ok) return;
    const { circuit, gateCount } = synthesize(parsed.eqs, { maxFanIn: fan, inputOrder: mode === 'table' ? table.inputs : undefined });
    if (asChip) {
      const name = parsed.eqs.map((e) => e.name).join('、').slice(0, 20);
      createChip(circuit, name, false);
      toast(`已生成芯片“${name}”（${gateCount} 个门），可以在左侧“我的芯片”里放置`, 'ok');
    } else {
      insertCircuit(circuit);
      toast(`已生成 ${gateCount} 个门`, 'ok');
    }
    close();
  };
  return (
    <Modal title="自动生成电路" onClose={close} wide>
      <div className="seg mode-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'expr'} className={mode === 'expr' ? 'on' : ''} onClick={() => setMode('expr')}>
          写表达式
        </button>
        <button role="tab" aria-selected={mode === 'table'} className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')} data-testid="mode-table">
          填真值表
        </button>
      </div>
      {mode === 'expr' ? (
        <>
          <p className="tip">
            运算符：与 <code>&amp; * ·</code>，或 <code>| +</code>，异或 <code>^ ⊕</code>，非 <code>! ~ ¬</code> 或后缀 <code>A'</code>。优先级：非 &gt; 与 &gt; 异或 &gt; 或。
            相同的子表达式只生成一次。
          </p>
          <textarea className="code" value={src} onChange={(e) => setSrc(e.target.value)} rows={7} spellCheck={false} aria-label="表达式" data-testid="expr-input" />
          {parsed.ok ? (
            <p className="tip ok">
              输入：{parsed.vars.join('、') || '（无）'}；输出：{parsed.eqs.map((e) => e.name).join('、')}
            </p>
          ) : (
            <p className="tip warn" role="alert">
              {parsed.error}
            </p>
          )}
        </>
      ) : (
        <TableDesigner onChange={(s, inputs, error) => setTable({ src: s, inputs, error })} />
      )}
      <label className="field inline">
        <span>每个门最多输入</span>
        <select value={fan} onChange={(e) => setFan(Number(e.target.value))}>
          {[2, 3, 4, 8].map((n) => (
            <option key={n} value={n}>
              {n} 个
            </option>
          ))}
        </select>
      </label>
      {disabled && <p className="tip warn">闯关模式下不能自动生成。</p>}
      <div className="row end">
        <button className="btn" disabled={!parsed.ok || disabled} onClick={() => make(true)}>
          生成为芯片
        </button>
        <button className="btn primary" disabled={!parsed.ok || disabled} onClick={() => make(false)} data-testid="expr-insert">
          放到画布上
        </button>
      </div>
    </Modal>
  );
}

export function HelpDialog() {
  return (
    <Modal title="使用说明" onClose={close} wide>
      <div className="help">
        <h3>基本操作</h3>
        <ul>
          <li>点击左侧元件放到画布中央，或直接拖到画布上。</li>
          <li>从一个引脚拖到另一个引脚连线；也可以先点一个引脚，再点另一个（手机上更方便）。一个输出可以接很多输入。</li>
          <li>点击输入引脚切换 0/1；按钮按住为 1。拖动空白处平移，滚轮或双指缩放，Shift+拖动框选。</li>
          <li>双击芯片进入内部；双击文字进行编辑。</li>
        </ul>
        <h3>信号颜色</h3>
        <ul className="legend">
          <li>
            <i className="sw v1" /> 1（高电平）
          </li>
          <li>
            <i className="sw v0" /> 0（低电平）
          </li>
          <li>
            <i className="sw vx" /> X：未知（比如门的输入悬空）
          </li>
          <li>
            <i className="sw vz" /> Z：高阻，没有元件驱动这根线
          </li>
          <li>
            <i className="sw ve" /> E：短路，两个输出一个给 0 一个给 1
          </li>
        </ul>
        <h3>仿真</h3>
        <ul>
          <li>每个门有一个单位的延迟。“运行”让时钟按设定速度走；“单拍”走一拍。</li>
          <li>“逐级传播”模式下，信号一级一级地穿过门电路，可以看到竞争冒险产生的毛刺；波形图的每一格是一级门延迟。</li>
          <li>电路一直无法稳定（例如环形振荡器）时，状态栏会提示，正在变化的导线会闪烁。</li>
        </ul>
        <h3>快捷键</h3>
        <table className="keys">
          <tbody>
            {[
              ['Delete / Backspace', '删除选中的元件和导线'],
              ['R / Shift+R', '顺时针 / 逆时针旋转'],
              ['Ctrl+Z / Ctrl+Y', '撤销 / 重做'],
              ['Ctrl+C / Ctrl+X / Ctrl+V', '复制 / 剪切 / 粘贴'],
              ['Ctrl+D', '原地复制一份'],
              ['Ctrl+A', '全选'],
              ['方向键', '移动选中的元件'],
              ['空格', '运行 / 暂停'],
              ['.', '单拍（逐级传播模式下走一级）'],
              ['F', '缩放到合适大小'],
              ['Esc', '取消连线和选择']
            ].map(([k, d]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
