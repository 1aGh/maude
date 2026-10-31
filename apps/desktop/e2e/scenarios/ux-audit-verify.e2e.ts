import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasOpened, waitForCanvasRects } from '../helpers/canvas-frame';
import { pressMenuRow } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow, dsRow } from '../helpers/tree';
import { activeTab, HOME } from '../helpers/windows';

/**
 * R2 UX audit — six controls the owner reported dead on the 2.0.0-rc.1 `.app`, checked in the real app and kept as
 * a regression guard (every button must do something):
 *
 *   1  right-click on an OBJECT (not an artboard) opens the object menu
 *   2  clicking a comment pin opens its thread
 *   3  the Design system canvas opens (pinned row in the Canvases panel)
 *   4  an AI chat entry (the chat's header, or the spark corner icon while it is folded) is on screen
 *   5  `?` opens the shortcuts sheet
 *   6  Menu › Back to Home goes to Home
 *
 * Boots into wdio.ux-audit.conf.ts's project (the reach seed: system `acme` + ui/Home with two Accent buttons).
 * Driving model: the lane runs with the origin split off, so the canvas frame is same-origin; objects are found by
 * coordinates from `window.__maudeCanvasRects()` and the pointer is synthetic, dispatched on the frame's document.
 * Every assertion is on a `data-testid` or a class the product draws.
 */
const tid = (s: string) => `[data-testid="${s}"]`;

/** Window coordinates (inside the frame) of the first stamped element whose text starts with `text`. */
function centreOf(text: string): Promise<{ x: number; y: number } | null> {
  return browser.execute((t) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const win = frame.contentWindow as (Window & { __maudeCanvasRects?: () => any }) | null;
    const hit = win?.__maudeCanvasRects?.().elements.find((e: any) => e.text.startsWith(t));
    if (!hit) return null;
    const el = frame.contentDocument?.querySelector(hit.selector) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, text);
}

/** A pointer event of `types`, in order, on whatever is under (x, y) inside the frame. */
function fire(types: string[], x: number, y: number, init: MouseEventInit = {}): Promise<void> {
  return browser.execute(
    (ts, px, py, extra) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const type of ts) {
        const ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
        target.dispatchEvent(
          new ctor(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: px,
            clientY: py,
            button: 0,
            ...extra,
          } as MouseEventInit)
        );
      }
    },
    types,
    x,
    y,
    init
  );
}

