// home/index-gc.ts — the machine index's project GC (V2-1.17 §5.6 "GC (Home server, at boot and daily…)"; p8-port-gc).
//
// Rule (Michal, 2026-10-29): `<index>/projects/<pid>/` is deleted when the pid is NOT in the app registry and
//   - stale: nothing in it was written for 30 days (the newest of the dir, its top-level entries and the snapshot's
//     `writer.at` — every project server writes there when it opens the project), or
//   - gone:  the snapshot's project root no longer exists.
// A registered pid is never deleted, gone or not: Home shows "isn't where it was" for it (V2-1.1). A snapshot that
// names a registered root is kept too, whatever its pid (a belt against a pid derivation drifting).
//
// The registry is Rust's (app-state.json): it reaches the Home server only over the internal bearer route
// (`POST /_home/internal/index-gc`, home.rs `run_index_gc`, at every Home boot and daily) — never from a page.
//
// Deletion is fenced the way scripts/dev/index-test-leak.mjs `apply()` is: only `<index>/projects/<pid>` with a
// pid-shaped last segment, never a symlink, never a registered pid, never when `projects/` itself is a symlink —
// and every candidate is checked BEFORE the first delete, so a refusal deletes nothing.
//
//   bun apps/studio/home/index-gc.ts --dry-run [--index-dir DIR] [--registry FILE] [--json]
// prints what the GC WOULD delete; it reads only and has no apply mode (the Home server is the one deleter).

import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { indexDir as machineIndexDir } from '../index/snapshot.ts';
import { PID_RE } from './pid.ts';
import type { HomeAnswer } from './signin.ts';

/** §5.6: "not opened for 30 days". */
export const GC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type GcReason = 'stale' | 'gone';

export interface GcCandidate {
  pid: string;
  dir: string;
  reason: GcReason;
  root?: string | null;
  lastActiveMs?: number;
}

/** The app registry as the GC sees it: every registered pid, and every registered root. */
export interface GcRegistry {
  pids: ReadonlySet<string>;
  roots: ReadonlySet<string>;
}

export interface GcPlan {
  total: number;
  kept: number;
  candidates: GcCandidate[];
}

function mtimeMs(p: string): number {
  return lstatSync(p, { throwIfNoEntry: false })?.mtimeMs ?? 0;
}

function readSnap(dir: string): { root: string | null; at: number } | null {
  const file = path.join(dir, 'index.json');
  const st = lstatSync(file, { throwIfNoEntry: false });
  if (!st?.isFile()) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const root = typeof raw?.project?.root === 'string' ? raw.project.root : null;
    const at = Number(raw?.writer?.at);
    return { root, at: Number.isFinite(at) ? at : 0 };
  } catch {
    return { root: null, at: 0 };
  }
}

function rootGone(root: string): boolean {
  if (!path.isAbsolute(root)) return false; // no usable root: the age rule alone decides
  try {
    realpathSync(root);
    return false;
  } catch (e) {
    return (
      (e as { code?: string }).code === 'ENOENT' || (e as { code?: string }).code === 'ENOTDIR'
    );
  }
}

/** Reads only. → every `projects/<pid>/` dir counted, and the ones the rule would delete. */
export function planIndexGc(
  indexDir: string,
  registry: GcRegistry,
  now = Date.now(),
  maxAgeMs = GC_MAX_AGE_MS
): GcPlan {
  const base = path.join(indexDir, 'projects');
  let names: string[] = [];
  try {
    names = readdirSync(base);
  } catch {
    return { total: 0, kept: 0, candidates: [] };
  }
  const candidates: GcCandidate[] = [];
  let total = 0;
  for (const pid of names) {
    if (!PID_RE.test(pid)) continue;
    const dir = path.join(base, pid);
    const st = lstatSync(dir, { throwIfNoEntry: false });
    if (!st?.isDirectory() || st.isSymbolicLink()) continue;
    total++;
    if (registry.pids.has(pid)) continue;
    const snap = readSnap(dir);
    const root = snap?.root ?? null;
    if (root && registry.roots.has(root)) continue;
    if (root && rootGone(root)) {
      candidates.push({ pid, dir, reason: 'gone', root });
      continue;
    }
    let last = Math.max(st.mtimeMs, snap?.at ?? 0);
    try {
      for (const f of readdirSync(dir)) last = Math.max(last, mtimeMs(path.join(dir, f)));
    } catch {
      // unreadable inside: the dir's own mtime decides
    }
    if (now - last > maxAgeMs)
      candidates.push({ pid, dir, reason: 'stale', root, lastActiveMs: last });
  }
  return { total, kept: total - candidates.length, candidates };
}

/**
 * Deletes exactly the candidates' dirs. Throws — before deleting anything — on any candidate that is not
 * `<indexDir>/projects/<pid>` (pid-shaped, registry-free), or when `projects/` is itself a symlink.
 */
