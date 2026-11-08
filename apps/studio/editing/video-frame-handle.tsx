// editing/video-frame-handle.tsx — #128 §5 (T3.6b): move and zoom the selected video clip's picture on the canvas.
//
//   Enter     the clip inspector's "Move on canvas", or ⌘K (`video.frame-handle`) with a picture clip selected in the
//             Timeline. The SHELL names the clip (`video-frame-handle`: its artboard, its source size, the zoom and the
//             focus the renderer shows at the playhead); this file only draws and measures.
//   In        a frame over the artboard's video, the whole picture's outline beyond it and four corner handles. Drag the
//             picture to move it inside the frame; drag a corner to zoom (the opposite corner stays); the wheel or a
//             trackpad pinch over the frame zooms about its centre and never moves the canvas camera.
//   Out       each drag (or a wheel run once it settles) is ONE `video-frame-commit` to the shell, which writes it as one
//             `video.reframe` through the Timeline's clip pipe — the inspector's Zoom / Focus write, so undo, the toast
//             and a refusal are the same. Leaving is the same action again, or selecting something else.
//
// `<Video>` is no `data-cd-id` element, so crop mode (crop-mode.tsx) can not take it; the arithmetic is crop mode's
// (crop-geometry.ts). A `<Reframe>` centres the output window on the focus, clamped to the picture, and draws the picture
// at cover × zoom — which is exactly crop mode's `object-position` rule, so a focus is converted to crop mode's X / Y and
// back (the focus is the picture point under the frame's centre). Nothing is written while the pointer is down, and a
// read-only canvas never draws the handle.

import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { frameCaf, frameRaf } from '../frame-clock.ts';
import {
  type Corner,
  type Crop,
  cornerPoint,
  coverSize,
  dragCorner,
  pan,
  pictureRect,
  type Size,
  ZOOM_MAX,
  ZOOM_MIN,
} from './crop-geometry.ts';

type Focus = [number, number];

export interface FrameBox {
  left: number;
  top: number;
  w: number;
  h: number;
}

