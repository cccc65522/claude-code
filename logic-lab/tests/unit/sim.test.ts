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
