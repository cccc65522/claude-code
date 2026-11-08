// Built-in functions.
//
// Each entry declares its parameters with a compact signature, e.g. 'n n?' or 'v r n b?':
//   n number   s text   b logical   v any value (errors propagate)   e any value incl. errors
//   r raw: ranges/arrays passed through   R must be a cell reference
//   suffix ? optional, + one or more (last only), * zero or more (last only)
// The evaluator coerces arguments before calling fn(args, ctx); coercion failures
// and thrown FormulaErrors become the cell's error value.
//
// Lazy functions (IF, IFERROR, CHOOSE, ...) get unevaluated nodes instead:
//   fn(nodes, ev, ctx, arrayMode) where ev(node) evaluates one argument.

import {
  ERR, FormulaError, ArrayValue, isError, isMatrix, MISSING,
  toNumber, toText, textToNumber, compareValues, valuesEqual
} from './values.js';
import { RangeMatrix, toScalar } from './range.js';
import { dateToSerial, serialToParts, daysInMonth, parseDateText, timeToSerial } from './dates.js';
import { formatValue } from './format.js';
import { tokenize } from './lexer.js';
import { MAX_ROWS, MAX_COLS } from './address.js';

export const FUNCTIONS = Object.create(null);

function def(name, signature, fn, category, syntax, desc, extra = {}) {
  const params = [];
  let min = 0;
  let max = 0;
  for (const tok of signature.split(/\s+/).filter(Boolean)) {
    const type = tok[0];
    const mod = tok[1];
    params.push(type);
    if (mod === '+') { min++; max = Infinity; }
    else if (mod === '*') { max = Infinity; }
    else if (mod === '?') { max++; }
    else { min++; max++; }
  }
  FUNCTIONS[name] = { name, params, min, max, fn, category, syntax, desc, ...extra };
}
const alias = (name, target) => { FUNCTIONS[name] = { ...FUNCTIONS[target], name }; };

// ---------- helpers ----------

function forEachArgValue(args, fn) {
  for (const a of args) {
    if (a === undefined) continue;
    if (isMatrix(a)) a.forEachValue(v => fn(v, true));
    else fn(a, false);
  }
}

// Excel's aggregate rule: inside ranges only real numbers count; direct arguments
// are coerced (TRUE -> 1, "3" -> 3, "abc" -> #VALUE!). Errors always propagate.
function numbers(args) {
  const out = [];
  forEachArgValue(args, (v, inRange) => {
    if (isError(v)) throw v;
    if (typeof v === 'number') out.push(v);
    else if (!inRange && v !== null && v !== MISSING) out.push(toNumber(v));
  });
  return out;
}

function flatValues(m) {
  if (!isMatrix(m)) return [m];
  const out = [];
  m.forEach(v => out.push(v));
  return out;
}

function shiftDecimal(n, d) {
  const [m, e = '0'] = String(n).split('e');
  return Number(`${m}e${Number(e) + d}`);
}
// Decimal-correct rounding: ROUND(2.675, 2) is 2.68 like Excel, not 2.67.
function roundWith(x, digits, mode) {
  const d = Math.trunc(digits);
  const sign = x < 0 ? -1 : 1;
  const abs = Number(Math.abs(x).toPrecision(15));
  const shifted = shiftDecimal(abs, d);
  const r = mode === 'up' ? Math.ceil(shifted) : mode === 'down' ? Math.floor(shifted) : Math.round(shifted);
  return sign * shiftDecimal(r, -d) || 0;
}
const clean = x => Number(x.toPrecision(15));

function wildcardRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '~' && i + 1 < pattern.length && '*?~'.includes(pattern[i + 1])) {
      re += '\\' + pattern[++i];
    } else if (ch === '*') re += '[\\s\\S]*';
    else if (ch === '?') re += '[\\s\\S]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}
const hasWildcard = s => /[*?]/.test(s);

// COUNTIF-style criteria: 5, ">5", "<>apple", "a*", "", "<>", ">=2026-01-01".
export function makeCriteria(crit) {
  if (isError(crit)) throw crit;
  if (typeof crit === 'number') {
    return v => (typeof v === 'number' ? v === crit : typeof v === 'string' && textToNumber(v) === crit);
  }
  if (typeof crit === 'boolean') return v => v === crit;
  if (crit === null) return v => v === null || v === '';
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(crit);
  const op = m[1] || '=';
  const rest = m[2];
  if (rest === '') {
    if (op === '=') return v => v === null || v === '';
    if (op === '<>') return v => v !== null && v !== '';
    return () => false;
  }
  let num = textToNumber(rest);
  if (num === null) {
    const d = parseDateText(rest);
    if (d) num = d.serial;
  }
  const upper = rest.toUpperCase();
  if (num === null && (upper === 'TRUE' || upper === 'FALSE')) {
    const b = upper === 'TRUE';
    return op === '=' ? v => v === b : op === '<>' ? v => v !== b : () => false;
  }
  if (num !== null) {
    const cmp = {
      '=': v => v === num, '<>': v => v !== num, '<': v => v < num,
      '>': v => v > num, '<=': v => v <= num, '>=': v => v >= num
    }[op];
    return v => {
      if (typeof v === 'number') return cmp(v);
      if (op === '=' && typeof v === 'string') return textToNumber(v) === num;
      return op === '<>';
    };
  }
  if (op === '=' || op === '<>') {
    const re = wildcardRegex(rest);
    const test = v => typeof v === 'string' && re.test(v);
    return op === '=' ? test : v => !test(v);
  }
  return v => {
    if (typeof v !== 'string') return false;
    const c = compareValues(v, rest);
    return op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
  };
}

function asMatrix(v) {
  if (isMatrix(v)) return v;
  return new ArrayValue([[v]]);
}

// The cell of `target` that lines up with position (i, j) of `shapeOf`, Excel-style:
// SUMIF's sum_range is resized to the criteria range from its top-left corner.
function aligned(target, i, j) {
  if (target instanceof RangeMatrix) {
    return target.source.getValue(target.sheetId, target.r1 + i, target.c1 + j);
  }
  return target.get(i, j);
}

function conditionalCells(range, criteria, extra = []) {
  const R = asMatrix(range);
  const tests = [[R, makeCriteria(toScalar(criteria))]];
  for (let k = 0; k < extra.length; k += 2) {
    const M = asMatrix(extra[k]);
    if (M.rows !== R.rows || M.cols !== R.cols) throw ERR.VALUE;
    tests.push([M, makeCriteria(toScalar(extra[k + 1]))]);
  }
  const hits = [];
  // When the first criterion can't match blanks, only non-blank cells need visiting.
  const blankMatches = tests[0][1](null);
  const visit = (i, j) => {
    for (const [M, t] of tests) if (!t(M.get(i, j))) return;
    hits.push([i, j]);
  };
  if (blankMatches) R.forEach((_, i, j) => visit(i, j));
  else R.forEachValue((_, i, j) => visit(i, j));
  return hits;
}

