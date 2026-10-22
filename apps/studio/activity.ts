// Canvas activity tracker (Phase 13 / DDR-029).
//
// Subscribes to the existing `fs:any` bus event, filters for canvas-shaped
// files under <designRoot>, and maintains a per-file `active | idle` status with
// a debounce: rapid saves stay `active`, ACTIVITY_IDLE_MS of fs silence flips a
// file to `idle`. Every transition emits `activity:change` on the bus, which
// ws.ts forwards to canvas iframes as `{ type: 'activity', … }`. The injected
// canvas runtime (use-canvas-activity.tsx) turns that into a live "agent works
// here" overlay on the affected artboards.
//
// Bun-native (DDR-009): setTimeout/clearTimeout + Bun.file for the Task 7 diff;
// no node:fs reads where Bun.file works. Pure, fs-injected helpers (isCanvasFile
// / diffArtboardIds) unit-test without touching disk.

import path from 'node:path';

import type { Context } from './context.ts';
import { isCanvasFile } from './skip-dirs.ts';

/** Idle debounce — fs silence longer than this flips a file `active` → `idle`. */
export const ACTIVITY_IDLE_MS = 3000;

/** Default user-write suppression window (see ActivityOptions.suppressTtlMs). */
export const SUPPRESS_TTL_MS = 2500;

/** LRU cap on the per-file text stash used by the Task 7 region diff. */
const STASH_CAP = 50;

/**
 * True when a design-root-relative path is a user-facing canvas the overlay
 * should light up. `.tsx` / `.html` only, minus:
 *   - runtime artifacts + any `_`-prefixed file or directory (`_history/`,
 *     `_draw/`, `_smoke/`, `_locator.json`, …),
 *   - SKIP_DIRS segments (node_modules, dist, …),
 *   - DS preview specimens under `system/<ds>/preview/**` — a critic editing a
 *     preview emits a real `fs:any`, but those aren't canvases the user is
 *     iterating on, so an overlay there is a false positive (plan Task 1 gotcha;
 *     extended to `.tsx` specimens, not just the `.html` the plan named, because
 *     the rationale is identical).
 *
 * Pure — no disk access. Accepts back-slash or forward-slash input. gate-b-c4m — the one copy lives
 * in skip-dirs.ts (the access closure asks it for `.html` canvases, and the hub imports that leaf).
 */
export { isCanvasFile };

export interface ActivityEntry {
  status: 'active' | 'idle';
  /** ISO timestamp of the last transition. */
  ts: string;
  /**
   * Artboard ids the change was scoped to (Task 7), or null when the change is
   * file-level (every artboard in the file lights up). Always null on the first
   * sight of a file (no baseline to diff against).
   */
  artboardIds: string[] | null;
}

export interface ActivityChange {
  file: string;
  status: 'active' | 'idle';
  artboard_ids: string[] | null;
  ts: string;
}

export interface Activity {
  /** WS-open snapshot — keyed by design-root-relative canvas path. */
  state: Record<string, ActivityEntry>;
  /**
   * Test seam — synchronously mark a file `active` (file-level) and schedule its
   * idle flip. The live path calls this from the `fs:any` handler, then refines
   * `artboardIds` asynchronously via the Task 7 diff.
   */
  mark(file: string): void;
  /** Unsubscribe from the bus and clear all pending idle timers. */
  stop(): void;
}

export interface ActivityOptions {
  /** Override the idle debounce (tests pass a small value). */
  idleMs?: number;
  /** Disable the Task 7 per-artboard diff (file-level only). Default: enabled. */
  diff?: boolean;
  /** Override the user-write suppression window (tests pass a small value). */
  suppressTtlMs?: number;
}

