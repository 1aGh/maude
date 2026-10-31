import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * r1-clipboard-drop (Michal's rc.1 items 13 / 10 / 14) in the packaged WKWebView:
 *   13  ⌘C on an object in artboard A, ⌘V on an object in B → the copy is in B; ⌘X then ⌘Z brings it back.
 *   10  an Assets drop the canvas sees only as text/plain (WebKit hides the shell's custom MIME type from the
 *       canvas origin) → the picture is placed in the artboard under the pointer.
 *   14  in Edit, a press on a board picture on bare canvas → "Switch to Preview to move it · ⌥⌘P".
 *
 * Driving model as edit-object-ops: objects by coordinates from `__maudeCanvasRects()`, synthetic events on the
 * frame's document, assertions on the file on disk or a `data-testid`. A synthetic key is not a user gesture, so
 * the native paste is stood in for by a `paste` event carrying the marker the copy writes (the real gesture path
 * is pinned by test/e2e/clipboard-drop.e2e.mjs in Chromium and test/r1-clip-marker-in-gesture.test.ts).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, '../fixtures/project/.design/ui');
const CANVAS = join(UI, 'Clip.tsx');
const META = join(UI, 'Clip.meta.json');
const BOARD = join(HERE, '../fixtures/project/.design/ui-clip.annotations.json');
const PIC = join(HERE, '../fixtures/project/assets/clip-pic.png');
const fixtures = createFixtureGuard('clipboard-drop', [CANVAS, META, BOARD, PIC]);
// 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const source = () => readFileSync(CANVAS, 'utf8');
const count = (re: RegExp) => (source().match(re) || []).length;
const MARKER = 'Maude · 1 object · paste on a canvas (maude-clip)';

const TSX = `import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
export default function Clip() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Clip">
        <DCArtboard id="a" label="A" width={320} height={200}>
          <div style={{ padding: 16 }}>
            <h2>Alpha heading</h2>
          </div>
        </DCArtboard>
        <DCArtboard id="b" label="B" width={320} height={200}>
          <div style={{ padding: 16 }}>
            <h2>Beta heading</h2>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

function rectOf(text: string): Promise<{ x: number; y: number } | null> {
  return browser.execute((t) => {
    const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const win = frame.contentWindow as (Window & { __maudeCanvasRects?: () => any }) | null;
    const hit = win?.__maudeCanvasRects?.().elements.find((e: any) => e.text.startsWith(t));
    const el = hit
      ? (frame.contentDocument?.querySelector(hit.selector) as HTMLElement | null)
      : null;
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, text);
}

async function click(x: number, y: number): Promise<void> {
  await browser.execute(
    (px, py) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = frame.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const type of ['pointerdown', 'pointerup', 'click'])
        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            clientX: px,
            clientY: py,
            button: 0,
            metaKey: true,
          })
        );
    },
    x,
    y
  );
}

async function inFrame(fn: string, ...args: unknown[]): Promise<unknown> {
  return browser.execute(
    (body, a) => {
      const frame = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      // test-only: runs the step body inside the canvas frame
      return new Function('doc', 'args', body)(frame.contentDocument, a);
    },
    fn,
    args
  );
}

const key = (k: string) =>
  inFrame(
    `doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: args[0], metaKey: true, bubbles: true, cancelable: true }));`,
    k
  );

async function untilOn(
  text: string,
  step: () => Promise<unknown>,
  done: () => boolean,
  msg: string
) {
  await browser.waitUntil(
    async () => {
      if (done()) return true;
      const at = await rectOf(text);
      if (at) {
        await click(at.x, at.y);
        await step();
      }
      await browser.pause(500);
      return done();
    },
    { timeout: 15000, timeoutMsg: msg }
  );
}

describe('copy / paste, Assets drop and the quiet tip (r1-clipboard-drop)', () => {
  before(async () => {
    fixtures.snapshot();
    mkdirSync(dirname(PIC), { recursive: true });
    writeFileSync(PIC, PNG);
    writeFileSync(CANVAS, TSX);
    writeFileSync(
      META,
      JSON.stringify({
        layout: {
          artboards: [
            { id: 'a', x: 100, y: 100 },
            { id: 'b', x: 500, y: 100 },
          ],
        },
      })
    );
    writeFileSync(
      BOARD,
      `{"format":"maude.annotations","v":2,"elements":[\n${JSON.stringify({ id: 'pic', type: 'image', index: 'a0', x: 120, y: 420, w: 160, h: 100, href: 'assets/clip-pic.png' })}\n]}\n`
    );
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-clip')).click();
    await waitForCanvasRects();
  });
  after(() => fixtures.restore());

  it('⌘C on Alpha in A, then ⌘V on Beta in B, puts the copy in B', async () => {
    await untilOn(
      'Alpha heading',
      () => key('c'),
      () => true,
      'copy'
    );
    await browser.pause(800);
    await untilOn(
      'Beta heading',
      () =>
        inFrame(
          `const dt = new DataTransfer(); dt.setData('text/plain', args[0]);
           doc.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));`,
          MARKER
        ),
      () => count(/Alpha heading/g) === 2,
      '⌘V never put the copy in the file'
    );
    expect(source().slice(source().indexOf('id="b"'))).toContain('Alpha heading');
  });

  it('⌘X removes Beta, ⌘Z brings it back', async () => {
    const before = count(/Beta heading/g);
    await untilOn(
      'Beta heading',
      () => key('x'),
      () => count(/Beta heading/g) === before - 1,
      'cut'
    );
    await key('z');
    await browser.waitUntil(() => count(/Beta heading/g) === before, {
      timeout: 10000,
      timeoutMsg: '⌘Z did not bring the cut object back',
    });
  });

  it('an Assets drop seen only as text/plain places the picture', async () => {
    const at = await rectOf('Alpha heading');
    expect(at).not.toBeNull();
    await inFrame(
      `const dt = new DataTransfer(); dt.setData('text/plain', 'assets/clip-pic.png');
       const el = doc.elementFromPoint(args[0], args[1]) || doc.body;
       for (const type of ['dragenter', 'dragover', 'drop'])
         el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: args[0], clientY: args[1], dataTransfer: dt }));`,
      at!.x,
      at!.y
    );
    await browser.waitUntil(() => /clip-pic\.png/.test(source()), {
      timeout: 10000,
      timeoutMsg: 'the dropped asset never reached the canvas source',
    });
  });

  it('a press on a board picture in Edit says to switch to Preview', async () => {
    await browser.waitUntil(
      async () => {
        const pressed = await inFrame(
          `const n = doc.querySelector('[data-id="pic"]'); const r = n && n.getBoundingClientRect();
           if (!r || !r.width) return null;
           const x = r.left + r.width / 2, y = r.top + r.height / 2;
           (doc.elementFromPoint(x, y) || doc.body).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
           return true;`
        );
        if (pressed !== true) return false;
        await browser.pause(300);
        const tip = await inFrame(
          `const t = doc.querySelector('[data-testid="annotation-quiet-tip"]'); return t ? t.textContent : null;`
        );
        return tip === 'Switch to Preview to move it · ⌥⌘P';
      },
      { timeout: 10000, timeoutMsg: 'no quiet tip at the press' }
    );
  });
});
