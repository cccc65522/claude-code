import assert from 'node:assert/strict';
import { test } from 'node:test';
import { truthTable, combinationalLoops, circuitStats } from '../../src/engine/analyze.ts';
import { emptyProject, CircuitBuilder } from '../../src/engine/builder.ts';
import { compile } from '../../src/engine/compile.ts';
import { evaluate, ExprError, exprToText, parseEquations, synthesize, variables, type Expr } from '../../src/engine/expr.ts';
import { covers, literalCount, minimize, minimizePOS, posToText, primeImplicants, sopToText } from '../../src/engine/qm.ts';
import type { Project } from '../../src/engine/types.ts';

// Deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function bruteMinTerms(n: number, ones: number[], dcs: number[]): number {
  // Smallest number of product terms, by brute force over prime implicants.
  const primes = primeImplicants(n, ones, dcs);
  for (let k = 0; k <= primes.length; k++) {
    const pick = (start: number, left: number, chosen: typeof primes): boolean => {
      if (left === 0) return ones.every((m) => chosen.some((p) => covers(p, m)));
      for (let i = start; i < primes.length; i++) if (pick(i + 1, left - 1, [...chosen, primes[i]])) return true;
      return false;
    };
    if (pick(0, k, [])) return k;
  }
  return Infinity;
}

test('Quine–McCluskey: textbook examples', () => {
  // f(A,B,C,D) = Σm(4,8,10,11,12,15) + d(9,14)  →  B·C̄·D̄ + A·D̄ + A·C  (3 terms)
  const sop = minimize(4, [4, 8, 10, 11, 12, 15], [9, 14]);
  assert.equal(sop.length, 3);
  assert.equal(sopToText(sop, 4, ['A', 'B', 'C', 'D']), 'A & C | A & !D | B & !C & !D');
  // XOR cannot be simplified.
  assert.equal(minimize(2, [1, 2]).length, 2);
  // Constant functions.
  assert.equal(sopToText(minimize(3, []), 3, ['A', 'B', 'C']), '0');
  assert.equal(sopToText(minimize(2, [0, 1, 2, 3]), 2, ['A', 'B']), '1');
  // Majority function: AB + AC + BC.
  const maj = minimize(3, [3, 5, 6, 7]);
  assert.equal(maj.length, 3);
  assert.ok(maj.every((p) => literalCount(p, 3) === 2));
  // Product of sums of the majority function: (A+B)(A+C)(B+C).
  assert.equal(posToText(minimizePOS(3, [3, 5, 6, 7]), 3, ['A', 'B', 'C']), '(A | B) & (A | C) & (B | C)');
});

test('Quine–McCluskey: random functions are covered exactly and minimally', () => {
  const rand = rng(7);
  for (let trial = 0; trial < 150; trial++) {
    const n = 1 + Math.floor(rand() * 5);
    const ones: number[] = [];
    const dcs: number[] = [];
    for (let m = 0; m < 1 << n; m++) {
      const r = rand();
      if (r < 0.4) ones.push(m);
      else if (r < 0.5) dcs.push(m);
    }
    const sop = minimize(n, ones, dcs);
    for (let m = 0; m < 1 << n; m++) {
      const v = sop.some((p) => covers(p, m));
      if (ones.includes(m)) assert.ok(v, `minterm ${m} covered`);
      else if (!dcs.includes(m)) assert.ok(!v, `maxterm ${m} not covered`);
    }
    if (n <= 4) assert.equal(sop.length, bruteMinTerms(n, ones, dcs), `minimal for n=${n} ones=${ones} dc=${dcs}`);
    const pos = minimizePOS(n, ones, dcs);
    for (let m = 0; m < 1 << n; m++) {
      // POS terms list the zeros: f(m) = 0 iff some term covers m.
      const zero = pos.some((p) => covers(p, m));
      if (ones.includes(m)) assert.ok(!zero);
      else if (!dcs.includes(m)) assert.ok(zero);
    }
  }
});

