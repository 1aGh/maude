// V2-4.7a — Settings: General · Connections · Advanced.
//
// 1. The rows contract: every nothing-deleted row homed in Settings (setg / setc / seta, plus the G0-D
//    rows D11 D12 D14 D17 D19) resolves to a control the sheet renders, under the testid the row names.
// 2. The sheet's own behaviour: sections as a tablist (arrows rove), esc closes and gives focus back,
//    Connections and Advanced exist only on the desktop (`cloud === null`), nothing is fetched that
//    a browser tab's cell refuses.
// 3. The secrets rule: a stored token or key is never rendered, and no test touches the real keychain
//    (every route is a stub; the Tauri bridge is a stub).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  railTarget,
  resolveTab,
  SECTIONS,
  SETTINGS_ROWS,
  sectionsFor,
} from '../client/v2/settings/settings-model.js';

const ND = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'client', 'v2', 'nothing-deleted.json'), 'utf8')
) as {
  rows: Array<{
    id: string;
    home: string;
    v2: { action: string | null; testid: string | null; where: string | null };
  }>;
};
const G0D = ['D11', 'D12', 'D14', 'D17', 'D19'];
const SETTINGS_HOMES = new Set(['setg', 'setc', 'seta']);
const settingsRows = ND.rows.filter((r) => SETTINGS_HOMES.has(r.home) || G0D.includes(r.id));

describe('the rows contract (pure)', () => {
  test('21 §A rows live in Settings and 5 G0-D rows name it', () => {
    expect(ND.rows.filter((r) => SETTINGS_HOMES.has(r.home)).length).toBe(21);
    expect(settingsRows.length).toBe(26);
  });

  test('every §A Settings row is carried by the model, in the section its home names', () => {
    const bySection: Record<string, string> = {
      setg: 'general',
      setc: 'connections',
      seta: 'advanced',
    };
    for (const r of ND.rows.filter((x) => SETTINGS_HOMES.has(x.home))) {
      const m = SETTINGS_ROWS.find((x) => x.nd === r.id);
      expect(m, r.id).toBeTruthy();
      expect(m?.section, r.id).toBe(bySection[r.home]);
    }
  });

  test('every model row that names a nothing-deleted id names one that exists', () => {
    for (const m of SETTINGS_ROWS) {
      if (m.nd)
        expect(
          ND.rows.some((r) => r.id === m.nd),
          m.nd
        ).toBe(true);
    }
  });

  test('every Settings row has its v2 home filled, and it is the model’s testid', () => {
    for (const r of settingsRows) {
      expect(r.v2.where, r.id).toBeTruthy();
      expect(r.v2.testid || r.v2.action, r.id).toBeTruthy();
    }
    for (const m of SETTINGS_ROWS) {
      if (!m.nd) continue;
      const row = ND.rows.find((r) => r.id === m.nd);
      expect(row?.v2.testid, m.nd).toBe(m.testid);
    }
  });

  test('local-machine sections need the desktop — absent (not disabled) in a cloud tab or before /_config', () => {
    expect(sectionsFor(null).map((s) => s.id)).toEqual(['general', 'connections', 'advanced']);
    expect(sectionsFor(undefined).map((s) => s.id)).toEqual(['general']);
    expect(sectionsFor({ role: 'member' }).map((s) => s.id)).toEqual(['general']);
    // every row flagged `local` lives in a section that needs the desktop
    for (const m of SETTINGS_ROWS) {
      const sec = SECTIONS.find((s) => s.id === m.section);
      expect(!!m.local, `${m.testid} local flag`).toBe(!!sec?.local);
    }
  });

  test('a remembered section this shell lacks never selects nothing', () => {
    expect(resolveTab({ role: 'member' }, undefined, 'advanced')).toBe('general');
    expect(resolveTab(null, undefined, 'advanced')).toBe('advanced');
    expect(resolveTab(null, 'connections', 'advanced')).toBe('connections');
    expect(resolveTab(null, 'nope', 'nope')).toBe('general');
  });

  test('the rail roves with arrows, Home and End and wraps', () => {
    const ids = ['general', 'connections', 'advanced'];
    expect(railTarget(ids, 'general', 'ArrowDown')).toBe('connections');
    expect(railTarget(ids, 'advanced', 'ArrowDown')).toBe('general');
    expect(railTarget(ids, 'general', 'ArrowUp')).toBe('advanced');
    expect(railTarget(ids, 'connections', 'Home')).toBe('general');
    expect(railTarget(ids, 'connections', 'End')).toBe('advanced');
    expect(railTarget(ids, 'connections', 'x')).toBeNull();
  });
});

