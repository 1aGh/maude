// Public surface of the collab module. Bundles the registry + persistence
// wiring so ws.ts + server.ts don't need to know about the internal split.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { canonicalAnnotations } from '../annotations/board-text.ts';
import { diffToOps } from '../annotations/ops.ts';
import { parseBoard } from '../annotations/schema.ts';
import type { Api } from '../api.ts';
import type { Context } from '../context.ts';

import { applyCommentsToDoc } from '../sync/codec.ts';
import { createPersistence, Y_TYPES } from './persistence.ts';
import { applyAnnotationsToDoc, createRegistry, type Registry } from './registry.ts';

export type { CollabConn } from './protocol.ts';
export type { Registry } from './registry.ts';
export type { Room, RoomConn } from './room.ts';
export { Y_TYPES };

export interface Collab {
  registry: Registry;
  /** Tear down the fs-driven re-seed subscription (server shutdown). */
  dispose(): void;
}

/**
 * Build the collab subsystem for this server instance. One registry +
 * persistence binding per dev-server boot. The registry is also the surface
 * the git-lifecycle path will call to force-snapshot dirty rooms (Phase 8
 * Task 7).
 */
export function createCollab(ctx: Context, api: Api): Collab {
  // Inverse of api.fileSlug — we have the URL slug, need the canonical
  // repo-relative path the api expects.
  //
  // Primary: api.fileForSlug scans the ACTUAL canvas files, so it resolves even
  // when the canvas has no comments yet. This is the fix for the receiving-peer
  // projection gap — a peer that hasn't yet got a comment for a canvas must
  // still locate the file to MATERIALIZE the first hub-pushed comment to disk
  // (DDR-064). The old comments-file scan was chicken-and-egg here: no comments
  // → null → persistJson bailed → the incoming comment never hit disk.
  //
  // Fallback: a canvas whose file the scan missed (renamed/moved with an orphan
  // comments file) still resolves via its existing comments file, preserving
  // the prior behavior for that edge.
  async function fileForSlug(slug: string): Promise<string | null> {
    const byCanvas = await api.fileForSlug(slug);
    if (byCanvas) return byCanvas;
    const all = await api.loadAllComments();
    for (const [file] of Object.entries(all)) {
      if (api.fileSlug(file) === slug) return file;
    }
    return null;
  }

  // Phase 9.2 (DDR-064) — under sharedDoc, disable the room's local file-seed
  // for pinned (provider-attached) slugs so it can't push duplicate Y.Array
  // items against the hub's canonical items (Risk 1). The registry is created
  // from the persistence callbacks, so break the cycle with a late-bound ref
  // (the predicate is only consulted at room-seed time, after `registry` is
  // assigned). Flag-OFF → predicate returns true → seed unchanged.
  let registryRef: Registry | null = null;
  // Board texts this process's rooms projected to disk and whose watcher echo
  // hasn't come back yet (a few per slug: flushes can outrun the watcher).
  const ownProjections = new Map<string, string[]>();
  // The board as disk last held it while the room agreed with it (the room's
  // own projection, or an external write it imported). An external write is
  // applied as the CHANGE from this base, never as a replacement: a room edit
  // not yet flushed (a delete, a move) survives a writer that didn't know it.
  const diskBase = new Map<string, string>();
  const persistence = createPersistence({
    ctx,
    api,
    fileForSlug,
    onAnnotationsProjected: (slug, board) => {
      const list = ownProjections.get(slug) ?? [];
      list.push(board);
      ownProjections.set(slug, list.slice(-4));
      diskBase.set(slug, board);
    },
    onAnnotationsSeeded: (slug, board) => {
      diskBase.set(slug, board);
    },
    shouldSeed: (slug) => !(ctx.sharedDoc && registryRef?.isPinned(slug)),
    // Issue #133 — record comment ids as synced only once the hub holds them,
    // and only for the room that IS the hub's doc (pinned). No hub linked:
    // nothing is "synced" — recording then would label local comments with
    // the last hub's identity and a relink would drop them (security review
    // F1a). Linked but the runtime is not up yet: not confirmed.
    commentsConfirmed: (slug) => {
      if (!ctx.cfg?.linkedHub || !registryRef?.isPinned(slug)) return false;
      return ctx.syncControl?.current?.()?.commentsConfirmedOnHub?.(slug) === true;
    },
    // A room restored from its own `.ydoc.bin` must not outrank a sidecar the
    // hub (or an editor) wrote after that cache — see `reconcileAfterCache`.
    // Only for rooms no hub provider owns: a pinned doc is the hub's replica
    // and file→doc imports belong to the sync agent's diff-aware lane.
    reconcileAfterCache: async (slug, doc, cachedAtMs) => {
      if (registryRef?.isPinned(slug)) return;
      const newerThanCache = (abs: string): boolean => {
        try {
          return statSync(abs).mtimeMs > cachedAtMs;
        } catch {
          return false;
        }
      };
      const file = await fileForSlug(slug);
      if (!file) return;
      if (newerThanCache(path.join(ctx.paths.designRoot, `${slug}.annotations.json`))) {
        const board = await api.loadAnnotations(file);
        if (board) applyAnnotationsToDoc(doc, board, 'seed');
      }
      if (newerThanCache(path.join(ctx.paths.commentsDir, `${slug}.json`))) {
        applyCommentsToDoc(doc, await api.loadCommentsForFile(file), 'seed');
      }
    },
  });
  // Accepted revisions: browser writes to a synced canvas's room are refused
  // (the room doc is the hub's accepted replica). Asked per frame — the save
  // mode can change while the studio runs.
  persistence.acceptedMode = () => ctx.syncControl?.current?.()?.acceptedMode?.() === true;
  const registry = createRegistry(persistence);
  registryRef = registry;

  // File = truth (the file-sync collaboration model + DDR-051): when a synced
  // file changes on disk from OUTSIDE the API path — the sync agent writing a
  // hub-pushed diff, or `design:edit` editing a JSON/SVG directly — fan the
  // change back out to the browser, since none of these go through the API's
  // onCommentsChanged. Two consumers, two reasons:
  //   - the live collab room (canvas pins / annotation strokes) — re-seeded so
  //     its in-memory doc stops clobbering the external change on next persist
  //     (the cross-machine "comment reverts to []" bug). Only when a room is
  //     mounted (peek, never create).
  //   - the shell's comments SIDEBAR — driven solely by the 'comments' WS event
  //     (app.jsx), which otherwise fires only on API writes. Emit it here too so
  //     a hub-pushed comment shows up on the peer's sidebar without a reload.
  // The registry's no-op guards make an identical re-seed free, so this can't
  // loop against the room's own persist (which also writes the file).
  // A mounted room with no hub provider takes external disk changes; a pinned
  // one leaves them to the sync agent.
  const ownsRoomFromDisk = (slug: string): boolean =>
    registry.peek(slug) !== null && !registry.isPinned(slug);
  const reseedFromDisk = async (rel: string): Promise<void> => {
    const cm = /^_comments\/(.+)\.json$/.exec(rel);
    // DDR-242 — the board file. A legacy `.annotations.svg` reappearing on disk
    // is NOT a board write (the boot migration quarantines it).
    const am = /^(.+)\.annotations\.json$/.exec(rel);
    const slug = cm?.[1] ?? am?.[1];
    if (!slug) return;
    const abs = path.join(ctx.paths.designRoot, rel);
    try {
      if (cm) {
        // Prefer the canonical loader (validates + default-fills the Comment
        // shape) keyed by the canvas file; fall back to the raw array when the
        // slug isn't mapped yet (e.g. a freshly-synced file with no prior load).
        const file = await fileForSlug(slug);
        const parsed = file
          ? await api.loadCommentsForFile(file)
          : JSON.parse(readFileSync(abs, 'utf8'));
        if (!Array.isArray(parsed)) return;
        // Phase 9.2 (DDR-064): when a hub provider is attached to the room
        // (pinned), a hub-pushed comment is ALREADY in the doc and the agent's
        // diff-aware applyFromFs owns external file→doc imports — re-seeding
        // would be the retired clobber path. The test is the PIN, not
        // `ctx.sharedDoc`: sharedDoc defaults on everywhere, including a cell
        // without live pairing, where no provider exists and disk is the only
        // way the hub's accepted state reaches the room. The sidebar still
        // needs the 'comments' bus emit, so keep that unconditionally.
        if (ownsRoomFromDisk(slug)) registry.syncRoomFromComments(slug, parsed);
        if (file) ctx.bus.emit('comments', { file, comments: parsed });
      } else if (ownsRoomFromDisk(slug)) {
        const text = readFileSync(abs, 'utf8');
        // The room's own projection coming back: the room is at or AHEAD of
        // it (an op may have landed since), so re-seeding from it would revert
        // that op. Consumed once, so a later external write of the same bytes
        // still re-seeds.
        const own = ownProjections.get(slug);
        const at = own ? own.indexOf(canonicalAnnotations(text) ?? '') : -1;
        if (own && at >= 0) {
          own.splice(0, at + 1);
          return;
        }
        const next = canonicalAnnotations(text);
        const base = diskBase.get(slug);
        if (next !== null && base !== undefined) {
          const toMap = (t: string) => new Map(parseBoard(t).elements.map((e) => [e.id, e]));
          const ops = diffToOps(toMap(base), toMap(next));
          diskBase.set(slug, next);
          if (!ops.length) return;
          const applied = registry.applyOpsToRoom(slug, ops);
          if (applied !== null && applied !== 'too-large') return;
        }
        if (next !== null) diskBase.set(slug, next);
        registry.syncRoomFromAnnotations(slug, text);
      }
    } catch {
      /* file vanished mid-flight or unreadable — leave state as-is */
    }
  };
  const unsubFs = ctx.bus.on('fs:any', (rel: string) => {
    void reseedFromDisk(rel);
  });

  return {
    registry,
    dispose() {
      unsubFs?.();
    },
  };
}
