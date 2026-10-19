import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S2.11 (artboards ed-lay-auto · ed-lay-reorder · ed-lay-free) — a frame with three cards in a row:
 * the gap bands and the token ruler, ← → reorder, dragging a card out of its frame (Place freely).
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is
 * on): objects are found by COORDINATES from `window.__maudeCanvasRects()`, pointer events are
 * synthetic and dispatched on the frame's document, and every assertion is on the file on disk or on a
 * `data-testid` the editing layer draws (`edit-gap-band`, `edit-token-ruler`, `edit-reorder-*`).
 *
 * The fixture declares its own `--space-*` scale in a <style>, so the ruler has stops to click onto.
 * The guard puts the original canvas back. Written, not run, by the slice (the lane has no desktop
 * build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CANVAS = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('edit-layout', [CANVAS]);
const source = () => readFileSync(CANVAS, 'utf8');

const HOME = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · LAYOUT" width={900} height={420}>
        <style>{":root{--space-12:12px;--space-16:16px;--space-24:24px;--space-32:32px;--space-48:48px}"}</style>
        <section data-cd-id="ly-services" style={{ display: "flex", gap: "24px", padding: "24px" }}>
          <div data-cd-id="ly-apps" style={{ width: 240, height: 140 }}>Small apps</div>
          <div data-cd-id="ly-product" style={{ width: 240, height: 140 }}>Product design</div>
          <div data-cd-id="ly-brand" style={{ width: 240, height: 140 }}>Brand systems</div>
        </section>
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

const count = (testid: string) =>
  browser.execute(
    (id) =>
      (
        document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement
      ).contentDocument?.querySelectorAll(`[data-testid="${id}"]`).length ?? 0,
    testid
  );

const textIn = (testid: string) =>
  browser.execute((id) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    return frame.contentDocument?.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
  }, testid);

/** The centre of the first gap handle (the dot the v1 overlay draws on a gap). */
function gapHandle(): Promise<Pt | null> {
  return browser.execute(() => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const el = frame.contentDocument?.querySelector(
      '.dc-spacing-handle--gap'
    ) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });
}

async function click(x: number, y: number): Promise<void> {
  await browser.execute(
    (px, py) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const type of ['pointerdown', 'pointerup', 'click'])
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: px, clientY: py, button: 0 })
        );
    },
    x,
    y
  );
}

/** Press on `from`, move through `via` (so the ruler / slot draw), release at `to`. */
async function drag(from: Pt, via: Pt, to: Pt, opts: { alt?: boolean } = {}): Promise<void> {
  await browser.execute(
    (a, v, b, alt) => {
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
        altKey: alt,
      });
      (doc.elementFromPoint(a.x, a.y) ?? doc.body).dispatchEvent(
        new PointerEvent('pointerdown', { ...init(a), altKey: false })
      );
      win.dispatchEvent(new PointerEvent('pointermove', init(v)));
      win.dispatchEvent(new PointerEvent('pointermove', init(b)));
      win.dispatchEvent(new PointerEvent('pointerup', init(b)));
    },
    from,
    via,
    to,
    !!opts.alt
  );
}

const order = () =>
  [...source().matchAll(/data-cd-id="ly-(apps|product|brand)"/g)].map((m) => m[1]);

describe('auto layout, reorder and free placement (S2.11)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, HOME);
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await browser.waitUntil(async () => (await rectOf('Small apps')) !== null, { timeout: 15000 });
  });
  after(() => fixtures.restore());

  it('selecting the frame tints its two gaps and chips them "24"', async () => {
    const report = startReport('edit-layout-bands');
    // the frame is selected by clicking its padding (left of the first card)
    const card = (await rectOf('Small apps'))!;
    await click(card.x - 140, card.y);
    await browser.waitUntil(async () => (await count('edit-gap-band')) === 2, { timeout: 8000 });
    expect(await textIn('edit-gap-chip')).toBe('24');
    await capture(report, 'bands');
  });

  it('dragging a gap shows the ruler 12 · 16 · 24 · 32 · 48 and clicks onto a stop', async () => {
    const report = startReport('edit-layout-ruler');
    const h = (await gapHandle())!;
    expect(h).not.toBeNull();
    // 9 px to the right: 33 raw → the 32 stop
    await drag(h, { x: h.x + 4, y: h.y }, { x: h.x + 9, y: h.y });
    await browser.waitUntil(async () => /gap: "32px"/.test(source()), { timeout: 8000 });
    expect(await textIn('edit-token-ruler-hint')).toBeNull(); // released: the ruler is gone
    await capture(report, 'stop');
  });

  it('→ moves the selected card later: one write, the order in the file changes', async () => {
    const report = startReport('edit-layout-arrow');
    const p = (await rectOf('Small apps'))!;
    await click(p.x, p.y);
    await browser.keys(['ArrowRight']);
    await browser.waitUntil(async () => order().join() === 'product,apps,brand', { timeout: 8000 });
    await capture(report, 'moved-later');
  });

  it('dragging the card out of the frame places it freely (CSS, no data-cd-*)', async () => {
    const report = startReport('edit-layout-free');
    const p = (await rectOf('Small apps'))!;
    // well below the frame, over empty artboard
    await drag(p, { x: p.x, y: p.y + 120 }, { x: p.x, y: p.y + 260 });
    await browser.waitUntil(
      async () => /ly-apps" style=\{\{[^}]*position: "absolute"/.test(source()),
      {
        timeout: 8000,
      }
    );
    expect(source()).toMatch(/ly-apps" style=\{\{[^}]*left: "\d+px"/);
    expect(source()).toMatch(/ly-apps" style=\{\{[^}]*top: "\d+px"/);
    expect(
      source()
        .match(/data-cd-[a-z]+=/g)
        ?.sort()
    ).toEqual(HOME.match(/data-cd-[a-z]+=/g)?.sort());
    await capture(report, 'free');
  });
});
