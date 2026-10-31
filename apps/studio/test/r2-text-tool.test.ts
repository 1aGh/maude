// r2-text-tool (UX audit rc.1 blocker: user-advocate U01, design D1, a11y A1, motion M6, graphic-design GD-10) —
// Edit's Text (T) + a click on an artboard adds a text WHERE THE POINTER ACTED, selects it and opens it for typing
// with its words selected; the keys typed while the write is on its way go into the text, never to the shortcut
// router (N / C / S crossed to Preview, E / S opened the sticker picker). The op half is test/edit-ops-shapes.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import type { EditOpResult } from '../edit-ops/types.ts';
import {
  BODY_ROLE,
  ENTER_TEXT_EDIT_EVENT,
  hasBodyRole,
  holdTyping,
  insertTextAt,
} from '../editing/click-to-type.ts';
import type { EditOpAsk } from '../editing/edit-op.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

type Rect = { left: number; top: number; width: number; height: number };
const rectOf = (r: Rect) => () =>
  ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height }) as DOMRect;

function build() {
  document.head.innerHTML = '';
  document.body.innerHTML = `
    <article data-dc-screen="mobile"><div class="dc-artboard-body">
      <section data-cd-id="card"></section>
    </div></article>`;
  const body = document.querySelector('.dc-artboard-body') as HTMLElement;
  const card = document.querySelector('[data-cd-id="card"]') as HTMLElement;
  body.getBoundingClientRect = rectOf({ left: 100, top: 50, width: 390, height: 844 });
  card.getBoundingClientRect = rectOf({ left: 120, top: 300, width: 200, height: 100 });
  return { body, card };
}
const stack = (els: Element[]) => {
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => els;
};

/** A fake edit-op round trip: records the ask, and "renders" the new text the way a canvas reload would. */
function fakeRun(into: () => HTMLElement, gate?: Promise<void>) {
  const asks: EditOpAsk[] = [];
  const run = async (ask: EditOpAsk): Promise<EditOpResult> => {
    asks.push(ask);
    if (gate) await gate;
    const p = document.createElement('p');
    p.setAttribute('data-cd-id', 'text');
    p.setAttribute('data-cd-editable', '');
    p.textContent = 'Text';
    into().appendChild(p);
    return {
      ok: true,
      writeId: 'w_1',
      actionId: null,
      created: [{ artboard: 'mobile', element: 'text' }],
    } as unknown as EditOpResult;
  };
  return { asks, run };
}

/** canvas-shell's side of ENTER_TEXT_EDIT_EVENT, enough of it: the text becomes the focused editor. */
function editorStub() {
  const opened: Array<{ el: HTMLElement; selectAll?: boolean }> = [];
  const on = (e: Event) => {
    const d = (e as CustomEvent<{ el: HTMLElement; selectAll?: boolean }>).detail;
    opened.push(d);
    d.el.setAttribute('contenteditable', 'plaintext-only');
    d.el.tabIndex = 0;
    d.el.focus();
  };
  document.addEventListener(ENTER_TEXT_EDIT_EVENT, on);
  return { opened, off: () => document.removeEventListener(ENTER_TEXT_EDIT_EVENT, on) };
}

beforeEach(() => {
  document.head.innerHTML = '';
});

describe('T + a click on an artboard', () => {
  test('the text goes where the pointer acted, in the artboard’s own px, and opens with its words selected', async () => {
    const { body } = build();
    stack([body]);
    const { asks, run } = fakeRun(() => body);
    const ed = editorStub();
    const selected: unknown[] = [];
    const ok = await insertTextAt(
      document,
      { x: 257, y: 336 },
      { run, select: (refs) => selected.push(...refs), waitMs: 200 }
    );
    ed.off();
    expect(ok).toBe(true);
    expect(asks).toEqual([
      {
        op: 'object.insert-shape',
        targets: [],
        params: { kind: 'text', artboard: 'mobile', at: { x: 157, y: 286 } },
      },
    ]);
    // never the artboard's 0,0
    expect(asks[0]?.params?.at).not.toEqual({ x: 0, y: 0 });
    expect(selected).toEqual([{ artboard: 'mobile', element: 'text' }]);
    expect(ed.opened).toHaveLength(1);
    expect(ed.opened[0]?.selectAll).toBe(true);
    expect(ed.opened[0]?.el.getAttribute('data-cd-id')).toBe('text');
  });

  test('inside a frame: the frame is the target, its own px, a static frame is pinned relative', async () => {
    const { body, card } = build();
    stack([card, body]);
    const { asks, run } = fakeRun(() => card);
    const ed = editorStub();
    await insertTextAt(document, { x: 130, y: 310 }, { run, waitMs: 200 });
    ed.off();
    expect(asks[0]?.targets).toEqual([{ artboard: 'mobile', element: 'card' }]);
    expect(asks[0]?.params).toMatchObject({ at: { x: 10, y: 10 }, relativeParent: true });
  });

  test('the system has a body style: the text asks for it (GD-10 — never the browser serif)', async () => {
    const { body } = build();
    const style = document.createElement('style');
    style.textContent = '.t-body { font-family: var(--font-body); font-size: var(--type-base); }';
    document.head.appendChild(style);
    expect(hasBodyRole(document)).toBe(true);
    stack([body]);
    const { asks, run } = fakeRun(() => body);
    await insertTextAt(document, { x: 110, y: 60 }, { run, waitMs: 200 });
    expect(asks[0]?.params?.role).toBe(BODY_ROLE);
  });

  test('no body style: no role asked (the op writes the system UI sans fallback)', () => {
    build();
    expect(hasBodyRole(document)).toBe(false);
  });
});

describe('single-key shortcuts never fire before the caret', () => {
  test('“Sharp pencils” typed while the write is on its way: the router hears none of it, the text gets all of it', async () => {
    const { body } = build();
    stack([body]);
    let open!: () => void;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const { run } = fakeRun(() => body, gate);
    const ed = editorStub();
    // the canvas router + the shell's crossing keys listen on document capture
    const routed: string[] = [];
    const router = (e: KeyboardEvent) => routed.push(e.key);
    document.addEventListener('keydown', router, true);
    const done = insertTextAt(document, { x: 150, y: 90 }, { run, waitMs: 200 });
    for (const key of 'Sharp pencils')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    open();
    await done;
    document.removeEventListener('keydown', router, true);
    ed.off();
    expect(routed).toEqual([]);
    const text = document.querySelector('[data-cd-id="text"]') as HTMLElement;
    expect(document.activeElement).toBe(text);
    expect(text.textContent).toBe('Sharp pencils');
  });

  test('⌘-chords still go through; esc gives the hold up; the hold ends by itself', async () => {
    const hold = holdTyping(document, 30);
    const routed: string[] = [];
    const router = (e: KeyboardEvent) => routed.push(e.key);
    document.addEventListener('keydown', router, true);
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true })
    );
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(routed).toEqual(['z']);
    expect(hold.typed()).toBe('a');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(routed).toEqual(['z', 'Escape', 'n']);
    const late = holdTyping(document, 10);
    await new Promise((r) => setTimeout(r, 30));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(late.typed()).toBe('');
    expect(routed).toContain('c');
    document.removeEventListener('keydown', router, true);
  });
});
