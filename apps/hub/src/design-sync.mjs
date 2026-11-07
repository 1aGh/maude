// Design EXPORT to a repository — Cloud Phase 25 D1, reclassified by DDR-228.
//
// The name says "sync" and it is not one. This opens a PULL REQUEST against a
// repository the hub does not own: a one-shot handoff a person reviews and
// merges, with no cursor, no ancestor, no conflict resolution and no return
// path. Nothing here converges, and nothing here is undone by the other side
// changing something.
//
// That distinction became load-bearing with the two-mode model. A hub-owned
// project's `.design/` is gitignored precisely so git and the hub are not both
// owners of the same bytes; this route is how those bytes reach a repo anyway,
// ONCE, as a reviewed change — the escape hatch that makes "no hybrid"
// liveable rather than a restriction. Wiring it as a continuous lane would
// rebuild the hybrid under a different name.
//
// The backup mode pushes the cell's own repository and is done. This one has to
// touch a repository we do NOT own, so it is deliberately shaped to make that
// safe:
//
//   1. A SHALLOW CLONE INTO A TEMPORARY DIRECTORY. Never the cell's own
//      checkout — a mistake there would damage the thing being copied.
//   2. THE DESIGN TREE IS REPLACED, not merged into. A rename or a deletion in
//      the design must appear as one in the diff; a copy-over would leave
//      deleted canvases in their repo forever.
//   3. ONLY `<folder>/` IS STAGED. Whatever else exists in their repository is
//      not ours to commit, and `git add --all -- <folder>` cannot reach it.
//   4. THE PUSH TARGETS OUR WORK BRANCH. Their base branch is never a push
//      target, so nothing lands until they merge the pull request.
//
// The credential is the same one the backup mirror uses: minted by the control
// plane, scoped to the one repository, ~an hour, and never written to disk (it
// exists in one argv, never in `.git/config`).

import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import {
  designSyncMessage,
  designSyncPullRequest,
  designSyncSteps,
  validateDesignSync,
} from '../../cloud/design-sync.mjs';
import { validateTarget } from '../../cloud/mirror.mjs';
import { requestPushToken } from './mirror-push.mjs';
import { inRuntimeDir } from './workspace-files.mjs';

/**
 * The export's `cp` filter: does this source path reach the repository?
 *
 * Runtime state (DDR-115) is per-machine and does not belong in someone else's
 * repository — `_history` alone would multiply its size. It is a `_` FOLDER, or
 * a `_` name at the design root (`_server.json`, `_active.json`), matched on the
 * path RELATIVE to the design root (fix/207: matching any `_` segment of the
 * absolute path dropped a design system's own modules, `preview/_ui-feedback.tsx`,
 * and a `_` folder above the design root would have dropped everything). A `_`
 * folder's own entry is kept (git records no empty folder); its contents are not.
 *
 * @param {string} designRoot absolute design root
 * @param {string} src        absolute path `cp` is about to copy
 */
export function designSyncKeeps(designRoot, src) {
  const rel = relative(designRoot, src).split(sep).join('/');
  if (rel === '') return true;
  return !inRuntimeDir(rel);
}

/** Count what will be described in the commit message. */
function countCanvases(dir, depth = 0) {
  if (depth > 5 || !existsSync(dir)) return 0;
  let n = 0;
  // Lazily required so this module stays importable in tests without a disk.
  const { readdirSync } = require('node:fs');
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name === '.git') continue;
    if (e.isDirectory()) n += countCanvases(join(dir, e.name), depth + 1);
    else if (e.name.endsWith('.tsx')) n += 1;
  }
  return n;
}

/**
 * Run one design-sync.
 *
 * Reports; never throws — like the backup mirror, a failure here must not be
 * able to disturb the workspace it is copying from.
 *
 * @returns {Promise<{ok: boolean, state: string, message?: string, pullRequest?: object}>}
 */
