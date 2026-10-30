// gate-b-sec4 (M1) — a cloned repo's committed `linkedHub` does not get this Mac's credential.
//
// The attack: a repo commits `.design/config.json` naming a hub H the victim already belongs to;
// the victim clones it. Before the fix the boot took `linkedHub` off disk and the token by URL, so
// the studio synced the attacker's tree into H as the victim. Now the link is honoured only when
// THIS Mac recorded it (sync/link-consent.ts); otherwise the claim is parked and nothing reaches H.

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { legacyClaim, resolveAccess } from '../access/scope.ts';
import { createCloudEndpoints } from '../cloud/endpoints.ts';
import { type Context, createContext, reloadConfig } from '../context.ts';
import { createSyncRoutes } from '../routes/sync.ts';
import {
  createLinkGate,
  linkConsent,
  linksPath,
  projectLinkOf,
  recordProjectLink,
} from '../sync/link-consent.ts';
import { createSyncSupervisor } from '../sync/supervisor.ts';

const ENV_KEYS = [
  'HUBS_CONFIG_PATH',
  'MAUDE_PROJECT_LINKS_PATH',
  'MAUDE_APP_BOUND_HUB',
  'CLAUDE_PROJECT_DIR',
  'MAUDE_WORKSPACE_MODE',
  'CI',
  'GITHUB_ACTIONS',
  'MAUDE_SYNC_IN_CI',
] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

let base: string;
let hits = 0;
const hub = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch() {
    hits++;
    return new Response('{}', { status: 404 });
  },
});
const HUB = `http://127.0.0.1:${hub.port}`;
afterAll(() => hub.stop(true));

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'maude-link-consent-')));
  const conf = join(base, 'conf');
  mkdirSync(conf, { recursive: true });
  process.env.HUBS_CONFIG_PATH = join(conf, 'hubs.json');
  delete process.env.MAUDE_PROJECT_LINKS_PATH;
  delete process.env.MAUDE_APP_BOUND_HUB;
  delete process.env.MAUDE_WORKSPACE_MODE;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  // This Mac already belongs to H.
  writeFileSync(
    process.env.HUBS_CONFIG_PATH,
    JSON.stringify({ hubs: { [HUB]: { token: 'mau_victim', linkedAt: 1, role: 'owner' } } }),
    { mode: 0o600 }
  );
  hits = 0;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

/** A folder whose committed config names H — what a clone of the attacker's repo looks like. */
function folder(name: string, extra: Record<string, unknown> = {}): string {
  const root = join(base, name);
  mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  writeFileSync(
    join(root, '.design', 'config.json'),
    JSON.stringify({ name, linkedHub: { url: HUB, linkedAt: 1 }, ...extra })
  );
  writeFileSync(join(root, '.design', 'ui', 'home.html'), '<button>planted</button>');
  return root;
}

function boot(root: string): Context {
  process.env.CLAUDE_PROJECT_DIR = root;
  return createContext();
}

/** A provider factory that only counts — a provider created is a document offered to H. */
function countingFactory() {
  const made: string[] = [];
  const factory = (args: { documentName: string }) => {
    made.push(args.documentName);
    const doc = new Y.Doc();
    return {
      document: doc,
      awareness: new Awareness(doc),
      async onceSynced() {},
      destroy() {
        doc.destroy();
      },
    };
  };
  return { factory, made };
}

