import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * 11 pn-accounts — "The account belongs to the project, on this Mac. It sits by the faces. Signing out signs out every
 * project on that account." The REAL account chip and card in the real shell, fed by the two seams a second sign-in
 * would feed (this lane has no cloud and one profile): `GET /_api/cloud/status` (connected, the e-mail) and the shell's
 * `accounts_list` (the Mac's accounts and their projects). Everything else — the profile (`/_config.profile`), the
 * project name, the chip, the card, the words — is the product's. The sign-in itself (a browser, a keychain) and the
 * two-profile bookkeeping in Rust are `project-tabs-identity` and the cargo tests; signing out is NOT pressed here.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const OTHERS = ['Studio site', 'Portfolio 2026', ...Array.from({ length: 11 }, (_, i) => `Side project ${i + 1}`)];

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

  it('with two accounts on this Mac the chip sits by the faces and the card says whose project this is', async () => {
    const seam = (await browser.executeAsync(
      (mine: { id: string; label: string }, email: string, others: string[], done: (v: string) => void) => {
        try {
          const w = window as unknown as {
            __e2eRealTauri?: Record<string, unknown>;
            __e2eRealFetch?: typeof fetch;
            __TAURI__: { core: { invoke: (c: string, a?: unknown, o?: unknown) => Promise<unknown> } };
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
                      { id: mine.id, label: mine.label, email, projects: ['this project'] },
                      { id: 'e2e-personal', label: 'Personal', email: 'you@gmail.com', projects: others },
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
    expect(await chip.getAttribute('aria-label')).toBe(`Account: ${me.label} · ${EMAIL}`);
    await capture('account chip');
    await chip.click();
    await $(tid('account-card')).waitForExist({ timeout: 6_000 });
    const t = async (id: string) => ((await $(tid(id))).getText() as Promise<string>);
    const current = await t('account-card-current');
    expect(current).toContain(`${me.label} · ${EMAIL}`);
    expect(current).toMatch(/ uses this account$/);
    const other = await t('account-card-other-e2e-personal');
    expect(other).toContain('Personal · you@gmail.com');
    expect(other).toContain('Studio site, Portfolio 2026 and 11 more');
    expect(await $(tid('account-card')).getText()).toContain('Also on this Mac');
    expect(await t('account-card-switch')).toBe('Sign in as another account…');
    const out = await t('account-card-signout');
    expect(out).toContain(`Sign out of ${EMAIL}…`);
    expect(out).toContain('Signs out every project on it');
    expect(await t('account-card-foot')).toMatch(
      new RegExp(`^Kept on this Mac — .+ opens as ${me.label} next time\\.$`)
    );
    await capture('account card');
    // the confirm names the effect; Cancel leaves everything as it was (nothing is signed out here)
    await $(tid('account-card-signout')).click();
    await $(tid('account-card-confirm')).waitForExist({ timeout: 4_000 });
    const ask = await t('account-card-confirm');
    expect(ask).toContain(`Sign out of ${EMAIL}?`);
    expect(ask).toContain('Every project on it is signed out. Your work stays on this Mac.');
    await capture('account sign-out confirm');
    await $(tid('account-card-signout-cancel')).click();
    // esc inside the card closes it (the card owns its keys; focus left with the Cancel button that went away)
    await browser.execute(() => {
      document
        .querySelector('[data-testid="account-card"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await browser.waitUntil(async () => !(await $(tid('account-card')).isExisting()), {
      timeout: 4_000,
      interval: 100,
      timeoutMsg: 'esc did not close the card',
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
