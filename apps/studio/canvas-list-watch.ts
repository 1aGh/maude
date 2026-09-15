// External-canvas list watcher.
//
// The browser file tree re-reads `/_index-data` only when it receives a
// `canvas-list-update` WS message. Until now that message was emitted ONLY by
// the dev-server's own create/delete API (`api.ts` createCanvas / deleteCanvas),
// so a canvas written straight to disk by something OUTSIDE the server — the ACP
// chat agent running `/design:new`, an agent `Write`, `git checkout`, a terminal
// `cp`/`rm` — never refreshed the tree. The file landed on disk, `fs:any` fired,
// the HMR/activity/git-status subscribers reacted, but the tree stayed stale
// until a full page reload. See `.ai/logs/rca/issue-acp-new-canvas-not-in-filetree.md`.
//
// This is the symmetric server-side counterpart: subscribe to `fs:any`, and when
// the set of openable canvas files under the configured canvas groups changes
// (add or remove), emit the same `canvas-list-update` the API does. The client's
// handler just calls `loadTree()` (a wholesale `/_index-data` re-read), so a
// nudge is all that's required — the diff makes it precise enough to skip every
// non-structural edit (a canvas body save, a `.meta.json` rewrite) and so avoid
// thrashing the tree on every `/design:edit`.
//
// Bun-native (DDR-009); the canvas listing reuses `findHtmlFiles` and the slug
// reuses `canvasSlugFromRel`, both from api.ts — the single source of truth that
// also backs `/_index-data` and the UI create/delete emits (no duplicated
// SKIP_DIRS / group rules to drift; DDR-115 runtime-state exclusions come along
// for free because `findHtmlFiles` already skips `_`-prefixed + SKIP_DIRS paths).

import path from 'node:path';

import {
  canvasSlugFromRel,
  findFiles,
  findHtmlFiles,
  PREVIEW_ASSET_EXTS,
  SKIP_DIRS,
} from './api.ts';
import type { Context } from './context.ts';

/**
 * Supporting files the tree lists beside the canvases (images, fonts, media —
 * the same `PREVIEW_ASSET_EXTS` `/_index-data` walks). A new one written from
 * outside the app — an agent's export, a teammate's image arriving through
 * sync — is a tree change too; without it the row stayed missing until
 * something else reloaded the tree (plan T17/L03). Sidecars and stylesheets are
 * deliberately NOT here: they are rewritten on every edit, and the tree nests
 * them under their canvas anyway.
 */
function isListedFile(low: string): boolean {
  return PREVIEW_ASSET_EXTS.some((x) => low.endsWith(x));
}

/** Burst-collapse window. A new canvas writes both `.tsx` and `.meta.json`; a
 * git checkout touches many files at once — one snapshot per quiet window. */
export const CANVAS_LIST_DEBOUNCE_MS = 150;

/**
 * Cheap gate: is this `fs:any` path worth a (debounced) full recompute? True
 * only for an openable canvas file (`.tsx` / `.html`) that lives under one of
 * the configured canvas groups and carries no `_`-prefixed or SKIP_DIRS segment.
 * A loose gate just means an occasional needless recompute — never a wrong emit,
 * since `snapshot()` is authoritative. Input is design-root-relative (the shape
 * fs-watch emits, e.g. `ui/project/Pricing.tsx`).
 *
 * Pure — no disk access. Accepts back-slash or forward-slash input.
 */
export function isCanvasCandidate(rel: string, groupPaths: string[]): boolean {
  if (typeof rel !== 'string') return false;
  const p = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p) return false;
  const low = p.toLowerCase();
  // A DIRECTORY IS A CANDIDATE TOO. Renaming or moving a folder OUTSIDE the app
  // (Finder, `mv`, `git checkout` of a branch that renamed it) changes the path
  // of every canvas inside it, but the only event that reaches here names the
  // DIRECTORY — `ui/dbox2` — which has no `.tsx` on the end. Gating on the
  // extension therefore ignored it, so the tree kept listing the old folder and,
  // worse, the sync runtime kept a descriptor pointing at a path that no longer
  // existed: the canvases in that folder silently stopped syncing until some
  // unrelated write to a `.tsx` happened to nudge the same recompute.
  // `snapshot()` is authoritative, so a directory that turns out to hold no
  // canvases costs one recompute and emits nothing.
  const last = p.slice(p.lastIndexOf('/') + 1);
  const looksLikeDir = !last.includes('.');
  if (!looksLikeDir && !low.endsWith('.tsx') && !low.endsWith('.html') && !isListedFile(low))
    return false;
  const segs = p.split('/');
  for (const s of segs) {
    if (!s) return false;
    if (s === '..') return false; // the extension test used to be the guard here
    if (s.startsWith('_')) return false;
    if (SKIP_DIRS.has(s)) return false;
  }
  return groupPaths.some((gp) => {
    const g = gp.replace(/^\/+|\/+$/g, '');
    return !!g && (p === g || p.startsWith(`${g}/`));
  });
}

