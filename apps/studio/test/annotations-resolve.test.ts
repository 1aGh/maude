// S4.12 (canvas 15 `an-sticky`, `an-convert`, the ⌘K "resolved" frame) — Resolve strikes a sticky through
// in place and keeps it; Reopen undoes it; ⌘K selects or trashes the resolved ones with one undo step.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnnotationElement } from '../annotations/types.ts';
import { ElementNode } from '../annotations/ui/element-node.tsx';
import { strokeToRenderItem } from '../annotations/ui/render-model.ts';
import {
  markResolved,
  NO_RESOLVED_LINE,
  resolvedCountMeta,
  resolveVerb,
  selectResolvedIds,
  toggleResolved,
  trashedLine,
  withoutResolvedStickies,
} from '../annotations/ui/sticky-resolve.ts';
import { filterByAuthors, withoutResolved } from '../annotations/ui/visibility.ts';
import { elementsToStrokes, strokesToElementMap } from '../annotations/v1-adapter.ts';
import type { StickyStroke, Stroke } from '../annotations-model.ts';

const AT = '2026-10-19T10:00:00Z';
const sticky = (id: string, o: Partial<StickyStroke> = {}): StickyStroke => ({
  id,
  tool: 'sticky',
  color: '#fce8a6',
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  text: `note ${id}`,
  fontSize: 14,
  ...o,
});
const rect = (id: string): Stroke => ({
  id,
  tool: 'rect',
  color: '#1f1f1f',
  width: 2,
  x: 0,
  y: 0,
  w: 50,
  h: 50,
});

describe('Resolve / Reopen on the selection', () => {
  const board: Stroke[] = [sticky('a'), sticky('b'), rect('r')];

  test('the verb: Resolve while any is open, Reopen when all are resolved, nothing for non-stickies', () => {
    expect(resolveVerb(board, ['a'])).toBe('resolve');
    expect(resolveVerb(board, ['r'])).toBeNull();
    const done = toggleResolved(board, ['a'], 'Jonas', AT);
    expect(resolveVerb(done, ['a'])).toBe('reopen');
    expect(resolveVerb(done, ['a', 'b'])).toBe('resolve'); // b is open
  });

  test('resolving stamps who and when, touches only the selected stickies, and keeps them in the list', () => {
    const next = toggleResolved(board, ['a', 'r'], 'Jonas', AT);
    expect(next).toHaveLength(3);
    expect((next[0] as StickyStroke).resolved).toEqual({ by: 'Jonas', at: AT });
    expect(next[1]).toBe(board[1]);
    expect(next[2]).toBe(board[2]);
  });

  test('reopening drops the stamp; the first answer stands when resolving again', () => {
    const done = toggleResolved(board, ['a'], 'Jonas', AT);
    const open = toggleResolved(done, ['a'], 'Tereza', '2026-10-20T10:00:00Z');
    expect((open[0] as StickyStroke).resolved).toBeUndefined();
    const both = toggleResolved(done, ['a', 'b'], 'Tereza', '2026-10-20T10:00:00Z');
    expect((both[0] as StickyStroke).resolved).toEqual({ by: 'Jonas', at: AT });
    expect((both[1] as StickyStroke).resolved).toEqual({
      by: 'Tereza',
      at: '2026-10-20T10:00:00Z',
    });
  });

  test('a locked sticky resolves too (a lock guards dragging, not "done")', () => {
    const next = toggleResolved([sticky('l', { locked: true })], ['l'], 'Jonas', AT);
    expect((next[0] as StickyStroke).resolved?.by).toBe('Jonas');
  });

  test('markResolved (the AI answered these) never reopens', () => {
    const done = toggleResolved(board, ['a'], 'Jonas', AT);
    const next = markResolved(done, ['a', 'b'], 'AI', AT);
    expect((next[0] as StickyStroke).resolved?.by).toBe('Jonas');
    expect((next[1] as StickyStroke).resolved?.by).toBe('AI');
  });
});

