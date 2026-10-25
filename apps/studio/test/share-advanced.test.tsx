// S9.20 — Share › Advanced, the link row's rules, local → cloud and the Settings account block,
// against the REAL components (happy-dom + React) with the studio's answers stubbed per case:
//  · co-share-advanced: This link (who / role / expires) only for the owner where the hub has links;
//    Copy link MAKES the link with those rules (the server's call), a rule change PATCHes it, Turn
//    off ends it; a non-owner copies the location and never asks the server to make one;
//  · the self-hosted variant from `/health.access`: no link rules, "Roles on this hub" says what is
//    missing, Where it syncs shows the hub's own address;
//  · ob-local-share / ob-local-moved / co-local-cloud: a local project's Share (desktop) offers
//    Move to cloud, sends the window's own POST, follows the move and opens on Invite once linked;
//  · ⌘K Link settings… / File › Share on GitHub… open the sheet on their row (one-shot focus);
//  · ob-settings: Plan "Free trial · N days left", Manage on <host>, the five account pages.
//  · S9.20b: "New people join as" sets the role the Invite row pre-selects (this browser, per
//    project; storage that throws falls back to Can edit) — the invite still sends its own role;
//    "Last synced" is the sync runtime's `lastSyncAt`, and no line is drawn without one.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (s: string) => void copiedText.push(s) },
  });
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccountBlock, planWords } from '../client/v2/settings/account.jsx';
import {
  advancedView,
  expiresAtFor,
  JOIN_AS_FALLBACK,
  joinAsKey,
  lastSyncedAt,
  readJoinAs,
  requestShareFocus,
  sheetView,
  writeJoinAs,
} from '../client/v2/share/share-model.js';
import { ShareSheet } from '../client/v2/share/share-sheet.jsx';
import { whenWords } from '../client/v2/sync-states/sync-states-model.js';

const copiedText: string[] = [];
const NOW = Date.UTC(2026, 9, 19, 12);
const DAY = 86_400_000;
const HUB = 'https://alligators.cloud.maude.sh';

const ROLES_V2 = {
  linked: true,
  reachable: true,
  hub: HUB,
  capabilities: ['roles-v2'],
  access: {
    authority: 'control-plane',
    roles: ['observer', 'viewer', 'member', 'owner'],
    scopes: ['project', 'canvas'],
    links: true,
    requests: true,
  },
};
const V1_CLOUD = {
  ...ROLES_V2,
  capabilities: [],
  access: {
    ...ROLES_V2.access,
    roles: ['viewer', 'member', 'owner'],
    scopes: ['project'],
    links: false,
  },
};
const SELF_HOSTED = {
  linked: true,
  reachable: true,
  hub: 'https://hub.studio-brno.cz',
  capabilities: [],
  access: {
    authority: 'hub',
    roles: ['member', 'owner'],
    scopes: ['project'],
    links: false,
    requests: true,
  },
};
const OWNER_ME = { role: 'owner', grants: [], caps: { invite: true, read: true } };
const MEMBER_ME = { role: 'member', grants: [], caps: { invite: false, read: true } };

type Call = [string, ...unknown[]];
function stubApi(over: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const ok = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, body });
  const postures = (over.postures as unknown[] | undefined) ?? null;
  let postureN = 0;
  const moves = (over.moves as unknown[] | undefined) ?? [{ state: 'ready', project: 'p' }];
  let moveN = 0;
  const api = {
    posture: () => {
      calls.push(['posture']);
      const p = postures ? postures[Math.min(postureN++, postures.length - 1)] : over.posture;
      return ok(p ?? ROLES_V2);
    },
    me: () => ok(over.me ?? OWNER_ME),
    people: () => ok({ people: [{ id: 'u_me', name: 'michal', role: 'owner', email: 'm@a.cz' }] }),
    invite: (b: unknown) => {
      calls.push(['invite', b]);
      return ok({ id: 'inv' }, 201);
    },
    resend: () => ok({}),
    revoke: () => ok(null, 204),
    setRole: () => ok({ ok: true }),
    remove: () => ok(null, 204),
    createLink: (b: unknown) => {
      calls.push(['createLink', b]);
      return ok({ id: 'lnk_0123456789abcdef', url: `${HUB}/l/lnk_0123456789abcdef.s1` }, 201);
    },
    patchLink: (id: string, b: unknown) => {
      calls.push(['patchLink', id, b]);
      return (b as { who?: string }).who === 'anyone'
        ? ok({ id, url: `${HUB}/l/${id}.s2` })
        : ok({ id });
    },
    moveToCloud: () => {
      calls.push(['moveToCloud']);
      return (
        (over.move as () => Promise<unknown>)?.() ??
        ok({ ok: true, project: 'p', state: 'provisioning' })
      );
    },
    moveState: () => {
      calls.push(['moveState']);
      return ok(moves[Math.min(moveN++, moves.length - 1)]);
    },
    githubInvite: (u: string) => {
      calls.push(['githubInvite', u]);
      return ok({ ok: true, username: u });
    },
    syncStatus: () => {
      calls.push(['syncStatus']);
      return ok(over.sync ?? { linked: true, state: 'online', lastSyncAt: null });
    },
  };
  return { api, calls };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  copiedText.length = 0;
});

