#!/usr/bin/env node
// index-test-leak.mjs — list (and with --apply, delete) the test projects that leaked into a machine
// index (P8, 2026-10-29). Studios booted by tests, e2e lanes, journeys and rigs without their own
// MAUDE_INDEX_DIR wrote their snapshots into ~/.maude/index/v1, and Home lists every one of them
// (2,292 entries on Michal's Mac, ~2,120 of them test copies). The harnesses now set a throwaway index;
// this cleans up what is already there.
//
//   node scripts/dev/index-test-leak.mjs [--index-dir DIR] [--registry FILE] [--json] [--apply]
//
// DRY RUN BY DEFAULT: prints counts per category plus a few samples, deletes nothing. An entry is a
// candidate only when its pid is NOT in the app registry (app-state.json `projects` keys, `recent`)
// and its root is not a registered root, AND either its root is a temp/test path or it has no
// index.json. `--apply` removes exactly the listed `projects/<pid>/` directories (never a symlink,
// never anything outside `<index-dir>/projects/`).
//
// Defaults: --index-dir ~/.maude/index/v1 · --registry ~/Library/Application Support/com.maude.app/app-state.json

import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PID_RE = /^l[0-9a-f]{16}$/;

/** Temp / test roots, in the order they are reported. First match names the category. */
export const CATEGORIES = [
  ['e2e-app', (r) => r.includes(`${sep}com.maude.app.e2e${sep}`)],
  ['worktree', (r) => r.includes(`${sep}.claude${sep}worktrees${sep}`)],
  ['agent-journeys', (r) => r.includes('maude-agent-journeys')],
  ['agent-evals', (r) => r.includes('maude-agent-evals')],
  ['var-folders', (r) => /^\/(private\/)?var\/folders\//.test(r)],
  ['tmp', (r) => /^\/(private\/)?tmp\//.test(r)],
];

export function categoryOf(root) {
  if (typeof root !== 'string' || !root) return null;
  for (const [name, test] of CATEGORIES) if (test(root)) return name;
  return null;
}

/** pids + roots the app knows (app-state.json). A missing/unreadable registry knows nothing. */
export function readRegistry(file) {
  const pids = new Set();
  const roots = new Set();
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { pids, roots, found: false };
  }
  const projects = raw?.projects;
  if (projects && typeof projects === 'object') {
    for (const [pid, p] of Object.entries(projects)) {
      pids.add(pid);
      if (typeof p?.pid === 'string') pids.add(p.pid);
      if (typeof p?.root === 'string') roots.add(p.root);
    }
  }
  for (const pid of Array.isArray(raw?.recent) ? raw.recent : [])
    if (typeof pid === 'string') pids.add(pid);
  for (const r of Array.isArray(raw?.recent_projects) ? raw.recent_projects : [])
    if (typeof r === 'string' && r.startsWith('/')) roots.add(r);
  return { pids, roots, found: true };
}

/** → { total, kept, candidates: [{ pid, dir, root, category }] } — reads only. */
export function scan(indexDir, registry) {
  const base = join(indexDir, 'projects');
  let names = [];
  try {
    names = readdirSync(base);
  } catch {
    return { total: 0, kept: 0, candidates: [] };
  }
  const candidates = [];
  let total = 0;
  for (const pid of names) {
    if (!PID_RE.test(pid)) continue;
    const dir = join(base, pid);
    const st = lstatSync(dir, { throwIfNoEntry: false });
    if (!st?.isDirectory() || st.isSymbolicLink()) continue;
    total++;
    if (registry.pids.has(pid)) continue;
    let root = null;
    let category = null;
    const snap = join(dir, 'index.json');
    if (!existsSync(snap)) category = 'no-index';
    else {
      try {
        root = JSON.parse(readFileSync(snap, 'utf8'))?.project?.root ?? null;
      } catch {
        root = null;
      }
      if (root && registry.roots.has(root)) continue;
      category = categoryOf(root);
    }
    if (category) candidates.push({ pid, dir, root, category });
  }
  return { total, kept: total - candidates.length, candidates };
}

/** Deletes exactly the candidates' dirs; refuses anything that is not `<indexDir>/projects/<pid>`. */
export function apply(indexDir, candidates) {
  const base = resolve(indexDir, 'projects') + sep;
  let removed = 0;
  for (const c of candidates) {
    const dir = resolve(c.dir);
    if (!dir.startsWith(base) || !PID_RE.test(dir.slice(base.length))) {
      throw new Error(`refusing to delete ${dir}: not an index project dir`);
    }
    const st = lstatSync(dir, { throwIfNoEntry: false });
    if (!st?.isDirectory() || st.isSymbolicLink()) continue;
    rmSync(dir, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

export function summarize(result, { samples = 3 } = {}) {
  const by = {};
  for (const c of result.candidates) {
    by[c.category] ??= { count: 0, gone: 0, samples: [] };
    const b = by[c.category];
    b.count++;
    if (c.root && !existsSync(c.root)) b.gone++;
    if (b.samples.length < samples) b.samples.push(c.root ?? c.pid);
  }
  return { total: result.total, kept: result.kept, candidates: result.candidates.length, by };
}

function main(argv) {
  const opt = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const indexDir = resolve(opt('index-dir', join(homedir(), '.maude', 'index', 'v1')));
  const registryFile = resolve(
    opt(
      'registry',
      join(homedir(), 'Library', 'Application Support', 'com.maude.app', 'app-state.json')
    )
  );
  const registry = readRegistry(registryFile);
  if (!registry.found && argv.includes('--apply')) {
    console.error(
      `no readable registry at ${registryFile} — refusing --apply (every project would look unregistered)`
    );
    process.exit(2);
  }
  const result = scan(indexDir, registry);
  const sum = summarize(result);
  if (argv.includes('--json')) console.log(JSON.stringify(sum, null, 2));
  else {
    console.log(`index ${indexDir}`);
    console.log(
      `registry ${registryFile} (${registry.found ? `${registry.pids.size} pids` : 'NOT FOUND'})`
    );
    console.log(`${sum.total} projects · ${sum.kept} kept · ${sum.candidates} test leftovers`);
    for (const [cat, b] of Object.entries(sum.by))
      console.log(
        `  ${cat.padEnd(15)} ${String(b.count).padStart(5)}  (root gone: ${b.gone})  e.g. ${b.samples.join(' · ')}`
      );
  }
  if (argv.includes('--apply')) {
    const n = apply(indexDir, result.candidates);
    console.log(`removed ${n} project dirs`);
  } else if (sum.candidates) console.log('dry run — nothing deleted (re-run with --apply)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
