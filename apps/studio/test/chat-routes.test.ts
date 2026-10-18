// S5.7 — the chat store's routes (routes/chat.ts): search, trash / restore / clear out,
// the resume session id. Built from the factory, no server; the CSRF + loopback guard is
// http.ts's `guardTableRoute`, tested with every table route.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOutboxStore } from '../outbox/store.ts';
import { createChatRoutes } from '../routes/chat.ts';

let root: string;
let outboxRoot: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chat-routes-'));
  outboxRoot = mkdtempSync(join(tmpdir(), 'chat-routes-ob-'));
  mkdirSync(join(root, '_chat'), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outboxRoot, { recursive: true, force: true });
});

function seed(id: string, user: string) {
  writeFileSync(
    join(root, '_chat', `${id}.jsonl`),
    `${JSON.stringify({ ts: 1, role: 'user', text: user })}\n`
  );
}

function make(extra: Partial<Parameters<typeof createChatRoutes>[0]> = {}) {
  const outbox = createOutboxStore({ designRoot: outboxRoot });
  const specs = createChatRoutes({ designRoot: root, outbox, ...extra });
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const url = new URL(`http://localhost${path}`);
    const spec = specs.find((s) => s.method === method && s.path === url.pathname);
    if (!spec) throw new Error(`no ${method} ${url.pathname}`);
    const res = await spec.handle(
      new Request(url, {
        method,
        ...(body !== undefined
          ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
          : {}),
      }),
      {}
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  return { specs, outbox, call };
}

const prompt = (outbox: ReturnType<typeof make>['outbox'], chatId: string) =>
  outbox.enqueue({
    kind: 'ai.prompt',
    label: 'Make it red',
    project: { id: null, hub: null },
    actor: 'me',
    device: 'mac',
    watermark: null,
    payload: {
      kind: 'ai.prompt',
      chatId,
      text: 'Make it red',
      scope: null,
      attachments: [],
      presentation: 'sent',
    },
    target: { chatId },
  } as never);

describe('the table', () => {
  test('main origin only; every write is refused for a read-only session', () => {
    const { specs } = make();
    expect(specs.map((s) => `${s.method} ${s.path}`).sort()).toEqual([
      'GET /_api/acp/chat/session',
      'GET /_api/acp/chats/search',
      'POST /_api/acp/chats/clear',
      'POST /_api/acp/chats/restore',
      'POST /_api/acp/chats/trash',
    ]);
    for (const s of specs) {
      expect(s.origin).toBe('main');
      if (s.method === 'POST') expect(s.readOnly).toBe('refused');
    }
  });
});

describe('search', () => {
  test('GET /chats/search?q= answers hits with snippets', async () => {
    seed('a', 'Fix the pricing table');
    seed('b', 'Something else');
    const { call } = make();
    const r = await call('GET', '/_api/acp/chats/search?q=pricing');
    expect(r.status).toBe(200);
    expect((r.json.hits as Array<{ id: string }>).map((h) => h.id)).toEqual(['a']);
  });

  test('no query is an empty list, an over-long one is cut, not refused', async () => {
    seed('a', 'hello');
    const { call } = make();
    expect((await call('GET', '/_api/acp/chats/search')).json.hits).toEqual([]);
    expect((await call('GET', `/_api/acp/chats/search?q=${'x'.repeat(5000)}`)).status).toBe(200);
  });
});

describe('Move to trash', () => {
  test('trashes the chat and drops its queued prompt (G22)', async () => {
    seed('a', 'one');
    seed('b', 'two');
    const { call, outbox } = make();
    const mine = prompt(outbox, 'a');
    const other = prompt(outbox, 'b');
    expect(mine.ok && other.ok).toBe(true);

    const r = await call('POST', '/_api/acp/chats/trash', { id: 'a' });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.droppedPrompts).toBe(1);

    const states = Object.fromEntries(
      outbox.list().map((x) => [(x.payload as { chatId: string }).chatId, x.state])
    );
    expect(states).toEqual({ a: 'dropped', b: 'queued' });
    expect(outbox.list().find((x) => x.state === 'dropped')?.outcome?.code).toBe('cancelled');
  });

  test('a chat that is running is not trashed', async () => {
    seed('a', 'one');
    const { call, outbox } = make({ isRunning: (id) => id === 'a' });
    prompt(outbox, 'a');
    const r = await call('POST', '/_api/acp/chats/trash', { id: 'a' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('running');
    expect(outbox.list()[0]?.state).toBe('queued');
    expect((await call('GET', '/_api/acp/chats/search?q=one')).json.hits).toHaveLength(1);
  });

  test('an unknown chat is a 404; a bad id or body is a 400', async () => {
    const { call } = make();
    expect((await call('POST', '/_api/acp/chats/trash', { id: 'ghost' })).status).toBe(404);
    expect((await call('POST', '/_api/acp/chats/trash', {})).status).toBe(400);
    expect((await call('POST', '/_api/acp/chats/trash', { id: '../x' })).status).toBe(400);
  });

  test('restore brings it back; restoring a live chat is a 404', async () => {
    seed('a', 'one');
    const { call } = make();
    await call('POST', '/_api/acp/chats/trash', { id: 'a' });
    expect((await call('POST', '/_api/acp/chats/restore', { id: 'a' })).status).toBe(200);
    expect((await call('GET', '/_api/acp/chats/search?q=one')).json.hits).toHaveLength(1);
    expect((await call('POST', '/_api/acp/chats/restore', { id: 'a' })).status).toBe(404);
  });

  test('clear out deletes trashed chats only', async () => {
    seed('a', 'one');
    seed('b', 'two');
    const { call } = make();
    await call('POST', '/_api/acp/chats/trash', { id: 'a' });
    const r = await call('POST', '/_api/acp/chats/clear', {});
    expect(r.json.deleted).toEqual(['a']);
    expect(existsSync(join(root, '_chat', 'a.jsonl'))).toBe(false);
    expect(existsSync(join(root, '_chat', 'b.jsonl'))).toBe(true);
  });
});

describe('the resume session id', () => {
  test('GET /chat/session?id= reads the sidecar; none is null', async () => {
    writeFileSync(join(root, '_chat', 'a.session.json'), JSON.stringify({ sessionId: 'sess-1' }));
    const { call } = make();
    expect((await call('GET', '/_api/acp/chat/session?id=a')).json.sessionId).toBe('sess-1');
    expect((await call('GET', '/_api/acp/chat/session?id=b')).json.sessionId).toBeNull();
  });
});
