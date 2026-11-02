// Desktop ↔ cloud live pairing (variant C2) — the invariant suite.
//
// This is the gate the feature is allowed through, and it is written against
// the two decisions it threads rather than against its own implementation:
//
//   DDR-209  a cell does not dial out, and the hub is the sole committer;
//   DDR-064  one shared Y.Doc per canvas, disk is a projection of it.
//
// So the tests here are not "does the code do what the code does". They are:
// can a cell be made to talk to anything but itself (no); can a second
// committer appear (no); do the browser's doc and the desktop's doc become one
// (yes); does a first connect between two non-empty sides duplicate anything
// (no); does one edit produce one reload (yes).
//
// The convergence LAWS themselves live in `shared-doc-convergence.test.ts` and
// are not repeated — this suite covers the cell TOPOLOGY on top of them.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { Y_TYPES } from '../collab/persistence.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context, DevServerConfig } from '../context.ts';
import { createBus } from '../context.ts';
import { resolveCellPairing } from '../sync/cell-pairing.ts';
import { applyCommentsToDoc, Y_SYNC_TYPES } from '../sync/codec.ts';
import {
  admitCanvases,
  type CanvasDescriptor,
  createSyncRuntime,
  DEFAULT_MAX_PINNED_ROOMS,
  type SyncProvider,
} from '../sync/index.ts';
import { migrateSeed } from '../sync/migrate-seed.ts';

const LOOPBACK = 'http://127.0.0.1:1234';

/** The full, valid pairing environment. Tests mutate ONE key at a time from
 *  here, so a test that passes for the wrong reason is hard to write. */
function pairingEnv(over: Record<string, string | undefined> = {}) {
  return {
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_CELL_PAIRING: '1',
    MAUDE_LOOPBACK_SYNC_URL: LOOPBACK,
    MAUDE_LOOPBACK_SYNC_TOKEN: 'cell-token',
    MAUDE_SYNC_NO_AUTOCOMMIT: '1',
    MAUDE_SHARED_DOC: '1',
    ...over,
  };
}

let dir: string;
const SAVED_ENV_KEYS = [
  'MAUDE_WORKSPACE_MODE',
  'MAUDE_CELL_PAIRING',
  'MAUDE_LOOPBACK_SYNC_URL',
  'MAUDE_LOOPBACK_SYNC_TOKEN',
  'MAUDE_SYNC_NO_AUTOCOMMIT',
  'MAUDE_SHARED_DOC',
  'MAUDE_MAX_PINNED_ROOMS',
  'HUBS_CONFIG_PATH',
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cell-pairing-'));
  saved = {};
  for (const k of SAVED_ENV_KEYS) saved[k] = process.env[k];
  // A cell has no `~/.config/maude/hubs.json`; point the reader at a path that
  // does not exist so a stray person-credential can never satisfy a test.
  process.env.HUBS_CONFIG_PATH = join(dir, 'absent-hubs.json');
});

