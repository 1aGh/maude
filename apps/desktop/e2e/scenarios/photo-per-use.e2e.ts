import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S8.15 (12 Import and Assets · ia-photo-inspector · ia-photo-steps) — a photo edit changes ONE use.
 *
 *   1. the inspector's Photo tab on a picture shows the eight looks, Light · Colour and "Only this use changes"
 *      ("… is in 1 more canvas — they keep the original. Reset brings this one back too.").
 *   2. a look writes `assets/<img8>.<edit8>.photo.json` and `data-photo-edit="<edit8>"` on THAT picture only — the
 *      other use in this canvas and the other canvas keep the original, and the every-use file is not written.
 *   3. Reset takes the attribute off again (the use shows the every-use look); ⌘Z puts it back.
 *   4. "Apply to every use…" opens a sheet that names the other canvas; Apply writes the every-use file and takes
 *      every use's own edit off.
 *
 * Driving model (memory: the canvas iframe is unreachable by DOM selectors once the origin split is on): events go
 * to the frame's document, the inspector is the shell's own DOM, and every assertion is on the files on disk.
 *
 * Written, not run, by the slice (the lane has no desktop build); run with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, '../fixtures/project/.design');
const IMG = '5e15c0de';
const PIC = join(DESIGN, `assets/${IMG}.png`);
const CANVAS = join(DESIGN, 'ui/Smoke.tsx');
const META = join(DESIGN, 'ui/Smoke.meta.json');
const OTHER = join(DESIGN, 'ui/Smoke-other.tsx');
const fixtures = createFixtureGuard('photo-per-use', [CANVAS, META]);
const source = () => readFileSync(CANVAS, 'utf8');
const perUseFiles = () =>
  readdirSync(join(DESIGN, 'assets')).filter((n) =>
    new RegExp(`^${IMG}\\.[0-9a-f]{8,16}\\.photo\\.json$`).test(n)
  );
const everyUse = join(DESIGN, `assets/${IMG}.photo.json`);

