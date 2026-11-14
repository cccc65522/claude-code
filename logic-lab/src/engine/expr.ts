// Boolean expressions: parser, evaluator, and synthesis of a laid-out circuit.
//
// Syntax (one equation per line, or separated by ";"):
//   S = A ^ B ^ Cin
//   Cout = A & B | Cin & (A ^ B)
// Operators, loosest first:  OR: | + ∨ || or   XOR: ^ ⊕ xor   AND: & * · ∧ && and
// NOT: prefix ! ~ ¬ not, or postfix '  (A' = NOT A). Constants 0 and 1.
import { CircuitBuilder } from './builder.ts';
import { partSpec } from './parts.ts';
import type { Circuit, GateKind, Part, Wire } from './types.ts';

export type Expr =
  | { t: 'var'; name: string }
  | { t: 'const'; v: 0 | 1 }
  | { t: 'not'; a: Expr }
  | { t: 'and' | 'or' | 'xor'; args: Expr[] };

export interface Equation {
  name: string;
  expr: Expr;
}

export class ExprError extends Error {
  readonly line: number;
  readonly col: number;
  constructor(message: string, line: number, col: number) {
    super(message);
    this.line = line;
    this.col = col;
  }
}

type Tok =
  | { k: 'id'; s: string; line: number; col: number }
  | { k: 'num'; v: 0 | 1; line: number; col: number }
  | { k: 'op'; s: '|' | '^' | '&' | '!' | "'" | '(' | ')' | '='; line: number; col: number }
  | { k: 'sep'; line: number; col: number }
  | { k: 'eof'; line: number; col: number };

const WORD_OPS: Record<string, '|' | '^' | '&' | '!'> = { or: '|', xor: '^', and: '&', not: '!' };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let line = 1;
  let col = 1;
  let i = 0;
  let depth = 0;
  const isIdStart = (c: string) => /[A-Za-z_一-鿿]/.test(c);
  const isId = (c: string) => /[A-Za-z0-9_一-鿿]/.test(c);
  while (i < src.length) {
    const c = src[i];
    const at = { line, col };
    if (c === '\n') {
      // A line break inside parentheses or right after an operator continues the expression.
      const last = out[out.length - 1];
      const continues = depth > 0 || (last?.k === 'op' && last.s !== "'" && last.s !== ')');
      if (!continues) out.push({ k: 'sep', ...at });
      i++;
      line++;
      col = 1;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      col++;
      continue;
    }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === ';' || c === '；') {
      out.push({ k: 'sep', ...at });
      i++;
      col++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '||' || two === '&&') {
      out.push({ k: 'op', s: two === '||' ? '|' : '&', ...at });
      i += 2;
      col += 2;
      continue;
    }
    const single: Record<string, '|' | '^' | '&' | '!' | "'" | '(' | ')' | '='> = {
      '|': '|',
      '+': '|',
      '∨': '|',
      '^': '^',
      '⊕': '^',
      '&': '&',
      '*': '&',
      '·': '&',
      '•': '&',
      '∧': '&',
      '!': '!',
      '~': '!',
      '¬': '!',
      "'": "'",
      '’': "'",
      '′': "'",
      '(': '(',
      '（': '(',
      ')': ')',
      '）': ')',
      '=': '='
    };
    if (single[c]) {
      if (single[c] === '(') depth++;
      else if (single[c] === ')') depth = Math.max(0, depth - 1);
      out.push({ k: 'op', s: single[c], ...at });
      i++;
      col++;
      continue;
    }
    if (c === '0' || c === '1') {
      if (i + 1 < src.length && isId(src[i + 1]) && !/[01]/.test(src[i + 1])) throw new ExprError(`“${c}${src[i + 1]}”不是合法的名字`, line, col);
      out.push({ k: 'num', v: c === '1' ? 1 : 0, ...at });
      i++;
      col++;
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < src.length && isId(src[j])) j++;
      const s = src.slice(i, j);
      const w = WORD_OPS[s.toLowerCase()];
      if (w) out.push({ k: 'op', s: w, ...at });
      else out.push({ k: 'id', s, ...at });
      col += j - i;
      i = j;
      continue;
    }
    throw new ExprError(`不认识的符号“${c}”`, line, col);
  }
  out.push({ k: 'eof', line, col });
  return out;
}

const OP_NAME: Record<string, string> = { '|': '或', '^': '异或', '&': '与' };

