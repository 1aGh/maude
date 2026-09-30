// Issue #111 — a second comment must not disappear a few seconds after it is
// added.
//
// The reporter's project was linked to a custom hub with shared-doc on. Adding
// a comment worked; a moment later it was gone and only the first one was left.
// Two halves, both pinned here:
//
//   1. ORDER (`publishComments`, api.ts). A mutation used to write
//      `_comments/<slug>.json` and only THEN, across a disk re-read in a call
//      nobody awaited, publish the list into the room's Y.Doc. `Room.flush()`
//      projects doc→file on an 800 ms trailing debounce that ANY doc update
//      re-arms — hub traffic included — so on a linked project a flush is
//      practically always pending, and that gap is a window in which it writes
//      the PRE-mutation doc back over the file. The fix is not a narrower
//      window: the doc is published FIRST and both halves are awaited, so a
//      flush firing at any point carries a doc that already holds the comment.
//
//   2. FRESHNESS (`persistJson`, collab/persistence.ts). Even with the order
//      right, an external write to the comments file (`/design:edit` resolves
//      by rewriting it — issue #74) can still put disk ahead of the doc. The
//      projection now refuses to drop an id the doc has NEVER carried, while
//      still materializing a genuine delete — an id the doc held and dropped.
//      That distinction is the whole guard, and it needs no wire-format change.
//
// The sibling file `comments-duplication.test.ts` covers the OTHER failure of
// this lane (#112, the same comment 1 → 2 → 4 → 8). Loss and duplication are
// separate defects with separate mechanisms; both are cheap to re-introduce.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';

import { writeReplica } from '../annotations/replica.ts';
import { parseBoard } from '../annotations/schema.ts';
import { type Comment, createApi } from '../api.ts';
import { createPersistence, Y_TYPES } from '../collab/persistence.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';
import { board, sticky } from './fixtures/annotations-v2/boards.ts';

function mkCtx(root: string, designRoot: string): Context {
  return {
    cfg: {} as Context['cfg'],
    projectLabel: 'test',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
}

const FILE = '.design/ui/Foo.tsx';
const SLUG = 'ui-foo';

function comment(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    file: FILE,
    selector: 'main',
    index: undefined,
    dom_path: ['main'],
    tag: 'main',
    classes: '',
    bounds: null,
    html_excerpt: '',
    text: `comment ${id}`,
    status: 'open',
    created: '2026-01-01T00:00:00.000Z',
    resolved_at: null,
    author: 'Test User',
    thread: [],
    mentions: [],
    ...over,
  };
}

type PublishHook = (file: string, comments: Comment[]) => void | Promise<void>;

/**
 * A sandbox with one canvas and, optionally, an existing comments file.
 *
 * `hook` is injectable because the ORDER of the two writes is the thing under
 * test — the hook is the doc half, and it has to be able to observe the disk
 * half's state at the moment it runs.
 */
function rig(list: unknown[] | null, hook: PublishHook = () => {}) {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'Foo.tsx'), 'export default function P(){return <main/>}\n');
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  const commentsFile = join(designRoot, '_comments', `${SLUG}.json`);
  if (list !== null) writeFileSync(commentsFile, JSON.stringify(list, null, 2));
  const ctx = mkCtx(root, designRoot);
  const api = createApi(ctx, { onCommentsChanged: hook });
  const onDisk = (): { id: string; status?: string }[] =>
    existsSync(commentsFile) ? JSON.parse(readFileSync(commentsFile, 'utf8')) : [];
  return { root, designRoot, ctx, api, commentsFile, onDisk };
}

