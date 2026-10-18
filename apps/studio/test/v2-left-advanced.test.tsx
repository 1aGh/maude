// S11.9 — Canvases and Layers › Advanced (06 · ad-left): Show file names (a second mono line), the project
// Folder and Design system rows, "updated just now", the row menu's Advanced group (Reveal in Finder · Open
// in editor · View code · Copy file path · Rename file…) with its native rows hidden in the browser and
// swapped to "Open in the Mac app", Layers › Advanced (tags and ids, counts, Select by selector — capped and
// scoped — and the element id), and the registry rows behind all of it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { isEnabled, isVisible } from '../actions/resolve.ts';
import { layoutRows, ROW_H, ROW_H_FILE, rowHeight } from '../client/v2/canvases/tree-model.js';
import {
  checkSelector,
  countLayers,
  countsLine,
  SELECT_CAP,
  SELECTOR_MAX_LEN,
  SELECTOR_WORDS,
  tagLabel,
  updatedWord,
} from '../client/v2/left-panel/advanced-model.js';
import {
  fileMenuItems,
  panelRole,
  rowProjectPath,
  runFileMenuItem,
} from '../client/v2/left-panel/canvas-file-menu.js';
import { scopedMatches } from '../client/v2/left-panel/selector-scope.js';
import {
  getViewPref,
  resetViewPrefsForTest,
  setViewPref,
  toggleViewPref,
  VIEW_PREF_KEYS,
} from '../client/v2/left-panel/view-prefs.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

// ── pure: the store, the model, the menu rules ───────────────────────────────────────────────────────
// One DOM for the whole file, torn down at its end (bun runs every file in one process).
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe('view prefs — the person’s own window', () => {
  beforeEach(() => resetViewPrefsForTest());

  test('off by default; a switch is remembered on this Mac and never throws without storage', () => {
    expect(getViewPref(VIEW_PREF_KEYS.fileNames)).toBe(false);
    setViewPref(VIEW_PREF_KEYS.fileNames, true);
    expect(globalThis.localStorage.getItem('maude.view.canvases.show-file-names')).toBe('1');
    expect(toggleViewPref(VIEW_PREF_KEYS.fileNames)).toBe(false);
    expect(globalThis.localStorage.getItem('maude.view.canvases.show-file-names')).toBe('0');
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    expect(() => setViewPref(VIEW_PREF_KEYS.tags, true)).not.toThrow();
    expect(getViewPref(VIEW_PREF_KEYS.tags)).toBe(true);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real });
  });
});

describe('the Advanced words', () => {
  test('updated: just now, then minutes, then hours', () => {
    const t = 1_000_000;
    expect(updatedWord(t, t)).toBe('updated just now');
    expect(updatedWord(t + 59_000, t)).toBe('updated just now');
    expect(updatedWord(t + 5 * 60_000, t)).toBe('updated 5 min ago');
    expect(updatedWord(t + 3 * 3_600_000, t)).toBe('updated 3 h ago');
  });

  test('counts line leaves out a part it does not know', () => {
    expect(countsLine({ artboards: 15, layers: 214 })).toBe('15 artboards · 214 layers');
    expect(countsLine({ artboards: 1, layers: 1 })).toBe('1 artboard · 1 layer');
    expect(countsLine({ artboards: 3 })).toBe('3 artboards');
    expect(countsLine({})).toBe('');
  });

  test('layers are counted through the tree, synthetic groups not at all', () => {
    const tree = {
      nodes: [
        { id: 'a', children: [{ id: 'b' }, { id: 'g', synthetic: true, children: [{ id: 'c' }] }] },
        { id: 'd' },
      ],
    };
    expect(countLayers(tree)).toBe(4);
    expect(countLayers(null)).toBe(0);
  });

  test('tag and id', () => {
    expect(tagLabel({ tag: 'SECTION', id: 'cd-91be07' })).toBe('section · cd-91be07');
    expect(tagLabel({ tag: 'a', id: '' })).toBe('a');
    expect(tagLabel({ tag: 'div', id: 'x', synthetic: true })).toBe('');
  });
});

