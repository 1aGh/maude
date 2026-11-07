/**
 * @file       artboard-still-raster.ts — 2.0.7: draw a still picture of a mounted artboard body into a `<canvas>`
 * @scope      apps/studio/artboard-still-raster.ts (DOM + canvas 2D; used by artboard-still.ts via the live gate)
 * @purpose    WebKit has no way to turn DOM into a bitmap (no `element()`, and an SVG `<foreignObject>` image of a
 *             real artboard drew blank into a canvas in Safari, measured 2026-11-06). This draws the body from its
 *             own geometry, in document order: boxes (background, border, radius), pictures and canvases (drawn
 *             as they are), each inline `<svg>` (serialized on its own with the rules its classes use and the
 *             defs it references — an SVG image draws reliably) and text as lines in its colour. At the size it
 *             stands in (under ~200 screen px) that reads as the artboard.
 *
 *             In slices (`startStill`): the walk a few nodes at a time, then the pictures decode off the main
 *             thread, then the paint a few operations at a time — so a drawing fits in a pan's frames.
 *
 *             Read-only and bounded (`RASTER_MAX_NODES`). Same-origin pictures only (the canvas origin's assets):
 *             a picture that would taint the canvas is skipped, never fetched.
 */

import { STILL_MAX_SCREEN_PX } from './artboard-still.ts';

/** Walk at most this many nodes of one body. */
export const RASTER_MAX_NODES = 4000;
/** The still's width in device px: 1.5 × the threshold at the device pixel ratio (≤ 2) — sharp up to that zoom-in. */
export function stillWidthPx(dpr: number): number {
  return Math.ceil(STILL_MAX_SCREEN_PX * Math.min(2, Math.max(1, dpr || 1)) * 1.5);
}
/** And never taller than this (a long page artboard). */
export const RASTER_MAX_HEIGHT_PX = 1600;

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

/**
 * Collects a body's paint in document order, a few nodes at a time (`run(deadline)`), so one drawing never holds a
 * frame (2.0.7 follow-up: drawings happen during a pan too). Coordinates are in the body's own CSS px — the body's
 * rect and its screen scale are read again at every slice, so a pan or a zoom between two slices moves nothing.
 * The children must stay in the render tree from the first slice to the last (the caller's walk state).
 */
export class Collector {
  readonly ops: Op[] = [];
  walked = 0;
  /** the body's size in its own CSS px (read at every slice) */
  w = 0;
  h = 0;
  private stack: Node[] = [];
  private started = false;
  constructor(
    private readonly body: HTMLElement,
    /** the still's px per body px (svg pictures are serialized at the size they are drawn) */
    private readonly pxPerLocal: (w: number) => number,
    private readonly now: () => number = () => performance.now()
  ) {}

  get done(): boolean {
    return this.started && (!this.stack.length || this.walked >= RASTER_MAX_NODES);
  }

