// 2.0.5 W4b — Switch for a team-server project (option A of W4's open point). The card offers it;
// `runTeamSwitch` brackets the team server's own sign-in page with the shell's
// `team_sign_in_prepare`, which moves THIS project onto a fresh profile of its own when its profile
// is shared (Rust: app_state.rs `prepare_team_switch`, pinned by cargo tests). The shell, the page
// opener and every route are stubs here — no real sign-in, no keychain.

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
import { ProjectAccountCard } from '../client/v2/shell/project-account-card.jsx';
import { projectAccount } from '../client/v2/shell/project-account-model.js';
import { runTeamSwitch, TEAM_SWITCH_WORDS } from '../client/v2/shell/team-switch.js';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const team = (credentialed: boolean, native = true) =>
  projectAccount({
    native,
    profile: { id: 'work', label: 'Work' },
    linkedHub: { url: 'https://hub.studio.cz', credentialed },
    hubAccount: credentialed ? 'michal@studio.cz' : null,
    cloudUrl: 'https://cloud.maude.sh',
    github: { state: 'out' },
  });

describe('the card offers Switch for a team server', () => {
  test('signed in: "Sign in as someone else…" on the hub-switch path, beside Sign out', () => {
    const a = team(true);
    expect(a.switch).toEqual({
      path: 'hub-switch',
      url: 'https://hub.studio.cz',
      label: 'Sign in as someone else…',
    });
    expect(a.signOut?.path).toBe('hub-detach');
  });

  test('signed out (e.g. just moved to its own profile): "Sign in to <host>…", no Sign out', () => {
    const a = team(false);
    expect(a.switch?.label).toBe('Sign in to hub.studio.cz…');
    expect(a.switch?.path).toBe('hub-switch');
    expect(a.signOut).toBeNull();
  });

  test('a browser tab has no shell: no Switch', () => {
    expect(team(true, false).switch).toBeNull();
  });

  test('clicking it hands the spec to onSwitch and runs no registry action', async () => {
    const ran: string[] = [];
    const switched: unknown[] = [];
    let closed = 0;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <ProjectAccountCard
          account={team(true)}
          run={(id: string) => ran.push(id)}
          onSwitch={(spec: unknown) => switched.push(spec)}
          onClose={() => {
            closed++;
          }}
        />
      )
    );
    const btn = host.querySelector('[data-testid="project-account-switch"]') as HTMLElement;
    expect(btn?.textContent).toBe('Sign in as someone else…');
    await act(async () => btn.click());
    expect(ran).toEqual([]);
    expect(switched).toEqual([team(true).switch]);
    expect(closed).toBe(1);
  });
});

function fakes(prepare: boolean | Error, polls: unknown[], opened = 'ok') {
  const calls: Array<[string, unknown]> = [];
  const invoked: string[] = [];
  const pages: string[] = [];
  return {
    calls,
    invoked,
    pages,
    deps: {
      url: 'https://hub.studio.cz',
      native: true,
      invoke: async (cmd: string) => {
        invoked.push(cmd);
        if (prepare instanceof Error) throw prepare;
        return prepare;
      },
      api: async (path: string, init: { body: string }) => {
        calls.push([path, JSON.parse(init.body)]);
        if (path === '/_api/hub-signin/start')
          return {
            ok: true,
            json: { ok: true, id: 'att1', signInUrl: 'https://hub.studio.cz/studio/signin?x' },
          };
        if (path === '/_api/hub-signin/poll') return { ok: true, json: polls.shift() };
        return { ok: true, json: { ok: true } };
      },
      openPage: async (u: string) => {
        pages.push(u);
        return opened;
      },
      wait: async () => {},
    },
  };
}

describe('runTeamSwitch', () => {
  test('a shared profile: the shell moves the project, and no sign-in starts on the shared one', async () => {
    const f = fakes(true, []);
    const r = await runTeamSwitch(f.deps);
    expect(f.invoked).toEqual(['team_sign_in_prepare']);
    expect(r).toMatchObject({ ok: true, moved: true, message: TEAM_SWITCH_WORDS.moved });
    expect(f.calls).toEqual([]);
    expect(f.pages).toEqual([]);
  });

  test('alone on its profile: the server’s own page, then the poll answers who signed in', async () => {
    const f = fakes(false, [
      { ok: true, pending: true },
      {
        ok: true,
        url: 'https://hub.studio.cz',
        user: { email: 'tereza@studio.cz', role: 'member' },
      },
    ]);
    const r = await runTeamSwitch(f.deps);
    expect(f.invoked).toEqual(['team_sign_in_prepare']);
    expect(f.calls.map((c) => c[0])).toEqual([
      '/_api/hub-signin/start',
      '/_api/hub-signin/poll',
      '/_api/hub-signin/poll',
    ]);
    expect(f.calls[0]?.[1]).toEqual({ url: 'https://hub.studio.cz' });
    expect(f.pages).toEqual(['https://hub.studio.cz/studio/signin?x']);
    expect(r).toMatchObject({ ok: true, user: 'tereza@studio.cz' });
    expect(r.message).toBe('Signed in to hub.studio.cz as tereza@studio.cz.');
  });

  test('a page the shell refuses to open cancels the attempt', async () => {
    const f = fakes(false, [], 'refused');
    const r = await runTeamSwitch(f.deps);
    expect(r).toMatchObject({ ok: false, error: TEAM_SWITCH_WORDS.refused });
    expect(f.calls.map((c) => c[0])).toEqual(['/_api/hub-signin/start', '/_api/hub-signin/cancel']);
  });

  test('the shell refusing the prepare stops everything', async () => {
    const f = fakes(new Error('This window is not a project.'), []);
    const r = await runTeamSwitch(f.deps);
    expect(r).toMatchObject({ ok: false, error: 'This window is not a project.' });
    expect(f.calls).toEqual([]);
  });

  test('outside the app nothing is invoked', async () => {
    const f = fakes(false, []);
    const r = await runTeamSwitch({ ...f.deps, native: false });
    expect(r).toMatchObject({ ok: false, error: TEAM_SWITCH_WORDS.needsApp });
    expect(f.invoked).toEqual([]);
  });
});
