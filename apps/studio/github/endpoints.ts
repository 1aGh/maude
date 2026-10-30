// github/endpoints.ts — `/_api/github/*` orchestration (Phase 28 / epic E3).
//
// Pure-ish handlers behind the GitHub routes: validate inputs, resolve the token
// from the loopback bridge (token.ts), call the service, and shape a
// `{ status, json }` result. NO HTTP/Request dependency — http.ts owns the gating
// (method · main-origin CSRF · loopback Host) and this module owns orchestration,
// mirroring git/endpoints.ts.
//
// SECURITY: every route is main-origin-only by omission from CANVAS_SAFE_API +
// startCanvasServer's `routes` map (the dual-allowlist rule). The token is fetched
// per-request from the keychain bridge, used once for the GitHub call, and never
// logged, echoed, or returned to the client. Inputs (repo name, username) are
// validated at this boundary before they reach the GitHub API.

import fs, { existsSync, mkdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import git from 'isomorphic-git';
import type { Context } from '../context.ts';
import { gitClone } from '../git/service.ts';
import { hasDesign, scaffoldDesign } from '../scaffold-design.ts';
import { clearCached, readCached, tokenHash, writeCached } from './identity-cache.ts';
import {
  createRepo,
  GitHubApiError,
  getIdentity,
  inviteCollaborator,
  listUserRepos,
  setRemote,
} from './service.ts';
import { getGithubToken } from './token.ts';

// A repo/folder NAME safe to join onto a user-chosen parent dir — alphanumeric
// start, then [A-Za-z0-9._-], no separators or leading dot ⇒ no traversal.
const SAFE_DIR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface GitHubEndpointResult {
  status: number;
  json: unknown;
}

// A GitHub username: 1–39 chars, alphanumeric or single hyphens, no leading/
// trailing/consecutive hyphen. Anchored — never reaches the API path unvalidated.
const USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** Turn a human project name into a valid GitHub repo slug, or null if nothing
 *  usable survives. GitHub repo names allow [A-Za-z0-9._-]; we lowercase, map
 *  spaces/invalid runs to single hyphens, trim hyphens, and cap at 100. */
export function slugifyRepoName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const slug = raw
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100)
    .toLowerCase();
  return slug.length > 0 ? slug : null;
}

