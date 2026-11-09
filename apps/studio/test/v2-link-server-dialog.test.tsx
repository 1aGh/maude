// 2.1.1 T5 — the one "Link your server" dialog as a view, with a fake API (project context): the address is
// checked once it rests (no Test connection button), the primary button wakes only once the server answered,
// an invite link opens its own field, Advanced draws only what the context can do, the browser wait has
// Cancel + Open the page again, and the Settings door (`TeamProjectsDialog serverOnly`) is this dialog.
// Plus the project API's wiring to the project server's routes. No network, no shell.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register({ url: 'http://localhost:4479/' });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TeamProjectsDialog } from '../client/panels/TeamProjects.jsx';
import { ShellStoreContext } from '../client/stores/shell-store.jsx';
import { LinkServerDialog } from '../client/v2/link-server/LinkServerDialog.jsx';
import LinkServerHost from '../client/v2/link-server/LinkServerHost.jsx';
import { projectLinkApi } from '../client/v2/link-server/link-server-api.js';
import { runLinkServer } from '../client/v2/shell/project-account-bus.js';

const HUB = 'https://design.example.com';
const DEBOUNCE = 20;

let host: HTMLElement;
let root: Root;
const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (id: string) => act(() => $(id)?.click());
function reactProps(el: Element): Record<string, (e: unknown) => unknown> {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  return (el as unknown as Record<string, Record<string, (e: unknown) => unknown>>)[key] ?? {};
}
const type = (id: string, value: string) =>
  act(() => {
    const el = $(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    reactProps(el).onChange?.({ target: el, currentTarget: el });
  });
const settle = (ms = DEBOUNCE + 30) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const submit = () =>
  act(async () => {
    $('link-server-signin')?.click();
    await new Promise((r) => setTimeout(r, 0));
  });

function render(el: unknown) {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(el as never);
  });
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

function fakeApi(over: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const rec =
    (name: string, fn: (...a: unknown[]) => unknown) =>
    async (...a: unknown[]) => {
      calls.push([name, ...a]);
      return fn(...a);
    };
  const api: Record<string, unknown> = {
    context: 'project',
    folders: false,
    check: rec('check', () => ({ ok: true, version: '2.1.0' })),
    signInStart: rec('signInStart', () => ({
      ok: true,
      id: 'att-1',
      signInUrl: `${HUB}/studio/signin?x`,
    })),
    openSignIn: rec('openSignIn', () => 'ok'),
    signInPoll: rec('signInPoll', () => ({ ok: true, pending: true })),
    signInCancel: rec('signInCancel', () => ({ ok: true })),
    linkKey: rec('linkKey', () => ({ ok: true })),
    finish: rec('finish', () => ({ ok: true })),
  };
  for (const [k, v] of Object.entries(over))
    api[k] = typeof v === 'function' ? rec(k, v as (...a: unknown[]) => unknown) : v;
  return { api, calls };
}

const mount = (api: Record<string, unknown>, props: Record<string, unknown> = {}) => {
  let closed = 0;
  render(
    createElement(LinkServerDialog, {
      api,
      project: 'Logo ideas',
      debounceMs: DEBOUNCE,
      pollMs: 5,
      onClose: () => {
        closed += 1;
      },
      ...props,
    })
  );
  return { closed: () => closed };
};

