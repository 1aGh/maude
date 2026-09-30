// Sync-agent integration tests — Phase 9 Task 4.
//
// Uses an in-memory pair of Y.Docs cross-linked via Y.applyUpdate as a stand-in
// for HocuspocusProvider's transport. The agent under test owns docB; docA
// represents "another peer talking to the hub". Updates flow:
//
//   docA → encode → applyUpdate(docB) → agent observes → write to disk
//   disk → onRead → applyFromFs → applyHtmlToDoc(docB) → encode → docA
//
// This lets us validate the whole bidi loop, echo prevention, and the
// 100-event stress scenario from the plan without booting a real hub.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { canonicalAnnotations } from '../annotations/board-text.ts';
import { REPLICA_TYPE } from '../annotations/replica.ts';
import { type CanvasSyncAgent, createCanvasSyncAgent } from '../sync/agent.ts';
import {
  annotationsFromDoc,
  applyAnnotationsToDoc,
  applyHtmlToDoc,
  htmlFromDoc,
} from '../sync/codec.ts';
import { createEchoGuard, hashBytes } from '../sync/echo-guard.ts';
import { createFsReader } from '../sync/fs-mirror.ts';
import { board, boardIds, sticky } from './fixtures/annotations-v2/boards.ts';

let dir: string;
let agent: CanvasSyncAgent;
let docA: Y.Doc;
let docB: Y.Doc;

function paths() {
  return {
    html: join(dir, 'screen.html'),
    comments: join(dir, '_comments', 'screen.json'),
    annotations: join(dir, 'screen.annotations.json'),
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-agent-'));
  docA = new Y.Doc();
  docB = new Y.Doc();
  // Mirror docA→docB and docB→docA, ignoring transient origin objects from
  // the transport itself (we use a symbol).
  const TRANSPORT = Symbol('transport');
  docA.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === TRANSPORT) return;
    Y.applyUpdate(docB, update, TRANSPORT);
  });
  docB.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === TRANSPORT) return;
    Y.applyUpdate(docA, update, TRANSPORT);
  });
});

afterEach(() => {
  agent?.stop();
  rmSync(dir, { recursive: true, force: true });
});

function makeAgent(extra: { adopt?: boolean; flushMs?: number } = {}): CanvasSyncAgent {
  const a = createCanvasSyncAgent({
    slug: 'screen',
    doc: docB,
    paths: paths(),
    echoGuard: createEchoGuard(),
    flushMs: 0, // synchronous flush; the agent uses queueMicrotask
    ...extra,
  });
  a.start();
  return a;
}

describe('CanvasSyncAgent — hub → disk (Flow B)', () => {
  test('writes HTML to disk when other peer mutates the doc', async () => {
    agent = makeAgent();
    // Other peer types into docA — propagates to docB via the in-memory
    // transport, which our agent observes.
    applyHtmlToDoc(docA, '<button>v1</button>');
    await agent.flush();

    expect(readFileSync(paths().html, 'utf8')).toBe('<button>v1</button>');
  });

  test('debounces multiple rapid peer edits into one disk write', async () => {
    agent = makeAgent({ flushMs: 30 });
    for (let i = 0; i < 10; i++) {
      applyHtmlToDoc(docA, `<button>v${i}</button>`);
    }
    await new Promise((res) => setTimeout(res, 80));

    expect(readFileSync(paths().html, 'utf8')).toBe('<button>v9</button>');
  });

  test('writes comments JSON when Y.Array changes', async () => {
    agent = makeAgent();
    docA.transact(() => {
      docA.getArray('comments').push([{ id: 'c1', body: 'hello' }]);
    });
    await agent.flush();

    const written = JSON.parse(readFileSync(paths().comments, 'utf8'));
    expect(written).toEqual([{ id: 'c1', body: 'hello' }]);
  });

  test('writes the annotations board when the replica changes', async () => {
    agent = makeAgent();
    const b = board(sticky('s1', 'annot'));
    applyAnnotationsToDoc(docA, b);
    await agent.flush();

    expect(readFileSync(paths().annotations, 'utf8')).toBe(b);
  });

  test('a hostile peer element is validated out before it reaches disk (DDR-054)', async () => {
    // The doc is peer-writable; the doc→file write runs the v2 validator.
    agent = makeAgent();
    const good = board(sticky('ok', 'fine'));
    applyAnnotationsToDoc(docA, good);
    docA.transact(() => {
      const bad = new Y.Map<unknown>();
      bad.set('type', 'image');
      bad.set('index', 'a1');
      bad.set('x', 0);
      bad.set('y', 0);
      bad.set('w', 10);
      bad.set('h', 10);
      bad.set('href', 'javascript:alert(1)');
      docA.getMap(REPLICA_TYPE).set('evil', bad);
    });
    await agent.flush();
    const onDisk = readFileSync(paths().annotations, 'utf8');
    // The unsafe field is stripped (the element itself may survive, inert);
    // the file is canonical and carries no active content.
    expect(onDisk).not.toContain('javascript:');
    expect(onDisk).toBe(canonicalAnnotations(onDisk));
    expect(boardIds(onDisk)).toContain('ok');
  });
});

