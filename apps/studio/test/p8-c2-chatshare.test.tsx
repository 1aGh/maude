// Phase 8 stage C round 2 — 03 AI Chat + 10 Share and collaboration: the open lists of the first pass.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { swatchOf, willChangeFor } from '../client/v2/ai/needs-you.js';
import { doneNotice, needsYouNotice } from '../client/v2/ai/needs-you-toast.js';
import PermissionCard from '../client/v2/ai/PermissionCard.jsx';
import { WillChange } from '../client/v2/ai/WillChange.jsx';
import { NoticeCard } from '../notifications.tsx';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('the toast is the kit one-line pill (03 ai-needs-hidden, 10 co-sync-back, 06 .k-toast)', () => {
  const entry = (over: Record<string, unknown>) =>
    ({ id: 'n1', title: 'Back online.', kind: 'info', ...over }) as never;

  // merged with p8-c2-kitadv: EVERY notice is the kit one-line pill (06 `.k-toast`): glyph · sentence · one
  // inline action · a quiet × (decision v2-p8-c2-toast-pill-every-notice) — the glyph-only pill rule is retired.
  test('glyph, text, one action and the quiet ×, in one pill', () => {
    const html = renderToStaticMarkup(
      <NoticeCard entry={entry({ icon: 'sync', action: { label: 'Show', onClick() {} } })} />
    );
    expect(html).toContain('maude-notice-ic--sync');
    expect(html).toContain('<svg');
    expect(html).toContain('Show');
    expect(html).toContain('maude-notice-close');
  });

  test('a notice without its own glyph takes its kind\'s, and is the same pill', () => {
    const html = renderToStaticMarkup(<NoticeCard entry={entry({ kind: 'success' })} />);
    expect(html).toContain('maude-notice-ic--done');
    expect(html).toContain('maude-notice-close');
  });

  test('Needs you leads with help, Done with the spark', () => {
    const n = needsYouNotice({ id: 'a', canvas: '.design/ui/X.tsx', line: 'Go', onOpen() {} });
    expect(n.icon).toBe('help');
    expect(doneNotice({ id: 'b', text: 'Done — ok.', onShow() {} })?.icon).toBe('spark');
  });
});

describe('03 ai-permission: what will change, named; a neutral card with the help glyph', () => {
  const run = (scope: unknown, touched = {}) => ({ scope, touched });
  const boards = [
    { id: 'post', label: 'Post 1:1' },
    { id: 'story', label: 'Story 9:16' },
    { id: 'a4', label: 'A4' },
    { id: 'reel', label: 'Reel' },
    { id: 'tile', label: 'Tile' },
  ];

  test('the scope names the artboards, four at most, the rest as a count', () => {
    const out = willChangeFor(
      run({ canvas: 'ui/x.tsx', artboards: ['post', 'story', 'a4', 'reel', 'tile'] }),
      boards
    );
    expect(out.boards.map((b: { label: string }) => b.label)).toEqual([
      'Post 1:1',
      'Story 9:16',
      'A4',
      'Reel',
    ]);
    expect(out.more).toBe(1);
  });

  test('a whole-canvas ask names what it has touched, and nothing when it has touched nothing', () => {
    expect(willChangeFor(run({ canvas: 'ui/x.tsx', artboards: '*' }), boards).boards).toEqual([]);
    const out = willChangeFor(
      run({ canvas: 'ui/x.tsx', artboards: '*' }, { 'ui/x.tsx': ['story'] }),
      boards
    );
    expect(out.boards).toEqual([{ id: 'story', label: 'Story 9:16' }]);
  });

  test('the strip draws one 28 x 22 tile per artboard and the names', () => {
    const html = renderToStaticMarkup(
      <WillChange
        boards={[
          { id: 'post', label: 'Post 1:1' },
          { id: 'story', label: 'Story 9:16' },
        ]}
        more={2}
      />
    );
    expect(html.match(/ai-nc-will-th/g)?.length).toBe(2);
    expect(html).toContain('Post 1:1 · Story 9:16 · +2');
    expect(renderToStaticMarkup(<WillChange boards={[]} />)).toBe('');
  });

  test('the card leads with the help glyph, not the spark, and carries the strip', () => {
    const request = {
      id: 'p1',
      toolCall: { kind: 'edit', title: 'Edit post.tsx', locations: [{ path: '/p/post.tsx' }] },
      options: [
        { optionId: 'a', kind: 'allow_once', name: 'Allow' },
        { optionId: 'r', kind: 'reject_once', name: 'Reject' },
      ],
    };
    const html = renderToStaticMarkup(
      <PermissionCard
        request={request}
        onRespond={() => {}}
        willChange={{ boards: [{ id: 'post', label: 'Post 1:1' }], more: 0 }}
      />
    );
    expect(html).toContain('ai-nc-ic--ask');
    expect(html).not.toContain('M8 1.5l1.4 3.7'); // the spark path
    expect(html).toContain('ai-permission-will');
  });

  test('a question is a neutral card — no accent inset ring on the permission / choice card', () => {
    const css = read('client/v2/ai/needs-you.css');
    expect(css).not.toMatch(/\.ai-nc-perm,\s*\.ai-nc-choice\s*\{[^}]*var\(--accent\)/);
  });
});

