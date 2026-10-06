// Unpaired-cell staleness — a room that no hub provider owns must follow disk.
//
// A cell without live pairing (MAUDE_CELL_PAIRING unset — the self-hosted
// StudyFi hub) runs the studio child with `sharedDoc` on by default but with NO
// provider attached to its rooms. The hub projects accepted comments/annotations
// onto disk; that disk write is the only way they reach the room. Two paths used
// to drop it:
//   1. the live fs:any re-seed was gated on `!ctx.sharedDoc` instead of "is a
//      provider attached", so a mounted room ignored every projection;
//   2. a room rebuilt later seeded from its own `.ydoc.bin` first and never
//      looked at the newer sidecar, so the stale board survived every reopen.
// Observed on design.studyfi.com 2026-09-14 → 09-17 (a whiteboard frozen at its
// first-open state while the hub document was byte-identical to the desktop).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as Y from 'yjs';
import { replicaBoardText, writeReplica } from '../annotations/replica.ts';
import { parseBoard } from '../annotations/schema.ts';
import type { Api } from '../api.ts';
import { createCollab } from '../collab/index.ts';
import { Y_TYPES } from '../collab/persistence.ts';
import type { RoomConn } from '../collab/room.ts';
import { type Context, createBus } from '../context.ts';
import { board, sticky } from './fixtures/annotations-v2/boards.ts';

