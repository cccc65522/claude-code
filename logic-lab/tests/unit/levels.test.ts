import assert from 'node:assert/strict';
import { test } from 'node:test';
import { truthTable } from '../../src/engine/analyze.ts';
import { compile } from '../../src/engine/compile.ts';
import { bcdDecoderChip, EXAMPLES } from '../../src/engine/examples.ts';
import { checkLevel, LEVELS, levelCircuit, type Level } from '../../src/engine/levels.ts';
import { decodeShare, encodeShare, parseProject, projectToJSON } from '../../src/engine/serialize.ts';
import { Simulator } from '../../src/engine/sim.ts';
import type { Circuit, Part, PartKind } from '../../src/engine/types.ts';

/** Tiny DSL: add parts to a level's starting circuit and wire them. */
function solve(level: Level, build: (add: (id: string, kind: PartKind, extra?: Partial<Part>) => void, w: (a: string, b: string) => void) => void): Circuit {
  const c = levelCircuit(level);
  let y = 0;
  const add = (id: string, kind: PartKind, extra: Partial<Part> = {}) => {
    c.parts.push({ id, kind, x: 10 + (y % 3) * 7, y: (y += 4), rot: 0, ...extra });
  };
  const w = (a: string, b: string) => {
    const [pa, pina = 'o'] = a.split('.');
    const [pb, pinb] = b.split('.');
    c.wires.push({ id: `w${c.wires.length}`, a: { part: pa, pin: pina }, b: { part: pb, pin: pinb ?? 'i' } });
  };
  build(add, w);
  return c;
}

