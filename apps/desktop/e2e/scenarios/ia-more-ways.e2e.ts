import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { png, tinyMp4 } from '../helpers/fixture-media';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 12 Import and Assets · ia-more-ways — two of the three more ways in (T2.6c, issue #172): ⌘V a screenshot, and drop a
 * video file. The third (a logo, SVG or PDF) is the converters' and is pinned by `v2-import-lines.test.ts`.
 *
 *   paste    a screenshot is pasted into the open canvas: its bytes land in the project's assets (a copy goes to Assets)
 *            and the canvas holds a reference to it; paste the SAME picture again and the same file is reused, not a
 *            second copy
 *   video    a video file dropped on the artboard is on the canvas at once as a `<video src="assets/…">` and its bytes are
 *            in assets; the canvas says so in one line ("Placed the video in …. It's in Assets too.")
 *
 * NOT driven, and why: Import › More ways with the native file panel (an NSOpenPanel is not in the webview, and a
 * WebDriver session cannot press it) — that stays with the rc soak. The 4K .mov that "prepares in place" needs a real
 * ffmpeg proxy run; a 2.6 kB mp4 stands in, so the "Preparing… 62 %" chip is not asserted.
 *
 * Driving model, as drop-photos and edit-images: a real `DataTransfer` carrying real `File`s made in the CANVAS's realm
 * (a File built in the shell's window is no Blob to the canvas) is dispatched on the frame's document — the same events
 * a paste and a Finder drop make — and every assertion is on the files on disk. This lane has the origin split OFF, so
 * the frame is same-origin.
 *
 * Preconditions: the default lane (wdio.conf.ts) and a built test app; media bytes are made in the spec
 * (`helpers/fixture-media.ts`: a generated PNG, `apps/studio/test/fixtures/tiny.mp4` from the repo). It writes the
 * fixture `Smoke.tsx` and its board (snapshot + byte-exact restore) and removes the asset files it added.
 * WRITTEN, NOT RUN in the T2.6c hand-back — the lead runs it once, alone.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, '../fixtures/project/.design');
const ASSETS = join(DESIGN, 'assets');
const CANVAS = join(DESIGN, 'ui/Smoke.tsx');
const META = join(DESIGN, 'ui/Smoke.meta.json');
const BOARD = join(DESIGN, 'ui-smoke.annotations.json');
const fixtures = createFixtureGuard('ia-more-ways', [CANVAS, META, BOARD]);
const source = () => readFileSync(CANVAS, 'utf8');
const board = () => (existsSync(BOARD) ? readFileSync(BOARD, 'utf8') : '');

const LABEL = 'Story 9:16 · Gameday';
const STORY = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="${LABEL}" width={450} height={800}>
        <div data-cd-id="hero" style={{ padding: 32, fontFamily: "system-ui" }}>GAMEDAY</div>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

const listAssets = () => (existsSync(ASSETS) ? readdirSync(ASSETS) : []);
let assetsBefore: string[] = [];

/** The asset files added since the spec began whose bytes are exactly `bytes`. */
const addedWith = (bytes: Buffer) =>
  listAssets()
    .filter((f) => !assetsBefore.includes(f))
    .filter((f) => readFileSync(join(ASSETS, f)).equals(bytes));

/** Run `fn(doc, win, ...args)` inside the canvas frame (same-origin in this lane). */
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

/** ⌘V of a picture: a `paste` event whose clipboard carries one image file. */
const pasteImage = (bytes: Buffer, name: string) =>
  inFrame(
    (doc, w, b64: string, fileName: string) => {
      const win = w as Window & typeof globalThis;
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new win.DataTransfer();
      dt.items.add(new win.File([raw], fileName, { type: 'image/png' }));
      doc.dispatchEvent(
        new win.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      );
    },
    bytes.toString('base64'),
    name
  );

/** A Finder drop of one video file on the artboard's body. */
const dropVideo = (bytes: Buffer, name: string) =>
  inFrame(
    async (doc, w, b64: string, fileName: string) => {
      const win = w as Window & typeof globalThis;
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const body = doc.querySelector('.dc-artboard-body') as HTMLElement;
      const r = body.getBoundingClientRect();
      const dt = new win.DataTransfer();
      dt.items.add(new win.File([raw], fileName, { type: 'video/mp4' }));
      const at = {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.bottom - 40,
        dataTransfer: dt,
      };
      body.dispatchEvent(new win.DragEvent('dragover', at));
      await new Promise((res) => setTimeout(res, 150));
      body.dispatchEvent(new win.DragEvent('drop', at));
    },
    bytes.toString('base64'),
    name
  );

describe('ia-more-ways — paste a screenshot, drop a video file (12 Import and Assets)', () => {
  before(async () => {
    fixtures.snapshot();
    startReport('ia-more-ways');
    assetsBefore = listAssets();
    await waitForSidecar();
    writeFileSync(CANVAS, STORY);
    writeFileSync(META, '{}\n');
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await browser.waitUntil(
      async () =>
        inFrame((doc) => !!doc.querySelector('.dc-artboard-body [data-cd-id="hero"]')).catch(
          () => false
        ),
      { timeout: 30_000, timeoutMsg: 'the canvas never rendered its artboard' }
    );
    await browser.pause(1_500); // the editing layer registers its handlers once it has mounted
  });

  after(() => {
    fixtures.restore();
    for (const f of listAssets())
      if (!assetsBefore.includes(f)) rmSync(join(ASSETS, f), { force: true });
  });

  it('⌘V puts a screenshot into the project’s assets and onto the canvas; the same picture pasted again is reused, not copied', async () => {
    const shot = png(48, 32, [200, 60, 40]);
    await pasteImage(shot, 'Snímek obrazovky 2026-10-06 v 14.05.png');
    await browser.waitUntil(async () => addedWith(shot).length === 1, {
      timeout: 20_000,
      timeoutMsg: 'the pasted screenshot never reached the project’s assets',
    });
    const [name] = addedWith(shot);
    // the canvas holds it: in the design (an artboard placement) or on the layer above it (a loose picture) — it landed
    await browser.waitUntil(async () => source().includes(name) || board().includes(name), {
      timeout: 20_000,
      timeoutMsg: `nothing on the canvas names ${name}`,
    });
    await capture('01-pasted');

    // paste it again: the file is the same fingerprint — one copy in assets, however many times
    await pasteImage(shot, 'Snímek obrazovky 2026-10-06 v 14.05.png');
    await browser.pause(5_000);
    expect(addedWith(shot)).toHaveLength(1);
  });

  it('a video file dropped on the artboard is a <video> on the canvas at once; its bytes are in assets', async () => {
    const clip = tinyMp4();
    const before = source();
    await dropVideo(clip, 'IMG_4471.mp4');
    await browser.waitUntil(async () => /<video\b[^>]*src="assets\/[^"]+\.mp4"/.test(source()), {
      timeout: 30_000,
      timeoutMsg: 'the dropped video never became a <video> element on the canvas',
    });
    expect(source()).not.toBe(before);
    expect(addedWith(clip)).toHaveLength(1);
    await capture('02-video-dropped');
    // the canvas says what happened in one line (a toast inside the frame). It stays a few seconds and may already be
    // gone by the time the disk has caught up, so a miss is logged, not failed — the bytes above are the proof.
    const said = await inFrame((doc) => doc.body.innerText);
    if (!said.includes(`Placed the video in ${LABEL}. It's in Assets too.`))
      console.warn('[ia-more-ways] the placed line was not on screen when read');
  });
});