export interface CanvasListWatch {
  /** Resolves once the initial canvas set has been seeded (no emit). */
  readonly ready: Promise<void>;
  /** Test seam — force a recompute + diff + emit. Serialized after the seed and
   * any in-flight refresh, so a create observed between calls always diffs
   * against the pre-create set. */
  refresh(): Promise<void>;
  /** Current known openable-canvas set (design-rel-prefixed). For assertions. */
  readonly known: ReadonlySet<string>;
  stop(): void;
}

export interface CanvasListWatchOptions {
  debounceMs?: number;
}

export function createCanvasListWatch(
  ctx: Context,
  opts: CanvasListWatchOptions = {}
): CanvasListWatch {
  const debounceMs = opts.debounceMs ?? CANVAS_LIST_DEBOUNCE_MS;
  // Mirror /_index-data's group set exactly (cfg.canvasGroups) — NOT api.ts's
  // create-allowlist, which additionally permits cfg.newCanvasDir. On the
  // default config newCanvasDir IS a group; a config pointing it outside
  // canvasGroups would have the canvas absent from /_index-data too, so the
  // watcher stays consistent with what the tree can actually show.
  //
  // Read at USE time, never captured — `reloadConfig` (context.ts) hot-swaps
  // ctx.cfg in place when config.json changes on disk, and a group added
  // mid-session (`/design:setup-ds` adding `system`) must gate correctly.
  const groupPaths = () => (ctx.cfg.canvasGroups ?? []).map((g) => g.path);

  // null = not yet seeded; the first refresh captures the baseline and emits
  // nothing (canvases already on disk at boot aren't "added").
  let known: Set<string> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let pending: ReturnType<typeof setTimeout> | null = null;

  async function snapshot(): Promise<Set<string>> {
    const out = new Set<string>();
    for (const g of ctx.cfg.canvasGroups ?? []) {
      const groupAbs = path.join(ctx.paths.designRoot, g.path);
      const groupRel = path.posix.join(ctx.paths.designRel, g.path);
      let files: string[];
      try {
        files = await findHtmlFiles(groupAbs, groupRel);
      } catch {
        continue; // group dir missing / unreadable — treat as empty
      }
      for (const f of files) out.add(f);
      try {
        for (const f of await findFiles(groupAbs, groupRel, PREVIEW_ASSET_EXTS)) out.add(f);
      } catch {
        /* unreadable — the canvases above still diff */
      }
    }
    return out;
  }

  function emit(action: 'added' | 'removed', rel: string) {
    // `rel` from findHtmlFiles is designRel-prefixed (`.design/ui/X.tsx`); strip
    // the prefix so the wire shape matches api.ts's group-relative emit
    // (`ui/X.tsx`). The client IGNORES the payload entirely — it just re-reads
    // /_index-data — so rel/slug are advisory only. SECURITY TRIPWIRE: any FUTURE
    // consumer of this event must treat rel/slug as ATTACKER-CONTROLLED (agent /
    // `git checkout`-authored filenames) and must NOT feed them to a
    // render/open/build sink without re-validating against /_index-data.
    const prefix = `${ctx.paths.designRel.replace(/^\/+|\/+$/g, '')}/`;
    const relOut = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
    if (isListedFile(rel.toLowerCase())) {
      // Not a canvas: its own action and no slug, so no consumer mistakes an
      // image for a canvas to close, retarget or adopt.
      ctx.bus.emit('canvas-list-update', { action: `file-${action}`, rel: relOut });
      return;
    }
    ctx.bus.emit('canvas-list-update', {
      action,
      rel: relOut,
      slug: canvasSlugFromRel(rel, ctx.paths.designRel),
    });
  }

  async function doRefresh(): Promise<void> {
    const next = await snapshot();
    if (known === null) {
      known = next; // seed — no emit
      return;
    }
    for (const rel of next) if (!known.has(rel)) emit('added', rel);
    for (const rel of known) if (!next.has(rel)) emit('removed', rel);
    known = next;
  }

  // Serialize every recompute through one chain so the boot-time seed always
  // runs first and concurrent snapshots can't race a create into a missed diff.
  function refresh(): Promise<void> {
    chain = chain.then(doRefresh, doRefresh);
    return chain;
  }

  const ready = refresh(); // seed at construction

  function schedule() {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      void refresh();
    }, debounceMs);
  }

  const off = ctx.bus.on('fs:any', (rel: string) => {
    if (!isCanvasCandidate(rel, groupPaths())) return;
    schedule();
  });

  function stop() {
    off();
    if (pending) clearTimeout(pending);
    pending = null;
  }

  return {
    ready,
    refresh,
    get known() {
      return known ?? new Set<string>();
    },
    stop,
  };
}