const SOLUTIONS: Record<string, Parameters<typeof solve>[1]> = {
  wire: (_add, w) => w('in_A', 'out_Y.i'),
  'not-from-nand': (add, w) => {
    add('n', 'nand');
    w('in_A', 'n.i0');
    w('in_A', 'n.i1');
    w('n', 'out_Y.i');
  },
  'and-from-nand': (add, w) => {
    add('n1', 'nand');
    add('n2', 'nand');
    w('in_A', 'n1.i0');
    w('in_B', 'n1.i1');
    w('n1', 'n2.i0');
    w('n1', 'n2.i1');
    w('n2', 'out_Y.i');
  },
  'or-from-nand': (add, w) => {
    add('na', 'nand');
    add('nb', 'nand');
    add('n', 'nand');
    w('in_A', 'na.i0');
    w('in_A', 'na.i1');
    w('in_B', 'nb.i0');
    w('in_B', 'nb.i1');
    w('na', 'n.i0');
    w('nb', 'n.i1');
    w('n', 'out_Y.i');
  },
  'xor-from-nand': (add, w) => {
    for (const id of ['m', 'p', 'q', 'r']) add(id, 'nand');
    w('in_A', 'm.i0');
    w('in_B', 'm.i1');
    w('in_A', 'p.i0');
    w('m', 'p.i1');
    w('in_B', 'q.i0');
    w('m', 'q.i1');
    w('p', 'r.i0');
    w('q', 'r.i1');
    w('r', 'out_Y.i');
  },
  'and-from-nor': (add, w) => {
    for (const id of ['na', 'nb', 'n']) add(id, 'nor');
    w('in_A', 'na.i0');
    w('in_A', 'na.i1');
    w('in_B', 'nb.i0');
    w('in_B', 'nb.i1');
    w('na', 'n.i0');
    w('nb', 'n.i1');
    w('n', 'out_Y.i');
  },
  'half-adder': (add, w) => {
    add('x', 'xor');
    add('a', 'and');
    w('in_A', 'x.i0');
    w('in_B', 'x.i1');
    w('in_A', 'a.i0');
    w('in_B', 'a.i1');
    w('x', 'out_S.i');
    w('a', 'out_C.i');
  },
  'full-adder': (add, w) => {
    add('x1', 'xor');
    add('x2', 'xor');
    add('a1', 'and');
    add('a2', 'and');
    add('o', 'or');
    w('in_A', 'x1.i0');
    w('in_B', 'x1.i1');
    w('x1', 'x2.i0');
    w('in_Cin', 'x2.i1');
    w('x2', 'out_S.i');
    w('in_A', 'a1.i0');
    w('in_B', 'a1.i1');
    w('x1', 'a2.i0');
    w('in_Cin', 'a2.i1');
    w('a1', 'o.i0');
    w('a2', 'o.i1');
    w('o', 'out_Cout.i');
  },
  mux: (add, w) => {
    add('ns', 'not');
    add('a', 'and');
    add('b', 'and');
    add('o', 'or');
    w('in_S', 'ns.i0');
    w('in_A', 'a.i0');
    w('ns', 'a.i1');
    w('in_B', 'b.i0');
    w('in_S', 'b.i1');
    w('a', 'o.i0');
    w('b', 'o.i1');
    w('o', 'out_Y.i');
  },
  mux4: (add, w) => {
    add('m0', 'mux');
    add('m1', 'mux');
    add('m', 'mux');
    w('in_D0', 'm0.a');
    w('in_D1', 'm0.b');
    w('in_S0', 'm0.s');
    w('in_D2', 'm1.a');
    w('in_D3', 'm1.b');
    w('in_S0', 'm1.s');
    w('m0', 'm.a');
    w('m1', 'm.b');
    w('in_S1', 'm.s');
    w('m', 'out_Y.i');
  },
  comparator: (add, w) => {
    add('eq', 'xnor');
    add('gt', 'nor');
    add('lt', 'nor');
    w('in_A', 'eq.i0');
    w('in_B', 'eq.i1');
    w('eq', 'gt.i0');
    w('in_B', 'gt.i1');
    w('eq', 'lt.i0');
    w('in_A', 'lt.i1');
    w('eq', 'out_EQ.i');
    w('gt', 'out_GT.i');
    w('lt', 'out_LT.i');
  },
  majority: (add, w) => {
    add('ab', 'and');
    add('ac', 'and');
    add('bc', 'and');
    add('o', 'or', { n: 3 });
    w('in_A', 'ab.i0');
    w('in_B', 'ab.i1');
    w('in_A', 'ac.i0');
    w('in_C', 'ac.i1');
    w('in_B', 'bc.i0');
    w('in_C', 'bc.i1');
    w('ab', 'o.i0');
    w('ac', 'o.i1');
    w('bc', 'o.i2');
    w('o', 'out_Y.i');
  },
  decoder: (add, w) => {
    add('n1', 'not');
    add('n0', 'not');
    w('in_A1', 'n1.i0');
    w('in_A0', 'n0.i0');
    const src = [['n1', 'n0'], ['n1', 'in_A0'], ['in_A1', 'n0'], ['in_A1', 'in_A0']];
    src.forEach(([a, b], i) => {
      add(`y${i}`, 'and');
      w(a, `y${i}.i0`);
      w(b, `y${i}.i1`);
      w(`y${i}`, `out_Y${i}.i`);
    });
  },
  parity: (add, w) => {
    add('x', 'xor', { n: 4 });
    ['A', 'B', 'C', 'D'].forEach((v, i) => w(`in_${v}`, `x.i${i}`));
    w('x', 'out_P.i');
  },
  'sr-latch': (add, w) => {
    add('n1', 'nor');
    add('n2', 'nor');
    w('in_S', 'n1.i0');
    w('n2', 'n1.i1');
    w('n1', 'n2.i0');
    w('in_R', 'n2.i1');
    w('n2', 'out_Q.i');
  },
  'd-latch': (add, w) => {
    for (const id of ['m', 'n', 'q', 'nq']) add(id, 'nand');
    w('in_D', 'm.i0');
    w('in_E', 'm.i1');
    w('m', 'n.i0');
    w('in_E', 'n.i1');
    w('m', 'q.i0');
    w('nq', 'q.i1');
    w('n', 'nq.i0');
    w('q', 'nq.i1');
    w('q', 'out_Q.i');
  },
  counter: (add, w) => {
    add('one', 'const', { value: 1 });
    add('t0', 'tff');
    add('t1', 'tff');
    w('one', 't0.t');
    w('one', 't1.t');
    w('in_CLK', 't0.c');
    w('t0.nq', 't1.c');
    w('t0.q', 'out_Q0.i');
    w('t1.q', 'out_Q1.i');
  }
};

test('every challenge has a reference solution that earns three stars', () => {
  for (const level of LEVELS) {
    const sol = SOLUTIONS[level.id];
    assert.ok(sol, `solution for ${level.id}`);
    const res = checkLevel(level, solve(level, sol));
    assert.ok(res.pass, `${level.id}: ${res.messages.join(' ')}`);
    assert.equal(res.stars, 3, `${level.id} uses ${res.count}, best ${level.best}`);
  }
});

