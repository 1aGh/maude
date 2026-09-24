// HMR broadcaster (Phase 3.6.1 Task 8).
//
// Bridges fs-watch.ts → ws.ts: classifies each change event under the design
// root and emits a `canvas-hmr` WS message. The iframe-side client (inlined in
// _shell.html) reacts to the message:
//
//   - `mode: "css"`    → swap <link> href with a cache-bust query (no module
//                        reload, no React state loss). Sub-150ms latency.
//   - `mode: "module"` → in-place hot-swap of the canvas module when the canvas
//                        runtime is mounted (re-import + remount only the canvas
//                        content; the iframe — and the live CollabProvider +
//                        presence — stay mounted, so a cross-peer synced edit
//                        updates seamlessly without a presence blink — Phase 30
//                        / F4). Falls back to location.reload() with no runtime
//                        (gallery thumbnails) or on a re-import with no usable
//                        default export. State (scroll / tool / undo) survives
//                        the hot-swap path.
//   - `mode: "hard"`   → location.reload() (used when canvas-lib.tsx or any
//                        `_lib/**` file changes — every open canvas needs to
//                        re-bundle).
//
// We deliberately do NOT try to wire Bun's `import.meta.hot.accept(...)`. Bun
// supports HMR in `bun dev` mode (HTML import roots), but canvases here are
// loaded via the importmap + Bun.build-produced ESM — there's no React Fast
// Refresh runtime to register with. Full-reload is the reliable path.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { recallCanvasBuild } from './canvas-source-memo.ts';
import { type TextPatch, textOnlyPatches } from './canvas-text-patch.ts';
import type { Context } from './context.ts';

const DEBOUNCE_MS = 50;

export interface HmrMessage {
  type: 'canvas-hmr';
  mode: 'css' | 'module' | 'hard' | 'meta' | 'asset';
  /**
   * Canvas-relative path of the file that changed, slash-normalised. Absent
   * when mode === 'hard' (the change is global — every canvas reloads).
   *
   * For mode === 'meta' this is the `<base>.meta.json` path; iframe peels off
   * the `.meta.json` suffix to compare against its own `canvasRel`.
   */
  file?: string;
  /** Cache-bust token — etag-like. Caller appends to <link> href. */
  version: number;
  /** Echo of `_lib`-scoped changes for debug + scope reasoning. */
  scope?: 'lib' | 'canvas';
  /**
   * The change was written by sync — the project's version landing on this
   * disk — not by this person's own edit. The iframe may skip a reload it
   * believes is the echo of an optimistic edit it already shows; it must never
   * skip one of these, because a teammate's change can ride the same write (a
   * lost race re-applied onto theirs).
   */
  remote?: boolean;
  /**
   * F4 — `module` only: the change is nothing but the text of this element
   * (versus the source of the canvas's last build). The iframe may show them at once; the remount it still
   * performs confirms them. Absent whenever anything else changed.
   */
  patches?: TextPatch[];
}

/** How long after a sync write its file's change still counts as remote. */
export const REMOTE_WRITE_WINDOW_MS = 3_000;

export interface HmrBroadcaster {
  /** Stop subscribing to fs-watch events. */
  stop(): void;
}

/**
 * Subscribe to fs:any / fs:css events. Debounces same-path changes, classifies
 * the change, and forwards via `broadcast`. `broadcast` is wired to the
 * existing ws.ts fanout; tests inject a stub.
 */
