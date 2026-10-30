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
  across: Record<string, unknown>[];
  closed: number;
}

function setup({
  ai = true,
  index = null as object | null,
  pins = null as object | null,
  across = null as object | null,
} = {}) {
  const spies: Spies = { ran: [], asked: [], opened: [], across: [], closed: 0 };
  unbind = bindPaletteEnv({
    // S1.5: a desktop tab's other projects (a browser tab binds none)
    ...(across
      ? {
          ownProject: { pid: `l${'a'.repeat(16)}`, name: 'Alligators brand' },
          searchProjects: async () => across,
          openSearchResult: (row: Record<string, unknown>) => spies.across.push(row),
        }
      : {}),
    designRel: '.design',
    canAskAI: () => ai,
    askAI: (t: string) => spies.asked.push(t),
    openCanvas: (p: string, a: string | null) => spies.opened.push([p, a]),
  });
  globalThis.fetch = (async (url: string) => {
    if (String(url).startsWith('/_api/pins'))
      return pins
        ? new Response(JSON.stringify(pins), { status: 200 })
        : new Response('{}', { status: 404 });
    return index
      ? new Response(JSON.stringify(index), { status: 200 })
      : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
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
    expect(first?.querySelector('.sh-pal-where')?.textContent).toBe('Menu › View › Advanced');
    expect(
      el.querySelector('[data-testid="palette-group-actions"] .sh-pal-aside')?.textContent
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
    const row = el.querySelector('.sh-pal-item.is-active');
    expect(row?.querySelector('.sh-pal-where')?.textContent).toMatch(/^Settings › /);
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
    // S11.3: the kit's spot and the 05 words (es-search-k), Ask AI still the one row below
    expect(none?.getAttribute('data-copy')).toBe('es-search-k.search-none');
    expect(none?.querySelector('.es-spot')).not.toBeNull();
    expect(none?.querySelector('button')).toBeNull();
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
        '[data-testid="palette-row-artboard:ui/2026/LetakA6.tsx#front"] .sh-pal-meta'
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

describe('⌘K words (S1.4)', () => {
  const idx = (rows: object[]) => ({ q: 'x', closeOnly: false, rows });
  const row = (group: string, key: string, name: string, meta: string) => ({
    group,
    key,
    name,
    meta,
    score: 1,
    close: true,
    marks: [],
  });

  test('a Mac with nothing opened: Recent says so, Start here lists where to begin, Ask AI says what to type', async () => {
    const { spies, actions } = setup({ pins: { pins: [], opened: {} } });
    const el = await mount(actions, spies);
    await act(async () => {
      await sleep(30);
    });
    expect(el.querySelector('[data-testid="palette-recent-empty"]')?.textContent).toBe(
      'Nothing opened yet.Canvases you open show up here, newest first.'
    );
    const ids = rowIds(el);
    expect(ids.slice(0, 4)).toEqual([
      'start:canvas.new',
      'start:project.open',
      'start:import.figma',
      'start:help.shortcuts',
    ]);
    expect(ids[ids.length - 1]).toBe('ask-ai');
    expect(el.querySelector('[data-testid="palette-row-ask-ai"]')?.textContent).toContain(
      'Ask AI — type what to make, or what to find'
    );
    expect(el.querySelector('[data-testid="palette-count"]')?.textContent).toBe(
      'Every tool is here — type its name'
    );
  });

  test('canvases opened lately are listed under Recent, newest first, and ↵ opens one', async () => {
    const { spies, actions } = setup({
      pins: { pins: [], opened: { 'ui/Pricing.tsx': 5, 'ui/Homepage.tsx': 9 } },
    });
    const el = await mount(actions, spies);
    await act(async () => {
      await sleep(30);
    });
    expect(el.querySelector('[data-testid="palette-recent-empty"]')).toBeNull();
    expect(rowIds(el).slice(0, 2)).toEqual(['recent:ui/Homepage.tsx', 'recent:ui/Pricing.tsx']);
    await act(async () => {
      (
        el.querySelector('[data-testid="palette-row-recent:ui/Homepage.tsx"]') as HTMLElement
      ).click();
    });
    expect(spies.opened).toEqual([['.design/ui/Homepage.tsx', null]]);
  });

  test('a misspelling: the CONTRACT line, then "Did you mean", and the footer says 0 results · 1 close match', async () => {
    const { spies, actions } = setup({
      index: idx([row('canvases', 'ui/Pricing.tsx', 'Pricing', 'ui')]),
    });
    const el = await mount(actions, spies);
    const input = await type(el, 'pricng');
    await act(async () => {
      await sleep(250);
    });
    expect(el.querySelector('[data-testid="palette-did-you-mean-note"]')?.textContent).toBe(
      'Nothing called “pricng”.Try another word, or ask AI to find it.'
    );
    expect(el.querySelector('[data-testid="palette-close-note"]')).toBeNull();
    const group = el.querySelector('[data-testid="palette-group-did-you-mean"]');
    expect(group?.textContent).toContain('Did you mean');
    expect(rowIds(el)).toEqual(['canvas:ui/Pricing.tsx', 'ask-ai']);
    expect(el.querySelector('[data-testid="palette-count"]')?.textContent).toBe(
      '0 results · 1 close match'
    );
    expect(el.querySelector('[data-testid="palette-row-ask-ai"]')?.textContent).toContain(
      'Ask AI to find “pricng” — it looks inside canvases too'
    );
    await key(input, 'Enter');
    expect(spies.opened).toEqual([['.design/ui/Pricing.tsx', null]]);
  });

  test('typos in one word of two: the note, the marks (name and meta) and "N close matches"', async () => {
    const { spies, actions } = setup({
      index: idx([
        row('canvases', 'ui/Uniformy-2027.tsx', 'Uniformy-2027', '2026/dresy'),
        row('artboards', 'ui/Uniformy-2027.tsx#h', 'Domácí dres 2027', 'x'),
      ]),
    });
    const el = await mount(actions, spies);
    await type(el, 'unifromy 2027');
    await act(async () => {
      await sleep(250);
    });
    expect(el.querySelector('[data-testid="palette-close-note"]')?.textContent).toBe(
      'Nothing called “unifromy”. Showing close matches for uniformy.'
    );
    expect(el.querySelector('[data-testid="palette-did-you-mean-note"]')).toBeNull();
    const marks = (id: string, where: string) =>
      [...el.querySelectorAll(`[data-testid="palette-row-${id}"] ${where} mark`)].map(
        (m) => m.textContent
      );
    expect(marks('canvas:ui/Uniformy-2027.tsx', '.sh-pal-ltxt')).toEqual(['Uniformy', '2027']);
    expect(marks('artboard:ui/Uniformy-2027.tsx#h', '.sh-pal-ltxt')).toEqual(['2027']);
    expect(marks('artboard:ui/Uniformy-2027.tsx#h', '.sh-pal-meta')).toEqual(['Uniformy']);
    expect(el.querySelector('[data-testid="palette-count"]')?.textContent).toBe('2 close matches');
  });

  test('a near miss among rows that have a word right is quiet', async () => {
    const { spies, actions } = setup({
      index: idx([
        { ...row('canvases', 'ui/a.tsx', 'Uniformy-lteak', 'a'), close: false },
        row('canvases', 'ui/b.tsx', 'Unifromy-letak', 'b'),
      ]),
    });
    const el = await mount(actions, spies);
    await type(el, 'uniformy lteak');
    await act(async () => {
      await sleep(250);
    });
    const strong = el.querySelector('[data-testid="palette-row-canvas:ui/a.tsx"]');
    const quiet = el.querySelector('[data-testid="palette-row-canvas:ui/b.tsx"]');
    expect(strong?.classList.contains('is-quiet')).toBe(false);
    expect(quiet?.classList.contains('is-quiet')).toBe(true);
    expect(el.querySelector('[data-testid="palette-count"]')?.textContent).toBe('2 results');
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

describe('⌘K across projects (S1.5 · pn-k-across)', () => {
  const OTHER = `l${'b'.repeat(16)}`;
  const CLOSED = `l${'c'.repeat(16)}`;
  const own = {
    q: 'mobil',
    closeOnly: false,
    rows: [
      {
        group: 'canvases',
        key: 'web/responsive.tsx',
        name: 'responsive',
        meta: 'web',
        score: 4,
        close: false,
        marks: [],
      },
    ],
  };
  const across = {
    groups: [
      // the shell never sends this tab's own project — and if it did, it is not shown twice
      { pid: `l${'a'.repeat(16)}`, name: 'Alligators brand', place: 'tab', rows: own.rows },
      {
        pid: OTHER,
        name: 'Studio site',
        place: 'tab',
        rows: [
          {
            group: 'artboards',
            key: 'ui/Homepage.tsx#mobile',
            name: 'Mobile',
            meta: 'Homepage ui',
            score: 4,
            close: false,
            marks: [],
          },
        ],
      },
      {
        pid: CLOSED,
        name: 'Portfolio 2026',
        place: 'closed',
        rows: [
          {
            group: 'canvases',
            key: 'case/Mobilni-app.tsx',
            name: 'Mobilní app',
            meta: 'case',
            score: 3,
            close: false,
            marks: [],
          },
        ],
      },
    ],
  };

  test('groups by project — this tab first — and ↵ on another project asks the shell, ids only', async () => {
    const { spies, actions } = setup({ index: own, across });
    const el = await mount(actions, spies);
    await type(el, 'mobil');
    await act(async () => {
      await sleep(250);
    });
    const groups = [...el.querySelectorAll('[data-testid^="palette-group-"]')].map((n) =>
      n.getAttribute('data-testid')
    );
    expect(groups.slice(0, 3)).toEqual([
      'palette-group-project-self',
      `palette-group-project-${OTHER}`,
      `palette-group-project-${CLOSED}`,
    ]);
    const head = (id: string) =>
      el.querySelector(`[data-testid="palette-group-${id}"] .sh-pal-group`)?.textContent;
    expect(head('project-self')).toBe('AAlligators brandthis tab');
    expect(head(`project-${OTHER}`)).toBe('SStudio sitein another tab');
    expect(head(`project-${CLOSED}`)).toBe('PPortfolio 2026not open — opens a tab');
    expect(el.querySelectorAll('[data-testid="palette-project-square"]').length).toBe(3);
    // this project answers once
    expect(rowIds(el).filter((id) => id.endsWith('web/responsive.tsx'))).toEqual([
      'canvas:web/responsive.tsx',
    ]);
    const row = el.querySelector(
      `[data-testid="palette-row-project:${OTHER}:artboard:ui/Homepage.tsx#mobile"]`
    ) as HTMLElement;
    await act(async () => {
      row.click();
    });
    expect(spies.across.map((r) => [r.pid, r.canvasRel, r.artboardId])).toEqual([
      [OTHER, 'ui/Homepage.tsx', 'mobile'],
    ]);
    expect(spies.opened).toEqual([]);
    expect(spies.closed).toBe(1);
  });

  // S15-A2: a misspelling flattens everything into "Did you mean" — another project's row still says
  // which project ↵ goes to, and where it is.
  test('“Did you mean”: another project’s row keeps its square, name and where it is', async () => {
    const typo = {
      groups: [
        across.groups[1],
        {
          ...across.groups[2],
          rows: [{ ...across.groups[2].rows[0], key: 'case/Mobile-app.tsx', name: 'Mobile app' }],
        },
      ],
    };
    const { spies, actions } = setup({ index: { rows: [] }, across: typo });
    const el = await mount(actions, spies);
    await type(el, 'mobjle');
    await act(async () => {
      await sleep(250);
    });
    expect(el.querySelector('[data-testid="palette-group-did-you-mean"]')).not.toBeNull();
    const labels = [...el.querySelectorAll('[data-testid="palette-project-label"]')].map(
      (n) => n.textContent
    );
    expect(labels.sort()).toEqual([
      'PPortfolio 2026 · not open — opens a tab',
      'SStudio site · in another tab',
    ]);
  });

  test('a browser tab asks nobody: Canvases · Artboards as before', async () => {
    const { spies, actions } = setup({ index: own });
    const el = await mount(actions, spies);
    await type(el, 'mobil');
    await act(async () => {
      await sleep(250);
    });
    expect(el.querySelector('[data-testid="palette-group-canvases"]')).not.toBeNull();
    expect(el.querySelector('[data-testid^="palette-group-project-"]')).toBeNull();
  });
});
