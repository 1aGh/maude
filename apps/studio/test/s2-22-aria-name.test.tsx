// S2.22 G9 — VoiceOver says the frame's name, not its tag (“Services”, not “div”), then the layout and the place:
// “Services, frame, 3 items, in a row — 4 of 6. Press Return to go inside.”
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => {
  document.body.innerHTML = '';
});

import { describeFocus, factsOf, spokenNameOf } from '../editing/aria-live.tsx';
import type { Measure } from '../editing/tab-order.tsx';

const M: Measure = {
  rectOf(e) {
    const [left, top, width, height] = (e.getAttribute('data-r') ?? '0,0,0,0')
      .split(',')
      .map(Number);
    return { left, top, width, height } as {
      left: number;
      top: number;
      width: number;
      height: number;
    };
  },
  shown: () => true,
};

// no layer name, no aria-label, no loose words: only a heading inside says what the frame is
function page() {
  document.body.innerHTML = `
  <article data-dc-screen="desk"><div class="dc-artboard-body">
    <nav data-cd-id="nav" data-r="0,0,1440,80"></nav>
    <section data-cd-id="hero" data-r="0,80,1440,400"></section>
    <div data-cd-id="eyebrow" data-r="0,480,1440,40"></div>
    <div data-cd-id="svc" data-r="0,520,1440,300" style="display:flex;flex-direction:row">
      <h2 data-cd-id="svc-title" data-r="0,520,200,40">Services  and more</h2>
      <div data-cd-id="card-a" data-r="40,540,400,240"></div>
      <div data-cd-id="card-b" data-r="510,541,400,239"></div>
    </div>
    <section data-cd-id="work" data-r="0,820,1440,300"></section>
    <footer data-cd-id="foot" data-r="0,1120,1440,100"></footer>
  </div></article>`;
}
const el = (id: string) => document.querySelector(`[data-cd-id="${id}"]`) as Element;

describe('the spoken name', () => {
  test('a frame with no name of its own is called by its first heading', () => {
    page();
    expect(spokenNameOf(el('svc'))).toBe('Services and more');
  });

  test('a layer name still wins; a frame with nothing to say keeps its kind word, never the tag', () => {
    page();
    el('svc').setAttribute('data-dc-element', 'Offer');
    expect(spokenNameOf(el('svc'))).toBe('Offer');
    // P8-C2 / CONTRACT: the kind word (Frame · Text · Photo …), never the code's own word ("section", "div")
    expect(spokenNameOf(el('hero'))).toBe('Frame');
  });

  test('the whole sentence for the unnamed frame, with its layout and its place', () => {
    page();
    const f = factsOf(el('svc'), M);
    expect(f.name).toBe('Services and more');
    expect(f.layout).toBe('row');
    expect(describeFocus(f)).toBe(
      'Services and more, frame, 3 items, in a row — 4 of 6. Press Return to go inside.'
    );
  });
});