export function parseEquations(src: string, defaultName = 'Y'): Equation[] {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const isOp = (t: Tok, s: string) => t.k === 'op' && t.s === s;

  const binary = (op: '|' | '^' | '&', sub: () => Expr): (() => Expr) => () => {
    const first = sub();
    const args = [first];
    while (isOp(peek(), op)) {
      next();
      args.push(sub());
    }
    if (args.length === 1) return first;
    const t = op === '|' ? 'or' : op === '^' ? 'xor' : 'and';
    // Flatten nested operators of the same kind: (A & B) & C = A & B & C.
    const flat: Expr[] = [];
    for (const a of args) if (a.t === t) flat.push(...(a as { args: Expr[] }).args);
    else flat.push(a);
    return { t, args: flat };
  };

  const primary = (): Expr => {
    const t = next();
    if (t.k === 'id') return { t: 'var', name: t.s };
    if (t.k === 'num') return { t: 'const', v: t.v };
    if (t.k === 'op' && t.s === '(') {
      const e = orExpr();
      const c = next();
      if (!isOp(c, ')')) throw new ExprError('缺少右括号“)”', c.line, c.col);
      return e;
    }
    if (t.k === 'op' && OP_NAME[t.s]) throw new ExprError(`“${OP_NAME[t.s]}”运算符前面缺少操作数`, t.line, t.col);
    if (t.k === 'eof' || t.k === 'sep') throw new ExprError('表达式不完整', t.line, t.col);
    throw new ExprError('这里需要一个变量、0、1 或括号', t.line, t.col);
  };
  const unary = (): Expr => {
    if (isOp(peek(), '!')) {
      next();
      return { t: 'not', a: unary() };
    }
    let e = primary();
    while (isOp(peek(), "'")) {
      next();
      e = { t: 'not', a: e };
    }
    return e;
  };
  const andExpr = binary('&', unary);
  const xorExpr = binary('^', andExpr);
  const orExpr: () => Expr = binary('|', xorExpr);

  const eqs: Equation[] = [];
  const names = new Set<string>();
  while (peek().k !== 'eof') {
    if (peek().k === 'sep') {
      next();
      continue;
    }
    let name = defaultName;
    const start = peek();
    if (start.k === 'id' && isOp(toks[pos + 1], '=')) {
      name = start.s;
      pos += 2;
    } else if (eqs.length > 0) {
      name = `${defaultName}${eqs.length + 1}`;
    }
    if (names.has(name)) throw new ExprError(`输出“${name}”定义了两次`, start.line, start.col);
    names.add(name);
    const expr = orExpr();
    const after = peek();
    if (after.k !== 'sep' && after.k !== 'eof') {
      if (after.k === 'id' || after.k === 'num' || isOp(after, '(') || isOp(after, '!'))
        throw new ExprError('两个操作数之间缺少运算符（例如 A & B）', after.line, after.col);
      if (isOp(after, ')')) throw new ExprError('多了一个右括号“)”', after.line, after.col);
      throw new ExprError('这里不应该出现这个符号', after.line, after.col);
    }
    eqs.push({ name, expr });
  }
  if (eqs.length === 0) throw new ExprError('请输入表达式，例如 Y = A & B', 1, 1);
  for (const eq of eqs) {
    for (const v of variables([eq])) {
      if (names.has(v)) throw new ExprError(`“${v}”既是输出又被当作输入使用；请换个名字`, 1, 1);
    }
  }
  return eqs;
}

/** Input variables in order of first appearance. */
export function variables(eqs: readonly Equation[]): string[] {
  const seen: string[] = [];
  const walk = (e: Expr) => {
    if (e.t === 'var') {
      if (!seen.includes(e.name)) seen.push(e.name);
    } else if (e.t === 'not') walk(e.a);
    else if (e.t !== 'const') e.args.forEach(walk);
  };
  eqs.forEach((q) => walk(q.expr));
  return seen;
}

export function evaluate(e: Expr, env: Record<string, 0 | 1>): 0 | 1 {
  switch (e.t) {
    case 'var':
      return env[e.name] ?? 0;
    case 'const':
      return e.v;
    case 'not':
      return (1 - evaluate(e.a, env)) as 0 | 1;
    case 'and':
      return e.args.every((a) => evaluate(a, env) === 1) ? 1 : 0;
    case 'or':
      return e.args.some((a) => evaluate(a, env) === 1) ? 1 : 0;
    case 'xor':
      return (e.args.reduce((s, a) => s ^ evaluate(a, env), 0) & 1) as 0 | 1;
  }
}

