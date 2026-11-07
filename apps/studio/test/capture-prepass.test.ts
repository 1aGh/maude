// capture-prepass — issue #150 §2 + §3 (T3.2).
//
// §2 An <img> of an SVG with no size of its own (width="100%" / viewBox only) is drawn by
//    @remotion/web-renderer as `drawImage(img, 0, 0, naturalWidth, naturalHeight, …)`; the
//    browser's stand-in natural size is not the coordinate space the picture is rasterized in,
//    so the export shows a cropped, scaled-up corner of it (measured live) or nothing. The
//    guard reports the layout size for exactly those images.
// §3 A transformed, non-positioned parent is the containing block of its `position: absolute`
//    children only while the transform is applied; the renderer resets the transform while it
//    measures, so the children jump to the frame. The guard pins such a parent as `relative`.
//
// Layout does not exist under happy-dom, so `clientWidth` / `currentSrc` are stubbed on the
// element — the guard's own logic (what counts as size-less, what is left alone, restore) is
// what is under test; the live before/after export frames carry the browser half.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import {
  installCapturePrepass,
  installSizelessSvgImageGuard,
  installTransformPinGuard,
  sizelessSvgDrawSpace,
  svgRootIsSizeless,
  svgViewBoxRatio,
} from '../exporters/capture-prepass.ts';

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function makeImg(src: string, layout: { w: number; h: number }, natural = { w: 157, h: 150 }) {
  const img = document.createElement('img') as HTMLImageElement;
  Object.defineProperty(img, 'currentSrc', { value: src });
  Object.defineProperty(img, 'complete', { value: true });
  Object.defineProperty(img, 'clientWidth', { value: layout.w });
  Object.defineProperty(img, 'clientHeight', { value: layout.h });
  document.body.appendChild(img);
  return { img, natural };
}

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('svgRootIsSizeless', () => {
  test('percent / viewBox-only / empty roots are size-less', () => {
    expect(svgRootIsSizeless('<svg width="100%" height="100%" viewBox="0 0 684 652"></svg>')).toBe(
      true
    );
    expect(svgRootIsSizeless('<svg viewBox="0 0 10 10"><rect/></svg>')).toBe(true);
    expect(svgRootIsSizeless('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true);
    expect(svgRootIsSizeless('<svg width="auto" height="auto" viewBox="0 0 4 4"></svg>')).toBe(
      true
    );
  });

  test('a root with real lengths has a size of its own', () => {
    expect(svgRootIsSizeless('<svg width="684" height="652" viewBox="0 0 684 652"></svg>')).toBe(
      false
    );
    expect(svgRootIsSizeless("<svg width='12px' height='3em'></svg>")).toBe(false);
    // one length + a viewBox gives the other by ratio
    expect(svgRootIsSizeless('<svg width="200" viewBox="0 0 10 5"></svg>')).toBe(false);
  });

  test('looks past an XML prolog and comments, and ignores a non-svg', () => {
    expect(
      svgRootIsSizeless(
        '<?xml version="1.0"?><!-- <svg width="9" height="9"> --><svg viewBox="0 0 1 1"/>'
      )
    ).toBe(true);
    expect(svgRootIsSizeless('<html><body></body></html>')).toBe(false);
  });
});

describe('installSizelessSvgImageGuard', () => {
  test('a size-less svg <img> reports its layout size as its natural size', () => {
    const { img } = makeImg(
      svgDataUrl('<svg width="100%" height="100%" viewBox="0 0 684 652"></svg>'),
      { w: 252, h: 240 }
    );
    const restore = installSizelessSvgImageGuard();
    try {
      expect(img.naturalWidth).toBe(252);
      expect(img.naturalHeight).toBe(240);
    } finally {
      restore();
    }
  });

  test('an svg with a real size, and a raster image, answer as before', () => {
    const fixed = makeImg(
      svgDataUrl('<svg width="684" height="652" viewBox="0 0 684 652"></svg>'),
      { w: 252, h: 240 }
    ).img;
    const png = makeImg('data:image/png;base64,AAAA', { w: 252, h: 240 }).img;
    const before = [fixed.naturalWidth, png.naturalWidth];
    const restore = installSizelessSvgImageGuard();
    try {
      expect([fixed.naturalWidth, png.naturalWidth]).toEqual(before);
    } finally {
      restore();
    }
  });

  test('a size-less svg that is not laid out keeps the browser answer', () => {
    const { img } = makeImg(svgDataUrl('<svg viewBox="0 0 10 10"></svg>'), { w: 0, h: 0 });
    const before = img.naturalWidth;
    const restore = installSizelessSvgImageGuard();
    try {
      expect(img.naturalWidth).toBe(before);
    } finally {
      restore();
    }
  });

  test('restore() puts the original getters back', () => {
    const proto = HTMLImageElement.prototype;
    const before = Object.getOwnPropertyDescriptor(proto, 'naturalWidth');
    const restore = installSizelessSvgImageGuard();
    expect(Object.getOwnPropertyDescriptor(proto, 'naturalWidth')?.get).not.toBe(before?.get);
    restore();
    expect(Object.getOwnPropertyDescriptor(proto, 'naturalWidth')?.get).toBe(before?.get);
  });
});

describe('sizelessSvgDrawSpace + svgViewBoxRatio', () => {
  test('the draw space is the canvas contain-fitted to the viewBox ratio (measured live)', () => {
    const ratio = svgViewBoxRatio('<svg viewBox="0 0 684 652"/>');
    expect(ratio).toBeCloseTo(684 / 652, 6);
    const a = sizelessSvgDrawSpace({ width: 400, height: 400 }, ratio);
    expect([Math.round(a.w), Math.round(a.h)]).toEqual([400, 381]);
    const b = sizelessSvgDrawSpace({ width: 640, height: 360 }, ratio);
    expect([Math.round(b.w), Math.round(b.h)]).toEqual([378, 360]);
    const wide = sizelessSvgDrawSpace(
      { width: 400, height: 400 },
      svgViewBoxRatio('<svg viewBox="0,0,100,50"/>')
    );
    expect([wide.w, wide.h]).toEqual([400, 200]);
  });

  test('no viewBox: the whole canvas; a degenerate viewBox is no ratio', () => {
    expect(svgViewBoxRatio('<svg width="100%"/>')).toBeNull();
    expect(svgViewBoxRatio('<svg viewBox="0 0 0 0"/>')).toBeNull();
    expect(sizelessSvgDrawSpace({ width: 90, height: 40 }, null)).toEqual({ w: 90, h: 40 });
  });
});

describe('the drawImage source rectangle of a size-less svg', () => {
  class FakeContext {
    calls: unknown[][] = [];
    constructor(public canvas: { width: number; height: number }) {}
    drawImage(...args: unknown[]) {
      this.calls.push(args);
    }
  }
  const g = globalThis as unknown as Record<string, unknown>;
  let hadOffscreen: unknown;

  beforeEach(() => {
    hadOffscreen = g.OffscreenCanvasRenderingContext2D;
    g.OffscreenCanvasRenderingContext2D = FakeContext;
  });
  afterAll(() => {
    g.OffscreenCanvasRenderingContext2D = hadOffscreen;
  });

  test('the whole-picture source rect becomes the whole draw space', () => {
    // the browser reports 0 here, the renderer is handed the layout size 252 × 240 and asks for
    // drawImage(img, 0, 0, 252, 240, dest…) — i.e. "the whole picture"
    const { img } = makeImg(
      svgDataUrl('<svg width="100%" height="100%" viewBox="0 0 684 652"></svg>'),
      { w: 252, h: 240 }
    );
    const ctx = new FakeContext({ width: 400, height: 400 });
    const restore = installSizelessSvgImageGuard();
    try {
      (ctx as unknown as { drawImage: (...a: unknown[]) => void }).drawImage(
        img,
        0,
        0,
        252,
        240,
        10,
        20,
        252,
        240
      );
    } finally {
      restore();
    }
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = ctx.calls[0] as number[];
    expect([sx, sy]).toEqual([0, 0]);
    expect(Math.round(sw)).toBe(400);
    expect(Math.round(sh)).toBe(381);
    expect([dx, dy, dw, dh]).toEqual([10, 20, 252, 240]); // destination untouched
  });

  test('a raster image, a fixed-size svg and the short forms draw untouched', () => {
    const png = makeImg('data:image/png;base64,AAAA', { w: 50, h: 50 }).img;
    const fixed = makeImg(svgDataUrl('<svg width="20" height="20"></svg>'), { w: 20, h: 20 }).img;
    const sizeless = makeImg(svgDataUrl('<svg viewBox="0 0 10 10"></svg>'), { w: 50, h: 50 }).img;
    const ctx = new FakeContext({ width: 400, height: 400 });
    const draw = (...a: unknown[]) =>
      (ctx as unknown as { drawImage: (...a: unknown[]) => void }).drawImage(...a);
    const restore = installSizelessSvgImageGuard();
    try {
      draw(png, 0, 0, 8, 8, 0, 0, 50, 50);
      draw(fixed, 0, 0, 20, 20, 0, 0, 50, 50);
      draw(sizeless, 5, 6, 7, 8); // 5-argument form: the browser draws the whole picture itself
    } finally {
      restore();
    }
    expect(ctx.calls[0].slice(1)).toEqual([0, 0, 8, 8, 0, 0, 50, 50]);
    expect(ctx.calls[1].slice(1)).toEqual([0, 0, 20, 20, 0, 0, 50, 50]);
    expect(ctx.calls[2].slice(1)).toEqual([5, 6, 7, 8]);
  });

  test('restore() puts the original drawImage back', () => {
    const original = FakeContext.prototype.drawImage;
    const restore = installSizelessSvgImageGuard();
    expect(FakeContext.prototype.drawImage).not.toBe(original);
    restore();
    expect(FakeContext.prototype.drawImage).toBe(original);
  });
});

function transformedParent(style: string) {
  const root = document.createElement('div');
  root.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 640px; height: 360px');
  const parent = document.createElement('div');
  parent.setAttribute('style', style);
  const child = document.createElement('div');
  child.setAttribute('style', 'position: absolute; top: 20px; left: 10px');
  parent.appendChild(child);
  root.appendChild(parent);
  document.body.appendChild(root);
  return { root, parent, child };
}

describe('installTransformPinGuard', () => {
  test('a static transformed parent is pinned as relative when the renderer reads it', () => {
    const { parent } = transformedParent('transform: scale(1.2); margin-left: 330px');
    const restore = installTransformPinGuard();
    try {
      getComputedStyle(parent);
      expect(parent.style.position).toBe('relative');
      // the rest of the author's styling is untouched
      expect(parent.style.transform).toBe('scale(1.2)');
      expect(parent.style.marginLeft).toBe('330px');
    } finally {
      restore();
    }
  });

  test('scale, rotate and filter make a containing block too', () => {
    for (const style of ['scale: 2', 'rotate: 5deg', 'filter: blur(2px)']) {
      document.body.innerHTML = '';
      const { parent } = transformedParent(style);
      const restore = installTransformPinGuard();
      try {
        getComputedStyle(parent);
        expect(parent.style.position, style).toBe('relative');
      } finally {
        restore();
      }
    }
  });

  test('an element that is positioned, or has no transform, is left alone', () => {
    const positioned = transformedParent('position: relative; transform: scale(2)').parent;
    const plain = transformedParent('margin-left: 4px').parent;
    const restore = installTransformPinGuard();
    try {
      getComputedStyle(positioned);
      getComputedStyle(plain);
      expect(positioned.style.position).toBe('relative'); // its own, not a pin
      expect(plain.style.position).toBe('');
    } finally {
      restore();
    }
    expect(positioned.style.position).toBe('relative');
  });

  test('a static z-index and stray offsets stay inert after the pin', () => {
    const { parent } = transformedParent('transform: scale(2); z-index: 5; top: 12px; left: 3px');
    const restore = installTransformPinGuard();
    try {
      getComputedStyle(parent);
      expect(parent.style.position).toBe('relative');
      expect(parent.style.zIndex).toBe('auto');
      expect(parent.style.top).toBe('auto');
      expect(parent.style.left).toBe('auto');
    } finally {
      restore();
    }
    // restore gives the author's values back
    expect(parent.style.position).toBe('');
    expect(parent.style.zIndex).toBe('5');
    expect(parent.style.top).toBe('12px');
    expect(parent.style.left).toBe('3px');
  });

  test('the pin is dropped on a frame where the author no longer transforms the element', () => {
    const { parent } = transformedParent('transform: scale(2)');
    const restore = installTransformPinGuard();
    try {
      getComputedStyle(parent);
      expect(parent.style.position).toBe('relative');
      parent.style.removeProperty('transform'); // the next frame: no transform authored
      getComputedStyle(parent);
      expect(parent.style.position).toBe('');
    } finally {
      restore();
    }
  });

  test('a read in the middle of the renderer reset does not drop the pin', () => {
    const { parent } = transformedParent('transform: scale(2)');
    const restore = installTransformPinGuard();
    try {
      getComputedStyle(parent);
      // what makeTransformResetter leaves inline while it measures the subtree
      parent.style.transform = 'none';
      parent.style.scale = 'none';
      parent.style.rotate = 'none';
      getComputedStyle(parent);
      expect(parent.style.position).toBe('relative');
    } finally {
      restore();
    }
  });

  test('restore() removes live pins and puts getComputedStyle back', () => {
    const original = window.getComputedStyle;
    const { parent } = transformedParent('transform: scale(2)');
    const restore = installTransformPinGuard();
    getComputedStyle(parent);
    expect(window.getComputedStyle).not.toBe(original);
    restore();
    expect(window.getComputedStyle).toBe(original);
    expect(parent.style.position).toBe('');
  });
});

describe('renderVideo wires the pre-pass around renderMediaOnWeb', () => {
  test('both guards are live during the render and gone after it', async () => {
    const original = window.getComputedStyle;
    let during: { pinned: string; natural: number } | null = null;
    mock.module('@remotion/web-renderer', () => ({
      renderMediaOnWeb: async () => {
        const parent = document.querySelector('[data-t]') as HTMLElement;
        getComputedStyle(parent); // how the renderer reads a node, before it resets it
        const img = document.querySelector('img') as HTMLImageElement;
        during = { pinned: parent.style.position, natural: img.naturalWidth };
        return { getBlob: async () => new Blob([new Uint8Array([1])]) };
      },
    }));
    const { parent } = transformedParent('transform: scale(1.5)');
    parent.setAttribute('data-t', '1');
    makeImg(svgDataUrl('<svg viewBox="0 0 10 10"></svg>'), { w: 90, h: 80 });
    await import('../exporters/video-render-lib.ts');
    const g = globalThis as unknown as {
      __maudeRenderVideo__: (o: Record<string, unknown>) => Promise<{ bytes: number }>;
    };
    await g.__maudeRenderVideo__({
      component: () => null,
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 1,
      container: 'mp4',
      muted: true,
    });
    expect(during).toEqual({ pinned: 'relative', natural: 90 });
    expect(window.getComputedStyle).toBe(original);
    expect(parent.style.position).toBe('');
  });
});

describe('installCapturePrepass', () => {
  test('one restore undoes both guards', () => {
    const original = window.getComputedStyle;
    const nat = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth')?.get;
    const restore = installCapturePrepass();
    restore();
    expect(window.getComputedStyle).toBe(original);
    expect(Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth')?.get).toBe(
      nat
    );
  });
});