describe('the dialog', () => {
  test('empty → checking → answers: no Test button; the address is checked once it rests; Sign in wakes', async () => {
    const { api, calls } = fakeApi();
    mount(api);
    expect($('link-server-dialog')?.querySelector('.ai-conn-t')?.textContent).toBe(
      'Link your server'
    );
    expect(host.textContent).not.toContain('Test connection');
    expect($('link-server-check')?.textContent).toBe(
      'Ask whoever runs it for the address. It’s checked as you type.'
    );
    expect(($('link-server-signin') as HTMLButtonElement).disabled).toBe(true);
    type('link-server-url', 'design.example.co');
    type('link-server-url', 'design.example.com');
    expect($('link-server-check')?.textContent).toBe('Checking design.example.com…');
    expect(($('link-server-signin') as HTMLButtonElement).disabled).toBe(true);
    await settle();
    expect(calls.filter((c) => c[0] === 'check')).toEqual([['check', HUB]]); // one, for the resting address
    expect($('link-server-check')?.textContent).toBe('design.example.com answers — Maude 2.1.0');
    expect(($('link-server-signin') as HTMLButtonElement).disabled).toBe(false);
    expect($('link-server-signin')?.textContent).toBe('Sign in in your browser');
  });

  test("didn't answer and not a Maude server are errors in words; the button stays asleep", async () => {
    const { api } = fakeApi({ check: () => ({ ok: false, reason: 'unreachable' }) });
    mount(api);
    type('link-server-url', 'design.example.com');
    await settle();
    expect($('link-server-check')?.getAttribute('data-tone')).toBe('bad');
    expect($('link-server-check')?.textContent).toContain('didn’t answer');
    expect($('link-server-url')?.getAttribute('data-bad')).toBe('true');
    expect(($('link-server-signin') as HTMLButtonElement).disabled).toBe(true);
  });

  test('Sign in → waiting (Cancel · Open the page again) → Cancel forgets the attempt, the dialog stays', async () => {
    const { api, calls } = fakeApi();
    const m = mount(api);
    type('link-server-url', 'design.example.com');
    await settle();
    await submit();
    await settle(10);
    expect($('link-server-waiting')?.textContent).toContain(
      'design.example.com opened in your browser'
    );
    click('link-server-reopen');
    expect(calls.filter((c) => c[0] === 'openSignIn')).toHaveLength(2);
    click('link-server-cancel');
    await settle(10);
    expect(calls.filter((c) => c[0] === 'signInCancel')).toEqual([['signInCancel', 'att-1']]);
    expect($('link-server-waiting')).toBeNull();
    expect($('link-server-dialog')).not.toBeNull();
    expect(calls.some((c) => c[0] === 'finish')).toBe(false);
    expect(m.closed()).toBe(0);
  });

  test('the browser came back: finish runs once and the dialog closes', async () => {
    let n = 0;
    const { api, calls } = fakeApi({
      signInPoll: () => (++n < 2 ? { ok: true, pending: true } : { ok: true, url: HUB }),
    });
    const m = mount(api);
    type('link-server-url', 'design.example.com');
    await settle();
    await submit();
    await settle(40);
    expect(calls.filter((c) => c[0] === 'finish')).toEqual([
      ['finish', HUB, { mode: 'kept', path: '' }],
    ]);
    expect(m.closed()).toBe(1);
  });

  test('I have an invite link: a masked field; a pasted link fills the address; it rides start once, then empties', async () => {
    const { api, calls } = fakeApi();
    mount(api);
    click('link-server-invite-open');
    const field = $('link-server-invite') as HTMLInputElement;
    expect(field.type).toBe('password');
    const KEY = `inv_${'k'.repeat(24)}`;
    type('link-server-invite', `${HUB}/join/${KEY}`);
    expect(($('link-server-url') as HTMLInputElement).value).toBe(HUB);
    await settle();
    await submit();
    expect(calls.find((c) => c[0] === 'signInStart')).toEqual([
      'signInStart',
      HUB,
      `${HUB}/join/${KEY}`,
    ]);
    expect(($('link-server-invite') as HTMLInputElement | null)?.value ?? '').toBe('');
    expect(host.innerHTML).not.toContain(KEY);
  });

  test('Advanced: a sign-in key replaces the browser; no folder block where the context cannot link a folder', async () => {
    const { api, calls } = fakeApi();
    mount(api);
    expect($('link-server-advanced')?.textContent).toContain('Sign-in key');
    expect($('link-server-advanced')?.textContent).not.toContain('folder');
    click('link-server-advanced');
    expect($('link-server-folder-kept')).toBeNull();
    expect(($('link-server-key') as HTMLInputElement).type).toBe('password');
    type('link-server-url', 'design.example.com');
    await settle();
    type('link-server-key', 'hk_admin_key_value');
    expect($('link-server-signin')?.textContent).toBe('Link with this key');
    await submit();
    await settle(10);
    expect(calls.map((c) => c[0]).filter((n) => n !== 'check')).toEqual(['linkKey', 'finish']);
    expect(host.innerHTML).not.toContain('hk_admin_key_value');
  });

  test('a context that can link a folder draws Keep a copy for me / Use my folder… with Choose…', async () => {
    const { api } = fakeApi({ folders: true, pickFolder: () => '/Users/me/git/logo-ideas' });
    mount(api);
    click('link-server-advanced');
    expect(($('link-server-folder-kept') as HTMLInputElement).checked).toBe(true);
    await act(async () => {
      reactProps($('link-server-folder-mine') as Element).onChange?.({});
    });
    click('link-server-folder-choose');
    await settle(10);
    expect($('link-server-folder-path')?.textContent).toBe('/Users/me/git/logo-ideas');
    expect(host.textContent).toContain('Sync Logo ideas with a Maude server your team runs.');
  });

  test('a context with no key and no folder path draws no Advanced at all (Home)', () => {
    const { api } = fakeApi({ linkKey: undefined });
    delete api.linkKey;
    mount(api, { project: null });
    expect($('link-server-advanced')).toBeNull();
  });
});

