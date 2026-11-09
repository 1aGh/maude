// 2.1.1 T7 — what the accounts lane's specs share (wdio.accounts.conf.ts): their world, the account chip's state,
// the Settings card, and the app shots the plan asks for.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { $, browser } from '@wdio/globals';

import type { AccountsWorld } from '../wdio.accounts.conf';
import { capture } from './evidence';

const HERE = dirname(fileURLToPath(import.meta.url));
export const tid = (s: string) => `[data-testid="${s}"]`;

/**
 * The 2.1.1 security-review rule (lead, 2026-11-09), landing in two fix branches: a committed `linkedHub` this
 * Mac never linked or confirmed is NOT a broken sign-in (no toast, no red badge, "Review…" through the link
 * consent), and linking a folder to a server this Mac never linked always asks first, even an empty one. The
 * specs assert that by default. `MAUDE_E2E_PRE_CONSENT_FIX=1` runs them on a tree from before those merges: the
 * unconfirmed-address case is skipped and an empty server links without the ask (the 2.1.1 B5 behaviour).
 */
export const PRE_CONSENT_FIX = process.env.MAUDE_E2E_PRE_CONSENT_FIX === '1';

/** This spec's world (the launcher set every world up; the spec file names its own). */
export function world(spec: string): AccountsWorld & { me: AccountsWorld['specs'][string] } {
  const all = JSON.parse(process.env.MAUDE_E2E_ACCOUNTS ?? 'null') as AccountsWorld | null;
  if (!all)
    throw new Error('MAUDE_E2E_ACCOUNTS is unset — run this spec through wdio.accounts.conf.ts');
  const me = all.specs[spec];
  if (!me) throw new Error(`no accounts world for ${spec}`);
  return { ...all, me };
}

/** What reached the lane's Maude Cloud tripwire (every request line), [] when nothing did. */
export function cloudContacts(w: AccountsWorld): string[] {
  return readFileSync(w.cloudLog, 'utf8').split('\n').filter(Boolean);
}

/** The plan's app shots (`.ai/scenarios/accounts-2.1.1/app-shots/<name>.png`): the run's capture, copied there. */
export const APP_SHOTS = resolve(HERE, '../../../../.ai/scenarios/accounts-2.1.1/app-shots');
export async function appShot(name: string): Promise<string> {
  // sheets and popovers ease in; a shot mid-fade shows two layers at once
  await browser.pause(800);
  const file = await capture(name);
  mkdirSync(APP_SHOTS, { recursive: true });
  const out = join(APP_SHOTS, `${name}.png`);
  copyFileSync(file, out);
  return out;
}

/** The account chip's face: kind, connection state and badge (null while the chip is not drawn). */
export async function chipState(): Promise<{
  kind: string | null;
  conn: string | null;
  badge: string | null;
  label: string | null;
} | null> {
  return browser.execute(() => {
    const chip = document.querySelector('[data-testid="share-cluster-account"]');
    if (!chip) return null;
    const badge = chip.querySelector('[data-testid="share-cluster-account-badge"]');
    return {
      kind: chip.getAttribute('data-kind'),
      conn: chip.getAttribute('data-conn'),
      badge: badge ? badge.getAttribute('data-badge') : null,
      label: chip.getAttribute('aria-label'),
    };
  });
}

/** Wait until the chip says one of `states`; the error names what it said last. */
export async function waitConn(states: string[], timeout = 60_000): Promise<void> {
  let last: unknown = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await chipState();
        return !!last && states.includes(String((last as { conn: string }).conn));
      },
      { timeout, interval: 500 }
    );
  } catch {
    // the message is built here: a `timeoutMsg` string is fixed before the first sample
    throw new Error(
      `the account chip never said ${states.join(' / ')} — last ${JSON.stringify(last)}`
    );
  }
}