  /** Walk until `deadline` (a `now()` value) or the end. Returns false when the body has no size. */
  run(deadline = Number.POSITIVE_INFINITY): boolean {
    const body = this.body;
    const br = body.getBoundingClientRect();
    if (br.width < 1 || br.height < 1) return false;
    const k = br.width / (body.offsetWidth || br.width);
    this.w = br.width / k;
    this.h = br.height / k;
    const s = this.pxPerLocal(this.w);
    if (!this.started) {
      this.started = true;
      for (let i = body.childNodes.length - 1; i >= 0; i--)
        this.stack.push(body.childNodes[i] as Node);
    }
    const stack = this.stack;
    const ops = this.ops;
    let n = 0;
    while (stack.length && this.walked < RASTER_MAX_NODES) {
      if ((++n & 7) === 0 && this.now() >= deadline) break;
      const node = stack.pop() as Node;
      this.walked += 1;
      if (node.nodeType === 3) {
        const t = node.textContent;
        const el = node.parentElement;
        if (!t?.trim() || !el) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || clear(cs.color)) continue;
        const rg = document.createRange();
        rg.selectNodeContents(node);
        const fs = Number.parseFloat(cs.fontSize) || 12;
        const rects: Array<[number, number, number, number]> = [];
        for (const r of Array.from(rg.getClientRects())) {
          if (r.width < 0.2 * k) continue;
          const rh = r.height / k;
          const h = Math.max(0.6, Math.min(rh * 0.5, fs * 0.55));
          rects.push([(r.left - br.left) / k, (r.top - br.top) / k + (rh - h) / 2, r.width / k, h]);
        }
        if (rects.length) ops.push({ k: 'text', rects, color: cs.color, a: 0.6 });
        continue;
      }
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      const r = el.getBoundingClientRect();
      if (r.width < 0.3 * k || r.height < 0.3 * k) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const x = (r.left - br.left) / k;
      const y = (r.top - br.top) / k;
      const w = r.width / k;
      const h = r.height / k;
      const a = Math.max(0, Math.min(1, Number(cs.opacity) || 1));
      if (el instanceof SVGElement) {
        if (el.tagName.toLowerCase() === 'svg') {
          const pw = Math.max(1, Math.round(w * s));
          const ph = Math.max(1, Math.round(h * s));
          ops.push({ k: 'svg', src: svgSource(el as SVGSVGElement, pw, ph), x, y, w, h, a });
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
          w,
          h,
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
        // a picture still loading is drawn once it has (the drawing waits for it, bounded)
        if (!(im.complete && im.naturalWidth === 0)) ops.push({ k: 'draw', el: im, x, y, w, h, a });
        continue;
      }
      if (tag === 'CANVAS') {
        ops.push({ k: 'draw', el: el as HTMLCanvasElement, x, y, w, h, a });
        continue;
      }
      if (tag === 'VIDEO') {
        const v = el as HTMLVideoElement;
        if (v.readyState >= 2) ops.push({ k: 'draw', el: v, x, y, w, h, a });
        continue;
      }
      if (tag === 'IFRAME' || tag === 'SCRIPT' || tag === 'STYLE') continue;
      for (let i = el.childNodes.length - 1; i >= 0; i--) stack.push(el.childNodes[i] as Node);
    }
    return true;
  }
}