describe('ux-audit — six controls, in the real app', () => {
  before(async () => {
    startReport('ux-audit-verify');
    await waitForSidecar();
  });

  it('3 · the Design system canvas opens from its pinned row', async () => {
    const row = await dsRow('acme');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $(tid('canvas-frame'))).waitForExist({ timeout: 30_000 });
    await waitForCanvasOpened();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
          return !!f?.contentDocument?.querySelector('[data-ds-token]');
        }),
      { timeout: 30_000, timeoutMsg: 'the Design system canvas drew no swatches' }
    );
    // …and no error card stands in its place
    expect(await $(tid('canvas-error-card')).isExisting()).toBe(false);
    await capture('ux-audit-ds-canvas');
  });

  it('1 · right-click on an object opens the OBJECT menu (not the artboard one)', async () => {
    await (await canvasRow('canvas-row-ui-home')).click();
    await waitForCanvasRects();
    await browser.waitUntil(async () => (await centreOf('cta')) !== null, {
      timeout: 20_000,
      timeoutMsg: 'the "cta" button never drew on ui/Home',
    });
    const at = (await centreOf('cta')) as { x: number; y: number };
    await fire(['pointerdown', 'contextmenu'], at.x, at.y, { button: 2, buttons: 2 });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
          return !!f?.contentDocument?.querySelector('.dc-context-menu');
        }),
      { timeout: 8_000, timeoutMsg: 'a right-click on an object opened no menu' }
    );
    const items = (await browser.execute(() => {
      const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      return [
        ...(f.contentDocument?.querySelectorAll(
          '.dc-context-menu [data-testid^="canvas-menu-item-"]'
        ) ?? []),
      ].map((e) => e.getAttribute('data-testid')?.replace('canvas-menu-item-', ''));
    })) as string[];
    // the OBJECT menu's rows (editing/object-menu.tsx) are there; the artboard-only rows are not
    for (const id of [
      'ask-ai-object',
      'copy-object',
      'duplicate-element',
      'frame',
      'delete-element',
    ])
      expect(items).toContain(id);
    expect(items).not.toContain('fit-one');
    expect(items).not.toContain('rename');
    await capture('ux-audit-object-menu');
  });

  it('2 · a comment pin opens its thread', async () => {
    // close the object menu, then do what a person does: C (the Comment tool), then a click on the object
    await browser.execute(() => {
      const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      (f.contentDocument as Document).body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      (f.contentDocument as Document).body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true, cancelable: true })
      );
    });
    await browser.pause(400);
    const at = (await centreOf('cta')) as { x: number; y: number };
    await fire(['pointerdown', 'pointerup', 'click'], at.x, at.y);
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
          return !!f?.contentDocument?.querySelector('[data-testid="comment-composer-send"]');
        }),
      {
        timeout: 8_000,
        timeoutMsg: 'the Comment tool (C, then a click on an object) opened no composer',
      }
    );
    await browser.execute(() => {
      const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = f.contentDocument as Document;
      const field = doc.querySelector(
        '.cm-composer textarea, .cm-layer textarea'
      ) as HTMLTextAreaElement | null;
      if (!field) return;
      const set = Object.getOwnPropertyDescriptor(
        (f.contentWindow as any).HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      set?.call(field, 'Audit: make this louder');
      field.dispatchEvent(new (f.contentWindow as any).Event('input', { bubbles: true }));
    });
    await browser.pause(300);
    await browser.execute(() => {
      const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      (
        f.contentDocument?.querySelector(
          '[data-testid="comment-composer-send"]'
        ) as HTMLElement | null
      )?.click();
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
          return !!f?.contentDocument?.querySelector('.cm-pin');
        }),
      { timeout: 15_000, timeoutMsg: 'the saved comment drew no pin' }
    );
    const pin = (await browser.execute(() => {
      const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const p = f.contentDocument?.querySelector('.cm-pin') as HTMLElement;
      const r = p.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })) as { x: number; y: number };
    await fire(['pointerdown', 'pointerup', 'click'], pin.x, pin.y);
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
          return !!f?.contentDocument?.querySelector('.cm-thread');
        }),
      { timeout: 8_000, timeoutMsg: 'clicking the pin opened no thread' }
    );
    await capture('ux-audit-pin-thread');
    // leave the canvas as found: close the card
    await browser.keys(['Escape']);
  });

  it('4 · an AI chat entry is on screen: the chat header, or the spark icon while it is folded', async () => {
    await browser.waitUntil(
      async () => {
        const header = await $(tid('ai-chat-header'))
          .isDisplayed()
          .catch(() => false);
        const spark = await $(tid('panel-icon-assistant'))
          .isDisplayed()
          .catch(() => false);
        return header || spark;
      },
      { timeout: 20_000, timeoutMsg: 'no AI chat entry (header or spark icon) is visible' }
    );
    await capture('ux-audit-ai-entry');
  });

  it('5 · ? opens the shortcuts sheet', async () => {
    // a key goes to the shell's document when the canvas does not hold focus
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await browser.keys(['?']);
    await (await $(tid('shortcuts-sheet'))).waitForDisplayed({
      timeout: 8_000,
      timeoutMsg: '? opened no shortcuts sheet',
    });
    await capture('ux-audit-shortcuts');
    await browser.keys(['Escape']);
    await (await $(tid('shortcuts-sheet'))).waitForExist({ reverse: true, timeout: 5_000 });
  });

  it('6 · Menu › Back to Home goes to Home', async () => {
    await pressMenuRow('nav.home');
    await browser.waitUntil(async () => (await activeTab()) === HOME, {
      timeout: 10_000,
      timeoutMsg: 'Back to Home left the project tab in front',
    });
  });
});