function lookupEquals(x) {
  if (typeof x === 'string' && hasWildcard(x)) {
    const re = wildcardRegex(x);
    return v => typeof v === 'string' && re.test(v);
  }
  return v => v !== null && !isError(v) && valuesEqual(v, x);
}
const sameKind = (a, b) => typeof a === typeof b;

// Approximate match over sorted data: index of the last item <= x (ascending)
// or the last item >= x (descending), ignoring items of a different type.
function approxIndex(list, x, descending = false) {
  let found = -1;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v === null || isError(v) || !sameKind(v, x)) continue;
    const c = compareValues(v, x);
    if (c === 0) found = i;
    else if (descending ? c > 0 : c < 0) found = i;
    else break;
  }
  return found;
}

function vector(m) {
  const M = asMatrix(m);
  if (M.rows !== 1 && M.cols !== 1) return null;
  const out = [];
  if (M.rows === 1) for (let j = 0; j < M.cols; j++) out.push(M.get(0, j));
  else for (let i = 0; i < M.rows; i++) out.push(M.get(i, 0));
  return out;
}

function toSerial(v) {
  if (typeof v === 'string') {
    const d = parseDateText(v);
    if (d) return d.serial;
  }
  const n = toNumber(v);
  if (n < 0) throw ERR.NUM;
  return n;
}

function scalarOf(v, ctx) {
  const s = toScalar(v, ctx);
  return s === MISSING ? null : s;
}

function truthy(v) {
  if (isError(v)) throw v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null) return false;
  if (typeof v === 'string') {
    const u = v.toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
  }
  throw ERR.VALUE;
}

function logicalValues(args) {
  const out = [];
  forEachArgValue(args, (v, inRange) => {
    if (isError(v)) throw v;
    if (typeof v === 'boolean') out.push(v);
    else if (typeof v === 'number') out.push(v !== 0);
    else if (!inRange && v !== null && v !== MISSING) out.push(truthy(v));
  });
  if (!out.length) throw ERR.VALUE;
  return out;
}

// ---------- math ----------

def('SUM', 'r+', args => numbers(args).reduce((a, b) => a + b, 0), '数学', 'SUM(数值1, [数值2], …)', '求和');
def('PRODUCT', 'r+', args => {
  const ns = numbers(args);
  return ns.length ? ns.reduce((a, b) => a * b, 1) : 0;
}, '数学', 'PRODUCT(数值1, [数值2], …)', '所有数值相乘');
def('SUMSQ', 'r+', args => numbers(args).reduce((a, b) => a + b * b, 0), '数学', 'SUMSQ(数值1, …)', '平方和');
def('SUMPRODUCT', 'r+', args => {
  const ms = args.map(asMatrix);
  const { rows, cols } = ms[0];
  if (ms.some(m => m.rows !== rows || m.cols !== cols)) throw ERR.VALUE;
  let total = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let p = 1;
      for (const m of ms) {
        const v = m.get(i, j);
        if (isError(v)) throw v;
        p *= typeof v === 'number' ? v : 0;
      }
      total += p;
    }
  }
  return total;
}, '数学', 'SUMPRODUCT(数组1, [数组2], …)', '对应元素相乘后求和；参数里可以写条件，如 (A1:A9>5)*B1:B9', { arrayArgs: true });

def('ABS', 'n', ([x]) => Math.abs(x), '数学', 'ABS(数值)', '绝对值');
def('SIGN', 'n', ([x]) => Math.sign(x), '数学', 'SIGN(数值)', '正数返回 1，负数返回 -1，零返回 0');
def('ROUND', 'n n', ([x, d]) => roundWith(x, d, 'half'), '数学', 'ROUND(数值, 小数位数)', '四舍五入');
def('ROUNDUP', 'n n', ([x, d]) => roundWith(x, d, 'up'), '数学', 'ROUNDUP(数值, 小数位数)', '远离零方向舍入');
def('ROUNDDOWN', 'n n', ([x, d]) => roundWith(x, d, 'down'), '数学', 'ROUNDDOWN(数值, 小数位数)', '向零方向舍去');
def('TRUNC', 'n n?', ([x, d = 0]) => roundWith(x, d, 'down'), '数学', 'TRUNC(数值, [小数位数])', '截去小数部分');
def('INT', 'n', ([x]) => Math.floor(x), '数学', 'INT(数值)', '向下取整');
def('MOD', 'n n', ([x, y]) => {
  if (y === 0) throw ERR.DIV0;
  return clean(x - y * Math.floor(x / y));
}, '数学', 'MOD(被除数, 除数)', '余数，符号与除数相同');
def('QUOTIENT', 'n n', ([x, y]) => {
  if (y === 0) throw ERR.DIV0;
  return Math.trunc(x / y);
}, '数学', 'QUOTIENT(被除数, 除数)', '整数商');
def('POWER', 'n n', ([x, y]) => {
  if (x === 0 && y === 0) throw ERR.NUM;
  if (x === 0 && y < 0) throw ERR.DIV0;
  return x ** y;
}, '数学', 'POWER(底数, 指数)', '乘幂');
def('SQRT', 'n', ([x]) => { if (x < 0) throw ERR.NUM; return Math.sqrt(x); }, '数学', 'SQRT(数值)', '平方根');
def('EXP', 'n', ([x]) => Math.exp(x), '数学', 'EXP(数值)', 'e 的乘幂');
def('LN', 'n', ([x]) => { if (x <= 0) throw ERR.NUM; return Math.log(x); }, '数学', 'LN(数值)', '自然对数');
def('LOG10', 'n', ([x]) => { if (x <= 0) throw ERR.NUM; return Math.log10(x); }, '数学', 'LOG10(数值)', '以 10 为底的对数');
def('LOG', 'n n?', ([x, b = 10]) => {
  if (x <= 0 || b <= 0) throw ERR.NUM;
  if (b === 1) throw ERR.DIV0;
  return clean(Math.log(x) / Math.log(b));
}, '数学', 'LOG(数值, [底数])', '对数，底数默认 10');
def('PI', '', () => Math.PI, '数学', 'PI()', '圆周率');
def('SIN', 'n', ([x]) => Math.sin(x), '数学', 'SIN(弧度)', '正弦');
def('COS', 'n', ([x]) => Math.cos(x), '数学', 'COS(弧度)', '余弦');
def('TAN', 'n', ([x]) => Math.tan(x), '数学', 'TAN(弧度)', '正切');
def('ASIN', 'n', ([x]) => { if (Math.abs(x) > 1) throw ERR.NUM; return Math.asin(x); }, '数学', 'ASIN(数值)', '反正弦');
def('ACOS', 'n', ([x]) => { if (Math.abs(x) > 1) throw ERR.NUM; return Math.acos(x); }, '数学', 'ACOS(数值)', '反余弦');
def('ATAN', 'n', ([x]) => Math.atan(x), '数学', 'ATAN(数值)', '反正切');
def('ATAN2', 'n n', ([x, y]) => { if (x === 0 && y === 0) throw ERR.DIV0; return Math.atan2(y, x); }, '数学', 'ATAN2(x, y)', '坐标的反正切');
def('RADIANS', 'n', ([x]) => x * Math.PI / 180, '数学', 'RADIANS(角度)', '角度转弧度');
def('DEGREES', 'n', ([x]) => x * 180 / Math.PI, '数学', 'DEGREES(弧度)', '弧度转角度');
def('CEILING', 'n n?', ([x, s = 1]) => {
  if (s === 0) return 0;
  if (x > 0 && s < 0) throw ERR.NUM;
  return clean(Math.ceil(clean(x / s)) * s);
}, '数学', 'CEILING(数值, [基数])', '向上舍入到基数的倍数');
def('FLOOR', 'n n?', ([x, s = 1]) => {
  if (s === 0) throw ERR.DIV0;
  if (x > 0 && s < 0) throw ERR.NUM;
  return clean(Math.floor(clean(x / s)) * s);
}, '数学', 'FLOOR(数值, [基数])', '向下舍入到基数的倍数');
def('MROUND', 'n n', ([x, m]) => {
  if (m === 0) return 0;
  if (Math.sign(x) * Math.sign(m) < 0) throw ERR.NUM;
  return clean(roundWith(x / m, 0, 'half') * m);
}, '数学', 'MROUND(数值, 倍数)', '舍入到最接近的倍数');
def('EVEN', 'n', ([x]) => { const r = Math.ceil(Math.abs(x) / 2) * 2; return x < 0 ? -r : r; }, '数学', 'EVEN(数值)', '向上舍入到偶数');
def('ODD', 'n', ([x]) => {
  let r = Math.ceil(Math.abs(x));
  if (r % 2 === 0) r += 1;
  return x < 0 ? -r : r;
}, '数学', 'ODD(数值)', '向上舍入到奇数');
def('FACT', 'n', ([x]) => {
  if (x < 0) throw ERR.NUM;
  let r = 1;
  for (let i = 2; i <= Math.floor(x); i++) r *= i;
  return r;
}, '数学', 'FACT(数值)', '阶乘');
def('COMBIN', 'n n', ([n, k]) => {
  n = Math.trunc(n); k = Math.trunc(k);
  if (n < 0 || k < 0 || k > n) throw ERR.NUM;
  let r = 1;
  for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
  return Math.round(r);
}, '数学', 'COMBIN(总数, 选取数)', '组合数');
const gcd2 = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
def('GCD', 'r+', args => {
  const ns = numbers(args).map(Math.trunc);
  if (ns.some(n => n < 0)) throw ERR.NUM;
  return ns.reduce(gcd2, 0);
}, '数学', 'GCD(数值1, …)', '最大公约数');
def('LCM', 'r+', args => {
  const ns = numbers(args).map(Math.trunc);
  if (ns.some(n => n < 0)) throw ERR.NUM;
  return ns.reduce((a, b) => (a === 0 || b === 0 ? 0 : (a / gcd2(a, b)) * b), 1);
}, '数学', 'LCM(数值1, …)', '最小公倍数');
def('RAND', '', (_, ctx) => ctx.random(), '数学', 'RAND()', '0 到 1 之间的随机数，每次重算都会变', { volatile: true });
def('RANDBETWEEN', 'n n', ([lo, hi], ctx) => {
  lo = Math.ceil(lo); hi = Math.floor(hi);
  if (lo > hi) throw ERR.NUM;
  return lo + Math.floor(ctx.random() * (hi - lo + 1));
}, '数学', 'RANDBETWEEN(最小值, 最大值)', '指定范围内的随机整数', { volatile: true });

