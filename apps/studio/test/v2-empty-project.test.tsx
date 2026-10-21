// S6.2 — a new project with no canvases (05 es-project-new): the card on the S11.1 kit, the prompt whose ↵
// creates a canvas from the sentence, the plain way out (⌘N), no toolbar, nothing for Can view, the Canvases
// panel's own line, and the mount in the viewport.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const STUDIO = join(import.meta.dir, '..');
const src = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const load = async () => {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  return {
    React,
    createRoot,
    act,
    model: await import('../client/v2/create/use-project-empty.js'),
    card: await import('../client/v2/create/empty-project.jsx'),
    store: await import('../client/stores/shell-store.jsx'),
  };
};

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const un of mounted.splice(0)) await un();
  document.body.innerHTML = '';
});

async function mount(make: (m: Awaited<ReturnType<typeof load>>) => JSX.Element) {
  const m = await load();
  const host = document.createElement('div');
  document.body.append(host);
  const root = m.createRoot(host);
  await m.act(async () => root.render(make(m)));
  mounted.push(() => m.act(async () => root.unmount()));
  return { ...m, host };
}

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const q = (host: Element, id: string) => host.querySelector(`[data-testid="${id}"]`);

/** A fetch that answers the create route and remembers the bodies. */
function createFetch(file = '.design/ui/a-one-page-portfolio.tsx') {
  const bodies: unknown[] = [];
  const fn = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') bodies.push(JSON.parse(String(init.body ?? '{}')));
    return { ok: true, status: 200, json: async () => ({ ok: true, file }) } as Response;
  }) as unknown as typeof fetch;
  return { fn, bodies };
}

const empty = { project: 'Portfolio 2026', canCreate: true };

