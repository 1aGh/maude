// Phase 27 (epic E2) — git service for the in-UI git-awareness layer.
//
// Wraps `isomorphic-git` (DDR-107) so the `/_api/git/*` endpoints can answer the
// non-technical persona's only real question — "what have I changed, and how do
// I Save / Publish / Get latest?" — WITHOUT a terminal. Vocabulary is enforced at
// the UI layer (Save version=commit · Publish=push · Get latest=pull · History=
// log); this module speaks plain git internally and never leaks the words.
//
// Two engines, one surface (Task 3 gotcha):
//   • DEFAULT — pure-JS isomorphic-git. Zero system-git dependency, so a managed
//     clone works on a machine without git installed (the non-technical default).
//   • MAUDE_USE_SYSTEM_GIT=1 — shell out to the `git` binary via Bun.spawn (the
//     api.ts gitCurrentUser pattern). For users who prefer their configured
//     credential helper / SSH agent over a request-body token.
//
// `dir` is the git WORKING DIRECTORY (the repo root that holds `.git`), NOT the
// designRoot. For a managed Maude project (DDR-111) the cloned repo IS the
// project, so dir === repoRoot. A `designPrefix` (the designRoot's path relative
// to the repo, e.g. ".design") scopes status/diff to the user's design files so
// unrelated repo churn never shows up in the non-technical Changes panel.
//
// SECURITY: the GitHub token reaches gitPush/gitPull as an argument and is used
// ONLY for the isomorphic-git `onAuth` callback (or the system-git remote URL).
// It is NEVER logged, persisted, or written to `_server.json`. The endpoint layer
// (http.ts) keeps it main-origin-only + loopback-only (DDR-054 / DDR-109).

import { spawn } from 'node:child_process';
import fs, { existsSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import { gitLogArgs, gitLogEnv, parseGitLog } from './log-format.ts';
import { withRepoLock } from './repo-lock.ts';
import { safeGitPrefix } from './safe-rel.ts';

// Read LIVE, not as a module-load const — the same reason `noSystemGit()` below
// is a function, and a sharper one since Cloud Phase 27 D2: a CELL now runs with
// this forced on (studio-child.mjs), so the system-git write paths stopped being
// an opt-in escape hatch and became what every cloud tenant's saves go through.
// A module-load const cannot be scoped around a test, which is how those paths
// came to have no coverage at all while the iso ones had plenty.
const systemGitForced = (): boolean =>
  /^(1|true|on|yes)$/i.test(process.env.MAUDE_USE_SYSTEM_GIT ?? '');
// DDR-133 (DDR-107 end-state): auto-prefer a detected system `git` for the NETWORK
// paths (gitFetchRemote / remoteAheadBehind — native fetch is instant + uses the
// user's own credential helper / SSH agent) AND the READ paths (status / list-
// branches / log / diff / show / unpushed / current-branch). The pure-JS iso engine
// is genuinely slow on a real-world repo — and worse, `git.statusMatrix` /
// `git.listBranches` can throw on some trees ("No obj for …") and wedge the 10 s
// Bun.serve idle window, which is exactly what made the switcher's branch list
// vanish + the dropdown hang. System git's `status --porcelain` / `for-each-ref`
// are instant and don't have that failure mode. iso remains the fallback when no
// `git` is on PATH (the zero-setup promise) and still backs the WRITE paths
// (commit / checkout / branch / fold / push / pull) unless forced. MAUDE_USE_SYSTEM_GIT=1
// forces system git everywhere; MAUDE_NO_SYSTEM_GIT=1 pins everything to iso
// (escape hatch / deterministic test engine).
// Read live (not a module-load const) so a test can scope MAUDE_NO_SYSTEM_GIT around
// a single assertion to deterministically exercise the iso engine without leaking.
const noSystemGit = (): boolean => /^(1|true|on|yes)$/i.test(process.env.MAUDE_NO_SYSTEM_GIT ?? '');
let systemGitProbe: Promise<boolean> | undefined;
/** True when a usable `git` binary is on PATH. Memoized per process — the sidecar
 *  respawns per repo (DDR-132), so one `git --version` probe per process is correct
 *  and cheap. The probe NEVER relaxes the DDR-131 transport gate: callers classify
 *  the remote URL first; this only picks which engine runs an already-vetted op. */
function systemGitAvailable(): Promise<boolean> {
  if (systemGitForced()) return Promise.resolve(true);
  if (noSystemGit()) return Promise.resolve(false);
  if (!systemGitProbe) {
    systemGitProbe = runGit(process.cwd(), ['--version'], undefined, 4000)
      .then((r) => r.code === 0 && /git version/i.test(r.stdout))
      .catch(() => false);
  }
  return systemGitProbe;
}

// ── one writer at a time (Cloud Phase 27 D2) ─────────────────────────────────
//
// In a CELL this process shares the checkout with the hub, which commits
// autosaves on its own clock. Every verb below either rewrites the working tree
// or the index, so each one runs under the cross-process advisory lock — held
// for the WHOLE verb, not per git invocation, because the dangerous unit is a
// sequence (`checkout main` → `merge` → `branch -D` in a fold, `add` → `commit`
// in the autocommit). On a desktop the lock is uncontended and costs a file
// create.
//
// A verb that cannot get the lock REFUSES in its own shape rather than throwing:
// these results reach a panel, and "somebody else is saving" is a sentence a
// designer can act on, where a 500 is not.
const REPO_BUSY = 'Somebody else is saving this project right now — try again in a moment.';

function underRepoLock<T>(
  dir: string,
  op: string,
  fn: () => Promise<T>,
  busy: () => T
): Promise<T> {
  return withRepoLock(dir, `studio:${op}`, fn).catch((err) => {
    console.warn(`[git] ${op} could not take the repo lock: ${(err as Error).message}`);
    return busy();
  });
}

const TIMED_OUT = Symbol('maude-git-timeout');
/** Race `p` against a timeout. Returns `TIMED_OUT` if the deadline wins; a late
 *  rejection from the losing promise is swallowed so it never surfaces as an
 *  unhandledRejection. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  p.catch(() => {});
  let timer: ReturnType<typeof setTimeout>;
  const t = new Promise<typeof TIMED_OUT>((res) => {
    timer = setTimeout(() => res(TIMED_OUT), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** Bounds for the two unbounded network paths (DDR-133). A stalled remote must
 *  surface a fast, friendly result instead of hanging the popup / the unattended
 *  status poll. */
const FETCH_TIMEOUT_MS = 12_000;
const PROBE_TIMEOUT_MS = 8_000;

/** One changed file as the Changes panel renders it. `status` maps to the M/A/D/U
 *  badge (DDR-075 status hues): modified→M, added→A, deleted→D, untracked→U. */
export type GitFileState = 'modified' | 'added' | 'deleted' | 'untracked';

export interface GitFileStatus {
  /** Path relative to the git working dir, forward-slashed (e.g. `.design/ui/Pricing v3.tsx`). */
  path: string;
  status: GitFileState;
}

export interface GitStatusResult {
  /** False when `dir` is not inside a git repo — the UI shows the "not versioned yet" state. */
  repo: boolean;
  branch: string | null;
  files: GitFileStatus[];
  clean: boolean;
  /** LOCAL count of saved versions not yet published (commits ahead of the
   *  remote-tracking ref) — computed with NO network, so the panel can offer
   *  Publish even when the working tree is clean. 0 = up to date / no remote. */
  unpushed: number;
  /** Populated only when a remote check was requested (token given + `checkRemote`). */
  ahead?: number;
  behind?: number;
  remoteAhead?: boolean;
}

export interface GitStatusOpts {
  /** Scope status to files under this repo-relative prefix (the designRoot). Omit = whole repo. */
  designPrefix?: string;
  /** When true AND `token` given, fetch the tracking remote and compute ahead/behind. */
  checkRemote?: boolean;
  token?: string;
  remote?: string;
}

export interface GitCommitResult {
  ok: boolean;
  sha?: string;
  error?: string;
}

export interface GitPushResult {
  ok: boolean;
  /** True when the remote rejected a non-fast-forward push — the only Publish conflict. */
  conflict?: boolean;
  /** True when the operation needs a GitHub sign-in we don't have yet (phase-28
   *  keychain). The iso-git engine can't use a system credential helper, so a
   *  tokenless publish on the default engine lands here → "Sign in to publish". */
  authRequired?: boolean;
  error?: string;
}

export interface GitPullResult {
  ok: boolean;
  /** True when the merge hit a real content conflict; `files` lists the conflicted paths. */
  conflict?: boolean;
  files?: string[];
  /** See GitPushResult.authRequired. */
  authRequired?: boolean;
  error?: string;
}

export interface GitResolveResult {
  ok: boolean;
  /** Conflicted paths that still couldn't be auto-resolved (empty on success). */
  unresolved?: string[];
  /** "Keep both" copies written alongside (zero data loss). */
  copies?: string[];
  /** See GitPushResult.authRequired. */
  authRequired?: boolean;
  error?: string;
}

export type ResolveChoice = 'mine' | 'theirs' | 'both';

export interface GitLogEntry {
  sha: string;
  message: string;
  author: string;
  email: string;
  /** ISO-8601 commit date. */
  date: string;
}

export interface GitDiffEntry {
  file: string;
  before: string;
  after: 'workdir';
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Resolve the `.git` dir for `dir`, or null if `dir` isn't in a git repo. We
 *  only support a `.git` directly at `dir` (the managed-clone layout, DDR-111) —
 *  no walk-up, so a `.design/` nested in a larger repo doesn't accidentally
 *  surface the parent repo's unrelated history. */
function isRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

/** Normalize a status-matrix prefix: strip leading/trailing slashes, forward-slash. */
/**
 * The design-root containment prefix, normalised and VALIDATED (F-13/B12).
 *
 * This used to strip slashes and nothing else, so a `designRoot` of
 * `../../..` normalised to `../../..` and `underPrefix` then matched nothing —
 * or, on the staging side, named files outside the design root entirely. The
 * rules live in `safe-rel.ts`; see its docblock for why containment (not argv)
 * is the risk here.
 *
 * A REFUSED prefix falls back to `'.design'`, never to `''`. Empty means "no
 * containment filter at all", so treating a hostile value as absent would
 * WIDEN the scope to the whole repository — the opposite of what refusing it
 * is for.
 */
function normPrefix(p?: string): string {
  const safe = safeGitPrefix(p);
  if (safe !== null) return safe;
  console.warn(
    `[git] refusing an unsafe design-root prefix (${JSON.stringify(p)}) — falling back to '.design'`
  );
  return '.design';
}

function underPrefix(filepath: string, prefix: string): boolean {
  if (!prefix) return true;
  return filepath === prefix || filepath.startsWith(`${prefix}/`);
}

/** Maude's own per-machine / per-user runtime state under the design root —
 *  NEVER versioned design content. It must never surface in the Changes panel
 *  nor be swept up by a "Save all" commit. The canonical IGNORED set is the
 *  DDR-115 taxonomy (also mirrored by `cli/lib/gitignore-block.mjs` + the repo
 *  `.gitignore`). A real managed project gitignores these; this is the backstop
 *  for a project that lacks the gitignore block.
 *
 *  DDR-115 divergence — the rule used to claim BOTH comments and annotations
 *  were versionable. It now splits:
 *    - `*.annotations.json` (v1: `.svg`) → VERSIONED (durable visual markup, no other
 *      transport) → NOT hidden here.
 *    - `_comments/`        → hub-sync-only (DDR-102 CRDT) → HIDDEN, so it never
 *      double-transports through git. */
/** Exported for the test that guards the D3 per-member sibling: three separate
 *  lists have to agree on what runtime state IS, and they silently did not. */
export function isMaudeRuntimeState(p: string): boolean {
  return (
    // The optional `.<session>` segment is Cloud Phase 27 D3: `_active.json`
    // becomes `_active.<sessionKey>.json` per member in a cell. Without it each
    // member's open tabs and selection showed as untracked to EVERYONE, a
    // "Save all" staged them, and a push published them — one person's place in
    // the project, in the tenant's remote.
    /(^|\/)_(?:server|active|sync|preflight|locator|export-history|generate-history)(?:\.[A-Za-z0-9_-]{1,64})?\.json$/.test(
      p
    ) ||
    /(^|\/)_server\.(?:lock|log)$/.test(p) ||
    /(^|\/)_(?:history|trash|draw|photo|smoke|reports|canvas-state|state|chat|comments|untrusted|export-jobs|cache)(?:\/|$)/.test(
      p
    ) ||
    // kgai per-machine graph projection (feature-kgai-ecosystem-integration,
    // DDR-115 taxonomy) — the append-only store rebuilds from the remote on sync.
    /(^|\/)\.kgai(?:\/|$)/.test(p)
  );
}

/** Map an isomorphic-git statusMatrix row [head, workdir, stage] → our state, or
 *  null when the file is unmodified (so it's dropped from the Changes list).
 *  head:  0 absent in HEAD, 1 present.
 *  workdir: 0 absent, 1 == HEAD, 2 differs.
 *  stage: 0 absent, 1 == HEAD, 2 == workdir, 3 differs from both. */
function classify(head: number, workdir: number, _stage: number): GitFileState | null {
  if (head === 0 && workdir === 0) return null; // never existed / fully removed-and-staged-away
  if (head === 1 && workdir === 0) return 'deleted'; // tracked, now gone
  if (head === 0 && workdir === 2) {
    // New file. "Added" once git has it staged; otherwise brand-new "untracked".
    return _stage === 0 ? 'untracked' : 'added';
  }
  if (head === 1 && workdir === 1) return null; // identical to HEAD
  if (head === 1 && workdir === 2) return 'modified';
  return null;
}

interface GitAuthor {
  name: string;
  email: string;
}

async function resolveAuthor(dir: string): Promise<GitAuthor> {
  // git config user.name / user.email against the repo, with a Maude default so a
  // commit never fails on an unconfigured identity (the non-technical case).
  let name = '';
  let email = '';
  try {
    name = (await git.getConfig({ fs, dir, path: 'user.name' })) ?? '';
  } catch {
    /* unset */
  }
  try {
    email = (await git.getConfig({ fs, dir, path: 'user.email' })) ?? '';
  } catch {
    /* unset */
  }
  return {
    name: name.trim() || 'Maude',
    email: email.trim() || 'maude@localhost',
  };
}

// ── system-git fallback (MAUDE_USE_SYSTEM_GIT=1) ─────────────────────────────

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** True when `timeoutMs` elapsed and the child was killed (DDR-133). */
  timedOut?: boolean;
}

/** Run `git <args>` in `dir`. `tokenRemote` (when given) replaces the `origin`
 *  URL's userinfo with the token for this one invocation via `-c` config so the
 *  PAT never lands in the on-disk remote URL or the process title's argv beyond
 *  the ephemeral child. `timeoutMs` (DDR-133) hard-kills a stalled child so the
 *  network paths can never hang the UI / the unattended poll. */
function runGit(
  dir: string,
  args: string[],
  env?: Record<string, string>,
  timeoutMs?: number
): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child = spawn('git', args, {
      cwd: dir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
    }
    // StringDecoder, NOT `d.toString()` per chunk — a pipe splits at arbitrary
    // BYTE boundaries, so a multi-byte sequence straddling two chunks decodes
    // to U+FFFD on each side and `git show` of a canvas with non-ASCII copy
    // comes back silently corrupted. The hub's runner carries the identical
    // fix: this commit's whole premise is that a cloud row and a local row
    // cannot differ in shape, and "one of the two mangles diacritics" is
    // exactly that kind of difference.
    const outDec = new StringDecoder('utf8');
    const errDec = new StringDecoder('utf8');
    child.stdout.on('data', (d) => {
      stdout += outDec.write(d);
    });
    child.stderr.on('data', (d) => {
      stderr += errDec.write(d);
    });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolveRun({ code: 127, stdout, stderr: String(e), timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      stdout += outDec.end();
      stderr += errDec.end();
      resolveRun({ code: timedOut ? 124 : (code ?? 1), stdout, stderr, timedOut });
    });
  });
}

