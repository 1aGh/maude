// V2-2.8 "fixed artboard loses 24 px" — a `fixed` DCArtboard counted its label
// strip inside its declared height, so on the canvas the design surface
// (`.dc-artboard-body`) was `height − label` tall and its foot was clipped,
// while the export (label hidden) showed the full height: the canvas and the
// file disagreed. Real browser (Chromium via the repo's playwright), real
// server, real exporter shim — layout is the thing under test, and happy-dom
// has none.
//
// Every consumer of artboard geometry is checked against the DECLARED size:
// the canvas render, the PNG export, the `screenshot --screen` shim and the
// `__maudeCanvasRects` geometry manifest (canvas-rects + the annotation
// toolkit). Hug artboards and the position of content must not change.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const W = 400;
const H = 300;

const CANVAS_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

export default function Sizes() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Sizes">
        <DCArtboard id="fixed" label="Fixed · ${W}×${H}" width={${W}} height={${H}} fixed padding={0}>
          <div style={{ position: "relative", height: "100%", background: "#132038" }}>
            <div data-probe="foot" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 20, background: "#ff00ff" }} />
          </div>
        </DCArtboard>
        <DCArtboard id="hug-short" label="Hug · short" width={${W}} height={${H}} padding={0}>
          <div style={{ height: 40, background: "#0a7" }} />
        </DCArtboard>
        <DCArtboard id="hug-tall" label="Hug · tall" width={${W}} height={${H}} padding={0}>
          <div style={{ height: 500, background: "#a70" }} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Measured {
  frame: Box;
  label: Box | null;
  body: Box | null;
  foot: Box | null;
}
interface PwPage {
  goto(url: string, o?: unknown): Promise<unknown>;
  waitForSelector(sel: string, o?: unknown): Promise<unknown>;
  evaluate<T>(fn: (...a: never[]) => T, arg?: unknown): Promise<T>;
}

let proc: Subprocess | null = null;
let browser: { close(): Promise<void> } | null = null;
let page: PwPage;
let port = 0;
let out = '';
const REL = '.design/ui/sizes.tsx';

const shellUrl = (extra = '') =>
  `http://localhost:${port}/_canvas-shell.html?canvas=${encodeURIComponent(REL)}${extra}`;

/** PNG IHDR width/height. */
function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** World-plane geometry at zoom 1 — the same reset the PNG exporter applies. */
async function measure(): Promise<Record<string, Measured>> {
  return page.evaluate(() => {
    const world = document.querySelector('.dc-world') as HTMLElement | null;
    if (world) {
      world.style.zoom = '1';
      world.style.transform = 'none';
    }
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const out: Record<string, unknown> = {};
    for (const ab of Array.from(document.querySelectorAll('[data-dc-screen]'))) {
      out[ab.getAttribute('data-dc-screen') ?? '?'] = {
        frame: box(ab),
        label: box(ab.querySelector('.dc-artboard-label')),
        body: box(ab.querySelector('.dc-artboard-body')),
        foot: box(ab.querySelector('[data-probe="foot"]')),
      };
    }
    return out as never;
  });
}

beforeAll(async () => {
  const box = makeSandbox();
  writeFileSync(join(box.designRoot, 'ui', 'sizes.tsx'), CANVAS_TSX);
  out = mkdtempSync(join(tmpdir(), 'fixed-size-out-'));
  port = nextPort();
  proc = await bootServer(box.root, port, { MAUDE_NO_AUTOBUILD: '1' });
  const { launchChromium } = (await import('../bin/_pw-launch.mjs')) as {
    launchChromium: () => Promise<{
      newContext: (o: unknown) => Promise<{ newPage: () => Promise<PwPage> }>;
      close: () => Promise<void>;
    }>;
  };
  const b = await launchChromium();
  browser = b;
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.goto(shellUrl(), { waitUntil: 'load' });
  await page.waitForSelector('[data-dc-screen="fixed"] .dc-artboard-body', { timeout: 60_000 });
  if (process.env.L1_DIAG) {
    const diag = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-dc-screen]')).map((ab) => {
        const a = ab as HTMLElement;
        const l = a.querySelector('.dc-artboard-label') as HTMLElement | null;
        const b = a.querySelector('.dc-artboard-body') as HTMLElement | null;
        return {
          id: a.dataset.dcScreen,
          style: a.getAttribute('style'),
          article: [a.offsetWidth, a.offsetHeight, a.clientWidth, a.clientHeight],
          label: l ? [l.offsetTop, l.offsetHeight] : null,
          body: b ? [b.offsetTop, b.offsetWidth, b.offsetHeight] : null,
          rects: (
            window as unknown as { __maudeCanvasRects: () => { artboards: unknown[] } }
          ).__maudeCanvasRects().artboards,
        };
      })
    );
    console.log(`L1_DIAG ${JSON.stringify(diag)}`);
  }
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (proc) await killProc(proc);
});