interface Want {
  artboardId: string;
  stableId: string;
  label: string;
  src: Size | null;
  zoom: number;
  focus: Focus;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const r4 = (n: number): number => Math.round(n * 10000) / 10000;
const NO_ROOM = 0.01;

// ── the arithmetic ─────────────────────────────────────────────────────────────────────────

/** The crop (crop mode's zoom + X / Y %) whose picture is the `<Reframe>` box for this zoom and focus. */
export function cropOfFocus(
  box: Size,
  src: Size,
  zoom: number,
  focus: readonly [number, number]
): Crop {
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const base = coverSize(box, src);
  const w = base.w * z;
  const h = base.h * z;
  const axis = (boxLen: number, len: number, f: number) => {
    const room = boxLen - len; // ≤ 0
    if (Math.abs(room) < NO_ROOM) return 50;
    const lead = clamp(boxLen / 2 - clamp(f, 0, 1) * len, room, 0);
    return (lead / room) * 100;
  };
  return { zoom: z, x: axis(box.w, w, focus[0]), y: axis(box.h, h, focus[1]) };
}

/** The focus of a crop: the picture point under the frame's centre; an axis with no room keeps `keep`. */
export function focusOfCrop(box: Size, src: Size, c: Crop, keep: readonly [number, number]): Focus {
  const r = pictureRect(box, src, c);
  const axis = (boxLen: number, len: number, lead: number, k: number) =>
    Math.abs(boxLen - len) < NO_ROOM ? k : r4(clamp((boxLen / 2 - lead) / len, 0, 1));
  return [axis(box.w, r.w, r.left, keep[0]), axis(box.h, r.h, r.top, keep[1])];
}

/** The zoom after one wheel step: up zooms in; a pinch (ctrl + wheel) is finer-grained per delta. Held to 1–8×. */
export function wheelZoom(zoom: number, deltaY: number, pinch: boolean): number {
  const k = pinch ? 0.01 : 0.002;
  return Math.round(clamp(zoom * Math.exp(-deltaY * k), ZOOM_MIN, ZOOM_MAX) * 1000) / 1000;
}

/** The artboard's video (its `<VideoComp>` host) in the canvas window's pixels, or null when it is not drawn. */
export function videoBox(doc: Document, artboardId: string): FrameBox | null {
  let el: Element | null = null;
  try {
    el = doc.querySelector(`[data-dc-screen="${CSS.escape(artboardId)}"] .dc-video-comp`);
  } catch {
    return null;
  }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { left: r.left, top: r.top, w: r.width, h: r.height };
}

/** The picture's own size when the shell could not say it: the first decoded frame under the artboard's video. */
function sizeFromDom(doc: Document, artboardId: string): Size | null {
  try {
    const v = doc.querySelector(
      `[data-dc-screen="${CSS.escape(artboardId)}"] .dc-video-comp video`
    ) as HTMLVideoElement | null;
    return v && v.videoWidth > 0 && v.videoHeight > 0
      ? { w: v.videoWidth, h: v.videoHeight }
      : null;
  } catch {
    return null;
  }
}

// ── chrome ─────────────────────────────────────────────────────────────────────────────────

const CSS_TEXT = `
.ed-vframe-picture {
  position: fixed; z-index: 5; box-sizing: border-box; pointer-events: auto; cursor: grab; touch-action: none;
  border: 1.5px dashed var(--accent, #4a7bff);
  background: color-mix(in oklab, var(--accent, #4a7bff) 6%, transparent);
}
.ed-vframe-picture[data-dragging] { cursor: grabbing; }
.ed-vframe-box {
  position: fixed; z-index: 6; pointer-events: none;
  box-shadow: 0 0 0 1.5px var(--accent, #4a7bff);
}
.ed-vframe-handle {
  position: fixed; z-index: 8; width: 10px; height: 10px; margin: -5px 0 0 -5px;
  border: 1.5px solid var(--accent, #4a7bff); border-radius: 2px; background: var(--bg-0, #fff); touch-action: none;
}
.ed-vframe-handle[data-c="nw"], .ed-vframe-handle[data-c="se"] { cursor: nwse-resize; }
.ed-vframe-handle[data-c="ne"], .ed-vframe-handle[data-c="sw"] { cursor: nesw-resize; }
.ed-vframe-tag {
  position: fixed; z-index: 8; pointer-events: none; padding: 2px 8px; border-radius: 6px;
  background: var(--accent, #4a7bff); color: var(--accent-fg, #fff);
  font: 500 11px/16px var(--maude-chrome-font, system-ui, sans-serif); white-space: nowrap;
}
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-vframe-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-vframe-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

/** The words on the tag over the frame. */
export const frameTagText = (label: string): string =>
  label ? `${label} · move and zoom` : 'Move and zoom';

/** A wheel run is written once it has been still this long (one undo step per run, not per notch). */
export const WHEEL_SETTLE_MS = 350;
/** A press that travels less than this is a click, and writes nothing. */
const CLICK_SLOP = 3;

type Drag =
  | { kind: 'pan'; x: number; y: number; from: Crop; moved: boolean }
  | { kind: 'corner'; corner: Corner; x: number; y: number; from: Crop; moved: boolean };

// ── the handle ─────────────────────────────────────────────────────────────────────────────

export function VideoFrameHandle({
  readOnly = false,
}: {
  readOnly?: boolean;
}): ReactElement | null {
  const [want, setWant] = useState<Want | null>(null);
  const [box, setBox] = useState<FrameBox | null>(null);
  // the crop being shown while the person works (null = the shell's numbers)
  const [live, setLive] = useState<Crop | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const wantRef = useRef(want);
  wantRef.current = want;
  const boxRef = useRef(box);
  boxRef.current = box;
  const liveRef = useRef(live);
  liveRef.current = live;
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // the shell names the clip, or takes the handle down
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (
        e.source !== window.parent ||
        (e.data as { dgn?: unknown } | null)?.dgn !== 'video-frame-handle'
      )
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'video-frame-handle') return;
      setLive(null);
      if (!m.artboardId || !m.stableId) {
        setWant(null);
        return;
      }
      setWant({
        artboardId: m.artboardId,
        stableId: m.stableId,
        label: m.label ?? '',
        src: m.src ?? null,
        zoom: m.zoom ?? 1,
        focus: m.focus ?? [0.5, 0.5],
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const on = !!want && !readOnly;
  useEffect(() => {
    if (on) ensureStyles();
  }, [on]);

  // the frame follows the artboard while the camera pans or zooms (not while a drag holds it)
  useEffect(() => {
    if (!on || !want) {
      setBox(null);
      return undefined;
    }
    let raf = 0;
    const tick = () => {
      if (!drag.current)
        setBox((b) => {
          const n = videoBox(document, want.artboardId);
          if (!n) return null;
          return b && b.left === n.left && b.top === n.top && b.w === n.w && b.h === n.h ? b : n;
        });
      raf = frameRaf(tick);
    };
    setBox(videoBox(document, want.artboardId));
    raf = frameRaf(tick);
    return () => frameCaf(raf);
  }, [on, want]);

  const srcOf = useCallback(
    (w: Want): Size | null => w.src ?? sizeFromDom(document, w.artboardId),
    []
  );
  const cropNow = useCallback((): Crop | null => {
    const w = wantRef.current;
    const b = boxRef.current;
    const src = w ? srcOf(w) : null;
    if (!w || !b || !src) return null;
    return liveRef.current ?? cropOfFocus(b, src, w.zoom, w.focus);
  }, [srcOf]);

  const commit = useCallback(
    (c: Crop) => {
      const w = wantRef.current;
      const b = boxRef.current;
      const src = w ? srcOf(w) : null;
      if (!w || !b || !src) return;
      // an axis the picture can not move along keeps what the file says
      const focus = focusOfCrop(b, src, c, w.focus);
      try {
        window.parent.postMessage(
          {
            dgn: 'video-frame-commit',
            v: 1,
            artboardId: w.artboardId,
            stableId: w.stableId,
            zoom: Math.round(c.zoom * 100) / 100,
            focus,
          },
          '*'
        );
      } catch {
        /* detached */
      }
    },
    [srcOf]
  );

  // the wheel and the trackpad pinch over the frame are the picture's, not the camera's
  useEffect(() => {
    if (!on) return undefined;
    const onWheel = (e: WheelEvent) => {
      const b = boxRef.current;
      if (!b || drag.current) return;
      if (
        e.clientX < b.left ||
        e.clientX > b.left + b.w ||
        e.clientY < b.top ||
        e.clientY > b.top + b.h
      )
        return;
      const cur = cropNow();
      const w = wantRef.current;
      const src = w ? srcOf(w) : null;
      if (!cur || !w || !src) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const zoom = wheelZoom(cur.zoom, e.deltaY, e.ctrlKey);
      if (zoom === cur.zoom) return;
      // about the frame's centre: the same focus, a bigger picture
      const next = cropOfFocus(b, src, zoom, focusOfCrop(b, src, cur, w.focus));
      setLive(next);
      liveRef.current = next;
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
        const c = liveRef.current;
        if (c) commit(c);
      }, WHEEL_SETTLE_MS);
    };
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = null;
    };
  }, [on, cropNow, srcOf, commit]);

  const move = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      const b = boxRef.current;
      const w = wantRef.current;
      const src = w ? srcOf(w) : null;
      if (!d || !b || !src) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
      d.moved = true;
      const rel = { w: b.w, h: b.h };
      const next =
        d.kind === 'pan'
          ? pan(rel, src, d.from, dx, dy)
          : dragCorner(rel, src, d.from, d.corner, e.clientX - b.left, e.clientY - b.top);
      liveRef.current = next;
      setLive(next);
    },
    [srcOf]
  );
  const up = useCallback(
    (e: PointerEvent) => {
      move(e);
      const d = drag.current;
      drag.current = null;
      setDragging(false);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      const c = liveRef.current;
      if (d?.moved && c) commit(c);
    },
    [move, commit]
  );
  useEffect(
    () => () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
    },
    [move, up]
  );

  const begin = (kind: 'pan' | Corner) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const from = cropNow();
    if (!from) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current =
      kind === 'pan'
        ? { kind: 'pan', x: e.clientX, y: e.clientY, from, moved: false }
        : { kind: 'corner', corner: kind, x: e.clientX, y: e.clientY, from, moved: false };
    setDragging(true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
  };

  if (!on || !want || !box) return null;
  const src = srcOf(want);
  const crop = src ? (live ?? cropOfFocus(box, src, want.zoom, want.focus)) : null;
  const r = src && crop ? pictureRect({ w: box.w, h: box.h }, src, crop) : null;
  const pic = r ? { left: box.left + r.left, top: box.top + r.top, w: r.w, h: r.h } : null;
  const corners: Corner[] = ['nw', 'ne', 'se', 'sw'];
  return (
    <div data-testid="edit-video-frame" data-dc-chrome>
      {pic ? (
        <i
          className="ed-vframe-picture"
          data-testid="edit-video-frame-picture"
          data-dragging={dragging ? 'true' : undefined}
          style={{ left: pic.left, top: pic.top, width: pic.w, height: pic.h }}
          onPointerDown={begin('pan')}
        />
      ) : null}
      <i
        className="ed-vframe-box"
        data-testid="edit-video-frame-box"
        style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
      />
      {pic
        ? corners.map((c) => {
            const p = cornerPoint({ left: pic.left, top: pic.top, w: pic.w, h: pic.h }, c);
            return (
              <i
                key={c}
                className="ed-vframe-handle"
                data-c={c}
                data-testid={`edit-video-frame-handle-${c}`}
                style={{ left: p.x, top: p.y }}
                onPointerDown={begin(c)}
              />
            );
          })
        : null}
      <span
        className="ed-vframe-tag"
        data-testid="edit-video-frame-tag"
        style={{ left: box.left, top: box.top - 24 }}
      >
        {frameTagText(want.label)}
      </span>
    </div>
  );
}
