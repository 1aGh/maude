// r4 #9 (Michal: "v home jsem dal sign in with maude cloud ... vyskocil kod ale maude desktop zadny code
// neukazuje, je to matouci"; decision v2-michal-r4-cloud-signin-show-code): the page the browser opens
// asks the person to confirm a code, so the app shows the SAME code in its waiting state, with one plain
// line, and never auto-approves. Home's card is pinned in home-first-run.test.tsx; this file pins the
// project-side sign-in sheet (Connections / the cloud bar) and the card's words.

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

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}

describe('the waiting sign-in shows the code the browser shows', () => {
  test('the project sheet says "Check that the browser shows this code:" and shows the code', async () => {
    const { CloudDeviceDialog } = await import('../client/panels/CloudBar.jsx');
    const h = await mount(
      <CloudDeviceDialog
        device={{
          userCode: 'HGU4-D9WE',
          verificationUrl: 'https://cloud.maude.sh/activate?code=HGU4-D9WE',
        }}
        cloudUrl="https://cloud.maude.sh"
        openFailed=""
        onOpenResult={() => {}}
        onCancel={() => {}}
      />
    );
    expect(h.textContent).toContain('Check that the browser shows this code:');
    expect(h.textContent).not.toContain('dashboard');
    expect(h.querySelector('[data-testid="cloud-user-code"]')?.textContent).toBe('HGU4-D9WE');
  });

  test("Home's card shows the code the moment it waits, without asking for it", async () => {
    const { SignInCard } = await import('../client/v2/signin/SignInCard.jsx');
    const h = await mount(
      <SignInCard mode="waiting" userCode="HGU4-D9WE" onCloud={() => {}} onLocal={() => {}} />
    );
    expect(h.querySelector('[data-testid="signin-code"]')?.textContent).toBe('HGU4-D9WE');
    expect(h.querySelector('[data-testid="signin-code-check"]')?.textContent).toBe(
      'Check that the browser shows this code:'
    );
  });

  test('before the start answered there is no code box (nothing to compare yet)', async () => {
    const { SignInCard } = await import('../client/v2/signin/SignInCard.jsx');
    const h = await mount(<SignInCard mode="waiting" onCloud={() => {}} onLocal={() => {}} />);
    expect(h.querySelector('[data-testid="signin-code-box"]')).toBe(null);
  });
});
