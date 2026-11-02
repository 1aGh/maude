#!/usr/bin/env node
// Nothing-deleted mapper (Phase 4 gate; contract apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md).
//
//   node scripts/v2-manifest/map-entries.mjs            dry run: counts + the open gap, grouped by file
//   node scripts/v2-manifest/map-entries.mjs --write    write `map` + `excluded` into nothing-deleted.json
//   node scripts/v2-manifest/map-entries.mjs --gaps     every unmapped entry, one per line
//
// Every entry of the frozen v1 manifest — plus every entry the scanner finds in today's code that the
// freeze did not list and that is not v2 code — resolves to one target (see map-rules.mjs): a §A/§B
// row, a registry action (`action:<id>`) or a testids.json hook re-emitted in v2 (`testid:<hook>`).
// Entries that are not v1 features are `excluded` with a reason (historical hooks: no live element).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAND, INFRA_IDS, LABEL_FILES, RULES, V2_CODE_IDS, V2_CODE_PATHS } from './map-rules.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = join(REPO, 'apps/studio/client/v2/v1-manifest.json');
const ND = join(REPO, 'apps/studio/client/v2/nothing-deleted.json');
const TESTIDS = join(REPO, 'apps/studio/client/testids.json');

/** Late entries that are v2 code (not v1 features): by path, or named one by one. */
export function isV2Code(e) {
  return V2_CODE_IDS.has(e.id) || V2_CODE_PATHS.some((re) => re.test(e.file));
}

const keyOf = (id) => id.slice(id.lastIndexOf('/') + 1);
const scopeOf = (id) => id.slice(id.indexOf('#') + 1, id.lastIndexOf('/'));
const normLabel = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/…|\.\.\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

function ruleMatches(rule, e) {
  if (!rule.file.test(e.file)) return false;
  if (rule.s && !rule.s.test(e.scope ?? scopeOf(e.id))) return false;
  if (rule.k && !rule.k.test(keyOf(e.id))) return false;
  if (rule.l && !rule.l.test(e.label ?? '')) return false;
  if (rule.t && !rule.t.test(e.testid ?? '')) return false;
  if (rule.kind && !rule.kind.test(e.kind)) return false;
  return true;
}

/**
 * Pure mapper.
 * @param {object} p
 * @param {Array} p.frozen    frozen manifest entries
 * @param {Array} p.late      entries in today's code the freeze did not list
 * @param {Set<string>} p.live ids of every entry in today's code (for the continuation rule)
 * @param {Array} p.rows      nothing-deleted rows ({ id, v2: { action, testid } })
 * @param {Map<string, object>} p.actions  registry: id → { id, label, legacy }
 * @param {Array} p.hooks     testids.json
 * @returns {{ map: Record<string,string>, excluded: Record<string,string>, via: Record<string,string>, unmapped: Array, invalid: Array }}
 */