describe('Select by selector — what the field sends', () => {
  const fake = (s: string) => {
    if (s.includes('[[')) throw new SyntaxError('bad');
  };
  test('nothing typed sends nothing', () => {
    expect(checkSelector('   ', fake)).toEqual({ kind: 'empty' });
  });
  test('an over-long selector is refused before it is parsed', () => {
    let parsed = false;
    const v = checkSelector('a'.repeat(SELECTOR_MAX_LEN + 1), () => {
      parsed = true;
    });
    expect(v).toEqual({ kind: 'error', error: SELECTOR_WORDS.long });
    expect(parsed).toBe(false);
  });
  test('an invalid selector is refused inline; a good one is trimmed and sent', () => {
    expect(checkSelector('a[[', fake)).toEqual({ kind: 'error', error: SELECTOR_WORDS.invalid });
    expect(checkSelector('  section#hero a ', fake)).toEqual({
      kind: 'select',
      selector: 'section#hero a',
    });
  });
});

describe('selector scope — the canvas half', () => {
  const doc = (html: string) => {
    document.body.innerHTML = html;
    return document;
  };

  test('SCOPED: only inside an artboard — the canvas chrome and the stage are never selected', () => {
    const d = doc(
      `<div class="toolbar"><a id="chrome">x</a></div>
       <div data-dc-screen="one"><section id="hero"><a id="in1">1</a></section></div>
       <div data-dc-screen="two"><section id="hero"><a id="in2">2</a></section></div>
       <a id="stage">stage</a>`
    );
    const r = scopedMatches(d, 'section#hero a');
    expect(r.ok && r.els.map((e) => e.id)).toEqual(['in1', 'in2']);
    const all = scopedMatches(d, 'a');
    expect(all.ok && all.els.map((e) => e.id)).toEqual(['in1', 'in2']);
  });

  test('CAPPED: at most 500, and it says there were more', () => {
    const rows = Array.from({ length: SELECT_CAP + 40 }, (_, i) => `<i class="x" id="n${i}"></i>`);
    const d = doc(`<div data-dc-screen="one">${rows.join('')}</div>`);
    const r = scopedMatches(d, '.x');
    expect(r.ok && r.els.length).toBe(SELECT_CAP);
    expect(r.ok && r.truncated).toBe(true);
    const small = scopedMatches(d, '#n3');
    expect(small.ok && small.truncated).toBe(false);
  });

  test('SAFE: an invalid, empty or over-long selector answers a reason and throws nothing', () => {
    const d = doc('<div data-dc-screen="one"><p>x</p></div>');
    expect(scopedMatches(d, 'p[[')).toEqual({ ok: false, reason: 'invalid' });
    expect(scopedMatches(d, '  ')).toEqual({ ok: false, reason: 'empty' });
    expect(scopedMatches(d, 'p'.repeat(SELECTOR_MAX_LEN + 1))).toEqual({
      ok: false,
      reason: 'long',
    });
  });
});

