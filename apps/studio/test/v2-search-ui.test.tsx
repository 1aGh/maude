// V2-4.6 — the REAL ⌘K palette and "?" sheet (happy-dom + React): typing finds a hidden tool with its
// where-path, ↵ runs it through the row's own runner and closes, Ask AI is the last row (⌘↵ always runs
// it, and it is absent where there is no AI), "Nothing called …" is the drawn copy, canvases and
// artboards come from the project index, and "?" lists every registry key and the moved fold.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommandPalette } from '../client/dialogs/command-palette.jsx';
import { ShortcutsOverlay } from '../client/dialogs/shortcuts-overlay.jsx';
import { bindPaletteEnv } from '../client/v2/search/search-env.js';
import { actionSearchRows, settingsSearchRows } from '../client/v2/search/search-model.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

const desktop = menuCtx({ native: true, canvasOpen: true });
let root: Root | null = null;
let host: HTMLElement | null = null;
let unbind: (() => void) | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  unbind?.();
  unbind = null;
});

interface Spies {
  ran: string[];
  asked: string[];
  opened: [string, string | null][];
  closed: number;
}

function setup({ ai = true, index = null as object | null } = {}) {
  const spies: Spies = { ran: [], asked: [], opened: [], closed: 0 };
  unbind = bindPaletteEnv({
    designRel: '.design',
    canAskAI: () => ai,
    askAI: (t: string) => spies.asked.push(t),
    openCanvas: (p: string, a: string | null) => spies.opened.push([p, a]),
  });
  globalThis.fetch = (async () =>
    index
      ? new Response(JSON.stringify(index), { status: 200 })
      : new Response('{}', { status: 404 })) as unknown as typeof fetch;
  const rows = [
    ...actionSearchRows(desktop, { eager: false, run: (id: string) => spies.ran.push(id) }),
    ...settingsSearchRows({ cloud: null, run: (s: string) => spies.ran.push(`settings:${s}`) }),
  ].map((r) => ({ ...r, onlyWhenSearched: true }));
  const short = [
    {
      id: 'export.open',
      group: 'Canvas',
      label: 'Export…',
      icon: 'download',
      kbd: '⇧⌘E',
      run: () => spies.ran.push('short:export'),
    },
  ];
  return { spies, actions: [...short, ...rows] };
}

async function mount(actions: object[], spies: Spies) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <CommandPalette
        open
        onClose={() => {
          spies.closed += 1;
        }}
        actions={actions as never}
      />
    );
  });
  return host;
}

// Typing calls the input's own React onChange. react-dom decides at import time whether the page can
// hear `input` events (canUseDOM), and the imports are hoisted above happy-dom's registration — so a
// dispatched `input` event never reaches onChange here, in this file or in a whole-suite run.
async function type(el: HTMLElement, value: string) {
  const input = el.querySelector('input') as HTMLInputElement;
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
  const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[propsKey];
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, value);
    props.onChange({ target: input, currentTarget: input });
  });
  return input;
}

async function key(input: HTMLInputElement, k: string, mods: { metaKey?: boolean } = {}) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...mods }));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rowIds = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-testid^="palette-row-"]')].map((n) =>
    (n.getAttribute('data-testid') as string).replace('palette-row-', '')
  );

