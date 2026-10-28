// S11.14 — Settings › Connections, each connection with its own Advanced (06 ad-edge-hub; D11, D12, D14).
//
// 1. The model: status words, the token mask (four characters at most), cloud-vs-team-server.
// 2. The route: `GET /_api/connections/hub` names the hub's version and the token's LAST FOUR — never
//    more, never for a short token, and the tokenless probe runs only for a credentialed link.
// 3. The section, rendered: the team server reads "Connected · saved 1 min ago"; its Advanced shows
//    Address, "•••• •••• a91f" + Replace…, Hub version; Replace… goes through `POST /_api/hub/link`
//    only and the new token never stays in the DOM; Figma Test; "2 keys · Gemini, ElevenLabs"; the v1
//    rows are no longer mounted. Every route is a stub — no real keychain, no network.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { FOLD_PANELS } from '../client/v2/fold/fold-store.js';
import {
  cloudRow,
  figmaRow,
  hubRow,
  isCloudHub,
  maskedToken,
  providerSummary,
  savedWords,
} from '../client/v2/settings/connections-model.js';
import { FOLD_LABELS } from '../client/v2/settings/settings-model.js';
import { createConnectionsRoutes, hubDetails, tokenLast4 } from '../routes/connections.ts';
import { ROLE_REFUSALS } from './_role-refusals.ts';

// ── 1. the model ────────────────────────────────────────────────────────────────────────────────

describe('connections-model (pure)', () => {
  test('the mask shows four characters at most, and only four printable ones', () => {
    expect(maskedToken('a91f')).toBe('•••• •••• a91f');
    expect(maskedToken(null)).toBe('•••• •••• ••••');
    expect(maskedToken('a91f-more-of-the-token')).toBe('•••• •••• ••••');
    expect(maskedToken('<b>x')).toBe('•••• •••• <b>x'); // text, rendered as text by React
    expect(maskedToken('a 9f')).toBe('•••• •••• ••••');
  });

  test('a cloud project cell is the cloud; anything else is your team’s own server', () => {
    const cloud = 'https://cloud.maude.sh';
    expect(isCloudHub('https://alligators.cloud.maude.sh', cloud)).toBe(true);
    expect(isCloudHub('https://cloud.maude.sh', cloud)).toBe(true);
    expect(isCloudHub('https://hub.studio-brno.cz', cloud)).toBe(false);
    expect(isCloudHub('https://evilcloud.maude.sh.example', cloud)).toBe(false);
    expect(isCloudHub('not a url', cloud)).toBe(false);
  });

  test('“Connected · saved 1 min ago” — a time only when the runtime reported one', () => {
    const now = Date.parse('2026-10-20T14:06:00');
    const linkedHub = { url: 'https://hub.studio-brno.cz', credentialed: true };
    const r = hubRow({
      linkedHub,
      cloudUrl: 'https://cloud.maude.sh',
      project: 'Studio site',
      lastSyncAt: now - 61_000,
      now,
    });
    expect(r).toMatchObject({
      linked: true,
      title: 'Studio site — your team’s own server',
      status: 'Connected · saved 1 min ago',
      tone: 'ok',
      action: 'sign-out',
    });
    expect(hubRow({ linkedHub, cloudUrl: 'https://cloud.maude.sh' }).status).toBe('Connected');
    expect(savedWords(now - 5_000, now)).toBe('saved just now');
    expect(savedWords(now - 2 * 3_600_000, now)).toBe('saved at 12:06');
    expect(savedWords(null, now)).toBeNull();
    // a link with no sign-in on this Mac is not "Connected"
    expect(hubRow({ linkedHub: { ...linkedHub, credentialed: false } }).action).toBe('sign-in');
    // no link, or a cloud link: the row offers to add a server
    expect(hubRow({}).action).toBe('add');
    expect(
      hubRow({
        linkedHub: { url: 'https://a.cloud.maude.sh', credentialed: true },
        cloudUrl: 'https://cloud.maude.sh',
      }).linked
    ).toBe(false);
  });

  test('cloud, AI and Figma words', () => {
    expect(cloudRow({ state: 'in', email: 'you@studio.cz' }).status).toBe(
      'Signed in as you@studio.cz'
    );
    expect(cloudRow({ state: 'out' }).action).toBe('sign-in');
    expect(
      providerSummary([
        { id: 'gemini', label: 'Gemini', configured: true, auth: 'api-key' },
        { id: 'elevenlabs', label: 'ElevenLabs', configured: true, auth: 'api-key' },
        { id: 'groq', label: 'Groq', configured: false, auth: 'api-key' },
        { id: 'local', label: 'Local', configured: true, auth: 'none' },
      ])
    ).toBe('2 keys · Gemini, ElevenLabs');
    expect(providerSummary([])).toBe('No keys yet');
    expect(figmaRow({ configured: true }).status).toBe('Connected · for imports');
    expect(figmaRow({ configured: false }).status).toBe('No token');
  });

  test('each connection has its own fold, listed for Open all / Reset with a label', () => {
    for (const row of ['cloud', 'hub', 'github', 'ai', 'figma']) {
      expect(FOLD_PANELS).toContain(`connections.${row}`);
      expect(FOLD_LABELS[`connections.${row}`]).toMatch(/^Connections › .+ › Advanced$/);
    }
  });
});

