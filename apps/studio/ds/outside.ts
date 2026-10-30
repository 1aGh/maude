// The outside-change watcher — V2-1.6 §5.10 `outside` + §5.11 (a), S10.3.
//
// A converted system's working files can change behind the studio's back: Claude Code edits the
// CSS, a `git pull` lands, a peer's file plane delivers. `engine.state(ds).outside` compares the
// working files against `base` the moment it is asked; this module decides WHEN that comparison is
// worth showing, and WHO made the change.
//
// When: only after the system folder (`<ds.path>/…`) has been quiet for W = 5 s — no fs event and
// no inbound delivery under that prefix. Plane B carries no order across files, so a peer that
// receives a publish may see `head.json` before or after the working files; mid-way the working
// files differ from whichever `base` is on disk. The quiet window absorbs that: once everything
// has landed the working files equal the new base and there is nothing to review (I #4).
//
// Who (per working file, kept per Mac in `_state/ds-outside/<ds>.json`, keyed by the file's
// sha256 so the answer is stable across re-evaluations and restarts):
//   peer     — a file-plane delivery reported through `notify(rel, {kind:'peer', name})`;
//   agent    — the design plugin's post-edit hook recorded the file (`_runs/<session>/touched.json`)
//              within a few seconds of its mtime → "Claude Code";
//   git      — git HEAD moved since this watcher last looked and the file differs → the author of
//              the last commit that touched it;
//   unknown  — otherwise.
// Names are data (DDR-172 D8): shown, never obeyed.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { atomicWrite } from '../sync/atomic-write.ts';
import type { DsEngine, DsState } from './engine.ts';

/** W — the quiet window (V2-1.6 §5.10). */
export const OUTSIDE_QUIET_MS = 5_000;
/** how far a hook's `touched.json` `at` may sit from the file's mtime and still name it */
const AGENT_SLACK_MS = 10_000;
const NAME_MAX = 64;

export type OutsideSourceKind = 'agent' | 'git' | 'peer' | 'unknown';

export interface OutsideSource {
  kind: OutsideSourceKind;
  name?: string;
}

export interface OutsideFile {
  /** system-folder-relative (`colors_and_type.css`) */
  path: string;
  source: OutsideSource;
  at: string;
}

/** The §5.11 (a) review — what the DS bar's "Changed outside" offers Keep / Undo on. */
export interface OutsideReview {
  kind: 'ds-outside';
  system: string;
  base: string | null;
  files: OutsideFile[];
  changes: NonNullable<DsState['outside']>['changes'];
  otherChanges: NonNullable<DsState['outside']>['otherChanges'];
  conflicts: DsState['conflicts'];
}

export interface OutsideOptions {
  designRoot: string;
  engine: Pick<DsEngine, 'systems' | 'state' | 'workingHashes'>;
  quietMs?: number;
  now?: () => number;
  /** the hook's records of `rel` (design-root-relative) — default: `_runs/<session>/touched.json` */
  agentTouch?: (rel: string) => { at: number; by?: string } | null;
  /** git HEAD now (null = not a git checkout) — default: `git rev-parse HEAD` */
  gitHead?: () => string | null;
  /** the author of the last commit that touched `abs` — default: `git log -1 --format=%an` */
  gitAuthor?: (abs: string) => string | null;
  /** a review is ready (or cleared: null) — the studio emits `ds:outside {system}` */
  onChange?: (system: string, review: OutsideReview | null) => void;
  log?: Pick<Console, 'warn'>;
}

interface Tracked {
  /** last fs event / delivery under the prefix */
  lastActivity: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** deliveries since the last evaluation, by system-relative file */
  peers: Map<string, OutsideSource>;
  /** the last evaluated answer, valid until the next activity */
  review: OutsideReview | null;
  evaluated: boolean;
}

interface StoredFile {
  path: string;
  sha256: string;
  source: OutsideSource;
  at: string;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const cleanName = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim();
  return s ? s.slice(0, NAME_MAX) : undefined;
};