test('expression parser: precedence, aliases and postfix complement', () => {
  const [eq] = parseEquations('Y = A + B·C ⊕ ¬D');
  assert.equal(exprToText(eq.expr), 'A | B & C ^ !D');
  const [e2] = parseEquations("F = (A and not B) or C'");
  assert.equal(exprToText(e2.expr), 'A & !B | !C');
  const eqs = parseEquations('S = A ^ B ^ Cin\nCout = A & B | Cin & (A ^ B)  # carry');
  assert.deepEqual(eqs.map((e) => e.name), ['S', 'Cout']);
  assert.deepEqual(variables(eqs), ['A', 'B', 'Cin']);
  assert.equal(parseEquations('A && B || 1')[0].name, 'Y');
  assert.equal(parseEquations('甲 = 乙 & 丙')[0].name, '甲');
});

test('expression parser: helpful errors', () => {
  const err = (src: string) => {
    try {
      parseEquations(src);
    } catch (e) {
      assert.ok(e instanceof ExprError);
      return e;
    }
    assert.fail(`expected error for ${src}`);
  };
  assert.match(err('Y = A B').message, /缺少运算符/);
  assert.match(err('Y = (A & B').message, /右括号/);
  assert.match(err('Y = A & ').message, /不完整/);
  assert.match(err('Y = A $ B').message, /不认识/);
  assert.match(err('Y = A\nY = B').message, /两次/);
  assert.match(err('Y = A\nZ = Y & B').message, /既是输出/);
  const e = err('Y = A &\n  & B');
  assert.equal(e.line, 2, 'a trailing operator continues onto the next line');
  assert.equal(e.col, 3);
  assert.equal(parseEquations('Y = (A &\n B) |\n C').length, 1);
});

function randomExpr(rand: () => number, vars: string[], depth: number): Expr {
  if (depth === 0 || rand() < 0.25) {
    if (rand() < 0.05) return { t: 'const', v: rand() < 0.5 ? 0 : 1 };
    return { t: 'var', name: vars[Math.floor(rand() * vars.length)] };
  }
  const r = rand();
  if (r < 0.2) return { t: 'not', a: randomExpr(rand, vars, depth - 1) };
  const t = r < 0.5 ? 'and' : r < 0.8 ? 'or' : 'xor';
  const k = 2 + Math.floor(rand() * 4);
  return { t, args: Array.from({ length: k }, () => randomExpr(rand, vars, depth - 1)) };
}

test('synthesis: generated circuits compute the expression (random check through the simulator)', () => {
  const rand = rng(42);
  for (let trial = 0; trial < 60; trial++) {
    const vars = ['A', 'B', 'C', 'D', 'E'].slice(0, 1 + Math.floor(rand() * 5));
    const exprs = [randomExpr(rand, vars, 4), randomExpr(rand, vars, 3)];
    const src = `F = ${exprToText(exprs[0])}\nG = ${exprToText(exprs[1])}`;
    const eqs = parseEquations(src);
    const { circuit, inputs } = synthesize(eqs, { maxFanIn: 2 + (trial % 3) });
    const p: Project = emptyProject();
    p.main = { ...circuit, id: 'main' };
    // Gates must not overlap each other.
    const nl = compile(p);
    assert.equal(nl.errors.length, 0);
    const res = truthTable(p, 'main');
    assert.ok(res.ok, src);
    if (!res.ok) continue;
    assert.deepEqual(res.table.inputs.map((s) => s.label), inputs);
    res.table.rows.forEach((row, r) => {
      const env: Record<string, 0 | 1> = {};
      inputs.forEach((v, k) => (env[v] = ((r >> (inputs.length - 1 - k)) & 1) as 0 | 1));
      assert.equal(row[0], evaluate(eqs[0].expr, env), `${src} row ${r}`);
      assert.equal(row[1], evaluate(eqs[1].expr, env), `${src} row ${r}`);
    });
  }
});

test('synthesis: shared subexpressions are built once, NOT of AND becomes NAND', () => {
  const eqs = parseEquations('X = !(A & B)\nY = (A & B) | C\nZ = !(A & B) ^ C');
  const { circuit, gateCount } = synthesize(eqs);
  const kinds = circuit.parts.map((p) => p.kind).sort();
  assert.ok(kinds.includes('nand'));
  assert.equal(circuit.parts.filter((p) => p.kind === 'and').length, 1);
  assert.equal(circuit.parts.filter((p) => p.kind === 'nand').length, 1, 'X and Z share the NAND');
  assert.equal(gateCount, 4);
});

