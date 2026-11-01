// r4 #8 (Michal, "v alligators jsem se chtel prihlasit ale vsechny pole jsou disabled"): the team-server
// sign-in the format callout opens ("Sign in" / "Sign in again") rendered INSIDE the callout stack, and the
// stack is `inert` while any aria-modal dialog is open -- including this one. Every field and button in the
// dialog was therefore unreachable (no focus, no click, no typing): "all the fields are disabled". The
// dialogs of the callout now render at the document body, outside the inert stack.

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

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const HUB = 'https://alligators.cloud.maude.sh';
const realFetch = globalThis.fetch;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  globalThis.fetch = realFetch;
});

const roleless = {
  name: 'alligators',
  designRel: '.design',
  formatVersion: 1,
  formatGate: { projectFormat: 1, supported: 2, source: 'config' },
  readOnlyReason: 'role',
  roleSource: 'missing',
  linkedHub: { url: HUB, linkedAt: 1 },
};
const dryMember = {
  format: 'maude.migrate-report',
  steps: [],
  refusals: [{ path: '', reason: 'not-owner', code: 'not-owner' }],
  dryRun: true,
  exitCode: 11,
  autoConvert: { allowed: true },
  project: {
    formatBefore: 1,
    linked: { hub: HUB, role: 'member', hubFormat: 2, capabilities: ['format-v2'], modeDue: false },
  },
};

const wait = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const $ = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('the sign-in dialog opened from the callout stack is reachable', () => {
  test('no field of the dialog sits inside an inert subtree; the callouts behind it stay inert', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      new Response(String(input) === '/_api/project/migrate' ? JSON.stringify(dryMember) : '{}', {
        status: 200,
      })) as typeof fetch;
    const { ShellStoreContext } = await import('../client/stores/shell-store.jsx');
    const { OlderFormatCallout } = await import('../client/v2/shell/format-update.jsx');
    const { CalloutStack } = await import('../client/v2/shell/callouts.jsx');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <ShellStoreContext.Provider
          value={{ shellCore: { cfg: roleless, project: 'alligators' } } as never}
        >
          <CalloutStack>
            <OlderFormatCallout />
          </CalloutStack>
        </ShellStoreContext.Provider>
      )
    );
    await wait(20);
    await act(async () => $('format-older-sign-in')?.click());
    await wait(40);
    const dialog = $('team-projects-dialog');
    expect(dialog).not.toBe(null);
    const inputs = [...(dialog?.querySelectorAll('input') ?? [])] as HTMLInputElement[];
    expect(inputs.length).toBe(3);
    for (const i of inputs) {
      expect(i.disabled).toBe(false);
      expect(i.closest('[inert]')).toBe(null);
    }
    // the dialog is outside the callout stack altogether (the stack stays inert behind it, S11.18)
    expect(dialog?.closest('[data-testid="callouts"]')).toBe(null);
  });
});