describe('it is in the file, not just on the screen', () => {
  const el: AnnotationElement = {
    id: 'a',
    type: 'sticky',
    index: 'a0',
    x: 10,
    y: 20,
    w: 200,
    h: 200,
    fill: '#fce8a6',
    text: 'Photo bigger?',
    fontSize: 14,
  };

  test('Resolve written from the UI reaches the element, and Reopen removes it (a removal is real)', () => {
    const current = new Map([[el.id, el]]);
    const strokes = elementsToStrokes([el]);
    const resolved = toggleResolved(strokes, ['a'], 'Jonas', AT);
    const written = strokesToElementMap(resolved, current).get('a');
    expect(written?.resolved).toEqual({ by: 'Jonas', at: AT });
    const back = elementsToStrokes([written as AnnotationElement]);
    expect((back[0] as StickyStroke).resolved).toEqual({ by: 'Jonas', at: AT });
    const reopened = toggleResolved(back, ['a'], 'Jonas', AT);
    const rewritten = strokesToElementMap(
      reopened,
      new Map([['a', written as AnnotationElement]])
    ).get('a');
    expect(rewritten?.resolved).toBeUndefined();
  });

  test('where an import came from survives an edit of its words', () => {
    const imported = { ...el, source: { kind: 'figjam', author: 'Tereza' } };
    const strokes = elementsToStrokes([imported]);
    expect((strokes[0] as StickyStroke).source).toEqual({ kind: 'figjam', author: 'Tereza' });
    const edited = strokes.map((s) => ({ ...s, text: 'changed' }) as Stroke);
    const written = strokesToElementMap(edited, new Map([['a', imported]])).get('a');
    expect(written?.source).toEqual({ kind: 'figjam', author: 'Tereza' });
  });
});

describe('what the sticky looks like when resolved', () => {
  const draw = (s: StickyStroke) => {
    const item = strokeToRenderItem(s);
    return renderToStaticMarkup(
      createElement(ElementNode, {
        el: (item as { el: AnnotationElement }).el,
        interactive: false,
        edit: null,
        resolveAsset: (h: string) => h,
      })
    );
  };
  test('struck through with a tick, its words kept', () => {
    const html = draw(sticky('a', { resolved: { by: 'Jonas', at: AT }, text: 'Photo bigger?' }));
    expect(html).toContain('line-through');
    expect(html).toContain('data-resolved="1"');
    expect(html).toContain('Photo bigger?');
    expect(html).toContain('Resolved by Jonas');
  });
  test('an open sticky is neither', () => {
    const html = draw(sticky('a'));
    expect(html).not.toContain('line-through');
    expect(html).not.toContain('data-resolved');
  });
  test('Hide resolved stickies (C29) still hides exactly these', () => {
    const board = toggleResolved([sticky('a'), sticky('b')], ['a'], 'Jonas', AT);
    expect(withoutResolved(board, true).map((s) => s.id)).toEqual(['b']);
    expect(filterByAuthors(board, [])).toBe(board);
  });
});

describe('⌘K: Select resolved stickies / Move resolved stickies to the trash', () => {
  const board = toggleResolved(
    [sticky('a'), sticky('b'), sticky('c'), rect('r')],
    ['a', 'c'],
    'Jonas',
    AT
  );
  test('select finds them in board order', () => {
    expect(selectResolvedIds(board)).toEqual(['a', 'c']);
  });
  test('trash leaves the open ones and everything that is not a sticky', () => {
    const { next, ids } = withoutResolvedStickies(board);
    expect(ids).toEqual(['a', 'c']);
    expect(next.map((s) => s.id)).toEqual(['b', 'r']);
  });
  test('nothing resolved: nothing changes, and the answer says so', () => {
    const open: Stroke[] = [sticky('a')];
    const out = withoutResolvedStickies(open);
    expect(out.ids).toEqual([]);
    expect(out.next).toBe(open);
    expect(NO_RESOLVED_LINE).toBe('No resolved stickies on this canvas.');
  });
  test('the words (canvas 15): "6 stickies moved to the trash", "1 sticky …", "6 on this canvas"', () => {
    expect(trashedLine(6)).toBe('6 stickies moved to the trash');
    expect(trashedLine(1)).toBe('1 sticky moved to the trash');
    expect(resolvedCountMeta(6)).toBe('6 on this canvas');
  });
});
