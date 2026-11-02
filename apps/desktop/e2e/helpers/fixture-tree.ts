import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The lane-level net under `fixture-guard.ts`: the WHOLE shared fixture project, byte-exact.
//
// Per-spec guards cover the files a spec KNOWS it writes. They cannot cover the app: version
// history restores, canvas edits, "Move to Archive" and the rest write fixture files the spec never
// names, and every spec in the default lane shares ONE fixture project. So the launcher baselines the
// tree once (`onPrepare`), each spec's session starts from that baseline (`beforeSession`, before the
// app launches), and the run ends on it (`onComplete`) — `git status apps/desktop/e2e/fixtures` is
// clean after a lane, whatever failed in the middle.
//
// What counts as "the tree": everything under `fixtures/project` except entries whose name starts
// with `_` — the fixture's own `.design/.gitignore` rule for Maude runtime state (DDR-115), which the
// app regenerates on every boot and which must NOT be reset under a running sidecar.
//
// The baseline is also a sidecar on disk (gitignored `_e2e-evidence/`): a launcher killed mid-run
// leaves it behind, and the NEXT `onPrepare` repairs the tree from it BEFORE baselining — the same
// idea as fixture-guard, so one dirty run cannot become the next run's baseline.

const E2E_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TREE_ROOT = join(E2E_ROOT, 'fixtures', 'project');
const SIDECAR = join(E2E_ROOT, '_e2e-evidence', 'fixture-tree.json');

type Tree = { files: Record<string, string>; dirs: string[] };

function walk(dir: string, out: Tree): void {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_')) continue;
    const abs = join(dir, name);
    const rel = relative(TREE_ROOT, abs);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.dirs.push(rel);
      walk(abs, out);
    } else if (st.isFile()) {
      out.files[rel] = readFileSync(abs).toString('base64');
    }
  }
}

function read(): Tree {
  const tree: Tree = { files: {}, dirs: [] };
  if (existsSync(TREE_ROOT)) walk(TREE_ROOT, tree);
  return tree;
}

function apply(baseline: Tree): number {
  let changed = 0;
  const now = read();
  for (const rel of Object.keys(now.files)) {
    if (!(rel in baseline.files)) {
      rmSync(join(TREE_ROOT, rel), { force: true });
      changed += 1;
    }
  }
  for (const [rel, b64] of Object.entries(baseline.files)) {
    if (now.files[rel] === b64) continue;
    const abs = join(TREE_ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, Buffer.from(b64, 'base64'));
    changed += 1;
  }
  const keep = new Set(baseline.dirs);
  for (const rel of now.dirs.sort((a, b) => b.length - a.length)) {
    if (keep.has(rel)) continue;
    try {
      rmdirSync(join(TREE_ROOT, rel));
      changed += 1;
    } catch {
      // not empty: holds `_*` runtime state — leave it
    }
  }
  return changed;
}

function load(): Tree | null {
  if (!existsSync(SIDECAR)) return null;
  try {
    return JSON.parse(readFileSync(SIDECAR, 'utf8')) as Tree;
  } catch {
    return null;
  }
}

/**
 * Runtime state is the one thing the tree restore must not touch under a RUNNING sidecar — and the one thing that
 * leaks from one session into the next once none is running: `_trash` (a canvas an earlier spec trashed comes back as
 * an "In the trash" ghost beside the live one, and a click opens the trashed copy read-only — edit-artboards part 2),
 * `_canvas-state` (the open tabs and selection), `_history`, `_comments`, `_export-history.json`. Every spec session
 * starts from a project that has never been opened: call this BEFORE the app launches (`beforeSession`), never while
 * one runs. Returns the names it removed. `designRoot` is a parameter so a test can point it at a temp dir.
 */
export function resetFixtureRuntime(designRoot: string = join(TREE_ROOT, '.design')): string[] {
  if (!existsSync(designRoot)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(designRoot)) {
    if (!name.startsWith('_')) continue;
    rmSync(join(designRoot, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

/**
 * p8-e2e-fix-r10 — `git clean -fdx`, scoped to the fixture project: every untracked AND ignored file under it goes.
 *
 * The tree baseline is whatever is on disk when a lane starts, so a file nobody tracks became part of it and was
 * "restored" into every later spec — and an ignored one never even shows in `git status`. A stale, gitignored
 * `.claudeignore` (a `# maude:sync-untrusted` block a linked-mode run wrote into the repo fixture) made
 * photo-per-use red in the main checkout and never in a fresh worktree. Only what git tracks is the fixture; the
 * rest is a previous run. Call it only while no app runs (it also takes `_*` runtime state). Without git (an
 * unpacked tarball) it does nothing. Returns the repo-relative paths git removed. `treeRoot` is a parameter so a
 * test can point it at a throwaway repo.
 */
export function cleanFixtureUntracked(treeRoot: string = TREE_ROOT): string[] {
  if (!existsSync(treeRoot)) return [];
  // `-- .` from inside the fixture: git never looks above it, whatever the caller's cwd
  const r = spawnSync('git', ['clean', '-fdx', '--', '.'], { cwd: treeRoot, encoding: 'utf8' });
  if (r.status !== 0) {
    if (r.error || /not a git repository/i.test(r.stderr ?? '')) return [];
    throw new Error(`[fixture-tree] git clean failed in ${treeRoot}: ${(r.stderr ?? '').trim()}`);
  }
  return (r.stdout ?? '')
    .split('\n')
    .map((l) => l.replace(/^Removing /, '').trim())
    .filter(Boolean);
}

function cleanAndSay(when: string): void {
  const gone = cleanFixtureUntracked();
  if (gone.length)
    console.warn(`[fixture-tree] ${when}: removed untracked/ignored ${gone.join(', ')}`);
}

/**
 * Launcher, once per lane: repair a killed run's damage, drop what git does not track (`clean`, off under
 * MAUDE_E2E_KEEP_STATE — it takes `_*` runtime state too), then baseline the tree.
 */
export function baselineFixtureTree({ clean = true }: { clean?: boolean } = {}): void {
  const stale = load();
  if (stale) {
    const n = apply(stale);
    if (n > 0) console.warn(`[fixture-tree] previous lane did not restore; repaired ${n} entries.`);
  }
  if (clean) cleanAndSay('lane start');
  mkdirSync(dirname(SIDECAR), { recursive: true });
  writeFileSync(SIDECAR, JSON.stringify(read()));
}

/**
 * Put the tree back on the baseline. Idempotent; a no-op when no lane baselined it. `clean` (only while no app
 * runs — between specs) also drops every untracked/ignored file, `_*` runtime state included.
 */
export function restoreFixtureTree({ clean = false }: { clean?: boolean } = {}): void {
  const baseline = load();
  if (baseline) apply(baseline);
  if (clean) cleanAndSay('between specs');
}

/** Launcher, end of the lane: restore, then drop the sidecar. */
export function releaseFixtureTree(): void {
  restoreFixtureTree();
  rmSync(SIDECAR, { force: true });
}
