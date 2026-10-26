import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S2.15 (artboards ed-img · ed-edge-paste) — images, crop mode and the Figma paste bar.
 *
 *   1. an Assets tile dropped on a frame fills it, cropped to fit (`object-fit: cover`), as ONE write ⌘Z takes back;
 *      dropped on the picture it only swaps the source.
 *   2. a double-click on the selected picture opens crop mode (faded ghost, brackets, "↵ done · esc cancel"); esc puts
 *      everything back and writes nothing; dragging then ↵ writes ONE `image.crop` (object-position, data-image-fit="crop").
 *   3. the inspector's Fit: Fit is `object-fit: contain`; Fill takes the crop away.
 *   4. a Figma copy that carries a picture lands as Figma's exact picture (`data-source="figma"`) with the bar under it,
 *      and the bar offers no Make editable until Figma import lands.
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is on): events are
 * dispatched on the frame's document, the inspector is the shell's own DOM, and every assertion is on the file on disk
 * or on a `data-testid` the editing layer draws.
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const META = join(HERE, '../fixtures/project/.design/ui/Smoke.meta.json');
const fixtures = createFixtureGuard('edit-images', [CANVAS, META]);
const source = () => readFileSync(CANVAS, 'utf8');

const HOME = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · IMAGES" width={900} height={420}>
        <div data-cd-id="player" style={{ width: 300, height: 400 }} />
        <div data-cd-id="mvp" style={{ width: 300, height: 400 }}>
          <img data-cd-id="photo" src="assets/pic.png" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

const inFrame = async <T>(
  fn: (doc: Document, win: Window, ...rest: any[]) => T,
  ...args: unknown[]
): Promise<T> => {
  // A throw inside `execute` reaches the spec as "A JavaScript exception occurred" and nothing else;
  // carry the page's own message out instead so a red run says WHY.
  const out = (await browser.execute(
    (src: string, a: unknown[]) => {
      try {
        const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
        return {
          v: new Function('doc', 'win', 'args', `return (${src})(doc, win, ...args)`)(
            frame.contentDocument,
            frame.contentWindow,
            a
          ),
        };
      } catch (e) {
        return { __inFrameError: String(e) };
      }
    },
    fn.toString(),
    args
  )) as { v?: T; __inFrameError?: string };
  if (out.__inFrameError) throw new Error(`inFrame: ${out.__inFrameError}`);
  return out.v as T;
};

const present = (testid: string) =>
  inFrame(
    (doc, _w, id: string) =>
      !!doc.querySelector(`[data-testid="${id}"]`) || !!doc.querySelector(`[data-cd-id="${id}"]`),
    testid
  );

/** Drop an Assets tile on the element with this id: the tile's own MIME payload on a synthetic drag. */
const dropTile = (id: string, asset: string) =>
  inFrame(
    (doc, win, elId: string, path: string) => {
      const el = doc.querySelector(`[data-cd-id="${elId}"]`) as HTMLElement;
      const r = el.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData('application/x-maude-asset', JSON.stringify({ asset: path, w: 64, h: 64 }));
      const at = {
        bubbles: true,
        cancelable: true,
        clientX: r.left + 10,
        clientY: r.top + 10,
        dataTransfer: dt,
      };
      el.dispatchEvent(new DragEvent('dragover', at));
      el.dispatchEvent(new DragEvent('drop', at));
      void win;
    },
    id,
    asset
  );

/**
 * A person's click on the element with this id: the pointer goes down, up and clicks AT ITS CENTRE (the router
 * picks its target by position, not by where the event was fired), with ⌘ so the picture itself is picked and
 * not the wrapper around it. `detail` 2 adds the double-click.
 */
/** ⌘Z until the file is `target` again. The press right after a write can race the op log's barrier. */
const undoTo = (target: string) =>
  browser.waitUntil(
    async () => {
      if (source() === target) return true;
      await browser.keys(['Meta', 'z']);
      await browser.pause(700);
      return source() === target;
    },
    { timeout: 20000, timeoutMsg: '⌘Z never put the file back' }
  );

const click = async (id: string, detail = 1) => {
  // a ⌘Z is on disk before the frame re-renders from it: until then the element may still be the undone one
  // (a dropped picture that never loaded draws 0 × 0, so the press lands on its frame). Press a drawn element.
  await browser.waitUntil(
    async () =>
      inFrame((doc, _w, elId: string) => {
        const r = doc.querySelector(`[data-cd-id="${elId}"]`)?.getBoundingClientRect();
        return !!r && r.width > 0 && r.height > 0;
      }, id),
    { timeout: 10_000, timeoutMsg: `"${id}" never drew a box to press` }
  );
  await clickNow(id, detail);
  // the selection settles (halo, inspector, crop affordance) a beat after the press: a double-click sent
  // at once is read as a press on something not yet selected
  await browser.pause(detail > 1 ? 300 : 700);
};
const clickNow = (id: string, detail = 1) =>
  inFrame(
    (doc, win, elId: string, d: number) => {
      const el = doc.querySelector(`[data-cd-id="${elId}"]`) as HTMLElement;
      const r = el.getBoundingClientRect();
      const at = {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        button: 0,
        metaKey: true,
      };
      const types =
        d > 1
          ? ['pointerdown', 'pointerup', 'click', 'dblclick']
          : ['pointerdown', 'pointerup', 'click'];
      for (const t of types) el.dispatchEvent(new win.MouseEvent(t, { ...at, detail: d }));
    },
    id,
    detail
  );

