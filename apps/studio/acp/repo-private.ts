// repo-private.ts — V2-8.9 re-check 2 M-c (decision maude/v2-p8-untracked-repo-files-private): which
// repo files outside the design root are private for the audience gate (acp/audience.ts).
//
// The accepted residual (decision maude/v2-p8-outside-reads-are-private) said a repo file outside the
// design root is something the hub's people already have — they have the repo. That holds only for
// what git TRACKS. A git-ignored or untracked file (`.env.local`, `.mcp.json`, `.claude/*.local.json`,
// `.npmrc`, a key) is on this Mac alone; carried into a hub-shared canvas it reaches people who never
// had it. So such a read is private, like a read outside the project:
//   • a file is private unless `git ls-files --error-unmatch` finds it tracked;
//   • a folder is private when git tracks nothing in it or it holds untracked, not-ignored files
//     (`ls-files -o --exclude-standard`) — a Grep / ripgrep honours .gitignore, so ignored files
//     inside a tracked folder are not what it reads;
//   • a fixed list of secret-shaped names is private even when tracked (a committed `.env` is still
//     not something to paste into a canvas others see);
//   • no git, not a repo, any error → private (fail toward the card).
// Answers are cached per path (bounded). git runs with `core.fsmonitor` off: the repo is untrusted
// (DDR-054) and that key runs a command (writes to .git/config already ask, acp/write-scope.ts).

import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, sep } from 'node:path';

/** Secret-shaped names: private whether git tracks them or not. `rel` is repo-relative, posix. */
export function isSecretName(rel: string): boolean {
  const parts = rel.split('/');
  const base = parts[parts.length - 1] ?? '';
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (base === '.mcp.json' || base === '.npmrc' || base === '.netrc' || base === '.pypirc')
    return true;
  if (/\.(pem|key|p12|pfx)$/i.test(base)) return true;
  return parts.length >= 2 && parts[parts.length - 2] === '.claude' && base.endsWith('.local.json');
}

const MAX_CACHE = 4096;

export type RepoPrivacy = (abs: string, kind: 'file' | 'dir') => boolean;

/** A cached checker for one repo. `git` is injectable for tests. */
export function createRepoPrivacy(
  repoRoot: string,
  git: (args: string[]) => { status: number | null; stdout: string } = (args) => {
    const r = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', repoRoot, ...args], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return { status: r.error ? null : r.status, stdout: r.stdout ?? '' };
  }
): RepoPrivacy {
  const cache = new Map<string, boolean>();
  return (abs, kind) => {
    const r = relative(repoRoot, abs);
    if (r === '' || r.startsWith('..') || isAbsolute(r)) return false; // not a repo file: not ours
    const rel = r.split(sep).join('/');
    const key = `${kind}:${rel}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let priv: boolean;
    if (kind === 'file' && isSecretName(rel)) priv = true;
    else if (kind === 'file') priv = git(['ls-files', '--error-unmatch', '--', rel]).status !== 0;
    else {
      const tracked = git(['ls-files', '--', rel]);
      const untracked = git(['ls-files', '-o', '--exclude-standard', '--directory', '--', rel]);
      priv =
        tracked.status !== 0 ||
        untracked.status !== 0 ||
        tracked.stdout.trim() === '' ||
        untracked.stdout.trim() !== '';
    }
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(key, priv);
    return priv;
  };
}