def('SUMIF', 'r v r?', ([range, crit, sumRange]) => {
  const target = sumRange === undefined ? asMatrix(range) : asMatrix(sumRange);
  let total = 0;
  for (const [i, j] of conditionalCells(range, crit)) {
    const v = aligned(target, i, j);
    if (isError(v)) throw v;
    if (typeof v === 'number') total += v;
  }
  return total;
}, '数学', 'SUMIF(条件区域, 条件, [求和区域])', '按条件求和，条件可写 ">5"、"苹果"、"张*"');
def('SUMIFS', 'r r v r* ', ([sumRange, range, crit, ...rest]) => {
  if (rest.length % 2) throw ERR.VALUE;
  const S = asMatrix(sumRange), R = asMatrix(range);
  if (S.rows !== R.rows || S.cols !== R.cols) throw ERR.VALUE;
  let total = 0;
  for (const [i, j] of conditionalCells(range, crit, rest)) {
    const v = S.get(i, j);
    if (isError(v)) throw v;
    if (typeof v === 'number') total += v;
  }
  return total;
}, '数学', 'SUMIFS(求和区域, 条件区域1, 条件1, …)', '多条件求和');

// ---------- statistics ----------

const mean = ns => {
  if (!ns.length) throw ERR.DIV0;
  return ns.reduce((a, b) => a + b, 0) / ns.length;
};
function variance(ns, sample) {
  const n = ns.length;
  if (n < (sample ? 2 : 1)) throw ERR.DIV0;
  const m = mean(ns);
  return ns.reduce((a, x) => a + (x - m) ** 2, 0) / (sample ? n - 1 : n);
}
const sorted = ns => ns.slice().sort((a, b) => a - b);
function percentileInc(ns, k) {
  if (!ns.length || k < 0 || k > 1) throw ERR.NUM;
  const s = sorted(ns);
  const pos = k * (s.length - 1);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return lo + 1 < s.length ? s[lo] + frac * (s[lo + 1] - s[lo]) : s[lo];
}