afterEach(() => {
  for (const k of SAVED_ENV_KEYS) {
    // Assigning `undefined` stringifies to "undefined"; delete is the restore.
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

/** Install a pairing environment for the duration of one test. */
function setEnv(env: Record<string, string | undefined>): void {
  for (const k of SAVED_ENV_KEYS) delete process.env[k];
  process.env.HUBS_CONFIG_PATH = join(dir, 'absent-hubs.json');
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) process.env[k] = v;
  }
}

function makeCtx(linkedHub?: DevServerConfig['linkedHub'], repoRoot = dir): Context {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  return {
    // The Lock-2 sandbox, so `.tsx` bodies are admitted to sync (DDR-060).
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
      linkedHub,
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
  } as Context;
}

function noopCallbacks(): RoomCallbacks {
  return { async seed() {}, async persistJson() {}, async persistBinary() {} };
}

/**
 * The cell topology in one object: the BROWSER's room doc (the registry's), the
 * DESKTOP's doc (`peerOf`, the other end of the hub), and a record of every URL
 * and token the runtime actually dialled.
 */
function cellHarness() {
  const registry = createRegistry(noopCallbacks());
  const peers = new Map<string, Y.Doc>();
  const dialled: Array<{ url: string; token: string; documentName: string }> = [];
  const TRANSPORT = Symbol('hub-transport');

  const factory = (args: {
    url: string;
    token: string;
    documentName: string;
    document?: Y.Doc;
  }): SyncProvider => {
    dialled.push({ url: args.url, token: args.token, documentName: args.documentName });
    const ownsLocal = !args.document;
    const local = args.document ?? new Y.Doc();
    // The desktop peer, on the far side of the hub's Hocuspocus document.
    const desktop = new Y.Doc();
    local.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === TRANSPORT) return;
      Y.applyUpdate(desktop, u, TRANSPORT);
    });
    desktop.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin === TRANSPORT) return;
      Y.applyUpdate(local, u, TRANSPORT);
    });
    peers.set(args.documentName, desktop);
    return {
      document: local,
      awareness: new Awareness(local),
      async onceSynced() {},
      destroy() {
        if (ownsLocal) local.destroy();
        desktop.destroy();
      },
    };
  };

  return {
    registry,
    factory,
    dialled,
    /** The doc the DESKTOP app holds for this canvas. */
    desktopDoc: (documentName: string) => {
      const d = peers.get(documentName);
      if (!d) throw new Error(`no provider for ${documentName}`);
      return d;
    },
    /** The doc the BROWSER's collab room holds for this canvas. */
    browserDoc: (slug: string) => registry.getDoc(slug),
  };
}

/* ------------------------------------------------------- Task 1: the guard */

describe('Task 1 — the workspace-mode guard opens only for loopback + commit-disabled', () => {
  test('the full, valid environment resolves a pairing', () => {
    const { pairing, refusal } = resolveCellPairing(pairingEnv());
    expect(refusal).toBeUndefined();
    expect(pairing).toEqual({ url: LOOPBACK, token: 'cell-token' });
  });

  test.each([
    ['localhost', 'http://localhost:1234'],
    ['127.0.0.1', 'http://127.0.0.1:9999'],
    ['[::1]', 'http://[::1]:1234'],
  ])('accepts the loopback host %s', (_label, url) => {
    expect(resolveCellPairing(pairingEnv({ MAUDE_LOOPBACK_SYNC_URL: url })).pairing).not.toBeNull();
  });

  test.each([
    ['a public hub', 'https://hub.example.com'],
    ['a LAN address that merely looks local', 'http://192.168.1.10:1234'],
    ['a host whose NAME contains localhost', 'https://localhost.evil.example.com'],
    ['a private-range address', 'http://10.0.0.5:1234'],
    ['not a URL at all', 'hub.example.com'],
  ])('refuses %s — a cell syncs to itself or to nothing', (_label, url) => {
    const { pairing, refusal, detail } = resolveCellPairing(
      pairingEnv({ MAUDE_LOOPBACK_SYNC_URL: url })
    );
    expect(pairing).toBeNull();
    expect(refusal).toBe('not-loopback');
    // The operator asked for pairing, so the refusal is never silent.
    expect(detail).toBeTruthy();
  });

  test('refuses when autocommit is not explicitly disabled', () => {
    // Absent — the default. "I forgot to set it" must not read as "it is off".
    expect(resolveCellPairing(pairingEnv({ MAUDE_SYNC_NO_AUTOCOMMIT: undefined })).refusal).toBe(
      'autocommit-enabled'
    );
    // And explicitly on.
    expect(resolveCellPairing(pairingEnv({ MAUDE_SYNC_NO_AUTOCOMMIT: '0' })).refusal).toBe(
      'autocommit-enabled'
    );
  });

  test('p8-v1-drop: MAUDE_SHARED_DOC has no opt-out any more — pairing ignores it', () => {
    // The single shared doc is the only model; `MAUDE_SHARED_DOC=0` (the old rollback) is gone, so it
    // neither refuses pairing nor turns anything off (was: refused 'shared-doc-off').
    expect(resolveCellPairing(pairingEnv({ MAUDE_SHARED_DOC: undefined })).pairing).not.toBeNull();
    expect(resolveCellPairing(pairingEnv({ MAUDE_SHARED_DOC: '0' })).pairing).not.toBeNull();
  });

  test('refuses when the token is missing', () => {
    expect(resolveCellPairing(pairingEnv({ MAUDE_LOOPBACK_SYNC_TOKEN: '' })).refusal).toBe(
      'no-token'
    );
  });

  test('is inert outside workspace mode and when not requested', () => {
    expect(resolveCellPairing(pairingEnv({ MAUDE_WORKSPACE_MODE: '0' })).refusal).toBe(
      'not-workspace-mode'
    );
    expect(resolveCellPairing(pairingEnv({ MAUDE_CELL_PAIRING: undefined })).refusal).toBe(
      'not-requested'
    );
    // A refusal that was never asked for gets no `detail` — nothing to say.
    expect(
      resolveCellPairing(pairingEnv({ MAUDE_CELL_PAIRING: undefined })).detail
    ).toBeUndefined();
  });
});

