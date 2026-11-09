// 2.1.1 T6 — Settings as one column of expandable cards (canvas 17, artboards 08 · 09 · 10 · 11).
//
// 1. The card: Enter/Space (a native button) toggles it, `aria-expanded` follows, a header action stays
//    visible while the card is closed, the body stays mounted (hidden) so nothing it holds is lost.
// 2. General › This project, per state: connected (cloud) · sign-in stopped working · sign-in missing ·
//    only on this Mac · kept by Maude.
// 3. Advanced no longer carries This project — its switches live in General › This project › Sync details.
// 4. ⌘K finds a row inside a CLOSED card, and opening it opens that card.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { settingsSearchRows } from '../client/v2/search/search-model.js';
import {
  CARDS,
  canvasSummary,
  layoutSummary,
  openCardOf,
  parseSettingsTarget,
  settingsTarget,
  toggleCard,
} from '../client/v2/settings/settings-cards.js';
import { SETTINGS_ROWS } from '../client/v2/settings/settings-model.js';
import { thisProjectModel } from '../client/v2/settings/this-project-model.js';
import { connectionWords } from '../client/v2/shell/connection-state.js';

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const CLOUD = 'https://cloud.example.test';

describe('General › This project — the model per state', () => {
  test('connected to Maude Cloud, in the person’s folder', () => {
    const m = thisProjectModel({
      status: {
        connected: true,
        email: 'alice@example.test',
        url: CLOUD,
        project: 'Brand site',
        linkedHub: { url: 'https://p1.cloud.example.test', credentialed: true },
        place: { kept: false, folder: '~/git/brand-site' },
      },
      syncStatus: { linked: true, state: 'online', lastSyncAt: NOW - 2 * 60_000 },
      native: true,
      now: NOW,
    });
    expect(m.conn.state).toBe('connected');
    expect(m.statusWord).toBe('Connected · synced 2 min ago');
    expect(m.desc).toBe('Your folder · ~/git/brand-site · also on Maude Cloud');
    expect(m.place).toEqual({ kind: 'folder', label: 'Your folder', path: '~/git/brand-site' });
    expect(m.account).toMatchObject({ kind: 'cloud', label: 'alice@example.test' });
    expect(m.bad).toBe(false);
    expect(m.fixLabel).toBeNull();
    expect(m.local).toBe(false);
    // Change… offers Show in Finder (the Mac app's door); moving the project has no backend yet
    expect(m.changeOptions.filter((o) => o.available).map((o) => o.id)).toEqual([
      'folder',
      'finder',
    ]);
    expect(m.canChange).toBe(true);
  });

  test('your server, sign-in stopped working — the fix is Sign in again, the callout says what waits', () => {
    const m = thisProjectModel({
      status: {
        connected: false,
        url: CLOUD,
        project: 'Design system',
        linkedHub: { url: 'https://design.example.com', credentialed: true },
        place: { kept: false, folder: '~/git/ds' },
      },
      syncStatus: { linked: true, state: 'online', accepted: { credentialRefused: true } },
      hubAccount: 'alice@example.com',
      now: NOW,
    });
    expect(m.conn.state).toBe('signin-rejected');
    // the words are the shell's one model (connection-state.js), the avatar's and the toast's
    expect(m.statusWord).toBe(connectionWords(m.conn).word);
    expect(m.statusWord).toBe('Sign-in stopped working');
    expect(m.sw).toBe('error');
    expect(m.bad).toBe(true);
    expect(m.fixLabel).toBe('Sign in again');
    expect(m.callout?.title).toBe('Your sign-in to design.example.com stopped working.');
    expect(m.account).toMatchObject({ kind: 'server', label: 'alice@example.com' });
    expect(m.linkKind).toBe('server');
  });

  test('your server, no sign-in on this Mac — the fix is Sign in', () => {
    const m = thisProjectModel({
      status: { url: CLOUD, linkedHub: { url: 'https://design.example.com', credentialed: false } },
      now: NOW,
    });
    expect(m.conn.state).toBe('signin-missing');
    expect(m.statusWord).toBe('Sign in to sync');
    expect(m.fixLabel).toBe('Sign in');
  });

  test('only on this Mac — no account, the two ways out, nothing to fix', () => {
    const m = thisProjectModel({
      status: {
        connected: false,
        url: CLOUD,
        project: 'Logo ideas',
        linkedHub: null,
        place: { kept: false, folder: '~/git/logo-ideas' },
      },
      now: NOW,
    });
    expect(m.conn.state).toBe('local');
    expect(m.local).toBe(true);
    expect(m.statusWord).toBe('Only on this Mac');
    expect(m.desc).toBe('Your folder · ~/git/logo-ideas · only on this Mac');
    expect(m.account).toEqual({ kind: 'local', label: 'No account', host: '' });
    expect(m.bad).toBe(false);
    // a browser tab has no Finder: nothing to change, so no Change… button
    expect(m.canChange).toBe(false);
  });

  test('kept by Maude — of a cloud project and of a server project', () => {
    const cloud = thisProjectModel({
      status: {
        url: CLOUD,
        connected: true,
        email: 'alice@example.test',
        linkedHub: { url: 'https://p9.cloud.example.test', credentialed: true },
        place: { kept: true },
      },
      syncStatus: { linked: true, state: 'online', queuedOps: 3 },
      now: NOW,
    });
    expect(cloud.place).toEqual({ kind: 'kept', label: 'Kept by Maude', path: '' });
    expect(cloud.desc).toBe('Kept by Maude · also on Maude Cloud');
    expect(cloud.statusWord).toBe('Syncing · 3 changes going out');
    expect(cloud.changeOptions.find((o) => o.id === 'kept')?.current).toBe(true);
    const server = thisProjectModel({
      status: {
        url: CLOUD,
        linkedHub: { url: 'https://design.example.com', credentialed: true },
        place: { kept: true },
      },
      now: NOW,
    });
    expect(server.place.label).toBe('On design.example.com');
    expect(server.desc).toBe('On design.example.com · copy kept by Maude');
  });

  test('offline vs a server that does not answer', () => {
    const status = {
      url: CLOUD,
      linkedHub: { url: 'https://design.example.com', credentialed: true },
    };
    const off = { linked: true, state: 'offline' };
    expect(thisProjectModel({ status, syncStatus: off, online: false }).statusWord).toBe(
      'Offline — changes wait on this Mac'
    );
    expect(thisProjectModel({ status, syncStatus: off, online: true }).statusWord).toBe(
      'Can’t reach design.example.com'
    );
  });
});
describe('the card table (pure)', () => {
  test('one card open per tab; a click on the open one closes it', () => {
    expect(openCardOf('general', {})).toBe('this-project');
    expect(openCardOf('general', { general: null })).toBeNull();
    expect(openCardOf('advanced', { advanced: 'privacy' })).toBe('privacy');
    expect(openCardOf('advanced', { advanced: 'nope' })).toBe('this-mac');
    expect(toggleCard('look', 'look')).toBeNull();
    expect(toggleCard('look', 'layout')).toBe('layout');
  });

  test('every Settings row names a card of its own section', () => {
    for (const r of SETTINGS_ROWS) {
      expect(CARDS[r.section as keyof typeof CARDS], r.testid).toContain(r.card);
    }
  });

  test('a closed card says what is set', () => {
    expect(
      canvasSummary({ minimap: false, zoom: true, annotations: true, autoInspector: undefined })
    ).toBe('Zoom controls and annotations on · minimap off');
    expect(layoutSummary({}, 'separate')).toBe('Panels in their usual places');
    expect(layoutSummary({ tree: 'right' }, 'in-inspector')).toBe(
      '1 panel moved · Layers inside the Inspector'
    );
  });
});

