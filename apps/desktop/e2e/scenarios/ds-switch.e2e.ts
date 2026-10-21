import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 13 · ds-multi-switch + ds-many-switch (S10.14) — look at the project in another design system, then move a folder
 * there in one review: alpha's ⋯ menu → Preview in… (↑↓ steps, esc stops) → Switch canvases to another system… →
 * Folder scope → Switch 2 canvases → ⌘Z takes it back. WRITTEN, NOT RUN in the S10.14 hand-back (the lead runs the
 * desktop lane, under the lock).
 *
 * Boots into a generated project (wdio.ds-switch.conf.ts → fixtures/seed-ds-switch.ts): systems `alpha`, `beta`
 * and `acme`; canvases on alpha (Home, Pairs, Pinned, Blocked, Pin, combine/One, combine/Two).
 *
 * Driving model: the shell's own DOM (the pinned rows, the menu, the sheet, the bar). The canvas frames are only
 * asked what they were built with (their `src`), never driven. The project is a throwaway temp dir.
 */
const ROOT = process.env.MAUDE_E2E_DS_SWITCH_ROOT ?? '';
const metaOf = (rel: string): Record<string, unknown> => {
  const file = join(ROOT, '.design', rel.replace(/\.tsx$/, '.meta.json'));
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const rowMenuItem = (label: string) =>
  $(`//*[@role="menuitem"][contains(normalize-space(.), "${label}")]`);
const openAlphaMenu = async () => {
  const menu = await $('[data-testid="canvases-ds-row-menu"][data-ds="alpha"]');
  await menu.waitForExist({ timeout: 60_000 });
  await menu.click();
};

describe('ds-switch — preview, then one review', () => {
  before(() => {
    startReport('ds-switch');
  });

  it('alpha’s menu offers Switch… and Preview in… (the project has three systems)', async () => {
    await waitForSidecar();
    await openAlphaMenu();
    expect(await (await rowMenuItem('Switch canvases to another system')).isExisting()).toBe(true);
    expect(await (await rowMenuItem('Preview in')).isExisting()).toBe(true);
    await capture('ds-switch-menu');
  });

  it('Preview in…: the banner names the system, ↓ steps, esc puts every canvas back', async () => {
    await (await rowMenuItem('Preview in')).click();
    const bar = await $('[data-testid="ds-preview-bar"]');
    await bar.waitForExist({ timeout: 15_000 });
    const first = await bar.getAttribute('data-target');
    expect(first).not.toBe('alpha');
    expect(await (await $('[data-testid="ds-preview-banner"]')).getText()).toContain('Previewing');
    await browser.keys(['ArrowDown']);
    await browser.waitUntil(async () => (await bar.getAttribute('data-target')) !== first, {
      timeout: 5_000,
      timeoutMsg: '↓ never stepped to the next system',
    });
    await capture('ds-switch-previewing');
    await browser.keys(['Escape']);
    await bar.waitForExist({ reverse: true, timeout: 10_000 });
    // nothing was written: every canvas still belongs to alpha
    expect(metaOf('ui/Home.tsx').designSystem).toBe('alpha');
    expect(metaOf('ui/combine/One.tsx').designSystem).toBe('alpha');
  });

  it('Switch…: "Switch canvases to beta?" — the pinned and blocked canvases keep their look', async () => {
    // The Folder scope is offered only from an open canvas (it names that canvas's folder), so one in
    // ui/combine is open for the rest of the scenario; the sheet then opens on that folder and the whole
    // project is one tap away.
    const one = await canvasRow('canvas-row-ui-combine-one');
    await one.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await openAlphaMenu();
    await (await rowMenuItem('Switch canvases to another system')).click();
    await (await $('[data-testid="ds-switch"]')).waitForExist({ timeout: 15_000 });
    await (await $('[data-testid="ds-switch-scope-all"]')).click();
    await browser.waitUntil(
      async () =>
        (await $('[data-testid="ds-switch-row"][data-path="ui/Pinned.tsx"]')).isExisting(),
      { timeout: 15_000, timeoutMsg: 'the whole-project scope never listed the pinned canvas' }
    );
    expect(await (await $('[data-testid="ds-switch-title"]')).getText()).toBe(
      'Switch canvases to beta?'
    );
    const pinned = await $(
      '[data-testid="ds-switch-row"][data-path="ui/Pinned.tsx"] [data-testid="ds-switch-note"]'
    );
    expect(await pinned.getText()).toBe('Pinned — keeps its look');
    const tick = await $('[data-testid="ds-switch-tick"][data-path="ui/Pinned.tsx"]');
    expect(await tick.getAttribute('aria-checked')).toBe('false');
    await capture('ds-switch-sheet');
  });

  it('Folder scope → Switch 2 canvases: only ui/combine moves, in one action', async () => {
    const scope = await $('[data-testid="ds-switch-scope-all"]');
    await scope.click();
    await browser.execute(() => {
      const f = document.querySelector(
        '[data-testid="ds-switch-scope-folder"]'
      ) as HTMLElement | null;
      f?.click();
    });
    // the sheet is keyed on its scope: a scope change REMOUNTS it, so the button is looked up fresh each time
    await browser.waitUntil(
      async () => {
        try {
          return (await (await $('[data-testid="ds-switch-go"]')).getText()) === 'Switch 2 canvases';
        } catch {
          return false;
        }
      },
      { timeout: 10_000, timeoutMsg: 'the folder scope never counted two canvases' }
    );
    await (await $('[data-testid="ds-switch-go"]')).click();
    await (await $('[data-testid="ds-switch"]')).waitForExist({ reverse: true, timeout: 20_000 });
    await browser.waitUntil(() => metaOf('ui/combine/One.tsx').designSystem === 'beta', {
      timeout: 20_000,
      timeoutMsg: 'the folder never moved to beta',
    });
    expect(metaOf('ui/combine/Two.tsx').designSystem).toBe('beta');
    expect(metaOf('ui/Home.tsx').designSystem).toBe('alpha');
    expect((await $$('[data-testid="ds-switch"]')).length).toBe(0);
    await capture('ds-switch-switched');
  });

  it('⌘Z takes the whole switch back', async () => {
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(() => metaOf('ui/combine/One.tsx').designSystem === 'alpha', {
      timeout: 20_000,
      timeoutMsg: '⌘Z never took the switch back',
    });
    expect(metaOf('ui/combine/Two.tsx').designSystem).toBe('alpha');
    await capture('ds-switch-undone');
  });
});
