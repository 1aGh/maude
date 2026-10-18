// S5.15 — the S5.5b gaps inside "Undo this chat" semantics (followups "S5.5b gaps"), on a LOCAL project:
//
//   - Undo this chat OUT OF ORDER (c1 · c2 · c1, then you) is ONE new version;
//   - ⌘Z on your own edit while a run is still open on the same file reaches the disk (it was left
//     unchanged: the disk held the run's staged bytes, which the store never accepted);
//   - a run's write refused `run-overlap` does not stay on disk (A13 rollback);
//   - U22: an old team server (no `undoTargets`) disables Undo this chat with the update line BEFORE
//     the person clicks, and a single ⌘Z still works.
//
// A real in-process kernel over bun:sqlite (sync/local-kernel.ts), the same run stage the hub link
// uses. The oracle is the store's history rows and the disk.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createProjectUndoRoutes, NEEDS_HUB_UPDATE } from '../routes/project-undo.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const quiet = { warn() {}, error() {} };
const REL = 'ui/k.tsx';
const REPO_REL = `.design/${REL}`;

const canvas = (o: { title?: string; foot?: string; s?: string; s2?: string } = {}) =>
  `import { DCArtboard } from '@maude/canvas-lib';

export default function K() {
  return (
    <div>
      <DCArtboard id="p" width={100} height={100}>
        <h1>${o.title ?? 'P title'}</h1>
        <p>keep one</p>
        <footer>${o.foot ?? 'P foot'}</footer>
      </DCArtboard>
      <p>keep two</p>
      <DCArtboard id="s" width={100} height={100}>
        <h1>${o.s ?? 'S title'}</h1>
        <p>keep three</p>
        <h2>${o.s2 ?? 'S sub'}</h2>
      </DCArtboard>
    </div>
  );
}
`;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-chat-undo-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const file = path.join(designRoot, REL);
  writeFileSync(file, canvas());
  return {
    designRoot,
    read: () => readFileSync(file, 'utf8'),
    write: (body: string) => writeFileSync(file, body),
  };
}

function open(designRoot: string) {
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_mac_one', name: 'Mac one' },
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    aiSettleMs: 0,
    log: quiet,
  });
  homes.push(h);
  return h;
}

async function toolWrite(h: LocalHome, p: ReturnType<typeof project>, key: string, body: string) {
  p.write(body);
  h.runtime.claimAiWrite(key, REPO_REL, hashBytes(body));
  h.observe(REL);
  await h.flush();
}

async function personWrite(h: LocalHome, p: ReturnType<typeof project>, body: string) {
  p.write(body);
  h.noteWritten(REL, body);
  h.observe(REL);
  await h.flush();
}

const rowsOf = async (h: LocalHome) => h.runtime.acceptedHistory({ limit: 50 });

