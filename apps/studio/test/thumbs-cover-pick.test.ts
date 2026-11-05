// W5 (2.0.5) — Home covers. Three ways a cover came out as nothing: (1) the top-left artboard was a
// 480 x 42 header slice, not the phone below it; (2) a board whose canvas draws nothing (annotations only,
// or one thin header over them) was clipped to a strip of `#canvas-root`; (3) a flat-colour picture was
// stored as a fresh hit and never looked at again.

import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { launchChromium } from '../bin/_pw-launch.mjs';
import { isBlankCover, parseRgb } from '../bin/_thumb-blank.mjs';
import { pickAny, pickCover } from '../bin/_thumb-cover.mjs';
import { pidOf } from '../index/snapshot.ts';
import { createThumbService, type ThumbService } from '../thumbs/service.ts';
import { readThumb } from '../thumbs/store.ts';
import { coverWorthy } from '../thumbs/validate.ts';
import { killProc, makeSandbox } from './_helpers.ts';
import { b64, fakeJpeg, fakeShim } from './_thumbs-fake.ts';
import { indexFor, rig, settle, type ThumbRig, writeFiles } from './_thumbs-helpers.ts';

const ab = (id: string, x: number, y: number, w: number, h: number) => ({ id, x, y, w, h });

describe('pickCover skips slivers (W5)', () => {
  const header = ab('header', 0, 0, 480, 42);
  const phone = ab('phone', 0, 120, 390, 844);

  test('a header strip over a phone → the phone', () => {
    expect(pickCover([header, phone], null)).toBe('phone');
    expect(pickCover([phone, header], null)).toBe('phone');
  });

  test('an extreme aspect is a sliver even when it is big', () => {
    expect(pickCover([ab('strip', 0, 0, 3320, 200), ab('screen', 0, 400, 800, 600)], null)).toBe(
      'screen'
    );
  });

  test('"Order and notes…" still wins, even for a sliver', () => {
    expect(pickCover([header, phone], ['header'])).toBe('header');
  });

  test('the usual pick is unchanged: top row, left to right', () => {
    const rects = [ab('b', 600, 0, 500, 400), ab('a', 0, 0, 500, 400), ab('c', 0, 500, 500, 400)];
    expect(pickCover(rects, null)).toBe('a');
  });

  test('no artboard worth it → null (the board, or pickAny, decides); pickAny is the biggest', () => {
    expect(pickCover([header, ab('line', 0, 100, 600, 20)], null)).toBeNull();
    expect(pickAny([header, ab('banner', 0, 100, 728, 90)])).toBe('banner');
    expect(pickAny([])).toBeNull();
  });
});

describe('a stored cover is never a sliver (W5)', () => {
  test('coverWorthy: the floor and the longest aspect', () => {
    expect(coverWorthy(480, 300)).toBe(true);
    expect(coverWorthy(223, 480)).toBe(true);
    expect(coverWorthy(480, 59)).toBe(true); // a 728 x 90 banner
    expect(coverWorthy(480, 41)).toBe(false); // the 1200 x 100 header slice Home showed
    expect(coverWorthy(480, 29)).toBe(false); // the 3320 x 200 strip
    expect(coverWorthy(40, 40)).toBe(false);
  });

  const services: ThumbService[] = [];
  afterAll(() => {
    for (const s of services) s.stop();
  });
  const COVER = { canvas: 'ui/A.tsx', artboard: null, size: 'card', priority: 'visible' } as const;
  function svcAnswering(shot: Record<string, unknown>) {
    const { root, designRoot } = makeSandbox();
    writeFiles(designRoot, {
      'ui/A.tsx': `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function A() { return (<DesignCanvas><DCSection id="s" title="A"><DCArtboard id="one" label="One" width={960} height={600}><div /></DCArtboard></DCSection></DesignCanvas>); }
`,
    });
    const index = indexFor(root, designRoot);
    const shim = fakeShim(() => ({
      ok: true,
      runtime: { artboards: [] },
      shots: [{ target: 0, artboard: 'one', ...shot }],
    }));
    const svc = createThumbService({
      pid: pidOf(root),
      designRoot,
      index,
      config: () => ({ theme: 'dark' }),
      serverOrigin: () => 'http://localhost:1',
      captureOrigin: () => 'http://localhost:2',
      spawnShim: shim.handle,
    });
    services.push(svc);
    return { root, svc, index };
  }

  test('a 480 x 30 strip is refused: no file, no cover, a retryable miss', async () => {
    const { root, svc, index } = svcAnswering({ jpeg: b64(fakeJpeg(480, 30)) });
    const first = await svc.thumb(COVER);
    const key = (first as { key: string }).key;
    expect(await settle(svc, COVER)).toEqual({ status: 'unavailable', reason: 'failed' });
    expect(readThumb(pidOf(root), key)).toBeNull();
    expect(index.canvas('ui/A.tsx')?.cover).toBeNull();
  });

  test('a picture the renderer flagged flat-colour is refused the same way', async () => {
    const { root, svc, index } = svcAnswering({ jpeg: b64(fakeJpeg(480, 300)), blank: true });
    const first = await svc.thumb(COVER);
    const key = (first as { key: string }).key;
    expect(await settle(svc, COVER)).toEqual({ status: 'unavailable', reason: 'failed' });
    expect(readThumb(pidOf(root), key)).toBeNull();
    expect(index.canvas('ui/A.tsx')?.cover).toBeNull();
  });

  test('the same picture not flagged is a normal cover', async () => {
    const { svc, index } = svcAnswering({ jpeg: b64(fakeJpeg(480, 300)), blank: false });
    expect((await settle(svc, COVER)).status).toBe('ready');
    expect(index.canvas('ui/A.tsx')?.cover?.h).toBe(300);
  });
});

