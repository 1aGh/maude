// p8-hub-drafts — on a HUB-LINKED project one typing session on a sticky/label is ONE ⌘Z step
// (decision maude/v2-p8-hub-drafts-fold-not-hold). Drafts still go to the hub as they are typed
// (DDR-242 AD7: a teammate sees the words within ~1 s); every write of the session carries its id,
// the proposal's transaction id carries it to the history row, and the ⌘Z stack folds the session's
// rows into one entry that ⌘Z undoes with `actionIds` (one kernel action, judged by F12's chained
// check). A hub without multi-target undo (1.x, no `capabilities.undoTargets`) keeps today's
// one-draft-per-⌘Z.
//
//   pure   — the session ids; the reducer's fold (and its off switch); the ⌘Z label of a fold;
//            the shell store's ⌘Z of a fold, and its retry on a hub that refuses `actionIds`;
//   hub    — two studios on a real hub (serve-hub fixture), ⌘Z through the shell store over
//            GET /_api/project/undo-stack + POST /_api/project/undo.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import '../annotations/ops-merge.ts';
import { replicaBoardText } from '../annotations/replica.ts';
import { serializeBoard } from '../annotations/schema.ts';
import { boardTextSlots } from '../annotations/text-steps.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  draftWriteId,
  isDraftWriteId,
  newTextSessionId,
  sessionWriteId,
  textSessionOfTransaction,
  textSessionOfWriteId,
  textSessionTransactionId,
} from '../annotations/ui/text-session.ts';
import { fold, initialState, nextRedo, nextUndo, view } from '../client/v2/undo/projection.js';
import { createUndoProjection } from '../client/v2/undo/use-undo-projection.jsx';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createProjectUndoRoutes } from '../routes/project-undo.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';
import { undoLabel } from '../sync/undo-target.ts';

const sticky = (id: string, text: string, index = 'a0'): AnnotationElement =>
  ({ id, type: 'sticky', index, x: 0, y: 0, w: 200, h: 200, text }) as AnnotationElement;

describe('text-session ids', () => {
  test('a draft and a commit name their session; the transaction id carries it to the row', () => {
    const sid = newTextSessionId();
    expect(sid).toMatch(/^[0-9a-f]{16}$/);
    const d = draftWriteId(sid);
    const c = sessionWriteId(sid);
    expect(isDraftWriteId(d)).toBe(true);
    expect(isDraftWriteId(c)).toBe(false);
    expect(textSessionOfWriteId(d)).toBe(sid);
    expect(textSessionOfWriteId(c)).toBe(sid);
    // annotations-sync.ts / the hub's WRITE_ID: ≤ 96 of [a-zA-Z0-9_-]
    for (const w of [d, c]) expect(w).toMatch(/^[a-zA-Z0-9_-]{1,96}$/);
    // a v1 draft id, a plain id, a run tag name no session
    expect(textSessionOfWriteId(draftWriteId())).toBeNull();
    expect(textSessionOfWriteId(crypto.randomUUID())).toBeNull();
    const tx = textSessionTransactionId(sid);
    expect(tx).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(textSessionOfTransaction(tx)).toBe(sid);
    expect(textSessionOfTransaction(`tx_${crypto.randomUUID().replace(/-/g, '')}`)).toBeNull();
  });
});