export function createHmrBroadcaster(
  ctx: Context,
  broadcast: (msg: HmrMessage) => void
): HmrBroadcaster {
  let pending: ReturnType<typeof setTimeout> | null = null;
  // RC4 (rca/issue-canvas-hmr-optimistic-update-consistency) — one pending
  // message PER FILE, plus a shared bucket for file-less messages (`hard` is
  // global). The old single-slot pendingMsg meant a <50 ms multi-file burst
  // (an agent turn touching several canvases) broadcast only the LAST file:
  // every other open canvas missed its reload and sat stale until a manual
  // hard refresh.
  const GLOBAL_KEY = '\0global'; // NUL prefix — can't collide with an on-disk rel path
  const pendingByKey = new Map<string, HmrMessage>();
  // meta is the lightest signal — it doesn't trigger a reload, just re-fetches
  // the sidecar. CSS still ranks above it so a same-window CSS write wins over
  // a meta echo; hard tops everything.
  const rank: Record<HmrMessage['mode'], number> = {
    meta: 0,
    asset: 0,
    css: 1,
    module: 2,
    hard: 3,
  };

  // Diff the canvas as it is now against the source the iframe renders (its
  // last build). Read at flush, not per event, so a burst diffs end to end.
  // String scanning plus the build's locator — never a parse (see
  // canvas-text-patch.ts: in a cell this is the credential-holding process).
  function withTextPatches(msg: HmrMessage): HmrMessage {
    const root = ctx.paths?.designRoot;
    if (msg.mode !== 'module' || !msg.file?.endsWith('.tsx') || !root) return msg;
    const abs = path.join(root, msg.file);
    let now: string;
    try {
      now = readFileSync(abs, 'utf8');
    } catch {
      return msg;
    }
    const built = recallCanvasBuild(abs);
    if (built === undefined) return msg;
    try {
      const patches = textOnlyPatches(built.source, now, built.locator);
      return patches?.length ? { ...msg, patches } : msg;
    } catch {
      return msg; // the remount still renders it
    }
  }

  function flush() {
    // A pending `hard` supersedes the per-file queue — every open canvas does a
    // full reload anyway, so the softer messages would be redundant churn.
    const hard = pendingByKey.get(GLOBAL_KEY);
    if (hard?.mode === 'hard') {
      broadcast(hard);
    } else {
      for (const msg of pendingByKey.values()) broadcast(withTextPatches(msg));
    }
    pendingByKey.clear();
    pending = null;
  }

  function classify(filename: string): HmrMessage | null {
    return classifyChange(filename, (cssRel) => {
      const root = ctx.paths?.designRoot;
      if (!root) return false; // no root resolved → can't probe; keep css swap
      return existsSync(path.join(root, cssRel.replace(/\.css$/i, '.tsx')));
    });
  }

  // Files sync just wrote (see HmrMessage.remote), with the time of the write.
  const projectedAt = new Map<string, number>();
  // A real watcher and the cell fallback can report the same completed write
  // more than 50 ms apart. A second import invalidates the first even when its
  // bytes are already arriving. Deduplicate disk VERSIONS, never merely paths
  // or a time window: another edit to this file must still reach the canvas.
  const remoteVersions = new Map<string, string>();
  const isRemote = (rel: string | undefined): boolean => {
    if (!rel) return false;
    const at = projectedAt.get(rel);
    return at !== undefined && Date.now() - at < REMOTE_WRITE_WINDOW_MS;
  };
  const offProjected = ctx.bus.on('sync:projected', (rel: unknown) => {
    if (typeof rel !== 'string' || !rel) return;
    const now = Date.now();
    projectedAt.set(rel.replace(/\\/g, '/'), now);
    if (projectedAt.size > 256) {
      for (const [k, at] of projectedAt)
        if (now - at >= REMOTE_WRITE_WINDOW_MS) projectedAt.delete(k);
    }
  });

  function enqueue(msg: HmrMessage) {
    const key = msg.mode === 'hard' ? GLOBAL_KEY : (msg.file ?? GLOBAL_KEY);
    const prev = pendingByKey.get(key);
    // Coalescing never loses "a teammate's change is in here".
    if (prev?.remote) msg.remote = true;
    // Same-key coalescing keeps the strongest mode (refreshing the payload for
    // equal rank, so the latest version token wins).
    if (!prev || rank[msg.mode] >= rank[prev.mode]) pendingByKey.set(key, msg);
    if (pending) clearTimeout(pending);
    pending = setTimeout(flush, DEBOUNCE_MS);
  }

  const offAny = ctx.bus.on('fs:any', (rel: string) => {
    const msg = classify(rel);
    if (!msg) return;
    const normalized = rel.replace(/\\/g, '/');
    if (isRemote(normalized) || isRemote(msg.file)) msg.remote = true;
    if (msg.remote && (msg.mode === 'module' || msg.mode === 'css') && ctx.paths.designRoot) {
      try {
        const s = statSync(path.join(ctx.paths.designRoot, normalized), { bigint: true });
        // Nanosecond ctime also detects a same-size rewrite with restored mtime;
        // inode detects atomic replacement. No source or large media is read.
        const version = `${msg.mode}:${msg.file}:${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
        if (remoteVersions.get(normalized) === version) return;
        remoteVersions.delete(normalized);
        remoteVersions.set(normalized, version);
        if (remoteVersions.size > 256) {
          const oldest = remoteVersions.keys().next().value;
          if (oldest !== undefined) remoteVersions.delete(oldest);
        }
      } catch {
        remoteVersions.delete(normalized); // missing/unreadable: fail open
      }
    } else remoteVersions.delete(normalized);
    enqueue(msg);
  });

  return {
    stop() {
      offAny();
      offProjected();
      if (pending) clearTimeout(pending);
      pending = null;
      pendingByKey.clear();
      remoteVersions.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers — exported for tests.

export const HMR_DEBOUNCE_MS = DEBOUNCE_MS;

/**
 * Classify a changed design-root-relative path into an HMR message. Pure +
 * fs-injected (`hasSiblingTsx`) so it unit-tests without touching disk.
 *
 * CSS routing is the load-bearing part. A canvas/specimen sibling stylesheet
 * (e.g. `system/x/preview/motion.css` next to `motion.tsx`, pulled in via
 * `import './motion.css'`) is INLINED into the built module as a `<style>` tag
 * by canvas-build.ts — there is NO `<link>` for it. The iframe's `mode:'css'`
 * handler swaps `<link href>` only, so a link swap for inlined CSS is a silent
 * no-op and the edit never reaches the browser (the bug this fixes). For those
 * we emit `mode:'module'` keyed on the sibling `.tsx`, so the open canvas
 * reloads and re-inlines the fresh CSS via the existing module-reload path.
 * Link-mounted CSS (DS tokens, `_components.css`, `_layout.css` — no sibling
 * `.tsx`) keeps the fast, state-preserving css swap.
 */
export function classifyChange(
  filename: string,
  hasSiblingTsx: (cssRel: string) => boolean
): HmrMessage | null {
  const rel = filename.replace(/\\/g, '/');
  const ext = path.extname(rel).toLowerCase();
  const version = Date.now();
  if (rel.startsWith('_lib/')) {
    return { type: 'canvas-hmr', mode: 'hard', scope: 'lib', version };
  }
  if (ext === '.css') {
    if (hasSiblingTsx(rel)) {
      const siblingTsx = rel.replace(/\.css$/i, '.tsx');
      return { type: 'canvas-hmr', mode: 'module', file: siblingTsx, version, scope: 'canvas' };
    }
    return { type: 'canvas-hmr', mode: 'css', file: rel, version, scope: 'canvas' };
  }
  // The PhotoEdit sidecar (`assets/<sha8>.photo.json`) — a peer's photo
  // adjustment arriving over the file plane. Ride the existing `asset` mode:
  // the shell recognises the `.photo.json` shape and, instead of re-pointing
  // an <img> (nothing references the sidecar), tells the canvas to re-fetch
  // the edit and re-bake (`maude:photo-edit-refreshed`). Without this the
  // sidecar changed on disk and no open canvas ever heard — a photo edit from
  // another machine appeared only after a manual reload.
  if (rel.endsWith('.photo.json') && /(^|\/)assets\//.test(rel)) {
    return { type: 'canvas-hmr', mode: 'asset', file: rel, version, scope: 'canvas' };
  }
  // Phase 8 — canvas-meta sidecar (`<base>.meta.json`) carries the
  // artboard layout / viewport. Emit a `meta` mode so foreign tabs can
  // re-fetch + re-apply the layout WITHOUT a full reload (which would
  // lose React state like tool mode, undo stack, scroll position).
  if (rel.endsWith('.meta.json')) {
    return { type: 'canvas-hmr', mode: 'meta', file: rel, version, scope: 'canvas' };
  }
  if (ext === '.tsx' || ext === '.jsx' || ext === '.ts' || ext === '.js') {
    return { type: 'canvas-hmr', mode: 'module', file: rel, version, scope: 'canvas' };
  }
  // 2026-08-15 annotations-assets RCA — a MEDIA file landing on disk (asset
  // pull, file-plane pull, desktop push echo) is a heal signal, not a reload:
  // any <img>/<image> that already 404'd on this name keeps the broken glyph
  // forever (browsers never retry a failed load on their own). `mode:'asset'`
  // tells open canvases to re-point matching, still-broken elements — no
  // reload, no React state loss. Covers top-level `assets/` AND DS trees
  // (`system/<ds>/assets/…`); `.part` staging files never match the ext set.
  if (ASSET_MEDIA_EXTS.has(ext)) {
    return { type: 'canvas-hmr', mode: 'asset', file: rel, version, scope: 'canvas' };
  }
  return null;
}

/** Media extensions worth a heal broadcast — the renderable subset of the
 *  asset lanes' vocabulary (fonts excluded: a font 404 heals only via a CSS
 *  re-evaluation, which is a reload — not worth forcing for the rare case). */
const ASSET_MEDIA_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.svg',
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
]);

// ---------------------------------------------------------------------------
// Container write bridge — inspector-edits-live-render RCA.

/**
 * Delay before synthesising the `fs:any` a container's `fs.watch` failed to
 * emit. The write is `await`ed inside the op before it returns, so a few hundred
 * ms is ample; kept well under activity's 2.5 s `SUPPRESS_TTL_MS` so the
 * user-write rim stays muted when the synthetic event lands.
 */
export const SYNTHETIC_FS_DELAY_MS = 250;

/**
 * In a CELL the recursive `fs.watch` (Linux inotify) does NOT fire for the
 * atomic tmp+rename writes `canvas-edit.ts` makes into `designRoot` subdirs —
 * verified live: after a `200` `edit-css` on a cell, a connected `canvas-hmr`
 * socket received nothing. So `fs:any` never fires, the HMR broadcaster never
 * runs, and a PEER's canvas iframe sits on the pre-edit module until a manual
 * reload. (Annotations are spared: they cross via the collab room, not `fs:any`.)
 *
 * Every write path arms `activity:suppress(rel)` immediately before writing — a
 * reliable, complete signal that a write to `rel` is imminent. Treat it as the
 * `fs:any` the watcher owes us and synthesise one once the write has settled. A
 * no-op or failed edit disarms via `activity:unsuppress`, which cancels the
 * pending emit, so an equal-length or rejected edit never reloads peers.
 *
 * WORKSPACE-MODE ONLY (the caller gates it): locally `fs.watch` fires, and a
 * second source would double-reload every canvas on every edit — the HMR
 * broadcaster's 50 ms per-path debounce cannot coalesce two events ~250 ms apart.
 */
export function createContainerWriteBridge(ctx: Context): { stop(): void } {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const norm = (rel: string) => rel.replace(/\\/g, '/');

  const offSuppress = ctx.bus.on('activity:suppress', (rel: string) => {
    if (typeof rel !== 'string' || !rel) return;
    const key = norm(rel);
    const prev = pending.get(key);
    if (prev) clearTimeout(prev);
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        ctx.bus.emit('fs:any', key);
      }, SYNTHETIC_FS_DELAY_MS)
    );
  });

  const cancel = (rel: string) => {
    if (typeof rel !== 'string' || !rel) return;
    const t = pending.get(norm(rel));
    if (t) {
      clearTimeout(t);
      pending.delete(norm(rel));
    }
  };
  const offUnsuppress = ctx.bus.on('activity:unsuppress', cancel);

  return {
    stop() {
      offSuppress();
      offUnsuppress();
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    },
  };
}
