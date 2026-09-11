// Sync runtime wiring tests — Phase 9 Task 4.
//
// Uses an in-memory ProviderFactory so we don't need to start a Hocuspocus
// server. The agents do real Y.Doc work; the test verifies the runtime
// honors linkedHub config, discovers canvases, wires up agents, and
// dispatches fs events through the bus correctly.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { Y_TYPES } from '../collab/persistence.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context, DevServerConfig } from '../context.ts';
import { createBus } from '../context.ts';
import { createConnectionMonitor } from '../sync/connection-state.ts';
import {
  type AwarenessRegistry,
  buildNoSyncablePayload,
  classifyAuthFailure,
  createSyncRuntime,
  discoverCanvases,
  type SyncProvider,
  scanCanvases,
  toWsUrl,
  validExpiry,
} from '../sync/index.ts';
import { createSyncStatusStore } from '../sync/status.ts';

let dir: string;
let cfgPathEnv: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-runtime-'));
  cfgPathEnv = process.env.HUBS_CONFIG_PATH;
  // Point hubs.json to a temp file we control.
  process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json');
});

afterEach(() => {
  // Node's process.env stringifies on assignment; assigning undefined yields
  // the literal string "undefined". delete is the correct restoration.
  if (cfgPathEnv === undefined) delete process.env.HUBS_CONFIG_PATH;
  else process.env.HUBS_CONFIG_PATH = cfgPathEnv;
  rmSync(dir, { recursive: true, force: true });
});

function writeHubsConfig(url: string, token: string): void {
  const cfgPath = process.env.HUBS_CONFIG_PATH;
  if (!cfgPath) throw new Error('HUBS_CONFIG_PATH not set by beforeEach');
  writeFileSync(cfgPath, JSON.stringify({ hubs: { [url]: { token, linkedAt: 1 } } }));
  // Match the CLI's saveHubsConfig mode so the DDR-054 §2h mode-warning
  // doesn't fire on every test.
  chmodSync(cfgPath, 0o600);
}

