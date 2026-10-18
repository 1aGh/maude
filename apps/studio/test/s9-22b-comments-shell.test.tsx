// S9.22b — the shell wiring S9.22 left open: the Comments panel's actions for a Can comment session,
// the unread-mention notices (Share cluster count + toast + read marks), and the `comments.filter-*` /
// `comments.open-thread` runners.

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

const A = '.design/ui/poster.tsx';
const B = '.design/ui/reel.tsx';
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('commentPanelActions — who gets Resolve / Reopen / Delete, and through which door', () => {
  const ws = { resolve: () => 'ws-resolve', reopen: () => 'ws-reopen', remove: () => 'ws-remove' };

  test('an editor keeps the socket lane', async () => {
    const { commentPanelActions } = await import('../client/v2/comments/comment-client.js');
    const a = commentPanelActions({ viewerMode: false, canComment: false, ws });
    expect(a.onResolve).toBe(ws.resolve);
    expect(a.onReopen).toBe(ws.reopen);
    expect(a.onDelete).toBe(ws.remove);
  });

  test('Can view (read-only, no comment): no actions at all', async () => {
    const { commentPanelActions } = await import('../client/v2/comments/comment-client.js');
    const a = commentPanelActions({ viewerMode: true, canComment: false, ws });
    expect([a.onResolve, a.onReopen, a.onDelete]).toEqual([undefined, undefined, undefined]);
  });

  test('Can comment (read-only): resolve / reopen / delete-own go to the op door; a refusal is said', async () => {
    const { commentPanelActions } = await import('../client/v2/comments/comment-client.js');
    const posted: unknown[] = [];
    const said: string[] = [];
    const post = async (op: unknown) => {
      posted.push(op);
      return { ok: false, status: 403, code: 'forbidden', error: 'You can’t do that here.' };
    };
    const a = commentPanelActions({
      viewerMode: true,
      canComment: true,
      ws,
      post,
      notify: (m: string) => said.push(m),
    });
    a.onResolve?.('c1');
    a.onReopen?.('c2');
    a.onDelete?.('c3');
    await new Promise((r) => setTimeout(r, 10));
    expect(posted).toEqual([
      { op: 'resolve', id: 'c1' },
      { op: 'reopen', id: 'c2' },
      { op: 'delete-own', id: 'c3' },
    ]);
    expect(said).toEqual([
      'You can’t do that here.',
      'You can’t do that here.',
      'You can’t do that here.',
    ]);
  });
});

describe('the comments.* runners (S9.22b binding)', () => {
  test('each filter row opens the panel on its filter; open-thread passes its params', async () => {
    const { createMenuHandlers, menuRunner, runnableIds } = await import(
      '../client/v2/shell/menu-runner.js'
    );
    const calls: unknown[][] = [];
    const d = new Proxy(
      {},
      {
        get:
          (_t, k) =>
          (...args: unknown[]) =>
            calls.push([String(k), ...args]),
      }
    );
    const h = createMenuHandlers(d);
    const ids = [
      'comments.filter-open',
      'comments.filter-mine',
      'comments.filter-resolved',
      'comments.filter-all',
      'comments.open-thread',
    ];
    const can = runnableIds(h);
    for (const id of ids) expect(can.has(id), id).toBe(true);
    menuRunner.bind(h, {});
    for (const id of ids.slice(0, 4)) menuRunner.run(id);
    menuRunner.run('comments.open-thread', { file: A, id: 'c1' });
    menuRunner.unbind(h);
    expect(calls).toEqual([
      ['onCommentsFilter', 'open'],
      ['onCommentsFilter', 'mine'],
      ['onCommentsFilter', 'resolved'],
      ['onCommentsFilter', 'all'],
      ['onOpenCommentThread', A, 'c1'],
    ]);
  });
});

