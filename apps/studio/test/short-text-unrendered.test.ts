// shortText — the text a selection carries (inspector "val", AI context). Chromium's `innerText`
// is '' for an element whose contents are not rendered yet: a `content-visibility: auto` board that
// has not had its first rendering update (the soft-reload remount window), or one scrolled out of
// view. The fallback to `textContent` then glued block boundaries together
// ("HeroCharacterization fixture.Get started"), so the SAME select-by-id carried a different text
// depending on whether it landed before or after the first paint (v1-keys Meta+d variant).
// The fallback must read the way the rendered text reads: a space at every block boundary.
//
// happy-dom for THIS file only, like dom-selection.test.ts. happy-dom's `innerText` is not
// Chromium's, so the not-rendered state is pinned the way Chromium reports it: `innerText === ''`.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { shortText } from '../dom-selection.ts';

function notRendered(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  const el = document.getElementById('root') as HTMLElement;
  Object.defineProperty(el, 'innerText', { value: '', configurable: true });
  return el;
}

describe('shortText when innerText is empty (contents not rendered)', () => {
  test('block siblings are separated, exactly like the rendered text', () => {
    const el = notRendered(
      '<main><h1>Hero</h1><p>Characterization fixture.</p><button>Get started</button></main>'
    );
    expect(shortText(el, 240)).toBe('Hero Characterization fixture. Get started');
  });

  test('inline runs stay glued (a <b> inside a word is not a boundary)', () => {
    const el = notRendered('<p>Hel<b>lo</b> <i>wor</i>ld</p>');
    expect(shortText(el, 240)).toBe('Hello world');
  });

  test('display:none content is not part of the text, a <br> is a separator', () => {
    const el = notRendered('<p>one<br>two<span style="display:none">hidden</span></p><p>three</p>');
    expect(shortText(el, 240)).toBe('one two three');
  });

  test('truncates with an ellipsis like the rendered path', () => {
    const el = notRendered('<p>abcdefghij</p>');
    expect(shortText(el, 5)).toBe('abcd…');
  });
});
