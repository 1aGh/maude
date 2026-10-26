// S9.20 — the link rules (10 co-share-advanced): `POST /_api/share/links` makes the project's link,
// `PATCH /_api/share/links/:id` changes its rules (who, role, expiry) or turns it off.
//  · owner-only, decided on the server: a session without `invite` is refused HERE, before the hub
//    hears anything (hidden ≠ refused) — and the hub refuses too;
//  · a canvas-only session gets the SAME answer as a route that does not exist (V2-1.16 U1);
//  · a pasted self-hosted token (a hubs.json record with no role) is read-only until a sign-in
//    stores one (decision v2-S9.9-roleless-record-is-floor) — refused like any non-owner;
//  · only `{ canvas?, role, who, expiresAt? }` / `{ role?, who?, expiresAt?, off? }` reach the hub,
//    a link may give Can view or Can comment only, and an id that is not an id is never a hub path.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { resolveAccess } from '../access/scope.ts';
import { createShareRoutes, MISSING_ROUTE_WORDS, type ShareRouteDeps } from '../routes/share.ts';
import { matchRoute, type RouteSpec } from '../routes/table.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

type Seen = { method: string; path: string; body: string; auth: string | null };
const seen: Seen[] = [];
let answer: { status: number; body: unknown } | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let hubUrl = '';
const procs: Subprocess[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      seen.push({
        method: req.method,
        path: u.pathname + u.search,
        body: await req.text(),
        auth: req.headers.get('authorization'),
      });
      if (answer) return Response.json(answer.body, { status: answer.status });
      return Response.json({ id: 'lnk_0123456789abcdef', url: 'https://x/l/lnk_0123456789abcdef' });
    },
  });
  hubUrl = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  server?.stop(true);
  for (const p of procs) await killProc(p);
});
afterEach(() => {
  seen.length = 0;
  answer = null;
});

const OWNER = resolveAccess({ v: 1, role: 'owner' });
const MEMBER = resolveAccess({ v: 1, role: 'member' });
const CANVAS_ONLY = resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] });
const TOKEN = 'mh_stored_credential_for_this_mac';

const specs = (over: Partial<ShareRouteDeps> = {}): RouteSpec[] =>
  createShareRoutes({ hub: () => ({ url: hubUrl, token: TOKEN }), access: () => OWNER, ...over });

