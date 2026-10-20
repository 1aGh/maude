// exporters/print-preflight.ts — S8.7: what the Export sheet checks BEFORE a Print PDF is made (09 Export ›
// ex-print, ex-print-warn). Three answers, none of which blocks the export ("Warnings inform; Export still
// exports"):
//
//   paper       the trim, bleed and safe margin of each print artboard the spec reaches (from the artboard's
//               own `print` prop, so the preview's paper follows Bleed and the real numbers);
//   back        which artboard "Add the back" would add as page 2 (exporters/print-back.ts), or none;
//   safeMargin  elements that sit inside the cut but closer to it than the safe margin ("the QR code is 2 mm
//               from the cut — past the 5 mm safe margin"), measured from the canvas-rects geometry — the
//               same WORLD-coordinate manifest `maude design canvas-rects` returns, so what the sheet warns
//               about is what the person sees on the canvas. An element that runs past the cut (a
//               background, a full-bleed picture) is bleed art, not a violation;
//   fonts       the font files the canvas declares (`@font-face`) and uses, each with whether it will embed
//               (pdf-fonts.ts `fontFileReport`). The sheet words it: "can't be embedded — the text prints as
//               shapes (same look)". Text as outlines (Advanced › Print PDF) makes every font safe.
//
// Reads only inside the design root (a `@font-face` url that escapes it, points at another host or is not a
// font file is ignored — the canvas is untrusted, DDR-054). Pure beyond those reads; the geometry source is
// injected, so a test hands it a manifest and the route hands it a headless render.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { readArtboardPrintProp } from '../canvas-edit.ts';
import { resolveCustomPrintArtboard } from '../kinds/print-custom.ts';
import { CSS_DPI, MM_PER_INCH } from '../print/units.ts';
import { type FontFileReason, fontFileReport } from './pdf-fonts.ts';
import { type BoardLite, findBack } from './print-back.ts';

const PX_PER_MM = CSS_DPI / MM_PER_INCH;

// ── geometry in ──────────────────────────────────────────────────────────────────────────────────
/** The slice of `window.__maudeCanvasRects()` the check reads (canvas-lib.tsx `CanvasRectsManifest`). */
export interface RectsManifest {
  artboards: Array<{ id: string; x: number; y: number; w: number; h: number }>;
  elements: Array<{
    cdId: string | null;
    artboard: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
    tag?: string;
    text?: string;
  }>;
}

export interface PaperInfo {
  /** the paper's name ("A6") — null for a custom size, whose nearest preset would be a wrong name */
  name: string | null;
  /** trim (the cut), mm */
  trimMm: [number, number];
  bleedMm: number;
  /** safe margin per side, mm: top, right, bottom, left */
  marginMm: [number, number, number, number];
}

export type Edge = 'top' | 'right' | 'bottom' | 'left';

export interface SafeMarginFinding {
  artboard: string;
  /** the V2-1.4 element id, when it has one (Show on canvas selects it) */
  element: string | null;
  /** what the person calls it: its text, else its id, else its tag */
  label: string;
  edge: Edge;
  /** how far inside the cut it sits, mm (0.1 resolution) */
  mm: number;
  /** the safe margin it breaks, mm */
  marginMm: number;
  /** where it sits on the paper, mm from the trim's top-left corner (the preview rings it) */
  box: { x: number; y: number; w: number; h: number };
}

export interface PreflightFont {
  family: string;
  /** designRoot-relative path of the font file */
  file: string;
  embeddable: boolean;
  reason: FontFileReason | null;
}

export interface PreflightBoard {
  canvas: string;
  id: string;
  label: string | null;
  paper: PaperInfo | null;
  back: { id: string; label: string | null } | null;
}

export interface PreflightReply {
  /** the spec reaches at least one print artboard */
  print: boolean;
  /** one entry per print artboard the spec reaches, in order */
  boards: PreflightBoard[];
  safeMargin: SafeMarginFinding[];
  /** false when no geometry was available (no render could run): the sheet shows no safe-margin line either way */
  measured: boolean;
  fonts: PreflightFont[];
  /** the one colour line is a constant: print is RGB, the shop converts (09 ex-print) */
  colour: 'rgb';
}

export interface PreflightTarget {
  /** designRoot-relative canvas */
  canvas: string;
  board: BoardLite;
  /** every artboard of that canvas (the back is found among them) */
  all: readonly BoardLite[];
}

