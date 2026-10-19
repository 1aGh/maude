// S4.V4 G5 (wave-A gate fix 3c) — a sticky turned into a comment could not be turned back: the thread had no
// ⋯ "Turn back into a sticky" and the from-line no Undo, though POST /_api/comments/to-sticky (S4.7) exists.
// The thread (canvas iframe, untrusted) asks the shell through `comment-op`; the shell runs the route as the
// session and keeps this session's conversions (their action ids never reach the canvas). S4-S9 §3.4.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { c2sSpec } from '../bridge/dgn-protocol.ts';
import { turnIntoComment } from '../client/v2/annotations/annotation-asks.js';
import { handleCommentBridgeMessage } from '../client/v2/comments/comment-bridge.js';
import { CommentThread, type OverlayComment } from '../comments-overlay.tsx';

function server(answers: Record<string, unknown> = {}) {
  const posts: Array<{ url: string; body: any }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    posts.push({ url, body });
    return { status: 200, json: async () => answers[url] ?? { ok: true } };
  }) as unknown as typeof fetch;
  return { posts, fetchImpl };
}

async function ask(op: Record<string, unknown>, fetchImpl: typeof fetch) {
  const replies: any[] = [];
  const raw = { dgn: 'comment-op', reqId: 'r1', op };
  const m = c2sSpec('comment-op')?.parse(raw);
  expect(m).toBeTruthy();
  await handleCommentBridgeMessage(
    { ...(m as object), dgn: 'comment-op' },
    {
      activePath: '.design/ui/Site.tsx',
      reply: (x: unknown) => replies.push(x),
      fetchImpl,
    }
  );
  return replies.find((r) => r.dgn === 'comment-op-result');
}

describe('S4.V4 G5 — the shell answers the thread’s conversion asks', () => {
  test('the dgn parser keeps only { op, commentId } for a conversion ask', () => {
    const m = c2sSpec('comment-op')?.parse({
      dgn: 'comment-op',
      reqId: 'r1',
      op: { op: 'to-sticky', commentId: 'c_1', file: '../../etc', actionId: 'planted' },
    }) as { op: unknown } | null;
    expect(m?.op).toEqual({ op: 'to-sticky', commentId: 'c_1' });
    expect(
      c2sSpec('comment-op')?.parse({ dgn: 'comment-op', reqId: 'r1', op: { op: 'to-sticky' } })
    ).toBeNull();
  });

  test('to-sticky runs POST /_api/comments/to-sticky as the session', async () => {
    const s = server();
    const r = await ask({ op: 'to-sticky', commentId: 'c_1' }, s.fetchImpl);
    expect(r.ok).toBe(true);
    expect(s.posts).toEqual([{ url: '/_api/comments/to-sticky', body: { commentId: 'c_1' } }]);
  });

  test('a refused turn-back carries the server’s line', async () => {
    const s = server();
    const fetchImpl = (async () => ({
      status: 409,
      json: async () => ({
        ok: false,
        reason: 'has-replies',
        line: 'Tereza replied — resolve the thread instead.',
      }),
    })) as unknown as typeof fetch;
    const r = await ask({ op: 'to-sticky', commentId: 'c_1' }, fetchImpl);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Tereza replied — resolve the thread instead.');
    expect(s.posts).toHaveLength(0);
  });

  test('the header Undo is offered only for this session’s conversion, and undoes it once', async () => {
    const s = server({
      '/_api/annotations/to-comment': { ok: true, commentId: 'c_9', actionId: 'act_1' },
    });
    expect((await ask({ op: 'convert-undoable', commentId: 'c_9' }, s.fetchImpl)).ok).toBe(false);
    const t = await turnIntoComment({
      file: '.design/ui/Site.tsx',
      id: 's_1',
      fetchImpl: s.fetchImpl,
    });
    expect(t.ok).toBe(true);
    expect((await ask({ op: 'convert-undoable', commentId: 'c_9' }, s.fetchImpl)).ok).toBe(true);
    expect((await ask({ op: 'convert-undo', commentId: 'c_9' }, s.fetchImpl)).ok).toBe(true);
    expect(s.posts.at(-1)).toEqual({ url: '/_api/project/undo', body: { actionId: 'act_1' } });
    expect((await ask({ op: 'convert-undoable', commentId: 'c_9' }, s.fetchImpl)).ok).toBe(false);
  });
});

