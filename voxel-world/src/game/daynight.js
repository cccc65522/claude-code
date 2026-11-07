// 昼夜循环。t 在 [0,1) 之间：0 = 午夜，0.25 = 日出（6:00），0.5 = 正午，0.75 = 日落（18:00）。

export const DAY_SECONDS = 720; // 现实里 12 分钟是游戏里的一整天
export const MORNING = 0.3;
export const NIGHT = 0.85;

const DAY_SKY = [0.66, 0.85, 1.0];
const NIGHT_SKY = [0.03, 0.05, 0.13];
const DUSK_SKY = [1.0, 0.62, 0.36];

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

export function wrapTime(t) {
  return ((t % 1) + 1) % 1;
}

export function skyAt(t) {
  const angle = (wrapTime(t) - 0.25) * Math.PI * 2;
  const elevation = Math.sin(angle); // 太阳高度：1 正午，-1 午夜
  const len = Math.hypot(Math.cos(angle), elevation, 0.35);
  const sunDir = [Math.cos(angle) / len, elevation / len, 0.35 / len];

  const day = smoothstep(-0.12, 0.2, elevation); // 0 夜晚 … 1 白天
  const dusk = Math.max(0, 1 - Math.abs(elevation) / 0.3); // 日出日落前后
  let sky = mix(NIGHT_SKY, DAY_SKY, day);
  sky = mix(sky, DUSK_SKY, dusk * 0.5);

  return {
    sunDir,
    elevation,
    day,
    dusk,
    sky,
    sunIntensity: 1.8 * day,
    moonIntensity: 0.45 * (1 - day),
    ambient: 0.45 + 1.2 * day,
    stars: 1 - smoothstep(-0.3, 0.05, elevation),
  };
}

export function clockText(t) {
  const minutes = Math.floor(wrapTime(t) * 24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
