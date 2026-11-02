// p8-sweep-final — in Preview an artboard's label click SELECTS the artboard (decision
// maude/v2-p8-leftovers-preview-label-selects). Found by the dead-control crawler: after Edit › Select all
// annotations (which switches the canvas to Preview) the `Artboard Desktop` label did nothing.
//
// Selecting is not editing: the design stays alive (a click on it still passes through), no tool changes,
// no edit callback runs. Only the shell's Preview (a governed canvas) gets this — a free canvas whose Browse
// tool is the boot default keeps its pure pass-through (browse-posture.test.tsx).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { classify, type RouterCallbacks, type Tool, useInputRouter } from '../input-router.tsx';

function Harness({ getTool, callbacks }: { getTool: () => Tool; callbacks: RouterCallbacks }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useInputRouter({ hostRef, getActiveTool: getTool, callbacks });
  return (
    <div ref={hostRef} className="dc-canvas">
      <article data-dc-screen="desktop" className="dc-artboard">
        <button type="button" className="dc-artboard-label" id="label">
          Desktop
        </button>
        <div className="dc-artboard-body">
          <button type="button" id="design-btn">
            Buy
          </button>
        </div>
      </article>
    </div>
  );
}

const fakeParent = { postMessage: () => {} };
let realParent: PropertyDescriptor | undefined;
const setMode = (mode: string) => {
  const store = canvasModeStore(window);
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: fakeParent as unknown as Window,
        data: {
          dgn: 'set-mode',
          v: 2,
          seq: store.get().modeSeq + 1,
          mode,
          present: null,
          caps: { edit: true, annotate: true, comment: true },
        },
      })
    );
  });
};

function press(el: Element, init: MouseEventInit = {}): void {
  const o = { bubbles: true, cancelable: true, button: 0, ...init };
  el.dispatchEvent(new MouseEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new MouseEvent('click', o));
}

function mount(tool: Tool) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root: Root = createRoot(el);
  const log = { selects: [] as unknown[], tools: 0, menus: 0, drops: 0 };
  act(() => {
    root.render(
      <Harness
        getTool={() => tool}
        callbacks={{
          onSelect: (a) => log.selects.push({ mode: a.mode, deep: a.deep }),
          onTool: () => {
            log.tools += 1;
          },
          onContextMenu: () => {
            log.menus += 1;
          },
          onDropComment: () => {
            log.drops += 1;
          },
        }}
      />
    );
  });
  return {
    el,
    log,
    done: () => {
      act(() => root.unmount());
      el.remove();
    },
  };
}

describe('Preview: an artboard label click selects the artboard', () => {
  beforeAll(() => {
    realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
    canvasModeStore(window); // the store listens from here on
  });
  afterAll(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent);
    else Reflect.deleteProperty(window, 'parent');
  });

  test('governed Preview: one select (top-level, replace) and nothing else changes', () => {
    setMode('preview');
    const m = mount('browse');
    act(() => press(m.el.querySelector('#label') as Element));
    expect(m.log.selects).toEqual([{ mode: 'replace', deep: false }]);
    // selecting is not editing: no tool flips, no menu, no comment pin
    expect(m.log).toMatchObject({ tools: 0, menus: 0, drops: 0 });
    m.done();
  });

  test('Shift adds to the selection, like everywhere else', () => {
    setMode('preview');
    const m = mount('browse');
    act(() => press(m.el.querySelector('#label') as Element, { shiftKey: true }));
    expect(m.log.selects).toEqual([{ mode: 'add', deep: false }]);
    m.done();
  });

  test('the design stays alive: a click ON the page passes through, nothing is selected', () => {
    setMode('preview');
    const m = mount('browse');
    let native = 0;
    const btn = m.el.querySelector('#design-btn') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      native += 1;
    });
    act(() => press(btn));
    expect(m.log.selects).toEqual([]);
    expect(native).toBe(1);
    m.done();
  });

  test('Edit keeps its own path: a Browse press on the label there does not select', () => {
    setMode('edit');
    const m = mount('browse');
    act(() => press(m.el.querySelector('#label') as Element));
    expect(m.log.selects).toEqual([]);
    m.done();
  });
});

describe('classify: the label press needs the shell to be in Preview', () => {
  const base = {
    type: 'pointerdown',
    button: 0,
    activeTool: 'browse',
    clientX: 1,
    clientY: 1,
  } as const;
  test('previewLabel + browse → select; without it, or off Browse, nothing new', () => {
    expect(classify({ ...base, previewLabel: true })).toMatchObject({
      kind: 'select',
      mode: 'replace',
      deep: false,
    });
    expect(classify({ ...base })).toEqual({ kind: 'no-op' });
    expect(classify({ ...base, activeTool: 'hand', previewLabel: true })).toEqual({
      kind: 'no-op',
    });
  });
});