describe('the row menu’s Advanced group', () => {
  const ids = (o: Parameters<typeof fileMenuItems>[0]) => fileMenuItems(o).map((i) => i.id);

  test('Mac app, Can edit: Reveal · Open in editor · View code · Copy file path · Rename file…', () => {
    const items = fileMenuItems({ role: 'edit', native: true });
    expect(items.map((i) => i.label)).toEqual([
      'Reveal in Finder',
      'Open in editor',
      'View code',
      'Copy file path',
      'Rename file…',
    ]);
    expect(items.at(-1)?.sepBefore).toBe(true);
  });

  test('in the browser the two native rows become ONE: Open in the Mac app', () => {
    expect(ids({ role: 'edit', native: false })).toEqual([
      'open-mac-app',
      'view-code',
      'copy-path',
      'rename-file',
    ]);
    expect(fileMenuItems({ role: 'edit', native: false })[0].label).toBe('Open in the Mac app');
  });

  test('Can comment: no Reveal / Open / Rename — View code and Copy file path stay', () => {
    expect(ids({ role: 'comment', native: true })).toEqual(['view-code', 'copy-path']);
  });

  test('Can view: none of the group', () => {
    expect(ids({ role: 'view', native: true })).toEqual([]);
  });

  test('a panel with no role is an editor, or the weakest when read-only', () => {
    expect(panelRole({ edit: true })).toBe('edit');
    expect(panelRole({ edit: false })).toBe('view');
    expect(panelRole({ role: 'comment', edit: false })).toBe('comment');
  });

  const row = { path: '.design/ui/Pricing.tsx', rel: 'ui/Pricing.tsx', key: 'row:p' };
  const io = (over: Record<string, unknown> = {}) => {
    const log: unknown[][] = [];
    return {
      log,
      io: {
        designRel: '.design',
        doors: {
          revealPath: async (p: string) => (log.push(['reveal', p]), { ok: true }),
          openInEditor: async (p: string) => (log.push(['editor', p]), { ok: true }),
        },
        write: async (t: string) => (log.push(['copy', t]), true),
        toast: (m: string) => log.push(['toast', m]),
        requestViewCode: (r: unknown) => log.push(['code', r]),
        startRename: (k: string) => log.push(['rename', k]),
        ...over,
      },
    };
  };

  test('paths handed to the doors are project-relative, never absolute', async () => {
    expect(rowProjectPath('.design', row)).toBe('.design/ui/Pricing.tsx');
    const { io: x, log } = io();
    await runFileMenuItem('reveal', row, x);
    await runFileMenuItem('open-editor', row, x);
    expect(log).toEqual([
      ['reveal', '.design/ui/Pricing.tsx'],
      ['editor', '.design/ui/Pricing.tsx'],
    ]);
  });

  test('View code asks the Viewport for this row’s canvas; Rename file… starts the in-place rename', async () => {
    const { io: x, log } = io();
    await runFileMenuItem('view-code', row, x);
    await runFileMenuItem('rename-file', row, x);
    expect(log).toEqual([
      ['code', { canvas: '.design/ui/Pricing.tsx' }],
      ['rename', 'row:p'],
    ]);
  });

  test('Copy file path copies the project path and says so', async () => {
    const { io: x, log } = io();
    await runFileMenuItem('copy-path', row, x);
    expect(log).toEqual([
      ['copy', '.design/ui/Pricing.tsx'],
      ['toast', 'File path copied.'],
    ]);
    const bad = io({ write: async () => false });
    await runFileMenuItem('copy-path', row, bad.io);
    expect(bad.log.at(-1)).toEqual(['toast', 'Couldn’t copy the file path.']);
  });

  test('a refused door says why in Rust’s own words; a browser says "Open in the Mac app"', async () => {
    const refused = io({
      doors: {
        revealPath: async () => ({
          ok: false,
          reason: 'refused',
          error: 'Switch to this tab first.',
        }),
      },
    });
    expect(await runFileMenuItem('reveal', row, refused.io)).toBe(false);
    expect(refused.log).toEqual([['toast', 'Switch to this tab first.']]);
    const browser = io({ doors: { revealPath: async () => ({ ok: false, reason: 'browser' }) } });
    await runFileMenuItem('reveal', row, browser.io);
    expect(browser.log[0]).toEqual([
      'toast',
      'Open this project in the Mac app to work with its files.',
    ]);
    const swap = io();
    await runFileMenuItem('open-mac-app', row, swap.io);
    expect(swap.log).toEqual([
      ['toast', 'Open this project in the Mac app to work with its files.'],
    ]);
  });
});

describe('Show file names — two-line rows', () => {
  test('a row that carries its file name is taller; the list lays out by the real heights', () => {
    const rows = [{ type: 'canvas', fileName: 'a.tsx' }, { type: 'canvas' }, { type: 'empty' }];
    expect(rowHeight(rows[0])).toBe(ROW_H_FILE);
    expect(rowHeight(rows[1])).toBe(ROW_H);
    expect(ROW_H_FILE).toBeGreaterThan(ROW_H);
    const { tops, height } = layoutRows(rows);
    expect(tops).toEqual([0, ROW_H_FILE, ROW_H_FILE + ROW_H]);
    expect(height).toBe(ROW_H_FILE + ROW_H + rowHeight(rows[2]));
  });
});

