import { useEffect, useRef, useState } from 'react';
import { findCircuit } from './engine/compile.ts';
import { levelById } from './engine/levels.ts';
import { decodeShare, encodeShare, parseProject, projectToJSON } from './engine/serialize.ts';
import { MAIN_ID } from './engine/types.ts';
import { simctl, SPEEDS, useSimVersion } from './store/simctl.ts';
import {
  copySelection,
  currentCircuit,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  enterCircuit,
  loadProject,
  movePartsBy,
  newProject,
  packageSelection,
  paste,
  redo,
  rotateSelection,
  saveProject,
  saveUI,
  selectAll,
  store,
  switchWorkspace,
  toast,
  undo,
  useEditor,
  withInputValues,
  zoomToFit,
  type Tab
} from './store/store.ts';
import { Canvas } from './ui/Canvas.tsx';
import { ChipsPanel } from './ui/ChipsPanel.tsx';
import { ExamplesDialog, ExprDialog, HelpDialog } from './ui/Dialogs.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { LevelsPanel } from './ui/LevelsPanel.tsx';
import { Palette } from './ui/Palette.tsx';
import { TruthPanel } from './ui/TruthPanel.tsx';
import { Waveform } from './ui/Waveform.tsx';

const save = () => saveProject(simctl.inputValues());

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || store.get().dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const s = store.get();
      // Keys bound to inputs and buttons of the circuit being simulated.
      if (!mod && !e.altKey && s.editing === MAIN_ID) {
        const bound = currentCircuit(s).parts.filter((p) => p.key === key && (p.kind === 'in' || p.kind === 'button'));
        if (bound.length) {
          e.preventDefault();
          if (e.repeat) return;
          for (const p of bound) p.kind === 'in' ? simctl.toggleInput(p.id) : simctl.setButton(p.id, true);
          return;
        }
      }
      if (mod && key === 'z' && !e.shiftKey) undo();
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) redo();
      else if (mod && key === 'c') copySelection() && toast('已复制');
      else if (mod && key === 'x') cutSelection();
      else if (mod && key === 'v') paste();
      else if (mod && key === 'd') duplicateSelection();
      else if (mod && key === 'a') selectAll();
      else if (mod && key === 'g') packageSelection();
      else if (mod) return;
      else if (key === 'delete' || key === 'backspace') deleteSelection();
      else if (key === 'r') rotateSelection(e.shiftKey ? -1 : 1);
      else if (key === ' ') simctl.setRunning(!simctl.running);
      else if (key === '.') simctl.step();
      else if (key === 'f') zoomToFit();
      else if (key === 'escape') store.set({ pendingPin: null, selParts: [], selWires: [] });
      else if (key.startsWith('arrow') && s.selParts.length) {
        const d = e.shiftKey ? 4 : 1;
        movePartsBy(s.selParts, key === 'arrowleft' ? -d : key === 'arrowright' ? d : 0, key === 'arrowup' ? -d : key === 'arrowdown' ? d : 0);
      } else return;
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const s = store.get();
      if (s.editing !== MAIN_ID) return;
      for (const p of currentCircuit(s).parts) if (p.kind === 'button' && p.key === e.key.toLowerCase()) simctl.setButton(p.id, false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}

function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 400);
    };
    let last = store.get().project;
    const unsub = store.subscribe(() => {
      const p = store.get().project;
      if (p !== last) {
        last = p;
        schedule();
      }
    });
    simctl.onInputsChanged = schedule;
    const flush = () => {
      clearTimeout(timer);
      save();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      unsub();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);
}

function useShareLink() {
  useEffect(() => {
    const m = location.hash.match(/^#c=(.+)$/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    decodeShare(m[1]).then(
      (p) => {
        if (store.get().workspace.mode === 'level') switchWorkspace({ mode: 'free' }, save);
        loadProject(p, '已打开分享的电路（可以撤销）');
      },
      (e: Error) => toast(e.message, 'error')
    );
  }, []);
}

