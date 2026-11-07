import { BRICK, DIRT, GLASS, IRON_ORE, LOG, PLANKS, SAND, STONE, TORCH } from './blocks.js';
import {
  APPLE, BERRIES, BREAD, BUCKET, COAL, IRON_INGOT, IRON_PICKAXE, PIE, STICK, STONE_AXE, STONE_HOE, STONE_PICKAXE, STONE_SHOVEL, WHEAT,
  RAW_MEAT, COOKED_MEAT, addItem, countOf, takeItem,
} from './items.js';

// 合成配方：不用摆位置，材料够就能合成
export const RECIPES = [
  { id: 'planks', inputs: [[LOG, 1]], output: [PLANKS, 4], hint: '砍树得到原木' },
  { id: 'sticks', inputs: [[PLANKS, 2]], output: [STICK, 4] },
  { id: 'torch', inputs: [[STICK, 1], [COAL, 1]], output: [TORCH, 4], hint: '煤炭在地下的石头里找' },
  { id: 'glass', inputs: [[SAND, 2], [COAL, 1]], output: [GLASS, 2], hint: '用煤炭把沙子烧成玻璃' },
  { id: 'brick', inputs: [[DIRT, 2], [SAND, 1], [COAL, 1]], output: [BRICK, 2], hint: '泥和沙子烧成砖' },
  { id: 'stonePickaxe', inputs: [[STONE, 3], [STICK, 2]], output: [STONE_PICKAXE, 1], hint: '挖石头、矿石快 4 倍，挖铁矿石必须有镐' },
  { id: 'stoneShovel', inputs: [[STONE, 1], [STICK, 2]], output: [STONE_SHOVEL, 1], hint: '挖泥土、沙子快 4 倍' },
  { id: 'stoneAxe', inputs: [[STONE, 3], [STICK, 2]], output: [STONE_AXE, 1], hint: '砍木头、树叶快 4 倍' },
  { id: 'stoneHoe', inputs: [[STONE, 2], [STICK, 2]], output: [STONE_HOE, 1], hint: '有了锄头，用麦种对着草地或泥土右键就能翻土种地' },
  { id: 'ironIngot', inputs: [[IRON_ORE, 1], [COAL, 1]], output: [IRON_INGOT, 1], hint: '铁矿石在更深的地下，要用镐挖' },
  { id: 'ironPickaxe', inputs: [[IRON_INGOT, 3], [STICK, 2]], output: [IRON_PICKAXE, 1], hint: '挖石头、矿石快 8 倍' },
  { id: 'bucket', inputs: [[IRON_INGOT, 3]], output: [BUCKET, 1], hint: '空桶对着水能装水，水桶能把水倒到别处' },
  { id: 'bread', inputs: [[WHEAT, 3]], output: [BREAD, 1], hint: '小麦要自己种：草方块里挖麦种，种在耕地上' },
  { id: 'cookedMeat', inputs: [[RAW_MEAT, 2], [COAL, 1]], output: [COOKED_MEAT, 2], hint: '生肉从绒耳兔身上来（草地上白天出没）' },
  { id: 'pie', inputs: [[APPLE, 2], [BERRIES, 3], [COAL, 1]], output: [PIE, 1], hint: '苹果从树叶里来，野莓从草方块里挖；一个果派顶 5 个鸡腿' },
];

// 工具只做一把就够（背包里已经有了就不能再做）
const SINGLE = new Set([STONE_PICKAXE, STONE_SHOVEL, STONE_AXE, IRON_PICKAXE, STONE_HOE]);
export function isSingle(recipe) {
  return SINGLE.has(recipe.output[0]);
}

// 现在的材料最多能合成几次
export function maxCrafts(inv, recipe) {
  if (isSingle(recipe)) {
    if (countOf(inv, recipe.output[0]) > 0) return 0;
    return recipe.inputs.every(([id, need]) => countOf(inv, id) >= need) ? 1 : 0;
  }
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
