import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S3.10a (`modes-present`, step "follow a link and back") — a link plays in Preview, the way back is the
 * PreviewBar's "‹ <canvas>", and the chip shows in Edit while the linked element is selected.
 *
 *   Edit      select the linked heading            -> the chip says "Go to Cut"
 *   Preview   ⌥⌘P, click the heading               -> Cut opens in Preview, the bar shows "‹ Smoke"
 *   Back      click the bar's back button          -> Smoke again, no back button
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is on):
 * the heading is found by COORDINATES from `window.__maudeCanvasRects()`, clicks and chords are synthetic
 * events on the frame's document, and every assertion is on the file on disk, on a `data-testid` the editing
 * layer draws in the frame, or on shell chrome (`preview-bar*`), which is plain DOM.
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('modes-present-links', [CANVAS]);
const source = () => readFileSync(CANVAS, 'utf8');

const HEADING = 'Maude desktop E2E';

/** The centre (client coords inside the frame) of the first stamped element whose text starts with `text`. */
function rectOf(text: string): Promise<{ x: number; y: number; id: string | null } | null> {
  return browser.execute((t) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const win = frame.contentWindow as (Window & { __maudeCanvasRects?: () => any }) | null;
    const hit = win?.__maudeCanvasRects?.().elements.find((e: any) => e.text.startsWith(t));
    if (!hit) return null;
    const el = frame.contentDocument?.querySelector(hit.selector) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, id: hit.cdId } : null;
  }, text);
}

async function click(x: number, y: number): Promise<void> {
  await browser.execute(
    (px, py) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: px, clientY: py, button: 0 })
        );
      }
    },
    x,
    y
  );
}

async function chord(key: string, mods: Partial<KeyboardEventInit> = {}): Promise<void> {
  await browser.execute(
    (k, m) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      (frame.contentDocument as Document).body.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
      );
    },
    key,
    mods
  );
}

const inFrame = (testid: string) =>
  browser.execute((id) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    return frame.contentDocument?.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
  }, testid);

const barText = async (testid: string) => (await $(`[data-testid="${testid}"]`)).getText();

describe('follow a link and back (S3.10a)', () => {
  before(async () => {
    fixtures.snapshot();
    await waitForSidecar();
    // The heading goes to Cut (another canvas in the fixture project). Written to disk: there is no human
    // picker for a new link yet, and this step is about playback.
    writeFileSync(
      CANVAS,
      source().replace(
        '<h1 data-testid="smoke-h1"',
        '<h1 data-cd-id="smoke-h1" data-cd-link="ui/Cut.tsx#cut" data-testid="smoke-h1"'
      )
    );
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await browser.waitUntil(async () => (await rectOf(HEADING))?.id === 'smoke-h1', {
      timeout: 15000,
      timeoutMsg: 'the linked heading never appeared on the canvas',
    });
  });
  after(() => fixtures.restore());

  it('Edit: selecting the linked heading shows the chip; nothing is written', async () => {
    startReport('modes-present-links-chip');
    const before = source();
    const h1 = await rectOf(HEADING);
    await click(h1!.x, h1!.y);
    await browser.waitUntil(async () => (await inFrame('edit-link-chip')) !== null, {
      timeout: 6000,
      timeoutMsg: 'the link chip never showed in Edit',
    });
    expect(await inFrame('edit-link-chip')).toContain('Go to Cut');
    await capture('edit-chip');
    expect(source()).toBe(before);
  });

  it('Preview: a click follows the link to Cut; the bar says where back goes', async () => {
    startReport('modes-present-links-follow');
    await chord('p', { metaKey: true, altKey: true, code: 'KeyP' });
    await $('[data-testid="preview-bar"]').waitForExist({ timeout: 8000 });
    expect(await $('[data-testid="preview-bar-back"]').isExisting()).toBe(false);
    // the chip is Edit chrome: gone in Preview
    expect(await inFrame('edit-link-chip')).toBeNull();
    const h1 = await rectOf(HEADING);
    await click(h1!.x, h1!.y);
    await $('[data-testid="preview-bar-back"]').waitForExist({
      timeout: 10000,
      timeoutMsg: 'following the link never opened the other canvas',
    });
    expect(await barText('preview-bar-title')).toContain('Cut');
    expect(await barText('preview-bar-back')).toContain('Smoke');
    await capture('preview-on-cut');
  });

  it('Back: the bar’s back button returns to Smoke and the button goes', async () => {
    startReport('modes-present-links-back');
    await $('[data-testid="preview-bar-back"]').click();
    await browser.waitUntil(async () => (await barText('preview-bar-title')).includes('Smoke'), {
      timeout: 10000,
      timeoutMsg: 'back never returned to the first canvas',
    });
    expect(await $('[data-testid="preview-bar-back"]').isExisting()).toBe(false);
    await capture('back-on-smoke');
    // leave Preview the ordinary way: esc is unchanged by links
    await chord('Escape', { code: 'Escape' });
  });
});
