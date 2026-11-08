// r2-browser-reds — one local identity across the origin split (rc.1 F08 after V2-8.9 r2 L1). On a Mac with
// no git user.name a comment is signed with the OS account ("iagh"); the shell (main origin) knows that name,
// but the canvas origins are told only "You" (L1: canvas code never reads the account name). So the canvas
// compared "iagh" to "You": your own pin read "by iagh", the thread card did not offer you your own comment.
// The trusted shell now says which comments and replies are yours (`mine: true`) when it hands them to the
// canvas; the canvas wears "You" on those without ever learning the name.

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
import { markMine, mineIdsOf, restampMine, viewerFor } from '../comments/mine-stamp.ts';
import { CommentsOverlay, type OverlayComment } from '../comments-overlay.tsx';

const FILE = '.design/ui/Board.tsx';
const comment = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    file: FILE,
    selector: '',
    bounds: { x: 100, y: 100, w: 24, h: 24 },
    text: 'Make this bigger',
    status: 'open',
    created: new Date().toISOString(),
    resolved_at: null,
    author: 'iagh',
    thread: [],
    ...over,
  }) as unknown as OverlayComment;

describe('markMine (the shell side)', () => {
  test('stamps the comments and replies signed with the viewer’s name, and nothing else', () => {
    const list = [
      {
        id: 'a',
        author: 'iagh',
        thread: [
          { id: 'r1', author: 'Jonas' },
          { id: 'r2', author: ' iagh ' },
        ],
      },
      { id: 'b', author: 'Jonas' },
      { id: 'c', author: 'iagh', authorKind: 'ai' },
    ];
    const out = markMine(list, 'iagh');
    expect(out[0].mine).toBe(true);
    expect(out[0].thread?.map((r) => r.mine === true)).toEqual([false, true]);
    expect(out[1].mine).toBeUndefined();
    expect(out[2].mine).toBeUndefined(); // an AI-written comment is never a person's
    // the shell's own list is not touched
    expect((list[0] as { mine?: boolean }).mine).toBeUndefined();
  });

  // #168 G2 — a stamped record still carried the viewer's own author string to the canvas, so `mine: true` told
  // canvas code which name is this viewer's. A record that is the viewer's crosses as "You"; others keep theirs.
  test('a record that is yours crosses to the canvas as "You", never your author string', () => {
    const out = markMine(
      [
        {
          id: 'a',
          author: 'iagh',
          thread: [
            { id: 'r1', author: 'iagh' },
            { id: 'r2', author: 'Jonas' },
          ],
        },
        { id: 'b', author: 'Jonas' },
      ],
      'iagh'
    );
    expect(JSON.stringify(out)).not.toContain('iagh');
    expect(out[0].author).toBe('You');
    expect(out[0].thread?.map((r) => r.author)).toEqual(['You', 'Jonas']);
    expect(out[1].author).toBe('Jonas');
    // the canvas still reads a stamped record as yours
    expect(viewerFor(out[0], 'You')).toBe('You');
  });

  test('no viewer name: nothing is stamped (and a stamp the list already carried is dropped)', () => {
    expect(markMine([{ id: 'a', author: 'iagh', mine: true }], null)[0].mine).toBeUndefined();
    expect(markMine([{ id: 'a', author: '', mine: true }], '')[0].mine).toBeUndefined();
  });

  test('the ids survive a list that arrives without stamps (the live-collab array)', () => {
    const ids = mineIdsOf(
      markMine([{ id: 'a', author: 'iagh', thread: [{ id: 'r', author: 'iagh' }] }], 'iagh')
    );
    const again = restampMine(
      [
        { id: 'a', author: 'iagh', thread: [{ id: 'r', author: 'iagh' }] },
        { id: 'z', author: 'x' },
      ],
      ids
    );
    expect(again[0].mine).toBe(true);
    expect(again[0].thread?.[0].mine).toBe(true);
    expect(again[1].mine).toBeUndefined();
  });
});

let root: Root | null = null;
let host: HTMLElement | null = null;
const realFetch = globalThis.fetch;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  document.body.innerHTML = '';
  globalThis.fetch = realFetch;
});

describe('the canvas wears "You" on what the shell says is yours', () => {
  test('a pin the shell marks as mine says "by You" though the canvas only knows "You"', async () => {
    // the canvas origin's /_api/git-user answer on a Mac with no git name (canvasUserName)
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: 'You' }), {
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<CommentsOverlay />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            dgn: 'comments-set',
            comments: markMine(
              [comment({ id: 'mine1' }), comment({ id: 'theirs', author: 'Jonas' })],
              'iagh'
            ),
          },
          // #168 F3 (6532961ad) — the overlay hears only its shell: post from the parent frame
          source: window.parent as unknown as Window,
        })
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    const label = (id: string) =>
      document.querySelector(`[data-comment-pin="${id}"]`)?.getAttribute('aria-label') ?? '';
    expect(label('mine1')).toContain('by You');
    expect(label('theirs')).toContain('by Jonas');
  });
});
