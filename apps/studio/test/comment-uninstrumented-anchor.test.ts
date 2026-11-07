// #151 causes 1-3 — a comment on an element that carries no `data-cd-id` stays pinned to it.
//
//   1. the anchor selector is a real element path inside the artboard (not the artboard alone, which
//      the tag check rejects), so it re-resolves to the SAME element, even among identical siblings;
//   2. the `dom_path` fallback searches every element of the artboard, not only the stamped ones;
//   3. an element comment stores the click's WORLD point, so when the element cannot be found the
//      pin follows pan and zoom instead of drifting with stale screen bounds.
//
// Needs a live DOM: happy-dom for THIS file only, like dom-selection.test.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { locateComment, resolveCommentTarget } from '../comments-overlay.tsx';
import {
  buildComposeSelection,
  commentSelectionFor,
  elementPathSelector,
  resolveByDomPath,
} from '../dom-selection.ts';

const BOARD = `
  <div data-dc-screen="art1">
    <article class="card">
      <span>one</span>
      <span>two</span>
      <span>three</span>
    </article>
    <article class="card">
      <span>four</span>
      <span>five</span>
    </article>
  </div>`;

function camera(vp: { x: number; y: number; zoom: number } | null): void {
  (window as unknown as { __maudeViewport?: unknown }).__maudeViewport = vp ? () => vp : undefined;
}

beforeEach(() => {
  document.body.innerHTML = `<div class="dc-canvas">${BOARD}</div>`;
  camera(null);
});

describe('elementPathSelector — a real path, not the artboard alone', () => {
  test('resolves to exactly the element, among identical siblings and repeated cards', () => {
    const spans = Array.from(document.querySelectorAll('span'));
    expect(spans.length).toBe(5);
    for (const el of spans) {
      const sel = elementPathSelector(el, 'art1');
      expect(sel).toBeTruthy();
      const hits = document.querySelectorAll(sel as string);
      expect(hits.length).toBe(1);
      expect(hits[0]).toBe(el);
    }
  });

  test('is rooted at the artboard and has no depth cap', () => {
    let html = '<i>deep</i>';
    for (let i = 0; i < 14; i++) html = `<div>${html}</div>`;
    document.body.innerHTML = `<div data-dc-screen="art1">${html}</div>`;
    const el = document.querySelector('i') as Element;
    const sel = elementPathSelector(el, 'art1') as string;
    expect(sel.startsWith('[data-dc-screen="art1"] > ')).toBe(true);
    expect(document.querySelectorAll(sel)[0]).toBe(el);
  });

  test('null for the artboard itself and for an element outside it', () => {
    const board = document.querySelector('[data-dc-screen="art1"]') as Element;
    expect(elementPathSelector(board, 'art1')).toBeNull();
    expect(elementPathSelector(document.body, 'art1')).toBeNull();
  });
});

