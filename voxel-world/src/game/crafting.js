import { BRICK, DIRT, GLASS, LOG, PLANKS, SAND, TORCH } from './blocks.js';
import { COAL, STICK, addItem, countOf, takeItem } from './items.js';

// 合成配方：不用摆位置，材料够就能合成
export const RECIPES = [
  { id: 'planks', inputs: [[LOG, 1]], output: [PLANKS, 4], hint: '砍树得到原木' },
  { id: 'sticks', inputs: [[PLANKS, 2]], output: [STICK, 4] },
  { id: 'torch', inputs: [[STICK, 1], [COAL, 1]], output: [TORCH, 4], hint: '煤炭在地下的石头里找' },
  { id: 'glass', inputs: [[SAND, 2], [COAL, 1]], output: [GLASS, 2], hint: '用煤炭把沙子烧成玻璃' },
  { id: 'brick', inputs: [[DIRT, 2], [SAND, 1], [COAL, 1]], output: [BRICK, 2], hint: '泥和沙子烧成砖' },
];

// 现在的材料最多能合成几次
export function maxCrafts(inv, recipe) {
  let n = Infinity;
  for (const [id, need] of recipe.inputs) n = Math.min(n, Math.floor(countOf(inv, id) / need));
  return n;
}

// 合成 times 次（材料不够就尽量多做），返回实际合成的次数
export function craft(inv, recipe, times = 1) {
  const n = Math.min(times, maxCrafts(inv, recipe));
  if (n <= 0) return 0;
  for (const [id, need] of recipe.inputs) takeItem(inv, id, need * n);
  addItem(inv, recipe.output[0], recipe.output[1] * n);
  return n;
}