describe('S5.15 — Undo this chat on a local project', () => {
  test('out of order (c1 · c2 · c1 · you): Undo this chat (c1) is ONE version; c2 and your edit stay', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.runtime.beginAiAction('acp:c1', 'c1 run 1', { runId: 'r_o1', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas({ foot: 'c1 foot' }));
    await h.runtime.endAiAction('acp:c1', 'done');
    h.runtime.beginAiAction('acp:c2', 'c2 run', { runId: 'r_o2', chatId: 'c2' });
    await toolWrite(h, p, 'acp:c2', canvas({ foot: 'c1 foot', s2: 'c2 sub' }));
    await h.runtime.endAiAction('acp:c2', 'done');
    h.runtime.beginAiAction('acp:c1', 'c1 run 2', { runId: 'r_o3', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas({ foot: 'c1 foot', s2: 'c2 sub', s: 'c1 S' }));
    await h.runtime.endAiAction('acp:c1', 'done');
    await personWrite(h, p, canvas({ foot: 'c1 foot', s2: 'c2 sub', s: 'c1 S', title: 'mine' }));
    const before = await rowsOf(h);

    const u = await h.runtime.acceptedUndo({ chatId: 'c1' }, false, { via: 'panel' });
    expect(u.status).toBe('accepted');
    const after = await rowsOf(h);
    expect(after.length).toBe(before.length + 1); // ONE new version
    expect(after[0].kind).toBe('undo');
    expect([...(after[0].undoes as string[])].sort()).toEqual(
      before
        .filter((r) => r.chatId === 'c1')
        .map((r) => r.actionId)
        .sort()
    );
    expect(p.read()).toBe(canvas({ s2: 'c2 sub', title: 'mine' }));
    // ⌘Z takes the chat undo back as one step
    await h.runtime.acceptedUndo(after[0].actionId);
    expect(p.read()).toBe(canvas({ foot: 'c1 foot', s2: 'c2 sub', s: 'c1 S', title: 'mine' }));
  });

  test('⌘Z on your own edit while a run is open on the same file reaches the disk, keeping the run’s bytes', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.runtime.beginAiAction('acp:c1', 'Footer', { runId: 'r_own', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas({ foot: 'P foot AI' }));
    await personWrite(h, p, canvas({ foot: 'P foot AI', title: 'P title MINE' }));
    const [mine] = await rowsOf(h);
    expect([mine.kind, mine.mine]).toEqual(['edit', true]);

    const u = await h.runtime.acceptedUndo(mine.actionId);
    expect(u.status).toBe('accepted');
    // your edit leaves the disk; the open run's staged footer stays
    expect(p.read()).toBe(canvas({ foot: 'P foot AI' }));
    // the undo's own disk write is not a new change of anyone's
    h.observe(REL);
    await h.flush();
    expect((await rowsOf(h))[0].kind).toBe('undo');

    const ended = await h.runtime.endAiAction('acp:c1', 'done');
    expect(ended?.status).toBe('accepted');
    expect(p.read()).toBe(canvas({ foot: 'P foot AI' }));
    const rows = await rowsOf(h);
    expect(rows[0].kind).toBe('ai');
    // and Undo this chat leaves the canvas as before the run
    await h.runtime.acceptedUndo({ chatId: 'c1' }, false, { via: 'panel' });
    expect(p.read()).toBe(canvas());
  });

  test('a write refused run-overlap does not stay on disk; the first run is untouched', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.runtime.beginAiAction('acp:c1', 'c1 on P', { runId: 'r_ov1', chatId: 'c1' });
    h.runtime.beginAiAction('acp:c2', 'c2 on P', { runId: 'r_ov2', chatId: 'c2' });
    const d1 = canvas({ title: 'c1 title' });
    await toolWrite(h, p, 'acp:c1', d1);
    // c2 rewrites the same characters c1 changed: refused, and rolled back to what c1 left
    await toolWrite(h, p, 'acp:c2', canvas({ title: 'c2 title' }));
    expect(p.read()).toBe(d1);
    // the rollback is not recorded as anyone's change, and c1 still publishes alone
    h.observe(REL);
    await h.flush();
    const e1 = await h.runtime.endAiAction('acp:c1', 'done');
    expect(e1?.status).toBe('accepted');
    const e2 = await h.runtime.endAiAction('acp:c2', 'done');
    expect(e2?.actionId).toBeUndefined();
    const kinds = (await rowsOf(h)).map((r) => [r.kind, r.label]);
    expect(kinds[0]).toEqual(['ai', 'c1 on P']);
    expect(kinds.filter(([k]) => k === 'outside')).toEqual([]);
    expect(p.read()).toBe(d1);
  });
});

describe('U22 — a v2 studio against an old team server', () => {
  const routes = (rt: Record<string, unknown>) =>
    createProjectUndoRoutes({ control: () => rt as never, designRel: '.design' });
  const spec = (specs: ReturnType<typeof routes>, method: string, p: string) => {
    const s = specs.find((x) => x.method === method && x.path === p);
    if (!s) throw new Error(`no ${method} ${p}`);
    return s;
  };
  const stack = async (rt: Record<string, unknown>) =>
    (await (
      await spec(routes(rt), 'GET', '/_api/project/undo-stack').handle(
        new Request(`http://localhost/_api/project/undo-stack?canvas=${REPO_REL}`),
        {} as never
      )
    ).json()) as Record<string, unknown>;
  const post = async (rt: Record<string, unknown>, body: unknown) => {
    const res = await spec(routes(rt), 'POST', '/_api/project/undo').handle(
      new Request('http://localhost/_api/project/undo', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
      {} as never
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  test('the undo stack says Undo this chat is disabled, with the update line, before anyone clicks', async () => {
    const old = { acceptedHistory: async () => [], chatUndoReady: () => false };
    expect((await stack(old)).chatUndo).toEqual({ ok: false, line: NEEDS_HUB_UPDATE });
    const fresh = { acceptedHistory: async () => [], chatUndoReady: () => true };
    expect((await stack(fresh)).chatUndo).toEqual({ ok: true });
  });

  test('POST {chatId} to an old server is refused with the line and never reaches the kernel; ⌘Z still works', async () => {
    const asked: unknown[] = [];
    const old = {
      chatUndoReady: () => false,
      acceptedHistory: async () => [],
      acceptedUndo: async (t: unknown) => {
        asked.push(t);
        return { status: 'accepted', actionId: 'a_u1', undoes: 'a_x' };
      },
    };
    const chat = await post(old, { chatId: 'c1' });
    expect(chat.status).toBe(409);
    expect(chat.body).toMatchObject({
      ok: false,
      reason: 'needs-hub-update',
      line: NEEDS_HUB_UPDATE,
    });
    expect(asked).toEqual([]);
    const one = await post(old, { actionId: 'a_x' });
    expect(one.status).toBe(200);
    expect(asked).toEqual([{ actionId: 'a_x' }]);
  });
});
