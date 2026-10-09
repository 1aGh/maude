#!/usr/bin/env node
// Maude v2 nothing-deleted audit (plan "Nothing-deleted contract"; created red by V2-2.0c, first
// green at the Phase 4 gate, must stay green after the V2-8.0 deletion).
//
//   node scripts/check-v2-nothing-deleted.mjs           audit; exit 0 only at 100 %
//   node scripts/check-v2-nothing-deleted.mjs --sync    refresh the rows of nothing-deleted.json from
//                                                       their sources, keeping every filled-in v2 field
//                                                       and every mapping
//   node scripts/check-v2-nothing-deleted.mjs --json    the audit as JSON
//
// Inputs:
//   apps/studio/client/v2/v1-manifest.json     every reachable v1 entry point, frozen (V2-2.0c,
//                                              scripts/v2-manifest/scan-v1.mjs)
//   apps/studio/client/v2/nothing-deleted.json rows = §A (ITEMS in `.design/ui/v2/06 Advanced.tsx`,
//                                              124 rows) + §B (Gate 0 table G0-D, D1–D20); each row's
//                                              `v2` = { action (registry id), testid, where (path a
//                                              person follows) }; `map` = v1 entry id → row id
// The audit is 100 % when
//   1. every manifest entry maps to an existing row,
//   2. every row has `v2.where` and a registry action id or a testid,
//   3. every row is reachable in a headless boot per shell and role (reachability.json, written by
//      the Phase 4 probe; until it exists this check is red).
// Exit 0 = 100 %; 1 = below (printed); 2 = could not run.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'apps/studio/client/v2/v1-manifest.json');
const ND = join(ROOT, 'apps/studio/client/v2/nothing-deleted.json');
const REACH = join(ROOT, 'apps/studio/client/v2/reachability.json');
const ADVANCED = join(ROOT, '.design/ui/v2/06 Advanced.tsx');
const PLAN = join(ROOT, '.ai/plans/feature-maude-v2-redesign.md');
const args = process.argv.slice(2);

function constIn(src, name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")`));
  if (!m) throw new Error(`06 Advanced: ITEMS uses ${name}, which is not a string const`);
  return JSON.parse(m[1]);
}

// Row ids are slugs of the feature text, so reordering the canvas never re-points a mapping.
const slug = (t) =>
  t
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56);

function sourceRows() {
  const rows = [];
  const taken = new Map();
  const uniqueId = (base) => {
    const k = (taken.get(base) ?? 0) + 1;
    taken.set(base, k);
    return k === 1 ? base : `${base}-${k}`;
  };
  // §A — ITEMS: [what, today's place, new home, where that home is drawn]
  const adv = readFileSync(ADVANCED, 'utf8');
  const block = adv.slice(
    adv.indexOf('const ITEMS'),
    adv.indexOf('\n];', adv.indexOf('const ITEMS'))
  );
  let n = 0;
  for (const line of block.split('\n')) {
    // the first cell is a string, or a const declared in the canvas (e.g. TRACE = "Resync")
    const m = line.match(
      /^\s*\[\s*("(?:[^"\\]|\\.)*"|[A-Z_][A-Z0-9_]*)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*("(?:[^"\\]|\\.)*"|null)\s*\]/
    );
    if (!m) continue;
    n++;
    const what = m[1].startsWith('"') ? JSON.parse(m[1]) : constIn(adv, m[1]);
    rows.push({
      id: uniqueId(`A-${slug(what)}`),
      source: '§A 06 Advanced ITEMS',
      what,
      today: m[2],
      home: m[3],
      drawnAt: m[4] === 'null' ? null : JSON.parse(m[4]),
    });
  }
  // §B — G0-D rows: | Dn | today's feature | v2 home | sign-off |
  const plan = readFileSync(PLAN, 'utf8');
  for (const m of plan.matchAll(/^\| (D\d{1,2}) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)) {
    rows.push({
      id: m[1],
      source: '§B G0-D',
      what: m[2].trim(),
      today: null,
      home: m[3].trim(),
      drawnAt: null,
    });
  }
  return rows;
}

const blankV2 = () => ({ action: null, testid: null, where: null });

