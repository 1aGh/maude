// rc.1 F33 — a comment needs no pointer: C arms the Comment tool, ↵ opens the composer on the selected
// element (WCAG 2.1.1). The key is the registry's `tool.create-default`, now bound in Preview too.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { canvasKeyIndex } from '../actions/canvas-keys.ts';
import { canvasKeyCtx } from '../actions/ctx.ts';
import { chordFromEvent } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import { commentOnSelection, isCommentTool } from '../editing/focus-model.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => {
  document.body.innerHTML = '';
});

const KEYS = canvasKeyIndex(['tool.create-default', 'object.enter']);
const enter = (ctx: Parameters<typeof canvasKeyCtx>[0]) =>
  resolveChord(
    KEYS,
    chordFromEvent({
      key: 'Enter',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    }),
    canvasKeyCtx(ctx)
  )?.action.id ?? null;

describe('↵ with the Comment tool armed', () => {
  test('is the registry’s create-default key in Edit and in Preview, for an editor and a commenter', () => {
    for (const mode of ['edit', 'preview'] as const)
      for (const readOnly of [false, true])
        expect(enter({ typing: false, readOnly, mode, toolArmed: true, selection: 'object' })).toBe(
          'tool.create-default'
        );
  });

  test('without an armed tool Preview’s ↵ is still nobody’s', () => {
    expect(
      enter({ typing: false, readOnly: false, mode: 'preview', selection: 'object' })
    ).toBeNull();
  });

  test('only the Comment tool is the comment tool', () => {
    expect(isCommentTool('comment')).toBe(true);
    for (const t of ['browse', 'frame', 'el-shape', 'el-text', null, undefined])
      expect(isCommentTool(t)).toBe(false);
  });
});

describe('commentOnSelection', () => {
  function page() {
    document.body.innerHTML = `<article data-dc-screen="a"><div class="dc-artboard-body">
      <h1 data-cd-id="h1x">Heading</h1></div></article>`;
    const h1 = document.querySelector('h1') as HTMLElement;
    h1.getBoundingClientRect = () =>
      ({ left: 100, top: 50, right: 500, bottom: 90, width: 400, height: 40 }) as DOMRect;
    const seen: {
      selection: { selector: string; artboardId: string | null };
      clientX: number;
      clientY: number;
    }[] = [];
    document.addEventListener('cm:open-composer', (e) => seen.push((e as CustomEvent).detail));
    return seen;
  }

  test('opens the composer on the selected element — its own anchor, below it, no pointer', () => {
    const seen = page();
    const opened = commentOnSelection(document, [
      { id: 'h1x', artboardId: 'a', selector: '[data-cd-id="h1x"]' } as never,
    ]);
    expect(opened).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].selection.selector).toContain('data-cd-id="h1x"');
    expect(seen[0].selection.artboardId).toBe('a');
    expect(seen[0].clientY).toBe(90); // the element's bottom: the card hangs under what it is about
  });

  test('nothing selected → nothing opens, and it says so', () => {
    const seen = page();
    expect(commentOnSelection(document, [])).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
