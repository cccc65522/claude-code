// Challenges: build a circuit with a restricted set of parts; checked automatically.
import { compile } from './compile.ts';
import { isGate, KIND_NAME } from './parts.ts';
import { Simulator } from './sim.ts';
import type { Circuit, Part, PartKind } from './types.ts';
import { VAL_NAME, type Val } from './values.ts';

type Bits = Record<string, 0 | 1>;

export interface SeqStep {
  set?: Bits;
  expect?: Bits;
}

export interface Level {
  id: string;
  title: string;
  goal: string;
  desc: string;
  hint: string;
  inputs: string[];
  outputs: string[];
  palette: PartKind[];
  test: { kind: 'comb'; fn: (v: Bits) => Bits } | { kind: 'seq'; steps: SeqStep[] };
  /** Smallest known number of parts (gates, flip-flops …; constants not counted). */
  best: number;
}

const BASIC: PartKind[] = ['not', 'and', 'or', 'xor', 'nand', 'nor', 'xnor'];
const b = (x: boolean | number): 0 | 1 => (x ? 1 : 0);

export const LEVELS: Level[] = [
  {
    id: 'wire',
    title: '第一根导线',
    goal: '让输出 Y 等于输入 A',
    desc: '从输入引脚 A 右侧的圆点按住拖到输出引脚 Y 左侧的圆点，松手就连好了一根导线。点一下 A 可以切换 0 和 1，导线亮起表示 1。',
    hint: '电脑上拖动连线；手机上先点 A 的引脚，再点 Y 的引脚。',
    inputs: ['A'],
    outputs: ['Y'],
    palette: [],
    test: { kind: 'comb', fn: (v) => ({ Y: v.A }) },
    best: 0
  },
  {
    id: 'not-from-nand',
    title: '与非门做非门',
    goal: 'Y = ¬A，只能用与非门',
    desc: '与非门（NAND）只有两个输入都是 1 时才输出 0。它是“万能门”：任何电路都能只用与非门搭出来。先从最简单的非门开始。',
    hint: '把与非门的两个输入接在同一个信号上：NAND(A, A) = ¬A。',
    inputs: ['A'],
    outputs: ['Y'],
    palette: ['nand'],
    test: { kind: 'comb', fn: (v) => ({ Y: b(!v.A) }) },
    best: 1
  },
  {
    id: 'and-from-nand',
    title: '与非门做与门',
    goal: 'Y = A·B，只能用与非门',
    desc: '与门 = 与非门后面再接一个非门。',
    hint: '先用一个与非门算 NAND(A, B)，再用上一关的办法把它取反。',
    inputs: ['A', 'B'],
    outputs: ['Y'],
    palette: ['nand'],
    test: { kind: 'comb', fn: (v) => ({ Y: b(v.A && v.B) }) },
    best: 2
  },
  {
    id: 'or-from-nand',
    title: '与非门做或门',
    goal: 'Y = A + B，只能用与非门',
    desc: '德摩根定律：A + B = ¬(¬A · ¬B)。',
    hint: '分别把 A、B 取反，再接进一个与非门。',
    inputs: ['A', 'B'],
    outputs: ['Y'],
    palette: ['nand'],
    test: { kind: 'comb', fn: (v) => ({ Y: b(v.A || v.B) }) },
    best: 3
  },
  {
    id: 'xor-from-nand',
    title: '与非门做异或门',
    goal: 'Y = A ⊕ B，只能用与非门',
    desc: '异或：两个输入不同时输出 1。直接按定义 A·¬B + ¬A·B 搭需要 5 个与非门，有一种巧妙的接法只要 4 个。',
    hint: '先算 M = NAND(A, B)，然后 NAND(A, M) 和 NAND(B, M)，最后把这两个再与非一次。',
    inputs: ['A', 'B'],
    outputs: ['Y'],
    palette: ['nand'],
    test: { kind: 'comb', fn: (v) => ({ Y: b(v.A !== v.B) }) },
    best: 4
  },
  {
    id: 'and-from-nor',
    title: '或非门做与门',
    goal: 'Y = A·B，只能用或非门',
    desc: '或非门（NOR）也是万能门。',
    hint: 'A·B = ¬(¬A + ¬B)；NOR(A, A) = ¬A。',
    inputs: ['A', 'B'],
    outputs: ['Y'],
    palette: ['nor'],
    test: { kind: 'comb', fn: (v) => ({ Y: b(v.A && v.B) }) },
    best: 3
  },
  {
    id: 'half-adder',
    title: '半加器',
    goal: '两个一位数相加：和 S、进位 C',
    desc: '0+0=00，0+1=01，1+1=10。S 是本位，C 是进位。',
    hint: 'S 是异或，C 是与。',
    inputs: ['A', 'B'],
    outputs: ['S', 'C'],
    palette: BASIC,
    test: { kind: 'comb', fn: (v) => ({ S: b(v.A ^ v.B), C: b(v.A & v.B) }) },
    best: 2
  },
  {
    id: 'full-adder',
    title: '全加器',
    goal: '三个一位数相加：A + B + Cin',
    desc: '全加器是多位加法器的基本单元：把低位的进位 Cin 也加进来。',
    hint: 'S = A ⊕ B ⊕ Cin；Cout = A·B + Cin·(A ⊕ B)。可以复用 A ⊕ B。',
    inputs: ['A', 'B', 'Cin'],
    outputs: ['S', 'Cout'],
    palette: BASIC,
    test: {
      kind: 'comb',
      fn: (v) => {
        const s = v.A + v.B + v.Cin;
        return { S: b(s & 1), Cout: b(s >> 1) };
      }
    },
    best: 5
  },
  {
    id: 'mux',
    title: '数据选择器',
    goal: 'S=0 时 Y=A，S=1 时 Y=B',
    desc: '二选一数据选择器（多路复用器）是 CPU 里最常见的部件之一：用一个控制信号决定让哪一路数据通过。',
    hint: 'Y = A·¬S + B·S。',
    inputs: ['A', 'B', 'S'],
    outputs: ['Y'],
    palette: ['not', 'and', 'or', 'nand', 'nor'],
    test: { kind: 'comb', fn: (v) => ({ Y: v.S ? v.B : v.A }) },
    best: 4
  },
  {
    id: 'mux4',
    title: '四选一',
    goal: '用两位选择信号 S1S0 从 D0–D3 里选出一路',
    desc: '大部件由小部件拼成：这一关可以直接用“二选一”。S1S0 = 2 时 Y = D2，依此类推。',
    hint: '先用两个二选一按 S0 分别在 D0/D1、D2/D3 里选，再用第三个按 S1 选。',
    inputs: ['D0', 'D1', 'D2', 'D3', 'S1', 'S0'],
    outputs: ['Y'],
    palette: ['mux', 'not', 'and', 'or'],
    test: { kind: 'comb', fn: (v) => ({ Y: [v.D0, v.D1, v.D2, v.D3][v.S1 * 2 + v.S0] }) },
    best: 3
  },
  {
    id: 'comparator',
    title: '一位比较器',
    goal: '比较 A 和 B：A>B 时 GT=1，相等时 EQ=1，A<B 时 LT=1',
    desc: '三个输出恰好有一个为 1。直接按定义搭需要 5 个门，想办法让输出之间互相利用，3 个门就够。',
    hint: 'EQ 是同或；A>B 等于“不相等并且 B=0”，也就是 NOR(EQ, B)。',
    inputs: ['A', 'B'],
    outputs: ['GT', 'EQ', 'LT'],
    palette: BASIC,
    test: { kind: 'comb', fn: (v) => ({ GT: b(v.A > v.B), EQ: b(v.A === v.B), LT: b(v.A < v.B) }) },
    best: 3
  },
  {
    id: 'majority',
    title: '三人表决器',
    goal: '三个人里至少两个人同意（1），Y 才为 1',
    desc: '这就是“多数函数”。打开右侧的“真值表”面板可以看到你电路的最简表达式。',
    hint: 'Y = A·B + A·C + B·C。门的输入个数可以在属性里改。',
    inputs: ['A', 'B', 'C'],
    outputs: ['Y'],
    palette: BASIC,
    test: { kind: 'comb', fn: (v) => ({ Y: b(v.A + v.B + v.C >= 2) }) },
    best: 4
  },
  {
    id: 'decoder',
    title: '2-4 译码器',
    goal: '输入二进制数 A1A0，让对应的 Yn 为 1',
    desc: '译码器把一个二进制数变成“第几根线亮”。内存用它根据地址选中某一个存储单元。',
    hint: 'Y0 = ¬A1·¬A0，Y1 = ¬A1·A0，Y2 = A1·¬A0，Y3 = A1·A0。两个非门可以共用。',
    inputs: ['A1', 'A0'],
    outputs: ['Y0', 'Y1', 'Y2', 'Y3'],
    palette: BASIC,
    test: {
      kind: 'comb',
      fn: (v) => {
        const n = v.A1 * 2 + v.A0;
        return { Y0: b(n === 0), Y1: b(n === 1), Y2: b(n === 2), Y3: b(n === 3) };
      }
    },
    best: 6
  },
  {
    id: 'parity',
    title: '奇偶校验',
    goal: '四个输入里 1 的个数是奇数时 P=1',
    desc: '奇偶校验位用来发现传输中翻转的一位。多输入异或门恰好就是“奇数个 1”。',
    hint: '把异或门的输入个数改成 4。',
    inputs: ['A', 'B', 'C', 'D'],
    outputs: ['P'],
    palette: ['xor', 'xnor', 'not'],
    test: { kind: 'comb', fn: (v) => ({ P: b((v.A + v.B + v.C + v.D) % 2) }) },
    best: 1
  },
  {
    id: 'sr-latch',
    title: 'SR 锁存器',
    goal: 'S=1 置 1，R=1 清 0，两个都为 0 时保持',
    desc: '把两个或非门的输出交叉接到对方的输入，电路就有了“记忆”。这是所有存储器的起点。检查时会依次按下 S、R，看 Q 能不能记住。',
    hint: '一个或非门的输入接 R 和另一个门的输出，它的输出就是 Q；另一个门的输入接 S 和 Q。',
    inputs: ['S', 'R'],
    outputs: ['Q'],
    palette: ['nor'],
    test: {
      kind: 'seq',
      steps: [
        { set: { S: 1 }, expect: { Q: 1 } },
        { set: { S: 0 }, expect: { Q: 1 } },
        { set: { R: 1 }, expect: { Q: 0 } },
        { set: { R: 0 }, expect: { Q: 0 } },
        { set: { S: 1 }, expect: { Q: 1 } },
        { set: { S: 0 }, expect: { Q: 1 } }
      ]
    },
    best: 2
  },
  {
    id: 'd-latch',
    title: 'D 锁存器',
    goal: 'E=1 时 Q 跟随 D；E=0 时 Q 保持不变',
    desc: 'SR 锁存器有“S、R 同时为 1”的禁用状态。D 锁存器只用一个数据输入 D 和一个使能 E，避免了这个问题。',
    hint: '用 4 个与非门：M = NAND(D, E)，N = NAND(M, E)，Q = NAND(M, Q̄)，Q̄ = NAND(N, Q)。',
    inputs: ['D', 'E'],
    outputs: ['Q'],
    palette: ['nand', 'nor', 'and', 'or', 'not'],
    test: {
      kind: 'seq',
      steps: [
        { set: { D: 1 } },
        { set: { E: 1 }, expect: { Q: 1 } },
        { set: { D: 0 }, expect: { Q: 0 } },
        { set: { D: 1 }, expect: { Q: 1 } },
        { set: { E: 0 }, expect: { Q: 1 } },
        { set: { D: 0 }, expect: { Q: 1 } },
        { set: { E: 1 }, expect: { Q: 0 } },
        { set: { E: 0 }, expect: { Q: 0 } },
        { set: { D: 1 }, expect: { Q: 0 } }
      ]
    },
    best: 4
  },
  {
    id: 'counter',
    title: '两位计数器',
    goal: 'CLK 每来一个上升沿，Q1Q0 加一：00 → 01 → 10 → 11 → 00',
    desc: '触发器只在时钟上升沿（0 变 1 的瞬间）改变状态。检查时会把 CLK 来回切换四次。T 触发器的 T=1 时每个上升沿翻转一次，T 端要接常量 1。',
    hint: '第一个 T 触发器接 CLK，输出 Q0；第二个的时钟接第一个的 Q̄，这样 Q0 从 1 变 0 时它才翻转。',
    inputs: ['CLK'],
    outputs: ['Q1', 'Q0'],
    palette: ['tff', 'dff', 'jkff', 'const', 'not', 'and', 'or', 'xor'],
    test: {
      kind: 'seq',
      steps: [
        { expect: { Q1: 0, Q0: 0 } },
        { set: { CLK: 1 }, expect: { Q1: 0, Q0: 1 } },
        { set: { CLK: 0 }, expect: { Q1: 0, Q0: 1 } },
        { set: { CLK: 1 }, expect: { Q1: 1, Q0: 0 } },
        { set: { CLK: 0 }, expect: { Q1: 1, Q0: 0 } },
        { set: { CLK: 1 }, expect: { Q1: 1, Q0: 1 } },
        { set: { CLK: 0 } },
        { set: { CLK: 1 }, expect: { Q1: 0, Q0: 0 } }
      ]
    },
    best: 2
  }
];

