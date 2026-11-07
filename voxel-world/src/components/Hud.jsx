import { ATLAS_COLS, ATLAS_ROWS } from '../game/mesher.js';
import { HOTBAR_KEYS } from '../game/blocks.js';
import { itemIcon, itemName } from '../game/items.js';

// 用图集里的贴图显示物品图标
export function ItemIcon({ id, atlasUrl }) {
  const tile = itemIcon(id);
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  return (
    <span
      className="block-icon"
      style={{
        backgroundImage: `url(${atlasUrl})`,
        backgroundSize: `${ATLAS_COLS * 100}% ${ATLAS_ROWS * 100}%`,
        backgroundPosition: `${(col / (ATLAS_COLS - 1)) * 100}% ${(row / (ATLAS_ROWS - 1)) * 100}%`,
      }}
    />
  );
}

// counts 为 null 时是创造模式（方块无限，不显示数量）
export default function Hud({ slots, counts, selected, onSelect, atlasUrl, statsRef, toast, hideHotbar }) {
  return (
    <div className={'hud' + (hideHotbar ? ' bag-open' : '')}>
      <div className="stats" ref={statsRef} />
      <div className="crosshair" />
      {toast && <div className="toast" key={toast.key}>{toast.text}</div>}
      <div className="hotbar" role="toolbar" aria-label="快捷栏">
        {slots.map((id, i) => {
          const n = counts ? counts[id] ?? 0 : null;
          return (
            <button
              key={id}
              type="button"
              className={'slot' + (i === selected ? ' active' : '') + (n === 0 ? ' empty' : '')}
              onClick={() => onSelect(i)}
              onTouchStart={(e) => e.stopPropagation()}
              aria-label={`${HOTBAR_KEYS[i]} ${itemName(id)}${n === null ? '' : ` ${n} 个`}`}
              aria-pressed={i === selected}
            >
              <ItemIcon id={id} atlasUrl={atlasUrl} />
              <span className="slot-key">{HOTBAR_KEYS[i]}</span>
              {n !== null && n > 0 && <span className="slot-count">{n}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