test('empty and wrong circuits fail with a reason', () => {
  for (const level of LEVELS) {
    if (level.id === 'counter') continue; // an empty counter fails too, checked below
    const res = checkLevel(level, levelCircuit(level));
    assert.equal(res.pass, false, level.id);
    assert.ok(res.messages.length > 0);
  }
  const counter = LEVELS.find((l) => l.id === 'counter')!;
  assert.equal(checkLevel(counter, levelCircuit(counter)).pass, false);
  // Using a forbidden gate.
  const notLevel = LEVELS.find((l) => l.id === 'not-from-nand')!;
  const cheat = solve(notLevel, (add, w) => {
    add('n', 'not');
    w('in_A', 'n.i0');
    w('n', 'out_Y.i');
  });
  const res = checkLevel(notLevel, cheat);
  assert.equal(res.pass, false);
  assert.match(res.messages[0], /不能用非门/);
  // An XOR made of 5 NAND gates passes with fewer stars.
  const xorLevel = LEVELS.find((l) => l.id === 'xor-from-nand')!;
  const wasteful = solve(xorLevel, (add, w) => {
    SOLUTIONS['xor-from-nand'](add, w);
    add('extra1', 'nand');
    add('extra2', 'nand');
    add('extra3', 'nand');
  });
  const r2 = checkLevel(xorLevel, wasteful);
  assert.ok(r2.pass);
  assert.equal(r2.stars, 1);
  // Half adder with S and C swapped.
  const ha = LEVELS.find((l) => l.id === 'half-adder')!;
  const swapped = solve(ha, (add, w) => {
    add('x', 'xor');
    add('a', 'and');
    w('in_A', 'x.i0');
    w('in_B', 'x.i1');
    w('in_A', 'a.i0');
    w('in_B', 'a.i1');
    w('x', 'out_C.i');
    w('a', 'out_S.i');
  });
  const r3 = checkLevel(ha, swapped);
  assert.equal(r3.pass, false);
  assert.match(r3.messages.join(''), /S 应为 1，实际是 0/);
});

test('a latch that oscillates is rejected, not hung', () => {
  const level = LEVELS.find((l) => l.id === 'sr-latch')!;
  const c = solve(level, (add, w) => {
    add('n', 'nor');
    w('in_S', 'n.i0');
    w('n', 'n.i1');
    w('n', 'out_Q.i');
  });
  const res = checkLevel(level, c);
  assert.equal(res.pass, false);
});

test('examples compile cleanly', () => {
  for (const ex of EXAMPLES) {
    const p = ex.build();
    for (const c of [p.main, ...p.chips]) {
      const nl = compile(p, c.id);
      assert.deepEqual(nl.errors, [], `${ex.id}/${c.id}`);
      const ids = new Set(c.parts.map((x) => x.id));
      assert.equal(ids.size, c.parts.length, 'unique part ids');
      // No two parts overlap.
      const boxes = c.parts.filter((x) => x.kind !== 'text').map((x) => ({ x, ...boxOf(x, p) }));
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
          assert.ok(!overlap, `${ex.id}/${c.id}: ${a.x.id} overlaps ${b.x.id}`);
        }
    }
  }
});

import { partBounds } from '../../src/engine/parts.ts';
function boxOf(part: Part, p: Parameters<typeof partBounds>[1]) {
  const b = partBounds(part, p);
  return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
}

test('BCD decoder chip matches the seven-segment table', () => {
  const chip = bcdDecoderChip();
  const p = { version: 1 as const, main: { id: 'main', name: 'm', parts: [], wires: [] }, chips: [chip] };
  const res = truthTable(p, 'bcd7');
  assert.ok(res.ok);
  if (!res.ok) return;
  const digits = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '1011111', '1110000', '1111111', '1111011'];
  assert.deepEqual(res.table.inputs.map((s) => s.label), ['D3', 'D2', 'D1', 'D0']);
  assert.deepEqual(res.table.outputs.map((s) => s.label), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  digits.forEach((segs, d) => assert.equal(res.table.rows[d].join(''), segs, `digit ${d}`));
});

test('decimal counter example counts 0–9 and wraps', () => {
  const p = EXAMPLES.find((e) => e.id === 'decimal')!.build();
  const sim = new Simulator(compile(p));
  sim.settle();
  const digit = () => {
    const segs = 'abcdefg'.split('').map((s) => sim.pinValue('disp', s)).join('');
    return ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '1011111', '1110000', '1111111', '1111011'].indexOf(segs);
  };
  const seen: number[] = [];
  for (let i = 0; i < 48; i++) {
    assert.ok(sim.tick().stable);
    const d = digit();
    if (seen[seen.length - 1] !== d) seen.push(d);
  }
  assert.deepEqual(seen.slice(0, 12), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
});