export function applyIndexGc(
  indexDir: string,
  candidates: GcCandidate[],
  registry: GcRegistry
): number {
  const projects = path.resolve(indexDir, 'projects');
  const pst = lstatSync(projects, { throwIfNoEntry: false });
  if (!pst) return 0;
  if (pst.isSymbolicLink() || !pst.isDirectory())
    throw new Error(`refusing to GC ${projects}: not a real directory`);
  const base = projects + path.sep;
  const dirs: string[] = [];
  for (const c of candidates) {
    const dir = path.resolve(c.dir);
    const name = dir.startsWith(base) ? dir.slice(base.length) : '';
    if (!PID_RE.test(name) || name !== c.pid || registry.pids.has(name))
      throw new Error(`refusing to delete ${dir}: not an unregistered index project dir`);
    dirs.push(dir);
  }
  let removed = 0;
  for (const dir of dirs) {
    const st = lstatSync(dir, { throwIfNoEntry: false });
    if (!st?.isDirectory() || st.isSymbolicLink()) continue;
    rmSync(dir, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

export interface GcResult {
  total: number;
  kept: number;
  removed: number;
  byReason: Record<GcReason, number>;
}

function byReason(candidates: GcCandidate[]): Record<GcReason, number> {
  const out: Record<GcReason, number> = { stale: 0, gone: 0 };
  for (const c of candidates) out[c.reason]++;
  return out;
}

/** Plan + apply — what the Home server runs at boot and daily. */
export function runIndexGc(indexDir: string, registry: GcRegistry, now = Date.now()): GcResult {
  const plan = planIndexGc(indexDir, registry, now);
  const removed = applyIndexGc(indexDir, plan.candidates, registry);
  return { total: plan.total, kept: plan.kept, removed, byReason: byReason(plan.candidates) };
}

/** The most registry entries one GC call carries (a registry is a handful of projects; this only bounds a body). */
export const MAX_GC_ENTRIES = 10_000;

/**
 * `POST /_home/internal/index-gc {pids, roots?}` (bearer — Rust only, home.rs `run_index_gc`). A body without a
 * pid list runs nothing: an absent list must never read as "nothing is registered".
 */
export function indexGcRequest(body: unknown, indexDir = machineIndexDir()): HomeAnswer {
  const b = (body ?? {}) as { pids?: unknown; roots?: unknown };
  const pids = b.pids;
  const roots = b.roots ?? [];
  if (
    !Array.isArray(pids) ||
    pids.length > MAX_GC_ENTRIES ||
    !pids.every((p) => typeof p === 'string' && PID_RE.test(p))
  )
    return { status: 400, body: { error: 'bad pids' } };
  if (
    !Array.isArray(roots) ||
    roots.length > MAX_GC_ENTRIES ||
    !roots.every((r) => typeof r === 'string' && path.isAbsolute(r))
  )
    return { status: 400, body: { error: 'bad roots' } };
  try {
    return {
      status: 200,
      body: runIndexGc(indexDir, {
        pids: new Set(pids as string[]),
        roots: new Set(roots as string[]),
      }),
    };
  } catch (e) {
    return { status: 500, body: { error: (e as Error).message } };
  }
}

// ── the read-only report (Michal's real index, before the GC ever runs there) ─────────────────────────────────

/** pids + roots from app-state.json — read only. */
export function readRegistryFile(file: string): (GcRegistry & { found: true }) | { found: false } {
  let raw: { projects?: Record<string, { root?: unknown }>; recent?: unknown };
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { found: false };
  }
  const pids = new Set<string>();
  const roots = new Set<string>();
  for (const [pid, p] of Object.entries(raw?.projects ?? {})) {
    pids.add(pid);
    if (typeof p?.root === 'string') roots.add(p.root);
  }
  for (const p of Array.isArray(raw?.recent) ? raw.recent : [])
    if (typeof p === 'string') pids.add(p);
  return { found: true, pids, roots };
}

function main(argv: string[]) {
  const opt = (name: string, dflt: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  if (!argv.includes('--dry-run')) {
    console.error(
      'index-gc: report only — pass --dry-run. The Home server is the one that deletes.'
    );
    process.exit(2);
  }
  const indexDir = path.resolve(opt('index-dir', path.join(homedir(), '.maude', 'index', 'v1')));
  const registryFile = path.resolve(
    opt(
      'registry',
      path.join(homedir(), 'Library', 'Application Support', 'com.maude.app', 'app-state.json')
    )
  );
  const reg = readRegistryFile(registryFile);
  if (!reg.found) {
    console.error(
      `index-gc: no readable registry at ${registryFile} — every project would look unregistered`
    );
    process.exit(2);
  }
  const plan = planIndexGc(indexDir, reg);
  const report = {
    index: indexDir,
    registry: registryFile,
    registeredPids: reg.pids.size,
    total: plan.total,
    kept: plan.kept,
    wouldDelete: plan.candidates.length,
    byReason: byReason(plan.candidates),
    candidates: plan.candidates.map((c) => ({
      pid: c.pid,
      reason: c.reason,
      root: c.root ?? null,
      lastActive: c.lastActiveMs ? new Date(c.lastActiveMs).toISOString() : null,
    })),
  };
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`index ${indexDir} · registry ${registryFile} (${reg.pids.size} pids)`);
    console.log(
      `${report.total} projects · ${report.kept} kept · would delete ${report.wouldDelete} (stale ${report.byReason.stale}, gone ${report.byReason.gone})`
    );
    for (const c of report.candidates)
      console.log(`  ${c.reason.padEnd(5)} ${c.pid} ${c.root ?? '(no root)'}`);
    console.log('dry run — nothing deleted');
  }
}

if (import.meta.main) main(process.argv.slice(2));
