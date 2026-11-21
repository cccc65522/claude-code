import { useState } from 'react';
import { countedParts, LEVELS, levelById } from '../engine/levels.ts';
import { simctl } from '../store/simctl.ts';
import { resetLevel, runCheck, saveProject, switchWorkspace, useEditor } from '../store/store.ts';

function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`${n} 星`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? 'on' : ''}>
          ★
        </span>
      ))}
    </span>
  );
}

const save = () => saveProject(simctl.inputValues());

export function LevelsPanel() {
  const workspace = useEditor((s) => s.workspace);
  const progress = useEditor((s) => s.progress);
  const check = useEditor((s) => s.check);
  const project = useEditor((s) => s.project);
  const [showHint, setShowHint] = useState(false);
  const level = workspace.mode === 'level' ? levelById(workspace.id) : undefined;
  const solved = Object.keys(progress).length;
  const idx = level ? LEVELS.indexOf(level) : -1;
  const next = idx >= 0 ? LEVELS[idx + 1] : undefined;

  return (
    <div className="panel-body levels">
      {level ? (
        <div className="level-card" data-testid="level-card">
          <div className="panel-head">
            <h2>
              第 {idx + 1} 关 · {level.title}
            </h2>
            <Stars n={progress[level.id] ?? 0} />
          </div>
          <p className="goal">{level.goal}</p>
          <p>{level.desc}</p>
          {showHint ? (
            <p className="tip hint">提示：{level.hint}</p>
          ) : (
            <button className="link" onClick={() => setShowHint(true)}>
              看提示
            </button>
          )}
          <p className="tip">
            已用 {countedParts(project.main)} 个元件，最少 {level.best} 个可以做到。
          </p>
          <div className="row">
            <button className="btn primary" onClick={() => runCheck()} data-testid="check">
              ✓ 检查
            </button>
            <button className="btn" onClick={() => confirm('清空这一关的电路，恢复到初始状态？（可以撤销）') && resetLevel()}>
              重来
            </button>
          </div>
          {check && (
            <div className={`check ${check.pass ? 'pass' : 'fail'}`} data-testid="check-result" role="status">
              {check.pass && <Stars n={check.stars} />}
              {check.messages.map((m) => (
                <p key={m}>{m}</p>
              ))}
              {check.pass && next && (
                <button
                  className="btn primary"
                  onClick={() => {
                    setShowHint(false);
                    switchWorkspace({ mode: 'level', id: next.id }, save);
                  }}
                >
                  下一关：{next.title} →
                </button>
              )}
              {check.pass && !next && <p>全部通关！可以去“自由实验”里搭更复杂的电路了。</p>}
            </div>
          )}
        </div>
      ) : (
        <p className="tip">选一关开始。每关只能用指定的元件，搭好后点“检查”，电脑会把所有输入组合都试一遍。</p>
      )}
      <h3>
        全部关卡 <span className="tip">已通过 {solved}/{LEVELS.length}</span>
      </h3>
      <ol className="level-list">
        {LEVELS.map((l, i) => (
          <li key={l.id} className={l.id === level?.id ? 'current' : ''}>
            <button
              onClick={() => {
                setShowHint(false);
                switchWorkspace({ mode: 'level', id: l.id }, save);
              }}
              data-level={l.id}
            >
              <span className="num">{i + 1}</span>
              <span className="title">{l.title}</span>
              <Stars n={progress[l.id] ?? 0} />
            </button>
          </li>
        ))}
      </ol>
      {level && (
        <button className="btn wide" onClick={() => switchWorkspace({ mode: 'free' }, save)}>
          ← 回到自由实验
        </button>
      )}
    </div>
  );
}
