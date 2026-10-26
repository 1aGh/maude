// S9.21 — Ask to edit through routes/share.ts (10 co-ask-edit):
//  · any session may ask (a read-only observer most of all); the hub hears `{ canvas? }` ONLY — a note,
//    a message or any other key the caller typed is dropped, so no free text reaches an owner;
//  · the open requests are the owner's, rebuilt row by row (a cell's extra fields never reach the sheet);
//  · Let … edit / Not now are refused HERE for every session without `invite` (hidden ≠ refused);
//  · an ask that cannot reach the hub waits in the outbox and its sender sends `{ canvas }` only.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAccess } from '../access/scope.ts';
import { createOutbox } from '../outbox/index.ts';
import {
  createShareRoutes,
  OFFLINE_ASK_WORDS,
  requestName,
  requestRows,
  type ShareRouteDeps,
  shareAskToEditSender,
} from '../routes/share.ts';
import { matchRoute, type RouteSpec } from '../routes/table.ts';

type Seen = { method: string; path: string; headers: Record<string, string>; body: string };
const seen: Seen[] = [];
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
      if (answer) return Response.json(answer.body, { status: answer.status });
      return Response.json({ id: 'req_1' }, { status: 201 });
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
const OBSERVER = resolveAccess({ v: 1, role: 'observer' });
const TOKEN = 'mh_stored_credential_for_this_mac';

function specs(over: Partial<ShareRouteDeps> = {}): RouteSpec[] {
  return createShareRoutes({
    hub: () => ({ url: hubUrl, token: TOKEN }),
    access: () => OBSERVER,
    ...over,
  });
}

