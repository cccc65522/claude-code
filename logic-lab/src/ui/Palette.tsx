import { memo } from 'react';
import { placeableChips } from '../engine/compile.ts';
import { levelById } from '../engine/levels.ts';
import { KIND_NAME, partSpec } from '../engine/parts.ts';
import type { Part, PartKind, Project } from '../engine/types.ts';
import type { Val } from '../engine/values.ts';
import { addChipInstance, addPart, defaultProps, store, useEditor, viewCenter } from '../store/store.ts';
import { PartView } from './PartShape.tsx';

const GROUPS: { title: string; kinds: PartKind[] }[] = [
  { title: '输入输出', kinds: ['in', 'out', 'button', 'clock', 'const', 'led', 'hex', 'seg7'] },
  { title: '逻辑门', kinds: ['and', 'or', 'not', 'xor', 'nand', 'nor', 'xnor', 'buf'] },
  { title: '组合与时序', kinds: ['mux', 'tri', 'dff', 'jkff', 'tff'] },
  { title: '存储', kinds: ['reg', 'rom', 'ram'] },
  { title: '标注与连线', kinds: ['tunnel', 'text'] }
];

const ICON_VALUES: Partial<Record<PartKind, Val[]>> = {
  in: [1],
  out: [1],
  led: [1],
  hex: [1, 0, 1, 0],
  seg7: [1, 1, 1, 1, 1, 1, 1].map((v, i) => (i === 6 ? 0 : v)) as Val[]
};

const PartIcon = memo(function PartIcon({ kind, project, chip }: { kind: PartKind; project?: Project; chip?: string }) {
  const part: Part = { id: 'icon', kind, x: 0, y: 0, rot: 0, ...defaultProps(kind), ...(chip ? { chip } : {}) };
  if (kind === 'text') part.text = 'Aa';
  const spec = partSpec(part, project);
  const pad = 0.6;
  const size = Math.max(spec.w, spec.h) + pad * 2;
  const vals = ICON_VALUES[kind] ?? spec.pins.map(() => 0 as Val);
  return (
    <svg className="palette-icon" viewBox={`${(spec.w - size) / 2} ${(spec.h - size) / 2} ${size} ${size}`} aria-hidden>
      <PartView part={part} spec={spec} selected={false} vals={vals} />
      {spec.pins.map((p) => (
        <circle key={p.name} className="pin-dot icon-pin" cx={p.x} cy={p.y} r={0.18} />
      ))}
    </svg>
  );
});

export function Palette() {
  const workspace = useEditor((s) => s.workspace);
  const project = useEditor((s) => s.project);
  const editing = useEditor((s) => s.editing);
  const level = workspace.mode === 'level' ? levelById(workspace.id) : undefined;
  const allowed = level ? new Set<PartKind>([...level.palette, 'text', 'tunnel']) : null;
  const chips = level ? [] : placeableChips(project, editing);

  const place = (kind: PartKind, chip?: string) => {
    const c = viewCenter();
    if (kind === 'chip' && chip) addChipInstance(chip, c.x, c.y);
    else addPart(kind, c.x, c.y);
    store.set({ sheetOpen: false });
  };

  return (
    <nav className="palette" aria-label="元件">
      {GROUPS.map((g) => {
        const kinds = allowed ? g.kinds.filter((k) => allowed.has(k)) : g.kinds;
        if (!kinds.length) return null;
        return (
          <section key={g.title} className="palette-group">
            <h3>{g.title}</h3>
            <div className="palette-items">
              {kinds.map((k) => (
                <button
                  key={k}
                  className="palette-item"
                  data-kind={k}
                  title={`${KIND_NAME[k]}：点击放到画布中央，或拖到画布上`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-mendao', JSON.stringify({ kind: k }));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => place(k)}
                >
                  <PartIcon kind={k} />
                  <span>{KIND_NAME[k]}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {level && level.palette.length === 0 && <p className="palette-empty">这一关只需要连线。</p>}
      {!level && (
        <section className="palette-group">
          <h3>我的芯片</h3>
          {chips.length === 0 ? (
            <p className="palette-empty">还没有芯片。在右侧“芯片”页新建，或把当前电路封装成芯片。</p>
          ) : (
            <div className="palette-items">
              {chips.map((c) => (
                <button
                  key={c.id}
                  className="palette-item chip-item"
                  data-chip={c.id}
                  title={`芯片“${c.name}”`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-mendao', JSON.stringify({ kind: 'chip', chip: c.id }));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => place('chip', c.id)}
                >
                  <PartIcon kind="chip" chip={c.id} project={project} />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </nav>
  );
}