function makeCtx(linkedHub?: DevServerConfig['linkedHub'], canvasOrigin?: string): Context {
  // Minimal Context — only the fields the sync runtime touches.
  const designRoot = join(dir, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  return {
    // T3 (9.1-B) — `canvasOrigin` set === the CSP/sandbox split is active
    // (MAUDE_CANVAS_ORIGIN_SPLIT=1). The `.tsx` sync opt-in is gated on it.
    canvasOrigin,
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
  };
}

function inMemoryProviderFactory(): {
  factory: (args: { url: string; token: string; documentName: string }) => SyncProvider;
  peerOf: (slug: string) => Y.Doc;
} {
  // Map of slug -> { local, peer } Y.Docs cross-linked via applyUpdate.
  const peers = new Map<string, { local: Y.Doc; peer: Y.Doc }>();
  const TRANSPORT = Symbol('test-transport');

  function factory(args: {
    url: string;
    token: string;
    documentName: string;
    document?: Y.Doc;
  }): SyncProvider {
    // Phase 9.2 (DDR-064): when the runtime injects a doc (sharedDoc ON), the
    // provider MUST attach to it — that's the whole point of convergence. The
    // peer is a second doc cross-linked through a mock transport, modelling
    // "another machine on the hub". We own `local` only when we created it, so
    // we don't destroy the registry-owned shared doc on teardown.
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
    peers.set(args.documentName, { local, peer });
    return {
      document: local,
      awareness: new Awareness(local),
      async onceSynced() {
        // Synced immediately for the in-memory pair.
      },
      destroy() {
        if (ownsLocal) local.destroy();
        peer.destroy();
      },
    };
  }

  return {
    factory,
    peerOf(slug: string): Y.Doc {
      const entry = peers.get(slug);
      if (!entry) throw new Error(`no provider for slug ${slug}`);
      return entry.peer;
    },
  };
}

describe('createSyncRuntime', () => {
  test('returns null when linkedHub is absent (solo mode)', () => {
    const ctx = makeCtx(undefined);
    expect(createSyncRuntime(ctx)).toBeNull();
  });

  test('returns null when token is missing from hubs.json', () => {
    const ctx = makeCtx({ url: 'https://hub.example.com', linkedAt: 1 });
    // No hubs.json written — token lookup returns null.
    expect(createSyncRuntime(ctx)).toBeNull();
  });

  test('starts agents for each discovered canvas', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });

    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'modal.html'), '<dialog>x</dialog>');

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    expect(runtime).not.toBeNull();

    await runtime?.start();
    expect(runtime?.size()).toBe(2);
    expect(runtime?.agentFor('ui-screen')).toBeDefined();
    expect(runtime?.agentFor('ui-modal')).toBeDefined();

    await runtime?.stop();
  });

  test('9.1-D: TSX-only project surfaces zero-syncable loudly (no silent no-op)', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });

    // Real (TSX-only) project: discovery admits .html only, so these don't sync.
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.tsx'), 'export default () => null;');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'modal.tsx'), 'export default () => null;');

    const events: unknown[] = [];
    ctx.bus.on('sync:status', (p) => events.push(p));

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();

    // No agents — but the state is now LOUD, not silent.
    expect(runtime?.size()).toBe(0);

    const syncFile = join(ctx.paths.designRoot, '_sync.json');
    expect(existsSync(syncFile)).toBe(true);
    const payload = JSON.parse(readFileSync(syncFile, 'utf8'));
    expect(payload.notSyncable).toBe(true);
    expect(payload.tsxCount).toBe(2);
    expect(payload.canvases).toBe(0);
    expect(payload.url).toBe(url);
    expect(payload.reason).toContain('DDR-060');

    // The browser banner gets the same payload over the bus.
    expect(events).toHaveLength(1);
    expect((events[0] as { notSyncable?: boolean }).notSyncable).toBe(true);

    await runtime?.stop();
  });

  test('adopt mode: pushes local disk state up to the hub on first sync', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1, adopt: true });

    writeFileSync(
      join(ctx.paths.designRoot, 'ui', 'screen.html'),
      '<button>local-bootstrap</button>'
    );

    const { factory, peerOf } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();

    // Reconcile fires after onceSynced() resolves — give one tick.
    await new Promise((res) => setTimeout(res, 10));

    expect(peerOf('ui-screen').getText('html').toString()).toBe('<button>local-bootstrap</button>');
    await runtime?.stop();
  });

  test('bus fs:any event dispatches through the agent', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });

    const htmlPath = join(ctx.paths.designRoot, 'ui', 'screen.html');
    writeFileSync(htmlPath, '');

    const { factory, peerOf } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();

    // Simulate a local edit: write to disk, then fire the bus event the
    // existing fs-watch.ts would emit.
    writeFileSync(htmlPath, '<button>local</button>');
    ctx.bus.emit('fs:any', 'ui/screen.html');

    // Wait for fs-mirror's 250ms quiet window + agent flush slack.
    await new Promise((res) => setTimeout(res, 400));

    expect(peerOf('ui-screen').getText('html').toString()).toBe('<button>local</button>');
    await runtime?.stop();
  });

  test('attaches each provider awareness to the registry and detaches on stop', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });

    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'modal.html'), '<dialog>x</dialog>');

    const attached: string[] = [];
    let detachCount = 0;
    const registry: AwarenessRegistry = {
      attachHubAwareness(slug, _awareness) {
        attached.push(slug);
        return () => {
          detachCount++;
        };
      },
    };

    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory, registry });
    await runtime?.start();

    expect(attached.sort()).toEqual(['ui-modal', 'ui-screen']);

    await runtime?.stop();
    expect(detachCount).toBe(2);
  });

  test('Task 8: provider going offline drives the status to offline + surfaces queued edits', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    // Provider stub that exposes onStatus so the test can drive WS transitions.
    let emitStatus: ((s: 'connected' | 'connecting' | 'disconnected') => void) | null = null;
    const doc = new Y.Doc();
    const factory = () => ({
      document: doc,
      onStatus(cb: (s: 'connected' | 'connecting' | 'disconnected') => void) {
        emitStatus = cb;
        return () => {
          emitStatus = null;
        };
      },
      async onceSynced() {},
      destroy() {
        doc.destroy();
      },
    });

    // Fake-timer monitor so the 30s grace window fires deterministically.
    let nowMs = 1_000;
    const timers: Array<{ fireAt: number; cb: () => void }> = [];
    const monitor = createConnectionMonitor({
      graceMs: 30_000,
      now: () => nowMs,
      setTimer: (cb, ms) => {
        const t = { fireAt: nowMs + ms, cb };
        timers.push(t);
        return t as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (h) => {
        const i = timers.indexOf(h as unknown as { fireAt: number; cb: () => void });
        if (i >= 0) timers.splice(i, 1);
      },
      onChange: (snap) => store.update(snap),
    });
    const writes: import('../sync/status.ts').SyncStatusPayload[] = [];
    const store = createSyncStatusStore({
      url,
      canvases: 1,
      write: (p) => writes.push(p),
    });

    const runtime = createSyncRuntime(ctx, {
      providerFactory: factory,
      connectionMonitor: monitor,
      statusStore: store,
    });
    await runtime?.start();

    // Connected → online.
    emitStatus?.('connected');
    expect(runtime?.status()?.state).toBe('online');

    // Disconnect, advance past the grace window → offline.
    emitStatus?.('disconnected');
    nowMs += 31_000;
    for (const t of [...timers]) {
      if (t.fireAt <= nowMs) {
        timers.splice(timers.indexOf(t), 1);
        t.cb();
      }
    }
    const offlineStatus = runtime?.status();
    expect(offlineStatus?.state).toBe('offline');
    expect(offlineStatus?.url).toBe(url);
    expect(offlineStatus?.offlineSince).not.toBeNull();
    // _sync.json mirror got the offline payload too.
    expect(writes.at(-1)?.state).toBe('offline');

    // Reconnect → back online with a green flash.
    emitStatus?.('connected');
    expect(runtime?.status()?.state).toBe('online');
    expect(runtime?.status()?.flash).toBe('synced');

    await runtime?.stop();
  });

  // ── Issue #118 — a document that re-handshakes is synced again ──────────
  //
  // FAIL-FIRST SHAPE: revert `repromoteOnReconnect` in sync/index.ts and this
  // goes red on the last assertion — `synced` stays 0 forever.
  //
  // What it guards: `noteDocState(slug,'connected')` had ONE call site, the
  // post-handshake reconcile inside `connectCanvas`, which runs at attach /
  // adopt / auth-re-probe and never again. A dropped socket demotes every
  // connected document to `pending` (correctly — a document whose socket is
  // gone is not synced), and nothing re-promoted it when the socket returned.
  // The demotion was permanent for the life of the runtime: observed live on
  // the reported project as `state:"online", docs:{synced:0,pending:85}`
  // fifteen minutes after a boot whose own log line read `85/87 synced`.
  test('a document demoted by a dropped socket is re-promoted when it returns', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    let emitStatus: ((s: 'connected' | 'connecting' | 'disconnected') => void) | null = null;
    const doc = new Y.Doc();
    const factory = () => ({
      document: doc,
      onStatus(cb: (s: 'connected' | 'connecting' | 'disconnected') => void) {
        emitStatus = cb;
        return () => {
          emitStatus = null;
        };
      },
      // Resolves on every call — the real provider clears `synced` on close and
      // sets it again after the next sync step, so a post-reconnect await is a
      // fresh handshake, not a cached `true`.
      async onceSynced() {},
      destroy() {
        doc.destroy();
      },
    });

    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();

    // `start()` resolves before the boot summary settles, so let the
    // post-handshake reconcile land before reading the counts.
    const settle = () => new Promise((r) => setTimeout(r, 0));
    await settle();

    // Boot: the handshake completed, so the document is synced.
    emitStatus?.('connected');
    expect(runtime?.status()?.docs?.synced).toBe(1);

    // The socket drops — demotion is correct and deliberate.
    emitStatus?.('disconnected');
    expect(runtime?.status()?.docs?.synced).toBe(0);
    expect(runtime?.status()?.docs?.pending).toBe(1);

    // …and it comes back. THIS is the assertion the bug failed.
    emitStatus?.('connected');
    await settle();
    expect(runtime?.status()?.docs?.synced).toBe(1);
    expect(runtime?.status()?.docs?.pending).toBe(0);

    await runtime?.stop();
  });

  // ── Issue #118 security remediation (2026-09-03 defender + attacker) ────
  //
  // These three are BEHAVIOURAL on purpose. The first cut of this fix shipped
  // two source-regex pins in sync-status.test.ts, and both review seats made
  // the same point: a grep over `index.ts` stays green through every one of the
  // four HIGH findings below. A test that cannot fail on the bug is not a gate.

  // F3 (attacker) — refusal laundering. `handleAuthFailure` files `generic` and
  // `rate-limit` NOWHERE but the monitor: they never enter `rejectedPermanent`.
  // Guarding the re-promotion on that map therefore let a transient refusal —
  // `permission-denied`, what every pre-DDR-102 hub sends — be overwritten with
  // `connected` while the hub was dropping the document's writes.
  // FAIL-FIRST: revert BOTH halves of the fix — the `rejectedAny` guard back to
  // `rejectedPermanent` AND the single `noteSyncActivity` back to the original
  // `noteDocState(slug,'connected')` pair — and this goes red. Reverting the
  // guard ALONE leaves it green, and that is a fact worth recording rather than
  // hiding: `noteSyncActivity` refuses to resurrect an `auth-rejected` document
  // on its own, so the two changes are independent layers over the same hole.
  // Neither is redundant — the guard also stops us waiting on, and stamping the
  // clock for, a document the hub has already refused.
  test('a transient refusal landing mid-handshake is NOT laundered into synced', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    let emitStatus: ((s: 'connected' | 'connecting' | 'disconnected') => void) | null = null;
    let failAuth: ((info: { reason: string }) => void) | null = null;
    let releaseSynced: (() => void) | null = null;
    let booted = false;
    const doc = new Y.Doc();
    const factory = () => ({
      document: doc,
      onStatus(cb: (s: 'connected' | 'connecting' | 'disconnected') => void) {
        emitStatus = cb;
        return () => {};
      },
      onAuthFailed(cb: (info: { reason: string }) => void) {
        failAuth = cb;
        return () => {};
      },
      // Boot resolves immediately; every later handshake is held open so the
      // test can land a refusal INSIDE the await window.
      onceSynced() {
        if (!booted) {
          booted = true;
          return Promise.resolve();
        }
        return new Promise<void>((r) => {
          releaseSynced = r;
        });
      },
      destroy() {},
    });

    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    const settle = () => new Promise((r) => setTimeout(r, 0));
    await settle();
    emitStatus?.('connected');
    expect(runtime?.status()?.docs?.synced).toBe(1);

    // Drop, then reconnect — the re-promotion is now parked on the handshake.
    emitStatus?.('disconnected');
    emitStatus?.('connected');
    await settle();

    // The hub refuses, in a TRANSIENT class, while we wait.
    failAuth?.({ reason: 'permission-denied' });
    await settle();
    expect(runtime?.status()?.docs?.rejected).toBe(1);

    // Now let the handshake land. It must NOT overwrite the refusal.
    releaseSynced?.();
    await settle();
    await settle();
    const after = runtime?.status();
    expect(after?.docs?.rejected).toBe(1);
    expect(after?.docs?.synced).toBe(0);

    await runtime?.stop();
  });

  // F4 (attacker) — the single-flight latch. `provider.destroy()` emits
  // `destroy`, never `synced`, so an unbounded `await onceSynced()` never
  // settles, `finally` never runs, and the slug stays latched forever: issue
  // #118 recreated per-document, permanently, by its own fix.
  // FAIL-FIRST: drop `settleWait` around the await → red (times out latched).
  test('a handshake that never settles does not latch the slug forever', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    let emitStatus: ((s: 'connected' | 'connecting' | 'disconnected') => void) | null = null;
    let booted = false;
    let hang = true;
    const doc = new Y.Doc();
    const factory = () => ({
      document: doc,
      onStatus(cb: (s: 'connected' | 'connecting' | 'disconnected') => void) {
        emitStatus = cb;
        return () => {};
      },
      onceSynced() {
        if (!booted) {
          booted = true;
          return Promise.resolve();
        }
        // First reconnect hangs forever; later ones resolve.
        if (hang) {
          hang = false;
          return new Promise<void>(() => {});
        }
        return Promise.resolve();
      },
      destroy() {},
    });

    // A short settle ceiling so the hung await is abandoned inside the test.
    const runtime = createSyncRuntime(ctx, {
      providerFactory: factory,
      auth: { settleTimeoutMs: 20 },
    });
    await runtime?.start();
    const settle = () => new Promise((r) => setTimeout(r, 0));
    await settle();
    emitStatus?.('connected');

    // Reconnect #1 — parks on a handshake that will never come.
    emitStatus?.('disconnected');
    emitStatus?.('connected');
    await new Promise((r) => setTimeout(r, 60));
    expect(runtime?.status()?.docs?.synced).toBe(0);

    // Reconnect #2 — must NOT be swallowed by a stale latch.
    emitStatus?.('disconnected');
    emitStatus?.('connected');
    await settle();
    await settle();
    expect(runtime?.status()?.docs?.synced).toBe(1);

    await runtime?.stop();
  });

  // N1 (verification review, HIGH) — the remediation for F1 introduced this,
  // and it is the sharpest lesson of the whole exercise: `reconnect()` first
  // CALLED `socket.onClose(...)`, which emits `status` and `disconnect` but
  // never `close`. Providers learn about a drop only through the `close` EVENT
  // (`websocketProvider.on('close', boundOnClose)` → `provider.synced = false`),
  // so every provider kept `synced === true` across the forced reconnect, and
  // `onceSynced()` — which short-circuits on that field — resolved instantly for
  // every document against a socket that had completed no handshake. The
  // recovery would have manufactured a fully-synced display out of nothing and
  // then disarmed the watchdog through its own `docs.synced > 0` guard.
  //
  // This test models the EMITTER rather than mirroring our own call shape — the
  // F1 test below cannot see N1 precisely because its fake has no emitter.
  // FAIL-FIRST: change the emit back to `socket.onClose({...})` → red.
  test('a forced reconnect resets every provider, so nothing is synced without a fresh handshake', async () => {
    const listeners = new Map<string, Array<(arg: unknown) => void>>();
    const socket = {
      status: 'connected',
      shouldConnect: true,
      on(evt: string, cb: (arg: unknown) => void) {
        if (!listeners.has(evt)) listeners.set(evt, []);
        listeners.get(evt)?.push(cb);
      },
      off() {},
      emit(evt: string, arg: unknown) {
        for (const cb of listeners.get(evt) ?? []) cb(arg);
      },
      // The library's own ctor wiring: the close EVENT runs this.
      onClose() {
        socket.status = 'disconnected';
      },
      disconnect() {
        socket.shouldConnect = false;
      },
      connect() {
        return Promise.resolve();
      },
      destroy() {},
    };
    socket.on('close', () => socket.onClose());

    // A provider that behaves like HocuspocusProvider: `synced` is reset ONLY
    // by the close event, and `attach()` registers that listener.
    // Explicit `this` keeps Biome from rewriting constructor fakes to arrows.
    const made: Array<{ synced: boolean }> = [];
    const { createDefaultProviderFactory } = await import('../sync/index.ts');
    const factory = createDefaultProviderFactory(async () => ({
      HocuspocusProviderWebsocket: function (this: unknown) {
        return socket;
      } as unknown as new () => unknown,
      HocuspocusProvider: function (this: Record<string, unknown>) {
        const self = { synced: true, document: new Y.Doc() };
        made.push(self);
        return {
          ...self,
          get synced() {
            return self.synced;
          },
          attach() {
            socket.on('close', () => {
              self.synced = false;
            });
          },
          on() {},
          off() {},
          destroy() {},
        };
      } as unknown as new () => unknown,
    }));
    await factory({ url: 'https://hub.example.com', token: 't', documentName: 'd' });
    expect(made[0]?.synced).toBe(true);

    factory.reconnect();

    // The provider must have been told. If it was not, `onceSynced()` would
    // resolve instantly and report a handshake that never happened.
    expect(made[0]?.synced).toBe(false);
    // …and the socket's own cleanup still ran, so the re-arm path is intact.
    expect(socket.status).toBe('disconnected');
    expect(socket.shouldConnect).toBe(true);
  });

  // NEW-3 / N4 (round-3 verification) — the stall watchdog had NO behavioural
  // coverage: it required the OWNED factory (so every test's injected one made
  // it a silent no-op) and real wall-clock minutes. Three review rounds each
  // found a HIGH inside this function and none of them could have been caught
  // by a test. These two drive it through an injected clock and factory.
  const stallCtx = () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');
    return ctx;
  };
  // A provider whose handshake NEVER lands: the document stays `pending` while
  // the socket reports connected — the half-open case the watchdog exists for.
  const stallFactory = (emit: { cb: ((s: 'connected' | 'disconnected') => void) | null }) => {
    const doc = new Y.Doc();
    return () => ({
      document: doc,
      onStatus(cb: (s: 'connected' | 'connecting' | 'disconnected') => void) {
        emit.cb = cb;
        return () => {};
      },
      onceSynced() {
        return new Promise<void>(() => {});
      },
      destroy() {},
    });
  };

  test('the stall watchdog forces a reconnect when the socket is up and nothing syncs', async () => {
    const ctx = stallCtx();
    const emit: { cb: ((s: 'connected' | 'disconnected') => void) | null } = { cb: null };
    let now = 1_000_000;
    let reconnects = 0;
    const factory = Object.assign(stallFactory(emit), { reconnect: () => reconnects++ });

    const runtime = createSyncRuntime(ctx, {
      providerFactory: factory,
      stall: { checkMs: 5, afterMs: 60_000, minMs: 300_000, jitterMs: 0, now: () => now },
    });
    await runtime?.start();
    emit.cb?.('connected');

    const snap = runtime?.status();
    expect(snap?.state).toBe('online');
    expect(snap?.docs?.synced).toBe(0);
    expect(snap?.docs?.pending).toBe(1);

    // Not yet — a handshake gets its moment.
    await new Promise((r) => setTimeout(r, 20));
    expect(reconnects).toBe(0);

    // Past the threshold: exactly one forced reconnect, and the floor holds.
    now += 61_000;
    await new Promise((r) => setTimeout(r, 30));
    expect(reconnects).toBe(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(reconnects).toBe(1);

    // The floor DOUBLED the moment the first one fired (5 → 10 min), so the
    // base minimum is no longer enough — this is the anti-storm property.
    now += 301_000;
    await new Promise((r) => setTimeout(r, 30));
    expect(reconnects).toBe(1);

    // Past the doubled floor: the second fires, and the floor doubles again
    // (→ 20 min), so the same advance must not buy a third.
    now += 301_000;
    await new Promise((r) => setTimeout(r, 30));
    expect(reconnects).toBe(2);
    now += 601_000;
    await new Promise((r) => setTimeout(r, 30));
    expect(reconnects).toBe(2);

    await runtime?.stop();
  });

  test('the watchdog stands down when ANY document is refused — that is the auth lane', async () => {
    // Two canvases on purpose: one refused, one still pending. With a single
    // refused doc `pending === 0` already short-circuits, so the test would
    // pass without the `rejected > 0` clause it is meant to pin.
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>a</button>');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'other.html'), '<button>b</button>');

    const cbs: Array<(s: 'connected' | 'disconnected') => void> = [];
    let now = 1_000_000;
    let reconnects = 0;
    const factory = Object.assign(
      (args: { documentName: string }) => {
        const doc = new Y.Doc();
        const refused = args.documentName.includes('screen');
        return {
          document: doc,
          onStatus(cb: (s: 'connected' | 'connecting' | 'disconnected') => void) {
            cbs.push(cb);
            return () => {};
          },
          onAuthFailed(cb: (info: { reason: string }) => void) {
            if (refused) setTimeout(() => cb({ reason: 'not authorized' }), 0);
            return () => {};
          },
          onceSynced() {
            return new Promise<void>(() => {});
          },
          destroy() {},
        };
      },
      { reconnect: () => reconnects++ }
    );

    const runtime = createSyncRuntime(ctx, {
      providerFactory: factory,
      stall: { checkMs: 5, afterMs: 60_000, minMs: 300_000, jitterMs: 0, now: () => now },
    });
    await runtime?.start();
    for (const cb of cbs) cb('connected');
    await new Promise((r) => setTimeout(r, 20));

    const snap = runtime?.status();
    expect(snap?.docs?.rejected).toBe(1);
    expect(snap?.docs?.pending).toBe(1);
    expect(snap?.docs?.synced).toBe(0);

    now += 600_000;
    await new Promise((r) => setTimeout(r, 30));
    expect(reconnects).toBe(0);

    await runtime?.stop();
  });

  // NEW-1 (round-3 verification, HIGH) — the LIBRARY makes the same mistake we
  // did. `checkConnection()`'s force-close branch CALLS `this.onClose(...)`
  // directly (and `cleanupWebSocket` has already detached the raw handlers), so
  // no `close` event is emitted, no provider's `boundOnClose` runs, and every
  // provider keeps `synced === true` through the teardown. `onceSynced()`
  // short-circuits on that field, so the re-promotion would report a handshake
  // that never happened — for every document — and then disarm the watchdog via
  // its own `docs.synced > 0` guard. Reached by exactly the #118 scenario: a
  // link that was healthy and then went quiet for 30 s.
  // FAIL-FIRST: drop the `resetSyncedOnDrop` status watcher → red.
  test('a status drop clears the handshake flag even when no close event is raised', async () => {
    const statusCbs: Array<(a: unknown) => void> = [];
    const socket = {
      status: 'connected',
      on(evt: string, cb: (a: unknown) => void) {
        if (evt === 'status') statusCbs.push(cb);
      },
      off(evt: string, cb: (a: unknown) => void) {
        if (evt !== 'status') return;
        const i = statusCbs.indexOf(cb);
        if (i >= 0) statusCbs.splice(i, 1);
      },
      emit() {},
      // The library's force-close: emits `status`, never `close`.
      forceClose() {
        socket.status = 'disconnected';
        for (const cb of [...statusCbs]) cb({ status: 'disconnected' });
      },
      destroy() {},
    };
    const self = { isSynced: true };
    const { createDefaultProviderFactory } = await import('../sync/index.ts');
    const factory = createDefaultProviderFactory(async () => ({
      HocuspocusProviderWebsocket: function (this: unknown) {
        return socket;
      } as unknown as new () => unknown,
      HocuspocusProvider: function (this: unknown) {
        return {
          document: new Y.Doc(),
          attach() {},
          on() {},
          off() {},
          destroy() {},
          get synced() {
            return self.isSynced;
          },
          // Mirrors the library setter: emits only on true, no-op if unchanged.
          set synced(v: boolean) {
            if (self.isSynced === v) return;
            self.isSynced = v;
          },
        };
      } as unknown as new () => unknown,
    }));
    const wrapped = await factory({
      url: 'https://hub.example.com',
      token: 't',
      documentName: 'd',
    });
    expect(self.isSynced).toBe(true);

    // The library tears the socket down WITHOUT a close event.
    socket.forceClose();

    // If the flag survived, onceSynced() would resolve instantly and the
    // re-promotion would invent a handshake for every document.
    expect(self.isSynced).toBe(false);

    wrapped.destroy();
    expect(statusCbs).toHaveLength(0);
  });

  // F1 (both seats, Critical) — `reconnect()` must not wedge the socket shut.
  // `disconnect()` clears `shouldConnect` without touching `status`, and
  // `connect()` early-returns on `status === Connected` BEFORE restoring it —
  // so the pair left the link permanently dead in exactly the state the
  // watchdog fires from. FAIL-FIRST: restore disconnect()+connect() → red.
  test('factory reconnect drives the close path and leaves the socket re-arming', async () => {
    const calls: string[] = [];
    class FakeSocket {
      status = 'connected';
      shouldConnect = true;
      webSocket: { close(): void } | null = { close: () => calls.push('ws.close') };
      handlers: Array<(a: unknown) => void> = [];
      on(evt: string, cb: (a: unknown) => void) {
        if (evt === 'close') this.handlers.push(cb);
      }
      off() {}
      emit(evt: string, arg: unknown) {
        if (evt !== 'close') return;
        calls.push('emit:close');
        // The library ctor wires the close EVENT to its own handler.
        for (const cb of this.handlers) cb(arg);
        this.onClose(arg);
      }
      disconnect() {
        calls.push('disconnect');
        this.shouldConnect = false;
      }
      connect() {
        calls.push('connect');
        if (this.status === 'connected') return Promise.resolve();
        this.shouldConnect = true;
        return Promise.resolve();
      }
      onClose(_arg: unknown) {
        calls.push('onClose');
        this.webSocket = null;
        this.status = 'disconnected';
        // The library re-arms here iff shouldConnect survived.
        if (this.shouldConnect) calls.push('rearmed');
      }
      destroy() {}
    }
    const socket = new FakeSocket();
    const { createDefaultProviderFactory } = await import('../sync/index.ts');
    const factory = createDefaultProviderFactory(async () => ({
      HocuspocusProviderWebsocket: function (this: unknown) {
        return socket;
      } as unknown as new () => unknown,
      HocuspocusProvider: function (this: unknown) {
        return {
          document: new Y.Doc(),
          attach() {},
          on() {},
          off() {},
          destroy() {},
        };
      } as unknown as new () => unknown,
    }));
    await factory({ url: 'https://hub.example.com', token: 't', documentName: 'd' });

    factory.reconnect();

    // The socket must still WANT to be connected — that is the whole bug.
    expect(socket.shouldConnect).toBe(true);
    expect(calls).toContain('rearmed');
    expect(calls).not.toContain('disconnect');
  });

  test('writes _sync.json on a clean fast connect (regression: status must not read "idle" while sync is healthy)', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    // Provider that — like the real wrapper after the fix — reports its current
    // status the instant a subscriber attaches, and is already synced. No later
    // WS *transition* fires (the monitor starts 'online', so a 'connected' note
    // is a no-op), so the only thing that writes `_sync.json` is the runtime's
    // initial status persist. Before the fix this left the file absent and
    // `maude design status` reported "idle / sync agent not running".
    const doc = new Y.Doc();
    const factory = () => ({
      document: doc,
      onStatus(cb: (s: 'connected' | 'connecting' | 'disconnected') => void) {
        cb('connected');
        return () => {};
      },
      async onceSynced() {},
      destroy() {
        doc.destroy();
      },
    });

    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();

    // Live status reflects an online agent...
    expect(runtime?.status()?.state).toBe('online');
    // ...and it has been persisted to _sync.json (what `maude design status` reads).
    const syncFile = join(ctx.paths.designRoot, '_sync.json');
    expect(existsSync(syncFile)).toBe(true);
    const payload = JSON.parse(readFileSync(syncFile, 'utf8'));
    expect(payload.state).toBe('online');
    expect(payload.canvases).toBe(1);
    expect(payload.notSyncable).toBeUndefined();

    await runtime?.stop();
  });

  test('DDR-102: reconcile over divergent local content records a diverged conflict + snapshots both sides', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    // Local disk has divergent, non-empty content (and no journal — divergence).
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>LOCAL EDIT</button>');

    // Provider whose doc already carries different hub state. No syncMeta
    // stamp (older peer) → newest-wins falls back to hub.
    const factory = () => {
      const document = new Y.Doc();
      document.getText('html').insert(0, '<button>HUB STATE</button>');
      return {
        document,
        async onceSynced() {},
        destroy() {
          document.destroy();
        },
      };
    };

    const runtime = createSyncRuntime(ctx, { providerFactory: factory });
    await runtime?.start();
    // Reconcile fires after onceSynced resolves.
    await new Promise((res) => setTimeout(res, 20));

    const status = runtime?.status();
    expect(status?.conflicts.length).toBeGreaterThanOrEqual(1);
    const conflict = status?.conflicts[0];
    expect(conflict?.kind).toBe('cold-start-diverged');
    expect(conflict?.winner).toBe('hub');
    // Both pre-resolution versions were snapshotted to _history/<slug>/.
    expect(conflict?.snapshots?.local).toBeDefined();
    expect(conflict?.snapshots?.hub).toBeDefined();
    const historyDir = join(ctx.paths.historyDir, 'ui-screen');
    const blobs = readdirSync(historyDir).filter((f) => f.endsWith('.html'));
    expect(blobs.length).toBe(2);
    // The loser (local) is recoverable byte-identical from its snapshot.
    const metas = readdirSync(historyDir).filter((f) => f.endsWith('.json'));
    const snapshotContents = blobs.map((f) => readFileSync(join(historyDir, f), 'utf8'));
    expect(snapshotContents).toContain('<button>LOCAL EDIT</button>');
    expect(snapshotContents).toContain('<button>HUB STATE</button>');
    expect(metas.length).toBe(2);
    // Hub won → disk now carries hub state.
    expect(readFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), 'utf8')).toBe(
      '<button>HUB STATE</button>'
    );
    await runtime?.stop();
  });
});

