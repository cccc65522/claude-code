import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CircuitBuilder, emptyProject } from '../../src/engine/builder.ts';
import { compile } from '../../src/engine/compile.ts';
import { partSpec, placedPins, rotatePoint } from '../../src/engine/parts.ts';
import { Simulator } from '../../src/engine/sim.ts';
import type { Project } from '../../src/engine/types.ts';
import { and, or, resolve, V0, V1, VE, VX, VZ, xor, not } from '../../src/engine/values.ts';

function projectWith(build: (b: CircuitBuilder) => void, chips: Project['chips'] = []): Project {
  const p = emptyProject();
  p.chips = chips;
  const b = new CircuitBuilder('main', '主电路', { project: p });
  build(b);
  p.main = b.build();
  return p;
}

function run(p: Project, rootId = 'main') {
  const sim = new Simulator(compile(p, rootId));
  assert.equal(sim.settle().stable, true);
  return sim;
}

test('four-valued logic', () => {
  assert.equal(and([V1, V1]), V1);
  assert.equal(and([V1, VX]), VX);
  assert.equal(and([V0, VX]), V0, 'a 0 input dominates an unknown');
  assert.equal(and([VZ, V1]), VX, 'floating input reads as unknown');
  assert.equal(or([V1, VX]), V1);
  assert.equal(or([V0, VZ]), VX);
  assert.equal(xor([V1, V1, V1]), V1, 'n-input xor is odd parity');
  assert.equal(xor([V1, VX]), VX);
  assert.equal(not(VE), VX);
  assert.equal(resolve([]), VZ);
  assert.equal(resolve([VZ, V1]), V1);
  assert.equal(resolve([V0, V1]), VE);
  assert.equal(resolve([V1, V1]), V1);
  assert.equal(resolve([V1, VX]), VX);
});

test('rotation keeps pins on the bounding box and on the grid', () => {
  const part = { id: 'g', kind: 'and' as const, x: 10, y: 20, rot: 0 as const, n: 3 };
  const spec = partSpec(part);
  for (const rot of [0, 1, 2, 3] as const) {
    const w = rot % 2 ? spec.h : spec.w;
    const h = rot % 2 ? spec.w : spec.h;
    for (const pin of placedPins({ ...part, rot }, spec)) {
      assert.ok(Number.isInteger(pin.wx) && Number.isInteger(pin.wy));
      assert.ok(pin.wx >= 10 && pin.wx <= 10 + w && pin.wy >= 20 && pin.wy <= 20 + h);
    }
  }
  assert.deepEqual(rotatePoint(4, 2, 4, 4, 1), [2, 4], 'east output turns south');
  const out = placedPins({ ...part, rot: 1 }, spec).find((p) => p.name === 'o')!;
  assert.equal(out.wside, 'S');
});

test('half adder', () => {
  const p = projectWith((b) => {
    b.add('in', 0, 0, { id: 'a', label: 'A' });
    b.add('in', 0, 4, { id: 'b', label: 'B' });
    b.add('xor', 6, 0, { id: 'x' });
    b.add('and', 6, 6, { id: 'n' });
    b.add('out', 14, 1, { id: 's' });
    b.add('out', 14, 7, { id: 'c' });
    b.wire('a', 'x.i0').wire('b', 'x.i1').wire('a', 'n.i0').wire('b', 'n.i1').wire('x', 's.i').wire('n', 'c.i');
  });
  const sim = run(p);
  for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
    sim.setInput('a', a);
    sim.setInput('b', b);
    assert.equal(sim.settle().stable, true);
    assert.equal(sim.pinValue('s', 'i'), a ^ b);
    assert.equal(sim.pinValue('c', 'i'), a & b);
  }
});

test('unit delay: a glitch appears on A AND NOT A', () => {
  const p = projectWith((b) => {
    b.add('in', 0, 0, { id: 'a' });
    b.add('not', 4, 4, { id: 'inv' });
    b.add('and', 8, 0, { id: 'g' });
    b.add('led', 14, 1, { id: 'l' });
    b.wire('a', 'g.i0').wire('a', 'inv.i0').wire('inv', 'g.i1').wire('g', 'l.i');
  });
  const sim = run(p);
  assert.equal(sim.pinValue('l', 'i'), 0);
  sim.setInput('a', 1);
  const seen: number[] = [];
  while (sim.pending) {
    sim.stepDelta();
    seen.push(sim.pinValue('l', 'i'));
  }
  assert.ok(seen.includes(1), 'the AND output pulses high for one gate delay');
  assert.equal(sim.pinValue('l', 'i'), 0);
});