describe('the ⌘Z stack folds one session into one entry', () => {
  const canvas = 'ui/k.tsx';
  let rev = 0;
  const row = (actionId: string, tx?: string, extra: Record<string, unknown> = {}) => ({
    revision: ++rev,
    actionId,
    mine: true,
    kind: 'edit',
    label: 'Edit annotations',
    committedAt: 1000 + rev,
    canvases: [canvas],
    ...(tx ? { transactionId: tx } : {}),
    ...extra,
  });
  const sid = 'aaaaaaaaaaaaaaaa';
  const other = 'bbbbbbbbbbbbbbbb';
  const ev = (rows: Array<Record<string, unknown>>) =>
    rows.map((action) => ({ type: 'action' as const, action }));
  const state = (rows: Array<Record<string, unknown>>, foldSessions = true) =>
    fold(initialState({ canvas, openedAt: 0, foldSessions }), ev(rows));

  test('drafts + commit of one session → one entry with every id, oldest first', () => {
    const rows = [
      row('a0'),
      row('d1', textSessionTransactionId(sid)),
      row('d2', textSessionTransactionId(sid)),
      row('c1', textSessionTransactionId(sid)),
    ];
    const s = state(rows);
    expect(s.entries.length).toBe(2);
    const top = nextUndo(s);
    expect(top?.actionId).toBe('d1');
    expect(top?.actionIds).toEqual(['d1', 'd2', 'c1']);
  });

  test('the switch off (a hub without multi-target undo) → one entry per row, as before', () => {
    const rows = [
      row('d1', textSessionTransactionId(sid)),
      row('d2', textSessionTransactionId(sid)),
    ];
    const s = state(rows, false);
    expect(s.entries.length).toBe(2);
    expect(nextUndo(s)?.actionIds).toBeUndefined();
  });

  test('another session, or another step of mine in between, starts a new entry', () => {
    const s = state([
      row('d1', textSessionTransactionId(sid)),
      row('e1', textSessionTransactionId(other)),
      row('d2', textSessionTransactionId(sid)),
      row('x1'),
      row('d3', textSessionTransactionId(sid)),
    ]);
    expect(s.entries.map((e) => e.actionIds ?? [e.actionId])).toEqual([
      ['d1'],
      ['e1'],
      ['d2'],
      ['x1'],
      ['d3'],
    ]);
  });

  test('⌘Z of the fold flips the whole entry; ⇧⌘Z flips it back', () => {
    const rows = [
      row('d1', textSessionTransactionId(sid)),
      row('c1', textSessionTransactionId(sid)),
      row('u1', undefined, { kind: 'undo', label: 'Undo', undoes: ['d1', 'c1'] }),
    ];
    const s = state(rows);
    expect(nextUndo(s)).toBeNull();
    expect(nextRedo(s)?.actionIds).toEqual(['d1', 'c1']);
    expect(nextRedo(s)?.undoneVia).toBe('u1');
    expect(view(s).entries.length).toBe(0);
    const back = state([
      ...rows,
      row('r1', undefined, { kind: 'redo', label: 'Redo', undoes: 'u1' }),
    ]);
    expect(nextUndo(back)?.actionIds).toEqual(['d1', 'c1']);
  });

  test('a ⌘Z of several ids is labelled a flip ("Undo"), a panel undo an entry', () => {
    expect(undoLabel({ actionIds: ['d1', 'c1'] }, false, 'keys')).toBe('Undo');
    expect(undoLabel({ actionIds: ['d1', 'c1'] }, false, 'panel')).toBe('Undo 2 changes');
    expect(undoLabel({ actionIds: ['d1', 'c1'] }, false)).toBe('Undo 2 changes');
  });
});

describe('the shell store: ⌘Z of a folded entry', () => {
  const entry = {
    actionId: 'd1',
    actionIds: ['d1', 'd2', 'c1'],
    who: 'you',
    label: 'Edit annotations',
    madeAt: 10,
    canvas: 'ui/k.tsx',
    artboards: [],
    state: 'done',
  };
  const store = (answer: (body: Record<string, unknown>) => { status: number; body: unknown }) => {
    const posts: Array<Record<string, unknown>> = [];
    const s = createUndoProjection({
      now: () => 0,
      announce: () => {},
      ownRunOn: () => false,
      designRel: () => 'design',
      request: async (method: string, _url: string, body?: unknown) => {
        if (method === 'GET')
          return { status: 200, body: { ok: true, entries: [entry], redo: [] } };
        posts.push(body as Record<string, unknown>);
        return answer(body as Record<string, unknown>);
      },
    } as never);
    return { s, posts };
  };

  test('sends every id of the session as one ⌘Z', async () => {
    const { s, posts } = store(() => ({ status: 200, body: { ok: true, actionId: 'u1' } }));
    const r = await s.undo('design/ui/k.tsx');
    expect(r.ok).toBe(true);
    expect(posts).toEqual([{ actionIds: ['d1', 'd2', 'c1'], via: 'keys' }]);
  });

  test('a hub that cannot (needs-hub-update) → the newest row alone, no error', async () => {
    const { s, posts } = store((b) =>
      Array.isArray(b.actionIds)
        ? { status: 409, body: { ok: false, reason: 'needs-hub-update' } }
        : { status: 200, body: { ok: true, actionId: 'u1' } }
    );
    const r = await s.undo('design/ui/k.tsx');
    expect(r.ok).toBe(true);
    expect(posts).toEqual([
      { actionIds: ['d1', 'd2', 'c1'], via: 'keys' },
      { actionId: 'c1', via: 'keys' },
    ]);
  });
});

// ---------------------------------------------------------------- a real hub, two studios

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function K() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" label="Hero" width={100} height={100}>
        <h1>K</h1>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

async function waitFor<T>(fn: () => T | Promise<T>, what: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* retry */
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'alice' | 'bob' | 'viewer', string>;
}

