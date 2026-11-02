// S1.13b — an artboard comes back from the Trash through S1.13's splice (S1 Q3: "Restoring an
// artboard is V2-1.9 §5.8 'Restore only <artboard>', taken from the revision before the trash
// action"). `POST /_api/trash/restore { id: 'artboard:…' }` used to answer 501 `not-yet`; with the
// seam wired (history/restore-artboard-action.ts `trashArtboardRestorer`) it lands ONE `restore`
// action, the artboard back in its old place and every other artboard byte-identical — on a local
// home and on a real hub, in both directions (memory: cloud and desktop are not symmetric).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { type Access, type AccessClaim, resolveAccess } from '../access/scope.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { trashArtboardRestorer } from '../history/restore-artboard-action.ts';
import type { ArtboardItem } from '../history/trash.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createTrashRoutes } from '../routes/trash.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

// biome-ignore lint/suspicious/noExplicitAny: a test reads arbitrary answer JSON
type Body = Record<string, any>;
type Ab = [id: string, label: string, text: string];

const claim = (c: AccessClaim) => resolveAccess(c);
const MEMBER = claim({ v: 1, role: 'member' });
const VIEWER = claim({ v: 1, role: 'viewer' });
const ONLY_B = claim({ v: 1, role: null, grants: [{ c: 'ui/b.tsx', r: 'member' }] });

function board(abs: Ab[]): string {
  const body = abs
    .map(
      ([id, label, text]) =>
        `      <DCArtboard id="${id}" label="${label}" width={100} height={100}>\n        <p>${text}</p>\n      </DCArtboard>\n`
    )
    .join('');
  return `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';\n\nexport default function Board() {\n  return (\n    <DesignCanvas>\n${body}    </DesignCanvas>\n  );\n}\n`;
}

/** The source with one artboard's element range taken out — what S2's ⌫ proposes. */
function without(src: string, id: string): string {
  const start = src.indexOf(`      <DCArtboard id="${id}"`);
  const end = src.indexOf('</DCArtboard>\n', start) + '</DCArtboard>\n'.length;
  if (start < 0) throw new Error(`no artboard ${id}`);
  return src.slice(0, start) + src.slice(end);
}

const HERO: Ab = ['hero', 'Hero', 'Hero v1'];
const AWAY: Ab = ['away', 'Away', 'Away v1'];
const THIRD: Ab = ['third', 'Third', 'Third v1'];
const KEEP: Ab = ['keep', 'Keep', 'Keep v1'];

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

