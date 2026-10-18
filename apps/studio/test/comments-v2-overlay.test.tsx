// S9.22 — the canvas-side half of Comments v2: the thread popover (10 · co-comment-thread), a pin on a
// video that shows only at its moment (co-comment-video), a print comment that speaks millimetres
// (co-comment-print), the mention popover with roles, and the shell bridge that lets a Can comment
// session reply (the comment door names the thread's canvas itself).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  realParent = Object.getOwnPropertyDescriptor(window, 'parent');
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  CommentsOverlay,
  CommentThread,
  type OverlayComment,
  resetMentionPeople,
  shellCommentOp,
} from '../comments-overlay.tsx';

const FILE = '.design/ui/Board.tsx';
const comment = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    file: FILE,
    selector: '',
    bounds: { x: 100, y: 100, w: 24, h: 24 },
    text: 'Datum je moc male',
    status: 'open',
    created: new Date(Date.now() - 2 * 3600_000).toISOString(),
    resolved_at: null,
    author: 'Jonas',
    thread: [],
    ...over,
  }) as unknown as OverlayComment;

let root: Root | null = null;
let host: HTMLElement | null = null;
let realParent: PropertyDescriptor | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  document.body.innerHTML = '';
  if (realParent) Object.defineProperty(window, 'parent', realParent);
  else Reflect.deleteProperty(window, 'parent');
  (globalThis as unknown as { __maudeVideoComps?: unknown }).__maudeVideoComps = undefined;
  resetMentionPeople();
});

function mountThread(c: OverlayComment, mine = false, extra: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CommentThread
        comment={c}
        sequence={1}
        onClose={() => {}}
        onPatch={(p) => ((extra.patches as unknown[]) ?? []).push(p)}
        onDelete={() => {}}
        onReply={async () => true}
        mine={mine}
      />
    );
  });
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const text = (sel: string) => q(sel)?.textContent?.trim() ?? null;

/** A fake shell: records what the overlay posts, answers with whatever the handler returns. */
function installShell(handle: (msg: Record<string, unknown>, reply: (m: unknown) => void) => void) {
  const fake = {
    postMessage(msg: Record<string, unknown>) {
      handle(msg, (data) =>
        queueMicrotask(() =>
          window.dispatchEvent(
            new MessageEvent('message', { data, source: fake as unknown as Window })
          )
        )
      );
    },
  };
  Object.defineProperty(window, 'parent', { configurable: true, get: () => fake });
  return fake;
}

describe('the thread popover (co-comment-thread)', () => {
  test('the header says where; Resolve sits beside it; the words are the sender’s', () => {
    document.body.innerHTML =
      '<div data-dc-screen="a4" data-dc-kind="print"><span class="dc-artboard-label">A4 · plakát</span><div class="dc-artboard-body"></div></div>';
    mountThread(comment({ artboard: 'a4' }));
    expect(text('[data-testid="comment-where-c1"]')).toBe('A4 · plakát');
    expect(
      q('.cm-thread__head .cm-thread__actions [data-testid="comment-resolve-c1"]')
    ).not.toBeNull();
    expect(text('.cm-thread__body')).toBe('Datum je moc male');
  });

  test('Delete comment is for the author only; someone else’s thread offers Resolve and no Delete', () => {
    mountThread(comment(), false);
    expect(q('[data-testid="comment-delete-c1"]')).toBeNull();
    expect(q('[data-testid="comment-resolve-c1"]')).not.toBeNull();
    act(() => root?.unmount());
    host?.remove();
    mountThread(comment(), true);
    expect(text('[data-testid="comment-delete-c1"]')).toBe('Delete comment');
    expect(text('[data-testid="comment-edit"]')).toBe('Edit');
  });

  test('a resolved thread offers Reopen', () => {
    mountThread(comment({ status: 'resolved' }));
    expect(text('[data-testid="comment-reopen-c1"]')).toContain('Reopen');
    expect(q('[data-testid="comment-resolve-c1"]')).toBeNull();
  });

  test('a converted sticky: the first message is the sticky’s author, the header says who moved it', () => {
    mountThread(
      comment({
        author: 'Michal',
        from: { kind: 'sticky', id: 's1', author: 'Jonas Beran', convertedBy: 'Michal', at: 'now' },
      }),
      true
    );
    expect(text('[data-testid="comment-from-c1"]')).toBe(
      'From Jonas’s sticky · turned into a comment by You'
    );
    expect(text('.cm-msg--root .cm-thread__author')).toBe('Jonas Beran');
    act(() => root?.unmount());
    host?.remove();
    mountThread(
      comment({
        author: 'Tereza',
        from: { kind: 'sticky', id: 's1', author: 'Jonas Beran', convertedBy: 'Tereza', at: 'now' },
      }),
      false
    );
    expect(text('[data-testid="comment-from-c1"]')).toBe(
      'From Jonas’s sticky · turned into a comment by Tereza'
    );
  });

  test('replies carry the AI mark when an AI wrote them', () => {
    mountThread(
      comment({
        thread: [
          {
            id: 'r1',
            author: 'Claude',
            body: 'done',
            created: new Date().toISOString(),
            authorKind: 'ai',
          },
        ],
      })
    );
    expect(text('.cm-thread__reply .cm-av')).toBe('AI');
  });
});

