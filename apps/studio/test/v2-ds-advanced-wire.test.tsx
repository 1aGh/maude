// S10.19 — the wiring around Design system › Advanced: the three registry actions and their runners, the host that
// reads and writes through the routes, the inspector's empty place drawing the panel, and what the buttons do (Check
// runs and says the outcome, Show goes to the token, Hand off opens the sheet, Reveal asks the Mac app, Restore opens
// Version history, Ask AI fills the composer and never sends).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AGENT_PATHS as ACTION_AGENTS } from '../actions/agents.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { onDsAdvancedRequest, resetDsAdvancedBus } from '../client/v2/ds/advanced-bus.js';
import { getAdvanced, getAdvancedActions, resetAdvanced } from '../client/v2/ds/advanced-store.js';
import { createMenuHandlers, menuRunner } from '../client/v2/shell/menu-runner.js';

const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'studio', path: 'system/studio' }],
  dsConverted: { studio: true },
};
const FILES = {
  format: 'maude.ds-system-files',
  v: 1,
  ds: 'studio',
  folder: 'system/studio/',
  css: { file: 'colors_and_type.css', present: true, text: ':root {}' },
  json: { file: 'tokens.json', present: false, text: '' },
  files: [{ kind: 'folder', names: ['system/studio/'], depth: 0 }],
  history: [],
  converted: true,
};
const CHECK = {
  format: 'maude.ds-system-check',
  v: 1,
  ds: 'studio',
  at: new Date().toISOString(),
  lines: [
    {
      id: 'contrast',
      ok: false,
      title: 'Contrast',
      text: '41 of 42 text pairs pass, Light and Dark',
    },
    {
      id: 'pair',
      ok: false,
      title: 'Quiet on Well',
      text: 'Dark: 4.2:1 — large text only',
      show: '--fg-3',
    },
  ],
};

type Call = { method: string; url: string; body: Record<string, unknown> | null };
function fakeFetch(o: { run?: { status: number; body: unknown } } = {}) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : null });
    const json = (status: number, b: unknown) =>
      ({ ok: status < 400, status, json: async () => b }) as Response;
    if (url.startsWith('/_api/ds/system-files')) return json(200, FILES);
    if (url.startsWith('/_api/ds/board'))
      return json(200, {
        format: 'maude.ds-board',
        label: 'Studio site',
        canvases: 5,
        themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
      });
    if (method === 'GET' && url.startsWith('/_api/ds/check-system'))
      return json(200, { format: 'maude.ds-system-check-last', ds: 'studio', check: null });
    if (method === 'POST' && url === '/_api/ds/check-system')
      return json(o.run?.status ?? 200, o.run?.body ?? CHECK);
    return json(404, {});
  };
  return { calls, impl: impl as unknown as typeof fetch };
}

describe('the registry', () => {
  test('ds.check-system (cli, Can edit), ds.handoff-tokens (the files) and ds.reveal-files (the Mac app)', () => {
    for (const id of ['ds.check-system', 'ds.handoff-tokens', 'ds.reveal-files'])
      expect(ACTIONS_BY_ID.has(id), id).toBe(true);
    expect(ACTION_AGENTS['ds.check-system']).toMatchObject({
      effect: 'none',
      minRole: 'edit',
      server: { route: '/_api/ds/check-system', method: 'POST' },
      agent: { path: 'cli', verb: expect.stringContaining('maude design ds check-system') },
    });
    expect(ACTION_AGENTS['ds.handoff-tokens']?.agent).toMatchObject({
      path: 'file',
      format: 'tokens',
    });
    expect(ACTION_AGENTS['ds.reveal-files']?.agent).toMatchObject({
      path: 'human',
      because: 'native-window',
    });
    // a browser tab has no Finder
    expect(ACTIONS_BY_ID.get('ds.reveal-files')?.visible?.shell).toEqual(['desktop']);
    // the system's own menu (S10.13) lights its "Check the system" row now that the action exists
    expect(ACTIONS_BY_ID.get('ds.check-system')?.label).toBe('Check the system');
  });

  test('the runner map: check and reveal ask the host; hand off opens the sheet on the tokens target', () => {
    const got: Array<Record<string, unknown>> = [];
    resetDsAdvancedBus();
    onDsAdvancedRequest((r: Record<string, unknown>) => got.push(r));
    const sheets: unknown[] = [];
    const h = createMenuHandlers({ setExportDialog: (x: unknown) => sheets.push(x) } as never);
    h['ds.check-system']?.({ ds: 'studio' });
    h['ds.reveal-files']?.({ ds: 'studio' });
    h['ds.handoff-tokens']?.({ ds: 'studio' });
    expect(got).toEqual([
      { kind: 'check', ds: 'studio' },
      { kind: 'reveal', ds: 'studio' },
    ]);
    expect(sheets).toEqual([{ mode: 'handoff', target: 'tokens', ds: 'studio' }]);
    resetDsAdvancedBus();
  });
});