export function createActivity(ctx: Context, opts: ActivityOptions = {}): Activity {
  const idleMs = opts.idleMs ?? ACTIVITY_IDLE_MS;
  const diffEnabled = opts.diff !== false;

  const state: Record<string, ActivityEntry> = {};
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Last-seen file text, for the Task 7 region diff. Insertion-ordered Map = LRU.
  const lastText = new Map<string, string>();
  // Phase 12.1 — writes the USER just made through the shell (drag / keyboard
  // reorder, inspector CSS/text/attr edits + their undo/redo) must NOT light the
  // "editing" rim: the overlay means "an agent works here" (DDR-029), and
  // flashing it on the user's own direct manipulation reads as interference.
  // The write path emits `activity:suppress` with the designRoot-relative path
  // right before writing; EVERY fs:any for that file inside the TTL window is
  // swallowed (RC2, rca/issue-canvas-hmr-optimistic-update-consistency — the
  // old one-shot delete let the 2nd event of a same-file write burst through:
  // slider drags and reorder spam produce several debounced fs:any per arm).
  // The TTL bounds the mute so a crashed write can't silence a file forever.
  const suppressTtlMs = opts.suppressTtlMs ?? SUPPRESS_TTL_MS;
  const suppressed = new Map<string, number>();

  function emit(file: string) {
    const e = state[file];
    if (!e) return;
    const change: ActivityChange = {
      file,
      status: e.status,
      artboard_ids: e.artboardIds,
      ts: e.ts,
    };
    ctx.bus.emit('activity:change', change);
  }

  function scheduleIdle(file: string) {
    const prev = idleTimers.get(file);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      idleTimers.delete(file);
      const e = state[file];
      if (!e || e.status === 'idle') return;
      e.status = 'idle';
      e.ts = new Date().toISOString();
      // Idle carries no artboard scope — the whole file cross-fades out.
      e.artboardIds = null;
      emit(file);
    }, idleMs);
    idleTimers.set(file, t);
  }

  // Public + internal entry. Marks the file `active` file-level (preserving any
  // artboardIds already refined this active window), refreshes the idle timer,
  // and emits. Emits on the idle→active transition AND on every refresh-while-
  // active (plan Task 2) — idempotent for the client, which only fades on idle.
  function mark(file: string) {
    const prev = state[file];
    const carryIds = prev && prev.status === 'active' ? prev.artboardIds : null;
    state[file] = { status: 'active', ts: new Date().toISOString(), artboardIds: carryIds };
    scheduleIdle(file);
    emit(file);
  }

  // Task 7 — refine the active file's artboardIds via a cheap region diff of the
  // previous vs current file text. Best-effort: any read race / parse ambiguity
  // leaves the file-level highlight in place. Runs at most once per fs:any (which
  // fs-watch already debounces 50 ms), and never blocks the synchronous mark().
  async function refineArtboards(file: string) {
    if (!ctx.paths?.designRoot) return;
    try {
      const abs = path.join(ctx.paths.designRoot, file);
      const next = await Bun.file(abs).text();
      const prev = lastText.get(file);
      stash(file, next);
      if (prev == null) return; // first sight — no baseline, stay file-level
      const ids = diffArtboardIds(prev, next);
      if (!ids || ids.length === 0) return; // ambiguous / outside-region change
      const e = state[file];
      if (e && e.status === 'active') {
        e.artboardIds = ids;
        emit(file);
      }
    } catch {
      /* read race, file gone, or designRoot unset in tests — stay file-level */
    }
  }

  function stash(file: string, text: string) {
    if (lastText.has(file)) lastText.delete(file);
    lastText.set(file, text);
    while (lastText.size > STASH_CAP) {
      const oldest = lastText.keys().next().value;
      if (oldest === undefined) break;
      lastText.delete(oldest);
    }
  }

  const off = ctx.bus.on('fs:any', (rel: string) => {
    if (!isCanvasFile(rel)) return;
    const until = suppressed.get(rel);
    if (until != null) {
      if (Date.now() < until) {
        // User-originated write window — keep the diff baseline fresh so the
        // NEXT (agent) edit still region-scopes correctly, but skip the rim.
        // The entry stays armed until the TTL expires or the writer disarms.
        if (diffEnabled) void refineArtboards(rel);
        return;
      }
      suppressed.delete(rel); // expired — clean up and fall through to mark()
    }
    mark(rel);
    if (diffEnabled) void refineArtboards(rel);
  });

  const offSuppress = ctx.bus.on('activity:suppress', (rel: string) => {
    if (typeof rel !== 'string' || !rel) return;
    suppressed.set(rel.replace(/\\/g, '/'), Date.now() + suppressTtlMs);
  });

  // The write path arms `activity:suppress` BEFORE the write (so it catches the
  // debounced fs:any). If the write turns out to be a no-op or throws, it disarms
  // via this event — otherwise a failed/spam reorder would swallow the NEXT
  // genuine (agent / synced-peer) edit's rim (adversarial F2).
  const offUnsuppress = ctx.bus.on('activity:unsuppress', (rel: string) => {
    if (typeof rel !== 'string' || !rel) return;
    suppressed.delete(rel.replace(/\\/g, '/'));
  });

  function stop() {
    off();
    offSuppress();
    offUnsuppress();
    for (const t of idleTimers.values()) clearTimeout(t);
    idleTimers.clear();
    lastText.clear();
    suppressed.clear();
  }

  return { state, mark, stop };
}

// ---------------------------------------------------------------------------
// Task 7 helpers — pure, regex-bounded region diff. Exported for unit tests.

/**
 * Map each `<DCArtboard id="X">…</DCArtboard>` to its inner body text. Returns
 * `null` when no artboard markers are found (the file can't be region-scoped, so
 * the caller falls back to a file-level highlight). DCArtboards aren't nested in
 * practice, so a non-greedy body match is sufficient — deliberately not AST-
 * based (a TSX parser would mean a new dep, against DDR-009's zero-dep spirit).
 */
function extractArtboardRegions(src: string): Map<string, string> | null {
  const re = /<DCArtboard\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/DCArtboard>/g;
  const map = new Map<string, string>();
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex-exec loop.
  while ((m = re.exec(src)) !== null) {
    map.set(m[1] as string, m[2] as string);
  }
  return map.size === 0 ? null : map;
}

/** The file with every artboard BODY stripped — what's left is the "shell". */
function artboardSkeleton(src: string): string {
  return src.replace(
    /(<DCArtboard\b[^>]*\bid=["'][^"']+["'][^>]*>)[\s\S]*?(<\/DCArtboard>)/g,
    '$1$2'
  );
}

/**
 * Ids of the `<DCArtboard>` blocks whose body changed between two file
 * revisions, or `null` to signal "fall back to file-level" when:
 *   - either revision has no parseable artboard markers, OR
 *   - anything outside the artboard bodies changed (imports, opening-tag attrs,
 *     artboard added/removed → the shell differs), OR
 *   - nothing inside any artboard body changed.
 */
export function diffArtboardIds(prev: string, next: string): string[] | null {
  const prevRegions = extractArtboardRegions(prev);
  const nextRegions = extractArtboardRegions(next);
  if (!prevRegions || !nextRegions) return null;
  if (artboardSkeleton(prev) !== artboardSkeleton(next)) return null;
  const ids = new Set([...prevRegions.keys(), ...nextRegions.keys()]);
  const changed: string[] = [];
  for (const id of ids) {
    if (prevRegions.get(id) !== nextRegions.get(id)) changed.push(id);
  }
  return changed.length ? changed : null;
}
