import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { closeTab, focusTab, openTab, pinCurrentWindow, waitWindow } from '../helpers/windows';

/**
 * Michal 2A (2026-10-28) — v2 opens a format-1 project VIEW ONLY until it is updated, and offers ONE button
 * (decision maude/v2-michal-1a-2a-format-gate-one-button-migrate). A person's own LOCAL format-1 project:
 *
 *   open    → the confirm asks once: Update "Old project" for Maude 2? (it never updates by itself)
 *   Cancel  → the callout "View only — this project still uses Maude 1." + Update project; writes are refused
 *   Update project → confirm → the toast, the callout goes, the project edits; the engine backed it up to
 *             `_history/_migrate/v2-<stamp>/` first and stamped `formatVersion: 2`
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const NAME = 'Old project';

function makeFormat1Project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'maude-e2e-format1-'));
  mkdirSync(join(dir, '.design', 'ui'), { recursive: true });
  // a Maude 1 project: no formatVersion key (absent = 1)
  writeFileSync(
    join(dir, '.design', 'config.json'),
    `${JSON.stringify({ name: NAME, designRoot: '.design', canvasGroups: [{ label: 'UI', path: 'ui' }], designSystems: [] }, null, 2)}\n`
  );
  writeFileSync(
    join(dir, '.design', 'ui', 'card.tsx'),
    [
      "import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';",
      'export default function Card() {',
      '  return (',
      '    <DesignCanvas>',
      '      <DCArtboard id="a" label="Card" width={320} height={200}>',
      '        <div style={{ padding: 24 }}>Card</div>',
      '      </DCArtboard>',
      '    </DesignCanvas>',
      '  );',
      '}',
      '',
    ].join('\n')
  );
  return dir;
}

/** `/_config` and a project write, from inside the tab (same origin as the window's own requests). */
async function probe(): Promise<{ cfg: Record<string, unknown>; write: number }> {
  return browser.execute(async () => {
    const cfg = await (await fetch('/_config')).json();
    const w = await fetch('/_api/canvas-meta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: '.design/ui/card.tsx',
        patch: { layout: { artboards: [{ id: 'a', x: 40, y: 40 }] } },
      }),
    });
    return { cfg, write: w.status };
  }) as Promise<{ cfg: Record<string, unknown>; write: number }>;
}

describe('format-update (Michal 2A: a format-1 project is view only + Update project)', () => {
  let home = '';
  let tab = '';
  let root = '';

  before(async () => {
    startReport('format-update');
    await browser.setTimeout({ script: 60_000 });
    await waitForSidecar();
    home = await pinCurrentWindow();
    root = makeFormat1Project();
    const opened = await openTab(root);
    tab = opened.label;
    await waitWindow(tab);
    await focusTab(tab);
    await waitForSidecar();
  });

  after(async () => {
    if (tab) await closeTab(tab, home).catch(() => undefined);
  });

  it('opening asks once — the confirm, with the contract words; nothing is updated yet', async () => {
    const dialog = await $(tid('format-update-dialog'));
    await dialog.waitForDisplayed({ timeout: 30_000 });
    expect(await dialog.$('h2').getText()).toBe(`Update "${NAME}" for Maude 2?`);
    expect(await dialog.getText()).toContain(
      "People still on Maude 1 can look at it but can't change it until they update. Nothing in the project is lost."
    );
    expect(await $(tid('format-update-confirm')).getText()).toBe('Update project');
    expect(await $(tid('format-update-cancel')).getText()).toBe('Cancel');
    await capture('fu-1 the confirm on opening');
    // only asking: the file is still format 1 and no backup exists
    expect(
      JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8')).formatVersion
    ).toBe(undefined);
    expect(existsSync(join(root, '.design', '_history', '_migrate'))).toBe(false);
  });

  it('Cancel → view only: the callout line + Update project, and a write is refused', async () => {
    await $(tid('format-update-cancel')).click();
    await $(tid('format-update-dialog')).waitForDisplayed({ reverse: true, timeout: 5_000 });
    const callout = await $(tid('format-older-callout'));
    await callout.waitForDisplayed({ timeout: 10_000 });
    expect(await callout.getAttribute('data-kind')).toBe('owner');
    expect(await callout.getText()).toContain('View only — this project still uses Maude 1.');
    expect(await $(tid('format-older-update')).getText()).toBe('Update project');
    const { cfg, write } = await probe();
    expect(cfg).toMatchObject({ formatVersion: 1, readOnly: true, readOnlyReason: 'format' });
    expect(write).toBe(403);
    await capture('fu-2 view only after Cancel');
  });

  it('Update project → confirm → editable, backed up first, formatVersion 2', async () => {
    await $(tid('format-older-update')).click();
    await $(tid('format-update-dialog')).waitForDisplayed({ timeout: 5_000 });
    await $(tid('format-update-confirm')).click();
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          document.body.innerText.includes(
            'Updated for Maude 2. People on Maude 1 can look but not edit.'
          )
        ),
      { timeout: 20_000, interval: 200, timeoutMsg: 'no "Updated for Maude 2" toast' }
    );
    await capture('fu-3 updated toast');
    await $(tid('format-older-callout')).waitForDisplayed({ reverse: true, timeout: 15_000 });
    const { cfg, write } = await probe();
    expect(cfg).toMatchObject({ formatVersion: 2, readOnly: false, formatGate: null });
    expect(write).toBe(200);
    expect(
      JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8')).formatVersion
    ).toBe(2);
    const snaps = readdirSync(join(root, '.design', '_history', '_migrate'));
    expect(snaps.some((d) => /^v2-/.test(d))).toBe(true);
    await capture('fu-4 editable after Update project');
  });
});
