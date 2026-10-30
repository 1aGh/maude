// asset-generated.ts — the Assets tab's "Generated" group (S8.21; closes the S8.16b toast "The other three are in Assets ›
// Generated"). A picture that has a `assets/<sha8>.gen.json` (maude.gen v1, contract S8-asset-sidecars §5.2) was made by AI;
// the takes of one run share a `group`, so a run is one block: its prompt, the provider and day, and its takes in the order
// they were made. A run's takes that were deleted or have not synced yet are simply not listed.
//
// Read only. The records are peer-synced text, so they are capped here and only ever drawn as text.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { readGen } from './generation/gen-sidecar.ts';
import { assetKindOf } from './index/extractors/asset-usage.ts';

export const GENERATED_MAX_GROUPS = 100;
const MAX_RECORDS = 2000;

export interface GeneratedGroup {
  group: string;
  prompt: string;
  provider: string;
  model: string;
  /** ISO-8601 UTC */
  at: string;
  by?: string;
  /** designRoot-relative `assets/<sha8>.<ext>` files that exist, in the order they were made */
  takes: string[];
}

const timeOf = (g: { at: string }, fallback: number) => {
  const t = Date.parse(g.at);
  return Number.isFinite(t) ? t : fallback;
};

/** Runs of generated media, newest first. [] when the project has none. */
export function listGeneratedGroups(designRoot: string): GeneratedGroup[] {
  const dir = path.join(designRoot, 'assets');
  let names: string[];
  try {
    names = readdirSync(dir).sort(); // a run's takes and its label never depend on readdir order
  } catch {
    return [];
  }
  // stem → the media file that carries it (a sidecar of the same stem is not media)
  const media = new Map<string, string>();
  for (const n of names) {
    if (!assetKindOf(n)) continue;
    const stem = n.split('.')[0] ?? n;
    if (!media.has(stem)) media.set(stem, n);
  }
  const groups = new Map<string, GeneratedGroup & { sortAt: number; seen: Set<string> }>();
  let scanned = 0;
  for (const n of names) {
    if (!n.endsWith('.gen.json')) continue;
    if (++scanned > MAX_RECORDS) break;
    const stem = n.slice(0, -'.gen.json'.length);
    const own = media.get(stem);
    if (!own) continue; // a record whose picture is not here (yet)
    let text: string;
    let mtime = 0;
    try {
      const st = statSync(path.join(dir, n));
      if (!st.isFile()) continue;
      mtime = st.mtimeMs;
      text = readFileSync(path.join(dir, n), 'utf8');
    } catch {
      continue;
    }
    const doc = readGen(text, { self: stem });
    if (!doc) continue;
    const key = typeof doc.group === 'string' && doc.group ? doc.group : stem;
    let g = groups.get(key);
    if (!g) {
      g = {
        group: key,
        prompt: doc.prompt.slice(0, 4000),
        provider: doc.provider.slice(0, 80),
        model: doc.model.slice(0, 80),
        at: doc.at,
        ...(typeof doc.by === 'string' && doc.by && !doc.by.includes('@') ? { by: doc.by } : {}),
        takes: [],
        sortAt: timeOf(doc, mtime),
        seen: new Set(),
      };
      groups.set(key, g);
    }
    // the run's own order is `takes`; a record that lists others adds the ones that exist
    for (const t of [...doc.takes, stem]) {
      const file = media.get(t);
      if (file && !g.seen.has(t)) {
        g.seen.add(t);
        g.takes.push(`assets/${file}`);
      }
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.sortAt - a.sortAt || (a.group < b.group ? -1 : 1))
    .slice(0, GENERATED_MAX_GROUPS)
    .map(({ sortAt: _s, seen: _seen, ...g }) => g);
}
