import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { withNetProbe } from '../helpers/net-probe';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S8.14 (artboards ia-drop-photos · ia-placed) — photos dragged from Finder onto an artboard.
 *
 *   1. six photos over an artboard with six empty frames: the artboard lights up and says "Drop to fill 6 empty frames in
 *      order"; dropped, each frame takes the n-th photo (the bytes on disk are the n-th file), as ONE write ⌘Z takes back.
 *   2. with no empty frame, several photos become one tidy grid (gridTemplateColumns) and one photo goes in loose.
 *   3. a drop on bare canvas (off every artboard) leaves the canvas file alone: it stays loose, the annotation layer's.
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is on, and a native Finder
 * drag cannot be driven by WebDriver): a real `DataTransfer` carrying real PNG `File`s is dispatched on the frame's
 * document — the same events a Finder drop makes — and every assertion is on the file on disk or a `data-testid` the
 * editing layer draws. The Assets tab half (Just added, the bars) is unit-tested; its E2E lives with `assets-panel.e2e.ts`.
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, '../fixtures/project/.design');
const CANVAS = join(DESIGN, 'ui/Smoke.tsx');
const META = join(DESIGN, 'ui/Smoke.meta.json');
const fixtures = createFixtureGuard('drop-photos', [CANVAS, META]);
const source = () => readFileSync(CANVAS, 'utf8');

const cells = (n: number) =>
  Array.from({ length: n }, (_, i) => `<img data-cd-id="cell-${i + 1}" alt="" />`).join(
    '\n          '
  );

