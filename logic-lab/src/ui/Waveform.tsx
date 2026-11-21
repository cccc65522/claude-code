import { useEffect, useRef, useState, type ReactElement } from 'react';
import { VAL_NAME, type Val } from '../engine/values.ts';
import { simctl, useSimVersion } from '../store/simctl.ts';
import { saveUI, store } from '../store/store.ts';

const ROW = 24;
const LABEL_W = 76;
const HIGH = 5;
const LOW = ROW - 5;

function traceFor(vals: (Val | undefined)[], x0: number, step: number, y: number) {
  const segs: ReactElement[] = [];
  let d = '';
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    const xa = x0 + i * step;
    const xb = xa + step;
    if (v === 0 || v === 1) {
      const yy = y + (v === 1 ? HIGH : LOW);
      const prev = vals[i - 1];
      if (d && (prev === 0 || prev === 1)) d += ` L${xa} ${yy} L${xb} ${yy}`;
      else d += ` M${xa} ${yy} L${xb} ${yy}`;
    } else if (v !== undefined) {
      segs.push(
        <rect
          key={i}
          className={`wave-band ${v === 4 ? 've' : v === 3 ? 'vz' : 'vx'}`}
          x={xa}
          y={y + HIGH}
          width={step}
          height={LOW - HIGH}
        />
      );
      if (v === 3) segs.push(<line key={`z${i}`} className="wave-z" x1={xa} x2={xb} y1={y + ROW / 2} y2={y + ROW / 2} />);
      d += '';
    }
  }
  return (
    <>
      {segs}
      <path className="wave-line" d={d} />
    </>
  );
}

export function Waveform() {
  useSimVersion();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const signals = simctl.signals;
  const all = simctl.samples;
  const avail = Math.max(100, width - LABEL_W - 8);
  const step = Math.max(4, Math.min(22, avail / Math.max(1, all.length)));
  const count = Math.min(all.length, Math.floor(avail / step));
  const samples = all.slice(all.length - count);
  const h = signals.length * ROW + 18;
  const hoverSample = hover !== null ? samples[hover] : samples[samples.length - 1];

  return (
    <div className="waveform" ref={ref} data-testid="waveform">
      <div className="wave-head">
        <b>波形图</b>
        <span className="tip">
          {simctl.stepMode ? '逐级传播：每一格是一级门延迟' : '每一格是一次稳定状态（时钟一拍或一次输入变化）'}
          {hoverSample ? ` · 第 ${hoverSample.t} 拍${simctl.stepMode ? ` 第 ${hoverSample.d} 级` : ''}` : ''}
        </span>
        <span className="grow" />
        <button className="btn small" onClick={() => simctl.clearWave()}>
          清空
        </button>
        <button
          className="btn small"
          onClick={() => {
            store.set({ waveOpen: false });
            saveUI();
          }}
          aria-label="收起波形图"
        >
          收起
        </button>
      </div>
      {signals.length === 0 ? (
        <p className="tip pad">电路里没有输入/输出引脚、时钟、按钮或指示灯，暂时没有可记录的信号。</p>
      ) : (
        <svg
          width="100%"
          height={h}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const i = Math.floor((e.clientX - r.left - LABEL_W) / step);
            setHover(i >= 0 && i < samples.length ? i : null);
          }}
          onMouseLeave={() => setHover(null)}
        >
          {signals.map((s, row) => {
            const y = row * ROW;
            const vals = samples.map((smp) => smp.v[s.id]);
            const cur = hoverSample?.v[s.id];
            return (
              <g key={s.id} className={`wave-row kind-${s.kind}`}>
                <text className="wave-label" x={6} y={y + ROW / 2 + 4}>
                  {s.label}
                </text>
                <text className={`wave-val v${cur ?? 3}`} x={LABEL_W - 8} y={y + ROW / 2 + 4} textAnchor="end">
                  {cur === undefined ? '' : VAL_NAME[cur]}
                </text>
                <line className="wave-grid" x1={LABEL_W} x2={LABEL_W + samples.length * step} y1={y + ROW} y2={y + ROW} />
                {traceFor(vals, LABEL_W, step, y)}
              </g>
            );
          })}
          {samples.map((smp, i) =>
            i > 0 && smp.t !== samples[i - 1].t && (smp.t % 5 === 0 || step > 14) ? (
              <text key={i} className="wave-tick" x={LABEL_W + i * step} y={h - 4}>
                {smp.t}
              </text>
            ) : null
          )}
          {hover !== null && <line className="wave-cursor" x1={LABEL_W + (hover + 0.5) * step} x2={LABEL_W + (hover + 0.5) * step} y1={0} y2={h - 16} />}
        </svg>
      )}
    </div>
  );
}
