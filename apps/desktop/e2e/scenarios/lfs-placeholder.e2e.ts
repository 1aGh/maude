import { execFileSync } from 'node:child_process';
import { $, $$, browser, expect } from '@wdio/globals';
import type { LfsFixture } from '../fixtures/make-lfs-fixture';
import { messageCount } from '../helpers/assistant';
import { waitForCanvasOpened } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 2.0.3 — a Git LFS placeholder says so, and the desktop app can repair it.
 *
 * World (wdio.lfs.conf.ts): a throwaway git project cloned "without git lfs pull" — `.design/assets/pic.png` and
 * `.design/assets/clip.mp4` are pointer files; pic.png's object is in `.git/lfs/objects`, clip.mp4's is not. The
 * canvas `ui/Lfs.tsx` renders `<img src="assets/pic.png">` and `<video src="assets/clip.mp4">`.
 *
 * Driving model: WebDriver switches INTO the canvas frame (`switchFrame`) to read the placeholder frames and press
 * their buttons; every shell-side check runs back on the top document. The split is OFF in this lane — the embedded
 * driver cannot act inside a cross-origin frame (wdio.lfs.conf.ts). The Copy check reads the REAL macOS clipboard
 * with `pbpaste` — the person's clipboard is saved first and put back in `after`, whatever failed.
 */

const fx = JSON.parse(process.env.MAUDE_E2E_LFS_FIXTURE ?? 'null') as LfsFixture | null;
const LFS_LINE = 'Not downloaded — Git LFS placeholder';
const frameSel = (rel: string) => `[data-testid="asset-frame"][data-rel="${rel}"]`;
const PIC = 'assets/pic.png';
const CLIP = 'assets/clip.mp4';

const pbpaste = () => execFileSync('pbpaste', { encoding: 'utf8' });
const pbcopy = (text: string) => execFileSync('pbcopy', { input: text });

/** Run `fn` inside the active canvas iframe; always back on the shell after. */
async function inCanvas<T>(fn: () => Promise<T>): Promise<T> {
  const frame = await $('[data-testid="canvas-frame"]');
  await frame.waitForExist({ timeout: 30_000 });
  await browser.switchFrame(frame);
  try {
    return await fn();
  } finally {
    await browser.switchFrame(null);
  }
}

