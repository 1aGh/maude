// index/match.ts — the ONE matcher every search uses (V2-2.17, contract V2-1.17 §5.7): the panel
// search, ⌘K and the marks. Pure; imported by the server and the client bundle.
//
//   fold(s)  NFD, strip combining marks, lower-case — "Trenéři" and "treneri" are the same word.
//   query    folded words; EVERY word must match, in any order.
//   per word contained in `name` → 3 (+1 when it starts a token) · in `meta` → 1 ·
//            else (≥ 4 letters) a token within one edit (insert / delete / substitute / swap of two
//            neighbours) of the word, or of the token's prefix of the word's length → 0.5, `close`.
//            A word that matches nothing drops the row.
//   order    score ↓, then openedAt ↓, then name.

export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Fold `s` and remember, for every folded index, the index in `s` it came from. */
function foldMapped(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    text += f;
    i += ch.length;
  }
  map.push(s.length);
  return { text, map };
}

export function words(q: string): string[] {
  return fold(q)
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

const tokenize = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Damerau (adjacent swap) distance ≤ 1? */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let first = -1;
    let diffs = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) {
        diffs++;
        if (first < 0) first = i;
        if (diffs > 2) return false;
      }
    }
    if (diffs === 1) return true;
    // a swap of two neighbours
    return diffs === 2 && a[first] === b[first + 1] && a[first + 1] === b[first];
  }
  // one insertion / deletion
  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) {
      i++;
      j++;
    } else {
      if (skipped) return false;
      skipped = true;
      j++;
    }
  }
  return true;
}

export interface MatchInput {
  key: string;
  name: string;
  meta?: string;
  openedAt?: number;
}

export interface MatchHit<T extends MatchInput> {
  row: T;
  score: number;
  close: boolean;
  marks: Array<[number, number]>;
}

/** Score one row against folded query words; null = dropped. */
export function scoreRow<T extends MatchInput>(row: T, qWords: string[]): MatchHit<T> | null {
  const name = foldMapped(row.name);
  const meta = fold(row.meta ?? '');
  const nameTokens = tokenize(name.text);
  const metaTokens = tokenize(meta);
  let score = 0;
  let close = false;
  const marks: Array<[number, number]> = [];
  for (const w of qWords) {
    const at = name.text.indexOf(w);
    if (at >= 0) {
      const startsToken = at === 0 || !/[\p{L}\p{N}]/u.test(name.text[at - 1] ?? '');
      score += startsToken ? 4 : 3;
      marks.push([name.map[at] as number, name.map[at + w.length] as number]);
      continue;
    }
    if (meta.includes(w)) {
      score += 1;
      continue;
    }
    if (w.length >= 4) {
      const near = (t: string) => withinOneEdit(w, t) || withinOneEdit(w, t.slice(0, w.length));
      if (nameTokens.some(near) || metaTokens.some(near)) {
        score += 0.5;
        close = true;
        continue;
      }
    }
    return null;
  }
  marks.sort((a, b) => a[0] - b[0]);
  return { row, score, close, marks };
}

/** Match rows against a query: every word must match; ranked; capped. */
export function match<T extends MatchInput>(
  rows: readonly T[],
  q: string,
  limit = 200
): MatchHit<T>[] {
  const qWords = words(q);
  if (!qWords.length) return [];
  const hits: MatchHit<T>[] = [];
  for (const row of rows) {
    const hit = scoreRow(row, qWords);
    if (hit) hits.push(hit);
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (b.row.openedAt ?? 0) - (a.row.openedAt ?? 0) ||
      a.row.name.localeCompare(b.row.name)
  );
  return hits.slice(0, limit);
}