describe('commentSelectionFor — the anchor an element comment gets', () => {
  test('an un-instrumented element gets a selector that re-resolves to it after a reload of the DOM', () => {
    const el = document.querySelectorAll('span')[3]; // "four": second card, first span
    const sel = commentSelectionFor({ el, cdId: null, artboardId: 'art1' }, 10, 20);
    expect(sel.tag).toBe('span');
    expect(sel.selector).not.toBe('[data-dc-screen="art1"]');

    // Rebuild the identical DOM (a reload): the stored anchor finds the SAME element.
    document.body.innerHTML = `<div class="dc-canvas">${BOARD}</div>`;
    const found = resolveCommentTarget({
      selector: sel.selector,
      index: sel.index,
      tag: sel.tag,
      classes: sel.classes,
      dom_path: sel.dom_path,
    });
    expect(found).not.toBeNull();
    expect(found?.textContent).toBe('four');
  });

  test('a stamped element keeps its data-cd-id anchor (unchanged)', () => {
    document.body.innerHTML = `<div data-dc-screen="art1"><button data-cd-id="aaa11111">Go</button></div>`;
    const el = document.querySelector('button');
    const sel = commentSelectionFor({ el, cdId: 'aaa11111', artboardId: 'art1' }, 1, 2);
    expect(sel.selector).toBe('[data-dc-screen="art1"] [data-cd-id="aaa11111"]');
  });

  test('picking the artboard itself stays an artboard-only anchor', () => {
    const board = document.querySelector('[data-dc-screen="art1"]');
    const sel = commentSelectionFor({ el: board, cdId: null, artboardId: 'art1' }, 1, 2);
    expect(sel.selector).toBe('[data-dc-screen="art1"]');
  });

  test('stores the WORLD point of the click when the canvas has a world plane', () => {
    camera({ x: 100, y: 50, zoom: 2 });
    const el = document.querySelector('span');
    const sel = commentSelectionFor({ el, cdId: null, artboardId: 'art1' }, 300, 250);
    expect(sel.world).toEqual({ x: 100, y: 100 });
  });

  test('no world plane (a specimen) stores no world', () => {
    const el = document.querySelector('span');
    const sel = commentSelectionFor({ el, cdId: null, artboardId: 'art1' }, 300, 250);
    expect(sel.world).toBeUndefined();
  });

  test('the right-click builder takes the same anchor and world', () => {
    camera({ x: 0, y: 0, zoom: 1 });
    const el = document.querySelectorAll('span')[1];
    const sel = buildComposeSelection({ el, cdId: null, artboardId: 'art1' }, 40, 60);
    expect(document.querySelectorAll(sel.selector)[0]).toBe(el);
    expect(sel.world).toEqual({ x: 40, y: 60 });
  });
});

describe('the pin follows pan and zoom', () => {
  test('an element comment whose target is gone falls back to its world point, not stale bounds', () => {
    camera({ x: 0, y: 0, zoom: 1 });
    const el = document.querySelector('span');
    const sel = commentSelectionFor({ el, cdId: null, artboardId: 'art1' }, 300, 250);
    const comment = {
      selector: sel.selector,
      index: sel.index,
      tag: sel.tag,
      dom_path: sel.dom_path,
      bounds: { x: 1, y: 1, w: 5, h: 5 },
      world: sel.world,
    };
    // the element disappears (renamed, removed) and the user pans + zooms
    document.body.innerHTML = '<div class="dc-canvas"><div data-dc-screen="art1"></div></div>';
    camera({ x: -80, y: 40, zoom: 2 });
    const { pos, missing } = locateComment(comment as never);
    expect(missing).toBe(true);
    // world (300, 250) -> client (300*2-80, 250*2+40), pin centred on it
    expect(pos).toEqual({ x: 520 - 12, y: 540 - 12, w: 24, h: 24 });
  });
});

describe('resolveByDomPath — every element of the artboard', () => {
  test('finds an element that has no data-cd-id', () => {
    document.body.innerHTML = `
      <div data-dc-screen="art1">
        <div data-cd-id="x1111111" class="decoy">decoy</div>
        <section class="hero"><p class="lede">Hello</p></section>
      </div>`;
    const found = resolveByDomPath(document, {
      artboardId: 'art1',
      tag: 'p',
      classes: 'lede',
      dom_path: ['div[data-dc-screen="art1"]', 'section.hero', 'p.lede'],
    });
    expect(found?.textContent).toBe('Hello');
  });

  test('legacy comment: artboard-only selector + tag resolves through the dom_path fallback', () => {
    document.body.innerHTML = `
      <div data-dc-screen="art1">
        <section class="hero"><span>a</span><span class="badge">b</span></section>
      </div>`;
    const el = resolveCommentTarget({
      selector: '[data-dc-screen="art1"]',
      tag: 'span',
      classes: 'badge',
      dom_path: ['div[data-dc-screen="art1"]', 'section.hero', 'span.badge'],
    });
    expect(el?.textContent).toBe('b');
  });
});
