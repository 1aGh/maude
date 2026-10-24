// S4.19 fidelity round 3 (canvas 15):
//   G4 an-sticky  - the selected sticky's own small toolbar: five papers + "+5", a Small..Huge size select, list,
//                   Lock, Turn into a comment; the face stays fixed (no B/I/S/U, no alignment). Text keeps its own.
//   G5 an-layers  - a locked selection says "Locked · Unlock ⇧⌘L"; a drag on it shows "Locked — unlock to move it".
//   G6            - a gallery sticker selects with the annotation toolbar and never opens the Photo inspector.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LOCKED_DRAG_TIP, LOCKED_LINE, LockedDragTip } from '../annotations/ui/locked.tsx';
import { opensPhotoInspector } from '../annotations/ui/sticker-drop.ts';
import { AnnotationContextToolbar } from '../annotations-context-toolbar.tsx';
import { StrokesStoreContext, type StrokesStoreValue } from '../annotations-layer.tsx';
import {
  DEFAULT_FONT_SIZE,
  STICKY_PALETTE,
  type StickyStroke,
  type Stroke,
  type TextStroke,
} from '../annotations-model.ts';
import {
  LOCKED_TOOLBAR as SHELL_LINE,
  LOCKED_DRAG_TIP as SHELL_TIP,
} from '../client/v2/annotations/annotation-list-model.js';
import {
  AnnotationSelectionProvider,
  useAnnotationSelection,
} from '../use-annotation-selection.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const sticky = (o: Partial<StickyStroke> = {}): StickyStroke => ({
  id: 'st',
  tool: 'sticky',
  color: STICKY_PALETTE[0],
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  text: 'Headline on one line?',
  fontSize: DEFAULT_FONT_SIZE,
  ...o,
});

function Select({ ids }: { ids: string[] }) {
  const sel = useAnnotationSelection();
  // biome-ignore lint/correctness/useExhaustiveDependencies: select once
  useEffect(() => sel.replace(ids), []);
  return null;
}

async function mountToolbar(strokes: Stroke[], ids: string[]) {
  const patches: Array<{ label?: string; patch: Record<string, unknown> }> = [];
  const locks: boolean[] = [];
  const ran: string[] = [];
  const store = {
    strokes,
    setStrokes: () => {},
    updateStroke: () => {},
    deleteStrokes: () => {},
    translateStrokes: () => {},
    applyToStrokes: (
      selected: readonly string[],
      fn: (s: Stroke) => Partial<Stroke> | null,
      label?: string
    ) => {
      for (const s of strokes)
        if (selected.includes(s.id)) {
          const p = fn(s);
          if (p) patches.push({ label, patch: p as Record<string, unknown> });
        }
    },
    groupSelection: () => null,
    ungroupSelection: () => {},
    setLocked: (_ids: readonly string[], locked: boolean) => locks.push(locked),
    runAction: (id: string) => {
      ran.push(id);
      return true;
    },
  } as unknown as StrokesStoreValue;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <AnnotationSelectionProvider>
        <StrokesStoreContext.Provider value={store}>
          <Select ids={ids} />
          <AnnotationContextToolbar editingId={null} />
        </StrokesStoreContext.Provider>
      </AnnotationSelectionProvider>
    )
  );
  return { host, patches, locks, ran };
}
const byId = (host: Element, id: string) => host.querySelector(`[data-testid="${id}"]`);
const click = async (el: Element | null) => {
  if (!el) throw new Error('no such control');
  await act(async () => (el as HTMLElement).click());
};
const papers = (host: Element) =>
  [...host.querySelectorAll('[aria-label="Color"] button[aria-label^="Sticky color"]')].map((b) =>
    b.getAttribute('aria-label')
  );

