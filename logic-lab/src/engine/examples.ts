// Built-in example projects.
import { CircuitBuilder, emptyProject } from './builder.ts';
import { parseEquations, synthesize } from './expr.ts';
import { minimize, sopToText } from './qm.ts';
import type { Circuit, Project } from './types.ts';

export interface Example {
  id: string;
  title: string;
  desc: string;
  build: () => Project;
}

function project(main: Circuit, chips: Circuit[] = []): Project {
  const p = emptyProject();
  p.main = { ...main, id: 'main' };
  p.chips = chips;
  return p;
}

function halfAdder(): Project {
  const b = new CircuitBuilder('main', '半加器');
  b.add('text', 0, -5, { text: '半加器：S 是 A、B 的异或，C 是 A、B 的与。点击左边的输入引脚切换 0/1。' });
  b.add('in', 0, 1, { id: 'A', label: 'A' });
  b.add('in', 0, 9, { id: 'B', label: 'B' });
  b.add('xor', 8, 1, { id: 'x' });
  b.add('and', 8, 8, { id: 'a' });
  b.add('out', 18, 2, { id: 'S', label: 'S' });
  b.add('out', 18, 9, { id: 'C', label: 'C' });
  b.wire('A', 'x.i0').wire('B', 'x.i1').wire('A', 'a.i0').wire('B', 'a.i1').wire('x', 'S.i').wire('a', 'C.i');
  return project(b.build());
}

export function fullAdderChip(): Circuit {
  const b = new CircuitBuilder('fa', '全加器');
  b.add('text', 0, -4, { text: '全加器芯片的内部。左边的输入引脚、右边的输出引脚就是芯片的接口。' });
  b.add('in', 0, 1, { id: 'A', label: 'A' });
  b.add('in', 0, 5, { id: 'B', label: 'B' });
  b.add('in', 0, 11, { id: 'Ci', label: 'Cin' });
  b.add('xor', 6, 1, { id: 'x1' });
  b.add('xor', 14, 3, { id: 'x2' });
  b.add('and', 14, 9, { id: 'a2' });
  b.add('and', 14, 15, { id: 'a1' });
  b.add('or', 22, 11, { id: 'o1' });
  b.add('out', 30, 4, { id: 'S', label: 'S' });
  b.add('out', 30, 12, { id: 'Co', label: 'Cout' });
  b.wire('A', 'x1.i0').wire('B', 'x1.i1').wire('x1', 'x2.i0').wire('Ci', 'x2.i1').wire('x2', 'S.i');
  b.wire('x1', 'a2.i0').wire('Ci', 'a2.i1').wire('A', 'a1.i0').wire('B', 'a1.i1');
  b.wire('a2', 'o1.i0').wire('a1', 'o1.i1').wire('o1', 'Co.i');
  return b.build();
}

function adder4(): Project {
  const fa = fullAdderChip();
  const p = emptyProject();
  p.chips = [fa];
  const b = new CircuitBuilder('main', '4 位加法器', { project: p });
  b.add('text', 0, -6, { text: '4 位行波进位加法器：四个“全加器”芯片串起来。双击芯片（或在属性里点“查看内部”）进入芯片。' });
  for (let i = 0; i < 4; i++) {
    const y = i * 10;
    b.add('in', 0, y, { id: `A${i}`, label: `A${i}` });
    b.add('in', 4, y + 2, { id: `B${i}`, label: `B${i}` });
    b.add('chip', 14, y, { id: `F${i}`, chip: 'fa' });
  }
  b.add('const', 8, 4, { id: 'zero', value: 0 });
  for (let i = 0; i < 4; i++) b.wire(`A${i}`, `F${i}.A`).wire(`B${i}`, `F${i}.B`);
  b.wire('zero', 'F0.Ci');
  for (let i = 0; i < 3; i++) b.wire(`F${i}.Co`, `F${i + 1}.Ci`);
  b.add('hex', 32, 0, { id: 'sum', label: '和' });
  // Stagger the vertical runs so the four sum wires don't overlap.
  for (let i = 0; i < 4; i++) b.wire(`F${i}.S`, `sum.d${i}`, i === 0 ? undefined : 24 + 2 * i);
  b.add('led', 32, 32, { id: 'cout', label: '进位', color: 'amber' });
  b.wire('F3.Co', 'cout.i');
  p.main = b.build();
  return p;
}

