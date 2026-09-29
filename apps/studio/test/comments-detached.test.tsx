// Issues #134 / #136 — a comment on a sticky "can't be saved" / "disappears
// after a while".
//
// A click in comment mode that lands outside an artboard (a sticky, a drawing,
// empty canvas) made a FLOATING comment with `selector: ''`. `CommentPin` could
// not resolve an empty selector, so after ORPHAN_GRACE_MS it called
// `onOrphaned` → `handleDelete` → `comment-delete`, and the shell deleted the
// comment for everyone ~3.5 s after it was saved (measured E2E on shipped
// v1.4.5, `.ai/plans/notes/multiplayer-parity-harness/`). Any peer whose DOM
// could not resolve an element comment did the same.
//
// The rule now (owner decision 2026-09-29): software never deletes a comment.
// A comment whose target cannot be found is DETACHED — it stays, visibly, at
// its last known place — and only a person deletes it. A comment placed on an
// annotation anchors to that annotation's id and follows it; a comment placed
// on empty canvas holds a WORLD point, so it stays put through pan and zoom.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommentsOverlay, type OverlayComment } from '../comments-overlay.tsx';

const FILE = '.design/ui/Board.tsx';

function comment(id: string, over: Partial<OverlayComment> & Record<string, unknown>) {
  return {
    id,
    file: FILE,
    selector: '',
    bounds: { x: 100, y: 100, w: 24, h: 24 },
    text: `comment ${id}`,
    status: 'open',
    created: `2026-09-29T10:00:0${id.length % 10}.000Z`,
    resolved_at: null,
    author: 'Alice',
    thread: [],
    ...over,
  } as OverlayComment;
}

/** happy-dom reports 0×0 rects; give an element a real one. */
function giveRect(el: Element, r: { x: number; y: number; w: number; h: number }) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      left: r.x,
      top: r.y,
      right: r.x + r.w,
      bottom: r.y + r.h,
      width: r.w,
      height: r.h,
      x: r.x,
      y: r.y,
      toJSON: () => ({}),
    }) as DOMRect;
}

const posted: unknown[] = [];
let root: Root | null = null;
let host: HTMLElement | null = null;
let realPost: typeof window.postMessage;

function mount(comments: OverlayComment[]) {
  posted.length = 0;
  realPost = window.parent.postMessage.bind(window.parent);
  window.parent.postMessage = ((msg: unknown) => {
    posted.push(msg);
  }) as typeof window.postMessage;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<CommentsOverlay />));
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { dgn: 'comments-set', comments } }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  window.parent.postMessage = realPost;
  document.body.innerHTML = '';
  (window as unknown as { __maudeViewport?: unknown }).__maudeViewport = undefined;
});

const deletes = () =>
  posted.filter((m) => (m as { dgn?: string } | null)?.dgn === 'comment-delete');
const pin = (id: string) => document.querySelector<HTMLElement>(`[data-comment-pin="${id}"]`);
const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe('#134/#136 — software never deletes a comment', () => {
  test('floating, annotation-anchored and unresolvable comments survive past the old grace window', async () => {
    mount([
      comment('floating', {}),
      comment('on-sticky', { annotationId: 's_gone' }),
      comment('lost-element', { selector: '[data-cd-id="nope"]', tag: 'button' }),
    ]);
    await wait(3700); // ORPHAN_GRACE_MS was 3000
    expect(deletes()).toEqual([]);
    expect(pin('floating')).not.toBeNull();
    expect(pin('on-sticky')).not.toBeNull();
    expect(pin('lost-element')).not.toBeNull();
  });

  test('a comment whose target is gone is marked detached, and a floating one is not', async () => {
    mount([
      comment('floating', {}),
      comment('on-sticky', { annotationId: 's_gone' }),
      comment('lost-element', { selector: '[data-cd-id="nope"]', tag: 'button' }),
    ]);
    await wait(3700);
    expect(pin('lost-element')?.getAttribute('data-detached')).toBe('true');
    expect(pin('on-sticky')?.getAttribute('data-detached')).toBe('true');
    expect(pin('floating')?.getAttribute('data-detached')).toBe('false');
    expect(pin('lost-element')?.getAttribute('aria-label')).toContain('detached');
  });
});

describe('anchors', () => {
  test('a comment on an annotation follows that annotation', async () => {
    document.body.innerHTML = '<svg><g data-id="s_sticky1" data-tool="sticky"><rect/></g></svg>';
    const g = document.querySelector('[data-id="s_sticky1"]');
    if (!g) throw new Error('fixture');
    giveRect(g, { x: 300, y: 200, w: 120, h: 80 });
    mount([comment('on-sticky', { annotationId: 's_sticky1', bounds: null })]);
    await wait(50);
    // Pin centre at the target's top-right corner: (right - 12, top - 12).
    expect(pin('on-sticky')?.style.left).toBe(`${300 + 120 - 12}px`);
    expect(pin('on-sticky')?.style.top).toBe(`${200 - 12}px`);
    expect(pin('on-sticky')?.getAttribute('data-detached')).toBe('false');

    giveRect(g, { x: 500, y: 260, w: 120, h: 80 }); // a peer moved the sticky
    await wait(50);
    expect(pin('on-sticky')?.style.left).toBe(`${500 + 120 - 12}px`);
  });

  test('a floating comment holds a world point through pan and zoom', async () => {
    const canvas = document.createElement('div');
    canvas.className = 'dc-canvas';
    document.body.append(canvas);
    giveRect(canvas, { x: 0, y: 0, w: 1000, h: 800 });
    let vp = { x: 10, y: 20, zoom: 2 };
    (window as unknown as { __maudeViewport?: () => typeof vp }).__maudeViewport = () => vp;
    mount([comment('floating', { world: { x: 100, y: 50 }, bounds: null })]);
    await wait(50);
    // screen point = vp + world·zoom = (210, 120); pin centred on it.
    expect(pin('floating')?.style.left).toBe('210px');
    expect(pin('floating')?.style.top).toBe(`${120 - 24}px`);

    vp = { x: -90, y: 20, zoom: 1 }; // pan left, zoom out
    await wait(50);
    expect(pin('floating')?.style.left).toBe('10px');
    expect(pin('floating')?.style.top).toBe(`${70 - 24}px`);
  });
});
