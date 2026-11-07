// 天气：晴天和下雨轮流来，强度慢慢变化（不会一下子开始、一下子停）。
// 平原和森林下雨，雪原下雪，沙漠不下。纯计算，可以在 Node 里测试。

export const WEATHER = {
  clear: { name: '晴' },
  rain: { name: '下雨' },
};

const CLEAR_SECONDS = [300, 600]; // 晴天持续多久（现实秒数）
const RAIN_SECONDS = [90, 200]; // 下雨持续多久
const FADE_PER_SECOND = 0.12; // 强度每秒最多变化多少（约 8 秒从无到有）

const between = ([a, b], rand) => a + rand() * (b - a);

export function createWeather(rand = Math.random) {
  return { state: 'clear', timer: between(CLEAR_SECONDS, rand), intensity: 0 };
}

// 切换到某种天气（暂停菜单里手动切换也用这个）
export function setWeather(w, state, rand = Math.random) {
  w.state = state;
  w.timer = between(state === 'rain' ? RAIN_SECONDS : CLEAR_SECONDS, rand);
}

/**
 * 推进天气。返回这一步天气有没有换（晴 ↔ 雨）。
 */
export function stepWeather(w, dt, rand = Math.random) {
  let changed = false;
  w.timer -= dt;
  if (w.timer <= 0) {
    setWeather(w, w.state === 'rain' ? 'clear' : 'rain', rand);
    changed = true;
  }
  const target = w.state === 'rain' ? 1 : 0;
  const step = FADE_PER_SECOND * dt;
  w.intensity = w.intensity < target ? Math.min(target, w.intensity + step) : Math.max(target, w.intensity - step);
  return changed;
}

// 这一列下的是雨、雪还是什么都不下
export function precipitationAt(world, x, z) {
  const biome = world.biomeAt(x, z);
  if (biome === 'desert') return null;
  if (biome === 'snow') return 'snow';
  return 'rain';
}

// (x,y,z) 头上有没有东西挡着（屋顶、树叶、山洞）
export function sheltered(world, x, y, z) {
  return world.topY(Math.floor(x), Math.floor(z)) >= Math.floor(y);
}

// 读档：只留下合理的值
export function sanitizeWeather(raw, rand = Math.random) {
  if (!raw || (raw.state !== 'clear' && raw.state !== 'rain') || !Number.isFinite(raw.timer)) return createWeather(rand);
  const intensity = Number.isFinite(raw.intensity) ? Math.max(0, Math.min(1, raw.intensity)) : raw.state === 'rain' ? 1 : 0;
  return { state: raw.state, timer: Math.max(1, Math.min(raw.timer, 600)), intensity };
}
