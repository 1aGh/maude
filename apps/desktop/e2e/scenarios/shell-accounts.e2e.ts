import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * 11 pn-accounts — "The account belongs to the project, on this Mac. It sits by the faces. Signing out signs out every
 * project on that account." The REAL account chip and card in the real shell, fed by the two seams a second sign-in
 * would feed (this lane has no cloud and one profile): `GET /_api/cloud/status` (connected, the e-mail) and the shell's
 * `accounts_list` (the Mac's accounts and their projects). Everything else — the profile (`/_config.profile`), the
 * project name, the chip, the card, the words — is the product's. The chip opens the project's account card
 * (`account-menu` + `account-switch`, 2.1.1 T2/T4 — they replaced the W4 `project-account` card). The sign-in itself (a browser, a keychain) and the
 * two-profile bookkeeping in Rust are `project-tabs-identity` and the cargo tests; signing out is NOT pressed here.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const OTHERS = [
  'Studio site',
  'Portfolio 2026',
  ...Array.from({ length: 11 }, (_, i) => `Side project ${i + 1}`),
];

describe('shell-accounts (11 pn-accounts)', () => {
  let me: { id: string; label: string } = { id: 'default', label: 'default' };
  const EMAIL = 'you@work-studio.cz';

  before(async () => {
    startReport('shell-accounts');
    await waitForSidecar();
    await pinCurrentWindow();
    await $('[data-testid^="canvas-row-"]').waitForExist({ timeout: 60_000 });
    const cfg = (await browser.executeAsync((done: (v: unknown) => void) => {
      fetch('/_config', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => done(j?.profile ?? null))
        .catch(() => done(null));
    })) as { id?: string; label?: string } | null;
    me = { id: cfg?.id ?? 'default', label: cfg?.label || cfg?.id || 'default' };
  });

  it('with two accounts on this Mac the chip sits by the faces and the project account card says whose project this is', async () => {
    const seam = (await browser.executeAsync(
      (
        mine: { id: string; label: string },
        email: string,
        others: string[],
        done: (v: string) => void
      ) => {
        try {
          const w = window as unknown as {
            __e2eRealTauri?: Record<string, unknown>;
            __e2eRealFetch?: typeof fetch;
            __TAURI__: {
              core: { invoke: (c: string, a?: unknown, o?: unknown) => Promise<unknown> };
            };
          };
          w.__e2eRealTauri ??= w.__TAURI__;
          const realTauri = w.__e2eRealTauri as unknown as typeof w.__TAURI__;
          const realInvoke = realTauri.core.invoke;
          w.__TAURI__ = {
            ...realTauri,
            core: {
              ...realTauri.core,
              invoke: (cmd: string, args?: unknown, opts?: unknown) =>
                cmd === 'accounts_list'
                  ? Promise.resolve([
                      {
                        id: mine.id,
                        label: mine.label,
                        email,
                        projects: ['this project'],
                        signedIn: true,
                      },
                      {
                        id: 'e2e-personal',
                        label: 'Personal',
                        email: null,
                        projects: others.length,
                        signedIn: true,
                      },
                    ])
                  : realInvoke(cmd, args, opts),
            },
          } as typeof w.__TAURI__;
          w.__e2eRealFetch ??= window.fetch.bind(window);
          const realFetch = w.__e2eRealFetch;
          window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
            String(input).includes('/_api/cloud/status')
              ? Promise.resolve(
                  new Response(JSON.stringify({ connected: true, email }), {
                    headers: { 'content-type': 'application/json' },
                  })
                )
              : realFetch(input, init)) as typeof fetch;
          window.dispatchEvent(new CustomEvent('maude:cloud-changed', { detail: { from: 'e2e' } }));
          done('ok');
        } catch (e) {
          done(`threw ${String(e)}`);
        }
      },
      me,
      EMAIL,
      OTHERS
    )) as string;
    expect(seam).toBe('ok');
    const chip = await $(tid('share-cluster-account'));
    await chip.waitForExist({
      timeout: 15_000,
      timeoutMsg: 'no account chip with two accounts on this Mac',
    });
    // 2.1.1 T2 (canvas 17): the face is the account — a Maude Cloud circle for a signed-in profile
    expect(await chip.getAttribute('data-kind')).toBe('cloud');
    expect(await chip.getAttribute('aria-label')).toContain(EMAIL);
    await capture('account chip');
    // the chip opens THIS project's account menu (2.1.1: `account-menu`, replacing `project-account`)
    await chip.click();
    await $(tid('account-menu')).waitForExist({ timeout: 6_000 });
    const t = async (id: string) => (await $(tid(id))).getText() as Promise<string>;
    // the seam says this profile is signed in to Maude Cloud as EMAIL: the block names it
    expect(await t('account-menu-account')).toContain(EMAIL);
    expect(await t('account-menu-where')).not.toBe('');
    await capture('account menu');
    // Switch account: the accounts already on this Mac; picking another asks first, Cancel changes nothing
    await $(tid('account-menu-switch')).click();
    await $(tid('account-switch')).waitForExist({ timeout: 4_000 });
    expect(await $(tid(`account-switch-row-${me.id}`)).getAttribute('aria-checked')).toBe('true');
    await $(tid('account-switch-row-e2e-personal')).click();
    await $(tid('account-switch-sheet')).waitForExist({ timeout: 4_000 });
    expect(await t('account-switch-sheet')).toContain('Nothing is moved or uploaded');
    await capture('account switch sheet');
    await $(tid('account-switch-sheet-cancel')).click();
    // esc closes the menu (the popover listens on the document)
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await $(tid('account-menu')).isExisting()), {
      timeout: 4_000,
      interval: 100,
      timeoutMsg: 'esc did not close the menu',
    });
  });

  after(async () => {
    await browser.execute(() => {
      const w = window as unknown as {
        __e2eRealTauri?: unknown;
        __e2eRealFetch?: typeof fetch;
        __TAURI__: unknown;
      };
      if (w.__e2eRealTauri) w.__TAURI__ = w.__e2eRealTauri;
      if (w.__e2eRealFetch) window.fetch = w.__e2eRealFetch;
    });
  });
});
