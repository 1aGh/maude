import { execFileSync } from 'node:child_process';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// No relative imports: scripts/test/e2e-dist-fresh.test.mjs and share-roles/stand-up.mjs load this under plain node.

/**
 * p8-e2e-fix-r12 — a studio the lane starts from the worktree serves `apps/studio/dist/client.bundle.js`. The
 * committed copy can be older than the client source (the test-lane wrapper puts dist back to it after every run),
 * and then the studio shows the old UI: share-roles read "Can comment" for a Can view grant for a whole round.
 *
 * Freshness per file: its last commit time when the working tree holds the committed bytes, its mtime when it has
 * uncommitted changes. mtime alone lies after a checkout (git stamps every file with the checkout time).
 * Returns why the bundle is stale, or null.
 */
export function staleClientDist(studioDir: string): string | null {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: studioDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  let top: string;
  try {
    // both sides real paths: git answers /private/var/… for a /var/… temp dir
    top = realpathSync(git('rev-parse', '--show-toplevel').trim());
    studioDir = realpathSync(studioDir);
  } catch {
    return null; // not a checkout (an installed package): nothing to compare against
  }
  const dirty = new Set(
    git('status', '--porcelain', '--untracked-files=all', '--', 'client', 'dist/client.bundle.js')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).trim())
  );
  const rel = (abs: string) => relative(top, abs).split('\\').join('/');
  const committedAt = (abs: string, ...exclude: string[]) => {
    const t = Number(git('log', '-1', '--format=%ct', '--', abs, ...exclude).trim());
    return Number.isFinite(t) && t > 0 ? t * 1000 : 0;
  };
  const bundle = join(studioDir, 'dist', 'client.bundle.js');
  let bundleAt: number;
  try {
    bundleAt = dirty.has(rel(bundle)) ? statSync(bundle).mtimeMs : committedAt(bundle);
  } catch {
    return 'there is no dist/client.bundle.js';
  }
  // CSS is not an input of client.bundle.js: it is the separate styles.css bundle (build.ts, client/styles/_index.css).
  // A CSS-only commit after the build (1b798abf4's token re-format, 2026-10-28) must not refuse a byte-identical bundle.
  let newest = committedAt(join(studioDir, 'client'), ':(exclude,glob)**/*.css');
  let newestWhat = `the last client commit (${new Date(newest).toISOString()})`;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p);
      } else if (dirty.has(rel(p)) && !e.name.endsWith('.css')) {
        const m = statSync(p).mtimeMs;
        if (m > newest) {
          newest = m;
          newestWhat = `${rel(p)} (uncommitted, ${new Date(m).toISOString()})`;
        }
      }
    }
  };
  walk(join(studioDir, 'client'));
  if (bundleAt >= newest) return null;
  return `dist/client.bundle.js (${new Date(bundleAt).toISOString()}) is older than ${newestWhat}`;
}

/** Refuse to boot a studio from `studioDir` on a stale client bundle — loud, with the fix. */
export function assertFreshClientDist(studioDir: string): void {
  const why = staleClientDist(studioDir);
  if (!why) return;
  throw new Error(
    `[e2e] the client bundle is older than the client source: ${why}.\n` +
      `  A studio started from this tree would serve the old UI. Build it first:\n` +
      `  cd ${studioDir} && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`
  );
}
