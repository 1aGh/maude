// editing/finder-drop.tsx — photos dragged from Finder onto an artboard (S8.14; 12 · ia-drop-photos, ia-placed).
//
// While the drag is over an artboard (or a frame, or a picture) it lights up and says what will happen: empty frames fill in
// order, else several photos become a tidy grid, else one photo goes in loose. On drop each file is imported (`POST /_api/asset`,
// the studio sniffs the bytes and names the file) and the lot is placed with ONE `image.place` (mode "auto") — one write, one
// undo step — and selected at once. They are in Assets too (the Assets tab lists the newest first under Just added).
//
// Bare canvas is not handled here: a drop there stays loose, as before (use-canvas-media-drop.tsx). A video, a sound or a link
// stays that hook's too. Dropped files are untrusted: only the type list is read here to draw the hint, the studio decides what a
// file is, and the path that is written never comes from the drop — it comes from the import's answer and is re-checked by
// `image.place` (`assets/<flat name>`).

import { useEffect, useRef, useState } from 'react';

import { uploadAsset } from '../asset-upload.ts';
import { showCanvasToast } from '../canvas-notifications.tsx';
import { dropHint, type PlaceTargetKind } from '../edit-ops/place-plan.ts';
import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import { uploadAndAnnounceMedia } from '../use-canvas-media-drop.tsx';
import { type Selection, useSelectionSet } from '../use-selection-set.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { containerAt } from './draw-tools.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import {
  askForFinderDrop,
  dragPhotoCount,
  emptyFramesIn,
  isFinderDrag,
  isPhoto,
  type Landing,
  MAX_PHOTOS,
  photosOf,
  placedLine,
  selectionRefs,
} from './finder-drop-model.ts';
import { type DropTarget, dropTargetAt, LOCKED_LINE } from './image-drop.tsx';
import { refOfElement, selectWhenRendered } from './object-actions.ts';
import { isLockedDom } from './selection.tsx';

/** A drop target for `n` photos: a picture under the pointer is only a target for one photo; several go to what holds it. */
export function finderTargetAt(doc: Document, x: number, y: number, n: number): DropTarget | null {
  const t = dropTargetAt(doc, x, y);
  if (!t || t.kind !== 'picture' || n <= 1) return t;
  const c = containerAt(doc, x, y);
  if (!c) return null;
  if (!c.frame) return { kind: 'artboard', el: c.el, ref: null, artboard: c.artboard };
  const ref = refOfElement(c.el);
  return ref ? { kind: 'frame', el: c.el, ref, artboard: c.artboard } : null;
}

/** What the pictures land on, as the plan sees it. An empty picture under the pointer is an empty frame. */
export function landingOf(t: DropTarget): Landing {
  if (t.kind === 'picture')
    return t.el.getAttribute('src') ? { kind: 'picture', empty: 0 } : { kind: 'frame', empty: 1 };
  return { kind: t.kind as PlaceTargetKind, empty: emptyFramesIn(t.el) };
}

/** The artboard's name as the canvas shows it ("Fotky ze zápasu"), or ''. */
export function artboardLabelOf(el: Element): string {
  const label = el.closest('[data-dc-screen]')?.querySelector('.dc-artboard-label');
  const own = Array.from(label?.childNodes ?? [])
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent ?? '')
    .join('')
    .trim();
  return (own || label?.textContent || '').trim().slice(0, 60);
}

const CONCURRENCY = 3;

type Imported = { path: string } | { error: string };

