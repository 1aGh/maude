// 2.1.1 T2/T4 — the account chip, its menu and Switch account (canvas 17 Accounts and Connections):
//  · the face says the kind (circle / server tile / laptop) with at most one badge;
//  · the menu's project block says where the project lives, the account and the status — red with
//    "Sign in again" and the server address when the sign-in is broken;
//  · Switch account lists the accounts ALREADY on this Mac and "No account — this Mac only", asks first,
//    and never offers a fresh empty account; Add a Maude Cloud account / Sign in with custom server foot.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { connectionState } from '../client/v2/shell/connection-state.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';
import {
  ACCOUNT_MENU_EVENT,
  LINK_SERVER_EVENT,
  openAccountMenu,
  runLinkServer,
} from '../client/v2/shell/project-account-bus.js';
import {
  AccountChip,
  ProjectAccountMenu,
  SwitchSheet,
} from '../client/v2/shell/project-account-card.jsx';
import {
  accountFace,
  accountMenu,
  switchList,
  switchSheet,
  syncedAgo,
} from '../client/v2/shell/project-account-model.js';
import { resetSignInToasts, useSignInToast } from '../client/v2/shell/project-account-toast.js';

const TEAM = 'https://design.example.com';
const CLOUD = 'https://cloud.maude.sh';
const local = connectionState({ linkedHub: null });
const broken = connectionState({ linkedHub: { url: TEAM, credentialed: false }, cloudUrl: CLOUD });
const rejected = connectionState({
  linkedHub: { url: TEAM, credentialed: true },
  cloudUrl: CLOUD,
  syncStatus: { accepted: { credentialRefused: true } },
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
async function render(el: ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(el));
  return (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
}

describe('accountFace — the kind is the face, at most one badge', () => {
  test('this Mac only: a laptop, never a badge', () => {
    const f = accountFace({ conn: local, profile: { id: 'default' } });
    expect(f).toMatchObject({ kind: 'local', label: 'This Mac', badge: null });
  });
  test('your server, sign-in broken: the server tile with the broken link', () => {
    expect(accountFace({ conn: broken })).toMatchObject({
      kind: 'server',
      label: 'design.example.com',
      badge: 'broken',
    });
  });
  test('a local project on a signed-in Maude Cloud account: the circle and the e-mail, no badge', () => {
    const f = accountFace({
      conn: local,
      profile: { id: 'work', label: 'Work' },
      cloudConnected: true,
      cloudEmail: 'alice@example.com',
    });
    expect(f).toMatchObject({
      kind: 'cloud',
      label: 'alice@example.com',
      initial: 'A',
      badge: null,
    });
  });
});

describe('accountMenu — the same menu for every project', () => {
  test('a local folder: Your folder, No account, and its two ways out', () => {
    const face = accountFace({ conn: local });
    const m = accountMenu({
      native: true,
      project: 'Logo ideas',
      conn: local,
      face,
      place: { kept: false, folder: '~/git/logo-ideas' },
    });
    expect(m.where).toMatchObject({
      kind: 'folder',
      text: 'Your folder',
      mono: '~/git/logo-ideas',
    });
    expect(m.account.text).toBe('No account — only on this Mac');
    expect(m.status.text).toBe('Only on this Mac');
    expect(m.actions.map((a) => a.id)).toEqual(['share.move-to-cloud', 'account.link-server']);
    expect(m.switch).toBe('list');
    expect(m.fix).toBeNull();
  });
  test('kept by Maude: no path to manage', () => {
    const m = accountMenu({
      native: true,
      conn: local,
      face: accountFace({ conn: local }),
      place: { kept: true },
    });
    expect(m.where).toMatchObject({ kind: 'kept', text: 'Kept by Maude' });
  });
  test('your server, sign-in stopped working: red, the address prefilled, Sign in again', () => {
    const face = accountFace({ conn: rejected });
    const m = accountMenu({
      native: true,
      project: 'Design system',
      conn: rejected,
      face,
      place: { kept: true },
      hubAccount: 'alice@example.com',
      lastSyncAt: 1_000,
      now: 1_000 + 30 * 3600_000,
    });
    expect(m.bad).toBe(true);
    expect(m.where).toMatchObject({ text: 'On design.example.com', extra: 'copy kept by Maude' });
    expect(m.account).toMatchObject({ text: 'alice@example.com', sub: 'your server' });
    expect(m.status.text).toBe('Sign-in stopped working · synced yesterday');
    expect(m.fix).toMatchObject({
      address: 'design.example.com',
      url: TEAM,
      label: 'Sign in again',
      path: 'hub-signin',
    });
  });
  test('a browser tab on this Mac has no Mac account to switch', () => {
    expect(
      accountMenu({ native: false, conn: local, face: accountFace({ conn: local }) }).switch
    ).toBeNull();
  });
  test('syncedAgo', () => {
    expect(syncedAgo(0)).toBeNull();
    expect(syncedAgo(1000, 1000 + 2 * 60_000)).toBe('synced 2 min ago');
  });
});

describe('switchList — accounts already on this Mac, never a fresh one', () => {
  const accounts = [
    { id: 'default', label: 'Personal', email: null, signedIn: false },
    { id: 'logo-ideas', label: 'Logo ideas', email: null, signedIn: false },
    { id: 'work', label: 'alice@example.com', email: null, signedIn: true },
    { id: 'bright', label: 'hello@brightside.example', email: null, signedIn: true },
  ];
  test('a project stranded on an empty profile: "No account" is ticked and is the way back', () => {
    const l = switchList({ accounts, profile: { id: 'logo-ideas' } });
    expect(l.rows.map((r) => r.id)).toEqual(['default', 'work', 'bright']);
    expect(l.rows[0]).toMatchObject({ title: 'No account — this Mac only', current: true });
    expect(l.foot.map((f) => f.id)).toEqual(['account.add-cloud', 'account.link-server']);
    expect(l.foot[1].params).toEqual({ intent: 'sign-in' });
  });
  test('the current account is ticked and shows its own e-mail', () => {
    const l = switchList({
      accounts: accounts.map((a) => (a.id === 'work' ? { ...a, email: 'alice@example.com' } : a)),
      profile: { id: 'work' },
    });
    expect(l.rows.find((r) => r.current)?.id).toBe('work');
    expect(l.rows[0].current).toBe(false);
  });
  test('without the shell list: only what the tab knows', () => {
    const l = switchList({ accounts: null, profile: { id: 'default' } });
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0].id).toBe('default');
  });
  test('the sheet: which account, nothing moves, the way back', () => {
    const l = switchList({ accounts, profile: { id: 'default' } });
    const s = switchSheet({
      row: l.rows.find((r) => r.id === 'bright'),
      project: 'Logo ideas',
      place: { kept: false, folder: '~/git/logo-ideas' },
      conn: local,
    });
    expect(s.title).toBe('Use hello@brightside.example for Logo ideas?');
    expect(s.lines[0]).toMatchObject({
      mono: '~/git/logo-ideas',
      after: '. Nothing is moved or uploaded.',
    });
    expect(s.lines[1].strong).toBe('hello@brightside.example');
    expect(s.primary).toBe('Use account');
  });
});