// Phase 9.2 (DDR-064) — the convergence core: ONE shared Y.Doc per canvas, the
// hub provider attached to it instead of a fresh doc. These prove (Task 3) that
// browser↔hub propagation flows through the single doc with the in-process
// relay RETIRED, and (Task 3 lifecycle) that a provider-pinned room survives the
// last-browser-leaves drop. Flag-OFF behavior is covered by every other test in
// this file running with `ctx.sharedDoc` unset.
describe('shared-doc convergence (MAUDE_SHARED_DOC ON)', () => {
  function noopCallbacks(): RoomCallbacks {
    return { async seed() {}, async persistJson() {}, async persistBinary() {} };
  }

  /** The real registry wrapped to COUNT relay calls, so a test can assert the
   *  wholesale syncRoomFrom* clobber path was never used under sharedDoc. All
   *  other methods delegate to the real registry (closures over its state). */
  function countingRegistry() {
    const real = createRegistry(noopCallbacks());
    let relayCalls = 0;
    let awarenessAttaches = 0;
    const wrapped: AwarenessRegistry & {
      getDoc(slug: string): Y.Doc;
      peek: typeof real.peek;
      get: typeof real.get;
      drop: typeof real.drop;
      destroyAll: typeof real.destroyAll;
      relayCalls(): number;
      awarenessAttaches(): number;
    } = {
      getDoc: (slug) => real.getDoc(slug),
      peek: (slug) => real.peek(slug),
      get: (slug) => real.get(slug),
      drop: (slug) => real.drop(slug),
      destroyAll: () => real.destroyAll(),
      pin: (slug) => real.pin(slug),
      unpin: (slug) => real.unpin(slug),
      attachHubAwareness: (slug, awareness) => {
        awarenessAttaches++;
        return real.attachHubAwareness(slug, awareness);
      },
      syncRoomFromComments: (slug, comments) => {
        relayCalls++;
        real.syncRoomFromComments(slug, comments);
      },
      syncRoomFromAnnotations: (slug, svg) => {
        relayCalls++;
        real.syncRoomFromAnnotations(slug, svg);
      },
      relayCalls: () => relayCalls,
      awarenessAttaches: () => awarenessAttaches,
    };
    return wrapped;
  }

  test('#121 shared runtime refuses corrupt source and publishes recovery notice', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 }, 'http://localhost:9');
    ctx.sharedDoc = true;
    const file = join(ctx.paths.designRoot, 'ui', 'screen.tsx');
    const clean = 'export default function Canvas(){return <main>Healthy</main>}';
    writeFileSync(file, clean);
    const registry = countingRegistry();
    const { factory, peerOf } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory, registry });
    try {
      await runtime?.start();
      const peer = peerOf('ui-screen');
      const body = peer.getText('html');
      peer.transact(() => {
        body.delete(0, body.length);
        body.insert(0, 'export default <div title="broken');
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(readFileSync(file, 'utf8')).toBe(clean);
      const status = JSON.parse(readFileSync(join(ctx.paths.designRoot, '_sync.json'), 'utf8'));
      expect(status.conflicts.some((c: { kind: string }) => c.kind === 'body-rejected')).toBe(true);
      expect(
        status.notices.some((n: { text: string }) => n.text.includes('Source sync blocked'))
      ).toBe(true);
      expect(
        readFileSync(
          join(ctx.paths.historyDir, 'ui-screen', 'sync-recovery', 'last-valid.tsx'),
          'utf8'
        )
      ).toBe(clean);
    } finally {
      await runtime?.stop();
      registry.destroyAll();
    }
  });

  test('browser edit on the shared doc reaches the hub peer with NO relay', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    ctx.sharedDoc = true; // flag ON
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    const registry = countingRegistry();
    const { factory, peerOf } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory, registry });
    await runtime?.start();

    // The provider is attached to the SAME doc the registry hands the browser.
    const shared = registry.getDoc('ui-screen');
    // Browser-style edit — a doc mutation whose origin is NOT the agent origin
    // (exactly what a browser conn or the inspector-write path produces).
    shared.getArray(Y_TYPES.comments).push([{ id: 'c1', text: 'hi' }]);

    // Converges to the hub peer through the provider transport — one doc.
    expect(peerOf('ui-screen').getArray(Y_TYPES.comments).toArray()).toEqual([
      { id: 'c1', text: 'hi' },
    ]);
    // And the wholesale relay (the Phase 9.1 clobber path) was NEVER invoked.
    expect(registry.relayCalls()).toBe(0);

    await runtime?.stop();
  });

  test('hub-pushed edit lands in the shared doc (provider applies to the room doc)', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    ctx.sharedDoc = true;
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    const registry = countingRegistry();
    const { factory, peerOf } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory, registry });
    await runtime?.start();

    // Another machine on the hub adds a comment → reaches our shared doc.
    peerOf('ui-screen')
      .getArray(Y_TYPES.comments)
      .push([{ id: 'h1', text: 'from peer' }]);
    expect(registry.getDoc('ui-screen').getArray(Y_TYPES.comments).toArray()).toEqual([
      { id: 'h1', text: 'from peer' },
    ]);
    expect(registry.relayCalls()).toBe(0);

    await runtime?.stop();
  });

  test('two-way merge: concurrent comment + annotation on both sides converge (no clobber)', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    ctx.sharedDoc = true;
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    const registry = countingRegistry();
    const { factory, peerOf } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory, registry });
    await runtime?.start();

    const shared = registry.getDoc('ui-screen');
    const peer = peerOf('ui-screen');
    // Local adds a comment; the hub peer concurrently sets an annotation.
    shared.getArray(Y_TYPES.comments).push([{ id: 'local-c', text: 'mine' }]);
    peer.getMap(Y_TYPES.annotations).set('svg', '<svg><rect/></svg>');

    // Both survive on both replicas — the CRDT merged, nothing clobbered.
    expect(shared.getArray(Y_TYPES.comments).toArray()).toEqual([{ id: 'local-c', text: 'mine' }]);
    expect(shared.getMap(Y_TYPES.annotations).get('svg')).toBe('<svg><rect/></svg>');
    expect(peer.getArray(Y_TYPES.comments).toArray()).toEqual([{ id: 'local-c', text: 'mine' }]);
    expect(peer.getMap(Y_TYPES.annotations).get('svg')).toBe('<svg><rect/></svg>');
    expect(registry.relayCalls()).toBe(0);

    await runtime?.stop();
  });

  test('a provider-pinned shared room survives the last-browser-leaves drop, released on stop', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    ctx.sharedDoc = true;
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    const registry = countingRegistry();
    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory, registry });
    await runtime?.start();

    // The room exists (created by getDoc at attach) with zero browser conns.
    expect(registry.peek('ui-screen')).not.toBeNull();
    // The last-browser-leaves close handler calls drop; pinned → NOT destroyed,
    // or the doc would be yanked out from under the live provider.
    await registry.drop('ui-screen');
    expect(registry.peek('ui-screen')).not.toBeNull();

    // Runtime stop releases the pin → drop now destroys normally.
    await runtime?.stop();
    await registry.drop('ui-screen');
    expect(registry.peek('ui-screen')).toBeNull();
  });

  test('Task 4 — the provider awareness is still bridged on the shared-doc path', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    ctx.sharedDoc = true;
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    const registry = countingRegistry();
    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory, registry });
    await runtime?.start();

    // Presence bridging is mode-independent (the attachHubAwareness call sits
    // outside the sharedDoc branch). Confirm it still fires here so cursors
    // relay cross-machine under the new path too.
    expect(registry.awarenessAttaches()).toBe(1);

    await runtime?.stop();
  });

  test('Task 11 — status surfaces the shared-doc model in _sync.json', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    ctx.sharedDoc = true;
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'screen.html'), '<button>hi</button>');

    const registry = countingRegistry();
    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory, registry });
    await runtime?.start();

    expect(runtime?.status()?.sharedDoc).toBe(true);
    const payload = JSON.parse(readFileSync(join(ctx.paths.designRoot, '_sync.json'), 'utf8'));
    expect(payload.sharedDoc).toBe(true);

    await runtime?.stop();
  });

  // Phase D (Task 8) — the body-gating security invariant under the shared-doc
  // path: a `.tsx` body crosses the hub ONLY with the syncable opt-in (Lock 1) +
  // the canvasOrigin sandbox (Lock 2). The gate is discovery-exclusion: an
  // opted-out `.tsx` is never in the sync set, so no provider attaches to a doc
  // for it and its body is never exposed (DDR-054 F1 / DDR-060).
  test('Phase D — an opted-OUT .tsx body never gets a shared doc/provider (gate holds)', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    // canvasOrigin set === Lock 2 (sandbox) active.
    const ctx = makeCtx({ url, linkedAt: 1 }, 'http://localhost:9');
    ctx.sharedDoc = true;

    // Opted-IN .tsx (Lock 1 + Lock 2 both set) → body may sync.
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'opted.tsx'), 'export default () => null;');
    writeFileSync(
      join(ctx.paths.designRoot, 'ui', 'opted.meta.json'),
      JSON.stringify({ syncable: true })
    );
    // Opted-OUT .tsx (no Lock 1) → body MUST NOT cross the hub.
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'secret.tsx'), 'export default () => SECRET;');
    writeFileSync(
      join(ctx.paths.designRoot, 'ui', 'secret.meta.json'),
      JSON.stringify({ syncable: false })
    );

    const registry = countingRegistry();
    const { factory } = inMemoryProviderFactory();
    const runtime = createSyncRuntime(ctx, { providerFactory: factory, registry });
    await runtime?.start();

    // Only the opted-in canvas is in the sync set.
    expect(runtime?.size()).toBe(1);
    // The opted-in canvas got a shared doc (room created via getDoc)…
    expect(registry.peek('ui-opted')).not.toBeNull();
    // …the opted-out one NEVER did — no provider, no doc, body unexposed.
    expect(registry.peek('ui-secret')).toBeNull();

    // The untrusted marker lists ONLY the body-exposing (opted-in) canvas.
    const index = JSON.parse(
      readFileSync(join(ctx.paths.designRoot, '_untrusted', 'INDEX.json'), 'utf8')
    );
    const markedSlugs = index.canvases.map((c: { slug: string }) => c.slug);
    expect(markedSlugs).toEqual(['ui-opted']);

    await runtime?.stop();
  });
});

