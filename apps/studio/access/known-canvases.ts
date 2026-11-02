// p8-c4b — the canvases the project's AUTHORITY knows of, for the closure's canvas test.
//
// gate-b-c4k decided canvas-ness from content: a `.tsx` is a canvas iff it renders DesignCanvas,
// or it has a meta / a board / a hub doc / a stored grant. The last signal was not wired, so an old
// meta-less canvas that does not render DesignCanvas was "a helper" and could be inlined into
// another canvas's frame (and its source read by a session granted only that other canvas). A
// stored grant names a canvas — nobody shares a component — so every canvas any grant names is one.
//
//   - a cell child: the file its hub writes into the HUB's data dir (never the tenant's checkout,
//     DDR-054) and names by env (`MAUDE_HUB_KNOWN_CANVASES_FILE`, the `MAUDE_HUB_FORMAT_FILE`
//     precedent). The hub rewrites it before it forwards a request, so a new grant counts on the
//     next one. Absent or unreadable: nothing is added (the content rule still holds).
//   - a hub-linked desktop: the grants of the claim it already stores for that hub (`accessFor`,
//     re-read per call like the gate's).
//   - an unlinked desktop: none (the owner, no grants anywhere).
//
// It only ever ADDS canvases — a listed file is refused as an import (c4j), never admitted.

import { readFileSync, statSync } from 'node:fs';

import { accessFor } from '../sync/hubs-config.ts';
import { isWorkspaceMode } from '../workspace-mode.ts';
import { type ClosureConfig, closureConfigOf } from './closure.ts';
import { resolveAccess } from './scope.ts';

/** The env var a cell's hub names its known-canvas file by (apps/hub studio-child.mjs). */
export const HUB_KNOWN_CANVASES_ENV = 'MAUDE_HUB_KNOWN_CANVASES_FILE';

/** A larger file is not read (256 grants × a few thousand accounts is far below it). */
const MAX_BYTES = 4 * 1024 * 1024;

let fileCache: { file: string; key: string; list: readonly string[] } | null = null;

/** The canvases the hub's file lists (`{ canvases: string[] }`), or none. Keyed by inode + mtime. */
export function readHubKnownCanvases(file: string): readonly string[] {
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return [];
    // The hub writes by rename, so a new write is a new inode even inside one mtime tick.
    const key = `${st.ino}:${st.size}:${st.mtimeMs}`;
    if (fileCache?.file === file && fileCache.key === key) return fileCache.list;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { canvases?: unknown };
    const list = Object.freeze(
      Array.isArray(raw?.canvases)
        ? raw.canvases.filter((c): c is string => typeof c === 'string')
        : []
    );
    fileCache = { file, key, list };
    return list;
  } catch {
    return [];
  }
}

/** This studio's known canvases (see the header). */
export function knownCanvasesFor(
  cfg: { linkedHub?: { url?: string } | null } | undefined,
  env: NodeJS.ProcessEnv = process.env
): readonly string[] {
  if (isWorkspaceMode(env)) {
    const file = env[HUB_KNOWN_CANVASES_ENV];
    return file ? readHubKnownCanvases(file) : [];
  }
  const url = cfg?.linkedHub?.url;
  if (!url) return [];
  try {
    return resolveAccess(accessFor(url)).grants.map((g) => g.c);
  } catch {
    return [];
  }
}

/**
 * The closure config the studio judges with: its EFFECTIVE config (gate-b-c4j) plus the known
 * canvases. Undefined without a config (the reader's own `config.json` is read — the caller adds
 * the known canvases through `projectClosureConfig` then).
 */
export function closureConfigFor(ctx: {
  cfg?: { linkedHub?: { url?: string } | null } | null;
}): ClosureConfig | undefined {
  return ctx.cfg ? closureConfigOf(ctx.cfg, knownCanvasesFor(ctx.cfg)) : undefined;
}