describe('the mounts', () => {
  test('the inspector’s empty place draws the panel beside the truth cards; the host rides on the review host', () => {
    const panel = readFileSync(
      new URL('../client/inspector/inspector-panel.jsx', import.meta.url),
      'utf8'
    );
    expect(panel).toContain("from '../v2/ds/advanced.jsx'");
    expect(panel).toMatch(
      /!el && !\(effTab === 'layers' && layersTree\?\.nodes\?\.length\) && \(dsTruth \|\| dsSystem\)/
    );
    const host = readFileSync(new URL('../client/v2/ds/review-host.jsx', import.meta.url), 'utf8');
    expect(host).toContain('<DsAdvancedHost');
    const css = readFileSync(new URL('../client/styles/_index.css', import.meta.url), 'utf8');
    expect(css).toContain('v2/ds/advanced.css');
  });
});

describe('the host', () => {
  const roots: Root[] = [];
  let Host: (p: Record<string, unknown>) => JSX.Element | null;
  const sent: Array<[string, unknown]> = [];
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    Host = (await import('../client/v2/ds/advanced-host.jsx')).DsAdvancedHost as never;
  });
  afterAll(() => GlobalRegistrator.unregister());
  beforeEach(() => {
    resetDsAdvancedBus();
    resetAdvanced();
    sent.length = 0;
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = undefined;
    menuRunner.unbind(handlersRef.current);
  });
  const handlersRef: { current: Record<string, unknown> } = { current: {} };

  async function mount(
    f: ReturnType<typeof fakeFetch>,
    toasts: string[],
    activePath: string | null
  ) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push(root);
    await act(async () =>
      root.render(
        <Host
          cfg={CFG}
          activePath={activePath}
          toast={(m: string) => toasts.push(m)}
          fetchImpl={f.impl}
          pollMs={60_000}
        />
      )
    );
    await act(async () => new Promise((r) => setTimeout(r, 40)));
  }
  const handlers = (extra: Record<string, unknown> = {}) => {
    handlersRef.current = createMenuHandlers({
      toggleRightPanel: (p: string) => sent.push(['panel', p]),
      setExportDialog: (x: unknown) => sent.push(['sheet', x]),
      onDsGoTo: (p: unknown) => sent.push(['go-to', p]),
      ...extra,
    } as never) as never;
    menuRunner.bind(handlersRef.current as never, {});
  };

  test('with the system’s own canvas open the store holds what the routes served; with another canvas, nothing', async () => {
    const f = fakeFetch();
    await mount(f, [], '.design/system/studio/design-system.tsx');
    expect(getAdvanced()).toMatchObject({
      ds: 'studio',
      label: 'Studio site',
      canvases: 5,
      native: false,
      files: { folder: 'system/studio/' },
      check: null,
    });
    expect(f.calls.some((c) => c.url === '/_api/ds/system-files?ds=studio')).toBe(true);
    await act(async () => void 0);
    resetAdvanced();
    await mount(fakeFetch(), [], '.design/ui/Home.tsx');
    expect(getAdvanced()).toBeNull();
  });

  test('Check runs the route, keeps the card in the panel and says the first thing that is not well', async () => {
    const f = fakeFetch();
    const toasts: string[] = [];
    await mount(f, toasts, '.design/system/studio/design-system.tsx');
    const acts = getAdvancedActions() as unknown as Record<string, () => unknown>;
    await act(async () => void (await acts.check?.()));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(f.calls).toContainEqual({
      method: 'POST',
      url: '/_api/ds/check-system',
      body: { ds: 'studio' },
    });
    expect((getAdvanced() as { check: { ds: string } }).check.ds).toBe('studio');
    expect((getAdvanced() as { busy: boolean }).busy).toBe(false);
    expect(toasts).toEqual(['Contrast: 41 of 42 text pairs pass, Light and Dark']);

    // the panel's other buttons go through the runner
    handlers();
    await act(async () => void acts.show?.('--fg-3'));
    await act(async () => void acts.handoff?.());
    await act(async () => void acts.history?.());
    expect(sent).toEqual([
      ['go-to', { ds: 'studio', token: '--fg-3' }],
      ['sheet', { mode: 'handoff', target: 'tokens', ds: 'studio' }],
      ['panel', 'changes'],
    ]);
  });

  test('a refused check is the person’s words in the panel, not a toast and not a stored card', async () => {
    const f = fakeFetch({ run: { status: 403, body: { code: 'forbidden', error: 'no' } } });
    const toasts: string[] = [];
    await mount(f, toasts, '.design/system/studio/design-system.tsx');
    const acts = getAdvancedActions() as unknown as Record<string, () => unknown>;
    await act(async () => void (await acts.check?.()));
    await act(async () => new Promise((x) => setTimeout(x, 20)));
    expect(getAdvanced()).toMatchObject({
      busy: false,
      note: 'You can’t check this design system.',
      check: null,
    });
    expect(toasts).toEqual([]);
  });

  test('a check asked for from a system’s own menu says the outcome and goes to that system', async () => {
    const f = fakeFetch();
    const toasts: string[] = [];
    handlers();
    await mount(f, toasts, '.design/ui/Home.tsx'); // another canvas is open
    const { requestDsAdvanced } = await import('../client/v2/ds/advanced-bus.js');
    await act(async () => void requestDsAdvanced({ kind: 'check', ds: 'studio' }));
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(f.calls).toContainEqual({
      method: 'POST',
      url: '/_api/ds/check-system',
      body: { ds: 'studio' },
    });
    expect(toasts).toEqual(['Contrast: 41 of 42 text pairs pass, Light and Dark']);
    expect(sent).toContainEqual(['go-to', { ds: 'studio' }]);
  });

  test('Reveal in Finder asks the Mac app for the folder; in a tab with no Mac app it says so', async () => {
    const f = fakeFetch();
    const toasts: string[] = [];
    const invoked: Array<[string, unknown]> = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: async (cmd: string, args: unknown) => void invoked.push([cmd, args]) },
    };
    await mount(f, toasts, '.design/system/studio/design-system.tsx');
    expect((getAdvanced() as { native: boolean }).native).toBe(true);
    const { requestDsAdvanced } = await import('../client/v2/ds/advanced-bus.js');
    await act(async () => void requestDsAdvanced({ kind: 'reveal', ds: 'studio' }));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(invoked).toEqual([['project_reveal_path', { rel: '.design/system/studio' }]]);
    // no Mac app
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = undefined;
    await act(async () => void requestDsAdvanced({ kind: 'reveal', ds: 'studio' }));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(toasts).toEqual(['Open this project in the Mac app to work with its files.']);
  });
});
