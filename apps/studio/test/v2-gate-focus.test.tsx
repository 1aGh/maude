// V2-4 gate (polish-b) — focus and semantics, rendered (happy-dom + React):
//  · ⌘K is a WAI-ARIA combobox: listbox / option / aria-selected, aria-activedescendant follows ↓, the
//    count is a polite status (a11y B1);
//  · every aria-modal overlay keeps Tab inside, esc closes from any row, focus returns to the opener
//    (a11y B2, W3) — ⌘K, "?";
//  · tabs rove (one tab stop, ←/→ Home / End) — the left panel (a11y W4);
//  · focus that fell to BODY because its element vanished lands on a control (W3: ⌘\, Present exit);
//  · the canvas hears the "Single-key shortcuts" switch over `key-prefs` (parent-gated).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, type ReactNode, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { CommandPalette } from '../client/dialogs/command-palette.jsx';
import { ShortcutsOverlay } from '../client/dialogs/shortcuts-overlay.jsx';
import { PanelTabs } from '../client/shell/dock.jsx';
import { bindPaletteEnv } from '../client/v2/search/search-env.js';
import { actionSearchRows } from '../client/v2/search/search-model.js';
import { installFocusRescue, useModalFocus } from '../client/v2/shell/modal-focus.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

let roots: Root[] = [];
let cleanups: (() => void)[] = [];
afterEach(() => {
  act(() => {
    for (const r of roots) r.unmount();
  });
  roots = [];
  for (const c of cleanups) c();
  cleanups = [];
  document.body.innerHTML = '';
});

function mount(ui: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  roots.push(r);
  act(() => r.render(ui));
  return { host, r };
}
const flush = () => act(async () => new Promise((res) => setTimeout(res, 0)));
const keydown = (el: Element, key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    );
  });
/** An opener button that had focus before the overlay. */
function opener() {
  const b = document.createElement('button');
  b.textContent = 'opener';
  document.body.append(b);
  b.focus();
  return b;
}

function paletteActions() {
  cleanups.push(
    bindPaletteEnv({
      designRel: '.design',
      canAskAI: () => false,
      askAI: () => {},
      openCanvas: () => {},
    })
  );
  const run = () => {};
  return [
    { id: 'export.open', group: 'Canvas', label: 'Export…', icon: 'download', kbd: '⇧⌘E', run },
    { id: 'handoff.open', group: 'Canvas', label: 'Handoff', icon: 'external', run },
    { id: 'settings.theme', group: 'Tools', label: 'Toggle theme', icon: 'sun', run },
    ...actionSearchRows(menuCtx({ native: true, canvasOpen: true }), { eager: false }).map((r) => ({
      ...r,
      onlyWhenSearched: true,
    })),
  ];
}