const TARGET = {
  path: '.design/ui/Combine-kampan.tsx',
  rel: 'ui/Combine-kampan.tsx',
  label: 'Combine-kampan',
};
const LINKS = {
  web: `${HUB}/?open=ui%2FCombine-kampan.tsx`,
  app: 'maude://open/alligators?open=ui%2FCombine-kampan.tsx',
  local: 'http://localhost:4402/?open=ui%2FCombine-kampan.tsx',
};
const tick = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

async function mount(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const { api, calls } = stubApi(over);
  let closed = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ShareSheet
        target={TARGET}
        links={LINKS}
        shell="native"
        project="Alligators brand"
        api={api}
        now={NOW}
        onClose={() => {
          closed += 1;
        }}
        {...props}
      />
    );
  });
  await tick();
  const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { calls, q, closed: () => closed };
}
const click = async (el: Element | null) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await tick();
};
/** React's onChange for a select (a dispatched change does not reach it under happy-dom). */
async function pick(el: HTMLElement | null, value: string) {
  // happy-dom's select hides its own keys from listing: the per-root key is read off an input
  const field = host?.querySelector('input') ?? el;
  const key = Object.keys(field as object).find((k) => k.startsWith('__reactProps'));
  await act(async () => {
    (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key as string].onChange({
      target: { value },
    });
  });
  await tick();
}
const openAdvanced = async (q: (id: string) => HTMLElement | null) => {
  if (q('share-other-ways-toggle')?.getAttribute('aria-expanded') !== 'true')
    await click(q('share-other-ways-toggle'));
};

describe('model — what Advanced draws comes from the server', () => {
  test('rules only for the owner where the hub has links; the matrix has the reported roles', () => {
    const v2Owner = sheetView({ posture: ROLES_V2, me: OWNER_ME, target: TARGET });
    const v2Member = sheetView({ posture: ROLES_V2, me: MEMBER_ME, target: TARGET });
    const v1Owner = sheetView({ posture: V1_CLOUD, me: OWNER_ME, target: TARGET });
    expect(advancedView({ view: v2Owner, shell: 'native', hubUrl: HUB }).rules).toBe(true);
    expect(advancedView({ view: v2Member, shell: 'native', hubUrl: HUB }).rules).toBe(false);
    expect(advancedView({ view: v1Owner, shell: 'native', hubUrl: HUB }).rules).toBe(false);
    expect(advancedView({ view: v1Owner, shell: 'native', hubUrl: HUB }).matrix).toEqual([
      'owner',
      'member',
      'viewer',
    ]);
    expect(advancedView({ view: v1Owner, shell: 'cloud', hubUrl: HUB }).github).toBe(false);
    const self = advancedView({
      view: sheetView({ posture: SELF_HOSTED, me: OWNER_ME, target: TARGET }),
      shell: 'native',
      hubUrl: SELF_HOSTED.hub,
    });
    expect([self.rules, self.matrix, self.hubRoles]).toEqual([
      false,
      null,
      { available: ['Can edit'], missing: ['Can comment', 'Can view'] },
    ]);
    expect(expiresAtFor('7d', NOW)).toBe(new Date(NOW + 7 * DAY).toISOString());
    expect(expiresAtFor('never', NOW)).toBeNull();
  });
});

