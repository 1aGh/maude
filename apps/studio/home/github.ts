// home/github.ts — the clone behind "From GitHub" on Home (S6.10; Rust's github_home.rs).
//
// Rust lists the repos and picks the folder; this is only the download, because the app bundles
// no git and the person's machine may have none (DDR-177) — the same iso-git `gitClone` the
// project's "Pull a local copy" uses. One INTERNAL row (`/_home/internal/github/clone`, Rust's
// per-spawn bearer): the page can never reach it, so it never names a folder or sees a token.
//
//   body {owner, repo, target, token?}
//   - owner/repo are validated again here and the URL is REBUILT from them
//     (`https://github.com/<owner>/<repo>.git`) — never a caller's string;
//   - target is the folder Rust just claimed: absolute, a real directory (not a link), empty;
//   - token is optional (a public repo clones without one); `gitClone` offers it to github.com
//     only, as auth — never in the URL. It is not stored, logged or echoed: every answer is
//     fixed words.
//   After the download a project without a design system gets the one every new project gets
//   (`scaffoldDesign`), so it opens as a tab.

import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { gitClone } from '../git/service.ts';
import { hasDesign, scaffoldDesign } from '../scaffold-design.ts';
import type { HomeAnswer } from './signin.ts';

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^(?!\.)[A-Za-z0-9._-]{1,100}$/;
/** A GitHub token: printable ASCII, no spaces (gho_…, ghp_…, github_pat_…). */
const TOKEN = /^[\x21-\x7e]{1,512}$/;

export interface HomeGithub {
  clone(body: unknown): Promise<HomeAnswer>;
}

type Clone = typeof gitClone;

const bad = (error: string): HomeAnswer => ({ status: 400, body: { ok: false, error } });

/** An empty, real (non-link) directory at an absolute path. */
function claimedFolder(v: unknown): string | null {
  if (typeof v !== 'string' || !path.isAbsolute(v)) return null;
  try {
    const st = lstatSync(v);
    if (!st.isDirectory() || st.isSymbolicLink()) return null;
    return readdirSync(v).length === 0 ? v : null;
  } catch {
    return null;
  }
}

export function createHomeGithub(opts: { clone?: Clone } = {}): HomeGithub {
  const clone = opts.clone ?? gitClone;
  return {
    async clone(body) {
      const b = (body ?? {}) as Record<string, unknown>;
      const { owner, repo, token } = b;
      if (typeof owner !== 'string' || !OWNER.test(owner)) return bad('Not a GitHub project.');
      if (typeof repo !== 'string' || !REPO.test(repo)) return bad('Not a GitHub project.');
      if (token != null && (typeof token !== 'string' || !TOKEN.test(token)))
        return bad('Not a GitHub sign-in.');
      const target = claimedFolder(b.target);
      if (!target) return bad('Not an empty project folder.');
      const res = await clone(
        `https://github.com/${owner}/${repo}.git`,
        target,
        typeof token === 'string' ? token : undefined
      );
      if (!res.ok) {
        return res.authRequired
          ? {
              status: 401,
              body: {
                ok: false,
                authRequired: true,
                error: 'GitHub sign-in is needed to download this project.',
              },
            }
          : {
              status: 502,
              body: {
                ok: false,
                error: 'Could not download the project. Check the link and try again.',
              },
            };
      }
      const had = hasDesign(target);
      if (!had) {
        const s = scaffoldDesign(target, repo);
        if (!s.ok)
          return { status: 500, body: { ok: false, error: 'Could not set up the project.' } };
      }
      return { status: 200, body: { ok: true, root: realpathSync(target), hadDesign: had } };
    },
  };
}