// ── the sheet, rendered ─────────────────────────────────────────────────────────────────────────

type Call = { url: string; method: string; body?: string };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

const CLOUD_STATUS = {
  connected: true,
  email: 'jana@example.test',
  url: 'https://cloud.example.test',
  project: 'Studio site',
  linkedHub: { url: 'https://hub.example.test/p/studio', credentialed: true },
};
const ROUTES: Record<string, unknown> = {
  '/_api/cloud/status': CLOUD_STATUS,
  '/_api/cloud/projects': {
    ok: true,
    projects: [
      {
        id: 'p1',
        name: 'Studio site',
        role: 'owner',
        url: 'https://hub.example.test/p/studio',
        stateLabel: 'owner',
      },
      {
        id: 'p2',
        name: 'Brand book',
        role: 'member',
        url: 'https://other.example.test/p/brand',
        stateLabel: 'member',
      },
    ],
  },
  '/_api/figma/status': { configured: true, requiredScope: 'file_content:read' },
  '/_api/generate/providers': { providers: [] },
  '/_api/generate/prefs': {},
  '/_api/generate/whisper-model': { models: [] },
  '/_api/generate/keyframe-model': { models: [] },
  '/_api/sync/settings': {
    ok: true,
    settings: { syncFiles: true, propagateDeletes: false, resolveFirstAnchor: 'ask' },
  },
  '/_api/sync/ownership': {
    mode: 'repo-owned',
    git: true,
    linked: true,
    trackedCount: 3,
    hubUrl: 'https://hub.example.test',
  },
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

/** The Tauri bridge, stubbed: nothing here reaches a keychain or a window. */
function installTauri() {
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: {
      invoke: async (cmd: string) => {
        if (cmd === 'github_is_signed_in') return false;
        if (cmd === 'prefs_get_claude_auto_setup') return true;
        return null;
      },
    },
  };
}

let SettingsSheet: (props: Record<string, unknown>) => React.ReactElement;
let CloudBar: (props: Record<string, unknown>) => React.ReactElement;
let IdentityBar: (props: Record<string, unknown>) => React.ReactElement;
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  SettingsSheet = (await import('../client/v2/settings/settings-sheet.jsx'))
    .default as unknown as typeof SettingsSheet;
  CloudBar = (await import('../client/panels/CloudBar.jsx')).default as unknown as typeof CloudBar;
  IdentityBar = (await import('../client/panels/IdentityBar.jsx'))
    .default as unknown as typeof IdentityBar;
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
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const settle = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};

const noop = () => {};
const PROPS = {
  theme: 'dark',
  onSetTheme: noop,
  cpMode: 'advanced',
  onSetCpMode: noop,
  minimapVisible: true,
  onToggleMinimap: noop,
  zoomCtlVisible: true,
  onToggleZoomCtl: noop,
  annotationsVisible: true,
  onToggleAnnotations: noop,
  autoOpenInspector: false,
  onToggleAutoOpenInspector: noop,
  hasCanvas: true,
  panelSide: {},
  onSetPanelSide: noop,
  layersMode: 'separate',
  onSetLayersMode: noop,
  onLinkedHub: noop,
  onLocalProject: noop,
};