export function mapEntries({
  frozen,
  late,
  live,
  rows,
  actions,
  hooks,
  hand = HAND,
  rules = RULES,
  labelFiles = LABEL_FILES,
  infra = INFRA_IDS,
}) {
  const rowIds = new Set(rows.filter((r) => !r.orphaned).map((r) => r.id));
  const rowByAction = new Map();
  const rowByTestid = new Map();
  for (const r of rows) {
    if (r.orphaned) continue;
    if (r.v2?.action && !rowByAction.has(r.v2.action)) rowByAction.set(r.v2.action, r.id);
    if (r.v2?.testid && !rowByTestid.has(r.v2.testid)) rowByTestid.set(r.v2.testid, r.id);
  }
  const hookBy = new Map(hooks.map((h) => [h.hook, h]));
  const actionByLabel = new Map();
  for (const a of actions.values()) {
    for (const l of [a.legacy?.menu, a.legacy?.palette, a.label]) {
      const n = normLabel(l);
      if (n && !actionByLabel.has(n)) actionByLabel.set(n, a.id);
    }
  }
  const valid = (t) =>
    t.startsWith('action:')
      ? actions.has(t.slice(7))
      : t.startsWith('testid:')
        ? hookBy.has(t.slice(7))
        : rowIds.has(t);
  const viaAction = (id) => rowByAction.get(id) ?? `action:${id}`;

  const map = {};
  const excluded = {};
  const via = {};
  const unmapped = [];
  const invalid = [];

  function resolveOne(e) {
    if (hand[e.id]) return [hand[e.id], 'hand'];
    if (e.kind === 'testid' && e.testid) {
      const h = hookBy.get(e.testid);
      if (h?.v2 === 'historical') return [null, 'historical'];
      if (h && (h.v2 === 'stable' || h.v2 === 'new'))
        return [rowByTestid.get(e.testid) ?? `testid:${e.testid}`, 'same-testid'];
    }
    if (labelFiles.some((re) => re.test(e.file))) {
      const id = actionByLabel.get(normLabel(e.label));
      if (id) return [viaAction(id), 'registry-label'];
    }
    for (const [i, rule] of rules.entries())
      if (ruleMatches(rule, e)) return [rule.to, `rule#${i}`];
    return [null, null];
  }

  for (const e of frozen) {
    if (infra[e.id]) {
      excluded[e.id] = infra[e.id];
      continue;
    }
    const [t, how] = resolveOne(e);
    if (how === 'historical') excluded[e.id] = 'historical hook: no live element in v1';
    else if (!t) unmapped.push(e);
    else if (!valid(t)) invalid.push({ id: e.id, target: t });
    else {
      map[e.id] = t;
      via[e.id] = how;
    }
  }
  // A late entry that only re-keyed a frozen one (its component was renamed or split) keeps the
  // frozen entry's target: same kind, file and key (or testid), and the frozen id is gone from code.
  const gone = frozen.filter((f) => !live.has(f.id));
  for (const e of late) {
    if (infra[e.id]) {
      excluded[e.id] = infra[e.id];
      continue;
    }
    if (isV2Code(e)) {
      excluded[e.id] = 'v2 code (added after the freeze)';
      continue;
    }
    const twin = gone.find(
      (f) =>
        f.kind === e.kind &&
        f.file === e.file &&
        (e.testid ? f.testid === e.testid : keyOf(f.id) === keyOf(e.id))
    );
    if (twin && map[twin.id]) {
      map[e.id] = map[twin.id];
      via[e.id] = `continues ${twin.id}`;
      continue;
    }
    const [t, how] = resolveOne(e);
    if (how === 'historical') excluded[e.id] = 'historical hook: no live element in v1';
    else if (!t) unmapped.push(e);
    else if (!valid(t)) invalid.push({ id: e.id, target: t });
    else {
      map[e.id] = t;
      via[e.id] = how;
    }
  }
  return { map, excluded, via, unmapped, invalid };
}

/** Loads every input from the tree (registry through Node's type stripping). */
export async function loadInputs() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const nd = JSON.parse(readFileSync(ND, 'utf8'));
  const hooks = JSON.parse(readFileSync(TESTIDS, 'utf8'));
  const { ACTIONS_BY_ID } = await import(join(REPO, 'apps/studio/actions/index.ts'));
  const { scan } = await import('./scan-v1.mjs');
  const now = scan();
  const frozenIds = new Set(manifest.entries.map((e) => e.id));
  // client/v2/ was never v1 (the audit's own filter); the rest is decided by isV2Code
  const late = now
    .filter((e) => !frozenIds.has(e.id) && !e.file.includes('/client/v2/'))
    .map((e) => ({ ...e }));
  return {
    manifest,
    nd,
    hooks,
    actions: ACTIONS_BY_ID,
    frozen: manifest.entries,
    late,
    live: new Set(now.map((e) => e.id)),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const inp = await loadInputs();
  const res = mapEntries({ ...inp, rows: inp.nd.rows });
  const targets = Object.values(res.map);
  const count = (p) => targets.filter(p).length;
  const total = inp.frozen.length + inp.late.length;
  console.log(
    `entries ${total} (frozen ${inp.frozen.length} + late ${inp.late.length}) · excluded ${Object.keys(res.excluded).length} · mapped ${targets.length} (row ${count((t) => !t.includes(':'))}, action ${count((t) => t.startsWith('action:'))}, testid ${count((t) => t.startsWith('testid:'))}) · unmapped ${res.unmapped.length} · invalid ${res.invalid.length}`
  );
  for (const x of res.invalid) console.log(`  invalid target ${x.target} ← ${x.id}`);
  if (args.includes('--gaps')) {
    for (const e of res.unmapped) console.log(`${e.id}\t${e.label}`);
  } else {
    const by = {};
    for (const e of res.unmapped) {
      by[e.file] = by[e.file] ?? [];
      by[e.file].push(e);
    }
    for (const [f, l] of Object.entries(by).sort((a, b) => b[1].length - a[1].length))
      console.log(
        `  ${String(l.length).padStart(3)}  ${f}  e.g. ${l
          .slice(0, 3)
          .map((e) => keyOf(e.id))
          .join(', ')}`
      );
  }
  if (args.includes('--write')) {
    if (res.invalid.length) {
      console.error('refusing to write: invalid targets above');
      process.exit(1);
    }
    const sorted = (o) =>
      Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
    inp.nd.map = sorted(res.map);
    inp.nd.excluded = sorted(res.excluded);
    writeFileSync(ND, `${JSON.stringify(inp.nd, null, 2)}\n`);
    console.log('wrote map + excluded → apps/studio/client/v2/nothing-deleted.json');
  }
}
