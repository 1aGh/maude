// index/match.ts — the ONE matcher every search uses (V2-2.17, contract V2-1.17 §5.7): the panel
// search, ⌘K and the marks. Pure; imported by the server and the client bundle.
//
//   fold(s)  NFD, strip combining marks, lower-case — "Trenéři" and "treneri" are the same word.
//   query    folded words; EVERY word must match, in any order.
//   per word contained in `name` → 3 (+1 when it starts a token) · in `meta` → 1 ·
//            else (≥ 4 characters, NO digit in the word) a token within one edit (insert / delete /
//            substitute / swap of two neighbours) of the word, or of the token's prefix of the word's
//            length → 0.5, `close`. A word with a digit is a number, not a spelling: "2023" is another
//            year than 2026, so it must be there exactly (S1.4, folding in S1.3's follow-up).
//            A word that matches nothing drops the row.
//   marks    `marks` = exact words in the name · `closeMarks` = the name's tokens a typo stood for ·
//            `metaMarks` = the words found in the meta (exact or typo). Ranges index the UNFOLDED text.
//   weak     no word of the query was there exactly — every one was a typo (⌘K shows such a row quiet).
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

export type Range = [number, number];

export interface MatchHit<T extends MatchInput> {
  row: T;
  score: number;
  close: boolean;
  marks: Range[];
  closeMarks: Range[];
  metaMarks: Range[];
  weak: boolean;
}

/** The letter/digit runs of an already-folded text, with where each starts. */
function tokensAt(text: string): Array<{ t: string; at: number }> {
  const out: Array<{ t: string; at: number }> = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) out.push({ t: m[0], at: m.index ?? 0 });
  return out;
}

/** Sorted, with touching or overlapping ranges merged. */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Where a typo of `w` sits among `toks`: the token's range (folded indexes), or null. */
function nearToken(w: string, toks: Array<{ t: string; at: number }>): Range | null {
  for (const k of toks) {
    if (withinOneEdit(w, k.t)) return [k.at, k.at + k.t.length];
    if (withinOneEdit(w, k.t.slice(0, w.length)))
      return [k.at, k.at + Math.min(k.t.length, w.length)];
  }
  return null;
}

/** Score one row against folded query words; null = dropped. */
export function scoreRow<T extends MatchInput>(row: T, qWords: string[]): MatchHit<T> | null {
  const name = foldMapped(row.name);
  const meta = foldMapped(row.meta ?? '');
  const nameTokens = tokensAt(name.text);
  const metaTokens = tokensAt(meta.text);
  let score = 0;
  let close = false;
  let exact = 0;
  const marks: Range[] = [];
  const closeMarks: Range[] = [];
  const metaMarks: Range[] = [];
  const toOriginal = (m: { map: number[] }, [a, b]: Range): Range => [
    m.map[a] as number,
    m.map[b] as number,
  ];
  for (const w of qWords) {
    const at = name.text.indexOf(w);
    if (at >= 0) {
      const startsToken = at === 0 || !/[\p{L}\p{N}]/u.test(name.text[at - 1] ?? '');
      score += startsToken ? 4 : 3;
      exact++;
      marks.push(toOriginal(name, [at, at + w.length]));
      continue;
    }
    const inMeta = meta.text.indexOf(w);
    if (inMeta >= 0) {
      score += 1;
      exact++;
      metaMarks.push(toOriginal(meta, [inMeta, inMeta + w.length]));
      continue;
    }
    if (w.length >= 4 && !/\d/.test(w)) {
      const inName = nearToken(w, nameTokens);
      const viaMeta = inName ? null : nearToken(w, metaTokens);
      if (inName || viaMeta) {
        score += 0.5;
        close = true;
        if (inName) closeMarks.push(toOriginal(name, inName));
        else if (viaMeta) metaMarks.push(toOriginal(meta, viaMeta));
        continue;
      }
    }
    return null;
  }
  marks.sort((a, b) => a[0] - b[0]);
  return {
    row,
    score,
    close,
    marks,
    closeMarks: mergeRanges(closeMarks),
    metaMarks: mergeRanges(metaMarks),
    weak: qWords.length > 0 && exact === 0,
  };
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
