import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { openAssistant } from '../helpers/assistant';
import { openInspector } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { pointerDown, pointerMove, pointerUp } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * rc.1 findings 5 / 6 / 16 / 20 (package C) — the shell's panels, in the packaged WKWebView.
 *
 *   20  nothing scrolls the shell: after the gesture that used to move the whole UI under the tab bar (a focus +
 *       scrollIntoView on something past the bottom, an explicit scroll) the document, `.sh-shell` and `body` are at 0
 *   5   every Advanced fold is closed the first time it is on screen (Canvases, the AI chat, the Inspector)
 *   16  every resizable panel resizes by its grip: Canvases (left), the Inspector, the AI chat
 *   6   the AI chat shrinks below its old 340 floor, and its Hide chevron is clear of the folded Inspector's icon
 *
 * Drags are synthesised `pointer*` events at window coordinates (helpers/pointer.ts): the embedded WebDriver raises no
 * pointer events from its own actions, and the grips listen for them.
 */
const tid = (s: string) => `[data-testid="${s}"]`;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const boxOf = async (testid: string): Promise<Box | null> =>
  (await browser.execute((id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, testid)) as Box | null;

const widthOf = async (testid: string) => Math.round((await boxOf(testid))?.w ?? 0);

/** Drag a grip `dx` px sideways (press on it, move in steps, release). */
async function dragGrip(gripId: string, dx: number) {
  const g = await boxOf(gripId);
  if (!g) throw new Error(`no ${gripId}`);
  const x = g.x + g.w / 2;
  const y = g.y + Math.min(200, g.h / 2);
  await pointerDown(x, y);
  for (let i = 1; i <= 8; i++) await pointerMove(x + (dx * i) / 8, y);
  await pointerUp(x + dx, y);
  await browser.pause(400);
}

const near = (got: number, want: number, what: string, tol = 4) =>
  expect(Math.abs(got - want) <= tol, `${what}: ${got}px, wanted ${want}px (±${tol})`).toBe(true);

describe('shell-panels (rc.1 5 / 6 / 16 / 20)', () => {
  before(async () => {
    startReport('shell-panels');
    await pinCurrentWindow();
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
    await waitForCanvasRects().catch(() => undefined);
  });

  it('20: a focus + scrollIntoView past the shell, and an explicit scroll, leave scrollTop at 0', async () => {
    const out = (await browser.execute(() => {
      const shell = document.querySelector('.sh-shell') as HTMLElement;
      const tall = document.createElement('div');
      tall.id = '__tall';
      tall.style.cssText = 'flex:none;height:3000px;width:10px;position:relative';
      const input = document.createElement('input');
      input.id = '__far';
      input.style.cssText = 'position:absolute;left:0;top:2800px';
      tall.append(input);
      shell.append(tall);
      const outside = document.createElement('div');
      outside.id = '__out';
      outside.style.cssText = 'position:absolute;left:0;top:4000px;width:10px;height:10px';
      document.body.append(outside);
      (document.getElementById('__far') as HTMLElement).focus();
      document.getElementById('__far')?.scrollIntoView();
      document.getElementById('__out')?.scrollIntoView();
      window.scrollTo(0, 500);
      (document.scrollingElement as Element).scrollTop = 400;
      shell.scrollTop = 300;
      return null;
    })) as null;
    expect(out).toBeNull();
    await browser.pause(300); // scroll events settle on the next frame
    const s = (await browser.execute(() => ({
      shell: (document.querySelector('.sh-shell') as HTMLElement).scrollTop,
      doc: (document.scrollingElement as Element).scrollTop,
      body: document.body.scrollTop,
    }))) as { shell: number; doc: number; body: number };
    expect(s).toEqual({ shell: 0, doc: 0, body: 0 });
    await browser.execute(() => {
      document.getElementById('__tall')?.remove();
      document.getElementById('__out')?.remove();
    });
    await capture('shell-panels-no-scroll');
  });

  it('5: the Advanced folds are closed the first time they are on screen', async () => {
    // Canvases › Advanced (the left panel on a fresh window)
    const canvases = await $(tid('canvases-advanced'));
    await canvases.waitForExist({ timeout: 30_000 });
    expect(await canvases.getAttribute('aria-expanded')).toBe('false');
    // the AI chat's
    await openAssistant();
    const ai = await $(tid('ai-advanced'));
    await ai.waitForDisplayed({ timeout: 30_000 });
    expect(await ai.getAttribute('aria-expanded')).toBe('false');
    // the Inspector's
    await openInspector();
    const insp = await $(tid('fold-inspector-toggle'));
    await insp.waitForExist({ timeout: 15_000 });
    expect(await insp.getAttribute('aria-expanded')).toBe('false');
    await capture('shell-panels-folds-closed');
  });

  it('16: the left panel follows its grip', async () => {
    const w0 = await widthOf('dock-slot-left');
    await dragGrip('panel-grip-left', 60);
    near(await widthOf('dock-slot-left'), w0 + 60, 'Canvases after +60');
    await dragGrip('panel-grip-left', -60);
    near(await widthOf('dock-slot-left'), w0, 'Canvases back');
  });

  it('16: the Inspector follows its grip', async () => {
    await openInspector();
    const w0 = await widthOf('dock-slot-right');
    await dragGrip('panel-grip-right', -80);
    near(await widthOf('dock-slot-right'), w0 + 80, 'Inspector after -80');
    await dragGrip('panel-grip-right', 80);
    near(await widthOf('dock-slot-right'), w0, 'Inspector back');
    await capture('shell-panels-inspector-resized');
  });

  it('16 + 6: the AI chat follows its grip, shrinks below 340, and its Hide chevron is clear of the folded Inspector icon', async () => {
    // fold the Inspector: ⇧⌘I, then its corner icon stands in the corner
    await browser.keys(['Shift', 'Command', 'i']);
    await $(tid('panel-icon-right')).waitForDisplayed({ timeout: 10_000 });
    await openAssistant();
    await browser.pause(500);
    const w0 = await widthOf('ai-chat-island');
    await dragGrip('panel-grip-right', -100);
    near(await widthOf('ai-chat-island'), w0 + 100, 'the chat grows with its grip');
    await dragGrip('panel-grip-right', 400);
    const small = await widthOf('ai-chat-island');
    expect(small <= 285, `the chat shrinks under its old 340 floor (${small}px)`).toBe(true);
    // full height: the chat reaches the corner the Inspector icon is in
    const grip = await boxOf('panel-grip-right');
    if (!grip) throw new Error('no right grip');
    await browser.execute(
      (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        el?.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window })
        );
      },
      grip.x + grip.w / 2,
      grip.y + 300
    );
    await browser.pause(500);
    const hide = await boxOf('ai-chat-hide');
    const icon = await boxOf('panel-icon-right');
    expect(hide).not.toBeNull();
    expect(icon).not.toBeNull();
    if (hide && icon) {
      const apart =
        icon.x + icon.w <= hide.x ||
        hide.x + hide.w <= icon.x ||
        icon.y + icon.h <= hide.y ||
        hide.y + hide.h <= icon.y;
      expect(
        apart,
        `Hide chevron ${JSON.stringify(hide)} under the icon ${JSON.stringify(icon)}`
      ).toBe(true);
    }
    await capture('shell-panels-chat-full');
  });
});
