// Phase 27 (epic E2) Task 5 — live dirty-state.
//
// Event-driven, NOT polled: piggyback on the existing fs-watch bus (`fs:any`,
// already debounced 50 ms per-path and already filtered to drop `_server.json` /
// `_active.json` / `_sync.json` / `_history/`). On a versionable change we
// recompute `gitStatus` once (trailing-debounced ~300 ms, since git status is
// heavier than a CSS reload) and emit a `git-status` bus event. ws.ts forwards it
// to the inspector clients (the shell), which update the Changes-panel count
// badge + the per-row M/A/D tree badges reactively. No client polling, no extra
// fs.watch — one recompute per burst of saves.

import type { Context } from '../context.ts';
import { type GitStatusResult, gitStatus } from './service.ts';

export interface GitWatch {
  /** Force a recompute + broadcast now (e.g. right after a commit lands). */
  refresh(): void;
  stop(): void;
}

const DEBOUNCE_MS = 300;

/** Recompute git-status only for changes to versionable design content — the
 *  plan's explicit allowlist (.tsx / .css / .meta.json / annotation SVG / comment
 *  + annotation dirs). Skips the noise fs-watch lets through (e.g. an `.html`
 *  fixture or a stray editor temp) so we don't fork git for a non-tracked save.
 *  `gitStatus` itself still drops Maude runtime state, so this is just an
 *  optimization, not a correctness gate. */
function isVersionable(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  if (p.includes('/_comments/') || p.startsWith('_comments/')) return true;
  if (p.includes('/_annotations/') || p.startsWith('_annotations/')) return true;
  return /\.(tsx|css|meta\.json|svg)$/.test(p) || /\.annotations\.(?:svg|json)$/.test(p);
}

export function createGitWatch(ctx: Context): GitWatch {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;
  let stopped = false;

  async function recompute() {
    if (stopped) return;
    if (running) {
      // A change landed mid-flight — run once more when the current pass finishes
      // so the final state always reflects the last save.
      pending = true;
      return;
    }
    running = true;
    try {
      const status: GitStatusResult = await gitStatus(ctx.paths.repoRoot, {
        designPrefix: ctx.paths.designRel,
      });
      if (!stopped) ctx.bus.emit('git-status', status);
    } catch (err) {
      console.warn('[git-watch] status failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
      if (pending && !stopped) {
        pending = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void recompute();
    }, DEBOUNCE_MS);
  }

  const unsub = ctx.bus.on('fs:any', (rel: string) => {
    if (typeof rel === 'string' && isVersionable(rel)) schedule();
  });

  return {
    refresh() {
      // Immediate (still single-flight guarded) — used right after a commit so the
      // panel clears without waiting for the next file save.
      void recompute();
    },
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      unsub();
    },
  };
}

export const __testing = { isVersionable, DEBOUNCE_MS };
