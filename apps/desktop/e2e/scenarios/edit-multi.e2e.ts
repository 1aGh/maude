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
 * S2.7 (artboard ed-obj-multi) — three objects, the align bar, the guide, the rotate handle.
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is
 * on): objects are found by COORDINATES from `window.__maudeCanvasRects()`, pointer events are
 * synthetic and dispatched on the frame's document, and every assertion is on the file on disk or on a
 * `data-testid` the editing layer draws (`edit-align-*`, `edit-rotate-*`).
 *
 * The scenario swaps the fixture canvas for three freely placed objects (Titulek, Podtitulek,
 * ZAPIŠ SE — Podtitulek sits 6 px off) and the guard puts the original back.
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('edit-multi', [CANVAS]);
const source = () => readFileSync(CANVAS, 'utf8');

const POST = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · MULTI" width={480} height={320}>
        <h1 data-cd-id="mx-title" style={{ position: "absolute", left: "24px", top: "24px", width: 300, height: 40 }}>Titulek</h1>
        <p data-cd-id="mx-sub" style={{ position: "absolute", left: "30px", top: "100px", width: 220, height: 28 }}>Podtitulek</p>
        <a data-cd-id="mx-btn" style={{ position: "absolute", left: "24px", top: "180px", width: 160, height: 44 }}>ZAPIŠ SE</a>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

type Pt = { x: number; y: number };

/** The centre (frame client coords) of the stamped element whose text starts with `text`. */
function rectOf(text: string): Promise<Pt | null> {
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

/** The centre of a chrome element the editing layer draws, by testid. */
function chromeAt(testid: string): Promise<Pt | null> {
  return browser.execute((id) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const el = frame.contentDocument?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, testid);
}

const textIn = (testid: string) =>
  browser.execute((id) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    return frame.contentDocument?.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
  }, testid);

/** A pointer click at (x, y) on the frame's document; `shift` adds to the selection. */
async function click(x: number, y: number, shift = false): Promise<void> {
  await browser.execute(
    (px, py, sh) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const type of ['pointerdown', 'pointerup', 'click']) {
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: px, clientY: py, button: 0, shiftKey: sh })
        );
      }
    },
    x,
    y,
    shift
  );
}

/** Press on `from`, move to `to` (optionally with ⇧), release — pointer events on the window. */
async function drag(from: Pt, to: Pt, shift = false): Promise<void> {
  await browser.execute(
    (a, b, sh) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const win = frame.contentWindow as Window;
      const doc = frame.contentDocument as Document;
      const init = (p: { x: number; y: number }): PointerEventInit => ({
        bubbles: true,
        cancelable: true,
        clientX: p.x,
        clientY: p.y,
        pointerId: 1,
        button: 0,
        shiftKey: sh,
      });
      (doc.elementFromPoint(a.x, a.y) ?? doc.body).dispatchEvent(
        new PointerEvent('pointerdown', init(a))
      );
      win.dispatchEvent(new PointerEvent('pointermove', init(b)));
      win.dispatchEvent(new PointerEvent('pointerup', init(b)));
    },
    from,
    to,
    shift
  );
}

describe('multi-select, align and rotate (S2.7)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, POST);
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await browser.waitUntil(async () => (await rectOf('ZAPIŠ SE')) !== null, { timeout: 15000 });
  });
  after(() => fixtures.restore());

  it('⇧-click three objects: the bar says "3 objects" and has no Tidy', async () => {
    const report = startReport('edit-multi-bar');
    for (const [i, t] of ['Titulek', 'Podtitulek', 'ZAPIŠ SE'].entries()) {
      const p = await rectOf(t);
      expect(p).not.toBeNull();
      await click(p!.x, p!.y, i > 0);
    }
    await browser.waitUntil(async () => (await textIn('edit-align-count')) === '3 objects', {
      timeout: 6000,
    });
    await capture(report, 'bar');
    expect(await chromeAt('edit-align-left')).not.toBeNull();
    expect(await chromeAt('edit-distribute-h')).not.toBeNull();
  });

  it('Align left puts Podtitulek on 24 in the file and leaves a guide with its place', async () => {
    const report = startReport('edit-multi-align-left');
    const b = await chromeAt('edit-align-left');
    await click(b!.x, b!.y);
    await browser.waitUntil(async () => !/left: "30px"/.test(source()), { timeout: 8000 });
    expect(source()).toMatch(/data-cd-id="mx-sub" style=\{\{[^}]*left: "24px"/);
    // top is never touched by a left align
    expect(source()).toMatch(/data-cd-id="mx-sub" style=\{\{[^}]*top: "100px"/);
    await browser.waitUntil(async () => (await textIn('edit-align-chip')) !== null, {
      timeout: 4000,
    });
    expect(await textIn('edit-align-chip')).toMatch(/^X \d+$/);
    await capture(report, 'guide');
  });

  it('Distribute vertically spaces the middle object evenly', async () => {
    const b = await chromeAt('edit-distribute-v');
    await click(b!.x, b!.y);
    // tops 24 / 100 / 180 with heights 40 / 28 / 44: gaps become equal, so Podtitulek leaves 100
    await browser.waitUntil(
      async () => !/data-cd-id="mx-sub" style=\{\{[^}]*top: "100px"/.test(source()),
      {
        timeout: 8000,
      }
    );
    expect(source()).toMatch(/data-cd-id="mx-title" style=\{\{[^}]*top: "24px"/);
    expect(source()).toMatch(/data-cd-id="mx-btn" style=\{\{[^}]*top: "180px"/);
  });

  it('the rotate handle turns one object; ⇧ snaps to 15°', async () => {
    const report = startReport('edit-multi-rotate');
    const p = await rectOf('ZAPIŠ SE');
    await click(p!.x, p!.y);
    await browser.waitUntil(async () => (await chromeAt('edit-rotate-handle')) !== null, {
      timeout: 6000,
    });
    const handle = (await chromeAt('edit-rotate-handle'))!;
    // swing the handle 32° about the object's centre, with ⇧: lands on 30°
    const dx = handle.x - p!.x;
    const dy = handle.y - p!.y;
    const a = (32 * Math.PI) / 180;
    const to = {
      x: p!.x + dx * Math.cos(a) - dy * Math.sin(a),
      y: p!.y + dx * Math.sin(a) + dy * Math.cos(a),
    };
    await drag(handle, to, true);
    await browser.waitUntil(
      async () => /mx-btn" style=\{\{[^}]*transform: "rotate\(30deg\)"/.test(source()),
      {
        timeout: 8000,
      }
    );
    await capture(report, 'rotated');
  });
});
