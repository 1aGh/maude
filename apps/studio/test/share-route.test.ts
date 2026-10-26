// S9.19 — routes/share.ts, the desktop's door to the linked hub's `/api/access/*`:
//  · the hub hears THIS Mac's stored credential and nothing the browser sent (no cookie, no
//    Authorization of the caller's, no extra header), and a body re-serialised from its JSON;
//  · only the mapped paths reach the hub; an id that is not an id never becomes a hub path;
//  · a session without `invite` is refused HERE — before the hub hears anything (hidden ≠ refused);
//  · the hub's status and words come back as they are (the hub decides every permission);
//  · `/health.access` is relayed as the posture (the Share sheet's Q13 switch), `linked: false` locally;
//  · an invite that cannot reach the hub waits in the outbox and sends itself once it can.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAccess } from '../access/scope.ts';
import { createOutbox } from '../outbox/index.ts';
import {
  createShareRoutes,
  OFFLINE_INVITE_WORDS,
  type ShareRouteDeps,
  shareInviteSender,
} from '../routes/share.ts';
import { matchRoute, type RouteSpec } from '../routes/table.ts';

type Seen = { method: string; path: string; headers: Record<string, string>; body: string };
const seen: Seen[] = [];
let health: Record<string, unknown> = {};
let answer: { status: number; body: unknown } | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let hubUrl = '';

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      seen.push({
        method: req.method,
        path: u.pathname + u.search,
        headers,
        body: await req.text(),
      });
      if (u.pathname === '/health') return Response.json(health);
      if (answer) {
        return answer.status === 204
          ? new Response(null, { status: 204 })
          : Response.json(answer.body, { status: answer.status });
      }
      return Response.json({ ok: true, path: u.pathname });
    },
  });
  hubUrl = `http://127.0.0.1:${server.port}`;
});
afterAll(() => {
  server?.stop(true);
});
afterEach(() => {
  seen.length = 0;
  answer = null;
});

const OWNER = resolveAccess({ v: 1, role: 'owner' });
const MEMBER = resolveAccess({ v: 1, role: 'member' });
const TOKEN = 'mh_stored_credential_for_this_mac';

function specs(over: Partial<ShareRouteDeps> = {}): RouteSpec[] {
  return createShareRoutes({
    hub: () => ({ url: hubUrl, token: TOKEN }),
    access: () => OWNER,
    ...over,
  });
}

