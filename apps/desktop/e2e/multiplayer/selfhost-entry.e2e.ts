import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

const run = JSON.parse(process.env.MAUDE_SELFHOST_ENTRY_RUN ?? 'null') as {
  input: string;
  scratch: string;
  out: string;
};
if (!run) throw new Error('Use selfhost-entry.conf.ts with an explicit target.');
const target = JSON.parse(readFileSync(run.input, 'utf8')) as {
  hubUrl: string;
  email: string;
  password: string;
};
const tid = (id: string) => `[data-testid="${id}"]`;
const canvasName = `Native selfhost ${run.scratch.split('-').at(-1)}`;
const editedTitle = `${canvasName} edited by designer`;
type CanvasObservation = { visible: boolean; text?: string; error?: string };
async function probe(query: string, operation = 'read', value: unknown = null) {
  return browser.execute(
    async (q, op, v) => ({
      observation: await (
        window as unknown as {
          __maudeE2EFrameProbe(q: string, op: string, v: unknown): Promise<CanvasObservation>;
        }
      ).__maudeE2EFrameProbe(q, op, v),
    }),
    query,
    operation,
    value
  );
}

describe('S01 self-host entry on a clean Linux native profile', () => {
  it('signs in to the team server, opens its project and creates a canvas through its UI', async () => {
    startReport('S01 actual self-host entry — Linux native debug');
    await (
      browser as unknown as { tauri?: { switchWindow(label: string): Promise<void> } }
    ).tauri?.switchWindow('main');
    await waitForSidecar();
    expect(await isNativeShell()).toBe(true);
    expect(existsSync(process.env.HUBS_CONFIG_PATH as string)).toBe(false);
    const door = await $(tid('ob-door-team'));
    await door.waitForDisplayed({ timeout: 120_000 });
    await capture('clean-first-run');
    await door.click();
    // The fields a teammate's invitation told them: address, email, password.
    await (await $(tid('team-hub-url'))).setValue(target.hubUrl);
    await (await $(tid('team-hub-email'))).setValue(target.email);
    await (await $(tid('team-hub-password'))).setValue(target.password);
    await capture('team-server-form');
    await (await $(tid('team-hub-open'))).click();
    // The project is open once its canvases arrive. A consent step, when this
    // server asks for one, is the same choice a person makes.
    try {
      await browser.waitUntil(
        async () => {
          const consent = await $(tid('sync-consent-accept'));
          if (await consent.isDisplayed().catch(() => false)) await consent.click();
          return (await browser.$$('[data-testid^="canvas-row-ui-"]').length) > 0;
        },
        { timeout: 180_000, interval: 1000, timeoutMsg: 'The invited project never opened' }
      );
    } catch (error) {
      writeFileSync(
        join(run.out, 'open-failure.txt'),
        await browser.execute(
          () => document.querySelector('[data-testid="team-projects"]')?.textContent ?? ''
        )
      );
      await capture('open-failure');
      throw error;
    }
    await capture('managed-copy-open');

    const roots = join(run.scratch, 'data/com.maude.app.e2e/projects');
    const copies = readdirSync(roots).filter((name) =>
      existsSync(join(roots, name, '.design/config.json'))
    );
    expect(copies).toHaveLength(1);
    const copy = join(roots, copies[0]);
    const cfg = JSON.parse(readFileSync(join(copy, '.design/config.json'), 'utf8'));
    expect(new URL(cfg.linkedHub?.url).origin).toBe(new URL(target.hubUrl).origin);
    // The app holds a hub credential for this server and no password anywhere.
    const hubs = readFileSync(process.env.HUBS_CONFIG_PATH as string, 'utf8');
    expect(hubs.includes(target.password)).toBe(false);

    await (await $('button[aria-label="New blank brief board"]')).click();
    await (await $('input[aria-label="New brief board name"]')).setValue(canvasName);
    await (await $('button[aria-label="Create brief board"]')).click();
    const row = `canvas-row-ui-${canvasName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    await (await $(tid(row))).waitForDisplayed({ timeout: 60_000 });
    const heading = 'div[style*="font-size: 22px"]';
    await browser.waitUntil(async () => (await probe(heading)).observation?.visible === true, {
      timeout: 60_000,
      timeoutMsg: 'Created board did not render in native canvas',
    });
    await capture('first-ui-create');
    await probe(tid('palette-mode-edit'), 'click');
    const editor = '[contenteditable="plaintext-only"]';
    await browser.waitUntil(
      async () => {
        if ((await probe(editor)).observation?.visible) return true;
        await probe(heading, 'doubleClick');
        return false;
      },
      { timeout: 30_000, interval: 200, timeoutMsg: 'Native leaf editor did not open' }
    );
    await probe(editor, 'editText', editedTitle);
    await probe(editor, 'key', { key: 'Enter' });
    await browser.waitUntil(
      async () => {
        const source = readFileSync(join(copy, '.design/ui', `${canvasName}.tsx`), 'utf8');
        return (
          source.includes(editedTitle) && (await probe(heading)).observation?.text === editedTitle
        );
      },
      { timeout: 60_000, timeoutMsg: 'First native UI text edit did not persist and render' }
    );
    await capture('first-ui-text-edit');
    writeFileSync(
      join(run.out, 'native-entry-result.json'),
      JSON.stringify(
        {
          status: 'native-ui-complete',
          copy,
          signedInEmail: target.email,
          server: cfg.linkedHub.url,
          createdCanvas: `ui/${canvasName}.tsx`,
          editedTitle,
          peerRender:
            'Requires independent browser observation; this result alone does not pass S01',
        },
        null,
        2
      )
    );
  });
});
