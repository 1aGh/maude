// V2-8.5 round 3 (c3-inspect) — 01 cf-select-tweak · 04 md-edit · 14 ed-ab-arrange.
//
// An artboard's page is ONE stamped root element that fills the artboard (`<div className="page">…`). The boards
// draw that root AS the artboard: a click on the page itself selects the artboard (Preset · Size · Fill · Corners
// · Clip content · Export), a click on an object selects the top object INSIDE the page (14: "Click selects the
// top object; double-click goes inside"), and the drag of the page is the drag of the artboard. The old top-mode
// climb ended at the root, so every click read "Frame 1440 × 996" and opened the object inspector for the page.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { serializeArtboardTree } from '../canvas-shell.tsx';
import {
  dropPageRoot,
  isPageHit,
  pageRootOf,
  resolveHoverTarget,
  yieldsToArtboardDrag,
} from '../input-router.tsx';

type Box = { w: number; h: number };

/** `<article data-dc-screen><div .dc-artboard-body>…</div></article>` with stubbed boxes. */
function board(html: string, body: Box, boxes: Record<string, Box> = {}) {
  const host = document.createElement('div');
  host.innerHTML = `<article class="dc-artboard" data-dc-screen="desktop"><div class="dc-artboard-body">${html}</div></article>`;
  document.body.appendChild(host);
  const rectOf = (el: Element, b: Box) =>
    Object.assign(el, {
      getBoundingClientRect: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: b.w,
        height: b.h,
        right: b.w,
        bottom: b.h,
      }),
    });
  const bodyEl = host.querySelector('.dc-artboard-body') as HTMLElement;
  rectOf(bodyEl, body);
  for (const [id, b] of Object.entries(boxes)) {
    const el = host.querySelector(`[data-cd-id="${id}"]`);
    if (el) rectOf(el, b);
  }
  const at = (sel: string) => host.querySelector(sel) as Element;
  const doc = (hit: Element) => ({ elementFromPoint: () => hit }) as unknown as Document;
  return { host, bodyEl, at, doc, article: at('article') };
}

const PAGE = `
  <div data-cd-id="page">
    <section data-cd-id="hero"><h1 data-cd-id="title">Calm software</h1></section>
    <p data-cd-id="sub">A small studio</p>
  </div>`;
const FULL = { w: 1440, h: 996 };

describe('the page root is the artboard', () => {
  test('pageRootOf: the sole stamped element that fills the body', () => {
    const b = board(PAGE, FULL, { page: FULL });
    expect(pageRootOf(b.bodyEl)?.getAttribute('data-cd-id')).toBe('page');
  });

  test('pageRootOf: a root that does not fill the body is an object, not the page', () => {
    const b = board(PAGE, FULL, { page: { w: 400, h: 300 } });
    expect(pageRootOf(b.bodyEl)).toBeNull();
  });

  test('pageRootOf: two stamped siblings at the top have no page root', () => {
    const b = board('<div data-cd-id="a"></div><div data-cd-id="b"></div>', FULL, {
      a: FULL,
      b: FULL,
    });
    expect(pageRootOf(b.bodyEl)).toBeNull();
  });

  test('a click on the headline selects the top object inside the page, never the page', () => {
    const b = board(PAGE, FULL, { page: FULL });
    const t = resolveHoverTarget(b.doc(b.at('[data-cd-id="title"]')), 10, 10, { deep: false });
    expect(t?.cdId).toBe('hero');
  });

  test('a click on the page itself selects the ARTBOARD (no element id)', () => {
    const b = board(PAGE, FULL, { page: FULL });
    const t = resolveHoverTarget(b.doc(b.at('[data-cd-id="page"]')), 10, 10, { deep: false });
    expect(t?.cdId).toBeNull();
    expect(t?.el).toBe(b.article);
    expect(t?.artboardId).toBe('desktop');
  });

  test('a page that is smaller than the artboard keeps today’s click (the root is an object)', () => {
    const b = board(PAGE, FULL, { page: { w: 400, h: 300 } });
    const t = resolveHoverTarget(b.doc(b.at('[data-cd-id="title"]')), 10, 10, { deep: false });
    expect(t?.cdId).toBe('page');
  });

  test('⌘-click (deep) still reaches the deepest element', () => {
    const b = board(PAGE, FULL, { page: FULL });
    const t = resolveHoverTarget(b.doc(b.at('[data-cd-id="title"]')), 10, 10, { deep: true });
    expect(t?.cdId).toBe('title');
  });

  test('dropPageRoot: the double-click ladder starts below the page', () => {
    const b = board(PAGE, FULL, { page: FULL });
    const chain = ['page', 'hero', 'title'].map((id) => b.at(`[data-cd-id="${id}"]`));
    expect(dropPageRoot(chain).map((e) => e.getAttribute('data-cd-id'))).toEqual(['hero', 'title']);
  });

  // 14 ed-ab-arrange: the drag of the page is the drag of the artboard
  test('a press ON the page is an artboard press; a press on an object is that object’s', () => {
    const b = board(PAGE, FULL, { page: FULL });
    const hitting = (el: Element) => {
      (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => el;
    };
    hitting(b.at('[data-cd-id="page"]'));
    expect(isPageHit(b.at('[data-cd-id="page"]'), 10, 10)).toBe(true);
    hitting(b.at('[data-cd-id="title"]'));
    expect(isPageHit(b.at('[data-cd-id="title"]'), 10, 10)).toBe(false);
  });

  test('the router lets the artboard-drag hook see a press on the page, not one on an object', () => {
    const b = board(PAGE, FULL, { page: FULL });
    const action = { kind: 'select' } as Parameters<typeof yieldsToArtboardDrag>[0];
    const mods = { metaKey: false, ctrlKey: false, clientX: 10, clientY: 10 };
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () =>
      b.at('[data-cd-id="page"]');
    expect(yieldsToArtboardDrag(action, b.at('[data-cd-id="page"]'), mods)).toBe(true);
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () =>
      b.at('[data-cd-id="title"]');
    expect(yieldsToArtboardDrag(action, b.at('[data-cd-id="title"]'), mods)).toBe(false);
    // ⌘ is deep-select's, always
    expect(
      yieldsToArtboardDrag(action, b.at('[data-cd-id="page"]'), { ...mods, metaKey: true })
    ).toBe(false);
  });
});

describe('Layers does not list the page root as a row', () => {
  test('the objects of the page are the top level under the artboard', () => {
    const b = board(PAGE, FULL, { page: FULL });
    expect(serializeArtboardTree(b.article).map((n) => n.id)).toEqual(['hero', 'sub']);
    // ...and a nested object keeps its own children
    expect(serializeArtboardTree(b.article)[0]?.children?.map((n) => n.id)).toEqual(['title']);
  });
  test('a lone card smaller than the artboard stays a row (it is an object)', () => {
    const b = board(PAGE, FULL, { page: { w: 400, h: 300 } });
    expect(serializeArtboardTree(b.article).map((n) => n.id)).toEqual(['page']);
  });
  test('two top-level objects: nothing to peel', () => {
    const b = board('<div data-cd-id="a">A</div><div data-cd-id="b">B</div>', FULL);
    expect(serializeArtboardTree(b.article).map((n) => n.id)).toEqual(['a', 'b']);
  });
});