// ── the thread (canvas side) ──────────────────────────────────────────────────────────────────────

function fakeShell(answer: (op: any) => { ok: boolean; error?: string }) {
  const asked: any[] = [];
  const parent = {
    postMessage(m: any) {
      if (m?.dgn !== 'comment-op') return;
      asked.push(m.op);
      const r = answer(m.op);
      for (const data of [
        { dgn: 'comment-op-ack', reqId: m.reqId },
        { dgn: 'comment-op-result', reqId: m.reqId, ...r },
      ]) {
        const ev = new Event('message');
        Object.defineProperties(ev, { data: { value: data }, source: { value: parent } });
        setTimeout(() => window.dispatchEvent(ev), 0);
      }
    },
  };
  const real = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  return {
    asked,
    restore: () => {
      if (real) Object.defineProperty(window, 'parent', real);
    },
  };
}

const converted = (thread: OverlayComment['thread'] = []): OverlayComment =>
  ({
    id: 'c_1',
    file: '.design/ui/Site.tsx',
    text: 'Mobile: button above the fold?',
    author: 'Jonas',
    created: new Date().toISOString(),
    status: 'open',
    thread,
    from: { kind: 'sticky', id: 's_1', author: 'Jonas', convertedBy: 'Michal', at: '' },
  }) as unknown as OverlayComment;

async function renderThread(comment: OverlayComment, onClose = () => {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <CommentThread
        comment={comment}
        sequence={1}
        onClose={onClose}
        onPatch={() => {}}
        onDelete={() => {}}
        onReply={async () => true}
        me="Michal"
      />
    );
    await new Promise((r) => setTimeout(r, 20));
  });
  // the shell's `convert-undoable` answer arrives on later ticks
  for (let i = 0; i < 10; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  return {
    host,
    done: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe('S4.V4 G5 — the converted thread offers Undo and ⋯ Turn back into a sticky', () => {
  test('the converter sees Undo; ⋯ → Turn back into a sticky asks the shell and closes', async () => {
    const shell = fakeShell(() => ({ ok: true }));
    let closed = 0;
    const t = await renderThread(converted(), () => (closed += 1));
    const from = t.host.querySelector('[data-testid="comment-from-c_1"]');
    expect(from?.textContent).toContain('turned into a comment by You');
    expect(t.host.querySelector('[data-testid="comment-from-undo-c_1"]')?.textContent).toBe('Undo');
    await act(async () => {
      (t.host.querySelector('[data-testid="comment-menu-c_1"]') as HTMLButtonElement).click();
    });
    const item = t.host.querySelector(
      '[data-testid="comment-menu-to-sticky-c_1"]'
    ) as HTMLButtonElement;
    expect(item?.textContent).toBe('Turn back into a sticky');
    expect(item.disabled).toBe(false);
    await act(async () => {
      item.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(shell.asked.map((o) => o.op)).toEqual(['convert-undoable', 'to-sticky']);
    expect(shell.asked[1]).toEqual({ op: 'to-sticky', commentId: 'c_1' });
    expect(closed).toBe(1);
    t.done();
    shell.restore();
  });

  test('after someone else replied: no Undo, the row is disabled with the line', async () => {
    const shell = fakeShell(() => ({ ok: true }));
    const t = await renderThread(
      converted([
        { id: 'r1', author: 'Tereza', body: 'On it', created: new Date().toISOString() },
      ] as never)
    );
    expect(t.host.querySelector('[data-testid="comment-from-undo-c_1"]')).toBeNull();
    await act(async () => {
      (t.host.querySelector('[data-testid="comment-menu-c_1"]') as HTMLButtonElement).click();
    });
    const item = t.host.querySelector(
      '[data-testid="comment-menu-to-sticky-c_1"]'
    ) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(t.host.textContent).toContain('Tereza replied — resolve the thread instead.');
    t.done();
    shell.restore();
  });

  test('no session conversion (the shell says no): no Undo link', async () => {
    const shell = fakeShell((op) => ({ ok: op.op !== 'convert-undoable' }));
    const t = await renderThread(converted());
    expect(t.host.querySelector('[data-testid="comment-from-undo-c_1"]')).toBeNull();
    t.done();
    shell.restore();
  });
});