// ── 2. the route ────────────────────────────────────────────────────────────────────────────────

describe('GET /_api/connections/hub', () => {
  const FULL = 'mht_live_0123456789abcdefXYZa91f';
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 's11-14-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const setup = (
    token: string | null,
    url = 'https://hub.studio-brno.cz',
    extra: Record<string, unknown> = {}
  ) => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ linkedHub: { url, linkedAt: 1 } }));
    const hubs = join(dir, 'hubs.json');
    writeFileSync(
      hubs,
      JSON.stringify({
        hubs: token ? { [url]: { token, linkedAt: 1, ...extra } } : {},
        trusted: [],
      })
    );
    return hubs;
  };

  // P8-T G1b-3 — 06 ad-edge-hub: "Signed in as you@studio-brno", the account the hub vouched at sign-in.
  test('Signed in as: the account the sign-in recorded; an old hubs.json without one is none, never an error', async () => {
    const probe = async () => ({ ok: true, version: 'maude-hub 2.0.0' });
    let hubs = setup(FULL, undefined, { account: 'you@studio-brno' });
    expect((await hubDetails({ designRoot: dir, hubsPath: () => hubs, probe }))?.account).toBe(
      'you@studio-brno'
    );
    hubs = setup(FULL); // a credential written before the field existed
    expect(
      (await hubDetails({ designRoot: dir, hubsPath: () => hubs, probe }))?.account
    ).toBeNull();
    hubs = setup(FULL, undefined, { account: '<img src=x onerror=alert(1)>' });
    expect(
      (await hubDetails({ designRoot: dir, hubsPath: () => hubs, probe }))?.account
    ).toBeNull();
    hubs = setup(FULL, undefined, { account: { email: 'x@y' } });
    expect(
      (await hubDetails({ designRoot: dir, hubsPath: () => hubs, probe }))?.account
    ).toBeNull();
  });

  test('the last four characters, the version, and nothing else of the token', async () => {
    const hubs = setup(FULL);
    const probed: unknown[][] = [];
    const deps = {
      designRoot: dir,
      hubsPath: () => hubs,
      probe: async (...args: unknown[]) => {
        probed.push(args);
        return { ok: true, version: 'maude-hub 2.0.0' };
      },
    };
    const d = await hubDetails(deps);
    expect(d).toEqual({
      url: 'https://hub.studio-brno.cz',
      credentialed: true,
      tokenLast4: 'a91f',
      healthy: true,
      version: 'maude-hub 2.0.0',
      account: null,
    });
    // the probe is handed the address and nothing else — the token never travels with it
    expect(probed).toEqual([['https://hub.studio-brno.cz']]);
    const [spec] = createConnectionsRoutes(deps);
    expect(spec).toMatchObject({ method: 'GET', path: '/_api/connections/hub', origin: 'main' });
    const body = await (
      await spec!.handle(new Request('http://localhost/_api/connections/hub'))
    ).text();
    expect(body).toContain('a91f');
    expect(body).not.toContain(FULL.slice(0, -4));
    expect(body).not.toContain('0123456789');
  });

  test('a short token shows no characters; a hostile version string is dropped', async () => {
    expect(tokenLast4('short-a91f')).toBeNull();
    expect(tokenLast4(FULL)).toBe('a91f');
    const hubs = setup('tiny');
    const d = await hubDetails({
      designRoot: dir,
      hubsPath: () => hubs,
      probe: async () => ({ ok: true, version: '<img src=x onerror=alert(1)>' }),
    });
    expect(d?.tokenLast4).toBeNull();
    expect(d?.version).toBeNull();
  });

  test('a link this Mac holds no sign-in for is never probed (config.json is committed, B2)', async () => {
    const hubs = setup(null, 'https://attacker.example');
    let probed = 0;
    const d = await hubDetails({
      designRoot: dir,
      hubsPath: () => hubs,
      probe: async () => {
        probed++;
        return { ok: true };
      },
    });
    expect(probed).toBe(0);
    expect(d).toMatchObject({ credentialed: false, tokenLast4: null, version: null });
  });

  test('no link, no details', async () => {
    expect(await hubDetails({ designRoot: dir })).toBeNull();
  });
});