describe('Advanced no longer has This project', () => {
  test('the sync switches are General › This project › Sync details rows now', () => {
    for (const id of [
      'sync-setting-syncFiles',
      'sync-setting-firstAnchor',
      'sync-ownership-adopt',
    ]) {
      const rows = SETTINGS_ROWS.filter((r) => r.testid === id);
      expect(rows.length, id).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.section, id).toBe('general');
        expect(r.card, id).toBe('this-project');
        expect(r.where).toContain('Settings › General › This project › Sync details');
      }
    }
    expect(SETTINGS_ROWS.some((r) => r.where.includes('Advanced › This project'))).toBe(false);
  });
});

describe('⌘K finds a row inside a closed card', () => {
  test('the result carries its card, and the sheet target names it', () => {
    const rows = settingsSearchRows({ cloud: null });
    const logs = rows.find((r) => r.testid === 'settings-report-logs');
    expect(logs).toBeTruthy();
    const row = SETTINGS_ROWS.find((r) => r.testid === 'settings-report-logs');
    expect(settingsTarget('advanced', row)).toBe('advanced#privacy');
    expect(parseSettingsTarget('advanced#privacy')).toEqual({ tab: 'advanced', card: 'privacy' });
    expect(parseSettingsTarget('advanced')).toEqual({ tab: 'advanced', card: null });
    expect(parseSettingsTarget('advanced#nope')).toEqual({ tab: 'advanced', card: null });
    // what the search runner hands the sheet
    let opened: unknown = null;
    settingsSearchRows({
      cloud: null,
      run: (s: string, r: unknown) => (opened = settingsTarget(s, r as never)),
    })
      .find((r) => r.testid === 'settings-report-logs')
      ?.run();
    expect(opened).toBe('advanced#privacy');
  });
});

