import { BLOCKS, HOTBAR } from '../game/blocks.js';
import { ATLAS_COLS, ATLAS_ROWS } from '../game/mesher.js';

// 用图集里的贴图显示快捷栏图标
export function BlockIcon({ id, atlasUrl }) {
  const tile = BLOCKS[id].tiles.side;
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

export default function Hud({ selected, onSelect, atlasUrl, statsRef, toast }) {
  return (
    <div className="hud">
      <div className="stats" ref={statsRef} />
      <div className="crosshair" />
      {toast && <div className="toast" key={toast.key}>{toast.text}</div>}
      <div className="hotbar" role="toolbar" aria-label="方块快捷栏">
        {HOTBAR.map((id, i) => (
          <button
            key={id}
            type="button"
            className={'slot' + (i === selected ? ' active' : '')}
            onClick={() => onSelect(i)}
            onTouchStart={(e) => e.stopPropagation()}
            aria-label={`${i + 1} ${BLOCKS[id].name}`}
            aria-pressed={i === selected}
          >
            <BlockIcon id={id} atlasUrl={atlasUrl} />
            <span className="slot-key">{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
