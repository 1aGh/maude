// S11.19: the v1 component names a v2 `where` path must never use. A `where` is "a path a person follows"
// (Menu › Diagnostics › Sync), not the name of the v1 body it replaces; naming a retired panel there
// pointed the next reader at code that is about to be retired (V2-8.0).
//
// Derived, not hand-listed: every PascalCase component scope in the frozen v1 manifest (entries outside
// client/v2), every `panel` entry label, and every component file under client/panels and client/dialogs.
// A name the v2 tree also defines (it was reused, not retired) is not banned. Single-hump words (Sidebar,
// Welcome, Row) and brand words never come from a scope, so they are never in the list.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const COMPONENT = /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/;

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Names the v2 tree defines itself (function/const/class declarations under client/v2). */
export function v2DefinedNames(root) {
  const defined = new Set();
  const decl = /\b(?:function|const|class)\s+([A-Z][A-Za-z0-9]+)/g;
  for (const f of walk(join(root, 'apps/studio/client/v2'))) {
    if (!/\.(jsx?|tsx?)$/.test(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(decl)) defined.add(m[1]);
  }
  return defined;
}

export function v1ComponentNames(root, manifest) {
  const names = new Set();
  for (const e of manifest.entries) {
    if (e.file?.includes('/client/v2/')) continue;
    for (const part of String(e.scope ?? '').split('.')) names.add(part);
    if (e.kind === 'panel') names.add(String(e.label ?? ''));
  }
  for (const dir of ['panels', 'dialogs']) {
    for (const f of walk(join(root, 'apps/studio/client', dir)))
      if (/\.jsx$/.test(f)) names.add(basename(f, '.jsx'));
  }
  const v2 = v2DefinedNames(root);
  return [...names].filter((n) => COMPONENT.test(n) && !v2.has(n)).sort();
}

/** [{ id, name }] for every live row whose v2.where uses a v1 component name as a word. */
export function v1NamesInWhere(rows, names) {
  const hits = [];
  for (const r of rows) {
    if (r.orphaned) continue;
    const where = r.v2?.where ?? '';
    for (const name of names)
      if (new RegExp(`(?<![A-Za-z0-9])${name}(?![A-Za-z0-9])`).test(where))
        hits.push({ id: r.id, name });
  }
  return hits;
}
