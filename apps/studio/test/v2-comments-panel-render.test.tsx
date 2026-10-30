// S9.22 — the Comments panel rendered (10 · co-comment-thread): filters Open · Mine · Resolved · All
// (default Open), grouped by canvas, Reopen on a resolved thread, delete only your own — and the v1 test
// ids (comment-filter-*, comment-item-<id>) still answer.

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
import { CommentsPanel as V1Path } from '../client/shell/comments-panel.jsx';
import { CommentsPanel } from '../client/v2/comments/comments-panel.jsx';

const NOW = Date.parse('2026-10-18T14:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const H = 3600_000;
const A = '.design/ui/Combine kampan.tsx';
const B = '.design/ui/video-hype.tsx';

const data = {
  [A]: [
    {
      id: 'c1',
      text: 'Datum je moc male',
      status: 'open',
      created: iso(2 * H),
      author: 'Jonas',
      artboard: 'a4',
      thread: [{ id: 'r1', author: 'Tereza', body: 'ok', created: iso(H) }],
    },
    {
      id: 'c2',
      text: 'Logo o kousek vys',
      status: 'open',
      created: iso(26 * H),
      author: 'Michal',
      thread: [],
    },
    {
      id: 'c3',
      text: 'hotovo',
      status: 'resolved',
      created: iso(50 * H),
      author: 'Michal',
      thread: [],
    },
  ],
  [B]: [
    {
      id: 'c4',
      text: 'Logo naskoci brzo',
      status: 'open',
      created: iso(27 * H),
      author: 'Petra',
      artboard: 'reel',
      t: 12,
      thread: [],
    },
  ],
};

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

type Props = Record<string, unknown>;
function mount(props: Props = {}) {
  const calls = {
    filter: [] as string[],
    jump: [] as unknown[],
    resolve: [] as string[],
    reopen: [] as string[],
    del: [] as string[],
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CommentsPanel
        commentsByFile={data}
        filter="open"
        setFilter={(f: string) => calls.filter.push(f)}
        activePath={A}
        focusedId={null}
        onJump={(f: string, id: string | null) => calls.jump.push([f, id])}
        onResolve={(id: string) => calls.resolve.push(id)}
        onReopen={(id: string) => calls.reopen.push(id)}
        onDelete={(id: string) => calls.del.push(id)}
        me="Michal"
        now={NOW}
        artboardLabel={(_f: string, id: string) =>
          id === 'a4' ? 'A4 · plakát' : id === 'reel' ? 'Reels · nábor' : id
        }
        {...props}
      />
    );
  });
  return calls;
}
const q = (s: string) => document.querySelector<HTMLElement>(s);
const all = (s: string) => [...document.querySelectorAll<HTMLElement>(s)];

