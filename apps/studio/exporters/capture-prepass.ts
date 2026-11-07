// capture-prepass.ts — issue #150 §2 + §3: two things @remotion/web-renderer gets
// wrong that the browser gets right, fixed in the capture page for the length of
// one render (same install / restore shape as svg-inline.ts, so the library stays
// unpatched — no per-workspace patchedDependencies entry, DDR-176 — and a
// renderer upgrade that fixes either one itself just makes the guard a no-op).
//
// §2  An `<img>` of an SVG that has no size of its own (`width="100%"`, or only a
//     `viewBox` — what Affinity / Illustrator write) has no usable
//     `naturalWidth`/`naturalHeight`. The renderer draws an image with
//     `drawImage(img, 0, 0, naturalWidth, naturalHeight, …)`: with 0 that draws
//     nothing (the report); with Chromium's 300 × 150 default-object-size
//     stand-in (157 × 150 for a 684 × 652 viewBox) it draws the TOP-LEFT part of
//     the picture, scaled up (measured live) — because a size-less SVG that is
//     the source of `drawImage` is rasterized at the size of the CANVAS it is
//     drawn into, not at its natural size nor at its layout size. The guard
//     reports the layout size where the browser reports 0, and rescales the
//     source rectangle from the natural size to the real draw space.
//
// §3  `transform` (and `scale`, `rotate`, `filter`) makes a NON-positioned element
//     the containing block of its `position: absolute` children. The renderer
//     resets those properties on an element while it measures the element's
//     subtree, so the children resolve against the next positioned ancestor — the
//     whole frame — and jump out of the element. While an element in that state
//     is read, it is pinned as `position: relative` (offsets `auto`, so nothing
//     moves): a containing block that does not depend on the property the
//     renderer is about to reset.
//
// Browser-safe and React-free; imported by `video-render-lib.ts` (runs inside the
// capture Chromium) and unit-tested under happy-dom.

// ---------------------------------------------------------------------------
// §2 — size-less SVG <img>
// ---------------------------------------------------------------------------

/** `12`, `12.5px`, `3em` … — a length, as opposed to `100%`, `auto` or nothing. */
const ABSOLUTE_LENGTH = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[a-z]{1,4})?\s*$/i;

function rootTag(text: string): string | null {
  const m = /<svg(?=[\s>/])[^>]*>/i.exec(text.replace(/<!--[\s\S]*?-->/g, ''));
  return m ? m[0] : null;
}

function rootAttr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

/**
 * Does this SVG document have NO size of its own? Reads the root start tag only.
 * An SVG has natural dimensions when both `width` and `height` are lengths, or
 * when one is and a `viewBox` supplies the ratio; anything else (`100%`, `auto`,
 * absent) is sized by whoever embeds it. Not an SVG at all → false.
 */
export function svgRootIsSizeless(text: string): boolean {
  const tag = rootTag(text);
  if (!tag) return false;
  const w = rootAttr(tag, 'width');
  const h = rootAttr(tag, 'height');
  const hasW = w !== null && ABSOLUTE_LENGTH.test(w);
  const hasH = h !== null && ABSOLUTE_LENGTH.test(h);
  if (hasW && hasH) return false;
  if ((hasW || hasH) && rootAttr(tag, 'viewBox') !== null) return false;
  return true;
}

/** width / height of the root's `viewBox`, or null when there is none (or it is degenerate). */
export function svgViewBoxRatio(text: string): number | null {
  const tag = rootTag(text);
  const vb = tag ? rootAttr(tag, 'viewBox') : null;
  if (vb === null) return null;
  const n = vb
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return n.length === 4 && n[2] > 0 && n[3] > 0 && n.every(Number.isFinite) ? n[2] / n[3] : null;
}

/**
 * The size Chromium rasterizes a size-less SVG at when it is the SOURCE of
 * `drawImage`: the canvas it is drawn into, contain-fitted to the viewBox ratio
 * (the whole canvas without a viewBox). Measured live (canvas 400 × 400, viewBox
 * 684 × 652 → 400 × 381; canvas 640 × 360 → 378 × 360) — and it does NOT depend
 * on how large the `<img>` is laid out, which is why the renderer's
 * natural-size-based source rectangle crops the picture.
 */
export function sizelessSvgDrawSpace(
  canvas: { width: number; height: number },
  ratio: number | null
): { w: number; h: number } {
  if (!ratio) return { w: canvas.width, h: canvas.height };
  const byWidth = { w: canvas.width, h: canvas.width / ratio };
  return byWidth.h <= canvas.height ? byWidth : { w: canvas.height * ratio, h: canvas.height };
}

function decodeSvgDataUrl(url: string): string | null {
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const head = url.slice(0, comma);
  const body = url.slice(comma + 1);
  try {
    return /;base64/i.test(head) ? atob(body) : decodeURIComponent(body);
  } catch {
    return null;
  }
}