// ── paper ────────────────────────────────────────────────────────────────────────────────────────
export function paperOf(print: Record<string, unknown> | null): PaperInfo | null {
  if (!print || typeof print.paper !== 'string') return null;
  try {
    const r = resolveCustomPrintArtboard(print as never);
    const custom = Array.isArray(print.sizeMm);
    return {
      name: custom ? null : String(r.paper).toUpperCase(),
      trimMm: [r.trimWidthMm, r.trimHeightMm],
      bleedMm: r.bleedMm,
      marginMm: [r.marginsMm.top, r.marginsMm.right, r.marginsMm.bottom, r.marginsMm.left],
    };
  } catch {
    return null;
  }
}

// ── safe margin ──────────────────────────────────────────────────────────────────────────────────
const round1 = (n: number) => Math.round(n * 10) / 10;
const MAX_FINDINGS = 12;
/** An element covering this much of the trim box is a page, not content near the cut. */
const WRAPPER_SHARE = 0.8;

export function safeMarginFindings(
  artboardId: string,
  paper: PaperInfo,
  rects: RectsManifest
): SafeMarginFinding[] {
  const ab = rects.artboards.find((a) => a.id === artboardId);
  if (!ab) return [];
  const bleed = paper.bleedMm * PX_PER_MM;
  const left = bleed;
  const top = bleed;
  const right = ab.w - bleed;
  const bottom = ab.h - bleed;
  const trimW = right - left;
  const trimH = bottom - top;
  if (!(trimW > 0 && trimH > 0)) return [];
  const [mTop, mRight, mBottom, mLeft] = paper.marginMm;
  const out: SafeMarginFinding[] = [];
  for (const el of rects.elements) {
    if (el.artboard !== artboardId || !(el.w > 0 && el.h > 0)) continue;
    const x0 = el.x - ab.x;
    const y0 = el.y - ab.y;
    const x1 = x0 + el.w;
    const y1 = y0 + el.h;
    // it reaches the cut or beyond it: bleed art (a background, a picture to the edge), not a violation
    if (x0 < left || y0 < top || x1 > right || y1 > bottom) continue;
    if (el.w >= trimW * WRAPPER_SHARE && el.h >= trimH * WRAPPER_SHARE) continue;
    const gaps: Array<[Edge, number, number]> = [
      ['left', (x0 - left) / PX_PER_MM, mLeft],
      ['top', (y0 - top) / PX_PER_MM, mTop],
      ['right', (right - x1) / PX_PER_MM, mRight],
      ['bottom', (bottom - y1) / PX_PER_MM, mBottom],
    ];
    const worst = gaps.filter(([, mm, margin]) => mm < margin).sort((a, b) => a[1] - b[1])[0];
    if (!worst) continue;
    const text = (el.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    out.push({
      artboard: artboardId,
      element: el.cdId,
      label: text || el.cdId || el.tag || 'element',
      edge: worst[0],
      mm: round1(Math.max(0, worst[1])),
      marginMm: worst[2],
      box: {
        x: round1((x0 - left) / PX_PER_MM),
        y: round1((y0 - top) / PX_PER_MM),
        w: round1(el.w / PX_PER_MM),
        h: round1(el.h / PX_PER_MM),
      },
    });
  }
  return out.sort((a, b) => a.mm - b.mm).slice(0, MAX_FINDINGS);
}

// ── fonts ────────────────────────────────────────────────────────────────────────────────────────
const MAX_CSS_BYTES = 512 * 1024;
const MAX_FONT_BYTES = 20 * 1024 * 1024;
const MAX_CSS_FILES = 40;
const FONT_EXT = /\.(otf|ttf|ttc|woff2?)$/i;
const FACE_RE = /@font-face\s*{([^}]*)}/gi;

interface Face {
  family: string;
  url: string;
  cssDir: string;
}

function readText(abs: string, max: number): string | null {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > max) return null;
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Every `.css` under `<designRoot>/system` (three levels deep, a bounded count). */
function systemCss(designRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || out.length >= MAX_CSS_FILES) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_CSS_FILES) return;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, depth + 1);
      else if (e.isFile() && e.name.endsWith('.css')) out.push(abs);
    }
  };
  walk(path.join(designRoot, 'system'), 1);
  return out;
}

function facesIn(css: string, cssDir: string): { faces: Face[]; rest: string } {
  const faces: Face[] = [];
  const rest = css.replace(FACE_RE, (_all, body: string) => {
    const family = /font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;]+))/i.exec(body);
    const name = (family?.[1] ?? family?.[2] ?? family?.[3] ?? '').trim();
    const url = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)/i.exec(body);
    const src = url?.[1] ?? url?.[2] ?? url?.[3];
    if (name && src) faces.push({ family: name, url: src, cssDir });
    return '';
  });
  return { faces, rest };
}

