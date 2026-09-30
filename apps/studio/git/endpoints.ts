// Phase 27 (epic E2) — `/_api/git/*` orchestration.
//
// Pure-ish handlers behind the git routes: validate inputs, expand the DDR-112
// staging set (a selected canvas auto-stages its same-stem sidecars), call the
// service, and shape a `{ status, json }` result. NO HTTP/Request dependency —
// http.ts owns the HTTP gating (method · main-origin · CSRF · loopback) and
// passes already-parsed inputs in. That split keeps the security boundary in one
// place (http.ts, mirroring canvas-create.ts) and this module unit-testable +
// free of an http.ts import cycle.
//
// SECURITY: every route is main-origin-only by omission from CANVAS_SAFE_API +
// startCanvasServer's `routes` map (the dual-allowlist rule). The token on
// push/pull is used once for the service's `onAuth`/header and never logged,
// echoed, or persisted (it is stripped from the JSON we return on error).

import type { Context } from '../context.ts';
import { parseGitHubRemote } from '../github/endpoints.ts';
import { createPullRequest, GitHubApiError } from '../github/service.ts';
import { getGithubToken } from '../github/token.ts';
import {
  type GitFileStatus,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiscard,
  gitFetchRemote,
  gitFoldDraft,
  gitListBranches,
  gitLog,
  gitPull,
  gitPush,
  gitResolve,
  gitStatus,
  isContainedRepoPath,
  type ResolveChoice,
} from './service.ts';

export interface GitEndpointResult {
  status: number;
  json: unknown;
}

const MAX_MESSAGE = 1000;
const MAX_FILES = 5000;

// A git remote name / ref that is SAFE to pass as a bare argv positional to the
// system-git engine. The leading-`-` reject is load-bearing: `git push <remote>`
// / `git fetch <ref>` parse a dash-led positional as an OPTION, so an unvalidated
// `--upload-pack=…` / `--exec=…` is argument-injection → command execution
// (CWE-88, the CVE-2017-1000117 family; security review A1/A2). isomorphic-git is
// immune (values are data, not argv) but we validate at the boundary so BOTH
// engines are safe regardless of MAUDE_USE_SYSTEM_GIT.
const GIT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
// A remote NAME is `origin`/`upstream` — never a path, so it excludes `/`
// (a path-shaped name could otherwise reach git as a local-filesystem
// transport on the system engine; security re-review hardening note).
const GIT_REMOTE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
function safeGitArg(v: unknown): string | undefined {
  return typeof v === 'string' && GIT_REF_RE.test(v) ? v : undefined;
}
function safeRemoteArg(v: unknown): string | undefined {
  return typeof v === 'string' && GIT_REMOTE_RE.test(v) ? v : undefined;
}

export interface GitEndpoints {
  status(opts?: { checkRemote?: boolean; token?: string }): Promise<GitEndpointResult>;
  commit(body: unknown): Promise<GitEndpointResult>;
  discard(body: unknown): Promise<GitEndpointResult>;
  push(body: unknown): Promise<GitEndpointResult>;
  pull(body: unknown): Promise<GitEndpointResult>;
  resolve(body: unknown): Promise<GitEndpointResult>;
  log(limitRaw: string | null, pathRaw?: string | null): Promise<GitEndpointResult>;
  diff(sha: string | null): Promise<GitEndpointResult>;
  // Phase 29 (E4) — drafts (branches). The UI vocabulary: draft=branch, "Shared
  // version"=main. The current branch is already on the status payload (`branch`).
  branches(): Promise<GitEndpointResult>;
  createBranch(body: unknown): Promise<GitEndpointResult>;
  checkout(body: unknown): Promise<GitEndpointResult>;
  // "Add this draft to the Shared version" — token-bearing (it publishes).
  fold(body: unknown): Promise<GitEndpointResult>;
  // "Refresh drafts" — token-bearing fetch so new remote drafts surface.
  fetchRemote(body: unknown): Promise<GitEndpointResult>;
}