// ── rendered ───────────────────────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
const ROUTES: Record<string, unknown> = {
  '/_api/cloud/status': {
    connected: true,
    email: 'jana@example.test',
    url: CLOUD,
    project: 'Studio site',
    linkedHub: { url: 'https://p1.cloud.example.test', credentialed: true },
    place: { kept: false, folder: '~/git/studio-site' },
  },
  '/_api/cloud/projects': { ok: true, projects: [] },
  '/_api/figma/status': { configured: false },
  '/_api/generate/providers': { providers: [] },
  '/_api/sync/settings': {
    ok: true,
    settings: { syncFiles: true, propagateDeletes: false, resolveFirstAnchor: 'ask' },
  },
};
function installFetch(over: Record<string, unknown> = {}) {
  const routes = { ...ROUTES, ...over };
  globalThis.fetch = (async (url: string) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    return new Response(JSON.stringify(key ? routes[key] : { ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
}

let SettingsSheet: (p: Record<string, unknown>) => React.ReactElement;
let SettingsCard: (p: Record<string, unknown>) => React.ReactElement;
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  SettingsSheet = (await import('../client/v2/settings/settings-sheet.jsx'))
    .default as unknown as typeof SettingsSheet;
  SettingsCard = (await import('../client/v2/settings/settings-card.jsx'))
    .SettingsCard as unknown as typeof SettingsCard;
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
    sessionStorage.clear();
  } catch {}
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const settle = (ms = 40) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function render(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await settle();
}

describe('the card, rendered', () => {
  test('the header toggles it; aria-expanded follows; the action stays visible when closed', async () => {
    const { useState } = await import('react');
    function Harness() {
      const [open, setOpen] = useState<string | null>(null);
      return (
        <SettingsCard
          id="demo"
          icon="settings"
          title="Demo"
          desc="What it is."
          summary="What is set"
          sw="error"
          open={open === 'demo'}
          onToggle={(id: string) => setOpen((c) => (c === id ? null : id))}
          action={
            <button type="button" data-testid="demo-fix">
              Sign in again
            </button>
          }
        >
          <p data-testid="demo-body">inside</p>
        </SettingsCard>
      );
    }
    await render(<Harness />);
    const head = q('settings-card-demo-toggle');
    expect(head?.tagName).toBe('BUTTON'); // Enter / Space are the button's own
    expect(head?.getAttribute('aria-expanded')).toBe('false');
    expect(q('settings-card-demo-body')?.hidden).toBe(true);
    // the body stays mounted while closed — nothing it holds is lost
    expect(q('demo-body')).toBeTruthy();
    // the one-click fix sits outside the header button, visible on the closed card
    expect(q('demo-fix')).toBeTruthy();
    expect(head?.contains(q('demo-fix'))).toBe(false);
    await act(async () => head?.click());
    expect(head?.getAttribute('aria-expanded')).toBe('true');
    expect(q('settings-card-demo-body')?.hidden).toBe(false);
    expect(head?.getAttribute('aria-controls')).toBe(q('settings-card-demo-body')?.id ?? 'x');
    await act(async () => head?.click());
    expect(head?.getAttribute('aria-expanded')).toBe('false');
  });
});

const noop = () => {};
const PROPS = {
  theme: 'dark',
  onSetTheme: noop,
  minimapVisible: false,
  onToggleMinimap: noop,
  zoomCtlVisible: true,
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
};

describe('the sheet, as cards', () => {
  test('General opens on This project; the rest are closed and say what is set', async () => {
    await render(<SettingsSheet cloud={null} {...PROPS} onClose={noop} />);
    await settle(80);
    expect(q('settings-card-this-project-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(q('settings-card-look-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(q('settings-card-canvas-summary')?.textContent).toContain('minimap off');
    expect(q('settings-this-project')?.textContent).toContain('Studio site');
    expect(q('settings-this-project')?.textContent).toContain('~/git/studio-site');
    // only one card of the tab is open
    await act(async () => q('settings-card-look-toggle')?.click());
    expect(q('settings-card-look-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(q('settings-card-this-project-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  test('Advanced: seven cards and Reset, no This project', async () => {
    await render(<SettingsSheet cloud={null} {...PROPS} initialTab="advanced" onClose={noop} />);
    await settle(80);
    const panel = q('settings-panel-advanced');
    const cards = [...(panel?.querySelectorAll('[data-card]') ?? [])].map((n) =>
      n.getAttribute('data-card')
    );
    expect(cards).toEqual(CARDS.advanced as unknown as string[]);
    expect(panel?.querySelector('[data-testid="settings-this-project"]')).toBeNull();
    expect(panel?.textContent).not.toContain('This project');
  });

  test('a ⌘K target opens the card that holds the row, even one the person closed', async () => {
    sessionStorage.setItem('maude-settings-card-v1', JSON.stringify({ advanced: null }));
    await render(
      <SettingsSheet cloud={null} {...PROPS} initialTab="advanced#privacy" onClose={noop} />
    );
    await settle(80);
    expect(q('settings-tab-advanced')?.getAttribute('aria-selected')).toBe('true');
    expect(q('settings-card-privacy-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(q('settings-report-logs')).toBeTruthy();
  });

  test('Connections: Claude, Figma, GitHub, AI keys — no project linking', async () => {
    await render(<SettingsSheet cloud={null} {...PROPS} initialTab="connections" onClose={noop} />);
    await settle(80);
    const panel = q('settings-panel-connections');
    const cards = [...(panel?.querySelectorAll('[data-card]') ?? [])].map((n) =>
      n.getAttribute('data-card')
    );
    expect(cards).toEqual(['claude', 'figma', 'github', 'ai']);
    for (const id of ['cloud-signin', 'cloud-account', 'settings-team-server-add', 'cloud-bar'])
      expect(panel?.querySelector(`[data-testid="${id}"]`), id).toBeNull();
    expect(panel?.textContent).toContain('General › This project');
  });
});