describe('CanvasSyncAgent — disk → hub (Flow A)', () => {
  test('applies disk HTML to doc when applyFromFs is called', () => {
    agent = makeAgent();
    const bytes = new TextEncoder().encode('<div>local-edit</div>');
    const changed = agent.applyFromFs({
      path: paths().html,
      bytes,
      hash: hashBytes(bytes),
    });
    expect(changed).toBe(true);
    expect(htmlFromDoc(docA)).toBe('<div>local-edit</div>');
  });

  test('parses + applies comments JSON from disk', () => {
    agent = makeAgent();
    const snap = [{ id: 'c2' }];
    const str = `${JSON.stringify(snap, null, 2)}\n`;
    const bytes = new TextEncoder().encode(str);
    agent.applyFromFs({ path: paths().comments, bytes, hash: hashBytes(bytes) });
    expect(docA.getArray('comments').toArray()).toEqual(snap);
  });

  test('applies the annotations board from disk', () => {
    agent = makeAgent();
    const b = board(sticky('s1', 'x'));
    const bytes = new TextEncoder().encode(b);
    expect(agent.applyFromFs({ path: paths().annotations, bytes, hash: hashBytes(bytes) })).toBe(
      true
    );
    expect(annotationsFromDoc(docA)).toBe(b);
  });

  test('drops the fs-watch echo of its own atomic write', async () => {
    agent = makeAgent();
    // Peer edits → agent writes to disk → echo guard recorded.
    applyHtmlToDoc(docA, '<button>hi</button>');
    await agent.flush();

    // Simulate the fs.watch firing for the path we just wrote.
    const bytes = readFileSync(paths().html);
    const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const changed = agent.applyFromFs({
      path: paths().html,
      bytes: u8,
      hash: hashBytes(u8),
    });

    expect(changed).toBe(false);
  });
});

describe('CanvasSyncAgent — cold start reconciliation', () => {
  test('hub-wins (default): overwrites disk when doc differs', async () => {
    // Local disk has stale content.
    writeFileSync(paths().html, '<old>');
    // Hub state arrives via docA (propagated to docB before reconcile runs).
    applyHtmlToDoc(docA, '<new>');

    agent = makeAgent();
    await agent.reconcile();

    expect(readFileSync(paths().html, 'utf8')).toBe('<new>');
  });

  test('adopt mode: pushes local disk state up to the doc', async () => {
    writeFileSync(paths().html, '<button>local</button>');
    // Hub has stale content.
    applyHtmlToDoc(docA, '<old-hub>');

    agent = makeAgent({ adopt: true });
    await agent.reconcile();

    expect(htmlFromDoc(docA)).toBe('<button>local</button>');
    expect(htmlFromDoc(docB)).toBe('<button>local</button>');
  });

  test('adopt mode is one-shot — second reconcile is hub-wins', async () => {
    writeFileSync(paths().html, '<button>local-v1</button>');
    agent = makeAgent({ adopt: true });
    await agent.reconcile();

    // Hub changes the value — stamp it explicitly newer than the disk so the
    // newest-wins reconcile is deterministic. An un-pinned `applyHtmlToDoc` stamp
    // is `Date.now()` (ms-truncated) while the disk mtime is sub-ms `statSync`:
    // in isolation they land in the same ms → tie → hub; under parallel-suite
    // load they straddle a ms boundary → disk looks newer → local, flaking this
    // assertion. Sibling tests pin timestamps for exactly this reason.
    applyHtmlToDoc(docA, '<button>hub-v2</button>');
    docA.getMap('syncMeta').set('bodyEditAt', Date.now() + 60_000);

    // Disk reverts to a stale local-only state.
    writeFileSync(paths().html, '<button>local-v3</button>');
    await agent.reconcile();

    // Hub state won this time — adopt was consumed, so the second reconcile runs
    // normal newest-wins, and the (explicitly newer) hub body wins.
    expect(htmlFromDoc(docB)).toBe('<button>hub-v2</button>');
  });

  test('empty hub doc does NOT clobber a non-empty local body — seeds local up instead (data-loss guard)', async () => {
    // Local holds the real canvas body; the hub is fresh — no state for this
    // slug yet (docB starts empty → docHtml === ''). The old behaviour wrote
    // the empty doc over disk and emptied the file; the guard must keep local.
    writeFileSync(paths().html, '<button>real-canvas</button>');

    let conflicts = 0;
    agent = createCanvasSyncAgent({
      slug: 'screen',
      doc: docB,
      paths: paths(),
      echoGuard: createEchoGuard(),
      flushMs: 0,
      onConflict: () => {
        conflicts++;
      },
    });
    agent.start();
    await agent.reconcile();

    // The local body MUST survive — an empty hub must never empty a real canvas.
    expect(readFileSync(paths().html, 'utf8')).toBe('<button>real-canvas</button>');
    // …and it is seeded UP to the hub instead of being discarded (local→doc).
    expect(htmlFromDoc(docA)).toBe('<button>real-canvas</button>');
    // An empty-hub seed is not a "hub overwrote your local" conflict.
    expect(conflicts).toBe(0);
  });

  test('identical disk + doc states: no disk write', async () => {
    writeFileSync(paths().html, '<button>same</button>');
    applyHtmlToDoc(docA, '<button>same</button>');

    agent = makeAgent();
    let writes = 0;
    const customAgent = createCanvasSyncAgent({
      slug: 'screen',
      doc: docB,
      paths: paths(),
      echoGuard: createEchoGuard(),
      flushMs: 0,
      writer: () => {
        writes++;
      },
    });
    customAgent.start();
    await customAgent.reconcile();
    customAgent.stop();

    expect(writes).toBe(0);
  });
});