export function createGitEndpoints(ctx: Context): GitEndpoints {
  const dir = ctx.paths.repoRoot;
  const designPrefix = ctx.paths.designRel;

  function bad(error: string): GitEndpointResult {
    return { status: 400, json: { ok: false, error } };
  }

  async function status(
    opts: { checkRemote?: boolean; token?: string } = {}
  ): Promise<GitEndpointResult> {
    // The "Get latest" remote ahead/behind probe needs a token for private repos.
    // It is NOT client-supplied (A3 — no token in a GET query); we fetch it
    // server-side from the keychain bridge (phase-28). No bridge / not signed in
    // → undefined → local-only status (no remote nudge), never an error.
    const token = opts.checkRemote
      ? (opts.token ?? (await getGithubToken()) ?? undefined)
      : opts.token;
    const result = await gitStatus(dir, {
      designPrefix,
      checkRemote: opts.checkRemote,
      token,
    });
    return { status: 200, json: result };
  }

  async function commit(body: unknown): Promise<GitEndpointResult> {
    const b = (body ?? {}) as { message?: unknown; files?: unknown };
    if (typeof b.message !== 'string') return bad('A version needs a short message.');
    const message = b.message.trim();
    if (!message) return bad('A version needs a short message.');
    if (message.length > MAX_MESSAGE) return bad('That message is too long.');

    let files: string[] | undefined;
    if (b.files != null) {
      if (!Array.isArray(b.files)) return bad('files must be a list.');
      if (b.files.length > MAX_FILES) return bad('Too many files selected.');
      const reqFiles: string[] = [];
      for (const f of b.files) {
        if (typeof f !== 'string' || !isContainedRepoPath(dir, f)) {
          return bad('A selected file is outside this project.');
        }
        reqFiles.push(f.replace(/\\/g, '/'));
      }
      // DDR-112 — auto-stage each selected canvas's same-stem sidecars (the
      // `.meta.json` layout/viewport state travels with its canvas). Only dirty
      // sidecars are added, so a clean meta isn't needlessly committed.
      const dirty = (await gitStatus(dir, { designPrefix })).files.map((f) => f.path);
      files = expandSidecars(reqFiles, dirty);
    }

    const res = await gitCommit(dir, message, files, { designPrefix });
    if (!res.ok) return { status: 400, json: { ok: false, error: res.error } };
    return { status: 200, json: { ok: true, sha: res.sha } };
  }

  async function discard(body: unknown): Promise<GitEndpointResult> {
    const b = (body ?? {}) as { files?: unknown };
    if (!Array.isArray(b.files) || b.files.length === 0) return bad('Select files to discard.');
    if (b.files.length > MAX_FILES) return bad('Too many files selected.');
    const files: string[] = [];
    for (const f of b.files) {
      if (typeof f !== 'string' || !isContainedRepoPath(dir, f)) {
        return bad('A selected file is outside this project.');
      }
      files.push(f.replace(/\\/g, '/'));
    }
    const res = await gitDiscard(dir, files, { designPrefix });
    if (!res.ok) return { status: 400, json: { ok: false, error: res.error } };
    return { status: 200, json: { ok: true, discarded: res.discarded } };
  }

  async function push(body: unknown): Promise<GitEndpointResult> {
    // Token resolution (phase-28): an explicit body token → the keychain bridge
    // (signed in via GitHub) → undefined. The bridge token is fetched server-side
    // (never client-supplied), so "Publish" works once you've signed in. With no
    // token the system-git engine still uses the credential helper; iso-git without
    // a token → authRequired → "Sign in to publish".
    const token = readToken(body) ?? (await getGithubToken()) ?? undefined;
    const b = (body ?? {}) as { remote?: unknown; ref?: unknown };
    // Reject a dash-led / malformed remote|ref BEFORE it can reach git argv (A1).
    if (b.remote != null && safeRemoteArg(b.remote) === undefined) return bad('Invalid remote.');
    if (b.ref != null && safeGitArg(b.ref) === undefined) return bad('Invalid draft name.');
    const res = await gitPush(dir, token, {
      remote: safeRemoteArg(b.remote),
      ref: safeGitArg(b.ref),
    });
    if (res.ok) return { status: 200, json: { ok: true } };
    if (res.authRequired) {
      return { status: 401, json: { ok: false, authRequired: true, error: res.error } };
    }
    if (res.conflict) {
      return {
        status: 409,
        json: { ok: false, conflict: true, error: 'Publish rejected — Get latest first.' },
      };
    }
    return { status: 502, json: { ok: false, error: res.error ?? 'Publish failed.' } };
  }

  async function pull(body: unknown): Promise<GitEndpointResult> {
    const token = readToken(body) ?? (await getGithubToken()) ?? undefined;
    const b = (body ?? {}) as { remote?: unknown; ref?: unknown };
    if (b.remote != null && safeRemoteArg(b.remote) === undefined) return bad('Invalid remote.');
    if (b.ref != null && safeGitArg(b.ref) === undefined) return bad('Invalid draft name.');
    const res = await gitPull(dir, token, {
      remote: safeRemoteArg(b.remote),
      ref: safeGitArg(b.ref),
    });
    if (res.ok) return { status: 200, json: { ok: true } };
    if (res.authRequired) {
      return { status: 401, json: { ok: false, authRequired: true, error: res.error } };
    }
    if (res.conflict) {
      return { status: 409, json: { ok: false, conflict: true, files: res.files ?? [] } };
    }
    return { status: 502, json: { ok: false, error: res.error ?? 'Get latest failed.' } };
  }

  async function resolve(body: unknown): Promise<GitEndpointResult> {
    const token = readToken(body) ?? (await getGithubToken()) ?? undefined;
    const b = (body ?? {}) as { choice?: unknown; remote?: unknown; ref?: unknown };
    const choice = b.choice;
    if (choice !== 'mine' && choice !== 'theirs' && choice !== 'both')
      return bad('Pick how to resolve: keep mine, theirs, or both.');
    if (b.remote != null && safeRemoteArg(b.remote) === undefined) return bad('Invalid remote.');
    if (b.ref != null && safeGitArg(b.ref) === undefined) return bad('Invalid draft name.');
    const res = await gitResolve(dir, choice as ResolveChoice, token, {
      remote: safeRemoteArg(b.remote),
      ref: safeGitArg(b.ref),
    });
    if (res.ok) return { status: 200, json: { ok: true, copies: res.copies ?? [] } };
    if (res.authRequired)
      return { status: 401, json: { ok: false, authRequired: true, error: res.error } };
    if (res.unresolved?.length)
      return { status: 409, json: { ok: false, unresolved: res.unresolved, error: res.error } };
    return { status: 502, json: { ok: false, error: res.error ?? 'Could not finish the merge.' } };
  }

  async function log(limitRaw: string | null, pathRaw?: string | null): Promise<GitEndpointResult> {
    let limit = 30;
    if (limitRaw != null) {
      const n = Number(limitRaw);
      if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), 200);
    }
    // Optional per-file scope (phase-27.1 — History click-to-preview + DiffView
    // version picker). A malformed / out-of-tree path is a hard 400, NOT a
    // silent fall-back to the repo-wide log: a bug must never widen the history
    // beyond the file the UI asked for.
    let filepath: string | undefined;
    if (pathRaw != null && pathRaw !== '') {
      // Normalize separators BEFORE the guards so the validated string is byte-
      // for-byte what reaches git (no post-guard mutation re-opening a bypass).
      const p = pathRaw.replace(/\\/g, '/');
      if (!isContainedRepoPath(dir, p)) return bad('That file is outside this project.');
      // History is scoped to the DESIGN TREE (matching status/diff) — not the
      // whole repo. This also rejects pathspec-magic prefixes (`:/`, `:(top)…`,
      // `:(exclude)…`): none start with the designPrefix, so they can never reach
      // system-git as live pathspec magic (defence-in-depth atop the `--`
      // terminator + GIT_LITERAL_PATHSPECS in logSystem).
      if (designPrefix && p !== designPrefix && !p.startsWith(`${designPrefix}/`)) {
        return bad('That file is outside this project.');
      }
      filepath = p;
    }
    return { status: 200, json: { entries: await gitLog(dir, limit, filepath) } };
  }

  async function diff(sha: string | null): Promise<GitEndpointResult> {
    // `sha` comes from a query param; allow only a git-ref-ish token whose FIRST
    // char is alphanumeric — a leading `-` would be parsed by system-git's
    // `git diff <sha> --` as an option, not a rev (argument injection, A2).
    const ref = sha && /^[A-Za-z0-9][A-Za-z0-9_./~^@{}-]{0,199}$/.test(sha) ? sha : 'HEAD';
    return { status: 200, json: { entries: await gitDiff(dir, ref, { designPrefix }) } };
  }

  // ── drafts (branches) — phase 29 / E4 ──────────────────────────────────────
  async function branches(): Promise<GitEndpointResult> {
    return { status: 200, json: { branches: await gitListBranches(dir) } };
  }

  async function createBranch(body: unknown): Promise<GitEndpointResult> {
    const b = (body ?? {}) as { name?: unknown };
    // Reject a dash-led / malformed draft name BEFORE it can reach git argv (A1).
    const name = safeGitArg(b.name);
    if (name === undefined) return bad("That draft name has characters we can't use.");
    const res = await gitCreateBranch(dir, name);
    if (!res.ok) return { status: 400, json: { ok: false, error: res.error } };
    return { status: 200, json: { ok: true, branch: res.branch } };
  }

  async function checkout(body: unknown): Promise<GitEndpointResult> {
    const b = (body ?? {}) as { name?: unknown };
    const name = safeGitArg(b.name);
    if (name === undefined) return bad('Invalid draft name.');
    const res = await gitCheckout(dir, name);
    // A dirty tree that blocks the switch is a precondition failure (409) so the
    // UI can say "Save your changes first" distinctly from a 400 validation error.
    if (!res.ok) return { status: 409, json: { ok: false, error: res.error } };
    return { status: 200, json: { ok: true, branch: res.branch } };
  }

  async function fold(body: unknown): Promise<GitEndpointResult> {
    // Token resolution mirrors push: body token → keychain bridge → undefined. Needed
    // for the GitHub PR API call; an ssh draft-push authenticates with the user's key.
    const token = readToken(body) ?? (await getGithubToken()) ?? undefined;
    const b = (body ?? {}) as { name?: unknown; remote?: unknown };
    const name = safeGitArg(b.name);
    if (name === undefined) return bad('Invalid draft name.');
    if (b.remote != null && safeRemoteArg(b.remote) === undefined) return bad('Invalid remote.');
    const res = await gitFoldDraft(dir, name, token, { remote: safeRemoteArg(b.remote) });
    if (!res.ok) {
      if (res.authRequired)
        return { status: 401, json: { ok: false, authRequired: true, error: res.error } };
      if (res.conflict)
        return { status: 409, json: { ok: false, conflict: true, error: res.error } };
      return { status: 502, json: { ok: false, error: res.error ?? 'Could not add the draft.' } };
    }
    // Local-merge path (no GitHub remote): the draft is already in the Shared version.
    if (!res.prReady) return { status: 200, json: { ok: true, shared: res.shared } };
    // PR path: the draft branch is pushed — open a pull request draft→shared. The merge
    // itself happens on GitHub after review (this is how a protected `main` is added to).
    const gh = res.remoteUrl ? parseGitHubRemote(res.remoteUrl) : null;
    if (!gh)
      return draftPublishedNoPr(
        res.shared,
        res.head,
        'Draft published. Open a pull request on your Git host to add it to the Shared version.'
      );
    if (!token)
      return draftPublishedNoPr(
        res.shared,
        res.head,
        'Draft published. Sign in with GitHub in Maude to open the pull request.'
      );
    try {
      const pr = await createPullRequest(token, gh.owner, gh.repo, {
        head: res.head as string,
        base: res.base as string,
        title: `Add draft “${res.head}” to ${res.base}`,
        body: 'Opened from Maude — “Add to Shared version”.',
      });
      return {
        status: 200,
        // Surface the resolved destination repo (F2): the user should SEE which
        // owner/repo their draft was pushed to / PR'd against, not just "the Shared
        // version" — a poisoned `origin` would otherwise silently target another repo.
        json: {
          ok: true,
          shared: res.shared,
          prUrl: pr.html_url,
          prNumber: pr.number,
          repo: `${gh.owner}/${gh.repo}`,
        },
      };
    } catch (e) {
      // The draft IS pushed — a PR-creation failure is a partial success, not a hard
      // fail. Surface the reason and keep the draft so the user can retry / open it.
      const msg = e instanceof GitHubApiError ? e.message : 'Could not open the pull request.';
      return draftPublishedNoPr(res.shared, res.head, msg);
    }
  }

  async function fetchRemote(body: unknown): Promise<GitEndpointResult> {
    // Token resolution mirrors fold/pull: body token → keychain bridge → undefined
    // → authRequired. Explicit user gesture only (the UI "Refresh drafts" button).
    const token = readToken(body) ?? (await getGithubToken()) ?? undefined;
    const b = (body ?? {}) as { remote?: unknown };
    if (b.remote != null && safeRemoteArg(b.remote) === undefined) return bad('Invalid remote.');
    const res = await gitFetchRemote(dir, token, { remote: safeRemoteArg(b.remote) });
    if (res.ok) return { status: 200, json: { ok: true, fetchedAt: res.fetchedAt } };
    if (res.authRequired)
      return { status: 401, json: { ok: false, authRequired: true, error: res.error } };
    return { status: 502, json: { ok: false, error: res.error ?? 'Could not refresh drafts.' } };
  }

  return {
    status,
    commit,
    discard,
    push,
    pull,
    resolve,
    log,
    diff,
    branches,
    createBranch,
    checkout,
    fold,
    fetchRemote,
  };
}

