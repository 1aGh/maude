// S2.12b — the Text tool in Edit (`el-text`) is click to type: a click on editable text types in
// place, a click on text filled in from code says so, a click on nothing adds a text element
// through the toolbar's insert verb (the one the momentary Insert Text slot used).
import { describe, expect, test } from 'bun:test';
import { clickToType, ENTER_TEXT_EDIT_EVENT, typeIntoSelected } from '../editing/click-to-type.ts';
import { TOOLBAR_INSERT_EVENT } from '../input-router.tsx';

function fakeDoc() {
  const events: Array<{ type: string; detail: unknown }> = [];
  return {
    events,
    doc: {
      dispatchEvent: (e: Event) => {
        events.push({ type: e.type, detail: (e as CustomEvent).detail });
        return true;
      },
    } as unknown as Document,
  };
}
const el = (editable: boolean) =>
  ({ hasAttribute: (n: string) => editable && n === 'data-cd-editable' }) as unknown as HTMLElement;

describe('clickToType', () => {
  test('editable text: asks the canvas to type in place, at the click', () => {
    const { doc, events } = fakeDoc();
    const target = el(true);
    expect(clickToType(doc, target, { clientX: 7, clientY: 9 })).toBe('edit');
    expect(events).toEqual([
      { type: ENTER_TEXT_EDIT_EVENT, detail: { el: target, clientX: 7, clientY: 9 } },
    ]);
  });

  test('text filled in from code: no edit, no new element — the caller says why', () => {
    const { doc, events } = fakeDoc();
    expect(clickToType(doc, el(false), { clientX: 1, clientY: 2 })).toBe('code');
    expect(events).toEqual([]);
  });

  test('nothing under the click: the toolbar insert verb adds a text element', () => {
    const { doc, events } = fakeDoc();
    expect(clickToType(doc, null, { clientX: 1, clientY: 2 })).toBe('insert');
    expect(events).toEqual([{ type: TOOLBAR_INSERT_EVENT, detail: { kind: 'text' } }]);
  });
});

// V2-8.7 — ↵ on a selected text: the keyboard door of the same edit ("Press Return to type", board 14 · 26).
describe('typeIntoSelected', () => {
  const leaf = (editable: boolean, kids: number[] = [3]) =>
    ({
      hasAttribute: (n: string) => editable && n === 'data-cd-editable',
      childNodes: kids.map((nodeType) => ({ nodeType })),
    }) as unknown as HTMLElement;

  test('editable leaf text: types in place with the words selected (no pointer, so no caret point)', () => {
    const { doc, events } = fakeDoc();
    const target = leaf(true);
    expect(typeIntoSelected(doc, target)).toBe('edit');
    expect(events).toEqual([
      {
        type: ENTER_TEXT_EDIT_EVENT,
        detail: { el: target, clientX: 0, clientY: 0, selectAll: true },
      },
    ]);
  });

  test('text filled in from code: no edit — the caller says why', () => {
    const { doc, events } = fakeDoc();
    expect(typeIntoSelected(doc, leaf(false))).toBe('code');
    expect(events).toEqual([]);
  });

  test('a frame with children, or nothing selected: ↵ is not a typing door', () => {
    const { doc, events } = fakeDoc();
    expect(typeIntoSelected(doc, leaf(true, [3, 1]))).toBeNull();
    expect(typeIntoSelected(doc, leaf(true, []))).toBeNull();
    expect(typeIntoSelected(doc, null)).toBeNull();
    expect(events).toEqual([]);
  });
});
