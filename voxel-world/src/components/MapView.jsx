import { useEffect, useRef } from 'react';

const MINI_RANGE = 64; // 小地图显示玩家周围 64×64 格

// 画玩家箭头：地图上北（-z）在上，所以朝向 yaw=0（面朝 -z）时箭头朝上
function drawArrow(ctx, x, y, yaw, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-yaw);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.8);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(-size * 0.7, size * 0.8);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1d2433';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawBed(ctx, x, y, size) {
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fillStyle = '#e53935';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
}

/**
 * 地图。mode="mini"：右上角的小地图；mode="full"：整个世界（按 M 打开）。
 * map 是 game/map.js 的 MapData；playerRef 里有位置、朝向和床的位置（spawn）。
 */
export default function MapView({ map, playerRef, mode, onClose, isTouch }) {
  const canvasRef = useRef(null);
  const source = useRef(null);

  useEffect(() => {
    // 整张地图先画到一张 256×256 的离屏画布上，有变化时才更新
    const off = document.createElement('canvas');
    off.width = map.w;
    off.height = map.h;
    source.current = { canvas: off, ctx: off.getContext('2d'), version: -1 };
  }, [map]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      if (t - last < (mode === 'mini' ? 100 : 200)) return; // 小地图每秒刷新 10 次就够了
      last = t;
      const canvas = canvasRef.current;
      const src = source.current;
      if (!canvas || !src) return;
      if (src.version !== map.version) {
        src.ctx.putImageData(new ImageData(map.pixels, map.w, map.h), 0, 0);
        src.version = map.version;
      }
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const p = playerRef.current;
      const W = canvas.width;
      ctx.fillStyle = '#ded6be';
      ctx.fillRect(0, 0, W, W);
      if (mode === 'mini') {
        const scale = W / MINI_RANGE;
        const sx = p.pos[0] - MINI_RANGE / 2;
        const sz = p.pos[2] - MINI_RANGE / 2;
        ctx.drawImage(src.canvas, sx, sz, MINI_RANGE, MINI_RANGE, 0, 0, W, W);
        if (p.spawn) {
          const bx = (p.spawn[0] + 0.5 - sx) * scale;
          const bz = (p.spawn[2] + 0.5 - sz) * scale;
          if (bx > 0 && bx < W && bz > 0 && bz < W) drawBed(ctx, bx, bz, 4);
        }
        drawArrow(ctx, W / 2, W / 2, p.yaw, 7);
      } else {
        const scale = W / map.w;
        ctx.drawImage(src.canvas, 0, 0, map.w, map.h, 0, 0, W, W);
        if (p.spawn) drawBed(ctx, (p.spawn[0] + 0.5) * scale, (p.spawn[2] + 0.5) * scale, 6);
        drawArrow(ctx, p.pos[0] * scale, p.pos[2] * scale, p.yaw, 10);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [map, playerRef, mode]);

  if (mode === 'mini') {
    return <canvas ref={canvasRef} className="minimap" width={180} height={180} aria-label="小地图" role="img" />;
  }
  const pct = Math.round(map.exploredFraction() * 100);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel map-panel" role="dialog" aria-label="地图">
        <div className="bag-head">
          <h2>地图</h2>
          <button type="button" className="close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <canvas ref={canvasRef} className="fullmap" width={768} height={768} />
        <p className="bag-foot">
          白色箭头是你，红点是你的床。已经探索了 {pct}%，没去过的地方是空白。{isTouch ? '点 × 回到游戏' : '按 M 或点 × 回到游戏'}
        </p>
      </div>
    </div>
  );
}
