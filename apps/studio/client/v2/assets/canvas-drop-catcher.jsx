// client/v2/assets/canvas-drop-catcher.jsx — r3: while an Assets tile is dragged, a transparent catcher lies over the
// canvas frame and takes the drag (asset-drop-session.js says why: WebKit gives the canvas origin no event of a drag the
// shell started). It forwards the pointer to the canvas in the frame's own coordinates, so the canvas keeps drawing its
// ring on the picture / frame / artboard under it, and on drop the shell places the picture it started dragging.
// Mounted by the Viewport; renders nothing unless a tile drag is in flight. A Finder drag never raises it.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { assetDragSession, createCatcherLane, isAssetDrag } from './asset-drop-session.js';
import { placeAsset } from './place-asset.js';

export const CATCHER_TESTID = 'canvas-asset-drop-catcher';

/**
 * Nothing is placed by a person who may only look, nor while the canvas is shown at a past version (Version history's
 * Viewing) or through a design-system preview: the frame is not the live file, so a drop would write to a canvas the
 * person is not looking at.
 */
export function catcherReadOnly({ readOnly, role, viewing, canvasTab, dsPreview }) {
  return (
    !!readOnly ||
    role === 'observer' ||
    role === 'viewer' ||
    (!!viewing && viewing.path === canvasTab) ||
    !!dsPreview
  );
}

/**
 * @param props.frame        () => HTMLIFrameElement | null — the active canvas frame
 * @param props.canvas       the open canvas (what `image.place` writes)
 * @param props.canvasOrigin the canvas origin (absent = the split is off: the shell's own origin)
 * @param props.readOnly     nothing is placed by a person who may only look
 */
export function CanvasDropCatcher({ frame, canvas, canvasOrigin, readOnly }) {
  const drag = useSyncExternalStore(assetDragSession.subscribe, assetDragSession.current);
  const live = useRef({});
  live.current = { frame, canvas, canvasOrigin };
  const laneRef = useRef(null);
  if (!laneRef.current) {
    const origin = () => live.current.canvasOrigin || window.location.origin;
    const win = () => live.current.frame?.()?.contentWindow ?? null;
    const post = (msg) => {
      try {
        win()?.postMessage(msg, origin());
      } catch {
        /* the frame went away */
      }
    };
    laneRef.current = createCatcherLane({
      session: assetDragSession,
      canvas: () => live.current.canvas || null,
      post,
      accept: (e) => acceptFromCanvas(e, { canvasOrigin: origin(), active: win() }),
      // a legacy-link write hands the canvas its undo step (⌘Z); on the op log the write is a kernel action and this is not called
      place: (req) =>
        placeAsset(req, { record: (payload) => post({ dgn: 'record-edit', payload }) }),
    });
  }
  const lane = laneRef.current;

  useEffect(() => {
    const onMessage = (e) => void lane.onMessage(e);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      lane.dispose();
    };
  }, [lane]);
  // the drag ended (dropped, esc, or released elsewhere): the ring goes too
  useEffect(() => {
    if (!drag) lane.leave();
  }, [drag, lane]);

  if (!drag || !canvas || readOnly) return null;
  const local = (e) => {
    const r = live.current.frame?.()?.getBoundingClientRect();
    return r ? [e.clientX - r.left, e.clientY - r.top] : null;
  };
  return (
    // a transparent drop catcher that exists only while a tile is dragged — a pointer-only door (↵ on a tile is the keyboard way)
    <div
      data-testid={CATCHER_TESTID}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'transparent' }}
      onDragEnter={(e) => {
        // not a tile (a Finder drag, text): the session is stale; let the event through to whatever lies below
        if (!isAssetDrag(e)) return assetDragSession.end();
        e.preventDefault();
      }}
      onDragOver={(e) => {
        if (!isAssetDrag(e)) return assetDragSession.end();
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        const p = local(e);
        if (p) lane.over(p[0], p[1]);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        lane.leave();
      }}
      onDrop={(e) => {
        if (!isAssetDrag(e)) return assetDragSession.end();
        e.preventDefault();
        e.stopPropagation();
        const p = local(e);
        if (p) lane.drop(p[0], p[1]);
      }}
    />
  );
}
