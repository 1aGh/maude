import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import {
  focusCanvasFrame,
  waitForArtboard,
  waitForCanvasOpened,
  waitForCanvasRects,
} from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { artboardLabelPoint, pointerClick } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { focusTab, labels, openTab } from '../helpers/windows';

/**
 * #122 122-C — a paste between two projects on this Mac (contract 122-cross-canvas-clipboard.md §5.6).
 *
 * source = MAUDE_PROJECT_ROOT: `ui/Home.tsx`, artboard "Hero" reading `W`, an imported `<Card>` and a picture.
 * target = MAUDE_E2E_SECONDARY_ROOT: `ui/About.tsx`, the same `components/Card.tsx`, no picture.
 *
 * Copy Hero in the source tab, ⌘V on About in the target tab: nothing is pasted until the target shell's own toast
 * ("Paste the artboard copied in Home · clip-source?") is clicked; then the artboard lands with its import and its
 * constant, the picture arrives in the target's `assets/` under the same content-addressed name, and the canvas
 * renders without an error card. ⌘Z on About takes the paste back; the picture stays (like an import).
 *
 * Written for the `clip` lane (wdio.clip.conf.ts). Every key goes to a FOCUSED tab's focused canvas frame:
 * a background tab is `document.hidden`, and a canvas-origin key needs the frame to hold focus.
 */
const SOURCE = process.env.MAUDE_PROJECT_ROOT as string;
const TARGET = process.env.MAUDE_E2E_SECONDARY_ROOT as string;
const src = (root: string, rel: string) => readFileSync(join(root, '.design', rel), 'utf8');
const boards = (s: string) => s.match(/<DCArtboard\b/g)?.length ?? 0;
const pictureIn = (root: string) =>
  existsSync(join(root, '.design', 'assets'))
    ? readdirSync(join(root, '.design', 'assets')).filter((f) => f.endsWith('.png'))
    : [];

async function openCanvas(row: string): Promise<void> {
  const el = await canvasRow(row);
  await el.waitForDisplayed({ timeout: 120_000 });
  await el.click();
  await waitForCanvasOpened();
  await waitForCanvasRects(); // the card going is not the first layout: wait for elements + a settled, full-size frame
}

/**
 * Select an artboard by its name strip and leave the person's focus in the canvas frame. The embedded WebDriver's
 * own clicks and element lookups never reach into the canvas frame (helpers/pointer.ts), so the click is synthesised at
 * the label's window point, and the frame then takes real focus — the shell honours a canvas ⌘V as the person's paste
 * only while the frame holds the focus of a focused window (use-canvas-bridge.jsx).
 */
async function selectArtboard(id: string): Promise<void> {
  await waitForArtboard(id);
  const at = await artboardLabelPoint(id);
  expect(at).not.toBeNull();
  await pointerClick((at as { x: number }).x, (at as { y: number }).y);
  await browser.pause(300);
  await focusCanvasFrame();
}

/** A chord pressed in the canvas (its document gets the keydown, as the canvas keymap reads it). */
async function canvasChord(key: string): Promise<void> {
  await browser.execute((k: string) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const doc = frame.contentDocument as Document;
    (doc.activeElement ?? doc.body).dispatchEvent(
      new KeyboardEvent('keydown', {
        key: k,
        code: `Key${k.toUpperCase()}`,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
  }, key);
}

/**
 * ⌘V in the canvas. The canvas takes a paste from WebKit's own `paste` event (the system clipboard still holding the
 * marker its copy left — editing/index.tsx); a keydown alone pastes nothing, and the embedded WebDriver cannot press
 * the real key. So: the keydown (the canvas tells the shell — the paste intent the shell's ask follows), then the paste
 * event WebKit would fire, carrying the marker text the copy put on the clipboard.
 */
async function canvasPaste(): Promise<void> {
  await browser.execute((mark: string) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const doc = frame.contentDocument as Document;
    const win = frame.contentWindow as Window & typeof globalThis;
    const at = doc.activeElement ?? doc.body;
    at.dispatchEvent(
      new win.KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    const data = new win.DataTransfer();
    data.setData('text/plain', mark);
    at.dispatchEvent(
      new win.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  }, 'Maude · 1 artboard · paste on a canvas (maude-clip)');
}

/** The latest copy on this Mac, as the desktop shell holds it (#122 `clip_latest`, caller-checked). */
const latestClip = () =>
  browser.execute(async () => {
    const t = (
      window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string) => Promise<unknown> } } }
    ).__TAURI__;
    return t?.core?.invoke ? await t.core.invoke('clip_latest') : null;
  }) as Promise<{ from?: string; kind?: string; mine?: boolean } | null>;