// ── 3. the registry ─────────────────────────────────────────────────────────────────────────────

describe('registry: one action per Connections capability, each on an existing route', () => {
  const want: Record<string, { route: string; minRole?: string }> = {
    'connections.replace-hub-token': { route: '/_api/hub/link' },
    'connections.figma-test': { route: '/_api/figma/probe', minRole: 'edit' },
    'connections.cloud-project-connect': { route: '/_api/cloud/attach', minRole: 'edit' },
    'connections.cloud-project-disconnect': { route: '/_api/cloud/detach' },
  };
  test.each(Object.keys(want))('%s', (id) => {
    const def = ACTIONS_BY_ID.get(id as never);
    expect(def, id).toBeTruthy();
    const ai = (
      AGENT_PATHS as unknown as Record<
        string,
        { server?: { route: string }; minRole?: string; agent: { path: string } }
      >
    )[id];
    expect(ai?.server?.route).toBe(want[id]!.route);
    expect(ai?.minRole).toBe(want[id]!.minRole);
    // an agent never types a token or picks an account
    expect(ai?.agent.path).toBe('human');
    expect(ROLE_REFUSALS.some((r) => r.route === want[id]!.route)).toBe(true);
  });
});

// ── 4. the section, rendered ────────────────────────────────────────────────────────────────────

type Call = { url: string; method: string; body?: string };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
const SECRET = 'tok_SECRET_0123456789_full_value';
const NEW_TOKEN = 'mht_NEW_token_value_typed_by_you_77c2';

const BASE: Record<string, unknown> = {
  '/_api/cloud/status': {
    connected: true,
    email: 'you@studio.cz',
    url: 'https://cloud.maude.sh',
    project: 'Studio site',
    linkedHub: { url: 'https://hub.studio-brno.cz', credentialed: true, token: SECRET },
  },
  '/_api/cloud/projects': { ok: true, projects: [] },
  '/_api/connections/hub': {
    ok: true,
    hub: {
      url: 'https://hub.studio-brno.cz',
      credentialed: true,
      tokenLast4: 'a91f',
      healthy: true,
      version: 'maude-hub 2.0.0',
      account: 'you@studio-brno',
      token: SECRET, // a server that over-shares must still not reach the DOM
    },
  },
  '/_api/hub/link': { ok: true, url: 'https://hub.studio-brno.cz', healthy: true },
  '/_api/generate/providers': {
    providers: [
      { id: 'gemini', label: 'Gemini', configured: true, auth: 'api-key', modalities: ['image'] },
      {
        id: 'elevenlabs',
        label: 'ElevenLabs',
        configured: true,
        auth: 'api-key',
        modalities: ['audio'],
      },
    ],
  },
  '/_api/figma/status': { configured: true, requiredScope: 'file_content:read', token: SECRET },
  '/_api/figma/probe': { ok: true, handle: 'tereza' },
};

function installFetch(over: Record<string, unknown> = {}) {
  calls = [];
  const routes = { ...BASE, ...over };
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.startsWith(k));
    return new Response(JSON.stringify(key ? routes[key] : { ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
}

let Section: (props: Record<string, unknown>) => React.ReactElement;
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Section = (await import('../client/v2/settings/connections-section.jsx'))
    .default as unknown as typeof Section;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  for (const id of FOLD_PANELS) foldStore.set(id, false);
});

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const settle = (ms = 40) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
/** React's own onChange for an element (happy-dom's input events do not reach it). */
function reactProps(el: Element): Record<string, (e: unknown) => unknown> {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  return (el as unknown as Record<string, Record<string, (e: unknown) => unknown>>)[key] ?? {};
}
const type = (el: HTMLInputElement | null, value: string) => {
  if (!el) throw new Error('missing input');
  return act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    reactProps(el).onChange?.({ target: el, currentTarget: el });
  });
};

async function mount(props: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<Section {...props} />));
  await settle(80);
}

