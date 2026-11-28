import { useEffect, useState } from 'react';
import { circuitStats } from '../engine/analyze.ts';
import { findCircuit } from '../engine/compile.ts';
import { clampInputs, isMultiInputGate, KIND_NAME, MAX_INPUTS, MEM_LIMITS, memBits, MIN_INPUTS } from '../engine/parts.ts';
import type { Part } from '../engine/types.ts';
import { VAL_NAME } from '../engine/values.ts';
import { MAIN_ID } from '../engine/types.ts';
import { simctl, useSimVersion } from '../store/simctl.ts';
import {
  createChip,
  currentCircuit,
  deleteSelection,
  enterCircuit,
  enterInstance,
  livePrefix,
  packageSelection,
  renameCircuit,
  setWireBend,
  rotateSelection,
  store,
  toast,
  updatePart,
  useEditor
} from '../store/store.ts';
import { isBindableKey } from '../engine/serialize.ts';

const LED_COLORS: [string, string][] = [
  ['red', '红'],
  ['green', '绿'],
  ['amber', '黄'],
  ['blue', '蓝'],
  ['white', '白']
];

/** Text input that commits on blur / Enter instead of on every keystroke. */
function LazyInput({ value, onCommit, placeholder, id, multiline }: { value: string; onCommit: (v: string) => void; placeholder?: string; id?: string; multiline?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  if (multiline)
    return <textarea id={id} value={draft} rows={3} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />;
  return (
    <input
      id={id}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`减少${label}`}>
        −
      </button>
      <output>{value}</output>
      <button onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`增加${label}`}>
        +
      </button>
    </div>
  );
}

const hex = (v: number, digits: number) => v.toString(16).toUpperCase().padStart(digits, '0');

function MemoryProps({ part }: { part: Part }) {
  useSimVersion();
  const { a, d } = memBits(part);
  const k = part.kind;
  const words = 1 << a;
  const digits = Math.ceil(d / 4);
  const text = Array.from({ length: words }, (_, i) => hex(part.data?.[i] ?? 0, digits))
    .join(' ')
    .replace(/((?:\S+ ){7}\S+) /g, '$1\n');
  const live = simctl.sim.memory(livePrefix() + part.id);
  return (
    <>
      {k !== 'reg' && (
        <label className="field">
          <span>地址位数（{words} 个字）</span>
          <Stepper value={a} min={MEM_LIMITS.abits[0]} max={MEM_LIMITS.abits[1]} label="地址位数" onChange={(v) => updatePart(part.id, { abits: v })} />
        </label>
      )}
      <label className="field">
        <span>{k === 'reg' ? '位数' : '数据位数'}</span>
        <Stepper value={d} min={MEM_LIMITS.dbits[0]} max={MEM_LIMITS.dbits[1]} label="数据位数" onChange={(v) => updatePart(part.id, { dbits: v })} />
      </label>
      {k === 'rom' && (
        <label className="field">
          <span>内容（十六进制，从地址 0 开始，空格或换行分隔）</span>
          <LazyInput
            id="rom-data"
            multiline
            value={text}
            onCommit={(v) => {
              const tokens = v.split(/[\s,，]+/).filter(Boolean);
              const values = tokens.map((t) => parseInt(t.replace(/^0x/i, ''), 16));
              const bad = tokens.findIndex((t, i) => !/^(0x)?[0-9a-f]+$/i.test(t) || values[i] >= 1 << d);
              if (bad >= 0) toast(`第 ${bad + 1} 个数“${tokens[bad]}”不对：要用十六进制，并且小于 ${hex(1 << d, 1)}`, 'error');
              else if (tokens.length > words) toast(`最多 ${words} 个字`, 'error');
              else updatePart(part.id, { data: values });
            }}
          />
        </label>
      )}
      {k === 'ram' && live && (
        <div className="mem-view" data-testid="ram-view">
          {Array.from({ length: words }, (_, w) => {
            let v = 0;
            let unknown = false;
            for (let b = 0; b < d; b++) {
              const bit = live[w * d + b];
              if (bit > 1) unknown = true;
              v |= (bit & 1) << b;
            }
            return (
              <span key={w} title={`地址 ${w}`}>
                <i>{hex(w, Math.ceil(a / 4))}</i>
                {unknown ? 'X'.repeat(digits) : hex(v, digits)}
              </span>
            );
          })}
        </div>
      )}
      {k === 'reg' && live && (
        <p className="tip">
          当前值 <b className="mono">{[...live].some((b) => b > 1) ? 'X' : hex([...live].reduce((s, b, i) => s | (b << i), 0), digits)}</b>（十六进制）
        </p>
      )}
      <p className="tip">
        {k === 'rom' && '只读存储器：输出地址 A 处的字，相当于一张真值表。'}
        {k === 'ram' && '读出是即时的；WE=1 时，在时钟上升沿把 I 写进地址 A。复位会清空内容。'}
        {k === 'reg' && '时钟上升沿把 D 存进去；EN=0 时保持（EN 不接视为 1）；R=1 立即清零。'}
      </p>
    </>
  );
}