/** A key to the FRAME's document (WebDriver's browser.keys lands on the shell's active element). */
const frameKey = (key: string, mods: { metaKey?: boolean } = {}) =>
  browser.execute(
    (k, m) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      (frame.contentDocument as Document).body.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
      );
    },
    key,
    mods
  );

describe('images, crop and the Figma paste bar (S2.15)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, HOME);
    writeFileSync(META, '{}\n');
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await browser.waitUntil(async () => (await $('[data-testid="canvas-frame"]')).isExisting(), {
      timeout: 15000,
    });
    // the NEW content, not the canvas that was open before it (the lane keeps one app across specs)
    await browser.waitUntil(async () => present('photo'), {
      timeout: 15000,
      timeoutMsg: 'the written canvas never rendered',
    });
  });
  after(() => fixtures.restore());

  it('a tile dropped on an empty frame fills it, cropped to fit, in one write ⌘Z takes back', async () => {
    const report = startReport('edit-images-drop');
    const before = source();
    await browser.pause(1000); // the drop targets register once the editing layer has mounted over the new canvas
    await dropTile('player', 'assets/pic.png');
    await browser.waitUntil(async () => source().split('<img').length === 3, { timeout: 8000 });
    expect(source()).toMatch(
      /<img data-cd-id="img"[^>]*src="assets\/pic\.png"[^>]*objectFit: "cover"/
    );
    await capture(report, 'filled');
    await undoTo(before);
  });

  it('dropped on the picture it swaps the source and keeps the box', async () => {
    const was = source();
    await dropTile('photo', 'assets/other.png');
    await browser.waitUntil(async () => source().includes('assets/other.png'), { timeout: 8000 });
    expect(source()).toContain('objectFit: "cover"');
    expect(source().split('<img').length).toBe(2);
    await undoTo(was);
  });

  it('double-click opens crop mode; esc writes nothing; a drag and ↵ write one image.crop', async () => {
    const report = startReport('edit-images-crop');
    const before = source();
    await click('photo');
    await click('photo', 2);
    await browser.waitUntil(async () => present('edit-crop-mode'), { timeout: 5000 });
    expect(await present('edit-crop-ghost')).toBe(true);
    expect(await present('edit-crop-hint')).toBe(true);
    await capture(report, 'crop-mode');
    await frameKey('Escape');
    await browser.waitUntil(async () => !(await present('edit-crop-mode')), { timeout: 5000 });
    expect(source()).toBe(before);
    await click('photo'); // esc left the picture selected; pick it again, settle, then double-click
    await click('photo', 2);
    await browser.waitUntil(async () => present('edit-crop-mode'), { timeout: 5000 });
    await inFrame((doc) => {
      const g = doc.querySelector('[data-testid="edit-crop-ghost"]') as HTMLElement;
      const r = g.getBoundingClientRect();
      const at = (t: string, dx: number) =>
        g.dispatchEvent(
          new PointerEvent(t, {
            bubbles: true,
            clientX: r.left + 20 + dx,
            clientY: r.top + 20,
            button: 0,
          })
        );
      at('pointerdown', 0);
      at('pointermove', 30);
      at('pointerup', 30);
    });
    await frameKey('Enter');
    await browser.waitUntil(async () => source().includes('data-image-fit="crop"'), {
      timeout: 8000,
    });
    expect(source()).toContain('objectPosition');
    await capture(report, 'cropped');
    await undoTo(before);
  });

  it('the inspector’s Fit: Fit is object-fit: contain, Fill takes it back', async () => {
    await click('photo');
    const fit = await $('[data-testid="insp-ctl-image-fit"]');
    await fit.waitForExist({ timeout: 5000 });
    await (await fit.$('button=Fit')).click();
    await browser.waitUntil(async () => source().includes('contain'), { timeout: 8000 });
    await (await fit.$('button=Fill')).click();
    await browser.waitUntil(async () => !source().includes('contain'), { timeout: 8000 });
  });

  it('a Figma copy with a picture lands as Figma’s exact picture; the bar says so and offers no Make editable', async () => {
    const report = startReport('edit-images-figma');
    await inFrame((doc, win) => {
      // the frame's own DataTransfer / File / ClipboardEvent, as a real paste hands over: a File from the shell's realm
      // fails the canvas's `instanceof Blob` (asset-upload.ts bodyOf) and the upload throws before any /_api call
      const W = win as unknown as {
        DataTransfer: typeof DataTransfer;
        File: typeof File;
        ClipboardEvent: typeof ClipboardEvent;
      };
      const meta = btoa(
        JSON.stringify({ fileKey: 'AbC123xyz', pasteID: 1, dataType: 'scene', name: 'Hero / v3' })
      );
      const html = `<span data-metadata="<!--(figmeta)${meta}(/figmeta)-->"></span><span data-buffer="<!--(figma)AA==(/figma)-->"></span>`;
      const dt = new W.DataTransfer();
      dt.setData('text/html', html);
      const png = Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
        ),
        (c) => c.charCodeAt(0)
      );
      dt.items.add(new W.File([png], 'hero.png', { type: 'image/png' }));
      doc.dispatchEvent(
        new W.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      );
    });
    await browser.waitUntil(async () => source().includes('data-source="figma"'), {
      timeout: 10000,
    });
    expect(source()).toContain('data-source-name="Hero / v3"');
    await browser.waitUntil(async () => present('edit-paste-bar'), { timeout: 5000 });
    expect(await present('edit-paste-make-editable')).toBe(false);
    await capture(report, 'pasted');
  });
});