describe('⌘K, the real palette', () => {
  test('nothing typed: the short list, then Ask AI last', async () => {
    const { spies, actions } = setup();
    const el = await mount(actions, spies);
    expect(rowIds(el)).toEqual(['export.open', 'ask-ai']);
    expect(el.querySelector('[data-testid="palette-count"]')?.textContent).toBe('Type to search');
  });

  test('"print guides": the hidden tool, its path beside it, ↵ runs it and closes', async () => {
    const { spies, actions } = setup();
    const el = await mount(actions, spies);
    const input = await type(el, 'print guides');
    const first = el.querySelector('[data-testid="palette-row-action:view.print-guides"]');
    expect(first).not.toBeNull();
    expect(first?.classList.contains('is-active')).toBe(true);
    expect(first?.querySelector('.st-pal-where')?.textContent).toBe('Menu › View › Advanced');
    expect(
      el.querySelector('[data-testid="palette-group-actions"] .st-pal-aside')?.textContent
    ).toBe('1 hidden tool');
    await key(input, 'Enter');
    expect(spies.ran).toEqual(['view.print-guides']);
    expect(spies.closed).toBe(1);
  });

  test('a Settings hit opens Settings on its section', async () => {
    const { spies, actions } = setup();
    const el = await mount(actions, spies);
    const input = await type(el, 'add a team server');
    const ids = rowIds(el);
    const row = el.querySelector('.st-pal-item.is-active');
    expect(row?.querySelector('.st-pal-where')?.textContent).toMatch(/^Settings › /);
    await key(input, 'Enter');
    expect(spies.ran).toEqual(['settings:connections']);
    expect(ids[ids.length - 1]).toBe('ask-ai');
  });

  test('Ask AI is the last row of every result, and ⌘↵ runs it whatever is highlighted', async () => {
    const { spies, actions } = setup();
    const el = await mount(actions, spies);
    const input = await type(el, 'hub');
    const ids = rowIds(el);
    expect(ids[ids.length - 1]).toBe('ask-ai');
    expect(ids.length).toBeGreaterThan(3);
    await key(input, 'Enter', { metaKey: true });
    expect(spies.asked).toEqual(['hub']);
    expect(spies.ran).toEqual([]);
  });

  test('no match: the drawn copy, a count of 0 results, and Ask AI still there to take the query', async () => {
    const { spies, actions } = setup();
    const el = await mount(actions, spies);
    const input = await type(el, 'pricng qqqq');
    const none = el.querySelector('[data-testid="palette-empty"]');
    expect(none?.textContent).toBe(
      'Nothing called “pricng qqqq”.Try another word, or ask AI to find it.'
    );
    expect(rowIds(el)).toEqual(['ask-ai']);
    expect(el.querySelector('[data-testid="palette-count"]')?.textContent).toBe('0 results');
    await key(input, 'Enter');
    expect(spies.asked).toEqual(['pricng qqqq']);
  });

  test('where there is no AI (a browser tab) there is no Ask AI row and the copy says so', async () => {
    const { spies, actions } = setup({ ai: false });
    const el = await mount(actions, spies);
    await type(el, 'pricng qqqq');
    expect(el.querySelector('[data-testid="palette-empty"]')?.textContent).toBe(
      'Nothing called “pricng qqqq”.Try another word.'
    );
    expect(rowIds(el)).toEqual([]);
    expect(el.querySelector('[data-testid="palette-ask-ai"]')).toBeNull();
  });

  test('canvases and artboards come from the project index, first, and open by path', async () => {
    const { spies, actions } = setup({
      index: {
        q: 'letak',
        closeOnly: false,
        rows: [
          {
            group: 'canvases',
            key: 'ui/2026/LetakA6.tsx',
            name: 'LetakA6',
            meta: 'ui/2026',
            score: 4,
            close: false,
            marks: [[0, 5]],
          },
          {
            group: 'artboards',
            key: 'ui/2026/LetakA6.tsx#front',
            name: 'Front',
            meta: 'LetakA6 ui print',
            score: 4,
            close: false,
            marks: [],
          },
        ],
      },
    });
    const el = await mount(actions, spies);
    await type(el, 'letak');
    await act(async () => {
      await sleep(250);
    });
    const ids = rowIds(el);
    expect(ids.slice(0, 2)).toEqual([
      'canvas:ui/2026/LetakA6.tsx',
      'artboard:ui/2026/LetakA6.tsx#front',
    ]);
    expect(ids[ids.length - 1]).toBe('ask-ai');
    expect(
      el.querySelector(
        '[data-testid="palette-row-artboard:ui/2026/LetakA6.tsx#front"] .st-pal-meta'
      )?.textContent
    ).toBe('artboard in LetakA6');
    const board = el.querySelector(
      '[data-testid="palette-row-artboard:ui/2026/LetakA6.tsx#front"]'
    ) as HTMLElement;
    await act(async () => {
      board.click();
    });
    expect(spies.opened).toEqual([['.design/ui/2026/LetakA6.tsx', 'front']]);
    expect(spies.closed).toBe(1);
  });

  test('↵ on a query the list has not re-rendered for yet runs what the box says (surface run 2026-09-16)', async () => {
    const { spies, actions } = setup();
    const el = await mount(actions, spies);
    const input = el.querySelector('input') as HTMLInputElement;
    // the box holds the text; React has not heard an input event for it
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, 'print guides');
    await key(input, 'Enter');
    expect(spies.ran).toEqual(['view.print-guides']);
  });

  test('esc closes', async () => {
    const { spies, actions } = setup();
    const el = await mount(actions, spies);
    await key(el.querySelector('input') as HTMLInputElement, 'Escape');
    expect(spies.closed).toBe(1);
  });
});

describe('"?", the real sheet', () => {
  test('lists the registry keys by group, the Advanced fold with paths, and the moved fold', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<ShortcutsOverlay open onClose={() => {}} />);
    });
    const el = host;
    expect(el.querySelector('[data-testid="shortcuts-group-edit-tools"]')).not.toBeNull();
    expect(
      el.querySelector('[data-testid="shortcuts-group-preview-tools"] .so-note')?.textContent
    ).toBe('The key switches to Preview');
    expect(el.querySelector('[data-testid="shortcuts-row-export.open"]')?.textContent).toContain(
      '⇧⌘E'
    );
    expect(el.querySelector('[data-testid="shortcuts-moved-hd"]')?.textContent).toBe(
      'Keys and tools that moved'
    );
    expect(el.querySelector('[data-testid="shortcuts-moved"]')?.textContent).toContain('Pen B');
    expect(
      el.querySelector('[data-testid="shortcuts-row-view.inspector"] .so-adv-path')?.textContent
    ).toBe('Menu › View › Advanced › Inspector');
  });

  test('"Find a shortcut" narrows by the ⌘K fold, and says when nothing matches', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<ShortcutsOverlay open onClose={() => {}} />);
    });
    const el = host;
    await type(el, 'zoom fit');
    expect(el.querySelector('[data-testid="shortcuts-row-view.zoom-fit"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="shortcuts-row-export.open"]')).toBeNull();
    await type(el, 'zzzzqq');
    expect(el.querySelector('[data-testid="shortcuts-none"]')?.textContent).toBe(
      'Nothing called “zzzzqq”. Try another word.'
    );
  });
});
