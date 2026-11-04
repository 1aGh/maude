// S1.13 — "Restore only <artboard>" on a linked project, in BOTH directions (memory: cloud and desktop are
// not symmetric — test both). Two studio runtimes on a real hub (the serve-hub fixture, accepted revisions):
// Alice restores one artboard and Bob's disk follows; then Bob restores the other one and Alice's follows.
// Each restore is ONE `restore` action through the hub kernel (lane.replace + baseContent, merged three-way),
// and the artboard nobody restored is byte-identical on both Macs.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createHistoryRoutes, type HistoryRuntime } from '../routes/history.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

const MEMBER = resolveAccess({ v: 1, role: 'member' } as AccessClaim);

const two = (
  hero: string,
  away: string
) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function Two() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" label="Hero" width={100} height={100}>
        <h1>${hero}</h1>
      </DCArtboard>
      <DCArtboard id="away" label="Away" width={100} height={100}>
        <p>${away}</p>
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
  /** the studio's bus: `fs:any` is what its file watcher would emit for a change on disk */
  bus: Context['bus'];
  read: (rel: string) => string | null;
  write: (rel: string, text: string) => void;
  /** a change on disk the watcher has not delivered yet (its 250 ms quiet window) */
  put: (rel: string, text: string) => void;
  restore: (body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
}

async function startPeer(repoRoot: string, url: string): Promise<Peer> {
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
    registry: createRegistry(noop()),
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  const specs = createHistoryRoutes({
    control: () => runtime as unknown as HistoryRuntime,
    designRel: 'design',
    designRoot,
    access: () => MEMBER,
  });
  const spec = specs.find(
    (s) => s.method === 'POST' && s.path === '/_api/project/restore'
  ) as RouteSpec;
  return {
    runtime,
    bus: ctx.bus,
    read: (rel) => {
      try {
        return readFileSync(join(designRoot, rel), 'utf8');
      } catch {
        return null;
      }
    },
    write: (rel, text) => {
      writeFileSync(join(designRoot, rel), text);
      ctx.bus.emit('fs:any', rel);
    },
    put: (rel, text) => writeFileSync(join(designRoot, rel), text),
    restore: async (body) => {
      const res = await spec.handle(
        new Request('http://localhost/_api/project/restore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        {}
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
  };
}

interface Pair {
  root: string;
  hub: Hub;
  alice: Peer;
  bob: Peer;
  stop: () => Promise<void>;
}

/** A real hub and two studios on it (Alice founds each canvas of `files`, Bob pulls them). */
async function startPair(prefix: string, files: Record<string, string>): Promise<Pair> {
  const saved: Record<string, string | undefined> = {};
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
    saved[k] = process.env[k];
  process.env.MAUDE_SYNC_IN_CI = '1';
  const hub = await startHub(join(root, 'hub'));
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
  for (const [rel, start] of Object.entries(files))
    writeFileSync(join(root, 'alice', 'design', rel), start);
  const alice = await startPeer(join(root, 'alice'), aliceUrl);
  await waitFor(async () => {
    const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    const b = (await res.json()) as { docs: { path: string }[] };
    return Object.keys(files).every((rel) => b.docs.some((d) => d.path === rel));
  }, 'the hub to accept the canvases');
  const bob = await startPeer(join(root, 'bob'), bobUrl);
  await bob.runtime.pullRemoteNow();
  await waitFor(
    () => Object.entries(files).every(([rel, start]) => bob.read(rel) === start),
    'bob’s copy'
  );
  const stop = async () => {
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
  };
  return { root, hub, alice, bob, stop };
}

describe.skipIf(!HUB_READY)('Restore only <artboard> — both directions on a real hub', () => {
  let pair: Pair;
  let alice: Peer;
  let bob: Peer;

  beforeAll(async () => {
    pair = await startPair('s113-restore-sync-', { 'ui/two.tsx': two('Hero v1', 'Away v1') });
    ({ alice, bob } = pair);
  }, 60_000);

  afterAll(async () => {
    await pair?.stop();
  });

  test('Alice restores Hero → Bob follows; Bob restores Away → Alice follows', async () => {
    const rows =
      (await alice.runtime.acceptedHistory?.({ path: 'design/ui/two.tsx', limit: 5 })) ?? [];
    const v1 = rows[0]?.revision as number;
    expect(v1).toBeGreaterThan(0);
    bob.write('ui/two.tsx', two('Hero v2', 'Away v2'));
    await waitFor(() => alice.read('ui/two.tsx') === two('Hero v2', 'Away v2'), 'bob→alice edit');

    // Alice → Bob
    const a = await alice.restore({ path: 'ui/two.tsx', at: `r${v1}`, artboard: 'hero' });
    expect(a.status).toBe(200);
    expect(a.body.ok).toBe(true);
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.read('ui/two.tsx') === two('Hero v1', 'Away v2');
    }, 'alice’s restore on bob');
    expect(alice.read('ui/two.tsx')).toBe(two('Hero v1', 'Away v2'));
    const [top] =
      (await bob.runtime.acceptedHistory?.({ path: 'design/ui/two.tsx', limit: 1 })) ?? [];
    expect(top?.kind).toBe('restore');
    expect(top?.mine).toBe(false);

    // Bob → Alice
    const b = await bob.restore({ path: 'ui/two.tsx', at: `r${v1}`, artboard: 'away' });
    expect(b.status).toBe(200);
    await waitFor(async () => {
      await alice.runtime.pullRemoteNow();
      return alice.read('ui/two.tsx') === two('Hero v1', 'Away v1');
    }, 'bob’s restore on alice');
    expect(bob.read('ui/two.tsx')).toBe(two('Hero v1', 'Away v1'));

    // Alice undoes HER restore: only Hero goes back to v2; Bob's Away restore stays
    const u = await alice.runtime.acceptedUndo?.(a.body.actionId as string);
    expect(u?.status).toBe('accepted');
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.read('ui/two.tsx') === two('Hero v2', 'Away v1');
    }, 'the undo of alice’s restore on bob');
  }, 60_000);
});

