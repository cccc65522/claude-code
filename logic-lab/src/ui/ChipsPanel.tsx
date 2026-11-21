import { useState } from 'react';
import { chipDependencies, placeableChips } from '../engine/compile.ts';
import { chipInterface } from '../engine/parts.ts';
import { MAIN_ID } from '../engine/types.ts';
import { addChipInstance, chipUsage, createChip, deleteChip, enterCircuit, renameCircuit, useEditor, viewCenter } from '../store/store.ts';

export function ChipsPanel() {
  const project = useEditor((s) => s.project);
  const editing = useEditor((s) => s.editing);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const placeable = new Set(placeableChips(project, editing).map((c) => c.id));

  return (
    <div className="panel-body">
      <div className="panel-head">
        <h2>芯片</h2>
        <button className="btn small primary" onClick={() => createChip()}>
          ＋ 新建芯片
        </button>
      </div>
      <p className="tip">
        芯片就是可以重复使用的子电路：芯片内部的“输入引脚”成为它左边的接口，“输出引脚”成为右边的接口。芯片里还可以再放别的芯片。
      </p>
      {editing !== MAIN_ID && (
        <button className="btn wide" onClick={() => enterCircuit(MAIN_ID)}>
          ← 回到主电路
        </button>
      )}
      {project.chips.length === 0 && <p className="tip">还没有芯片。</p>}
      <ul className="chip-list">
        {project.chips.map((c) => {
          const { inputs, outputs } = chipInterface(c);
          const used = chipUsage(project, c.id);
          const deps = chipDependencies(project, c.id);
          return (
            <li key={c.id} className={c.id === editing ? 'current' : ''} data-chip-row={c.id}>
              {renaming === c.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    renameCircuit(c.id, draft);
                    setRenaming(null);
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    aria-label="芯片名字"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                      renameCircuit(c.id, draft);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                  />
                </form>
              ) : (
                <div className="chip-title">
                  <b>{c.name}</b>
                  <span className="tip">
                    {inputs.length} 入 {outputs.length} 出 · {c.parts.length} 个元件{deps.size ? ` · 用到 ${deps.size} 种芯片` : ''}
                    {used.length ? ` · 用在：${used.join('、')}` : ''}
                  </span>
                </div>
              )}
              <div className="row">
                <button className="btn small" onClick={() => enterCircuit(c.id)} disabled={c.id === editing}>
                  编辑
                </button>
                <button
                  className="btn small"
                  disabled={!placeable.has(c.id)}
                  title={placeable.has(c.id) ? '放到画布中央' : '不能放进它自己（或包含它的芯片）里'}
                  onClick={() => {
                    const p = viewCenter();
                    addChipInstance(c.id, p.x, p.y);
                  }}
                >
                  放置
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    setDraft(c.name);
                    setRenaming(c.id);
                  }}
                >
                  改名
                </button>
                <button
                  className="btn small danger"
                  disabled={used.length > 0}
                  title={used.length ? '还在使用中' : '删除这个芯片'}
                  onClick={() => {
                    if (confirm(`删除芯片“${c.name}”？（可以撤销）`)) deleteChip(c.id);
                  }}
                >
                  删除
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
