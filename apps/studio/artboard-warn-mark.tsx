/**
 * @file       artboard-warn-mark.tsx — S7.25 (08 ak-warnings, ak-convert-after): the one warning style on the canvas.
 * @scope      apps/studio/artboard-warn-mark.tsx
 * @purpose    A small problem glyph beside an artboard's label ("2 things to check") and the live list behind it. The
 *             artboard measures ITSELF — the layers it holds, its comp's length, its own props — and runs the same
 *             detectors the server does (kinds/warnings.ts), so a mark appears the moment the design changes, with no
 *             second render. The list is also stamped on the artboard (`data-dc-warnings`) where the Inspector's
 *             selection payload already reads every `data-dc-*`, so its top row needs no new message.
 *
 *             Shown, never blocking: the mark is not a button and never a dialog. It sits inside the label (a transient
 *             design aid, hidden from every export with the rest of the chrome), and only artboards of a kind that has
 *             something to check (print · web · video) measure anything at all.
 */

import { type RefObject, useEffect, useState } from 'react';

import { DsIcon } from './canvas-ds-icons.tsx';
import { readArtboardVideoMeta } from './kinds/meta.ts';
import {
  detectWarnings,
  summaryWords,
  type WarnArtboard,
  type Warning,
  type WarnRect,
  type WarnRects,
} from './kinds/warnings.ts';

const MAX_ELEMENTS = 300;
const SETTLE_MS = 250;
const LEAF_TAGS = new Set(['img', 'svg', 'video', 'picture', 'button', 'a', 'input']);

/** The layers worth a check: a picture or control, or a leaf that holds text — not a structural wrapper. */
function isCandidate(el: Element): boolean {
  if (LEAF_TAGS.has(el.tagName.toLowerCase())) return true;
  if (el.querySelector('[data-cd-id]')) return false;
  return (el.textContent ?? '').trim().length > 0;
}

/** The artboard's layers in the artboard's OWN px (zoom-independent: screen rects over the live scale). */
function measure(body: HTMLElement): WarnRects | null {
  const b = body.getBoundingClientRect();
  if (!(b.width > 0 && b.height > 0 && body.offsetWidth > 0)) return null;
  const k = b.width / body.offsetWidth;
  const elements: WarnRect[] = [];
  for (const el of Array.from(body.querySelectorAll('[data-cd-id]'))) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (!isCandidate(el)) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) continue;
    const img = el instanceof HTMLImageElement ? el : null;
    elements.push({
      cdId: el.getAttribute('data-cd-id'),
      x: (r.left - b.left) / k,
      y: (r.top - b.top) / k,
      w: r.width / k,
      h: r.height / k,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? '').trim().slice(0, 80),
      ...(img?.complete && img.naturalWidth > 0 ? { naturalW: img.naturalWidth } : {}),
    });
  }
  return { artboard: { x: 0, y: 0, w: body.offsetWidth, h: body.offsetHeight }, elements };
}

interface CompSnap {
  artboardId: string | null;
  fps: number;
  durationInFrames: number;
}

function videoOf(id: string): { frames: number; fps: number; maxFrames: number | null } | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    __maude_comps__?: () => CompSnap[];
    __canvas_meta__?: unknown;
  };
  const comp = w.__maude_comps__?.().find((c) => c.artboardId === id);
  if (!comp) return null;
  return {
    frames: comp.durationInFrames,
    fps: comp.fps,
    maxFrames: readArtboardVideoMeta(w.__canvas_meta__, id).maxFrames ?? null,
  };
}

/** Where the artboard was made from (Change kind's copy): `artboardMeta[id].madeFrom.label`, or null. */
export function madeFromLabel(id: string): string | null {
  if (typeof window === 'undefined') return null;
  const meta = (window as unknown as { __canvas_meta__?: unknown }).__canvas_meta__;
  return readArtboardVideoMeta(meta, id).madeFrom?.label ?? null;
}

export interface WarnProps {
  id: string;
  kind: 'digital' | 'web' | 'print' | 'video';
  width: number | undefined;
  height: number | undefined;
  fixed: boolean;
  print: unknown;
  bodyRef: RefObject<HTMLElement | null>;
}