describe('03 ai-choice-fail: a row names its colour with a disc', () => {
  test('only a literal hex is a colour', () => {
    expect(swatchOf({ label: 'Green #2f9e44' })).toBe('#2f9e44');
    expect(swatchOf({ label: 'Light', hint: 'like #fff' })).toBe('#fff');
    expect(swatchOf({ label: 'Green' })).toBeNull();
    expect(swatchOf({ label: 'url(javascript:1)' })).toBeNull();
  });
});

describe('03 ai-chat-list: one header, and a 22 px disc for the state', () => {
  test('the chat header steps aside while the list is open', () => {
    expect(read('client/panels/ChatPanel.jsx')).toMatch(
      /menuOpen && connected \? null : \(\s*<ChatHeader/
    );
  });
  test('the row state is the 22 px run disc, not an 8 px dot', () => {
    const css = read('client/v2/ai/ai-list-advanced.css');
    const rule = /\.ai-cl-state \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('width: 22px');
    expect(read('client/v2/ai/ChatList.jsx')).toContain('<RunIcon state={state} />');
  });
});

describe('03 ai-not-ready: the connect sheet floats over the panel as its own card', () => {
  test('inline means over the panel, not clipped inside the slot', () => {
    const css = read('client/v2/ai/needs-you.css');
    const rule = /\.ai-conn-sheet--inline \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('position: absolute');
    expect(css).toContain('.ai-island:has(.ai-conn-sheet--inline) .ai-suggest');
  });
});

describe('10 co-comment-thread: the Comments panel', () => {
  test('a row wears the author tone face with one letter; the AI wears the spark', async () => {
    const { CommentsPanel } = await import('../client/v2/comments/comments-panel.jsx');
    const mk = (id: string, author: string, authorKind = 'human') => ({
      id,
      author,
      authorKind,
      text: 'Datum je moc malé',
      resolved: false,
      replies: 0,
      time: '2 h ago',
      file: '.design/ui/a.tsx',
    });
    const html = renderToStaticMarkup(
      <CommentsPanel
        commentsByFile={{ '.design/ui/a.tsx': [mk('c1', 'Jonas'), mk('c2', 'Claude', 'ai')] }}
        filter="open"
        activePath=".design/ui/a.tsx"
        me="Michal"
        now={Date.now()}
        onClose={() => {}}
      />
    );
    expect(html).toMatch(/k-av k-av--md k-av--[a-z]+[^>]*>J</);
    expect(html).toContain('cmp-av is-ai');
    expect(html).toContain('comments-panel-close');
  });

  test('the filter count has air before it ("Open 4"), and the reply field says "Reply…"', () => {
    expect(read('client/v2/comments/comments.css')).toMatch(
      /\.cmp-seg-b \.cmp-n \{[^}]*margin-left: var\(--space-1\)/
    );
    expect(read('comments-overlay.tsx')).toContain('placeholder="Reply…"');
  });

  test('the panel is closable from the shell (onClose reaches togglePanel)', () => {
    expect(read('client/hooks/use-palette-and-panels.jsx')).toContain(
      "onClose={() => togglePanel('comments')}"
    );
  });
});
