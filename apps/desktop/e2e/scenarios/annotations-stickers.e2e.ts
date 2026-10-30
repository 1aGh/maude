import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, $$, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 15 Annotations — the Stickers gallery, a sticker that follows the pointer, and the stamps (S4.3 / S4.13, canvas 15
 * `an-stk-gallery` · `an-stk-drop` · `an-stamps`; the plan's V2-8.3 `annotations-stickers`).
 *
 *   1  Preview's Stickers slot opens the GALLERY (the shell draws it): the Stamps row (six votes), the bundled packs,
 *      a search. Opening it writes nothing.
 *   2  A pick follows the pointer (`annot-placing`); one click puts it down at 160 px, the board file gets ONE image
 *      element carrying its `sticker` ref, and the "160 × 160" chip names its size. The gallery's PNG is uploaded
 *      into the project (`assets/`), which is the only other thing written.
 *   3  A stamp: pick Yes in the gallery, the gallery folds to the Stamps row (`stamps-row-yes`, the armed one is
 *      `data-on`), a click stamps, a second click on the same spot is the SAME stamp ("one each, they count": the
 *      stamp's id is its spot + maker + kind), and Escape puts the stamp down.
 *
 * Driving model (as first-canvas / edit-artboards): MAUDE_CANVAS_ORIGIN_SPLIT=0, so the canvas iframe is same-origin;
 * the toolbar and the placing ghost are in the canvas document, the gallery is the SHELL's DOM. The pointer events the
 * placement layer listens for are dispatched on the canvas document at coordinates read from its own DOM; every
 * assertion that matters is on the BOARD FILE on disk (`ui-smoke.annotations.json`), never on a pixel.
 *
 * Hooks (client/TESTIDS.md · 15 Annotations): toolbar-preview, toolbar-slot-stickers, tool-panel-stickers,
 * stickers-stamps, stickers-stamp-<id>, stickers-pack-<slug>, sticker-<pack>-<file>, stamps-row-<id>, annot-placing,
 * annot-sticker-size, annot-stamp-face.
 *
 * WRITTEN, NOT RUN (the p8 desktop lane had no screen): the lead's screen slot is its first run. Two things only that
 * run can answer — whether a local project with no signed-in person names its stamp maker ("You"), and whether the
 * gallery's sticker upload lands before the click that follows it (the wait below is on the board file, not a sleep).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, '../fixtures/project/.design');
const BOARD = join(DESIGN, 'ui-smoke.annotations.json');
const ASSETS = join(DESIGN, 'assets');
const fixtures = createFixtureGuard('annotations-stickers', [BOARD]);
const ARTBOARD = 'smoke'; // <DCArtboard id="smoke" ...> in ui/Smoke.tsx

const tid = (s: string) => `[data-testid="${s}"]`;
const STAMPS = ['yes', 'no', 'star', 'heart', 'ask', 'plus'];

type Element = {
  id: string;
  type: string;
  w?: number;
  h?: number;
  kind?: string;
  sticker?: { pack: string; id: string };
};
const board = (): Element[] =>
  existsSync(BOARD) ? (JSON.parse(readFileSync(BOARD, 'utf8')).elements ?? []) : [];
const stickers = () => board().filter((e) => e.type === 'image' && e.sticker);
const stamps = () => board().filter((e) => e.type === 'stamp');

let assetsBefore = new Set<string>();

// ── the canvas document ──────────────────────────────────────────────────────────────────────────────────────
const inFrame = <T>(fn: (doc: Document) => T) =>
  browser.execute((src) => {
    const iframe = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    return new Function('doc', `return (${src})(doc)`)(iframe.contentDocument);
  }, fn.toString()) as Promise<T>;

type Pt = { x: number; y: number };

/** A point on the artboard, frame-local px: just inside its top-left corner, below the name. */
const onArtboard = (dx: number, dy: number) =>
  browser.execute(
    (id, ox, oy) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const r = (
        frame.contentDocument?.querySelector(
          `[data-dc-screen="${id}"] .dc-artboard-body`
        ) as HTMLElement | null
      )?.getBoundingClientRect();
      return r ? { x: r.left + ox, y: r.top + oy } : null;
    },
    ARTBOARD,
    dx,
    dy
  ) as Promise<Pt | null>;

/** Pointer events on the canvas document at `p` — what the placement layer and the stamp tool listen for. */
function pointer(p: Pt, types: string[]) {
  return browser.execute(
    (px, py, ts) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const win = frame.contentWindow as Window & typeof globalThis;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const t of ts) {
        const init = {
          bubbles: true,
          cancelable: true,
          clientX: px,
          clientY: py,
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        };
        target.dispatchEvent(
          t.startsWith('pointer') ? new win.PointerEvent(t, init) : new win.MouseEvent(t, init)
        );
      }
    },
    p.x,
    p.y,
    types
  );
}
const MOVE = ['pointermove'];
const CLICK = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

const keyInFrame = (key: string) =>
  browser.execute((k) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const doc = frame.contentDocument as Document;
    const win = frame.contentWindow as Window & typeof globalThis;
    doc.dispatchEvent(
      new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    );
  }, key);

/** Preview (N: Preview with Sticky in hand), then Sticky put down — the toolbar that has the Stickers slot. */
async function inPreview() {
  if (await inFrame((d) => !!d.querySelector('[data-testid="toolbar-preview"]'))) return;
  await keyInFrame('n');
  await browser.waitUntil(
    async () => inFrame((d) => !!d.querySelector('[data-testid="toolbar-preview"]')),
    { timeout: 15_000, timeoutMsg: 'N did not open Preview' }
  );
  await keyInFrame('Escape');
}