/** The artboard's warnings, live: re-measured a moment after its content or its props change. */
export function useArtboardWarnings(p: WarnProps): Warning[] {
  const [list, setList] = useState<Warning[]>([]);
  const printKey = p.print ? JSON.stringify(p.print) : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: printKey stands for the print prop; the body ref is read inside.
  useEffect(() => {
    if (p.kind === 'digital') {
      setList((prev) => (prev.length ? [] : prev));
      return;
    }
    const body = p.bodyRef.current;
    if (!body) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      const rects = p.kind === 'video' ? null : measure(body);
      // an artboard the browser has not laid out (content-visibility, off screen) measures nothing: keep what we knew
      if (p.kind !== 'video' && body.querySelector('[data-cd-id]') && !rects?.elements.length)
        return;
      const video = p.kind === 'video' ? videoOf(p.id) : null;
      const ab: WarnArtboard = {
        id: p.id,
        kind: p.kind,
        widthPx: body.offsetWidth || p.width || 0,
        heightPx: body.offsetHeight || p.height || 0,
        fixed: p.fixed,
        ...(p.print ? { print: p.print } : {}),
        ...(video
          ? { durationFrames: video.frames, fps: video.fps, maxFrames: video.maxFrames }
          : {}),
      };
      const next = detectWarnings(ab, rects);
      setList((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, SETTLE_MS);
    };
    later();
    if (p.kind === 'video') {
      // a comp registers just after mount and its frames never change a warning: look twice, no observers
      const retry = setTimeout(run, 1500);
      return () => {
        if (timer) clearTimeout(timer);
        clearTimeout(retry);
      };
    }
    const mo = new MutationObserver(later);
    mo.observe(body, { childList: true, subtree: true, attributes: true, characterData: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    ro?.observe(body);
    // an artboard scrolled into view is laid out then (content-visibility), and a picture finishing loading gives its width
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && later());
    io?.observe(body);
    body.addEventListener('load', later, true);
    return () => {
      if (timer) clearTimeout(timer);
      mo.disconnect();
      ro?.disconnect();
      io?.disconnect();
      body.removeEventListener('load', later, true);
    };
  }, [p.id, p.kind, p.width, p.height, p.fixed, printKey]);
  return list;
}

/** The `data-dc-warnings` read-back: only what the Inspector's row needs. */
export const warningsAttr = (list: readonly Warning[]): string | undefined =>
  list.length ? JSON.stringify(list) : undefined;

/** The glyph beside the label. Not a control: a title, and `aria-hidden` (the label's own name says the count).
 *  08 `.ak-lw`: a 16 px `--status-warn` pill with the DS `problem` glyph in `--object-ink` (6.5:1 in both themes, also
 *  on the selected accent label - it is a fill, not a stroke that vanishes there). */
export function ArtboardWarnMark({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="dc-artboard-warn dc-artboard-guides"
      data-testid="artboard-warn-mark"
      data-count={count}
      title={summaryWords(count)}
      aria-hidden="true"
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: 16,
        height: 16,
        marginLeft: 6,
        borderRadius: 999,
        background: 'var(--maude-hud-warn, #f5b84a)',
        color: 'var(--maude-hud-object-ink, #1a1d24)',
        verticalAlign: 'middle',
      }}
    >
      <DsIcon name="problem" size={11} />
    </span>
  );
}
ArtboardWarnMark.displayName = 'ArtboardWarnMark';

// ── the layer a warning is about, outlined on the artboard (08 ak-warnings: "Crosses the cut") ─────────────────────

/** The word on the tag of an outlined layer, per warning code. Only the cut says it on the canvas; every other warning
 *  is the label mark + one inspector line. */
export const OUTLINE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  'crosses-cut': 'Crosses the cut',
  'layers-at-cut': 'Crosses the cut',
});

const MAX_OUTLINES = 8;

/** The cdIds the warnings name that deserve an outline. */
export function outlineTargets(list: readonly Warning[]): Array<{ cdId: string; word: string }> {
  const out: Array<{ cdId: string; word: string }> = [];
  for (const w of list) {
    const word = OUTLINE_WORDS[w.code];
    if (!word) continue;
    const fix = w.fix as { element?: string; elements?: string[] };
    for (const id of fix.elements ?? (fix.element ? [fix.element] : []))
      if (typeof id === 'string' && out.length < MAX_OUTLINES) out.push({ cdId: id, word });
  }
  return out;
}

interface Outline {
  x: number;
  y: number;
  w: number;
  h: number;
  word: string;
}

/**
 * A dashed `--status-warn` outline and a small tag on each layer the warnings name, drawn over the artboard's design
 * surface like the guides: a transient design aid (`dc-artboard-guides`, hidden from every export), not selectable.
 * `rect` is the surface in WORLD px; the layer's rect is measured in the artboard's own px and carried over.
 */
export function ArtboardWarnOutlines({
  warnings,
  bodyRef,
  rect,
  show,
}: {
  warnings: readonly Warning[];
  bodyRef: RefObject<HTMLElement | null>;
  rect: { x: number; y: number; w: number; h: number };
  show: boolean;
}) {
  const [outlines, setOutlines] = useState<Outline[]>([]);
  const key = JSON.stringify(outlineTargets(warnings));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the targets; the body is read inside.
  useEffect(() => {
    const body = bodyRef.current;
    const targets = outlineTargets(warnings);
    if (!show || !body || targets.length === 0) {
      setOutlines((prev) => (prev.length ? [] : prev));
      return;
    }
    const b = body.getBoundingClientRect();
    const k = body.offsetWidth > 0 && b.width > 0 ? b.width / body.offsetWidth : 1;
    const next: Outline[] = [];
    for (const t of targets) {
      const el = body.querySelector(`[data-cd-id="${t.cdId.replace(/["\\]/g, '\\$&')}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      next.push({
        x: (r.left - b.left) / k,
        y: (r.top - b.top) / k,
        w: r.width / k,
        h: r.height / k,
        word: t.word,
      });
    }
    setOutlines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [key, show, rect.x, rect.y, rect.w, rect.h]);
  if (!show || outlines.length === 0) return null;
  return (
    <div
      className="dc-artboard-guides dc-warn-outlines"
      data-testid="artboard-warn-outlines"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        pointerEvents: 'none',
      }}
    >
      {outlines.map((o, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: outlines are positional, re-derived on every change
          key={i}
          data-testid="artboard-warn-outline"
          style={{
            position: 'absolute',
            left: o.x,
            top: o.y,
            width: o.w,
            height: o.h,
            border: '1.5px dashed var(--maude-hud-warn, #f5b84a)',
            borderRadius: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              right: -1.5,
              bottom: 'calc(100% + 4px)',
              padding: '1px 4px',
              borderRadius: 4,
              background: 'var(--maude-hud-warn, #f5b84a)',
              color: 'var(--maude-hud-object-ink, #1a1d24)',
              font: '600 11px/1.3 var(--font-body, system-ui, sans-serif)',
              whiteSpace: 'nowrap',
            }}
          >
            {o.word}
          </span>
        </span>
      ))}
    </div>
  );
}
