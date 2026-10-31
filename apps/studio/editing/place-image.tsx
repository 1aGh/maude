// editing/place-image.tsx — r2-p1 TD10 (Michal, UX audit F10): placing the picture Image (I) picked.
//
// The shell opened its picture picker the moment I was pressed (client/v2/shell/image-pick.js), put the picture in Assets
// and hands it down as `place-image {asset, natural?, label?}` (dgn, shell → canvas, parent-gated). The canvas arms it:
//
//   a click on an artboard   the picture is placed there, centred on the click, on the artboard's page (absolute)
//   ↵                        in the middle of the view, on the selected artboard or the one under the middle
//   esc                      lets go; nothing was written (the picture stays in Assets)
//
// Each ends in ONE `image.place` edit-op (`mode: 'loose'`, `at` in the artboard's own px — what a paste does,
// edit-ops/image-fit.ts): one write, one undo step. The canvas never writes source; it measures and asks.

import { useCallback, useEffect, useRef, useState } from 'react';

import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { showCanvasToast } from '../canvas-notifications.tsx';
import type { EditOpResult } from '../edit-ops/types.ts';
import { isReadOnlyCanvas } from '../read-only-mode.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { useUndoStackOptional } from '../use-undo-stack.tsx';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { PLACE_ACTION } from './image-drop.tsx';
import { selectWhenRendered } from './object-actions.ts';
import { pastePoint, pasteTarget } from './paste-bar.tsx';

export const OUTSIDE_IMAGE_LINE = 'Click inside an artboard to place the picture.';
export const NO_ARTBOARD_LINE = 'Scroll an artboard into view to place the picture.';
export const PLACE_IMAGE_HINT = (label: string) =>
  `Click to place ${label} · ↵ in the middle · esc to cancel`;

export interface ImageRequest {
  asset: string;
  natural: { w: number; h: number } | null;
  label: string;
}

/** The fields of a `place-image` the parent-gated listener accepted, or null when malformed. */
export function imageRequestFrom(m: unknown): ImageRequest | null {
  const x = m as Record<string, unknown> | null;
  if (typeof x?.asset !== 'string' || !x.asset) return null;
  const n = x.natural as { w?: unknown; h?: unknown } | null | undefined;
  const natural =
    n && typeof n.w === 'number' && typeof n.h === 'number' && n.w > 0 && n.h > 0
      ? { w: n.w, h: n.h }
      : null;
  const label =
    typeof x.label === 'string' && x.label ? x.label : x.asset.split('/').pop() || 'the picture';
  return { asset: x.asset, natural, label };
}

/** The `image.place` ask: loose on `artboard`, the picture centred on `point` (the artboard's own px). */
export function askForImageAt(
  req: ImageRequest,
  artboard: string,
  point: { x: number; y: number }
): EditOpAsk {
  const w = req.natural?.w ?? 0;
  const h = req.natural?.h ?? 0;
  const params: Record<string, unknown> = { asset: req.asset, mode: 'loose', artboard };
  if (req.natural) params.natural = req.natural;
  params.at = {
    x: Math.max(0, Math.round(point.x - w / 2)),
    y: Math.max(0, Math.round(point.y - h / 2)),
  };
  return { op: PLACE_ACTION, targets: [], params };
}

/** The artboard under screen (x, y) and that point in the artboard's own px; null off every artboard. */
export function artboardPointAt(
  doc: Document,
  x: number,
  y: number
): { artboard: string; point: { x: number; y: number } } | null {
  const stack = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(x, y) : [];
  for (const el of stack) {
    const body = el.closest('.dc-artboard-body') as HTMLElement | null;
    const artboard = body?.closest('[data-dc-screen]')?.getAttribute('data-dc-screen');
    if (!body || !artboard) continue;
    const r = body.getBoundingClientRect();
    const k = body.offsetWidth > 0 && r.width > 0 ? r.width / body.offsetWidth : 1;
    return { artboard, point: { x: (x - r.left) / k, y: (y - r.top) / k } };
  }
  return null;
}

async function runImagePlace(
  req: ImageRequest,
  ask: EditOpAsk,
  deps: { record: (r: unknown) => void; select: (refs: unknown[]) => void }
): Promise<EditOpResult> {
  const result = await runEditOp(ask);
  if (!result.ok) {
    showCanvasToast(result.message || OUTSIDE_IMAGE_LINE, 'error');
    return result;
  }
  if (result.actionId === null && result.writeId) {
    const rec = editOpRecord(result.writeId, `Place ${req.label}`);
    if (rec) deps.record(rec);
  }
  if (result.created?.length) deps.select(result.created);
  return result;
}

const CSS_TEXT = `
.ed-place-image-hint {
  position: fixed;
  left: 50%;
  bottom: 88px;
  transform: translateX(-50%);
  z-index: 6;
  pointer-events: none;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--maude-chrome-bg-1, #ffffff);
  color: var(--maude-chrome-fg-0, #2a2520);
  border: 1px solid var(--maude-chrome-line, rgba(0, 0, 0, 0.14));
  font: 500 12px/1.3 system-ui, -apple-system, sans-serif;
  white-space: nowrap;
}`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('ed-place-image-css')) return;
  const s = document.createElement('style');
  s.id = 'ed-place-image-css';
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

export function PlaceImage({ readOnly }: { readOnly?: boolean }) {
  const selSet = useSelectionSet();
  const undo = useUndoStackOptional();
  const live = useRef({ selSet, undo });
  live.current = { selSet, undo };
  const [req, setReq] = useState<ImageRequest | null>(null);

  const deps = useCallback(
    () => ({
      record: (rec: unknown) => live.current.undo?.record(rec as never),
      select: (refs: unknown[]) =>
        selectWhenRendered(refs as never, (s) => live.current.selSet.replace(s)),
    }),
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || (e.data as { dgn?: unknown } | null)?.dgn !== 'place-image')
        return;
      const m = acceptFromShell(e, window);
      if (m?.dgn !== 'place-image' || isReadOnlyCanvas()) return;
      const r = imageRequestFrom(m);
      if (r) setReq(r);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!req || readOnly) return undefined;
    ensureStyles();
    let swallowClick = 0;
    const done = (ask: EditOpAsk | null) => {
      setReq(null);
      if (ask) void runImagePlace(req, ask, deps());
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      swallowClick = Date.now();
      const hit = artboardPointAt(document, e.clientX, e.clientY);
      if (!hit) {
        showCanvasToast(OUTSIDE_IMAGE_LINE, 'info');
        return;
      }
      done(askForImageAt(req, hit.artboard, hit.point));
    };
    const click = (e: MouseEvent) => {
      if (Date.now() - swallowClick < 600) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(null);
        return;
      }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      const artboard = pasteTarget(live.current.selSet.selected)?.artboard ?? null;
      const centre = pastePoint(artboard, null);
      if (!artboard || !centre) {
        showCanvasToast(NO_ARTBOARD_LINE, 'info');
        return;
      }
      done(askForImageAt(req, artboard, centre));
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [req, readOnly, deps]);

  if (!req || readOnly) return null;
  return (
    <div className="ed-place-image-hint" data-testid="edit-place-image-hint" role="status">
      {PLACE_IMAGE_HINT(req.label)}
    </div>
  );
}
