// Two-level logic minimisation (Quine–McCluskey) with an exact minimum cover found by
// branch and bound, falling back to a greedy cover when there are too many candidates.
//
// Bit convention: with n variables, variable 0 is the most significant bit of a
// minterm index (so the first input is the leftmost column of the truth table).

export interface Implicant {
  /** Values of the bits that are not eliminated. */
  value: number;
  /** Bits set here are eliminated ("don't care" positions of the cube). */
  mask: number;
}

export interface Literal {
  v: number;
  neg: boolean;
}

export function covers(imp: Implicant, m: number): boolean {
  return (m & ~imp.mask) === imp.value;
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

export function literalCount(imp: Implicant, n: number): number {
  return n - popcount(imp.mask);
}

export function primeImplicants(n: number, minterms: readonly number[], dontcares: readonly number[] = []): Implicant[] {
  let current = new Map<string, Implicant>();
  for (const m of [...minterms, ...dontcares]) current.set(`${m}|0`, { value: m, mask: 0 });
  const primes: Implicant[] = [];
  const full = (1 << n) - 1;
  while (current.size > 0) {
    const items = [...current.values()];
    const combined = new Set<string>();
    const next = new Map<string, Implicant>();
    // Bucket by mask and by number of ones, so we only compare neighbours.
    const buckets = new Map<string, Implicant[]>();
    for (const it of items) {
      const key = `${it.mask}|${popcount(it.value)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(it);
    }
    for (const it of items) {
      const higher = buckets.get(`${it.mask}|${popcount(it.value) + 1}`);
      if (!higher) continue;
      for (const other of higher) {
        const diff = it.value ^ other.value;
        if (diff & (diff - 1)) continue; // more than one bit differs
        if ((diff & it.mask) !== 0 || (diff & full) === 0) continue;
        const merged = { value: it.value & ~diff, mask: it.mask | diff };
        next.set(`${merged.value}|${merged.mask}`, merged);
        combined.add(`${it.value}|${it.mask}`);
        combined.add(`${other.value}|${other.mask}`);
      }
    }
    for (const it of items) if (!combined.has(`${it.value}|${it.mask}`)) primes.push(it);
    current = next;
  }
  return primes;
}

const EXACT_LIMIT = 40;

/** Minimum sum-of-products cover of `minterms` (don't-cares may be used but need not be covered). */
export function minimize(n: number, minterms: readonly number[], dontcares: readonly number[] = []): Implicant[] {
  if (minterms.length === 0) return [];
  const primes = primeImplicants(n, minterms, dontcares).filter((p) => minterms.some((m) => covers(p, m)));
  const chosen: Implicant[] = [];
  let uncovered = new Set(minterms);

  // Essential prime implicants.
  for (const m of minterms) {
    const cov = primes.filter((p) => covers(p, m));
    if (cov.length === 1 && !chosen.includes(cov[0])) chosen.push(cov[0]);
  }
  for (const p of chosen) for (const m of [...uncovered]) if (covers(p, m)) uncovered.delete(m);
  if (uncovered.size === 0) return sortImplicants(chosen, n);

  let rest = primes.filter((p) => !chosen.includes(p) && [...uncovered].some((m) => covers(p, m)));
  // Drop primes dominated by a cheaper-or-equal prime that covers a superset of what's left.
  rest = rest.filter(
    (p, i) =>
      !rest.some((q, j) => {
        if (i === j) return false;
        const pc = [...uncovered].filter((m) => covers(p, m));
        if (!pc.every((m) => covers(q, m))) return false;
        const qc = [...uncovered].filter((m) => covers(q, m)).length;
        const lp = literalCount(p, n);
        const lq = literalCount(q, n);
        // q dominates p (covers at least as much, no more literals); ties broken by index.
        return lq <= lp && (qc > pc.length || lq < lp || j < i);
      })
  );

  const cost = (list: Implicant[]) => list.length * 1000 + list.reduce((s, p) => s + literalCount(p, n), 0);

  if (rest.length <= EXACT_LIMIT) {
    let best: Implicant[] | null = null;
    let bestCost = Infinity;
    const search = (left: Set<number>, picked: Implicant[]) => {
      if (left.size === 0) {
        const c = cost(picked);
        if (c < bestCost) {
          bestCost = c;
          best = [...picked];
        }
        return;
      }
      if ((picked.length + 1) * 1000 >= bestCost) return;
      // Branch on the minterm with the fewest options.
      let pivot = -1;
      let options: Implicant[] = [];
      for (const m of left) {
        const opts = rest.filter((p) => covers(p, m));
        if (pivot < 0 || opts.length < options.length) {
          pivot = m;
          options = opts;
        }
      }
      for (const p of options) {
        const nl = new Set([...left].filter((m) => !covers(p, m)));
        picked.push(p);
        search(nl, picked);
        picked.pop();
      }
    };
    search(uncovered, []);
    if (best) return sortImplicants([...chosen, ...(best as Implicant[])], n);
  }

  // Greedy: repeatedly take the prime covering the most uncovered minterms.
  while (uncovered.size > 0) {
    let bestP = rest[0];
    let bestN = -1;
    for (const p of rest) {
      const k = [...uncovered].filter((m) => covers(p, m)).length;
      if (k > bestN || (k === bestN && literalCount(p, n) < literalCount(bestP, n))) {
        bestN = k;
        bestP = p;
      }
    }
    chosen.push(bestP);
    uncovered = new Set([...uncovered].filter((m) => !covers(bestP, m)));
  }
  return sortImplicants(chosen, n);
}

function sortImplicants(list: Implicant[], n: number): Implicant[] {
  const key = (p: Implicant) => {
    // Order like a textbook: by first variable used, positive before negative.
    let s = '';
    for (let i = 0; i < n; i++) {
      const bit = 1 << (n - 1 - i);
      s += p.mask & bit ? '2' : p.value & bit ? '0' : '1';
    }
    return s;
  };
  return [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export function literals(imp: Implicant, n: number): Literal[] {
  const out: Literal[] = [];
  for (let i = 0; i < n; i++) {
    const bit = 1 << (n - 1 - i);
    if (imp.mask & bit) continue;
    out.push({ v: i, neg: (imp.value & bit) === 0 });
  }
  return out;
}

/** Sum of products in the syntax accepted by the expression parser, e.g. "A & !B | C". */
export function sopToText(imps: readonly Implicant[], n: number, names: readonly string[]): string {
  if (imps.length === 0) return '0';
  if (imps.some((p) => literalCount(p, n) === 0)) return '1';
  return imps
    .map((p) => {
      return literals(p, n)
        .map((l) => (l.neg ? '!' : '') + names[l.v])
        .join(' & ');
    })
    .join(' | ');
}

/**
 * Product of sums: minimise the complement and apply De Morgan's law. Each returned
 * implicant is a sum term in which every literal is complemented.
 */
export function minimizePOS(n: number, minterms: readonly number[], dontcares: readonly number[] = []): Implicant[] {
  const ones = new Set(minterms);
  const dc = new Set(dontcares);
  const zeros: number[] = [];
  for (let m = 0; m < 1 << n; m++) if (!ones.has(m) && !dc.has(m)) zeros.push(m);
  return minimize(n, zeros, dontcares);
}

export function posToText(imps: readonly Implicant[], n: number, names: readonly string[]): string {
  if (imps.length === 0) return '1';
  if (imps.some((p) => literalCount(p, n) === 0)) return '0';
  return imps
    .map((p) => {
      const lits = literals(p, n).map((l) => (l.neg ? '' : '!') + names[l.v]);
      return lits.length > 1 && imps.length > 1 ? `(${lits.join(' | ')})` : lits.join(' | ');
    })
    .join(' & ');
}