export function exprToText(e: Expr, parentPrec = 0): string {
  const prec = { or: 1, xor: 2, and: 3 } as const;
  switch (e.t) {
    case 'var':
      return e.name;
    case 'const':
      return String(e.v);
    case 'not':
      return '!' + exprToText(e.a, 4);
    default: {
      const p = prec[e.t];
      const sep = e.t === 'or' ? ' | ' : e.t === 'xor' ? ' ^ ' : ' & ';
      const s = e.args.map((a) => exprToText(a, p)).join(sep);
      return p < parentPrec ? `(${s})` : s;
    }
  }
}

// ---------------------------------------------------------------------------
// Synthesis

interface Node {
  key: string;
  kind: 'in' | 'const' | GateKind;
  args: Node[];
  name?: string;
  value?: 0 | 1;
  level: number;
  id?: string;
  y?: number;
  h?: number;
}

export interface SynthOptions {
  /** Largest gate fan-in to use; wider operations become trees. */
  maxFanIn?: number;
  /** Grid origin of the generated block. */
  x?: number;
  y?: number;
  idPrefix?: string;
  /** Existing input parts to reuse, by label (e.g. when regenerating inside a challenge). */
  reuseInputs?: Record<string, string>;
  reuseOutputs?: Record<string, string>;
  /** Order of the input pins (default: order of first appearance). Extra names become unused inputs. */
  inputOrder?: string[];
  circuitId?: string;
  circuitName?: string;
}

export interface SynthResult {
  circuit: Circuit;
  inputs: string[];
  outputs: string[];
  gateCount: number;
}

