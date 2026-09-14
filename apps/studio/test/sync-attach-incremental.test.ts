// Continuous discovery — a canvas that appears AFTER boot still syncs.
//
// THE REGRESSION THIS PINS. `createSyncRuntime.start()` enumerated the project
// once and opened one provider per canvas it found. Nothing joined the runtime
// afterwards, so a canvas created a second later never synced, never got a
// cursor, and — on the cell, where the same runtime is what publishes a canvas
// to the hub at all — never even became a Hocuspocus document, which is why it
// could not be discovered by the desktop either. The only cure was a full
// runtime cycle (the Resync button, or relaunching the app), and the direction
// asymmetry the user reported was purely an artifact of which end restarts more
// often.
//
// The assertions below are deliberately about the WIRE, not about the runtime's
// bookkeeping: a canvas is adopted when its content reaches the peer doc. A test
// that only checked `size()` would pass on a runtime that opened a provider and
// never connected it.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import type { Context, DevServerConfig } from '../context.ts';
import { createBus } from '../context.ts';
import { stampMovedTo } from '../sync/codec.ts';
import { createSyncRuntime, MAX_PULLS_PER_POLL, type SyncProvider } from '../sync/index.ts';

let dir: string;
let cfgPathEnv: string | undefined;
let realFetch: typeof fetch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-incremental-'));
  cfgPathEnv = process.env.HUBS_CONFIG_PATH;
  process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json');
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (cfgPathEnv === undefined) delete process.env.HUBS_CONFIG_PATH;
  else process.env.HUBS_CONFIG_PATH = cfgPathEnv;
  rmSync(dir, { recursive: true, force: true });
});

/** The hub's `GET /api/documents` — names and byte counts, never a path. */
function hubListing(
  documents: Array<{ name: string; bytes: number }>,
  tombstones: Array<{ name: string; deletedAt: number }> = []
): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/api/documents')) {
      return new Response(JSON.stringify({ documents, tombstones }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
}

function writeHubsConfig(url: string, token: string): void {
  const cfgPath = process.env.HUBS_CONFIG_PATH;
  if (!cfgPath) throw new Error('HUBS_CONFIG_PATH not set by beforeEach');
  writeFileSync(cfgPath, JSON.stringify({ hubs: { [url]: { token, linkedAt: 1 } } }));
  chmodSync(cfgPath, 0o600);
}

function makeCtx(
  linkedHub?: DevServerConfig['linkedHub'],
  // The cross-origin sandbox. Present = active, which is production and the
  // condition a hub-authored `.tsx` body is admitted under (DDR-060 couples the
  // two). `null` means OFF — not `undefined`, which would trigger this default
  // and silently give the sandbox-off test a sandbox.
  canvasOrigin: string | null = 'http://canvas.localhost:9'
): Context {
  const designRoot = join(dir, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  return {
    canvasOrigin: canvasOrigin ?? undefined,
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
      repoRoot: dir,
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

/** Cross-linked in-memory provider pair, mirroring `sync-runtime.test.ts`. */
function inMemoryProviderFactory(): {
  factory: (args: { url: string; token: string; documentName: string }) => SyncProvider;
  peerOf: (name: string) => Y.Doc | undefined;
  destroyed: string[];
} {
  const peers = new Map<string, Y.Doc>();
  const destroyed: string[] = [];
  const TRANSPORT = Symbol('test-transport');

  function factory(args: {
    url: string;
    token: string;
    documentName: string;
    document?: Y.Doc;
  }): SyncProvider {
    const ownsLocal = !args.document;
    const local = args.document ?? new Y.Doc();
    const peer = new Y.Doc();
    local.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === TRANSPORT) return;
      Y.applyUpdate(peer, update, TRANSPORT);
    });
    peer.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === TRANSPORT) return;
      Y.applyUpdate(local, update, TRANSPORT);
    });
    peers.set(args.documentName, peer);
    return {
      document: local,
      awareness: new Awareness(local),
      async onceSynced() {},
      destroy() {
        destroyed.push(args.documentName);
        if (ownsLocal) local.destroy();
        peer.destroy();
      },
    };
  }

  return { factory, peerOf: (name) => peers.get(name), destroyed };
}

/** Write a canvas the way the API does — body first, sidecar second. */
function writeCanvas(ctx: Context, name: string, body: string): void {
  writeFileSync(join(ctx.paths.designRoot, 'ui', `${name}.html`), body);
}

const HUB = 'https://hub.example.com';