describe('Git LFS placeholders: the words, Copy prompt and Fix with AI (2.0.3)', () => {
  let savedClipboard: string | null = null;
  let copied = '';

  before(async () => {
    if (!fx) throw new Error('run through wdio.lfs.conf.ts (MAUDE_E2E_LFS_FIXTURE is not set)');
    savedClipboard = pbpaste();
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-lfs')).click();
    await browser.waitUntil(
      async () =>
        (await $('[data-testid="canvas-frame"]').getAttribute('data-path'))?.endsWith(
          'ui/Lfs.tsx'
        ) === true,
      { timeout: 30_000, timeoutMsg: 'the Lfs canvas never became the active frame' }
    );
    await waitForCanvasOpened();
  });

  after(() => {
    // the person's clipboard back, whatever happened above
    if (savedClipboard !== null) pbcopy(savedClipboard);
  });

  it('both media show the LFS placeholder frame, with Fix with AI and Copy prompt', async () => {
    const report = startReport('lfs-placeholder');
    const seen = await inCanvas(async () => {
      await browser.waitUntil(
        async () =>
          (await $$(`[data-testid="asset-frame"][data-state="lfs-pointer"]`).length) === 2 &&
          (await $(`${frameSel(PIC)} [data-testid="asset-frame-lfs-copy"]`).isExisting()),
        { timeout: 45_000, interval: 300, timeoutMsg: 'the two LFS placeholder frames never showed' }
      );
      const out: Record<string, { text: string; fix: string; copy: string }> = {};
      for (const rel of [PIC, CLIP]) {
        const f = await $(frameSel(rel));
        out[rel] = {
          text: await f.getText(),
          // getText, not isDisplayed: the embedded driver's isDisplayed is an execute script, which throws inside a
          // frame (measured on this lane)
          fix: await $(`${frameSel(rel)} [data-testid="asset-frame-lfs-fix"]`).getText(),
          copy: await $(`${frameSel(rel)} [data-testid="asset-frame-lfs-copy"]`).getText(),
        };
      }
      return out;
    });
    console.log(`[lfs] frames: ${JSON.stringify(seen)}`);
    for (const rel of [PIC, CLIP]) {
      expect(seen[rel]?.text).toContain(LFS_LINE);
      expect(seen[rel]?.text).toContain(rel.split('/').pop() as string);
      expect(seen[rel]?.fix).toBe('Fix with AI');
      expect(seen[rel]?.copy).toBe('Copy prompt');
    }
    await capture(report, 'two LFS placeholder frames');
  });

  it('Copy prompt: the button reads "Copied" and the macOS clipboard holds the prompt', async () => {
    const sentinel = `maude-e2e-lfs-sentinel-${Date.now()}`;
    pbcopy(sentinel);
    const word = await inCanvas(async () => {
      const sel = `${frameSel(PIC)} [data-testid="asset-frame-lfs-copy"]`;
      await (await $(sel)).click();
      let last = '';
      // "Copied" lasts 1.5 s after the shell's answer (asset-placeholder.tsx): poll fast, and find the button
      // again each time (the frame layer may redraw it; a held reference can keep reading the old node's words)
      await browser
        .waitUntil(
          async () => {
            last = await $(sel).getText();
            return last !== 'Copy prompt';
          },
          { timeout: 6_000, interval: 100 }
        )
        .catch(() => {});
      return last;
    });
    console.log(`[lfs] copy button after click: "${word}"`);
    expect(word).toBe('Copied');
    copied = pbpaste();
    console.log(`[lfs] clipboard (${copied.length} chars):\n${copied}\n[lfs] end of clipboard`);
    expect(copied).not.toBe(sentinel);
    expect(copied).toContain(`\`${fx?.pic.path}\` (its object is already in .git/lfs/objects)`);
    expect(copied).toContain(`\`${fx?.clip.path}\``);
    expect(copied).not.toContain(`\`${fx?.clip.path}\` (its object`);
    expect(copied).toContain('.git/lfs/objects/<oid[0:2]>/<oid[2:4]>/<oid>');
    expect(copied).toMatch(/`\.design\/_trash\/lfs-pointers-\d{4}-\d{2}-\d{2}\/`/);
    expect(copied).toContain('Do not commit anything');
  });

  it('Fix with AI: the AI chat opens with the same prompt in the composer, and nothing is sent', async () => {
    const report = startReport('lfs-placeholder-fix');
    expect(copied.length).toBeGreaterThan(0);
    const before = await messageCount();
    await inCanvas(async () => {
      await (await $(`${frameSel(PIC)} [data-testid="asset-frame-lfs-fix"]`)).click();
    });
    await $('[data-testid="ai-chat-header"]').waitForDisplayed({
      timeout: 15_000,
      timeoutMsg: 'the AI chat never opened',
    });
    const input = await $('[data-testid="chat-composer"] .chat-input');
    await input.waitForExist({ timeout: 15_000 });
    let value = '';
    await browser.waitUntil(
      async () => {
        value = await input.getValue();
        return value.length > 0;
      },
      { timeout: 15_000, interval: 250, timeoutMsg: 'the composer was never pre-filled' }
    );
    console.log(`[lfs] composer value (${value.length} chars) equals clipboard: ${value === copied}`);
    expect(value).toBe(copied);
    // nothing was sent: give a send the time it would need, then count the thread again
    await browser.pause(3_000);
    expect(await input.getValue()).toBe(copied);
    const after = await messageCount();
    console.log(`[lfs] messages before=${before} after=${after}`);
    expect(after).toBe(before);
    await capture(report, 'chat pre-filled, unsent');
  });
});