function readJson(abs: string): unknown {
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

/** The design plugin's post-edit records (cli/lib/design-hook.mjs `recordTouch`). */
export function hookTouches(
  designRoot: string
): (rel: string) => { at: number; by?: string } | null {
  return (rel) => {
    const runs = path.join(designRoot, '_runs');
    let best: { at: number; by?: string } | null = null;
    let dirs: string[] = [];
    try {
      dirs = readdirSync(runs);
    } catch {
      return null;
    }
    for (const d of dirs) {
      const t = readJson(path.join(runs, d, 'touched.json'));
      const e = isObj(t) ? t[rel] : null;
      if (!isObj(e) || typeof e.at !== 'number') continue;
      if (!best || e.at > best.at)
        best = { at: e.at, ...(typeof e.by === 'string' ? { by: e.by } : {}) };
    }
    return best;
  };
}

function gitOut(cwd: string, args: string[]): string | null {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 3_000 });
    if (r.status !== 0) return null;
    const s = String(r.stdout).trim();
    return s || null;
  } catch {
    return null;
  }
}

export function createDsOutsideWatcher(opts: OutsideOptions) {
  const designRoot = path.resolve(opts.designRoot);
  const quietMs = opts.quietMs ?? OUTSIDE_QUIET_MS;
  const now = opts.now ?? Date.now;
  const agentTouch = opts.agentTouch ?? hookTouches(designRoot);
  const gitHead = opts.gitHead ?? (() => gitOut(designRoot, ['rev-parse', 'HEAD']));
  const gitAuthor =
    opts.gitAuthor ??
    ((abs: string) =>
      gitOut(path.dirname(abs), ['log', '-1', '--format=%an', '--', path.basename(abs)]));
  const tracked = new Map<string, Tracked>();
  let lastGitHead: string | null | undefined;
  let stopped = false;

  const stateFile = (ds: string) => path.join(designRoot, '_state', 'ds-outside', `${ds}.json`);

  function track(ds: string): Tracked {
    let t = tracked.get(ds);
    if (!t) {
      t = { lastActivity: 0, timer: null, peers: new Map(), review: null, evaluated: false };
      tracked.set(ds, t);
    }
    return t;
  }

  function systemOf(rel: string): { name: string; path: string } | null {
    const r = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
    for (const s of opts.engine.systems()) if (r.startsWith(`${s.path}/`)) return s;
    return null;
  }

  function readStored(ds: string): StoredFile[] {
    const v = readJson(stateFile(ds));
    if (!isObj(v) || v.v !== 1 || !Array.isArray(v.files)) return [];
    return (v.files as unknown[]).filter(
      (f): f is StoredFile =>
        isObj(f) &&
        typeof f.path === 'string' &&
        typeof f.sha256 === 'string' &&
        isObj(f.source) &&
        typeof f.at === 'string'
    );
  }

  function writeStored(ds: string, base: string | null, files: StoredFile[] | null) {
    const abs = stateFile(ds);
    try {
      if (!files) {
        if (existsSync(abs)) unlinkSync(abs);
        return;
      }
      mkdirSync(path.dirname(abs), { recursive: true });
      atomicWrite(
        abs,
        `${JSON.stringify({ format: 'maude.ds-outside', v: 1, system: ds, base, files }, null, 2)}\n`
      );
    } catch (err) {
      opts.log?.warn?.(`[ds] could not record who changed ${ds}: ${String(err).slice(0, 120)}`);
    }
  }

  function attribute(
    sys: { name: string; path: string },
    file: string,
    t: Tracked,
    gitMoved: boolean
  ): { source: OutsideSource; at: string } {
    const abs = path.join(designRoot, sys.path, file);
    let mtime = now();
    try {
      mtime = statSync(abs).mtimeMs;
    } catch {
      /* deleted: attribute at now */
    }
    const at = new Date(mtime).toISOString();
    const peer = t.peers.get(file);
    if (peer) return { source: peer, at };
    const touch = agentTouch(`${sys.path}/${file}`);
    if (touch && Math.abs(touch.at - mtime) <= AGENT_SLACK_MS)
      return { source: { kind: 'agent', name: 'Claude Code' }, at };
    if (gitMoved) {
      const name = cleanName(gitAuthor(abs));
      if (name) return { source: { kind: 'git', name }, at };
    }
    return { source: { kind: 'unknown' }, at };
  }

  /** Evaluate now (the timer, a lazy read, tests). */
  function evaluate(ds: string): OutsideReview | null {
    const t = track(ds);
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
    const sys = opts.engine.systems().find((s) => s.name === ds);
    if (!sys) return null;
    let st: DsState;
    try {
      st = opts.engine.state(ds);
    } catch (err) {
      opts.log?.warn?.(`[ds] outside check of ${ds} failed: ${String(err).slice(0, 120)}`);
      return null;
    }
    const prev = t.review;
    // HEAD is read on every look, so a pull between two looks reads as one
    const head = gitHead();
    const gitMoved = lastGitHead !== undefined && head !== null && head !== lastGitHead;
    lastGitHead = head;
    if (!st.outside) {
      t.review = null;
      t.evaluated = true;
      t.peers.clear();
      if (readStored(ds).length) writeStored(ds, null, null);
      if (prev) opts.onChange?.(ds, null);
      return null;
    }
    const hashes = opts.engine.workingHashes(ds) as Record<string, string>;
    const stored = new Map(readStored(ds).map((f) => [`${f.path}\0${f.sha256}`, f]));
    const files: StoredFile[] = [];
    for (const file of st.outside.files) {
      const sha = hashes[file] ?? 'absent';
      const keep = stored.get(`${file}\0${sha}`);
      if (keep && !t.peers.has(file)) files.push(keep);
      else files.push({ path: file, sha256: sha, ...attribute(sys, file, t, gitMoved) });
    }
    t.peers.clear();
    writeStored(ds, st.base, files);
    const review: OutsideReview = {
      kind: 'ds-outside',
      system: ds,
      base: st.base,
      files: files.map(({ path: p, source, at }) => ({ path: p, source, at })),
      changes: st.outside.changes,
      otherChanges: st.outside.otherChanges,
      conflicts: st.conflicts,
    };
    t.review = review;
    t.evaluated = true;
    if (JSON.stringify(prev) !== JSON.stringify(review)) opts.onChange?.(ds, review);
    return review;
  }

  function quiet(ds: string): boolean {
    const t = tracked.get(ds);
    return !t || now() - t.lastActivity >= quietMs;
  }

  return {
    quietMs,
    /**
     * An fs event or an inbound delivery for design-root-relative `rel`. A delivery passes its
     * source (`{kind:'peer', name}`); an fs event passes none.
     */
    notify(rel: string, source?: OutsideSource): void {
      if (stopped) return;
      const sys = systemOf(rel);
      if (!sys) return;
      const t = track(sys.name);
      t.lastActivity = now();
      t.evaluated = false;
      if (source?.kind === 'peer') {
        const file = String(rel)
          .replace(/\\/g, '/')
          .replace(/^\/+/, '')
          .slice(sys.path.length + 1);
        const name = cleanName(source.name);
        t.peers.set(file, { kind: 'peer', ...(name ? { name } : {}) });
      }
      if (t.timer) clearTimeout(t.timer);
      t.timer = setTimeout(() => {
        t.timer = null;
        if (!stopped) evaluate(sys.name);
      }, quietMs);
      (t.timer as { unref?: () => void }).unref?.();
    },
    /** Has `<ds.path>/` been quiet for W? */
    quiet,
    /** The review to show, or null — never while the folder is still settling. */
    review(ds: string): OutsideReview | null {
      if (!quiet(ds)) return null;
      const t = track(ds);
      return t.evaluated ? t.review : evaluate(ds);
    },
    evaluate,
    /** A Keep / Undo / publish changed what the working files are compared with: re-read. */
    invalidate(ds: string): void {
      const t = tracked.get(ds);
      if (t) t.evaluated = false;
    },
    stop(): void {
      stopped = true;
      for (const t of tracked.values()) if (t.timer) clearTimeout(t.timer);
      tracked.clear();
    },
  };
}

export type DsOutsideWatcher = ReturnType<typeof createDsOutsideWatcher>;