def('AVERAGE', 'r+', args => mean(numbers(args)), '统计', 'AVERAGE(数值1, [数值2], …)', '平均值');
def('MAX', 'r+', args => { const ns = numbers(args); return ns.length ? Math.max(...ns) : 0; }, '统计', 'MAX(数值1, …)', '最大值');
def('MIN', 'r+', args => { const ns = numbers(args); return ns.length ? Math.min(...ns) : 0; }, '统计', 'MIN(数值1, …)', '最小值');
def('COUNT', 'r+', args => {
  let n = 0;
  forEachArgValue(args, (v, inRange) => {
    if (typeof v === 'number') n++;
    else if (!inRange && (typeof v === 'boolean' || (typeof v === 'string' && textToNumber(v) !== null))) n++;
  });
  return n;
}, '统计', 'COUNT(值1, …)', '数字的个数');
def('COUNTA', 'r+', args => {
  let n = 0;
  forEachArgValue(args, v => { if (v !== null && v !== MISSING) n++; });
  return n;
}, '统计', 'COUNTA(值1, …)', '非空单元格的个数');
def('COUNTBLANK', 'r', ([r]) => {
  const M = asMatrix(r);
  let n = 0;
  M.forEach(v => { if (v === null || v === '') n++; });
  return n;
}, '统计', 'COUNTBLANK(区域)', '空单元格的个数');
def('COUNTIF', 'r v', ([range, crit]) => conditionalCells(range, crit).length, '统计', 'COUNTIF(区域, 条件)', '满足条件的单元格个数');
def('COUNTIFS', 'r v r*', ([range, crit, ...rest]) => {
  if (rest.length % 2) throw ERR.VALUE;
  return conditionalCells(range, crit, rest).length;
}, '统计', 'COUNTIFS(区域1, 条件1, [区域2, 条件2], …)', '同时满足多个条件的个数');
def('AVERAGEIF', 'r v r?', ([range, crit, avgRange]) => {
  const target = avgRange === undefined ? asMatrix(range) : asMatrix(avgRange);
  const ns = [];
  for (const [i, j] of conditionalCells(range, crit)) {
    const v = aligned(target, i, j);
    if (isError(v)) throw v;
    if (typeof v === 'number') ns.push(v);
  }
  return mean(ns);
}, '统计', 'AVERAGEIF(条件区域, 条件, [求平均区域])', '按条件求平均');
function ifsNumbers([target, range, crit, ...rest]) {
  if (rest.length % 2) throw ERR.VALUE;
  const T = asMatrix(target), R = asMatrix(range);
  if (T.rows !== R.rows || T.cols !== R.cols) throw ERR.VALUE;
  const ns = [];
  for (const [i, j] of conditionalCells(range, crit, rest)) {
    const v = T.get(i, j);
    if (isError(v)) throw v;
    if (typeof v === 'number') ns.push(v);
  }
  return ns;
}
def('AVERAGEIFS', 'r r v r*', args => mean(ifsNumbers(args)), '统计', 'AVERAGEIFS(求平均区域, 条件区域1, 条件1, …)', '多条件求平均');
def('MAXIFS', 'r r v r*', args => { const ns = ifsNumbers(args); return ns.length ? Math.max(...ns) : 0; }, '统计', 'MAXIFS(最大值区域, 条件区域1, 条件1, …)', '多条件最大值');
def('MINIFS', 'r r v r*', args => { const ns = ifsNumbers(args); return ns.length ? Math.min(...ns) : 0; }, '统计', 'MINIFS(最小值区域, 条件区域1, 条件1, …)', '多条件最小值');
def('MEDIAN', 'r+', args => {
  const s = sorted(numbers(args));
  if (!s.length) throw ERR.NUM;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}, '统计', 'MEDIAN(数值1, …)', '中位数');
def('MODE', 'r+', args => {
  const ns = numbers(args);
  const counts = new Map();
  let best = null, bestCount = 1;
  for (const n of ns) {
    const c = (counts.get(n) || 0) + 1;
    counts.set(n, c);
    if (c > bestCount) { best = n; bestCount = c; }
  }
  if (best === null) throw ERR.NA;
  return best;
}, '统计', 'MODE(数值1, …)', '出现次数最多的数');
alias('MODE.SNGL', 'MODE');
def('STDEV', 'r+', args => Math.sqrt(variance(numbers(args), true)), '统计', 'STDEV(数值1, …)', '样本标准差');
def('STDEVP', 'r+', args => Math.sqrt(variance(numbers(args), false)), '统计', 'STDEVP(数值1, …)', '总体标准差');
def('VAR', 'r+', args => variance(numbers(args), true), '统计', 'VAR(数值1, …)', '样本方差');
def('VARP', 'r+', args => variance(numbers(args), false), '统计', 'VARP(数值1, …)', '总体方差');
alias('STDEV.S', 'STDEV'); alias('STDEV.P', 'STDEVP'); alias('VAR.S', 'VAR'); alias('VAR.P', 'VARP');
def('LARGE', 'r n', ([r, k]) => {
  const s = sorted(numbers([r]));
  k = Math.ceil(k);
  if (k < 1 || k > s.length) throw ERR.NUM;
  return s[s.length - k];
}, '统计', 'LARGE(区域, k)', '第 k 大的数');
def('SMALL', 'r n', ([r, k]) => {
  const s = sorted(numbers([r]));
  k = Math.ceil(k);
  if (k < 1 || k > s.length) throw ERR.NUM;
  return s[k - 1];
}, '统计', 'SMALL(区域, k)', '第 k 小的数');
def('RANK', 'n r n?', ([x, r, order = 0]) => {
  const ns = numbers([r]);
  if (!ns.includes(x)) throw ERR.NA;
  return 1 + ns.filter(n => (order ? n < x : n > x)).length;
}, '统计', 'RANK(数值, 区域, [升序])', '排名，第三个参数非 0 时按升序');
alias('RANK.EQ', 'RANK');
def('PERCENTILE', 'r n', ([r, k]) => percentileInc(numbers([r]), k), '统计', 'PERCENTILE(区域, k)', '第 k 百分位数（k 在 0 到 1 之间）');
alias('PERCENTILE.INC', 'PERCENTILE');
def('QUARTILE', 'r n', ([r, q]) => {
  q = Math.trunc(q);
  if (q < 0 || q > 4) throw ERR.NUM;
  return percentileInc(numbers([r]), q / 4);
}, '统计', 'QUARTILE(区域, 四分位)', '四分位数（0 到 4）');
alias('QUARTILE.INC', 'QUARTILE');
def('CORREL', 'r r', ([a, b]) => {
  const A = flatValues(a), B = flatValues(b);
  if (A.length !== B.length) throw ERR.NA;
  const xs = [], ys = [];
  A.forEach((x, i) => {
    if (isError(x)) throw x;
    if (isError(B[i])) throw B[i];
    if (typeof x === 'number' && typeof B[i] === 'number') { xs.push(x); ys.push(B[i]); }
  });
  if (xs.length < 2) throw ERR.DIV0;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  if (sxx === 0 || syy === 0) throw ERR.DIV0;
  return sxy / Math.sqrt(sxx * syy);
}, '统计', 'CORREL(区域1, 区域2)', '相关系数');

// ---------- logical ----------

