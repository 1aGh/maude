// S11.13 — Settings › Advanced (06 ad-settings, ad-edge-remember), Reset, remembered folds, C34.
//
// 1. The model: every 06 row is carried; the two C34 rows are not; the helper lines say what 06 says.
// 2. The section, rendered: This Mac (Runtime, port), Claude Code (Plugins, own copy), Decision memory,
//    Privacy, Experimental, Reset — each switch writes its prefs.json field, nothing else.
// 3. Reset: panel layout, Close all, the per-fold switch list, and Reset all settings… behind a dialog
//    titled with its verb. No test touches the real keychain or prefs file (fetch and Tauri are stubs).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { FOLD_PANELS } from '../client/v2/fold/fold-store.js';
import { createAdvancedPrefs } from '../client/v2/settings/advanced-prefs.js';
import { createSettingsHandlers } from '../client/v2/settings/settings-handlers.js';
import {
  ABSENT_ROW_LABELS,
  decisionMemoryLine,
  FOLD_LABELS,
  foldRows,
  pluginsLine,
  REPORT_LOGS_CHOICES,
  reportLogsConsent,
  reportLogsPolicy,
  resetAllPlan,
  resetPanelLayoutPlan,
  runtimeLine,
  SETTINGS_ROWS,
} from '../client/v2/settings/settings-model.js';

// ── the model (pure) ────────────────────────────────────────────────────────────────────────────

describe('the model carries 06 ad-settings', () => {
  const ids = SETTINGS_ROWS.filter((r) => r.section === 'advanced').map((r) => r.testid);

  test('every Advanced row 06 draws has a home, a testid and a where', () => {
    for (const want of [
      'settings-app-version',
      'settings-update-restart',
      'settings-server-port',
      'settings-runtime',
      'settings-server-build',
      'settings-keys-store',
      'settings-plugins',
      'settings-own-plugin-copy',
      'settings-claude-autosetup',
      'settings-copy-draw',
      'settings-copy-brand',
      'settings-decision-memory',
      'settings-transcription',
      'settings-keyframes',
      'settings-report-logs',
      'sync-setting-syncFiles',
      'sync-ownership-adopt',
      'settings-experimental-teams',
      'settings-reset-panel-layout',
      'settings-reset-folds',
      'settings-reset-all',
      'settings-fold-<id>',
    ])
      expect(ids, want).toContain(want);
    for (const r of SETTINGS_ROWS.filter((x) => x.section === 'advanced'))
      expect(r.where?.startsWith('Settings › Advanced'), r.testid).toBe(true);
  });

  test('C34: no row for usage data or "Faster canvas engine" — not hidden, not disabled, absent', () => {
    expect(ABSENT_ROW_LABELS).toEqual(['Send anonymous usage data', 'Faster canvas engine']);
    for (const r of SETTINGS_ROWS) {
      expect(r.testid).not.toMatch(/usage|telemetry|analytics|canvas-engine|faster/i);
      expect(r.where ?? '').not.toMatch(/usage data|Faster canvas engine/i);
    }
  });

  test('the new actions are named on their rows', () => {
    const act = (id: string) => SETTINGS_ROWS.find((r) => r.testid === id)?.action;
    expect(act('settings-reset-panel-layout')).toBe('settings.reset-panel-layout');
    expect(act('settings-reset-all')).toBe('settings.reset-all');
    expect(act('settings-own-plugin-copy')).toBe('settings.use-own-plugin-copy');
    expect(act('settings-experimental-teams')).toBe('settings.experimental-teams');
  });
});

