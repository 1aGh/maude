// client/v2/canvases/panel-search.js — S1.3: the search box of the Canvases panel (01 · cf-panel-search).
//
// PURE. Type in the panel and the tree flattens to the canvases that answer: by NAME, by the FOLDER they sit
// in, and by the ARTBOARDS inside them ("letak" finds LetakA6 through “Náborový leták A6 · FLAG”). Accents,
// word order and a swapped letter do not matter — because this is not a second matcher: it is index/match.ts
// `scoreRow`, the one ⌘K and `/_api/index?q=` already use (S1 Q8 — "one matcher"), run over the artboards the
// project index snapshot already carries (so no round trip per keystroke, and it answers offline).
//
// What `scoreRow` gives back — marks — only covers the NAME. A mark is an [start, end) range into the ORIGINAL
// text ("Trenéři", never its folded "treneri"), so the row can wrap exactly the letters the person typed.
// `markRanges` does the same for the words a row shows besides its name (the folder, the quoted artboard).

import { fold, scoreRow, words as queryWords } from '../../../index/match.ts';

/** `s` folded (no accents, lower case), plus for every folded index the index in `s` it came from. */
export function foldMapped(s) {
  const src = String(s ?? '');
  let text = '';
  const map = [];
  let i = 0;
  for (const ch of src) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < f.length; k++) map.push(i);
    text += f;
    i += ch.length;
  }
  map.push(src.length);
  return { text, map };
}

/**
 * Where each of `qWords` (already folded) sits in `text`, as [start, end) ranges in the ORIGINAL text,
 * sorted and merged. A word that is not there (a typo, or a word that matched elsewhere) marks nothing.
 */
export function markRanges(text, qWords) {
  const { text: folded, map } = foldMapped(text);
  const out = [];
  for (const w of qWords || []) {
    if (!w) continue;
    const at = folded.indexOf(w);
    if (at >= 0) out.push([map[at], map[at + w.length]]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** `text` split into [{ t, m }] runs — `m` true where a mark covers it. Drawn as <mark> by the row. */
export function splitMarks(text, marks) {
  const s = String(text ?? '');
  if (!marks?.length) return [{ t: s, m: false }];
  const parts = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a > at) parts.push({ t: s.slice(at, a), m: false });
    if (b > a) parts.push({ t: s.slice(a, b), m: true });
    at = Math.max(at, b);
  }
  if (at < s.length) parts.push({ t: s.slice(at), m: false });
  return parts;
}

const KIND_WORDS = {
  web: 'web',
  digital: 'digital',
  social: 'digital',
  print: 'print',
  video: 'video',
};
const kindWord = (k) => KIND_WORDS[k] || '';

/**
 * `scoreRow` forgives one wrong letter in a word of four or more — right for "unifromy", wrong for "2023",
 * which is another year, not a typo of 2026. A query word with a digit must be there exactly.
 */
function digitsExact(qWords, ...texts) {
  const hay = fold(texts.join(' '));
  return qWords.every((w) => !/\d/.test(w) || hay.includes(w));
}

/**
 * The canvases that answer `query`, best first.
 *
 *   canvases  canvas nodes (tree-model): `{ path, name, boards, sortKinds }`
 *   folderOf  (canvas) => the folder words a hit shows ("2026/combine")
 *   order     canvases in the user's Sort order — the tie-break among equal scores
 *
 * Every word must be found (in the name or the folder of a canvas, or in the name of one of its artboards —
 * and the artboard's own canvas name counts for it, so "letak a6 predni" finds LetakA6 › A · přední FLAG).
 *
 * @returns {{ canvas, score, close, nameMarks, viaBoards, matched, folder, boardSub }[]}
 *   matched   the artboards whose OWN name matched: `{ id, label, kind, marks }` (all of them when it was
 *             only a close match or only the canvas name)
 *   viaBoards the canvas itself did not match by name — an artboard did ("an artboard hit")
 *   boardSub  the one-line answer a collapsed artboard hit shows: `{ text, marks }`
 *             — print · “Náborový leták A6 · FLAG” and 3 more
 */
export function searchCanvases(canvases, query, { folderOf = () => '', order } = {}) {
  const qWords = queryWords(query);
  if (!qWords.length) return [];
  const rank = new Map((order || canvases).map((c, i) => [c.path, i]));
  const hits = [];
  for (const c of canvases) {
    const folder = folderOf(c) || '';
    const kinds = (c.sortKinds || []).map(kindWord).filter(Boolean).join(' ');
    const ownHit = scoreRow(
      { key: c.path, name: c.name, meta: `${folder} ${kinds}`.trim() },
      qWords
    );
    const own = ownHit && digitsExact(qWords, c.name, folder, kinds) ? ownHit : null;
    const boards = [];
    for (const b of c.boards || []) {
      const h = scoreRow(
        { key: `${c.path}#${b.id}`, name: b.label || b.id, meta: `${c.name} ${kindWord(b.kind)}` },
        qWords
      );
      if (h && digitsExact(qWords, b.label || b.id, c.name)) boards.push({ b, h });
    }
    if (!own && !boards.length) continue;
    const named = boards.filter((x) => x.h.marks.length > 0);
    const shown = (named.length ? named : boards).map(({ b, h }) => ({
      id: b.id,
      label: b.label || b.id,
      kind: b.kind,
      marks: h.marks,
      score: h.score,
    }));
    const nameMarks = own?.marks ?? [];
    const viaBoards = nameMarks.length === 0 && shown.length > 0;
    const best = Math.max(own?.score ?? 0, ...shown.map((m) => m.score * 0.9));
    const close = own ? own.close && !shown.length : boards.every((x) => x.h.close);
    const first = shown[0];
    let boardSub = null;
    if (viaBoards && first) {
      const lead = kindWord(first.kind) ? `${kindWord(first.kind)} · ` : '';
      const more = shown.length > 1 ? ` and ${shown.length - 1} more` : '';
      const text = `${lead}“${first.label}”${more}`;
      boardSub = {
        text,
        marks: first.marks.map(([a, b]) => [a + lead.length + 1, b + lead.length + 1]),
      };
    }
    hits.push({
      canvas: c,
      score: best,
      close,
      nameMarks,
      viaBoards,
      matched: shown,
      folder,
      boardSub,
      folderMarks: markRanges(folder, qWords),
    });
  }
  hits.sort(
    (a, b) => b.score - a.score || (rank.get(a.canvas.path) ?? 0) - (rank.get(b.canvas.path) ?? 0)
  );
  return hits;
}