describe('issue #111 — a mutation reaches the shared doc BEFORE disk', () => {
  test('the doc publish runs before the comments file is written', async () => {
    // The regression proper. If the hook can already see the new comment on
    // disk, the file was written first and the flush window is back.
    let diskAtPublish: unknown[] | null = null;
    const r = rig(null, (_file, comments) => {
      diskAtPublish = r.onDisk();
      expect(comments).toHaveLength(1); // the doc gets the full post-mutation list
    });
    await r.api.commentsAdd({ file: FILE, text: 'first' });

    expect(diskAtPublish).toEqual([]); // nothing on disk yet — doc went first
    expect(r.onDisk()).toHaveLength(1); // …and disk caught up before we returned
  });

  test('an async hook is awaited — the mutation cannot resolve ahead of the doc', async () => {
    // `onCommentsChanged` used to be fire-and-forget, so `commentsAdd` could
    // return (and the HTTP response go out) reporting a comment the doc had
    // not received. A slow doc publish must hold the mutation open.
    let published = false;
    const r = rig(null, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      published = true;
    });
    await r.api.commentsAdd({ file: FILE, text: 'first' });
    expect(published).toBe(true);
  });

  test('every mutation publishes, not just add', async () => {
    const seen: { file: string; ids: string[] }[] = [];
    const r = rig([comment('c1')], (file, comments) => {
      seen.push({ file, ids: comments.map((c) => c.id) });
    });
    await r.api.commentsAdd({ file: FILE, text: 'second' });
    await r.api.commentsAddReply('c1', { body: 'reply' });
    await r.api.commentsPatch('c1', { status: 'resolved' });
    await r.api.commentsDelete('c1');

    expect(seen).toHaveLength(4);
    expect(seen.every((s) => s.file === FILE)).toBe(true);
    expect(seen[3]?.ids).not.toContain('c1'); // the delete published the shorter list
  });

  test('the doc and the file are handed the SAME (deduped) list', async () => {
    // Otherwise the file→doc import that follows the write sees a difference
    // and re-enters the loop — the churn #112 turns into duplication.
    let publishedIds: string[] = [];
    const r = rig([comment('c1'), comment('c1')], (_file, comments) => {
      publishedIds = comments.map((c) => c.id);
    });
    await r.api.commentsAdd({ file: FILE, text: 'second' });
    expect(publishedIds).toEqual(r.onDisk().map((c) => c.id));
    expect(publishedIds.filter((id) => id === 'c1')).toHaveLength(1);
  });
});