describe('the Comments panel', () => {
  test('the old import path is the same component', () => {
    expect(V1Path).toBe(CommentsPanel);
  });

  test('four filters in the contract order with counts; Open is selected', () => {
    mount();
    const tabs = all('[role="tab"]');
    expect(tabs.map((t) => t.getAttribute('data-testid'))).toEqual([
      'comment-filter-open',
      'comment-filter-mine',
      'comment-filter-resolved',
      'comment-filter-all',
    ]);
    expect(tabs.map((t) => t.textContent)).toEqual(['Open 3', 'Mine 2', 'Resolved 1', 'All 4']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
  });

  test('a filter click asks the host; Mine lists the threads you started, in every status', () => {
    const calls = mount();
    act(() => q('[data-testid="comment-filter-mine"]')?.click());
    expect(calls.filter).toEqual(['mine']);
    act(() => root?.unmount());
    host?.remove();
    mount({ filter: 'mine' });
    expect(all('[data-testid^="comment-item-"]').map((r) => r.getAttribute('data-testid'))).toEqual(
      ['comment-item-c2', 'comment-item-c3']
    );
  });

  test('grouped by canvas, the open canvas first; a row says where, when and how many replies', () => {
    mount();
    const groups = all('[data-testid^="comment-group-"]');
    expect(groups.map((g) => g.getAttribute('data-testid'))).toEqual([
      'comment-group-combine-kampan',
      'comment-group-video-hype',
    ]);
    expect(q('[data-testid="comment-where-c1"]')?.textContent).toBe('A4 · plakát');
    expect(q('[data-testid="comment-item-c1"]')?.textContent).toContain('1 h ago · 1 reply');
    // a video comment names its moment
    expect(q('[data-testid="comment-where-c4"]')?.textContent).toBe('Reels · nábor · at 0:12');
  });

  test('a row opens its thread; another canvas’s header opens that canvas; the open canvas’s header is a title, not a button', () => {
    const calls = mount();
    act(() => q('[data-testid="comment-item-c1"]')?.click());
    // p8-sweep-advanced — the open canvas has nothing to open (the dead-control crawl clicked it and nothing happened)
    expect(q('[data-testid="comment-group-combine-kampan"] .cmp-group-hd')?.tagName).not.toBe(
      'BUTTON'
    );
    const other = q('[data-testid="comment-group-video-hype"] button.cmp-group-hd');
    expect(other).not.toBeNull();
    act(() => other?.click());
    expect(calls.jump).toEqual([
      [A, 'c1'],
      [B, null],
    ]);
  });

  test('Resolve on an open thread, Reopen on a resolved one', () => {
    const calls = mount();
    act(() => q('[data-testid="comment-resolve-c1"]')?.click());
    expect(calls.resolve).toEqual(['c1']);
    expect(calls.jump).toEqual([]); // the click did not also open the thread
    act(() => root?.unmount());
    host?.remove();
    const calls2 = mount({ filter: 'resolved' });
    expect(q('[data-testid="comment-resolve-c3"]')).toBeNull();
    act(() => q('[data-testid="comment-reopen-c3"]')?.click());
    expect(calls2.reopen).toEqual(['c3']);
  });

  test('Delete comment is on your own threads only', () => {
    const calls = mount();
    expect(q('[data-testid="comment-delete-c1"]')).toBeNull(); // Jonas's
    expect(q('[data-testid="comment-delete-c4"]')).toBeNull(); // Petra's
    act(() => q('[data-testid="comment-delete-c2"]')?.click());
    expect(calls.del).toEqual(['c2']);
    expect(q('[data-testid="comment-delete-c2"]')?.getAttribute('aria-label')).toBe(
      'Delete comment'
    );
  });

  test('without handlers (a viewer) the thread is readable and nothing mutates', () => {
    mount({ onResolve: undefined, onReopen: undefined, onDelete: undefined });
    expect(all('.cmp-act')).toEqual([]);
    expect(q('[data-testid="comment-item-c1"]')).not.toBeNull();
  });

  test('a canvas with no comments at all: the 05 line with the canvas named, the C key in the sentence', () => {
    mount({ commentsByFile: {}, filter: 'open', activePath: A, onShare: () => {} });
    const e = q('[data-testid="comments-empty"]');
    expect(e?.getAttribute('data-copy')).toBe('es-panels-canvas.comments-none');
    expect(e?.querySelector('.es-sit')?.textContent).toBe('No comments on Combine kampan yet.');
    expect(e?.querySelector('.es-next')?.textContent).toContain(
      'Press C, then click anywhere on the canvas to leave one.'
    );
    expect(e?.querySelector('.es-next kbd, .es-next .kbd')?.textContent).toBe('C');
    expect(e?.querySelector('.es-spot')).not.toBeNull();
  });

  test('"Share for feedback" is the one action, and only where the host can share', () => {
    const shared: number[] = [];
    mount({ commentsByFile: {}, activePath: A, onShare: () => shared.push(1) });
    const btn = all('[data-testid="comments-empty"] button');
    expect(btn.map((b) => b.textContent)).toEqual(['Share for feedback']);
    act(() => btn[0].click());
    expect(shared).toEqual([1]);
    act(() => root?.unmount());
    host?.remove();
    mount({ commentsByFile: {}, activePath: A });
    expect(all('[data-testid="comments-empty"] button')).toEqual([]);
  });

  test('all resolved: "All done." with the confetti, and only here', () => {
    mount({ commentsByFile: { [A]: [{ ...data[A][2] }] }, filter: 'open', activePath: A });
    const e = q('[data-testid="comments-empty"]');
    expect(e?.getAttribute('data-copy')).toBe('es-panels-canvas.comments-done');
    expect(e?.querySelector('.es-sit')?.textContent).toBe('All done.');
    expect(e?.querySelector('.es-next')?.textContent).toBe(
      'Every comment on Combine kampan is resolved. They stay under Resolved, with their replies.'
    );
    expect(all('[data-testid="empty-confetti"]')).toHaveLength(1);
    expect(e?.querySelector('button')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    mount({ commentsByFile: {}, activePath: A });
    expect(all('[data-testid="empty-confetti"]')).toEqual([]);
  });

  test('a filter that is empty while others are not says which one, in plain words', () => {
    mount({ filter: 'mine', commentsByFile: { [A]: [{ ...data[A][1], author: 'Jonas' }] } });
    expect(q('[data-testid="comments-empty"]')?.textContent).toContain('You have not started');
    expect(all('[data-testid="empty-confetti"]')).toEqual([]);
  });

  test('a viewer who can comment: "…Jonas and Tereza see it right away." and no Share', async () => {
    const people = [
      { id: 'u1', name: 'Jonas', role: 'member' },
      { id: 'u2', name: 'Tereza', role: 'member' },
      { id: 'me', name: 'Petra', role: 'viewer' },
    ];
    const real = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ people })) as unknown as typeof fetch;
    try {
      mount({ commentsByFile: {}, activePath: A, viewer: true, me: 'Petra', onShare: () => {} });
      await act(async () => new Promise((r) => setTimeout(r, 20)));
      const e = q('[data-testid="comments-empty"]');
      expect(e?.getAttribute('data-copy')).toBe('es-viewer.viewer-comments-none');
      expect(e?.querySelector('.es-next')?.textContent).toContain(
        'Jonas and Tereza see it right away.'
      );
      expect(e?.querySelector('button')).toBeNull();
    } finally {
      globalThis.fetch = real;
    }
  });

  test('a viewer when nobody else can be named: the plain line, no half-filled sentence', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    try {
      mount({ commentsByFile: {}, activePath: A, viewer: true });
      await act(async () => new Promise((r) => setTimeout(r, 20)));
      expect(q('[data-testid="comments-empty"]')?.getAttribute('data-copy')).toBe(
        'es-panels-canvas.comments-none'
      );
      expect(q('[data-testid="comments-empty"]')?.textContent).not.toContain('{');
    } finally {
      globalThis.fetch = real;
    }
  });

  test('the names that see a comment, said as a sentence part', async () => {
    const { namesLine, emptyKind } = await import('../client/v2/comments/comments-model.js');
    expect(namesLine(['Jonas'])).toBe('Jonas');
    expect(namesLine(['Jonas', 'Tereza'])).toBe('Jonas and Tereza');
    expect(namesLine(['Jonas', 'Tereza', 'Petra'])).toBe('Jonas, Tereza and Petra');
    expect(namesLine(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 others');
    expect(emptyKind('open', { all: 0, open: 0, mine: 0, resolved: 0 })).toBe('none');
    expect(emptyKind('open', { all: 4, open: 0, mine: 0, resolved: 4 })).toBe('done');
    expect(emptyKind('resolved', { all: 4, open: 4, mine: 0, resolved: 0 })).toBe('filter');
  });

  test('a filter the host does not know falls back to Open', () => {
    mount({ filter: 'bogus' });
    expect(q('[data-testid="comment-filter-open"]')?.getAttribute('aria-selected')).toBe('true');
  });
});