function PartProps({ part }: { part: Part }) {
  const project = useEditor((s) => s.project);
  useSimVersion();
  const def = part.kind === 'chip' ? project.chips.find((c) => c.id === part.chip) : undefined;
  const k = part.kind;
  return (
    <div className="props">
      <h2>
        {KIND_NAME[k]}
        {part.locked && <span className="badge">闯关引脚</span>}
      </h2>
      {k !== 'text' && k !== 'chip' && (
        <label className="field">
          <span>名字</span>
          {part.locked ? (
            <input value={part.label ?? ''} disabled />
          ) : (
            <LazyInput value={part.label ?? ''} placeholder={k === 'in' || k === 'out' ? '例如 A、Cin' : '可选'} onCommit={(v) => updatePart(part.id, { label: v.trim() || undefined })} />
          )}
        </label>
      )}
      {k === 'text' && (
        <label className="field">
          <span>文字</span>
          <LazyInput id="prop-text" multiline value={part.text ?? ''} onCommit={(v) => updatePart(part.id, { text: v })} />
        </label>
      )}
      {isMultiInputGate(k) && (
        <label className="field">
          <span>输入个数</span>
          <div className="stepper">
            <button onClick={() => updatePart(part.id, { n: clampInputs((part.n ?? 2) - 1) })} disabled={(part.n ?? 2) <= MIN_INPUTS} aria-label="减少输入">
              −
            </button>
            <output data-testid="input-count">{clampInputs(part.n)}</output>
            <button onClick={() => updatePart(part.id, { n: clampInputs((part.n ?? 2) + 1) })} disabled={(part.n ?? 2) >= MAX_INPUTS} aria-label="增加输入">
              +
            </button>
          </div>
        </label>
      )}
      {k === 'const' && (
        <label className="field">
          <span>值</span>
          <div className="seg">
            {[0, 1].map((v) => (
              <button key={v} className={part.value === v ? 'on' : ''} onClick={() => updatePart(part.id, { value: v as 0 | 1 })}>
                {v}
              </button>
            ))}
          </div>
        </label>
      )}
      {k === 'clock' && (
        <label className="field">
          <span>每几拍翻转</span>
          <div className="stepper">
            <button onClick={() => updatePart(part.id, { period: Math.max(1, (part.period ?? 1) - 1) })} disabled={(part.period ?? 1) <= 1}>
              −
            </button>
            <output>{part.period ?? 1}</output>
            <button onClick={() => updatePart(part.id, { period: Math.min(64, (part.period ?? 1) + 1) })}>+</button>
          </div>
        </label>
      )}
      {k === 'led' && (
        <label className="field">
          <span>颜色</span>
          <div className="seg">
            {LED_COLORS.map(([c, name]) => (
              <button key={c} className={`swatch led-${c} ${(part.color ?? 'red') === c ? 'on' : ''}`} onClick={() => updatePart(part.id, { color: c })} title={name}>
                {name}
              </button>
            ))}
          </div>
        </label>
      )}
      {k === 'in' && (
        <p className="tip">
          当前值 <b>{VAL_NAME[simctl.pinValue(livePrefix() + part.id, 'o')]}</b>。
          {store.get().live ? '这是芯片的输入接口，值来自外面的电路。' : '点击画布上的引脚切换。'}
          {!store.get().live && (project.chips.length > 0 || store.get().editing !== MAIN_ID) ? '在芯片内部，输入引脚就是芯片的输入接口。' : ''}
        </p>
      )}
      {k === 'button' && <p className="tip">按住为 1，松开为 0。</p>}
      {(k === 'in' || k === 'button') && store.get().editing === MAIN_ID && (
        <label className="field">
          <span>键盘按键（a–z、0–9，R 和 F 除外）</span>
          <LazyInput
            value={part.key ?? ''}
            placeholder="例如 1"
            onCommit={(v) => {
              const key = v.trim().toLowerCase();
              if (!key) updatePart(part.id, { key: undefined });
              else if (isBindableKey(key)) updatePart(part.id, { key });
              else toast('只能用一个字母或数字（R、F 是编辑器快捷键）', 'error');
            }}
          />
        </label>
      )}
      {(k === 'dff' || k === 'jkff' || k === 'tff') && <p className="tip">在时钟输入的上升沿（0→1）动作。底部的 R 是异步清零端，接 1 时 Q 立即变 0，可以不接。</p>}
      {(k === 'rom' || k === 'ram' || k === 'reg') && <MemoryProps part={part} />}
      {k === 'tri' && <p className="tip">EN=1 时输出等于输入；EN=0 时输出高阻（Z），不影响导线上的其他信号。</p>}
      {k === 'mux' && <p className="tip">S=0 选输入 0，S=1 选输入 1。</p>}
      {k === 'chip' && def && (
        <>
          <p className="tip">
            芯片“{def.name}”，{def.parts.filter((p) => p.kind === 'in').length} 个输入、{def.parts.filter((p) => p.kind === 'out').length} 个输出。
          </p>
          <button className="btn wide" onClick={() => enterInstance(part.id)} data-testid="view-instance">
            查看内部（实时信号）
          </button>
          <button className="btn wide" onClick={() => enterCircuit(def.id)}>
            单独编辑芯片定义
          </button>
          <p className="tip">“查看内部”显示这个实例此刻的信号；“单独编辑”把芯片拿出来，用它自己的输入单独仿真。</p>
        </>
      )}
      {k === 'chip' && !def && <p className="tip warn">这个芯片的定义已经被删除了。</p>}
      {k !== 'text' && (
        <div className="row">
          <button className="btn" onClick={() => rotateSelection(-1)} title="逆时针旋转（Shift+R）">
            ⟲ 旋转
          </button>
          <button className="btn" onClick={() => rotateSelection(1)} title="顺时针旋转（R）">
            ⟳ 旋转
          </button>
        </div>
      )}
      {!part.locked && (
        <button className="btn danger wide" onClick={deleteSelection}>
          删除（Delete）
        </button>
      )}
    </div>
  );
}

