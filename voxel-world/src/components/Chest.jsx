import { ITEM_ORDER, countOf, itemName } from '../game/items.js';
import { ItemIcon } from './Hud.jsx';

// 列出一个“背包”里的东西，每样有“1 个”和“全部”两个按钮
function ItemList({ box, atlasUrl, verb, onMove, empty }) {
  const ids = ITEM_ORDER.filter((id) => countOf(box, id) > 0);
  // ITEM_ORDER 里没有的（以防万一）也列出来
  for (const key of Object.keys(box)) if (!ids.includes(Number(key))) ids.push(Number(key));
  if (!ids.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="foods">
      {ids.map((id) => (
        <li key={id} className="food">
          <ItemIcon id={id} atlasUrl={atlasUrl} />
          <span className="food-text">
            {itemName(id)} ×{countOf(box, id)}
          </span>
          <button type="button" onClick={() => onMove(id, 1)}>{verb} 1</button>
          <button type="button" onClick={() => onMove(id, countOf(box, id))}>全部</button>
        </li>
      ))}
    </ul>
  );
}

// 箱子面板：上面是箱子里的东西（取出来），下面是背包（存进去）
export default function Chest({ box, inventory, atlasUrl, onTake, onStore, onClose, isTouch }) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel bag" role="dialog" aria-label="箱子">
        <div className="bag-head">
          <h2>箱子</h2>
          <button type="button" className="close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <h3>箱子里</h3>
        <ItemList box={box} atlasUrl={atlasUrl} verb="取" onMove={onTake} empty="箱子是空的。" />
        <h3>背包</h3>
        <ItemList box={inventory} atlasUrl={atlasUrl} verb="存" onMove={onStore} empty="背包是空的。" />
        <p className="bag-foot">{isTouch ? '点 × 回到游戏' : '按 E 或点 × 回到游戏'}。挖掉箱子时，里面的东西会自动放进背包。</p>
      </div>
    </div>
  );
}