test('floating inputs, tri-state buses and short circuits', () => {
  const p = projectWith((b) => {
    b.add('in', 0, 0, { id: 'd1', value: 1 });
    b.add('in', 0, 4, { id: 'e1', value: 1 });
    b.add('in', 0, 8, { id: 'd2', value: 0 });
    b.add('in', 0, 12, { id: 'e2', value: 0 });
    b.add('tri', 6, 0, { id: 't1' });
    b.add('tri', 6, 8, { id: 't2' });
    b.add('led', 14, 4, { id: 'bus' });
    b.add('and', 6, 16, { id: 'g' });
    b.add('led', 14, 16, { id: 'floating' });
    b.wire('d1', 't1.i').wire('e1', 't1.en').wire('d2', 't2.i').wire('e2', 't2.en');
    b.wire('t1', 'bus.i').wire('t2', 'bus.i');
    b.wire('d1', 'g.i0').wire('g', 'floating.i');
  });
  const sim = run(p);
  assert.equal(sim.pinValue('bus', 'i'), V1, 'only t1 drives the bus');
  assert.equal(sim.pinValue('floating', 'i'), VX, '1 AND floating = unknown');
  sim.setInput('e1', 0);
  sim.settle();
  assert.equal(sim.pinValue('bus', 'i'), VZ, 'no driver: high impedance');
  sim.setInput('e2', 1);
  sim.settle();
  assert.equal(sim.pinValue('bus', 'i'), V0);
  sim.setInput('e1', 1);
  sim.settle();
  assert.equal(sim.pinValue('bus', 'i'), VE, 'two drivers disagree');
});

test('SR latch from NOR gates holds its state', () => {
  const p = projectWith((b) => {
    b.add('in', 0, 0, { id: 's' });
    b.add('in', 0, 8, { id: 'r' });
    b.add('nor', 6, 0, { id: 'n1' }); // outputs Q̄
    b.add('nor', 6, 8, { id: 'n2' }); // outputs Q
    b.add('out', 14, 9, { id: 'q' });
    b.wire('s', 'n1.i0').wire('n2', 'n1.i1').wire('n1', 'n2.i0').wire('r', 'n2.i1').wire('n2', 'q.i');
  });
  const sim = run(p);
  assert.equal(sim.pinValue('q', 'i'), VX, 'never set: unknown');
  sim.setInput('s', 1);
  sim.settle();
  assert.equal(sim.pinValue('q', 'i'), 1);
  sim.setInput('s', 0);
  sim.settle();
  assert.equal(sim.pinValue('q', 'i'), 1, 'holds after S released');
  sim.setInput('r', 1);
  sim.settle();
  assert.equal(sim.pinValue('q', 'i'), 0);
  sim.setInput('r', 0);
  sim.settle();
  assert.equal(sim.pinValue('q', 'i'), 0);
  // Releasing S and R together from 1,1 makes an ideal latch oscillate.
  sim.setInput('s', 1);
  sim.setInput('r', 1);
  sim.settle();
  sim.setInput('s', 0);
  sim.setInput('r', 0);
  assert.equal(sim.settle(200).stable, false);
  assert.equal(sim.oscillating, true);
  assert.ok(sim.unstableNets.size >= 2);
});