describe('the words', () => {
  test('Decision memory: a count from the graph, else "Not set up" — never a guess', () => {
    expect(decisionMemoryLine({ active: true, decisions: 523, engine: 'kgai' })).toBe(
      '523 decisions · kgai'
    );
    expect(decisionMemoryLine({ active: true, decisions: 1, engine: 'kgai' })).toBe(
      '1 decision · kgai'
    );
    expect(decisionMemoryLine({ active: true, decisions: 0, engine: 'kgai' })).toBe(
      '0 decisions · kgai'
    );
    for (const s of [
      null,
      undefined,
      {},
      { active: false, decisions: null },
      { active: false, decisions: 5 }, // a stale count behind an inactive graph is not shown
      { active: true },
    ])
      expect(decisionMemoryLine(s as never)).toBe('Not set up');
  });

  test('Runtime reads "Bun x · built in"; no answer is a dash', () => {
    expect(runtimeLine({ runtime: 'Bun 1.3.4' })).toBe('Bun 1.3.4 · built in');
    expect(runtimeLine(null)).toBe('—');
  });

  test('Plugins: "design 2.0.0 · flow 2.0.0", or null when the bundle ships none', () => {
    expect(
      pluginsLine({
        plugins: [
          { name: 'design', version: '2.0.0' },
          { name: 'flow', version: '2.0.0' },
        ],
      })
    ).toBe('design 2.0.0 · flow 2.0.0');
    expect(pluginsLine({ plugins: [] })).toBeNull();
    expect(pluginsLine(null)).toBeNull();
  });

  test('Logs in bug reports: Ask each time · Always · Never; absent or odd = ask', () => {
    expect(REPORT_LOGS_CHOICES.map((c) => c.label)).toEqual(['Ask each time', 'Always', 'Never']);
    expect(reportLogsPolicy({ reportLogs: 'always' })).toBe('always');
    expect(reportLogsPolicy({ reportLogs: 'never' })).toBe('never');
    expect(reportLogsPolicy({ reportLogs: 'sometimes' })).toBe('ask');
    expect(reportLogsPolicy(undefined)).toBe('ask');
  });

  // A6c — what Report a bug does with the policy. Ask each time keeps today's dialog (the log
  // rows offered, ticked — the preview IS the consent); Never offers no log row and sends none.
  test('Report a bug reads the policy: never offers no log row; ask and always offer it ticked', () => {
    expect(reportLogsConsent('ask')).toEqual({ offer: true, on: true });
    expect(reportLogsConsent('always')).toEqual({ offer: true, on: true });
    expect(reportLogsConsent('never')).toEqual({ offer: false, on: false });
    const src = readFileSync(join(import.meta.dir, '..', 'client', 'report-bug.jsx'), 'utf8');
    expect(src).toContain('reportLogsConsent(reportLogsPolicy(');
  });
});

describe('the per-fold switch list = FOLD_PANELS ∪ remembered ids', () => {
  test('FOLD_PANELS carries every panel 06 draws a fold in, and keeps ai.chat', () => {
    for (const id of [
      'left.canvases',
      'left.layers',
      'inspector',
      'history',
      'code',
      'connections',
      'ai',
      'ai.chat',
      'share',
      'timeline',
      'export',
      'ds',
      'settings',
      'diagnostics',
      'help',
    ])
      expect(FOLD_PANELS, id).toContain(id);
  });

  test('every listed panel has a person-words label, and a later id gets one too', () => {
    for (const id of FOLD_PANELS) expect(FOLD_LABELS[id], id).toMatch(/ › Advanced$/);
    const rows = foldRows([...FOLD_PANELS, 'future.panel', 'inspector']);
    expect(rows.length).toBe(FOLD_PANELS.length + 1);
    expect(rows.at(-1)).toEqual({ id: 'future.panel', label: 'future.panel › Advanced' });
  });
});

