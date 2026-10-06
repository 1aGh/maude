/**
 * @file       annotations/fractional-index.ts — z-order keys (DDR-242 §1)
 * @scope      apps/studio/annotations/fractional-index.ts
 * @purpose    Fractional indexing: a key strictly between any two keys, so a
 *             reorder writes ONE element instead of renumbering its neighbours,
 *             and two peers reordering concurrently converge.
 *
 *             Port of the algorithm in rocicorp/fractional-indexing
 *             (https://github.com/rocicorp/fractional-indexing, CC0-1.0 — public
 *             domain; kept in-tree so the hub, a DDR-054 "untrusted to peers"
 *             component with a frozen lockfile, takes no new dependency).
 *
 *             Two peers inserting between the same two keys produce the SAME
 *             key — order is therefore always `(index, id)` (`compareOrder`),
 *             never index alone.
 */

export const BASE_62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = '0';
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

function midpoint(a: string, b: string | null): string {
  if (b != null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.slice(-1) === ZERO || (b && b.slice(-1) === ZERO)) throw new Error('trailing zero');
  if (b) {
    let n = 0;
    while ((a[n] || ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? BASE_62_DIGITS.indexOf(a[0] as string) : 0;
  const digitB = b != null ? BASE_62_DIGITS.indexOf(b[0] as string) : BASE_62_DIGITS.length;
  if (digitB - digitA > 1) {
    return BASE_62_DIGITS[Math.round(0.5 * (digitA + digitB))] as string;
  }
  if (b && b.length > 1) return b.slice(0, 1);
  return (BASE_62_DIGITS[digitA] as string) + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const len = integerLength(key[0] as string);
  if (len > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, len);
}

/** True when `key` is a well-formed order key (used to validate untrusted input). */
export function isValidOrderKey(key: string): boolean {
  try {
    if (key === SMALLEST_INTEGER) return false;
    if (!/^[0-9A-Za-z]+$/.test(key)) return false;
    const i = integerPart(key);
    return key.slice(i.length).slice(-1) !== ZERO;
  } catch {
    return false;
  }
}

function assertKey(key: string): void {
  if (!isValidOrderKey(key)) throw new Error(`invalid order key: ${key}`);
}

function incrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('') as [string, ...string[]];
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = BASE_62_DIGITS.indexOf(digs[i] as string) + 1;
    if (d === BASE_62_DIGITS.length) digs[i] = ZERO;
    else {
      digs[i] = BASE_62_DIGITS[d] as string;
      carry = false;
    }
  }
  if (!carry) return head + digs.join('');
  if (head === 'Z') return `a${ZERO}`;
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digs.push(ZERO);
  else digs.pop();
  return h + digs.join('');
}

function decrementInteger(x: string): string | null {
  const [head, ...digs] = x.split('') as [string, ...string[]];
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = BASE_62_DIGITS.indexOf(digs[i] as string) - 1;
    if (d === -1) digs[i] = BASE_62_DIGITS.slice(-1);
    else {
      digs[i] = BASE_62_DIGITS[d] as string;
      borrow = false;
    }
  }
  if (!borrow) return head + digs.join('');
  if (head === 'a') return `Z${BASE_62_DIGITS.slice(-1)}`;
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digs.push(BASE_62_DIGITS.slice(-1));
  else digs.pop();
  return h + digs.join('');
}

/** A key strictly between `a` and `b` (null = open end). Throws if `a >= b`. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a != null) assertKey(a);
  if (b != null) assertKey(b);
  if (a != null && b != null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a == null) {
    if (b == null) return `a${ZERO}`;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res == null) throw new Error('cannot decrement any more');
    return res;
  }
  if (b == null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia);
    return i == null ? ia + midpoint(fa, null) : i;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i == null) throw new Error('cannot increment any more');
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

/** `n` ascending keys strictly between `a` and `b`, evenly spread. */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  if (b == null) {
    let c = keyBetween(a, b);
    const out = [c];
    for (let i = 0; i < n - 1; i++) {
      c = keyBetween(c, b);
      out.push(c);
    }
    return out;
  }
  if (a == null) {
    let c = keyBetween(a, b);
    const out = [c];
    for (let i = 0; i < n - 1; i++) {
      c = keyBetween(a, c);
      out.push(c);
    }
    return out.reverse();
  }
  const mid = Math.floor(n / 2);
  const c = keyBetween(a, b);
  return [...keysBetween(a, c, mid), c, ...keysBetween(c, b, n - mid - 1)];
}

/** Total paint order: index (code-unit order), ties broken by id. */
export function compareOrder(
  a: { index: string; id: string },
  b: { index: string; id: string }
): number {
  if (a.index !== b.index) return a.index < b.index ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Keys for `ids` (desired order) that reuse `prev` keys where they are already
 * in order (longest increasing run), minting new keys only for moved items.
 */
export function orderKeys(
  ids: readonly string[],
  prev: ReadonlyMap<string, string>
): Map<string, string> {
  const out = new Map<string, string>();
  // Longest increasing subsequence over the items that have a previous key.
  const cand = ids
    .map((id, i) => ({ id, i, k: prev.get(id) }))
    .filter((c) => c.k !== undefined) as Array<{ id: string; i: number; k: string }>;
  const tails: number[] = [];
  const back: number[] = new Array(cand.length).fill(-1);
  for (let j = 0; j < cand.length; j++) {
    const k = (cand[j] as { k: string }).k;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cand[tails[mid] as number] as { k: string }).k < k) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) back[j] = tails[lo - 1] as number;
    tails[lo] = j;
  }
  const keep = new Set<string>();
  for (
    let j = tails.length ? (tails[tails.length - 1] as number) : -1;
    j >= 0;
    j = back[j] as number
  ) {
    keep.add((cand[j] as { id: string }).id);
  }
  for (const id of keep) out.set(id, prev.get(id) as string);
  // Fill the gaps between kept keys.
  let i = 0;
  while (i < ids.length) {
    if (keep.has(ids[i] as string)) {
      i++;
      continue;
    }
    let j = i;
    while (j < ids.length && !keep.has(ids[j] as string)) j++;
    const lo = i > 0 ? (out.get(ids[i - 1] as string) ?? null) : null;
    const hi = j < ids.length ? (out.get(ids[j] as string) ?? null) : null;
    let keys: string[];
    try {
      keys = keysBetween(lo, hi, j - i);
    } catch {
      // Degenerate neighbours — renumber the whole sibling list.
      const all = keysBetween(null, null, ids.length);
      return new Map(ids.map((id, n) => [id, all[n] as string]));
    }
    for (let n = i; n < j; n++) out.set(ids[n] as string, keys[n - i] as string);
    i = j;
  }
  return out;
}
