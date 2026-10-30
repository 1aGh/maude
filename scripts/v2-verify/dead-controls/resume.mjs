// resume.mjs — pure helpers that let a sweep CONTINUE from earlier shards (`dead-controls.mjs --resume a.json,…`).
//
// A shard that spent its time budget lists the states it never entered as `unreachable` `(surface)` rows. A resume
// run reads those shards, (1) seeds the "judged once" map and the "child already queued" set from every row that was
// really judged — so a control clicked in an earlier shard is a twin here, not clicked a second time — and (2) turns
// each unreachable state into a seed the crawler walks to and crawls, then keeps crawling the children it finds.
// The merge (`mergeShards`) drops an unreachable row once some shard crawled that state.

/** The key a control is judged once under — see `Crawler.judgeKeyOf`. */
export function judgeKey(frame, key, surface) {
  const scoped = /^tid:project-menu-row-sub-/.test(key) ? `|${surface}` : '';
  return `${frame}|${key}${scoped}`;
}

const isSurfaceRow = (r) => r.effect === 'unreachable' && r.control === '(surface)';
// rows that were not judged in their state: a twin was never clicked, a vanished/unreachable row was not found
const notJudged = (r) => r.effect === 'twin' || r.effect === 'vanished' || r.effect === 'unreachable';

/** `mode|shell|surface` of every state some shard entered (it listed a row, or recorded it in `statesDone`). */
export function reachedStates(parts) {
  const reached = new Set();
  for (const p of parts) {
    for (const r of p.results ?? []) if (r.effect !== 'unreachable') reached.add(stateKey(r));
    for (const s of p.statesDone ?? []) reached.add(stateKey(s));
  }
  return reached;
}
const stateKey = (r) => `${r.mode}|${r.shell}|${r.surface}`;

/**
 * @param parts   earlier shards (their parsed `--json` files)
 * @param opts    { mode, shell, accept(surface) → bool, shard: [i, n] | null }
 * @returns { judged: Map<judgeKey, where>, queued: Set<sig>, seeds: string[] }  seeds = state paths, shallowest first
 */
export function planResume(parts, { mode, shell, accept = () => true, shard = null }) {
  const judged = new Map();
  const queued = new Set();
  for (const p of parts)
    for (const r of p.results ?? []) {
      if (r.mode !== mode || r.shell !== shell || notJudged(r) || !r.key) continue;
      const k = judgeKey(r.frame, r.key, r.surface);
      if (!judged.has(k)) judged.set(k, `${r.surface} · ${r.control}`);
      queued.add(`${r.surface}>${r.key}`);
    }
  const reached = reachedStates(parts);
  const seen = new Set();
  let seeds = [];
  for (const p of parts)
    for (const r of p.results ?? []) {
      if (!isSurfaceRow(r) || r.mode !== mode || r.shell !== shell) continue;
      if (reached.has(stateKey(r)) || seen.has(r.surface) || !accept(r.surface)) continue;
      seen.add(r.surface);
      seeds.push(r.surface);
    }
  // BFS order, like the crawl: a parent state is judged before its children
  seeds = seeds
    .map((s, i) => ({ s, i, d: s.split(' › ').length }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.s);
  if (shard) {
    const [i, n] = shard;
    seeds = seeds.filter((_, idx) => idx % n === i - 1);
  }
  return { judged, queued, seeds };
}

/**
 * Concatenate shards. An unreachable `(surface)` row goes when any shard entered that state; the same state listed
 * unreachable by two shards stays once (the later note wins).
 */
export function mergeShards(parts) {
  const merged = { results: [], errors: [], external: [], popups: [], unreachable: [], statesDone: [] };
  for (const p of parts)
    for (const k of Object.keys(merged)) merged[k].push(...(p[k] ?? []));
  const reached = reachedStates(parts);
  const last = new Map();
  merged.results.forEach((r, i) => {
    if (isSurfaceRow(r)) last.set(stateKey(r), i);
  });
  merged.results = merged.results.filter(
    (r, i) => !isSurfaceRow(r) || (!reached.has(stateKey(r)) && last.get(stateKey(r)) === i)
  );
  return merged;
}