function srLatch(): Project {
  const b = new CircuitBuilder('main', 'SR 锁存器');
  b.add('text', 0, -6, { text: '两个或非门交叉耦合：按一下 S 置 1，按一下 R 清 0，松开后状态保持。\n两个都按住再同时松开，理想电路会振荡（状态栏会提示）。' });
  b.add('button', 0, 1, { id: 'S', label: 'S' });
  b.add('button', 0, 11, { id: 'R', label: 'R' });
  b.add('nor', 8, 1, { id: 'n1' });
  b.add('nor', 8, 9, { id: 'n2' });
  b.add('led', 20, 2, { id: 'nq', label: 'Q̄', color: 'blue' });
  b.add('led', 20, 9, { id: 'q', label: 'Q' });
  b.wire('S', 'n1.i0').wire('n2', 'n1.i1').wire('n1', 'n2.i0').wire('R', 'n2.i1');
  b.wire('n1', 'nq.i').wire('n2', 'q.i');
  return project(b.build());
}

function counter4(): Project {
  const b = new CircuitBuilder('main', '4 位计数器');
  b.add('text', 0, -6, { text: '异步（行波）计数器：每个 T 触发器在前一级 Q̄ 的上升沿翻转。点“运行”让时钟跑起来，下方波形图会记录信号。' });
  b.add('clock', 0, 5, { id: 'clk', label: 'CLK', period: 1 });
  b.add('const', 0, 0, { id: 'one', value: 1 });
  for (let i = 0; i < 4; i++) b.add('tff', 6 + i * 10, 0, { id: `T${i}` });
  b.wire('clk', 'T0.c');
  for (let i = 0; i < 4; i++) b.wire('one', `T${i}.t`);
  for (let i = 1; i < 4; i++) b.wire(`T${i - 1}.nq`, `T${i}.c`);
  b.add('hex', 48, 10, { id: 'h', label: '计数' });
  for (let i = 0; i < 4; i++) b.wire(`T${i}.q`, `h.d${i}`);
  for (let i = 0; i < 4; i++) {
    b.add('out', 12 + i * 10, 12, { id: `Q${i}`, label: `Q${i}`, rot: 1 });
    b.wire(`T${i}.q`, `Q${i}.i`);
  }
  return project(b.build());
}

const SEGMENTS: Record<string, number[]> = {
  a: [0, 2, 3, 5, 6, 7, 8, 9],
  b: [0, 1, 2, 3, 4, 7, 8, 9],
  c: [0, 1, 3, 4, 5, 6, 7, 8, 9],
  d: [0, 2, 3, 5, 6, 8, 9],
  e: [0, 2, 6, 8],
  f: [0, 4, 5, 6, 8, 9],
  g: [2, 3, 4, 5, 6, 8, 9]
};

/** BCD → seven-segment decoder, minimised by Quine–McCluskey (codes 10–15 are don't-cares). */
export function bcdDecoderChip(): Circuit {
  const names = ['D3', 'D2', 'D1', 'D0'];
  const dc = [10, 11, 12, 13, 14, 15];
  const src = Object.entries(SEGMENTS)
    .map(([seg, ones]) => `${seg} = ${sopToText(minimize(4, ones, dc), 4, names)}`)
    .join('\n');
  const { circuit } = synthesize(parseEquations(src), {
    inputOrder: names,
    maxFanIn: 4,
    circuitId: 'bcd7',
    circuitName: 'BCD 七段译码器',
    idPrefix: 'd'
  });
  circuit.parts.push({ id: 'note', kind: 'text', x: 0, y: -5, rot: 0, text: '由真值表经 Quine–McCluskey 化简后自动生成（10–15 视为无关项）。' });
  return circuit;
}

function decimalCounter(): Project {
  const dec = bcdDecoderChip();
  const p = emptyProject();
  p.chips = [dec];
  const b = new CircuitBuilder('main', '十进制计数器', { project: p });
  b.add('text', 0, -6, { text: '计数到 10（二进制 1010）时与门立刻把四个触发器清零，所以只显示 0–9。\n七段译码器是一个自动生成的芯片。' });
  b.add('clock', 0, 5, { id: 'clk', label: 'CLK', period: 2 });
  b.add('const', 0, 0, { id: 'one', value: 1 });
  for (let i = 0; i < 4; i++) b.add('tff', 6 + i * 10, 0, { id: `T${i}` });
  b.wire('clk', 'T0.c');
  for (let i = 0; i < 4; i++) b.wire('one', `T${i}.t`);
  for (let i = 1; i < 4; i++) b.wire(`T${i - 1}.nq`, `T${i}.c`);
  b.add('and', 30, 12, { id: 'ten' });
  b.wire('T3.q', 'ten.i0').wire('T1.q', 'ten.i1');
  for (let i = 0; i < 4; i++) b.wire('ten', `T${i}.clr`);
  b.add('chip', 50, 0, { id: 'dec', chip: 'bcd7' });
  for (let i = 0; i < 4; i++) b.wire(`T${i}.q`, `dec.${dec.parts.find((x) => x.kind === 'in' && x.label === `D${i}`)!.id}`);
  b.add('seg7', 66, 0, { id: 'disp' });
  for (const seg of 'abcdefg') b.wire(`dec.${dec.parts.find((x) => x.kind === 'out' && x.label === seg)!.id}`, `disp.${seg}`);
  p.main = b.build();
  return p;
}