describe('S9.17 hunks — a mention notice click opens the thread; the shell hears the count', () => {
  const PATHS = ['.design/ui/poster.tsx'];
  const deps = (ran: unknown[][], opened: string[]) => ({
    paths: PATHS,
    designRel: '.design',
    activePath: null,
    openLinkedFile: (rel: string) => opened.push(rel),
    openTab: () => {},
    frameFor: () => null,
    setPresent: () => {},
    schedule: (fn: () => void) => fn(),
    runAction: (id: string, params: unknown) => ran.push([id, params]),
  });

  test('shell://navigate {canvas, thread} opens the canvas, then runs comments.open-thread', async () => {
    const { applyShellNavigate } = await import('../client/shell-events.js');
    const ran: unknown[][] = [];
    const opened: string[] = [];
    const plan = applyShellNavigate(
      { canvas: 'ui/poster.tsx', thread: 'c_abc-1' },
      deps(ran, opened)
    );
    expect(plan?.thread).toBe('c_abc-1');
    expect(opened).toEqual(['ui/poster.tsx']);
    expect(ran).toEqual([['comments.open-thread', { file: A, id: 'c_abc-1' }]]);
  });

  test('a junk thread id is dropped (the canvas still opens); a canvas not here runs nothing', async () => {
    const { applyShellNavigate } = await import('../client/shell-events.js');
    const ran: unknown[][] = [];
    const opened: string[] = [];
    for (const thread of ['a b', 'x'.repeat(65), '../x', 7])
      expect(
        applyShellNavigate({ canvas: 'ui/poster.tsx', thread }, deps(ran, opened))
      ).not.toHaveProperty('thread');
    applyShellNavigate({ canvas: 'ui/gone.tsx', thread: 'c1' }, deps(ran, opened));
    expect(ran).toEqual([]);
    expect(opened.length).toBe(5);
  });

  test('ShellMentionCallouts tells the desktop shell the unread count (mention_notice); a browser does not', async () => {
    const { ShellMentionCallouts } = await import('../client/v2/comments/use-comments-shell.jsx');
    const { ShellStoreContext } = await import('../client/stores/shell-store.jsx');
    const notices = { unread: [], unreadCount: 2, toasts: [], dismiss() {}, read() {} };
    const store = { comments: { notices, openThread() {} }, shellCore: { commentsByFile: {} } };
    for (const native of [true, false]) {
      const invoked: unknown[][] = [];
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(
          <ShellStoreContext.Provider value={store as never}>
            <ShellMentionCallouts
              native={native}
              invokeImpl={(cmd: string, args: unknown) => {
                invoked.push([cmd, args]);
                return Promise.resolve();
              }}
            />
          </ShellStoreContext.Provider>
        );
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(invoked).toEqual(native ? [['mention_notice', { count: 2, latest: null }]] : []);
      act(() => root.unmount());
      host.remove();
    }
  });
});

describe('useCommentsShell — unread mentions, read marks, open a thread', () => {
  async function harness(commentsByFile: Record<string, unknown[]>) {
    const { useCommentsShell } = await import('../client/v2/comments/use-comments-shell.jsx');
    const posts: unknown[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ seen: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    const calls: unknown[][] = [];
    const out: { current: ReturnType<typeof useCommentsShell> | null } = { current: null };
    function Harness() {
      out.current = useCommentsShell({
        commentsByFile,
        me: 'Michal Dovrtel',
        activePath: A,
        jumpToComment: (f: string, id: string) => calls.push(['jump', f, id]),
        setCommentsFilter: (f: string) => calls.push(['filter', f]),
        openRightPanel: (p: string) => calls.push(['panel', p]),
        fetchImpl,
      });
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Harness />);
      await new Promise((r) => setTimeout(r, 20));
    });
    return { out, calls, posts, root, host };
  }

  const DATA = {
    [A]: [{ id: 'c1', text: 'Mrkni @michal', author: 'Jonas', created: iso(3_000), thread: [] }],
    [B]: [
      {
        id: 'c2',
        text: 'bez',
        author: 'Jonas',
        created: iso(9_000),
        thread: [{ id: 'r1', author: 'Tereza', body: 'diky @Michal', created: iso(1_000) }],
      },
    ],
  };

  test('the count is the threads with something unread; opening one marks it read in ui-prefs seen', async () => {
    const h = await harness(DATA);
    expect(h.out.current?.unreadCount).toBe(2);
    await act(async () => {
      h.out.current?.openThread(B, 'c2');
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(h.calls).toContainEqual(['jump', B, 'c2']);
    expect(h.calls).toContainEqual(['panel', 'comments']);
    expect(h.posts).toEqual([{ seen: { 'cm-mention:c2:r1': true } }]);
    expect(h.out.current?.unreadCount).toBe(1);
    act(() => h.root.unmount());
    h.host.remove();
  });

  test('open-thread with no id opens the oldest unread mention; a filter opens the panel on it', async () => {
    const h = await harness(DATA);
    await act(async () => {
      h.out.current?.openThread();
      h.out.current?.showFilter('mine');
      h.out.current?.showFilter('nonsense');
    });
    expect(h.calls.find((c) => c[0] === 'jump')).toEqual(['jump', A, 'c1']);
    expect(h.calls.filter((c) => c[0] === 'filter')).toEqual([
      ['filter', 'mine'],
      ['filter', 'open'],
    ]);
    act(() => h.root.unmount());
    h.host.remove();
  });

  test('marksFor hands S7.17 the open canvas’s timeline flags', async () => {
    const h = await harness({
      [A]: [{ id: 'x1', artboard: 'reel', t: 2, author: 'Jonas', status: 'open' }],
    });
    expect(h.out.current?.marksFor({ id: 'reel', fps: 30 })).toEqual([
      { threadId: 'x1', frame: 60, t: 2, author: 'Jonas', resolved: false },
    ]);
    act(() => h.root.unmount());
    h.host.remove();
  });
});