export async function runDesignSync(
  {
    designRoot,
    repository,
    folder,
    baseBranch,
    workBranch,
    projectName,
    controlPlaneUrl,
    tenantId,
    cellSecret,
    run,
    log = console,
  },
  deps = {}
) {
  const repoCheck = validateTarget({ repo: repository, branch: baseBranch ?? 'main' });
  if (!repoCheck.ok) return { ok: false, state: 'failed', message: repoCheck.errors.join('; ') };
  const syncCheck = validateDesignSync({ folder, baseBranch, workBranch });
  if (!syncCheck.ok) return { ok: false, state: 'failed', message: syncCheck.errors.join('; ') };
  const target = syncCheck.target;
  if (!existsSync(designRoot)) {
    return { ok: false, state: 'failed', message: 'this workspace has no design folder yet' };
  }

  const minted = await requestPushToken(
    { controlPlaneUrl, tenantId, cellSecret, repository: repoCheck.target.repo },
    deps
  );
  if (!minted.ok) return minted;

  const url = `https://x-access-token:${minted.token}@github.com/${repoCheck.target.full}.git`;
  let work = null;
  try {
    work = await mkdtemp(join(tmpdir(), 'maude-design-sync-'));
    // Clone shallow: we need one commit to build on, not their history.
    const cloned = await run(['clone', '--depth', '1', '--branch', target.baseBranch, url, work], {
      cwd: tmpdir(),
    });
    if (cloned.code !== 0) {
      return {
        ok: false,
        state: 'failed',
        message: `could not read ${repoCheck.target.full} (${firstLine(cloned.stderr)})`,
      };
    }

    const dest = join(work, target.folder);
    // REPLACE, don't merge — a deletion in the design must be a deletion here.
    await rm(dest, { recursive: true, force: true });
    await cp(designRoot, dest, {
      recursive: true,
      // Runtime state (DDR-115) is per-machine and does not belong in someone
      // else's repository. `_history` alone would multiply its size.
      filter: (src) => designSyncKeeps(designRoot, src),
    });

    const canvases = countCanvases(dest);
    const message = designSyncMessage({ projectName: projectName ?? tenantId, canvases });
    for (const step of designSyncSteps({ ...target, message })) {
      const res = await run(step.args, { cwd: work, env: gitIdentity() });
      if (res.code !== 0) {
        // "nothing to commit" is a SUCCESS: the design has not changed since
        // the last sync, and reporting that as a failure would train people to
        // ignore the status.
        if (step.name === 'commit' && /nothing to commit/i.test(res.stdout + res.stderr)) {
          return { ok: true, state: 'up-to-date' };
        }
        return {
          ok: false,
          state: 'failed',
          message: `${step.name} failed: ${firstLine(res.stderr || res.stdout)}`,
        };
      }
    }

    const pr = designSyncPullRequest({
      projectName: projectName ?? tenantId,
      folder: target.folder,
      canvases,
    });
    const opened = await openPullRequest({
      token: minted.token,
      full: repoCheck.target.full,
      head: target.workBranch,
      base: target.baseBranch,
      ...pr,
      fetchImpl: deps.fetchImpl ?? fetch,
    });
    log.log?.(
      `[design-sync] ${repoCheck.target.full}: ${canvases} canvas(es) → ${target.folder}/ (${opened.state})`
    );
    return { ok: true, state: 'synced', pullRequest: opened };
  } catch (err) {
    return { ok: false, state: 'failed', message: err.message };
  } finally {
    if (work) await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Open the pull request, or report the one that is already open.
 *
 * A repeated sync updates the SAME pull request rather than opening a second —
 * a customer whose design changes daily must not find thirty of them.
 */
async function openPullRequest({ token, full, head, base, title, body, fetchImpl }) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'maude-design-sync',
  };
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${full}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title, body, head, base }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const pr = await res.json();
      return { state: 'opened', number: pr.number, url: pr.html_url };
    }
    const problem = await res.json().catch(() => ({}));
    // GitHub answers 422 when a PR for this head already exists — which is the
    // steady state, not an error.
    if (res.status === 422) {
      const listed = await fetchImpl(
        `https://api.github.com/repos/${full}/pulls?head=${encodeURIComponent(full.split('/')[0])}:${encodeURIComponent(head)}&state=open`,
        { headers, signal: AbortSignal.timeout(20_000) }
      );
      const open = listed.ok ? await listed.json() : [];
      if (Array.isArray(open) && open[0]) {
        return { state: 'updated', number: open[0].number, url: open[0].html_url };
      }
    }
    return {
      state: 'pushed-no-pr',
      message: problem?.message ?? `GitHub answered ${res.status}`,
    };
  } catch (err) {
    // The branch IS pushed at this point — saying so matters, because the work
    // is already in their repository and they can open the PR themselves.
    return { state: 'pushed-no-pr', message: err.message };
  }
}

/**
 * The commit's identity.
 *
 * A commit in someone else's repository must say who made it. "Maude" as the
 * author is honest — a person did not write this commit — and it keeps the
 * customer's own contributor stats truthful.
 */
function gitIdentity() {
  return {
    GIT_AUTHOR_NAME: 'Maude',
    GIT_AUTHOR_EMAIL: 'design-sync@maude.sh',
    GIT_COMMITTER_NAME: 'Maude',
    GIT_COMMITTER_EMAIL: 'design-sync@maude.sh',
  };
}

function firstLine(s) {
  return (
    String(s ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)[0] ?? 'no detail'
  );
}
