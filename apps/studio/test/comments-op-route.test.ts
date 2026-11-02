// S9.7b — the studio's comment door: `POST /_api/comments/op` (routes/comments.ts).
//
// One op per call, judged by comments/ops.ts (the same rules as the hub's `POST /api/comments`).
// The author is the session — a cell's vouched member, a desktop's git identity — never the body.
// `comment` capability: Can comment may, Can view (observer) may not. A canvas-only session acts
// on its granted canvases only, and the route resolves a thread's canvas ON THE SERVER, so a reply
// names an id and nothing else: a thread on B answers exactly like a missing one (S9.9's note — the
// legacy `/_api/comments/<id>/reply` names no canvas, so a canvas-only session could not reply).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import type { AccessClaim } from '../access/scope.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const CANVAS_A = '.design/ui/a.tsx';
const CANVAS_B = '.design/ui/b.tsx';
const SRC = 'export default function C() { return <div>c</div>; }\n';
const OP = '/_api/comments/op';

const claim = (c: AccessClaim) => ({
  'x-maude-access': Buffer.from(JSON.stringify(c)).toString('base64url'),
});
const asRole = (role: string, user = 'Lin Park') => ({
  ...claim({ v: 1, role } as AccessClaim),
  'x-maude-role': role,
  'x-maude-readonly': role === 'member' || role === 'owner' ? '0' : '1',
  'x-maude-user': user,
});
/** Can comment on canvas A only — no project role. */
const COMMENT_ON_A = {
  ...claim({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'viewer' }] } as AccessClaim),
  'x-maude-readonly': '1',
  'x-maude-user': 'Guest Ada',
};

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

let cell = '';
let canvasOrigin = '';
beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'a.tsx'), SRC);
  writeFileSync(join(designRoot, 'ui', 'b.tsx'), SRC);
  const port = nextPort();
  procs.push(
    await bootServer(root, port, {
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
      MAUDE_PROJECT_NAME: 'Alligators',
    })
  );
  cell = `http://localhost:${port}`;
  canvasOrigin = String(
    JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')).canvasOrigin
  );
}, 60000);

async function op(headers: Record<string, string>, body: unknown, base = cell) {
  const r = await fetch(base + OP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, json, text, line: `${r.status} ${json.error ?? json.code ?? ''}` };
}

type C = Record<string, unknown> & { id: string; thread: Record<string, unknown>[] };
const commentOf = (r: { json: Record<string, unknown> }) => r.json.comment as C;

