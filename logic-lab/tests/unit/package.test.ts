import assert from 'node:assert/strict';
import { test } from 'node:test';
import { truthTable } from '../../src/engine/analyze.ts';
import { compile, findCircuit } from '../../src/engine/compile.ts';
import { EXAMPLES } from '../../src/engine/examples.ts';
import { chipInterface } from '../../src/engine/parts.ts';
import { PackageError, packageParts } from '../../src/engine/package.ts';
import { Simulator } from '../../src/engine/sim.ts';
import type { Project } from '../../src/engine/types.ts';

let n = 0;
const newId = (prefix: string) => `${prefix}_t${++n}`;
const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const rows = (p: Project, c = 'main') => {
  const r = truthTable(p, c);
  assert.ok(r.ok);
  return r.ok ? r.table.rows.map((x) => x.join('')) : [];
};

test('packaging the gates of the half adder keeps its behaviour and names the pins', () => {
  const p = example('half-adder');
  const before = rows(p);
  const ids = p.main.parts.map((x) => x.id); // everything: switches and lamps stay outside
  const res = packageParts(p, 'main', ids, { chipId: 'ha', name: '半加器', newId });
  assert.equal(res.inputs, 2);
  assert.equal(res.outputs, 2);
  const chip = res.project.chips.find((c) => c.id === 'ha')!;
  const { inputs, outputs } = chipInterface(chip);
  assert.deepEqual(inputs.map((x) => x.label), ['A', 'B']);
  assert.deepEqual(outputs.map((x) => x.label), ['S', 'C']);
  assert.deepEqual(res.project.main.parts.filter((x) => x.kind === 'chip').map((x) => x.id), [res.instanceId]);
  assert.equal(res.project.main.parts.filter((x) => x.kind === 'xor' || x.kind === 'and').length, 0);
  assert.deepEqual(compile(res.project).errors, []);
  assert.deepEqual(rows(res.project), before);
  assert.deepEqual(rows(res.project, 'ha'), before, 'the chip on its own is a half adder too');
});

test('fan-in and fan-out across the boundary share one interface pin', () => {
  const p = example('half-adder');
  // A feeds both gates: one chip input for A, one for B.
  const gates = p.main.parts.filter((x) => x.kind === 'xor' || x.kind === 'and').map((x) => x.id);
  const res = packageParts(p, 'main', gates, { chipId: 'g', name: 'g', newId });
  const chip = res.project.chips.find((c) => c.id === 'g')!;
  assert.equal(chipInterface(chip).inputs.length, 2);
  // One output driving two lamps → one chip output.
  const q = example('sr-latch');
  const nor = q.main.parts.filter((x) => x.kind === 'nor').map((x) => x.id);
  const r2 = packageParts(q, 'main', [nor[0]], { chipId: 'n', name: 'n', newId });
  // n1 has inputs S and n2's output, and drives the Q̄ lamp and n2.
  assert.equal(r2.inputs, 2);
  assert.equal(r2.outputs, 1);
  const sim = new Simulator(compile(r2.project));
  sim.settle();
  sim.setInput('S', 1);
  sim.settle();
  assert.equal(sim.pinValue('q', 'i'), 1, 'latch still sets through the chip boundary');
  sim.setInput('S', 0);
  sim.settle();
  assert.equal(sim.pinValue('q', 'i'), 1, 'and holds');
});

test('sequential logic: a packaged decimal counter still counts 0–9', () => {
  const p = example('decimal');
  const logic = p.main.parts.filter((x) => x.kind === 'tff' || x.kind === 'and' || x.kind === 'const').map((x) => x.id);
  const res = packageParts(p, 'main', logic, { chipId: 'cnt', name: '十进制计数', newId });
  assert.equal(res.inputs, 1, 'only the clock goes in');
  assert.equal(res.outputs, 4, 'four counter bits come out');
  const sim = new Simulator(compile(res.project));
  sim.settle();
  const digits = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '1011111', '1110000', '1111111', '1111011'];
  const seen: number[] = [];
  for (let i = 0; i < 48; i++) {
    sim.tick();
    const d = digits.indexOf('abcdefg'.split('').map((s) => sim.pinValue('disp', s)).join(''));
    if (seen[seen.length - 1] !== d) seen.push(d);
  }
  assert.deepEqual(seen.slice(0, 11), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
});

test('packaging inside a chip definition (nested chips)', () => {
  const p = example('adder4');
  const fa = findCircuit(p, 'fa')!;
  const carry = fa.parts.filter((x) => x.id === 'a1' || x.id === 'a2' || x.id === 'o1').map((x) => x.id);
  const res = packageParts(p, 'fa', carry, { chipId: 'carry', name: '进位', newId });
  assert.equal(res.inputs, 4, 'A, B, Cin and A⊕B');
  assert.equal(res.outputs, 1);
  const sim = new Simulator(compile(res.project));
  for (let a = 0; a < 16; a += 3)
    for (let b = 0; b < 16; b += 5) {
      for (let i = 0; i < 4; i++) {
        sim.setInput(`A${i}`, ((a >> i) & 1) as 0 | 1);
        sim.setInput(`B${i}`, ((b >> i) & 1) as 0 | 1);
      }
      sim.settle();
      const sum = [0, 1, 2, 3].reduce((s, i) => s + (sim.pinValue('sum', `d${i}`) << i), 0) + (sim.pinValue('cout', 'i') << 4);
      assert.equal(sum, a + b);
    }
});

test('nothing to package', () => {
  const p = example('half-adder');
  const switches = p.main.parts.filter((x) => x.kind === 'in').map((x) => x.id);
  assert.throws(() => packageParts(p, 'main', switches, { chipId: 'x', name: 'x', newId }), PackageError);
});
