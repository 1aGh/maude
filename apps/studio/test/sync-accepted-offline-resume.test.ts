// Phase 8 (reported as a P0 "silent loss after an offline episode"): an edit
// made while the hub is unreachable, then a teammate's edit to the same canvas
// right after it comes back. Two studio sync runtimes against ONE real hub
// (spawned under Node — Bun cannot load better-sqlite3), in both project modes:
// accepted revisions (`--transactions`, DDR-241) and legacy shared-doc. The hub
// is FROZEN (SIGSTOP), not killed: its sockets stay open, so the offline side's
// proposal sits in a half-delivered request instead of failing fast — the
// shape a laptop lid or a flaky Wi-Fi produces.
//
// The report watched only the designer, whose offline save was accepted first.
// The teammate's later, overlapping save is the one the hub rejects — kept on
// the TEAMMATE's disk, named in the teammate's conflicts, the project's version
// saved beside it. So the oracle reads BOTH peers (and the hub's head): either
// both disks agree, or every disk that differs belongs to a peer holding a
// conflict on that very canvas. Never two silently different copies. Each
// direction runs: designer offline then teammate, teammate offline then
// designer, both offline, and the no-pause baseline.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import {
  createDefaultProviderFactory,
  createSyncRuntime,
  type DisposableProviderFactory,
  type ProviderFactory,
  type SyncProvider,
  type SyncRuntime,
} from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY) {
  console.warn(
    '[sync-accepted-offline-resume] SKIPPED — apps/hub dependencies are not installed; this suite needs a real hub.'
  );
}

const src = (title: string) =>
  `export default function Home() {\n  return <h1 title="${title}">Home</h1>;\n}\n`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  ms = 20_000
): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (err) {
      last = err;
    }
    if (Date.now() > end)
      throw new Error(`timed out waiting for ${what}${last ? ` (${last})` : ''}`);
    await sleep(50);
  }
}

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'alice' | 'bob' | 'viewer', string>;
}

function startHub(dataDir: string, transactions: boolean): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'node',
      [FIXTURE, dataDir, '0', ...(transactions ? ['--transactions'] : [])],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
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
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) reject(new Error(`hub exited ${code}: ${buf}`));
    });
  });
}

function stopHub(hub: Hub): Promise<void> {
  return new Promise((resolve) => {
    if (hub.proc.exitCode !== null) return resolve();
    hub.proc.once('exit', () => resolve());
    hub.proc.kill('SIGCONT');
    hub.proc.kill('SIGTERM');
  });
}

function noopCallbacks(): RoomCallbacks {
  return { async seed() {}, async persistJson() {}, async persistBinary() {} };
}

interface Peer {
  name: string;
  ctx: Context;
  runtime: SyncRuntime;
  read: (rel: string) => string | null;
  write: (rel: string, text: string) => void;
  conflicts: () => unknown[];
}

function makeCtx(repoRoot: string, url: string): Context {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ canvasGroups: [{ label: 'Canvases', path: 'ui' }] })
  );
  return {
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
}

async function startPeer(
  name: string,
  repoRoot: string,
  url: string,
  providerFactory?: ProviderFactory
): Promise<Peer> {
  const ctx = makeCtx(repoRoot, url);
  const registry = createRegistry(noopCallbacks());
  const runtime = createSyncRuntime(ctx, {
    registry,
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
    ...(providerFactory ? { providerFactory } : {}),
  });
  if (!runtime) throw new Error(`${name}: runtime refused to start`);
  await runtime.start();
  const file = (rel: string) => join(ctx.paths.designRoot, rel);
  const read = (rel: string) => {
    try {
      return readFileSync(file(rel), 'utf8');
    } catch {
      return null;
    }
  };
  const write = (rel: string, text: string) => {
    writeFileSync(file(rel), text);
    ctx.bus.emit('fs:any', rel);
  };
  const conflicts = () =>
    ((runtime.status() as unknown as { conflicts?: unknown[] } | null)?.conflicts ?? []).slice();
  return { name, ctx, runtime, read, write, conflicts };
}

async function head(hub: Hub, path: string): Promise<string | null> {
  const auth = { authorization: `Bearer ${hub.tokens.owner}` };
  const b = (await (
    await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, { headers: auth })
  ).json()) as { docs: { path: string; lanes: Record<string, { hash: string }> }[] };
  const hash = b.docs.find((d) => d.path === path)?.lanes.html?.hash;
  if (!hash) return null;
  const blob = (await (
    await fetch(`${hub.http}/api/projects/current/v1/blobs/${hash}`, { headers: auth })
  ).json()) as { body: string };
  return blob.body;
}

