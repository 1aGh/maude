// P8 c10 ann - 15 an-convert: the converted-thread card draws what the board draws and nothing else at rest - the
// caption line ("From Jonas's sticky · turned into a comment by You · Undo"), the messages, and a foot of Resolve +
// "⋯". No Edit / Delete comment / ✕ header, no Reply field: they live behind the "⋯" (nothing is deleted). The card
// also sits beside ITS pin - a converted note is anchored by a world point, which the old anchor ignored (the card
// fell to the top-left corner).
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
import { CommentThread, computeThreadAnchor, type OverlayComment } from '../comments-overlay.tsx';

const converted = (extra: Record<string, unknown> = {}): OverlayComment =>
  ({
    id: 'c_1',
    file: '.design/ui/Site.tsx',
    text: 'Mobile: button above the fold?',
    author: 'Jonas',
    created: new Date().toISOString(),
    status: 'open',
    thread: [],
    from: { kind: 'sticky', id: 's_1', author: 'Jonas', convertedBy: 'Michal', at: '' },
    ...extra,
  }) as unknown as OverlayComment;

const plain = (): OverlayComment =>
  ({
    id: 'c_2',
    file: '.design/ui/Site.tsx',
    text: 'Photo is small',
    author: 'Michal',
    created: new Date().toISOString(),
    status: 'open',
    thread: [],
  }) as unknown as OverlayComment;

async function render(comment: OverlayComment, mine = true) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const calls: string[] = [];
  await act(async () => {
    root.render(
      <CommentThread
        comment={comment}
        sequence={1}
        onClose={() => calls.push('close')}
        onPatch={(p) => calls.push(`patch:${JSON.stringify(p)}`)}
        onDelete={() => calls.push('delete')}
        onReply={async () => true}
        mine={mine}
        me="Michal"
      />
    );
    await new Promise((r) => setTimeout(r, 20));
  });
  return {
    host,
    calls,
    q: (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`),
    done: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe('15 an-convert: the converted card carries only the board controls at rest', () => {
  test('no Edit, no Delete comment, no ✕ header, no Reply field; Resolve and ⋯ remain', async () => {
    const t = await render(converted());
    expect(t.q('comment-edit')).toBeNull();
    expect(t.q('comment-delete-c_1')).toBeNull();
    expect(t.host.querySelector('.cm-thread__close')).toBeNull();
    expect(t.host.querySelector('[aria-label="Reply"]')).toBeNull();
    expect(t.q('comment-resolve-c_1')).not.toBeNull();
    expect(t.q('comment-menu-c_1')).not.toBeNull();
    // the caption line is first, the words follow
    const root = t.host.querySelector('.cm-thread') as HTMLElement;
    expect(
      root.firstElementChild?.querySelector('[data-testid="comment-from-c_1"]')
    ).not.toBeNull();
    expect(t.host.textContent).toContain('Mobile: button above the fold?');
    t.done();
  });

  test('the ⋯ keeps every dropped function: Reply…, Edit, Turn back into a sticky, Delete comment', async () => {
    const t = await render(converted());
    await act(async () => {
      t.q('comment-menu-c_1')?.click();
    });
    const items = [...t.host.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent);
    expect(items).toEqual(['Reply…', 'Edit', 'Turn back into a sticky', 'Delete comment']);
    await act(async () => {
      t.q('comment-menu-reply-c_1')?.click();
    });
    expect(t.host.querySelector('[aria-label="Reply"]')).not.toBeNull();
    await act(async () => {
      t.q('comment-menu-c_1')?.click();
    });
    await act(async () => {
      t.q('comment-delete-c_1')?.click();
    });
    expect(t.calls).toEqual(['delete', 'close']);
    t.done();
  });

  test('a plain comment keeps its header (Edit · Resolve · Delete comment · ✕) and its reply field', async () => {
    const t = await render(plain());
    expect(t.q('comment-edit')).not.toBeNull();
    expect(t.q('comment-delete-c_2')).not.toBeNull();
    expect(t.host.querySelector('.cm-thread__close')).not.toBeNull();
    expect(t.host.querySelector('[aria-label="Reply"]')).not.toBeNull();
    t.done();
  });
});

describe('15 an-convert: the card sits beside its pin', () => {
  test('a note anchored by a world point anchors its card at the pin, not the top-left corner', () => {
    // no selector and no stored bounds: only `world` names the place (pin and card share locateComment)
    const w = window as unknown as { __maudeViewport?: () => unknown };
    const canvas = document.createElement('div');
    canvas.className = 'dc-canvas';
    document.body.append(canvas);
    w.__maudeViewport = () => ({ x: 0, y: 0, zoom: 1 });
    try {
      const a = computeThreadAnchor(converted({ world: { x: 400, y: 300 } }));
      // the pin box is the point +- 12: right edge 412, top 288 -> the card is 8 px beyond it, level with the pin
      expect(a).toEqual({ x: 412 + 8, y: 288 - 28 });
    } finally {
      w.__maudeViewport = undefined;
      canvas.remove();
    }
  });
  test('a converted card opens to the right of the pin, level with it', () => {
    const a = computeThreadAnchor(converted({ bounds: { x: 100, y: 200, w: 0, h: 0 } }));
    // the pin is centred at (right - 14, top - 14): 28 px wide, so its right edge is `right`
    expect(a.x).toBe(100 + 8);
    expect(a.y).toBe(200 - 28);
  });
});