describe('Task 1 — createSyncRuntime honours the guard', () => {
  test('workspace + loopback + autocommit-off ⇒ the runtime starts', async () => {
    setEnv(pairingEnv());
    const ctx = makeCtx();
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.tsx'), 'export default () => null;');

    const h = cellHarness();
    const runtime = createSyncRuntime(ctx, {
      providerFactory: h.factory,
      registry: h.registry,
    });
    expect(runtime).not.toBeNull();
    await runtime?.start();
    expect(runtime?.size()).toBe(1);
    await runtime?.stop();
  });

  test('workspace + a non-loopback linkedHub in the TENANT config ⇒ still null', () => {
    // No pairing env at all — just workspace mode and a tenant config pointing
    // at somebody else's hub. This is the DDR-209 case, unchanged.
    setEnv({ MAUDE_WORKSPACE_MODE: '1' });
    const ctx = makeCtx({ url: 'https://someone-elses-hub.example.com', linkedAt: 1 });
    expect(createSyncRuntime(ctx)).toBeNull();
  });

  test('workspace + pairing on + autocommit NOT disabled ⇒ still null', () => {
    setEnv(pairingEnv({ MAUDE_SYNC_NO_AUTOCOMMIT: undefined }));
    const ctx = makeCtx();
    expect(createSyncRuntime(ctx)).toBeNull();
  });

  test('the tenant config cannot steer the socket — only the workspace id crosses', async () => {
    setEnv(pairingEnv());
    // A hostile / merely stale committed config: a hub URL we must ignore, and
    // a workspace id we MUST honour (it decides the document name the desktop
    // peer is on — see cell-pairing.ts).
    const ctx = makeCtx({
      url: 'https://attacker.example.com',
      linkedAt: 1,
      workspaceId: 'acme-web',
    });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.tsx'), 'export default () => null;');
    // Namespacing is what turns workspaceId into the wire name.
    execFileSync('git', ['init', '-q'], { cwd: dir });

    const h = cellHarness();
    const runtime = createSyncRuntime(ctx, {
      providerFactory: h.factory,
      registry: h.registry,
    });
    await runtime?.start();

    expect(h.dialled).toHaveLength(1);
    expect(h.dialled[0]?.url).toBe(LOOPBACK);
    expect(h.dialled[0]?.token).toBe('cell-token');
    // The tenant's workspace id reached the WIRE NAME — without it the browser
    // and the desktop would sit on two differently-named documents and this
    // whole feature would silently do nothing.
    expect(h.dialled[0]?.documentName).toContain('acme-web');

    await runtime?.stop();
  });
});