describe('G4 - the selected sticky follows canvas 15 an-sticky', () => {
  test('five papers and "+5"; the "+5" opens the other five in place', async () => {
    const { host } = await mountToolbar([sticky()], ['st']);
    expect(papers(host)).toHaveLength(5);
    expect(papers(host)[0]).toBe(`Sticky color ${STICKY_PALETTE[0]}`);
    const more = byId(host, 'annot-sticky-paper-more');
    expect(more?.textContent).toBe('+5');
    await click(more);
    expect(papers(host)).toHaveLength(10);
    expect(byId(host, 'annot-sticky-paper-more')).toBeNull();
  });
  test('a paper from the rest is already showing when the sticky wears it', async () => {
    const { host } = await mountToolbar([sticky({ color: STICKY_PALETTE[4] })], ['st']);
    expect(papers(host)).toHaveLength(10);
  });
  test('a Small..Huge select sets the size; Medium is the sticky default', async () => {
    const { host, patches } = await mountToolbar([sticky()], ['st']);
    const sel = byId(host, 'annot-sticky-size') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      'Small',
      'Medium',
      'Large',
      'Extra large',
      'Huge',
    ]);
    expect(sel.value).toBe(String(DEFAULT_FONT_SIZE));
    expect([...sel.options].find((o) => o.selected)?.textContent).toBe('Medium');
    await act(async () => {
      sel.value = '64';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(patches).toEqual([{ label: 'set font size', patch: { fontSize: 64 } }]);
  });
  test('List is one button: bullets, then numbers, then off', async () => {
    const { host, patches } = await mountToolbar([sticky()], ['st']);
    await click(byId(host, 'annot-sticky-list'));
    expect(patches.at(-1)?.patch).toEqual({ listType: 'bullet' });
    const { host: h2, patches: p2 } = await mountToolbar([sticky({ listType: 'bullet' })], ['st']);
    await click(byId(h2, 'annot-sticky-list'));
    expect(p2.at(-1)?.patch).toEqual({ listType: 'number' });
    const { host: h3, patches: p3 } = await mountToolbar([sticky({ listType: 'number' })], ['st']);
    await click(byId(h3, 'annot-sticky-list'));
    expect(p3.at(-1)?.patch).toEqual({ listType: undefined });
  });
  test('Lock and Turn into a comment are there; the face stays fixed (no B/I/S/U, no alignment, no number box)', async () => {
    const { host, ran, locks } = await mountToolbar([sticky()], ['st']);
    await click(byId(host, 'annot-ctx-lock'));
    expect(locks).toEqual([true]);
    await click(byId(host, 'annot-ctx-more'));
    await click(byId(host, 'annot-ctx-to-comment'));
    expect(ran).toEqual(['annotation.to-comment']);
    for (const gone of ['Bold', 'Italic', 'Strikethrough', 'Underline', 'Text alignment'])
      expect(host.querySelector(`[aria-label^="${gone}"]`)).toBeNull();
    expect(host.querySelector('.dc-annot-ctx-fs-trigger')).toBeNull();
    expect(host.querySelector('[aria-label="Bulleted list"]')).toBeNull();
  });
  test('a text annotation keeps its own toolbar: size px, B/I/S/U, alignment', async () => {
    const text: TextStroke = {
      id: 'tx',
      tool: 'text',
      x: 0,
      y: 0,
      w: 100,
      h: 30,
      text: 'Hello',
      fontSize: 16,
      color: '#111111',
    } as TextStroke;
    const { host } = await mountToolbar([text], ['tx']);
    for (const kept of ['Bold', 'Italic', 'Strikethrough', 'Underline', 'Text alignment'])
      expect(host.querySelector(`[aria-label^="${kept}"]`)).not.toBeNull();
    expect(byId(host, 'annot-sticky-size')).toBeNull();
  });
});

describe('G5 - a locked selection says so', () => {
  test('"Locked · Unlock ⇧⌘L", and Unlock unlocks', async () => {
    const { host, locks } = await mountToolbar([sticky({ locked: true })], ['st']);
    const line = byId(host, 'annotation-locked-toolbar');
    expect(line?.textContent).toContain('Locked');
    expect(line?.textContent).toContain('Unlock');
    expect(line?.textContent).toContain('⇧⌘L');
    await click(byId(host, 'annot-ctx-unlock'));
    expect(locks).toEqual([false]);
  });
  test('an unlocked sticky shows no such line', async () => {
    const { host } = await mountToolbar([sticky()], ['st']);
    expect(byId(host, 'annotation-locked-toolbar')).toBeNull();
  });
  test('the canvas copy of the words equals the shell list', () => {
    expect(LOCKED_LINE).toEqual(SHELL_LINE);
    expect(LOCKED_DRAG_TIP).toBe(SHELL_TIP);
    expect(LOCKED_DRAG_TIP).toBe('Locked — unlock to move it');
  });
  test('the drag tip follows the pointer and goes when it lets go', async () => {
    let done = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(<LockedDragTip at={{ x: 100, y: 80 }} onDone={() => done++} />)
    );
    const tip = byId(host, 'annotation-locked-tip') as HTMLElement;
    expect(tip.textContent).toBe('Locked — unlock to move it');
    expect(tip.style.left).toBe('114px');
    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 90 }));
    });
    expect((byId(host, 'annotation-locked-tip') as HTMLElement).style.left).toBe('214px');
    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerup'));
    });
    expect(done).toBe(1);
  });
  test('the layer raises the tip where a drag on a locked annotation is refused', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', 'annotations-layer.tsx'),
      'utf8'
    ) as string;
    expect(src).toMatch(
      /setLockedTip\(\{ x: e\.clientX, y: e\.clientY \}\);\s*return \{ kind: 'locked' \}/
    );
    expect(src).toContain('<LockedDragTip at={lockedTip} onDone={clearLockedTip} />');
  });
});

describe('G6 - a gallery sticker never opens the Photo inspector', () => {
  const pasted = { id: 'p', tool: 'image', x: 0, y: 0, w: 10, h: 10, href: 'assets/a.png' };
  test('a pasted picture still does; a gallery sticker, a link and a nothing do not', () => {
    expect(opensPhotoInspector(pasted)).toBe(true);
    expect(
      opensPhotoInspector({ ...pasted, sticker: { pack: 'project-status', id: 'group-46' } })
    ).toBe(false);
    expect(opensPhotoInspector({ id: 'l', tool: 'link' })).toBe(false);
    expect(opensPhotoInspector(undefined)).toBe(false);
  });
  test('the layer asks the helper for both the selection effect and the click that must not clear the DOM selection', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(import.meta.dir, '..', 'annotations-layer.tsx'),
      'utf8'
    ) as string;
    expect(src).toContain(
      'selCount === 1 && opensPhotoInspector(strokesById.get(annotSel?.selectedIds[0] as string))'
    );
    expect(src).toContain(
      "if (strokeTool !== 'image' || !opensPhotoInspector(hitStroke)) elementSel?.clear();"
    );
  });
});
