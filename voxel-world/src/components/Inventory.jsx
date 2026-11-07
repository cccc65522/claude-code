import { FOODS, ITEM_ORDER, countOf, foodValue, itemName } from '../game/items.js';
import { canUseCustomSlot, creativePalette } from '../game/home.js';
import { MAX_HUNGER } from '../game/health.js';
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

// 创造模式：方块选择器，点一下放到快捷栏最后一格
function Palette({ atlasUrl, custom, onSetCustom, onClose }) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel bag" role="dialog" aria-label="选方块">
        <div className="bag-head">
          <h2>选方块</h2>
          <button type="button" className="close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <p className="bag-note">点一样东西，把它放到快捷栏最后一格（=）。</p>
        <div className="bag-grid">
          {creativePalette().map((id) => (
            <button
              key={id}
              type="button"
              className={'bag-item pick' + (id === custom ? ' current' : '')}
              onClick={() => onSetCustom(id)}
              aria-pressed={id === custom}
            >
              <ItemIcon id={id} atlasUrl={atlasUrl} />
              <span className="bag-name">{itemName(id)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// 背包和合成面板
export default function Inventory({ inventory, atlasUrl, onCraft, onClose, isTouch, onEat, hunger, creative, custom, onSetCustom }) {
  if (creative) return <Palette atlasUrl={atlasUrl} custom={custom} onSetCustom={onSetCustom} onClose={onClose} />;
  const items = ITEM_ORDER.filter((id) => countOf(inventory, id) > 0);
  const foods = FOODS.filter((id) => countOf(inventory, id) > 0);
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
            {items.map((id) =>
              canUseCustomSlot(id) ? (
                // 能放的东西：点一下放到快捷栏最后一格
                <button
                  key={id}
                  type="button"
                  className={'bag-item pick' + (id === custom ? ' current' : '')}
                  title={`${itemName(id)}：点一下放到快捷栏最后一格`}
                  onClick={() => onSetCustom(id)}
                  aria-pressed={id === custom}
                >
                  <ItemIcon id={id} atlasUrl={atlasUrl} />
                  <span className="bag-count">{countOf(inventory, id)}</span>
                  <span className="bag-name">{itemName(id)}</span>
                </button>
              ) : (
                <div key={id} className="bag-item" title={itemName(id)}>
                  <ItemIcon id={id} atlasUrl={atlasUrl} />
                  <span className="bag-count">{countOf(inventory, id)}</span>
                  <span className="bag-name">{itemName(id)}</span>
                </div>
              ),
            )}
          </div>
        ) : (
          <p className="empty">背包是空的。先去挖点方块、砍棵树吧。</p>
        )}

        <p className="bag-note">工具不用拿在手上：挖方块时会自动用背包里最合适的工具。点能放的东西（绿框）可以把它放到快捷栏最后一格（=）。</p>

        <h3>
          食物 <span className="h3-note">饱食度 {hunger / 2} / {MAX_HUNGER / 2}</span>
        </h3>
        {foods.length ? (
          <ul className="foods">
            {foods.map((id) => (
              <li key={id} className="food">
                <ItemIcon id={id} atlasUrl={atlasUrl} />
                <span className="food-text">
                  {itemName(id)} ×{countOf(inventory, id)} <span className="food-value">+{foodValue(id) / 2} 鸡腿</span>
                </span>
                <button type="button" disabled={hunger >= MAX_HUNGER} onClick={() => onEat(id)}>
                  吃
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">没有吃的。砍树叶有时掉苹果，挖草方块有时挖到野莓。</p>
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
