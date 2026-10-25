// P8 stage C round 10 (14 ed-text-edit): while a Czech text is typed, the ties show on the page's Czech copy — the board
// draws the small arcs under "v" and "s" of the body line while the headline is edited ("Language Čeština keeps
// one-letter words with the next word — small ties show where while you type").
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { TextInPlace } from '../editing/text-in-place.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

// happy-dom lays nothing out: every character gets a 10 x 20 box at its index
const stubRects = () => {
  const proto = Range.prototype as unknown as { getBoundingClientRect: () => DOMRect };
  const saved = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: Range) {
    const left = this.startOffset * 10;
    return { left, top: 100, width: 10, height: 20, right: left + 10, bottom: 120, x: left, y: 100 } as DOMRect;
  };
  return () => {
    proto.getBoundingClientRect = saved;
  };
};

async function mount(html: string) {
  document.body.innerHTML = html;
  const el = document.querySelector('[data-cd-id="title"]') as HTMLElement;
  el.setAttribute('contenteditable', 'plaintext-only');
  el.classList.add('dc-text-editing');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<TextInPlace />));
  await act(async () => {
    document.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
const arcs = () => document.querySelectorAll('[data-testid="edit-tie-arc"]').length;

describe('14 ed-text-edit: the ties on the page while a Czech text is typed', () => {
  test('the headline has no one-letter word, the body line has two: two arcs', async () => {
    const restore = stubRects();
    await mount(`<section lang="cs"><article data-dc-screen="p"><div class="dc-artboard-body">
      <h1 data-cd-id="title">STAŇ SE GATOREM</h1>
      <p data-cd-id="body">Přijď na Combine v sobotu 14. 3. — s kamarády</p>
    </div></article></section>`);
    expect(arcs()).toBe(2);
    restore();
  });
  test('another language, another artboard, or no Czech copy: no arcs', async () => {
    const restore = stubRects();
    await mount(`<section lang="cs">
      <article data-dc-screen="p"><div class="dc-artboard-body">
        <h1 data-cd-id="title">STAŇ SE GATOREM</h1>
        <p lang="en">Come in a minute and see a show</p>
      </div></article>
      <article data-dc-screen="q"><div class="dc-artboard-body"><p>Jdu v lese</p></div></article>
    </section>`);
    expect(arcs()).toBe(0);
    restore();
  });
  test('the edited text keeps its own arcs, none counted twice', async () => {
    const restore = stubRects();
    await mount(`<section lang="cs"><article data-dc-screen="p"><div class="dc-artboard-body">
      <h1 data-cd-id="title">Jdu v lese</h1>
      <p data-cd-id="body">Přijď v sobotu</p>
    </div></article></section>`);
    expect(arcs()).toBe(2);
    restore();
  });
});