if (args.includes('--sync')) {
  const old = existsSync(ND) ? JSON.parse(readFileSync(ND, 'utf8')) : { rows: [], map: {} };
  const prev = new Map(old.rows.map((r) => [r.id, r]));
  const rows = sourceRows().map((r) => ({ ...r, v2: prev.get(r.id)?.v2 ?? blankV2() }));
  // rows are never deleted: one whose source disappeared stays, marked orphaned
  for (const r of old.rows)
    if (!rows.some((x) => x.id === r.id)) rows.push({ ...r, orphaned: true });
  const doc = {
    schema: 'maude.nothing-deleted/1',
    about:
      'Every v1 feature and its v2 home. rows = §A (06 Advanced ITEMS) + §B (G0-D); v2 = registry action id / testid / where-path, filled by the package that builds the home; map = v1-manifest entry id → row id. Audited by scripts/check-v2-nothing-deleted.mjs.',
    rows,
    map: old.map ?? {},
  };
  writeFileSync(ND, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `nothing-deleted: ${rows.length} rows (${rows.filter((r) => r.id.startsWith('A')).length} §A, ${rows.filter((r) => r.id.startsWith('D')).length} §B) → apps/studio/client/v2/nothing-deleted.json`
  );
  process.exit(0);
}

let manifest;
let nd;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  nd = JSON.parse(readFileSync(ND, 'utf8'));
} catch (e) {
  console.error(`nothing-deleted: cannot read inputs — ${e.message}`);
  process.exit(2);
}

// v1 entry points that appeared in the code after the freeze count as unmapped too
const { scan } = await import('./v2-manifest/scan-v1.mjs');
const frozen = new Set(manifest.entries.map((e) => e.id));
const late = scan().filter((e) => !frozen.has(e.id) && !e.file.includes('/client/v2/'));

const rowIds = new Set(nd.rows.filter((r) => !r.orphaned).map((r) => r.id));
const entries = [...manifest.entries, ...late];
const unmapped = entries.filter((e) => !rowIds.has(nd.map?.[e.id]));
const live = nd.rows.filter((r) => !r.orphaned);
const unhomed = live.filter((r) => !r.v2?.where || !(r.v2?.action || r.v2?.testid));
let unreached = live;
let reachNote = 'reachability probe not run yet (Phase 4 headless boot per shell and role)';
if (existsSync(REACH)) {
  const reach = JSON.parse(readFileSync(REACH, 'utf8'));
  const ok = new Set(
    Object.entries(reach.rows ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k)
  );
  unreached = live.filter((r) => !ok.has(r.id));
  reachNote = `reachability from ${reach.taken ?? 'unknown run'}`;
}

const pct = (open, total) => (total ? ((100 * (total - open)) / total).toFixed(1) : '100.0');
const result = {
  manifest: {
    total: entries.length,
    addedAfterFreeze: late.length,
    unmapped: unmapped.length,
    pct: pct(unmapped.length, entries.length),
  },
  homes: { total: live.length, unfilled: unhomed.length, pct: pct(unhomed.length, live.length) },
  reachable: {
    total: live.length,
    unreached: unreached.length,
    pct: pct(unreached.length, live.length),
    note: reachNote,
  },
};
const green = !unmapped.length && !unhomed.length && !unreached.length;

if (args.includes('--json')) {
  console.log(JSON.stringify({ ...result, green }, null, 2));
} else {
  console.log(
    `v1 entry points mapped to a row   ${result.manifest.pct} %  (${unmapped.length} of ${entries.length} open${late.length ? `, ${late.length} added after the freeze` : ''})`
  );
  console.log(
    `rows with a v2 home (where + id)  ${result.homes.pct} %  (${unhomed.length} of ${live.length} open)`
  );
  console.log(
    `rows reachable in a headless boot ${result.reachable.pct} %  (${unreached.length} of ${live.length} open — ${reachNote})`
  );
  console.log(
    green
      ? 'nothing-deleted: 100 %'
      : 'nothing-deleted: below 100 % (red by design until the Phase 4 gate)'
  );
}
process.exit(green ? 0 : 1);
