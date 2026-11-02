// S2.11c (ed-lay-auto) — the canvas half of `layout.set-gap`: ⌥ on a gap drag is ONE edit-op over
// the held frame and the frames inside it that have the same gap — not one write per frame. The
// writer is test/edit-ops-set-gap.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { EditOpResult } from '../edit-ops/types.ts';
import { layoutOpsDeps } from '../editing/reorder-slot.tsx';
import { framesWithGap, NO_FRAMES_LINE, runSetGap } from '../editing/set-gap.ts';
import { spaceTokenFor, tokenRuler } from '../editing/token-ruler.tsx';
import { SelectionSetProvider, useSelectionSet } from '../use-selection-set.tsx';
import { SpacingHandlesOverlay } from '../use-spacing-handles.tsx';
import { ToolProvider } from '../use-tool-mode.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
const saved = layoutOpsDeps.current;
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  tokenRuler.hide();
  layoutOpsDeps.current = saved;
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
});

const OK: EditOpResult = { ok: true, actionId: null, writeId: 'w1', rev: 'r', refs: [] };

/** An artboard with a frame "page" (gap 16) holding two rows (gap 16 and gap 24) and a block. */
const tree = () => {
  document.body.innerHTML = `
    <article data-dc-screen="desktop"><div class="dc-artboard-body">
      <section data-cd-id="page" style="display:flex;gap:16px">
        <div data-cd-id="row1" style="display:flex;gap:16px"><i data-cd-id="x1"></i><i data-cd-id="x2"></i></div>
        <div data-cd-id="row2" style="display:flex;gap:24px"><i data-cd-id="y1"></i><i data-cd-id="y2"></i></div>
        <div data-cd-id="row3" style="display:flex;gap:16px"><i data-cd-id="z1"></i><i data-cd-id="z2"></i></div>
        <div data-cd-id="block" style="display:block;gap:16px"></div>
      </section>
    </div></article>`;
  return (id: string) => document.querySelector(`[data-cd-id="${id}"]`) as HTMLElement;
};

describe('framesWithGap', () => {
  test('the auto layouts inside with the held gap — not another size, not a block', () => {
    const q = tree();
    expect(framesWithGap(q('page'), 16).map((e) => e.dataset.cdId)).toEqual(['row1', 'row3']);
    expect(framesWithGap(q('page'), 24).map((e) => e.dataset.cdId)).toEqual(['row2']);
  });
});

describe('spaceTokenFor', () => {
  test('a value that is a stop of the system is its token; any other number is none', () => {
    tree();
    document.documentElement.style.setProperty('--space-4', '16px');
    document.documentElement.style.setProperty('--space-6', '24px');
    const sheet = document.createElement('style');
    sheet.textContent = ':root{--space-4:16px;--space-6:24px}';
    document.head.appendChild(sheet);
    expect(spaceTokenFor(16)).toBe('--space-4');
    expect(spaceTokenFor(24)).toBe('--space-6');
    expect(spaceTokenFor(17)).toBeNull();
    sheet.remove();
  });
});

describe('runSetGap', () => {
  test('one ask for all the frames, with the token on a stop, and no canvas record', async () => {
    const q = tree();
    const sheet = document.createElement('style');
    sheet.textContent = ':root{--space-6:24px}';
    document.head.appendChild(sheet);
    const asks: unknown[] = [];
    const recs: unknown[] = [];
    const r = await runSetGap([q('page'), q('row1'), q('row3')], 24, {
      run: async (a) => (asks.push(a), OK),
      record: (x) => recs.push(x),
    });
    sheet.remove();
    expect(r).toEqual(OK);
    expect(asks).toEqual([
      {
        op: 'layout.set-gap',
        targets: [
          { artboard: 'desktop', element: 'page' },
          { artboard: 'desktop', element: 'row1' },
          { artboard: 'desktop', element: 'row3' },
        ],
        params: { gap: { token: '--space-6' } },
      },
    ]);
    // p8-v1-drop: no canvas undo record — the write is a kernel action and ⌘Z is the shell history
    expect(recs).toHaveLength(0);
  });

  test('a number that is no stop goes as px', async () => {
    const q = tree();
    const asks: { params?: unknown }[] = [];
    await runSetGap([q('page')], 20, { run: async (a) => (asks.push(a), OK) });
    expect(asks[0]?.params).toEqual({ gap: { px: 20 } });
  });

  test('a refusal is the toast and records nothing', async () => {
    const q = tree();
    const toasts: string[] = [];
    const recs: unknown[] = [];
    const r = await runSetGap([q('page')], 20, {
      run: async () => ({ ok: false, code: 'locked', message: 'page is locked · ⇧⌘L unlocks' }),
      toast: (m) => toasts.push(m),
      record: (x) => recs.push(x),
    });
    expect(r?.ok).toBe(false);
    expect(toasts).toEqual(['page is locked · ⇧⌘L unlocks']);
    expect(recs).toHaveLength(0);
  });

  test('nothing the canvas can name: no ask, a toast', async () => {
    tree();
    const toasts: string[] = [];
    const asks: unknown[] = [];
    const r = await runSetGap([document.createElement('div')], 20, {
      run: async (a) => (asks.push(a), OK),
      toast: (m) => toasts.push(m),
    });
    expect(r).toBeNull();
    expect(asks).toHaveLength(0);
    expect(toasts).toEqual([NO_FRAMES_LINE]);
  });
});

