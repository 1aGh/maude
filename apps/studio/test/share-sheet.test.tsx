// S9.19 — the Share sheet against the REAL components (happy-dom + React), with the studio's
// `/_api/share/*` answers stubbed per case:
//  · Q13 (S9-slices): before the lead flips `roles-v2` a cell reports roles [viewer, member, owner],
//    scopes [project], links false — Can view, This canvas and the link row are NOT drawn; after it,
//    they are. A self-hosted hub offers Can edit only;
//  · Share opens on Invite (the field is focused), Invite is the primary button;
//  · a person who may not invite gets no Invite row and no role menus (the hub refuses anyway);
//  · pending invites say "expires in N days" with Resend; Remove asks first; an offline invite says
//    "Invites send when this Mac is online.";
//  · the retired dialog's testids are re-emitted (share-dialog, share-<kind>-url, Close share dialog).
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
import { expiresIn, peopleRows, sheetView } from '../client/v2/share/share-model.js';
import { ShareSheet } from '../client/v2/share/share-sheet.jsx';

const NOW = Date.UTC(2026, 9, 18, 12);
const DAY = 86_400_000;

const V1_CLOUD = {
  linked: true,
  reachable: true,
  capabilities: [],
  access: {
    authority: 'control-plane',
    roles: ['viewer', 'member', 'owner'],
    scopes: ['project'],
    links: false,
    requests: true,
  },
};
const ROLES_V2 = {
  linked: true,
  reachable: true,
  capabilities: ['roles-v2'],
  access: {
    authority: 'control-plane',
    roles: ['observer', 'viewer', 'member', 'owner'],
    scopes: ['project', 'canvas'],
    links: true,
    requests: true,
  },
};
const SELF_HOSTED = {
  linked: true,
  reachable: true,
  capabilities: [],
  access: {
    authority: 'hub',
    roles: ['member', 'owner'],
    scopes: ['project'],
    links: false,
    requests: true,
  },
};
const PEOPLE = [
  { id: 'u_me', name: 'michal', role: 'owner', email: 'michal@alligators.cz' },
  { id: 'u_t', name: 'tereza', role: 'member', email: 'tereza@alligators.cz' },
  { id: 'u_j', name: 'jonas', role: 'viewer', email: 'jonas@alligators.cz' },
  {
    id: 'inv_p',
    name: 'petra@alligators.cz',
    role: 'viewer',
    email: 'petra@alligators.cz',
    state: 'invited',
    expiresAt: NOW + 5 * DAY - 1000,
  },
  { id: 'req_1', name: 'vojta', role: null, email: 'vojta@x.cz', state: 'requested' },
];
const OWNER_ME = { role: 'owner', grants: [], caps: { invite: true, read: true } };
const MEMBER_ME = { role: 'member', grants: [], caps: { invite: false, read: true } };

type Call = [string, ...unknown[]];
function stubApi(over: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const ok = (body: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, body });
  const log =
    <T,>(name: string, answer: (...a: never[]) => T) =>
    (...args: unknown[]): T => {
      calls.push([name, ...args]);
      return (answer as (...a: unknown[]) => T)(...args);
    };
  const hook = (k: string) => over[k] as (() => Promise<unknown>) | undefined;
  const api = {
    posture: log('posture', () => ok(over.posture ?? V1_CLOUD)),
    me: log('me', () => ok(over.me ?? OWNER_ME)),
    people: (canvas?: string) => {
      calls.push(['people', canvas ?? null]);
      return ok({ people: over.people ?? PEOPLE });
    },
    invite: log(
      'invite',
      () => hook('invite')?.() ?? ok({ id: 'inv_new', expiresAt: NOW + 7 * DAY }, 201)
    ),
    resend: log('resend', () => ok({ expiresAt: NOW + 7 * DAY })),
    revoke: log('revoke', () => ok(null, 204)),
    setRole: log('setRole', () => hook('setRole')?.() ?? ok({ ok: true })),
    remove: log('remove', () => ok(null, 204)),
  };
  return { api, calls };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const TARGET = {
  path: '.design/ui/Combine-kampan.tsx',
  rel: 'ui/Combine-kampan.tsx',
  label: 'Combine-kampan',
};
const LINKS = {
  web: 'https://alligators.cloud.maude.sh/?c=ui/Combine-kampan.tsx',
  app: 'maude://alligators/combine-kampan',
  local: 'http://localhost:4402/?c=Combine-kampan',
};

async function mount(over: Record<string, unknown> = {}) {
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
        youEmail="michal@alligators.cz"
        api={api}
        now={NOW}
        onClose={() => {
          closed += 1;
        }}
      />
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const options = () =>
    [...(q('share-invite-role')?.querySelectorAll('option') ?? [])].map((o) => o.textContent);
  return { calls, q, options, closed: () => closed };
}

const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
  });

/**
 * React's own handler for an element (a dispatched `input` / `change` / `submit` does not reach it
 * under happy-dom). React keeps a node's current props under one per-root key; happy-dom's form and
 * select hide their own keys from listing, so the key's name is read off the e-mail field.
 */
