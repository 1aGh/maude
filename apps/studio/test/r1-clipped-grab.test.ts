// r1 #12 (Michal, rc.1: "once I move an object off the artboard I have no way to move it back") — the artboard clips
// the object, so the browser's hit-test lands on empty canvas: the marquee cleared the selection and no drag began.
// A press inside the SELECTED object's box grabs it even where it is clipped; the element drag (canvas-shell) and the
// empty-canvas marquee (artboard-marquee) both ask `clippedGrab`. The real-Chromium half (drag out, drag back) is
// test/e2e/canvas-tools.e2e.mjs.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const rect = (left: number, top: number, w: number, h: number) =>
  ({
    left,
    top,
    right: left + w,
    bottom: top + h,
    width: w,
    height: h,
    x: left,
    y: top,
  }) as DOMRect;

function scene() {
  document.body.innerHTML = `<div class="dc-canvas" id="canvas"><div class="dc-world">
    <article data-dc-screen="a4"><div class="dc-artboard-body" id="body">
      <div data-cd-id="rect" id="rect"></div><div data-cd-id="other" id="other"></div>
    </div></article></div></div><div class="dc-tool-palette" id="chrome"></div>`;
  // the rect was dragged to the left of the artboard: its box is at 100…220 × 200…280, the body starts at 600
  (document.getElementById('rect') as HTMLElement).getBoundingClientRect = () =>
    rect(100, 200, 120, 80);
  (document.getElementById('body') as HTMLElement).getBoundingClientRect = () =>
    rect(600, 100, 595, 842);
  return {
    canvas: document.getElementById('canvas') as Element,
    other: document.getElementById('other') as Element,
    chrome: document.getElementById('chrome') as Element,
  };
}

const sel = (id: string) => [{ id, artboardId: 'a4', selector: `[data-cd-id="${id}"]` }] as never;

describe('r1 #12 — a press on a selected object clipped by its artboard grabs it', () => {
  test('inside its box on empty canvas: the object', async () => {
    const { clippedGrab } = await import('../editing/clipped-grab.ts');
    const { canvas } = scene();
    expect(clippedGrab(document, 150, 240, canvas, sel('rect'))?.id).toBe('rect');
  });

  test('outside its box, nothing selected, two selected, on chrome or inside an artboard: nothing', async () => {
    const { clippedGrab } = await import('../editing/clipped-grab.ts');
    const { canvas, other, chrome } = scene();
    expect(clippedGrab(document, 400, 240, canvas, sel('rect'))).toBeNull();
    expect(clippedGrab(document, 150, 240, canvas, [] as never)).toBeNull();
    expect(
      clippedGrab(document, 150, 240, canvas, [...sel('rect'), ...sel('other')] as never)
    ).toBeNull();
    expect(clippedGrab(document, 150, 240, chrome, sel('rect'))).toBeNull();
    // inside an artboard body the ordinary hit-test answers
    expect(clippedGrab(document, 150, 240, other, sel('rect'))).toBeNull();
  });

  test('the element drag and the empty-canvas marquee both ask it', async () => {
    const shell = await Bun.file(new URL('../canvas-shell.tsx', import.meta.url)).text();
    const marquee = await Bun.file(new URL('../artboard-marquee.tsx', import.meta.url)).text();
    expect(shell).toMatch(/clippedGrab\(document, e\.clientX, e\.clientY, t, sel\)/);
    expect(marquee).toMatch(
      /clippedGrab\(document, e\.clientX, e\.clientY, e\.target, selSet\.selected\)\)\s*return;/
    );
  });
});
