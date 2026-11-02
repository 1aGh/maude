// v2-github-home — S6.10: "From GitHub" in Home's "Open a folder or a GitHub project" (02 ob-adv-sheets).
// The segment is drawn from Rust's answers (github_repos / home_github_sign_in / github_clone / github_create,
// stubbed here) and opens the clone as a tab with open_project({root}). It never asks for, holds or shows a
// token: no command it sends carries one, and no answer it renders has one.

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

import { AdvancedSheets } from '../client/v2/onboarding/AdvancedSheets.jsx';
import { githubChoice, repoRef } from '../client/v2/onboarding/github-home.js';

const flush = async (n = 8) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
};
let host: HTMLElement;
let root: Root;
const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const $$ = (id: string) => [...host.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const click = async (id: string) => {
  await act(async () => $(id)?.click());
  await flush();
};
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
const submit = async () => {
  const form = $('onb-folder-go')?.closest('form') as HTMLFormElement;
  await act(async () => {
    reactProps(form).onSubmit?.({ preventDefault() {} });
  });
  await flush();
};
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

const REPOS = [
  { fullName: 'brno-alligators/brand', private: true },
  { fullName: 'brno-alligators/club-web', private: true },
  { fullName: '1aGh/personal-page', private: false },
];

type Call = [string, Record<string, unknown>];
function mount(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const opened: string[] = [];
  let closed = 0;
  const listeners = new Map<string, (p: unknown) => void>();
  const invoke = async (cmd: string, args: Record<string, unknown>) => {
    calls.push([cmd, args]);
    const a = answers[cmd];
    if (!a) throw `unknown command ${cmd}`;
    return a(args);
  };
  const listen = async (event: string, fn: (p: unknown) => void) => {
    listeners.set(event, fn);
    return () => listeners.delete(event);
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(
      createElement(AdvancedSheets, {
        open: 'folder-github',
        profile: 'work',
        onClose: () => closed++,
        openPrepared: async () => {},
        startFigma: async () => true,
        openFolder: async () => {},
        github: { invoke, listen, openRoot: async (r: string) => opened.push(r) },
      } as never)
    );
  });
  return { calls, opened, listeners, closed: () => closed };
}

const signedIn = () => ({ profile: 'work', signedIn: true, login: 'tereza', repos: REPOS });
const cloned = (args: Record<string, unknown>) => ({
  root: `/Users/t/Maude/${String(args.fullName ?? args.name)
    .split('/')
    .pop()}`,
  profile: 'work',
  name: 'x',
});