type HubMode = 'transactions' | 'legacy';

function suite(mode: HubMode) {
  describe.skipIf(!HUB_READY)(
    `[${mode}] an edit while the hub is frozen, then a teammate edit`,
    () => {
      let root: string;
      let hub: Hub;
      let alice: Peer; // the teammate (seeds the project)
      let bob: Peer; // the designer (joins it)
      const saved: Record<string, string | undefined> = {};

      beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), `offline-resume-${mode}-`));
        for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
          saved[k] = process.env[k];
        process.env.MAUDE_SYNC_IN_CI = '1';
        hub = await startHub(join(root, 'hub'), mode === 'transactions');
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
        writeFileSync(join(root, 'alice', 'design', 'ui', 'home.tsx'), src('Hello'));
        alice = await startPeer('alice', join(root, 'alice'), aliceUrl);
        // Bob joins a project that has content (an empty project's first canvas
        // is the supervisor's restart cycle, covered by the runtime suite).
        if (mode === 'transactions')
          await waitFor(async () => (await head(hub, 'ui/home.tsx')) !== null, 'the seed accepted');
        else await sleep(2_000);
        bob = await startPeer('bob', join(root, 'bob'), bobUrl);
        await waitFor(
          async () => {
            await bob.runtime.pullRemoteNow();
            return bob.read('ui/home.tsx') === src('Hello');
          },
          'bob to receive the seed',
          45_000
        );
      }, 120_000);

      afterAll(async () => {
        await alice?.runtime.stop();
        await bob?.runtime.stop();
        if (hub) await stopHub(hub);
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
        rmSync(root, { recursive: true, force: true });
      });

      /** A fresh canvas both peers hold at `value`, before the scenario starts. */
      async function settle(rel: string, value: string) {
        alice.write(rel, value);
        await alice.runtime.rescanNow();
        await waitFor(
          async () => {
            await bob.runtime.pullRemoteNow();
            if (alice.read(rel) !== value || bob.read(rel) !== value) return false;
            return mode === 'legacy' || (await head(hub, rel)) === value;
          },
          `both peers to settle on ${value}`,
          45_000
        );
        // Let the legacy shared document's echo die down before the outage.
        await sleep(1_500);
      }

      /**
       * The invariant. After the dust settles, either both disks agree (and, in
       * transactions mode, equal the hub's accepted head), or every disk that
       * differs is held by a peer that names THIS canvas in a conflict and kept
       * the project's version as a recovery copy. Never two silently different
       * copies. And neither save is gone from the world.
       */
      async function expectNoSilentLoss(rel: string, saves: { alice: string; bob: string }) {
        const slug = rel.replace(/\.tsx$/, '').replace(/\//g, '-');
        let snapshot = '';
        const held = (p: Peer) => p.conflicts().some((c) => (c as { slug?: string }).slug === slug);
        await waitFor(
          async () => {
            const h = mode === 'transactions' ? await head(hub, rel) : null;
            const rows = [alice, bob].map((p) => ({ p: p.name, disk: p.read(rel), held: held(p) }));
            snapshot = JSON.stringify({ head: h, rows });
            if (mode === 'transactions') {
              if (!h) return false;
              return rows.every((r) => r.disk === h || r.held);
            }
            return rows[0].disk === rows[1].disk || rows.some((r) => r.held);
          },
          'convergence or a surfaced conflict on this canvas',
          60_000
        ).catch((e) => {
          throw new Error(`${(e as Error).message}\nstate: ${snapshot}`);
        });
        // Settled is not a passing glance: it holds for a while.
        await sleep(4_000);
        const h = mode === 'transactions' ? await head(hub, rel) : null;
        const rows = [alice, bob].map((p) => ({ p, disk: p.read(rel), held: held(p) }));
        console.log(`[offline-resume:${mode}] ${rel}: ${snapshot}`);
        if (mode === 'transactions') {
          for (const r of rows) {
            if (r.disk === h) continue;
            expect(r.held).toBe(true);
            const incoming = join(r.p.ctx.paths.historyDir, slug, 'sync-recovery', 'incoming.tsx');
            expect(readFileSync(incoming, 'utf8')).toBe(h as string);
          }
        } else if (rows[0].disk !== rows[1].disk) {
          // V2-8.17 (#121): the peer that holds the conflict kept its own text
          // and saved the project's version — the other peer's disk — beside it.
          expect(rows.some((r) => r.held)).toBe(true);
          for (const r of rows.filter((x) => x.held)) {
            const other = rows.find((x) => x !== r);
            const incoming = join(r.p.ctx.paths.historyDir, slug, 'sync-recovery', 'incoming.tsx');
            expect(readFileSync(incoming, 'utf8')).toBe(other?.disk as string);
          }
        }
        const titleOf = (s: string) => /title="([^"]*)"/.exec(s)?.[1] ?? s;
        const world = [h ?? '', ...rows.map((r) => r.disk ?? '')].join('\n');
        for (const value of [saves.alice, saves.bob]) {
          expect(world).toContain(titleOf(value));
        }
      }

      test('baseline (no pause): edits travel both ways', async () => {
        await settle('ui/s0.tsx', src('base 0'));
        bob.write('ui/s0.tsx', src('designer online'));
        await waitFor(() => alice.read('ui/s0.tsx') === src('designer online'), 'alice gets it');
        alice.write('ui/s0.tsx', src('teammate online'));
        await waitFor(() => bob.read('ui/s0.tsx') === src('teammate online'), 'bob gets it');
      }, 90_000);

      test('designer edits while the hub is frozen; teammate edits right after it resumes', async () => {
        await settle('ui/s1.tsx', src('base 1'));
        hub.proc.kill('SIGSTOP');
        bob.write('ui/s1.tsx', src('mine while offline'));
        await sleep(6_000);
        hub.proc.kill('SIGCONT');
        alice.write('ui/s1.tsx', src('theirs'));
        await expectNoSilentLoss('ui/s1.tsx', {
          bob: src('mine while offline'),
          alice: src('theirs'),
        });
      }, 120_000);

      test('teammate edits while the hub is frozen; designer edits right after it resumes', async () => {
        await settle('ui/s2.tsx', src('base 2'));
        hub.proc.kill('SIGSTOP');
        alice.write('ui/s2.tsx', src('teammate offline'));
        await sleep(6_000);
        hub.proc.kill('SIGCONT');
        bob.write('ui/s2.tsx', src('designer after'));
        await expectNoSilentLoss('ui/s2.tsx', {
          alice: src('teammate offline'),
          bob: src('designer after'),
        });
      }, 120_000);

      // Legacy (the shared Y.Text, DDR-064) used to merge two concurrent
      // full-file edits of the same span character by character — both peers
      // converged on an interleaving of the two titles with no notice (#121).
      // V2-8.17: the peer whose edit the hub took second detects the overlap
      // on reconnect, keeps its own text, and surfaces the conflict.
      test('both edit while the hub is frozen', async () => {
        await settle('ui/s3.tsx', src('base 3'));
        hub.proc.kill('SIGSTOP');
        bob.write('ui/s3.tsx', src('designer frozen'));
        await sleep(1_000);
        alice.write('ui/s3.tsx', src('teammate frozen'));
        await sleep(5_000);
        hub.proc.kill('SIGCONT');
        await expectNoSilentLoss('ui/s3.tsx', {
          bob: src('designer frozen'),
          alice: src('teammate frozen'),
        });
      }, 120_000);
    }
  );
}