/** The font files the canvas declares and uses, with whether each will embed. */
export function collectFonts(designRoot: string, canvasRel: string): PreflightFont[] {
  let root: string;
  try {
    root = realpathSync(designRoot);
  } catch {
    return [];
  }
  const canvasAbs = path.join(designRoot, canvasRel);
  const source = readText(canvasAbs, 4 * 1024 * 1024) ?? '';
  const cssFiles = [canvasAbs.replace(/\.tsx$/i, '.css'), ...systemCss(designRoot)];
  const faces: Face[] = [];
  let used = source;
  for (const file of cssFiles) {
    const css = readText(file, MAX_CSS_BYTES);
    if (css === null) continue;
    const parsed = facesIn(css, path.dirname(file));
    faces.push(...parsed.faces);
    used += `\n${parsed.rest}`;
  }
  const lower = used.toLowerCase();
  const seen = new Set<string>();
  const out: PreflightFont[] = [];
  for (const face of faces) {
    if (!lower.includes(face.family.toLowerCase())) continue; // declared, never used on this canvas
    if (/^[a-z][a-z0-9+.-]*:/i.test(face.url) || face.url.startsWith('//')) continue;
    let rel: string;
    try {
      rel = decodeURIComponent(face.url.replace(/[?#].*$/, ''));
    } catch {
      continue;
    }
    if (!FONT_EXT.test(rel)) continue;
    const abs = path.resolve(face.cssDir, rel);
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      continue;
    }
    if (real !== root && !real.startsWith(root + path.sep)) continue;
    if (seen.has(real)) continue;
    seen.add(real);
    let bytes: Uint8Array;
    try {
      if (statSync(real).size > MAX_FONT_BYTES) continue;
      bytes = new Uint8Array(readFileSync(real));
    } catch {
      continue;
    }
    const rep = fontFileReport(bytes);
    out.push({
      family: face.family,
      file: path.relative(root, real).split(path.sep).join('/'),
      embeddable: rep.embeddable,
      reason: rep.reason === 'unreadable' ? null : rep.reason,
    });
  }
  return out;
}

// ── the reply ────────────────────────────────────────────────────────────────────────────────────
export interface PreflightInput {
  /** absolute design root */
  designRoot: string;
  targets: readonly PreflightTarget[];
  /** the geometry source; absent or null = unmeasured (no safe-margin line, nothing blocked) */
  rects?: (canvasRel: string) => Promise<RectsManifest | null>;
}

export async function preflightPrint(input: PreflightInput): Promise<PreflightReply> {
  const boards: PreflightBoard[] = [];
  const safeMargin: SafeMarginFinding[] = [];
  const fonts: PreflightFont[] = [];
  const fontSeen = new Set<string>();
  const manifests = new Map<string, RectsManifest | null>();
  let measured = false;
  const sources = new Map<string, string | null>();
  for (const t of input.targets) {
    const abs = path.join(input.designRoot, t.canvas);
    if (!sources.has(t.canvas)) sources.set(t.canvas, readText(abs, 4 * 1024 * 1024));
    const text = sources.get(t.canvas);
    let prop: Record<string, unknown> | null = null;
    try {
      if (text) prop = readArtboardPrintProp(abs, text, t.board.id, { arrays: true });
    } catch {
      prop = null;
    }
    const paper = paperOf(prop);
    const back = findBack(t.board, t.all);
    boards.push({
      canvas: t.canvas,
      id: t.board.id,
      label: t.board.label,
      paper,
      back: back ? { id: back.id, label: back.label } : null,
    });
    if (paper && input.rects) {
      if (!manifests.has(t.canvas)) {
        try {
          manifests.set(t.canvas, await input.rects(t.canvas));
        } catch {
          manifests.set(t.canvas, null);
        }
      }
      const m = manifests.get(t.canvas);
      if (m) {
        measured = true;
        safeMargin.push(...safeMarginFindings(t.board.id, paper, m));
      }
    }
    if (existsSync(abs) && !fontSeen.has(t.canvas)) {
      fontSeen.add(t.canvas);
      fonts.push(...collectFonts(input.designRoot, t.canvas));
    }
  }
  return {
    print: input.targets.length > 0,
    boards,
    safeMargin,
    measured,
    fonts,
    colour: 'rgb',
  };
}