async function typeInto(
  act: (f: () => Promise<void>) => Promise<void>,
  input: HTMLInputElement,
  v: string
) {
  await act(async () => {
    // the node's own prototype and window: other files in the same process register their own DOM
    const win = input.ownerDocument.defaultView as unknown as typeof globalThis;
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    set?.call(input, v);
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  });
}
async function pressEnter(act: (f: () => Promise<void>) => Promise<void>, el: Element) {
  await act(async () => {
    const win = el.ownerDocument.defaultView as unknown as typeof globalThis;
    el.dispatchEvent(
      new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });
}

describe('projectEmptyModel', () => {
  test('a loaded project with no canvases and no tab open is the empty one', async () => {
    const { model } = await load();
    expect(
      model.projectEmptyModel({ groups: [], treeLoaded: true, project: 'Portfolio 2026' })
    ).toEqual(empty);
  });

  test('not known yet, a canvas in the tree, or a tab open: nothing', async () => {
    const { model } = await load();
    const group = {
      kind: 'canvas',
      label: 'UI',
      fullPath: '.design/ui',
      paths: ['.design/ui/Home.tsx'],
      dirs: [],
    };
    expect(model.projectEmptyModel({ groups: [], treeLoaded: false })).toBeNull();
    expect(model.projectEmptyModel({ groups: [group], treeLoaded: true })).toBeNull();
    expect(model.projectEmptyModel({ groups: [], treeLoaded: true, tabCount: 1 })).toBeNull();
  });

  test('the design system and project files are not canvases', async () => {
    const { model } = await load();
    const ds = {
      kind: 'canvas',
      label: 'Design system',
      fullPath: '.design/system',
      paths: ['.design/system/Kit.tsx'],
      dirs: [],
    };
    const files = {
      kind: 'files',
      label: 'Project',
      fullPath: 'src',
      paths: ['src/a.tsx'],
      dirs: [],
    };
    expect(model.projectEmptyModel({ groups: [ds, files], treeLoaded: true })?.canCreate).toBe(
      true
    );
  });

  test('Can view cannot create', async () => {
    const { model } = await load();
    expect(
      model.projectEmptyModel({ groups: [], treeLoaded: true, viewerMode: true })?.canCreate
    ).toBe(false);
  });
});

describe('EmptyProject', () => {
  test('05 es-project-new: the situation, the next step, the prompt and the plain way out', async () => {
    const { host } = await mount(({ React, card }) =>
      React.createElement(card.EmptyProject, { model: empty })
    );
    const block = q(host, 'empty-project');
    expect(text(block?.querySelector('.es-sit') ?? null)).toBe(
      'Portfolio 2026 has no canvases yet.'
    );
    expect(text(block?.querySelector('.es-next') ?? null)).toBe(
      'Describe the first one and AI drafts it — or start blank.'
    );
    const input = q(host, 'empty-project-prompt') as HTMLInputElement;
    expect(input.placeholder).toBe('A one-page portfolio with six projects, calm and light');
    const blank = q(host, 'empty-project-blank') as HTMLButtonElement;
    expect(text(blank)).toBe('Start with an empty canvas⌘N');
    // the kit's own block: the spot art is the AI one, and there is at most one action
    expect(block?.querySelectorAll('.es-acts > *').length).toBe(1);
  });

  test('no toolbar: there is nothing to draw on yet', async () => {
    const { host } = await mount(({ React, card }) =>
      React.createElement(card.EmptyProject, { model: empty })
    );
    expect(host.querySelector('[role="toolbar"], [data-testid*="toolbar"], .toolbar')).toBeNull();
  });

  test('↵ in the prompt creates a canvas from the sentence: the create call carries fromPrompt', async () => {
    const f = createFetch();
    const opened: string[] = [];
    const { host, act } = await mount(({ React, card }) =>
      React.createElement(card.EmptyProject, {
        model: empty,
        deps: { fetchImpl: f.fn, open: (file: string) => opened.push(file) },
      })
    );
    const input = q(host, 'empty-project-prompt') as HTMLInputElement;
    await typeInto(act, input, '  A one-page portfolio,   six projects ');
    await pressEnter(act, input);
    expect(f.bodies).toEqual([{ kind: 'blank', fromPrompt: 'A one-page portfolio, six projects' }]);
    expect(opened).toEqual(['.design/ui/a-one-page-portfolio.tsx']);
  });

  test('↵ on nothing makes nothing; the send button is the same door as ↵', async () => {
    const f = createFetch();
    const { host, act } = await mount(({ React, card }) =>
      React.createElement(card.EmptyProject, {
        model: empty,
        deps: { fetchImpl: f.fn, open: () => {} },
      })
    );
    const input = q(host, 'empty-project-prompt') as HTMLInputElement;
    await pressEnter(act, input);
    expect(f.bodies).toEqual([]);
    await typeInto(act, input, 'Three logo ideas');
    await act(async () => (q(host, 'empty-project-send') as HTMLButtonElement).click());
    expect(f.bodies).toEqual([{ kind: 'blank', fromPrompt: 'Three logo ideas' }]);
  });

  test('"Start with an empty canvas" makes a blank one, no sentence', async () => {
    const f = createFetch();
    const { host, act } = await mount(({ React, card }) =>
      React.createElement(card.EmptyProject, {
        model: empty,
        deps: { fetchImpl: f.fn, open: () => {} },
      })
    );
    await act(async () => (q(host, 'empty-project-blank') as HTMLButtonElement).click());
    expect(f.bodies).toEqual([{ kind: 'blank' }]);
  });

  test('Can view: the situation only — no prompt, no send, no button', async () => {
    const { host } = await mount(({ React, card }) =>
      React.createElement(card.EmptyProject, {
        model: { project: 'Portfolio 2026', canCreate: false },
      })
    );
    expect(text(q(host, 'empty-project')?.querySelector('.es-sit') ?? null)).toBe(
      'Portfolio 2026 has no canvases yet.'
    );
    expect(q(host, 'empty-project-prompt')).toBeNull();
    expect(q(host, 'empty-project-send')).toBeNull();
    expect(q(host, 'empty-project-blank')).toBeNull();
    expect(host.querySelector('.es-next')).toBeNull();
  });
});

describe('EmptyProjectSlot (the viewport mount)', () => {
  const core = (over: Record<string, unknown> = {}) => ({
    shellCore: {
      groups: [],
      treeLoaded: true,
      treeLoadFailures: 0,
      tabs: [],
      project: 'Portfolio 2026',
      viewerMode: false,
      ...over,
    },
  });

  test('0 canvases: the card replaces the v1 "No canvas open" placeholder', async () => {
    const { host } = await mount(({ React, card, store }) =>
      React.createElement(
        store.ShellStoreContext.Provider,
        { value: core() },
        React.createElement(card.EmptyProjectSlot, null, React.createElement('i', { id: 'v1' }))
      )
    );
    expect(q(host, 'empty-project')).not.toBeNull();
    expect(host.querySelector('#v1')).toBeNull();
  });

  test('a project with canvases, or no shell store at all, keeps the placeholder', async () => {
    const group = {
      kind: 'canvas',
      label: 'UI',
      fullPath: '.design/ui',
      paths: ['.design/ui/Home.tsx'],
      dirs: [],
    };
    const withCanvas = await mount(({ React, card, store }) =>
      React.createElement(
        store.ShellStoreContext.Provider,
        { value: core({ groups: [group] }) },
        React.createElement(card.EmptyProjectSlot, null, React.createElement('i', { id: 'v1' }))
      )
    );
    expect(withCanvas.host.querySelector('#v1')).not.toBeNull();
    expect(q(withCanvas.host, 'empty-project')).toBeNull();
    const bare = await mount(({ React, card }) =>
      React.createElement(card.EmptyProjectSlot, null, React.createElement('i', { id: 'v1' }))
    );
    expect(bare.host.querySelector('#v1')).not.toBeNull();
  });

  test('while the tree is loading the card does not flash, and a failed load shows the placeholder', async () => {
    const loading = await mount(({ React, card, store }) =>
      React.createElement(
        store.ShellStoreContext.Provider,
        { value: core({ treeLoaded: false }) },
        React.createElement(card.EmptyProjectSlot, null, React.createElement('i', { id: 'v1' }))
      )
    );
    expect(loading.host.innerHTML).toBe('');
    const failed = await mount(({ React, card, store }) =>
      React.createElement(
        store.ShellStoreContext.Provider,
        { value: core({ treeLoaded: false, treeLoadFailures: 2 }) },
        React.createElement(card.EmptyProjectSlot, null, React.createElement('i', { id: 'v1' }))
      )
    );
    expect(failed.host.querySelector('#v1')).not.toBeNull();
  });
});

describe('the Canvases panel line', () => {
  async function mountPanel(over: Record<string, unknown> = {}) {
    const fetchImpl = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    return mount(({ React }) => {
      const { CanvasesPanel } = panelMod;
      return React.createElement(CanvasesPanel, {
        groups: [],
        projectLabel: 'Portfolio 2026',
        onOpen: () => {},
        fetchImpl,
        ...over,
      });
    });
  }
  let panelMod: typeof import('../client/v2/canvases/canvases-panel.jsx');
  beforeAll(async () => {
    panelMod = await import('../client/v2/canvases/canvases-panel.jsx');
  });

  test('"No canvases yet." through the kit, a New canvas row, and the foot that explains folders', async () => {
    const f = createFetch();
    const { host, act } = await mountPanel({ fetchImpl: f.fn });
    const block = q(host, 'canvases-none');
    expect(text(block?.querySelector('.es-sit') ?? null)).toBe('No canvases yet.');
    expect(text(block?.querySelector('.es-next') ?? null)).toBe(
      'Each canvas holds as many artboards as you like.'
    );
    expect(text(q(host, 'canvases-foot'))).toBe('Folders appear when you make one.');
    expect(text(q(host, 'canvases-none-new'))).toBe('New canvas');
    await act(async () => (q(host, 'canvases-none-new') as HTMLButtonElement).click());
    expect(f.bodies.at(-1)).toEqual({ kind: 'blank' });
  });

  test('Can view: the line is there, the New canvas row is not', async () => {
    const { host } = await mountPanel({ readOnly: true });
    expect(text(q(host, 'canvases-none')?.querySelector('.es-sit') ?? null)).toBe(
      'No canvases yet.'
    );
    expect(q(host, 'canvases-none-new')).toBeNull();
  });
});

describe('where it is mounted, and what stays true', () => {
  test('the viewport renders the slot around the v1 placeholder', () => {
    const v = src('client/shell/viewport.jsx');
    expect(v).toContain("import { EmptyProjectSlot } from '../v2/create/empty-project.jsx'");
    expect(v).toContain('<EmptyProjectSlot>');
    expect(v).toContain('No canvas open'); // the placeholder is still the fallback
  });

  test('the shell store hands the slot every field it reads (gate-b-polish2: without them the centre was blank)', () => {
    const app = src('client/app.jsx');
    const start = app.indexOf('const shellStore = {');
    const core = app.slice(app.indexOf('shellCore: {', start), app.indexOf('    local: {', start));
    const keys = new Set(core.match(/^\s{6}([A-Za-z]\w*),$/gm)?.map((l) => l.trim().slice(0, -1)));
    for (const k of ['groups', 'treeLoaded', 'treeLoadFailures', 'tabs', 'viewerMode', 'project'])
      expect(keys.has(k)).toBe(true);
  });

  test('every copy line is the kit table’s (es-project-new ids), not a string of ours', () => {
    const s = src('client/v2/create/empty-project.jsx');
    expect(s).toContain("'es-project-new.project-none'");
    expect(s).toContain("'es-project-new.panel-none'");
  });

  test('Share cluster: a project nothing links reads Local project', async () => {
    const { saveStatus } = await import('../client/v2/shell/save-status.js');
    const s = saveStatus({
      linked: false,
      online: true,
      phase: null,
      pending: 0,
      writeFailed: null,
    });
    expect(s.word).toBe('Local project');
  });

  test('the testids are in the contract', () => {
    const ids = JSON.parse(src('client/testids.json')).map((e: { hook: string }) => e.hook);
    const md = src('client/TESTIDS.md');
    for (const id of [
      'empty-project',
      'empty-project-prompt',
      'empty-project-send',
      'empty-project-blank',
      'canvases-none',
      'canvases-none-new',
    ]) {
      expect(ids).toContain(id);
      expect(md).toContain(`\`${id}\``);
    }
  });
});