async function mount(props: Record<string, unknown> = {}) {
  const opener = document.createElement('button');
  opener.textContent = 'opener';
  document.body.append(opener);
  opener.focus();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const onClose = props.onClose ?? noop;
  await act(async () =>
    root.render(<SettingsSheet cloud={null} {...PROPS} {...props} onClose={onClose} />)
  );
  await settle(60);
  return { opener, root };
}
const goto = async (id: string) => {
  await click(q(`settings-tab-${id}`));
  await settle(80);
};

describe('the desktop sheet renders every Settings row', () => {
  test('General: account, look, canvas and view, layout', async () => {
    await mount();
    for (const id of [
      'settings-account',
      'settings-open-dashboard',
      'settings-theme',
      'settings-inspector-vocabulary',
      'settings-canvas-view',
      'panel-side-tree',
    ])
      expect(q(id), id).toBeTruthy();
    // the account says who, never a secret
    expect(document.body.textContent).toContain('jana@example.test');
  });

  test('Connections: cloud account and projects, the workspace address, team server, GitHub, AI keys, Figma', async () => {
    installTauri();
    await mount();
    await goto('connections');
    for (const id of [
      'cloud-account',
      'cloud-sign-out',
      'settings-cloud-projects',
      'cloud-project-p1',
      'cloud-disconnect-p1', // p1 is the project this folder is linked to
      'cloud-project-p2', // p2 offers Connect
      'settings-hub-address',
      'settings-team-server-add',
      'settings-github',
      'settings-github-signin',
      'settings-ai-keys',
      'figma-connect-card',
      'figma-test', // "Test" (D14)
    ])
      expect(q(id), id).toBeTruthy();
    expect(q('cloud-project-p2')?.textContent).toContain('Connect Brand book');
    // the address is shown; the token never is
    expect(q('settings-hub-address')?.textContent).toContain('https://hub.example.test/p/studio');
    expect(q('settings-hub-address')?.textContent).toContain('never shown');
  });

  test('Connections: “Add a team server…” opens the server form only (D12)', async () => {
    installTauri();
    await mount();
    await goto('connections');
    await click(q('settings-team-server-add'));
    await settle(50);
    for (const id of [
      'team-projects-dialog',
      'team-hub-url',
      'team-hub-email',
      'team-hub-password',
    ])
      expect(q(id), id).toBeTruthy();
    // not the recents and not the cloud list — those have their own homes
    const dialog = q('team-projects-dialog') as HTMLElement;
    expect(dialog.querySelector('section[aria-label="Maude Cloud"]')).toBeNull();
    expect(dialog.querySelector('section[aria-label="Recent team projects"]')).toBeNull();
    expect(dialog.querySelector('section[aria-label="Your team\'s server"]')).toBeTruthy();
    // esc belongs to the dialog first; the sheet stays
    await act(async () => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('settings-sheet')).toBeTruthy();
  });

  test('Advanced: this Mac, Claude Code, engines, this project', async () => {
    installTauri();
    await mount();
    await goto('advanced');
    for (const id of [
      'settings-app-version',
      'settings-update-restart',
      'settings-server-build',
      'settings-keys-store',
      'settings-claude-autosetup',
      'settings-copy-draw',
      'settings-copy-brand',
      'settings-transcription',
      'settings-transcription-engine',
      'settings-keyframes',
      'settings-keyframe-engine',
      'sync-setting-syncFiles',
      'sync-setting-propagateDeletes',
      'sync-setting-firstAnchor',
      'sync-ownership-adopt',
    ])
      expect(q(id), id).toBeTruthy();
  });

  test('every model row’s testid is on screen in its section (pattern ids by prefix)', async () => {
    installTauri();
    await mount();
    for (const sec of ['general', 'connections', 'advanced']) {
      await goto(sec);
      const panel = q(`settings-panel-${sec}`) as HTMLElement;
      for (const m of SETTINGS_ROWS.filter((r) => r.section === sec)) {
        const sel = m.testid.includes('<')
          ? `[data-testid^="${m.testid.split('<')[0]}"]`
          : `[data-testid="${m.testid}"]`;
        expect(panel.querySelector(sel), `${sec}: ${m.testid}`).toBeTruthy();
      }
    }
  });

  test('the update row: Restart now waits for a staged build; Later dismisses it', async () => {
    installTauri();
    let later = 0;
    await mount({ update: { version: '2.0.1' }, onUpdateLater: () => later++ });
    await goto('advanced');
    const restart = q('settings-update-restart') as HTMLButtonElement;
    expect(restart.disabled).toBe(false);
    expect(q('settings-update')?.textContent).toContain('2.0.1 is ready');
    await click(q('settings-update-later'));
    expect(later).toBe(1);
  });

  test('no update staged: Restart now is there but idle', async () => {
    installTauri();
    await mount({ update: null });
    await goto('advanced');
    expect((q('settings-update-restart') as HTMLButtonElement).disabled).toBe(true);
    expect(q('settings-update-later')).toBeNull();
  });

  test('a project not linked to a workspace says so instead of showing dead switches', async () => {
    installFetch({
      '/_api/sync/settings': { ok: true, settings: null },
      '/_api/sync/ownership': { mode: 'repo-owned', git: false },
    });
    await mount();
    await goto('advanced');
    expect(q('settings-project-unlinked')).toBeTruthy();
    expect(q('sync-setting-syncFiles')).toBeNull();
  });
});

