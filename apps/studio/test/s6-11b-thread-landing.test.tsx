// S6.11b — a thread landing in the project window (an invite or a mention, `shell://navigate {canvas, thread}`):
//   1. lead decision option B: a MENTION landing's toast is S1.18's words "Opened from <name>'s link — <canvas>."
//      — the name is the thread's stored author, never anything the payload carried. An INVITE landing
//      (OpenTarget `via: "invite"`, kept by Rust only beside a thread and only from Home — decision
//      maude/v2-p8-t-share-3-opentarget-via-invite) says CONTRACT §3's "<who> invited you here — their comment is
//      on <canvas>." by the same stored author (test/p8-g1a-invite-landing-toast.test.ts);
//   2. the thread opens with the REPLY field focused (bridge `comment-focus {id, reply: true}`), and one delayed
//      shot — not a retry ladder — runs `tool.comment` (Preview with the Comment tool, CONTRACT §71–72).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register({ url: 'http://localhost:4400/' });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  // React's scheduler and the stores' timers can still be queued when the last test ends; let them run while
  // `window` exists, or they fire into a destroyed DOM ("window is not defined", unhandled between tests)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const A = '.design/ui/poster.tsx';
const SRC = (...p: string[]) => readFileSync(join(import.meta.dir, '..', ...p), 'utf8');

describe('applyShellNavigate — a thread landing', () => {
  const deps = (log: unknown[][], extra: Record<string, unknown> = {}) => ({
    paths: [A],
    designRel: '.design',
    activePath: null,
    openLinkedFile: (rel: string) => log.push(['open', rel]),
    openTab: () => {},
    frameFor: () => null,
    setPresent: () => {},
    schedule: (fn: () => void, ms: number) => {
      log.push(['schedule', ms]);
      fn();
    },
    runAction: (id: string, params?: unknown) => log.push(['run', id, params]),
    toast: (t: string) => log.push(['toast', t]),
    ...extra,
  });

  test('reply focused at once, then ONE shot: tool.comment + "Opened from Tereza\'s link — poster."', async () => {
    const { applyShellNavigate, LANDING_SHOT_MS } = await import('../client/shell-events.js');
    const log: unknown[][] = [];
    const authors: unknown[][] = [];
    applyShellNavigate(
      { canvas: 'ui/poster.tsx', thread: 'th_01' },
      deps(log, {
        threadAuthor: (file: string, id: string) => {
          authors.push([file, id]);
          return 'Tereza';
        },
      })
    );
    expect(log).toEqual([
      ['open', 'ui/poster.tsx'],
      ['schedule', 0],
      ['run', 'comments.open-thread', { file: A, id: 'th_01', reply: true }],
      ['schedule', LANDING_SHOT_MS],
      ['run', 'tool.comment', undefined],
      ['toast', "Opened from Tereza's link — poster."],
    ]);
    // the name is looked up in THIS project's comments, for the thread the shell named
    expect(authors).toEqual([[A, 'th_01']]);
  });

  test('no stored author → "Opened from a link — poster."; payload text never reaches the toast', async () => {
    const { applyShellNavigate } = await import('../client/shell-events.js');
    const log: unknown[][] = [];
    applyShellNavigate(
      { canvas: 'ui/poster.tsx', thread: 'th_01', fromName: 'Mallory', name: 'Mallory' },
      deps(log, { threadAuthor: () => null })
    );
    const toasts = log.filter((l) => l[0] === 'toast');
    expect(toasts).toEqual([['toast', 'Opened from a link — poster.']]);
    expect(JSON.stringify(log)).not.toContain('Mallory');
  });

  test('a canvas without a thread, or one not in this tree: no Comment tool, no toast', async () => {
    const { applyShellNavigate } = await import('../client/shell-events.js');
    for (const payload of [
      { canvas: 'ui/poster.tsx' },
      { canvas: 'ui/gone.tsx', thread: 'th_01' },
      { canvas: 'ui/poster.tsx', thread: 'bad id' },
    ]) {
      const log: unknown[][] = [];
      applyShellNavigate(payload, deps(log));
      expect(log.filter((l) => l[0] === 'run' || l[0] === 'toast')).toEqual([]);
    }
  });

  test('threadAuthor reads the stored author; use-tabs hands it and the toast to the navigate deps', async () => {
    const { threadAuthor } = await import('../client/v2/comments/use-comments-shell.jsx');
    const byFile = {
      [A]: [
        { id: 'th_01', author: '  Tereza ' },
        { id: 'th_02', author: '' },
      ],
    };
    expect(threadAuthor(A, 'th_01', byFile)).toBe('Tereza');
    expect(threadAuthor(A, 'th_02', byFile)).toBeNull();
    expect(threadAuthor(A, 'nope', byFile)).toBeNull();
    const tabs = SRC('client', 'hooks', 'use-tabs.jsx');
    const ref = tabs.slice(
      tabs.indexOf('shellNavRef.current = {'),
      tabs.indexOf('return startShellEvents({')
    );
    for (const k of ['shellToast(title, true, undefined,', 'threadAuthor,'])
      expect({ k, present: ref.includes(k) }).toEqual({ k, present: true });
  });
});

