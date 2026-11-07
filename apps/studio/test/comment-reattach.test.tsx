// #151 §5 (T2.3, D5) — "Re-attach to element", the client half: the thread card's button, the
// document-event hand-off between the card (overlay) and the click owner (mount), and the op a
// pick turns into. The op's own rules (validation, authorship) are comments-reattach-op.test.ts.
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
import { createRoot } from 'react-dom/client';
import {
  cancelReattach,
  listenForReattach,
  listenForReattachPick,
  pendingReattach,
  pickForReattach,
  type ReattachPick,
  reattachOpFor,
  requestReattach,
} from '../comment-reattach.ts';
import { CommentThread, type OverlayComment } from '../comments-overlay.tsx';

const thread = (extra: Record<string, unknown> = {}): OverlayComment =>
  ({
    id: 'c_9',
    file: '.design/ui/Site.tsx',
    selector: '[data-dc-screen="a"]',
    text: 'Label is off',
    author: 'Ana',
    created: new Date().toISOString(),
    status: 'open',
    thread: [],
    ...extra,
  }) as unknown as OverlayComment;

async function render(comment: OverlayComment, onReattach?: () => void) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <CommentThread
        comment={comment}
        sequence={1}
        onClose={() => {}}
        onPatch={() => {}}
        onDelete={() => {}}
        onReply={async () => true}
        onReattach={onReattach}
        mine={false}
        me="Bo"
      />
    );
    await new Promise((r) => setTimeout(r, 20));
  });
  return {
    q: (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`),
    done: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe('the thread card offers Re-attach to element', () => {
  test('an element comment gets the button, and pressing it asks to re-attach', async () => {
    let asked = 0;
    const t = await render(thread(), () => asked++);
    const btn = t.q('comment-reattach-c_9');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-label')).toBe('Re-attach to element');
    act(() => btn?.click());
    expect(asked).toBe(1);
    t.done();
  });

  test('a floating comment (a point, no element yet) can be re-attached too', async () => {
    const t = await render(thread({ selector: '', world: { x: 1, y: 2 } }), () => {});
    expect(t.q('comment-reattach-c_9')).not.toBeNull();
    t.done();
  });

  test('a note on a board object, a video moment or a point on paper has no button', async () => {
    for (const extra of [
      { annotationId: 'an_1' },
      { t: 3.2, artboard: 'v' },
      { mm: { x: 1, y: 1 }, artboard: 'p' },
    ]) {
      const t = await render(thread(extra), () => {});
      expect(t.q('comment-reattach-c_9')).toBeNull();
      t.done();
    }
  });

  test('without a handler (a host that cannot take the click) there is no button', async () => {
    const t = await render(thread());
    expect(t.q('comment-reattach-c_9')).toBeNull();
    t.done();
  });
});

describe('the overlay → mount → overlay hand-off', () => {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    for (const d of disposers.splice(0)) d();
    cancelReattach();
  });

  const SEL = {
    selector: '[data-dc-screen="a"] > div:nth-child(1) > span:nth-child(2)',
    index: 0,
    dom_path: ['div', 'span'],
    tag: 'span',
    classes: 'lbl',
    bounds: { x: 1, y: 2, w: 3, h: 4 },
    html: '<span class="lbl">x</span>',
    artboardId: 'a',
    world: { x: 10, y: 20 },
  };

  test('start arms the mount; the next click is taken as the anchor and names the thread', () => {
    let armed = 0;
    const picks: ReattachPick[] = [];
    disposers.push(
      listenForReattach(
        () => armed++,
        () => {}
      ),
      listenForReattachPick(
        (p) => picks.push(p),
        () => {}
      )
    );
    expect(pickForReattach(SEL, 5, 6)).toBe(false); // nothing waiting: the click is a plain comment
    requestReattach('c_9');
    expect(armed).toBe(1);
    expect(pendingReattach()).toBe('c_9');
    expect(pickForReattach(SEL, 5, 6)).toBe(true);
    expect(pendingReattach()).toBeNull();
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ id: 'c_9', clientX: 5, clientY: 6 });
    expect(picks[0]?.selection.selector).toBe(SEL.selector);
    // one click only: the next is a plain comment again
    expect(pickForReattach(SEL, 1, 1)).toBe(false);
  });

  test('cancel ends the wait on both sides, with no pick', () => {
    let cancelled = 0;
    let overlayCancelled = 0;
    const picks: ReattachPick[] = [];
    disposers.push(
      listenForReattach(
        () => {},
        () => cancelled++
      ),
      listenForReattachPick(
        (p) => picks.push(p),
        () => overlayCancelled++
      )
    );
    requestReattach('c_9');
    cancelReattach();
    expect(cancelled).toBe(1);
    expect(overlayCancelled).toBe(1);
    expect(pendingReattach()).toBeNull();
    expect(pickForReattach(SEL, 5, 6)).toBe(false);
    expect(picks).toHaveLength(0);
  });

  test('a start without an id arms nothing', () => {
    let armed = 0;
    disposers.push(
      listenForReattach(
        () => armed++,
        () => {}
      )
    );
    document.dispatchEvent(new CustomEvent('cm:reattach-start', { detail: {} }));
    expect(armed).toBe(0);
    expect(pendingReattach()).toBeNull();
  });
});

describe('the op a pick becomes', () => {
  test('carries the element anchor, the click world point and the artboard it landed on', () => {
    const op = reattachOpFor(
      'c_9',
      {
        selector: '[data-cd-id="x"]',
        index: 2,
        dom_path: ['div'],
        tag: 'span',
        classes: 'lbl',
        bounds: { x: 1, y: 2, w: 3, h: 4 },
        html: '<span/>',
        world: { x: 10, y: 20 },
      },
      { artboard: 'a' }
    );
    expect(op).toEqual({
      op: 'reattach',
      id: 'c_9',
      selector: '[data-cd-id="x"]',
      index: 2,
      dom_path: ['div'],
      tag: 'span',
      classes: 'lbl',
      bounds: { x: 1, y: 2, w: 3, h: 4 },
      html_excerpt: '<span/>',
      world: { x: 10, y: 20 },
      artboard: 'a',
    });
  });
});