/** The Stickers slot, pressed in the canvas: the shell answers with the gallery. */
async function openGallery() {
  await inPreview();
  // A person's click in the canvas makes the frame the shell's focused element; the shell opens a tool panel
  // only then (EH-P4-2, use-tool-panels.js `hasFocus`). A synthetic click inside the frame moves no focus, so
  // put it where the person's click would.
  await browser.execute(() =>
    (document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement | null)?.focus()
  );
  await inFrame((d) => {
    (d.querySelector('[data-testid="toolbar-slot-stickers"]') as HTMLElement).click();
    return true;
  });
  await $(tid('tool-panel-stickers')).waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'the Stickers slot did not open the gallery',
  });
}

describe('annotations-stickers — the gallery, a sticker that follows the pointer, the stamps (15)', () => {
  before(async () => {
    startReport('annotations-stickers');
    fixtures.snapshot();
    assetsBefore = new Set(readdirSync(ASSETS));
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
  });
  after(() => {
    fixtures.restore();
    // the gallery's PNG is copied into the project when a sticker is picked
    for (const n of readdirSync(ASSETS))
      if (!assetsBefore.has(n)) rmSync(join(ASSETS, n), { force: true });
  });

  it('Stickers opens the gallery: the Stamps row of six, the bundled packs, a search — and writes nothing', async () => {
    const before = readFileSync(BOARD, 'utf8');
    await openGallery();
    await $(tid('stickers-stamps')).waitForDisplayed({ timeout: 10_000 });
    for (const id of STAMPS) expect(await $(tid(`stickers-stamp-${id}`)).isExisting()).toBe(true);
    await $(tid('stickers-search')).waitForExist({ timeout: 10_000 });
    expect(await $$('[data-testid^="stickers-pack-"]').length).toBeGreaterThan(0);
    expect(await $$('[data-testid^="sticker-"]').length).toBeGreaterThan(0);
    await capture('01-gallery');
    expect(readFileSync(BOARD, 'utf8')).toBe(before);
  });

  it('a pick follows the pointer and one click puts it down at 160 px, selected, "160 × 160"', async () => {
    expect(stickers()).toHaveLength(0);
    const cell = await $('[data-testid^="sticker-project-status-"]');
    await cell.waitForExist({
      timeout: 10_000,
      timeoutMsg: 'the Project status pack has no sticker',
    });
    await cell.click();
    // the gallery steps aside; the sticker is on the pointer
    await $(tid('tool-panel-stickers')).waitForDisplayed({ reverse: true, timeout: 10_000 });
    const at = (await onArtboard(160, 120)) as Pt;
    expect(at).not.toBeNull();
    await browser.waitUntil(
      async () => {
        await pointer(at, MOVE);
        return inFrame((d) => !!d.querySelector('[data-testid="annot-placing"]'));
      },
      {
        timeout: 20_000,
        interval: 300,
        timeoutMsg: 'the picked sticker never followed the pointer',
      }
    );
    await capture('02-following');
    await pointer(at, CLICK);
    await browser.waitUntil(() => stickers().length === 1, {
      timeout: 30_000,
      timeoutMsg: 'the sticker never reached the board file',
    });
    const [s] = stickers();
    expect(s.sticker?.pack).toBe('project-status');
    expect([s.w, s.h]).toEqual([160, 160]);
    await browser.waitUntil(
      async () =>
        inFrame((d) =>
          (d.querySelector('[data-testid="annot-sticker-size"]')?.textContent ?? '').includes('160')
        ),
      { timeout: 10_000, timeoutMsg: 'no "160 × 160" chip under the placed sticker' }
    );
    await capture('02-placed');
  });

  it('a stamp: the gallery folds to the Stamps row, a click stamps, the same spot is the same stamp, Esc puts it down', async () => {
    await openGallery();
    await $(tid('stickers-stamp-yes')).click();
    await $(tid('stamps-row-yes')).waitForDisplayed({
      timeout: 10_000,
      timeoutMsg: 'the gallery did not fold to the Stamps row after a stamp was picked',
    });
    expect(await $(tid('stamps-row-yes')).getAttribute('data-on')).not.toBeNull();
    const at = (await onArtboard(300, 200)) as Pt;
    await pointer(at, CLICK);
    await browser.waitUntil(() => stamps().length === 1, {
      timeout: 30_000,
      timeoutMsg: 'the stamp never reached the board file',
    });
    expect(stamps()[0].kind).toBe('yes');
    // it stays armed: the same spot again is the same stamp (its id is spot + maker + kind) — never a second one
    await pointer(at, CLICK);
    await browser.pause(2000);
    expect(stamps()).toHaveLength(1);
    await browser.waitUntil(
      async () => inFrame((d) => !!d.querySelector('[data-testid="annot-stamp-face"]')),
      { timeout: 10_000, timeoutMsg: 'the stamp was written but not drawn' }
    );
    await capture('03-stamped');
    await keyInFrame('Escape');
    await $(tid('stamps-row-yes')).waitForDisplayed({ reverse: true, timeout: 10_000 });
    // the sticker from step 2 is still the only picture on the board
    expect(stickers()).toHaveLength(1);
  });
});