describe('a committed linkedHub this Mac never linked', () => {
  test('boots solo and sends nothing to the hub, even though this Mac holds its credential', async () => {
    const root = folder('clone');
    const ctx = boot(root);

    const { factory, made } = countingFactory();
    const sup = createSyncSupervisor(ctx, {
      providerFactory: factory as never,
    });
    const outcome = await sup.start();
    // History asks the linked cell through the cloud endpoints — it must not either.
    const history = await createCloudEndpoints(ctx).history(null, null);
    await Bun.sleep(150);
    await sup.stop();

    // nothing offered to H, nothing asked of H — first, so a regression reads as exactly that
    expect(made).toEqual([]);
    expect(hits).toBe(0);
    expect(ctx.cfg.linkedHub).toBeUndefined();
    expect(ctx.unconfirmedHub?.url).toBe(HUB);
    expect(outcome.syncing).toBe(false);
    expect(outcome.reason).toBe('unconfirmed');
    expect(outcome.detail).toBe(`This project says it syncs with 127.0.0.1:${hub.port}. Connect?`);
    expect((history.json as { reason?: string }).reason).toBe('not-linked');
  });

  test('the file watcher keeps it parked (a reload is not a link)', () => {
    const ctx = boot(folder('clone'));
    expect(reloadConfig(ctx)).toBe(false);
    expect(ctx.cfg.linkedHub).toBeUndefined();
  });

  test('Connect writes the record and starts syncing; the next boot syncs with no prompt', async () => {
    const root = folder('clone');
    const ctx = boot(root);
    const restarts: unknown[] = [];
    const sup = createSyncSupervisor(ctx, {}, (c) => {
      restarts.push(c.cfg.linkedHub?.url ?? null);
      return null;
    });
    ctx.syncControl = sup;
    const gate = createLinkGate(ctx);
    expect(gate.pending()).toEqual({ host: `127.0.0.1:${hub.port}` });

    const r = await gate.confirm();
    expect(r.ok).toBe(true);
    expect(restarts).toEqual([HUB]);
    expect(ctx.cfg.linkedHub?.url).toBe(HUB);
    expect(ctx.unconfirmedHub).toBeUndefined();
    expect(projectLinkOf(root)).toMatchObject({ hub: HUB, how: 'connect' });

    const again = boot(root);
    expect(again.cfg.linkedHub?.url).toBe(HUB);
    expect(again.unconfirmedHub).toBeUndefined();
  });

  test('a record for ANOTHER folder does not count', () => {
    const mine = folder('mine');
    recordProjectLink(mine, { url: HUB }, 'link');
    const ctx = boot(folder('clone'));
    expect(ctx.cfg.linkedHub).toBeUndefined();
    expect(ctx.unconfirmedHub?.url).toBe(HUB);
    expect(boot(mine).cfg.linkedHub?.url).toBe(HUB);
  });

  test('a record for another hub, or another workspace, is not this claim', () => {
    const root = folder('ws', { linkedHub: { url: HUB, linkedAt: 1, workspaceId: 'ws-attacker' } });
    recordProjectLink(root, { url: HUB, workspaceId: 'ws-mine' }, 'link');
    expect(boot(root).cfg.linkedHub).toBeUndefined();
    const other = folder('other');
    recordProjectLink(other, { url: 'https://elsewhere.example.com' }, 'link');
    expect(boot(other).cfg.linkedHub).toBeUndefined();
  });

  test('the app’s own binding (a managed copy) is honoured and recorded', () => {
    const root = folder('managed');
    process.env.MAUDE_APP_BOUND_HUB = `${HUB}/`;
    const ctx = boot(root);
    expect(ctx.cfg.linkedHub?.url).toBe(HUB);
    expect(projectLinkOf(root)).toMatchObject({ hub: HUB, how: 'app' });
  });

  test('Connect is refused to a session that cannot edit, and to nothing waiting', async () => {
    const ctx = boot(folder('clone'));
    const viewer = createSyncRoutes({
      control: () => null,
      trace: {} as never,
      link: createLinkGate(ctx),
      access: () => resolveAccess(legacyClaim('viewer')),
    });
    const confirm = viewer.find((r) => r.path === '/_api/sync/link/confirm');
    const res = await confirm?.handle(
      new Request('http://x/', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }),
      {}
    );
    expect(res?.status).toBe(403);
    expect(((await (res as Response).json()) as { reason?: string }).reason).toBe('not-allowed');
    expect(ctx.unconfirmedHub?.url).toBe(HUB);
    const get = viewer.find((r) => r.path === '/_api/sync/link');
    const body = await (await get?.handle(new Request('http://x/'), {}))?.json();
    expect(body).toEqual({ pending: { host: `127.0.0.1:${hub.port}` } });
  });

  // V2-8.9 defender M1 (decision maude/v2-8.9-sync-link-confirm-needs-fetch-metadata): Connect hands
  // this Mac's hub credential to the folder's hub — the person's act in the Maude window. Only a
  // browser's own same-origin fetch carries Sec-Fetch-Site: same-origin; a loopback curl from an AI
  // session does not, so the route refuses it before the access check, the gate or the hub.
  test('Connect is refused without the window’s Sec-Fetch-Site, even for the owner', async () => {
    const ctx = boot(folder('clone'));
    const owner = createSyncRoutes({
      control: () => null,
      trace: {} as never,
      link: createLinkGate(ctx),
      access: () => resolveAccess(legacyClaim('owner')),
    });
    const confirm = owner.find((r) => r.path === '/_api/sync/link/confirm');
    for (const site of [null, 'none', 'cross-site', 'same-site']) {
      const headers: Record<string, string> = site ? { 'sec-fetch-site': site } : {};
      const res = await confirm?.handle(new Request('http://x/', { method: 'POST', headers }), {});
      expect(res?.status).toBe(403);
      expect(((await (res as Response).json()) as { reason?: string }).reason).toBe('window-only');
      expect(ctx.unconfirmedHub?.url).toBe(HUB);
    }
  });
});