/** Import the files, three at a time, answers in the order the files came. */
export async function importAll(
  files: readonly File[],
  upload: (f: File) => Promise<Imported> = (f) => uploadAsset(f)
): Promise<Imported[]> {
  const out: Imported[] = new Array(files.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < files.length; i = next++) {
      try {
        out[i] = await upload(files[i] as File);
      } catch (e) {
        out[i] = { error: e instanceof Error ? e.message : 'upload failed' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  return out;
}

/** A picture's natural size, for one loose photo (a width the file's own). Never rejects; null when it cannot be read. */
export function naturalOf(file: Blob): Promise<{ w: number; h: number } | null> {
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL)
    return Promise.resolve(null);
  return new Promise((resolve) => {
    let url = '';
    const done = (v: { w: number; h: number } | null) => {
      if (url) URL.revokeObjectURL(url);
      resolve(v);
    };
    try {
      url = URL.createObjectURL(file);
      const img = new Image();
      const timer = setTimeout(() => done(null), 1500);
      img.onload = () => {
        clearTimeout(timer);
        done(img.naturalWidth > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : null);
      };
      img.onerror = () => {
        clearTimeout(timer);
        done(null);
      };
      img.src = url;
    } catch {
      done(null);
    }
  });
}

export interface FinderDropDeps {
  upload?: (f: File) => Promise<Imported>;
  natural?: (f: File) => Promise<{ w: number; h: number } | null>;
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error' | 'warning') => void;
  record?: (rec: NonNullable<ReturnType<typeof editOpRecord>>) => void;
  select?: (refs: ElementRef[]) => void;
}

/**
 * One drop: import, place all in ONE write, say a failure in one line, record ONE undo step, select what was placed.
 * Photos that could not be imported are left out and named in one line; the rest are still placed.
 */
export async function runFinderDrop(
  photos: readonly File[],
  target: DropTarget,
  landing: Landing,
  label: string,
  deps: FinderDropDeps = {}
): Promise<EditOpResult | null> {
  const imported = await importAll(photos, deps.upload);
  const ok: string[] = [];
  let firstError = '';
  for (const r of imported) {
    if ('path' in r) ok.push(r.path);
    else if (!firstError) firstError = r.error;
  }
  const failed = imported.length - ok.length;
  if (failed > 0) {
    const what =
      failed === imported.length
        ? failed === 1
          ? 'the photo'
          : `${failed} photos`
        : `${failed} of ${imported.length} photos`;
    deps.toast?.(`Couldn’t add ${what}. ${firstError}`.trim(), 'error');
  }
  if (ok.length === 0) return null;
  const natural = ok.length === 1 ? await (deps.natural ?? naturalOf)(photos[0] as File) : null;
  const ask = askForFinderDrop(ok, target, natural);
  const result = await (deps.run ?? ((a: EditOpAsk) => runEditOp(a)))(ask);
  if (!result.ok) {
    deps.toast?.(result.message, 'error');
    return result;
  }
  if (result.actionId === null && result.writeId) {
    const rec = editOpRecord(result.writeId, ok.length === 1 ? 'Place picture' : 'Place photos');
    if (rec) deps.record?.(rec);
  }
  if (result.created?.length) deps.select?.(selectionRefs(landing, ok.length, result.created));
  deps.toast?.(placedLine(ok.length, label), 'info');
  return result;
}

const CSS_TEXT = `
.ed-fdrop-ring {
  position: fixed;
  z-index: 6;
  pointer-events: none;
  box-sizing: border-box;
  border: 2px solid var(--maude-hud-accent, #4a7bff);
  background: color-mix(in oklab, var(--maude-hud-accent, #4a7bff) 12%, transparent);
  border-radius: 2px;
  animation: ed-fdrop-in var(--dur-fast, 120ms) ease-out;
}
.ed-fdrop-ring[data-kind="artboard"] { border-style: dashed; }
.ed-fdrop-pill {
  position: absolute;
  transform: translate(-50%, -50%);
  max-width: calc(100% - 16px);
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--maude-hud-accent, #4a7bff);
  color: var(--maude-hud-accent-fg, #fff);
  font: 600 12px/1.3 var(--maude-chrome-font-ui, system-ui, sans-serif);
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.ed-fdrop-ring[data-busy="true"] .ed-fdrop-pill { background: var(--maude-chrome-bg-1, #1b1e24); color: var(--maude-chrome-fg-0, #e7eaf0); }
@keyframes ed-fdrop-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ed-fdrop-ring { animation-duration: 1ms; } }
`.trim();

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-fdrop-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-fdrop-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

interface Hint {
  kind: PlaceTargetKind;
  left: number;
  top: number;
  w: number;
  h: number;
  text: string;
  busy: boolean;
  /** where the pill sits inside the ring: the middle of the part that is on screen */
  px: number;
  py: number;
}

/** The middle of the part of `r` that is inside the window, relative to `r` (a tall artboard keeps its pill in view). */
function pillAt(r: DOMRect): { px: number; py: number } {
  const x0 = Math.max(r.left, 0);
  const x1 = Math.min(r.right, window.innerWidth);
  const y0 = Math.max(r.top, 0);
  const y1 = Math.min(r.bottom, window.innerHeight);
  return { px: (x0 + x1) / 2 - r.left, py: (y0 + y1) / 2 - r.top };
}

const sameHint = (a: Hint | null, b: Hint | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    a.text === b.text &&
    a.busy === b.busy &&
    a.px === b.px &&
    a.py === b.py &&
    a.left === b.left &&
    a.top === b.top &&
    a.w === b.w &&
    a.h === b.h);

export function FinderDrop({ readOnly }: { readOnly?: boolean }) {
  ensureStyles();
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();
  const live = useRef({ selSet, undo });
  live.current = { selSet, undo };
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined' || readOnly) return undefined;
    const show = (next: Hint | null) => setHint((prev) => (sameHint(prev, next) ? prev : next));
    const clear = () => show(null);
    const over = (e: DragEvent) => {
      if (isReadOnlyCanvas() || !isFinderDrag(e.dataTransfer?.types)) return;
      const items = e.dataTransfer?.items;
      const n = dragPhotoCount(items);
      // the list is readable and holds no photo (a video, a sound): not ours
      if (n === 0 && items && items.length > 0) return clear();
      const t = finderTargetAt(document, e.clientX, e.clientY, n);
      // bare canvas: a drop there stays loose (the media hook draws its own frame)
      if (!t) return clear();
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      document.body.classList.remove('dc-media-dragover');
      if (isLockedDom(t.el)) return clear();
      const landing = landingOf(t);
      const r = t.el.getBoundingClientRect();
      show({
        kind: landing.kind,
        left: r.left,
        top: r.top,
        w: r.width,
        h: r.height,
        text: dropHint(landing.kind, n, landing.empty),
        busy: false,
        ...pillAt(r),
      });
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget == null) clear();
    };
    const drop = (e: DragEvent) => {
      if (isReadOnlyCanvas() || !isFinderDrag(e.dataTransfer?.types)) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      const { photos, over: extra } = photosOf(files);
      if (photos.length === 0) return clear();
      const t = finderTargetAt(document, e.clientX, e.clientY, photos.length);
      if (!t) return clear();
      e.preventDefault();
      e.stopPropagation();
      document.body.classList.remove('dc-media-dragover');
      if (isLockedDom(t.el)) {
        clear();
        return void showCanvasToast(LOCKED_LINE, 'info');
      }
      // a video or a sound dropped together with the photos is the media hook's job; do it here, since this drop was taken
      for (const f of files) {
        if (isPhoto(f)) continue;
        if (f.type.startsWith('video/')) void uploadAndAnnounceMedia(f, 'video');
        else if (f.type.startsWith('audio/')) void uploadAndAnnounceMedia(f, 'audio');
      }
      if (extra > 0)
        showCanvasToast(`Placed the first ${MAX_PHOTOS}. The rest were left out.`, 'info');
      const landing = landingOf(t);
      const r = t.el.getBoundingClientRect();
      show({
        kind: landing.kind,
        left: r.left,
        top: r.top,
        w: r.width,
        h: r.height,
        text: photos.length === 1 ? 'Adding the photo…' : `Adding ${photos.length} photos…`,
        busy: true,
        ...pillAt(r),
      });
      void runFinderDrop(photos, t, landing, artboardLabelOf(t.el), {
        toast: (m, kind) => showCanvasToast(m, kind === 'error' ? 'error' : 'info'),
        record: (rec) => live.current.undo?.record(rec),
        select: (refs) =>
          selectWhenRendered(refs, (s: Selection[]) => live.current.selSet.replace(s)),
      }).finally(clear);
    };
    document.addEventListener('dragover', over, true);
    document.addEventListener('dragleave', leave, true);
    document.addEventListener('drop', drop, true);
    return () => {
      document.removeEventListener('dragover', over, true);
      document.removeEventListener('dragleave', leave, true);
      document.removeEventListener('drop', drop, true);
    };
  }, [readOnly]);

  if (!hint) return null;
  return (
    <i
      className="ed-fdrop-ring"
      data-testid="edit-drop-hint"
      data-kind={hint.kind}
      data-busy={hint.busy ? 'true' : undefined}
      role="status"
      style={{ left: hint.left, top: hint.top, width: hint.w, height: hint.h }}
    >
      <span className="ed-fdrop-pill" style={{ left: hint.px, top: hint.py }}>
        {hint.text}
      </span>
    </i>
  );
}