describe('where on the artboard (video time, print mm)', () => {
  test('a video comment says "at 0:12" and the chip parks the player there', () => {
    document.body.innerHTML = '<div data-dc-screen="reel" data-dc-kind="video"></div>';
    let sought = -1;
    let paused = false;
    (globalThis as unknown as { __maudeVideoComps: unknown }).__maudeVideoComps = new Map([
      [
        'v1',
        {
          artboardId: 'reel',
          fps: 30,
          ref: { current: { pause: () => (paused = true), seekTo: (f: number) => (sought = f) } },
        },
      ],
    ]);
    mountThread(comment({ artboard: 'reel', t: 12 }));
    expect(text('[data-testid="comment-chip-c1"]')).toBe('at 0:12');
    act(() => q('[data-testid="comment-chip-c1"]')?.click());
    expect(paused).toBe(true);
    expect(sought).toBe(360);
  });

  test('a print comment says how far from the trim, on the nearer side of each axis', () => {
    document.body.innerHTML =
      '<div data-dc-screen="flag" data-dc-kind="print" data-dc-print=\'{"paper":"a4"}\'><span class="dc-artboard-label">A · přední FLAG</span></div>';
    mountThread(comment({ artboard: 'flag', mm: { x: 14, y: 295 } }));
    expect(text('[data-testid="comment-chip-c1"]')).toBe(
      '14 mm from the left · 2 mm above the trim'
    );
    expect(text('[data-testid="comment-where-c1"]')).toBe('A · přední FLAG');
  });

  test('a pin on a video shows at its moment only; the playhead moving brings the next one up', async () => {
    let frame = 360; // 0:12 at 30 fps
    (globalThis as unknown as { __maudeVideoComps: unknown }).__maudeVideoComps = new Map([
      ['v1', { artboardId: 'reel', fps: 30, ref: { current: { getCurrentFrame: () => frame } } }],
    ]);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<CommentsOverlay />));
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            dgn: 'comments-set',
            comments: [
              comment({ id: 'at12', artboard: 'reel', t: 12 }),
              comment({ id: 'at21', artboard: 'reel', t: 21 }),
              comment({ id: 'plain' }),
            ],
          },
        })
      );
    });
    const wait = (ms: number) =>
      act(async () => {
        await new Promise((r) => setTimeout(r, ms));
      });
    const pins = () =>
      [...document.querySelectorAll('[data-comment-pin]')]
        .map((p) => p.getAttribute('data-comment-pin'))
        .sort();
    await wait(300);
    expect(pins()).toEqual(['at12', 'plain']);
    frame = 21 * 30;
    await wait(300);
    expect(pins()).toEqual(['at21', 'plain']);
  });
});

describe('the shell bridge', () => {
  test('an op goes to the shell and the shell’s answer comes back', async () => {
    const seen: Record<string, unknown>[] = [];
    installShell((msg, reply) => {
      seen.push(msg);
      if (msg.dgn !== 'comment-op') return;
      reply({ dgn: 'comment-op-ack', reqId: msg.reqId });
      reply({
        dgn: 'comment-op-result',
        reqId: msg.reqId,
        ok: true,
        comment: { id: 'c1', status: 'resolved' },
      });
    });
    const r = await shellCommentOp({ op: 'resolve', id: 'c1' });
    expect(r).toEqual({ ok: true, comment: { id: 'c1', status: 'resolved' } });
    expect(seen[0]).toMatchObject({ dgn: 'comment-op', op: { op: 'resolve', id: 'c1' } });
  });

  test('a refusal is a sentence, not a throw', async () => {
    installShell((msg, reply) => {
      reply({ dgn: 'comment-op-ack', reqId: msg.reqId });
      reply({
        dgn: 'comment-op-result',
        reqId: msg.reqId,
        ok: false,
        error: 'Ask the owner to change this.',
      });
    });
    expect(await shellCommentOp({ op: 'reply', id: 'c1', body: 'hi' })).toEqual({
      ok: false,
      error: 'Ask the owner to change this.',
    });
  });

  test('nobody acking means no bridge: null, so the caller sends the v1 message instead', async () => {
    installShell(() => {});
    expect(await shellCommentOp({ op: 'resolve', id: 'c1' })).toBeNull();
  });

  test('no shell at all (a standalone preview) is null as well', async () => {
    expect(await shellCommentOp({ op: 'resolve', id: 'c1' })).toBeNull();
  });

  test('only the shell can answer: a message from another window is ignored', async () => {
    installShell((msg) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { dgn: 'comment-op-ack', reqId: msg.reqId },
          source: window as unknown as Window,
        })
      );
    });
    expect(await shellCommentOp({ op: 'resolve', id: 'c1' })).toBeNull();
  });
});

describe('the mention popover', () => {
  async function typeAt(query: string) {
    const field = q('textarea[aria-label="Reply"]') as HTMLTextAreaElement;
    const key = Object.keys(field).find((k) => k.startsWith('__reactProps')) as string;
    const props = (
      field as unknown as Record<string, { onChange?: (e: unknown) => void; onFocus?: () => void }>
    )[key];
    act(() => props?.onFocus?.());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    act(() => {
      field.value = query;
      field.setSelectionRange(query.length, query.length);
      props?.onChange?.({ target: field });
    });
  }

  test('people who can open the canvas, with their role, and nothing else about them', async () => {
    installShell((msg, reply) => {
      if (msg.dgn === 'comment-people-request')
        reply({
          dgn: 'comment-people',
          reqId: msg.reqId,
          people: [
            { id: 'u1', name: 'Tereza Novak', role: 'Can edit' },
            { id: 'u2', name: 'Jonas Beran', role: 'Can comment' },
          ],
        });
    });
    mountThread(comment());
    await typeAt('@');
    const rows = [...document.querySelectorAll('.cm-mention-popup__item')].map(
      (r) => r.textContent
    );
    expect(rows).toEqual(['@terezaCan edit', '@jonasCan comment']);
    expect(document.querySelector('.cm-mention-popup__email')).toBeNull();
  });
});