describe('⌘K semantics (a11y B1)', () => {
  test('combobox → listbox of options; aria-activedescendant follows ↓; the count is a polite status', async () => {
    mount(<CommandPalette open onClose={() => {}} actions={paletteActions() as never} />);
    await flush();
    const input = document.querySelector('[data-testid="palette-input"]') as HTMLInputElement;
    const list = document.querySelector('[data-testid="palette-list"]') as HTMLElement;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(list.getAttribute('role')).toBe('listbox');
    const opts = [...list.querySelectorAll('[role="option"]')];
    expect(opts.length).toBe(3);
    expect(opts.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(input.getAttribute('aria-activedescendant')).toBe(opts[0].id);
    await keydown(input, 'ArrowDown');
    const now = [...list.querySelectorAll('[role="option"]')];
    expect(input.getAttribute('aria-activedescendant')).toBe(now[1].id);
    expect(now[1].getAttribute('aria-selected')).toBe('true');
    // rows are not tab stops (focus stays in the box) — the combobox pattern
    expect(now.every((o) => o.getAttribute('tabindex') === '-1')).toBe(true);
    // the group heading labels a role=group
    const group = list.querySelector('[role="group"]') as HTMLElement;
    expect(document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
      'Canvas'
    );
    const count = document.querySelector('[data-testid="palette-count"]') as HTMLElement;
    expect([count.getAttribute('role'), count.getAttribute('aria-live')]).toEqual([
      'status',
      'polite',
    ]);
  });
});

describe('overlays keep and return focus (a11y B2, W3)', () => {
  test('⌘K: Tab wraps inside, esc from a ROW closes, focus goes back to the opener', async () => {
    const back = opener();
    let closed = 0;
    const view = mount(
      <CommandPalette
        open
        onClose={() => {
          closed += 1;
        }}
        actions={paletteActions() as never}
      />
    );
    await flush();
    const input = document.querySelector('[data-testid="palette-input"]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    await keydown(input, 'Tab');
    expect(document.activeElement).toBe(input); // the only tab stop inside: Tab stays on it
    await keydown(input, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(input);
    const row = document.querySelector('[data-testid="palette-row-handoff.open"]') as HTMLElement;
    row.focus();
    await keydown(row, 'Escape');
    expect(closed).toBe(1);
    act(() =>
      view.r.render(<CommandPalette open={false} onClose={() => {}} actions={[] as never} />)
    );
    await flush();
    expect(document.activeElement).toBe(back);
  });

  test('"?": Tab wraps from the last control to the first; esc closes; focus returns', async () => {
    const back = opener();
    let closed = 0;
    const view = mount(
      <ShortcutsOverlay
        open
        onClose={() => {
          closed += 1;
        }}
      />
    );
    await flush();
    const sheet = document.querySelector('[data-testid="shortcuts-sheet"]') as HTMLElement;
    const find = document.querySelector('[data-testid="shortcuts-find"]') as HTMLElement;
    expect(document.activeElement).toBe(find);
    const stops = [...sheet.querySelectorAll('button, input')] as HTMLElement[];
    const last = stops[stops.length - 1];
    last.focus();
    await keydown(last, 'Tab');
    expect(document.activeElement).toBe(stops[0]);
    await keydown(stops[0], 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
    // a focus that escaped to the page is pulled back in
    back.focus();
    await keydown(back, 'Tab');
    expect(sheet.contains(document.activeElement)).toBe(true);
    await keydown(document.activeElement as Element, 'Escape');
    expect(closed).toBe(1);
    act(() => view.r.render(<ShortcutsOverlay open={false} onClose={() => {}} />));
    await flush();
    expect(document.activeElement).toBe(back);
  });
});

describe('a disabled initial control (gate-b-keys patch: ⇧⌘H focus behind the sheet)', () => {
  function Sheet({ disabled }: { disabled: boolean }) {
    const go = useRef<HTMLButtonElement | null>(null);
    const ref = useModalFocus({ onClose: () => {}, initialRef: go });
    return (
      <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1} data-testid="sheet">
        <button type="button" ref={go} disabled={disabled}>
          Go
        </button>
      </div>
    );
  }
  test('initialRef disabled → focus lands on the dialog, not left on the opener', async () => {
    opener();
    mount(<Sheet disabled />);
    await flush();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('sheet');
  });
  test('initialRef enabled → focus lands on it', async () => {
    opener();
    mount(<Sheet disabled={false} />);
    await flush();
    expect(document.activeElement?.textContent).toBe('Go');
  });
});

describe('tabs rove (a11y W4)', () => {
  test('the left panel: one tab stop; → / ← / Home / End pick and focus', async () => {
    const picks: string[] = [];
    let active = 'tree';
    const ui = () => (
      <PanelTabs
        side="left"
        ids={['tree', 'layers', 'assets']}
        activeId={active}
        onPick={(id: string) => {
          picks.push(id);
          active = id;
        }}
        onFold={() => {}}
      />
    );
    const view = mount(ui());
    const tab = (id: string) =>
      document.querySelector(`[data-testid="panel-tab-${id}"]`) as HTMLElement;
    expect(['tree', 'layers', 'assets'].map((id) => tab(id).getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
    ]);
    tab('tree').focus();
    await keydown(tab('tree'), 'ArrowRight');
    act(() => view.r.render(ui()));
    expect(picks).toEqual(['layers']);
    expect(document.activeElement).toBe(tab('layers'));
    expect(tab('layers').getAttribute('tabindex')).toBe('0');
    const press = async (from: string, key: string) => {
      await keydown(tab(from), key);
      act(() => view.r.render(ui()));
    };
    await press('layers', 'End');
    await press('assets', 'ArrowRight'); // wraps
    await press('tree', 'ArrowLeft');
    await press('assets', 'Home');
    expect(picks).toEqual(['layers', 'assets', 'tree', 'assets', 'tree']);
    expect(document.activeElement).toBe(tab('tree'));
  });
});

describe('focus never drops to BODY when its element vanishes (W3)', () => {
  const frame = () => {
    const f = document.createElement('iframe');
    f.setAttribute('data-testid', 'canvas-frame');
    document.body.append(f);
    return f;
  };
  const raf = () => act(async () => new Promise((res) => setTimeout(res, 40)));

  test('the Present exit pill unmounts → the canvas frame', async () => {
    const f = frame();
    cleanups.push(installFocusRescue(document));
    const pill = document.createElement('button');
    document.body.append(pill);
    pill.focus();
    pill.remove();
    (document.activeElement as HTMLElement | null)?.blur?.();
    await raf();
    expect(document.activeElement).toBe(f);
  });

  test('⌘\\ hides the panel a control was in → the Hide / Show panels toggle', async () => {
    frame();
    const toggle = document.createElement('button');
    toggle.setAttribute('data-testid', 'share-cluster-panels');
    const slot = document.createElement('div');
    slot.className = 'sh-dockslot';
    const row = document.createElement('button');
    slot.append(row);
    document.body.append(toggle, slot);
    cleanups.push(installFocusRescue(document));
    row.focus();
    slot.hidden = true;
    row.blur();
    await raf();
    expect(document.activeElement).toBe(toggle);
  });

  test('a click on blank chrome (the element still there) is left alone', async () => {
    frame();
    cleanups.push(installFocusRescue(document));
    const b = document.createElement('button');
    document.body.append(b);
    b.focus();
    b.blur();
    document.body.append(document.createElement('span')); // some DOM change
    await raf();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('the canvas hears the switch (`key-prefs`)', () => {
  test('from its parent only; on by default', () => {
    const store = canvasModeStore(window);
    expect(store.get().singleKeys).toBe(true);
    const send = (source: unknown, singleKeys: unknown) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: source as Window,
          data: { dgn: 'key-prefs', singleKeys },
        })
      );
    send({ postMessage() {} }, false); // a stranger window
    expect(store.get().singleKeys).toBe(true);
    send(window.parent, false);
    expect(store.get().singleKeys).toBe(false);
    send(window.parent, 'yes'); // junk is dropped
    expect(store.get().singleKeys).toBe(false);
    send(window.parent, true);
    expect(store.get().singleKeys).toBe(true);
  });
});