/** Parse `owner/repo` out of a GitHub remote URL (https or ssh form).
 *
 *  SECURITY (phase-28 audit D-1/F-2, HIGH): the host MUST be anchored to exactly
 *  `github.com`. The original `url.match(/github\.com[:/]+…/)` matched the substring
 *  ANYWHERE, so `https://evil.com/github.com/o/r.git` parsed as owner=`o` repo=`r`
 *  and the raw URL then flowed to `git.clone`'s host-agnostic `onAuth` → the keychain
 *  PAT was offered as Basic auth to the attacker host (token exfiltration). We parse
 *  the https form with the WHATWG URL parser and assert `hostname === 'github.com'`;
 *  callers MUST clone from the canonical URL rebuilt from the returned owner/repo,
 *  never the raw input. */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const trimmed = String(url).trim();
  let owner: string | undefined;
  let repo: string | undefined;
  // ssh form: git@github.com:owner/repo(.git) — host is literal here.
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (ssh) {
    owner = ssh[1];
    repo = ssh[2];
  } else {
    let u: URL;
    try {
      u = new URL(trimmed);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:') return null; // no http downgrade, no ssh:// smuggling
    if (u.hostname.toLowerCase() !== 'github.com') return null; // ANCHORED host
    const parts = u.pathname.replace(/^\/+/, '').split('/');
    if (parts.length < 2) return null;
    owner = parts[0];
    repo = parts[1].replace(/\.git$/i, '');
  }
  if (!owner || !repo) return null;
  if (!USERNAME_RE.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;
  return { owner, repo };
}

/** Canonical HTTPS clone URL for a validated owner/repo — the ONLY URL a caller
 *  should hand to git.clone (never raw user input; see parseGitHubRemote security). */
export function canonicalGitHubCloneUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}.git`;
}

export interface GitHubEndpoints {
  identity(): Promise<GitHubEndpointResult>;
  repos(): Promise<GitHubEndpointResult>;
  createRepo(body: unknown): Promise<GitHubEndpointResult>;
  createProject(body: unknown): Promise<GitHubEndpointResult>;
  createLocalProject(body: unknown): Promise<GitHubEndpointResult>;
  invite(body: unknown): Promise<GitHubEndpointResult>;
  clone(body: unknown): Promise<GitHubEndpointResult>;
  initDesign(body: unknown): Promise<GitHubEndpointResult>;
}

/** Validate a user-chosen parent dir (from the native folder picker). */
function validParentDir(v: unknown): v is string {
  return typeof v === 'string' && isAbsolute(v) && existsSync(v) && statSync(v).isDirectory();
}

export function createGitHubEndpoints(ctx: Context): GitHubEndpoints {
  const repoDir = ctx.paths.repoRoot;

  function bad(error: string): GitHubEndpointResult {
    return { status: 400, json: { ok: false, error } };
  }

  /** Resolve the token, run `fn`, and map any GitHubApiError to a JSON result. */
  async function withToken(
    fn: (token: string) => Promise<GitHubEndpointResult>
  ): Promise<GitHubEndpointResult> {
    const token = await getGithubToken();
    if (!token) {
      return {
        status: 401,
        json: { ok: false, signedIn: false, error: 'Sign in with GitHub in the Maude app first.' },
      };
    }
    try {
      return await fn(token);
    } catch (e) {
      if (e instanceof GitHubApiError) {
        // status 0 = network → 502; otherwise pass GitHub's status through.
        return { status: e.status === 0 ? 502 : e.status, json: { ok: false, error: e.message } };
      }
      return { status: 502, json: { ok: false, error: 'GitHub request failed. Try again.' } };
    }
  }

  // Fetch a fresh profile and rewrite the cache; swallow errors so a background
  // revalidation can NEVER reject the request promise. A revoked/rotated token
  // (401) during revalidation drops the entry so the next call re-fetches/re-prompts.
  async function revalidateIdentity(key: string, token: string): Promise<void> {
    try {
      writeCached(key, await getIdentity(token));
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 401) clearCached(key);
      // any other failure (network blip, etc.) — keep the last-known cache as-is.
    }
  }

  // SWR (DDR-132): serve the per-user disk cache instantly on a key (token-hash)
  // match and revalidate in the background, so a sidecar respawn on repo switch
  // still paints the identity with no "Checking GitHub…" round-trip. First-ever
  // call (cache miss) does one fresh fetch + write.
  async function identity(): Promise<GitHubEndpointResult> {
    return withToken(async (token) => {
      const key = tokenHash(token);
      const cached = readCached(key);
      if (cached) {
        void revalidateIdentity(key, token); // fire-and-forget; never awaited
        return { status: 200, json: { ok: true, ...cached } };
      }
      const fresh = await getIdentity(token);
      writeCached(key, fresh);
      return { status: 200, json: { ok: true, ...fresh } };
    });
  }

  async function repos(): Promise<GitHubEndpointResult> {
    return withToken(async (token) => ({
      status: 200,
      json: { ok: true, repos: await listUserRepos(token) },
    }));
  }

  async function createRepoHandler(body: unknown): Promise<GitHubEndpointResult> {
    const b = (body ?? {}) as { name?: unknown; private?: unknown; description?: unknown };
    const name = slugifyRepoName(b.name);
    if (!name) return bad('Enter a project name (letters, numbers, hyphens).');
    if (b.private != null && typeof b.private !== 'boolean') return bad('Invalid visibility.');
    const isPrivate = b.private !== false; // default PRIVATE for non-technical safety
    let description: string | undefined;
    if (b.description != null) {
      if (typeof b.description !== 'string' || b.description.length > 350)
        return bad('Description is too long.');
      description = b.description;
    }
    return withToken(async (token) => {
      const repo = await createRepo(token, { name, private: isPrivate, description });
      // Point the local project's origin at the new repo so the next Publish pushes
      // to it. iso-git, no network. Failure here is non-fatal to repo creation.
      let remoteSet = true;
      try {
        await setRemote(repoDir, repo.clone_url);
      } catch {
        remoteSet = false;
      }
      return { status: 200, json: { ok: true, repo, remoteSet } };
    });
  }

  async function invite(body: unknown): Promise<GitHubEndpointResult> {
    const b = (body ?? {}) as { username?: unknown };
    if (typeof b.username !== 'string') return bad('Enter a GitHub username.');
    const username = b.username.trim().replace(/^@/, '');
    if (!USERNAME_RE.test(username)) return bad('That doesn’t look like a GitHub username.');

    // owner/repo come from the CURRENT project's origin remote — the client never
    // supplies them, so you can only ever invite to the project you have open.
    const remotes = await git.listRemotes({ fs, dir: repoDir }).catch(() => []);
    const origin = remotes.find((r) => r.remote === 'origin');
    if (!origin) {
      return {
        status: 409,
        json: {
          ok: false,
          error: 'This project isn’t on GitHub yet — create or open it on GitHub first.',
        },
      };
    }
    const parsed = parseGitHubRemote(origin.url);
    if (!parsed)
      return { status: 409, json: { ok: false, error: 'This project isn’t a GitHub project.' } };

    return withToken(async (token) => {
      const res = await inviteCollaborator(token, parsed.owner, parsed.repo, username);
      return { status: 200, json: { ok: true, invited: res.invited, username } };
    });
  }

  // "Pull a local copy": clone a GitHub project into a user-chosen folder. The
  // parentDir comes from the NATIVE folder picker (a Tauri command), and every
  // input is validated before it reaches the filesystem / iso-git.
  async function clone(body: unknown): Promise<GitHubEndpointResult> {
    const b = (body ?? {}) as { cloneUrl?: unknown; parentDir?: unknown; name?: unknown };
    const parsed = typeof b.cloneUrl === 'string' ? parseGitHubRemote(b.cloneUrl) : null;
    if (!parsed) {
      return bad('That isn’t a GitHub project link.');
    }
    // SECURITY (audit D-1/F-2): clone from the CANONICAL github.com URL rebuilt from
    // the validated owner/repo — NEVER the raw user string. Even if a crafted link
    // slipped past the parser, the token can only ever be offered to github.com.
    const cloneUrl = canonicalGitHubCloneUrl(parsed.owner, parsed.repo);
    if (typeof b.name !== 'string' || !SAFE_DIR_NAME.test(b.name))
      return bad('Invalid project name.');
    if (
      typeof b.parentDir !== 'string' ||
      !isAbsolute(b.parentDir) ||
      !existsSync(b.parentDir) ||
      !statSync(b.parentDir).isDirectory()
    ) {
      return bad('Pick a folder on your computer to save the project in.');
    }
    const target = join(b.parentDir, b.name);
    if (existsSync(target)) {
      return {
        status: 409,
        json: { ok: false, error: `A folder named “${b.name}” already exists there.` },
      };
    }
    // Token OPTIONAL — public repos clone tokenless; private repos surface
    // authRequired from the service if no token is available.
    const token = (await getGithubToken()) ?? undefined;
    const res = await gitClone(cloneUrl, target, token);
    if (res.ok) {
      // Tell the client whether the pulled repo is actually a Maude project. If not,
      // the client must NOT switch to it (the dev-server can't serve a project with
      // no .design/ — it fails loud) — it shows a "set it up" message instead.
      return { status: 200, json: { ok: true, path: target, hasDesign: hasDesign(target) } };
    }
    if (res.authRequired) {
      return { status: 401, json: { ok: false, authRequired: true, error: res.error } };
    }
    return {
      status: 502,
      json: { ok: false, error: res.error ?? 'Could not download the project.' },
    };
  }

  // "New project" — create a GitHub repo AND a ready-to-design local project:
  // create repo → make <parentDir>/<slug> → git init → scaffold a bootable .design/
  // → point origin at the repo. No push here — the user Publishes (pushes) when
  // ready, exactly like every other change. Returns the path to open.
  async function createProject(body: unknown): Promise<GitHubEndpointResult> {
    const b = (body ?? {}) as {
      name?: unknown;
      private?: unknown;
      description?: unknown;
      parentDir?: unknown;
    };
    const slug = slugifyRepoName(b.name);
    if (!slug) return bad('Enter a project name (letters, numbers, hyphens).');
    if (b.private != null && typeof b.private !== 'boolean') return bad('Invalid visibility.');
    if (!validParentDir(b.parentDir))
      return bad('Pick a folder on your computer to save the project in.');
    let description: string | undefined;
    if (b.description != null) {
      if (typeof b.description !== 'string' || b.description.length > 350)
        return bad('Description is too long.');
      description = b.description;
    }
    const target = join(b.parentDir, slug);
    if (existsSync(target)) {
      return {
        status: 409,
        json: { ok: false, error: `A folder named “${slug}” already exists there.` },
      };
    }
    const humanName = typeof b.name === 'string' ? b.name.trim() : slug;
    return withToken(async (token) => {
      const repo = await createRepo(token, {
        name: slug,
        private: b.private !== false,
        description,
      });
      try {
        mkdirSync(target, { recursive: true });
        await git.init({ fs, dir: target, defaultBranch: 'main' });
        const s = scaffoldDesign(target, humanName);
        if (!s.ok)
          return {
            status: 500,
            json: { ok: false, error: s.error ?? 'Could not set up the project.' },
          };
        await setRemote(target, repo.clone_url);
      } catch (e) {
        return {
          status: 500,
          json: {
            ok: false,
            error: e instanceof Error ? e.message : 'Could not set up the project.',
          },
        };
      }
      return { status: 200, json: { ok: true, path: target, repo } };
    });
  }

  // "Just a local git repo, no GitHub remote" — same as createProject minus the
  // network: mkdir + git init (defaultBranch main) + .design scaffold, NO token, NO
  // createRepo, NO setRemote. The user can publish it later. Reuses the same slug +
  // parent-dir validation as createProject, and the route is main-origin/loopback
  // gated (http.ts) + absent from CANVAS_SAFE_API (dual-allowlist) like its sibling.
  async function createLocalProject(body: unknown): Promise<GitHubEndpointResult> {
    const b = (body ?? {}) as { name?: unknown; parentDir?: unknown };
    const slug = slugifyRepoName(b.name);
    if (!slug) return bad('Enter a project name (letters, numbers, hyphens).');
    if (!validParentDir(b.parentDir))
      return bad('Pick a folder on your computer to save the project in.');
    const target = join(b.parentDir, slug);
    if (existsSync(target)) {
      return {
        status: 409,
        json: { ok: false, error: `A folder named “${slug}” already exists there.` },
      };
    }
    const humanName = typeof b.name === 'string' ? b.name.trim() : slug;
    try {
      mkdirSync(target, { recursive: true });
      await git.init({ fs, dir: target, defaultBranch: 'main' });
      const s = scaffoldDesign(target, humanName);
      if (!s.ok)
        return {
          status: 500,
          json: { ok: false, error: s.error ?? 'Could not set up the project.' },
        };
    } catch (e) {
      return {
        status: 500,
        json: {
          ok: false,
          error: e instanceof Error ? e.message : 'Could not set up the project.',
        },
      };
    }
    return { status: 200, json: { ok: true, path: target } };
  }

  // Fallback for "open a folder/repo that isn't a Maude project yet" — scaffold a
  // bootable .design/ into an existing folder so it can open (no GitHub, no token).
  async function initDesign(body: unknown): Promise<GitHubEndpointResult> {
    const b = (body ?? {}) as { dir?: unknown };
    if (!validParentDir(b.dir)) return bad('That folder doesn’t exist.');
    if (hasDesign(b.dir as string)) {
      return { status: 200, json: { ok: true, alreadyDesign: true } };
    }
    const s = scaffoldDesign(b.dir as string);
    if (!s.ok)
      return {
        status: 500,
        json: { ok: false, error: s.error ?? 'Could not set up the project.' },
      };
    return { status: 200, json: { ok: true } };
  }

  return {
    identity,
    repos,
    createRepo: createRepoHandler,
    createProject,
    createLocalProject,
    invite,
    clone,
    initDesign,
  };
}

export const __testing = {
  slugifyRepoName,
  parseGitHubRemote,
  canonicalGitHubCloneUrl,
  USERNAME_RE,
};