describe('the sheet’s own behaviour', () => {
  test('sections are a vertical tablist; arrows rove and select', async () => {
    await mount();
    const tablist = document.querySelector('[role="tablist"]') as HTMLElement;
    expect(tablist.getAttribute('aria-orientation')).toBe('vertical');
    const tabs = qa('[role="tab"]');
    expect(tabs.map((t) => t.textContent)).toEqual(['General', 'Connections', 'Advanced']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');
    await act(async () => {
      tabs[0].dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
    });
    await settle(40);
    expect(qa('[role="tab"]')[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(qa('[role="tab"]')[1]);
    // each tab controls a panel that is its label
    const panel = document.getElementById('v2s-panel-connections');
    expect(panel?.getAttribute('aria-labelledby')).toBe('v2s-tab-connections');
    expect(panel?.hidden).toBe(false);
  });

  test('esc closes the sheet and focus goes back to where it was', async () => {
    let closed = 0;
    const { opener } = await mount({ onClose: () => closed++ });
    expect(document.activeElement).toBe(q('settings-tab-general'));
    await act(async () => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closed).toBe(1);
    // the caller unmounts the sheet on close — focus returns to the opener
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    expect(document.activeElement).toBe(opener);
  });

  test('a click on the veil closes; a click inside does not', async () => {
    let closed = 0;
    await mount({ onClose: () => closed++ });
    await act(async () => {
      q('settings-sheet')?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    });
    expect(closed).toBe(0);
    await act(async () => {
      q('settings-scrim')?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    });
    expect(closed).toBe(1);
  });

  test('the section you left on is the one you come back to', async () => {
    await mount();
    await goto('advanced');
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    await mount();
    expect(q('settings-tab-advanced')?.getAttribute('aria-selected')).toBe('true');
  });

  test('a cloud tab gets General only, and asks for none of the local-machine routes', async () => {
    await mount({ cloud: { role: 'member', dashboardUrl: 'https://cloud.example.test' } });
    expect(qa('[role="tab"]').map((t) => t.textContent)).toEqual(['General']);
    expect(q('settings-open-dashboard')).toBeTruthy(); // the cloud tab was configured with one
    const asked = calls.map((c) => c.url);
    for (const forbidden of [
      '/_api/generate',
      '/_api/figma',
      '/_api/cloud',
      '/_api/sync/settings',
      '/_api/sync/ownership',
    ])
      expect(
        asked.some((u) => u.startsWith(forbidden)),
        forbidden
      ).toBe(false);
  });

  test('before /_config answers (cloud undefined) nothing local is mounted or fetched', async () => {
    await mount({ cloud: undefined });
    expect(qa('[role="tab"]').map((t) => t.textContent)).toEqual(['General']);
    expect(calls.length).toBe(0);
  });

  test('a self-hosted cloud tab with no dashboard has no “open the dashboard”', async () => {
    await mount({ cloud: { role: 'owner' } });
    expect(q('settings-open-dashboard')).toBeNull();
    expect(q('settings-account')).toBeNull();
  });
});

describe('secrets stay where they are', () => {
  test('a Figma token being typed is a password field, and a saved one is never read back', async () => {
    await mount();
    await goto('connections');
    const input = q('figma-connect-input') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    expect(input.placeholder).toContain('stored'); // masked placeholder, not the token
  });

  test('nothing in the sheet reads a token out of a response', async () => {
    installFetch({
      '/_api/cloud/status': {
        ...CLOUD_STATUS,
        linkedHub: {
          url: 'https://hub.example.test/p/studio',
          credentialed: true,
          token: 'tok_SECRET',
        },
      },
    });
    await mount();
    await goto('connections');
    expect(document.body.textContent).not.toContain('tok_SECRET');
  });
});

describe('the left panel footer only hosts', () => {
  async function mountEls(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(el));
    await settle(60);
  }

  test('CloudBar “host” draws no rail — the account and projects are Settings’ now', async () => {
    await mountEls(<CloudBar variant="host" />);
    expect(q('cloud-host')).toBeTruthy();
    for (const id of ['cloud-bar', 'cloud-signin', 'cloud-account', 'cloud-project-p1'])
      expect(q(id), id).toBeNull();
  });

  test('CloudBar “rail” (the default) is unchanged: the account button, the menu on demand', async () => {
    await mountEls(<CloudBar />);
    expect(q('cloud-bar')).toBeTruthy();
    expect(q('cloud-account')?.getAttribute('aria-haspopup')).toBe('menu');
    expect(q('cloud-project-p1')).toBeNull(); // the menu is closed
    await click(q('cloud-account'));
    await settle(40);
    expect(q('cloud-project-p1')).toBeTruthy();
  });

  test('IdentityBar “host” draws no rail; “settings” draws the row', async () => {
    installTauri();
    await mountEls(
      <>
        <IdentityBar variant="host" />
        <IdentityBar variant="settings" />
      </>
    );
    expect(document.querySelectorAll('.gi-rail').length).toBe(0);
    expect(document.querySelectorAll('.gi-host').length).toBe(1);
    expect(q('settings-github-signin')).toBeTruthy();
  });

  test('a link change made in Settings reaches the host, so its deep-link warning is never stale', async () => {
    await mountEls(
      <>
        <CloudBar variant="host" />
        <CloudBar variant="settings" />
      </>
    );
    const statusReads = () => calls.filter((c) => c.url.startsWith('/_api/cloud/status')).length;
    const before = statusReads();
    await click(q('cloud-disconnect-p1'));
    await settle(60);
    expect(calls.some((c) => c.url.startsWith('/_api/cloud/detach') && c.method === 'POST')).toBe(
      true
    );
    // the host re-read the link; the settings instance did not need to (it set its own state)
    expect(statusReads()).toBeGreaterThan(before);
  });

  test('only the host answers a maude:// link — the settings instance never listens for one', async () => {
    let listened = 0;
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: {
        invoke: async (cmd: string) => {
          if (cmd === 'take_pending_deep_link') listened++;
          return null;
        },
      },
    };
    await mountEls(<CloudBar variant="settings" />);
    expect(listened).toBe(0);
    await mountEls(<CloudBar variant="host" />);
    expect(listened).toBe(1);
  });
});
