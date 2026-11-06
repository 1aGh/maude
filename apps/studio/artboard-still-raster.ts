/**
 * @file       artboard-still-raster.ts — 2.0.7: draw a still picture of a mounted artboard body into a `<canvas>`
 * @scope      apps/studio/artboard-still-raster.ts (DOM + canvas 2D; used by artboard-still.ts via the live gate)
 * @purpose    WebKit has no way to turn DOM into a bitmap (no `element()`, and an SVG `<foreignObject>` image of a
 *             real artboard drew blank into a canvas in Safari, measured 2026-11-06). This draws the body from its
 *             own geometry, in document order: boxes (background, border, radius), pictures and canvases (drawn
 *             as they are), each inline `<svg>` (serialized on its own with the rules its classes use and the
 *             defs it references — an SVG image draws reliably) and text as lines in its colour. At the size it
 *             stands in (under ~200 screen px) that reads as the artboard; it is only shown during a zoom.
 *
 *             Read-only and bounded (`RASTER_MAX_NODES`). Same-origin pictures only (the canvas origin's assets):
 *             a picture that would taint the canvas is skipped, never fetched.
 */

import { STILL_MAX_SCREEN_PX } from './artboard-still.ts';

/** Walk at most this many nodes of one body. */
export const RASTER_MAX_NODES = 4000;
/** The still's width in device px: the threshold at the device pixel ratio, with a margin for a zoom-in. */
export function stillWidthPx(dpr: number): number {
  return Math.min(640, Math.ceil(STILL_MAX_SCREEN_PX * Math.max(1, dpr || 1) * 1.25));
}
/** And never taller than this (a long page artboard). */
export const RASTER_MAX_HEIGHT_PX = 2048;

const clear = (c: string | null | undefined): boolean =>
  !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);

type Op =
  | {
      k: 'box';
      x: number;
      y: number;
      w: number;
      h: number;
      r: number;
      bg: string;
      bw: number;
      bc: string;
      a: number;
    }
  | { k: 'draw'; el: CanvasImageSource; x: number; y: number; w: number; h: number; a: number }
  | {
      k: 'svg';
      src: string;
      x: number;
      y: number;
      w: number;
      h: number;
      a: number;
      img?: HTMLImageElement | null;
    }
  | { k: 'text'; rects: Array<[number, number, number, number]>; color: string; a: number };

let rulesCache: { at: number; rules: CSSStyleRule[] } | null = null;

function styleRules(doc: Document): CSSStyleRule[] {
  // the stylesheets of a canvas document change rarely; re-read them at most every few seconds
  const now = Date.now();
  if (rulesCache && now - rulesCache.at < 5000) return rulesCache.rules;
  const rules: CSSStyleRule[] = [];
  for (const sh of Array.from(doc.styleSheets)) {
    let list: CSSRuleList | null = null;
    try {
      list = sh.cssRules;
    } catch {
      list = null; // a cross-origin sheet (web fonts)
    }
    if (!list) continue;
    for (const r of Array.from(list))
      if ((r as CSSStyleRule).selectorText) rules.push(r as CSSStyleRule);
  }
  rulesCache = { at: now, rules };
  return rules;
}

/** The rules an SVG's classes use (its own `<style>` children serialize with it). */
function cssFor(svg: Element): string {
  const cls = new Set<string>();
  for (const e of [svg, ...Array.from(svg.querySelectorAll('[class]'))])
    for (const c of (e.getAttribute('class') || '').split(/\s+/)) if (c) cls.add(c);
  if (!cls.size) return '';
  let out = '';
  for (const r of styleRules(svg.ownerDocument)) {
    const s = r.selectorText;
    for (const c of cls)
      if (s.includes(`.${c}`)) {
        out += `${r.cssText}\n`;
        break;
      }
  }
  return out;
}

const URL_REF = /url\(["']?#([^)"']+)["']?\)/g;

/** Gradients, patterns, filters, symbols an SVG references from outside itself. */
function defsFor(svg: Element): string {
  const ids = new Set<string>();
  for (const e of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const at of ['fill', 'stroke', 'filter', 'mask', 'clip-path', 'style']) {
      const v = e.getAttribute(at);
      if (v) for (const m of v.matchAll(URL_REF)) ids.add(m[1] as string);
    }
    const h = e.getAttribute('href') || e.getAttribute('xlink:href');
    if (h && h[0] === '#') ids.add(h.slice(1));
  }
  const ser = new XMLSerializer();
  let out = '';
  for (const id of ids) {
    const d = svg.ownerDocument.getElementById(id);
    if (d && !svg.contains(d)) out += ser.serializeToString(d);
  }
  return out;
}

function escCss(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function svgSource(svg: SVGSVGElement, w: number, h: number): string {
  const cl = svg.cloneNode(true) as SVGSVGElement;
  cl.setAttribute('width', String(w));
  cl.setAttribute('height', String(h));
  cl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const color = getComputedStyle(svg).color;
  const extra = `<style>svg{color:${color}}${escCss(cssFor(svg))}</style><defs>${defsFor(svg)}</defs>`;
  return new XMLSerializer().serializeToString(cl).replace(/^<svg([^>]*)>/, (m) => m + extra);
}

function loadSvg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }));
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      resolve(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    im.src = url;
  });
}

