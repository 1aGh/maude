import { readFileSync } from 'node:fs';

import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { focusTab, waitWindow } from '../helpers/windows';

/**
 * S6.11 — an invite reaches Home (02 ob-invite-landed, ob-edge-accounts; contract S6-S9 §5.1–§5.3).
 *
 *  1. A dead invite link (`maude://invite/<id>` through the REAL routing, `e2e_route_deep_link`) brings
 *     Home forward and says the cloud's words; nothing opens and no sheet asks.
 *  2. A live invite while nobody is signed in: "Open the invite as you@work-studio.cz?" with who invited
 *     that address to which project; Escape closes it. Home asked the stub for the peek only — no
 *     accept, nothing attached — and the id is nowhere in Home's DOM.
 *
 * Not in this lane yet (needs a local cell on Node 24 — memory `maude-local-cell-needs-node-24`): the
 * matching profile landing on the canvas with the thread open, and the other-account sheet's Open
 * signing in a new profile in its own tab (the browser leg of the device flow). invite-flow.test.tsx
 * proves both against stubbed Rust + Home server.
 *
 * Config: wdio.invite-landing.conf.ts (stub control plane, throwaway profiles + keychain).
 */
const HOME = 'home';
const LIVE = '0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab';
const DEAD = '0b6f3d4e-1c2a-4b5d-8e9f-00000000dead';
const GONE = 'This invitation link is not valid. Ask the person who invited you for a new one.';
const tid = (s: string) => `[data-testid="${s}"]`;

async function onHome(): Promise<void> {
  await waitWindow(HOME);
  await browser.switchToWindow(HOME);
  await browser.waitUntil(
    async () => {
      try {
        return await browser.execute(
          () => location.protocol === 'http:' && document.readyState === 'complete'
        );
      } catch {
        return false;
      }
    },
    { timeout: 120_000, interval: 250, timeoutMsg: 'Home never reached its server' }
  );
  await focusTab(HOME);
  await (await $(tid('home-root'))).waitForDisplayed({ timeout: 90_000 });
}

async function route(url: string) {
  return browser.execute(
    (u: string) =>
      // biome-ignore lint/suspicious/noExplicitAny: __TAURI__ is an injected global
      (window as any).__TAURI__.core.invoke('e2e_route_deep_link', { url: u }).then(
        () => ({}),
        (err: unknown) => ({ err: String(err) })
      ),
    url
  ) as Promise<{ err?: string }>;
}

const stubLog = () =>
  readFileSync(process.env.MAUDE_E2E_INVITE_LOG ?? '', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { method: string; path: string });

describe('invite-landing (native-desktop)', () => {
  before(async () => {
    startReport('invite-landing (native-desktop)');
    await onHome();
  });

  it('1 · a dead invite says so on Home; nothing opens, nothing asks', async () => {
    expect((await route(`maude://invite/${DEAD}`)).err).toBeUndefined();
    await browser.waitUntil(async () => (await $('body').getText()).includes(GONE), {
      timeout: 15_000,
      timeoutMsg: 'the dead-invite words never showed',
    });
    expect(await $(tid('invite-sheet')).isExisting()).toBe(false);
    await capture('01-dead-invite');
  });

  it('2 · signed out: "Open the invite as <address>?" — peek only, nothing attached, no id in the page', async () => {
    expect((await route(`maude://invite/${LIVE}`)).err).toBeUndefined();
    const sheet = await $(tid('invite-sheet'));
    await sheet.waitForDisplayed({ timeout: 15_000 });
    expect(await sheet.getAttribute('data-mode')).toBe('signed-out');
    expect(await $(tid('invite-sheet-title')).getText()).toBe(
      'Open the invite as you@work-studio.cz?'
    );
    expect(await $(tid('invite-sheet-body')).getText()).toBe(
      'Tereza invited that address to Alligators brand.'
    );
    const html = await browser.execute(() => document.documentElement.outerHTML);
    expect(html.includes(LIVE)).toBe(false);
    await capture('02-invite-sheet-signed-out');

    await browser.keys('Escape');
    await sheet.waitForExist({ reverse: true, timeout: 5_000 });
    const asked = stubLog().filter((r) => r.path.startsWith('/api/invites/'));
    expect(asked.map((r) => `${r.method} ${r.path}`)).toEqual([
      `GET /api/invites/${DEAD}/peek`,
      `GET /api/invites/${LIVE}/peek`,
    ]);
  });
});