def('IF', 'v v? v?', (nodes, ev, ctx, arrayMode) => {
  const cond = ev(nodes[0]);
  const branch = (n, fallback) => {
    if (!n) return fallback;
    const v = ev(n);
    return v === MISSING ? 0 : v;
  };
  if (arrayMode && isMatrix(cond)) {
    const yes = branch(nodes[1], true), no = branch(nodes[2], false);
    const pick = (M, i, j) => (isMatrix(M) ? M.get(M.rows === 1 ? 0 : i, M.cols === 1 ? 0 : j) : M);
    const data = [];
    for (let i = 0; i < cond.rows; i++) {
      const row = [];
      for (let j = 0; j < cond.cols; j++) {
        const c = cond.get(i, j);
        try { row.push(truthy(c) ? pick(yes, i, j) : pick(no, i, j)); } catch (e) { row.push(e); }
      }
      data.push(row);
    }
    return new ArrayValue(data);
  }
  const c = scalarOf(cond, ctx);
  if (isError(c)) return c;
  return truthy(c) ? branch(nodes[1], true) : branch(nodes[2], false);
}, '逻辑', 'IF(条件, 成立时, [不成立时])', '条件判断', { lazy: true });
def('IFS', 'v v v*', (nodes, ev, ctx) => {
  if (nodes.length % 2) return ERR.VALUE;
  for (let i = 0; i < nodes.length; i += 2) {
    const c = scalarOf(ev(nodes[i]), ctx);
    if (isError(c)) return c;
    if (truthy(c)) return ev(nodes[i + 1]);
  }
  return ERR.NA;
}, '逻辑', 'IFS(条件1, 值1, [条件2, 值2], …)', '返回第一个成立条件对应的值', { lazy: true });
def('IFERROR', 'v v', (nodes, ev, ctx, arrayMode) => {
  const v = ev(nodes[0]);
  if (arrayMode && isMatrix(v)) {
    const alt = ev(nodes[1]);
    const data = v.toArray().map(row => row.map(x => (isError(x) ? (isMatrix(alt) ? alt.get(0, 0) : alt) : x)));
    return new ArrayValue(data);
  }
  const s = scalarOf(v, ctx);
  if (isError(s)) { const alt = ev(nodes[1]); return alt === MISSING ? 0 : alt; }
  return s;
}, '逻辑', 'IFERROR(值, 出错时的值)', '出错时返回指定的值', { lazy: true });
def('IFNA', 'v v', (nodes, ev, ctx) => {
  const s = scalarOf(ev(nodes[0]), ctx);
  if (s === ERR.NA) { const alt = ev(nodes[1]); return alt === MISSING ? 0 : alt; }
  return s;
}, '逻辑', 'IFNA(值, 为 #N/A 时的值)', '值为 #N/A 时返回指定的值', { lazy: true });
def('SWITCH', 'v v v v*', (nodes, ev, ctx) => {
  const x = scalarOf(ev(nodes[0]), ctx);
  if (isError(x)) return x;
  let i = 1;
  for (; i + 1 < nodes.length; i += 2) {
    const c = scalarOf(ev(nodes[i]), ctx);
    if (isError(c)) return c;
    if (valuesEqual(x, c) && typeof x === typeof c) return ev(nodes[i + 1]);
  }
  return i < nodes.length ? ev(nodes[i]) : ERR.NA;
}, '逻辑', 'SWITCH(表达式, 值1, 结果1, …, [默认])', '按值匹配返回结果', { lazy: true });
def('CHOOSE', 'n v v*', (nodes, ev, ctx) => {
  const k = scalarOf(ev(nodes[0]), ctx);
  if (isError(k)) return k;
  const i = Math.trunc(toNumber(k));
  if (i < 1 || i >= nodes.length) return ERR.VALUE;
  const v = ev(nodes[i]);
  return v === MISSING ? 0 : v;
}, '逻辑', 'CHOOSE(序号, 值1, [值2], …)', '按序号从列表中选择', { lazy: true });
def('AND', 'r+', args => logicalValues(args).every(Boolean), '逻辑', 'AND(条件1, …)', '全部成立时为 TRUE');
def('OR', 'r+', args => logicalValues(args).some(Boolean), '逻辑', 'OR(条件1, …)', '任一成立时为 TRUE');
def('XOR', 'r+', args => logicalValues(args).filter(Boolean).length % 2 === 1, '逻辑', 'XOR(条件1, …)', '成立的个数为奇数时为 TRUE');
def('NOT', 'v', ([v]) => !truthy(v), '逻辑', 'NOT(条件)', '取反');
def('TRUE', '', () => true, '逻辑', 'TRUE()', '逻辑值 TRUE');
def('FALSE', '', () => false, '逻辑', 'FALSE()', '逻辑值 FALSE');

// ---------- text ----------