describe('discoverCanvases', () => {
  test('finds .html files but EXCLUDES .tsx (DDR-054 §2b)', async () => {
    const ctx = makeCtx({ url: 'https://h.example.com', linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'a.html'), '');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'b.tsx'), '');

    const list = await discoverCanvases(ctx);
    const slugs = list.map((c) => c.slug).sort();
    // .tsx is deliberately refused — hostile-hub-pushed JSX would be
    // transpiled and executed in iframe same-origin. Solo-mode editing
    // of .tsx is unaffected.
    expect(slugs).toEqual(['ui-a']);
  });

  test('skips dirs starting with _ (e.g. _history, _comments)', async () => {
    const ctx = makeCtx({ url: 'https://h.example.com', linkedAt: 1 });
    mkdirSync(join(ctx.paths.designRoot, 'ui', '_history'));
    writeFileSync(join(ctx.paths.designRoot, 'ui', '_history', 'snap.html'), '');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'real.html'), '');

    const list = await discoverCanvases(ctx);
    expect(list.map((c) => c.slug)).toEqual(['ui-real']);
  });

  // T3 (9.1-B) — opted-in .tsx sync, gated on the sandbox split.
  test('admits an opted-in .tsx ONLY when the split is active (Lock1⊃Lock2)', async () => {
    const HUB = { url: 'https://h.example.com', linkedAt: 1 };
    // split ACTIVE (canvasOrigin set) + sidecar opts in → admitted, body = .tsx.
    const ctx = makeCtx(HUB, 'http://localhost:9');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'opted.tsx'), 'export default () => null;');
    writeFileSync(
      join(ctx.paths.designRoot, 'ui', 'opted.meta.json'),
      JSON.stringify({ syncable: true })
    );
    const list = await discoverCanvases(ctx);
    const opted = list.find((c) => c.slug === 'ui-opted');
    expect(opted).toBeDefined();
    expect(opted?.html).toBe(join(ctx.paths.designRoot, 'ui', 'opted.tsx'));
  });

  test('does NOT admit an opted-in .tsx when the split is OFF (the coupling)', async () => {
    // Same opt-in, but canvasOrigin undefined → sandbox not in force → refused.
    const ctx = makeCtx({ url: 'https://h.example.com', linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'opted.tsx'), 'export default () => null;');
    writeFileSync(
      join(ctx.paths.designRoot, 'ui', 'opted.meta.json'),
      JSON.stringify({ syncable: true })
    );
    const list = await discoverCanvases(ctx);
    expect(list.map((c) => c.slug)).not.toContain('ui-opted');
  });

  test('does NOT admit a .tsx without the opt-in even when the split is active', async () => {
    const ctx = makeCtx({ url: 'https://h.example.com', linkedAt: 1 }, 'http://localhost:9');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'plain.tsx'), 'export default () => null;');
    // sidecar present but syncable:false → still refused.
    writeFileSync(
      join(ctx.paths.designRoot, 'ui', 'plain.meta.json'),
      JSON.stringify({ syncable: false, title: 'Plain' })
    );
    const list = await discoverCanvases(ctx);
    expect(list.map((c) => c.slug)).not.toContain('ui-plain');
  });
});

