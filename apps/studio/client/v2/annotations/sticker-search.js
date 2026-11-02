// client/v2/annotations/sticker-search.js — S4.3: the Stickers gallery's pure model (canvas 15
// an-stk-gallery / an-stk-search). No React, no DOM: pack order, keyword search across the bundled packs
// and the vote stamps, the chips, the empty state and Recent are all testable on their own.
//
//   orderPacks(packs)               → CONTRACT C13 order (FigJam Doodle · Life Style · Opposing Thoughts ·
//                                      Project status); an unknown pack goes last
//   searchStickers(packs, stamps, q, chip?) → null (blank query = browse) | a result (see below)
//   pushRecent / resolveRecent      → the per-person Recent list (≤ 12, newest first)

/** CONTRACT C13. */
export const PACK_ORDER = Object.freeze([
  'figjam-doodle',
  'life-style',
  'opposing-thoughts',
  'project-status',
]);
export const RECENT_MAX = 12;
/** The words an empty search offers (canvas 15: sticker words are English). */
export const SUGGEST_WORDS = Object.freeze(['done', 'finished', 'approved']);
/** "All" plus at most this many word chips. */
export const CHIP_MAX = 4;

/** "Project status stickers" → "Project status" (names trimmed, C13). */
export function packDisplayName(pack) {
  return String(pack?.name ?? pack?.slug ?? '')
    .replace(/\s+stickers$/i, '')
    .trim();
}

export function orderPacks(packs) {
  const rank = (p) => {
    const i = PACK_ORDER.indexOf(p.slug);
    return i < 0 ? PACK_ORDER.length : i;
  };
  // stable: Array.prototype.sort keeps the incoming order within one rank
  return [...(packs ?? [])]
    .map((p) => ({ ...p, name: packDisplayName(p) }))
    .sort((a, b) => rank(a) - rank(b));
}

const norm = (s) => String(s ?? '').toLowerCase();
const tokensOf = (q) => norm(q).split(/\s+/).filter(Boolean);

/** The first keyword that carries every token, or the first one carrying the first token; else null. */
function matchWord(keywords, tokens) {
  const ks = (keywords ?? []).map(norm);
  // every token must hit SOME keyword (AND); the label is the keyword that hit the first token
  for (const t of tokens) if (!ks.some((k) => k.includes(t))) return null;
  return ks.find((k) => k.includes(tokens[0])) ?? null;
}

/**
 * Search the packs and the stamps.
 * @param packs ordered packs `[{slug, name, stickers:[{file, keywords, url}]}]`
 * @param stamps the stamp defs `[{id, name, keywords}]`
 * @param chip a word to narrow the SAME hit set to (null = All)
 * @returns null for a blank query, else
 *   `{ query, empty, count, chips:[{word,count}], packs:[{slug,name,author,attributionUrl,total,stickers}],
 *      stamps, missing:[pack names with no hit], noStamp, suggest }`
 *   Each sticker hit is `{...sticker, pack, id, word}`; `count` is the number of sticker + stamp hits shown.
 */
export function searchStickers(packs, stamps, query, chip = null) {
  const tokens = tokensOf(query);
  if (tokens.length === 0) return null;
  const q = String(query).trim();

  const allHits = []; // [{pack, sticker}] before the chip
  const perPack = [];
  for (const pack of packs ?? []) {
    const hits = [];
    for (const s of pack.stickers ?? []) {
      const word = matchWord(s.keywords, tokens);
      if (word) hits.push({ ...s, pack: pack.slug, id: s.file, word });
    }
    perPack.push({ pack, hits });
    for (const h of hits) allHits.push(h);
  }
  const stampHits = (stamps ?? []).filter(
    (s) => matchWord([s.name, ...(s.keywords ?? [])], tokens) !== null
  );

  // chips: the words the hits carry. Words that contain the query come first (they ARE the match),
  // then co-occurring words; each by count (desc), then first appearance. Singletons are noise.
  const count = new Map();
  const first = new Map();
  for (const h of allHits) {
    for (const k of new Set((h.keywords ?? []).map(norm))) {
      count.set(k, (count.get(k) ?? 0) + 1);
      if (!first.has(k)) first.set(k, first.size);
    }
  }
  const isMatch = (w) => tokens.some((t) => w.includes(t));
  const chips = [...count.entries()]
    .filter(([, n]) => n >= 2)
    .sort(
      (a, b) =>
        Number(isMatch(b[0])) - Number(isMatch(a[0])) ||
        b[1] - a[1] ||
        first.get(a[0]) - first.get(b[0])
    )
    .slice(0, CHIP_MAX)
    .map(([word, n]) => ({ word, count: n }));

  const keep = (h) => !chip || (h.keywords ?? []).some((k) => norm(k) === norm(chip));
  const shown = perPack
    .map(({ pack, hits }) => ({
      slug: pack.slug,
      name: pack.name,
      author: pack.author,
      attributionUrl: pack.attributionUrl,
      total: (pack.stickers ?? []).length,
      stickers: hits.filter(keep),
    }))
    .filter((p) => p.stickers.length > 0);
  // a chip narrows stickers; the stamps are not keyworded by it, so they step aside while one is on
  const stampsShown = chip ? [] : stampHits;
  const n = shown.reduce((a, p) => a + p.stickers.length, 0) + stampsShown.length;

  return {
    query: q,
    empty: allHits.length === 0 && stampHits.length === 0,
    all: allHits.length + stampHits.length, // hits before a chip narrows them
    count: n, // hits shown
    chips,
    packs: shown,
    stamps: stampsShown,
    missing: perPack.filter(({ hits }) => hits.length === 0).map(({ pack }) => pack.name),
    noStamp: stampHits.length === 0,
    suggest: [...SUGGEST_WORDS],
  };
}

const isRef = (r) =>
  !!r && typeof r === 'object' && typeof r.pack === 'string' && typeof r.id === 'string';

/** Newest first, de-duplicated by (pack, id), capped. */
export function pushRecent(list, ref, max = RECENT_MAX) {
  if (!isRef(ref)) return Array.isArray(list) ? list.filter(isRef).slice(0, max) : [];
  const rest = (Array.isArray(list) ? list : []).filter(
    (r) => isRef(r) && !(r.pack === ref.pack && r.id === ref.id)
  );
  return [{ pack: ref.pack, id: ref.id }, ...rest].slice(0, max);
}

/** Recent refs → live stickers (with `url`); anything the catalogue no longer has drops out. */
export function resolveRecent(packs, list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!isRef(r)) continue;
    const pack = (packs ?? []).find((p) => p.slug === r.pack);
    const s = pack?.stickers?.find((x) => x.file === r.id);
    if (s) out.push({ ...s, pack: pack.slug, id: s.file });
  }
  return out;
}
