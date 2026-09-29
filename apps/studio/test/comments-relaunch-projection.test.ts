// Issue #133 — a peer relaunched after a comment was deleted elsewhere.
//
// Measured end-to-end on shipped v1.4.5 (real hub + two studios,
// `.ai/plans/notes/multiplayer-parity-harness/v1.4.5-reverify/exp3-relaunch.mjs`):
//
//   - accepted mode: D closes; W deletes A and adds C; D relaunches. D's
//     `_comments` file stays [A,B] FOREVER — later comments (E) never land —
//     while W has [B,C,E]. The room projection reads A (on disk, never carried
//     by this process's doc) as a write still in flight and refuses every write.
//   - legacy mode: the relaunched peer's cold-start union re-adds A, so the
//     deleted comment comes back for everyone.
//
// Both need one fact that used to live only in memory: which ids were synced
// from this machine before. `sync/comment-ledger.ts` keeps it on disk.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';

import { createApi } from '../api.ts';
import { createPersistence, Y_TYPES } from '../collab/persistence.ts';
import { type Context, createBus } from '../context.ts';
import { createCanvasSyncAgent } from '../sync/agent.ts';
import { loadCommentLedger } from '../sync/comment-ledger.ts';
import { createEchoGuard } from '../sync/echo-guard.ts';
import { makeSandbox } from './_helpers.ts';

const FILE = '.design/ui/Foo.tsx';
const SLUG = 'ui-foo';

function comment(id: string) {
  return {
    id,
    file: FILE,
    selector: 'main',
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
  };
}

/** One project on disk; each `process()` is a fresh launch of the studio. */
function project() {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'Foo.tsx'), 'export default function P(){return <main/>}\n');
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  const commentsFile = join(designRoot, '_comments', `${SLUG}.json`);
  const ctx = {
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
  } as Context;
  const onDisk = (): string[] => {
    try {
      return (JSON.parse(readFileSync(commentsFile, 'utf8')) as { id: string }[]).map((c) => c.id);
    } catch {
      return [];
    }
  };
  function launch(commentsConfirmed?: (slug: string) => boolean) {
    // A NEW ledger instance per launch — what a process restart reads back.
    const commentLedger = loadCommentLedger(designRoot, { flushMs: 0 });
    const api = createApi(ctx, { onCommentsChanged: () => {} });
    return createPersistence({
      ctx,
      api,
      fileForSlug: async () => FILE,
      commentLedger,
      ...(commentsConfirmed ? { commentsConfirmed } : {}),
    });
  }
  return { designRoot, commentsFile, onDisk, launch };
}

describe('#133 — the room projection after a relaunch (accepted-mode freeze)', () => {
  test('a remote delete made while this peer was closed materializes, and new comments land', async () => {
    const p = project();

    // Session 1: the doc carries A and B; the projection writes them.
    const first = p.launch();
    const doc1 = new Y.Doc();
    doc1.getArray(Y_TYPES.comments).push([comment('A'), comment('B')]);
    await first.persistJson(SLUG, doc1);
    expect(p.onDisk()).toEqual(['A', 'B']);

    // Closed. Elsewhere, A is deleted and C added. Session 2 gets [B, C].
    const second = p.launch();
    const doc2 = new Y.Doc();
    const arr = doc2.getArray(Y_TYPES.comments);
    arr.push([comment('B'), comment('C')]);
    await second.persistJson(SLUG, doc2);
    expect(p.onDisk()).toEqual(['B', 'C']);

    arr.push([comment('D')]);
    await second.persistJson(SLUG, doc2);
    expect(p.onDisk()).toEqual(['B', 'C', 'D']);
  });

  test('a comment written to disk but never synced is still kept (the #111 direction)', async () => {
    const p = project();
    const first = p.launch();
    const doc1 = new Y.Doc();
    doc1.getArray(Y_TYPES.comments).push([comment('A')]);
    await first.persistJson(SLUG, doc1);

    // B reaches the file from outside (an external edit, a mutation whose
    // import has not landed) — it was never in any doc this machine synced.
    writeFileSync(p.commentsFile, JSON.stringify([comment('A'), comment('B')]));
    const second = p.launch();
    const doc2 = new Y.Doc();
    doc2.getArray(Y_TYPES.comments).push([comment('A')]);
    await second.persistJson(SLUG, doc2);
    expect(p.onDisk()).toEqual(['A', 'B']);
  });

  test('with no ledger at all (first launch after upgrade) nothing is deleted', async () => {
    const p = project();
    writeFileSync(p.commentsFile, JSON.stringify([comment('A'), comment('B')]));
    const only = p.launch();
    const doc = new Y.Doc();
    doc.getArray(Y_TYPES.comments).push([comment('B'), comment('C')]);
    await only.persistJson(SLUG, doc);
    expect(p.onDisk()).toEqual(['A', 'B']); // deferred — the safe direction
  });
});