export function levelById(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}

/** Starting circuit: locked input pins on the left, output pins on the right. */
export function levelCircuit(level: Level): Circuit {
  const parts: Part[] = [];
  const rows = Math.max(level.inputs.length, level.outputs.length);
  const span = Math.max(rows * 6, 12);
  level.inputs.forEach((name, i) => {
    const y = Math.round(((i + 0.5) * span) / level.inputs.length) - 1;
    parts.push({ id: `in_${name}`, kind: 'in', x: 0, y, rot: 0, label: name, locked: true });
  });
  level.outputs.forEach((name, i) => {
    const y = Math.round(((i + 0.5) * span) / level.outputs.length) - 1;
    parts.push({ id: `out_${name}`, kind: 'out', x: 34, y, rot: 0, label: name, locked: true });
  });
  return { id: 'main', name: level.title, parts, wires: [] };
}

/** Parts that count towards the score. */
export function countedParts(c: Circuit): number {
  return c.parts.filter((p) => isGate(p.kind) || ['dff', 'jkff', 'tff', 'mux', 'tri', 'chip'].includes(p.kind)).length;
}

export interface CheckResult {
  pass: boolean;
  messages: string[];
  count: number;
  stars: 0 | 1 | 2 | 3;
}

export function starsFor(level: Level, count: number): 1 | 2 | 3 {
  return count <= level.best ? 3 : count <= level.best + 2 ? 2 : 1;
}