describe('isBlankCover looks at the pixels (W5, real Chromium)', () => {
  test('a solid-white JPEG is blank; a picture with content is not', async () => {
    const browser = await launchChromium({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto('about:blank');
      const make = (draw: string) =>
        page.evaluate((src: string) => {
          const c = document.createElement('canvas');
          c.width = 480;
          c.height = 300;
          const g = c.getContext('2d') as CanvasRenderingContext2D;
          new Function('g', src)(g);
          return c.toDataURL('image/jpeg', 0.8).split(',')[1];
        }, draw);
      const white = await make('g.fillStyle="#fff"; g.fillRect(0,0,480,300)');
      const dark = await make('g.fillStyle="#16181d"; g.fillRect(0,0,480,300)');
      const content = await make(
        'g.fillStyle="#fff"; g.fillRect(0,0,480,300); g.fillStyle="#6366f1"; g.fillRect(40,40,220,120); g.fillStyle="#111"; g.fillRect(40,200,400,40)'
      );
      expect(await isBlankCover(page, white)).toBe(true);
      // one deliberate colour is a design; the canvas's own background is an empty viewport
      expect(await isBlankCover(page, dark)).toBe(false);
      expect(await isBlankCover(page, dark, [22, 24, 29])).toBe(true);
      expect(parseRgb('rgb(22, 24, 29)')).toEqual([22, 24, 29]);
      expect(parseRgb('rgba(0, 0, 0, 0)')).toBeNull();
      expect(await isBlankCover(page, content)).toBe(false);
      expect(await isBlankCover(page, 'not-an-image')).toBeNull(); // undecidable → kept
    } finally {
      await browser.close();
    }
  }, 60_000);
});

// the real thing: an annotations-only board and a thin header over a board render a cover that shows the
// board (the hide-chrome sheet hides the annotation layer for exports — a board cover puts it back)
const rigs: ThumbRig[] = [];
afterAll(async () => {
  for (const r of rigs) {
    r.svc.stop();
    await killProc(r.proc);
  }
});

const BOARD = JSON.stringify({
  format: 'maude.annotations',
  v: 2,
  elements: [
    {
      id: 's_sec',
      type: 'section',
      index: 'a0',
      x: 0,
      y: 0,
      w: 1600,
      h: 1000,
      label: 'Plan',
      color: '#6366f1',
    },
    {
      id: 's_s1',
      type: 'sticky',
      parent: 's_sec',
      index: 'a1',
      x: 40,
      y: 60,
      w: 400,
      h: 160,
      fill: '#fde68a',
      text: 'First idea',
      fontSize: 18,
    },
    {
      id: 's_s2',
      type: 'sticky',
      parent: 's_sec',
      index: 'a2',
      x: 500,
      y: 60,
      w: 400,
      h: 160,
      fill: '#bbf7d0',
      text: 'Second idea',
      fontSize: 18,
    },
    {
      id: 's_s3',
      type: 'sticky',
      parent: 's_sec',
      index: 'a3',
      x: 40,
      y: 300,
      w: 400,
      h: 160,
      fill: '#bfdbfe',
      text: 'Third idea',
      fontSize: 18,
    },
  ].map((e) => ({ ...e, author: { kind: 'ai' } })),
});

describe('board covers (W5, real Chromium)', () => {
  test('annotations-only and header-over-board canvases get a sane cover that is not blank', async () => {
    const r = await rig(() => ({
      'ui/Warm.tsx': `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function C() { return (<DesignCanvas><DCSection id="s" title="W"><DCArtboard id="a" label="A" width={300} height={200}><div /></DCArtboard></DCSection></DesignCanvas>); }
`,
      'ui/Zero.tsx': `import { DesignCanvas } from "@maude/canvas-lib";
export default function C() { return <DesignCanvas />; }
`,
      'ui/Strip.tsx': `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function C() { return (<DesignCanvas><DCSection id="s" title="S"><DCArtboard id="header" label="Header" width={3320} height={200}><div style={{ background: "#fff", color: "#111", fontSize: 40, padding: 40 }}>Title</div></DCArtboard></DCSection></DesignCanvas>); }
`,
    }));
    rigs.push(r);
    for (const name of ['zero', 'strip'])
      writeFileSync(join(r.designRoot, `ui-${name}.annotations.json`), BOARD);
    // the first render of a booted server can spend its whole budget compiling the shell
    await settle(r.svc, {
      canvas: 'ui/Warm.tsx',
      artboard: null,
      size: 'card',
      priority: 'visible',
    });
    for (const name of ['Zero', 'Strip']) {
      const res = await settle(r.svc, {
        canvas: `ui/${name}.tsx`,
        artboard: null,
        size: 'card',
        priority: 'visible',
      });
      // a sane cover (never a strip), or no cover at all so Home shows its placeholder
      if (res.status === 'ready') {
        expect(res.h).toBeGreaterThanOrEqual(0.4 * res.w);
        const bytes = readThumb(pidOf(r.root), res.key) as Uint8Array;
        const browser = await launchChromium({ headless: true });
        try {
          const page = await browser.newPage();
          await page.goto('about:blank');
          expect(await isBlankCover(page, b64(bytes))).toBe(false);
        } finally {
          await browser.close();
        }
      } else {
        expect(res.status).toBe('unavailable');
      }
      // and with a board drawn it IS a cover, not a miss
      expect(res.status).toBe('ready');
    }
  }, 150_000);
});