test('ring oscillator is reported, not hung', () => {
  // A NAND whose output feeds its own input oscillates once enabled.
  const p = projectWith((b) => {
    b.add('in', 0, 0, { id: 'en' });
    b.add('nand', 4, 0, { id: 'n' });
    b.wire('en', 'n.i0').wire('n.o', 'n.i1');
  });
  const sim = new Simulator(compile(p));
  assert.equal(sim.settle(100).stable, true, 'disabled: output steady at 1');
  assert.equal(sim.pinValue('n', 'o'), 1);
  sim.setInput('en', 1);
  const res = sim.settle(100);
  assert.equal(res.stable, false);
  assert.equal(sim.oscillating, true);
  assert.ok(sim.unstableNets.size > 0);
  // A NOT gate looped onto itself starts unknown and stays unknown.
  const p2 = projectWith((b) => {
    b.add('not', 0, 0, { id: 'n' });
    b.wire('n.o', 'n.i0');
  });
  const sim2 = new Simulator(compile(p2));
  assert.equal(sim2.settle(100).stable, true);
  assert.equal(sim2.pinValue('n', 'o'), VX);
});

test('ripple counter from T flip-flops counts clock ticks', () => {
  const p = projectWith((b) => {
    b.add('clock', 0, 0, { id: 'clk', period: 1 });
    b.add('const', 0, 6, { id: 'one', value: 1 });
    b.add('tff', 6, 0, { id: 't0' });
    b.add('tff', 14, 0, { id: 't1' });
    b.add('tff', 22, 0, { id: 't2' });
    b.add('hex', 30, 0, { id: 'h' });
    b.wire('clk', 't0.c').wire('one', 't0.t').wire('one', 't1.t').wire('one', 't2.t');
    b.wire('t0.nq', 't1.c').wire('t1.nq', 't2.c');
    b.wire('t0.q', 'h.d0').wire('t1.q', 'h.d1').wire('t2.q', 'h.d2');
  });
  const sim = run(p);
  const count = () => sim.pinValue('h', 'd0') + 2 * sim.pinValue('h', 'd1') + 4 * sim.pinValue('h', 'd2');
  assert.equal(count(), 0);
  const seen: number[] = [];
  for (let i = 0; i < 18; i++) {
    assert.equal(sim.tick().stable, true);
    if (sim.pinValue('clk', 'o') === 1) seen.push(count());
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 0, 1]);
});

test('D flip-flop: rising edge only, asynchronous clear', () => {
  const p = projectWith((b) => {
    b.add('in', 0, 0, { id: 'd' });
    b.add('in', 0, 4, { id: 'c' });
    b.add('in', 0, 8, { id: 'r' });
    b.add('dff', 6, 0, { id: 'ff' });
    b.add('out', 14, 0, { id: 'q' });
    b.wire('d', 'ff.d').wire('c', 'ff.c').wire('r', 'ff.clr').wire('ff.q', 'q.i');
  });
  const sim = run(p);
  const set = (path: string, v: 0 | 1) => {
    sim.setInput(path, v);
    sim.settle();
    return sim.pinValue('q', 'i');
  };
  assert.equal(set('d', 1), 0, 'D alone does nothing');
  assert.equal(set('c', 1), 1, 'captured on rising edge');
  assert.equal(set('d', 0), 1, 'ignores D while clock is high');
  assert.equal(set('c', 0), 1, 'falling edge does nothing');
  assert.equal(set('r', 1), 0, 'clear');
  set('r', 0);
  set('d', 1);
  assert.equal(set('c', 1), 1);
  assert.equal(sim.pinValue('ff', 'nq'), 0);
});

test('JK flip-flop truth table', () => {
  const p = projectWith((b) => {
    b.add('in', 0, 0, { id: 'j' });
    b.add('in', 0, 4, { id: 'k' });
    b.add('in', 0, 8, { id: 'c' });
    b.add('jkff', 6, 0, { id: 'ff' });
    b.add('out', 14, 0, { id: 'q' });
    b.wire('j', 'ff.j').wire('k', 'ff.k').wire('c', 'ff.c').wire('ff.q', 'q.i');
  });
  const sim = run(p);
  const pulse = (j: 0 | 1, k: 0 | 1) => {
    sim.setInput('j', j);
    sim.setInput('k', k);
    sim.settle();
    sim.setInput('c', 1);
    sim.settle();
    sim.setInput('c', 0);
    sim.settle();
    return sim.pinValue('q', 'i');
  };
  assert.equal(pulse(1, 0), 1, 'set');
  assert.equal(pulse(0, 0), 1, 'hold');
  assert.equal(pulse(1, 1), 0, 'toggle');
  assert.equal(pulse(1, 1), 1, 'toggle');
  assert.equal(pulse(0, 1), 0, 'reset');
});

