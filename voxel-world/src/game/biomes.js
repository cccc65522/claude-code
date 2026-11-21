import { fbm2 } from './noise.js';

// 生物群系：按“温度”和“湿度”两张大尺度的噪声图分成四种。
// 地形高低所有群系都一样（边界处不会出现断崖），不同的只是地面、植物和水面。

export const BIOMES = {
  plains: { name: '平原' },
  forest: { name: '森林' },
  desert: { name: '沙漠' },
  snow: { name: '雪原' },
};

export function climateAt(seed, x, z) {
  // 噪声值大多挤在 0.5 附近，拉开一点让各种群系都占得到地方
  const stretch = (v) => Math.max(0, Math.min(1, (v - 0.5) * 2.2 + 0.5));
  return {
    temp: stretch(fbm2(x / 110, z / 110, seed + 300, 3)),
    humid: stretch(fbm2(x / 90, z / 90, seed + 600, 3)),
  };
}

export function biomeAt(seed, x, z) {
  const { temp, humid } = climateAt(seed, x, z);
  if (temp < 0.3) return 'snow';
  if (temp > 0.62 && humid < 0.5) return 'desert';
  if (humid > 0.56) return 'forest';
  return 'plains';
}