describe('continuous canvas discovery', () => {
  test('a canvas created after start() is adopted and reaches the hub', async () => {
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'screen', '<button>boot</button>');

    const { factory, peerOf } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    expect(runtime?.size()).toBe(1);
    // The canvas that did NOT exist at boot.
    expect(peerOf('ui-later')).toBeUndefined();

    writeCanvas(ctx, 'later', '<section>made after boot</section>');
    // The nudge the server's canvas-list watcher emits. Its payload is
    // deliberately ignored by the runtime (it is attacker-controlled), so an
    // empty one must still work — the rescan is the authority.
    ctx.bus.emit('canvas-list-update', { action: 'added', rel: 'ui/later.html' });
    await runtime?.rescanNow();
    await new Promise((res) => setTimeout(res, 20));

    expect(runtime?.size()).toBe(2);
    expect(peerOf('ui-later')?.getText('html').toString()).toBe(
      '<section>made after boot</section>'
    );
    // The boot canvas is untouched by the adoption.
    expect(peerOf('ui-screen')?.getText('html').toString()).toBe('<button>boot</button>');

    await runtime?.stop();
  });

  test('adopting is idempotent — a second rescan opens no second provider', async () => {
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'screen', '<button>boot</button>');

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();

    writeCanvas(ctx, 'later', '<p>x</p>');
    await runtime?.rescanNow();
    await runtime?.rescanNow();
    await runtime?.rescanNow();

    // Two providers on one document would give this peer two votes in every
    // merge and double every echo.
    expect(runtime?.size()).toBe(2);
    expect(await runtime?.adopt([])).toBe(0);

    await runtime?.stop();
  });

  test('a deleted canvas is released — its provider is destroyed, the rest survive', async () => {
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'a', '<i>a</i>');
    writeCanvas(ctx, 'b', '<i>b</i>');
    writeCanvas(ctx, 'c', '<i>c</i>');

    const { factory, peerOf, destroyed } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    expect(runtime?.size()).toBe(3);

    rmSync(join(ctx.paths.designRoot, 'ui', 'b.html'));
    await runtime?.rescanNow();

    expect(runtime?.size()).toBe(2);
    expect(destroyed).toEqual(['ui-b']);
    // The survivors are still live, not collateral damage of the release.
    peerOf('ui-a')?.getText('html'); // touch — must not throw on a destroyed doc
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'c.html'), '<i>c2</i>');
    ctx.bus.emit('fs:any', 'ui/c.html');
    // Past the fs reader's own per-path quiet window (DEFAULT_QUIET_MS).
    await new Promise((res) => setTimeout(res, 400));
    expect(peerOf('ui-c')?.getText('html').toString()).toBe('<i>c2</i>');

    await runtime?.stop();
  });

  test('a released canvas leaves the status payload instead of hanging as pending', async () => {
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'a', '<i>a</i>');
    writeCanvas(ctx, 'b', '<i>b</i>');

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    await new Promise((res) => setTimeout(res, 20));

    rmSync(join(ctx.paths.designRoot, 'ui', 'b.html'));
    await runtime?.rescanNow();

    const items = (runtime?.status()?.items ?? []) as Array<{ slug: string }>;
    expect(items.map((i) => i.slug)).not.toContain('ui-b');

    await runtime?.stop();
  });

  test('a canvas created on the HUB after boot is pulled down without a restart', async () => {
    // Symptom A of the 2026-08-13 report, in one test: a canvas made in the
    // cloud never reached the desktop, because the desktop asked the hub what
    // the project contained exactly once — at connect — and never again.
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'screen', '<button>boot</button>');
    hubListing([{ name: 'ui-screen', bytes: 10 }]);

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    expect(runtime?.size()).toBe(1);

    // Somebody makes a canvas in the cloud. The hub now lists a document this
    // peer has never heard of, and has no file for.
    hubListing([
      { name: 'ui-screen', bytes: 10 },
      { name: 'ui-fromcloud', bytes: 20 },
    ]);
    await runtime?.pullRemoteNow();
    await new Promise((res) => setTimeout(res, 20));

    expect(runtime?.size()).toBe(2);
    expect(runtime?.agentFor('ui-fromcloud')).toBeDefined();
    // The panel tells the person what arrived, so "nothing happened" is not the
    // user-visible outcome of a successful pull.
    expect(runtime?.status()?.pulled?.names).toContain('ui-fromcloud');

    await runtime?.stop();
  });

  test('a second poll does not re-pull what the first one already attached', async () => {
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'screen', '<button>boot</button>');
    hubListing([
      { name: 'ui-screen', bytes: 10 },
      { name: 'ui-fromcloud', bytes: 20 },
    ]);

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    const afterBoot = runtime?.size();

    await runtime?.pullRemoteNow();
    await runtime?.pullRemoteNow();
    await runtime?.pullRemoteNow();

    // Boot already pulled it; the poll must recognise its own work.
    expect(runtime?.size()).toBe(afterBoot);

    await runtime?.stop();
  });

  test('coming back online asks the hub what it missed, without waiting out the interval', async () => {
    // The longest wait is the least excusable one: a peer that was offline for
    // an hour has an hour of other people's canvases to learn about, and making
    // it sit through the poll interval on top of the outage is a wait nobody
    // should have to explain. `flash: 'synced'` is the monitor's reconnect edge
    // — once per return, not once per status frame.
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'screen', '<button>boot</button>');
    hubListing([{ name: 'ui-screen', bytes: 10 }]);

    // A provider that reports WS status, so a drop and a return are real
    // events rather than a status the stub never leaves.
    const { factory } = inMemoryProviderFactory();
    let emit: ((s: 'connected' | 'connecting' | 'disconnected') => void) | null = null;
    const statusFactory = (args: Parameters<typeof factory>[0]) => {
      const provider = factory(args);
      return {
        ...provider,
        onStatus(cb: (s: 'connected' | 'connecting' | 'disconnected') => void) {
          emit = cb;
          cb('connected');
          return () => {};
        },
      };
    };
    const runtime = createSyncRuntime(ctx, { providerFactory: statusFactory });
    await runtime?.start();

    hubListing([
      { name: 'ui-screen', bytes: 10 },
      { name: 'ui-whilegone', bytes: 20 },
    ]);
    // Away, then back. Only the RETURN is a reason to ask.
    emit?.('disconnected');
    emit?.('connected');
    await new Promise((res) => setTimeout(res, 2200));

    expect(runtime?.agentFor('ui-whilegone')).toBeDefined();

    await runtime?.stop();
  });

  test('a hub-authored .tsx is REFUSED when the sandbox is off', async () => {
    // 9.1-B / DDR-060 couple the two locks: a `.tsx` syncs only while the
    // cross-origin sandbox is active. `scanCanvases` has always asked that of
    // LOCAL files; the pull lane never did, so a peer with the sandbox off
    // still received hub-authored `.tsx` bodies and rendered them — on the main
    // origin, which is the execution the coupling exists to prevent. Reachable
    // once per connect before; every 20 s once discovery went continuous.
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 }, null); // split OFF
    writeCanvas(ctx, 'screen', '<button>boot</button>');
    hubListing([
      { name: 'ui-screen', bytes: 10 },
      { name: 'ui-fromcloud', bytes: 20 },
    ]);

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    await runtime?.pullRemoteNow();

    expect(runtime?.agentFor('ui-fromcloud')).toBeUndefined();

    await runtime?.stop();
  });

  test('a hub-authored .tsx is REFUSED when the project opted out of TSX sync', async () => {
    // The other half of the same gate: `linkedHub.syncTsx: false` is set
    // precisely to keep hub `.tsx` off this machine.
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1, syncTsx: false });
    writeCanvas(ctx, 'screen', '<button>boot</button>');
    hubListing([
      { name: 'ui-screen', bytes: 10 },
      { name: 'ui-fromcloud', bytes: 20 },
    ]);

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    await runtime?.pullRemoteNow();

    expect(runtime?.agentFor('ui-fromcloud')).toBeUndefined();

    await runtime?.stop();
  });

  test('one listing cannot land more than the per-pass cap', async () => {
    // Volume is a security property here: every accepted name is a file in the
    // design root, a provider, a pinned doc, and something autocommit puts into
    // the person's git. Bounded by ONE listing before; unbounded once the lane
    // re-asks forever. The rest arrive on later polls.
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'screen', '<button>boot</button>');
    hubListing([
      { name: 'ui-screen', bytes: 10 },
      ...Array.from({ length: 200 }, (_, i) => ({ name: `ui-flood${i}`, bytes: 1 })),
    ]);

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    const afterBoot = runtime?.size() ?? 0;
    await runtime?.pullRemoteNow();

    expect((runtime?.size() ?? 0) - afterBoot).toBeLessThanOrEqual(MAX_PULLS_PER_POLL);

    await runtime?.stop();
  });

  test('an unreachable hub is not an error — the poll degrades, sync continues', async () => {
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'screen', '<button>boot</button>');
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    // Must not throw, must not tear the runtime down.
    await runtime?.pullRemoteNow();
    expect(runtime?.size()).toBe(1);

    await runtime?.stop();
  });

  test('a hub-named document may not escape the design root, mid-session either', async () => {
    // The boot pull is guarded (`pullTargets` → `resolvePulledTarget` →
    // `admitPullTarget`); the poll reaches the same guards through the same
    // functions rather than a second copy of the decision.
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'screen', '<button>boot</button>');

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();

    hubListing([
      { name: 'ui-screen', bytes: 10 },
      // Not a legal document name — refused before it can become a path.
      { name: '../../etc/passwd', bytes: 1 },
      { name: 'ui/../../escape', bytes: 1 },
    ]);
    await runtime?.pullRemoteNow();

    expect(runtime?.size()).toBe(1);
    await runtime?.stop();
  });

  test('an EMPTY linked project asks for a cycle when it gains its first canvas', async () => {
    // The emptiest corner of the same bug. `start()` returns early when nothing
    // is syncable — before the status store, the monitor or the fs reader exist
    // — so the continuous-discovery block at the bottom is never reached, and a
    // person who links a fresh project and then makes their first canvas would
    // still be told to restart.
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });

    const asked: unknown[] = [];
    ctx.bus.on('sync:needs-restart', (p) => asked.push(p));

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    expect(runtime?.size()).toBe(0);
    expect(asked).toHaveLength(0);

    writeCanvas(ctx, 'first', '<main>the first one</main>');
    await runtime?.rescanNow();

    // It asks — cycling is the supervisor's to do (server.ts wires this).
    expect(asked).toHaveLength(1);

    await runtime?.stop();
  });

  test('adopt() refuses after stop() — nothing joins a dead runtime', async () => {
    writeHubsConfig(HUB, 'mau_test');
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'a', '<i>a</i>');

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    await runtime?.stop();

    writeCanvas(ctx, 'b', '<i>b</i>');
    await runtime?.rescanNow();
    expect(runtime?.size()).toBe(0);
    expect(
      await runtime?.adopt([
        {
          slug: 'ui-b',
          html: join(ctx.paths.designRoot, 'ui', 'b.html'),
          comments: join(ctx.paths.commentsDir, 'ui-b.json'),
          annotations: join(ctx.paths.designRoot, 'ui-b.annotations.svg'),
          meta: join(ctx.paths.designRoot, 'ui', 'b.meta.json'),
          css: join(ctx.paths.designRoot, 'ui', 'b.css'),
        },
      ])
    ).toBe(0);
  });
});

