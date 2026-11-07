import { useRef, useState } from 'react';

const RADIUS = 52;

// 手机操作：左下角摇杆移动，在屏幕其他地方拖动转视角，右下角按钮挖 / 放 / 跳。
export default function TouchControls({ input, onPause, flying, onToggleFly, onBag, onEat }) {
  const joyId = useRef(null);
  const joyCenter = useRef([0, 0]);
  const lookId = useRef(null);
  const lookLast = useRef([0, 0]);
  const [knob, setKnob] = useState(null);

  const onJoyStart = (e) => {
    const t = e.changedTouches[0];
    joyId.current = t.identifier;
    const rect = e.currentTarget.getBoundingClientRect();
    joyCenter.current = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    onJoyMove(e);
  };
  const onJoyMove = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId.current) continue;
      let dx = t.clientX - joyCenter.current[0];
      let dy = t.clientY - joyCenter.current[1];
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      input.move = { x: dx / RADIUS, y: dy / RADIUS };
      setKnob([dx, dy]);
    }
  };
  const onJoyEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId.current) continue;
      joyId.current = null;
      input.move = { x: 0, y: 0 };
      setKnob(null);
    }
  };

  const onLookStart = (e) => {
    if (lookId.current !== null) return;
    const t = e.changedTouches[0];
    lookId.current = t.identifier;
    lookLast.current = [t.clientX, t.clientY];
  };
  const onLookMove = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId.current) continue;
      input.lookX += (t.clientX - lookLast.current[0]) * 0.006;
      input.lookY += (t.clientY - lookLast.current[1]) * 0.006;
      lookLast.current = [t.clientX, t.clientY];
    }
  };
  const onLookEnd = (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId.current) lookId.current = null;
  };

  const hold = (kind) => ({
    onTouchStart: (e) => {
      e.stopPropagation();
      input.actions.push(kind);
      input.held[kind] = true;
      input.held[kind + 'Timer'] = -0.2; // 按住约 0.4 秒后开始连续执行
    },
    onTouchEnd: () => {
      input.held[kind] = false;
    },
    onTouchCancel: () => {
      input.held[kind] = false;
    },
  });

  const flag = (name) => ({
    onTouchStart: (e) => {
      e.stopPropagation();
      input[name] = true;
    },
    onTouchEnd: () => {
      input[name] = false;
    },
    onTouchCancel: () => {
      input[name] = false;
    },
  });

  return (
    <div className="touch-layer" onTouchStart={onLookStart} onTouchMove={onLookMove} onTouchEnd={onLookEnd} onTouchCancel={onLookEnd}>
      <div
        className="joystick"
        onTouchStart={(e) => {
          e.stopPropagation();
          onJoyStart(e);
        }}
        onTouchMove={(e) => {
          e.stopPropagation();
          onJoyMove(e);
        }}
        onTouchEnd={onJoyEnd}
        onTouchCancel={onJoyEnd}
      >
        <div className="knob" style={knob ? { transform: `translate(${knob[0]}px, ${knob[1]}px)` } : undefined} />
      </div>

      <div className="touch-buttons">
        <button type="button" className="tbtn dig" {...hold('dig')}>挖</button>
        <button type="button" className="tbtn place" {...hold('place')}>放</button>
        <button type="button" className="tbtn jump" {...flag('touchJump')}>{flying ? '上' : '跳'}</button>
        {flying && <button type="button" className="tbtn down" {...flag('touchDown')}>下</button>}
      </div>

      <div className="touch-top">
        {onEat && (
          <button type="button" className="chip" onTouchStart={(e) => e.stopPropagation()} onClick={onEat}>
            吃
          </button>
        )}
        {onBag && (
          <button type="button" className="chip" onTouchStart={(e) => e.stopPropagation()} onClick={onBag}>
            背包
          </button>
        )}
        <button type="button" className="chip" onTouchStart={(e) => e.stopPropagation()} onClick={onToggleFly}>
          {flying ? '停止飞行' : '飞行'}
        </button>
        <button type="button" className="chip" onTouchStart={(e) => e.stopPropagation()} onClick={onPause}>
          暂停
        </button>
      </div>
    </div>
  );
}