const HOME = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function Smoke() {
  return (
    <DesignCanvas>
      <DCArtboard id="smoke" label="SMOKE/01 · PHOTO" width={900} height={420}>
        <img data-cd-id="photo" src="assets/${IMG}.png" alt="" style={{ width: 300, height: 400, objectFit: "cover" }} />
        <img data-cd-id="photo-2" src="assets/${IMG}.png" alt="" style={{ width: 300, height: 400, objectFit: "cover" }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const OTHER_SRC = `import { DCArtboard, DesignCanvas } from "@maude/canvas-lib";

export default function SmokeOther() {
  return (
    <DesignCanvas>
      <DCArtboard id="other" label="OTHER" width={400} height={420}>
        <img data-cd-id="pic" src="assets/${IMG}.png" alt="" />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

const inFrame = async <T>(
  fn: (doc: Document, win: Window, ...rest: any[]) => T,
  ...args: unknown[]
): Promise<T> => {
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

const present = (id: string) =>
  inFrame((doc, _w, elId: string) => !!doc.querySelector(`[data-cd-id="${elId}"]`), id);

/** ⌘-click at the element's centre (the router picks by position), then let the selection settle. */
const click = async (id: string) => {
  await inFrame((doc, win, elId: string) => {
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
    for (const t of ['pointerdown', 'pointerup', 'click'])
      el.dispatchEvent(new win.MouseEvent(t, { ...at, detail: 1 }));
  }, id);
  await browser.pause(700);
};

/** The Photo tab of the inspector (the tab strip's "Photo" button). */
const openPhoto = async () => {
  const tab = await $('button.sh-rp-tab=Photo');
  await tab.waitForExist({ timeout: 8000 });
  await tab.click();
  await (await $('[data-testid="photo-section"]')).waitForExist({ timeout: 8000 });
};

const attrOn = (id: string) => {
  const tag =
    source()
      .match(/<img\b[^>]*>/g)
      ?.find((t) => t.includes(`data-cd-id="${id}"`)) ?? '';
  return /data-photo-edit="([0-9a-f]+)"/.exec(tag)?.[1] ?? null;
};

describe('photo edits change one use (S8.15)', () => {
  before(async () => {
    await waitForSidecar();
    fixtures.snapshot();
    copyFileSync(join(DESIGN, 'assets/pic.png'), PIC);
    writeFileSync(CANVAS, HOME);
    writeFileSync(META, '{}\n');
    writeFileSync(OTHER, OTHER_SRC);
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await browser.waitUntil(async () => present('photo-2'), {
      timeout: 15000,
      timeoutMsg: 'the written canvas never rendered',
    });
  });
  after(() => {
    fixtures.restore();
    for (const f of [PIC, OTHER, everyUse, ...perUseFiles().map((n) => join(DESIGN, 'assets', n))])
      if (existsSync(f)) rmSync(f);
  });

  it('the Photo tab says what changes: this use only', async () => {
    const report = startReport('photo-per-use-tab');
    await click('photo');
    await openPhoto();
    for (const look of [
      'original',
      'brighter',
      'warmer',
      'cooler',
      'punchy',
      'mono',
      'club-green',
      'night',
    ])
      expect(await (await $(`[data-testid="photo-look-${look}"]`)).isExisting()).toBe(true);
    const scopeText = async () =>
      (await (await $('[data-testid="photo-scope-line"]')).getText()).trim();
    await browser
      .waitUntil(async () => (await scopeText()).includes('is in 1 more canvas'), {
        timeout: 8000,
        timeoutMsg: 'the scope line never named exactly the other canvas',
      })
      .catch(async (e: Error) => {
        throw new Error(`${e.message} — it says: “${await scopeText()}”`);
      });
    await capture(report, 'tab');
  });

  it('a look lands on this use only: its own file, its own attribute, nothing for every use', async () => {
    const before = source();
    await (await $('[data-testid="photo-look-mono"]')).click();
    await browser.waitUntil(async () => attrOn('photo') !== null, {
      timeout: 10000,
      timeoutMsg: 'data-photo-edit never landed on the picture',
    });
    const edit8 = attrOn('photo') as string;
    expect(perUseFiles()).toContain(`${IMG}.${edit8}.photo.json`);
    expect(
      JSON.parse(readFileSync(join(DESIGN, `assets/${IMG}.${edit8}.photo.json`), 'utf8'))
    ).toMatchObject({
      adjustments: { grayscale: 1 },
    });
    expect(attrOn('photo-2')).toBeNull();
    expect(readFileSync(OTHER, 'utf8')).toBe(OTHER_SRC);
    expect(existsSync(everyUse)).toBe(false);
    // one write: only the attribute changed
    expect(source().replace(` data-photo-edit="${edit8}"`, '')).toBe(before);
  });

  it('Reset takes it off; ⌘Z puts it back', async () => {
    const edit8 = attrOn('photo');
    await (await $('[data-testid="photo-reset"]')).click();
    await browser.waitUntil(async () => attrOn('photo') === null, { timeout: 8000 });
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(async () => attrOn('photo') === edit8, {
      timeout: 10000,
      timeoutMsg: '⌘Z never put the use’s edit back',
    });
    // the panel follows the file: with the use's own edit back, Mono is the look it shows again
    await browser.waitUntil(
      async () =>
        (await (await $('[data-testid="photo-look-mono"]')).getAttribute('aria-checked')) ===
        'true',
      {
        timeout: 8000,
        timeoutMsg: 'after ⌘Z the Photo tab did not show the use’s own look (Mono) again',
      }
    );
  });

  it('Apply to every use… names the other canvas, then writes every use', async () => {
    const report = startReport('photo-per-use-every');
    await (await $('[data-testid="photo-every-use-open"]')).click();
    const sheet = await $('[data-testid="photo-every-use-sheet"]');
    await sheet.waitForExist({ timeout: 5000 });
    const rows = await $$('[data-testid="photo-every-use-row"]');
    expect(await rows.map((r) => r.getAttribute('data-canvas'))).toContain('ui/Smoke-other.tsx');
    await capture(report, 'sheet');
    await (await $('[data-testid="photo-every-use-apply"]')).click();
    await browser.waitUntil(async () => existsSync(everyUse), { timeout: 10000 });
    await browser.waitUntil(async () => attrOn('photo') === null, {
      timeout: 10000,
      timeoutMsg: 'Apply never took the use’s own edit off',
    });
    expect(JSON.parse(readFileSync(everyUse, 'utf8'))).toMatchObject({
      adjustments: { grayscale: 1 },
    });
  });
});