/** The Trash routes over a runtime, the way http.ts wires them (S1.13b seam included). */
function trashRoutes(o: {
  control: () => unknown;
  designRel: string;
  designRoot: string;
  access: () => Access;
}) {
  const specs = createTrashRoutes({
    control: () => o.control() as object,
    access: () => o.access(),
    readSource: (rel) => {
      try {
        return readFileSync(join(o.designRoot, ...rel.split('/')), 'utf8');
      } catch {
        return null;
      }
    },
    restoreArtboard: trashArtboardRestorer({
      control: () => o.control() as object,
      designRel: o.designRel,
    }),
  });
  const find = (method: string, p: string) =>
    specs.find((s) => s.method === method && s.path === p) as RouteSpec;
  const call = async (method: string, p: string, body?: unknown) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const res = await find(method, p).handle(
      new Request(`http://localhost${p}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(text !== undefined ? { body: text } : {}),
      }),
      {}
    );
    return { status: res.status, body: (await res.json()) as Body };
  };
  return {
    list: async () => ((await call('GET', '/_api/trash')).body.items ?? []) as Body[],
    restore: (id: string) => call('POST', '/_api/trash/restore', { id }),
  };
}

// ── a local home ────────────────────────────────────────────────────────────────────────────

const homes: LocalHome[] = [];
const dirs: string[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function localProject(start: string) {
  const root = mkdtempSync(path.join(tmpdir(), 's113b-trash-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const file = path.join(designRoot, 'ui', 'a.tsx');
  writeFileSync(file, start);
  writeFileSync(path.join(designRoot, 'ui', 'b.tsx'), board([KEEP]));
  const home = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_s113b', name: 'Mac' },
    bootId: 'boot-s113b',
    lockRetryMs: 0,
    settleMs: 5,
    log: { warn() {}, error() {} },
  });
  homes.push(home);
  await home.ready();
  const read = () => readFileSync(file, 'utf8');
  const edit = async (text: string) => {
    writeFileSync(file, text);
    home.observe('ui/a.tsx');
    await home.flush();
  };
  /** S2's artboard-trash action (S1-trash.md §2): the range out, `origin.trashed` naming it. */
  const trashArtboard = async ([id, label]: Ab) => {
    const before = read();
    const after = without(before, id);
    writeFileSync(file, after);
    const r = await home.runtime.proposeLanes(
      canvasSlugFromRel('ui/a.tsx', '.design'),
      [{ lane: 'html', text: after, baseText: before }],
      {
        kind: 'trash',
        label: `Moved “${label}” to the trash`,
        origin: { trashed: [{ artboard: id, label }] },
      }
    );
    expect(r.status).toBe('accepted');
    return r.actionId as string;
  };
  const head = async () =>
    (await home.runtime.acceptedHistory({ path: '.design/ui/a.tsx', limit: 1 }))[0];
  let who = MEMBER;
  const routes = trashRoutes({
    control: () => home.runtime,
    designRel: '.design',
    designRoot,
    access: () => who,
  });
  const as = (a: Access) => {
    who = a;
  };
  return { home, read, edit, trashArtboard, head, as, ...routes };
}

const idOf = (items: Body[], artboard: string) =>
  items.find((i) => i.kind === 'artboard' && i.artboard === artboard)?.id as string | undefined;

describe('the Trash restores an artboard through the splice — a local home', () => {
  test('it comes back in its old place; every other artboard is byte-identical; ⌘Z takes it back', async () => {
    const p = await localProject(board([HERO, AWAY, THIRD]));
    await p.trashArtboard(HERO);
    const later = board([['away', 'Away', 'Away v2'], THIRD]);
    await p.edit(later);
    const id = idOf(await p.list(), 'hero');
    expect(id).toBeDefined();

    const r = await p.restore(id as string);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, id, path: 'ui/a.tsx' });
    expect(typeof r.body.actionId).toBe('string');
    await p.home.flush();
    expect(p.read()).toBe(board([HERO, ['away', 'Away', 'Away v2'], THIRD]));
    const row = await p.head();
    expect(row?.kind).toBe('restore');
    expect(row?.actionId).toBe(r.body.actionId);
    expect(row?.label).toBe('Restored “Hero” from the trash');
    expect(idOf(await p.list(), 'hero')).toBeUndefined();

    // ⌘Z of the restore: one step back — Hero is in the Trash again, Away keeps its edit
    const u = await p.home.runtime.acceptedUndo(r.body.actionId);
    expect(u.status).toBe('accepted');
    await p.home.flush();
    expect(p.read()).toBe(later);
    expect(idOf(await p.list(), 'hero')).toBe(id);
  });

  test('Restore N: three items, one `undo { actionIds }` takes all three back', async () => {
    const start = board([HERO, AWAY, THIRD, KEEP]);
    const p = await localProject(start);
    for (const ab of [HERO, AWAY, THIRD]) await p.trashArtboard(ab);
    const emptied = board([KEEP]);
    expect(p.read()).toBe(emptied);
    const items = await p.list();
    const ids = ['hero', 'away', 'third'].map((a) => idOf(items, a) as string);
    expect(ids.every(Boolean)).toBe(true);

    // the Restore N card restores the selection one by one and keeps every action id (S11.5)
    const actionIds: string[] = [];
    for (const id of ids) {
      const r = await p.restore(id);
      expect(r.status).toBe(200);
      actionIds.push(r.body.actionId);
    }
    await p.home.flush();
    expect(p.read()).toBe(start);
    const before = (await p.head())?.revision as number;

    const u = await p.home.runtime.acceptedUndo({ actionIds });
    expect(u.status).toBe('accepted');
    await p.home.flush();
    expect(p.read()).toBe(emptied);
    const top = await p.head();
    expect(top?.revision).toBe(before + 1); // ONE new version
    expect((await p.list()).filter((i) => i.kind === 'artboard')).toHaveLength(3);
  });

  test('refusals: Can view is refused; a canvas-only session reads it exactly like a missing item', async () => {
    const p = await localProject(board([HERO, AWAY]));
    await p.trashArtboard(HERO);
    const id = idOf(await p.list(), 'hero') as string;
    const top = (await p.head())?.revision;

    p.as(VIEWER);
    expect(await p.restore(id)).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
    p.as(ONLY_B);
    const hidden = await p.restore(id);
    const missing = await p.restore('artboard:a_nope/hero');
    expect(hidden).toEqual(missing);
    expect(hidden).toMatchObject({ status: 403, body: { reason: 'not-in-scope' } });
    expect((await p.head())?.revision).toBe(top); // nothing reached the home
    expect(p.read()).toBe(board([AWAY]));
  });

  test('the seam judges the session first and passes the splice’s 409 reasons through', async () => {
    const p = await localProject(board([HERO, AWAY]));
    await p.trashArtboard(HERO);
    const items = await p.list();
    const item = items.find((i) => i.artboard === 'hero') as unknown as ArtboardItem;
    let calls = 0;
    const seam = trashArtboardRestorer({
      control: () =>
        new Proxy(p.home.runtime, {
          get(t, k) {
            if (k === 'acceptedRestore') calls++;
            return Reflect.get(t, k);
          },
        }),
      designRel: '.design',
    });
    expect(await seam(item, ONLY_B)).toEqual({ status: 'rejected', code: 'not-in-scope' });
    expect(await seam(item, VIEWER)).toEqual({ status: 'rejected', code: 'forbidden' });
    expect(calls).toBe(0);
    // an artboard the revision before never had: the splice's own reason, not a guess
    expect(await seam({ ...item, artboard: 'ghost' }, MEMBER)).toEqual({
      status: 'rejected',
      code: 'not-in-version',
    });
    // a home with no splice restore (an older one) is `legacy`, never a 501
    const legacy = trashArtboardRestorer({
      control: () => ({ acceptedHistory: p.home.runtime.acceptedHistory }),
      designRel: '.design',
    });
    expect(await legacy(item, MEMBER)).toEqual({ status: 'rejected', code: 'legacy' });
  });
});

// ── a real hub, both directions ─────────────────────────────────────────────────────────────

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

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
  read: (rel: string) => string | null;
  list: () => Promise<Body[]>;
  restore: (id: string) => Promise<{ status: number; body: Body }>;
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
  const routes = trashRoutes({
    control: () => runtime,
    designRel: 'design',
    designRoot,
    access: () => MEMBER,
  });
  return {
    runtime,
    read: (rel) => {
      try {
        return readFileSync(join(designRoot, rel), 'utf8');
      } catch {
        return null;
      }
    },
    ...routes,
  };
}

describe.skipIf(!HUB_READY)(
  'the Trash restores an artboard — both directions on a real hub',
  () => {
    let root: string;
    let hub: Hub;
    let alice: Peer;
    let bob: Peer;
    let tx = 0;
    const saved: Record<string, string | undefined> = {};
    const START = board([HERO, AWAY, KEEP]);

    /** S2's artboard-trash action, proposed to the hub as `who` (S1-trash.md §2). */
    async function trashOnHub(who: 'alice' | 'bob', peer: Peer, [id, label]: Ab) {
      const auth = { authorization: `Bearer ${hub.tokens[who]}` };
      const b = (await (
        await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, { headers: auth })
      ).json()) as Body;
      const doc = (b.docs as Body[]).find((d) => d.path === 'ui/two.tsx')?.doc as string;
      const before = (await peer.runtime.acceptedVersion?.('design/ui/two.tsx', b.revision)) ?? '';
      const res = await fetch(`${hub.http}/api/projects/current/v1/proposals`, {
        method: 'POST',
        // a v2 writer (the v2 peers founded the project at format 2; a 1.x one is fenced 426)
        headers: { ...auth, 'content-type': 'application/json', 'x-maude-format': '2' },
        body: JSON.stringify({
          protocol: 1,
          projectId: b.projectId,
          epoch: b.epoch,
          transactionId: `tx_s113b_${++tx}`,
          origin: { trashed: [{ artboard: id, label }] },
          action: {
            kind: 'trash',
            label: `Moved “${label}” to the trash`,
            operations: [
              {
                op: 'lane.replace',
                doc,
                lane: 'html',
                content: without(before, id),
                baseContent: before,
              },
            ],
          },
        }),
      });
      expect(res.status).toBe(200);
    }

    const sync = async (want: string, what: string) =>
      waitFor(async () => {
        await alice.runtime.pullRemoteNow();
        await bob.runtime.pullRemoteNow();
        return alice.read('ui/two.tsx') === want && bob.read('ui/two.tsx') === want;
      }, what);

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 's113b-trash-sync-'));
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
      writeFileSync(join(root, 'alice', 'design', 'ui', 'two.tsx'), START);
      alice = await startPeer(join(root, 'alice'), aliceUrl);
      await waitFor(async () => {
        const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
          headers: { authorization: `Bearer ${hub.tokens.owner}` },
        });
        const b = (await res.json()) as { docs: { path: string }[] };
        return b.docs.some((d) => d.path === 'ui/two.tsx');
      }, 'the hub to accept ui/two.tsx');
      bob = await startPeer(join(root, 'bob'), bobUrl);
      await bob.runtime.pullRemoteNow();
      await waitFor(() => bob.read('ui/two.tsx') === START, 'bob’s copy');
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

    test('Alice trashes Hero, Bob restores it → Alice follows; Bob trashes Away, Alice restores → Bob follows', async () => {
      // Alice → (hub) → Bob restores
      await trashOnHub('alice', alice, HERO);
      await sync(board([AWAY, KEEP]), 'alice’s trash on both');
      const heroId = await waitFor(
        async () => idOf(await bob.list(), 'hero'),
        'hero in bob’s Trash'
      );
      const a = await bob.restore(heroId);
      expect(a.status).toBe(200);
      expect(typeof a.body.actionId).toBe('string');
      await sync(START, 'bob’s restore on alice');
      const [top] =
        (await alice.runtime.acceptedHistory?.({ path: 'design/ui/two.tsx', limit: 1 })) ?? [];
      expect(top?.kind).toBe('restore');
      expect(top?.label).toBe('Restored “Hero” from the trash');
      expect(top?.mine).toBe(false);

      // Bob → (hub) → Alice restores
      await trashOnHub('bob', bob, AWAY);
      await sync(board([HERO, KEEP]), 'bob’s trash on both');
      const awayId = await waitFor(
        async () => idOf(await alice.list(), 'away'),
        'away in alice’s Trash'
      );
      const b = await alice.restore(awayId);
      expect(b.status).toBe(200);
      await sync(START, 'alice’s restore on bob');

      // ⌘Z of Alice's restore (the newest action — the kernel's undo refuses a lane someone else
      // changed since): Away goes back to the Trash on Bob's Mac too; Bob's Hero restore stays
      const u = await alice.runtime.acceptedUndo?.(b.body.actionId as string);
      expect(u).toMatchObject({ status: 'accepted' });
      await sync(board([HERO, KEEP]), 'the undo of alice’s restore on bob');
      expect(
        await waitFor(async () => idOf(await bob.list(), 'away'), 'away back in bob’s Trash')
      ).toBe(awayId);
    }, 90_000);
  }
);