export function checkLevel(level: Level, circuit: Circuit): CheckResult {
  const messages: string[] = [];
  const count = countedParts(circuit);
  const fail = (): CheckResult => ({ pass: false, messages, count, stars: 0 });

  const banned = new Set<PartKind>();
  for (const p of circuit.parts) {
    if (p.kind === 'text' || p.kind === 'tunnel') continue;
    if (p.locked && (p.kind === 'in' || p.kind === 'out')) continue;
    if (!level.palette.includes(p.kind)) banned.add(p.kind);
  }
  if (banned.size) {
    const allowed = level.palette.length ? level.palette.map((k) => KIND_NAME[k]).join('、') : '只用导线';
    messages.push(`这一关不能用${[...banned].map((k) => KIND_NAME[k]).join('、')}。允许：${allowed}。`);
    return fail();
  }
  const pinOf = (name: string, kind: 'in' | 'out') => circuit.parts.find((p) => p.kind === kind && p.label === name);
  for (const name of level.inputs) if (!pinOf(name, 'in')) messages.push(`找不到输入引脚 ${name}。`);
  for (const name of level.outputs) if (!pinOf(name, 'out')) messages.push(`找不到输出引脚 ${name}。`);
  if (messages.length) return fail();

  const project = { version: 1 as const, main: circuit, chips: [] };
  const nl = compile(project);
  const sim = new Simulator(nl);
  const setAll = (bits: Bits) => {
    for (const [name, v] of Object.entries(bits)) sim.setInput(pinOf(name, 'in')!.id, v);
  };
  const read = (name: string): Val => sim.pinValue(pinOf(name, 'out')!.id, 'i');
  const describe = (bits: Bits) =>
    Object.entries(bits)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');

  if (level.test.kind === 'comb') {
    const n = level.inputs.length;
    let wrong = 0;
    for (let r = 0; r < 1 << n; r++) {
      const bits: Bits = {};
      level.inputs.forEach((name, k) => (bits[name] = ((r >> (n - 1 - k)) & 1) as 0 | 1));
      sim.reset();
      setAll(bits);
      if (!sim.settle().stable) {
        messages.push(`${describe(bits)} 时电路振荡，停不下来。`);
        return fail();
      }
      const want = level.test.fn(bits);
      for (const name of level.outputs) {
        const got = read(name);
        if (got !== want[name]) {
          wrong++;
          if (wrong <= 4) messages.push(`${describe(bits)} 时 ${name} 应为 ${want[name]}，实际是 ${VAL_NAME[got]}。`);
        }
      }
    }
    if (wrong > 4) messages.push(`……一共 ${wrong} 处不对。`);
    if (wrong) return fail();
  } else {
    sim.reset();
    const state: Bits = Object.fromEntries(level.inputs.map((name) => [name, 0 as const]));
    setAll(state);
    sim.settle();
    for (const [i, step] of level.test.steps.entries()) {
      if (step.set) {
        Object.assign(state, step.set);
        setAll(step.set);
      }
      if (!sim.settle().stable) {
        messages.push(`第 ${i + 1} 步（${describe(state)}）电路振荡，停不下来。`);
        return fail();
      }
      for (const [name, v] of Object.entries(step.expect ?? {})) {
        const got = read(name);
        if (got !== v) {
          messages.push(`第 ${i + 1} 步（${describe(state)}）${name} 应为 ${v}，实际是 ${VAL_NAME[got]}。`);
          return fail();
        }
      }
    }
  }
  const stars = starsFor(level, count);
  messages.push(
    stars === 3
      ? `通过！用了 ${count} 个元件，达到最少。`
      : `通过！用了 ${count} 个元件，最少只要 ${level.best} 个，再试试？`
  );
  return { pass: true, messages, count, stars };
}