/** The shell's notices, for a failure message. */
const notices = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('.maude-notice-title')).map((n) => n.textContent ?? '')
  ) as Promise<string[]>;

/** The text the open canvas shows (the frame is same-origin in this lane). */
const canvasText = () =>
  browser.execute(() => {
    const frame = document.querySelector(
      '[data-testid="canvas-frame"]'
    ) as HTMLIFrameElement | null;
    return frame?.contentDocument?.body?.innerText ?? '';
  }) as Promise<string>;

describe('#122 122-C — paste between two project tabs', () => {
  let report: ReturnType<typeof startReport>;
  let sourceTab = '';
  let targetTab = '';

  before(async () => {
    report = startReport('clipboard-cross-project');
    await waitForSidecar();
    sourceTab = (await labels()).find((l) => l.startsWith('p-')) ?? '';
    expect(sourceTab).not.toBe('');
    targetTab = (await openTab(TARGET)).label;
    await waitForSidecar();
  });

  it('copies Hero in the source project (nothing written there)', async () => {
    await focusTab(sourceTab);
    await openCanvas('canvas-row-ui-home');
    const before = src(SOURCE, 'ui/Home.tsx');
    await selectArtboard('hero');
    await canvasChord('c');
    // the copy is the latest on this Mac: the shell told the desktop its handle
    await browser.waitUntil(async () => (await latestClip())?.from === 'ui/Home.tsx', {
      timeout: 15_000,
      timeoutMsg: 'the copy never reached the desktop shell (clip_latest)',
    });
    expect(src(SOURCE, 'ui/Home.tsx')).toBe(before);
    await capture(report, 'copied-in-source');
  });

  it('⌘V on About in the other project waits for the shell’s own toast', async () => {
    await focusTab(targetTab);
    await openCanvas('canvas-row-ui-about');
    await selectArtboard('about');
    await canvasPaste();
    const ask = await $('//*[contains(normalize-space(.), "Paste the artboard copied in Home")]');
    await ask.waitForDisplayed({ timeout: 15_000 }).catch(async (e: unknown) => {
      throw new Error(
        `no confirm toast; notices ${JSON.stringify(await notices())}; latest ${JSON.stringify(await latestClip())}; ${String(e)}`
      );
    });
    // nothing crosses before the click: no paste, no picture
    expect(boards(src(TARGET, 'ui/About.tsx'))).toBe(1);
    expect(pictureIn(TARGET)).toEqual([]);
    await capture(report, 'asked-in-target');
  });

  it('Paste brings the artboard, its import, its constant and its picture', async () => {
    const paste = await $('//button[normalize-space(.)="Paste"]');
    await paste.waitForClickable({ timeout: 10_000 });
    await paste.click();
    await browser.waitUntil(() => boards(src(TARGET, 'ui/About.tsx')) === 2, {
      timeout: 30_000,
      timeoutMsg: 'the artboard never landed in About',
    });
    const out = src(TARGET, 'ui/About.tsx');
    expect(out).toContain("import { Card } from '../components/Card';");
    expect(out).toContain('const W = 640;');
    const sent = readFileSync(join(SOURCE, '.design', 'assets', pictureIn(SOURCE)[0] as string));
    const name = `${createHash('sha256').update(sent).digest('hex').slice(0, 8)}.png`;
    expect(pictureIn(TARGET)).toEqual([name]);
    expect(readFileSync(join(TARGET, '.design', 'assets', name)).equals(sent)).toBe(true);
    // it renders: the pasted card's text is on the canvas and no error card replaced it
    await browser.waitUntil(async () => (await canvasText()).includes('Carried across'), {
      timeout: 30_000,
      timeoutMsg: 'the pasted card never rendered in About',
    });
    expect(await $('[data-testid="canvas-error-card"]').isExisting()).toBe(false);
    await capture(report, 'pasted-in-target');
  });

  it('⌘Z on About takes the paste back; the picture stays', async () => {
    await selectArtboard('about');
    await canvasChord('z');
    await browser.waitUntil(() => boards(src(TARGET, 'ui/About.tsx')) === 1, {
      timeout: 20_000,
      timeoutMsg: 'the paste was not undone',
    });
    expect(src(TARGET, 'ui/About.tsx')).not.toContain('components/Card');
    expect(pictureIn(TARGET).length).toBe(1);
    await capture(report, 'undone-in-target');
  });
});