async function call(table: RouteSpec[], method: string, path: string, body?: unknown) {
  const url = `http://localhost:4399${path}`;
  const m = matchRoute(table, method, new URL(url).pathname);
  if (!m) throw new Error(`no route ${method} ${path}`);
  const res = await m.spec.handle(
    new Request(url, {
      method,
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    m.params
  );
  return { status: res.status, text: await res.text() };
}

describe('what the hub hears', () => {
  test('create and change map to /api/access/links with the stored credential and clean bodies', async () => {
    const t = specs();
    const made = await call(t, 'POST', '/_api/share/links', {
      canvas: 'ui/kampan.tsx',
      role: 'observer',
      who: 'anyone',
      expiresAt: '2030-01-01T00:00:00.000Z',
      smuggled: 'x',
    });
    expect(made.status).toBe(200);
    expect(JSON.parse(made.text).id).toBe('lnk_0123456789abcdef');
    await call(t, 'PATCH', '/_api/share/links/lnk_0123456789abcdef', {
      who: 'team',
      role: 'viewer',
      expiresAt: null,
      evil: true,
    });
    await call(t, 'PATCH', '/_api/share/links/lnk_0123456789abcdef', { off: true });
    expect(seen.map((s) => [s.method, s.path, JSON.parse(s.body), s.auth])).toEqual([
      [
        'POST',
        '/api/access/links',
        {
          canvas: 'ui/kampan.tsx',
          role: 'observer',
          who: 'anyone',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
        `Bearer ${TOKEN}`,
      ],
      [
        'PATCH',
        '/api/access/links/lnk_0123456789abcdef',
        { who: 'team', role: 'viewer', expiresAt: null },
        `Bearer ${TOKEN}`,
      ],
      ['PATCH', '/api/access/links/lnk_0123456789abcdef', { off: true }, `Bearer ${TOKEN}`],
    ]);
  });

  test('a link never gives more than Can comment; bad ids and canvases never reach the hub', async () => {
    const t = specs();
    for (const role of ['member', 'owner', 'admin']) {
      const r = await call(t, 'POST', '/_api/share/links', { role, who: 'anyone' });
      expect([role, r.status]).toEqual([role, 422]);
      expect(JSON.parse(r.text).error).toBe('A link can give Can view or Can comment, never more.');
    }
    expect(
      (await call(t, 'POST', '/_api/share/links', { role: 'viewer', who: 'all' })).status
    ).toBe(400);
    expect(
      (await call(t, 'POST', '/_api/share/links', { role: 'viewer', who: 'team', canvas: '../x' }))
        .status
    ).toBe(400);
    expect(
      (await call(t, 'PATCH', '/_api/share/links/a%2F..%2Fx', { role: 'viewer' })).status
    ).toBe(404);
    expect((await call(t, 'PATCH', '/_api/share/links/lnk_1', { role: 'member' })).status).toBe(
      422
    );
    expect(seen).toEqual([]);
  });

  test('the hub’s refusal and words come back as they are', async () => {
    answer = {
      status: 422,
      body: {
        error: 'Not on this hub — it has no view-only accounts, so no link either.',
        reason: 'role-unsupported',
      },
    };
    const r = await call(specs(), 'POST', '/_api/share/links', { role: 'viewer', who: 'team' });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.text).reason).toBe('role-unsupported');
  });
});

describe('who may change the link', () => {
  test('a session without `invite` is refused before the hub hears it', async () => {
    const t = specs({ access: () => MEMBER });
    for (const [m, p] of [
      ['POST', '/_api/share/links'],
      ['PATCH', '/_api/share/links/lnk_0123456789abcdef'],
    ] as const) {
      const r = await call(t, m, p, { role: 'viewer', who: 'team' });
      expect([p, r.status, JSON.parse(r.text).error]).toEqual([p, 403, 'read-only']);
    }
    expect(seen).toEqual([]);
  });

  test('a canvas-only session hears what a missing route says, and nothing reaches the hub', async () => {
    const t = specs({ access: () => CANVAS_ONLY });
    for (const [m, p] of [
      ['POST', '/_api/share/links'],
      ['PATCH', '/_api/share/links/lnk_0123456789abcdef'],
    ] as const) {
      const r = await call(t, m, p, { role: 'viewer', who: 'team' });
      expect([p, r.status, r.text]).toEqual([p, 404, MISSING_ROUTE_WORDS]);
    }
    expect(seen).toEqual([]);
  });
});

describe('a booted, hub-linked desktop (the real gate)', () => {
  const HUB = 'http://hub.invalid:9';
  async function bootLinked(record: Record<string, unknown>) {
    const { root, designRoot } = makeSandbox();
    const cfgPath = join(designRoot, 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.linkedHub = { url: HUB, linkedAt: Date.now() };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const hubsPath = join(root, 'hubs.json');
    writeFileSync(
      hubsPath,
      JSON.stringify({ hubs: { [HUB]: { token: 't', linkedAt: Date.now(), ...record } } })
    );
    const port = nextPort();
    procs.push(await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath }));
    return `http://localhost:${port}`;
  }
  const send = async (base: string, method: string, path: string, body: unknown) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        origin: base,
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, text: await r.text() };
  };

  test('a pasted token (no role) and a member are refused; a canvas-only record sees no route', async () => {
    const roleless = await bootLinked({});
    const member = await bootLinked({ role: 'member' });
    const canvasOnly = await bootLinked({
      access: { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] },
    });
    for (const base of [roleless, member]) {
      const r = await send(base, 'POST', '/_api/share/links', { role: 'viewer', who: 'anyone' });
      expect([r.status, JSON.parse(r.text).error]).toEqual([403, 'read-only']);
      const p = await send(base, 'PATCH', '/_api/share/links/lnk_0123456789abcdef', { off: true });
      expect([p.status, JSON.parse(p.text).error]).toEqual([403, 'read-only']);
    }
    const missing = await send(canvasOnly, 'POST', '/_api/share/no-such-route', {});
    const create = await send(canvasOnly, 'POST', '/_api/share/links', {
      role: 'viewer',
      who: 'anyone',
    });
    expect(create).toEqual(missing);
  }, 90000);
});