describe('scanCanvases', () => {
  test('tallies .tsx canvases separately from syncable .html', async () => {
    const ctx = makeCtx({ url: 'https://h.example.com', linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'a.html'), '');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'b.tsx'), '');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'c.tsx'), '');

    const scan = await scanCanvases(ctx);
    expect(scan.canvases.map((c) => c.slug)).toEqual(['ui-a']);
    expect(scan.tsxCount).toBe(2);
  });
});

// DDR-079 (was DDR-072) — TSX sync defaults ON. A .tsx with no explicit sidecar
// verdict syncs by default; `syncTsx: false` opts the project out; the per-canvas
// sidecar still wins; the Lock-2 sandbox coupling is preserved.
describe('scanCanvases — project-level syncTsx default-on (DDR-079)', () => {
  test('explicit syncTsx:true + sandbox ON admits a .tsx WITHOUT a per-canvas opt-in', async () => {
    const ctx = makeCtx(
      { url: 'https://h.example.com', linkedAt: 1, syncTsx: true },
      'http://localhost:9'
    );
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'free.tsx'), 'export default () => null;');
    const scan = await scanCanvases(ctx);
    const free = scan.canvases.find((c) => c.slug === 'ui-free');
    expect(free).toBeDefined();
    expect(free?.html).toBe(join(ctx.paths.designRoot, 'ui', 'free.tsx'));
    expect(scan.tsxCount).toBe(0);
  });

  test('syncTsx:true is INERT when the sandbox split is OFF (Lock-2 coupling preserved)', async () => {
    // canvasOrigin undefined → sandbox not in force → no .tsx syncs, flag or not.
    const ctx = makeCtx({ url: 'https://h.example.com', linkedAt: 1, syncTsx: true });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'free.tsx'), 'export default () => null;');
    const scan = await scanCanvases(ctx);
    expect(scan.canvases.map((c) => c.slug)).not.toContain('ui-free');
    expect(scan.tsxCount).toBe(1);
  });

  test('per-canvas "syncable": false OVERRIDES syncTsx:true (sidecar wins)', async () => {
    const ctx = makeCtx(
      { url: 'https://h.example.com', linkedAt: 1, syncTsx: true },
      'http://localhost:9'
    );
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'secret.tsx'), 'export default () => null;');
    writeFileSync(
      join(ctx.paths.designRoot, 'ui', 'secret.meta.json'),
      JSON.stringify({ syncable: false, title: 'Secret' })
    );
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'open.tsx'), 'export default () => null;');
    const scan = await scanCanvases(ctx);
    const slugs = scan.canvases.map((c) => c.slug);
    expect(slugs).toContain('ui-open'); // no sidecar → project default
    expect(slugs).not.toContain('ui-secret'); // explicit opt-out wins
  });

  test('DDR-079: without the flag (syncTsx absent) a .tsx is admitted BY DEFAULT', async () => {
    const ctx = makeCtx({ url: 'https://h.example.com', linkedAt: 1 }, 'http://localhost:9');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'plain.tsx'), 'export default () => null;');
    const scan = await scanCanvases(ctx);
    expect(scan.canvases.map((c) => c.slug)).toContain('ui-plain'); // default ON
    expect(scan.tsxCount).toBe(0);
  });

  test('DDR-079: syncTsx:false opts the whole project OUT (.tsx not admitted)', async () => {
    const ctx = makeCtx(
      { url: 'https://h.example.com', linkedAt: 1, syncTsx: false },
      'http://localhost:9'
    );
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'plain.tsx'), 'export default () => null;');
    const scan = await scanCanvases(ctx);
    expect(scan.canvases.map((c) => c.slug)).not.toContain('ui-plain');
    expect(scan.tsxCount).toBe(1);
  });

  test('DDR-079: per-canvas "syncable": true still admits one .tsx even when project opted out', async () => {
    const ctx = makeCtx(
      { url: 'https://h.example.com', linkedAt: 1, syncTsx: false },
      'http://localhost:9'
    );
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'keep.tsx'), 'export default () => null;');
    writeFileSync(
      join(ctx.paths.designRoot, 'ui', 'keep.meta.json'),
      JSON.stringify({ syncable: true, title: 'Keep' })
    );
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'drop.tsx'), 'export default () => null;');
    const scan = await scanCanvases(ctx);
    const slugs = scan.canvases.map((c) => c.slug);
    expect(slugs).toContain('ui-keep'); // sidecar opt-in wins over project opt-out
    expect(slugs).not.toContain('ui-drop'); // project opted out
  });
});

describe('buildNoSyncablePayload', () => {
  test('TSX-only project: reason names the count + DDR-060', () => {
    const p = buildNoSyncablePayload('https://h.example.com', 3, '/proj/.design');
    expect(p.notSyncable).toBe(true);
    expect(p.tsxCount).toBe(3);
    expect(p.reason).toContain('3 TSX canvas(es)');
    expect(p.reason).toContain('DDR-060');
  });

  test('empty project: reason reports no canvases under the design root', () => {
    const p = buildNoSyncablePayload('https://h.example.com', 0, '/proj/.design');
    expect(p.tsxCount).toBe(0);
    expect(p.reason).toContain('no canvases found under /proj/.design');
  });
});

describe('toWsUrl', () => {
  test('https → wss', () => {
    expect(toWsUrl('https://hub.example.com')).toBe('wss://hub.example.com');
  });
  test('http → ws', () => {
    expect(toWsUrl('http://localhost:1234')).toBe('ws://localhost:1234');
  });
  test('passthrough for ws://', () => {
    expect(toWsUrl('ws://localhost:1234')).toBe('ws://localhost:1234');
  });
});

// DDR-102 — WS multiplexing: the default factory shares ONE
// HocuspocusProviderWebsocket per hub URL across all providers.
describe('createDefaultProviderFactory — shared socket multiplexing', () => {
  class FakeEmitter {
    handlers = new Map<string, Set<(arg?: unknown) => void>>();
    on(evt: string, cb: (arg?: unknown) => void) {
      if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
      this.handlers.get(evt)?.add(cb);
    }
    off(evt: string, cb: (arg?: unknown) => void) {
      this.handlers.get(evt)?.delete(cb);
    }
    emit(evt: string, arg?: unknown) {
      for (const cb of this.handlers.get(evt) ?? []) cb(arg);
    }
  }

  function makeFakeModule() {
    const sockets: Array<{ url: string; destroyed: boolean }> = [];
    const providers: Array<{
      name: string;
      attached: boolean;
      destroyed: boolean;
      socket: unknown;
    }> = [];

    class HocuspocusProviderWebsocket extends FakeEmitter {
      url: string;
      status = 'connecting';
      destroyed = false;
      constructor(cfg: { url: string }) {
        super();
        this.url = cfg.url;
        sockets.push(this);
      }
      destroy() {
        this.destroyed = true;
      }
    }

    class HocuspocusProvider extends FakeEmitter {
      configuration: { name: string; websocketProvider: unknown; document: unknown };
      awareness = undefined;
      synced = false;
      attached = false;
      destroyed = false;
      name: string;
      socket: unknown;
      constructor(cfg: { name: string; websocketProvider: unknown; document: unknown }) {
        super();
        this.configuration = cfg;
        this.name = cfg.name;
        this.socket = cfg.websocketProvider;
        providers.push(this);
      }
      attach() {
        this.attached = true;
      }
      destroy() {
        this.destroyed = true;
      }
    }

    return { mod: { HocuspocusProviderWebsocket, HocuspocusProvider }, sockets, providers };
  }

  test('N providers for one hub URL share ONE socket, each explicitly attached', async () => {
    const { mod, sockets, providers } = makeFakeModule();
    const { createDefaultProviderFactory } = await import('../sync/index.ts');
    const factory = createDefaultProviderFactory(async () => mod);

    await factory({ url: 'https://hub.example.com', token: 't', documentName: 'ui-a' });
    await factory({ url: 'https://hub.example.com', token: 't', documentName: 'ui-b' });
    await factory({ url: 'https://hub.example.com', token: 't', documentName: 'ui-c' });

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://hub.example.com');
    expect(providers).toHaveLength(3);
    for (const p of providers) {
      expect(p.attached).toBe(true);
      expect(p.socket).toBe(sockets[0]);
    }
  });

  test('provider destroy() detaches only; dispose() destroys the shared socket', async () => {
    const { mod, sockets, providers } = makeFakeModule();
    const { createDefaultProviderFactory } = await import('../sync/index.ts');
    const factory = createDefaultProviderFactory(async () => mod);

    const p1 = await factory({ url: 'https://h.example.com', token: 't', documentName: 'ui-a' });
    p1.destroy();
    expect(providers[0].destroyed).toBe(true);
    expect(sockets[0].destroyed).toBe(false); // socket survives provider death

    factory.dispose();
    expect(sockets[0].destroyed).toBe(true);
  });

  test('onStatus seeds from the SOCKET status and forwards provider status events', async () => {
    const { mod, sockets, providers } = makeFakeModule();
    const { createDefaultProviderFactory } = await import('../sync/index.ts');
    const factory = createDefaultProviderFactory(async () => mod);

    const wrapped = await factory({
      url: 'https://h.example.com',
      token: 't',
      documentName: 'ui-a',
    });
    const seen: string[] = [];
    const unsub = wrapped.onStatus?.((s) => seen.push(s));
    // Seeded from socket.status ('connecting') immediately.
    expect(seen).toEqual(['connecting']);
    // Provider-level forwarded events keep flowing.
    (providers[0] as unknown as FakeEmitter).emit('status', { status: 'connected' });
    expect(seen).toEqual(['connecting', 'connected']);
    unsub?.();
    (providers[0] as unknown as FakeEmitter).emit('status', { status: 'disconnected' });
    expect(seen).toEqual(['connecting', 'connected']); // unsubscribed
    expect(sockets).toHaveLength(1);
  });
});