describe('the menu', () => {
  test('Switch account opens the list; a row asks first; the current row picks nothing', async () => {
    const picked: string[] = [];
    const face = accountFace({ conn: local });
    const menu = accountMenu({ native: true, conn: local, face });
    const list = switchList({
      accounts: [
        { id: 'default', label: 'Personal', signedIn: false },
        { id: 'work', label: 'Work', signedIn: true },
      ],
      profile: { id: 'default' },
    });
    let view = 'menu';
    const el = () =>
      createElement(ProjectAccountMenu, {
        menu,
        face,
        list,
        view,
        onView: (v: string) => {
          view = v;
        },
        onAction() {},
        onPick: (r: { id: string }) => picked.push(r.id),
      });
    const q = await render(el());
    expect(q('account-menu-action-share.move-to-cloud')?.textContent).toContain(
      'Put this project on Maude Cloud'
    );
    await act(async () => q('account-menu-switch')?.click());
    expect(view).toBe('switch');
    await act(async () => root?.render(el()));
    await act(async () => q('account-switch-row-default')?.click());
    expect(picked).toEqual([]);
    await act(async () => q('account-switch-row-work')?.click());
    expect(picked).toEqual(['work']);
  });
  test('the broken block carries the address and its one button', async () => {
    const fixes: unknown[] = [];
    const face = accountFace({ conn: broken });
    const menu = accountMenu({ native: true, conn: broken, face });
    const q = await render(
      createElement(ProjectAccountMenu, {
        menu,
        face,
        onAction() {},
        onFix: (f: unknown) => fixes.push(f),
      })
    );
    expect(q('account-menu-project')?.dataset.bad).toBe('true');
    expect(q('account-menu-fix-address')?.textContent).toBe('design.example.com');
    expect(q('account-menu-fix')?.textContent).toBe('Sign in');
    await act(async () => q('account-menu-fix')?.click());
    expect(fixes).toEqual([expect.objectContaining({ url: TEAM, path: 'hub-signin' })]);
  });
  test('the chip draws the badge and opens the menu', async () => {
    let opened = 0;
    const q = await render(
      createElement(AccountChip, { face: accountFace({ conn: broken }), onOpen: () => opened++ })
    );
    expect(q('share-cluster-account')?.dataset.kind).toBe('server');
    expect(q('share-cluster-account-badge')?.dataset.badge).toBe('broken');
    await act(async () => q('share-cluster-account')?.click());
    expect(opened).toBe(1);
  });
  test('the sheet confirms or cancels', async () => {
    let done = '';
    const sheet = switchSheet({ row: { id: 'default', kind: 'local', title: 'x' }, project: 'P' });
    const q = await render(
      createElement(SwitchSheet, {
        sheet,
        onCancel: () => (done = 'cancel'),
        onConfirm: () => (done = 'ok'),
      })
    );
    expect(q('account-switch-sheet')?.textContent).toContain('Use no account for P?');
    await act(async () => q('account-switch-sheet-confirm')?.click());
    expect(done).toBe('ok');
  });
});

