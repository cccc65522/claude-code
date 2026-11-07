import { ITEM_ORDER, countOf, itemName } from '../game/items.js';
import { RECIPES, maxCrafts } from '../game/crafting.js';
import { ItemIcon } from './Hud.jsx';

function Stack({ id, n, atlasUrl, missing }) {
  return (
    <span className={'stack' + (missing ? ' missing' : '')} title={itemName(id)}>
      <ItemIcon id={id} atlasUrl={atlasUrl} />
      <span className="stack-text">
        {itemName(id)} ×{n}
      </span>
    </span>
  );
}

// 背包和合成面板
export default function Inventory({ inventory, atlasUrl, onCraft, onClose, isTouch }) {
  const items = ITEM_ORDER.filter((id) => countOf(inventory, id) > 0);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel bag" role="dialog" aria-label="背包与合成">
        <div className="bag-head">
          <h2>背包与合成</h2>
          <button type="button" className="close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <h3>背包</h3>
        {items.length ? (
          <div className="bag-grid">
            {items.map((id) => (
              <div key={id} className="bag-item" title={itemName(id)}>
                <ItemIcon id={id} atlasUrl={atlasUrl} />
                <span className="bag-count">{countOf(inventory, id)}</span>
                <span className="bag-name">{itemName(id)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">背包是空的。先去挖点方块、砍棵树吧。</p>
        )}

        <h3>合成</h3>
        <ul className="recipes">
          {RECIPES.map((r) => {
            const n = maxCrafts(inventory, r);
            return (
              <li key={r.id} className={'recipe' + (n > 0 ? ' ok' : '')}>
                <div className="recipe-line">
                  {r.inputs.map(([id, need]) => (
                    <Stack key={id} id={id} n={need} atlasUrl={atlasUrl} missing={countOf(inventory, id) < need} />
                  ))}
                  <span className="arrow" aria-label="得到">→</span>
                  <Stack id={r.output[0]} n={r.output[1]} atlasUrl={atlasUrl} />
                </div>
                <div className="recipe-actions">
                  <button type="button" disabled={n < 1} onClick={() => onCraft(r, 1)}>合成</button>
                  <button type="button" disabled={n < 2} onClick={() => onCraft(r, n)}>
                    全部{n >= 2 ? ` ×${n}` : ''}
                  </button>
                </div>
                {n === 0 && r.hint && <p className="hint">{r.hint}</p>}
              </li>
            );
          })}
        </ul>
        <p className="bag-foot">{isTouch ? '点 × 回到游戏' : '按 E 或点 × 回到游戏'}</p>
      </div>
    </div>
  );
}