function WireProps({ id, bent }: { id: string; bent: boolean }) {
  useSimVersion();
  const probed = simctl.isProbed(id);
  const live = useEditor((s) => s.live);
  const wire = currentCircuit().wires.find((w) => w.id === id);
  const v = wire ? simctl.pinValue(livePrefix() + wire.a.part, wire.a.pin) : simctl.wireValue(id);
  return (
    <div className="props">
      <h2>导线</h2>
      <p className="tip">
        当前值 <b>{['0', '1', 'X（未知）', 'Z（悬空）', 'E（短路）'][v]}</b>
      </p>
      <button
        className={`btn wide${probed ? ' on' : ''}`}
        data-testid="probe"
        disabled={!!live}
        title={live ? '实时查看芯片内部时不能加探针；请回到外层电路' : undefined}
        onClick={() => {
          simctl.toggleProbe(id);
          if (!probed) store.set({ waveOpen: true });
        }}
      >
        {probed ? '从波形图移除' : '加入波形图'}
      </button>
      {bent && (
        <button className="btn wide" onClick={() => setWireBend(id, undefined)}>
          恢复自动走线
        </button>
      )}
      <button className="btn danger wide" onClick={deleteSelection}>
        删除（Delete）
      </button>
      <p className="tip">拖动导线中间那段可以调整走线，双击恢复自动。把新导线拖到这根导线上，会接到同一个信号。</p>
    </div>
  );
}