/** The SVG's source text, or null when it cannot be read (then the image is left alone). */
function readSvgText(url: string): string | null {
  if (/^data:image\/svg\+xml/i.test(url)) return decodeSvgDataUrl(url);
  try {
    // Synchronous on purpose: the renderer asks for `naturalWidth` in the middle of a draw call
    // and cannot await. Same-origin / blob / loopback only (the capture CSP's connect-src), once
    // per URL (`infoCache`).
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    return xhr.status === 200 || (xhr.status === 0 && xhr.responseText) ? xhr.responseText : null;
  } catch {
    return null;
  }
}

const SVG_URL = /\.svg(?:[?#]|$)|^data:image\/svg\+xml/i;

function layoutSize(img: HTMLImageElement, which: 'width' | 'height'): number {
  // The content box: what the browser rasterizes an SVG image at. `clientWidth` is
  // transform-independent (the renderer resets the transform anyway) and excludes borders.
  const client = which === 'width' ? img.clientWidth : img.clientHeight;
  if (!client) return 0;
  let pad = 0;
  try {
    const cs = getComputedStyle(img);
    pad =
      which === 'width'
        ? (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
        : (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0);
  } catch {
    /* no computed style: padding is rare on an image */
  }
  return Math.max(0, client - pad);
}

type DrawImageFn = (this: unknown, image: unknown, ...rest: number[]) => void;

/**
 * Make a size-less SVG `<img>` draw the way the browser shows it, for as long as
 * the guard is installed:
 *  • `naturalWidth` / `naturalHeight` that the browser reports as 0 report the
 *    layout size instead (with 0 the renderer draws nothing at all);
 *  • the 9-argument `drawImage` the renderer issues has its SOURCE rectangle
 *    rescaled from the natural size it was computed from to the size the picture
 *    is really rasterized at (`sizelessSvgDrawSpace`), so the whole picture lands
 *    in the destination instead of its top-left corner.
 * Every other image — a PNG, an SVG with a real size, one not laid out — answers
 * and draws exactly as before. Returns the restore function; call it in a `finally`.
 */
export function installSizelessSvgImageGuard(): () => void {
  const proto = HTMLImageElement.prototype;
  const widthDesc = Object.getOwnPropertyDescriptor(proto, 'naturalWidth');
  const heightDesc = Object.getOwnPropertyDescriptor(proto, 'naturalHeight');
  if (!widthDesc?.get || !heightDesc?.get) return () => {};
  const realWidth = widthDesc.get;
  const realHeight = heightDesc.get;
  const infoCache = new Map<string, { sizeless: boolean; ratio: number | null }>();

  const infoFor = (img: HTMLImageElement): { sizeless: boolean; ratio: number | null } | null => {
    const url = img.currentSrc || img.src;
    if (!url || !img.complete) return null;
    let info = infoCache.get(url);
    if (!info) {
      info = { sizeless: false, ratio: null };
      // A raster image is never asked: only SVG-looking URLs, or an image the browser itself
      // reports as having no size at all.
      if (SVG_URL.test(url) || realWidth.call(img) === 0) {
        const text = readSvgText(url);
        if (text !== null && svgRootIsSizeless(text)) {
          info = { sizeless: true, ratio: svgViewBoxRatio(text) };
        }
      }
      infoCache.set(url, info);
    }
    return info.sizeless ? info : null;
  };

  const natural = (img: HTMLImageElement, which: 'width' | 'height'): number => {
    const real = (which === 'width' ? realWidth : realHeight).call(img) as number;
    if (real > 0 || !infoFor(img)) return real;
    const laid = layoutSize(img, which);
    return laid > 0 ? laid : real;
  };

  Object.defineProperty(proto, 'naturalWidth', {
    ...widthDesc,
    get(this: HTMLImageElement) {
      return natural(this, 'width');
    },
  });
  Object.defineProperty(proto, 'naturalHeight', {
    ...heightDesc,
    get(this: HTMLImageElement) {
      return natural(this, 'height');
    },
  });

  const restores: Array<() => void> = [];
  for (const name of ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D']) {
    const ctor = (globalThis as unknown as Record<string, { prototype: Record<string, unknown> }>)[
      name
    ];
    const original = ctor?.prototype?.drawImage as DrawImageFn | undefined;
    if (!original) continue;
    ctor.prototype.drawImage = function guardedDrawImage(
      this: { canvas?: { width: number; height: number } },
      image: unknown,
      ...rest: number[]
    ) {
      if (rest.length === 8 && image instanceof HTMLImageElement && this.canvas) {
        const info = infoFor(image);
        const nw = info ? natural(image, 'width') : 0;
        const nh = info ? natural(image, 'height') : 0;
        if (info && nw > 0 && nh > 0) {
          const space = sizelessSvgDrawSpace(this.canvas, info.ratio);
          const kx = space.w / nw;
          const ky = space.h / nh;
          const [sx, sy, sw, sh, ...dest] = rest;
          return original.call(this, image, sx * kx, sy * ky, sw * kx, sh * ky, ...dest);
        }
      }
      return original.call(this, image, ...rest);
    };
    restores.push(() => {
      ctor.prototype.drawImage = original;
    });
  }

  return () => {
    for (const restore of restores) restore();
    Object.defineProperty(proto, 'naturalWidth', widthDesc);
    Object.defineProperty(proto, 'naturalHeight', heightDesc);
  };
}

// ---------------------------------------------------------------------------
// §3 — transformed static parents with absolute children
// ---------------------------------------------------------------------------

/** Longhands the renderer resets on an element while it measures the subtree. */
const INSET_PROPS = ['top', 'right', 'bottom', 'left'] as const;

interface Pin {
  position: string;
  positionPriority: string;
  zIndex: string;
  zIndexPriority: string;
  insets: Array<[string, string, string]>;
  /** What made the element a containing block — decides what "mid-reset" looks like. */
  by: Array<'transform' | 'filter'>;
}

const NONE = new Set(['', 'none', 'initial']);
const set = (cs: CSSStyleDeclaration, prop: string): boolean =>
  !NONE.has(cs.getPropertyValue(prop));

function causes(cs: CSSStyleDeclaration): Array<'transform' | 'filter'> {
  const by: Array<'transform' | 'filter'> = [];
  if (set(cs, 'transform') || set(cs, 'scale') || set(cs, 'rotate')) by.push('transform');
  if (set(cs, 'filter')) by.push('filter');
  return by;
}

/** The renderer's own reset leaves these inline values behind (see `makeTransformResetter`). */
function midReset(el: HTMLElement, by: Pin['by']): boolean {
  const s = el.style;
  return by.some((b) =>
    b === 'transform'
      ? s.transform === 'none' && s.scale === 'none' && s.rotate === 'none'
      : s.filter === 'none'
  );
}

/**
 * While installed, an element that is `position: static` yet carries a `transform`
 * / `scale` / `rotate` / `filter` is pinned as `position: relative` the moment it
 * is read through `getComputedStyle` — which is how the renderer reads every node
 * and ancestor, before it resets the property. The pin is dropped again when the
 * author's own styling no longer makes the element a containing block (a frame
 * where the transform is `none`), so a later frame still matches the browser.
 * Returns the restore function — it also undoes every live pin.
 */
export function installTransformPinGuard(): () => void {
  const original = window.getComputedStyle;
  const pins = new Map<HTMLElement, Pin>();

  const unpin = (el: HTMLElement, pin: Pin): void => {
    const s = el.style;
    s.removeProperty('position');
    if (pin.position) s.setProperty('position', pin.position, pin.positionPriority);
    s.removeProperty('z-index');
    if (pin.zIndex) s.setProperty('z-index', pin.zIndex, pin.zIndexPriority);
    for (const [prop, value, priority] of pin.insets) {
      s.removeProperty(prop);
      if (value) s.setProperty(prop, value, priority);
    }
    pins.delete(el);
  };

  const sync = (el: HTMLElement, cs: CSSStyleDeclaration): void => {
    const pin = pins.get(el);
    const by = causes(cs);
    if (pin) {
      if (by.length === 0 && !midReset(el, pin.by)) unpin(el, pin);
      return;
    }
    if (by.length === 0) return;
    if (cs.position && cs.position !== 'static') return;
    if (cs.display === 'inline' || cs.display === 'contents' || cs.display === 'none') return;
    const s = el.style;
    const record: Pin = {
      position: s.getPropertyValue('position'),
      positionPriority: s.getPropertyPriority('position'),
      zIndex: s.getPropertyValue('z-index'),
      zIndexPriority: s.getPropertyPriority('z-index'),
      insets: [],
      by,
    };
    // A static element ignores z-index and offsets; a relative one would not. Neutralize both so
    // the pin changes the containing block and nothing else (a flex / grid item already honours
    // z-index, so that one is left alone).
    const parent = el.parentElement;
    const parentDisplay = parent ? original.call(window, parent).display : '';
    const itemOfFlexOrGrid = /flex|grid/.test(parentDisplay);
    if (!itemOfFlexOrGrid && cs.zIndex && cs.zIndex !== 'auto') s.setProperty('z-index', 'auto');
    for (const prop of INSET_PROPS) {
      const value = cs.getPropertyValue(prop);
      if (value && value !== 'auto') {
        record.insets.push([prop, s.getPropertyValue(prop), s.getPropertyPriority(prop)]);
        s.setProperty(prop, 'auto');
      }
    }
    s.setProperty('position', 'relative');
    pins.set(el, record);
  };

  window.getComputedStyle = function guardedGetComputedStyle(
    this: Window,
    el: Element,
    pseudo?: string | null
  ): CSSStyleDeclaration {
    const cs = original.call(window, el, pseudo);
    if (!pseudo && el instanceof HTMLElement) {
      try {
        sync(el, cs);
      } catch {
        /* a guard must never break the render it protects */
      }
    }
    return cs;
  } as typeof window.getComputedStyle;

  return () => {
    window.getComputedStyle = original;
    for (const [el, pin] of [...pins]) unpin(el, pin);
  };
}

/** Both pre-pass guards for one render. Returns the restore function. */
export function installCapturePrepass(): () => void {
  const restoreImages = installSizelessSvgImageGuard();
  const restorePins = installTransformPinGuard();
  return () => {
    restorePins();
    restoreImages();
  };
}