function startHub(dataDir: string): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{')) continue;
        clearTimeout(timer);
        const info = JSON.parse(line);
        resolve({ proc, http: info.http, port: info.port, tokens: info.tokens });
        return;
      }
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
  });
}

const noop = (): RoomCallbacks => ({
  async seed() {},
  async persistJson() {},
  async persistBinary() {},
});

interface Peer {
  runtime: SyncRuntime;
  designRoot: string;
  /** The board this studio's canvas room shows (shared doc: the hub replica itself). */
  board: (slug: string) => string | null;
  /** ⌘Z through the shell store, over the real undo routes. `legacyHub` = a 1.x hub's answer. */
  undoKey: (o?: { legacyHub?: boolean }) => Promise<{ ok: boolean; stale?: boolean }>;
}

async function startPeer(repoRoot: string, url: string): Promise<Peer> {
  const registry = createRegistry(noop());
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ canvasGroups: [{ label: 'Canvases', path: 'ui' }] })
  );
  const ctx = {
    canvasOrigin: 'http://canvas.localhost',
    sharedDoc: true,
    cfg: {
      name: 'test',
      projectLabel: null,
      designRoot: 'design',
      canvasGroups: [{ label: 'Canvases', path: 'ui' }],
      rootClass: 'app',
      themeDefault: 'dark',
      tokensCssRel: 'system/colors.css',
      teamAccentDefault: null,
      handoffTargets: [],
      newCanvasDir: 'ui',
      newComponentDir: 'ui/components',
      linkedHub: { url, linkedAt: 0, fileEvents: false },
      _source: 'defaults',
    },
    projectLabel: 'test',
    paths: {
      repoRoot,
      designRel: 'design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: 'design/system/colors.css',
      systemDirRel: 'system',
    },
    bus: createBus(),
  } as unknown as Context;
  const runtime = createSyncRuntime(ctx, {
    registry,
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  let legacy = false;
  // A 1.x hub: its bootstrap names no `undoTargets` (chatUndoReady false), `actionIds` is invalid.
  const control = () =>
    (legacy ? { ...runtime, chatUndoReady: () => false } : runtime) as unknown as never;
  const specs = createProjectUndoRoutes({ control, designRel: 'design' });
  const spec = (method: string, path: string) =>
    specs.find((s) => s.method === method && s.path === path) as RouteSpec;
  const request = async (method: string, url: string, body?: unknown) => {
    const path = new URL(url, 'http://localhost').pathname;
    // the stale toast's "who changed it" read (history route) is not part of this harness
    if (!spec(method, path)) return { status: 404, body: {} };
    const res = await spec(method, path).handle(
      new Request(new URL(url, 'http://localhost'), {
        method,
        ...(body !== undefined
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      }),
      {} as never
    );
    return { status: res.status, body: await res.json() };
  };
  return {
    runtime,
    designRoot,
    board: (slug) => replicaBoardText(registry.getDoc(slug)),
    undoKey: async (o = {}) => {
      legacy = o.legacyHub === true;
      try {
        // a fresh shell store per press, opened before the session (`since` = 0)
        const store = createUndoProjection({
          request,
          now: () => 0,
          announce: () => {},
          ownRunOn: () => false,
          designRel: () => 'design',
        } as never);
        const r = (await store.undo('design/ui/k.tsx')) as { ok: boolean; stale?: boolean };
        return r;
      } finally {
        legacy = false;
      }
    },
  };
}

describe.skipIf(!HUB_READY)('one typing session on a real hub = one ⌘Z step', () => {
  let root: string;
  let hub: Hub;
  let alice: Peer;
  let bob: Peer;
  let doc = '';
  const saved: Record<string, string | undefined> = {};
  const SLUG = 'ui-k';

  const head = async (): Promise<string> => {
    const res = await fetch(
      `${hub.http}/api/projects/current/v1/lane?doc=${encodeURIComponent(doc)}&lane=annotations&rev=${Number.MAX_SAFE_INTEGER}`,
      { headers: { authorization: `Bearer ${hub.tokens.owner}` } }
    );
    return ((await res.json()) as { body: string }).body;
  };
  const textOf = async (id: string) => boardTextSlots(await head()).get(id);
  /** What a peer's canvas shows for `id` (its room's doc, the hub replica under a shared doc). */
  const peerText = (p: Peer, id: string) => {
    const b = p.board(SLUG);
    return b ? boardTextSlots(b).get(id) : undefined;
  };
  /** One write on the hub head, as a text session sends it. */
  const write = async (who: Peer, el: AnnotationElement, writeId?: string) => {
    const base = await head();
    const els = base ? (JSON.parse(base).elements as AnnotationElement[]) : [];
    const next = [...els.filter((e) => e.id !== el.id), el];
    const r = await who.runtime.proposeLane?.(SLUG, 'annotations', serializeBoard(next), {
      baseText: base,
      ...(writeId ? { writeId } : {}),
    });
    expect(r?.status).toBe('accepted');
    return r?.actionId as string;
  };
  /** A session on `id`: drafts of `texts` (the last one is the commit). */
  const session = async (who: Peer, id: string, index: string, texts: string[]) => {
    const sid = newTextSessionId();
    for (let i = 0; i < texts.length; i += 1) {
      const last = i === texts.length - 1;
      await write(
        who,
        sticky(id, texts[i] as string, index),
        last ? sessionWriteId(sid) : draftWriteId(sid)
      );
    }
    return sid;
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'p8-hub-drafts-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    const aliceUrl = `http://127.0.0.1:${hub.port}`;
    const bobUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: { [aliceUrl]: { token: hub.tokens.alice }, [bobUrl]: { token: hub.tokens.bob } },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'alice', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'alice', 'design', 'ui', 'k.tsx'), CANVAS);
    alice = await startPeer(join(root, 'alice'), aliceUrl);
    doc = await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { doc: string; path: string }[] };
      return b.docs.find((d) => d.path === 'ui/k.tsx')?.doc ?? '';
    }, 'the hub to accept ui/k.tsx');
    bob = await startPeer(join(root, 'bob'), bobUrl);
    await bob.runtime.pullRemoteNow();
    await waitFor(() => bob.runtime.acceptedMode?.() === true, 'bob in accepted mode');
  }, 60_000);

  afterAll(async () => {
    await alice?.runtime.stop();
    await bob?.runtime.stop();
    if (hub && hub.proc.exitCode === null) {
      const gone = new Promise((r) => hub.proc.once('exit', r));
      hub.proc.kill('SIGTERM');
      await gone;
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('N drafts + commit → one ⌘Z restores the text before the session; the peer sees both', async () => {
    await write(alice, sticky('one', 'Hello', 'a0'));
    await session(alice, 'one', 'a0', ['Hello w', 'Hello wor', 'Hello world', 'Hello world!']);
    expect(await textOf('one')).toBe('Hello world!');
    await waitFor(() => peerText(bob, 'one') === 'Hello world!', 'bob to see the final text');
    const r = await alice.undoKey();
    expect(r.ok).toBe(true);
    expect(await textOf('one')).toBe('Hello');
    await waitFor(() => peerText(bob, 'one') === 'Hello', 'bob to see the restored text');
  }, 30_000);

  test('the other direction: Bob’s session, Bob’s one ⌘Z, Alice sees final then restored', async () => {
    await write(bob, sticky('four', 'Ahoj', 'a3'));
    await session(bob, 'four', 'a3', ['Ahoj s', 'Ahoj sve', 'Ahoj svete']);
    await waitFor(() => peerText(alice, 'four') === 'Ahoj svete', 'alice to see the final text');
    const r = await bob.undoKey();
    expect(r.ok).toBe(true);
    expect(await textOf('four')).toBe('Ahoj');
    await waitFor(() => peerText(alice, 'four') === 'Ahoj', 'alice to see the restored text');
  }, 30_000);

  test('a collaborator rewrote my word between my drafts → ⌘Z of the session refused', async () => {
    await write(alice, sticky('two', 'red', 'a1'));
    const sid = newTextSessionId();
    await write(alice, sticky('two', 'red green', 'a1'), draftWriteId(sid));
    await write(bob, sticky('two', 'red GRÜN', 'a1'));
    await write(alice, sticky('two', 'red GRÜN blue', 'a1'), draftWriteId(sid));
    await write(alice, sticky('two', 'red GRÜN blue!', 'a1'), sessionWriteId(sid));
    const r = await alice.undoKey();
    expect(r.ok).toBe(false);
    expect(r.stale).toBe(true);
    expect(await textOf('two')).toBe('red GRÜN blue!');
  }, 30_000);

  test('a 1.x hub (no multi-target undo) → one row per ⌘Z, as before, no error', async () => {
    await write(alice, sticky('three', 'a', 'a2'));
    await session(alice, 'three', 'a2', ['a b', 'a b c']);
    const r = await alice.undoKey({ legacyHub: true });
    expect(r.ok).toBe(true);
    expect(await textOf('three')).toBe('a b');
    expect((await alice.undoKey({ legacyHub: true })).ok).toBe(true);
    expect(await textOf('three')).toBe('a');
  }, 30_000);
});