/** Collect the body's paint at once (in the body's own CSS px). Exported for tests. */
export function collectOps(body: HTMLElement): { ops: Op[]; walked: number } {
  const c = new Collector(body, (w) => stillWidthPx(dpr()) / (w || 1));
  c.run();
  return { ops: c.ops, walked: c.walked };
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

const dpr = () => (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);

/** The longest synchronous slice of each phase so far (ms) — diagnostics (`__maudeStillStats`). */
export const rasterTimings = { collectMax: 0, paintMax: 0, decodeWaitMax: 0 };

/**
 * How long a drawing waits for its pictures to load and decode (ms). Decoding happens off the main thread
 * (`HTMLImageElement.decode()`); a picture drawn cold decodes ON it — 6 ms median, 36 ms worst per picture on the
 * mascot canvas in Safari, against 1–2 ms once decoded (measured 2026-11-07). A picture not in by then is left out.
 */
export const RASTER_DECODE_WAIT_MS = 1500;

/** The body's children enter / leave the render tree for the walk (the controller's walk state). */
export interface WalkHooks {
  enter(): void;
  leave(): void;
}

/**
 * One still being drawn, in slices: `step(deadline)` works until `deadline` and returns `more` (call again next
 * frame), `wait` (pictures are decoding — call again once `ready` settles) or `done` (`result` holds the still, or
 * null). The walk state is on from the first collect slice to the last, never across the decode wait or the paint.
 */
export interface StillJob {
  step(deadline: number): 'more' | 'wait' | 'done';
  readonly ready: Promise<unknown> | null;
  readonly result: HTMLElement | null;
  /** which phase it is in (diagnostics, tests) */
  readonly phase: 'collect' | 'decode' | 'paint' | 'done';
  abort(): void;
}

function bounded(p: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}

/** Start drawing a still of a mounted artboard body. */
export function startStill(
  body: HTMLElement,
  walk: WalkHooks,
  now: () => number = () => performance.now()
): StillJob {
  const wPx = stillWidthPx(dpr());
  const collector = new Collector(body, (w) => wPx / (w || 1), now);
  let phase: StillJob['phase'] = 'collect';
  let ready: Promise<unknown> | null = null;
  let decoded = false;
  let result: HTMLCanvasElement | null = null;
  let cv: HTMLCanvasElement | null = null;
  let g: CanvasRenderingContext2D | null = null;
  let i = 0;
  let entered = false;
  let base = '';
  const leave = () => {
    if (entered) walk.leave();
    entered = false;
  };
  const finish = (r: HTMLCanvasElement | null) => {
    leave();
    result = r;
    phase = 'done';
    return 'done' as const;
  };
  const job: StillJob = {
    get ready() {
      return ready;
    },
    get result() {
      return result;
    },
    get phase() {
      return phase;
    },
    abort() {
      leave();
      phase = 'done';
    },
    step(deadline) {
      if (phase === 'collect') {
        if (!entered) {
          walk.enter();
          entered = true;
        }
        const t0 = now();
        const ok = collector.run(deadline);
        rasterTimings.collectMax = Math.max(rasterTimings.collectMax, now() - t0);
        if (!ok) return finish(null);
        if (!collector.done) return 'more';
        // the body's colour, else the frame's (the article's own background): never a transparent hole
        base = getComputedStyle(body).backgroundColor;
        if (clear(base) && body.parentElement)
          base = getComputedStyle(body.parentElement).backgroundColor;
        leave();
        phase = 'decode';
        const waits: Promise<unknown>[] = [];
        for (const op of collector.ops) {
          if (op.k === 'svg') {
            waits.push(
              loadSvg(op.src).then(async (im) => {
                op.img = im;
                if (im) await im.decode().catch(() => {});
              })
            );
          } else if (op.k === 'draw' && op.el instanceof HTMLImageElement) {
            waits.push(op.el.decode().catch(() => {}));
          }
        }
        const t1 = now();
        ready = bounded(Promise.all(waits), RASTER_DECODE_WAIT_MS).then(() => {
          decoded = true;
          rasterTimings.decodeWaitMax = Math.max(rasterTimings.decodeWaitMax, now() - t1);
        });
        if (waits.length) return 'wait';
        decoded = true;
        return job.step(deadline);
      }
      if (phase === 'decode') {
        if (!decoded) return 'wait';
        phase = 'paint';
        cv = document.createElement('canvas');
        cv.width = wPx;
        const lw = collector.w || 1;
        const lh = collector.h || 1;
        const s = wPx / lw;
        cv.height = Math.max(1, Math.min(RASTER_MAX_HEIGHT_PX, Math.round(lh * s)));
        g = cv.getContext('2d');
        if (!g) return finish(null);
        g.scale(s, cv.height / lh);
        if (!clear(base)) {
          g.fillStyle = base;
          g.fillRect(0, 0, lw, lh);
        }
      }
      if (phase === 'paint' && g && cv) {
        const t0 = now();
        const ops = collector.ops;
        while (i < ops.length) {
          if (i > 0 && (i & 3) === 0 && now() >= deadline) break;
          const op = ops[i++] as Op;
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
              const im = op.el as HTMLImageElement;
              if (!(im instanceof HTMLImageElement) || (im.complete && im.naturalWidth > 0))
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
        rasterTimings.paintMax = Math.max(rasterTimings.paintMax, now() - t0);
        if (i < ops.length) return 'more';
        g.globalAlpha = 1;
        return finish(cv);
      }
      return phase === 'done' ? 'done' : 'more';
    },
  };
  return job;
}

/**
 * Draw a still of a mounted artboard body at once (no slicing; the body must be in the render tree). Resolves to a
 * `<canvas>` (not yet in the document), or null when the body has no size.
 */
export async function drawStill(body: HTMLElement): Promise<HTMLCanvasElement | null> {
  const job = startStill(body, { enter() {}, leave() {} });
  for (let n = 0; n < 1000; n++) {
    const r = job.step(Number.POSITIVE_INFINITY);
    if (r === 'done') return job.result as HTMLCanvasElement | null;
    if (r === 'wait') await job.ready;
  }
  return null;
}