test('truth table of a full adder, with minimised expressions', () => {
  const { circuit } = synthesize(parseEquations('S = A ^ B ^ C\nCo = A & B | A & C | B & C'));
  const p = emptyProject();
  p.main = { ...circuit, id: 'main' };
  const res = truthTable(p, 'main');
  assert.ok(res.ok);
  if (!res.ok) return;
  const t = res.table;
  assert.deepEqual(t.rows.map((r) => r.join('')), ['00', '10', '10', '01', '10', '01', '01', '11']);
  assert.equal(t.sequential, false);
  assert.equal(sopToText(t.sop[1]!, 3, ['A', 'B', 'C']), 'A & B | A & C | B & C');
  assert.equal(t.sop[0]!.length, 4, 'XOR of three variables needs all four minterms');
});

test('truth table flags latches and flip-flops as sequential', () => {
  const p = emptyProject();
  const b = new CircuitBuilder('main', 'latch');
  b.add('in', 0, 0, { id: 's', label: 'S' });
  b.add('in', 0, 8, { id: 'r', label: 'R' });
  b.add('nor', 6, 0, { id: 'n1' });
  b.add('nor', 6, 8, { id: 'n2' });
  b.add('out', 14, 9, { id: 'q', label: 'Q' });
  b.wire('s', 'n1.i0').wire('n2', 'n1.i1').wire('n1', 'n2.i0').wire('r', 'n2.i1').wire('n2', 'q.i');
  p.main = b.build();
  const loops = combinationalLoops(compile(p));
  assert.equal(loops.length, 1);
  assert.deepEqual([...loops[0]].sort(), ['n1', 'n2']);
  const res = truthTable(p, 'main');
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.table.sequential, true);
  // S=1 sets, R=1 resets, S=R=0 is unknown from the all-unknown start.
  assert.deepEqual(res.table.rows.map((r) => r[0]), [2, 0, 1, 0]);
  assert.equal(circuitStats(p, 'main').depth, 2);
});

test('truth table errors', () => {
  const p = emptyProject();
  assert.equal(truthTable(p, 'main').ok, false);
  const many = new CircuitBuilder('main', 'many');
  for (let i = 0; i < 11; i++) many.add('in', 0, i * 4);
  many.add('out', 10, 0);
  p.main = many.build();
  const res = truthTable(p, 'main');
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /最多/);
});

import { checkNames, tableToEquations, type Cell } from '../../src/engine/expr.ts';

test('truth table designer: random tables round-trip through minimisation, synthesis and simulation', () => {
  const rand = rng(99);
  for (let trial = 0; trial < 40; trial++) {
    const n = 1 + Math.floor(rand() * 4);
    const inputs = ['P', 'Q', 'R', 'S'].slice(0, n);
    const outs = ['F', 'G'].map((name) => ({ name, values: Array.from({ length: 1 << n }, (): Cell => (rand() < 0.15 ? 'x' : rand() < 0.5 ? 1 : 0)) }));
    const src = tableToEquations(inputs, outs);
    const { circuit } = synthesize(parseEquations(src), { inputOrder: inputs });
    const p = emptyProject();
    p.main = { ...circuit, id: 'main' };
    const res = truthTable(p, 'main');
    assert.ok(res.ok, src);
    if (!res.ok) continue;
    assert.deepEqual(res.table.inputs.map((s) => s.label), inputs, 'inputs keep their order even if unused');
    outs.forEach((o, k) =>
      o.values.forEach((v, r) => {
        if (v !== 'x') assert.equal(res.table.rows[r][k], v, `${src}\nrow ${r}`);
      })
    );
  }
});

test('truth table designer: name checks', () => {
  assert.equal(checkNames(['A', 'B'], ['Y']), null);
  assert.match(checkNames(['A', 'A'], ['Y'])!, /重复/);
  assert.match(checkNames(['A', '1x'], ['Y'])!, /不是合法/);
  assert.match(checkNames(['and'], ['Y'])!, /运算符/);
  assert.match(checkNames(['A'], ['A'])!, /重复/);
  assert.match(checkNames([], ['Y'])!, /至少/);
});