describe('a fixed artboard is its declared size', () => {
  test('render: the design surface is exactly width × height, foot not clipped', async () => {
    const m = (await measure()).fixed;
    expect(m.body).not.toBeNull();
    expect(m.body?.w).toBeCloseTo(W, 0);
    expect(m.body?.h).toBeCloseTo(H, 0);
    // The bottom-anchored 20 px marker sits flush with the surface's foot.
    expect((m.foot?.y ?? 0) + (m.foot?.h ?? 0)).toBeCloseTo((m.body?.y ?? 0) + (m.body?.h ?? 0), 0);
    expect(m.foot?.h).toBeCloseTo(20, 0);
  });

  test('content does not move: the surface still starts right under the label', async () => {
    const m = (await measure()).fixed;
    // The label stays inside the frame at its top (the v1 look) and the body
    // follows it — so nothing on an existing canvas shifts; the frame only
    // grows at the bottom by the label height.
    expect(m.label).not.toBeNull();
    expect(m.body?.y).toBeCloseTo((m.label?.y ?? 0) + (m.label?.h ?? 0), 0);
    expect(m.label?.y).toBeCloseTo(m.frame.y + 1, 0); // 1 px frame border
  });

  test('hug artboards are untouched: the floor is still the frame, content still drives it', async () => {
    const all = await measure();
    const short = all['hug-short'];
    const tall = all['hug-tall'];
    // floor = the frame's content box (frame minus its 2 × 1 px border)
    expect(short.frame.h - 2).toBeCloseTo(H, 0);
    expect(tall.body?.h).toBeCloseTo(500, 0);
  });

  // The capture hides the label, so the export already carried the full
  // declared height before this fix — the canvas did not. Guard that it still
  // does. (The 1 px frame border is inside the capture on a content-box design
  // system: 402×302 for 400×300, before and after — a separate question.)
  test('export: the PNG of the fixed artboard is width × height (+ the 1 px frame border)', async () => {
    const file = join(out, 'fixed.png');
    const r = Bun.spawnSync([
      'bun',
      new URL('../bin/_png-playwright.mjs', import.meta.url).pathname,
      '--url',
      shellUrl('&hide-chrome=1'),
      '--selector',
      '[data-dc-screen="fixed"]',
      '--out',
      file,
      '--timeout',
      '60',
    ]);
    expect(new TextDecoder().decode(r.stderr)).not.toContain('Error');
    expect(r.exitCode).toBe(0);
    expect(pngSize(file)).toEqual({ w: W + 2, h: H + 2 });
  }, 120_000);

  test('the geometry manifest (canvas-rects, annotation toolkit) reports the design surface', async () => {
    await page.goto(shellUrl(), { waitUntil: 'load' });
    await page.waitForSelector('[data-dc-screen="fixed"] .dc-artboard-body', { timeout: 60_000 });
    const rects = await page.evaluate(() =>
      (
        window as unknown as { __maudeCanvasRects: () => { artboards: Box[] & { id: string }[] } }
      ).__maudeCanvasRects()
    );
    const fixed = (rects.artboards as unknown as Array<Box & { id: string }>).find(
      (a) => a.id === 'fixed'
    );
    expect(fixed?.w).toBeCloseTo(W, 0);
    expect(fixed?.h).toBeCloseTo(H, 0);
    // …positioned where the design is: right under the label strip.
    const all = rects.artboards as unknown as Array<Box & { id: string }>;
    const hug = all.find((a) => a.id === 'hug-tall');
    expect(hug?.h).toBeCloseTo(500, 0);
    expect((hug?.y ?? 0) - (fixed?.y ?? 0)).toBeCloseTo(0, 0);
  });

  test('screenshot --screen captures the whole design: label strip + the full declared surface', async () => {
    const file = join(out, 'shot.png');
    const r = Bun.spawnSync([
      'bun',
      new URL('../bin/_screenshot-playwright.mjs', import.meta.url).pathname,
      '--url',
      shellUrl(),
      '--selector',
      '[data-dc-screen="fixed"]',
      '--out',
      file,
      '--timeout',
      '60',
    ]);
    expect(r.exitCode).toBe(0);
    const m = (await measure()).fixed;
    const size = pngSize(file);
    // The shot is taken at the canvas's own fit zoom, so compare SHAPE, not
    // pixels: frame = border + label + the FULL surface + border.
    const want = (2 + (m.label?.h ?? 0) + H) / (W + 2);
    expect(size.h / size.w).toBeCloseTo(want, 1);
    expect(Math.abs(size.h / size.w - want)).toBeLessThan(0.02);
  }, 120_000);
});
