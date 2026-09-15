// Public surface of the collab module. Bundles the registry + persistence
// wiring so ws.ts + server.ts don't need to know about the internal split.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Api } from '../api.ts';
import type { Context } from '../context.ts';

import { createPersistence, Y_TYPES } from './persistence.ts';
import { createRegistry, type Registry } from './registry.ts';

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
  const persistence = createPersistence({
    ctx,
    api,
    fileForSlug,
    shouldSeed: (slug) => !(ctx.sharedDoc && registryRef?.isPinned(slug)),
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
  const reseedFromDisk = async (rel: string): Promise<void> => {
    const cm = /^_comments\/(.+)\.json$/.exec(rel);
    const am = /^(.+)\.annotations\.svg$/.exec(rel);
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
        // Phase 9.2 (DDR-064): under sharedDoc the hub provider is attached to
        // the single room doc, so a hub-pushed comment is ALREADY in the room —
        // the wholesale re-seed (last-writer-wins blob copy) is the retired
        // clobber path. The agent's diff-aware applyFromFs handles external
        // file→doc imports instead. The sidebar still needs the 'comments' bus
        // emit, so keep that unconditionally.
        if (!ctx.sharedDoc && registry.peek(slug)) registry.syncRoomFromComments(slug, parsed);
        if (file) ctx.bus.emit('comments', { file, comments: parsed });
      } else if (!ctx.sharedDoc && registry.peek(slug)) {
        registry.syncRoomFromAnnotations(slug, readFileSync(abs, 'utf8'));
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