describe('migration — a project already syncing on this Mac keeps syncing', () => {
  function syncedEarlier(root: string, rel: string, body: Record<string, unknown>): string {
    const abs = join(root, '.design', rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, JSON.stringify(body));
    const past = new Date(Date.now() - 86_400_000);
    utimesSync(abs, past, past);
    return abs;
  }

  test('an existing _sync.json for that hub derives the record once, no prompt', () => {
    const root = folder('paired');
    syncedEarlier(root, '_sync.json', { url: HUB, state: 'connected' });
    const ctx = boot(root);
    expect(ctx.cfg.linkedHub?.url).toBe(HUB);
    expect(ctx.unconfirmedHub).toBeUndefined();
    expect(projectLinkOf(root)).toMatchObject({ hub: HUB, how: 'migrated' });
  });

  test('the sync journal under _state counts the same way', () => {
    const root = folder('journal');
    syncedEarlier(root, '_state/sync-journal.json', { hubUrl: HUB, updatedAt: 1, slugs: {} });
    expect(boot(root).cfg.linkedHub?.url).toBe(HUB);
  });

  test('evidence for another hub, evidence newer than the store, or a symlink is not evidence', () => {
    const a = folder('other-hub');
    syncedEarlier(a, '_sync.json', { url: 'https://elsewhere.example.com' });
    expect(boot(a).cfg.linkedHub).toBeUndefined();

    // The store exists from before (this build already ran) — a file written after it is fresh.
    const b = folder('fresh');
    writeFileSync(join(b, '.design', '_sync.json'), JSON.stringify({ url: HUB }));
    const store = JSON.parse(readFileSync(linksPath(), 'utf8'));
    writeFileSync(linksPath(), JSON.stringify({ ...store, since: Date.now() - 3_600_000 }));
    expect(boot(b).cfg.linkedHub).toBeUndefined();

    const c = folder('link');
    const real = syncedEarlier(a, '_state/sync-journal.json', { hubUrl: HUB });
    mkdirSync(join(c, '.design', '_state'), { recursive: true });
    symlinkSync(real, join(c, '.design', '_state', 'sync-journal.json'));
    expect(boot(c).cfg.linkedHub).toBeUndefined();
  });

  test('a _sync.json the repo itself commits (tracked by git) is not this Mac’s evidence', () => {
    const root = folder('committed');
    const abs = syncedEarlier(root, '_sync.json', { url: HUB });
    const v = linkConsent(
      { url: HUB },
      { repoRoot: root, designRoot: join(root, '.design'), tracked: (_r, p) => p === abs }
    );
    expect(v).toEqual({ ok: false, reason: 'no-record' });
    // and with real git: force-added past the ignore rule
    const run = (...args: string[]) =>
      Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'ignore', stderr: 'ignore' });
    run('init', '-q');
    run('add', '-f', '.design/_sync.json');
    expect(boot(root).cfg.linkedHub).toBeUndefined();
  });
});
