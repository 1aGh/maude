import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { closeTab, focusTab, openTab, pinCurrentWindow, waitWindow } from '../helpers/windows';

/**
 * p8-v1-drop (decision maude/v2-michal-drop-v1-auto-convert) — v2 converts a person's own LOCAL format-1
 * project BY ITSELF when it opens it; there is no opt-in dialog any more (Michal 2A's "Update project"
 * confirm is gone):
 *
 *   open → the notice "Updated for Maude 2. It now saves with accepted revisions. A copy of the old files
 *          is in Version history, on this Mac only."; the callout goes, the project edits; the engine
 *          backed it up to `_history/_migrate/v2-<stamp>/` first and stamped `formatVersion: 2`
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

describe('format-update (p8-v1-drop: a format-1 project converts by itself on open)', () => {
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
    // The precondition, stated: the tab serves THIS project before any test looks for the notice. A pass-1 run (2026-10-28, loaded machine) timed out on the dialog twice with no trace of what the
    // tab had served; this turns that into a failure that names it (and gives a slow first load room).
    let seen: unknown = null;
    await browser.waitUntil(
      async () => {
        seen = await browser.execute(async () => {
          const c = await (await fetch('/_config')).json();
          return { name: c.name, formatVersion: c.formatVersion, formatGate: c.formatGate };
        });
        const c = seen as { name?: string; formatGate?: unknown };
        return c.name === NAME;
      },
      {
        timeout: 60_000,
        interval: 500,
        timeoutMsg: `the tab never served the format-1 project: ${JSON.stringify(seen)}`,
      }
    );
  });

  after(async () => {
    if (tab) await closeTab(tab, home).catch(() => undefined);
  });

  it('opening converts it by itself — no dialog; the notice says what happened and where the copy is', async () => {
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          document.body.innerText.includes(
            'Updated for Maude 2. It now saves with accepted revisions. A copy of the old files is in Version history, on this Mac only.'
          )
        ),
      { timeout: 30_000, interval: 200, timeoutMsg: 'no "Updated for Maude 2" notice' }
    );
    // the opt-in dialog is gone (p8-v1-drop): the only dialog left is the cloud warning, never shown here
    expect(await $(tid('format-cloud-dialog')).isExisting()).toBe(false);
    await capture('fu-1 updated by itself on open');
  });

  it('editable, backed up first, formatVersion 2', async () => {
    await $(tid('format-older-callout')).waitForDisplayed({ reverse: true, timeout: 15_000 });
    const { cfg, write } = await probe();
    expect(cfg).toMatchObject({ formatVersion: 2, readOnly: false, formatGate: null });
    expect(write).toBe(200);
    expect(
      JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8')).formatVersion
    ).toBe(2);
    const snaps = readdirSync(join(root, '.design', '_history', '_migrate'));
    expect(snaps.some((d) => /^v2-/.test(d))).toBe(true);
    await capture('fu-2 editable after the automatic update');
  });
});
