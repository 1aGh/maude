import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * S9.24 — a day offline, back online, the same sticky changed on two Macs (10 · co-sync-offline,
 * co-sync-back, co-conflict). DOM-driven; the canvas iframe is never reached (the card, the mark and
 * the foot are shell islands).
 *
 *   1. the team server goes away (SIGSTOP); the designer changes the sticky on this Mac — the
 *      Canvases foot says the change is kept on this Mac
 *   2. meanwhile the teammate changes the SAME sticky on theirs (their proposal is accepted first)
 *   3. the server returns: the toast says one sticky needs a look, and the "2 versions" mark shows
 *   4. the card draws both versions; Keep both puts the designer's version beside the teammate's —
 *      on BOTH copies (the asymmetric direction: the teammate's copy must get the copy too)
 *   5. the reverse race: the teammate is the one who loses — no card on THIS Mac
 *
 * Runs under wdio.team-project.conf.ts (real hub + seeding teammate), AFTER team-project.e2e.ts has
 * signed the designer in; skips otherwise. Not part of any CI lane yet.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const TEAM = process.env.MAUDE_E2E_TEAM
  ? (JSON.parse(process.env.MAUDE_E2E_TEAM) as {
      hub: string;
      teammate: string;
      managedDir: string;
      hubPid: number;
    })
  : null;

const BOARD = 'ui-welcome.annotations.json';
const sticky = (id: string, text: string, x = 630) => ({
  id,
  type: 'sticky',
  index: 'a0',
  x,
  y: 460,
  w: 190,
  h: 120,
  text,
});
const board = (els: ReturnType<typeof sticky>[]) =>
  `{"v":2,"elements":[\n${els.map((e) => JSON.stringify(e)).join(',\n')}\n]}\n`;
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const texts = (p: string) => {
  try {
    return (JSON.parse(read(p) ?? '{}').elements ?? []).map((e: { text?: string }) => e.text);
  } catch {
    return [];
  }
};

async function eventually(what: string, fn: () => boolean | Promise<boolean>, timeout = 60_000) {
  await browser.waitUntil(async () => !!(await fn()), {
    timeout,
    interval: 500,
    timeoutMsg: `timed out: ${what}`,
  });
}

describe('offline-conflict (native-desktop)', () => {
  before(async function () {
    if (!TEAM || !existsSync(join(TEAM.managedDir, '.design'))) this.skip();
    startReport('offline-conflict (native-desktop) — the same sticky changed on two Macs');
    await browser.setTimeout({ script: 60_000 });
    await pinCurrentWindow().catch(() => {});
    await waitForSidecar();
  });

  const t = () => TEAM as NonNullable<typeof TEAM>;
  const mine = () => join(t().managedDir, '.design', BOARD);
  const theirs = () => join(t().teammate, '.design', BOARD);

  it('0 · both copies hold the sticky as it was', async () => {
    writeFileSync(theirs(), board([sticky('s1', 'Číslo na zádech?')]));
    await eventually('the base sticky on this Mac', () =>
      texts(mine()).includes('Číslo na zádech?')
    );
  });

  it('1–3 · offline edit, the teammate’s edit lands first, back online with one sticky to look at', async () => {
    process.kill(t().hubPid, 'SIGSTOP');
    try {
      writeFileSync(mine(), board([sticky('s1', 'Číslo na zádech větší — 30 cm')]));
      const foot = await $(`${tid('canvases-foot')}[data-slot="sync"]`);
      await foot.waitForDisplayed({ timeout: 60_000 });
      expect(await foot.getText()).toContain('kept on this Mac');
      await capture('01-offline-foot');
    } finally {
      process.kill(t().hubPid, 'SIGCONT');
    }
    // the teammate's change reaches the project before this Mac's outbox drains
    writeFileSync(
      theirs(),
      board([sticky('s1', 'Číslo 25 cm — jinak se nad něj nevejde sponzor')])
    );
    const mark = await $(tid('sync-conflict-mark'));
    await mark.waitForDisplayed({ timeout: 120_000 });
    expect(await mark.getText()).toContain('2 versions');
    const toast = await $('*=one sticky needs a look');
    expect(await toast.isExisting()).toBe(true);
    await capture('02-back-online-mark');
  });

  it('4 · Keep both: the designer’s version beside the teammate’s, on both copies', async () => {
    await (await $(tid('sync-conflict-mark'))).click();
    const card = await $(tid('sync-conflict-card'));
    await card.waitForDisplayed({ timeout: 15_000 });
    expect(await (await $(tid('sync-conflict-mine'))).getText()).toContain('30 cm');
    expect(await (await $(tid('sync-conflict-theirs'))).getText()).toContain('25 cm');
    await capture('03-conflict-card');
    await (await $(tid('sync-conflict-keep-both'))).click();
    await card.waitForDisplayed({ reverse: true, timeout: 15_000 });
    for (const [who, p] of [
      ['this Mac', mine()],
      ['the teammate', theirs()],
    ] as const)
      await eventually(
        `both versions at ${who}`,
        () => {
          const all = texts(p);
          return (
            all.some((x: string) => x?.includes('30 cm')) &&
            all.some((x: string) => x?.includes('25 cm'))
          );
        },
        120_000
      );
    await capture('04-kept-both');
  });

  it('5 · the reverse race: the teammate loses — no card here', async () => {
    writeFileSync(mine(), board([sticky('s1', 'Mine first')]));
    await eventually('mine at the teammate', () => texts(theirs()).includes('Mine first'), 120_000);
    expect(await (await $(tid('sync-conflict-mark'))).isExisting()).toBe(false);
    await capture('05-reverse-no-card');
  });
});
