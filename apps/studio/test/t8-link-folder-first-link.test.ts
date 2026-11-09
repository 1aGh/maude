// 2.1.1 T8 — Link your server (`POST /_api/hub/link-folder`):
//   • the FIRST link to a server this Mac never linked always asks, with what goes up — even when the
//     server says it holds nothing (its survey is the server's word, not the person's);
//   • "already linked" comes from THIS Mac's link record: an address the repo names that this Mac never
//     confirmed is neither "already linked" nor a reason to send the person to unlink at that host;
//   • the address is https, or http only on loopback.
// Every machine file lives in a temp dir.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardTableRoute } from '../http.ts';
import { createHubLinkFolderRoutes, HUB_LINK_FOLDER_PATH } from '../routes/hub-link-folder.ts';
import type { RouteSpec } from '../routes/table.ts';
import { saveHubCredential } from '../sync/hub-link.ts';
import { recordProjectLink } from '../sync/link-consent.ts';

const TOKEN = 'hubtok_t8-secret';
const calls: string[] = [];
const fake = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req) {
    const { pathname } = new URL(req.url);
    calls.push(pathname);
    if (pathname === '/health')
      return Response.json({ ok: true, formatVersion: 2, capabilities: ['format-v2'] });
    if (req.headers.get('authorization') !== `Bearer ${TOKEN}`)
      return Response.json({ error: 'sign in' }, { status: 401 });
    if (pathname === '/api/projects/current/v1/bootstrap') return Response.json({ docs: [] });
    if (pathname === '/api/files') return Response.json({ files: [] });
    return new Response('not found', { status: 404 });
  },
});
const FAKE = `http://127.0.0.1:${fake.port}`;
afterAll(() => fake.stop(true));

let tmp = '';
const saved: Record<string, string | undefined> = {};
const ENV = ['HUBS_CONFIG_PATH', 'MAUDE_MACHINE_FILE', 'MAUDE_CLOUD_CONFIG'];
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  tmp = mkdtempSync(join(tmpdir(), 't8-link-folder-'));
  mkdirSync(join(tmp, 'machine'));
  process.env.HUBS_CONFIG_PATH = join(tmp, 'machine', 'hubs.json');
  process.env.MAUDE_MACHINE_FILE = join(tmp, 'machine', 'machine.json');
  process.env.MAUDE_CLOUD_CONFIG = join(tmp, 'machine', 'cloud.json');
  calls.length = 0;
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

const linksFile = () => join(tmp, 'machine', 'project-links.json');

function makeFolder(name: string, cfg: Record<string, unknown> = {}) {
  const repoRoot = join(tmp, name);
  const designRoot = join(repoRoot, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ name, canvasGroups: [{ label: 'Canvases', path: 'ui' }], ...cfg })
  );
  writeFileSync(
    join(designRoot, 'ui', 'home.tsx'),
    "import { DesignCanvas } from '@maude/canvas-lib';\nexport default () => <DesignCanvas />;\n"
  );
  return { repoRoot, designRoot };
}

function routeFor(folder: { repoRoot: string; designRoot: string }) {
  let attached = 0;
  const [spec] = createHubLinkFolderRoutes({
    designRoot: folder.designRoot,
    repoRoot: folder.repoRoot,
    linksFile: linksFile(),
    canvasGroups: () => [{ label: 'Canvases', path: 'ui' }],
    localFormat: () => 2,
    attachStored: async (url) => {
      attached++;
      return { status: 200, json: { ok: true, url, sync: null } };
    },
    worktreeOf: () => null,
  }).map(guardTableRoute);
  const post = async (body: unknown) => {
    const res = await (spec as RouteSpec).handle(
      new Request(`http://127.0.0.1:4399${HUB_LINK_FOLDER_PATH}`, {
        method: 'POST',
        headers: {
          host: '127.0.0.1:4399',
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify(body),
      }),
      {}
    );
    // biome-ignore lint/suspicious/noExplicitAny: a JSON answer
    return { status: res.status, body: (await res.json()) as any };
  };
  return { post, attached: () => attached };
}

describe('the first link to a server this Mac never linked', () => {
  test('an empty server still asks, with what goes up; nothing is linked until yes', async () => {
    const f = makeFolder('a');
    saveHubCredential(FAKE, TOKEN, 'member');
    const r = routeFor(f);
    const ask = await r.post({ url: FAKE });
    expect(ask.body).toMatchObject({ ok: true, state: 'needs-confirm', empty: true });
    expect(ask.body.counts.canvases.onlyHere).toBe(1);
    expect(r.attached()).toBe(0);
    const yes = await r.post({ url: FAKE, confirm: ask.body.confirm });
    expect(yes.body.state).toBe('linked');
    expect(r.attached()).toBe(1);
  });

  test('a server this Mac already linked another folder to links straight away when empty', async () => {
    const f = makeFolder('a');
    saveHubCredential(FAKE, TOKEN, 'member');
    recordProjectLink(join(tmp, 'elsewhere'), { url: FAKE }, 'link', { file: linksFile() });
    const r = routeFor(f);
    expect((await r.post({ url: FAKE })).body.state).toBe('linked');
    expect(r.attached()).toBe(1);
  });
});

describe('already linked = this Mac’s link record', () => {
  test('an unconfirmed committed address does not block linking your own server', async () => {
    const f = makeFolder('a', { linkedHub: { url: 'https://planted.example', linkedAt: 1 } });
    saveHubCredential(FAKE, TOKEN, 'member');
    const ask = await routeFor(f).post({ url: FAKE });
    expect(ask.status).toBe(200);
    expect(ask.body.state).toBe('needs-confirm');
    expect(JSON.stringify(ask.body)).not.toContain('planted.example');
  });

  test('linking the unconfirmed address itself is not "already linked"', async () => {
    const f = makeFolder('a', { linkedHub: { url: FAKE, linkedAt: 1 } });
    saveHubCredential(FAKE, TOKEN, 'member');
    const ask = await routeFor(f).post({ url: FAKE });
    expect(ask.body.already).toBeUndefined();
    expect(ask.body.state).toBe('needs-confirm');
  });

  test('a link this Mac recorded still answers already-linked / linked-elsewhere', async () => {
    const f = makeFolder('a', { linkedHub: { url: FAKE, linkedAt: 1 } });
    recordProjectLink(f.repoRoot, { url: FAKE }, 'link', { file: linksFile() });
    saveHubCredential(FAKE, TOKEN, 'member');
    expect((await routeFor(f).post({ url: FAKE })).body).toMatchObject({
      state: 'linked',
      already: true,
    });
    const other = await routeFor(f).post({ url: 'https://other.example' });
    expect(other.status).toBe(409);
    expect(other.body.reason).toBe('linked-elsewhere');
    expect(JSON.parse(readFileSync(join(f.designRoot, 'config.json'), 'utf8')).linkedHub.url).toBe(
      FAKE
    );
  });
});

describe('the address', () => {
  test('cleartext http to a remote host is refused before any request', async () => {
    const f = makeFolder('a');
    saveHubCredential('http://hub.example', TOKEN, 'member');
    const r = await routeFor(f).post({ url: 'http://hub.example' });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('bad-address');
    expect(calls).toEqual([]);
  });
});