// ── status ───────────────────────────────────────────────────────────────────

export async function gitStatus(dir: string, opts: GitStatusOpts = {}): Promise<GitStatusResult> {
  if (!isRepo(dir)) {
    return { repo: false, branch: null, files: [], clean: true, unpushed: 0 };
  }
  const prefix = normPrefix(opts.designPrefix);
  const result = (await systemGitAvailable())
    ? await statusSystem(dir, prefix)
    : await statusIso(dir, prefix);

  // Local "saved but not published" count — no network (uses the cached
  // remote-tracking ref). Lets the panel offer Publish even on a clean tree.
  result.unpushed = await localUnpushed(dir, result.branch, opts.remote || 'origin').catch(() => 0);

  if (opts.checkRemote) {
    try {
      const { ahead, behind } = await remoteAheadBehind(dir, opts.token, opts.remote);
      result.ahead = ahead;
      result.behind = behind;
      result.remoteAhead = behind > 0;
    } catch {
      // Remote unreachable / no tracking branch — leave the nudge fields unset so
      // the UI just doesn't show a "Get latest" banner. Never fatal to status.
    }
  }
  return result;
}

async function statusIso(dir: string, prefix: string): Promise<GitStatusResult> {
  const branch = (await git.currentBranch({ fs, dir, fullname: false })) ?? null;
  const matrix = await git.statusMatrix({
    fs,
    dir,
    filter: prefix ? (f) => underPrefix(f, prefix) : undefined,
  });
  const files: GitFileStatus[] = [];
  for (const [filepath, head, workdir, stage] of matrix) {
    if (isMaudeRuntimeState(filepath)) continue;
    const state = classify(head, workdir, stage);
    if (state) files.push({ path: filepath, status: state });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { repo: true, branch, files, clean: files.length === 0, unpushed: 0 };
}

async function statusSystem(dir: string, prefix: string): Promise<GitStatusResult> {
  const br = await runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = br.code === 0 ? br.stdout.trim() || null : null;
  // -z NUL-delimited porcelain v1 so filenames with spaces survive intact.
  const st = await runGit(dir, ['status', '--porcelain', '-z', '--untracked-files=all']);
  const files: GitFileStatus[] = [];
  if (st.code === 0) {
    const records = st.stdout.split('\0').filter(Boolean);
    for (const rec of records) {
      // Each record: `XY <path>` (rename's second path arrives as its own record).
      const xy = rec.slice(0, 2);
      const path = rec.slice(3).replace(/\\/g, '/');
      if (!path || !underPrefix(path, prefix) || isMaudeRuntimeState(path)) continue;
      const state = classifyPorcelain(xy);
      if (state) files.push({ path, status: state });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { repo: true, branch, files, clean: files.length === 0, unpushed: 0 };
}

function classifyPorcelain(xy: string): GitFileState | null {
  if (xy === '??') return 'untracked';
  const x = xy[0];
  const y = xy[1];
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'A') return 'added';
  if (x === 'M' || y === 'M' || x === 'R' || x === 'C') return 'modified';
  return null;
}

// ── commit (Save version) ─────────────────────────────────────────────────────

/** Save selected files as one version. `files` are repo-relative paths the user
 *  checked; an empty/undefined list means "Save all" (every changed file under
 *  `designPrefix`). Each file is staged add-or-remove based on its workdir
 *  presence, then one commit lands. Returns the new sha. */
export function gitCommit(
  dir: string,
  message: string,
  files?: string[],
  opts: { designPrefix?: string } = {}
): Promise<GitCommitResult> {
  return underRepoLock(
    dir,
    'commit',
    () => commitLocked(dir, message, files, opts),
    () => ({
      ok: false,
      error: REPO_BUSY,
    })
  );
}

async function commitLocked(
  dir: string,
  message: string,
  files?: string[],
  opts: { designPrefix?: string } = {}
): Promise<GitCommitResult> {
  if (!isRepo(dir)) return { ok: false, error: 'This project is not versioned yet.' };
  const msg = (message ?? '').trim();
  if (!msg) return { ok: false, error: 'A version needs a short message.' };

  const prefix = normPrefix(opts.designPrefix);
  // Resolve the working set: explicit selection, else every changed file in scope.
  const status = await gitStatus(dir, { designPrefix: prefix });
  if (status.clean) return { ok: false, error: 'Nothing to save.' };

  let selected: GitFileStatus[];
  if (files?.length) {
    const want = new Set(files.map((f) => f.replace(/\\/g, '/')));
    selected = status.files.filter((f) => want.has(f.path));
    if (!selected.length) return { ok: false, error: 'None of the selected files have changes.' };
  } else {
    selected = status.files;
  }

  return systemGitForced() ? commitSystem(dir, msg, selected) : commitIso(dir, msg, selected);
}

async function commitIso(
  dir: string,
  message: string,
  selected: GitFileStatus[]
): Promise<GitCommitResult> {
  try {
    for (const f of selected) {
      if (f.status === 'deleted') {
        await git.remove({ fs, dir, filepath: f.path });
      } else {
        await git.add({ fs, dir, filepath: f.path });
      }
    }
    const author = await resolveAuthor(dir);
    const sha = await git.commit({ fs, dir, message, author });
    return { ok: true, sha };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

async function commitSystem(
  dir: string,
  message: string,
  selected: GitFileStatus[]
): Promise<GitCommitResult> {
  for (const f of selected) {
    const args = f.status === 'deleted' ? ['rm', '--', f.path] : ['add', '--', f.path];
    const r = await runGit(dir, args);
    if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'stage failed' };
  }
  // -m via argv (message is server-side; no shell interpolation through spawn).
  const c = await runGit(dir, ['commit', '-m', message]);
  if (c.code !== 0) return { ok: false, error: c.stderr.trim() || 'commit failed' };
  const head = await runGit(dir, ['rev-parse', 'HEAD']);
  return { ok: true, sha: head.stdout.trim() };
}

// ── discard (revert a change) ───────────────────────────────────────────────

export interface GitDiscardResult {
  ok: boolean;
  discarded?: string[];
  error?: string;
}

/** Throw away the unsaved changes to `files` — the Changes-panel per-file undo.
 *  A tracked file (modified/deleted) is restored from HEAD; an untracked file is
 *  deleted (it has no HEAD version to restore). Destructive by intent; the UI
 *  confirms first. Each path is the endpoint-validated repo-relative form. */
export function gitDiscard(
  dir: string,
  files: string[],
  opts: { designPrefix?: string } = {}
): Promise<GitDiscardResult> {
  return underRepoLock(
    dir,
    'discard',
    () => discardLocked(dir, files, opts),
    () => ({
      ok: false,
      error: REPO_BUSY,
    })
  );
}

async function discardLocked(
  dir: string,
  files: string[],
  opts: { designPrefix?: string } = {}
): Promise<GitDiscardResult> {
  if (!isRepo(dir)) return { ok: false, error: 'This project is not versioned yet.' };
  if (!files?.length) return { ok: false, error: 'Nothing selected to discard.' };
  const prefix = normPrefix(opts.designPrefix);
  const status = await gitStatus(dir, { designPrefix: prefix });
  const byPath = new Map(status.files.map((f) => [f.path, f.status]));
  const targets = files.map((f) => f.replace(/\\/g, '/')).filter((f) => byPath.has(f));
  if (!targets.length) return { ok: false, error: 'None of those files have changes.' };

  try {
    for (const f of targets) {
      if (byPath.get(f) === 'untracked') {
        await fs.promises.rm(join(dir, f), { force: true });
      } else if (systemGitForced()) {
        const r = await runGit(dir, ['checkout', 'HEAD', '--', f]);
        if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'discard failed' };
      } else {
        await git.checkout({ fs, dir, filepaths: [f], ref: 'HEAD', force: true });
      }
    }
    return { ok: true, discarded: targets };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ── branches (DRAFTS — phase 29 / E4) ────────────────────────────────────────
// The UI never says "branch": a side branch is a "draft", and `main`/`master` is
// the "Shared version". Switching a draft moves HEAD, which the git-lifecycle.ts
// `.git/HEAD` watcher already turns into a Yjs flush + reload prompt (DDR-051) —
// this module does NOT duplicate that.

/** The default remote a managed Maude project tracks (DDR-111 clone). */
const DEFAULT_REMOTE = 'origin';

/** How we'll transport-fetch a remote, derived from its URL:
 *   - `http`   → isomorphic-git (HTTP-only) OR system git with a token header.
 *   - `ssh`    → system git only (user's own ssh-agent creds), NEVER a token.
 *     Covers `ssh://` / `git://` / the scp-like `git@github.com:org/repo` form.
 *   - `none`   → no remote configured; nothing to fetch (benign).
 *   - `unsafe` → REFUSE — never hand to the git binary. The `ext::` / `fd::` /
 *     `transport::` helpers make `git fetch` run an ARBITRARY SHELL COMMAND from the
 *     config URL. A poisoned `.git/config` (which rides a folder/clone and no
 *     file-review sees) would otherwise be RCE the moment the unattended status
 *     poll fires. Also refuses `file://` / local-path (local-read vector) and any
 *     unknown scheme. See DDR-131 hardening + the adversarial review of 75a2f0d. */
type RemoteTransport = 'http' | 'ssh' | 'none' | 'unsafe';

function classifyRemoteUrl(url: string): RemoteTransport {
  const u = (url || '').trim();
  if (!u) return 'none';
  // Transport helpers embed `::` (ext::, fd::, transport::) → arbitrary command. Reject first.
  if (u.includes('::')) return 'unsafe';
  if (/^https?:\/\//i.test(u)) return 'http';
  if (/^(?:ssh|git):\/\//i.test(u)) return 'ssh';
  // scp-like `user@host:path` (no scheme) — the common `git@github.com:org/repo` form.
  if (/^[\w.+-]+@[\w.-]+:[^/]/.test(u)) return 'ssh';
  // file://, bare local paths, and anything else: REFUSE. A managed project tracks
  // a github.com http/ssh remote; a local/file transport is both unusual and a
  // local-read vector, so we don't hand it to the git binary at all.
  return 'unsafe';
}

/** True when a remote URL points at github.com (https or the scp-like ssh form).
 *  Decides the fold path (DDR-162): a GitHub remote gets the PR flow (push draft +
 *  open a pull request via the endpoint); anything else (no remote, a local/file
 *  remote) keeps the local-merge path. Only a routing decision — the authoritative,
 *  security-anchored owner/repo parse is `parseGitHubRemote` at the endpoint, which
 *  rejects an embedded `evil.com/github.com/…` even if this heuristic didn't. */
function isGitHubRemote(url: string): boolean {
  return /(?:^|\/\/|@)github\.com[:/]/i.test((url || '').trim());
}

/** Read a remote's configured URL (empty string when missing). */
async function readRemoteUrl(dir: string, remote: string): Promise<string> {
  return (await git.getConfig({ fs, dir, path: `remote.${remote}.url` }).catch(() => null)) || '';
}

/** The GitHub PAT (keychain) may ONLY be attached to a request bound for GitHub —
 *  never to an arbitrary HTTPS host an attacker put in `remote.origin.url` (PAT
 *  exfil / SSRF). HTTP(S) urls only; ssh carries no token regardless. */
function isTrustedTokenHost(url: string): boolean {
  const u = (url || '').trim();
  // SECURITY (F1 — parser-differential PAT exfil): the token-attach decision must NOT
  // trust a `new URL()` parse that git+libcurl will REDO with a different grammar. A
  // `https://github.com\@attacker/x` reads as host github.com under WHATWG but as host
  // `attacker` under curl (backslash = path/userinfo char). Reject any byte that could
  // re-open the authority — backslash, userinfo `@`, whitespace, control chars — then
  // require the byte-exact canonical github.com https prefix, so the host resolves to
  // github.com under BOTH parsers before the PAT is ever lent.
  // Only printable ASCII (rejects whitespace, control, and non-ASCII homoglyphs),
  // and no backslash / userinfo `@` — the two bytes that let curl re-resolve the host.
  if (/[^\x21-\x7e]/.test(u) || u.includes('\\') || u.includes('@')) return false;
  if (!/^https:\/\/github\.com\//i.test(u)) return false;
  try {
    return new URL(u).hostname.toLowerCase() === 'github.com';
  } catch {
    return false;
  }
}

/** The URL git will ACTUALLY dial for `remote`, after any `url.<base>.insteadOf`
 *  rewrite — the URL that must be host-validated, NOT the raw `remote.url`. A poisoned
 *  `.git/config` `url.<attacker>.insteadOf = https://github.com/` (rides a clone/folder,
 *  no file-review sees it) makes the SYSTEM engine dial the attacker even though
 *  `remote.url` is a clean github URL; this is the surviving instance of the F1
 *  "validate-here / connect-there" class (verify re-review). `git ls-remote --get-url`
 *  applies insteadOf and prints WITHOUT touching the network. iso-git ignores insteadOf,
 *  so when there's no system git the raw URL IS the effective one. */
async function effectiveRemoteUrl(dir: string, remote: string): Promise<string> {
  const raw = await readRemoteUrl(dir, remote);
  if (!raw) return ''; // no remote → 'none'
  if (!(await systemGitAvailable())) return raw;
  const r = await runGit(dir, [...HARDENED_REMOTE_FLAGS, 'ls-remote', '--get-url', remote]);
  const eff = r.code === 0 ? r.stdout.trim() : '';
  return eff || raw;
}

/** Defense-in-depth for any `runGit` that resolves a config remote URL: disable the
 *  command-EXECUTING transports at the git layer too (`classifyRemoteUrl` already
 *  refuses them before we spawn — this is the backstop). Deliberately does NOT
 *  block `file`/local object transfer (legitimate local-repo fetch), only the
 *  shell-spawning helpers. */
const HARDENED_REMOTE_FLAGS = ['-c', 'protocol.ext.allow=never', '-c', 'protocol.fd.allow=never'];

/** Non-empty, trimmed lines of a git stdout block. */
function splitLines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fold a remote-tracking ref into the merged draft map: a name already seen
 *  locally becomes `both` (recents = the newer of the two commit times); a name
 *  seen only on the remote becomes a `remote`-only draft. */
function mergeRemote(merged: Map<string, GitBranch>, name: string, updatedAt: number): void {
  const existing = merged.get(name);
  if (existing) {
    merged.set(name, {
      ...existing,
      where: 'both',
      updatedAt: Math.max(existing.updatedAt, updatedAt),
    });
  } else {
    merged.set(name, { name, current: false, updatedAt, where: 'remote' });
  }
}

export interface GitBranch {
  name: string;
  current: boolean;
  /** Last-commit time on this branch, unix seconds — drives the "recents" sort in
   *  the switcher. 0 when unknown (resolution failed / empty branch). */
  updatedAt: number;
  /** Where this draft lives. `local` = only here, `remote` = only on the team's
   *  remote (not downloaded yet — switching creates a tracking branch), `both` =
   *  present in both. The UI labels `remote` drafts "from your team". */
  where: 'local' | 'remote' | 'both';
}

/** List drafts (branches) — LOCAL plus the remote-tracking refs already on disk
 *  (populated by the original clone / a prior fetch; a fresh teammate draft only
 *  appears after `gitFetchRemote`). Each carries its last-commit time so the UI
 *  can sort by recents, and a `where` tag so it can mark remote-only drafts.
 *  Returns [] when `dir` isn't a repo. */
export async function gitListBranches(dir: string): Promise<GitBranch[]> {
  if (!isRepo(dir)) return [];
  try {
    const merged = new Map<string, GitBranch>();
    if (await systemGitAvailable()) {
      const cur = (await runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
      // Tab-separated so a branch name (no tabs/newlines, charset-guarded) can't
      // collide with the delimiter; committerdate:unix is the recents key.
      const fmt = '--format=%(refname:short)%09%(committerdate:unix)';
      const local = await runGit(dir, ['for-each-ref', fmt, 'refs/heads']);
      if (local.code !== 0) return [];
      for (const line of splitLines(local.stdout)) {
        const [name, ts] = line.split('\t');
        merged.set(name, {
          name,
          current: name === cur,
          updatedAt: Number(ts) || 0,
          where: 'local',
        });
      }
      // Remote refs come back as "origin/<name>" — strip the prefix, skip origin/HEAD.
      // NB: `%(refname:short)` collapses the symbolic ref refs/remotes/origin/HEAD to
      // the bare remote name ("origin"), so skip that too or it shows as a phantom branch.
      const remote = await runGit(dir, ['for-each-ref', fmt, `refs/remotes/${DEFAULT_REMOTE}`]);
      if (remote.code === 0) {
        for (const line of splitLines(remote.stdout)) {
          const [full, ts] = line.split('\t');
          if (!full || full === DEFAULT_REMOTE) continue; // origin/HEAD short form
          const name = full.startsWith(`${DEFAULT_REMOTE}/`)
            ? full.slice(DEFAULT_REMOTE.length + 1)
            : full;
          if (!name || name === 'HEAD') continue;
          mergeRemote(merged, name, Number(ts) || 0);
        }
      }
      return [...merged.values()];
    }
    // iso engine (default): merge local heads with refs/remotes/<remote>/*.
    const cur = (await git.currentBranch({ fs, dir, fullname: false })) ?? null;
    const at = async (ref: string): Promise<number> => {
      try {
        const oid = await git.resolveRef({ fs, dir, ref });
        const { commit } = await git.readCommit({ fs, dir, oid });
        return commit.committer?.timestamp || 0;
      } catch {
        return 0; // empty / unresolvable ref — sorts last
      }
    };
    const localNames = await git.listBranches({ fs, dir });
    await Promise.all(
      localNames.map(async (name) => {
        merged.set(name, {
          name,
          current: name === cur,
          updatedAt: await at(name),
          where: 'local',
        });
      })
    );
    // Remote enumeration is best-effort: a repo with no remote yields [].
    const remoteNames = (
      await git.listBranches({ fs, dir, remote: DEFAULT_REMOTE }).catch(() => [])
    ).filter((n) => n && n !== 'HEAD');
    await Promise.all(
      remoteNames.map(async (name) => {
        mergeRemote(merged, name, await at(`refs/remotes/${DEFAULT_REMOTE}/${name}`));
      })
    );
    return [...merged.values()];
  } catch {
    return [];
  }
}

export interface GitBranchResult {
  ok: boolean;
  branch?: string;
  error?: string;
}

/** Create a new draft off HEAD and switch to it. The name is validated against the
 *  same dash-led / charset guard as every other positional (defense-in-depth). */
export function gitCreateBranch(dir: string, name: string): Promise<GitBranchResult> {
  return underRepoLock(
    dir,
    'branch',
    () => createBranchLocked(dir, name),
    () => ({
      ok: false,
      error: REPO_BUSY,
    })
  );
}

async function createBranchLocked(dir: string, name: string): Promise<GitBranchResult> {
  if (!isRepo(dir)) return { ok: false, error: 'This project is not versioned yet.' };
  if (!isSafeGitPositional(name))
    return { ok: false, error: "That draft name has characters we can't use." };
  try {
    const existing = await gitListBranches(dir);
    if (existing.some((b) => b.name === name))
      return { ok: false, error: 'A draft with that name already exists.' };
    if (systemGitForced()) {
      const r = await runGit(dir, ['checkout', '-b', name]);
      if (r.code !== 0)
        return { ok: false, error: r.stderr.trim() || 'Could not create the draft.' };
    } else {
      await git.branch({ fs, dir, ref: name, checkout: true });
    }
    return { ok: true, branch: name };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Switch to an existing draft (or back to the Shared version). A dirty tree that
 *  would be clobbered surfaces a plain "Save your changes first" rather than a
 *  raw git error. */
export function gitCheckout(dir: string, name: string): Promise<GitBranchResult> {
  return underRepoLock(
    dir,
    'checkout',
    () => checkoutLocked(dir, name),
    () => ({
      ok: false,
      error: REPO_BUSY,
    })
  );
}

async function checkoutLocked(dir: string, name: string): Promise<GitBranchResult> {
  if (!isRepo(dir)) return { ok: false, error: 'This project is not versioned yet.' };
  if (!isSafeGitPositional(name)) return { ok: false, error: 'Invalid draft name.' };
  try {
    if (systemGitForced()) {
      // System git DWIMs `git checkout <name>` into a tracking branch when <name>
      // exists on exactly one remote, so the local + remote-only cases share a path.
      const r = await runGit(dir, ['checkout', name]);
      if (r.code !== 0) {
        const blob = `${r.stderr} ${r.stdout}`.toLowerCase();
        if (blob.includes('would be overwritten') || blob.includes('local changes'))
          return { ok: false, error: 'Save your changes before switching drafts.' };
        if (
          blob.includes('did not match') ||
          blob.includes('pathspec') ||
          blob.includes('invalid reference')
        )
          return { ok: false, error: "Couldn't find that draft — try Refresh." };
        return { ok: false, error: r.stderr.trim() || 'Could not switch drafts.' };
      }
    } else {
      // iso-git does NOT DWIM: a local ref checks out directly, but a remote-only
      // draft must be created as a tracking branch from refs/remotes/<remote>/<name>.
      const localNames = await git.listBranches({ fs, dir });
      if (localNames.includes(name)) {
        await git.checkout({ fs, dir, ref: name });
      } else {
        const remoteNames = await git
          .listBranches({ fs, dir, remote: DEFAULT_REMOTE })
          // Annotated: a bare `[]` infers never[], which made the `.includes`
          // below take a `never` and rejected any real branch name.
          .catch((): string[] => []);
        if (!remoteNames.includes(name))
          return { ok: false, error: "Couldn't find that draft — try Refresh." };
        await git.checkout({ fs, dir, ref: name, remote: DEFAULT_REMOTE, track: true });
      }
    }
    return { ok: true, branch: name };
  } catch (e) {
    const msg = errMsg(e);
    if (/overwrit|local change|conflict/i.test(msg))
      return { ok: false, error: 'Save your changes before switching drafts.' };
    if (/not ?found|did not match|resolve/i.test(msg))
      return { ok: false, error: "Couldn't find that draft — try Refresh." };
    return { ok: false, error: msg };
  }
}

/** The "Shared version" is whichever of these exists (main preferred). */
const SHARED_BRANCHES = new Set(['main', 'master']);

export interface GitFoldResult {
  ok: boolean;
  /** A non-FF / rejected publish reuses the plain "Get latest first" path, never a merge UI. */
  conflict?: boolean;
  authRequired?: boolean;
  error?: string;
  /** The Shared-version branch the draft was added to (local merge) or targeted (PR). */
  shared?: string;
  /** PR flow (DDR-162): a GitHub remote exists, the draft branch was pushed, and the
   *  endpoint should open a pull request `head → base`. When set, no local merge or
   *  push of the Shared version happened — the merge lands on GitHub, post-review. */
  prReady?: boolean;
  head?: string;
  base?: string;
  remoteUrl?: string;
}

/** "Add this draft to the Shared version" (phase-29 / E4, Task 7): merge the draft
 *  into the Shared version (main/master, FF when possible), publish it, then remove
 *  the draft. A content conflict or a rejected publish surfaces the plain "Get latest
 *  first" path (no 3-way merge UI). The local draft is removed ONLY after a clean
 *  publish, so a rejected publish leaves a recoverable state. */
export function gitFoldDraft(
  dir: string,
  draftName: string,
  token: string | undefined,
  opts: { remote?: string } = {}
): Promise<GitFoldResult> {
  return underRepoLock(
    dir,
    'fold',
    () => foldLocked(dir, draftName, token, opts),
    () => ({
      ok: false,
      error: REPO_BUSY,
    })
  );
}

async function foldLocked(
  dir: string,
  draftName: string,
  token: string | undefined,
  opts: { remote?: string } = {}
): Promise<GitFoldResult> {
  if (!isRepo(dir)) return { ok: false, error: 'This project is not versioned yet.' };
  if (!isSafeGitPositional(draftName)) return { ok: false, error: 'Invalid draft name.' };
  invalidateRemoteProbe(dir); // a fold changes ahead/behind — re-probe next status
  const remote = opts.remote || 'origin';
  const branches = await gitListBranches(dir);
  const shared = branches.find((b) => SHARED_BRANCHES.has(b.name))?.name;
  if (!shared) return { ok: false, error: 'This project has no Shared version yet.' };
  if (draftName === shared) return { ok: false, error: "That's already the Shared version." };
  if (!branches.some((b) => b.name === draftName))
    return { ok: false, error: "That draft doesn't exist." };

  // A GitHub remote → PR flow (DDR-162): publish the DRAFT branch (branch protection
  // guards the Shared version, not the draft) and signal the endpoint to open a pull
  // request draft→shared. We deliberately do NOT merge or push the Shared version here
  // — pushing a protected `main` is exactly what GitHub forbids, and the reason the PR
  // exists. The merge lands on GitHub after review.
  const remoteUrl = await readRemoteUrl(dir, remote);
  if (isGitHubRemote(remoteUrl)) {
    const push = await gitPush(dir, token, { remote, ref: draftName });
    if (!push.ok) {
      if (push.authRequired) return { ok: false, authRequired: true, error: push.error };
      if (push.conflict)
        return {
          ok: false,
          conflict: true,
          error: 'Your draft moved on the server — Get latest first, then add it.',
        };
      return { ok: false, error: push.error ?? 'Could not publish your draft.' };
    }
    return { ok: true, shared, prReady: true, head: draftName, base: shared, remoteUrl };
  }

  // No remote (or a non-GitHub local remote) → merge the draft into the Shared version
  // locally; there's no PR host. Unchanged pre-PR-flow behavior.
  // Merge the draft into the Shared version (FF when possible, else a merge commit).
  try {
    if (systemGitForced()) {
      const co = await runGit(dir, ['checkout', shared]);
      if (co.code !== 0) return { ok: false, error: 'Save your changes before adding the draft.' };
      const mg = await runGit(dir, ['merge', draftName]);
      if (mg.code !== 0) {
        await runGit(dir, ['merge', '--abort']).catch(() => {});
        await runGit(dir, ['checkout', draftName]).catch(() => {});
        return {
          ok: false,
          conflict: true,
          error: 'Get the latest Shared version first, then add your draft.',
        };
      }
    } else {
      await git.checkout({ fs, dir, ref: shared });
      const author = await resolveAuthor(dir);
      await git.merge({
        fs,
        dir,
        ours: shared,
        theirs: draftName,
        author,
        fastForward: true,
        message: `Add draft "${draftName}" to the Shared version`,
      });
      await git.checkout({ fs, dir, ref: shared, force: true });
    }
  } catch (e) {
    if (!systemGitForced()) {
      try {
        await git.checkout({ fs, dir, ref: draftName, force: true });
      } catch {
        /* best effort — leave the user on whatever checked out */
      }
    }
    const msg = errMsg(e);
    if (/overwrit|local change|save/i.test(msg))
      return { ok: false, error: 'Save your changes before adding the draft.' };
    return {
      ok: false,
      conflict: true,
      error: 'Get the latest Shared version first, then add your draft.',
    };
  }

  // Publish the Shared version.
  const push = await gitPush(dir, token, { remote, ref: shared });
  if (!push.ok) {
    if (push.authRequired) return { ok: false, authRequired: true, error: push.error };
    if (push.conflict)
      return {
        ok: false,
        conflict: true,
        error: 'Someone else published — Get latest first, then add your draft.',
      };
    return { ok: false, error: push.error ?? 'Could not publish the Shared version.' };
  }

  // The draft's work is now in the Shared version — remove the draft (local only).
  try {
    if (systemGitForced()) await runGit(dir, ['branch', '-D', draftName]);
    else await git.deleteBranch({ fs, dir, ref: draftName });
  } catch {
    /* non-fatal: the fold + publish succeeded; a leftover draft ref is harmless */
  }

  return { ok: true, shared };
}

// ── push (Publish) ─────────────────────────────────────────────────────────

/** Publish / Get-latest transport routing — brings the network WRITE paths up to the
 *  same DDR-131/DDR-133 gate the network READ paths already enforce (gitFetchRemote
 *  `:1099`, remoteAheadBehind `:1628`). iso-git speaks HTTP(S) ONLY, so an ssh/git
 *  remote MUST run through the system binary (the "unrecognized transport protocol:
 *  ssh" bug was push/pull skipping this); a command-executing / non-github URL is
 *  REFUSED before any spawn; and the keychain PAT rides only a trusted-host HTTPS
 *  request. `none` (no remote configured) keeps the pre-gate routing so a local-only
 *  project's tokenless publish still short-circuits to "sign in" unchanged. */
type NetWriteRoute =
  | { via: 'system'; tokenForSystem: string | undefined }
  | { via: 'iso' }
  | { via: 'legacy' }
  | { via: 'authRequired' }
  | { via: 'reject'; error: string };

async function resolveNetWriteRoute(
  dir: string,
  remote: string,
  token: string | undefined
): Promise<NetWriteRoute> {
  const url = await effectiveRemoteUrl(dir, remote); // post-insteadOf — the URL git dials
  const transport = classifyRemoteUrl(url);
  if (transport === 'none') return { via: 'legacy' };
  // Command-executing transports (ext::/fd::/transport:: — the `::` helpers) are RCE:
  // refuse BEFORE any spawn so neither engine ever resolves them. A plain file/local
  // remote is NOT rejected here — it's a legitimate explicit local-repo transfer
  // (handled by the system branch below), matching HARDENED_REMOTE_FLAGS' stance that
  // only shell-spawning helpers are blocked, not file object transfer.
  if (url.includes('::'))
    return { via: 'reject', error: 'Maude can only sync github.com (HTTPS or SSH) projects.' };
  const trustedHttp = transport === 'http' && isTrustedTokenHost(url);
  if (transport === 'http' && !trustedHttp)
    return { via: 'reject', error: 'Maude can only sync github.com projects.' };
  // Tokenless github HTTPS with no system git to fall back on: iso can't authenticate
  // → ask the user to sign in (mirrors gitFetchRemote `:1096`).
  if (transport === 'http' && !token && !(await systemGitAvailable()))
    return { via: 'authRequired' };
  // System engine for: ssh (iso can't speak it), a file/local remote ('unsafe' minus
  // the `::` helpers rejected above — e.g. a bare-repo path), or ANY remote once a git
  // binary exists. The PAT rides only a trusted-host HTTPS request; ssh/local use the
  // user's own key / on-disk path.
  if ((await systemGitAvailable()) || transport === 'ssh' || transport === 'unsafe')
    return { via: 'system', tokenForSystem: trustedHttp ? token : undefined };
  return { via: 'iso' }; // github HTTPS + token, no system git present
}

/** Publish. `token` is optional in phase-27: the system-git engine falls back to
 *  the user's configured credential helper / SSH, so a developer-ish user who
 *  cloned with system git can publish today (no in-UI token). The iso-git default
 *  engine needs the token (no helper integration) → `authRequired` when absent,
 *  which the UI renders as "Sign in to publish" (phase-28 keychain fills it).
 *  Engine choice goes through resolveNetWriteRoute so an ssh remote reaches the git
 *  binary instead of iso's HTTP-only transport (DDR-131/DDR-133 parity). */
export async function gitPush(
  dir: string,
  token: string | undefined,
  opts: { remote?: string; ref?: string } = {}
): Promise<GitPushResult> {
  if (!isRepo(dir)) return { ok: false, error: 'This project is not versioned yet.' };
  invalidateRemoteProbe(dir); // a publish changes ahead/behind — re-probe next status
  const remote = opts.remote || 'origin';
  const route = await resolveNetWriteRoute(dir, remote, token);
  switch (route.via) {
    case 'reject':
      return { ok: false, error: route.error };
    case 'authRequired':
      return { ok: false, authRequired: true, error: 'Sign in to publish.' };
    case 'system':
      return pushSystem(dir, route.tokenForSystem, remote, opts.ref);
    case 'iso':
      return pushIso(dir, token, remote, opts.ref);
    case 'legacy':
      return systemGitForced()
        ? pushSystem(dir, token, remote, opts.ref)
        : pushIso(dir, token, remote, opts.ref);
  }
}

async function pushIso(
  dir: string,
  token: string | undefined,
  remote: string,
  ref?: string
): Promise<GitPushResult> {
  if (!token) return { ok: false, authRequired: true, error: 'Sign in to publish.' };
  try {
    const branch = ref || (await git.currentBranch({ fs, dir, fullname: false })) || 'main';
    const res = await git.push({
      fs,
      http,
      dir,
      remote,
      ref: branch,
      // GitHub PAT over HTTPS basic-auth: token as username, empty password
      // (Task 3 gotcha — NOT a Bearer header). isomorphic-git never logs this.
      onAuth: () => ({ username: token, password: '' }),
    });
    // PushResult.ok is true on success; a rejected ref carries an error string.
    if (res.ok) {
      // iso-git's push does NOT advance the local remote-tracking ref, so the
      // "ready to publish" count (localUnpushed, which compares HEAD against
      // refs/remotes/<remote>/<branch>) would keep counting the commits we just
      // pushed. Point the tracking ref at what we pushed so it clears to 0.
      const oid = await git.resolveRef({ fs, dir, ref: branch }).catch(() => null);
      if (oid) {
        await git
          .writeRef({ fs, dir, ref: `refs/remotes/${remote}/${branch}`, value: oid, force: true })
          .catch(() => {});
      }
      return { ok: true };
    }
    const errors = Object.values(res.refs ?? {})
      .map((r) => (r as { error?: string }).error)
      .filter(Boolean) as string[];
    const blob = `${res.error ?? ''} ${errors.join(' ')}`.toLowerCase();
    if (isNonFastForward(blob)) return { ok: false, conflict: true };
    return { ok: false, error: errors[0] || res.error || 'Publish failed.' };
  } catch (e) {
    const msg = errMsg(e);
    if (isNonFastForward(msg)) return { ok: false, conflict: true };
    if (isTransportError(msg))
      return {
        ok: false,
        error: 'Publishing needs the git command-line tool for this project’s connection.',
      };
    return { ok: false, error: msg };
  }
}

async function pushSystem(
  dir: string,
  token: string | undefined,
  remote: string,
  ref?: string
): Promise<GitPushResult> {
  const branch = ref || (await runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  if (!isSafeGitPositional(remote) || (branch && !isSafeGitPositional(branch))) {
    return { ok: false, error: 'Invalid remote or draft name.' };
  }
  // With a token, inject it via an ephemeral http.extraheader (never lands on
  // disk). Without one, fall through to the user's configured credential helper /
  // SSH agent — the phase-27 "I cloned with system git" publish path.
  const args = tokenHeaderArgs(token);
  args.push(...HARDENED_REMOTE_FLAGS, 'push', remote, branch || 'HEAD');
  const r = await runGit(dir, args);
  if (r.code === 0) return { ok: true };
  // 127 = no git binary on PATH (the ssh-remote-but-no-CLI case; ssh always routes here).
  if (r.code === 127)
    return {
      ok: false,
      error: 'Publishing needs the git command-line tool for this project’s connection.',
    };
  if (isNonFastForward(`${r.stderr} ${r.stdout}`.toLowerCase()))
    return { ok: false, conflict: true };
  return { ok: false, error: r.stderr.trim() || 'Publish failed.' };
}

/** Defense-in-depth (security re-review): the endpoint already validates
 *  `remote`/`ref`, but the system-git engine passes them as bare argv positionals,
 *  so a dash-led value would be parsed as an OPTION (argument injection, A1). This
 *  is a SECOND guard — a future relaxation of the endpoint regex can't silently
 *  re-open the class. A real git remote/ref/branch never starts with `-`. */
const SAFE_GIT_POSITIONAL = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
function isSafeGitPositional(v: string): boolean {
  return SAFE_GIT_POSITIONAL.test(v);
}

/** Ephemeral `git -c http.<github>.extraheader=…` args carrying a token as HTTPS
 *  basic auth, or `[]` when no token (fall back to the user's credential helper). The
 *  header is per-invocation so the PAT never lands in the on-disk remote URL — AND it
 *  is SCOPED to `https://github.com/` (not the global `http.extraheader`): git attaches
 *  it only to a request whose curl-RESOLVED host is github.com, so a poisoned remote
 *  that WHATWG reads as github.com but curl dials elsewhere never receives the PAT
 *  (F1 defense-in-depth, on top of the isTrustedTokenHost strict-validate). */
function tokenHeaderArgs(token: string | undefined): string[] {
  if (!token) return [];
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  return ['-c', `http.https://github.com/.extraheader=Authorization: Basic ${auth}`];
}

function isNonFastForward(blob: string): boolean {
  return (
    blob.includes('non-fast-forward') ||
    blob.includes('not a simple fast-forward') ||
    blob.includes('fetch first') ||
    blob.includes('rejected') ||
    blob.includes('updates were rejected')
  );
}

/** iso-git speaks HTTP(S) only and throws "unrecognized transport protocol" on an
 *  ssh/git remote. Routing now sends those to system git (resolveNetWriteRoute), so
 *  this is a BELT: if a transport error ever still reaches an iso catch, map it to the
 *  same "use the git CLI" copy gitFetchRemote shows (`:1153`) instead of leaking the
 *  raw isomorphic-git string to the UI. */
function isTransportError(blob: string): boolean {
  return /unrecognized transport|unsupported|protocol/i.test(blob);
}

// ── pull (Get latest) ─────────────────────────────────────────────────────

/** Get latest. Same optional-token model as gitPush (see its doc comment). */
export function gitPull(
  dir: string,
  token: string | undefined,
  opts: { remote?: string; ref?: string } = {}
): Promise<GitPullResult> {
  return underRepoLock(
    dir,
    'pull',
    () => pullLocked(dir, token, opts),
    () => ({
      ok: false,
      error: REPO_BUSY,
    })
  );
}

async function pullLocked(
  dir: string,
  token: string | undefined,
  opts: { remote?: string; ref?: string } = {}
): Promise<GitPullResult> {
  if (!isRepo(dir)) return { ok: false, error: 'This project is not versioned yet.' };
  invalidateRemoteProbe(dir); // a pull changes ahead/behind — re-probe next status
  const remote = opts.remote || 'origin';
  const route = await resolveNetWriteRoute(dir, remote, token);
  switch (route.via) {
    case 'reject':
      return { ok: false, error: route.error };
    case 'authRequired':
      return { ok: false, authRequired: true, error: 'Sign in to get the latest.' };
    case 'system':
      return pullSystem(dir, route.tokenForSystem, remote, opts.ref);
    case 'iso':
      return pullIso(dir, token, remote, opts.ref);
    case 'legacy':
      return systemGitForced()
        ? pullSystem(dir, token, remote, opts.ref)
        : pullIso(dir, token, remote, opts.ref);
  }
}

async function pullIso(
  dir: string,
  token: string | undefined,
  remote: string,
  ref?: string
): Promise<GitPullResult> {
  if (!token) return { ok: false, authRequired: true, error: 'Sign in to get the latest.' };
  try {
    const branch = ref || (await git.currentBranch({ fs, dir, fullname: false })) || 'main';
    const author = await resolveAuthor(dir);
    await git.pull({
      fs,
      http,
      dir,
      remote,
      ref: branch,
      singleBranch: true,
      author,
      onAuth: () => ({ username: token, password: '' }),
    });
    return { ok: true };
  } catch (e) {
    // isomorphic-git surfaces a real content conflict as MergeConflictError, whose
    // `data` is the list of conflicted filepaths. DiffView opens on these.
    const conflictFiles = mergeConflictFiles(e);
    if (conflictFiles) return { ok: false, conflict: true, files: conflictFiles };
    const msg = errMsg(e);
    if (isTransportError(msg))
      return {
        ok: false,
        error: 'Getting the latest needs the git command-line tool for this project’s connection.',
      };
    return { ok: false, error: msg };
  }
}

async function pullSystem(
  dir: string,
  token: string | undefined,
  remote: string,
  ref?: string
): Promise<GitPullResult> {
  const branch = ref || (await runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  if (!isSafeGitPositional(remote) || (branch && !isSafeGitPositional(branch))) {
    return { ok: false, error: 'Invalid remote or draft name.' };
  }
  const args = tokenHeaderArgs(token);
  args.push(...HARDENED_REMOTE_FLAGS, 'pull', '--no-rebase', remote, branch || 'HEAD');
  const r = await runGit(dir, args);
  if (r.code === 0) return { ok: true };
  if (r.code === 127)
    return {
      ok: false,
      error: 'Getting the latest needs the git command-line tool for this project’s connection.',
    };
  const blob = `${r.stderr}\n${r.stdout}`;
  if (/conflict/i.test(blob)) {
    // Parse `CONFLICT (content): Merge conflict in <path>` lines.
    const files = [...blob.matchAll(/Merge conflict in (.+)/g)].map((m) => m[1].trim());
    return { ok: false, conflict: true, files: files.length ? files : undefined };
  }
  return { ok: false, error: r.stderr.trim() || 'Get latest failed.' };
}

// ── fetch (Refresh drafts) ──────────────────────────────────────────────────

export interface GitFetchResult {
  ok: boolean;
  /** Unix seconds the refresh completed — the UI shows it as "as of <time>". */
  fetchedAt?: number;
  /** See GitPushResult.authRequired — a tokenless refresh on the iso engine. */
  authRequired?: boolean;
  /** The fetch exceeded FETCH_TIMEOUT_MS and was bounded (DDR-133). */
  timedOut?: boolean;
  error?: string;
}

/** Refresh the team's drafts: fetch ALL remote heads (no singleBranch) so brand-new
 *  teammate drafts surface in `gitListBranches`. Prunes deleted remotes. Same
 *  optional-token model as gitPull. Explicit user gesture only — never auto-run. */
export async function gitFetchRemote(
  dir: string,
  token: string | undefined,
  opts: { remote?: string } = {}
): Promise<GitFetchResult> {
  if (!isRepo(dir)) return { ok: false, error: 'This project is not versioned yet.' };
  const remote = opts.remote || DEFAULT_REMOTE;
  if (!isSafeGitPositional(remote)) return { ok: false, error: 'Invalid remote name.' };
  // SECURITY (DDR-131 hardening): classify the configured remote URL BEFORE spawning
  // git. iso-git speaks HTTP(S) only, so an ssh/git remote must go to the system
  // binary — but a command-executing (`ext::`) / local (`file://`) URL must be
  // REFUSED, never handed to `git fetch` (it would run as the user). And the GitHub
  // token may only ride a github.com HTTPS request, never an attacker-chosen host.
  const url = await effectiveRemoteUrl(dir, remote); // post-insteadOf — the URL git dials
  const transport = classifyRemoteUrl(url);
  if (transport === 'none') return { ok: false, error: 'This project has no remote to refresh.' };
  if (transport === 'unsafe')
    return { ok: false, error: 'Maude can only refresh github.com (HTTPS or SSH) projects.' };
  const trustedHttp = transport === 'http' && isTrustedTokenHost(url);
  // Token/host POLICY is engine-independent (DDR-133): an HTTPS remote must be
  // github.com (token-host = fetch-host — never lend the PAT to another host) and
  // requires sign-in; an ssh remote uses the user's own key against whatever host
  // they configured. The engine choice below only decides HOW a vetted fetch runs.
  if (transport === 'http' && !trustedHttp)
    return { ok: false, error: 'Maude can only refresh github.com projects.' };
  // Tokenless github HTTPS: the iso engine can't authenticate (→ sign in), but system
  // git uses the developer's own credential helper, so only block when there's no
  // system git to fall back on (DDR-133). With system git, a tokenless fetch Just Works.
  if (transport === 'http' && !token && !(await systemGitAvailable()))
    return { ok: false, authRequired: true, error: 'Sign in with GitHub to refresh.' };
  try {
    if ((await systemGitAvailable()) || transport === 'ssh') {
      // System git (auto-preferred when present — DDR-133): attach the token header
      // ONLY for a trusted-host HTTPS remote (else fall back to the user's own
      // credential helper); an ssh remote authenticates with the user's own key.
      const args = trustedHttp ? tokenHeaderArgs(token) : [];
      args.push(...HARDENED_REMOTE_FLAGS, 'fetch', '--prune', remote);
      const r = await runGit(dir, args, undefined, FETCH_TIMEOUT_MS);
      if (r.timedOut)
        return {
          ok: false,
          timedOut: true,
          error: 'Refresh timed out — check your connection and try again.',
        };
      if (r.code === 127)
        return {
          ok: false,
          error: 'Refresh needs the git command-line tool for this project’s connection.',
        };
      if (r.code !== 0) {
        const blob = `${r.stderr}\n${r.stdout}`.toLowerCase();
        if (transport === 'http' && /auth|denied|credential|terminal prompts disabled/.test(blob))
          return { ok: false, authRequired: true, error: 'Sign in with GitHub to refresh.' };
        if (
          /permission denied|publickey|host key|authenticity|could not read from remote/.test(blob)
        )
          return {
            ok: false,
            error: 'Couldn’t reach the remote — check your connection or SSH key.',
          };
        return { ok: false, error: r.stderr.trim() || 'Could not refresh drafts.' };
      }
    } else {
      // iso engine: github HTTPS with a token (guaranteed by the policy guards above).
      const fetched = await withTimeout(
        git.fetch({
          fs,
          http,
          dir,
          remote,
          prune: true,
          onAuth: () => ({ username: token ?? '', password: '' }),
        }),
        FETCH_TIMEOUT_MS
      );
      if (fetched === TIMED_OUT)
        return {
          ok: false,
          timedOut: true,
          error: 'Refresh timed out — check your connection and try again.',
        };
    }
    return { ok: true, fetchedAt: Math.floor(Date.now() / 1000) };
  } catch (e) {
    const msg = errMsg(e);
    if (/unrecognized transport|unsupported|protocol/i.test(msg))
      return {
        ok: false,
        error: 'Refresh needs the git command-line tool for this project’s connection.',
      };
    if (/auth|denied|credential|401|403/i.test(msg))
      return { ok: false, authRequired: true, error: 'Sign in with GitHub to refresh.' };
    return { ok: false, error: msg };
  }
}

// ── resolve (finish a Get-latest merge that hit a conflict) ─────────────────

/** Finish the merge `gitPull` left unresolved, applying one CHOICE to every
 *  conflicted file:
 *   • `mine`   — keep our version (their edits set aside)
 *   • `theirs` — take the incoming version
 *   • `both`   — take theirs AND save ours as a "<name> (mine)<ext>" copy (the
 *                DiffView zero-data-loss default).
 *  Produces the two-parent merge commit so a subsequent Publish fast-forwards. */
export function gitResolve(
  dir: string,
  choice: ResolveChoice,
  token: string | undefined,
  opts: { remote?: string; ref?: string } = {}
): Promise<GitResolveResult> {
  return underRepoLock(
    dir,
    'resolve',
    () => resolveLocked(dir, choice, token, opts),
    () => ({
      ok: false,
      error: REPO_BUSY,
    })
  );
}

async function resolveLocked(
  dir: string,
  choice: ResolveChoice,
  token: string | undefined,
  opts: { remote?: string; ref?: string } = {}
): Promise<GitResolveResult> {
  if (!isRepo(dir)) return { ok: false, error: 'This project is not versioned yet.' };
  if (choice !== 'mine' && choice !== 'theirs' && choice !== 'both')
    return { ok: false, error: 'Pick how to resolve: keep mine, theirs, or both.' };
  return systemGitForced()
    ? resolveSystem(dir, choice, opts.remote || 'origin', opts.ref)
    : resolveIso(dir, choice, token, opts.remote || 'origin', opts.ref);
}

async function resolveIso(
  dir: string,
  choice: ResolveChoice,
  _token: string | undefined,
  remote: string,
  ref?: string
): Promise<GitResolveResult> {
  try {
    const branch = ref || (await git.currentBranch({ fs, dir, fullname: false })) || 'main';
    if (!isSafeGitPositional(remote) || !isSafeGitPositional(branch))
      return { ok: false, error: 'Invalid remote or draft name.' };
    const author = await resolveAuthor(dir);
    const theirsRef = `${remote}/${branch}`;

    // `gitPull` already fetched `theirsRef`; resolve OIDs from local refs (no net).
    const ourOid = await git.resolveRef({ fs, dir, ref: branch });
    try {
      await git.resolveRef({ fs, dir, ref: theirsRef });
    } catch {
      return { ok: false, error: 'Get the latest again — the shared copy moved.' };
    }

    // Authoritative conflicted set (dry-run merge with the default marker driver
    // throws MergeConflictError listing them) — drives the "both" copies.
    let conflicted: string[] = [];
    try {
      await git.merge({ fs, dir, ours: branch, theirs: theirsRef, author, dryRun: true });
    } catch (e) {
      conflicted = mergeConflictFiles(e) || [];
    }

    // A mergeDriver that returns ONE whole side per blob is always a clean merge,
    // so git.merge resolves every conflict and writes the two-parent merge commit;
    // non-conflicting changes from both sides still merge normally.
    const wantOurs = choice === 'mine';
    const mergeDriver = ({ contents }: { contents: string[] }) => ({
      mergedText: wantOurs ? contents[1] : contents[2], // [base, ours, theirs]
      cleanMerge: true,
    });
    await git.merge({
      fs,
      dir,
      ours: branch,
      theirs: theirsRef,
      author,
      message: `Get latest — kept ${choice}`,
      mergeDriver,
    });
    await git.checkout({ fs, dir, ref: branch, force: true });

    // "Keep both": theirs won the merged file; write OUR version as a sibling copy
    // and commit it so nothing is lost.
    const copies: string[] = [];
    if (choice === 'both') {
      for (const fp of conflicted) {
        try {
          const copyRel = mineCopyPath(fp);
          // Containment guard (audit F-1/D-2): every other write in this module
          // goes through isContainedRepoPath; the copy path is git-tree-derived
          // (can't hold `..` today) but the invariant must hold unconditionally.
          if (!isContainedRepoPath(dir, copyRel)) continue;
          const { blob } = await git.readBlob({ fs, dir, oid: ourOid, filepath: fp });
          fs.writeFileSync(join(dir, copyRel), Buffer.from(blob));
          await git.add({ fs, dir, filepath: copyRel });
          copies.push(copyRel);
        } catch {
          /* add/delete conflict — no our-side blob to copy; skip */
        }
      }
      if (copies.length)
        await git.commit({ fs, dir, author, message: 'Saved my version as a copy' });
    }
    return { ok: true, copies: copies.length ? copies : undefined };
  } catch (e) {
    const cf = mergeConflictFiles(e);
    if (cf)
      return { ok: false, unresolved: cf, error: 'Could not finish the merge automatically.' };
    return { ok: false, error: errMsg(e) };
  }
}

async function resolveSystem(
  dir: string,
  choice: ResolveChoice,
  _remote: string,
  _ref?: string
): Promise<GitResolveResult> {
  // After `git pull --no-rebase` hit a conflict the repo is mid-merge (MERGE_HEAD
  // + unmerged index). Resolve each unmerged path with the chosen side, commit.
  const u = await runGit(dir, ['diff', '--name-only', '--diff-filter=U']);
  const files = u.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!files.length) return { ok: false, error: 'Nothing to resolve — get the latest first.' };
  const copies: string[] = [];
  // Paths come from git's own unmerged list and are passed after `--`, so a
  // dash-led name can't be parsed as an option.
  for (const fp of files) {
    let ourContent: Buffer | null = null;
    if (choice === 'both') {
      const show = await runGit(dir, ['show', `:2:${fp}`]); // stage 2 = ours
      if (show.code === 0) ourContent = Buffer.from(show.stdout);
    }
    const side = choice === 'mine' ? '--ours' : '--theirs';
    const co = await runGit(dir, ['checkout', side, '--', fp]);
    if (co.code !== 0) return { ok: false, error: co.stderr.trim() || `Could not resolve ${fp}.` };
    await runGit(dir, ['add', '--', fp]);
    if (choice === 'both' && ourContent) {
      const copyRel = mineCopyPath(fp);
      // Containment guard (audit F-1/D-2) — same invariant as resolveIso.
      if (isContainedRepoPath(dir, copyRel)) {
        fs.writeFileSync(join(dir, copyRel), ourContent);
        await runGit(dir, ['add', '--', copyRel]);
        copies.push(copyRel);
      }
    }
  }
  const c = await runGit(dir, ['commit', '--no-edit']);
  if (c.code !== 0) return { ok: false, error: c.stderr.trim() || 'Could not finish the merge.' };
  return { ok: true, copies: copies.length ? copies : undefined };
}

function mergeConflictFiles(e: unknown): string[] | null {
  if (!e || typeof e !== 'object') return null;
  const err = e as { code?: string; caller?: string; data?: unknown };
  const isConflict =
    err.code === 'MergeConflictError' ||
    err.code === 'MergeNotSupportedError' ||
    err.code === 'CheckoutConflictError';
  if (!isConflict) return null;
  // isomorphic-git ≥1.x throws MergeConflictError with `data` shaped as an OBJECT
  // ({ filepaths, bothModified, deleteByUs, deleteByTheirs }) — NOT a bare array.
  // The original `Array.isArray(err.data)` check therefore always fell through to
  // `[]`, so a real conflict surfaced with NO files and the DiffView resolver
  // never opened (the project wedged). Handle both shapes; an empty list still
  // means "conflict, but no parseable paths".
  if (Array.isArray(err.data)) return err.data.map(String);
  const d = err.data as { filepaths?: unknown; bothModified?: unknown } | null | undefined;
  if (d && typeof d === 'object') {
    const list = Array.isArray(d.filepaths)
      ? d.filepaths
      : Array.isArray(d.bothModified)
        ? d.bothModified
        : null;
    if (list) return list.map(String);
  }
  return [];
}

/** Repo-relative sibling path for the zero-loss "keep both" copy:
 *  `.design/ui/Foo.tsx` → `.design/ui/Foo (mine).tsx`. */
function mineCopyPath(rel: string): string {
  const slash = rel.lastIndexOf('/');
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : '';
  const base = slash >= 0 ? rel.slice(slash + 1) : rel;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  return `${dir}${stem} (mine)${ext}`;
}

// ── log (History) ─────────────────────────────────────────────────────────

/** `filepath` (repo-relative, forward slashes) scopes History to a single
 *  canvas — the per-file version list that drives the History click-to-preview
 *  and the DiffView "Saved version" picker (phase-27.1). Omit for the repo-wide
 *  log (byte-identical to the pre-27.1 behaviour). The caller is responsible for
 *  containment-validating `filepath` (it reaches system-git positionally after
 *  `--`, so no option injection, but it must not address a file outside the
 *  design tree). */
export async function gitLog(dir: string, limit = 30, filepath?: string): Promise<GitLogEntry[]> {
  if (!isRepo(dir)) return [];
  return (await systemGitAvailable())
    ? logSystem(dir, limit, filepath)
    : logIso(dir, limit, filepath);
}

async function logIso(dir: string, limit: number, filepath?: string): Promise<GitLogEntry[]> {
  try {
    const commits = await git.log({ fs, dir, depth: limit, ...(filepath ? { filepath } : {}) });
    return commits.map((c) => {
      const a = c.commit.author;
      return {
        sha: c.oid,
        message: c.commit.message.trim().split('\n')[0] ?? '',
        author: a.name,
        email: a.email,
        date: new Date(a.timestamp * 1000).toISOString(),
      };
    });
  } catch {
    return [];
  }
}

async function logSystem(dir: string, limit: number, filepath?: string): Promise<GitLogEntry[]> {
  // The format, the argv (including the `--` terminator) and the parser all
  // live in `log-format.ts` — the cloud cell's `/api/history` reads its own
  // repo through the SAME three, so a cloud row and a local row cannot drift
  // into different shapes behind one renderer. `gitLogEnv` carries the
  // GIT_LITERAL_PATHSPECS hardening that must travel with a scoped argv.
  const r = await runGit(dir, gitLogArgs(limit, filepath), gitLogEnv(filepath));
  if (r.code !== 0) return [];
  return parseGitLog(r.stdout);
}

// ── diff (visual before/after) ─────────────────────────────────────────────

/** Files that differ between commit `sha` and the working tree, scoped to
 *  `designPrefix`. DiffView uses each entry to drive the screenshot pipeline
 *  (render `before` sha vs `after`=workdir). `sha` defaults to HEAD, in which
 *  case this is exactly the current dirty set. */
export async function gitDiff(
  dir: string,
  sha = 'HEAD',
  opts: { designPrefix?: string } = {}
): Promise<GitDiffEntry[]> {
  if (!isRepo(dir)) return [];
  const prefix = normPrefix(opts.designPrefix);
  return (await systemGitAvailable()) ? diffSystem(dir, sha, prefix) : diffIso(dir, sha, prefix);
}

async function diffIso(dir: string, sha: string, prefix: string): Promise<GitDiffEntry[]> {
  try {
    const ref = await git.resolveRef({ fs, dir, ref: sha }).catch(() => sha);
    const changed = await git.walk({
      fs,
      dir,
      trees: [git.TREE({ ref }), git.WORKDIR()],
      map: async (filepath, entries) => {
        if (filepath === '.') return;
        if (prefix && !underPrefix(filepath, prefix)) return;
        if (isMaudeRuntimeState(filepath)) return;
        const [tree, work] = entries;
        const treeOid = tree ? await tree.oid().catch(() => undefined) : undefined;
        const workOid = work ? await work.oid().catch(() => undefined) : undefined;
        // Different content (or added/removed) → it's a diff entry.
        if (treeOid === workOid) return;
        // Skip directories.
        const tType = tree ? await tree.type().catch(() => 'blob') : 'blob';
        const wType = work ? await work.type().catch(() => 'blob') : 'blob';
        if (tType === 'tree' || wType === 'tree') return;
        return filepath;
      },
    });
    return (changed as string[])
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((file) => ({ file, before: sha, after: 'workdir' as const }));
  } catch {
    return [];
  }
}

async function diffSystem(dir: string, sha: string, prefix: string): Promise<GitDiffEntry[]> {
  // Second guard (the endpoint already anchors the sha regex): a dash-led rev
  // would be parsed as a `git diff` option even with the trailing `--` (which
  // only protects the pathspec). A real rev never starts with `-`.
  if (!isSafeGitPositional(sha)) return [];
  const r = await runGit(dir, ['diff', '--name-only', '-z', sha, '--']);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\0')
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f && underPrefix(f, prefix) && !isMaudeRuntimeState(f))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({ file, before: sha, after: 'workdir' as const }));
}

// ── show a file at a past version (DiffView "before" render) ────────────────

/** The text content of `repoRelPath` as it was at commit/ref `sha`, or null if
 *  unavailable. Drives the DiffView "before" pane (build the canvas from this
 *  source). `sha` is positional-guarded (no argument injection) and the path is
 *  containment-checked. Read-only; same exposure class as reading the current
 *  design file. */
export async function gitShowFile(
  dir: string,
  sha: string,
  repoRelPath: string
): Promise<string | null> {
  if (!isRepo(dir)) return null;
  if (!isSafeGitPositional(sha)) return null;
  const rel = repoRelPath.replace(/\\/g, '/');
  if (!isContainedRepoPath(dir, rel)) return null;
  try {
    if (await systemGitAvailable()) {
      const r = await runGit(dir, ['show', `${sha}:${rel}`]);
      return r.code === 0 ? r.stdout : null;
    }
    const oid = await git.resolveRef({ fs, dir, ref: sha }).catch(() => sha);
    const { blob } = await git.readBlob({ fs, dir, oid, filepath: rel });
    return new TextDecoder().decode(blob);
  } catch {
    return null;
  }
}

// ── local "unpushed" (saved-but-not-published) — NO network ─────────────────

/** Count local commits not yet on the remote-tracking ref `<remote>/<branch>`,
 *  using only on-disk refs (no fetch). When no tracking ref exists but a remote
 *  is configured, every commit counts as unpushed (never published). 0 when
 *  there's no remote or no branch. Best-effort; callers swallow errors → 0. */
async function localUnpushed(dir: string, branch: string | null, remote: string): Promise<number> {
  if (!branch) return 0;
  // Guard parity with the other system-git callsites — `branch`/`remote` are
  // server-derived today, but never interpolate an unguarded positional into git
  // argv (defense-in-depth so a future caller can't re-open the injection class).
  if (!isSafeGitPositional(branch) || !isSafeGitPositional(remote)) return 0;
  if (await systemGitAvailable()) {
    const r = await runGit(dir, ['rev-list', '--count', `${remote}/${branch}..HEAD`]);
    if (r.code === 0) return Number(r.stdout.trim()) || 0;
    // No tracking ref — count all commits if a remote exists, else 0.
    const remotes = await runGit(dir, ['remote']);
    if (!remotes.stdout.trim()) return 0;
    const all = await runGit(dir, ['rev-list', '--count', 'HEAD']);
    return all.code === 0 ? Number(all.stdout.trim()) || 0 : 0;
  }
  const trackingOid = await git
    .resolveRef({ fs, dir, ref: `refs/remotes/${remote}/${branch}` })
    .catch(() => null);
  const localLog = await git.log({ fs, dir, ref: 'HEAD', depth: 500 }).catch(() => []);
  if (!trackingOid) {
    const remotes = await git.listRemotes({ fs, dir }).catch(() => []);
    return remotes.length ? localLog.length : 0;
  }
  const remoteSet = new Set(
    (await git.log({ fs, dir, ref: trackingOid, depth: 500 }).catch(() => [])).map((c) => c.oid)
  );
  let n = 0;
  for (const c of localLog) {
    if (remoteSet.has(c.oid)) break; // shared history → the rest is published
    n++;
  }
  return n;
}

// ── remote ahead/behind (Get latest nudge) ─────────────────────────────────

interface AheadBehind {
  ahead: number;
  behind: number;
}

// In-memory TTL cache + in-flight dedupe for the network probe (DDR-132). A
// Changes-panel toggle, a 60 s tick, and effect re-runs all call status?remote=1;
// without this they each fire a fresh `git fetch`. The cache is per FRESH process
// — a repo switch respawns the sidecar (fresh process ⇒ one fresh probe), which is
// exactly the desired semantics, so it deliberately never persists to disk.
const REMOTE_PROBE_TTL_MS = 45_000;
const probeCache = new Map<string, { at: number; val: AheadBehind }>();
const probeInflight = new Map<string, Promise<AheadBehind>>();

/** Drop any cached/in-flight probe for `dir` so the next status re-fetches —
 *  called after a push/pull/fold so the "Get latest" nudge updates immediately. */
export function invalidateRemoteProbe(dir: string): void {
  const prefix = `${dir}\0`;
  for (const k of probeCache.keys()) if (k.startsWith(prefix)) probeCache.delete(k);
  for (const k of probeInflight.keys()) if (k.startsWith(prefix)) probeInflight.delete(k);
}

/** Resolve the current branch with the active engine — local-only, no network. */
async function currentBranchOf(dir: string): Promise<string> {
  if (await systemGitAvailable()) {
    const r = await runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return r.stdout.trim() || 'main';
  }
  return (await git.currentBranch({ fs, dir, fullname: false })) || 'main';
}

/** Fetch the tracking remote and count commits ahead (local-only) / behind
 *  (remote-only). `behind > 0` is what surfaces the "Get latest" banner. Network;
 *  callers guard with try/catch so an offline poll never breaks local status.
 *
 *  TTL-cached + in-flight-deduped per `dir\0remote\0branch` (DDR-132): a value
 *  younger than the TTL is served without a fetch, and concurrent callers share
 *  one in-flight promise. Only the RESOLVED value is cached — a throw clears the
 *  in-flight slot so a later call retries (failures are never cached). */
export async function remoteAheadBehind(
  dir: string,
  token: string | undefined,
  remote = 'origin'
): Promise<AheadBehind> {
  const branch = await currentBranchOf(dir);
  const key = `${dir}\0${remote}\0${branch}`;
  const hit = probeCache.get(key);
  if (hit && Date.now() - hit.at < REMOTE_PROBE_TTL_MS) return hit.val;
  const existing = probeInflight.get(key);
  if (existing) return existing;
  const p = remoteAheadBehindUncached(dir, token, remote, branch)
    .then((val) => {
      probeCache.set(key, { at: Date.now(), val });
      return val;
    })
    .finally(() => {
      probeInflight.delete(key);
    });
  probeInflight.set(key, p);
  return p;
}

async function remoteAheadBehindUncached(
  dir: string,
  token: string | undefined,
  remote: string,
  branch: string
): Promise<AheadBehind> {
  // SECURITY (DDR-131 hardening): this probe runs UNATTENDED (status?remote=1 on a
  // 60s tick / post-action), so it's the highest-value RCE sink — classify the
  // remote URL before touching the git binary. A command-executing (`ext::`) or
  // local (`file://`) URL is refused (return 0/0, no spawn); the token rides only a
  // github.com HTTPS request, never an attacker-chosen host.
  const url = await effectiveRemoteUrl(dir, remote); // post-insteadOf — the URL git dials
  const transport = classifyRemoteUrl(url);
  if (transport === 'none' || transport === 'unsafe') return { ahead: 0, behind: 0 };
  const trustedHttp = transport === 'http' && isTrustedTokenHost(url);
  // SECURITY (DDR-133 fix — adversarial review F1): the host-allowlist MUST gate this
  // UNATTENDED probe BEFORE the engine branch, mirroring gitFetchRemote (`:1089`). With
  // system git now auto-preferred, an http transport otherwise reached the system path
  // for ANY host — turning a poisoned non-github `remote.origin.url` into an unattended
  // `git fetch` SSRF/beacon (the old `!trustedHttp` guard sat AFTER the engine branch,
  // so it only ever protected the now-dead iso path). github-only for http; ssh uses the
  // user's own key (DDR-131-accepted, same as the explicit Refresh).
  if (transport === 'http' && !trustedHttp) return { ahead: 0, behind: 0 };
  if ((await systemGitAvailable()) || transport === 'ssh')
    return remoteAheadBehindSystem(dir, trustedHttp ? token : undefined, remote, branch);
  // iso engine, HTTP(S) to github (trustedHttp guaranteed by the guard above).
  // Bounded (DDR-133): a timeout THROWS so the wrapper never caches it — the next
  // poll retries, and local status is unaffected (caller try/catches).
  const fetched = await withTimeout(
    git.fetch({
      fs,
      http,
      dir,
      remote,
      ref: branch,
      singleBranch: true,
      tags: false,
      onAuth: () => ({ username: token ?? '', password: '' }),
    }),
    PROBE_TIMEOUT_MS
  );
  if (fetched === TIMED_OUT) throw new Error('remote probe timed out');
  const localOid = await git.resolveRef({ fs, dir, ref: branch });
  const remoteOid = await git
    .resolveRef({ fs, dir, ref: `refs/remotes/${remote}/${branch}` })
    .catch(() => null);
  if (!remoteOid || remoteOid === localOid) return { ahead: 0, behind: 0 };

  const localSet = new Set(
    (await git.log({ fs, dir, ref: localOid, depth: 500 })).map((c) => c.oid)
  );
  const remoteSet = new Set(
    (await git.log({ fs, dir, ref: remoteOid, depth: 500 })).map((c) => c.oid)
  );
  let ahead = 0;
  let behind = 0;
  for (const oid of localSet) if (!remoteSet.has(oid)) ahead++;
  for (const oid of remoteSet) if (!localSet.has(oid)) behind++;
  return { ahead, behind };
}

async function remoteAheadBehindSystem(
  dir: string,
  token: string | undefined,
  remote: string,
  branch: string
): Promise<{ ahead: number; behind: number }> {
  if (!isSafeGitPositional(remote) || !isSafeGitPositional(branch)) {
    throw new Error('invalid remote or branch');
  }
  // Token only when the caller vetted a trusted HTTPS host; harden the transport
  // allowlist at the git layer too (defense-in-depth behind classifyRemoteUrl).
  const args = token ? tokenHeaderArgs(token) : [];
  args.push(...HARDENED_REMOTE_FLAGS, 'fetch', remote, branch);
  const f = await runGit(dir, args, undefined, PROBE_TIMEOUT_MS);
  if (f.timedOut) throw new Error('remote probe timed out');
  if (f.code !== 0) throw new Error(f.stderr.trim() || 'fetch failed');
  const counts = await runGit(dir, [
    'rev-list',
    '--left-right',
    '--count',
    `${branch}...${remote}/${branch}`,
  ]);
  if (counts.code !== 0) return { ahead: 0, behind: 0 };
  const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

// ── shared ───────────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Guard: a repo-relative path that stays inside `dir` (no traversal, no abs).
 *  The endpoint layer validates user-supplied `files[]` with this before they
 *  reach gitCommit so a poisoned path can't stage outside the repo. */
export function isContainedRepoPath(dir: string, repoRelative: string): boolean {
  if (typeof repoRelative !== 'string' || !repoRelative) return false;
  if (repoRelative.includes('\0')) return false;
  if (isAbsolute(repoRelative)) return false;
  const resolved = join(dir, repoRelative);
  const rel = relative(dir, resolved);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`);
}

export interface GitCloneResult {
  ok: boolean;
  dir?: string;
  authRequired?: boolean;
  error?: string;
}

/** Clone a repo into `dir` (a fresh, non-existent path). Full clone of the default
 *  branch (no shallow) so the working copy can commit + Publish. The optional token
 *  authenticates private repos via iso-git's `onAuth` (token-as-username, never
 *  logged) — phase-28's "pull a local copy". */
export async function gitClone(url: string, dir: string, token?: string): Promise<GitCloneResult> {
  // SECURITY (phase-28 audit D-1/F-2, defense-in-depth): only ever offer the
  // keychain token to a github.com host. Callers already rebuild a canonical
  // URL, but this guarantees a crafted/redirected URL can never receive the PAT
  // as Basic auth — the bug class the whole keychain/bridge design exists to
  // prevent. A non-github host clones tokenless (public) or fails auth (private).
  let tokenHost = false;
  try {
    tokenHost = new URL(url).hostname.toLowerCase() === 'github.com';
  } catch {
    tokenHost = false;
  }
  const auth = token && tokenHost ? { onAuth: () => ({ username: token, password: '' }) } : {};
  try {
    await git.clone({
      fs,
      http,
      dir,
      url,
      singleBranch: true,
      ...auth,
    });
    // An EMPTY remote (a freshly-created repo) clones to a repo with NO commits and
    // an odd/unborn HEAD — the first Save version then fails to land on a resolvable
    // `main`, so Publish errors with "Could not find main" and unpushed can't be
    // computed. Normalize HEAD to an unborn `main` so the first commit creates it and
    // Publish (first push) works. Only touch the empty case; a populated clone is left
    // exactly as cloned.
    const hasCommits = await git
      .log({ fs, dir, depth: 1 })
      .then((l) => l.length > 0)
      .catch(() => false);
    if (!hasCommits) {
      fs.writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    }
    return { ok: true, dir };
  } catch (e) {
    const msg = errMsg(e);
    if (/401|403|auth|credential|unauthor/i.test(msg)) {
      return {
        ok: false,
        authRequired: true,
        error: 'GitHub sign-in is needed to download this project.',
      };
    }
    return { ok: false, error: 'Could not download the project. Check the link and try again.' };
  }
}

export const __testing = {
  classify,
  classifyPorcelain,
  isNonFastForward,
  normPrefix,
  isMaudeRuntimeState,
  isSafeGitPositional,
};
