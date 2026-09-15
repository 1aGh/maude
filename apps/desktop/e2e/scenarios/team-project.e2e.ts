import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * Plan T21/T22 — a designer who was added to a project opens the desktop app,
 * picks the project and works. On a clean install, through the real wizard DOM:
 *
 *   1. first run → "Open a project you were invited to"
 *   2. the team server's address + email + password — no token, no folder
 *   3. the app opens the project's OWN copy (keyed by server + project) and the
 *      teammate's canvases arrive
 *   4. a teammate's change reaches the designer's copy; the designer's change
 *      reaches the teammate — both ways, no sync vocabulary anywhere
 *   5. the switcher names the project and offers the team projects again
 *
 * Only runs under wdio.team-project.conf.ts (real hub + seeding teammate).
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const TEAM = process.env.MAUDE_E2E_TEAM
  ? (JSON.parse(process.env.MAUDE_E2E_TEAM) as {
      hub: string;
      teammate: string;
      managedDir: string;
      password: string;
    })
  : null;

const canvas = (title: string) => `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection id="main" title="Team project">
        <DCArtboard id="main" label="MAIN" width={480} height={320}>
          <h1 style={{ padding: 32, fontFamily: "system-ui", color: "#111" }}>${title}</h1>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function eventually(what: string, fn: () => boolean | Promise<boolean>, timeout = 60_000) {
  await browser.waitUntil(async () => (await fn()) === true, {
    timeout,
    interval: 500,
    timeoutMsg: `timed out: ${what}`,
  });
}

describe('team-project (native-desktop)', () => {
  before(async function () {
    if (!TEAM) this.skip();
    startReport('team-project (native-desktop) — invited designer opens the project, no folder');
    await browser.setTimeout({ script: 60_000 });
  });

  it('1 · first run offers the invited-project door', async () => {
    await waitForSidecar();
    expect(await isNativeShell()).toBe(true);
    const door = await $(tid('ob-door-team'));
    await door.waitForDisplayed({ timeout: 180_000 });
    expect(await door.getText()).toContain('invited');
    await capture('01-first-run-team-door');
    await door.click();
    await (await $(tid('team-projects'))).waitForDisplayed({ timeout: 15_000 });
    await capture('02-team-projects');
  });

  it('2 · a wrong password says so, and nothing opens', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    await (await $(tid('team-hub-url'))).setValue(t.hub);
    await (await $(tid('team-hub-email'))).setValue('designer@x.test');
    await (await $(tid('team-hub-password'))).setValue('not-the-password');
    await (await $(tid('team-hub-open'))).click();
    const err = await $(tid('team-error'));
    await err.waitForDisplayed({ timeout: 20_000 });
    const text = (await err.getText()).toLowerCase();
    expect(text).not.toContain('token');
    expect(existsSync(t.managedDir)).toBe(false);
    await capture('03-wrong-password');
  });

  it('3 · email + password opens the project’s own copy with the teammate’s canvases', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    const pw = await $(tid('team-hub-password'));
    await pw.clearValue();
    await pw.setValue(t.password);
    await (await $(tid('team-hub-open'))).click();
    // The shell switches the sidecar and the webview reloads onto the project.
    await browser.pause(6_000);
    await waitForSidecar();
    const welcome = await $(tid('canvas-row-ui-welcome'));
    await welcome.waitForDisplayed({ timeout: 120_000 });
    await (await $(tid('canvas-row-screens-home'))).waitForDisplayed({ timeout: 60_000 });
    await capture('04-project-open-with-canvases');

    // The copy lives where the app keeps team projects — nobody chose a folder.
    const copy = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
    await eventually('the welcome canvas on disk in the managed copy', () => read(copy) !== null);
    expect(read(copy)).toContain('Welcome, team');
    const cfg = JSON.parse(read(join(t.managedDir, '.design', 'config.json')) ?? '{}');
    expect(cfg.managed?.projectId).toBe('local');
    expect(cfg.linkedHub?.url).toBe(t.hub);
    // The password was never written anywhere; only the minted credential.
    const hubs = read(process.env.HUBS_CONFIG_PATH ?? '') ?? '';
    expect(hubs).toContain(t.hub);
    expect(hubs).not.toContain(t.password);
  });

  it('4 · changes travel both ways', async () => {
    const t = TEAM as NonNullable<typeof TEAM>;
    const mine = join(t.managedDir, '.design', 'ui', 'welcome.tsx');
    const theirs = join(t.teammate, '.design', 'ui', 'welcome.tsx');

    writeFileSync(theirs, canvas('Welcome, edited by a teammate'));
    await eventually('the teammate’s edit in the designer’s copy', () =>
      (read(mine) ?? '').includes('edited by a teammate')
    );
    await capture('05-teammate-edit-arrived');

    // The designer edits too (as their editor or an agent would write it).
    await browser.pause(1_500);
    writeFileSync(mine, canvas('Welcome, edited by the designer'));
    await eventually('the designer’s edit at the teammate', () =>
      (read(theirs) ?? '').includes('edited by the designer')
    );
    await capture('06-designer-edit-arrived');
  });

  it('5 · the switcher names the project and offers team projects again', async () => {
    const trigger = await $(tid('repo-switcher-trigger'));
    await trigger.waitForDisplayed({ timeout: 30_000 });
    await trigger.click();
    const popup = await $(tid('repo-switcher-popup'));
    await popup.waitForDisplayed({ timeout: 10_000 });
    expect(await popup.getText()).not.toContain('--local');
    await (await $(tid('switcher-open-team'))).click();
    const dialog = await $(tid('team-projects-dialog'));
    await dialog.waitForDisplayed({ timeout: 10_000 });
    await capture('07-switcher-team-projects');
    expect(await dialog.getText()).toContain('On this computer');
    await (await $(tid('team-projects-close'))).click();
  });
});