// ── the drag: ⌥ is one op, a plain drag is still the one v1 write ────────────────────────────

function Seed() {
  const { replace } = useSelectionSet();
  useEffect(() => {
    replace({ id: 'page', artboardId: 'desktop', selector: '[data-cd-id="page"]' } as never);
  }, [replace]);
  return null;
}

async function dragGap(altKey: boolean, opts: { scale?: string; metaKey?: boolean } = {}) {
  const q = tree();
  const sheet = document.createElement('style');
  if (opts.scale) {
    sheet.textContent = opts.scale;
    document.head.appendChild(sheet);
  }
  // layout boxes for the overlay: the frame and its children have a size
  const box = (el: Element, x: number, y: number, w: number, h: number) => {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y }) as DOMRect;
  };
  box(q('page'), 0, 0, 400, 100);
  box(q('row1'), 0, 0, 100, 100);
  box(q('row2'), 116, 0, 100, 100);
  box(q('row3'), 240, 0, 100, 100);
  box(q('block'), 356, 0, 40, 100);
  const posts: { dgn?: string; patch?: Record<string, string> }[] = [];
  const realPost = window.parent.postMessage;
  window.parent.postMessage = ((m: { dgn?: string }) => void posts.push(m)) as never;
  const asks: { op: string; targets: { element: string }[]; params: unknown }[] = [];
  layoutOpsDeps.current = {
    run: async (a) => (asks.push(a as never), OK),
    record: () => {},
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <SelectionSetProvider postTarget={null}>
        <ToolProvider initial="move">
          <Seed />
          <SpacingHandlesOverlay />
        </ToolProvider>
      </SelectionSetProvider>
    )
  );
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
  const handle = document.querySelector('.dc-spacing-handle--gap') as HTMLElement | null;
  if (!handle) throw new Error('no gap handle was drawn');
  const fire = (type: string, x: number, init: PointerEventInit = {}) => {
    const ev = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      clientX: x,
      clientY: 50,
      altKey,
      metaKey: !!opts.metaKey,
      ...init,
    });
    (type === 'pointerdown' ? handle : window).dispatchEvent(ev);
  };
  await act(async () => {
    fire('pointerdown', 108);
    fire('pointermove', 116); // +8 → 24
    fire('pointerup', 116);
  });
  await act(async () => {
    await Promise.resolve();
  });
  window.parent.postMessage = realPost;
  sheet.remove();
  return { asks, posts };
}

describe('the ⌥ gap drag', () => {
  test('with ⌥: ONE layout.set-gap over the held frame and the other frames of that gap — no per-frame resize-request', async () => {
    const { asks, posts } = await dragGap(true);
    expect(asks).toHaveLength(1);
    expect(asks[0]?.op).toBe('layout.set-gap');
    expect(asks[0]?.targets.map((t) => t.element)).toEqual(['page', 'row1', 'row3']);
    expect(posts.filter((p) => p.dgn === 'resize-request')).toHaveLength(0);
  });

  test('without ⌥: still the one v1 resize-request for the held frame, no edit-op', async () => {
    const { asks, posts } = await dragGap(false);
    expect(asks).toHaveLength(0);
    expect(posts.filter((p) => p.dgn === 'resize-request')).toHaveLength(1);
  });
});

describe('S2.24 G4 — a plain gap drag that lands on a stop writes the token, not the number', () => {
  const SCALE = ':root{--space-4:16px;--space-6:24px;--space-7:32px}';
  const gapOf = (posts: { dgn?: string; patch?: Record<string, string> }[]) =>
    posts.find((p) => p.dgn === 'resize-request')?.patch?.gap;

  test('the stop 24 is var(--space-6)', async () => {
    const { posts } = await dragGap(false, { scale: SCALE });
    expect(gapOf(posts)).toBe('var(--space-6)');
  });

  test('⌘ (any number) writes the number, even where a stop is', async () => {
    document.documentElement.style.setProperty('--space-6', '24px');
    const { posts } = await dragGap(false, { scale: SCALE, metaKey: true });
    expect(gapOf(posts)).toBe('24px');
  });

  test('a system with no space scale writes the number', async () => {
    const { posts } = await dragGap(false);
    expect(gapOf(posts)).toBe('24px');
  });
});