async function call(table: RouteSpec[], method: string, path: string, body?: unknown) {
  const url = `http://localhost:4399${path}`;
  const m = matchRoute(table, method, new URL(url).pathname);
  if (!m) throw new Error(`no route ${method} ${path}`);
  const res = await m.spec.handle(
    new Request(url, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: 'maude_session=caller',
        'sec-fetch-site': 'same-origin',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    m.params
  );
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

describe('Ask to edit', () => {
  test('a read-only session may ask; the route is a read-only-allowed main-origin write', () => {
    const s = specs().find((x) => x.method === 'POST' && x.path === '/_api/share/requests');
    expect([s?.origin, s?.readOnly]).toEqual(['main', 'allowed']);
  });

  test('the hub hears { canvas } only — the note, a message, any other key is dropped', async () => {
    const r = await call(specs(), 'POST', '/_api/share/requests', {
      canvas: 'ui/kampan.tsx',
      note: '<img src=x onerror=alert(1)> please',
      message: 'hi',
      role: 'owner',
    });
    expect(r.status).toBe(201);
    expect(seen.map((x) => [x.method, x.path, x.headers.authorization, x.headers.cookie])).toEqual([
      ['POST', '/api/access/requests', `Bearer ${TOKEN}`, undefined],
    ]);
    expect(JSON.parse(seen[0]?.body ?? 'null')).toEqual({ canvas: 'ui/kampan.tsx' });
  });

  test('a project-wide ask sends an empty body; a canvas that is not a path is never sent', async () => {
    await call(specs(), 'POST', '/_api/share/requests', { note: 'x' });
    expect(JSON.parse(seen[0]?.body ?? 'null')).toEqual({});
    seen.length = 0;
    const bad = await call(specs(), 'POST', '/_api/share/requests', { canvas: '../../etc/passwd' });
    // the same answer a canvas outside the session's grants gets (no oracle)
    expect([bad.status, bad.body?.reason, seen.length]).toEqual([403, 'not-in-scope', 0]);
  });

  test('the hub’s answers come back as they are (pending, already-can-edit, rate-limited)', async () => {
    for (const [status, reason] of [
      [409, 'pending'],
      [409, 'already-can-edit'],
      [429, 'rate-limited'],
    ] as const) {
      answer = { status, body: { error: 'words', reason } };
      const r = await call(specs(), 'POST', '/_api/share/requests', {});
      expect([r.status, r.body?.reason]).toEqual([status, reason]);
    }
  });
});

describe('the owner’s side', () => {
  test('GET requests and approve / decline are refused below owner before the hub hears it', async () => {
    for (const who of [OBSERVER, MEMBER]) {
      const t = specs({ access: () => who });
      for (const [method, path] of [
        ['GET', '/_api/share/requests'],
        ['POST', '/_api/share/requests/req_1/approve'],
        ['POST', '/_api/share/requests/req_1/decline'],
      ] as const) {
        const r = await call(t, method, path, method === 'POST' ? {} : undefined);
        expect([path, r.status]).toEqual([path, 403]);
      }
    }
    expect(seen).toEqual([]);
  });

  test('approve / decline reach the fixed hub path; a non-id never becomes a path', async () => {
    const t = specs({ access: () => OWNER });
    answer = { status: 200, body: { ok: true } };
    await call(t, 'POST', '/_api/share/requests/req_ab12/approve', { role: 'owner' });
    await call(t, 'POST', '/_api/share/requests/req_ab12/decline', {});
    expect(seen.map((x) => [x.path, x.body])).toEqual([
      ['/api/access/requests/req_ab12/approve', '{}'],
      ['/api/access/requests/req_ab12/decline', '{}'],
    ]);
    seen.length = 0;
    const r = await call(t, 'POST', '/_api/share/requests/a.b/approve', {});
    expect([r.status, seen.length]).toEqual([404, 0]);
  });

  test('the request list is rebuilt key by key — a cell’s note or markup never reaches the sheet', async () => {
    answer = {
      status: 200,
      body: {
        requests: [
          {
            id: 'req_1',
            from: { name: 'Petra‮\u0007 Nováková', email: 'petra@alligators.cz', html: '<b>' },
            canvas: 'ui/kampan.tsx',
            at: 5,
            note: 'free text',
          },
          { id: '../bad', from: { name: 'x' }, at: 1 },
        ],
      },
    };
    const r = await call(specs({ access: () => OWNER }), 'GET', '/_api/share/requests');
    expect(r.body).toEqual({
      requests: [
        {
          id: 'req_1',
          from: { name: 'Petra Nováková', email: 'petra@alligators.cz' },
          canvas: 'ui/kampan.tsx',
          at: 5,
        },
      ],
    });
  });

  test('requestName keeps one short line', () => {
    expect(requestName('a'.repeat(200)).length).toBe(80);
    expect(requestName('Line\nbreak')).toBe('Linebreak');
    expect(requestRows(null)).toEqual([]);
  });
});

describe('offline', () => {
  test('an ask the hub cannot hear waits in the outbox and sends { canvas } only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ask-outbox-'));
    let t = 1_000_000;
    let up = false;
    const deps: ShareRouteDeps = {
      hub: () => ({ url: hubUrl, token: TOKEN }),
      access: () => OBSERVER,
      fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
        up ? fetch(input, init) : Promise.reject(new TypeError('offline'))) as typeof fetch,
    };
    const outbox = createOutbox({
      designRoot: dir,
      now: () => t,
      senders: { 'share.ask-to-edit': shareAskToEditSender(deps) },
      gates: () => ({
        online: true,
        hubReachable: true,
        signedIn: true,
        aiConnected: true,
        aiReady: true,
        allowanceResetsAt: null,
      }),
      target: () => ({ projectId: null, projectName: 'Alligators brand', role: 'observer' }),
      contentPending: () => [],
    });
    try {
      const r = await call(createShareRoutes({ ...deps, outbox }), 'POST', '/_api/share/requests', {
        canvas: 'ui/kampan.tsx',
        note: 'typed text',
      });
      expect([r.status, r.body?.queued, r.body?.words]).toEqual([202, true, OFFLINE_ASK_WORDS]);
      const id = r.body?.id as string;
      expect(outbox.store.get(id)?.payload).toEqual({
        kind: 'share.ask-to-edit',
        scope: { canvas: 'ui/kampan.tsx' },
      });
      up = true;
      seen.length = 0;
      t += 3_600_000;
      for (let i = 0; i < 4 && outbox.store.get(id)?.state !== 'done'; i++) {
        await outbox.drain.wake();
        t += 3_600_000;
      }
      expect(seen.map((x) => [x.method, x.path])).toEqual([['POST', '/api/access/requests']]);
      expect(JSON.parse(seen[0]?.body ?? 'null')).toEqual({ canvas: 'ui/kampan.tsx' });
      expect(outbox.store.get(id)?.state).toBe('done');
    } finally {
      outbox.drain.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the sender: "you already asked" is the request having landed, not a failure', async () => {
    answer = { status: 409, body: { error: 'You already asked.', reason: 'pending' } };
    const send = shareAskToEditSender({ hub: () => ({ url: hubUrl, token: TOKEN }) });
    const out = await send({
      payload: { kind: 'share.ask-to-edit', scope: 'project', note: 'never sent' },
      project: { id: null, hub: hubUrl },
    } as never);
    expect(out).toMatchObject({ ok: false, status: 409, code: 'already' });
    expect(JSON.parse(seen[0]?.body ?? 'null')).toEqual({});
  });
});