describe('#133 — the legacy cold-start union after a relaunch (resurrection)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'comment-ledger-'));
    mkdirSync(join(dir, '_comments'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const paths = () => ({
    html: join(dir, 'screen.html'),
    comments: join(dir, '_comments', 'screen.json'),
    annotations: join(dir, 'screen.annotations.svg'),
  });

  async function relaunch(ledgerIds: string[] | null) {
    writeFileSync(paths().comments, JSON.stringify([comment('A'), comment('B')], null, 2));
    const ledger = loadCommentLedger(dir, { flushMs: 0 });
    if (ledgerIds) ledger.record('screen', ledgerIds);
    const doc = new Y.Doc();
    // The hub's document: A was deleted there while this peer was closed.
    doc.getArray('comments').push([comment('B'), comment('C')]);
    const agent = createCanvasSyncAgent({
      slug: 'screen',
      doc,
      paths: paths(),
      echoGuard: createEchoGuard(),
      flushMs: 0,
      commentLedger: ledger,
    });
    agent.start();
    await agent.reconcile();
    agent.stop();
    const ids = (doc.getArray('comments').toArray() as { id: string }[]).map((c) => c.id);
    const disk = (JSON.parse(readFileSync(paths().comments, 'utf8')) as { id: string }[]).map(
      (c) => c.id
    );
    return { ids, disk };
  }

  test('a comment synced before and deleted remotely does not come back', async () => {
    const { ids, disk } = await relaunch(['id:A', 'id:B']);
    expect(ids).toEqual(['B', 'C']);
    expect(disk).toEqual(['B', 'C']);
  });

  test('a local-only comment never synced from here is still unioned up', async () => {
    const { ids } = await relaunch(['id:B']);
    expect(ids).toEqual(['B', 'C', 'A']);
  });
});

describe('withoutRemotelyDeleted — the rule both cold-start unions share', () => {
  const c = (id: string) => ({ id });
  test('drops only ids synced before that the doc no longer holds', async () => {
    const { withoutRemotelyDeleted } = await import('../sync/comment-ledger.ts');
    const local = [c('A'), c('B'), c('X')];
    const doc = [c('B'), c('C')];
    const synced = new Set(['id:A', 'id:B']);
    expect(withoutRemotelyDeleted(local, doc, synced)).toEqual([c('B'), c('X')]);
    expect(withoutRemotelyDeleted(local, doc, new Set())).toEqual(local);
    expect(withoutRemotelyDeleted(local, doc, undefined)).toEqual(local);
  });
});

describe('#133(b) — a comment written before the sync runtime was up is proposed at cold start', () => {
  const c = (id: string) => ({ id, text: id });
  const json = (ids: string[]) => JSON.stringify(ids.map(c));

  test('a local comment never synced from here is owed to the project', async () => {
    const { commentsOwedToProject } = await import('../sync/accepted-cold-start.ts');
    const ledger = loadCommentLedger(mkdtempSync(join(tmpdir(), 'owed-')), { flushMs: 0 });
    ledger.record('s', ['id:A', 'id:B']);
    // disk: A, B, EARLY · accepted: A, B, C (C came from a peer)
    const owed = commentsOwedToProject(
      json(['A', 'B', 'EARLY']),
      json(['A', 'B', 'C']),
      's',
      ledger
    );
    expect(JSON.parse(owed ?? '[]').map((x: { id: string }) => x.id)).toEqual([
      'A',
      'B',
      'C',
      'EARLY',
    ]);
  });

  test('a comment deleted elsewhere is not owed — it is not proposed back', async () => {
    const { commentsOwedToProject } = await import('../sync/accepted-cold-start.ts');
    const ledger = loadCommentLedger(mkdtempSync(join(tmpdir(), 'owed-')), { flushMs: 0 });
    ledger.record('s', ['id:A', 'id:B']);
    expect(commentsOwedToProject(json(['A', 'B']), json(['B']), 's', ledger)).toBeNull();
  });

  test('without a ledger record for the canvas nothing is decided (upgrade)', async () => {
    const { commentsOwedToProject } = await import('../sync/accepted-cold-start.ts');
    const ledger = loadCommentLedger(mkdtempSync(join(tmpdir(), 'owed-')), { flushMs: 0 });
    expect(commentsOwedToProject(json(['A', 'EARLY']), json(['A']), 's', ledger)).toBeNull();
  });
});

describe('#133 Task 8 — a comment stuck on this disk is reported', () => {
  test('the log says how many are local-only, once per change, and when it clears', async () => {
    const p = project();
    writeFileSync(p.commentsFile, JSON.stringify([comment('A'), comment('LOCAL')]));
    const persistence = p.launch();
    const doc = new Y.Doc();
    const arr = doc.getArray(Y_TYPES.comments);
    arr.push([comment('A')]);
    const warn = console.warn;
    const log = console.log;
    const lines: string[] = [];
    console.warn = (...a: unknown[]) => lines.push(`W ${a.join(' ')}`);
    console.log = (...a: unknown[]) => lines.push(`L ${a.join(' ')}`);
    try {
      await persistence.persistJson(SLUG, doc);
      await persistence.persistJson(SLUG, doc); // same count — not repeated
      arr.push([comment('LOCAL')]); // it reached the document
      await persistence.persistJson(SLUG, doc);
    } finally {
      console.warn = warn;
      console.log = log;
    }
    const mine = lines.filter((l) => l.includes(`[collab/${SLUG}] comments:`));
    expect(mine).toHaveLength(2);
    expect(mine[0]).toContain('1 on this disk is not in the shared document yet');
    expect(mine[1]).toContain('in the shared document again');
  });
});

describe('#133 review — a comment the hub has not acknowledged is never "synced"', () => {
  test('added offline, quit before delivery, relaunch: the comment is kept, not taken for a delete', async () => {
    const p = project();
    // Session 1, offline: the doc holds A (synced long ago) and B (just added,
    // never delivered). The hub has not confirmed anything this session.
    const first = p.launch(() => false);
    const doc1 = new Y.Doc();
    doc1.getArray(Y_TYPES.comments).push([comment('A'), comment('B')]);
    await first.persistJson(SLUG, doc1);
    expect(p.onDisk()).toEqual(['A', 'B']);

    // Session 2, online: the hub's doc has only A. B must survive on disk
    // (deferred as in flight), never be projected away as a remote delete.
    const second = p.launch(() => true);
    const doc2 = new Y.Doc();
    doc2.getArray(Y_TYPES.comments).push([comment('A')]);
    await second.persistJson(SLUG, doc2);
    expect(p.onDisk()).toEqual(['A', 'B']);
  });
});

describe('#133 review — ledger identity and storage', () => {
  test('another workspace on the same hub URL starts from nothing (F1c)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-ws-'));
    const l = loadCommentLedger(dir, { flushMs: 0 });
    l.invalidateIfHubChanged('https://hub.example ws/one/main/_');
    l.record('s', ['id:A']);
    l.invalidateIfHubChanged('https://hub.example ws/one/main/_'); // same → kept
    expect(l.get('s').has('id:A')).toBe(true);
    l.invalidateIfHubChanged('https://hub.example ws/two/main/_');
    expect(l.get('s').has('id:A')).toBe(false);
    expect(l.known('s')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('keys are stored hashed — a peer-controlled comment body never lands in the file (F3)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-hash-'));
    const l = loadCommentLedger(dir, { flushMs: 0 });
    const idless = `json:${JSON.stringify({ text: 'x'.repeat(5000) })}`;
    l.record('s', ['id:A', idless]);
    const raw = readFileSync(join(dir, '_state', 'comment-ledger.json'), 'utf8');
    expect(raw).not.toContain('xxxxxxxx');
    expect(raw).not.toContain('id:A');
    expect(raw.length).toBeLessThan(400);
    // …and a fresh load still answers for the raw keys.
    const again = loadCommentLedger(dir, { flushMs: 0 });
    expect(again.get('s').has('id:A')).toBe(true);
    expect(again.get('s').has(idless)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