const SLUG = 'ui-boards-team';
const FILE = 'ui/boards/Team.tsx';
// DDR-242 — canonical v2 boards (the sidecar is `<slug>.annotations.json`).
const OLD_SVG = board(sticky('old', 'first open'));
const NEW_SVG = board(
  sticky('old', 'first open'),
  sticky('new', 'projected', { x: 300, index: 'a1' })
);

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'unpaired-reseed-'));
  mkdirSync(path.join(root, '_comments'), { recursive: true });
  mkdirSync(path.join(root, '_state'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const annPath = () => path.join(root, `${SLUG}.annotations.json`);
const commentsPath = () => path.join(root, '_comments', `${SLUG}.json`);
const binPath = () => path.join(root, '_state', `${SLUG}.ydoc.bin`);

function harness() {
  const ctx = {
    sharedDoc: true,
    bus: createBus(),
    paths: { designRoot: root, commentsDir: path.join(root, '_comments') },
  } as unknown as Context;
  const read = async (p: string) => {
    const f = Bun.file(p);
    return (await f.exists()) ? f.text() : null;
  };
  const api = {
    fileForSlug: async (slug: string) => (slug === SLUG ? FILE : null),
    fileSlug: () => SLUG,
    loadAllComments: async () => ({}),
    loadAnnotations: async () => read(annPath()),
    loadCommentsForFile: async () => JSON.parse((await read(commentsPath())) ?? '[]'),
    saveAnnotations: async (_f: string, svg: string) => writeFileSync(annPath(), svg),
    saveCommentsForFile: async (_f: string, list: unknown[]) =>
      writeFileSync(commentsPath(), JSON.stringify(list)),
  } as unknown as Api;
  return { ctx, collab: createCollab(ctx, api) };
}

const conn = (): RoomConn => ({ id: 'peer', send() {} }) as unknown as RoomConn;
const svgOf = (doc: Y.Doc) => replicaBoardText(doc);

/** Write a `.ydoc.bin` whose replica holds `text`, stamped `ageMs` in the past. */
function writeCache(text: string, ageMs: number) {
  const doc = new Y.Doc();
  writeReplica(doc, parseBoard(text).elements, 'test');
  writeFileSync(binPath(), Y.encodeStateAsUpdate(doc));
  const t = (Date.now() - ageMs) / 1000;
  utimesSync(binPath(), t, t);
}

describe('live disk → room re-seed follows the pin, not ctx.sharedDoc', () => {
  test('an unpinned room under sharedDoc takes a projected annotation write', async () => {
    const { ctx, collab } = harness();
    writeFileSync(annPath(), OLD_SVG);
    const room = collab.registry.get(SLUG);
    await room.connect(conn());
    expect(svgOf(room.doc)).toBe(OLD_SVG);

    writeFileSync(annPath(), NEW_SVG);
    ctx.bus.emit('fs:any', `${SLUG}.annotations.json`);
    await Bun.sleep(20);
    expect(svgOf(room.doc)).toBe(NEW_SVG);
    collab.dispose();
  });

  test('an external write is merged as a change: a room edit not yet on disk survives it', async () => {
    // The multiplayer rig's L09 deletes: a peer's sync wrote a board that did
    // not know the room had just deleted an element; the full re-seed brought
    // it back. The external write's CHANGE (a new element) lands; the room's
    // own delete stays.
    const { ctx, collab } = harness();
    writeFileSync(annPath(), OLD_SVG);
    const room = collab.registry.get(SLUG);
    await room.connect(conn());
    collab.registry.applyOpsToRoom(SLUG, [{ op: 'delete', id: 'old' }]);
    expect(parseBoard(svgOf(room.doc) ?? '').elements.map((e) => e.id)).toEqual([]);

    writeFileSync(annPath(), NEW_SVG); // still has `old`, adds `new`
    ctx.bus.emit('fs:any', `${SLUG}.annotations.json`);
    await Bun.sleep(20);
    expect(parseBoard(svgOf(room.doc) ?? '').elements.map((e) => e.id)).toEqual(['new']);
    collab.dispose();
  });

  test('a legacy .annotations.svg reappearing on disk is NOT a board write', async () => {
    // DDR-242 AD6 — only the boot migration may import a v1 sidecar (and one
    // that reappears next to a .json is quarantined), never the live reseed.
    const { ctx, collab } = harness();
    writeFileSync(annPath(), OLD_SVG);
    const room = collab.registry.get(SLUG);
    await room.connect(conn());
    writeFileSync(
      path.join(root, `${SLUG}.annotations.svg`),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );
    ctx.bus.emit('fs:any', `${SLUG}.annotations.svg`);
    await Bun.sleep(20);
    expect(svgOf(room.doc)).toBe(OLD_SVG);
    collab.dispose();
  });

  test('an unpinned room under sharedDoc takes projected comments', async () => {
    const { ctx, collab } = harness();
    const room = collab.registry.get(SLUG);
    await room.connect(conn());
    writeFileSync(commentsPath(), JSON.stringify([{ id: 'c1', text: 'from hub' }]));
    ctx.bus.emit('fs:any', `_comments/${SLUG}.json`);
    await Bun.sleep(20);
    expect(room.doc.getArray(Y_TYPES.comments).toArray()).toEqual([{ id: 'c1', text: 'from hub' }]);
    collab.dispose();
  });

  test('a pinned room (hub provider attached) is left to the sync agent', async () => {
    const { ctx, collab } = harness();
    writeFileSync(annPath(), OLD_SVG);
    const room = collab.registry.get(SLUG);
    await room.connect(conn());
    collab.registry.pin(SLUG);

    writeFileSync(annPath(), NEW_SVG);
    ctx.bus.emit('fs:any', `${SLUG}.annotations.json`);
    writeFileSync(commentsPath(), JSON.stringify([{ id: 'c1', text: 'x' }]));
    ctx.bus.emit('fs:any', `_comments/${SLUG}.json`);
    await Bun.sleep(20);
    expect(svgOf(room.doc)).toBe(OLD_SVG);
    expect(room.doc.getArray(Y_TYPES.comments).length).toBe(0);
    collab.dispose();
  });
});

describe('cache restore does not outrank a newer sidecar', () => {
  test('a sidecar written after the .ydoc.bin wins on reopen', async () => {
    writeCache(OLD_SVG, 60_000);
    writeFileSync(annPath(), NEW_SVG);
    writeFileSync(commentsPath(), JSON.stringify([{ id: 'c9', text: 'projected' }]));
    const { collab } = harness();
    const room = collab.registry.get(SLUG);
    await room.connect(conn());
    expect(svgOf(room.doc)).toBe(NEW_SVG);
    expect(room.doc.getArray(Y_TYPES.comments).toArray()).toEqual([
      { id: 'c9', text: 'projected' },
    ]);
    collab.dispose();
  });

  test('the forward step is causal — a client holding the cached state converges on disk', async () => {
    // A browser tab that loaded the stale room keeps its doc across the room
    // rebuild and re-syncs it. The reconcile must be an update ON TOP of the
    // cached items, or concurrent sets of the same replica key would be
    // decided by clientID and the stale board could win back.
    writeCache(OLD_SVG, 60_000);
    const tab = new Y.Doc();
    Y.applyUpdate(tab, new Uint8Array(await Bun.file(binPath()).arrayBuffer()));
    writeFileSync(annPath(), NEW_SVG);

    const { collab } = harness();
    const room = collab.registry.get(SLUG);
    await room.connect(conn());
    Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(tab));
    Y.applyUpdate(tab, Y.encodeStateAsUpdate(room.doc));
    expect(svgOf(room.doc)).toBe(NEW_SVG);
    expect(svgOf(tab)).toBe(NEW_SVG);
    collab.dispose();
  });

  test('an older sidecar leaves the cached state alone', async () => {
    writeFileSync(annPath(), OLD_SVG);
    const t = (Date.now() - 120_000) / 1000;
    utimesSync(annPath(), t, t);
    writeCache(NEW_SVG, 60_000);
    const { collab } = harness();
    const room = collab.registry.get(SLUG);
    await room.connect(conn());
    expect(svgOf(room.doc)).toBe(NEW_SVG);
    collab.dispose();
  });
});