describe('S6.10 · From GitHub', () => {
  test('the segment is live: the repo list from Rust, each row Private or Public', async () => {
    const m = mount({ github_repos: signedIn });
    await flush();
    expect($('onb-folder-tab-github')?.getAttribute('aria-disabled')).toBeNull();
    await click('onb-folder-tab-github');
    const rows = $$('onb-github-repo');
    expect(rows.map((r) => r.textContent)).toEqual([
      'brno-alligators/brandPrivate',
      'brno-alligators/club-webPrivate',
      '1aGh/personal-pagePublic',
    ]);
    expect(rows[0].getAttribute('aria-checked')).toBe('true');
    expect($('onb-github-link')?.getAttribute('placeholder')).toBe('Or paste a GitHub link');
    expect($('onb-github-new')?.textContent).toBe('New project on GitHub — private by default');
    expect(m.calls[0]).toEqual(['github_repos', { profile: 'work' }]);
  });

  test('Open clones the chosen repo into ~/Maude and opens it as a tab', async () => {
    const m = mount({ github_repos: signedIn, github_clone: cloned });
    await flush();
    await click('onb-folder-tab-github');
    await act(async () => $$('onb-github-repo')[2].click());
    await submit();
    expect(m.calls.at(-1)).toEqual([
      'github_clone',
      { fullName: '1aGh/personal-page', chooseFolder: false, profile: 'work' },
    ]);
    expect(m.opened).toEqual(['/Users/t/Maude/personal-page']);
    expect(m.closed()).toBe(1);
  });

  test('a pasted github.com link wins; another host never enables Open', async () => {
    const m = mount({ github_repos: signedIn, github_clone: cloned });
    await flush();
    await click('onb-folder-tab-github');
    await type('onb-github-link', 'https://evil.example/github.com/o/r');
    await flush();
    expect(($('onb-folder-go') as HTMLButtonElement).disabled).toBe(true);
    await type('onb-github-link', 'https://github.com/1aGh/maude.git');
    await flush();
    expect(($('onb-folder-go') as HTMLButtonElement).disabled).toBe(false);
    await submit();
    expect(m.calls.at(-1)?.[1]).toEqual({
      fullName: '1aGh/maude',
      chooseFolder: false,
      profile: 'work',
    });
  });

  test('Choose another folder… asks Rust for the picker; a closed picker changes nothing', async () => {
    const m = mount({ github_repos: signedIn, github_clone: () => null });
    await flush();
    await click('onb-folder-tab-github');
    await click('onb-github-choose-folder');
    await submit();
    expect(m.calls.at(-1)?.[1]).toMatchObject({
      fullName: 'brno-alligators/brand',
      chooseFolder: true,
    });
    expect(m.opened).toEqual([]);
    expect(m.closed()).toBe(0);
    expect(($('onb-folder-go') as HTMLButtonElement).disabled).toBe(false);
  });

  test('New project on GitHub asks for a name and creates it (private by default, in Rust)', async () => {
    const m = mount({ github_repos: signedIn, github_create: cloned });
    await flush();
    await click('onb-folder-tab-github');
    await click('onb-github-new');
    expect(($('onb-folder-go') as HTMLButtonElement).disabled).toBe(true);
    await type('onb-github-new-name', 'Poster');
    await flush();
    await submit();
    expect(m.calls.at(-1)).toEqual([
      'github_create',
      { name: 'Poster', chooseFolder: false, profile: 'work' },
    ]);
    expect(m.opened).toEqual(['/Users/t/Maude/Poster']);
  });

  test('a signed-out profile signs in to GitHub from Home, then lists the profile Rust chose', async () => {
    let n = 0;
    const m = mount({
      github_repos: (a) =>
        n++ === 0
          ? { profile: 'work', signedIn: false, repos: [] }
          : { profile: a.profile, signedIn: true, login: 'michal', repos: REPOS.slice(0, 1) },
      home_github_sign_in: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { profile: 'p-fresh', login: 'michal' };
      },
    });
    await flush();
    await click('onb-folder-tab-github');
    expect($('onb-github-signin')?.textContent).toBe('Sign in with GitHub');
    expect(($('onb-folder-go') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => $('onb-github-signin')?.click());
    await act(async () => m.listeners.get('github://device-code')?.({ user_code: 'WDJB-MJHT' }));
    expect(host.textContent).toContain('Enter WDJB-MJHT on github.com/login/device');
    await flush(12);
    expect(m.calls.map((c) => c[0])).toEqual([
      'github_repos',
      'home_github_sign_in',
      'github_repos',
    ]);
    expect(m.calls[1][1]).toEqual({ profile: 'work' });
    expect(m.calls[2][1]).toEqual({ profile: 'p-fresh' });
    expect($$('onb-github-repo')).toHaveLength(1);
  });

  test('no command carries a token and none is shown; a list that cannot be read is said in the segment', async () => {
    const m = mount({
      github_repos: () => {
        throw "Couldn't reach GitHub. Check your internet connection and try again.";
      },
    });
    await flush();
    await click('onb-folder-tab-github');
    expect($('onb-github-error')?.textContent).toContain("Couldn't reach GitHub");
    expect($('onb-folder-error')).toBeNull(); // the folder half is untouched
    for (const [, args] of m.calls)
      for (const k of Object.keys(args)) expect(k).not.toMatch(/token/i);
    expect(host.innerHTML).not.toMatch(/gh[opsu]_|token/i);
  });

  test('repoRef: owner/repo or a github.com link only', () => {
    expect(repoRef('brno-alligators/brand')).toBe('brno-alligators/brand');
    expect(repoRef('git@github.com:1aGh/maude.git')).toBe('1aGh/maude');
    for (const bad of [
      'https://github.com.evil.example/o/r',
      'https://x@github.com/o/r',
      'http://github.com/o/r',
      'https://github.com/o/r/tree/main',
      'o/..',
      'o',
    ])
      expect([bad, repoRef(bad)]).toEqual([bad, null]);
    expect(githubChoice({ picked: 'a/b', link: '' })).toEqual({ kind: 'clone', fullName: 'a/b' });
    expect(githubChoice({ isNew: true, name: '  ' })).toBeNull();
  });
});