function fullAdderChip(): Project['chips'][number] {
  const b = new CircuitBuilder('fa', '全加器');
  b.add('in', 0, 0, { id: 'A', label: 'A' });
  b.add('in', 0, 4, { id: 'B', label: 'B' });
  b.add('in', 0, 8, { id: 'Ci', label: 'Cin' });
  b.add('xor', 6, 0, { id: 'x1' });
  b.add('xor', 14, 2, { id: 'x2' });
  b.add('and', 6, 8, { id: 'a1' });
  b.add('and', 14, 8, { id: 'a2' });
  b.add('or', 22, 8, { id: 'o1' });
  b.add('out', 28, 3, { id: 'S', label: 'S' });
  b.add('out', 28, 9, { id: 'Co', label: 'Cout' });
  b.wire('A', 'x1.i0').wire('B', 'x1.i1').wire('x1', 'x2.i0').wire('Ci', 'x2.i1').wire('x2', 'S.i');
  b.wire('A', 'a1.i0').wire('B', 'a1.i1').wire('x1', 'a2.i0').wire('Ci', 'a2.i1');
  b.wire('a1', 'o1.i0').wire('a2', 'o1.i1').wire('o1', 'Co.i');
  return b.build();
}

test('chips: a 4-bit adder made of nested full-adder chips', () => {
  const fa = fullAdderChip();
  // A 2-bit adder chip made from two full-adder chips, then two of those make 4 bits.
  const p0 = emptyProject();
  p0.chips = [fa];
  const b2 = new CircuitBuilder('add2', '2 位加法器', { project: p0 });
  for (const [id, y] of [['a0', 0], ['a1', 4], ['b0', 8], ['b1', 12], ['ci', 16]] as const) b2.add('in', 0, y, { id, label: id });
  b2.add('chip', 6, 0, { id: 'f0', chip: 'fa' });
  b2.add('chip', 6, 10, { id: 'f1', chip: 'fa' });
  b2.add('out', 16, 0, { id: 's0', label: 's0' });
  b2.add('out', 16, 4, { id: 's1', label: 's1' });
  b2.add('out', 16, 8, { id: 'co', label: 'co' });
  b2.wire('a0', 'f0.A').wire('b0', 'f0.B').wire('ci', 'f0.Ci').wire('f0.S', 's0.i');
  b2.wire('a1', 'f1.A').wire('b1', 'f1.B').wire('f0.Co', 'f1.Ci').wire('f1.S', 's1.i').wire('f1.Co', 'co.i');
  const add2 = b2.build();
  const p = projectWith(
    (b) => {
      for (let i = 0; i < 4; i++) {
        b.add('in', 0, i * 4, { id: `A${i}` });
        b.add('in', 0, 20 + i * 4, { id: `B${i}` });
      }
      b.add('chip', 8, 0, { id: 'lo', chip: 'add2' });
      b.add('chip', 8, 14, { id: 'hi', chip: 'add2' });
      b.add('hex', 24, 0, { id: 'h' });
      b.add('led', 24, 10, { id: 'carry' });
      b.wire('A0', 'lo.a0').wire('A1', 'lo.a1').wire('B0', 'lo.b0').wire('B1', 'lo.b1');
      b.wire('A2', 'hi.a0').wire('A3', 'hi.a1').wire('B2', 'hi.b0').wire('B3', 'hi.b1').wire('lo.co', 'hi.ci');
      b.wire('lo.s0', 'h.d0').wire('lo.s1', 'h.d1').wire('hi.s0', 'h.d2').wire('hi.s1', 'h.d3').wire('hi.co', 'carry.i');
    },
    [fa, add2]
  );
  const nl = compile(p);
  assert.equal(nl.errors.length, 0);
  assert.equal(nl.comps.filter((c) => c.kind === 'xor').length, 8, 'four full adders, two XORs each');
  // Carry-in of the low half is unconnected: the adder sees a floating input.
  const sim = new Simulator(nl);
  sim.settle();
  assert.equal(sim.pinValue('h', 'd0'), VX);
  // Tie it low with a constant and check every sum.
  p.main.parts.push({ id: 'zero', kind: 'const', x: 0, y: 40, rot: 0, value: 0 });
  p.main.wires.push({ id: 'wz', a: { part: 'zero', pin: 'o' }, b: { part: 'lo', pin: 'ci' } });
  const sim2 = new Simulator(compile(p));
  for (let a = 0; a < 16; a++) {
    for (let bb = 0; bb < 16; bb++) {
      for (let i = 0; i < 4; i++) {
        sim2.setInput(`A${i}`, ((a >> i) & 1) as 0 | 1);
        sim2.setInput(`B${i}`, ((bb >> i) & 1) as 0 | 1);
      }
      assert.equal(sim2.settle().stable, true);
      const sum = [0, 1, 2, 3].reduce((s, i) => s + (sim2.pinValue('h', `d${i}`) << i), 0) + (sim2.pinValue('carry', 'i') << 4);
      assert.equal(sum, a + bb, `${a}+${bb}`);
    }
  }
});

