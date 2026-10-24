// comments-overlay — pure helpers covering the two comment-anchoring bugs in
// .ai/logs/rca/issue-comment-anchor-drift-and-popup-edge-clamp.md:
//
//   1. `resolveCommentTarget` — a stale `data-cd-id` selector (post-rewrite
//      renumbering, DDR-019) must not be trusted when it resolves to an
//      element of the wrong tag; it must fall back to the structural matcher,
//      and return null (not a wrong element) when the target is truly gone.
//   2. `placeNearPoint` — the composer/thread popup must flip to whichever
//      side of the anchor actually fits the viewport, instead of always
//      growing down-right and clipping off-screen near a canvas edge.
//
// Needs a live DOM for (1) — register happy-dom for THIS file only, like
// annotations-roundtrip.test.ts.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { placeNearPoint, resolveCommentTarget } from '../comments-overlay.tsx';

describe('resolveCommentTarget', () => {
  test('trusts a direct data-cd-id hit when the tag matches', () => {
    document.body.innerHTML = `
      <div data-dc-screen="art1">
        <button class="cta" data-cd-id="aaa11111">Buy now</button>
      </div>
    `;
    const el = resolveCommentTarget({
      selector: '[data-dc-screen="art1"] [data-cd-id="aaa11111"]',
      tag: 'button',
      classes: 'cta',
      dom_path: ['html', 'body', 'div[data-dc-screen="art1"]', 'button.cta'],
    });
    expect(el?.getAttribute('data-cd-id')).toBe('aaa11111');
  });

  test('falls back to the structural match when the id now belongs to a different tag', () => {
    // Renumbering: "aaa11111" now sits on an unrelated <div>; the button the
    // comment was anchored to kept its structure but got a fresh id.
    document.body.innerHTML = `
      <div data-dc-screen="art1">
        <div data-cd-id="aaa11111" class="decoy">Wrong element now has the old id</div>
        <section class="hero">
          <button class="cta" data-cd-id="zzz99999">Buy now</button>
        </section>
      </div>
    `;
    const el = resolveCommentTarget({
      selector: '[data-dc-screen="art1"] [data-cd-id="aaa11111"]',
      tag: 'button',
      classes: 'cta',
      dom_path: ['html', 'body', 'div[data-dc-screen="art1"]', 'section.hero', 'button.cta'],
    });
    expect(el?.getAttribute('data-cd-id')).toBe('zzz99999');
  });

  test('returns null (not a wrong element) when the target has genuinely been removed', () => {
    document.body.innerHTML = `
      <div data-dc-screen="art1">
        <p>The button that used to be here is gone.</p>
      </div>
    `;
    const el = resolveCommentTarget({
      selector: '[data-dc-screen="art1"] [data-cd-id="aaa11111"]',
      tag: 'button',
      classes: 'cta',
      dom_path: ['html', 'body', 'div[data-dc-screen="art1"]', 'button.cta'],
    });
    expect(el).toBeNull();
  });
});

describe('placeNearPoint', () => {
  beforeAll(() => {
    window.innerWidth = 1000;
    window.innerHeight = 800;
  });

  test('keeps the default down-right placement when there is room', () => {
    const placed = placeNearPoint({ x: 100, y: 100 }, { w: 300, h: 200 });
    expect(placed).toEqual({ x: 100, y: 100 });
  });

  test('flips to the left of the anchor when the card would overflow the right edge', () => {
    const placed = placeNearPoint({ x: 900, y: 100 }, { w: 300, h: 200 });
    // 900 + 300 = 1200 > 1000 → flip: 900 - 300 = 600, which has room (>= margin).
    expect(placed.x).toBe(600);
  });

  test('flips above the anchor when the card would overflow the bottom edge', () => {
    const placed = placeNearPoint({ x: 100, y: 700 }, { w: 300, h: 200 });
    // 700 + 200 = 900 > 800 → flip: 700 - 200 = 500, which has room.
    expect(placed.y).toBe(500);
  });

  test('flips both axes when the anchor sits in a corner (near right AND bottom edge)', () => {
    const placed = placeNearPoint({ x: 950, y: 750 }, { w: 300, h: 200 });
    // Flipped x (950-300=650) has room, so it flips rather than clamps.
    expect(placed.x).toBe(650);
    // Flipped y (750-200=550) has room too.
    expect(placed.y).toBe(550);
  });

  // P8 C5 (04 md-comment, 10 co-comment-thread): the Comments panel is docked on the RIGHT (CONTRACT §6), so a
  // card that opens toward it sat under the island with its Resolve out of reach. The card keeps to the
  // canvas the shell leaves free (the occluded insets), not the whole iframe.
  test('keeps clear of an occluded right edge: flips left rather than sit under the panel', () => {
    const ins = { top: 0, right: 320, bottom: 0, left: 0 };
    // free width is 680: 500 + 300 > 680 → flip to 200
    expect(placeNearPoint({ x: 500, y: 100 }, { w: 300, h: 200 }, ins).x).toBe(200);
  });

  test('keeps clear of an occluded left edge and top: never starts under the island', () => {
    const ins = { top: 80, right: 0, bottom: 0, left: 300 };
    const placed = placeNearPoint({ x: 10, y: 10 }, { w: 300, h: 200 }, ins);
    expect(placed.x).toBe(300 + 8);
    expect(placed.y).toBe(80 + 8);
  });

  test('no insets = the whole window, as before', () => {
    const zero = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(placeNearPoint({ x: 900, y: 100 }, { w: 300, h: 200 }, zero)).toEqual(
      placeNearPoint({ x: 900, y: 100 }, { w: 300, h: 200 })
    );
  });

  test('clamps inward when even the flipped position would go negative', () => {
    const placed = placeNearPoint({ x: 50, y: 50 }, { w: 2000, h: 2000 });
    // Card wider/taller than the viewport in both directions — neither the
    // default nor the flip fits, so it clamps to the margin-in-from-edge spot.
    expect(placed.x).toBe(8);
    expect(placed.y).toBe(8);
  });
});