/** Read a non-empty string token from a request body without retaining it. */
function readToken(body: unknown): string | null {
  const t = (body as { token?: unknown })?.token;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

/** Fold partial-success: the draft branch was pushed but no PR could be opened (no
 *  sign-in, a non-GitHub remote, or the PR call failed). `ok:true` because the work IS
 *  published; the UI shows `error` as a heads-up and keeps the draft for a retry. */
function draftPublishedNoPr(
  shared: string | undefined,
  head: string | undefined,
  error: string
): GitEndpointResult {
  return {
    status: 200,
    json: { ok: true, shared, published: head, prUnavailable: true, error },
  };
}

/** DDR-112 — expand each selected path to include any DIRTY same-directory,
 *  same-stem sidecar (`<stem>.meta.json`, `<stem>.annotations.json`, …). The `.`
 *  delimiter prevents `ui/Pricing` from grabbing `ui/Pricing v3.*`. */
export function expandSidecars(selected: string[], dirty: string[]): string[] {
  const out = new Set(selected);
  for (const sel of selected) {
    const dot = sel.lastIndexOf('.');
    if (dot === -1) continue;
    const stem = `${sel.slice(0, dot)}.`;
    for (const d of dirty) {
      if (d !== sel && d.startsWith(stem)) out.add(d);
    }
  }
  return [...out];
}

export const __testing = { expandSidecars, safeGitArg, safeRemoteArg };
export type { GitFileStatus };