/** Build a circuit computing the given equations, with a left-to-right layered layout. */
export function synthesize(eqs: readonly Equation[], opts: SynthOptions = {}): SynthResult {
  const maxFan = Math.max(2, Math.min(8, opts.maxFanIn ?? 4));
  const nodes = new Map<string, Node>();
  const used0 = variables(eqs);
  const inputs = opts.inputOrder ? [...opts.inputOrder, ...used0.filter((v) => !opts.inputOrder!.includes(v))] : used0;
  const intern = (n: Omit<Node, 'level'>): Node => {
    const found = nodes.get(n.key);
    if (found) return found;
    const level = n.args.length ? 1 + Math.max(...n.args.map((a) => a.level)) : 0;
    const node: Node = { ...n, level };
    nodes.set(n.key, node);
    return node;
  };
  for (const name of inputs) intern({ key: `in:${name}`, kind: 'in', args: [], name });

  const gate = (kind: GateKind, args: Node[]): Node => {
    // Commutative: order arguments canonically for structural hashing.
    const sorted = kind === 'not' || kind === 'buf' ? args : [...args].sort((a, b) => (a.key < b.key ? -1 : 1));
    return intern({ key: `${kind}(${sorted.map((a) => a.key).join(',')})`, kind, args: sorted });
  };
  const wide = (kind: 'and' | 'or' | 'xor', args: Node[], negate: boolean): Node => {
    const uniq = kind === 'xor' ? args : [...new Map(args.map((a) => [a.key, a])).values()];
    if (uniq.length === 1) return negate ? gate('not', uniq) : uniq[0];
    let level = uniq;
    while (level.length > maxFan) {
      const nextLevel: Node[] = [];
      for (let i = 0; i < level.length; i += maxFan) {
        const chunk = level.slice(i, i + maxFan);
        nextLevel.push(chunk.length === 1 ? chunk[0] : gate(kind, chunk));
      }
      level = nextLevel;
    }
    const neg: Record<string, GateKind> = { and: 'nand', or: 'nor', xor: 'xnor' };
    return gate(negate ? neg[kind] : kind, level);
  };
  const build = (e: Expr, negate = false): Node => {
    switch (e.t) {
      case 'var': {
        const n = nodes.get(`in:${e.name}`)!;
        return negate ? gate('not', [n]) : n;
      }
      case 'const': {
        const v = (negate ? 1 - e.v : e.v) as 0 | 1;
        return intern({ key: `const:${v}`, kind: 'const', args: [], value: v });
      }
      case 'not':
        return build(e.a, !negate);
      default:
        return wide(e.t, e.args.map((a) => build(a)), negate);
    }
  };
  const roots = eqs.map((q) => ({ name: q.name, node: build(q.expr) }));

  // Keep only nodes reachable from outputs (plus every input, so the interface is complete).
  const used = new Set<Node>();
  const mark = (n: Node) => {
    if (used.has(n)) return;
    used.add(n);
    n.args.forEach(mark);
  };
  roots.forEach((r) => mark(r.node));
  const all = [...nodes.values()].filter((n) => used.has(n) || n.kind === 'in');

  const maxLevel = Math.max(0, ...all.map((n) => n.level));
  const columns: Node[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const n of all) columns[n.level].push(n);

  const ox = opts.x ?? 0;
  const oy = opts.y ?? 0;
  const b = new CircuitBuilder(opts.circuitId ?? 'synth', opts.circuitName ?? '综合电路', { prefix: opts.idPrefix ?? 'g' });
  const colX = (level: number) => ox + (level === 0 ? 0 : 4 + (level - 1) * 8 + 2);

  // Inputs: stacked in order of appearance; constants below them.
  let yCursor = oy;
  for (const n of columns[0]) {
    if (n.kind !== 'in') continue;
    n.h = 2;
    n.y = yCursor;
    yCursor += 4;
  }
  for (let level = 1; level <= maxLevel; level++) {
    const col = columns[level];
    const center = (n: Node) => {
      const ys = n.args.filter((a) => a.y !== undefined).map((a) => a.y! + (a.h ?? 2) / 2);
      return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : oy;
    };
    col.sort((a, b2) => center(a) - center(b2));
    let free = oy;
    for (const n of col) {
      const h = n.kind === 'not' || n.kind === 'buf' ? 2 : 2 * n.args.length;
      n.h = h;
      const want = Math.round(center(n) - h / 2);
      n.y = Math.max(free, want);
      free = n.y + h + 2;
    }
  }
  // Constants live in column 0 after the inputs.
  for (const n of all) {
    if (n.kind === 'in') {
      n.id = opts.reuseInputs?.[n.name!] ?? b.add('in', colX(0), n.y!, { label: n.name });
    } else if (n.kind === 'const') {
      n.id = b.add('const', 0, 0, { value: n.value });
    } else {
      // Order a gate's inputs top to bottom to avoid crossings.
      n.args.sort((p, q) => (p.y ?? 0) + (p.h ?? 2) / 2 - ((q.y ?? 0) + (q.h ?? 2) / 2));
      n.id = b.add(n.kind, colX(n.level), n.y!, n.kind === 'not' || n.kind === 'buf' ? {} : { n: n.args.length });
    }
  }
  // Place constants just left of their consumer, away from other parts.
  for (const n of all) {
    if (n.kind !== 'const') continue;
    const consumers = all.filter((m) => m.args.includes(n));
    const part = b.parts.find((p) => p.id === n.id)!;
    if (consumers.length) {
      const c = consumers[0];
      const k = c.args.indexOf(n);
      const pinY = c.kind === 'not' || c.kind === 'buf' ? 1 : 1 + 2 * Math.max(0, k);
      part.y = (c.y ?? 0) + pinY - 1;
      part.x = colX(c.level) - 3;
    } else {
      part.x = colX(0);
      part.y = yCursor;
      yCursor += 4;
    }
  }
  for (const n of all) {
    n.args.forEach((a, i) => {
      if (a.id && n.id) b.wire(a.id, n.kind === 'not' || n.kind === 'buf' ? `${n.id}.i0` : `${n.id}.i${i}`);
    });
  }
  const outX = colX(maxLevel) + (maxLevel === 0 ? 6 : 8);
  let outY = oy;
  for (const r of roots) {
    const y = Math.max(outY, Math.round((r.node.y ?? 0) + (r.node.h ?? 2) / 2 - 1));
    const id = opts.reuseOutputs?.[r.name] ?? b.add('out', outX, y, { label: r.name });
    outY = y + 4;
    b.wire(r.node.id!, `${id}.i`);
  }
  const circuit = b.build();
  const gateCount = circuit.parts.filter((p) => p.kind !== 'in' && p.kind !== 'out' && p.kind !== 'const').length;
  return { circuit, inputs, outputs: roots.map((r) => r.name), gateCount };
}

/** Bounding box of a set of parts in grid units. */
export function boundsOf(parts: readonly Part[]): { x: number; y: number; w: number; h: number } {
  if (parts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of parts) {
    const s = partSpec(p);
    const w = p.rot % 2 ? s.h : s.w;
    const h = p.rot % 2 ? s.w : s.h;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + w);
    y1 = Math.max(y1, p.y + h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export type { Wire };