test('recursive and missing chips are compile errors', () => {
  const self = new CircuitBuilder('loop', '自己');
  self.add('in', 0, 0, { id: 'i' });
  self.add('chip', 4, 0, { id: 'me', chip: 'loop' });
  const p = emptyProject();
  p.chips = [self.build()];
  p.main.parts.push({ id: 'x', kind: 'chip', chip: 'loop', x: 0, y: 0, rot: 0 });
  p.main.parts.push({ id: 'y', kind: 'chip', chip: 'nope', x: 0, y: 8, rot: 0 });
  const nl = compile(p);
  assert.ok(nl.errors.some((e) => e.kind === 'missing-chip' && e.partId === 'y'));
  const inner = compile(p, 'loop');
  assert.ok(inner.errors.some((e) => e.kind === 'recursive-chip' && e.partId === 'me'));
});

test('state survives recompiling after an edit', () => {
  const p = projectWith((b) => {
    b.add('in', 0, 0, { id: 'c' });
    b.add('const', 0, 4, { id: 'one', value: 1 });
    b.add('tff', 6, 0, { id: 'ff' });
    b.add('led', 14, 0, { id: 'l' });
    b.wire('c', 'ff.c').wire('one', 'ff.t').wire('ff.q', 'l.i');
  });
  const sim = run(p);
  sim.setInput('c', 1);
  sim.settle();
  assert.equal(sim.pinValue('l', 'i'), 1);
  // Add an unrelated part: the flip-flop keeps its state and the input keeps its value.
  p.main.parts.push({ id: 'extra', kind: 'and', x: 30, y: 30, rot: 0 });
  const sim2 = new Simulator(compile(p), sim);
  sim2.settle();
  assert.equal(sim2.pinValue('l', 'i'), 1);
  assert.equal(sim2.getInput('c'), 1);
});

test('ROM: looks up the word at the address; unknown address gives X', () => {
  const p = projectWith((b) => {
    for (let i = 0; i < 2; i++) b.add('in', 0, i * 4, { id: `a${i}` });
    b.add('rom', 6, 0, { id: 'rom', abits: 2, dbits: 3, data: [5, 2, 7] });
    b.wire('a0', 'rom.a0').wire('a1', 'rom.a1');
  });
  const sim = run(p);
  const word = () => [0, 1, 2].reduce((s, k) => s + (sim.pinValue('rom', `d${k}`) << k), 0);
  const at = (addr: number) => {
    sim.setInput('a0', (addr & 1) as 0 | 1);
    sim.setInput('a1', ((addr >> 1) & 1) as 0 | 1);
    sim.settle();
    return word();
  };
  assert.deepEqual([at(0), at(1), at(2), at(3)], [5, 2, 7, 0], 'missing words read as 0');
  const q = projectWith((b) => {
    b.add('rom', 6, 0, { id: 'rom', abits: 1, dbits: 1, data: [1, 1] });
  });
  assert.equal(run(q).pinValue('rom', 'd0'), VX, 'floating address');
});