/** Open the account menu from the chip (it toggles: opens only when closed). */
export async function openAccountMenu(): Promise<void> {
  if (await (await $(tid('account-menu'))).isExisting()) return;
  const chip = await $(tid('share-cluster-account'));
  await chip.waitForDisplayed({ timeout: 30_000 });
  await chip.click();
  await (await $(tid('account-menu'))).waitForDisplayed({ timeout: 6_000 });
}

export async function closeAccountMenu(): Promise<void> {
  if (!(await (await $(tid('account-menu'))).isExisting())) return;
  await browser.keys(['Escape']);
  await browser.waitUntil(async () => !(await (await $(tid('account-menu'))).isExisting()), {
    timeout: 5_000,
    timeoutMsg: 'esc did not close the account menu',
  });
}

/** The notices on screen whose id starts with `signin-` (the broken sign-in toast), with their text. */
export async function signInNotices(): Promise<{ id: string; text: string }[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid^="notice-signin-"]')).map((el) => ({
      id: el.getAttribute('data-testid') || '',
      text: (el.textContent || '').trim(),
    }))
  );
}

/** Settings on `tab` (general · connections · advanced), opened from the one menu when it is not up. */
export async function openSettings(tab: 'general' | 'connections' | 'advanced'): Promise<void> {
  if (!(await (await $(tid('settings-sheet'))).isExisting())) {
    await (await $(tid('project-pill'))).click();
    const row = await $(tid('project-menu-row-settings.open'));
    await row.waitForDisplayed({ timeout: 10_000 });
    await row.click();
    await (await $(tid('settings-sheet'))).waitForDisplayed({ timeout: 10_000 });
  }
  await (await $(tid(`settings-tab-${tab}`))).click();
  await (await $(tid(`settings-panel-${tab}`))).waitForDisplayed({ timeout: 10_000 });
}

/** General's This project card, opened. */
export async function openThisProject(): Promise<void> {
  await openSettings('general');
  const card = await $(tid('settings-card-this-project-toggle'));
  await card.waitForDisplayed({ timeout: 15_000 });
  if ((await card.getAttribute('aria-expanded')) !== 'true') await card.click();
}

export async function closeSettings(): Promise<void> {
  const close = await $(tid('settings-close'));
  if (await close.isExisting()) await close.click();
  await browser
    .waitUntil(async () => !(await (await $(tid('settings-sheet'))).isExisting()), {
      timeout: 5_000,
    })
    .catch(() => {});
}

/** The project's config.json as it is on disk now. */
export function projectConfig(
  root: string
): { linkedHub?: { url?: string } } & Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8'));
}

/** This Mac's stored sign-in for `hub` in `hubsFile` (true when a record with a token is there). */
export function storedSignIn(hubsFile: string, hub: string): boolean {
  if (!existsSync(hubsFile)) return false;
  const doc = JSON.parse(readFileSync(hubsFile, 'utf8')) as {
    hubs?: Record<string, { token?: string }>;
  };
  const key = Object.keys(doc.hubs ?? {}).find((k) => k.replace(/\/+$/, '') === hub);
  return !!(key && doc.hubs?.[key]?.token);
}

/** The non-retired document paths a hub holds (its bootstrap), as the owner sees them. */
export async function hubDocs(hub: string, ownerToken: string): Promise<string[]> {
  const r = await fetch(`${hub}/api/projects/current/v1/bootstrap`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  if (r.status !== 200) return [];
  const j = (await r.json()) as { docs?: { path: string; retired?: boolean }[] };
  return (j.docs ?? []).filter((d) => !d.retired).map((d) => d.path);
}

/** A one-artboard canvas titled `title` (the lane's projects and their edits). */
export const canvasSource = (
  title: string
) => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="${title}">
        <DCArtboard id="main" label="MAIN" width={480} height={320}>
          <h1 style={{ padding: 32, fontFamily: "system-ui", color: "#111" }}>${title}</h1>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

export const specName = (file: string) => basename(file);