def('LEN', 's', ([s]) => s.length, '文本', 'LEN(文本)', '字符个数');
def('LEFT', 's n?', ([s, n = 1]) => { if (n < 0) throw ERR.VALUE; return s.slice(0, Math.trunc(n)); }, '文本', 'LEFT(文本, [字符数])', '从左边取字符');
def('RIGHT', 's n?', ([s, n = 1]) => { if (n < 0) throw ERR.VALUE; n = Math.trunc(n); return n === 0 ? '' : s.slice(-n); }, '文本', 'RIGHT(文本, [字符数])', '从右边取字符');
def('MID', 's n n', ([s, start, n]) => {
  if (start < 1 || n < 0) throw ERR.VALUE;
  return s.substr(Math.trunc(start) - 1, Math.trunc(n));
}, '文本', 'MID(文本, 开始位置, 字符数)', '从中间取字符');
def('LOWER', 's', ([s]) => s.toLowerCase(), '文本', 'LOWER(文本)', '转小写');
def('UPPER', 's', ([s]) => s.toUpperCase(), '文本', 'UPPER(文本)', '转大写');
def('PROPER', 's', ([s]) => s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, p, c) => p + c.toUpperCase()), '文本', 'PROPER(文本)', '每个单词首字母大写');
def('TRIM', 's', ([s]) => s.replace(/ +/g, ' ').trim(), '文本', 'TRIM(文本)', '去掉首尾空格，中间连续空格保留一个');
def('CLEAN', 's', ([s]) => s.replace(/[\x00-\x1f]/g, ''), '文本', 'CLEAN(文本)', '去掉不可打印字符');
def('SUBSTITUTE', 's s s n?', ([s, from, to, nth]) => {
  if (from === '') return s;
  if (nth === undefined) return s.split(from).join(to);
  nth = Math.trunc(nth);
  if (nth < 1) throw ERR.VALUE;
  let idx = -1;
  for (let k = 0; k < nth; k++) {
    idx = s.indexOf(from, idx + 1);
    if (idx < 0) return s;
  }
  return s.slice(0, idx) + to + s.slice(idx + from.length);
}, '文本', 'SUBSTITUTE(文本, 旧文本, 新文本, [第几处])', '替换文字');
def('REPLACE', 's n n s', ([s, start, n, to]) => {
  if (start < 1 || n < 0) throw ERR.VALUE;
  start = Math.trunc(start) - 1;
  return s.slice(0, start) + to + s.slice(start + Math.trunc(n));
}, '文本', 'REPLACE(文本, 开始位置, 字符数, 新文本)', '按位置替换');
def('FIND', 's s n?', ([needle, hay, start = 1]) => {
  if (start < 1 || start > hay.length + 1) throw ERR.VALUE;
  const i = hay.indexOf(needle, Math.trunc(start) - 1);
  if (i < 0) throw ERR.VALUE;
  return i + 1;
}, '文本', 'FIND(要找的文本, 所在文本, [开始位置])', '查找位置（区分大小写）');
def('SEARCH', 's s n?', ([needle, hay, start = 1]) => {
  if (start < 1 || start > hay.length + 1) throw ERR.VALUE;
  const from = Math.trunc(start) - 1;
  if (needle === '') return from + 1;
  const src = wildcardRegex(needle).source.slice(1, -1);
  const m = new RegExp(src, 'i').exec(hay.slice(from));
  if (!m) throw ERR.VALUE;
  return from + m.index + 1;
}, '文本', 'SEARCH(要找的文本, 所在文本, [开始位置])', '查找位置（不区分大小写，可用通配符）');
def('REPT', 's n', ([s, n]) => {
  if (n < 0 || s.length * n > 32767) throw ERR.VALUE;
  return s.repeat(Math.trunc(n));
}, '文本', 'REPT(文本, 次数)', '重复文本');
def('CONCATENATE', 's+', args => args.join(''), '文本', 'CONCATENATE(文本1, …)', '连接文本');
def('CONCAT', 'r+', args => {
  let out = '';
  for (const a of args) {
    if (isMatrix(a)) a.forEach(v => { if (isError(v)) throw v; out += toText(v); });
    else { if (isError(a)) throw a; out += toText(a === MISSING ? null : a); }
  }
  return out;
}, '文本', 'CONCAT(文本或区域1, …)', '连接文本，可以直接传区域');
def('TEXTJOIN', 's b r+', ([sep, ignoreEmpty, ...rest]) => {
  const parts = [];
  for (const a of rest) {
    for (const v of flatValues(a)) {
      if (isError(v)) throw v;
      const t = toText(v === MISSING ? null : v);
      if (ignoreEmpty && t === '') continue;
      parts.push(t);
    }
  }
  return parts.join(sep);
}, '文本', 'TEXTJOIN(分隔符, 忽略空白, 文本1, …)', '用分隔符连接文本');
def('TEXT', 'v s', ([v, fmt]) => {
  if (typeof v === 'string') {
    const n = textToNumber(v) ?? parseDateText(v)?.serial ?? null;
    if (n === null) return formatValue(v, fmt).text;
    v = n;
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return formatValue(v ?? 0, fmt, { precision: 15 }).text;
}, '文本', 'TEXT(值, 格式)', '按格式把数字变成文字，如 TEXT(A1,"0.00")、TEXT(A1,"yyyy-mm-dd")');
def('VALUE', 'v', ([v]) => {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  const s = toText(v).trim();
  const n = textToNumber(s.replace(/^[¥￥$]/, ''));
  if (n !== null) return n;
  const d = parseDateText(s);
  if (d) return d.serial;
  throw ERR.VALUE;
}, '文本', 'VALUE(文本)', '文字转数字');
def('EXACT', 's s', ([a, b]) => a === b, '文本', 'EXACT(文本1, 文本2)', '完全相同（区分大小写）');
def('CHAR', 'n', ([n]) => { if (n < 1 || n > 255) throw ERR.VALUE; return String.fromCharCode(n); }, '文本', 'CHAR(编码)', '编码对应的字符');
def('CODE', 's', ([s]) => { if (!s) throw ERR.VALUE; return s.charCodeAt(0); }, '文本', 'CODE(文本)', '第一个字符的编码');
def('UNICHAR', 'n', ([n]) => { if (n < 1 || n > 0x10ffff) throw ERR.VALUE; return String.fromCodePoint(n); }, '文本', 'UNICHAR(编码)', 'Unicode 编码对应的字符');
def('UNICODE', 's', ([s]) => { if (!s) throw ERR.VALUE; return s.codePointAt(0); }, '文本', 'UNICODE(文本)', '第一个字符的 Unicode 编码');
function nthIndex(s, delim, n) {
  if (n === 0 || delim === '') throw ERR.VALUE;
  if (n > 0) {
    let i = -1;
    for (let k = 0; k < n; k++) { i = s.indexOf(delim, i + 1); if (i < 0) return -1; }
    return i;
  }
  let i = s.length;
  for (let k = 0; k < -n; k++) { i = s.lastIndexOf(delim, i - 1); if (i < 0) return -1; }
  return i;
}
def('TEXTBEFORE', 's s n?', ([s, d, n = 1]) => {
  const i = nthIndex(s, d, Math.trunc(n));
  if (i < 0) throw ERR.NA;
  return s.slice(0, i);
}, '文本', 'TEXTBEFORE(文本, 分隔符, [第几个])', '分隔符之前的文本');
def('TEXTAFTER', 's s n?', ([s, d, n = 1]) => {
  const i = nthIndex(s, d, Math.trunc(n));
  if (i < 0) throw ERR.NA;
  return s.slice(i + d.length);
}, '文本', 'TEXTAFTER(文本, 分隔符, [第几个])', '分隔符之后的文本');

// ---------- lookup & reference ----------

def('VLOOKUP', 'v r n b?', ([x, table, col, approx = true]) => {
  const T = asMatrix(table);
  col = Math.trunc(col);
  if (col < 1) throw ERR.VALUE;
  if (col > T.cols) throw ERR.REF;
  const keys = [];
  for (let i = 0; i < T.rows; i++) keys.push(T.get(i, 0));
  let row;
  if (approx) row = approxIndex(keys, x);
  else { const eq = lookupEquals(x); row = keys.findIndex(eq); }
  if (row < 0) throw ERR.NA;
  return T.get(row, col - 1);
}, '查找', 'VLOOKUP(查找值, 表格区域, 列序号, [近似匹配])', '在表格第一列查找，返回同一行指定列的值；精确查找第四个参数写 FALSE 或 0');
def('HLOOKUP', 'v r n b?', ([x, table, row, approx = true]) => {
  const T = asMatrix(table);
  row = Math.trunc(row);
  if (row < 1) throw ERR.VALUE;
  if (row > T.rows) throw ERR.REF;
  const keys = [];
  for (let j = 0; j < T.cols; j++) keys.push(T.get(0, j));
  let col;
  if (approx) col = approxIndex(keys, x);
  else col = keys.findIndex(lookupEquals(x));
  if (col < 0) throw ERR.NA;
  return T.get(row - 1, col);
}, '查找', 'HLOOKUP(查找值, 表格区域, 行序号, [近似匹配])', '在表格第一行查找');
def('MATCH', 'v r n?', ([x, arr, type = 1]) => {
  const list = vector(arr);
  if (!list) throw ERR.NA;
  let i;
  if (type === 0) i = list.findIndex(lookupEquals(x));
  else i = approxIndex(list, x, type < 0);
  if (i < 0) throw ERR.NA;
  return i + 1;
}, '查找', 'MATCH(查找值, 区域, [匹配方式])', '返回位置；匹配方式 0 为精确');
def('INDEX', 'r n? n?', ([ref, row, col]) => {
  const M = asMatrix(ref);
  let r = row === undefined ? 0 : Math.trunc(row);
  let c = col === undefined ? 0 : Math.trunc(col);
  if (col === undefined && row !== undefined && M.rows === 1 && M.cols > 1) { c = r; r = 1; }
  if (col === undefined && row !== undefined && M.cols === 1) c = 1;
  if (r < 0 || c < 0 || r > M.rows || c > M.cols) throw ERR.REF;
  if (r > 0 && c > 0) return M.get(r - 1, c - 1);
  if (M instanceof RangeMatrix) {
    if (r === 0 && c === 0) return M;
    return r === 0 ? M.sub(0, c - 1, M.rows, 1) : M.sub(r - 1, 0, 1, M.cols);
  }
  const data = M.toArray();
  if (r === 0 && c === 0) return M;
  return new ArrayValue(r === 0 ? data.map(rw => [rw[c - 1]]) : [data[r - 1]]);
}, '查找', 'INDEX(区域, 行号, [列号])', '返回区域中指定行列的值');
def('XLOOKUP', 'v r r v? n? n?', ([x, look, ret, notFound, mode = 0, search = 1]) => {
  const list = vector(look);
  if (!list) throw ERR.VALUE;
  const L = asMatrix(look), R = asMatrix(ret);
  const vertical = L.cols === 1 && L.rows > 1 || (L.rows === 1 && L.cols === 1 && R.rows >= 1 && R.cols === 1);
  if (vertical ? R.rows !== L.rows : R.cols !== L.cols) throw ERR.VALUE;
  const order = [...list.keys()];
  if (search < 0) order.reverse();
  let hit = -1;
  const eq = mode === 2 ? lookupEquals(x) : (v => v !== null && !isError(v) && sameKind(v, x) && valuesEqual(v, x));
  for (const i of order) if (eq(list[i])) { hit = i; break; }
  if (hit < 0 && (mode === -1 || mode === 1)) {
    let best = -1;
    for (const i of order) {
      const v = list[i];
      if (v === null || isError(v) || !sameKind(v, x)) continue;
      const c = compareValues(v, x);
      if (mode === -1 ? c < 0 : c > 0) {
        if (best < 0 || (mode === -1 ? compareValues(v, list[best]) > 0 : compareValues(v, list[best]) < 0)) best = i;
      }
    }
    hit = best;
  }
  if (hit < 0) {
    if (notFound !== undefined && notFound !== null) return notFound;
    throw ERR.NA;
  }
  if (R instanceof RangeMatrix) {
    const sub = vertical ? R.sub(hit, 0, 1, R.cols) : R.sub(0, hit, R.rows, 1);
    return sub.rows === 1 && sub.cols === 1 ? sub.get(0, 0) : sub;
  }
  return vertical ? R.get(hit, 0) : R.get(0, hit);
}, '查找', 'XLOOKUP(查找值, 查找区域, 返回区域, [找不到时], [匹配方式], [搜索方向])', '新版查找：默认精确匹配，可以向左查');
def('LOOKUP', 'v r r?', ([x, look, ret]) => {
  const list = vector(look);
  if (!list) throw ERR.NA;
  const i = approxIndex(list, x);
  if (i < 0) throw ERR.NA;
  if (ret === undefined) return list[i];
  const out = vector(ret);
  if (!out || i >= out.length) throw ERR.NA;
  return out[i];
}, '查找', 'LOOKUP(查找值, 查找区域, [结果区域])', '在有序区域中近似查找');
def('ROW', 'R?', ([ref], ctx) => (ref ? ref.r1 + 1 : ctx.row + 1), '查找', 'ROW([引用])', '行号');
def('COLUMN', 'R?', ([ref], ctx) => (ref ? ref.c1 + 1 : ctx.col + 1), '查找', 'COLUMN([引用])', '列号');
def('ROWS', 'r', ([r]) => asMatrix(r).rows, '查找', 'ROWS(区域)', '区域的行数');
def('COLUMNS', 'r', ([r]) => asMatrix(r).cols, '查找', 'COLUMNS(区域)', '区域的列数');
def('TRANSPOSE', 'r', ([r]) => {
  const M = asMatrix(r);
  const data = [];
  for (let j = 0; j < M.cols; j++) {
    const row = [];
    for (let i = 0; i < M.rows; i++) row.push(M.get(i, j));
    data.push(row);
  }
  return new ArrayValue(data);
}, '查找', 'TRANSPOSE(区域)', '行列互换（配合 SUMPRODUCT、INDEX 使用）');
def('OFFSET', 'R n n n? n?', ([ref, dr, dc, h, w]) => {
  const r1 = ref.r1 + Math.trunc(dr), c1 = ref.c1 + Math.trunc(dc);
  const rows = h === undefined ? ref.rows : Math.trunc(h);
  const cols = w === undefined ? ref.cols : Math.trunc(w);
  if (rows < 1 || cols < 1) throw ERR.REF;
  if (r1 < 0 || c1 < 0 || r1 + rows > MAX_ROWS || c1 + cols > MAX_COLS) throw ERR.REF;
  return new RangeMatrix(ref.source, ref.sheetId, r1, c1, r1 + rows - 1, c1 + cols - 1);
}, '查找', 'OFFSET(起点, 下移行数, 右移列数, [高度], [宽度])', '从起点偏移得到新的区域', { volatile: true });
def('INDIRECT', 's b?', ([text], ctx) => {
  let toks;
  try { toks = tokenize(text.trim()); } catch { throw ERR.REF; }
  if (toks.length !== 2 || (toks[0].type !== 'ref' && toks[0].type !== 'range')) throw ERR.REF;
  const t = toks[0];
  const sheetId = t.sheet === null ? ctx.sheetId : ctx.resolveSheet(t.sheet);
  if (sheetId === null) throw ERR.REF;
  if (t.type === 'ref') return new RangeMatrix(ctx.source, sheetId, t.row, t.col, t.row, t.col);
  return new RangeMatrix(ctx.source, sheetId,
    Math.min(t.start.row, t.end.row), Math.min(t.start.col, t.end.col),
    Math.max(t.start.row, t.end.row), Math.max(t.start.col, t.end.col), t.kind !== 'cells');
}, '查找', 'INDIRECT(引用文字)', '把文字（如 "Sheet2!A1"）当作引用', { volatile: true });

// ---------- date & time ----------

def('DATE', 'n n n', ([y, m, d]) => {
  const s = dateToSerial(Math.trunc(y), Math.trunc(m), Math.trunc(d));
  if (s < 0 || y > 9999) throw ERR.NUM;
  return s;
}, '日期', 'DATE(年, 月, 日)', '组成日期');
def('TIME', 'n n n', ([h, m, s]) => {
  const t = timeToSerial(Math.trunc(h), Math.trunc(m), Math.trunc(s));
  if (t < 0) throw ERR.NUM;
  return t - Math.floor(t);
}, '日期', 'TIME(时, 分, 秒)', '组成时间');
def('TODAY', '', (_, ctx) => Math.floor(ctx.now()), '日期', 'TODAY()', '今天的日期', { volatile: true });
def('NOW', '', (_, ctx) => ctx.now(), '日期', 'NOW()', '现在的日期和时间', { volatile: true });
def('YEAR', 'v', ([v]) => serialToParts(toSerial(v)).year, '日期', 'YEAR(日期)', '年份');
def('MONTH', 'v', ([v]) => serialToParts(toSerial(v)).month, '日期', 'MONTH(日期)', '月份');
def('DAY', 'v', ([v]) => serialToParts(toSerial(v)).day, '日期', 'DAY(日期)', '日');
def('HOUR', 'v', ([v]) => serialToParts(toSerial(v)).hour, '日期', 'HOUR(时间)', '小时');
def('MINUTE', 'v', ([v]) => serialToParts(toSerial(v)).minute, '日期', 'MINUTE(时间)', '分钟');
def('SECOND', 'v', ([v]) => serialToParts(toSerial(v)).second, '日期', 'SECOND(时间)', '秒');
def('WEEKDAY', 'v n?', ([v, type = 1]) => {
  const w = serialToParts(toSerial(v)).weekday; // 0 = Sunday
  if (type === 1) return w + 1;
  if (type === 2) return ((w + 6) % 7) + 1;
  if (type === 3) return (w + 6) % 7;
  throw ERR.NUM;
}, '日期', 'WEEKDAY(日期, [类型])', '星期几；类型 2 表示周一为 1');
def('WEEKNUM', 'v n?', ([v, type = 1]) => {
  const s = Math.floor(toSerial(v));
  const p = serialToParts(s);
  const jan1 = dateToSerial(p.year, 1, 1);
  const startDow = type === 2 ? 1 : 0;
  const jan1Dow = serialToParts(jan1).weekday;
  const offset = (jan1Dow - startDow + 7) % 7;
  return Math.floor((s - jan1 + offset) / 7) + 1;
}, '日期', 'WEEKNUM(日期, [类型])', '一年中的第几周');
def('DATEVALUE', 's', ([s]) => {
  const d = parseDateText(s);
  if (!d) throw ERR.VALUE;
  return Math.floor(d.serial);
}, '日期', 'DATEVALUE(日期文字)', '日期文字转日期');
function addMonths(serial, months) {
  const p = serialToParts(serial);
  const total = p.year * 12 + (p.month - 1) + Math.trunc(months);
  const y = Math.floor(total / 12), m = (total % 12) + 1;
  return { y, m, d: p.day };
}
def('EDATE', 'v n', ([v, n]) => {
  const { y, m, d } = addMonths(toSerial(v), n);
  return dateToSerial(y, m, Math.min(d, daysInMonth(y, m)));
}, '日期', 'EDATE(开始日期, 月数)', '几个月之后的同一天');
def('EOMONTH', 'v n', ([v, n]) => {
  const { y, m } = addMonths(toSerial(v), n);
  return dateToSerial(y, m, daysInMonth(y, m));
}, '日期', 'EOMONTH(开始日期, 月数)', '几个月之后的月末');
def('DAYS', 'v v', ([end, start]) => Math.floor(toSerial(end)) - Math.floor(toSerial(start)), '日期', 'DAYS(结束日期, 开始日期)', '相差天数');
def('DATEDIF', 'v v s', ([a, b, unit]) => {
  const s = Math.floor(toSerial(a)), e = Math.floor(toSerial(b));
  if (s > e) throw ERR.NUM;
  const p = serialToParts(s), q = serialToParts(e);
  let months = (q.year - p.year) * 12 + (q.month - p.month);
  if (q.day < p.day) months--;
  switch (unit.toUpperCase()) {
    case 'D': return e - s;
    case 'M': return months;
    case 'Y': return Math.floor(months / 12);
    case 'YM': return months % 12;
    case 'MD': {
      if (q.day >= p.day) return q.day - p.day;
      const prevMonthDays = daysInMonth(q.month === 1 ? q.year - 1 : q.year, q.month === 1 ? 12 : q.month - 1);
      return prevMonthDays - p.day + q.day;
    }
    case 'YD': {
      let anchor = dateToSerial(q.year, p.month, Math.min(p.day, daysInMonth(q.year, p.month)));
      if (anchor > e) anchor = dateToSerial(q.year - 1, p.month, Math.min(p.day, daysInMonth(q.year - 1, p.month)));
      return e - anchor;
    }
  }
  throw ERR.NUM;
}, '日期', 'DATEDIF(开始日期, 结束日期, 单位)', '两个日期的间隔；单位 "Y" 年、"M" 月、"D" 天、"YM"、"MD"、"YD"');
function holidaySet(h) {
  const set = new Set();
  if (h === undefined || h === null) return set;
  for (const v of flatValues(h)) {
    if (isError(v)) throw v;
    if (typeof v === 'number') set.add(Math.floor(v));
  }
  return set;
}
const isWeekend = s => { const w = serialToParts(s).weekday; return w === 0 || w === 6; };
def('NETWORKDAYS', 'v v r?', ([a, b, h]) => {
  let s = Math.floor(toSerial(a)), e = Math.floor(toSerial(b));
  const sign = s <= e ? 1 : -1;
  if (sign < 0) [s, e] = [e, s];
  const hol = holidaySet(h);
  let n = 0;
  for (let d = s; d <= e; d++) if (!isWeekend(d) && !hol.has(d)) n++;
  return n * sign;
}, '日期', 'NETWORKDAYS(开始日期, 结束日期, [假日])', '工作日天数（不含周六日和假日）');
def('WORKDAY', 'v n r?', ([a, days, h]) => {
  let d = Math.floor(toSerial(a));
  const hol = holidaySet(h);
  let left = Math.trunc(days);
  const step = left >= 0 ? 1 : -1;
  while (left !== 0) {
    d += step;
    if (!isWeekend(d) && !hol.has(d)) left -= step;
  }
  return d;
}, '日期', 'WORKDAY(开始日期, 工作日数, [假日])', '若干个工作日之后的日期');

// ---------- information ----------

def('ISBLANK', 'e', ([v]) => v === null, '信息', 'ISBLANK(值)', '是否为空单元格');
def('ISNUMBER', 'e', ([v]) => typeof v === 'number', '信息', 'ISNUMBER(值)', '是否为数字');
def('ISTEXT', 'e', ([v]) => typeof v === 'string', '信息', 'ISTEXT(值)', '是否为文本');
def('ISNONTEXT', 'e', ([v]) => typeof v !== 'string', '信息', 'ISNONTEXT(值)', '是否不是文本');
def('ISLOGICAL', 'e', ([v]) => typeof v === 'boolean', '信息', 'ISLOGICAL(值)', '是否为逻辑值');
def('ISERROR', 'e', ([v]) => isError(v), '信息', 'ISERROR(值)', '是否为错误值');
def('ISERR', 'e', ([v]) => isError(v) && v !== ERR.NA, '信息', 'ISERR(值)', '是否为 #N/A 以外的错误值');
def('ISNA', 'e', ([v]) => v === ERR.NA, '信息', 'ISNA(值)', '是否为 #N/A');
def('ISEVEN', 'n', ([n]) => Math.trunc(n) % 2 === 0, '信息', 'ISEVEN(数值)', '是否为偶数');
def('ISODD', 'n', ([n]) => Math.abs(Math.trunc(n)) % 2 === 1, '信息', 'ISODD(数值)', '是否为奇数');
def('NA', '', () => ERR.NA, '信息', 'NA()', '返回 #N/A');
def('N', 'e', ([v]) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : isError(v) ? v : 0), '信息', 'N(值)', '转成数字，文字为 0');
def('T', 'e', ([v]) => (typeof v === 'string' ? v : isError(v) ? v : ''), '信息', 'T(值)', '是文本就返回文本，否则返回空');
def('ERROR.TYPE', 'e', ([v]) => {
  if (!isError(v)) throw ERR.NA;
  return ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'].indexOf(v.code) + 1 || 8;
}, '信息', 'ERROR.TYPE(错误值)', '错误值对应的编号');

export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();
export { FormulaError };