/** Next-state and output logic of the traffic light, generated from equations. */
export function trafficLogicChip(): Circuit {
  const src = [
    'D2 = Q2 ^ (Q1 & Q0)',
    'D1 = Q1 ^ Q0',
    'D0 = !Q0',
    '绿 = !Q2',
    '黄 = Q2 & !Q1 & !Q0',
    '红 = Q2 & (Q1 | Q0)'
  ].join('\n');
  const { circuit } = synthesize(parseEquations(src), { inputOrder: ['Q2', 'Q1', 'Q0'], circuitId: 'traffic', circuitName: '交通灯逻辑', idPrefix: 't' });
  circuit.parts.push({ id: 'note', kind: 'text', x: 0, y: -5, rot: 0, text: '状态 0–3 绿灯，4 黄灯，5–7 红灯；D 是下一个状态。由表达式自动生成。' });
  return circuit;
}

function trafficLight(): Project {
  const logic = trafficLogicChip();
  const p = emptyProject();
  p.chips = [logic];
  const b = new CircuitBuilder('main', '交通灯', { project: p });
  b.add('text', 0, -7, { text: '有限状态机：三个 D 触发器保存状态（0–7），芯片根据当前状态算出下一个状态和三盏灯。\n点“运行”：绿灯 4 拍 → 黄灯 1 拍 → 红灯 3 拍，循环。' });
  const pin = (label: string, kind: 'in' | 'out') => logic.parts.find((x) => x.kind === kind && x.label === label)!.id;
  b.add('chip', 14, 0, { id: 'L', chip: 'traffic' });
  // Flip-flops staggered so their feedback wires don't share a vertical run.
  ['2', '1', '0'].forEach((k, i) => b.add('dff', 32 + 3 * i, i * 8, { id: `F${k}`, label: `Q${k}` }));
  b.add('clock', 22, 24, { id: 'clk', label: 'CLK', period: 2 });
  for (const k of ['2', '1', '0']) b.wire('clk', `F${k}.c`);
  b.wire(`L.${pin('D2', 'out')}`, 'F2.d');
  b.wire(`L.${pin('D1', 'out')}`, 'F1.d', 29);
  b.wire(`L.${pin('D0', 'out')}`, 'F0.d', 27);
  ['2', '1', '0'].forEach((k, i) => b.wire(`F${k}.q`, `L.${pin(`Q${k}`, 'in')}`, -2 - i));
  b.add('led', 52, 0, { id: 'red', label: '红', color: 'red' });
  b.add('led', 52, 4, { id: 'amber', label: '黄', color: 'amber' });
  b.add('led', 52, 8, { id: 'green', label: '绿', color: 'green' });
  b.wire(`L.${pin('红', 'out')}`, 'red.i').wire(`L.${pin('黄', 'out')}`, 'amber.i').wire(`L.${pin('绿', 'out')}`, 'green.i');
  p.main = b.build();
  return p;
}

/** Seven-segment patterns for 0–F: bit 0 = segment a … bit 6 = segment g. */
export const HEX_SEGMENTS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

function romDisplay(): Project {
  const b = new CircuitBuilder('main', 'ROM 查表');
  b.add('text', 0, -7, { text: '用 ROM 当译码器：计数器给出地址，ROM 里存着 0–F 每个数字的七段字形（第 0 位是 a 段）。\n选中 ROM 可以在属性里改内容，比如把某个数字换成别的图案。' });
  b.add('clock', 0, 5, { id: 'clk', label: 'CLK', period: 2 });
  b.add('const', 0, 0, { id: 'one', value: 1 });
  for (let i = 0; i < 4; i++) b.add('tff', 6 + i * 8, 0, { id: `T${i}` });
  b.wire('clk', 'T0.c');
  for (let i = 0; i < 4; i++) b.wire('one', `T${i}.t`);
  for (let i = 1; i < 4; i++) b.wire(`T${i - 1}.nq`, `T${i}.c`);
  b.add('rom', 42, 10, { id: 'rom', abits: 4, dbits: 7, data: HEX_SEGMENTS });
  for (let i = 0; i < 4; i++) b.wire(`T${i}.q`, `rom.a${i}`);
  b.add('seg7', 56, 10, { id: 'disp' });
  'abcdefg'.split('').forEach((s, i) => b.wire(`rom.d${i}`, `disp.${s}`));
  return project(b.build());
}