function reactProps(el: Element): Record<string, (e: unknown) => unknown> {
  const field = document.querySelector('[data-testid="share-invite-email"]') ?? el;
  const key = Object.getOwnPropertyNames(field).find((k) =>
    k.startsWith('__reactProps$')
  ) as string;
  return (el as unknown as Record<string, Record<string, (e: unknown) => unknown>>)[key] ?? {};
}
async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    reactProps(el).onChange?.({ target: el, currentTarget: el });
  });
}
async function pickRole(q: (id: string) => HTMLElement | null, value: string) {
  const sel = q('share-invite-role') as HTMLSelectElement;
  await act(async () => {
    reactProps(sel).onChange?.({ target: { value }, currentTarget: sel });
  });
}
async function submitInvite(q: (id: string) => HTMLElement | null) {
  await act(async () => {
    await reactProps(q('share-invite') as HTMLElement).onSubmit?.({ preventDefault() {} });
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('Q13 — the sheet draws only what the hub reports', () => {
  test('before the roles-v2 flip: no Can view, no This canvas, no link row', async () => {
    const { q, options, calls } = await mount({ posture: V1_CLOUD });
    expect(q('share-scope')).toBeNull();
    expect(options()).toEqual(['Can edit', 'Can comment']);
    expect(q('share-link-row')).toBeNull();
    // The whole project is the scope: people are asked for without a canvas.
    expect(calls.filter((c) => c[0] === 'people')).toEqual([['people', null]]);
    await click(q('share-person-role-u_t'));
    expect(q('share-role-observer')).toBeNull();
    expect(q('share-role-viewer')).not.toBeNull();
    // Make owner is hidden until an ownership-transfer route exists (v2-lead-make-owner-hidden).
    expect(q('share-role-make-owner')).toBeNull();
  });

  test('after it: the scope segment (This canvas first), Can view and the link row', async () => {
    const { q, options, calls } = await mount({ posture: ROLES_V2 });
    expect(q('share-scope')).not.toBeNull();
    expect(q('share-scope-canvas')?.getAttribute('aria-pressed')).toBe('true');
    expect(options()).toEqual(['Can edit', 'Can comment', 'Can view']);
    expect(q('share-link-row')?.textContent).toContain('Copy link');
    expect(calls.filter((c) => c[0] === 'people')).toEqual([['people', 'ui/Combine-kampan.tsx']]);
    await click(q('share-person-role-u_t'));
    expect(q('share-role-observer')?.textContent).toContain('Look only');
    expect(q('share-role-remove')?.textContent).toBe('Remove from Combine-kampan');
    await click(q('share-scope-project'));
    expect(calls.filter((c) => c[0] === 'people').at(-1)).toEqual(['people', null]);
  });

  test('a self-hosted hub offers Can edit only', async () => {
    const { options, q } = await mount({ posture: SELF_HOSTED });
    expect(options()).toEqual(['Can edit']);
    expect(q('share-scope')).toBeNull();
  });

  test('the model: an unreachable hub falls back to what every hub holds', () => {
    const v = sheetView({
      posture: { linked: true, reachable: false, you: { invite: true } },
      target: TARGET,
    });
    expect([v.inviteRoles, v.showScope, v.showLinkRow, v.canInvite]).toEqual([
      ['member'],
      false,
      false,
      true,
    ]);
  });
});

describe('Invite first', () => {
  test('the e-mail field has focus; Invite is primary and needs an address', async () => {
    const { q } = await mount();
    expect(document.activeElement).toBe(q('share-invite-email'));
    expect(q('share-invite-submit')?.className).toContain('btn--primary');
    expect((q('share-invite-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  test('Invite sends the address, the role and the scope’s canvas', async () => {
    const { q, calls } = await mount({ posture: ROLES_V2 });
    await typeInto(q('share-invite-email') as HTMLInputElement, 'lukas.novak@gmail.com');
    await pickRole(q, 'observer');
    expect((q('share-invite-submit') as HTMLButtonElement).disabled).toBe(false);
    await submitInvite(q);
    expect(calls.find((c) => c[0] === 'invite')).toEqual([
      'invite',
      { email: 'lukas.novak@gmail.com', role: 'observer', canvas: 'ui/Combine-kampan.tsx' },
    ]);
    expect(q('share-invite-sent')?.textContent).toBe('Invited lukas.novak@gmail.com · Can view');
  });

  test('offline: the invite waits, and says so', async () => {
    const { q } = await mount({
      invite: () =>
        Promise.resolve({
          ok: true,
          status: 202,
          body: { queued: true, words: 'Invites send when this Mac is online.' },
        }),
    });
    await typeInto(q('share-invite-email') as HTMLInputElement, 'petra@alligators.cz');
    await submitInvite(q);
    expect(q('share-invite-queued')?.textContent).toBe('Invites send when this Mac is online.');
  });

  test('a self-hosted hub sends no mail: the invitation link is shown to pass on', async () => {
    const { q } = await mount({
      posture: SELF_HOSTED,
      invite: () =>
        Promise.resolve({
          ok: true,
          status: 201,
          body: { id: 'i1', sent: false, url: 'https://hub.example/invite/abc' },
        }),
    });
    await typeInto(q('share-invite-email') as HTMLInputElement, 'jonas@alligators.cz');
    await submitInvite(q);
    expect(q('share-invite-link')?.querySelector('input')?.value).toBe(
      'https://hub.example/invite/abc'
    );
  });
});

describe('people', () => {
  test('rows in words: You first, roles strongest first, requests left to their own block', async () => {
    const { q } = await mount();
    const names = [...(q('share-people')?.querySelectorAll('.v2sh-pp-n') ?? [])].map(
      (n) => n.textContent
    );
    expect(names).toEqual(['You', 'tereza', 'jonas', 'petra@alligators.cz']);
    expect(q('share-people')?.textContent).toContain('3 people · 1 invited');
    expect(q('share-person-req_1')).toBeNull();
    expect(q('share-person-role-u_me')?.tagName).toBe('SPAN'); // your own row is quiet
    expect(q('share-person-role-u_j')?.textContent).toContain('Can comment');
  });

  test('a pending invite: "expires in 5 days" and Resend', async () => {
    const { q, calls } = await mount();
    expect(q('share-person-inv_p')?.textContent).toContain('Invited · expires in 5 days');
    await click(q('share-person-resend-inv_p'));
    expect(calls.find((c) => c[0] === 'resend')).toEqual(['resend', 'inv_p']);
  });

  test('a role change asks the hub, and its refusal is shown in its own words', async () => {
    const { q, calls } = await mount({
      setRole: () =>
        Promise.resolve({
          ok: false,
          status: 422,
          body: { error: 'Only the owner can change that.', reason: 'forbidden' },
        }),
    });
    await click(q('share-person-role-u_j'));
    await click(q('share-role-member'));
    expect(calls.find((c) => c[0] === 'setRole')).toEqual(['setRole', 'u_j', 'member', null]);
    expect(q('share-error')?.textContent).toBe('Only the owner can change that.');
  });

  test('Remove asks first, then removes from the scope', async () => {
    const { q, calls } = await mount({ posture: ROLES_V2 });
    await click(q('share-person-role-u_t'));
    await click(q('share-role-remove'));
    expect(q('share-remove-dialog')?.textContent).toContain('Remove tereza from Combine-kampan?');
    expect(calls.find((c) => c[0] === 'remove')).toBeUndefined();
    await click(q('share-remove-confirm'));
    expect(calls.find((c) => c[0] === 'remove')).toEqual([
      'remove',
      'u_t',
      'ui/Combine-kampan.tsx',
    ]);
    expect(q('share-remove-dialog')).toBeNull();
  });

  test('a pending invite’s Remove takes the invitation back', async () => {
    const { q, calls } = await mount();
    await click(q('share-person-role-inv_p'));
    expect(q('share-role-viewer')).toBeNull(); // a pending invite has no role to change
    await click(q('share-role-remove'));
    await click(q('share-remove-confirm'));
    expect(calls.find((c) => c[0] === 'revoke')).toEqual(['revoke', 'inv_p']);
  });

  test('a person who may not invite: no Invite row, no role menus — the hub would refuse', async () => {
    const { q } = await mount({
      me: MEMBER_ME,
      people: PEOPLE.filter((p) => !p.state).map(({ email: _e, ...p }) => p),
    });
    expect(q('share-invite')).toBeNull();
    expect(q('share-owner-only')?.textContent).toContain('Ask the owner to change this.');
    expect(q('share-person-role-u_t')?.tagName).toBe('SPAN');
    expect(host?.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });
});

describe('the retired dialog’s hooks, re-emitted', () => {
  test('root, close button, and the web / app / local links under Other ways in', async () => {
    const { q, closed } = await mount();
    expect(q('share-dialog')?.getAttribute('role')).toBe('dialog');
    await click(host?.querySelector('[aria-label="Close share dialog"]') ?? null);
    expect(closed()).toBe(1);
    const fold = q('share-other-ways');
    expect(fold).not.toBeNull();
    await click(q('share-other-ways-toggle'));
    expect((q('share-web-url') as HTMLInputElement | null)?.value).toBe(LINKS.web);
    expect(q('share-app-url')).not.toBeNull();
    expect(q('share-local-url')).not.toBeNull();
    expect(q('share-copy-local')).not.toBeNull();
  });

  test('a local project: no Invite, one line about the cloud', async () => {
    const { q } = await mount({ posture: { linked: false } });
    expect(q('share-invite')).toBeNull();
    expect(q('share-local-note')).not.toBeNull();
  });
});

describe('model words', () => {
  test('expiresIn and the row order', () => {
    expect(expiresIn(NOW + 5 * DAY - 1, NOW)).toBe('expires in 5 days');
    expect(expiresIn(NOW + DAY - 1, NOW)).toBe('expires tomorrow');
    expect(expiresIn(NOW - 1, NOW)).toBe('expires today');
    expect(peopleRows(PEOPLE, { now: NOW }).map((r) => r.id)).toEqual([
      'u_me',
      'u_t',
      'u_j',
      'inv_p',
    ]);
  });
});