// ── the registry rows ────────────────────────────────────────────────────────────────────────────────
describe('registry — the Advanced rows', () => {
  const desktopEditor = menuCtx({ native: true, canvasOpen: true });
  const desktopCommenter = menuCtx({ native: true, canvasOpen: true, readOnly: true });
  const browserEditor = menuCtx({ native: false, canvasOpen: true });
  const def = (id: string) => {
    const d = ACTIONS_BY_ID.get(id);
    if (!d) throw new Error(`no action ${id}`);
    return d;
  };

  test('the two native doors are exec native and desktop-only', () => {
    for (const id of ['canvas.reveal-in-finder', 'canvas.open-in-editor']) {
      expect(def(id).exec).toBe('native');
      expect(isVisible(def(id), desktopEditor)).toBe(true);
      expect(isVisible(def(id), browserEditor)).toBe(false);
    }
  });

  test('a person who can only comment is not offered the doors, but can copy the path', () => {
    expect(isVisible(def('canvas.reveal-in-finder'), desktopCommenter)).toBe(false);
    expect(isVisible(def('canvas.open-in-editor'), desktopCommenter)).toBe(false);
    expect(isVisible(def('canvas.rename-file'), desktopCommenter)).toBe(false);
    expect(isVisible(def('canvas.copy-file-path'), desktopCommenter)).toBe(true);
  });

  test('they act on the OPEN canvas: greyed with none open', () => {
    const none = menuCtx({ native: true, canvasOpen: false });
    for (const id of ['canvas.reveal-in-finder', 'canvas.open-in-editor', 'canvas.copy-file-path'])
      expect(isEnabled(def(id), none)).toBe(false);
    expect(isEnabled(def('canvas.copy-file-path'), desktopEditor)).toBe(true);
  });

  test('the left panel’s switches are toggles and are there for everyone', () => {
    expect(def('canvases.show-file-names').kind).toBe('toggle');
    expect(def('layers.show-tags').kind).toBe('toggle');
    expect(isVisible(def('canvases.show-file-names'), desktopCommenter)).toBe(true);
    expect(isVisible(def('layers.select-by-selector'), desktopCommenter)).toBe(true);
  });
});

// ── rendered ─────────────────────────────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
const roots: Root[] = [];