describe('issue #111 — persistJson never projects a doc that is behind the file', () => {
  /** Wire a persistence over `rig`'s api, pinned to the one canvas. */
  function persistenceFor(r: ReturnType<typeof rig>, shouldSeed?: () => boolean) {
    return createPersistence({
      ctx: r.ctx,
      api: r.api,
      fileForSlug: async () => FILE,
      ...(shouldSeed ? { shouldSeed } : {}),
    });
  }

  test('a comment the doc has never carried survives a flush', async () => {
    // The reporter's exact state, reproduced at the seam: disk holds two
    // comments, the room doc still holds one, and the room flushes. The old
    // projection wrote `[c1]` over `[c1, c2]` and c2 was gone for good.
    const r = rig([comment('c1'), comment('c2')]);
    const persistence = persistenceFor(r);
    const doc = new Y.Doc();
    doc.getArray(Y_TYPES.comments).push([comment('c1')]);

    await persistence.persistJson(SLUG, doc);

    expect(r.onDisk().map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  test('a genuine delete still materializes', async () => {
    // The other side of the guard, and the reason it is keyed on "has the doc
    // EVER held this id" rather than a plain subset check: a delete-all on one
    // peer must reach every peer's JSON file, which is what the `seenComments`
    // latch was added for. Deferring that would be a different bug.
    const r = rig([comment('c1'), comment('c2')]);
    const persistence = persistenceFor(r);
    const doc = new Y.Doc();
    const arr = doc.getArray(Y_TYPES.comments);

    arr.push([comment('c1'), comment('c2')]);
    await persistence.persistJson(SLUG, doc); // doc has now SEEN both
    arr.delete(1, 1); // c2 deleted, on this peer or a remote one
    await persistence.persistJson(SLUG, doc);

    expect(r.onDisk().map((c) => c.id)).toEqual(['c1']);
  });

  test('a delete that arrives before the FIRST flush still materializes', async () => {
    // The guard is keyed on "has this doc ever held the id", and sampling that
    // only when a flush happens to run is not enough: every doc update re-arms
    // the 800 ms debounce, so an add and a remote delete inside one window is
    // the common shape. Without the observer the surviving disk copy reads as
    // "never seen", the projection defers, and the delete never lands.
    const r = rig(null);
    const persistence = persistenceFor(r);
    const doc = new Y.Doc();
    const arr = doc.getArray(Y_TYPES.comments);

    await persistence.seed(SLUG, doc); // the room mounts and starts observing
    arr.push([comment('c1')]); // the doc half of a local add…
    await r.api.saveCommentsForFile(FILE, [comment('c1')] as never); // …and the disk half
    arr.delete(0, 1); // remote delete, inside the same debounce window
    await persistence.persistJson(SLUG, doc); // the FIRST flush this doc gets

    expect(r.onDisk()).toEqual([]);
  });

  test('a delete-all still empties the file', async () => {
    const r = rig([comment('c1')]);
    const persistence = persistenceFor(r);
    const doc = new Y.Doc();
    const arr = doc.getArray(Y_TYPES.comments);

    arr.push([comment('c1')]);
    await persistence.persistJson(SLUG, doc);
    arr.delete(0, 1);
    await persistence.persistJson(SLUG, doc);

    expect(r.onDisk()).toEqual([]);
  });

  test('a hub-pushed comment still lands on a peer that has none', async () => {
    // The receiving-peer path (DDR-064): the doc is AHEAD, not behind, so the
    // guard must not fire. A file that does not exist yet is not "ahead".
    const r = rig(null);
    const persistence = persistenceFor(r);
    const doc = new Y.Doc();
    doc.getArray(Y_TYPES.comments).push([comment('c1')]);

    await persistence.persistJson(SLUG, doc);

    expect(r.onDisk().map((c) => c.id)).toEqual(['c1']);
  });

  test('a value change the doc owns still overwrites the file', async () => {
    // Deferring is scoped to UNSEEN identities. A remote resolve of a comment
    // both sides hold has to reach disk, or the sidebar never updates.
    const r = rig([comment('c1', { status: 'open' })]);
    const persistence = persistenceFor(r);
    const doc = new Y.Doc();
    doc.getArray(Y_TYPES.comments).push([comment('c1', { status: 'resolved' })]);

    await persistence.persistJson(SLUG, doc);

    expect(r.onDisk()[0]?.status).toBe('resolved');
  });

  test('the deferral clears once the doc catches up', async () => {
    // Deferring must not be a dead end: whatever brings the id into the doc is
    // itself a doc update, which re-arms the flush. The next pass writes.
    const r = rig([comment('c1'), comment('c2')]);
    const persistence = persistenceFor(r);
    const doc = new Y.Doc();
    const arr = doc.getArray(Y_TYPES.comments);
    arr.push([comment('c1')]);

    await persistence.persistJson(SLUG, doc); // deferred
    expect(r.onDisk()).toHaveLength(2);

    arr.push([comment('c2')]); // the file→doc import lands
    arr.push([comment('c3')]); // …plus something new from the hub
    await persistence.persistJson(SLUG, doc);

    expect(r.onDisk().map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  test('the identity set carries over when a slug is rebuilt on a fresh doc', async () => {
    // A room dropped when its last browser leaves comes back on a NEW Y.Doc.
    // What this peer has seen is a property of the peer, not of the doc object —
    // if it reset, the first flush after a reopen would read every id on disk as
    // "never seen" and defer forever, and a delete could never materialize.
    // Pinned, i.e. shared-doc with a hub provider attached: the room's local
    // file-seed is off (DDR-064 Risk 1), so a rebuilt room starts EMPTY and
    // nothing but the carried-over set can tell a delete from a cold start.
    const r = rig(null);
    const persistence = persistenceFor(r, () => false);

    const first = new Y.Doc();
    await persistence.seed(SLUG, first);
    first.getArray(Y_TYPES.comments).push([comment('c1')]);
    await persistence.persistJson(SLUG, first);
    expect(r.onDisk().map((c) => c.id)).toEqual(['c1']);

    // The room is rebuilt empty (a fresh doc, hub state not yet arrived) and the
    // comment is deleted remotely. The delete must still reach disk.
    const second = new Y.Doc();
    await persistence.seed(SLUG, second);
    await persistence.persistJson(SLUG, second);

    expect(r.onDisk()).toEqual([]);
  });

  test('the identity set is bounded, and overflowing it defers rather than deletes', async () => {
    // The doc is populated by the hub, so this set is peer-supplied and grows
    // without a cap unless one is imposed (DDR-054 §2d). Eviction is oldest
    // first, and the point of this test is the DIRECTION it degrades in: an
    // evicted id reads as "never seen", which defers the write. It must never
    // read as a delete.
    const overflow = Array.from({ length: 10_050 }, (_, i) => comment(`c${i}`));
    const r = rig([comment('c0')]); // the oldest id, still on disk
    const persistence = persistenceFor(r);
    const doc = new Y.Doc();
    await persistence.seed(SLUG, doc);
    doc.transact(() => {
      doc.getArray(Y_TYPES.comments).push(overflow.slice(1)); // everything BUT c0
    });

    await persistence.persistJson(SLUG, doc);

    // c0 was evicted from the set, so the projection cannot prove the doc is
    // ahead of the file — it leaves the file alone instead of dropping c0.
    expect(r.onDisk().map((c) => c.id)).toContain('c0');
  });

  test('annotations still persist while the comments half is deferred', async () => {
    // The two lanes share `persistJson` but not a fate — an early return would
    // have silently taken the annotations write with it.
    const r = rig([comment('c1'), comment('c2')]);
    const persistence = persistenceFor(r);
    const doc = new Y.Doc();
    doc.getArray(Y_TYPES.comments).push([comment('c1')]);
    const b = board(sticky('s1', 'kept'));
    writeReplica(doc, parseBoard(b).elements, 'test');

    await persistence.persistJson(SLUG, doc);

    expect(r.onDisk()).toHaveLength(2); // comments deferred
    expect(await r.api.loadAnnotations(FILE)).toBe(b); // annotations wrote
  });
});