describe('the reply flag on its way to the canvas', () => {
  test('comments.open-thread forwards reply; a plain open stays two-argument', async () => {
    const { createMenuHandlers, menuRunner } = await import('../client/v2/shell/menu-runner.js');
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
    menuRunner.bind(h, {});
    menuRunner.run('comments.open-thread', { file: A, id: 'c1', reply: true });
    menuRunner.run('comments.open-thread', { file: A, id: 'c2' });
    menuRunner.run('comments.open-thread', { file: A, id: 'c3', reply: 'yes' });
    menuRunner.unbind(h);
    expect(calls).toEqual([
      ['onOpenCommentThread', A, 'c1', { reply: true }],
      ['onOpenCommentThread', A, 'c2'],
      ['onOpenCommentThread', A, 'c3'],
    ]);
  });

  test('openThread passes reply to jumpToComment', async () => {
    const { useCommentsShell } = await import('../client/v2/comments/use-comments-shell.jsx');
    const jumps: unknown[][] = [];
    let api: { openThread: (f: string, id: string, o?: unknown) => boolean } | null = null;
    function Probe() {
      api = useCommentsShell({
        commentsByFile: { [A]: [{ id: 'c1', author: 'Tereza' }] },
        me: null,
        activePath: null,
        jumpToComment: (...a: unknown[]) => jumps.push(a),
        setCommentsFilter: () => {},
        openRightPanel: () => {},
        fetchImpl: async () => new Response('{}'),
      });
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(<Probe />));
    act(() => {
      api?.openThread(A, 'c1', { reply: true });
      api?.openThread(A, 'c1');
    });
    expect(jumps).toEqual([
      [A, 'c1', { reply: true }],
      [A, 'c1'],
    ]);
    act(() => root.unmount());
  });

  test('reply-focus: the message carries reply only when asked; the frame re-send keeps it for that thread', async () => {
    const { commentFocusMessage, replyFocusFor, wantReplyFocus, REPLY_FOCUS_TTL_MS } = await import(
      '../client/v2/comments/reply-focus.js'
    );
    expect(commentFocusMessage('c1')).toEqual({ dgn: 'comment-focus', id: 'c1' });
    expect(commentFocusMessage('c1', true)).toEqual({
      dgn: 'comment-focus',
      id: 'c1',
      reply: true,
    });
    wantReplyFocus('c1', 1000);
    expect(replyFocusFor('c1', 1500)).toBe(true);
    expect(replyFocusFor('c2', 1500)).toBe(false);
    expect(replyFocusFor('c1', 1000 + REPLY_FOCUS_TTL_MS + 1)).toBe(false);
    wantReplyFocus(null); // a plain jump clears it
    expect(replyFocusFor('c1', 1500)).toBe(false);
  });

  test('the bridge admits `reply: true` on comment-focus and nothing else for it', async () => {
    const { s2cSpec } = await import('../bridge/dgn-protocol.ts');
    const spec = s2cSpec('comment-focus');
    expect(spec?.parse({ id: 'c1', reply: true })).toEqual({ id: 'c1', reply: true });
    expect(spec?.parse({ id: 'c1' })).toEqual({ id: 'c1' });
    expect(spec?.parse({ id: 'c1', reply: 'yes' })).toBeNull();
    expect(spec?.parse({ id: 'c1', reply: false })).toBeNull();
  });

  test('app.jsx jumpToComment sends the reply flag; the frame re-send in use-canvas-bridge carries it', () => {
    const app = SRC('client', 'app.jsx');
    const at = app.indexOf('const jumpToComment = useCallback(');
    const body = app.slice(at, app.indexOf('[activePath]', at));
    for (const k of [
      '(file, id, opts) =>',
      'wantReplyFocus(reply ? id : null)',
      'commentFocusMessage(id, reply)',
    ])
      expect({ k, present: body.includes(k) }).toEqual({ k, present: true });
    expect(app).toContain(
      'onOpenCommentThread: (file, id, opts) => comments?.openThread(file, id, opts)'
    );
    expect(SRC('client', 'hooks', 'use-canvas-bridge.jsx')).toContain(
      'commentFocusMessage(focusedCommentId, replyFocusFor(focusedCommentId))'
    );
  });
});

describe('the canvas: CommentThread focuses the reply field', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
  });
  async function mount(focusReply: number) {
    const { CommentThread } = await import('../comments-overlay.tsx');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const comment = {
      id: 'th_01',
      file: A,
      text: 'Can we try the poster in blue?',
      author: 'Tereza',
      status: 'open',
      created: new Date().toISOString(),
      thread: [],
    };
    act(() => {
      root?.render(
        <CommentThread
          comment={comment as never}
          sequence={1}
          onClose={() => {}}
          onPatch={() => {}}
          onDelete={() => {}}
          onReply={async () => true}
          focusReply={focusReply}
        />
      );
    });
  }
  const replyField = () =>
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]');

  test('a landing (focusReply) puts the focus in the reply field', async () => {
    await mount(1);
    expect(replyField()).not.toBeNull();
    expect(document.activeElement).toBe(replyField());
  });

  test('an ordinary open keeps the focus on the dialog', async () => {
    await mount(0);
    expect(replyField()).not.toBeNull();
    expect(document.activeElement).not.toBe(replyField());
  });

  test('the overlay turns `comment-focus {reply: true}` into that focus', () => {
    const src = SRC('comments-overlay.tsx');
    expect(src).toContain('if (id && m.reply === true) setReplyFocus((n) => n + 1);');
    expect(src).toContain('focusReply={replyFocus}');
  });
});