describe('the Settings door and the project API', () => {
  test('TeamProjectsDialog serverOnly (Settings › Add a team server…) is the one dialog now', () => {
    render(createElement(TeamProjectsDialog, { serverOnly: true, onClose: () => {} }));
    expect($('link-server-dialog')).not.toBeNull();
    expect($('team-projects-dialog')).toBeNull();
    expect($('team-hub-url')).toBeNull();
  });

  test('projectLinkApi talks only to the project server; finish opens the server project', async () => {
    const posts: [string, unknown][] = [];
    const opened: unknown[] = [];
    const linked: unknown[] = [];
    const api = projectLinkApi({
      fetchPost: async (path: string, body: unknown) => {
        posts.push([path, body]);
        if (path.endsWith('/check'))
          return { ok: false, status: 502, json: { ok: false, reason: 'not-a-maude-workspace' } };
        return { ok: true, status: 200, json: { ok: true, id: 'a', signInUrl: 'u' } };
      },
      openProject: async (input: unknown) => {
        opened.push(input);
        return { ok: true };
      },
      link: async (body: unknown) => {
        linked.push(body);
        return { ok: true, status: 200, json: { ok: true } };
      },
    } as never);
    expect(await api.check(HUB)).toEqual({ ok: false, reason: 'not-a-maude-workspace' });
    expect(await api.signInStart(HUB, 'inv_x')).toMatchObject({ ok: true, id: 'a' });
    expect(await api.linkKey(HUB, 'k')).toMatchObject({ ok: true });
    expect(await api.finish(HUB)).toEqual({ ok: true });
    expect(posts).toEqual([
      ['/_api/hub-signin/check', { url: HUB }],
      ['/_api/hub-signin/start', { url: HUB, invite: 'inv_x' }],
    ]);
    expect(linked).toEqual([{ url: HUB, token: 'k' }]);
    expect(opened).toEqual([{ kind: 'known-hub', url: HUB }]);
    expect(api.folders).toBe(false);
  });
});

describe('the host answers account.link-server (B1 maude:link-server)', () => {
  test('with the host mounted the row opens the dialog (address prefilled), never Settings', async () => {
    render(
      createElement(
        ShellStoreContext.Provider,
        { value: { shellCore: { cfg: { name: 'Logo ideas' }, project: 'logo-ideas' } } as never },
        createElement(LinkServerHost)
      )
    );
    expect($('link-server-dialog')).toBeNull();
    const settings: unknown[] = [];
    let how = '';
    await act(async () => {
      how = runLinkServer(
        { intent: 'sign-in', url: HUB },
        { setSettingsOpen: (t: unknown) => settings.push(t) }
      );
    });
    expect(how).toBe('dialog');
    expect(settings).toEqual([]);
    expect(($('link-server-url') as HTMLInputElement).value).toBe(HUB);
    click('link-server-cancel');
    expect($('link-server-dialog')).toBeNull();
  });
});