function CircuitInfo() {
  const project = useEditor((s) => s.project);
  const editing = useEditor((s) => s.editing);
  const workspace = useEditor((s) => s.workspace);
  useSimVersion();
  const c = findCircuit(project, editing) ?? project.main;
  // The running netlist belongs to the simulated circuit, which differs while looking inside an instance.
  const live = useEditor((s) => s.live);
  const stats = circuitStats(project, editing, live ? undefined : simctl.nl);
  return (
    <div className="props">
      <h2>{editing === MAIN_ID ? (workspace.mode === 'level' ? '闯关电路' : '主电路') : '芯片'}</h2>
      {editing !== MAIN_ID && (
        <label className="field">
          <span>芯片名字</span>
          <LazyInput value={c.name} onCommit={(v) => renameCircuit(c.id, v)} />
        </label>
      )}
      <dl className="stats">
        <dt>元件</dt>
        <dd>{stats.parts}</dd>
        <dt>导线</dt>
        <dd>{stats.wires}</dd>
        <dt>逻辑门</dt>
        <dd>{stats.gates}</dd>
        {stats.flatGates !== stats.gates && (
          <>
            <dt>展开芯片后</dt>
            <dd>{stats.flatGates} 个门</dd>
          </>
        )}
        <dt>最长门级路径</dt>
        <dd>{stats.depth} 级</dd>
      </dl>
      {editing === MAIN_ID && workspace.mode === 'free' && c.parts.some((p) => p.kind === 'in' || p.kind === 'out') && (
        <button className="btn wide" onClick={() => createChip(currentCircuit(), c.name === '主电路' ? '新芯片' : c.name)}>
          把当前电路复制为芯片
        </button>
      )}
      <div className="help-mini">
        <p>
          <b>放元件</b>：点左侧元件，或拖到画布上。
        </p>
        <p>
          <b>连线</b>：从一个引脚拖到另一个引脚；也可以先点一个引脚，再点另一个。
        </p>
        <p>
          <b>移动视图</b>：拖动空白处；滚轮或双指缩放。<b>框选</b>：按住 Shift 拖动。
        </p>
        <p>
          <b>快捷键</b>：Delete 删除、R 旋转、Ctrl+Z/Y 撤销重做、Ctrl+C/V 复制粘贴、空格 运行/暂停、. 单步。
        </p>
      </div>
    </div>
  );
}

export function Inspector() {
  const selParts = useEditor((s) => s.selParts);
  const selWires = useEditor((s) => s.selWires);
  const project = useEditor((s) => s.project);
  const editing = useEditor((s) => s.editing);
  const workspace = useEditor((s) => s.workspace);
  const c = findCircuit(project, editing) ?? project.main;
  if (selParts.length === 1 && selWires.length === 0) {
    const part = c.parts.find((p) => p.id === selParts[0]);
    if (part) return <PartProps part={part} />;
  }
  if (selWires.length === 1 && selParts.length === 0) {
    const wire = c.wires.find((w) => w.id === selWires[0]);
    if (wire) return <WireProps id={wire.id} bent={wire.bend !== undefined} />;
  }
  if (selParts.length + selWires.length > 0) {
    return (
      <div className="props">
        <h2>{selParts.length ? `已选 ${selParts.length} 个元件` : ''}{selWires.length ? `${selParts.length ? '、' : '已选 '}${selWires.length} 根导线` : ''}</h2>
        {selParts.length > 0 && (
          <div className="row">
            <button className="btn" onClick={() => rotateSelection(-1)}>
              ⟲ 旋转
            </button>
            <button className="btn" onClick={() => rotateSelection(1)}>
              ⟳ 旋转
            </button>
          </div>
        )}
        {workspace.mode === 'free' && selParts.length > 0 && (
          <>
            <button className="btn wide primary" onClick={packageSelection} data-testid="package">
              封装为芯片（Ctrl+G）
            </button>
            <p className="tip">选中的逻辑会移进一个新芯片，跨出选区的连线自动变成芯片的引脚。开关、指示灯和显示器留在外面。</p>
          </>
        )}
        <button className="btn danger wide" onClick={deleteSelection}>
          删除（Delete）
        </button>
        <p className="tip">Ctrl+C 复制、Ctrl+V 粘贴、Ctrl+D 原地复制一份。</p>
      </div>
    );
  }
  return <CircuitInfo />;
}
