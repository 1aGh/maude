import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

const run = JSON.parse(process.env.MAUDE_CLOUD_ENTRY_RUN ?? 'null') as {
  controlUrl: string;
  projectId: string;
  scratch: string;
  out: string;
};
if (!run) throw new Error('Use cloud-entry.conf.ts with an explicit target.');
const tid = (id: string) => `[data-testid="${id}"]`;
const canvasName = `Native cloud ${run.scratch.split('-').at(-1)}`;
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

describe('S01 cloud entry on a clean Linux native profile', () => {
  it('approves a real device login, picks the invited project and creates a canvas through its UI', async () => {
    startReport('S01 actual cloud entry — Linux native debug');
    await (
      browser as unknown as { tauri?: { switchWindow(label: string): Promise<void> } }
    ).tauri?.switchWindow('main');
    await waitForSidecar();
    expect(await isNativeShell()).toBe(true);
    const cloudTarget = await browser.execute(async () => {
      const r = await fetch('/_api/cloud/status');
      const data = await r.json();
      return { status: r.status, url: data.url, connected: data.connected };
    });
    expect(cloudTarget).toEqual({ status: 200, url: run.controlUrl, connected: false });
    expect(existsSync(process.env.MAUDE_CLOUD_CONFIG as string)).toBe(false);
    const door = await $(tid('ob-door-team'));
    await door.waitForDisplayed({ timeout: 120_000 });
    await capture('clean-first-run');
    await door.click();
    const signin = await $(tid('team-cloud-signin'));
    await signin.waitForDisplayed();
    console.log('[cloud-entry] starting device sign-in through the UI');
    await signin.click();
    const code = await $(tid('team-cloud-code'));
    try {
      await code.waitForDisplayed();
    } catch (error) {
      const text = await browser.execute(() =>
        (document.querySelector('[data-testid="team-projects"]')?.textContent ?? '').replace(
          /[A-Z0-9]{4}-[A-Z0-9]{4}/g,
          '[code]'
        )
      );
      writeFileSync(join(run.out, 'device-code-failure.txt'), text);
      throw error;
    }
    // A local operator bridge, not a fake grant. Only the real dashboard's
    // signed-in designer can approve this code; app polling remains unchanged.
    writeFileSync(
      join(run.scratch, 'device-approval.json'),
      JSON.stringify({
        controlUrl: run.controlUrl,
        code: await code.getText(),
      }),
      { mode: 0o600 }
    );
    const project = await $(tid(`team-cloud-project-${run.projectId}`));
    await project.waitForDisplayed({ timeout: 240_000 });
    await capture('real-login-project-picker');
    await project.click();
    await browser.waitUntil(
      async () => {
        const rows = await browser.$$(tid('canvas-row-ui-cloud-acceptance'));
        return (await rows.length) > 0;
      },
      { timeout: 180_000, interval: 1000, timeoutMsg: 'Invited project canvas did not arrive' }
    );
    // This fresh profile must make the same consent choice as a person. The
    // embedded driver's synthetic click can otherwise reach behind a modal.
    const consent = await $(tid('sync-consent-accept'));
    await consent.waitForDisplayed();
    await consent.click();
    await consent.waitForDisplayed({ reverse: true });
    await capture('managed-copy-open');

    const roots = join(run.scratch, 'data/com.maude.app.e2e/projects');
    const copies = readdirSync(roots).filter((name) =>
      existsSync(join(roots, name, '.design/config.json'))
    );
    expect(copies).toHaveLength(1);
    const copy = join(roots, copies[0]);
    const cfg = JSON.parse(readFileSync(join(copy, '.design/config.json'), 'utf8'));
    expect(cfg.linkedHub?.url).toBeTruthy();
    const session = JSON.parse(readFileSync(process.env.MAUDE_CLOUD_CONFIG as string, 'utf8'));
    expect(session.url).toBe(run.controlUrl.replace(/\/$/, ''));
    expect(session.email).toBe('designer-a@maude-f3.invalid');

    await (await $('button[aria-label="New blank brief board"]')).click();
    await (await $('input[aria-label="New brief board name"]')).setValue(canvasName);
    await (await $('button[aria-label="Create brief board"]')).click();
    const row = `canvas-row-ui-${canvasName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    await (await $(tid(row))).waitForDisplayed({
      timeout: 60_000,
    });
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
          projectId: run.projectId,
          copy,
          signedInEmail: session.email,
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