describe('Settings › Connections, rendered (06 ad-edge-hub)', () => {
  test('five rows; the team server reads Connected · saved 1 min ago, with Sign out', async () => {
    installFetch();
    await mount({ syncStatus: { lastSyncAt: Date.now() - 61_000 } });
    for (const id of [
      'settings-cloud',
      'settings-conn-hub',
      'settings-github',
      'settings-ai-keys',
      'figma-connect-card',
    ])
      expect(q(id), id).toBeTruthy();
    expect(q('settings-conn-hub')?.textContent).toContain('Studio site — your team’s own server');
    expect(q('settings-conn-hub-status')?.textContent).toBe('Connected · saved 1 min ago');
    expect(q('settings-hub-sign-out')?.textContent).toBe('Sign out');
    expect(q('settings-conn-cloud-status')?.textContent).toBe('Signed in as you@studio.cz');
    expect(q('settings-conn-ai-status')?.textContent).toBe('2 keys · Gemini, ElevenLabs');
    expect(q('settings-conn-figma-status')?.textContent).toBe('Connected · for imports');
    // the v1 rows are not mounted any more
    expect(document.querySelector('.cb-settings, .gi-settings, .v2s-provider-card')).toBeNull();
    // the address and the token are Advanced-only: nothing of them before the fold opens
    expect(document.body.textContent).not.toContain('hub.studio-brno.cz');
    expect(document.body.textContent).not.toContain('a91f');
  });

  test('the e2e-facing hooks stay: the account row, the cloud-bar words, a viewer’s browser door', async () => {
    installFetch({
      '/_api/cloud/projects': {
        ok: true,
        projects: [
          { id: 'gallery', name: 'Stub Gallery', role: 'viewer', url: 'https://g.cloud.maude.sh' },
          { id: 'proj', name: 'Stub Project', role: 'member', url: 'https://p.cloud.maude.sh' },
        ],
      },
    });
    await mount();
    expect(q('cloud-account')?.textContent).toContain('you@studio.cz');
    expect(q('cloud-project-gallery')?.textContent).toBe('View Stub Gallery in the browser');
    expect(q('cloud-project-proj')?.textContent).toBe('Connect Stub Project');
    expect(q('cloud-bar')?.contains(q('settings-cloud-projects'))).toBe(true);
  });

  test('its Advanced: Address (copy), Access token •••• •••• a91f + Replace…, Hub version', async () => {
    installFetch();
    await mount();
    await click(q('fold-connections.hub-toggle'));
    await settle();
    const body = q('fold-connections.hub-body') as HTMLElement;
    expect(body.textContent).toContain('https://hub.studio-brno.cz');
    expect(q('settings-hub-token')?.textContent).toContain('•••• •••• a91f');
    expect(q('settings-hub-token-replace')?.textContent).toBe('Replace…');
    expect(q('settings-hub-version')?.textContent).toContain('maude-hub 2.0.0');
    // P8-T G1b-3 — the board's order: Address · Access token · Signed in as · Hub version
    expect(q('settings-hub-account')?.textContent).toBe('Signed in asyou@studio-brno');
    const order = ['settings-hub-token', 'settings-hub-account', 'settings-hub-version'].map((t) =>
      q(t)
    );
    for (let i = 1; i < order.length; i++)
      expect(
        (order[i - 1] as Node).compareDocumentPosition(order[i] as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    // the token is never rendered beyond its last four
    const html = document.body.innerHTML;
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain('0123456789');
  });

  test('a credential from before the account was recorded draws no Signed in as line, and nothing breaks', async () => {
    const { account: _gone, ...hub } = (
      BASE['/_api/connections/hub'] as { hub: Record<string, unknown> }
    ).hub;
    installFetch({ '/_api/connections/hub': { ok: true, hub } });
    await mount();
    await click(q('fold-connections.hub-toggle'));
    await settle();
    expect(q('settings-hub-token')?.textContent).toContain('•••• •••• a91f');
    expect(q('settings-hub-version')?.textContent).toContain('maude-hub 2.0.0');
    expect(q('settings-hub-account')).toBeNull();
    expect(document.body.textContent).not.toContain('undefined');
  });

  test('Replace… writes through POST /_api/hub/link only, and the typed token leaves the DOM', async () => {
    installFetch();
    await mount();
    await click(q('fold-connections.hub-toggle'));
    await settle();
    await click(q('settings-hub-token-replace'));
    const input = q('settings-hub-token-input') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    await type(input, NEW_TOKEN);
    const before = calls.length;
    await click(q('settings-hub-token-save'));
    await settle(60);
    const writes = calls.slice(before).filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /_api/hub/link']);
    expect(JSON.parse(writes[0]!.body ?? '{}')).toEqual({
      url: 'https://hub.studio-brno.cz',
      token: NEW_TOKEN,
    });
    // the token went into that one body and nowhere else
    expect(calls.filter((c) => (c.body ?? '').includes(NEW_TOKEN)).length).toBe(1);
    expect(calls.some((c) => c.url.includes(NEW_TOKEN))).toBe(false);
    expect(q('settings-hub-token-input')).toBeNull();
    expect(document.body.innerHTML).not.toContain(NEW_TOKEN);
  });

  test('a cloud project link: no team server row is claimed, the address is under Maude Cloud', async () => {
    installFetch({
      '/_api/cloud/status': {
        connected: true,
        email: 'you@studio.cz',
        url: 'https://cloud.maude.sh',
        project: 'Studio site',
        linkedHub: { url: 'https://studio-site.cloud.maude.sh', credentialed: true },
      },
    });
    await mount();
    expect(q('settings-team-server-add')?.textContent).toBe('Add a team server…');
    expect(q('settings-hub-sign-out')).toBeNull();
    await click(q('fold-connections.cloud-toggle'));
    await settle();
    expect(q('settings-hub-address')?.textContent).toContain('https://studio-site.cloud.maude.sh');
    expect(q('settings-hub-token-replace')).toBeNull(); // a cloud token renews itself
  });

  test('Figma: Test spends the token once and says who it is (D14); Disconnect is beside it', async () => {
    installFetch();
    await mount();
    expect(q('figma-disconnect')?.textContent).toBe('Disconnect');
    await click(q('figma-test'));
    await settle();
    expect(calls.filter((c) => c.url === '/_api/figma/probe' && c.method === 'POST').length).toBe(
      1
    );
    expect(q('figma-connected-as')?.textContent).toBe('Connected as tereza');
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  test('02 ob-settings: "AI — your Claude account" (Pro or Max, Connected, Change…) sits between the hub and Figma', async () => {
    installFetch({ '/_api/preflight': { items: [{ id: 'claude', status: 'present' }] } });
    await mount();
    const row = q('settings-claude');
    expect(row?.textContent).toContain('AI — your Claude account');
    expect(row?.textContent).toContain('Pro or Max, or an API key.');
    expect(q('settings-conn-claude-status')?.textContent).toBe('Connected');
    expect(q('settings-claude-action')?.textContent).toBe('Change…');
    const order = [...document.querySelectorAll('[data-conn]')].map((n) =>
      n.getAttribute('data-conn')
    );
    expect(order.slice(0, 4)).toEqual(['cloud', 'hub', 'claude', 'figma']);
    // Change… opens the one Connect sheet, in the row; Cancel closes it
    await click(q('settings-claude-action'));
    expect(row?.querySelector('[data-testid="ai-connect-sheet"]')).toBeTruthy();
    await click(row?.querySelector('[data-testid="ai-connect-cancel"]') ?? null);
    expect(row?.querySelector('[data-testid="ai-connect-sheet"]')).toBeNull();
  });

  test('02 ob-settings: no Claude account reads Not connected with Connect…', async () => {
    installFetch({ '/_api/preflight': { items: [{ id: 'claude', status: 'missing' }] } });
    await mount();
    expect(q('settings-conn-claude-status')?.textContent).toBe('Not connected');
    expect(q('settings-claude-action')?.textContent).toBe('Connect…');
  });

  test('02 ob-settings: Figma without a token is the collapsed "Add token…" row; the field opens on it', async () => {
    installFetch({
      '/_api/figma/status': { configured: false, requiredScope: 'file_content:read' },
    });
    await mount();
    expect(q('settings-conn-figma-status')?.textContent).toBe('No token');
    expect(q('figma-connect-input')).toBeNull();
    expect(q('figma-add-token')?.textContent).toBe('Add token…');
    await click(q('figma-add-token'));
    expect(q('figma-connect-input')).toBeTruthy();
    await click(q('figma-add-token'));
    expect(q('figma-connect-input')).toBeNull();
  });

  test('the section mounts none of the v1 Settings rows', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'client', 'v2', 'settings', 'connections-section.jsx'),
      'utf8'
    );
    expect(src).not.toMatch(/import CloudBar\b/);
    const imports = src.match(/^import[^;]*;/gms)?.join('\n') ?? '';
    expect(src).not.toMatch(/import IdentityBar\b/);
    expect(imports).not.toMatch(/\bFigmaConnectCard\b/);
    expect(imports).not.toMatch(/\bProviderKeys\b/);
  });
});
