// Phase 8 Task 4 — AI activity tracking with heartbeat-based TTL.
//
// `/design:edit` (or any external slash command driving Claude work) POSTs to
// /_api/ai/start when it begins editing a canvas, pings /_api/ai/heartbeat
// every 10 seconds, and POSTs /_api/ai/end on normal completion. The server
// maintains an in-memory map keyed by canvas file path, broadcasts changes
// over the inspector WS bus so every open client renders a yellow "Claude is
// editing this canvas" banner.
//
// Why not Awareness — Awareness is the y-protocols channel for connected
// peers. The AI is not a connected peer (it lives in a slash command, not a
// browser tab) and the banner has to reach BOTH collab and inspector clients,
// not just the per-canvas Y.Doc room. A separate bus event keeps the model
// honest: AI activity is a server-managed projection, not a peer state.
//
// 30-second grace TTL — if the slash command crashes (no /end POST) the
// banner auto-clears 30 s after the last heartbeat. A janitor runs every 5 s
// and broadcasts cleared state if the entry expired.

import type { Context } from '../context.ts';

const HEARTBEAT_GRACE_MS = 30_000;
const JANITOR_INTERVAL_MS = 5_000;

export interface AiActivityEntry {
  file: string;
  author: string;
  startedAt: number;
  lastHeartbeat: number;
}

/**
 * S9.11 (V2-1.16 L13) — the banner entries a session may see: every entry for a project
 * session (`see === null`, U7), only visible canvases' for a canvas-only one. `file` is the
 * v1 repo-relative form (`.design/x.tsx`); the seer takes designRoot-relative paths.
 */
export function filterAiEntries<E extends { file: string }>(
  entries: E[],
  see: ((rel: string) => boolean) | null,
  designRel: string
): E[] {
  if (see === null) return entries;
  const prefix = `${designRel.replace(/^\/+|\/+$/g, '')}/`;
  return entries.filter((e) => {
    const f = String(e.file).replace(/\\/g, '/').replace(/^\/+/, '');
    const rel = f.startsWith(prefix) ? f.slice(prefix.length) : f;
    return rel !== '' && !rel.split('/').includes('..') && see(rel);
  });
}

export interface AiActivity {
  /** Begin tracking AI work on a canvas. Idempotent — replaces any prior. */
  start(file: string, author: string): AiActivityEntry;
  /** Refresh the lastHeartbeat timestamp. Returns null if no entry. */
  heartbeat(file: string): AiActivityEntry | null;
  /** Explicit end — clears immediately on normal completion. */
  end(file: string): boolean;
  /** Read the live state — used by the GET /_api/ai endpoint. */
  list(): AiActivityEntry[];
  /** Check one canvas — used by the bus broadcaster. */
  get(file: string): AiActivityEntry | null;
  /** Tear down the janitor (server shutdown). */
  stop(): void;
}

export function createAiActivity(ctx: Context, now: () => number = Date.now): AiActivity {
  const entries = new Map<string, AiActivityEntry>();
  let janitor: ReturnType<typeof setInterval> | null = null;

  function broadcast(file: string, entry: AiActivityEntry | null) {
    ctx.bus.emit('ai-activity', { file, entry });
  }

  function expired(entry: AiActivityEntry, t: number): boolean {
    return t - entry.lastHeartbeat > HEARTBEAT_GRACE_MS;
  }

  function start(file: string, author: string): AiActivityEntry {
    const t = now();
    const entry: AiActivityEntry = {
      file,
      author,
      startedAt: entries.get(file)?.startedAt ?? t,
      lastHeartbeat: t,
    };
    entries.set(file, entry);
    broadcast(file, entry);
    ensureJanitor();
    return entry;
  }

  function heartbeat(file: string): AiActivityEntry | null {
    const entry = entries.get(file);
    if (!entry) return null;
    entry.lastHeartbeat = now();
    broadcast(file, entry);
    return entry;
  }

  function end(file: string): boolean {
    if (!entries.has(file)) return false;
    entries.delete(file);
    broadcast(file, null);
    if (entries.size === 0 && janitor) {
      clearInterval(janitor);
      janitor = null;
    }
    return true;
  }

  function list(): AiActivityEntry[] {
    return Array.from(entries.values());
  }

  function get(file: string): AiActivityEntry | null {
    return entries.get(file) ?? null;
  }

  function ensureJanitor() {
    if (janitor || typeof setInterval === 'undefined') return;
    janitor = setInterval(() => {
      const t = now();
      for (const [file, entry] of entries) {
        if (expired(entry, t)) {
          entries.delete(file);
          broadcast(file, null);
        }
      }
      if (entries.size === 0 && janitor) {
        clearInterval(janitor);
        janitor = null;
      }
    }, JANITOR_INTERVAL_MS);
  }

  function stop(): void {
    if (janitor) {
      clearInterval(janitor);
      janitor = null;
    }
  }

  return { start, heartbeat, end, list, get, stop };
}

export { HEARTBEAT_GRACE_MS, JANITOR_INTERVAL_MS };