test('traffic light cycles green ×4, amber ×1, red ×3', () => {
  const p = EXAMPLES.find((e) => e.id === 'traffic')!.build();
  const sim = new Simulator(compile(p));
  sim.settle();
  const light = () => (sim.pinValue('green', 'i') ? 'G' : '') + (sim.pinValue('amber', 'i') ? 'Y' : '') + (sim.pinValue('red', 'i') ? 'R' : '');
  // One letter per state: the initial one, then after each rising clock edge.
  let seq = light();
  let clk = sim.pinValue('clk', 'o');
  for (let i = 0; i < 64; i++) {
    sim.tick();
    const now = sim.pinValue('clk', 'o');
    if (clk === 0 && now === 1) seq += light();
    clk = now;
  }
  assert.equal(seq, 'GGGGYRRR'.repeat(2) + 'G');
});

test('project validation and share links round-trip', async () => {
  const p = EXAMPLES.find((e) => e.id === 'adder4')!.build();
  const back = parseProject(JSON.parse(projectToJSON(p)));
  assert.deepEqual(back, p);
  const link = await encodeShare(p);
  assert.ok(link.length < projectToJSON(p).length / 2, 'compressed');
  assert.deepEqual(await decodeShare(link), p);
  await assert.rejects(decodeShare('zgarbage!!'), /损坏/);
  assert.throws(() => parseProject({ app: 'other' }), /不是/);
  // Junk is dropped rather than crashing.
  const cleaned = parseProject({
    main: { parts: [{ id: 'a', kind: 'and', x: 1.4, y: 'q' }, { id: 'a', kind: 'or' }, { kind: 'bogus' }], wires: [{ id: 'w', a: { part: 'a', pin: 'o' }, b: { part: 'zz', pin: 'i' } }] }
  });
  assert.equal(cleaned.main.parts.length, 1);
  assert.equal(cleaned.main.parts[0].x, 1);
  assert.equal(cleaned.main.wires.length, 0);
});

import { stateTable } from '../../src/engine/analyze.ts';

test('state table of the traffic light: an 8-state cycle, Moore outputs', () => {
  const res = stateTable(EXAMPLES.find((e) => e.id === 'traffic')!.build(), 'main');
  assert.ok(res.ok);
  if (!res.ok) return;
  const t = res.table;
  assert.deepEqual(t.flops.map((f) => f.label), ['Q2', 'Q1', 'Q0']);
  assert.equal(t.inputs.length, 0);
  assert.deepEqual(t.rows.map((r) => r.next), [1, 2, 3, 4, 5, 6, 7, 0]);
  assert.deepEqual(t.reachable, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(t.moore, true);
  // Lamps in order red, amber, green.
  assert.deepEqual(t.outputs.map((o) => o.label), ['红', '黄', '绿']);
  assert.deepEqual(t.rows.map((r) => r.out.join('')), ['001', '001', '001', '001', '010', '100', '100', '100']);
});

test('state table with an input, and error cases', () => {
  // A toggle flip-flop with an enable input: T = EN.
  const p = { version: 1 as const, chips: [], main: { id: 'main', name: 'm', wires: [] as never[], parts: [] as never[] } } as unknown as import('../../src/engine/types.ts').Project;
  p.main.parts.push(
    { id: 'en', kind: 'in', x: 0, y: 0, rot: 0, label: 'EN' },
    { id: 'clk', kind: 'clock', x: 0, y: 6, rot: 0, period: 3 },
    { id: 't', kind: 'tff', x: 6, y: 0, rot: 0, label: 'Q' },
    { id: 'y', kind: 'out', x: 14, y: 0, rot: 0, label: 'Y' }
  );
  p.main.wires.push(
    { id: 'w1', a: { part: 'en', pin: 'o' }, b: { part: 't', pin: 't' } },
    { id: 'w2', a: { part: 'clk', pin: 'o' }, b: { part: 't', pin: 'c' } },
    { id: 'w3', a: { part: 't', pin: 'q' }, b: { part: 'y', pin: 'i' } }
  );
  const res = stateTable(p, 'main');
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.table.period, 3);
  // (state, EN) → next: hold when EN=0, toggle when EN=1.
  assert.deepEqual(res.table.rows.map((r) => `${r.state}${r.input}>${r.next}`), ['00>0', '01>1', '10>1', '11>0']);
  assert.deepEqual(res.table.reachable, [0, 1]);
  const half = stateTable(EXAMPLES.find((e) => e.id === 'half-adder')!.build(), 'main');
  assert.equal(half.ok, false);
  if (!half.ok) assert.match(half.error, /没有触发器/);
});