// DDR-102 — auth-failure intelligence (classification, aggregation,
// destroy-on-permanent + re-probe) and the honest settled boot summary.
describe('validExpiry — a hub-reported deadline sane enough to schedule against', () => {
  const NOW = 1_000_000_000_000;
  test('accepts a plausible future integer', () => {
    expect(validExpiry(NOW + 12 * 60 * 60 * 1000, NOW)).toBe(NOW + 12 * 60 * 60 * 1000);
  });
  test('rejects a past or present stamp (falls to the invalid-token path instead)', () => {
    expect(validExpiry(NOW - 1, NOW)).toBeNull();
    expect(validExpiry(NOW, NOW)).toBeNull();
  });
  test('rejects an absurdly far-future stamp (the setTimeout-overflow trap)', () => {
    expect(validExpiry(NOW + 60 * 24 * 60 * 60 * 1000, NOW)).toBeNull(); // 60 days
  });
  test('rejects non-integers and non-numbers', () => {
    expect(validExpiry(NOW + 1000.5, NOW)).toBeNull();
    expect(validExpiry('soon', NOW)).toBeNull();
    expect(validExpiry(Number.NaN, NOW)).toBeNull();
    expect(validExpiry(Number.POSITIVE_INFINITY, NOW)).toBeNull();
    expect(validExpiry(undefined, NOW)).toBeNull();
  });
});

describe('classifyAuthFailure — permanent classes outrank the transient ones', () => {
  test('the invalid-token bucket refusal classifies as invalid-token, not rate-limit', () => {
    // The hub's invalid-token bucket says BOTH things. Filing it under
    // rate-limit (transient) made the runtime retry into the very bucket
    // refusing it — the alligators incident's 1840-vs-138 log ratio.
    expect(classifyAuthFailure('invalid token — rate limited, retry in up to 60s')).toBe(
      'invalid-token'
    );
  });

  test('plain reasons still land in their own classes', () => {
    expect(classifyAuthFailure('invalid token')).toBe('invalid-token');
    expect(classifyAuthFailure('token not authorized for this documentName')).toBe(
      'not-authorized'
    );
    expect(classifyAuthFailure('rate limit exceeded for this token — retry in up to 60s')).toBe(
      'rate-limit'
    );
    expect(classifyAuthFailure('permission-denied')).toBe('generic');
  });
});