test('register: loads on the rising edge when enabled, clears asynchronously', () => {
  const p = projectWith((b) => {
    for (let i = 0; i < 4; i++) b.add('in', 0, i * 3, { id: `d${i}` });
    b.add('in', 0, 14, { id: 'clk' });
    b.add('in', 0, 18, { id: 'en', value: 1 });
    b.add('in', 0, 22, { id: 'clr' });
    b.add('reg', 8, 0, { id: 'r' });
    for (let i = 0; i < 4; i++) b.wire(`d${i}`, `r.d${i}`);
    b.wire('clk', 'r.c').wire('en', 'r.en').wire('clr', 'r.clr');
  });
  const sim = run(p);
  const val = () => [0, 1, 2, 3].reduce((s, k) => s + (sim.pinValue('r', `q${k}`) << k), 0);
  const set = (id: string, v: 0 | 1) => {
    sim.setInput(id, v);
    sim.settle();
  };
  set('d0', 1);
  set('d2', 1);
  assert.equal(val(), 0);
  set('clk', 1);
  assert.equal(val(), 5);
  set('clk', 0);
  set('en', 0);
  set('d1', 1);
  set('clk', 1);
  assert.equal(val(), 5, 'disabled: holds');
  set('clr', 1);
  assert.equal(val(), 0);
  assert.deepEqual([...sim.memory('r')!], [0, 0, 0, 0]);
});