describe('POST /_api/comments/op', () => {
  test('add: the author is the session; a forged author / authorKind / from is ignored', async () => {
    const r = await op(asRole('viewer'), {
      op: 'add',
      file: CANVAS_A,
      text: 'Tighten this @ada',
      author: 'Mallory',
      authorId: 'forged',
      authorKind: 'ai',
      from: { kind: 'sticky', id: 'a1', author: 'Jonas' },
      artboard: 'hero',
      t: 1.25,
      mm: { x: 3, y: 4 },
    });
    expect(r.status).toBe(200);
    const c = commentOf(r);
    expect(r.json.id).toBe(c.id);
    expect({
      author: c.author,
      authorId: c.authorId,
      authorKind: c.authorKind,
      from: c.from,
      artboard: c.artboard,
      t: c.t,
      mm: c.mm,
      mentions: c.mentions,
      status: c.status,
    }).toEqual({
      author: 'Lin Park',
      authorId: undefined,
      authorKind: undefined,
      from: undefined,
      artboard: 'hero',
      t: 1.25,
      mm: { x: 3, y: 4 },
      mentions: ['@ada'],
      status: 'open',
    });
    const listed = (await (
      await fetch(`${cell}/_comments?file=${encodeURIComponent(CANVAS_A)}`, {
        headers: asRole('viewer'),
      })
    ).json()) as { comments: C[] };
    expect(listed.comments.find((x) => x.id === c.id)?.author).toBe('Lin Park');
  }, 30000);

  test('as: ai stamps authorKind ai, and AI text mentions nobody', async () => {
    const r = await op(asRole('member', 'Michal'), {
      op: 'add',
      file: CANVAS_A,
      text: 'Contrast is 3.1:1 here @ada',
      as: 'ai',
    });
    expect(r.status).toBe(200);
    expect(commentOf(r).authorKind).toBe('ai');
    expect(commentOf(r).author).toBe('Michal');
    expect(commentOf(r).mentions).toEqual([]);
  }, 30000);

  test('reply / resolve / reopen on another person’s thread; edit-own of it is not-yours', async () => {
    const root = commentOf(
      await op(asRole('member', 'Michal'), { op: 'add', file: CANVAS_A, text: 'Root' })
    );
    const replied = await op(asRole('viewer'), { op: 'reply', id: root.id, body: 'Agreed' });
    expect(replied.status).toBe(200);
    expect(commentOf(replied).thread.map((t) => [t.author, t.body])).toEqual([
      ['Lin Park', 'Agreed'],
    ]);
    expect(commentOf(await op(asRole('viewer'), { op: 'resolve', id: root.id })).status).toBe(
      'resolved'
    );
    expect(commentOf(await op(asRole('viewer'), { op: 'reopen', id: root.id })).status).toBe(
      'open'
    );
    const edit = await op(asRole('viewer'), { op: 'edit-own', id: root.id, text: 'mine now' });
    expect([edit.status, edit.json.code]).toEqual([403, 'not-yours']);
    expect((await op(asRole('viewer'), { op: 'delete-own', id: root.id })).json.code).toBe(
      'not-yours'
    );
  }, 30000);

  test('Can view (observer) is refused every op — 403 read-only', async () => {
    const root = commentOf(
      await op(asRole('member', 'Michal'), { op: 'add', file: CANVAS_A, text: 'R' })
    );
    for (const body of [
      { op: 'add', file: CANVAS_A, text: 'x' },
      { op: 'reply', id: root.id, body: 'x' },
      { op: 'resolve', id: root.id },
    ])
      expect([body.op, (await op(asRole('observer'), body)).line]).toEqual([
        body.op,
        '403 read-only',
      ]);
  }, 30000);

  test('canvas-only: replies on a granted canvas; B’s thread is exactly a missing one', async () => {
    const onA = commentOf(
      await op(asRole('member', 'Michal'), { op: 'add', file: CANVAS_A, text: 'A' })
    );
    const onB = commentOf(
      await op(asRole('member', 'Michal'), { op: 'add', file: CANVAS_B, text: 'B' })
    );
    const replyA = await op(COMMENT_ON_A, { op: 'reply', id: onA.id, body: 'from the guest' });
    expect(replyA.status).toBe(200);
    expect(commentOf(replyA).thread.at(-1)?.author).toBe('Guest Ada');
    expect((await op(COMMENT_ON_A, { op: 'add', file: CANVAS_A, text: 'new on A' })).status).toBe(
      200
    );

    const replyB = await op(COMMENT_ON_A, { op: 'reply', id: onB.id, body: 'x' });
    const missing = await op(COMMENT_ON_A, { op: 'reply', id: 'c_000000000000', body: 'x' });
    expect(replyB.line).toBe('403 not-in-scope');
    expect(replyB.text).toBe(missing.text);
    // Naming the granted canvas does not unlock a thread that lives on B.
    const smuggled = await op(COMMENT_ON_A, { op: 'resolve', id: onB.id, file: CANVAS_A });
    expect(smuggled.text).toBe(missing.text);
    expect((await op(COMMENT_ON_A, { op: 'add', file: CANVAS_B, text: 'x' })).text).toBe(
      missing.text
    );
    const b = (await (
      await fetch(`${cell}/_comments?file=${encodeURIComponent(CANVAS_B)}`, {
        headers: asRole('member', 'Michal'),
      })
    ).json()) as { comments: C[] };
    const stillB = b.comments.find((x) => x.id === onB.id);
    expect([stillB?.status, stillB?.thread.length]).toEqual(['open', 0]);
  }, 30000);

  test('a body that is not an op is 400; an unknown id is 404 for a project member', async () => {
    expect((await op(asRole('member'), { op: 'shout', id: 'c_1' })).status).toBe(400);
    expect((await op(asRole('member'), { op: 'add', file: CANVAS_A })).status).toBe(400);
    expect(
      (await op(asRole('member'), { op: 'add', file: '../etc/passwd', text: 'x' })).status
    ).toBe(400);
    const gone = await op(asRole('member'), { op: 'reply', id: 'c_000000000000', body: 'x' });
    expect([gone.status, gone.json.code]).toEqual([404, 'not-found']);
  }, 30000);

  test('main origin only: the canvas origin does not serve it', async () => {
    expect(canvasOrigin.startsWith('http')).toBe(true);
    const r = await op(asRole('owner'), { op: 'add', file: CANVAS_A, text: 'x' }, canvasOrigin);
    expect(r.status).not.toBe(200);
  }, 30000);
});