function tristateBus(): Project {
  const b = new CircuitBuilder('main', '三态总线');
  b.add('text', 0, -6, { text: '两个三态门共用一根总线。只打开一个使能端 EN 时，总线上是它的数据；\n都关上时总线悬空（Z，虚线）；都打开且数据不同时短路（E，红色）。' });
  b.add('in', 0, 1, { id: 'D1', label: 'D1', value: 1 });
  b.add('in', 0, 6, { id: 'E1', label: 'EN1', value: 1 });
  b.add('in', 0, 13, { id: 'D2', label: 'D2' });
  b.add('in', 0, 18, { id: 'E2', label: 'EN2' });
  b.add('tri', 8, 0, { id: 't1' });
  b.add('tri', 8, 12, { id: 't2' });
  b.add('led', 22, 7, { id: 'bus', label: '总线' });
  b.wire('D1', 't1.i').wire('E1', 't1.en').wire('D2', 't2.i').wire('E2', 't2.en').wire('t1', 'bus.i').wire('t2', 'bus.i');
  return project(b.build());
}

function ringOscillator(): Project {
  const b = new CircuitBuilder('main', '环形振荡器');
  b.add('text', 0, -6, { text: '奇数个反相器首尾相接，没有稳定状态。打开 EN，电路就会振荡，\n仿真器检测到后会在状态栏提示，并把一直在变的导线标出来。' });
  b.add('in', 0, 1, { id: 'en', label: 'EN' });
  b.add('nand', 6, 1, { id: 'g0' });
  b.add('not', 14, 2, { id: 'g1' });
  b.add('not', 20, 2, { id: 'g2' });
  b.add('led', 28, 2, { id: 'l' });
  b.wire('en', 'g0.i0').wire('g0', 'g1.i0').wire('g1', 'g2.i0').wire('g2', 'g0.i1').wire('g2', 'l.i');
  return project(b.build());
}

function hazard(): Project {
  const b = new CircuitBuilder('main', '竞争冒险');
  b.add('text', 0, -6, { text: 'Y = A·¬A 理论上永远是 0，但非门有延迟：A 从 0 变 1 的瞬间，与门两个输入都是 1，\n输出会出现一个短暂的“毛刺”。打开工具栏的“逐级传播”再拨动 A，就能看到（波形图里也有）。' });
  b.add('in', 0, 1, { id: 'A', label: 'A' });
  b.add('not', 6, 5, { id: 'n' });
  b.add('and', 14, 1, { id: 'g' });
  b.add('out', 22, 2, { id: 'Y', label: 'Y' });
  b.wire('A', 'g.i0').wire('A', 'n.i0').wire('n', 'g.i1').wire('g', 'Y.i');
  return project(b.build());
}

export const EXAMPLES: Example[] = [
  { id: 'half-adder', title: '半加器', desc: '异或门和与门：最简单的加法电路', build: halfAdder },
  { id: 'adder4', title: '4 位加法器', desc: '自定义芯片：四个全加器串成行波进位加法器', build: adder4 },
  { id: 'sr-latch', title: 'SR 锁存器', desc: '交叉耦合的或非门，电路有了记忆', build: srLatch },
  { id: 'counter4', title: '4 位计数器', desc: 'T 触发器 + 时钟 + 十六进制显示 + 波形图', build: counter4 },
  { id: 'decimal', title: '十进制计数器', desc: '异步清零 + 自动生成的 BCD 七段译码器', build: decimalCounter },
  { id: 'rom7', title: 'ROM 查表显示', desc: 'ROM 存着 0–F 的七段字形，计数器扫过地址', build: romDisplay },
  { id: 'traffic', title: '交通灯状态机', desc: '三个 D 触发器 + 由表达式生成的状态转移逻辑', build: trafficLight },
  { id: 'tristate', title: '三态总线', desc: '高阻态 Z 与短路 E', build: tristateBus },
  { id: 'ring', title: '环形振荡器', desc: '没有稳定状态的电路，演示振荡检测', build: ringOscillator },
  { id: 'hazard', title: '竞争冒险', desc: '门延迟造成的毛刺，用“逐级传播”观察', build: hazard }
];