describe('the link and its rules (co-share-advanced)', () => {
  test('the owner: Copy link makes the link with the rules; a change PATCHes it; Turn off ends it', async () => {
    const { q, calls } = await mount({ posture: ROLES_V2 });
    await openAdvanced(q);
    expect(q('share-link-rules')).not.toBeNull();
    await pick(q('share-link-who'), 'anyone');
    await pick(q('share-link-expires'), '7d');
    expect(calls.filter((c) => c[0] === 'createLink' || c[0] === 'patchLink')).toEqual([]);
    expect(q('share-link-row')?.textContent).toContain('Anyone with the link');
    await click(q('share-link-copy'));
    expect(calls.find((c) => c[0] === 'createLink')).toEqual([
      'createLink',
      {
        role: 'observer',
        who: 'anyone',
        expiresAt: new Date(NOW + 7 * DAY).toISOString(),
        canvas: 'ui/Combine-kampan.tsx',
      },
    ]);
    expect(copiedText).toEqual([`${HUB}/l/lnk_0123456789abcdef.s1`]);
    // a second Copy copies the same link — it does not make another
    await click(q('share-link-copy'));
    expect(calls.filter((c) => c[0] === 'createLink')).toHaveLength(1);
    await pick(q('share-link-role'), 'viewer');
    expect(calls.filter((c) => c[0] === 'patchLink')).toEqual([
      ['patchLink', 'lnk_0123456789abcdef', { role: 'viewer' }],
    ]);
    await click(q('share-link-off'));
    expect(calls.filter((c) => c[0] === 'patchLink').at(-1)).toEqual([
      'patchLink',
      'lnk_0123456789abcdef',
      { off: true },
    ]);
    expect(q('share-link-off')).toBeNull();
  });

  test('P8 c8 (10 co-share-advanced): Role is a live select even on a Team only link; values are wide enough to read whole; no extra hint under App link', async () => {
    const { q } = await mount({ posture: ROLES_V2 }, { links: { ...LINKS, appIsLocalOnly: true } });
    await openAdvanced(q);
    expect((q('share-link-who') as HTMLSelectElement).value).toBe('team');
    // the board draws Role enabled in this state (the link row's sub-line already says the role of a team link)
    expect((q('share-link-role') as HTMLSelectElement).disabled).toBe(false);
    // a value is as wide as its text, so the ellipsis only ever appears when the sheet itself is too narrow
    for (const id of ['share-app-url', 'share-local-url', 'share-syncs-hub']) {
      const input = q(id) as HTMLInputElement;
      expect(input.style.width, id).toBe(`${input.value.length + 1}ch`);
    }
    expect(q('share-other-ways')?.textContent).not.toContain('Opens the folder on this Mac only.');
  });

  test('someone who may not invite: no rules, and Copy link copies the location only', async () => {
    const { q, calls } = await mount({ posture: ROLES_V2, me: MEMBER_ME });
    await openAdvanced(q);
    expect(q('share-link-rules')).toBeNull();
    await click(q('share-link-copy'));
    expect(calls.filter((c) => c[0] === 'createLink')).toEqual([]);
    expect(copiedText).toEqual([LINKS.web]);
  });

  test('before the flip (no links): no link row and no rules; the roles side by side without Can view', async () => {
    const { q } = await mount({ posture: V1_CLOUD });
    await openAdvanced(q);
    expect(q('share-link-row')).toBeNull();
    expect(q('share-link-rules')).toBeNull();
    const heads = [...(q('share-role-matrix')?.querySelectorAll('thead th') ?? [])].map(
      (th) => th.textContent
    );
    expect(heads).toEqual(['What', 'Owner', 'Can edit', 'Can comment']);
    expect((q('share-syncs-hub') as HTMLInputElement | null)?.value).toBe(HUB);
  });
});

describe('a project on a self-hosted hub (co-share-advanced, right)', () => {
  test('its own address, only the roles it holds, no link rules, no matrix', async () => {
    const { q } = await mount({ posture: SELF_HOSTED });
    // the hint names what's inside while the fold is CLOSED; open, the body says it (kit fold, 06 Advanced).
    // The fold is remembered per panel, so an earlier test may have left it open: close it first.
    if (q('share-other-ways-toggle')?.getAttribute('aria-expanded') === 'true')
      await click(q('share-other-ways-toggle'));
    expect(q('share-other-ways')?.textContent).toContain('Other ways in, sync, roles');
    await openAdvanced(q);
    expect(q('share-other-ways')?.textContent).not.toContain('Other ways in, sync, roles');
    expect(q('share-other-ways')?.textContent).toContain('Other ways in');
    expect((q('share-syncs-hub') as HTMLInputElement | null)?.value).toBe(
      'https://hub.studio-brno.cz'
    );
    expect(q('share-hub-roles-missing')?.textContent).toContain('Can comment · Can view');
    expect(q('share-hub-roles-missing')?.textContent).toContain('no view-only accounts');
    expect(q('share-link-rules')).toBeNull();
    expect(q('share-role-matrix')).toBeNull();
  });
});

