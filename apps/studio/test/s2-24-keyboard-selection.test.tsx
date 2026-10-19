// S2.24 nit (ed-edge-keys) — ↵ into a section selected its `h1` as a "Frame": the keyboard's selection was a bare
// id/selector/tag payload with no `text`, and the inspector decides a text object by its `text`
// (client/v2/inspector/kinds/index.js). The keyboard now makes the same payload a pointer pick does.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => GlobalRegistrator.unregister());

import { resolveKind } from '../client/v2/inspector/kinds/index.js';
import { hoverTargetToSelection } from '../dom-selection.ts';
import { keyboardSelection } from '../use-keyboard-discipline.tsx';

const tree = () => {
  document.body.innerHTML = `
    <article data-dc-screen="desktop"><div class="dc-artboard-body">
      <section data-cd-id="hero"><h1 data-cd-id="headline">Jedeme v zeleném.</h1><div data-cd-id="box"></div></section>
    </div></article>`;
  return (id: string) => document.querySelector(`[data-cd-id="${id}"]`) as HTMLElement;
};

describe('the keyboard selection', () => {
  test('carries the text, like the pointer pick', () => {
    const q = tree();
    const key = keyboardSelection(q('headline'));
    expect(key.text).toBe('Jedeme v zeleném.');
    expect(key.id).toBe('headline');
    expect(key.artboardId).toBe('desktop');
    const pointer = hoverTargetToSelection({
      el: q('headline'),
      cdId: 'headline',
      artboardId: 'desktop',
    } as never);
    expect(key.text).toBe(pointer.text);
    expect(key.tag).toBe(pointer.tag);
  });

  test('an h1 reads as Text in the inspector, a box as Frame', () => {
    const q = tree();
    expect(resolveKind(keyboardSelection(q('headline'))).id).toBe('text');
    expect(resolveKind(keyboardSelection(q('box'))).id).toBe('frame');
  });
});