function FileMenu() {
  const [open, setOpen] = useState(false);
  const workspace = useEditor((s) => s.workspace);
  const fileRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const free = workspace.mode === 'free';
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const exportFile = () => {
    const s = store.get();
    const p = withInputValues(s.project, s.editing, simctl.inputValues());
    const blob = new Blob([JSON.stringify(JSON.parse(projectToJSON(p)), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.main.name || '电路'}.mendao.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const share = async () => {
    const s = store.get();
    const code = await encodeShare(withInputValues(s.project, s.editing, simctl.inputValues()));
    const url = `${location.origin}${location.pathname}#c=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`分享链接已复制（${url.length} 个字符）。别人打开就能看到这个电路。`, 'ok');
    } catch {
      prompt('复制这个链接：', url);
    }
  };
  return (
    <div className="menu" ref={ref}>
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="file-menu">
        文件 ▾
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button role="menuitem" onClick={run(newProject)}>
            {free ? '新建空白电路' : '重来这一关'}
          </button>
          <button role="menuitem" disabled={!free} onClick={run(() => store.set({ dialog: 'examples' }))}>
            打开示例…
          </button>
          <button role="menuitem" disabled={!free} onClick={run(() => store.set({ dialog: 'expr' }))}>
            由表达式或真值表生成电路…
          </button>
          <hr />
          <button role="menuitem" disabled={!free} onClick={run(() => fileRef.current?.click())}>
            导入文件…
          </button>
          <button role="menuitem" onClick={run(exportFile)}>
            导出文件
          </button>
          <button role="menuitem" onClick={run(share)}>
            复制分享链接
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            loadProject(parseProject(JSON.parse(await f.text())), `已导入“${f.name}”`);
          } catch (err) {
            toast(`导入失败：${(err as Error).message}`, 'error');
          }
        }}
      />
    </div>
  );
}

function SimControls() {
  useSimVersion();
  return (
    <div className="sim-controls">
      <button
        className={`btn ${simctl.running ? 'on' : 'primary'}`}
        onClick={() => simctl.setRunning(!simctl.running)}
        title="让时钟走起来（空格）"
        data-testid="run"
      >
        {simctl.running ? '⏸' : '▶'}
        <span className="lbl"> {simctl.running ? '暂停' : '运行'}</span>
      </button>
      <button className="btn" onClick={() => simctl.step()} title={simctl.stepMode ? '走一级门延迟（.）' : '时钟走一拍（.）'} data-testid="step">
        ⏭<span className="lbl"> {simctl.stepMode ? '下一级' : '单拍'}</span>
      </button>
      <select
        className="speed"
        value={simctl.speed}
        onChange={(e) => simctl.setSpeed(Number(e.target.value))}
        title="运行速度（拍/秒）"
        aria-label="运行速度"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s} 拍/秒
          </option>
        ))}
      </select>
      <label className={`toggle ${simctl.stepMode ? 'on' : ''}`} title="一级一级地显示信号传播">
        <input type="checkbox" checked={simctl.stepMode} onChange={(e) => simctl.setStepMode(e.target.checked)} data-testid="step-mode" />
        <span>
          逐级<span className="lbl">传播</span>
        </span>
      </label>
      <button className="btn" onClick={() => simctl.reset()} title="复位：触发器清零、时钟归零" aria-label="复位">
        ⟲<span className="lbl"> 复位</span>
      </button>
    </div>
  );
}

function StatusBar() {
  useSimVersion();
  const project = useEditor((s) => s.project);
  const editing = useEditor((s) => s.editing);
  const c = findCircuit(project, editing) ?? project.main;
  const sim = simctl.sim;
  const errors = simctl.nl.errors;
  return (
    <div className="statusbar" data-testid="status">
      <span>第 {sim.time} 拍</span>
      {simctl.stepMode && simctl.busy && <span className="busy">信号传播中…</span>}
      {sim.oscillating && (
        <span className="warn" data-testid="osc-warning">
          ⚠ 电路振荡，无法稳定
        </span>
      )}
      {errors.slice(0, 2).map((e, i) => (
        <span key={i} className="warn">
          ⚠ {e.message}
        </span>
      ))}
      <span className="grow" />
      <span className="dim">
        {c.parts.length} 个元件 · {c.wires.length} 根导线{simctl.nl.comps.length > c.parts.length ? ` · 展开后 ${simctl.nl.comps.length} 个` : ''}
      </span>
    </div>
  );
}

function Breadcrumb() {
  const editing = useEditor((s) => s.editing);
  const project = useEditor((s) => s.project);
  if (editing === MAIN_ID) return null;
  const chip = project.chips.find((c) => c.id === editing);
  return (
    <div className="breadcrumb" data-testid="breadcrumb">
      <button className="link" onClick={() => enterCircuit(MAIN_ID)}>
        主电路
      </button>
      <span>›</span>
      <b>{chip?.name}</b>
      <span className="tip">正在编辑芯片内部（这里可以单独仿真）</span>
      <button className="btn small" onClick={() => enterCircuit(MAIN_ID)}>
        ← 返回
      </button>
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'props', label: '属性' },
  { id: 'table', label: '真值表' },
  { id: 'chips', label: '芯片' },
  { id: 'levels', label: '闯关' }
];

function SidePanel() {
  const tab = useEditor((s) => s.tab);
  const workspace = useEditor((s) => s.workspace);
  const tabs = TABS.filter((t) => !(t.id === 'chips' && workspace.mode === 'level'));
  const active = tabs.some((t) => t.id === tab) ? tab : 'props';
  return (
    <>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            className={active === t.id ? 'on' : ''}
            onClick={() => {
              store.set({ tab: t.id });
              saveUI();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel">
        {active === 'props' && <Inspector />}
        {active === 'table' && <TruthPanel />}
        {active === 'chips' && <ChipsPanel />}
        {active === 'levels' && <LevelsPanel />}
      </div>
    </>
  );
}

export function App() {
  useKeyboard();
  useAutosave();
  useShareLink();
  const dialog = useEditor((s) => s.dialog);
  const toastMsg = useEditor((s) => s.toast);
  const theme = useEditor((s) => s.theme);
  const workspace = useEditor((s) => s.workspace);
  const waveOpen = useEditor((s) => s.waveOpen);
  const sheetOpen = useEditor((s) => s.sheetOpen);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const selCount = useEditor((s) => s.selParts.length + s.selWires.length);
  const [pane, setPane] = useState<'palette' | 'panel'>('palette');
  const level = workspace.mode === 'level' ? levelById(workspace.id) : undefined;

  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const openSheet = (p: 'palette' | 'panel') => {
    if (sheetOpen && pane === p) store.set({ sheetOpen: false });
    else {
      setPane(p);
      store.set({ sheetOpen: true });
    }
  };

  return (
    <div className={`app${sheetOpen ? ' sheet-open' : ''} pane-${pane}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M4 4 H11 A8 8 0 0 1 11 20 H4 Z" />
            </svg>
          </span>
          <b>门道</b>
          <span className="sub">数字电路实验台</span>
        </div>
        <div className="seg ws" role="group" aria-label="模式">
          <button className={workspace.mode === 'free' ? 'on' : ''} onClick={() => workspace.mode !== 'free' && switchWorkspace({ mode: 'free' }, save)}>
            自由实验
          </button>
          <button
            className={workspace.mode === 'level' ? 'on' : ''}
            data-testid="levels-mode"
            onClick={() => {
              if (workspace.mode === 'level') return;
              const progress = store.get().progress;
              const first = ['wire', 'not-from-nand', 'and-from-nand', 'or-from-nand', 'xor-from-nand'].find((id) => !progress[id]) ?? 'wire';
              switchWorkspace({ mode: 'level', id: first }, save);
            }}
          >
            闯关
          </button>
        </div>
        <FileMenu />
        <div className="row tight">
          <button className="icon-btn" onClick={undo} disabled={!past} title="撤销（Ctrl+Z）" aria-label="撤销">
            ↶
          </button>
          <button className="icon-btn" onClick={redo} disabled={!future} title="重做（Ctrl+Y）" aria-label="重做">
            ↷
          </button>
        </div>
        <SimControls />
        <span className="grow" />
        <button
          className={`btn desktop-only${waveOpen ? ' on' : ''}`}
          onClick={() => {
            store.set({ waveOpen: !waveOpen });
            saveUI();
          }}
          data-testid="wave-toggle"
        >
          波形
        </button>
        <button className="icon-btn fit-btn" onClick={zoomToFit} title="缩放到合适大小（F）" aria-label="缩放到合适大小">
          ⤢
        </button>
        <button
          className="icon-btn theme-btn"
          onClick={() => {
            const next = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';
            store.set({ theme: next });
            saveUI();
            toast(next === 'auto' ? '跟随系统深浅色' : next === 'dark' ? '深色模式' : '浅色模式');
          }}
          title="切换深浅色"
          aria-label="切换深浅色"
        >
          ◐
        </button>
        <button className="icon-btn help-btn" onClick={() => store.set({ dialog: 'help' })} title="使用说明" aria-label="使用说明">
          ?
        </button>
      </header>

      <aside className="left">
        <Palette />
      </aside>

      <main className="center">
        <Breadcrumb />
        {level && (
          <div className="level-banner">
            <b>{level.title}</b>
            <span>{level.goal}</span>
          </div>
        )}
        <div className="canvas-wrap">
          <Canvas />
          {selCount > 0 && (
            <div className="floating-actions">
              <button className="btn small" onClick={() => rotateSelection(1)} aria-label="旋转">
                ⟳
              </button>
              <button className="btn small danger" onClick={deleteSelection} aria-label="删除所选">
                删除
              </button>
            </div>
          )}
        </div>
        <StatusBar />
        {waveOpen && <Waveform />}
      </main>

      <aside className="right">
        <SidePanel />
      </aside>

      <nav className="mobile-nav">
        <button className={sheetOpen && pane === 'palette' ? 'on' : ''} onClick={() => openSheet('palette')}>
          元件
        </button>
        <button className={sheetOpen && pane === 'panel' ? 'on' : ''} onClick={() => openSheet('panel')}>
          {level ? '关卡' : '面板'}
        </button>
        <button
          onClick={() => {
            store.set({ waveOpen: !waveOpen, sheetOpen: false });
            saveUI();
          }}
          className={waveOpen ? 'on' : ''}
        >
          波形
        </button>
        {sheetOpen && (
          <button className="close" onClick={() => store.set({ sheetOpen: false })} aria-label="收起">
            ✕
          </button>
        )}
      </nav>

      {dialog === 'examples' && <ExamplesDialog />}
      {dialog === 'expr' && <ExprDialog />}
      {dialog === 'help' && <HelpDialog />}
      {toastMsg && (
        <div key={toastMsg.id} className={`toast ${toastMsg.kind}`} role="status" data-testid="toast">
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}

// Keep the current circuit referenced for debugging from the console.
(globalThis as unknown as { mendao: unknown }).mendao = { store, simctl, currentCircuit };