/* ------------------------------------------ Task 3: the hub is sole committer */

describe('Task 3 — no second committer appears inside the cell', () => {
  test('a full edit cycle under pairing leaves git untouched', async () => {
    setEnv(pairingEnv());
    // A REAL repo, so an autocommit that existed would leave a real commit.
    const repo = mkdtempSync(join(tmpdir(), 'cell-pairing-repo-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
      execFileSync('git', ['config', 'user.email', 't@t.test'], { cwd: repo });
      execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo });

      const ctx = makeCtx(undefined, repo);
      writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.tsx'), 'export default () => null;');
      execFileSync('git', ['add', '-A'], { cwd: repo });
      execFileSync('git', ['commit', '-qm', 'seed'], { cwd: repo });
      const before = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim();

      const h = cellHarness();
      const runtime = createSyncRuntime(ctx, {
        providerFactory: h.factory,
        registry: h.registry,
      });
      await runtime?.start();

      // The desktop peer edits the body — the exact traffic that, on the hub
      // side, triggers `afterStoreDocument` and the ONE legitimate commit.
      h.desktopDoc('ui-screen').getText(Y_SYNC_TYPES.html).insert(0, 'export const x = 1;\n');
      // stop() is where an autocommit would flush its quiescence window.
      await runtime?.stop();

      const after = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim();
      expect(after).toBe(before);
      // Not merely uncommitted — never staged either.
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim();
      expect(staged).toBe('');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('pairing never writes .claudeignore into the tenant repo', async () => {
    setEnv(pairingEnv());
    const ctx = makeCtx();
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.tsx'), 'export default () => null;');

    const h = cellHarness();
    const runtime = createSyncRuntime(ctx, {
      providerFactory: h.factory,
      registry: h.registry,
    });
    await runtime?.start();
    // The marker's audience (Claude reading this checkout) does not exist in a
    // cell, and the hub would commit and mirror the file to the tenant's repo.
    expect(existsSync(join(ctx.paths.repoRoot, '.claudeignore'))).toBe(false);
    await runtime?.stop();
  });
});

/* --------------------------------- Task 5 + the headline: the two ends meet */

describe('presence and edits cross both ways', () => {
  test('the browser room doc and the desktop doc are ONE doc', async () => {
    setEnv(pairingEnv());
    const ctx = makeCtx();
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.tsx'), 'export default () => null;');

    const h = cellHarness();
    const runtime = createSyncRuntime(ctx, {
      providerFactory: h.factory,
      registry: h.registry,
    });
    await runtime?.start();

    // Browser → desktop.
    h.browserDoc('ui-screen')
      .getArray(Y_TYPES.comments)
      .push([{ id: 'from-browser', text: 'hi' }]);
    expect(h.desktopDoc('ui-screen').getArray(Y_TYPES.comments).toArray()).toEqual([
      { id: 'from-browser', text: 'hi' },
    ]);

    // Desktop → browser.
    h.desktopDoc('ui-screen').getMap(Y_TYPES.annotations).set('svg', '<svg><rect/></svg>');
    expect(h.browserDoc('ui-screen').getMap(Y_TYPES.annotations).get('svg')).toBe(
      '<svg><rect/></svg>'
    );

    await runtime?.stop();
  });

  test('the hub-synced awareness is bridged to the room, so cursors relay', async () => {
    setEnv(pairingEnv());
    const ctx = makeCtx();
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.tsx'), 'export default () => null;');

    const h = cellHarness();
    let attaches = 0;
    const runtime = createSyncRuntime(ctx, {
      providerFactory: h.factory,
      registry: {
        getDoc: (s) => h.registry.getDoc(s),
        pin: (s) => h.registry.pin(s),
        unpin: (s) => h.registry.unpin(s),
        attachHubAwareness: (s, a) => {
          attaches++;
          return h.registry.attachHubAwareness(s, a);
        },
      },
    });
    await runtime?.start();
    // Presence crosses for free BECAUSE the awareness is the provider's — this
    // is the bridge, and without it a cursor stops at the process boundary.
    expect(attaches).toBe(1);
    await runtime?.stop();
  });
});

describe('Task 5 — first connect between two non-empty sides', () => {
  test('desktop state and browser files converge without duplicating comments', async () => {
    // The cell's disk holds what the BROWSER has been writing; the doc holds
    // what the DESKTOP synced up. Both non-empty — the case a naive
    // `applyUpdate` merge turns into every comment appearing twice.
    const designRoot = join(dir, 'design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    mkdirSync(join(designRoot, '_comments'), { recursive: true });
    const paths = {
      html: join(designRoot, 'ui', 'screen.tsx'),
      comments: join(designRoot, '_comments', 'ui-screen.json'),
      annotations: join(designRoot, 'ui-screen.annotations.svg'),
    };
    writeFileSync(paths.html, 'export const BROWSER = 1;\n');
    writeFileSync(
      paths.comments,
      JSON.stringify([
        { id: 'shared-1', text: 'both sides have this' },
        { id: 'browser-only', text: 'only on disk' },
      ])
    );

    const doc = new Y.Doc();
    doc.getText(Y_SYNC_TYPES.html).insert(0, 'export const DESKTOP = 1;\n');
    applyCommentsToDoc(
      doc,
      [
        { id: 'shared-1', text: 'both sides have this' },
        { id: 'desktop-only', text: 'only in the doc' },
      ],
      Symbol('seed')
    );

    const result = await migrateSeed({ slug: 'ui-screen', doc, paths });

    // ONE authoritative body — never a concatenation of the two.
    const body = doc.getText(Y_SYNC_TYPES.html).toString();
    expect([result]).not.toContain('empty');
    expect(body === 'export const BROWSER = 1;\n' || body === 'export const DESKTOP = 1;\n').toBe(
      true
    );

    // Comments are id-unioned, so nothing is lost AND nothing is doubled.
    const ids = (doc.getArray(Y_TYPES.comments).toArray() as Array<{ id: string }>).map(
      (c) => c.id
    );
    expect([...ids].sort()).toEqual(['browser-only', 'desktop-only', 'shared-1']);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  test('re-running the seed is a no-op — a restarting cell cannot accumulate', async () => {
    const designRoot = join(dir, 'design');
    mkdirSync(join(designRoot, '_comments'), { recursive: true });
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    const paths = {
      html: join(designRoot, 'ui', 'screen.tsx'),
      comments: join(designRoot, '_comments', 'ui-screen.json'),
      annotations: join(designRoot, 'ui-screen.annotations.svg'),
    };
    writeFileSync(paths.html, 'export const A = 1;\n');
    writeFileSync(paths.comments, JSON.stringify([{ id: 'c1', text: 'one' }]));

    const doc = new Y.Doc();
    await migrateSeed({ slug: 'ui-screen', doc, paths });
    const first = doc.getArray(Y_TYPES.comments).toArray();
    for (let i = 0; i < 3; i++) await migrateSeed({ slug: 'ui-screen', doc, paths });
    expect(doc.getArray(Y_TYPES.comments).toArray()).toEqual(first);
  });
});

/* ------------------------------------- Task 6: exactly one reload per edit */

describe('Task 6 — a doc-originated edit produces exactly one reload signal', () => {
  test('a projection write announces itself, once per file', async () => {
    setEnv(pairingEnv());
    const ctx = makeCtx();
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.tsx'), 'export const A = 1;\n');

    const seen: string[] = [];
    ctx.bus.on('fs:any', (rel: string) => seen.push(rel));

    const h = cellHarness();
    const runtime = createSyncRuntime(ctx, {
      providerFactory: h.factory,
      registry: h.registry,
    });
    await runtime?.start();
    seen.length = 0; // ignore the cold-start materialize

    // A desktop peer edits the body. The container's fs.watch would miss the
    // atomic write that follows, so without the announcement the browser's
    // canvas iframe never reloads — the bug this hook exists for.
    h.desktopDoc('ui-screen').getText(Y_SYNC_TYPES.html).insert(0, '// edited\n');
    await Bun.sleep(1400); // projection debounce (800 ms) + announce delay (250 ms)

    const bodyEvents = seen.filter((r) => r === 'ui/screen.tsx');
    expect(bodyEvents).toHaveLength(1);
    // And the file really did land — the signal is not announcing a phantom.
    expect(readFileSync(join(ctx.paths.designRoot, 'ui', 'screen.tsx'), 'utf8')).toContain(
      '// edited'
    );

    await runtime?.stop();
  }, 10_000);

  test('the announcement does not loop back into the doc', async () => {
    setEnv(pairingEnv());
    const ctx = makeCtx();
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.tsx'), 'export const A = 1;\n');

    const h = cellHarness();
    const runtime = createSyncRuntime(ctx, {
      providerFactory: h.factory,
      registry: h.registry,
    });
    await runtime?.start();

    const doc = h.browserDoc('ui-screen');
    let updates = 0;
    doc.on('update', () => updates++);

    h.desktopDoc('ui-screen').getText(Y_SYNC_TYPES.html).insert(0, '// edited\n');
    const afterEdit = updates;
    // Long enough for the write, the announcement, the fs read and any import
    // it might have produced. The echo guard is what makes this terminate.
    await Bun.sleep(1600);
    expect(updates).toBe(afterEdit);

    await runtime?.stop();
  }, 10_000);
});

/* --------------------------- DDR-064 pre-cutover checklist (A4 / A6 gates) */

describe('DDR-064 pre-cutover — slug collisions and the pinned-room ceiling', () => {
  const canvas = (slug: string, html: string): CanvasDescriptor => ({
    slug,
    html,
    comments: `/c/${slug}.json`,
    annotations: `/a/${slug}.svg`,
    meta: html.replace(/\.tsx$/, '.meta.json'),
    css: html.replace(/\.tsx$/, '.css'),
  });

  test('A4 — two files that flatten to one slug BOTH refuse to sync', () => {
    // `ui/a/b.tsx` and `ui/a-b.tsx` both flatten to `ui-a-b`. One document for
    // two files means each receives the other's body as a remote change and
    // writes it over itself, forever.
    const admitted = admitCanvases(
      [
        canvas('ui-a-b', '/d/ui/a/b.tsx'),
        canvas('ui-a-b', '/d/ui/a-b.tsx'),
        canvas('ui-ok', '/d/ui/ok.tsx'),
      ],
      true
    );
    expect(admitted.map((c) => c.slug)).toEqual(['ui-ok']);
  });

  test('A4 — a clean set passes through untouched', () => {
    const set = [canvas('a', '/d/ui/a.tsx'), canvas('b', '/d/ui/b.tsx')];
    expect(admitCanvases(set, true)).toEqual(set);
  });

  test('A6 — the pinned-room ceiling bounds the shared-doc set', () => {
    process.env.MAUDE_MAX_PINNED_ROOMS = '2';
    const set = [
      canvas('a', '/d/ui/a.tsx'),
      canvas('b', '/d/ui/b.tsx'),
      canvas('c', '/d/ui/c.tsx'),
    ];
    expect(admitCanvases(set, true)).toHaveLength(2);
    // Flag OFF is unpinned, so the ceiling does not apply to it.
    expect(admitCanvases(set, false)).toHaveLength(3);
  });

  test('A6 — the default ceiling is far above any real project', () => {
    expect(DEFAULT_MAX_PINNED_ROOMS).toBeGreaterThanOrEqual(500);
  });
});
