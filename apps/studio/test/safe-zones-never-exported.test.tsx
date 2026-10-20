// S7.22 — "Shown on the canvas only — never exported." (08 ak-safe-zones). A safe-zone band is chrome: it must be
// in no capture, no PNG, no PDF, no SVG. Three layers, each pinned here:
//
//   1. every byte of it lives under `.dc-artboard-guides` — the one mount `_shell.html`'s `#canvas-hide-chrome`
//      block and `capture-chrome.ts` hide, and a sibling of (never inside) the exported `[data-dc-screen]`;
//   2. every exporter that renders a canvas reaches it through `canvasShellUrl` (`?hide-chrome=1`), so that block
//      is what each of them sees;
//   3. in a real Chromium, with the real overlay markup and the real hide-chrome block: the browser lane's
//      `svgForElement` capture carries no band, the PNG of the artboard is pixel-identical to the same artboard
//      with NO safe zone (and differs from it when the chrome block is off — the positive control), and under
//      print media (PDF) the band is `display: none`.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArtboardGuidesOverlay } from '../artboard-guides-overlay.tsx';
import { getBrowserBundle, getCaptureCoreBundle } from '../exporters/_browser-bundles.ts';
import { CAPTURE_HIDDEN_SELECTORS } from '../exporters/capture-chrome.ts';
import { DEV_SERVER_ROOT } from '../paths.ts';

const SHELL = join(DEV_SERVER_ROOT, '..', '..', 'plugins', 'design', 'templates', '_shell.html');
const HIDE_BLOCK =
  readFileSync(SHELL, 'utf8').match(
    /<style id="canvas-hide-chrome"[^>]*>([\s\S]*?)<\/style>/
  )?.[1] ?? '';

const W = 270;
const H = 480;

/** The overlay exactly as DCArtboard mounts it: a world-coordinate sibling of the article. */
const overlay = (safeZones: string | undefined) =>
  renderToStaticMarkup(
    <ArtboardGuidesOverlay
      rect={{ x: 40, y: 40, w: W, h: H }}
      kind="digital"
      visibility={{}}
      safeZones={safeZones}
      artboardId="story"
    />
  );