async function call(
  table: RouteSpec[],
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  const url = `http://localhost:4399${path}`;
  const m = matchRoute(table, method, new URL(url).pathname);
  if (!m) throw new Error(`no route ${method} ${path}`);
  const res = await m.spec.handle(
    new Request(url, {
      method,
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    m.params
  );
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

describe('the table', () => {
  test('every share route is main-origin only', () => {
    const t = specs();
    expect(t.length).toBeGreaterThan(0);
    expect(t.filter((s) => s.origin !== 'main').map((s) => s.path)).toEqual([]);
    for (const s of t) expect(s.path.startsWith('/_api/share/')).toBe(true);
  });
});

describe('what the hub hears', () => {
  test('the stored credential only — never the caller’s cookie, Authorization or headers', async () => {
    const r = await call(
      specs(),
      'POST',
      '/_api/share/invites',
      { email: 'lukas@alligators.cz', role: 'viewer', canvas: 'ui/kampan.tsx', smuggled: 'x' },
      {
        cookie: 'maude_session=browser-cookie',
        authorization: 'Bearer caller-token',
        'x-maude-access': 'forged',
        'x-maude-actor': 'boss@alligators.cz',
      }
    );
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(1);
    const h = seen[0] as Seen;
    expect(h.method).toBe('POST');
    expect(h.path).toBe('/api/access/invites');
    expect(h.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(h.headers.cookie).toBeUndefined();
    expect(h.headers['x-maude-access']).toBeUndefined();
    expect(h.headers['x-maude-actor']).toBeUndefined();
    expect(JSON.parse(h.body)).toEqual({
      email: 'lukas@alligators.cz',
      role: 'viewer',
      canvas: 'ui/kampan.tsx',
    });
  });

  test('each mapped route reaches its hub path and method', async () => {
    const t = specs();
    const cases: [string, string, unknown, string, string][] = [
      ['GET', '/_api/share/me', undefined, 'GET', '/api/access/me'],
      ['GET', '/_api/share/people', undefined, 'GET', '/api/access/people'],
      [
        'GET',
        '/_api/share/people?canvas=ui%2Fa.tsx',
        undefined,
        'GET',
        '/api/access/people?canvas=ui%2Fa.tsx',
      ],
      ['POST', '/_api/share/invites/inv_1/resend', {}, 'POST', '/api/access/invites/inv_1/resend'],
      ['POST', '/_api/share/invites/inv_1/revoke', {}, 'DELETE', '/api/access/invites/inv_1'],
      ['PATCH', '/_api/share/people/u_1', { role: 'viewer' }, 'PATCH', '/api/access/people/u_1'],
      ['POST', '/_api/share/people/u_1/remove', {}, 'DELETE', '/api/access/people/u_1'],
      [
        'POST',
        '/_api/share/people/u_1/remove',
        { canvas: 'ui/a.tsx' },
        'DELETE',
        '/api/access/people/u_1?canvas=ui%2Fa.tsx',
      ],
    ];
    for (const [m, p, b, hm, hp] of cases) {
      seen.length = 0;
      await call(t, m, p, b);
      expect([p, seen[0]?.method, seen[0]?.path]).toEqual([p, hm, hp]);
    }
  });

  test('an id or a canvas that is not one never becomes a hub path', async () => {
    const t = specs();
    expect((await call(t, 'POST', '/_api/share/invites/a%2F..%2Fx/resend', {})).status).toBe(404);
    expect(
      (await call(t, 'POST', '/_api/share/people/u_1/remove', { canvas: '../x' })).status
    ).toBe(400);
    expect((await call(t, 'GET', '/_api/share/people?canvas=..%2Fsecret')).status).toBe(403);
    expect(seen).toEqual([]);
  });
});

describe('who may change access', () => {
  test('a session without `invite` is refused before the hub hears it', async () => {
    const t = specs({ access: () => MEMBER });
    const writes: [string, string, unknown][] = [
      ['POST', '/_api/share/invites', { email: 'a@b.cz', role: 'member' }],
      ['POST', '/_api/share/invites/inv_1/resend', {}],
      ['POST', '/_api/share/invites/inv_1/revoke', {}],
      ['PATCH', '/_api/share/people/u_1', { role: 'viewer' }],
      ['POST', '/_api/share/people/u_1/remove', {}],
    ];
    for (const [m, p, b] of writes) {
      const r = await call(t, m, p, b);
      expect([p, r.status, r.body?.error, r.body?.message]).toEqual([
        p,
        403,
        'read-only',
        'Ask the owner to change this.',
      ]);
    }
    expect(seen).toEqual([]);
    // Reading who has access is the hub's to filter (L17), so it is asked.
    expect((await call(t, 'GET', '/_api/share/people')).status).toBe(200);
  });

  test('the hub’s refusal and its words come back as they are', async () => {
    answer = {
      status: 422,
      body: { error: 'Making someone the owner is its own step.', reason: 'owner-immutable' },
    };
    const r = await call(specs(), 'PATCH', '/_api/share/people/u_1', { role: 'owner' });
    expect(r).toEqual({
      status: 422,
      body: { error: 'Making someone the owner is its own step.', reason: 'owner-immutable' },
    });
  });

  test('a removal answers 204 straight through', async () => {
    answer = { status: 204, body: null };
    expect((await call(specs(), 'POST', '/_api/share/people/u_1/remove', {})).status).toBe(204);
  });
});

describe('posture (`/health.access`, S9-slices Q13)', () => {
  test('before the flip: the v1 roles and project scope, as the hub says', async () => {
    health = {
      ok: true,
      capabilities: ['awareness'],
      access: {
        authority: 'control-plane',
        roles: ['viewer', 'member', 'owner'],
        scopes: ['project'],
        links: false,
        requests: true,
      },
    };
    const r = await call(specs(), 'GET', '/_api/share/posture');
    expect(r.body).toEqual({
      linked: true,
      reachable: true,
      you: { invite: true },
      hub: hubUrl, // S9.20 — Share › Advanced › Where it syncs
      capabilities: ['awareness'],
      access: {
        authority: 'control-plane',
        roles: ['viewer', 'member', 'owner'],
        scopes: ['project'],
        links: false,
        requests: true,
      },
    });
    expect(seen[0]?.headers.authorization).toBeUndefined(); // /health is public: no token sent
  });

  test('a local project is not linked; a hub that does not answer is unreachable', async () => {
    expect((await call(specs({ hub: () => null }), 'GET', '/_api/share/posture')).body).toEqual({
      linked: false,
    });
    const down = specs({ hub: () => ({ url: 'http://127.0.0.1:1', token: TOKEN }) });
    expect((await call(down, 'GET', '/_api/share/posture')).body).toEqual({
      linked: true,
      reachable: false,
      you: { invite: true },
      hub: 'http://127.0.0.1:1',
    });
    const w = await call(specs({ hub: () => null }), 'POST', '/_api/share/invites', {
      email: 'a@b.cz',
    });
    expect([w.status, w.body?.reason]).toEqual([409, 'not-linked']);
  });
});

describe('an invite while the hub cannot be reached', () => {
  test('waits in the outbox with the words, then sends itself to the hub', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'share-outbox-'));
    let t = 1_000_000;
    let up = false;
    const deps: ShareRouteDeps = {
      hub: () => ({ url: hubUrl, token: TOKEN }),
      access: () => OWNER,
      // This Mac is offline until `up`: the request never leaves.
      fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
        up ? fetch(input, init) : Promise.reject(new TypeError('offline'))) as typeof fetch,
    };
    const outbox = createOutbox({
      designRoot: dir,
      now: () => t,
      senders: { 'share.invite': shareInviteSender(deps) },
      gates: () => ({
        online: true,
        hubReachable: true,
        signedIn: true,
        aiConnected: true,
        aiReady: true,
        allowanceResetsAt: null,
      }),
      target: () => ({ projectId: null, projectName: 'Alligators brand', role: 'owner' }),
      contentPending: () => [],
    });
    try {
      const r = await call(createShareRoutes({ ...deps, outbox }), 'POST', '/_api/share/invites', {
        email: 'petra@alligators.cz',
        role: 'observer',
        canvas: 'ui/kampan.tsx',
      });
      expect([r.status, r.body?.queued, r.body?.words]).toEqual([202, true, OFFLINE_INVITE_WORDS]);
      const id = r.body?.id as string;
      const rec = outbox.store.get(id);
      expect(rec?.payload).toEqual({
        kind: 'share.invite',
        email: 'petra@alligators.cz',
        role: 'view',
        scope: { canvas: 'ui/kampan.tsx' },
      });
      expect(rec?.label).toBe('Invite petra@… · Can view');
      // The first try (the hub still down) settles into a backoff; nothing reached the hub.
      await outbox.drain.wake();
      await outbox.drain.wake();
      expect(outbox.store.get(id)?.state).toBe('queued');
      // The hub comes back; the drain's next pass after the backoff sends it.
      up = true;
      seen.length = 0;
      t += 3_600_000;
      for (let i = 0; i < 3 && outbox.store.get(id)?.state !== 'done'; i++)
        await outbox.drain.wake();
      expect(seen.map((s) => [s.method, s.path, s.headers.authorization])).toEqual([
        ['POST', '/api/access/invites', `Bearer ${TOKEN}`],
      ]);
      expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual({
        email: 'petra@alligators.cz',
        role: 'observer',
        canvas: 'ui/kampan.tsx',
      });
      expect(outbox.store.get(id)?.state).toBe('done');
    } finally {
      outbox.drain.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
