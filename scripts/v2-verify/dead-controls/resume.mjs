// resume.mjs — pure helpers that let a sweep CONTINUE from earlier shards (`dead-controls.mjs --resume a.json,…`).
//
// A shard that spent its time budget lists the states it never entered as `unreachable` `(surface)` rows. A resume
// run reads those shards, (1) seeds the "judged once" map and the "child already queued" set from every row that was
// really judged — so a control clicked in an earlier shard is a twin here, not clicked a second time — and (2) turns
// each unreachable state into a seed the crawler walks to and crawls, then keeps crawling the children it finds.
// The merge (`mergeShards`) drops an unreachable row once some shard crawled that state.

import { isRigError } from './report.mjs';

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

// an error's `control` is `frame:name` for a click, `<open name>` / `<re-toggle name>` for a replay step
const errorName = (c) =>
  String(c ?? '')
    .replace(/^\w+:/, '')
    .replace(/^<(?:open|re-toggle|again, clean:|read) (.*?)(?: again)?>$/, '$1');
const realError = (e) => !isRigError(e) && /http (409|422|404|5\d\d)/.test(e.kind);

/**
 * States judged on an older build whose rows may no longer hold: a disabled row that showed no reason, a DEAD row,
 * and any row (or the path to it) that drew a real server error. `mode|shell|surface`.
 */
export function staleStates(parts) {
  const stale = new Set();
  for (const p of parts) {
    const names = new Set((p.errors ?? []).filter(realError).map((e) => `${e.mode}|${e.shell}|${errorName(e.control)}`));
    for (const r of p.results ?? []) {
      if (r.effect === 'unreachable') continue;
      const named =
        names.has(`${r.mode}|${r.shell}|${r.control}`) ||
        r.surface.split(' › ').some((seg) => names.has(`${r.mode}|${r.shell}|${seg}`) && seg === r.control);
      if ((r.effect === 'disabled' && !r.note) || r.effect === 'DEAD' || named) stale.add(stateKey(r));
    }
  }
  return stale;
}

/**
 * @param parts   earlier shards (their parsed `--json` files)
 * @param opts    { mode, shell, accept(surface) → bool, shard: [i, n] | null, redo, seedFrom: parts | null }
 *                seedFrom (members of `parts`) limits the unreached-state seeds to what those shards left behind
 * @returns { judged: Map<judgeKey, where>, queued: Set<sig>, seeds: string[] }  seeds = state paths, shallowest first
 */
export function planResume(allParts, { mode, shell, accept = () => true, shard = null, redo = false, seedFrom = null }) {
  const parts = supersede(allParts);
  const judged = new Map();
  const queued = new Set();
  const stale = redo ? staleStates(parts) : new Set();
  for (const p of parts)
    for (const r of p.results ?? []) {
      if (r.mode !== mode || r.shell !== shell || notJudged(r) || !r.key) continue;
      if (stale.has(stateKey(r))) continue; // judged on an older build: judged again
      const k = judgeKey(r.frame, r.key, r.surface);
      if (!judged.has(k)) judged.set(k, `${r.surface} · ${r.control}`);
      queued.add(`${r.surface}>${r.key}`);
    }
  const reached = reachedStates(parts);
  const seen = new Set();
  let seeds = [];
  for (const k of stale) {
    const [m, sh, ...rest] = k.split('|');
    const surface = rest.join('|');
    if (m === mode && sh === shell && accept(surface) && !seen.has(surface)) {
      seen.add(surface);
      seeds.push(surface);
    }
  }
  for (const [pi, p] of parts.entries()) {
    // only the states THESE shards left unreached (`parts` are copies: match by position)
    if (seedFrom && !seedFrom.includes(allParts[pi])) continue;
    for (const r of p.results ?? []) {
      if (!isSurfaceRow(r) || r.mode !== mode || r.shell !== shell) continue;
      if ((reached.has(stateKey(r)) && !stale.has(stateKey(r))) || seen.has(r.surface) || !accept(r.surface))
        continue;
      seen.add(r.surface);
      seeds.push(r.surface);
    }
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
  const redone = seeds.filter((x) => stale.has(`${mode}|${shell}|${x}`));
  return { judged, queued, seeds, redone };
}

/** The shards with every state a LATER shard judged again (`redone`) dropped from the earlier ones, errors included. */
export function supersede(parts) {
  const redoneAfter = parts.map((_, j) => {
    const set = new Set();
    for (const q of parts.slice(j + 1)) for (const s of q.redone ?? []) set.add(stateKey(s));
    return set;
  });
  const names = redoneAfter.map((set, j) => {
    const n = new Set();
    for (const r of parts[j].results ?? [])
      if (set.has(stateKey(r))) {
        n.add(`${r.mode}|${r.shell}|${r.control}`);
        n.add(`${r.mode}|${r.shell}|${r.surface.split(' › ').pop()}`);
      }
    return n;
  });
  const kept = parts.map((p, j) => ({
    ...p,
    results: (p.results ?? []).filter((r) => !redoneAfter[j].has(stateKey(r))),
    errors: (p.errors ?? []).filter(
      (e) => isRigError(e) || !names[j].has(`${e.mode}|${e.shell}|${errorName(e.control)}`)
    ),
  }));
  return kept;
}

/**
 * Concatenate shards. An unreachable `(surface)` row goes when any shard entered that state; the same state listed
 * unreachable by two shards stays once (the later note wins). A redone state replaces the earlier rows of it.
 */
export function mergeShards(parts) {
  const kept = supersede(parts);
  const merged = { results: [], errors: [], external: [], popups: [], unreachable: [], statesDone: [] };
  for (const p of kept) for (const k of Object.keys(merged)) merged[k].push(...(p[k] ?? []));
  const reached = reachedStates(kept);
  const last = new Map();
  merged.results.forEach((r, i) => {
    if (isSurfaceRow(r)) last.set(stateKey(r), i);
  });
  merged.results = merged.results.filter(
    (r, i) => !isSurfaceRow(r) || (!reached.has(stateKey(r)) && last.get(stateKey(r)) === i)
  );
  return merged;
}
