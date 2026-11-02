// V2-8.5 c3 (14 R4 · ed-lay-reorder) — the tag that follows a lifted card names it by the breadcrumb's rule: a
// name, a label, the first words of its OWN text, else the kind word. Never everything inside it, never the tag.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { nameOf, slotLine } from '../editing/reorder-slot.tsx';

const card = (html: string): Element => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild as Element;
};

describe('reorder slot: what the lifted card is called', () => {
  test('a card with no name is "Frame", not the glued text of what is inside it', () => {
    const el = card(
      '<div data-cd-id="c"><h3>Product design</h3><p>Apps and brand systems</p></div>'
    );
    expect(nameOf(el)).toBe('Frame');
    expect(slotLine({ name: nameOf(el), index: 3, total: 5, copy: false, out: false })).toBe(
      'Frame · moves to 3 of 5'
    );
  });
  test('a name the designer gave stays; a text object reads its own first words', () => {
    expect(nameOf(card('<div data-dc-element="Small apps"><p>x</p></div>'))).toBe('Small apps');
    expect(nameOf(card('<p>Calm software, made in Brno.</p>'))).toBe('Calm software, made');
  });
  test('never the tag', () => {
    expect(nameOf(card('<section><span><i></i></span></section>'))).toBe('Frame');
    expect(nameOf(card('<img alt="">'))).toBe('Photo');
  });
});