describe('remote structural notifications', () => {
  test('retirement publishes both paths after the old body is quarantined', async () => {
    writeHubsConfig(HUB, 'mau_test');
    hubListing([]);
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'before', '<h1>kept</h1>');
    const { factory, peerOf } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    const events: unknown[] = [];
    ctx.bus.on('canvas-list-update', (event) => {
      if (event?.action === 'moved')
        events.push({
          ...event,
          oldExists: existsSync(join(ctx.paths.designRoot, 'ui/before.html')),
        });
    });
    try {
      await runtime?.start();
      writeCanvas(ctx, 'after', '<h1>kept</h1>');
      const peer = peerOf('ui-before');
      if (!peer) throw new Error('Expected a live source provider');
      stampMovedTo(peer, 'ui/after.html');
      for (let i = 0; i < 50 && events.length === 0; i++) await Bun.sleep(20);
      expect(events).toEqual([
        expect.objectContaining({
          action: 'moved',
          fromRel: 'ui/before.html',
          rel: 'ui/after.html',
          oldExists: false,
        }),
      ]);
      expect(existsSync(join(ctx.paths.designRoot, 'ui/after.html'))).toBe(true);
    } finally {
      await runtime?.stop();
    }
  });

  test('cell metadata invalidation reads tombstones and publishes removal after quarantine', async () => {
    writeHubsConfig(HUB, 'mau_test');
    hubListing([]);
    const ctx = makeCtx({ url: HUB, linkedAt: 1 });
    writeCanvas(ctx, 'gone', '<h1>recoverable</h1>');
    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    const events: unknown[] = [];
    ctx.bus.on('canvas-list-update', (event) => {
      if (event?.action === 'removed')
        events.push({
          ...event,
          oldExists: existsSync(join(ctx.paths.designRoot, 'ui/gone.html')),
        });
    });
    try {
      await runtime?.start();
      hubListing([], [{ name: 'ui-gone', deletedAt: Date.now() }]);
      ctx.bus.emit('sync:documents-changed');
      for (let i = 0; i < 50 && events.length === 0; i++) await Bun.sleep(20);
      expect(events).toEqual([
        expect.objectContaining({ action: 'removed', rel: 'ui/gone.html', oldExists: false }),
      ]);
    } finally {
      await runtime?.stop();
    }
  });
});