describe('DDR-102 — auth-failure intelligence + boot summary', () => {
  function fakeTimerQueue() {
    let nextId = 1;
    const timers = new Map<number, { cb: () => void; ms: number }>();
    return {
      setTimer: (cb: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { cb, ms });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (h: ReturnType<typeof setTimeout>) => {
        timers.delete(h as unknown as number);
      },
      /** Fire every pending timer with ms <= maxMs (one sweep). */
      fire(maxMs: number) {
        for (const [id, t] of [...timers.entries()]) {
          if (t.ms <= maxMs) {
            timers.delete(id);
            t.cb();
          }
        }
      },
      pending: () => timers.size,
    };
  }

  /** Stub factory whose providers expose onAuthFailed + track destroys. */
  function authStubFactory() {
    const made: Array<{
      documentName: string;
      token: string | undefined;
      destroyed: boolean;
      emitAuthFailure: (reason: string) => void;
      document: Y.Doc;
    }> = [];
    const factory = (args: { documentName: string; token?: string; document?: Y.Doc }) => {
      const document = args.document ?? new Y.Doc();
      const cbs = new Set<(info: { reason: string }) => void>();
      const entry = {
        documentName: args.documentName,
        token: args.token,
        destroyed: false,
        emitAuthFailure: (reason: string) => {
          for (const cb of cbs) cb({ reason });
        },
        document,
      };
      made.push(entry);
      return {
        document,
        onAuthFailed(cb: (info: { reason: string }) => void) {
          cbs.add(cb);
          return () => cbs.delete(cb);
        },
        onceSynced() {
          return new Promise<void>(() => {}); // never settles (rejected docs)
        },
        destroy() {
          entry.destroyed = true;
        },
      };
    };
    return { factory, made };
  }

  test('classification + ONE aggregated warn + destroy-on-permanent + re-probe', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'a.html'), '<a/>');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'b.html'), '<b/>');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'c.html'), '<c/>');

    const timers = fakeTimerQueue();
    const { factory, made } = authStubFactory();
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(' '));
    };

    // The transient retry checks each document's due time against this clock;
    // the delay-bucket queue does not move one, so the test moves it with the
    // 5-minute sweep below.
    let nowMs = 0;
    try {
      const runtime = createSyncRuntime(ctx, {
        providerFactory: factory,
        auth: {
          warnDebounceMs: 2_000,
          reprobeMs: 300_000,
          settleTimeoutMs: 15_000,
          setTimer: timers.setTimer,
          clearTimer: timers.clearTimer,
          now: () => nowMs,
        },
      });
      await runtime?.start();
      expect(made).toHaveLength(3);
      // readdir order is not deterministic — address providers by slug.
      const bySlug = (slug: string) => {
        const m = made.find((p) => p.documentName === slug);
        if (!m) throw new Error(`no provider for ${slug}`);
        return m;
      };

      // Hub rejects: a + b permanently (scope), c transiently (rate limit).
      bySlug('ui-a').emitAuthFailure('token not authorized for this documentName');
      bySlug('ui-b').emitAuthFailure('token not authorized for this documentName');
      bySlug('ui-c').emitAuthFailure('rate limit exceeded for this token');

      // Per-slug statuses are honest immediately.
      const status = runtime?.status();
      expect(status?.docs?.rejected).toBe(3);
      expect(status?.rejectedSlugs?.sort()).toEqual(['ui-a', 'ui-b', 'ui-c']);

      // Permanent classes destroyed (retry storm stopped); transient keeps its
      // provider until the paced retry swaps it (asserted below).
      expect(bySlug('ui-a').destroyed).toBe(true);
      expect(bySlug('ui-b').destroyed).toBe(true);
      expect(bySlug('ui-c').destroyed).toBe(false);

      // No warn yet (debounced); ONE aggregated warn after the window.
      const authWarnsBefore = warns.filter((w) => w.includes('auth rejections')).length;
      expect(authWarnsBefore).toBe(0);
      timers.fire(2_000);
      const authWarns = warns.filter((w) => w.includes('auth rejections'));
      expect(authWarns).toHaveLength(1);
      // Reason-specific hints, both classes in the one warn.
      expect(authWarns[0]).toContain('not-authorized');
      expect(authWarns[0]).toContain('rate-limit');
      expect(authWarns[0]).toContain('mint a hub-wide token');
      expect(authWarns[0]).toContain('HUB_CONN_RATE_LIMIT');

      // Re-probe (5 min): the two permanently-rejected docs reconnect with the
      // SAME doc instance (agent wiring survives the provider swap) — and so
      // does the rate-limited one, on its own shorter timer. This used to pin
      // only a + b: nothing ever asked whether ui-c came back, and it didn't
      // (RCA issue-sync-rate-limited-docs-never-retried).
      const docA = bySlug('ui-a').document;
      const docC = bySlug('ui-c').document;
      nowMs = 300_000;
      timers.fire(300_000);
      await new Promise((res) => setTimeout(res, 10));
      const reprobed = made.slice(3);
      expect(reprobed.map((m) => m.documentName).sort()).toEqual(['ui-a', 'ui-b', 'ui-c']);
      expect(reprobed.find((m) => m.documentName === 'ui-a')?.document).toBe(docA);
      expect(reprobed.find((m) => m.documentName === 'ui-c')?.document).toBe(docC);
      expect(bySlug('ui-c').destroyed).toBe(true);

      await runtime?.stop();
    } finally {
      console.warn = origWarn;
    }
  });

  test('invalid-token triggers ONE silent renewal and an immediate re-probe with the fresh token', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_stale');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'a.html'), '<a/>');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'b.html'), '<b/>');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'c.html'), '<c/>');

    const timers = fakeTimerQueue();
    const { factory, made } = authStubFactory();
    let renewCalls = 0;
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = () => {};
    console.log = () => {};
    try {
      const runtime = createSyncRuntime(ctx, {
        providerFactory: factory,
        auth: {
          warnDebounceMs: 2_000,
          reprobeMs: 300_000,
          settleTimeoutMs: 15_000,
          setTimer: timers.setTimer,
          clearTimer: timers.clearTimer,
          renewCredential: async () => {
            renewCalls++;
            return { token: 'mau_fresh', expiresAt: null };
          },
        },
      });
      await runtime?.start();
      expect(made).toHaveLength(3);
      expect(made.every((m) => m.token === 'mau_stale')).toBe(true);

      // The whole burst rejects with the expired credential…
      for (const m of made.slice(0, 3)) m.emitAuthFailure('invalid token');
      await new Promise((res) => setTimeout(res, 10));

      // …ONE renewal (single-flight), and the re-probe happened NOW — no
      // 5-minute wait — with the fresh token on every reconnected provider.
      expect(renewCalls).toBe(1);
      const reprobed = made.slice(3);
      expect(reprobed.map((m) => m.documentName).sort()).toEqual(['ui-a', 'ui-b', 'ui-c']);
      expect(reprobed.every((m) => m.token === 'mau_fresh')).toBe(true);

      await runtime?.stop();
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }
  });

  test('F1: a hub refusing on VOLUME cannot drive a renewal storm — the cap stops it', async () => {
    // The regression this whole review turned on. A cell refusing its own
    // clients with "invalid token — rate limited" classifies permanent →
    // triggers renewal → renewal succeeds (token was fine) → reprobe → every
    // reconnected doc is refused again → loop. Reproduced at 2342/s before the
    // cap. Here every reconnected provider auto-re-rejects, so without the cap
    // this test would spin forever; with it, renewals are bounded.
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_stale');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'a.html'), '<a/>');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'b.html'), '<b/>');

    let renewCalls = 0;
    let providersMade = 0;
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = () => {};
    console.log = () => {};
    // Every provider auto-rejects with the volume-refusal string the moment a
    // failure handler is attached — modelling a full hub bucket.
    const factory = (args: { documentName: string; token?: string; document?: Y.Doc }) => {
      const document = args.document ?? new Y.Doc();
      providersMade++;
      return {
        document,
        onAuthFailed(cb: (info: { reason: string }) => void) {
          queueMicrotask(() => cb({ reason: 'invalid token — rate limited, retry in up to 60s' }));
          return () => {};
        },
        onceSynced: () => new Promise<void>(() => {}),
        destroy() {},
      };
    };
    try {
      const runtime = createSyncRuntime(ctx, {
        providerFactory: factory,
        auth: {
          warnDebounceMs: 2_000,
          reprobeMs: 300_000,
          settleTimeoutMs: 15_000,
          setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
          clearTimer: () => {},
          renewMinIntervalMs: 0, // isolate the CAP from the floor
          renewCredential: async () => {
            renewCalls++;
            return { token: `mau_fresh_${renewCalls}`, expiresAt: null };
          },
        },
      });
      await runtime?.start();
      // Let the storm run itself out — if the cap failed, this never settles
      // and the test times out (which is itself the failure signal).
      for (let i = 0; i < 20; i++) await new Promise((res) => setTimeout(res, 5));

      // Bounded by the cap (default 3), NOT thousands.
      expect(renewCalls).toBeLessThanOrEqual(3);
      expect(renewCalls).toBeGreaterThan(0);
      // Providers created is likewise bounded — no runaway reconnect fan-out.
      expect(providersMade).toBeLessThan(20);
      await runtime?.stop();
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }
  });

  test('F1: the frequency floor collapses a rapid second burst to no extra renewal', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_stale');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'a.html'), '<a/>');

    let renewCalls = 0;
    let clock = 1_000_000;
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = () => {};
    console.log = () => {};
    const { factory, made } = authStubFactory();
    try {
      const runtime = createSyncRuntime(ctx, {
        providerFactory: factory,
        auth: {
          warnDebounceMs: 2_000,
          reprobeMs: 300_000,
          settleTimeoutMs: 15_000,
          setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
          clearTimer: () => {},
          now: () => clock,
          renewMinIntervalMs: 60_000,
          renewCredential: async () => {
            renewCalls++;
            return { token: 'mau_fresh', expiresAt: null };
          },
        },
      });
      await runtime?.start();
      made[0]?.emitAuthFailure('invalid token');
      await new Promise((res) => setTimeout(res, 10));
      expect(renewCalls).toBe(1);
      // A second rejection 10 s later (inside the 60 s floor) → no new renewal.
      clock += 10_000;
      made[0]?.emitAuthFailure('invalid token');
      await new Promise((res) => setTimeout(res, 10));
      expect(renewCalls).toBe(1);
      // Past the floor → renewal is allowed again.
      clock += 60_000;
      made[0]?.emitAuthFailure('invalid token');
      await new Promise((res) => setTimeout(res, 10));
      expect(renewCalls).toBe(2);
      await runtime?.stop();
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }
  });

  test('a failed renewal changes nothing — rejected docs wait for the slow re-probe as before', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_stale');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'a.html'), '<a/>');

    const timers = fakeTimerQueue();
    const { factory, made } = authStubFactory();
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = () => {};
    console.log = () => {};
    try {
      const runtime = createSyncRuntime(ctx, {
        providerFactory: factory,
        auth: {
          warnDebounceMs: 2_000,
          reprobeMs: 300_000,
          settleTimeoutMs: 15_000,
          setTimer: timers.setTimer,
          clearTimer: timers.clearTimer,
          renewCredential: async () => null, // signed out / revoked / self-hosted
        },
      });
      await runtime?.start();
      made[0]?.emitAuthFailure('invalid token');
      await new Promise((res) => setTimeout(res, 10));

      // No immediate re-probe (the renewal failed) — the doc stays rejected…
      expect(made).toHaveLength(1);
      expect(runtime?.status()?.docs?.rejected).toBe(1);
      // …until the slow re-probe fires, with the ORIGINAL token (unchanged).
      timers.fire(300_000);
      await new Promise((res) => setTimeout(res, 10));
      expect(made).toHaveLength(2);
      expect(made[1]?.token).toBe('mau_stale');

      await runtime?.stop();
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }
  });

  test('a stored expiry arms a pre-expiry renewal at ~80% of the remaining life', async () => {
    const url = 'https://hub.example.com';
    const cfgPath = process.env.HUBS_CONFIG_PATH;
    if (!cfgPath) throw new Error('HUBS_CONFIG_PATH not set by beforeEach');
    writeFileSync(
      cfgPath,
      JSON.stringify({
        hubs: { [url]: { token: 'mau_stale', linkedAt: 1, expiresAt: Date.now() + 100_000 } },
      })
    );
    chmodSync(cfgPath, 0o600);
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'a.html'), '<a/>');

    const timers = fakeTimerQueue();
    const { factory } = authStubFactory();
    let renewCalls = 0;
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = () => {};
    console.log = () => {};
    try {
      const runtime = createSyncRuntime(ctx, {
        providerFactory: factory,
        auth: {
          warnDebounceMs: 2_000,
          reprobeMs: 300_000,
          settleTimeoutMs: 15_000,
          setTimer: timers.setTimer,
          clearTimer: timers.clearTimer,
          renewCredential: async () => {
            renewCalls++;
            return { token: 'mau_fresh', expiresAt: null };
          },
        },
      });
      await runtime?.start();
      // 100 s of life left → the renewal timer sits at 80 s, so a 30 s sweep
      // must not reach it (only the settle timers live down there)…
      timers.fire(30_000);
      await new Promise((res) => setTimeout(res, 5));
      expect(renewCalls).toBe(0);
      // …and the 80 s sweep fires it, once, without any rejection happening.
      timers.fire(80_000);
      await new Promise((res) => setTimeout(res, 5));
      expect(renewCalls).toBe(1);

      await runtime?.stop();
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }
  });

  test('a successful re-probe clears the refusal, and the reconcile is a separate word', async () => {
    // A REGRESSION GUARD, not a falsifier — this already held. It is here
    // because the clear moved: it used to sit at the BOTTOM of the
    // post-handshake path, below a reconcile that can throw into a rejection
    // `settleWait` swallows, so a document that reconnected fine but failed to
    // settle on disk would have kept telling the user to go fix a credential
    // that was never the problem. The clear now runs on the handshake, and the
    // reconcile reports separately (`pending` vs `connected`) and loudly.
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'a.html'), '<a/>');

    const timers = fakeTimerQueue();
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = () => {};
    console.log = () => {};

    let round = 0;
    const factory = (args: { documentName: string; document?: Y.Doc }) => {
      const document = args.document ?? new Y.Doc();
      const first = round++ === 0;
      return {
        document,
        onAuthFailed(cb: (info: { reason: string }) => void) {
          if (first) queueMicrotask(() => cb({ reason: 'token not authorized' }));
          return () => {};
        },
        onceSynced: () => (first ? new Promise<void>(() => {}) : Promise.resolve()),
        destroy() {},
      };
    };

    try {
      const runtime = createSyncRuntime(ctx, {
        providerFactory: factory,
        auth: {
          warnDebounceMs: 2_000,
          reprobeMs: 300_000,
          settleTimeoutMs: 15_000,
          setTimer: timers.setTimer,
          clearTimer: timers.clearTimer,
        },
      });
      await runtime?.start();
      await new Promise((res) => setTimeout(res, 10));
      expect(runtime?.status().docs?.rejected).toBe(1);

      timers.fire(300_000);
      await new Promise((res) => setTimeout(res, 40));

      expect(runtime?.status().docs?.rejected).toBe(0);
      expect(runtime?.status().rejectedSlugs ?? []).toEqual([]);

      await runtime?.stop();
    } finally {
      console.warn = origWarn;
      console.log = origLog;
    }
  });

  test('a new process never serves the previous one’s verdict, not even mid-boot', async () => {
    // `_sync.json` is a file and `/_sync-status` returns whatever is in it. The
    // first honest snapshot of a run is not written until every provider has
    // been built — after a scan AND a listing fetch that waits up to 6 seconds.
    // For that whole window the CLI and the browser banner were reading the
    // LAST run's counters as current. So the window is what this asserts: the
    // fetch is held open, and the file must ALREADY be clean.
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    const statusFile = join(ctx.paths.designRoot, '_sync.json');
    writeFileSync(
      statusFile,
      JSON.stringify({
        url,
        canvases: 76,
        state: 'online',
        docs: { synced: 0, pending: 3, rejected: 73 },
        rejectedSlugs: ['ui-a', 'ui-b'],
      })
    );
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'a.html'), '<a/>');

    const realFetch = globalThis.fetch;
    let releaseListing: () => void = () => {};
    const listingReached = new Promise<void>((res) => {
      globalThis.fetch = (async () => {
        res();
        await new Promise<void>((r) => {
          releaseListing = r;
        });
        return new Response(JSON.stringify({ documents: [] }), { status: 200 });
      }) as typeof fetch;
    });

    try {
      const { factory } = inMemoryProviderFactory();
      const runtime = createSyncRuntime(ctx, { providerFactory: factory });
      const booting = runtime?.start();
      await listingReached;

      // Mid-boot, with the listing still in flight — exactly where the stale
      // file used to be authoritative.
      const midBoot = JSON.parse(readFileSync(statusFile, 'utf8'));
      expect(midBoot.docs.rejected).toBe(0);
      expect(midBoot.rejectedSlugs ?? []).toEqual([]);
      expect(midBoot.state).toBe('connecting');

      releaseListing();
      await booting;
      await runtime?.stop();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('boot summary prints AFTER settle with honest counts (not the premature N/N)', async () => {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'good.html'), '<g/>');
    writeFileSync(join(ctx.paths.designRoot, 'ui', 'bad.html'), '<b/>');

    const timers = fakeTimerQueue();
    const logs: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    console.warn = () => {};

    // 'good' syncs immediately; 'bad' is auth-rejected and never settles.
    const { factory, made } = authStubFactory();
    const mixedFactory = (args: { documentName: string; document?: Y.Doc }) => {
      if (args.documentName === 'ui-good') {
        const document = args.document ?? new Y.Doc();
        return {
          document,
          async onceSynced() {},
          destroy() {},
        };
      }
      return factory(args);
    };

    try {
      const runtime = createSyncRuntime(ctx, {
        providerFactory: mixedFactory,
        auth: {
          settleTimeoutMs: 15_000,
          warnDebounceMs: 2_000,
          setTimer: timers.setTimer,
          clearTimer: timers.clearTimer,
        },
      });
      await runtime?.start();
      made.find((m) => m.documentName === 'ui-bad')?.emitAuthFailure('invalid token');
      // Boot prints the linking line immediately, NOT a premature N/N.
      expect(logs.some((l) => l.includes('linking to'))).toBe(true);
      expect(logs.some((l) => l.includes('synced'))).toBe(false);

      // Let the good handshake's microtask chain run, then hit the ceiling.
      await new Promise((res) => setTimeout(res, 10));
      timers.fire(15_000);
      await new Promise((res) => setTimeout(res, 10));

      const summary = logs.find((l) => l.includes('synced'));
      expect(summary).toBeDefined();
      expect(summary).toContain('1/2 synced');
      expect(summary).toContain('1 auth-rejected');
      expect(summary).toContain('ui-bad');
      expect(summary).toContain('invalid-token');

      // lastSyncAt reflects the real reconcile activity of the good canvas.
      expect(runtime?.status()?.lastSyncAt).not.toBeNull();
      expect(runtime?.status()?.docs?.synced).toBe(1);

      await runtime?.stop();
    } finally {
      console.log = origLog;
      console.warn = origWarn;
    }
  });
});