const canvasWith = (inner: string) => `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="Fotky ze zápasu" width={900} height={600}>
        <div data-cd-id="grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          ${inner}
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

const SIX_EMPTY = canvasWith(cells(6));
const NONE_EMPTY = canvasWith('<p data-cd-id="note">no frames</p>');

const inFrame = async <T>(
  fn: (doc: Document, win: Window, ...rest: any[]) => T | Promise<T>,
  ...args: unknown[]
): Promise<T> => {
  const out = (await browser.executeAsync(
    (src: string, a: unknown[], done: (r: unknown) => void) => {
      try {
        const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
        Promise.resolve(
          new Function('doc', 'win', 'args', `return (${src})(doc, win, ...args)`)(
            frame.contentDocument,
            frame.contentWindow,
            a
          )
        ).then(
          (v) => done({ v }),
          (e) => done({ __inFrameError: String(e) })
        );
      } catch (e) {
        done({ __inFrameError: String(e) });
      }
    },
    fn.toString(),
    args
  )) as { v?: T; __inFrameError?: string };
  if (out.__inFrameError) throw new Error(`inFrame: ${out.__inFrameError}`);
  return out.v as T;
};

/**
 * A drag of `n` distinct PNG photos over (x, y) inside the artboard body — or over the bare canvas when `bare`. Returns the
 * data URL of each file, in the order they were dropped, so the spec can compare bytes on disk. `phase` = 'over' only
 * dispatches dragover/dragleave and returns the hint text; 'drop' dispatches dragover then drop.
 */
const dragPhotos = (n: number, phase: 'over' | 'drop', bare = false) =>
  inFrame(
    async (doc, win, count: number, ph: string, off: boolean) => {
      const files: File[] = [];
      const urls: string[] = [];
      for (let i = 0; i < count; i++) {
        const c = doc.createElement('canvas');
        c.width = c.height = 8;
        const g = c.getContext('2d') as CanvasRenderingContext2D;
        g.fillStyle = `hsl(${i * 47}, 80%, 50%)`;
        g.fillRect(0, 0, 8, 8);
        urls.push(c.toDataURL('image/png'));
        const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b as Blob), 'image/png'));
        // the frame's own File / DataTransfer, as a real Finder drop hands over: a File built in the shell's realm fails the
        // canvas's `instanceof Blob` (asset-upload.ts bodyOf) and the upload throws before any /_api call (r2–r5 "(none)")
        const W = win as unknown as { File: typeof File; DataTransfer: typeof DataTransfer };
        files.push(new W.File([blob], `IMG_${i}.png`, { type: 'image/png' }));
      }
      const body = doc.querySelector('.dc-artboard-body') as HTMLElement;
      const r = body.getBoundingClientRect();
      const x = off ? 3 : r.left + r.width / 2;
      const y = off ? 3 : r.top + 6;
      const dt = new (win as unknown as { DataTransfer: typeof DataTransfer }).DataTransfer();
      for (const f of files) dt.items.add(f);
      const at = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt };
      const target = (off ? doc.body : body) as HTMLElement;
      target.dispatchEvent(new win.DragEvent('dragover', at));
      await new Promise((res) => setTimeout(res, 150));
      const hint = doc.querySelector('[data-testid="edit-drop-hint"]')?.textContent ?? null;
      if (ph === 'drop') target.dispatchEvent(new win.DragEvent('drop', at));
      else target.dispatchEvent(new win.DragEvent('dragleave', { ...at, relatedTarget: null }));
      return { hint, urls };
    },
    n,
    phase,
    bare
  );

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

/** The `src` of the picture with this id (the writer puts `src` before `data-cd-id`, so read the whole tag). */
const srcOf = (cell: string): string | null =>
  source()
    .match(new RegExp(`<img[^>]*data-cd-id="${cell}"[^>]*>`))?.[0]
    .match(/src="(assets\/[^"]+)"/)?.[1] ?? null;

const dataUrlBytes = (url: string): Buffer => Buffer.from(url.split(',')[1] as string, 'base64');

const useCanvas = async (text: string, ready: string) => {
  writeFileSync(CANVAS, text);
  writeFileSync(META, '{}\n');
  await browser.pause(800);
  await browser.waitUntil(
    async () =>
      inFrame((doc, _w, id: string) => !!doc.querySelector(`[data-cd-id="${id}"]`), ready),
    { timeout: 15000, timeoutMsg: 'the written canvas never rendered' }
  );
  await browser.pause(1000); // the drop targets register once the editing layer has mounted over the new canvas
};

const BOARD = 'Fotky ze zápasu'; // the fixture artboard's label (`NONE_EMPTY` / `SIX_EMPTY` above)

describe('drop from Finder onto an artboard (S8.14)', () => {
  before(async () => {
    await waitForSidecar();
    writeFileSync(CANVAS, SIX_EMPTY);
    writeFileSync(META, '{}\n');
    await (await canvasRow('canvas-row-ui-smoke')).click();
    // empty frames have no box of their own, so the rects hook (which lists boxes) stays empty: wait for the artboard itself
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
          return !!frame?.contentDocument?.querySelector('.dc-artboard-body [data-cd-id="cell-1"]');
        }),
      { timeout: 30_000, timeoutMsg: 'the canvas never rendered its six frames' }
    );
    await browser.pause(1500);
  });
  after(() => fixtures.restore());

  it('the artboard says what will happen, and six photos fill six empty frames in order — one write', async () => {
    const report = startReport('drop-photos-fill');
    await useCanvas(SIX_EMPTY, 'cell-6');
    const before = source();
    const over = await dragPhotos(6, 'over');
    expect(over.hint).toBe('Drop to fill 6 empty frames in order');
    expect(source()).toBe(before); // a hover writes nothing
    const { urls } = await withNetProbe(async () => {
      const dropped = await dragPhotos(6, 'drop');
      await browser.waitUntil(async () => srcOf('cell-6') !== null, {
        timeout: 15000,
        timeoutMsg: 'the six photos were never placed',
      });
      return dropped;
    });
    // cell n holds photo n: the file on disk behind each src is that photo's bytes
    for (let i = 0; i < 6; i++) {
      const rel = srcOf(`cell-${i + 1}`) as string;
      expect(rel).toMatch(/^assets\/[A-Za-z0-9._-]+$/);
      expect(readFileSync(join(DESIGN, rel)).equals(dataUrlBytes(urls[i] as string))).toBe(true);
    }
    await capture(report, 'placed');
    await undoTo(before); // all six are ONE step
  });

  it('with no empty frame several photos become a tidy grid; one photo goes in loose', async () => {
    const report = startReport('drop-photos-grid');
    await useCanvas(NONE_EMPTY, 'note');
    const before = source();
    const over = await dragPhotos(4, 'over');
    // 12 · ia-drop-photos: the chip names WHERE the photos go — the artboard under the pointer, by its name
    expect(over.hint).toBe(`Drop to place 4 photos in ${BOARD}`);
    await dragPhotos(4, 'drop');
    await browser.waitUntil(async () => source().split('<img').length === 5, {
      timeout: 15000,
      timeoutMsg: 'the grid was never written',
    });
    expect(source()).toContain('"repeat(2, 1fr)"');
    await capture(report, 'grid');
    await undoTo(before);
    // the file is back; the canvas draws it a beat later — hover the artboard as it is drawn again, not the grid
    // still on screen (a photo frame there says "Drop to fill the frame")
    await browser.waitUntil(
      async () => inFrame((doc) => doc.querySelectorAll('.dc-artboard-body img').length === 0),
      { timeout: 15000, timeoutMsg: 'the canvas never drew the undone state' }
    );
    const one = await dragPhotos(1, 'over');
    expect(one.hint).toBe(`Drop to place the photo in ${BOARD}`);
  });

  it('a drop on bare canvas leaves the canvas file alone: it stays loose', async () => {
    await useCanvas(NONE_EMPTY, 'note');
    const before = source();
    const over = await dragPhotos(3, 'over', true);
    expect(over.hint).toBeNull(); // no artboard under the pointer: no hint
    await dragPhotos(3, 'drop', true);
    await browser.pause(2500);
    expect(source()).toBe(before);
  });
});