describe('Invite by GitHub username (takes over project.share-github)', () => {
  test('File › Share on GitHub… opens the sheet with Advanced open on the GitHub row', async () => {
    requestShareFocus('github');
    const { q, calls } = await mount({ posture: V1_CLOUD });
    expect(q('share-other-ways-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(q('share-github-username'));
    const field = q('share-github-username') as HTMLInputElement;
    const key = Object.keys(field).find((k) => k.startsWith('__reactProps')) as string;
    await act(async () => {
      (field as unknown as Record<string, { onChange: (e: unknown) => void }>)[key].onChange({
        target: { value: '@tereza' },
      });
    });
    await click(q('share-github-invite'));
    expect(calls.find((c) => c[0] === 'githubInvite')).toEqual(['githubInvite', 'tereza']);
    expect(q('share-github-done')?.textContent).toContain('Invited @tereza.');
  });

  test('not in a browser shell', async () => {
    const { q } = await mount({ posture: V1_CLOUD }, { shell: 'cloud' });
    await openAdvanced(q);
    expect(q('share-github')).toBeNull();
  });
});

describe('local → cloud (ob-local-share · ob-local-moved · co-local-cloud)', () => {
  test('a local project offers Move to cloud, moves, then opens on Invite once linked', async () => {
    const { q, calls } = await mount({
      postures: [{ linked: false }, ROLES_V2],
      moves: [{ state: 'ready', project: 'p' }],
    });
    expect(q('share-move')?.textContent).toContain('Move “Alligators brand” to the cloud?');
    expect(q('share-move')?.textContent).toContain('Only need a file? Menu › Export…');
    expect(q('share-invite-email')).toBeNull();
    await click(q('share-move-confirm'));
    expect(calls.filter((c) => c[0] === 'moveToCloud')).toHaveLength(1);
    expect(q('share-move')).toBeNull();
    expect(q('share-moved')?.textContent).toContain('Setting up the cloud project');
    await tick(1600);
    await tick();
    expect(calls.filter((c) => c[0] === 'moveState')).toHaveLength(1);
    expect(q('share-moved')?.textContent).toBe(
      'Moved to the cloud — your canvases are going up now.'
    );
    expect(q('share-invite-email')).not.toBeNull();
  });

  test('a refusal keeps the project local and says why', async () => {
    const { q } = await mount({
      posture: { linked: false },
      move: () =>
        Promise.resolve({
          ok: false,
          status: 402,
          body: { error: 'Choose a plan to keep editing.' },
        }),
    });
    await click(q('share-move-confirm'));
    expect(q('share-move-error')?.textContent).toBe('Choose a plan to keep editing.');
    expect(q('share-move')).not.toBeNull();
  });

  test('Cancel closes; a browser shell gets the one line instead of the offer', async () => {
    const a = await mount({ posture: { linked: false } });
    const cancel = [...(a.q('share-move')?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Cancel'
    );
    await click(cancel ?? null);
    expect(a.closed()).toBe(1);
    act(() => root?.unmount());
    host?.remove();
    const b = await mount({ posture: { linked: false } }, { shell: 'local' });
    expect(b.q('share-move')).toBeNull();
    expect(b.q('share-local-note')?.textContent).toContain('Local project — kept on this Mac.');
  });
});

describe('Settings › General › Account (ob-settings)', () => {
  async function mountAccount(props: Record<string, unknown>) {
    const opened: string[] = [];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<AccountBlock cloud={null} {...props} open={(u: string) => opened.push(u)} />);
    });
    const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    return { q, opened };
  }

  test('signed in: plan, Manage on <host>, the five account pages — each opens the web page', async () => {
    const { q, opened } = await mountAccount({
      account: {
        connected: true,
        email: 'you@studio.cz',
        url: 'https://cloud.maude.sh',
        plan: { state: 'trialing', daysLeft: 12 },
      },
    });
    expect(q('settings-account-state')?.textContent).toBe('Signed in to cloud.maude.sh');
    expect(q('settings-account-plan')?.textContent).toBe('Free trial · 12 days left');
    expect(q('settings-open-dashboard')?.textContent).toBe('Manage on cloud.maude.sh');
    const links = [...(q('settings-account-links')?.querySelectorAll('button') ?? [])];
    expect(links.map((b) => b.textContent?.replace('↗', ''))).toEqual([
      'People and invites',
      'Billing and plan',
      'Your Macs',
      'Download everything',
      'Delete the account',
    ]);
    for (const b of links) await click(b);
    expect(opened).toEqual([
      'https://cloud.maude.sh/account/people',
      'https://cloud.maude.sh/account/billing',
      'https://cloud.maude.sh/account/macs',
      'https://cloud.maude.sh/account/download',
      'https://cloud.maude.sh/account/delete',
    ]);
  });

  test('no plan reported → no plan line; signed out → no account pages; a read-only link → nothing', async () => {
    const a = await mountAccount({
      account: { connected: true, email: 'y@s.cz', url: 'https://cloud.maude.sh', plan: null },
    });
    expect(a.q('settings-account-plan')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const b = await mountAccount({
      account: { connected: false, email: null, url: 'https://cloud.maude.sh', plan: null },
    });
    expect(b.q('settings-account-state')?.textContent).toBe('Not signed in');
    expect(b.q('settings-account-links')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const c = await mountAccount({ readOnly: true, account: null });
    expect(c.q('settings-account')).toBeNull();
  });

  test('plan words', () => {
    expect(planWords({ state: 'trialing', daysLeft: 1 })).toBe('Free trial · 1 day left');
    expect(planWords({ state: 'ended', daysLeft: 0 })).toBe(
      'Trial ended · Choose a plan to keep editing'
    );
    expect(planWords(null)).toBeNull();
  });
});

describe('S9.20b — New people join as (the Invite row default, this browser)', () => {
  const KEY = joinAsKey({ hub: HUB, project: 'Alligators brand' }) as string;
  afterEach(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* happy-dom storage */
    }
  });

  test('the row sets the role Invite pre-selects, is remembered per project, and the invite sends its own role', async () => {
    const a = await mount({ posture: ROLES_V2 });
    await openAdvanced(a.q);
    const row = a.q('share-join-as') as HTMLSelectElement;
    expect(row).not.toBeNull();
    expect(row.value).toBe('member'); // nothing remembered → Can edit
    expect((a.q('share-invite-role') as HTMLSelectElement).value).toBe('member');
    await pick(row, 'viewer');
    expect((a.q('share-invite-role') as HTMLSelectElement).value).toBe('viewer');
    expect(localStorage.getItem(KEY)).toBe('viewer');

    // the invite carries its explicit role (the server checks it — no hub default field exists)
    await pick(a.q('share-invite-email'), 'lukas@example.com');
    const form = a.q('share-invite') as HTMLFormElement;
    const key = Object.keys(a.q('share-invite-email') as object).find((k) =>
      k.startsWith('__reactProps')
    ) as string;
    await act(async () => {
      await (form as unknown as Record<string, { onSubmit: (e: unknown) => unknown }>)[
        key
      ].onSubmit({ preventDefault() {} });
    });
    await tick();
    const sent = a.calls.find((c) => c[0] === 'invite');
    expect(sent?.[1]).toMatchObject({ email: 'lukas@example.com', role: 'viewer' });

    act(() => root?.unmount());
    host?.remove();
    const b = await mount({ posture: ROLES_V2 });
    expect((b.q('share-invite-role') as HTMLSelectElement).value).toBe('viewer');
  });

  test('only where the link rules are drawn (the owner, a hub with links)', async () => {
    const m = await mount({ posture: ROLES_V2, me: MEMBER_ME });
    await openAdvanced(m.q);
    expect(m.q('share-join-as')).toBeNull();
  });

  test('storage that is missing or throws falls back to Can edit; a role an invite cannot give is ignored', () => {
    const throwing = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readJoinAs(KEY, throwing)).toBe(JOIN_AS_FALLBACK);
    expect(JOIN_AS_FALLBACK).toBe('member');
    expect(() => writeJoinAs(KEY, 'viewer', throwing)).not.toThrow();
    const box = new Map<string, string>([[KEY, 'owner']]);
    const mapStore = {
      getItem: (k: string) => box.get(k) ?? null,
      setItem: (k: string, v: string) => void box.set(k, v),
    } as unknown as Storage;
    expect(readJoinAs(KEY, mapStore)).toBe('member');
    writeJoinAs(KEY, 'owner', mapStore);
    expect(box.get(KEY)).toBe('owner'); // untouched: owner is never written
    expect(readJoinAs(null, mapStore)).toBe('member');
  });
});

describe('S9.20b — Last synced under Where it syncs', () => {
  test("the sync runtime's lastSyncAt, in the CONTRACT clock", async () => {
    const at = NOW - 2 * DAY;
    const { q } = await mount({ posture: ROLES_V2, sync: { linked: true, lastSyncAt: at } });
    await openAdvanced(q);
    expect(q('share-syncs-last')?.textContent).toBe(whenWords(at, NOW));
  });

  test('no time the runtime knows → no line', async () => {
    const { q } = await mount({ posture: ROLES_V2, sync: { linked: false } });
    await openAdvanced(q);
    expect(q('share-syncs-hub')).not.toBeNull();
    expect(q('share-syncs-last')).toBeNull();
    expect(lastSyncedAt({ linked: true, lastSyncAt: 'yesterday' })).toBeNull();
    expect(lastSyncedAt(null)).toBeNull();
  });
});