describe('rendered', () => {
  afterEach(async () => {
    globalThis.fetch = realFetch;
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    resetViewPrefsForTest();
  });

  const q = (host: HTMLElement, id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (el: Element | null) => {
    if (!el) throw new Error('missing element');
    return act(async () => {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  };
  async function mount(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(el));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    return host;
  }
  const answer = (body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  test('Canvases › Advanced: Show file names, Folder with Copy, Design system with Open, "updated just now"', async () => {
    globalThis.fetch = answer({
      projectFolder: '/Users/iagh/Maude/alligators',
      sources: { server: { status: {} } },
    });
    const { CanvasesAdvanced } = await import('../client/v2/left-panel/canvases-advanced.jsx');
    const opened: string[] = [];
    const host = await mount(
      <CanvasesAdvanced
        open
        onToggle={() => {}}
        showHidden={false}
        onToggleHidden={() => {}}
        shown={93}
        total={93}
        trash={{ total: 12, entries: [], legacy: false }}
        onOpenTrash={() => {}}
        dsName="alligators"
        onOpenDs={(n: string) => opened.push(n)}
        onRefresh={() => {}}
      />
    );
    const sw = q(host, 'canvases-show-file-names');
    expect(sw?.getAttribute('aria-checked')).toBe('false');
    await click(sw);
    expect(sw?.getAttribute('aria-checked')).toBe('true');
    expect(getViewPref(VIEW_PREF_KEYS.fileNames)).toBe(true);
    expect(q(host, 'canvases-folder')?.textContent).toBe('/Users/iagh/Maude/alligators');
    expect(q(host, 'canvases-ds-folder')?.textContent).toBe('system/alligators');
    await click(q(host, 'canvases-ds-open'));
    expect(opened).toEqual(['alligators']);
    expect(q(host, 'canvases-count')?.textContent).toBe('93 of 93 shown');
    expect(q(host, 'canvases-updated')?.textContent).toBe('· updated just now');
  });

  test('Canvases › Advanced: no Folder row where there is no folder (the cloud)', async () => {
    const { setDiagnosticsFacts } = await import('../client/v2/diagnostics/diagnostics-bus.js');
    setDiagnosticsFacts({ folder: '' });
    globalThis.fetch = answer({ sources: { server: { status: {} } } });
    const { CanvasesAdvanced } = await import('../client/v2/left-panel/canvases-advanced.jsx');
    const host = await mount(
      <CanvasesAdvanced
        open
        onToggle={() => {}}
        showHidden={false}
        onToggleHidden={() => {}}
        shown={1}
        total={1}
        showTrash={false}
      />
    );
    expect(q(host, 'canvases-folder')).toBeNull();
    expect(q(host, 'canvases-ds-folder')).toBeNull();
  });

  test('Layers › Advanced: the switch, the counts, the element id', async () => {
    const { LayersAdvanced } = await import('../client/v2/left-panel/layers-advanced.jsx');
    const said: string[] = [];
    const clip: string[] = [];
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void clip.push(t) },
    });
    const host = await mount(
      <LayersAdvanced
        open
        onToggle={() => {}}
        artboardCount={15}
        tree={{ nodes: [{ id: 'a', children: [{ id: 'b' }] }] }}
        elementId="cd-91be07"
        toast={(m: string) => said.push(m)}
      />
    );
    expect(q(host, 'layers-counts')?.textContent).toBe('15 artboards · 2 layers');
    expect(q(host, 'layers-element-id')?.textContent).toBe('cd-91be07');
    await click(q(host, 'layers-element-id-copy'));
    expect(clip).toEqual(['cd-91be07']);
    expect(said).toEqual(['Element id copied.']);
    const sw = q(host, 'layers-show-tags');
    await click(sw);
    expect(sw?.getAttribute('aria-checked')).toBe('true');
    expect(getViewPref(VIEW_PREF_KEYS.tags)).toBe(true);
  });

  test('Select by selector: ↵ sends a good selector; invalid and over-long are refused inline, nothing sent', async () => {
    const { LayersAdvanced } = await import('../client/v2/left-panel/layers-advanced.jsx');
    const sent: string[] = [];
    const host = await mount(
      <LayersAdvanced open onToggle={() => {}} onSelectBySelector={(s: string) => sent.push(s)} />
    );
    const input = q(host, 'layers-selector') as HTMLInputElement;
    // React's own handlers, called directly (happy-dom's input/keydown path trips React's value polyfill)
    const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps$')) as string;
    const live = () =>
      (input as unknown as Record<string, Record<string, (e: unknown) => void>>)[propsKey];
    const type = async (v: string) => {
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        set?.call(input, v);
        live().onChange({ target: input, currentTarget: input });
      });
    };
    const enter = () =>
      act(async () => {
        live().onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
      });
    await type('a[[');
    await enter();
    expect(sent).toEqual([]);
    expect(q(host, 'layers-selector-error')?.textContent).toBe(SELECTOR_WORDS.invalid);
    await type('a'.repeat(SELECTOR_MAX_LEN + 1));
    await enter();
    expect(sent).toEqual([]);
    expect(q(host, 'layers-selector-error')?.textContent).toBe(SELECTOR_WORDS.long);
    await type('  section#hero a  ');
    expect(q(host, 'layers-selector-error')).toBeNull();
    await enter();
    expect(sent).toEqual(['section#hero a']);
  });

  test('Show tags and ids: a layer row prints its tag and id only while the switch is on', async () => {
    const { LayerRow } = await import('../client/inspector/layers.jsx');
    const node = {
      id: 'cd-91be07',
      index: 0,
      tag: 'section',
      type: 'frame',
      label: 'Hero',
      children: [],
    };
    const row = () => (
      <LayerRow
        node={node}
        depth={0}
        collapsed={new Set()}
        hiddenOverride={new Map()}
        onToggle={() => {}}
        onSelect={() => {}}
        onHover={() => {}}
      />
    );
    const host = await mount(row());
    expect(q(host, 'layer-tag')).toBeNull();
    await act(async () => setViewPref(VIEW_PREF_KEYS.tags, true));
    expect(q(host, 'layer-tag')?.textContent).toBe('section · cd-91be07');
  });

  // ── the panel itself: the second line, the menu's Advanced group ──
  const D = '.design';
  const PATHS = [`${D}/ui/Pricing.tsx`, `${D}/ui/Home page.tsx`];
  const groups = [
    { label: 'UI canvases', kind: 'canvas', fullPath: `${D}/ui`, paths: PATHS, dirs: [] },
  ];
  const snapshot = {
    pid: 'l0123456789abcdef',
    project: { designRel: D },
    writer: { seq: 1 },
    canvases: PATHS.map((p, i) => ({
      rel: p.slice(D.length + 1),
      kind: 'canvas',
      mtimeMs: 1000 + i,
      madeByAi: false,
      cover: null,
      artboards: [{ id: 'a', kind: 'web' }],
    })),
  };
  async function mountPanel(over: Record<string, unknown> = {}) {
    globalThis.fetch = (async (url: string) => {
      const body = String(url).startsWith('/_api/index')
        ? snapshot
        : { ok: true, pins: [], opened: {} };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const { CanvasesPanel } = await import('../client/v2/canvases/canvases-panel.jsx');
    const host = await mount(
      <CanvasesPanel
        groups={groups}
        search=""
        projectLabel="Alligators brand"
        activePath={null}
        onOpen={() => {}}
        {...over}
      />
    );
    await act(async () => new Promise((r) => setTimeout(r, 420)));
    return host;
  }
  const openMenu = async (host: HTMLElement) => {
    await click(host.querySelector('[data-testid^="tree-row-menu-"]'));
    return Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="canvas-menu-"]')).map(
      (b) => b.getAttribute('data-testid')?.slice('canvas-menu-'.length)
    );
  };
  const spacerH = (host: HTMLElement) =>
    Number((host.querySelector('.cv-spacer') as HTMLElement).style.height.replace('px', ''));

  test('Show file names: each canvas row grows a mono second line (and the list is taller)', async () => {
    const host = await mountPanel();
    expect(host.querySelectorAll('.cv-file').length).toBe(0);
    const h0 = spacerH(host);
    await act(async () => setViewPref(VIEW_PREF_KEYS.fileNames, true));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    const files = Array.from(host.querySelectorAll('.cv-file')).map((e) => e.textContent);
    expect(files.sort()).toEqual(['Home page.tsx', 'Pricing.tsx']);
    expect(spacerH(host)).toBeGreaterThan(h0);
  });

  test('the menu has no Advanced group while the fold is closed', async () => {
    const { foldStore } = await import('../client/v2/fold/use-fold.js');
    foldStore.set('left.canvases', false);
    const host = await mountPanel();
    expect(await openMenu(host)).toEqual([
      'open',
      'pin',
      'rename',
      'duplicate',
      'move',
      'copy-link',
      'trash',
    ]);
  });

  test('fold open, in the browser: Open in the Mac app · View code · Copy file path · Rename file…', async () => {
    const { foldStore } = await import('../client/v2/fold/use-fold.js');
    const { takeViewCodeRequest, resetCodeBusForTest } = await import(
      '../client/v2/code/code-bus.js'
    );
    resetCodeBusForTest();
    foldStore.set('left.canvases', true);
    try {
      const host = await mountPanel();
      expect(await openMenu(host)).toEqual([
        'open',
        'pin',
        'rename',
        'duplicate',
        'move',
        'copy-link',
        'open-mac-app',
        'view-code',
        'copy-path',
        'rename-file',
        'trash',
      ]);
      await click(document.querySelector('[data-testid="canvas-menu-view-code"]'));
      expect(takeViewCodeRequest()).toEqual({
        canvas: expect.stringMatching(/^\.design\/ui\/.+\.tsx$/),
      });
    } finally {
      foldStore.set('left.canvases', false);
    }
  });

  test('fold open, in the Mac app: Reveal in Finder takes the PROJECT-relative path', async () => {
    const { foldStore } = await import('../client/v2/fold/use-fold.js');
    foldStore.set('left.canvases', true);
    const calls: Array<[string, unknown]> = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: async (cmd: string, args: unknown) => void calls.push([cmd, args]) },
    };
    try {
      const host = await mountPanel();
      const items = await openMenu(host);
      expect(items).toContain('reveal');
      expect(items).toContain('open-editor');
      expect(items).not.toContain('open-mac-app');
      await click(document.querySelector('[data-testid="canvas-menu-reveal"]'));
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toBe('project_reveal_path');
      expect((calls[0][1] as { rel: string }).rel).toMatch(/^\.design\/ui\/.+\.tsx$/);
    } finally {
      delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
      foldStore.set('left.canvases', false);
    }
  });

  test('a read-only panel gets none of the group (Can view), even with the fold open', async () => {
    const { foldStore } = await import('../client/v2/fold/use-fold.js');
    foldStore.set('left.canvases', true);
    try {
      const host = await mountPanel({ readOnly: true });
      expect(await openMenu(host)).toEqual(['open', 'pin', 'copy-link']);
    } finally {
      foldStore.set('left.canvases', false);
    }
  });

  test('a Can comment panel keeps View code and Copy file path only', async () => {
    const { foldStore } = await import('../client/v2/fold/use-fold.js');
    foldStore.set('left.canvases', true);
    try {
      const host = await mountPanel({ readOnly: true, role: 'comment' });
      expect(await openMenu(host)).toEqual(['open', 'pin', 'copy-link', 'view-code', 'copy-path']);
    } finally {
      foldStore.set('left.canvases', false);
    }
  });
});
