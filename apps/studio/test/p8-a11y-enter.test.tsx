// V2-8.7 — ↵ on the canvas. VoiceOver says "Press Return to go inside" / "to type" (aria-live.tsx), the keys sheet says
// ↵ goes inside a frame and starts typing in a text — but nothing in the canvas listened for ↵ (only ⌘K / a menu could
// run `object.enter`), so a keyboard-only run could not edit a text. These pin the key AND what it does.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const FIXTURE = (editable: boolean) => `
<article class="dc-artboard" data-dc-screen="desktop">
  <div class="dc-artboard-body">
    <section data-cd-id="services" data-dc-element="services">
      <h3 data-cd-id="title"${editable ? ' data-cd-editable' : ''}>Brand systems</h3>
    </section>
  </div>
</article>`;
const sel = (id: string) => ({
  id,
  selector: `[data-dc-screen="desktop"] [data-cd-id="${id}"]`,
  artboardId: 'desktop',
});

async function mountLayer(select: string, artboardId: string | null = 'desktop') {
  const { ENTER_TEXT_EDIT_EVENT } = await import('../editing/click-to-type.ts');
  const { KeyboardLayer } = await import('../editing/focus-model.tsx');
  const { SelectionSetProvider, useSelectionSet } = await import('../use-selection-set.tsx');
  let ctx: ReturnType<typeof useSelectionSet> | null = null;
  const Grab = () => {
    ctx = useSelectionSet();
    return null;
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <SelectionSetProvider>
        <Grab />
        <KeyboardLayer />
      </SelectionSetProvider>
    )
  );
  await act(async () =>
    (ctx as unknown as { replace: (s: unknown) => void }).replace({ ...sel(select), artboardId })
  );
  const typed: Array<Record<string, unknown>> = [];
  const on = (e: Event) => typed.push((e as CustomEvent).detail);
  document.addEventListener(ENTER_TEXT_EDIT_EVENT, on);
  return {
    typed,
    selected: () => (ctx as unknown as { selected: Array<{ id?: string }> }).selected,
    off: () => document.removeEventListener(ENTER_TEXT_EDIT_EVENT, on),
  };
}
const enter = (target: EventTarget = document.body) => {
  const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

describe('↵ on the canvas (V2-8.7)', () => {
  test('on a selected text: types in it, the whole text selected, and the key is taken', async () => {
    document.body.innerHTML = FIXTURE(true);
    const m = await mountLayer('title');
    let e!: KeyboardEvent;
    await act(async () => {
      e = enter();
    });
    m.off();
    expect(m.typed).toHaveLength(1);
    expect(m.typed[0]).toMatchObject({ clientX: 0, clientY: 0, selectAll: true });
    expect(((m.typed[0] as { el: HTMLElement }).el as HTMLElement).getAttribute('data-cd-id')).toBe(
      'title'
    );
    expect(e.defaultPrevented).toBe(true);
  });

  test('a text the shell just inserted (selected by id, its artboard not yet known) types too', async () => {
    document.body.innerHTML = FIXTURE(true);
    const m = await mountLayer('title', null);
    await act(async () => {
      enter();
    });
    m.off();
    expect(m.typed).toHaveLength(1);
  });

  test('on a frame that holds objects: goes inside (the first child is selected)', async () => {
    document.body.innerHTML = FIXTURE(true);
    const m = await mountLayer('services');
    await act(async () => {
      enter();
    });
    m.off();
    expect(m.selected().map((s) => s.id)).toEqual(['title']);
    expect(m.typed).toHaveLength(0);
  });

  test('a focused control keeps its own ↵ (a toolbar button is not the canvas)', async () => {
    document.body.innerHTML = `${FIXTURE(true)}<button id="b">Frame</button>`;
    const m = await mountLayer('title');
    let e!: KeyboardEvent;
    await act(async () => {
      e = enter(document.getElementById('b') as HTMLElement);
    });
    m.off();
    expect(m.typed).toHaveLength(0);
    expect(e.defaultPrevented).toBe(false);
  });

  test('on text filled in from code: no editor (the toast says why)', async () => {
    document.body.innerHTML = FIXTURE(false);
    const m = await mountLayer('title');
    await act(async () => {
      enter();
    });
    m.off();
    expect(m.typed).toHaveLength(0);
  });
});
