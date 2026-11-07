// #151 §6 (T2.3) — a comment anchored to a SHARED `data-cd-id` (many rows of one `.map()` carry the same
// computed id) plus an occurrence index jumped to another element after a canvas edit: an inserted row
// shifts what "the 5th match" is, a removed one leaves the index past the end (and the resolver then
// took the FIRST match). The stored index is a first guess now, checked against what the thread
// remembers of its element (tag, words, ancestors, classes); when it is no longer that element, the
// match that is wins.
//
// Needs a live DOM: happy-dom for THIS file only.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { resolveCommentTarget } from '../comments-overlay.tsx';

const NAMES = ['Ana', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'];

function board(names: string[], extra = ''): string {
  const rows = names
    .map(
      (n) => `<li><span data-cd-id="f7fad178" class="who">${n}</span><i class="x">${n}!</i></li>`
    )
    .join('');
  return `<div class="dc-canvas"><div data-dc-screen="art1"><ul>${rows}</ul>${extra}</div></div>`;
}

/** What a thread on "Ed" (5th row, index 4) stored when it was made. */
const ED = {
  selector: '[data-cd-id="f7fad178"]',
  index: 4,
  tag: 'span',
  classes: 'who',
  dom_path: ['div[data-dc-screen]', 'ul', 'li', 'span'],
  html_excerpt: '<span data-cd-id="f7fad178" class="who">Ed</span>',
};

const text = (el: Element | null) => el?.textContent;

beforeEach(() => {
  document.body.innerHTML = board(NAMES);
});

describe('a shared-id anchor survives edits that shift its index', () => {
  test('unchanged canvas: the stored index still names the same element', () => {
    expect(text(resolveCommentTarget(ED))).toBe('Ed');
  });

  test('a row inserted ABOVE it shifts the index by one: still Ed, not the row now at index 4', () => {
    document.body.innerHTML = board(['New', ...NAMES]);
    expect(text(resolveCommentTarget(ED))).toBe('Ed');
  });

  test('rows removed ABOVE it leave the index past the end: still Ed, not the first match', () => {
    document.body.innerHTML = board(['Ana', 'Ed']);
    expect(text(resolveCommentTarget(ED))).toBe('Ed');
  });

  test('a row inserted BELOW it changes nothing', () => {
    document.body.innerHTML = board([...NAMES, 'Gus']);
    expect(text(resolveCommentTarget(ED))).toBe('Ed');
  });

  test('the element’s words were edited: the nearest by position and ancestry, not a stranger', () => {
    // Ed became "Edward"; nothing says "Ed" any more. The index (4) still lands on that row.
    document.body.innerHTML = board(['Ana', 'Bo', 'Cy', 'Di', 'Edward', 'Flo']);
    expect(text(resolveCommentTarget(ED))).toBe('Edward');
  });

  test('the element is gone and its words with it: the stored index is the fallback, as before', () => {
    document.body.innerHTML = board(['Ana', 'Bo']);
    // index 4 is past the end of two matches: the first match, exactly today's behaviour
    expect(text(resolveCommentTarget(ED))).toBe('Ana');
  });

  test('the same words twice: the stored index decides between the two', () => {
    document.body.innerHTML = board(['Ed', 'Bo', 'Ed', 'Di']);
    expect(text(resolveCommentTarget({ ...ED, index: 2 }))).toBe('Ed');
    const hits = Array.from(document.querySelectorAll('[data-cd-id="f7fad178"]'));
    expect(resolveCommentTarget({ ...ED, index: 2 })).toBe(hits[2] as Element);
    expect(resolveCommentTarget({ ...ED, index: 0 })).toBe(hits[0] as Element);
  });

  test('a record from before the words were stored (no html_excerpt) behaves as it always did', () => {
    const { html_excerpt: _drop, ...legacy } = ED;
    document.body.innerHTML = board(['New', ...NAMES]);
    // no fingerprint to check the index against: the index it has, exactly the old behaviour
    expect(text(resolveCommentTarget(legacy))).toBe('Di');
  });

  test('a unique selector is untouched: no index, one match', () => {
    document.body.innerHTML = board(NAMES, '<p data-cd-id="solo">only</p>');
    expect(text(resolveCommentTarget({ selector: '[data-cd-id="solo"]', tag: 'p' }))).toBe('only');
  });
});
