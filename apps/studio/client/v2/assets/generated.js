// client/v2/assets/generated.js — the "Generated" group of the Assets tab (S8.21; closes S8.16b's "The other three are in
// Assets › Generated").
//
// A picture with an `assets/<sha8>.gen.json` was made by AI; the takes of one run share a group, so a run is one block with
// its prompt and its takes in the order they were made. The server lists the runs (`GET /_api/asset-generated`); this file
// joins them to the tab's rows and reads them aloud. Generated claims its pictures BEFORE Just added does: the toast that
// follows Generate promises they are in Generated, and a fresh take must be there from the first second, not after 30 minutes.
//
// Pure for the join and the words; the hook reads the studio when the panel asks.

import { useCallback, useEffect, useRef, useState } from 'react';
import { dayText } from './details-model.js';

/**
 * Split rows into the runs of generated media (in the order the server gave: newest run first) and everything else.
 * A row listed by two runs belongs to the first; a take the tab does not list (a search narrowed it out) is skipped.
 * @returns {{ runs: Array<object>, claimed: Set<string>, rest: object[] }}
 */
export function splitGenerated(assets, groups) {
  const byPath = new Map(assets.map((a) => [a.path, a]));
  const claimed = new Set();
  const runs = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    const items = [];
    for (const rel of g?.takes ?? []) {
      const row = byPath.get(rel);
      if (row && !claimed.has(rel)) {
        claimed.add(rel);
        items.push(row);
      }
    }
    if (items.length) runs.push({ ...g, items });
  }
  return { runs, claimed, rest: assets.filter((a) => !claimed.has(a.path)) };
}

/** A run's heading: what was asked for, cut at a word. */
export function runTitle(run) {
  const p = String(run?.prompt ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!p) return 'Generated';
  return p.length > 64 ? `${p.slice(0, 63).trimEnd()}…` : p;
}

/** "4 takes · fal · 5 Oct" */
export function runMeta(run) {
  const n = run?.items?.length ?? 0;
  return [`${n} ${n === 1 ? 'take' : 'takes'}`, run?.provider, dayText(run?.at)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * @returns {{ groups: object[], reload: () => Promise<void> }} `groups` is [] until the studio answers (or if it cannot say).
 * The caller reloads when the tab's rows move (a run's record is a file of its own, but its picture landing is the signal), so
 * one change in the project is one read here, not a second listener of its own.
 */
export function useGenerated({ fetchImpl } = {}) {
  const [groups, setGroups] = useState([]);
  const alive = useRef(true);
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const r = await fetchRef.current('/_api/asset-generated', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      if (alive.current) setGroups(Array.isArray(j?.groups) ? j.groups : []);
    } catch {
      if (alive.current) setGroups([]);
    }
  }, []);

  return { groups, reload };
}