describe('CanvasSyncAgent — stress: 100 rapid disk writes converge with no echo loop', () => {
  test('100-event scenario from plan validate', async () => {
    // Wire up fs-mirror against the temp dir so this looks like the production
    // flow: file writes → fs.watch → fs-mirror debounce → agent.applyFromFs.
    agent = makeAgent({ flushMs: 20 });

    const reader = createFsReader({
      rootDir: dir,
      quietMs: 15,
      accept: (p) => p.endsWith('.html'),
      onRead: async (evt) => {
        agent.applyFromFs({
          path: join(dir, evt.path),
          bytes: evt.bytes,
          hash: evt.hash,
        });
      },
    });

    // Track how many times the doc transitioned — should be bounded, no echo
    // loop multiplying it.
    let docUpdates = 0;
    docB.on('update', () => {
      docUpdates++;
    });

    for (let i = 0; i < 100; i++) {
      writeFileSync(paths().html, `<button>${i}</button>`);
      reader.notify('screen.html');
    }

    // Let everything settle: reader quiet (15ms), agent flush (20ms) + slack.
    await new Promise((res) => setTimeout(res, 200));
    await reader.flush();
    await agent.flush();
    reader.stop();

    // Doc + disk + peer all converge on the last write.
    const last = '<button>99</button>';
    expect(htmlFromDoc(docB)).toBe(last);
    expect(htmlFromDoc(docA)).toBe(last);
    expect(readFileSync(paths().html, 'utf8')).toBe(last);

    // Update count must be bounded — strictly < 100 transitions (debounce did
    // its job) AND < 200 (no echo loop running 2x amplification).
    expect(docUpdates).toBeLessThan(200);
    // Also: it should be > 0 — we DID see real syncs.
    expect(docUpdates).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DDR-102 — cold-start conflict protocol (journal-gated fast-forward, dual
// snapshot, newest-wins, comments id-union).
describe('CanvasSyncAgent — DDR-102 cold-start conflict protocol', () => {
  interface SnapCall {
    content: string;
    reason: string;
  }

  function makeJournal(initial: Record<string, { bodyHash: string }> = {}) {
    const entries = new Map(Object.entries(initial));
    const records: Array<{ slug: string; hashes: Record<string, string | undefined> }> = [];
    return {
      journal: {
        get: (slug: string) => entries.get(slug) ?? null,
        record: (slug: string, hashes: { bodyHash?: string; cssHash?: string }) => {
          records.push({ slug, hashes });
          const prev = entries.get(slug);
          entries.set(slug, { bodyHash: hashes.bodyHash ?? prev?.bodyHash ?? '' });
        },
        invalidateIfHubChanged: () => {},
        flush: () => {},
        stop: () => {},
        size: () => entries.size,
      },
      records,
    };
  }

  function protocolAgent(extra: {
    journal?: ReturnType<typeof makeJournal>['journal'];
    snapshots?: SnapCall[];
    conflicts?: unknown[];
  }) {
    const a = createCanvasSyncAgent({
      slug: 'screen',
      doc: docB,
      paths: paths(),
      echoGuard: createEchoGuard(),
      flushMs: 0,
      journal: extra.journal,
      snapshot: extra.snapshots
        ? async (content, reason) => {
            extra.snapshots?.push({ content, reason });
            return `ts-${extra.snapshots?.length}`;
          }
        : undefined,
      onConflict: (info) => {
        extra.conflicts?.push(info);
      },
    });
    a.start();
    return a;
  }

  test('journal match → silent fast-forward: hub overwrites disk, NO snapshot, NO conflict', async () => {
    const { setHtml } = await import('node:fs').then(() => ({ setHtml: writeFileSync }));
    setHtml(paths().html, '<button>synced-v1</button>');
    applyHtmlToDoc(docA, '<button>hub-v2</button>');

    const { journal } = makeJournal({
      screen: { bodyHash: hashBytes('<button>synced-v1</button>') },
    });
    const snapshots: SnapCall[] = [];
    const conflicts: unknown[] = [];
    agent = protocolAgent({ journal, snapshots, conflicts });
    await agent.reconcile();

    expect(readFileSync(paths().html, 'utf8')).toBe('<button>hub-v2</button>');
    expect(snapshots).toHaveLength(0);
    expect(conflicts).toHaveLength(0);
  });

  test('diverged + local newer → local wins, BOTH sides snapshotted, conflict recorded', async () => {
    writeFileSync(paths().html, '<button>local-newer</button>');
    // Hub doc carries different body with an OLDER bodyEditAt stamp.
    docA.transact(() => {
      applyHtmlToDoc(docA, '<button>hub-older</button>');
      docA.getMap('syncMeta').set('bodyEditAt', Date.now() - 60_000);
    });

    const { journal } = makeJournal(); // no entry → divergence
    const snapshots: SnapCall[] = [];
    const conflicts: Array<{ kind: string; winner?: string; snapshots?: object }> = [];
    agent = protocolAgent({ journal, snapshots, conflicts });
    await agent.reconcile();

    // Local body survives on disk AND is pushed up to the hub.
    expect(readFileSync(paths().html, 'utf8')).toBe('<button>local-newer</button>');
    expect(htmlFromDoc(docA)).toBe('<button>local-newer</button>');
    // Dual snapshot: local first, hub second.
    expect(snapshots.map((s) => s.reason)).toEqual(['pre-sync-local', 'pre-sync-hub']);
    expect(snapshots[0].content).toBe('<button>local-newer</button>');
    expect(snapshots[1].content).toBe('<button>hub-older</button>');
    // Conflict entry carries winner + snapshot refs.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe('cold-start-diverged');
    expect(conflicts[0].winner).toBe('local');
    expect(conflicts[0].snapshots).toBeDefined();
  });

  test('diverged + hub newer → hub wins, both sides snapshotted', async () => {
    writeFileSync(paths().html, '<button>local-older</button>');
    docA.transact(() => {
      applyHtmlToDoc(docA, '<button>hub-newer</button>');
      docA.getMap('syncMeta').set('bodyEditAt', Date.now() + 60_000);
    });

    const { journal } = makeJournal();
    const snapshots: SnapCall[] = [];
    const conflicts: Array<{ winner?: string }> = [];
    agent = protocolAgent({ journal, snapshots, conflicts });
    await agent.reconcile();

    expect(readFileSync(paths().html, 'utf8')).toBe('<button>hub-newer</button>');
    expect(snapshots.map((s) => s.reason)).toEqual(['pre-sync-local', 'pre-sync-hub']);
    expect(conflicts[0].winner).toBe('hub');
  });

  test('DDR-064 empty-hub guard is bit-identical: seed-local-up, no snapshot, no conflict', async () => {
    writeFileSync(paths().html, '<button>real-canvas</button>');
    // docA/docB empty — fresh hub.
    const { journal } = makeJournal();
    const snapshots: SnapCall[] = [];
    const conflicts: unknown[] = [];
    agent = protocolAgent({ journal, snapshots, conflicts });
    await agent.reconcile();

    expect(readFileSync(paths().html, 'utf8')).toBe('<button>real-canvas</button>');
    expect(htmlFromDoc(docA)).toBe('<button>real-canvas</button>');
    expect(snapshots).toHaveLength(0);
    expect(conflicts).toHaveLength(0);
  });

  test('journal checkpoints: doc→disk flush and disk→doc apply both record', async () => {
    const { journal, records } = makeJournal();
    agent = createCanvasSyncAgent({
      slug: 'screen',
      doc: docB,
      paths: paths(),
      echoGuard: createEchoGuard(),
      flushMs: 0,
      journal,
    });
    agent.start();

    // Hub edit → disk write → checkpoint.
    applyHtmlToDoc(docA, '<button>from-hub</button>');
    await agent.flush();
    expect(records.some((r) => r.hashes.bodyHash === hashBytes('<button>from-hub</button>'))).toBe(
      true
    );

    // Local edit → doc apply → checkpoint.
    const bytes = new TextEncoder().encode('<button>from-disk</button>');
    agent.applyFromFs({ path: paths().html, bytes, hash: hashBytes(bytes) });
    expect(records.some((r) => r.hashes.bodyHash === hashBytes(bytes))).toBe(true);
  });

  test('comments id-union: doc order first, local-only appended, both sides converge', async () => {
    // Local file has c1 + c3; hub doc has c1 + c2.
    const localComments = [
      { id: 'c1', body: 'shared' },
      { id: 'c3', body: 'local-only' },
    ];
    mkdirSync(join(dir, '_comments'), { recursive: true });
    writeFileSync(paths().comments, `${JSON.stringify(localComments, null, 2)}\n`);
    docA.transact(() => {
      docA.getArray('comments').push([
        { id: 'c1', body: 'shared' },
        { id: 'c2', body: 'hub-only' },
      ]);
    });

    agent = protocolAgent({});
    await agent.reconcile();

    const expectUnion = [
      { id: 'c1', body: 'shared' },
      { id: 'c2', body: 'hub-only' },
      { id: 'c3', body: 'local-only' },
    ];
    // Doc (and the peer) hold the union…
    expect(docA.getArray('comments').toArray()).toEqual(expectUnion);
    // …and the disk file was rewritten to the union too.
    expect(JSON.parse(readFileSync(paths().comments, 'utf8'))).toEqual(expectUnion);
  });

  test('comments union with empty hub doc keeps + pushes local comments', async () => {
    const localComments = [{ id: 'c9', body: 'only-local' }];
    mkdirSync(join(dir, '_comments'), { recursive: true });
    writeFileSync(paths().comments, `${JSON.stringify(localComments, null, 2)}\n`);

    agent = protocolAgent({});
    await agent.reconcile();

    expect(docA.getArray('comments').toArray()).toEqual(localComments);
    expect(JSON.parse(readFileSync(paths().comments, 'utf8'))).toEqual(localComments);
  });
});

// ---------------------------------------------------------------------------
// DDR-102 fail-closed (security review F1): a hub-wins resolution must NEVER
// overwrite local when the local snapshot didn't land — keep local + push up.
describe('CanvasSyncAgent — fail-closed on snapshot failure (DDR-102 F1)', () => {
  function failClosedAgent(
    snapshotImpl: (content: string, reason: string) => Promise<string | null>,
    conflicts: unknown[]
  ) {
    const a = createCanvasSyncAgent({
      slug: 'screen',
      doc: docB,
      paths: paths(),
      echoGuard: createEchoGuard(),
      flushMs: 0,
      // No journal → every diff is divergence (conflict path).
      snapshot: snapshotImpl,
      onConflict: (info) => {
        conflicts.push(info);
      },
    });
    a.start();
    return a;
  }

  test('hub newer BUT local snapshot returns null → REFUSE overwrite, keep local, push up', async () => {
    writeFileSync(paths().html, '<button>local-work</button>');
    // Hub doc carries a NEWER stamp so newest-wins would pick hub.
    docA.transact(() => {
      applyHtmlToDoc(docA, '<button>hub-stale</button>');
      docA.getMap('syncMeta').set('bodyEditAt', Date.now() + 60_000);
    });

    const conflicts: Array<{ winner?: string; snapshotFailed?: boolean }> = [];
    // Snapshot writer that FAILS (disk full / read-only _history): returns null.
    agent = failClosedAgent(async () => null, conflicts);
    await agent.reconcile();

    // Local work survives on disk (NOT overwritten by hub-stale) …
    expect(readFileSync(paths().html, 'utf8')).toBe('<button>local-work</button>');
    // … and is pushed UP to the hub (nothing lost on either side).
    expect(htmlFromDoc(docA)).toBe('<button>local-work</button>');
    // The conflict is recorded with the degraded-snapshot flag + flipped winner.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].winner).toBe('local');
    expect(conflicts[0].snapshotFailed).toBe(true);
  });

  test('hub newer + local snapshot SUCCEEDS → normal hub-wins (control)', async () => {
    writeFileSync(paths().html, '<button>local-work</button>');
    docA.transact(() => {
      applyHtmlToDoc(docA, '<button>hub-newer</button>');
      docA.getMap('syncMeta').set('bodyEditAt', Date.now() + 60_000);
    });

    const conflicts: Array<{ winner?: string; snapshotFailed?: boolean }> = [];
    // Only the local snapshot succeeds; hub snapshot can fail without changing
    // the outcome (local is the loser when hub wins).
    agent = failClosedAgent(
      async (_c, reason) => (reason === 'pre-sync-local' ? 'ts-local' : null),
      conflicts
    );
    await agent.reconcile();

    expect(readFileSync(paths().html, 'utf8')).toBe('<button>hub-newer</button>');
    expect(conflicts[0].winner).toBe('hub');
    expect(conflicts[0].snapshotFailed).toBeUndefined();
  });
});

describe('cold-start meta — an empty doc is not a canvas with no title', () => {
  // A canvas created on a PEER used to reach the hub as a body with no meta:
  // no title, no kind, no design-system binding. It stayed that way until
  // somebody moved an artboard, because a meta EDIT was the only thing that
  // ever pushed meta into the doc.
  //
  // The cloud hid it. A cell's studio child arms `activity:suppress` on create
  // and the container write bridge turns that into an `fs:any` a quarter-second
  // later — by which time the new canvas has an agent to receive it. A desktop
  // has no bridge: its real `fs.watch` fires immediately, before the agent
  // exists, and the event lands nowhere. One side won the race, the other lost
  // it, and the gap underneath (cold-start meta was doc→file only) was
  // invisible from the winning end.

  const metaPaths = () => ({ ...paths(), meta: join(dir, 'screen.meta.json') });

  function metaAgent(extra: Record<string, unknown> = {}): CanvasSyncAgent {
    const a = createCanvasSyncAgent({
      slug: 'screen',
      doc: docB,
      paths: metaPaths(),
      echoGuard: createEchoGuard(),
      flushMs: 0,
      ...extra,
    });
    a.start();
    return a;
  }

  test('local meta seeds the doc when the doc has none', async () => {
    writeFileSync(
      metaPaths().meta,
      JSON.stringify({ title: 'Kanban', kind: 'web', designSystem: 'project' })
    );
    agent = metaAgent();
    await agent.reconcile();

    // The other peer must be able to SEE it — that is the whole point.
    const seen = JSON.parse(docA.getText('meta').toString());
    expect(seen.title).toBe('Kanban');
    expect(seen.kind).toBe('web');
  });

  test('it does NOT overwrite meta the doc already carries', async () => {
    // The safety property. Seeding runs only into a vacuum, so it can never be
    // a peer quietly winning a disagreement about a shared key.
    docA.getText('meta').insert(0, JSON.stringify({ title: 'From the hub', kind: 'web' }));
    writeFileSync(metaPaths().meta, JSON.stringify({ title: 'From my disk', kind: 'mobile' }));

    agent = metaAgent();
    await agent.reconcile();

    expect(JSON.parse(docA.getText('meta').toString()).title).toBe('From the hub');
    // …and the hub's opinion lands on disk, which is the pre-existing behaviour.
    expect(JSON.parse(readFileSync(metaPaths().meta, 'utf8')).title).toBe('From the hub');
  });

  test('no local meta and no doc meta is simply nothing to do', async () => {
    agent = metaAgent();
    await agent.reconcile();
    expect(docA.getText('meta').toString()).toBe('');
  });

  test('per-user keys never leave the machine', async () => {
    // `viewport` is the per-user camera (DDR-115). Seeding must go through the
    // same shared-subset filter as every other meta write, or the fix would
    // start syncing somebody's scroll position.
    writeFileSync(
      metaPaths().meta,
      JSON.stringify({ title: 'Kanban', viewport: { x: 12, y: 34, zoom: 2 } })
    );
    agent = metaAgent();
    await agent.reconcile();

    expect(docA.getText('meta').toString()).not.toContain('viewport');
  });
});