describe('the registry and the bus', () => {
  test('account.switch reads "Switch account…" and opens the list; the two foot rows are actions', () => {
    expect(ACTIONS_BY_ID.get('account.switch')?.label).toBe('Switch account…');
    expect(ACTIONS_BY_ID.get('account.add-cloud')?.label).toBe('Add a Maude Cloud account…');
    expect(ACTIONS_BY_ID.get('account.link-server')?.label).toBe('Link your server…');
    let add = 0;
    let sw = 0;
    const h = createMenuHandlers({
      native: true,
      onSwitchAccount: () => sw++,
      onAddCloudAccount: () => add++,
      toast() {},
    } as never) as Record<string, (p?: unknown) => void>;
    h['account.switch']();
    h['account.add-cloud']();
    expect([sw, add]).toEqual([1, 1]);
  });
  test('Link your server goes to the dialog when it listens, else to Settings › Connections', () => {
    const tabs: unknown[] = [];
    const d = { setSettingsOpen: (t: unknown) => tabs.push(t) };
    expect(runLinkServer({ intent: 'sign-in' }, d)).toBe('settings');
    expect(tabs).toEqual(['connections']);
    const seen: unknown[] = [];
    const on = (e: Event) => {
      seen.push((e as CustomEvent).detail);
      e.preventDefault();
    };
    window.addEventListener(LINK_SERVER_EVENT, on);
    expect(runLinkServer({ intent: 'sign-in' }, d)).toBe('dialog');
    window.removeEventListener(LINK_SERVER_EVENT, on);
    expect(seen).toEqual([{ intent: 'sign-in' }]);
    expect(tabs).toHaveLength(1);
  });
  test('openAccountMenu tells the host which view', () => {
    const got: unknown[] = [];
    const on = (e: Event) => got.push((e as CustomEvent).detail);
    window.addEventListener(ACCOUNT_MENU_EVENT, on);
    openAccountMenu('switch');
    window.removeEventListener(ACCOUNT_MENU_EVENT, on);
    expect(got).toEqual([{ view: 'switch' }]);
  });
});

describe('the toast — once per session, the two sign-in states only', () => {
  test('told once for the same project and state; again for a new state', async () => {
    resetSignInToasts();
    const told: Array<{ title: string; action: { label: string } }> = [];
    function Probe({ conn }: { conn: unknown }) {
      useSignInToast({
        conn,
        project: 'Design system',
        onFix() {},
        toast: (t: never) => told.push(t),
      });
      return null;
    }
    await render(createElement(Probe, { conn: broken }));
    await act(async () => root?.render(createElement(Probe, { conn: { ...broken } })));
    expect(told).toHaveLength(1);
    expect(told[0].action.label).toBe('Sign in');
    act(() => root?.unmount());
    root = createRoot(host as HTMLElement);
    await act(async () => root?.render(createElement(Probe, { conn: broken })));
    expect(told).toHaveLength(1);
    await act(async () => root?.render(createElement(Probe, { conn: rejected })));
    expect(told).toHaveLength(2);
    expect(told[1].action.label).toBe('Sign in again');
    await act(async () => root?.render(createElement(Probe, { conn: local })));
    expect(told).toHaveLength(2);
  });
});