suite('transactions');
suite('legacy');

// V2-8.17 (#121) — the legacy shared document while one peer is really AWAY
// (its sockets closed, not a frozen hub): designer offline, teammate offline,
// both offline; different parts still merge silently; and a peer without the
// check (a 1.x desktop) next to one with it. The side whose change the hub
// takes second keeps its own text, holds a conflict naming the canvas and saves
// the project's version beside it; the other side keeps its own; nobody holds
// an interleaving of the two.

/** The default factory, minus the V2-8.17 feed — a peer that never runs the check. */
function withoutOverlapCheck(f: DisposableProviderFactory): DisposableProviderFactory {
  const wrapped = (async (args: Parameters<ProviderFactory>[0]) => {
    const p = await f(args);
    const { onRemoteUpdate: _r, onConfirmed: _c, ...rest } = p;
    return rest as SyncProvider;
  }) as DisposableProviderFactory;
  wrapped.dispose = () => f.dispose();
  wrapped.reconnect = () => f.reconnect();
  wrapped.park = () => f.park?.();
  wrapped.unpark = () => f.unpark?.();
  return wrapped;
}

function apartSuite(label: string, v1Bob: boolean) {
  describe.skipIf(!HUB_READY)(`[legacy] ${label}`, () => {
    let root: string;
    let hub: Hub;
    let alice: Peer; // the teammate
    let bob: Peer; // the designer
    const factories = {} as Record<'alice' | 'bob', DisposableProviderFactory>;
    const saved: Record<string, string | undefined> = {};

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'offline-apart-'));
      for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
        saved[k] = process.env[k];
      process.env.MAUDE_SYNC_IN_CI = '1';
      hub = await startHub(join(root, 'hub'), false);
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
      factories.alice = createDefaultProviderFactory();
      const bobFactory = createDefaultProviderFactory();
      factories.bob = v1Bob ? withoutOverlapCheck(bobFactory) : bobFactory;
      mkdirSync(join(root, 'alice', 'design', 'ui'), { recursive: true });
      writeFileSync(join(root, 'alice', 'design', 'ui', 'home.tsx'), src('Hello'));
      alice = await startPeer('alice', join(root, 'alice'), aliceUrl, factories.alice);
      await sleep(2_000);
      bob = await startPeer('bob', join(root, 'bob'), bobUrl, factories.bob);
      await waitFor(
        async () => {
          await bob.runtime.pullRemoteNow();
          return bob.read('ui/home.tsx') === src('Hello');
        },
        'bob to receive the seed',
        45_000
      );
    }, 120_000);

    afterAll(async () => {
      await alice?.runtime.stop();
      await bob?.runtime.stop();
      factories.alice?.dispose();
      factories.bob?.dispose();
      if (hub) await stopHub(hub);
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(root, { recursive: true, force: true });
    });

    async function settle(rel: string, value: string) {
      alice.write(rel, value);
      await alice.runtime.rescanNow();
      await waitFor(
        async () => {
          await bob.runtime.pullRemoteNow();
          return alice.read(rel) === value && bob.read(rel) === value;
        },
        `both peers to settle on ${value}`,
        45_000
      );
      await sleep(1_500);
    }

    const slugOf = (rel: string) => rel.replace(/\.tsx$/, '').replace(/\//g, '-');
    const holds = (p: Peer, rel: string) =>
      p.conflicts().some((c) => (c as { slug?: string }).slug === slugOf(rel));

    /** The hub took `first`'s change first: both keep their own, `second` holds it. */
    async function expectKept(
      rel: string,
      first: Peer,
      firstSave: string,
      second: Peer,
      secondSave: string
    ) {
      let state = '';
      await waitFor(
        () => {
          state = JSON.stringify(
            [first, second].map((p) => ({ p: p.name, disk: p.read(rel), held: holds(p, rel) }))
          );
          return (
            first.read(rel) === firstSave && second.read(rel) === secondSave && holds(second, rel)
          );
        },
        `${second.name} to hold the conflict with both texts kept`,
        60_000
      ).catch((e) => {
        throw new Error(`${(e as Error).message}\nstate: ${state}`);
      });
      // Settled is not a passing glance: it holds for a while.
      await sleep(4_000);
      console.log(`[offline-apart] ${rel}: ${state}`);
      expect(first.read(rel)).toBe(firstSave);
      expect(second.read(rel)).toBe(secondSave);
      expect(holds(first, rel)).toBe(false);
      const incoming = join(
        second.ctx.paths.historyDir,
        slugOf(rel),
        'sync-recovery',
        'incoming.tsx'
      );
      expect(readFileSync(incoming, 'utf8')).toBe(firstSave);
    }

    const away = (p: Peer) => factories[p.name as 'alice' | 'bob'].park?.();
    const back = (p: Peer) => factories[p.name as 'alice' | 'bob'].unpark?.();

    test.skipIf(v1Bob)(
      'designer offline; teammate edits online; designer reconnects',
      async () => {
        await settle('ui/a1.tsx', src('base a1'));
        away(bob);
        await sleep(1_000);
        alice.write('ui/a1.tsx', src('teammate online'));
        await sleep(2_000);
        bob.write('ui/a1.tsx', src('designer offline'));
        await sleep(2_000);
        back(bob);
        await expectKept('ui/a1.tsx', alice, src('teammate online'), bob, src('designer offline'));
      },
      120_000
    );

    test.skipIf(v1Bob)(
      'teammate offline; designer edits online; teammate reconnects',
      async () => {
        await settle('ui/a2.tsx', src('base a2'));
        away(alice);
        await sleep(1_000);
        bob.write('ui/a2.tsx', src('designer online'));
        await sleep(2_000);
        alice.write('ui/a2.tsx', src('teammate offline'));
        await sleep(2_000);
        back(alice);
        await expectKept('ui/a2.tsx', bob, src('designer online'), alice, src('teammate offline'));
      },
      120_000
    );

    test.skipIf(v1Bob)(
      'both offline; the designer reconnects first',
      async () => {
        await settle('ui/a3.tsx', src('base a3'));
        away(bob);
        away(alice);
        await sleep(1_000);
        bob.write('ui/a3.tsx', src('designer away'));
        alice.write('ui/a3.tsx', src('teammate away'));
        await sleep(2_000);
        back(bob);
        await sleep(4_000);
        back(alice);
        await expectKept('ui/a3.tsx', bob, src('designer away'), alice, src('teammate away'));
      },
      120_000
    );

    test.skipIf(v1Bob)(
      'both offline, different parts: merges silently on reconnect',
      async () => {
        const two = (title: string, label: string) =>
          `export default function Home() {\n  return <h1 title="${title}">${label}</h1>;\n}\n`;
        await settle('ui/a4.tsx', two('base a4', 'Home'));
        away(bob);
        away(alice);
        await sleep(1_000);
        bob.write('ui/a4.tsx', two('designer away', 'Home'));
        alice.write('ui/a4.tsx', two('base a4', 'Start'));
        await sleep(2_000);
        back(bob);
        await sleep(4_000);
        back(alice);
        const merged = two('designer away', 'Start');
        await waitFor(
          () => alice.read('ui/a4.tsx') === merged && bob.read('ui/a4.tsx') === merged,
          'both disks to hold the merge',
          60_000
        ).catch((e) => {
          throw new Error(
            `${(e as Error).message}\nalice: ${alice.read('ui/a4.tsx')}\nbob: ${bob.read('ui/a4.tsx')}`
          );
        });
        expect(holds(alice, 'ui/a4.tsx') || holds(bob, 'ui/a4.tsx')).toBe(false);
      },
      120_000
    );

    test.skipIf(v1Bob)(
      'both edit while the hub is frozen, the teammate first',
      async () => {
        await settle('ui/a5.tsx', src('base a5'));
        hub.proc.kill('SIGSTOP');
        alice.write('ui/a5.tsx', src('teammate frozen'));
        await sleep(1_500);
        bob.write('ui/a5.tsx', src('designer frozen'));
        await sleep(5_000);
        hub.proc.kill('SIGCONT');
        // Which queued update the resumed hub reads first is the hub's
        // business, not the order they were written in; whichever it took
        // second is the side that holds.
        let state = '';
        await waitFor(
          () => {
            state = `alice held=${holds(alice, 'ui/a5.tsx')} bob held=${holds(bob, 'ui/a5.tsx')}`;
            return holds(alice, 'ui/a5.tsx') !== holds(bob, 'ui/a5.tsx');
          },
          'exactly one side to hold the conflict',
          60_000
        ).catch((e) => {
          throw new Error(`${(e as Error).message}\n${state}`);
        });
        const [first, firstSave, second, secondSave] = holds(bob, 'ui/a5.tsx')
          ? [alice, src('teammate frozen'), bob, src('designer frozen')]
          : [bob, src('designer frozen'), alice, src('teammate frozen')];
        await expectKept('ui/a5.tsx', first, firstSave, second, secondSave);
      },
      120_000
    );

    // A 1.x desktop runs no check and is not broken by a peer that does: when
    // the hub takes the 1.x side's change first, the v2 side taken second
    // writes the 1.x side's version back, keeps its own, and holds the
    // conflict — the 1.x disk ends on its own text, never the interleaving.
    // (The reverse order is the 1.x side's to detect, which it cannot: the
    // pre-V2-8.17 behaviour, unchanged.)
    test.skipIf(!v1Bob)(
      'a 1.x designer without the check; the v2 teammate is taken second and acts',
      async () => {
        await settle('ui/a6.tsx', src('base a6'));
        away(alice);
        await sleep(1_000);
        bob.write('ui/a6.tsx', src('designer online'));
        await sleep(2_000);
        alice.write('ui/a6.tsx', src('teammate offline'));
        await sleep(2_000);
        back(alice);
        await expectKept('ui/a6.tsx', bob, src('designer online'), alice, src('teammate offline'));
      },
      120_000
    );
  });
}

apartSuite('peers apart, both with the overlap check', false);
apartSuite('a 1.x designer without the overlap check', true);