/** A canvas-shaped page: the artboard, its overlay sibling, and the shell's hide-chrome block. */
function page(opts: { safeZones?: string; chromeOn: boolean }): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style id="canvas-hide-chrome" media="${opts.chromeOn ? 'all' : 'not all'}">${HIDE_BLOCK}</style>
<style>body{margin:0;background:#fff}.dc-world{position:relative;width:400px;height:600px}</style></head>
<body><div class="dc-world">
<article class="dc-artboard" data-dc-screen="story" style="position:absolute;left:40px;top:40px;width:${W}px;height:${H}px;background:#12203a;color:#f5f2ea;font:20px Arial,sans-serif">
<div class="dc-artboard-body" style="padding:16px"><p>Sobota 19:00</p><p style="margin-top:340px">Vstupenky na webu</p></div></article>
${overlay(opts.safeZones)}
</div></body></html>`;
}

describe('1 · the bands live in the guides mount, outside the exported artboard', () => {
  const html = overlay('instagram-reels');

  test('one root, the hidden class, and everything drawn is inside it', () => {
    expect(html.startsWith('<div class="dc-artboard-guides"')).toBe(true);
    expect(html.match(/class="dc-artboard-guides"/g)?.length).toBe(1);
    expect(html.endsWith('</div>')).toBe(true);
    expect(html).toContain('Caption and audio');
  });

  test('the class is in the shell block AND capture-chrome (the two lists every exporter reads)', () => {
    expect(HIDE_BLOCK).toContain('.dc-artboard-guides');
    expect(CAPTURE_HIDDEN_SELECTORS).toContain('.dc-artboard-guides');
  });

  test('the overlay is not part of the artboard the exporters serialise', () => {
    const full = page({ safeZones: 'instagram-reels', chromeOn: true });
    const article = full.slice(full.indexOf('<article'), full.indexOf('</article>'));
    expect(article).not.toContain('safe-zone');
    expect(article).not.toContain('Caption and audio');
  });
});

describe('2 · every exporter that renders a canvas goes through the hide-chrome shell URL', () => {
  for (const f of ['png', 'pdf', 'svg', 'html', 'pptx', 'video']) {
    test(`exporters/${f}.ts`, () => {
      const src = readFileSync(join(DEV_SERVER_ROOT, 'exporters', `${f}.ts`), 'utf8');
      expect(src).toContain('canvasShellUrl(');
    });
  }

  test('jpg.ts is png.ts with another encoder: it runs the png adapter, not its own capture', () => {
    const src = readFileSync(join(DEV_SERVER_ROOT, 'exporters', 'jpg.ts'), 'utf8');
    expect(src).toMatch(/from '\.\/png\.ts'/);
  });

  test('canvasShellUrl always sets hide-chrome=1 (the flag that turns the block on)', () => {
    const src = readFileSync(join(DEV_SERVER_ROOT, 'exporters', 'index.ts'), 'utf8');
    expect(src).toContain("params.set('hide-chrome', '1')");
  });
});

describe('3 · in a real Chromium', () => {
  type Page = {
    setContent(html: string, o?: unknown): Promise<void>;
    screenshot(o: unknown): Promise<Buffer>;
    emulateMedia(o: unknown): Promise<void>;
    evaluate<T>(fn: (...a: never[]) => T | Promise<T>, ...a: unknown[]): Promise<T>;
    addScriptTag(o: unknown): Promise<void>;
    waitForFunction(fn: () => unknown): Promise<void>;
    pdf(o: unknown): Promise<Buffer>;
  };

  async function withPage<T>(fn: (p: Page) => Promise<T>): Promise<T> {
    const { launchChromium } = (await import('../bin/_pw-launch.mjs')) as {
      launchChromium: () => Promise<{
        newContext: (o: unknown) => Promise<{ newPage: () => Promise<unknown> }>;
        close: () => Promise<void>;
      }>;
    };
    const browser = await launchChromium();
    try {
      const ctx = await browser.newContext({
        viewport: { width: 400, height: 600 },
        deviceScaleFactor: 1,
      });
      return await fn((await ctx.newPage()) as Page);
    } finally {
      await browser.close();
    }
  }

  const clip = { x: 40, y: 40, width: W, height: H };

  test(
    'PNG: the artboard with a safe zone exports pixel-identical to the same artboard without one',
    async () => {
      const shot = (p: Page, o: { safeZones?: string; chromeOn: boolean }) =>
        p.setContent(page(o), { waitUntil: 'load' }).then(() => p.screenshot({ clip }));
      const { withZones, without, controlOff } = await withPage(async (p) => ({
        withZones: await shot(p, { safeZones: 'instagram-reels', chromeOn: true }),
        without: await shot(p, { chromeOn: true }),
        // positive control: the bands DO paint when the chrome block is off (the live editor)
        controlOff: await shot(p, { safeZones: 'instagram-reels', chromeOn: false }),
      }));
      expect(Buffer.compare(withZones, without)).toBe(0);
      expect(Buffer.compare(controlOff, without)).not.toBe(0);
    },
    { timeout: 60_000 }
  );

  test(
    'PDF: under print media the band is display:none, and the page prints',
    async () => {
      const { shown, hidden, pdfBytes } = await withPage(async (p) => {
        const probe = () =>
          p.evaluate(() => {
            const el = document.querySelector('[data-testid="safe-zones"]');
            return el
              ? getComputedStyle(el.closest('.dc-artboard-guides') as Element).display
              : 'absent';
          });
        await p.setContent(page({ safeZones: 'instagram-reels', chromeOn: false }), {
          waitUntil: 'load',
        });
        await p.emulateMedia({ media: 'print' });
        const shownNow = await probe();
        await p.setContent(page({ safeZones: 'instagram-reels', chromeOn: true }), {
          waitUntil: 'load',
        });
        await p.emulateMedia({ media: 'print' });
        const hiddenNow = await probe();
        const pdf = await p.pdf({ width: '400px', height: '600px', printBackground: true });
        return { shown: shownNow, hidden: hiddenNow, pdfBytes: pdf.byteLength };
      });
      expect(shown).toBe('block'); // control: without the hide-chrome block it would print
      expect(hidden).toBe('none');
      expect(pdfBytes).toBeGreaterThan(500);
    },
    { timeout: 60_000 }
  );

  test(
    "capture: the browser lane's svgForElement carries no band and no tag",
    async () => {
      const [iife, core] = await Promise.all([
        getBrowserBundle('dom-to-svg', 'domToSvg'),
        getCaptureCoreBundle(),
      ]);
      const svg = await withPage(async (p) => {
        // the live canvas: the hide-chrome block is OFF, applyCaptureChrome is the only thing hiding chrome
        await p.setContent(page({ safeZones: 'instagram-reels', chromeOn: false }), {
          waitUntil: 'load',
        });
        await p.addScriptTag({ path: iife });
        await p.addScriptTag({ path: core, type: 'module' });
        await p.waitForFunction(
          () => !!(window as never as Record<string, unknown>).__maudeCaptureCore
        );
        return p.evaluate(async () => {
          // biome-ignore lint/suspicious/noExplicitAny: injected globals
          const w = window as any;
          const target = document.querySelector('[data-dc-screen]') as Element;
          return (await w.__maudeCaptureCore.svgForElement(target, w.domToSvg)) as string;
        });
      });
      expect(svg).toContain('Sobota 19:00'); // it did capture the artboard
      for (const word of ['Caption and audio', 'Profile and progress bar', 'Buttons', 'safe-zone'])
        expect(svg).not.toContain(word);
    },
    { timeout: 60_000 }
  );
});
