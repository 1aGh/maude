// Phase 8 Task 7 — `.git/HEAD` watcher. On branch switch (`git checkout`) or
// pull mid-session, force-snapshot every dirty Y.Doc to its on-disk JSON form
// BEFORE prompting peers to reload. Order matters per DDR-051 §3:
//
//   1. Synchronously flush every dirty room → JSON via registry.flushAll().
//   2. THEN broadcast a `git-lifecycle` bus event with the new HEAD ref.
//   3. Clients render a non-modal "Repo state changed — reload to sync?"
//      banner; on confirm they call location.reload() and the next mount
//      seeds the Y.Doc from the (now branch-current) JSON.
//
// Without step 1, the reload prompt can fire while in-flight edits are still
// buffered in the 800 ms debounce window — the user's "reload" click then
// silently discards them. Force-snapshot is the cheap escape valve: pay the
// full sync cost once at branch-switch time.

import { existsSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';

import type { Context } from '../context.ts';
import type { Registry } from './registry.ts';

export interface GitLifecycle {
  /** Stop the underlying watcher (server shutdown). */
  stop(): void;
}

interface GitLifecycleEvent {
  reason: 'head-changed';
  head: string;
  prevHead: string | null;
  ts: number;
}

const HEAD_DEBOUNCE_MS = 250;

export function createGitLifecycle(ctx: Context, registry: Registry): GitLifecycle {
  const gitDir = path.join(ctx.paths.repoRoot, '.git');
  const headPath = path.join(gitDir, 'HEAD');

  if (!existsSync(headPath)) {
    // Not a git repo — no lifecycle to watch. Quietly no-op so the dev-server
    // still works inside scratch / templated projects.
    return { stop: () => {} };
  }

  let prevHead: string | null = readHeadSafe(headPath);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let watcher: ReturnType<typeof watch> | null = null;
  let stopped = false;

  async function onChange() {
    if (stopped) return;
    const next = readHeadSafe(headPath);
    if (next === null) return; // transient mid-write read; ignore
    if (next === prevHead) return;
    const old = prevHead;
    prevHead = next;

    // STEP 1 — synchronous JSON flush BEFORE the prompt. Awaiting is critical;
    // the broadcast must NOT race ahead of the disk write.
    try {
      await registry.flushAll();
    } catch (err) {
      console.error('[git-lifecycle] flushAll failed:', err);
    }

    // STEP 2 — broadcast. Clients render a reload prompt; user confirms → reload.
    const evt: GitLifecycleEvent = {
      reason: 'head-changed',
      head: next,
      prevHead: old,
      ts: Date.now(),
    };
    ctx.bus.emit('git-lifecycle', evt);
  }

  function schedule() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void onChange();
    }, HEAD_DEBOUNCE_MS);
  }

  try {
    // Watch the HEAD file directly. fs.watch on .git/HEAD fires on every
    // checkout (git rewrites the file with the new ref) and on pull (when
    // git updates HEAD to a new commit via the `update-ref` path). Some
    // filesystems / git implementations fire spurious events on packfile
    // operations too — the readHead diff above filters noise.
    watcher = watch(headPath, { persistent: false }, () => schedule());
    // An 'error' with no listener is thrown and exits the studio (the
    // 2026-10-02 cell crash loop came from a sibling watcher). Log and stop.
    watcher.on('error', (err) => {
      console.warn('[git-lifecycle] .git/HEAD watcher error — stopped:', err.message);
      watcher?.close();
    });
  } catch (err) {
    console.warn(
      '[git-lifecycle] failed to watch .git/HEAD:',
      err instanceof Error ? err.message : err
    );
  }

  function stop() {
    stopped = true;
    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      watcher = null;
    }
  }

  return { stop };
}

function readHeadSafe(headPath: string): string | null {
  try {
    return readFileSync(headPath, 'utf8').trim();
  } catch {
    return null;
  }
}
