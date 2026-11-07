import { ATLAS_COLS, ATLAS_ROWS } from '../game/mesher.js';
import { HOTBAR_KEYS } from '../game/blocks.js';
import { itemIcon, itemName } from '../game/items.js';
import { MAX_AIR, MAX_HEALTH, MAX_HUNGER } from '../game/health.js';

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

const HEART = 'M8 14.2 1.9 8.3A3.7 3.7 0 0 1 8 3.6a3.7 3.7 0 0 1 6.1 4.7Z';

// 生命值：10 颗心，每颗 2 点
function Hearts({ health }) {
  const hearts = [];
  for (let i = 0; i < MAX_HEALTH / 2; i++) {
    const fill = Math.max(0, Math.min(2, health - i * 2)); // 0 空，1 半颗，2 满
    hearts.push(
      <svg key={i} className="heart" viewBox="0 0 16 16" aria-hidden="true">
        <path d={HEART} className="heart-empty" />
        {fill > 0 && (
          <path d={HEART} className="heart-full" style={fill === 1 ? { clipPath: 'inset(0 50% 0 0)' } : undefined} />
        )}
      </svg>,
    );
  }
  return (
    <div className={'hearts' + (health <= 6 ? ' low' : '')} role="img" aria-label={`生命值 ${health / 2} / ${MAX_HEALTH / 2}`}>
      {hearts}
    </div>
  );
}

// 饱食度：10 个鸡腿，从右往左减少
function Hunger({ hunger }) {
  const legs = [];
  for (let i = 0; i < MAX_HUNGER / 2; i++) {
    const fill = Math.max(0, Math.min(2, hunger - i * 2));
    legs.push(
      <svg key={i} className="drumstick" viewBox="0 0 16 16" aria-hidden="true">
        <g className="leg-empty">
          <ellipse cx="6.5" cy="6.5" rx="5" ry="4.5" transform="rotate(-45 6.5 6.5)" />
          <path d="M9.6 9.6 13 13M12 14.5l2.5-2.5" />
        </g>
        {fill > 0 && (
          <g className="leg-full" style={fill === 1 ? { clipPath: 'inset(0 0 0 50%)' } : undefined}>
            <ellipse cx="6.5" cy="6.5" rx="5" ry="4.5" transform="rotate(-45 6.5 6.5)" />
            <path d="M9.6 9.6 13 13M12 14.5l2.5-2.5" />
          </g>
        )}
      </svg>,
    );
  }
  return (
    <div className={'hunger' + (hunger <= 6 ? ' low' : '')} role="img" aria-label={`饱食度 ${hunger / 2} / ${MAX_HUNGER / 2}`}>
      {legs}
    </div>
  );
}

// 氧气：在水下才显示
function Bubbles({ air }) {
  return (
    <div className="bubbles" role="img" aria-label={`氧气 ${air} / ${MAX_AIR}`}>
      {Array.from({ length: MAX_AIR }, (_, i) => (
        <span key={i} className={'bubble' + (i < air ? '' : ' popped')} />
      ))}
    </div>
  );
}

// counts 为 null 时是创造模式（方块无限，不显示数量），health 为 null 时不显示生命值
export default function Hud({ slots, counts, selected, onSelect, atlasUrl, statsRef, toast, hideHotbar, health, air, hunger }) {
  return (
    <div className={'hud' + (hideHotbar ? ' bag-open' : '')}>
      <div className="stats" ref={statsRef} />
      <div className="crosshair" />
      {toast && <div className="toast" key={toast.key}>{toast.text}</div>}
      {health !== null && !hideHotbar && (
        <div className="status">
          <Hearts health={health} />
          <div className="status-right">
            {air < MAX_AIR && <Bubbles air={air} />}
            <Hunger hunger={hunger} />
          </div>
        </div>
      )}
      <div className="hotbar" role="toolbar" aria-label="快捷栏">
        {slots.map((id, i) => {
          const n = counts ? counts[id] ?? 0 : null;
          return (
            <button
              key={i} // 同一样东西可能在快捷栏里出现两次（最后一格是自选的）
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
