// r1-roleless-signin (Michal rc.1, finding 1, option A) — the format callout, rendered (happy-dom). A
// format-1 project linked through a record WITHOUT a role (`/_config` readOnlyReason 'role' +
// roleSource 'missing') offers Sign in — the team server's own sign-in, the same dialog the
// no-sign-in case opens — and never "Ask the owner". Once the sign-in stores an owner role, `/_config`
// stops saying 'role' and the project converts by itself. A role the hub vouched (observer) still
// says Ask the owner.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const w = window as unknown as { __TAURI__?: unknown };
  w.__TAURI__ = { core: { invoke: async () => [] } };
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const HUB = 'https://design.example';
const realFetch = globalThis.fetch;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
  try {
    sessionStorage.clear();
  } catch {}
});

const roleless = {
  name: 'armory',
  designRel: '.design',
  formatVersion: 1,
  formatGate: { projectFormat: 1, supported: 2, source: 'config' },
  readOnlyReason: 'role',
  roleSource: 'missing',
  linkedHub: { url: HUB, linkedAt: 1 },
};
const REPORT = { format: 'maude.migrate-report', steps: [], refusals: [] };
const dryOwner = {
  ...REPORT,
  dryRun: true,
  exitCode: 0,
  autoConvert: { allowed: true },
  project: {
    formatBefore: 1,
    linked: { hub: HUB, role: 'owner', hubFormat: 2, capabilities: ['format-v2'], modeDue: false },
  },
};
const dryMember = {
  ...dryOwner,
  exitCode: 11,
  refusals: [{ path: '', reason: 'not-owner', code: 'not-owner' }],
  project: { ...dryOwner.project, linked: { ...dryOwner.project.linked, role: 'member' } },
};

function mockMigrate(dry: () => unknown) {
  const calls = { dry: 0, apply: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/_api/project/migrate') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.apply) {
        calls.apply++;
        return new Response(
          JSON.stringify({
            ...REPORT,
            dryRun: false,
            exitCode: 0,
            project: { formatBefore: 1, linked: null },
          }),
          { status: 200 }
        );
      }
      calls.dry++;
      return new Response(JSON.stringify(dry()), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return calls;
}

const wait = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const kind = () => $('format-older-callout')?.getAttribute('data-kind') ?? null;
const line = () => $('format-older-callout')?.textContent ?? '';

let setCfg: (c: Record<string, unknown>) => void = () => {};

/** Mounts the callout with a cfg the test can change (the shell re-reads `/_config` on access:changed). */
async function mount(cfg0: Record<string, unknown>) {
  const { ShellStoreContext } = await import('../client/stores/shell-store.jsx');
  const { OlderFormatCallout } = await import('../client/v2/shell/format-update.jsx');
  function Host() {
    const [cfg, set] = useState(cfg0);
    setCfg = set;
    return (
      <ShellStoreContext.Provider value={{ shellCore: { cfg, project: 'armory' } } as never}>
        <OlderFormatCallout />
      </ShellStoreContext.Provider>
    );
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Host />));
  await wait(20);
}

describe('a record without a role: Sign in, not Ask the owner', () => {
  test('the line says Sign in, the button opens the team-server sign-in for the linked hub', async () => {
    const { OLDER_COPY, FAIL_COPY } = await import('../client/v2/shell/format-update.js');
    const calls = mockMigrate(() => dryMember);
    await mount(roleless);
    expect(kind()).toBe('roleless');
    expect(line()).toContain(OLDER_COPY.olderRoleless('design.example'));
    expect(line()).toContain('Sign in');
    expect(line()).not.toContain('Ask the owner');
    expect(calls.apply).toBe(0);
    const btn = $('format-older-sign-in');
    expect(btn?.textContent).toBe(FAIL_COPY.signIn);
    // one action (CONTRACT §4)
    expect($('format-older-callout')?.querySelectorAll('button').length).toBe(1);
    await act(async () => btn?.click());
    await wait(20);
    const dialog = $('team-projects-dialog');
    expect(dialog).not.toBe(null);
    // the server field is the project's hub
    const inputs = [...(dialog?.querySelectorAll('input') ?? [])] as HTMLInputElement[];
    expect(inputs.some((i) => i.value === HUB)).toBe(true);
  });

  test('the sign-in stores owner → `/_config` drops the role reason → it converts by itself', async () => {
    let signedIn = false;
    const calls = mockMigrate(() => (signedIn ? dryOwner : dryMember));
    await mount(roleless);
    expect(kind()).toBe('roleless');
    expect(calls.apply).toBe(0);
    // the workspace sign-in rewrote hubs.json with role owner; the shell re-reads /_config
    signedIn = true;
    await act(async () => setCfg({ ...roleless, readOnlyReason: 'format', roleSource: null }));
    await wait(40);
    expect(calls.apply).toBe(1);
  });

  test('a role the hub vouched (observer) still says Ask the owner, no button', async () => {
    const { OLDER_COPY } = await import('../client/v2/shell/format-update.js');
    mockMigrate(() => dryMember);
    await mount({ ...roleless, roleSource: 'stored' });
    expect(kind()).toBe('non-owner');
    expect(line()).toContain(OLDER_COPY.olderNonOwner);
    expect($('format-older-sign-in')).toBe(null);
  });
});