// ── F14 (2.0.4, #166): Version history restores over a change this disk has and the hub lacks ───
//
// The restores here splice onto (or replace) the canvas's NEWEST version on the hub, but the person
// sees THIS disk. A hand edit (an AI run, an editor, a pull) still in the watcher's quiet window was
// missing from that head: the restore landed and answered 200, the late hand edit overlapped it and
// was held here — the project and the other Mac got the restore, this file kept the hand edit.

/** The canvas without its Hero artboard — what an AI run or an editor leaves on disk. */
const withoutHero = (s: string) =>
  s.replace(/ {6}<DCArtboard id="hero"[\s\S]*?<\/DCArtboard>\n/, '');

describe.skipIf(!HUB_READY)(
  'F14 — Version history restores over a change on this disk the hub has not taken yet (#166)',
  () => {
    // one canvas per leg, so a leg that fails (a held change) cannot fail the next one
    const ARTBOARD = 'ui/f14-artboard.tsx';
    const WHOLE = 'ui/f14-whole.tsx';
    const HELD = 'ui/f14-held.tsx';
    const V1 = two('Hero v1', 'Away v1');
    let pair: Pair;
    let alice: Peer;
    let bob: Peer;

    const newest = async () => {
      const res = await fetch(`${pair.hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${pair.hub.tokens.owner}` },
      });
      return ((await res.json()) as { revision: number }).revision;
    };
    /** The revision at which `rel` read `want`. */
    const revOf = async (rel: string, want: string) => {
      const path = `design/${rel}`;
      const rows = (await alice.runtime.acceptedHistory?.({ path, limit: 50 })) ?? [];
      for (const r of rows) {
        const body = await alice.runtime.acceptedVersion?.(path, r.revision as number);
        if (body === want) return r.revision as number;
      }
      throw new Error(`no version of ${rel} reads that`);
    };
    const both = (rel: string, want: string, what: string) =>
      waitFor(async () => {
        await alice.runtime.pullRemoteNow();
        await bob.runtime.pullRemoteNow();
        return alice.read(rel) === want && bob.read(rel) === want;
      }, what);

    beforeAll(async () => {
      pair = await startPair('f14-history-restore-', { [ARTBOARD]: V1, [WHOLE]: V1, [HELD]: V1 });
      ({ alice, bob } = pair);
    }, 60_000);

    afterAll(async () => {
      await pair?.stop();
    });

    test('Restore only <artboard>: the hand edit goes up first, both Macs end with the restore', async () => {
      const v1 = await revOf(ARTBOARD, V1);
      bob.write(ARTBOARD, two('Hero v2', 'Away v2'));
      await both(ARTBOARD, two('Hero v2', 'Away v2'), 'v2 on both Macs');

      // Hero leaves bob's file by hand, and "Restore only Hero" is clicked before his watcher has
      // delivered that change — the hub still holds Hero v2
      bob.put(ARTBOARD, withoutHero(two('Hero v2', 'Away v2')));
      const r = await bob.restore({ path: ARTBOARD, at: `r${v1}`, artboard: 'hero' });
      expect(r.status).toBe(200);
      bob.bus.emit('fs:any', ARTBOARD); // the watcher's (late) event for the hand edit

      const want = two('Hero v1', 'Away v2');
      await both(ARTBOARD, want, 'Hero v1 back on both Macs');
      await new Promise((res) => setTimeout(res, 1_500)); // nothing takes it back
      expect(bob.read(ARTBOARD)).toBe(want);
      expect(alice.read(ARTBOARD)).toBe(want);
    }, 90_000);

    test('Restore this version (whole canvas): the hand edit goes up first, both Macs end with it', async () => {
      const v1 = await revOf(WHOLE, V1);
      bob.write(WHOLE, two('Hero v3', 'Away v3'));
      await both(WHOLE, two('Hero v3', 'Away v3'), 'v3 on both Macs');

      bob.put(WHOLE, withoutHero(two('Hero v3', 'Away v3')));
      const r = await bob.restore({ path: WHOLE, at: `r${v1}` });
      expect(r.status).toBe(200);
      bob.bus.emit('fs:any', WHOLE);

      await both(WHOLE, V1, 'v1 on both Macs');
      await new Promise((res) => setTimeout(res, 1_500));
      expect(bob.read(WHOLE)).toBe(V1);
      expect(alice.read(WHOLE)).toBe(V1);
    }, 90_000);

    test('a change the hub refused stays held: both restores say why and land nothing', async () => {
      const v1 = await revOf(HELD, V1);
      bob.write(HELD, two('Hero v2', 'Away v2'));
      await both(HELD, two('Hero v2', 'Away v2'), 'v2 on both Macs');
      // bob's Away text and alice's cross: bob's is refused (overlap) and held on his disk
      const mine = two('Hero v2', 'Away by bob');
      bob.put(HELD, mine);
      const before = await newest();
      alice.write(HELD, two('Hero v2', 'Away by alice'));
      await waitFor(async () => (await newest()) > before, 'alice’s edit on the hub');
      await bob.runtime.pullRemoteNow();
      bob.bus.emit('fs:any', HELD);
      await waitFor(async () => {
        const st = (await bob.runtime.status?.()) as Record<string, unknown> | undefined;
        const notices = (st?.notices ?? []) as { id?: unknown }[];
        return notices.some((n) => String(n?.id).startsWith('source-conflict-'));
      }, 'bob’s edit held');
      const top = await newest();

      for (const body of [
        { path: HELD, at: `r${v1}`, artboard: 'hero' },
        { path: HELD, at: `r${v1}` },
      ]) {
        const r = await bob.restore(body);
        expect(r.status).toBe(409);
        expect(r.body).toMatchObject({ ok: false, reason: 'unsaved-change' });
        expect(String(r.body.line)).toContain('isn’t saved');
      }
      expect(await newest()).toBe(top); // nothing reached the project
      expect(bob.read(HELD)).toBe(mine); // the held change is still this Mac's file
    }, 90_000);
  }
);