// ── A transient refusal on the shared socket is retried by the runtime ───────
//
// RCA `issue-sync-rate-limited-docs-never-retried` (2026-09-11). `rate-limit`
// and `generic` refusals were parked on "the provider's built-in backoff" —
// and under DDR-102 multiplexing there is none: a provider re-sends its token
// only when the SHARED socket opens, and the socket never closes while the
// documents that did authenticate keep it busy. 16 of 112 canvases stayed
// `auth-rejected` for the life of the process on design.studyfi.com.
// FAIL-FIRST: every test below except the stop-safety one goes red on the
// pre-fix runtime (no retry lane — `ui-c` is never re-created). Each guard is
// also pinned on its own: dropping the batch budget, the doubling, the
// single-flight check, the strike reset in `clearRejection`, or the timer
// clear in `stop()` turns exactly its test red.
describe('transient auth refusals — the runtime-owned paced retry', () => {
  /**
   * A clocked scheduler. `fakeTimerQueue` above fires by DELAY bucket, which
   * cannot say "never more than N re-auths inside any 60 s" or "not before a
   * full window": this one keeps absolute due times, fires in due order, and
   * runs timers armed while it advances.
   */
  function fakeClock() {
    let now = 1_000_000;
    let nextId = 1;
    const timers = new Map<number, { cb: () => void; at: number }>();
    const flush = () => new Promise((res) => setTimeout(res, 0));
    return {
      now: () => now,
      setTimer: (cb: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { cb, at: now + ms });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (h: ReturnType<typeof setTimeout>) => {
        timers.delete(h as unknown as number);
      },
      async advance(ms: number) {
        const end = now + ms;
        for (;;) {
          let dueId = -1;
          let dueAt = Number.POSITIVE_INFINITY;
          for (const [id, t] of timers) {
            if (t.at <= end && t.at < dueAt) {
              dueAt = t.at;
              dueId = id;
            }
          }
          if (dueId === -1) break;
          const t = timers.get(dueId);
          timers.delete(dueId);
          now = dueAt;
          t?.cb();
          // connectCanvas awaits the factory — let it land before moving on.
          await flush();
          await flush();
        }
        now = end;
        await flush();
      },
      pending: () => timers.size,
    };
  }

  /** Providers that refuse on demand and complete a handshake on demand. */
  function retryStubFactory(clock: { now: () => number }) {
    const made: Array<{
      documentName: string;
      at: number;
      destroyed: boolean;
      document: Y.Doc;
      emitAuthFailure: (reason: string) => void;
      sync: () => void;
    }> = [];
    const factory = (args: { documentName: string; document?: Y.Doc }) => {
      const document = args.document ?? new Y.Doc();
      const cbs = new Set<(info: { reason: string }) => void>();
      let resolveSynced: () => void = () => {};
      const synced = new Promise<void>((res) => {
        resolveSynced = res;
      });
      const entry = {
        documentName: args.documentName,
        at: clock.now(),
        destroyed: false,
        document,
        emitAuthFailure: (reason: string) => {
          for (const cb of cbs) cb({ reason });
        },
        sync: () => resolveSynced(),
      };
      made.push(entry);
      return {
        document,
        onAuthFailed(cb: (info: { reason: string }) => void) {
          cbs.add(cb);
          return () => cbs.delete(cb);
        },
        onceSynced: () => synced,
        destroy() {
          entry.destroyed = true;
        },
      };
    };
    const of = (slug: string) => made.filter((m) => m.documentName === slug);
    const latest = (slug: string) => {
      const all = of(slug);
      const m = all[all.length - 1];
      if (!m) throw new Error(`no provider for ${slug}`);
      return m;
    };
    return { factory, made, of, latest };
  }

  const RATE_LIMIT = 'rate limit exceeded for this token — retry in up to 60s';
  const WINDOW = 60_000;
  const JITTER = 15_000;

  async function boot(
    slugs: string[],
    auth: Record<string, unknown> = {}
  ): Promise<{
    runtime: ReturnType<typeof createSyncRuntime>;
    clock: ReturnType<typeof fakeClock>;
    stub: ReturnType<typeof retryStubFactory>;
  }> {
    const url = 'https://hub.example.com';
    writeHubsConfig(url, 'mau_test');
    const ctx = makeCtx({ url, linkedAt: 1 });
    for (const s of slugs) writeFileSync(join(ctx.paths.designRoot, 'ui', `${s}.html`), `<${s}/>`);
    const clock = fakeClock();
    const stub = retryStubFactory(clock);
    const runtime = createSyncRuntime(ctx, {
      providerFactory: stub.factory,
      auth: {
        warnDebounceMs: 2_000,
        reprobeMs: 300_000,
        settleTimeoutMs: 15_000,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        now: clock.now,
        transientRetryMs: WINDOW,
        transientJitterMs: JITTER,
        random: () => 0.999,
        ...auth,
      },
    });
    await runtime?.start();
    return { runtime, clock, stub };
  }

  let origWarn: typeof console.warn;
  let origLog: typeof console.log;
  beforeEach(() => {
    origWarn = console.warn;
    origLog = console.log;
    console.warn = () => {};
    console.log = () => {};
  });
  afterEach(() => {
    console.warn = origWarn;
    console.log = origLog;
  });

  test('a rate-limited document is re-authenticated after one window + jitter, alone, on its own doc', async () => {
    const { runtime, clock, stub } = await boot(['a', 'b', 'c']);
    expect(stub.made).toHaveLength(3);
    const first = stub.latest('ui-c');
    first.emitAuthFailure(RATE_LIMIT);
    expect(runtime?.status().rejectedSlugs).toEqual(['ui-c']);

    // Not inside the window the hub just refused in.
    await clock.advance(WINDOW - 1);
    expect(stub.of('ui-c')).toHaveLength(1);

    // One window + the maximum jitter later: exactly ONE new provider, for
    // ui-c, on the SAME Y.Doc (agent wiring survives the swap).
    await clock.advance(JITTER + 1);
    expect(stub.of('ui-c')).toHaveLength(2);
    expect(stub.latest('ui-c').document).toBe(first.document);
    expect(first.destroyed).toBe(true);
    // The documents that authenticated are untouched.
    expect(stub.of('ui-a')).toHaveLength(1);
    expect(stub.of('ui-b')).toHaveLength(1);
    expect(stub.latest('ui-a').destroyed).toBe(false);
    expect(stub.latest('ui-b').destroyed).toBe(false);

    // The hub accepts this time → the refusal clears.
    stub.latest('ui-c').sync();
    await clock.advance(10);
    expect(runtime?.status().rejectedSlugs ?? []).toEqual([]);
    expect(runtime?.status().docs?.rejected).toBe(0);

    await runtime?.stop();
  });

  test('the generic class (every pre-DDR-102 hub) takes the same recovery path', async () => {
    const { runtime, clock, stub } = await boot(['a', 'c']);
    stub.latest('ui-c').emitAuthFailure('permission-denied');
    await clock.advance(WINDOW + JITTER);
    expect(stub.of('ui-c')).toHaveLength(2);
    expect(stub.of('ui-a')).toHaveLength(1);
    stub.latest('ui-c').sync();
    await clock.advance(10);
    expect(runtime?.status().rejectedSlugs ?? []).toEqual([]);
    await runtime?.stop();
  });

  test('batch pacing: 40 refusals under a budget of 10 → never more than 10 re-auths in any 60 s', async () => {
    const slugs = Array.from({ length: 40 }, (_, i) => `d${String(i).padStart(2, '0')}`);
    const { runtime, clock, stub } = await boot(slugs, { transientBatch: 10 });
    expect(stub.made).toHaveLength(40);
    const bootCount = stub.made.length;
    for (const m of [...stub.made]) m.emitAuthFailure(RATE_LIMIT);
    expect(runtime?.status().docs?.rejected).toBe(40);

    // First window after the refusal: exactly the budget.
    await clock.advance(WINDOW + JITTER);
    expect(stub.made.length - bootCount).toBe(10);

    // Drain the rest, then check the sliding-window property over every retry.
    await clock.advance(10 * WINDOW);
    const retries = stub.made.slice(bootCount);
    expect(retries).toHaveLength(40);
    expect(new Set(retries.map((r) => r.documentName)).size).toBe(40);
    for (const r of retries) {
      const inSpan = retries.filter((x) => x.at >= r.at && x.at < r.at + WINDOW).length;
      expect(inSpan).toBeLessThanOrEqual(10);
    }
    await runtime?.stop();
  });

  test('backoff: repeat refusals double the wait up to the re-probe cap; one handshake resets it', async () => {
    const { runtime, clock, stub } = await boot(['c'], { transientJitterMs: 0 });
    const waitFor = async (expected: number) => {
      const before = stub.of('ui-c').length;
      stub.latest('ui-c').emitAuthFailure(RATE_LIMIT);
      await clock.advance(expected - 1);
      expect(stub.of('ui-c')).toHaveLength(before);
      await clock.advance(1);
      expect(stub.of('ui-c')).toHaveLength(before + 1);
    };
    await waitFor(60_000);
    await waitFor(120_000);
    await waitFor(240_000);
    await waitFor(300_000); // 480 s, capped at AUTH_REPROBE_MS
    await waitFor(300_000);

    // A handshake that lands resets the ladder.
    stub.latest('ui-c').sync();
    await clock.advance(10);
    expect(runtime?.status().rejectedSlugs ?? []).toEqual([]);
    await waitFor(60_000);
    await runtime?.stop();
  });

  test('single-flight: a second burst while the retry is armed arms no second timer', async () => {
    const { runtime, clock, stub } = await boot(['a', 'b', 'c']);
    // Past the boot settle ceiling, so only the lanes under test hold timers.
    await clock.advance(20_000);
    const base = clock.pending();

    stub.latest('ui-c').emitAuthFailure(RATE_LIMIT);
    await clock.advance(2_500); // the aggregated warn flushes
    expect(clock.pending()).toBe(base + 1);

    stub.latest('ui-b').emitAuthFailure(RATE_LIMIT);
    await clock.advance(2_500);
    expect(clock.pending()).toBe(base + 1);

    // Both recover, each exactly once.
    await clock.advance(2 * (WINDOW + JITTER));
    expect(stub.of('ui-c')).toHaveLength(2);
    expect(stub.of('ui-b')).toHaveLength(2);
    expect(stub.of('ui-a')).toHaveLength(1);
    await runtime?.stop();
  });

  test('stop() with a retry armed clears it and creates no provider afterwards', async () => {
    const { runtime, clock, stub } = await boot(['a', 'c']);
    stub.latest('ui-c').emitAuthFailure(RATE_LIMIT);
    await runtime?.stop();
    // Cleared, not merely defused: asserted BEFORE advancing, because a timer
    // left armed fires during `advance` and leaves the queue either way — and
    // the `stopped` guard inside it would still keep the provider count flat.
    expect(clock.pending()).toBe(0);
    const after = stub.made.length;
    await clock.advance(10 * WINDOW);
    expect(stub.made).toHaveLength(after);
  });
});