describe('the reset plans', () => {
  test('Reset panel layout moves back only what moved, and writes the layout in one patch', () => {
    const plan = resetPanelLayoutPlan({
      panelSide: { tree: 'right', inspector: 'right', layers: 'left' },
      layersMode: 'in-inspector',
    });
    expect(plan.sideCalls).toEqual([['tree', 'left']]);
    expect(plan.layersModeCall).toBe('separate');
    expect(plan.patch).toEqual({
      panelSides: {
        tree: 'left',
        layers: 'left',
        inspector: 'right',
        comments: 'right',
        changes: 'right',
        assistant: 'right',
      },
      layersMode: 'separate',
      pin: { on: false },
      panelsHidden: false,
    });
    expect(resetPanelLayoutPlan({ panelSide: {}, layersMode: 'separate' }).sideCalls).toEqual([]);
  });

  test('Reset all settings covers the look, shortcuts, layout and the AI switches — not keys or sync', () => {
    const plan = resetAllPlan(
      {
        theme: 'light',
        minimapVisible: true,
        zoomCtlVisible: false,
        annotationsVisible: false,
        autoOpenInspector: true,
        panelSide: {},
        layersMode: 'separate',
      },
      ['inspector', 'left.canvases']
    );
    expect(plan.toggles).toEqual([
      ['onSetTheme', 'dark'],
      ['onToggleMinimap'],
      ['onToggleAnnotations'],
    ]);
    expect(plan.foldIds).toEqual(['inspector', 'left.canvases']);
    expect(Object.keys(plan.patch).sort()).toEqual(
      [
        'annotations',
        'autoOpenInspector',
        'canvases',
        'experimentalTeams',
        'layersMode',
        'minimap',
        'ownPluginCopy',
        'panelSides',
        'panelsHidden',
        'pin',
        'reportLogs',
        'singleKeyShortcuts',
        'theme',
        'zoom',
      ].sort()
    );
    // nothing about keys, sign-ins, sync or what has been seen
    const text = JSON.stringify(plan.patch);
    expect(text).not.toMatch(/seen|key"|token|hub|sync/i);
  });
});

// ── the section, rendered ───────────────────────────────────────────────────────────────────────

type Call = { url: string; method: string; body?: string };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

const ROUTES: Record<string, unknown> = {
  '/_api/settings/about': {
    runtime: 'Bun 1.3.4',
    plugins: [
      { name: 'design', version: '2.0.0' },
      { name: 'flow', version: '2.0.0' },
    ],
  },
  '/_api/kg/summary': { active: true, decisions: 523, engine: 'kgai' },
  '/_api/ui-prefs': {},
  '/_api/generate/providers': { providers: [] },
  '/_api/generate/prefs': {},
  '/_api/generate/whisper-model': { models: [] },
  '/_api/generate/keyframe-model': { models: [] },
  '/_api/sync/settings': {
    ok: true,
    settings: { syncFiles: true, propagateDeletes: false, resolveFirstAnchor: 'ask' },
  },
  '/_api/sync/ownership': { mode: 'repo-owned', git: true, linked: true, trackedCount: 3 },
};
function installFetch(over: Record<string, unknown> = {}) {
  calls = [];
  const routes = { ...ROUTES, ...over };
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    return new Response(JSON.stringify(key ? routes[key] : { ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
}
const prefWrites = () =>
  calls
    .filter((c) => c.url.startsWith('/_api/ui-prefs') && c.method === 'POST')
    .map((c) => JSON.parse(c.body ?? '{}') as Record<string, unknown>);

let SettingsSheet: (props: Record<string, unknown>) => React.ReactElement;
let foldStore: typeof import('../client/v2/fold/use-fold.js').foldStore;
let advancedPrefs: typeof import('../client/v2/settings/use-advanced-prefs.js').advancedPrefs;
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  SettingsSheet = (await import('../client/v2/settings/settings-sheet.jsx'))
    .default as unknown as typeof SettingsSheet;
  foldStore = (await import('../client/v2/fold/use-fold.js')).foldStore;
  advancedPrefs = (await import('../client/v2/settings/use-advanced-prefs.js')).advancedPrefs;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(() => {
  installFetch();
  try {
    localStorage.clear();
  } catch {}
  foldStore.reset();
  advancedPrefs.reset();
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
const change = (el: HTMLElement | null, value: string) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    (el as HTMLSelectElement).value = value;
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
};

const noop = () => {};
function props(over: Record<string, unknown> = {}) {
  return {
    cloud: null,
    theme: 'dark',
    onSetTheme: noop,
    cpMode: 'advanced',
    onSetCpMode: noop,
    minimapVisible: false,
    onToggleMinimap: noop,
    zoomCtlVisible: false,
    onToggleZoomCtl: noop,
    annotationsVisible: true,
    onToggleAnnotations: noop,
    autoOpenInspector: true,
    onToggleAutoOpenInspector: noop,
    hasCanvas: true,
    panelSide: {},
    onSetPanelSide: noop,
    layersMode: 'separate',
    onSetLayersMode: noop,
    onLinkedHub: noop,
    onLocalProject: noop,
    onClose: noop,
    initialTab: 'advanced',
    ...over,
  };
}
async function mount(over: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<SettingsSheet {...props(over)} />));
  await settle(80);
}

describe('Settings › Advanced, rendered', () => {
  test('This Mac and Claude Code: runtime, port, plugins, own copy', async () => {
    await mount();
    expect(q('settings-runtime')?.textContent).toContain('Bun 1.3.4 · built in');
    expect(q('settings-server-port')).toBeTruthy();
    expect(q('settings-server-port')?.querySelector('input')).toBeNull(); // display only
    expect(q('settings-keys-store')?.textContent).toContain('macOS Keychain');
    expect(q('settings-plugins')?.textContent).toContain('design 2.0.0 · flow 2.0.0');
    const own = q('settings-own-plugin-copy')?.querySelector('input') as HTMLInputElement;
    expect(own.checked).toBe(false);
  });

  test('Decision memory shows the graph’s count — or "Not set up"', async () => {
    await mount();
    expect(q('settings-decision-memory')?.textContent).toContain('523 decisions · kgai');
    document.body.innerHTML = '';
    installFetch({ '/_api/kg/summary': { active: false, decisions: null, engine: 'kgai' } });
    await mount();
    expect(q('settings-decision-memory')?.textContent).toContain('Not set up');
  });

  test('C34: neither the usage-data switch nor "Faster canvas engine" is on screen', async () => {
    await mount();
    const text = q('settings-panel-advanced')?.textContent ?? '';
    for (const label of ABSENT_ROW_LABELS) expect(text).not.toContain(label);
    expect(text).not.toMatch(/anonymous usage|telemetry/i);
  });

  test('the words of This project are 06’s', async () => {
    await mount();
    const text = q('settings-this-project')?.textContent ?? '';
    expect(text).toContain('Follow the trash from other devices');
    expect(text).toContain('Trash keeps it until you clear it out');
    expect(text).not.toContain('Propagate deletions');
  });

  test('Use my own plugin copy writes ownPluginCopy, and only that', async () => {
    await mount();
    calls = [];
    await click(q('settings-own-plugin-copy')?.querySelector('input') ?? null);
    expect(prefWrites()).toEqual([{ ownPluginCopy: true }]);
    expect(advancedPrefs.get().ownPluginCopy).toBe(true);
  });

  test('AI reviews argue it out writes experimentalTeams', async () => {
    await mount();
    calls = [];
    await click(q('settings-experimental-teams')?.querySelector('input') ?? null);
    expect(prefWrites()).toEqual([{ experimentalTeams: true }]);
  });

  test('Logs in bug reports: Ask each time by default; Always is remembered per Mac', async () => {
    await mount();
    const sel = q('settings-report-logs-select') as HTMLSelectElement;
    expect(sel.value).toBe('ask');
    calls = [];
    await change(sel, 'always');
    expect(prefWrites()).toEqual([{ reportLogs: 'always' }]);
  });
});

describe('the Advanced prefs store', () => {
  test('a saved choice on disk is adopted; a choice made in this page is not overwritten', () => {
    const writes: unknown[] = [];
    const s = createAdvancedPrefs({ persist: (p) => writes.push(p) });
    s.hydrate({ reportLogs: 'never', experimentalTeams: true, ownPluginCopy: 'yes' });
    expect(s.get()).toEqual({ ownPluginCopy: false, experimentalTeams: true, reportLogs: 'never' });
    expect(writes).toEqual([]); // adopting the disk never writes it back
    s.set('reportLogs', 'always');
    s.hydrate({ reportLogs: 'never' });
    expect(s.get().reportLogs).toBe('always');
    expect(writes).toEqual([{ reportLogs: 'always' }]);
  });

  test('a value outside the set is refused, and an unchanged value is not rewritten', () => {
    const writes: unknown[] = [];
    const s = createAdvancedPrefs({ persist: (p) => writes.push(p) });
    expect(s.set('reportLogs', 'sometimes')).toBe(false);
    expect(s.set('ownPluginCopy', 'true')).toBe(false);
    expect(s.set('experimentalTeams', false)).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe('Reset', () => {
  test('Reset panel layout calls the live handlers for what moved, then writes the layout', async () => {
    const sides: Array<[string, string]> = [];
    const modes: string[] = [];
    await mount({
      panelSide: { tree: 'right' },
      onSetPanelSide: (id: string, side: string) => sides.push([id, side]),
      layersMode: 'in-inspector',
      onSetLayersMode: (m: string) => modes.push(m),
    });
    calls = [];
    await click(q('settings-reset-panel-layout-btn'));
    expect(sides).toEqual([['tree', 'left']]);
    expect(modes).toEqual(['separate']);
    const w = prefWrites()[0] as { pin: unknown; layersMode: string; panelsHidden: boolean };
    expect(w.pin).toEqual({ on: false });
    expect(w.layersMode).toBe('separate');
    expect(w.panelsHidden).toBe(false);
  });

  test('Close all Advanced sections folds every fold, "?" sheet’s too', async () => {
    await mount();
    await act(async () => {
      foldStore.openAll();
    });
    expect(foldStore.openIds().length).toBeGreaterThan(3);
    await click(q('settings-reset-folds-btn'));
    expect(foldStore.openIds()).toEqual([]);
  });

  test('the per-fold list has one switch per fold, in step with the store', async () => {
    await mount();
    const row = (id: string) =>
      q(`settings-fold-${id}`)?.querySelector('input') as HTMLInputElement;
    for (const id of FOLD_PANELS) expect(row(id), id).toBeTruthy();
    expect(row('inspector').checked).toBe(false);
    await click(row('inspector'));
    expect(foldStore.get('inspector')).toBe(true);
    expect(row('inspector').checked).toBe(true);
    // an id remembered later joins the list
    await act(async () => {
      foldStore.set('future.panel', true);
    });
    expect(row('future.panel').checked).toBe(true);
    // and a fold opened elsewhere flips its switch
    await act(async () => {
      foldStore.set('inspector', false);
    });
    expect(row('inspector').checked).toBe(false);
  });

  test('Reset all settings… asks first: a dialog titled with its verb, Cancel writes nothing', async () => {
    await mount();
    calls = [];
    await click(q('settings-reset-all-btn'));
    const dlg = q('settings-reset-all-dialog') as HTMLElement;
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.querySelector('h2')?.textContent).toBe('Reset all settings');
    expect(q('settings-reset-all-confirm')?.textContent).toBe('Reset all settings');
    // the safe answer has focus
    expect(document.activeElement).toBe(q('settings-reset-all-cancel'));
    await click(q('settings-reset-all-cancel'));
    expect(q('settings-reset-all-dialog')).toBeNull();
    expect(prefWrites()).toEqual([]);
  });

  test('esc inside the dialog closes it and leaves Settings open', async () => {
    await mount();
    await click(q('settings-reset-all-btn'));
    await act(async () => {
      (q('settings-reset-all-dialog') as HTMLElement).dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(q('settings-reset-all-dialog')).toBeNull();
    expect(q('settings-sheet')).toBeTruthy();
  });

  test('Reset all settings puts the look, layout, folds and switches back — and nothing else', async () => {
    const seen: string[] = [];
    await mount({
      theme: 'light',
      onSetTheme: (t: string) => seen.push(`theme:${t}`),
      minimapVisible: true,
      onToggleMinimap: () => seen.push('minimap'),
    });
    await act(async () => {
      foldStore.openAll();
      advancedPrefs.set('ownPluginCopy', true);
      advancedPrefs.set('reportLogs', 'never');
    });
    calls = [];
    await click(q('settings-reset-all-btn'));
    await click(q('settings-reset-all-confirm'));
    expect(q('settings-reset-all-dialog')).toBeNull();
    expect(seen).toEqual(['theme:dark', 'minimap']);
    expect(foldStore.openIds()).toEqual(['help']); // a fresh Mac's
    expect(advancedPrefs.get()).toEqual({
      ownPluginCopy: false,
      experimentalTeams: false,
      reportLogs: 'ask',
    });
    const merged = Object.assign({}, ...prefWrites()) as Record<string, unknown>;
    expect(merged.theme).toBe('dark');
    expect(merged.singleKeyShortcuts).toBe(true);
    expect(merged.pin).toEqual({ on: false });
    // keys and sign-ins are other routes entirely
    expect(
      calls.some((c) => /\/_api\/(keys|cloud|github|figma|sync)/.test(c.url) && c.method !== 'GET')
    ).toBe(false);
  });
});

describe('⌘K runs the four registry actions', () => {
  test('the two switches flip the store the sheet reads, and say when it takes effect', async () => {
    const prefs = createAdvancedPrefs();
    const said: string[] = [];
    const h = createSettingsHandlers({ toast: (m: string) => said.push(m) }, { prefs });
    await h['settings.use-own-plugin-copy']();
    expect(prefs.get().ownPluginCopy).toBe(true);
    await h['settings.use-own-plugin-copy']();
    expect(prefs.get().ownPluginCopy).toBe(false);
    await h['settings.experimental-teams']();
    expect(prefs.get().experimentalTeams).toBe(true);
    expect(said.length).toBe(3);
    for (const m of said) expect(m).toContain('next starts');
  });

  test('the two resets open Settings › Advanced — never act from a search box', () => {
    const opened: unknown[] = [];
    const h = createSettingsHandlers({ setSettingsOpen: (t: unknown) => opened.push(t) }, {});
    h['settings.reset-panel-layout']();
    h['settings.reset-all']();
    expect(opened).toEqual(['advanced', 'advanced']);
  });
});