test('RAM: writes on the clock edge when WE=1, reads combinationally, keeps contents across edits', () => {
  const p = projectWith((b) => {
    for (let i = 0; i < 2; i++) b.add('in', 0, i * 3, { id: `a${i}` });
    for (let i = 0; i < 2; i++) b.add('in', 0, 8 + i * 3, { id: `i${i}` });
    b.add('in', 0, 16, { id: 'we' });
    b.add('in', 0, 20, { id: 'clk' });
    b.add('ram', 8, 0, { id: 'm', abits: 2, dbits: 2 });
    b.wire('a0', 'm.a0').wire('a1', 'm.a1').wire('i0', 'm.i0').wire('i1', 'm.i1').wire('we', 'm.we').wire('clk', 'm.c');
  });
  const sim = run(p);
  const set = (id: string, v: 0 | 1) => {
    sim.setInput(id, v);
    sim.settle();
  };
  const read = () => sim.pinValue('m', 'o0') + 2 * sim.pinValue('m', 'o1');
  const write = (addr: number, v: number) => {
    set('a0', (addr & 1) as 0 | 1);
    set('a1', ((addr >> 1) & 1) as 0 | 1);
    set('i0', (v & 1) as 0 | 1);
    set('i1', ((v >> 1) & 1) as 0 | 1);
    set('we', 1);
    set('clk', 1);
    set('clk', 0);
    set('we', 0);
  };
  write(1, 3);
  write(2, 2);
  set('i0', 0);
  set('i1', 0);
  set('clk', 1); // WE=0: no write
  set('clk', 0);
  const at = (addr: number) => {
    set('a0', (addr & 1) as 0 | 1);
    set('a1', ((addr >> 1) & 1) as 0 | 1);
    return read();
  };
  assert.deepEqual([at(0), at(1), at(2), at(3)], [0, 3, 2, 0]);
  // Editing the circuit keeps the memory contents.
  p.main.parts.push({ id: 'extra', kind: 'led', x: 40, y: 0, rot: 0 });
  const sim2 = new Simulator(compile(p), sim);
  sim2.settle();
  assert.deepEqual([...sim2.memory('m')!], [0, 0, 1, 1, 0, 1, 0, 0]);
  sim2.reset();
  assert.deepEqual([...sim2.memory('m')!], [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('scale: a 5000-gate chain settles (not mistaken for oscillation), a 64-bit adder of chips adds', async () => {
  const chain = projectWith((b) => {
    b.add('in', 0, 0, { id: 'src' });
    let prev = 'src';
    for (let i = 0; i < 5000; i++) {
      const id = b.add(i % 2 ? 'not' : 'buf', 4 + i * 4, 0);
      b.wire(prev, `${id}.i0`);
      prev = id;
    }
    b.add('led', 4 + 5000 * 4, 0, { id: 'end' });
    b.wire(prev, 'end.i');
  });
  const t0 = performance.now();
  const sim = new Simulator(compile(chain));
  assert.equal(sim.settle().stable, true);
  sim.setInput('src', 1);
  const res = sim.settle();
  assert.equal(res.stable, true);
  assert.equal(res.deltas, 5002, 'the switch, 5000 gates, then the lamp');
  assert.equal(sim.pinValue('end', 'i'), 1, '2500 inverters: even count');
  assert.ok(performance.now() - t0 < 2000, 'fast enough');

  const { fullAdderChip } = await import('../../src/engine/examples.ts');
  const fa = fullAdderChip();
  const N = 64;
  const p = projectWith((b) => {
    b.add('const', 0, 0, { id: 'zero', value: 0 });
    for (let i = 0; i < N; i++) {
      b.add('in', 0, 10 + i * 10, { id: `A${i}` });
      b.add('in', 0, 14 + i * 10, { id: `B${i}` });
      b.add('chip', 10, 10 + i * 10, { id: `F${i}`, chip: 'fa' });
      b.add('led', 30, 10 + i * 10, { id: `S${i}` });
      b.wire(`A${i}`, `F${i}.A`).wire(`B${i}`, `F${i}.B`).wire(`F${i}.S`, `S${i}.i`);
      b.wire(i ? `F${i - 1}.Co` : 'zero', `F${i}.Ci`);
    }
  }, [fa]);
  const nl = compile(p);
  assert.equal(nl.comps.filter((c) => c.kind === 'xor').length, 2 * N);
  const big = new Simulator(nl);
  big.settle();
  const rand = (() => {
    let s = 12345;
    return () => (s = (s * 1103515245 + 12345) >>> 0);
  })();
  const t1 = performance.now();
  for (let trial = 0; trial < 40; trial++) {
    const a = (BigInt(rand()) << 32n) | BigInt(rand());
    const c = (BigInt(rand()) << 32n) | BigInt(rand());
    for (let i = 0; i < N; i++) {
      big.setInput(`A${i}`, Number((a >> BigInt(i)) & 1n) as 0 | 1);
      big.setInput(`B${i}`, Number((c >> BigInt(i)) & 1n) as 0 | 1);
    }
    assert.equal(big.settle().stable, true);
    let sum = 0n;
    for (let i = 0; i < N; i++) sum |= BigInt(big.pinValue(`S${i}`, 'i')) << BigInt(i);
    assert.equal(sum, (a + c) & ((1n << 64n) - 1n));
  }
  assert.ok(performance.now() - t1 < 2000);
});

test('tunnels: same label connects, different label or different circuit does not', () => {
  const chip = new CircuitBuilder('c', 'c');
  chip.add('in', 0, 0, { id: 'ci', label: 'X' });
  chip.add('tunnel', 4, 0, { id: 'ct', label: 'BUS' });
  chip.add('out', 10, 0, { id: 'co', label: 'Y' });
  chip.add('tunnel', 6, 4, { id: 'ct2', label: 'BUS' });
  chip.wire('ci', 'ct.p').wire('ct2.p', 'co.i');
  const p = projectWith(
    (b) => {
      b.add('in', 0, 0, { id: 'src' });
      b.add('tunnel', 4, 0, { id: 't1', label: 'BUS' });
      b.add('tunnel', 4, 6, { id: 't2', label: 'BUS' });
      b.add('tunnel', 4, 12, { id: 't3', label: 'OTHER' });
      b.add('led', 10, 6, { id: 'l2' });
      b.add('led', 10, 12, { id: 'l3' });
      b.add('chip', 4, 20, { id: 'inst', chip: 'c' });
      b.add('led', 20, 20, { id: 'l4' });
      b.wire('src', 't1.p').wire('t2.p', 'l2.i').wire('t3.p', 'l3.i').wire('inst.co', 'l4.i');
    },
    [chip.build()]
  );
  const sim = run(p);
  sim.setInput('src', 1);
  sim.settle();
  assert.equal(sim.pinValue('l2', 'i'), 1);
  assert.equal(sim.pinValue('l3', 'i'), VZ, 'different label: floating');
  assert.equal(sim.pinValue('l4', 'i'), VZ, "the chip's BUS is its own: its input X is unconnected");
});