/** Collect the body's paint, in document order. Exported for tests. */
export function collectOps(body: HTMLElement): { ops: Op[]; walked: number } {
  const br = body.getBoundingClientRect();
  const ops: Op[] = [];
  let walked = 0;
  const stack: Node[] = [];
  for (let i = body.childNodes.length - 1; i >= 0; i--) stack.push(body.childNodes[i] as Node);
  while (stack.length && walked < RASTER_MAX_NODES) {
    const node = stack.pop() as Node;
    walked += 1;
    if (node.nodeType === 3) {
      const t = node.textContent;
      const el = node.parentElement;
      if (!t?.trim() || !el) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || clear(cs.color)) continue;
      const rg = document.createRange();
      rg.selectNodeContents(node);
      const fs = Number.parseFloat(cs.fontSize) || 12;
      const scale = br.width / (body.offsetWidth || br.width || 1);
      const rects: Array<[number, number, number, number]> = [];
      for (const r of Array.from(rg.getClientRects())) {
        if (r.width < 0.2) continue;
        const h = Math.max(0.6, Math.min(r.height * 0.5, fs * scale * 0.55));
        rects.push([r.left - br.left, r.top - br.top + (r.height - h) / 2, r.width, h]);
      }
      if (rects.length) ops.push({ k: 'text', rects, color: cs.color, a: 0.6 });
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const r = el.getBoundingClientRect();
    if (r.width < 0.3 || r.height < 0.3) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const x = r.left - br.left;
    const y = r.top - br.top;
    const a = Math.max(0, Math.min(1, Number(cs.opacity) || 1));
    if (el instanceof SVGElement) {
      if (el.tagName.toLowerCase() === 'svg') {
        ops.push({
          k: 'svg',
          src: svgSource(el as SVGSVGElement, r.width, r.height),
          x,
          y,
          w: r.width,
          h: r.height,
          a,
        });
      }
      continue; // an svg's children are drawn by its serialization
    }
    const bg = cs.backgroundColor;
    const bw = Number.parseFloat(cs.borderTopWidth) || 0;
    const bc = cs.borderTopColor;
    if (!clear(bg) || (bw > 0 && !clear(bc))) {
      const rad = Number.parseFloat(cs.borderTopLeftRadius) || 0;
      ops.push({
        k: 'box',
        x,
        y,
        w: r.width,
        h: r.height,
        r: rad,
        bg: clear(bg) ? '' : bg,
        bw: clear(bc) ? 0 : bw,
        bc,
        a,
      });
    }
    const tag = el.tagName;
    if (tag === 'IMG') {
      const im = el as HTMLImageElement;
      if (im.complete && im.naturalWidth > 0)
        ops.push({ k: 'draw', el: im, x, y, w: r.width, h: r.height, a });
      continue;
    }
    if (tag === 'CANVAS') {
      ops.push({ k: 'draw', el: el as HTMLCanvasElement, x, y, w: r.width, h: r.height, a });
      continue;
    }
    if (tag === 'VIDEO') {
      const v = el as HTMLVideoElement;
      if (v.readyState >= 2) ops.push({ k: 'draw', el: v, x, y, w: r.width, h: r.height, a });
      continue;
    }
    if (tag === 'IFRAME' || tag === 'SCRIPT' || tag === 'STYLE') continue;
    for (let i = el.childNodes.length - 1; i >= 0; i--) stack.push(el.childNodes[i] as Node);
  }
  return { ops, walked };
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, rr);
  else g.rect(x, y, w, h);
}

/**
 * Draw a still of a mounted artboard body. Resolves to a `<canvas>` (not yet in the document), or null when
 * the body has no size. The coordinates are the body's on-screen ones; the canvas is sized `stillWidthPx`.
 */
export async function drawStill(body: HTMLElement): Promise<HTMLCanvasElement | null> {
  const br = body.getBoundingClientRect();
  if (br.width < 1 || br.height < 1) return null;
  const { ops } = collectOps(body);
  await Promise.all(
    ops.map(async (op) => {
      if (op.k === 'svg') op.img = await loadSvg(op.src);
    })
  );
  const wPx = stillWidthPx(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  const s = wPx / br.width;
  const cv = document.createElement('canvas');
  cv.width = wPx;
  cv.height = Math.max(1, Math.min(RASTER_MAX_HEIGHT_PX, Math.round(br.height * s)));
  const g = cv.getContext('2d');
  if (!g) return null;
  g.scale(s, cv.height / br.height);
  // the body's colour, else the frame's (the article's own background): never a transparent hole
  let base = getComputedStyle(body).backgroundColor;
  if (clear(base) && body.parentElement)
    base = getComputedStyle(body.parentElement).backgroundColor;
  if (!clear(base)) {
    g.fillStyle = base;
    g.fillRect(0, 0, br.width, br.height);
  }
  for (const op of ops) {
    g.globalAlpha = op.a;
    try {
      if (op.k === 'box') {
        roundRect(g, op.x, op.y, op.w, op.h, op.r);
        if (op.bg) {
          g.fillStyle = op.bg;
          g.fill();
        }
        if (op.bw > 0) {
          g.strokeStyle = op.bc;
          g.lineWidth = op.bw;
          g.stroke();
        }
      } else if (op.k === 'draw') {
        g.drawImage(op.el, op.x, op.y, op.w, op.h);
      } else if (op.k === 'svg') {
        if (op.img) g.drawImage(op.img, op.x, op.y, op.w, op.h);
      } else {
        g.fillStyle = op.color;
        for (const [x, y, w, h] of op.rects) g.fillRect(x, y, w, h);
      }
    } catch {
      // a picture that cannot be drawn is left out
    }
  }
  g.globalAlpha = 1;
  return cv;
}
