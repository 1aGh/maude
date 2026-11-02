// Round 11 (10 co-sync-offline): the thread card of a comment that waits on this Mac says so, in the
// board's words — "Queued — sends when this Mac is online." The mark is `queued: true`, stamped by the
// shell from the outbox (sync-states/row-words.js); the card draws only what it is given.
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
import { CommentThread, type OverlayComment } from '../comments-overlay.tsx';

const comment = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    file: '.design/ui/Board.tsx',
    selector: '',
    bounds: { x: 100, y: 100, w: 24, h: 24 },
    text: 'Pruh na rukávu sjednotit s helmou.',
    status: 'open',
    created: new Date(Date.now() - 60_000).toISOString(),
    resolved_at: null,
    author: 'Michal',
    thread: [],
    ...over,
  }) as unknown as OverlayComment;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  document.body.innerHTML = '';
});
function mountThread(c: OverlayComment) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CommentThread
        comment={c}
        sequence={1}
        onClose={() => {}}
        onPatch={() => {}}
        onDelete={() => {}}
        onReply={async () => true}
        mine
      />
    );
  });
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);

describe('the queued line on a comment that waits (co-sync-offline)', () => {
  test('a `queued` comment says "Queued — sends when this Mac is online." under its words', () => {
    mountThread(comment({ queued: true }));
    const line = q('[data-testid="comment-queued-c1"]');
    expect(line?.textContent?.trim()).toBe('Queued — sends when this Mac is online.');
    // the line sits in the comment's own message, after the body
    expect(line?.previousElementSibling?.classList.contains('cm-thread__body')).toBe(true);
  });

  test('a comment that is not queued says nothing', () => {
    mountThread(comment());
    expect(q('[data-testid="comment-queued-c1"]')).toBeNull();
  });

  test('a queued REPLY says it under the reply, not under the comment', () => {
    mountThread(
      comment({
        thread: [
          { id: 'r1', author: 'Michal', body: 'a', created: new Date().toISOString() },
          {
            id: 'r2',
            author: 'Michal',
            body: 'b',
            created: new Date().toISOString(),
            queued: true,
          },
        ],
      })
    );
    expect(q('[data-testid="comment-queued-c1"]')).toBeNull();
    expect(q('[data-testid="comment-queued-r1"]')).toBeNull();
    expect(q('[data-testid="comment-queued-r2"]')?.textContent?.trim()).toBe(
      'Queued — sends when this Mac is online.'
    );
  });
});
