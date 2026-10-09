// hooks/use-canvas-bridge.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SYSTEM_TAB, isModuleCanvasPath } from '../shell/constants.js';
import { acceptCanvasNotice } from '../../canvas-notice-message.ts';
import { notifyCanvasText } from '../../notifications.tsx';
import { browseFirstRunHint, layersTreeSig } from '../shell/util.js';
import { resolveToolCursor } from '../../canvas-cursors.ts';
import { afterRecordableWrites } from '../inspector/css-knobs.jsx';
import { applyEditRequest } from '../apply-edit-request.ts';
import { PHOTO_ASSET_RE } from '../inspector/inspector-panel.jsx';
import { sanitizeArtboardText } from '../panels/timeline-comp-target.js';
import { isNativeApp } from '../github.js';
import {
  browserCaptureEligible,
  captureDeckViaBrowser,
  captureScale,
  sanitizeCapturedItems,
} from '../export-lane.js';
import { downloadCapturedBlob } from '../dialogs/export-dialog.jsx';
import { moveLayerNode } from '../inspector/layers.jsx';
import { SCREEN_PRESETS, replacedValue } from '../inspector/css-vocab.jsx';
import { PAPER_PRESETS, resolvePrintArtboard } from '../../print/units.ts';

export function useCanvasBridge({
  activePath,
  selected,
  setSelected,
  selectedRef,
  lastLocalSelectAtRef,
  scheduleHaloRestore,
  scheduleArtboardResync,
  pendingReorderRef,
  lastLayersTreeRef,
  settlePendingSelectionRef,
  reorderLayerRef,
  repositionElementRef,
  resizeElementRef,
  layersBusyRef,
  layersBusyTimerRef,
  layersTree,
  setLayersTree,
  setLoadingPath,
  setCanvasError,
  setLoadedPath,
  cfg,
  viewerMode,
  commentsByFile,
  focusedCommentId,
  setFocusedCommentId,
  theme,
  setPaletteOpen,
  setExportDialog,
  setTimelineOpen,
  setActiveComps,
  setTimelineFrame,
  setTimelinePlaying,
  canvasActiveArtboard,
  setCanvasActiveArtboard,
  timelineFrameRef,
  timelineCompIdRef,
  setInspectorTab,
  setPhotoSel,
  openRightPanel,
  toggleRightPanel,
  maybeAutoOpenInspectorOnSelect,
  toggleTimeline,
  minimapVisible,
  zoomCtlVisible,
  presentMode,
  setPresentMode,
  setActiveArtboards,
  iframesRef,
  postToActiveCanvas,
  captureFromCanvas,
  broadcastChrome,
  wsSend,
  reloadActive,
}) {
  // ----- Inbound messages from iframes -----
  useEffect(() => {
    // Does this comment id belong to the canvas the user is actually looking
    // at? Scopes the patch/delete relays below — see the SECURITY note there.
    //
    // The leading `!!activePath` is load-bearing, not defensive noise: with no
    // active canvas the branches' `activeWin` is `null`, and `e.source` is also
    // `null` for a message whose source context was discarded before dispatch —
    // so `e.source === activeWin` can pass as `null === null`. This is the
    // second conjunct that closes that path. Don't "simplify" it away.
    const ownsActiveComment = (id) =>
      !!activePath && (commentsByFile[activePath] || []).some((c) => c && c.id === id);
    function onMessage(e) {
      // Cross-origin hardening (DDR-054): only accept dgn control messages from
      // the canvas-content origin — the split origin when on, else our own origin
      // for the same-origin iframe. Drops spoofed messages from any other window.
      // Every canvas iframe shares that origin, so the check below proves only
      // "a canvas said this", NOT "the canvas the user is looking at said it" —
      // each mutating branch additionally gates on `e.source === activeWin`.
      const expectedOrigin = cfg?.canvasOrigin || window.location.origin;
      if (e.origin !== expectedOrigin) return;
      const m = e.data;
      if (!m || typeof m !== 'object' || !m.dgn) return;
      if (m.dgn === 'canvas-notice') {
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        const notice = acceptCanvasNotice(e, expectedOrigin, activeWin);
        if (notice) notifyCanvasText(notice.title, notice.kind);
        return;
      }
      if (m.dgn === 'tool-cursor') {
        // Phase 24 — show the active canvas tool's cursor across the WHOLE app
        // shell (sidebar, top bar, everything) so the custom cursor is visible
        // everywhere in maude, not just inside the canvas iframe. The canvas
        // sends only a tool TOKEN; we resolve it to a cursor string from our own
        // trusted map (resolveToolCursor) and apply THAT — never a raw
        // canvas-supplied value. A malicious synced canvas (DDR-054) can thus
        // only pick a known, always-visible glyph; it cannot inject an
        // invisible/displaced SVG cursor as a clickjacking aid over the un-CSP'd
        // shell (phase-24 ethical-hacker Finding 2; DDR-067).
        // feature-4 — the browse tool is a pure pass-through: don't force a
        // global shell cursor, so the shell chrome keeps its own affordance
        // cursors (pointer over buttons). Also fire the one-time "press V" hint
        // — a live canvas booting in browse is exactly when it's teachable.
        if (m.tool === 'browse') {
          document.body.style.cursor = '';
          const el = document.getElementById('dc-app-cursor');
          if (el) el.textContent = '';
          browseFirstRunHint(viewerMode);
          return;
        }
        const cursor = resolveToolCursor(m.tool);
        if (cursor) {
          document.body.style.cursor = cursor;
          let el = document.getElementById('dc-app-cursor');
          if (!el) {
            el = document.createElement('style');
            el.id = 'dc-app-cursor';
            document.head.appendChild(el);
          }
          el.textContent = `* { cursor: ${cursor} !important; }`;
        }
        return;
      }
      // SECURITY (attacker Finding 2, mirrors the phase-28 F-2 reorder/present
      // gate at the handlers below): selection posts are honored ONLY from the
      // ACTIVE canvas's window. Every open canvas iframe shares one
      // `canvasOrigin`, so the origin check above can't tell the foreground
      // canvas from a background/synced one — and a selection carries an
      // attacker-chosen `file` that the server trusts verbatim and write-throughs
      // into the persistent per-canvas `selections` map, then rides into the
      // auto-approving ACP agent's frozen context. A background (untrusted, DDR-054)
      // canvas must not be able to plant a selection with no user gesture. The
      // user can only click the visible active canvas, so a non-active source is
      // never a legitimate selection.
      //
      // The SAME gate now covers the privileged SOURCE-WRITE relays — `edit-text`
      // (inline text commit) and `apply-edit` (undo/redo re-application). Both
      // ride into a main-origin `.tsx` rewrite; a write path is strictly more
      // dangerous than a selection, yet was previously ungated (ethical-hacker
      // F-B, DDR-160 follow-up). A background/synced untrusted canvas (DDR-054)
      // must not drive a gestureless write into another canvas — and inline edits
      // + Cmd+Z always originate in the ACTIVE canvas the user is looking at, so
      // a non-active source is never legitimate here either.
      if (
        m.dgn === 'select' ||
        m.dgn === 'select-set' ||
        m.dgn === 'clear-select' ||
        m.dgn === 'edit-text' ||
        m.dgn === 'apply-edit' ||
        m.dgn === 'undo-barrier'
      ) {
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        if (e.source !== activeWin) return;
      }
      if (m.dgn === 'select' && m.selection) {
        setPhotoSel(null); // a DOM selection supersedes an annotation-image Photo target
        lastLocalSelectAtRef.current = Date.now();
        wsSend({ type: 'select', selection: m.selection });
        setSelected(m.selection);
        maybeAutoOpenInspectorOnSelect(m.selection); // Stage C
      } else if (m.dgn === 'select-set') {
        setPhotoSel(null);
        lastLocalSelectAtRef.current = Date.now();
        // Canvas multi-select. Payload shape:
        //   null              → empty selection
        //   Selection         → length-1 (back-compat with legacy single-element shape)
        //   Selection[]       → N > 1
        // For shell purposes we track the focused entry (head of array, or
        // the bare object) — comments + halo only act on one element at a
        // time today. Multi-target editing is an explicit Phase-4.1 non-goal.
        const payload = m.selection;
        if (payload == null) {
          wsSend({ type: 'clear-select' });
          setSelected(null);
        } else if (Array.isArray(payload)) {
          const head = payload[0] ?? null;
          if (head) wsSend({ type: 'select', selection: head });
          setSelected(head);
          // Stage C — auto-open only for a genuine SINGLE selection, never multi.
          if (payload.length === 1) maybeAutoOpenInspectorOnSelect(head);
        } else {
          wsSend({ type: 'select', selection: payload });
          setSelected(payload);
          maybeAutoOpenInspectorOnSelect(payload); // Stage C
        }
      } else if (m.dgn === 'clear-select') {
        setPhotoSel(null);
        lastLocalSelectAtRef.current = Date.now();
        wsSend({ type: 'clear-select' });
        setSelected(null);
      } else if (m.dgn === 'edit-text' && m.id) {
        // Phase 12 (DDR-103) — inline text edit committed in the canvas. POST to
        // the main-origin-only /_api/edit-text → editText writes the escaped
        // JSXText to source; the file-watcher HMR reload then shows the new text.
        // DDR-150 P1: a refusal is NO LONGER silent — post `edit-reverted` back
        // to the canvas, which reverts the optimistic contenteditable text AND
        // toasts the reason, so a failed edit can't silently vanish on the next
        // reload ("my text edit didn't stick"). The user-facing toast lives
        // canvas-side (showCanvasToast) because App has no in-scope status
        // surface — `setStatus` belongs to ExportDialog, not App.
        const editSource = e.source;
        const revert = (reason) => {
          try {
            editSource?.postMessage({ dgn: 'edit-reverted', op: 'text', id: m.id, reason }, '*');
          } catch {}
        };
        fetch('/_api/edit-text', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            canvas: m.file,
            id: m.id,
            text: m.text ?? '',
            // Context for editing `{variable}` text — which rendered instance +
            // its pre-edit text, so the engine targets the right source string.
            ...(typeof m.occurrence === 'number' ? { occurrence: m.occurrence } : {}),
            ...(typeof m.before === 'string' ? { before: m.before } : {}),
          }),
        })
          .then((r) => r.json().catch(() => ({})))
          .then((j) => {
            if (!j.ok) revert(j.error || "this element can't be edited inline");
          })
          .catch(() => revert('network error'));
      } else if (m.dgn === 'undo-barrier' && typeof m.requestId === 'string') {
        // Answer once every write that will post a `record-edit` has settled
        // (and so posted it — window messages arrive in order), so the canvas's
        // Cmd+Z sees the edit that is on screen. Read-only; nothing is written.
        const source = e.source;
        Promise.all([editApplyChainRef.current.catch(() => {}), afterRecordableWrites()]).then(
          () => {
            try {
              source?.postMessage({ dgn: 'undo-barrier-ok', requestId: m.requestId }, '*');
            } catch {}
          }
        );
      } else if (
        m.dgn === 'apply-edit' &&
        m.id &&
        (m.op === 'css' || m.op === 'text' || m.op === 'attr')
      ) {
        // Inline-edit undo/redo (DDR-103/104 follow-up). The canvas iframe's
        // `edit-source` command can't call the main-origin-only `/_api/edit-*`
        // routes (DDR-054), so it asks us to re-apply the before/after value.
        // `value` null = reset (remove the inline prop / attr). The css/attr
        // request carries the command's expected current value, so an undo can
        // never overwrite a teammate's newer value (audit 2026-09-13 P1 #5);
        // the outcome goes back to the canvas so a refused undo/redo does not
        // advance its stack.
        const req = applyEditRequest(m);
        if (!req) return;
        const replyTo = e.source;
        const reply = (result) => {
          if (typeof m.requestId !== 'string') return;
          try {
            replyTo?.postMessage(
              { dgn: 'apply-edit-result', requestId: m.requestId, ...result },
              '*'
            );
          } catch {}
        };
        const value = typeof m.value === 'string' ? m.value : null;
        editApplyChainRef.current = editApplyChainRef.current
          .catch(() => {})
          .then(() =>
            fetch(req.url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(req.body),
            })
              .then((r) => r.json().catch(() => ({})))
              .then((j) => {
                if (j.ok) {
                  // Repaint only once the source accepted it: a refused undo
                  // must not show a value the file does not hold.
                  if (req.op === 'css') applyOptimisticStyle({ id: m.id, prop: m.key, value });
                  reply({ ok: true });
                  return;
                }
                console.warn('[apply-edit]', req.op, j.error || 'failed');
                reply({ ok: false, error: j.error || 'failed', conflict: j.conflict === true });
              })
              .catch(() => reply({ ok: false, error: 'network error' }))
          );
      } else if (m.dgn === 'layers-tree') {
        // Phase 12 Task 4 — browsable layers tree for the active artboard.
        setLayersTree({ artboardId: m.artboardId, nodes: Array.isArray(m.tree) ? m.tree : [] });
        const sig = layersTreeSig(m.tree);
        lastLayersTreeRef.current = { tree: m.tree, sig, artboardId: m.artboardId ?? null };
        // fresh tree (correct ids) landed — drags OK again
        layersBusyRef.current = false;
        if (layersBusyTimerRef.current) {
          clearTimeout(layersBusyTimerRef.current);
          layersBusyTimerRef.current = null;
        }
        // Phase 12.1 — a reorder writes source → SOFT HMR (no dgn:'loaded' fires,
        // so the loaded-handler re-select never runs). The live observer's fresh
        // tree is our signal instead: re-select the moved element by its NEW
        // positional id (movedId) so the selection halo + the keyboard cursor
        // follow it. Without this the next Alt+arrow acts on the STALE id, which
        // positionally now points at a different element. Only act once the tree
        // actually CONTAINS movedId — an in-canvas drag posts a PREVIEW tree
        // first (old ids, pre-write); consuming then would re-select nothing and
        // burn the pending ref before the real post-HMR tree lands.
        settlePendingSelectionRef.current?.(m.tree, sig, m.artboardId ?? null);
      } else if (m.dgn === 'reorder-revert') {
        // Phase 12.1 follow-up — Cmd+Z/Cmd+Shift+Z on a reorder. The canvas undo
        // stack (untrusted iframe) can't reach the main-origin-only
        // /_api/reorder-revert, so it REQUESTS; the shell writes. Active canvas
        // only. SECURITY (adversarial F4): pin the target to `activePath` — do NOT
        // forward m.canvas (an untrusted iframe could name a different canvas); the
        // undo stack is per active canvas anyway, and the server's seq→entry.abs +
        // 409 content-match are the backstop.
        const rvWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const rvShape = typeof m.seq === 'number' && (m.dir === 'undo' || m.dir === 'redo');
        if (e.source === rvWin && rvShape && activePath) {
          layersBusyRef.current = true;
          if (layersBusyTimerRef.current) clearTimeout(layersBusyTimerRef.current);
          layersBusyTimerRef.current = setTimeout(() => {
            layersBusyRef.current = false;
            layersBusyTimerRef.current = null;
          }, 700);
          fetch('/_api/reorder-revert', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ canvas: activePath, seq: m.seq, dir: m.dir }),
          })
            .then((r) => r.json().catch(() => ({})))
            .then((j) => {
              if (!j.ok) console.warn('[reorder-revert]', j.error || 'failed');
            })
            .catch(() => {});
        }
      } else if (m.dgn === 'reorder-request') {
        // Phase 12.1 (DDR-138) — the in-canvas ReorderGrip (untrusted canvas
        // iframe) can't reach the main-origin-only /_api/reorder (DDR-054), so it
        // REQUESTS a move; the shell performs the privileged write via reorderLayer
        // (same lane as edit-text → /_api/edit-text). Honor it ONLY from the ACTIVE
        // canvas (a background tab's untrusted canvas must not mutate source), and
        // only for well-formed ids/position (reorderLayer + the server re-validate).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okShape =
          typeof m.id === 'string' &&
          typeof m.refId === 'string' &&
          (m.position === 'before' ||
            m.position === 'after' ||
            m.position === 'inside-start' ||
            m.position === 'inside-end');
        if (e.source === activeWin && okShape) {
          reorderLayerRef.current?.(m.id, m.refId, m.position, {
            idIndex: Number.isInteger(m.idIndex) ? m.idIndex : undefined,
            refIndex: Number.isInteger(m.refIndex) ? m.refIndex : undefined,
          });
        }
      } else if (m.dgn === 'reposition-request') {
        // Free-XY reposition for out-of-flow elements (position:absolute/
        // fixed) — the in-canvas drag switches from reorder-mode to
        // coordinate-mode when the dragged element is out of flow, because
        // reordering an absolute/fixed element's JSX siblings never changes
        // where it paints (the "moves then snaps back" RCA). Same trust
        // model + confused-deputy guard as reorder-request: untrusted canvas
        // REQUESTS, shell WRITES, pinned to the ACTIVE canvas (never
        // `m.canvas`, which an untrusted iframe could spoof).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okShape =
          typeof m.id === 'string' &&
          Number.isFinite(m.left) &&
          Number.isFinite(m.top) &&
          Number.isFinite(m.beforeLeft) &&
          Number.isFinite(m.beforeTop);
        if (e.source === activeWin && okShape) {
          repositionElementRef.current?.(
            m.id,
            m.left,
            m.top,
            m.beforeLeft,
            m.beforeTop,
            Number.isInteger(m.idIndex) ? m.idIndex : undefined
          );
        }
      } else if (m.dgn === 'resize-request') {
        // feature-element-editing-robustness Stage D — in-canvas drag-resize
        // commit. Same trust model + confused-deputy guard as reposition-request:
        // untrusted canvas REQUESTS, shell WRITES, pinned to the ACTIVE canvas
        // (never `m.canvas`). Payload: { id, patch:{width,height,left?,top?},
        // before:{width,height,left,top} } — px strings, before values null when
        // the prop was unset (reset on undo).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okShape = typeof m.id === 'string' && m.patch && typeof m.patch === 'object';
        if (e.source === activeWin && okShape) {
          resizeElementRef.current?.(
            m.id,
            m.patch,
            m.before,
            Number.isInteger(m.idIndex) ? m.idIndex : undefined
          );
        }
      } else if (m.dgn === 'delete-request') {
        // feature-element-editing-robustness Stage I — delete an element (Del key
        // / context menu / toolbar in the canvas). Same confused-deputy guard as
        // reorder/reposition/resize: untrusted canvas REQUESTS, shell WRITES,
        // pinned to the ACTIVE canvas (never `m.canvas`).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.id === 'string') {
          deleteElementShellRef.current?.(
            m.id,
            Number.isInteger(m.idIndex) ? m.idIndex : undefined
          );
        }
      } else if (m.dgn === 'duplicate-request') {
        // Cmd+D (Task L3) — duplicate the selected element. Confused-deputy gated
        // + pinned to the active canvas, like the other structural verbs.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.id === 'string') {
          duplicateElementShellRef.current?.(
            m.id,
            Number.isInteger(m.idIndex) ? m.idIndex : undefined
          );
        }
      } else if (m.dgn === 'copy-style') {
        // Task L4 — capture the current selection's authored style (shell-side).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) copyStyleRef.current?.();
      } else if (m.dgn === 'paste-style') {
        // Task L4 — apply the copied style to the target element.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.id === 'string') pasteStyleRef.current?.(m.id);
      } else if (m.dgn === 'insert-request') {
        // Stage I3 — insert a synthesized div/text/image relative to `refId`,
        // OR — empty-artboard fallback (tool-palette "+ Element" on a fresh
        // artboard with no elements yet) — as a child of `artboardId`. Exactly
        // one of the two must be present; the artboardId variant only makes
        // sense inside-start/inside-end (no sibling to be before/after).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const hasRefId = typeof m.refId === 'string';
        const hasArtboardId = typeof m.artboardId === 'string';
        const okPosition =
          m.position === 'before' ||
          m.position === 'after' ||
          m.position === 'inside-start' ||
          m.position === 'inside-end';
        const okShape =
          hasRefId !== hasArtboardId &&
          (m.kind === 'div' || m.kind === 'text' || m.kind === 'image') &&
          okPosition &&
          (!hasArtboardId || m.position === 'inside-start' || m.position === 'inside-end');
        if (e.source === activeWin && okShape) {
          insertElementShellRef.current?.(m.refId, m.position, m.kind, {
            artboardId: hasArtboardId ? m.artboardId : undefined,
            src: typeof m.src === 'string' ? m.src : undefined,
            refIndex: Number.isInteger(m.refIndex) ? m.refIndex : undefined,
          });
        }
      } else if (m.dgn === 'insert-image-request') {
        // Stage F/I3 — "Insert ▸ Image" from the canvas context menu, or the
        // tool-palette's Image tool (`artboardId` in place of `refId` for its
        // empty-artboard fallback, or NEITHER when the canvas has no artboard
        // at all — feature-bulk-media-insert). An image needs a contained
        // asset src, so the shell opens the AssetPicker in bulk mode; the
        // confirm then drives insertElementShell(kind:'image') per path (Task
        // 10) or a single batched annotation insert. Confused-deputy gated +
        // pinned to the active canvas like the other request verbs.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const hasRefId = typeof m.refId === 'string';
        const hasArtboardId = typeof m.artboardId === 'string';
        const noAnchor = !hasRefId && !hasArtboardId;
        const okShape =
          (hasRefId !== hasArtboardId || noAnchor) &&
          (noAnchor ||
            m.position === 'before' ||
            m.position === 'after' ||
            m.position === 'inside-start' ||
            m.position === 'inside-end') &&
          (!hasArtboardId || m.position === 'inside-start' || m.position === 'inside-end');
        if (e.source === activeWin && okShape) {
          openAssetPickerRef.current?.({
            purpose: 'insert-image',
            canvas: activePath,
            refId: m.refId,
            artboardId: hasArtboardId ? m.artboardId : undefined,
            position: noAnchor ? undefined : m.position,
            refIndex: Number.isInteger(m.refIndex) ? m.refIndex : undefined,
            multiple: true,
            // Artboard destination is possible whenever there's ANY resolvable
            // anchor — a refId (context-menu, or the tool-palette's normal
            // last-element case) inserts inside the SAME artboard that
            // element already lives in, not just the artboardId fallback.
            hasArtboardAnchor: !noAnchor,
          });
        }
      } else if (m.dgn === 'replace-media-request') {
        // Stage F2 — "Replace image…" from the canvas context menu. Opens the
        // AssetPicker in replace mode; the pick re-points src via edit-attr. The
        // context menu supplies the current src as the undo before-value.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.id === 'string') {
          openAssetPickerRef.current?.({
            purpose: 'replace-src',
            canvas: activePath,
            id: m.id,
            before: typeof m.before === 'string' ? m.before : null,
          });
        }
      } else if (m.dgn === 'convert-to-absolute-request') {
        // feature-4 T8 (convert-to-absolute, DDR-188) — the canvas measured the
        // frozen child boxes; perform the main-origin batch write (ONE undo
        // seq via structuralWrite). The server re-validates every field; here we
        // just confused-deputy-guard the source (DDR-054) + a light shape check.
        // Two shapes: single-container (element context menu) or `containers`
        // batch (the artboard-level "Convert layout to absolute").
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const isBatch = Array.isArray(m.containers) && m.containers.length > 0;
        const isSingle =
          typeof m.containerId === 'string' && Array.isArray(m.children) && m.children.length > 0;
        if (e.source === activeWin && (isBatch || isSingle)) {
          const count = isBatch
            ? m.containers.reduce(
                (n, c) => n + (Array.isArray(c?.children) ? c.children.length : 0),
                0
              )
            : m.children.length;
          structuralWriteRef.current?.(
            '/_api/convert-to-absolute',
            isBatch
              ? {
                  allowShared: m.allowShared === true,
                  containers: m.containers,
                  // feature-4 TRUE FLATTEN — unstyled layout wrappers to remove.
                  ...(Array.isArray(m.dissolve) && m.dissolve.length > 0
                    ? { dissolve: m.dissolve }
                    : {}),
                }
              : {
                  containerId: m.containerId,
                  containerSetRelative: m.containerSetRelative === true,
                  // feature-4 T8b — the canvas asked the user's confirm already;
                  // the server still refuses `.map` children regardless.
                  allowShared: m.allowShared === true,
                  children: m.children,
                },
            {
              label: 'convert to absolute',
              // Dogfood 2026-07-19 — the conversion is zero-visual-delta by
              // design, which LOOKED like "nic nedělá". Say what happened, and
              // surface server refusals (.map children etc.) as a toast
              // instead of a console.warn nobody sees.
              onOk: () => {
                postToActiveCanvas({ dgn: 'selection-clear' });
                postToActiveCanvas({
                  dgn: 'op-toast',
                  message: `Converted ${count} element${count === 1 ? '' : 's'} to absolute — press V and drag them freely (⌘Z to undo).`,
                });
              },
              onFail: (j) =>
                postToActiveCanvas({
                  dgn: 'op-toast',
                  message: `Convert failed: ${j?.error || 'unknown error'}`,
                }),
            }
          );
        }
      } else if (m.dgn === 'replace-annotation-media-request') {
        // Stage F3 — "Replace…" on an annotation ImageStroke/MediaRefStroke.
        // Opens the SAME AssetPicker; unlike F2 the pick is posted BACK DOWN to
        // the canvas (no data-cd-id to ride edit-attr — the annotation model owns
        // its own strokes, so the canvas iframe performs the write itself).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.id === 'string') {
          openAssetPickerRef.current?.({
            purpose: 'replace-annotation-media',
            canvas: activePath,
            id: m.id,
            before: typeof m.before === 'string' ? m.before : null,
          });
        }
      } else if (m.dgn === 'edit-annotation-photo-request') {
        // feature-photo-editor (Task 17) — "Edit Photo…" on an annotation
        // ImageStroke. The annotation model has no data-cd-id / DOM selection, so
        // it can't ride the normal select path; instead the canvas posts its
        // `assets/<sha8>.<ext>` href up and the shell opens the Photo-only tab on
        // it. Same confused-deputy gate (DDR-054) + active-canvas pin as F3.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const asset = PHOTO_ASSET_RE.exec(typeof m.asset === 'string' ? m.asset : '')?.[0] || null;
        if (e.source === activeWin && typeof m.id === 'string' && asset) {
          setPhotoSel({ asset, strokeId: m.id });
          openRightPanel('inspector');
          setInspectorTab('photo');
        }
      } else if (m.dgn === 'open-sticker-picker') {
        // Phase 4 (whiteboard-improvements) — the toolbar's Stickers button.
        // Confused-deputy gated + pinned to the active canvas like the other
        // request verbs above.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) {
          openStickerPickerRef.current?.({ canvas: activePath });
        }
      } else if (m.dgn === 'insert-artboard-request') {
        // Stage I4 — insert a new empty artboard from a screen-size preset.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okShape =
          typeof m.id === 'string' && Number.isFinite(m.width) && Number.isFinite(m.height);
        if (e.source === activeWin && okShape) {
          insertArtboardShellRef.current?.({
            id: m.id,
            label: typeof m.label === 'string' ? m.label : m.id,
            width: m.width,
            height: m.height,
          });
        }
      } else if (m.dgn === 'resize-artboard-request') {
        // Stage D4 — free-hand artboard resize (numeric width/height props).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okShape =
          typeof m.artboardId === 'string' &&
          (Number.isFinite(m.width) || Number.isFinite(m.height));
        if (e.source === activeWin && okShape) {
          resizeArtboardShellRef.current?.(
            m.artboardId,
            Number.isFinite(m.width) ? m.width : undefined,
            Number.isFinite(m.height) ? m.height : undefined
          );
        }
      } else if (m.dgn === 'delete-artboard-request') {
        // Backspace / context-menu delete of a whole artboard (by its id prop).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && typeof m.artboardId === 'string') {
          deleteArtboardShellRef.current?.(m.artboardId);
        }
      } else if (m.dgn === 'rename-artboard-request') {
        // Plan T25/L08 — double-click an artboard's name to rename it. Same
        // confused-deputy guard: the canvas asks, the shell writes the active
        // canvas only.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (
          e.source === activeWin &&
          typeof m.artboardId === 'string' &&
          typeof m.label === 'string' &&
          m.label.trim()
        ) {
          structuralWriteRef.current?.(
            '/_api/set-artboard-label',
            { artboardId: m.artboardId, label: m.label.slice(0, 80) },
            { label: 'rename artboard' }
          );
        }
      } else if (m.dgn === 'set-artboard-kind-request') {
        // feature-1-artboard-kinds-foundation, T8 — context-menu "Artboard
        // kind" submenu (inside the untrusted iframe). `kind: null` clears
        // back to the implicit default.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const okKind = m.kind === null || typeof m.kind === 'string';
        if (e.source === activeWin && typeof m.artboardId === 'string' && okKind) {
          // Dogfood round 6 — DIRECT write, never back into the ask flow (the
          // ask lives shell-side in setArtboardKindShell; re-entering it from
          // this canvas round-trip looped the confirm dialog forever).
          directArtboardKindWriteRef.current?.(m.artboardId, m.kind);
        }
      } else if (m.dgn === 'duplicate-artboard-request') {
        // feature-3-web-artboards T3 — context-menu "Duplicate at width…"
        // submenu (inside the untrusted iframe).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (
          e.source === activeWin &&
          typeof m.artboardId === 'string' &&
          Number.isFinite(m.width)
        ) {
          duplicateArtboardShellRef.current?.(m.artboardId, m.width);
        }
      } else if (m.dgn === 'open-inspector') {
        // Phase 12 — context-menu "Inspect" / tool-palette Inspect opens the right panel.
        // feature-photo-editor (Task 16) — an optional `tab` lands the panel on a
        // specific tab (the element "Edit Photo…" entry passes `tab: 'photo'`; the
        // img is already selected via select-set, so the Photo tab derives its
        // target from that selection's `photoAsset`).
        openRightPanel('inspector');
        if (typeof m.tab === 'string') setInspectorTab(m.tab);
      } else if (m.dgn === 'present-enter') {
        // Canvas tool-palette "Presentation mode" button — Present Mode is a
        // shell-level state (hides the menubar / sidebar / panels), so the
        // canvas requests it here and the shell flips it on + broadcasts
        // dgn:'view-chrome' back to every iframe. Enter-only (the palette is
        // hidden while presenting); exit is Esc or the floating pill. The
        // inbound origin gate above (DDR-054) already authenticates the canvas.
        // Hardening (phase-28 audit F-2): honor it ONLY from the ACTIVE canvas
        // (a background tab's untrusted canvas must not flip the foreground),
        // and NEVER while a modal dialog is open — present mode hides Sidebar-
        // descendant modals (OAuth device-code / Share-invite), so an untrusted
        // canvas could otherwise blank an in-flight confirmation.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        const modalOpen = !!document.querySelector('[role="dialog"][aria-modal="true"]');
        if (e.source === activeWin && !modalOpen && !presentMode) {
          setPresentMode(true);
          broadcastChrome({ present: true });
        }
      } else if (m.dgn === 'comment-compose' && m.selection) {
        // Phase 6 — the iframe overlay owns the composer surface now. The
        // shell just mirrors `selected` so the StatusBar / sidebar still
        // reflect the target, and skips the legacy `startDraftFor` path that
        // opened the shell-side composer. Legacy `.html` mocks (no
        // canvas-shell mount) fall through to the same path; they lose the
        // shell composer in this phase. Acceptable per Phase 6 scope.
        setSelected(m.selection);
      } else if (m.dgn === 'comment-submit' && m.payload && typeof m.payload.text === 'string') {
        // Phase 6 — iframe overlay finished composing. Relay through the
        // existing WS `comments-add` channel; server-side persistence +
        // broadcast back are identical to the legacy shell-composer flow.
        //
        // SECURITY — gated on `activeWin` and PINNED to `activePath`, the same
        // shape as every other mutating branch in this handler. The origin
        // check at the top passes for EVERY canvas iframe (they all share
        // `canvasOrigin`), so without this a canvas sitting in a BACKGROUND
        // tab could post comments onto any file it cared to name, with no user
        // gesture. This handler's preamble waived that on the grounds that
        // comments are an "inert store" — the ACP panel's one-click
        // "Implement N comments" action retires that premise, because open
        // comments are now a feed the agent acts on. `p.file` is ignored
        // rather than validated: the active canvas is the only file the user
        // can actually see themselves commenting on.
        const p = m.payload;
        const txt = String(p.text).trim();
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && txt && activePath && activePath !== SYSTEM_TAB) {
          wsSend({
            type: 'comments-add',
            payload: {
              file: activePath,
              selector: p.selector,
              index: p.index,
              dom_path: p.dom_path,
              tag: p.tag,
              classes: p.classes,
              bounds: p.bounds,
              html_excerpt: p.html_excerpt,
              // #134/#136 anchors — shape-checked server-side (api.ts commentsAdd).
              annotationId: p.annotationId,
              world: p.world,
              text: txt,
            },
          });
        }
      } else if (m.dgn === 'comment-patch' && m.id && m.patch && typeof m.patch === 'object') {
        // Phase 6 — thread popover routes resolve / reopen through here.
        // SECURITY — same gate as comment-submit, plus an ownership check: a
        // bare id would otherwise reach ANY comment in the project. Patch and
        // delete change or remove somebody else's note, which is exactly why
        // ws.ts refuses both for a viewer session; the iframe lane needs the
        // matching restriction.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && ownsActiveComment(m.id)) {
          wsSend({ type: 'comments-patch', id: m.id, patch: m.patch });
        }
      } else if (m.dgn === 'comment-delete' && m.id) {
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin && ownsActiveComment(m.id)) {
          wsSend({ type: 'comments-delete', id: m.id });
          setFocusedCommentId((prev) => (prev === m.id ? null : prev));
        }
      } else if (m.dgn === 'comment-click' && m.id) {
        setFocusedCommentId(m.id);
      } else if (m.dgn === 'artboards' && typeof m.count === 'number') {
        // P2 (Plan C) — optional iframe-reported artboard count; overrides the
        // meta.json-derived seed when the canvas knows better. Clamp.
        const n = Math.round(m.count);
        if (Number.isFinite(n) && n >= 0 && n <= 999) setActiveArtboards(n);
      } else if (m.dgn === 'active-artboard') {
        // DDR-148 — canvas-lib reports the viewport-active artboard on pan. Gate
        // to the ACTIVE canvas window (a background canvas must not hijack the
        // Timeline's target). The Timeline re-parses to this artboard's comp.
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        if (e.source !== activeWin) return;
        // Neutralize + cap exactly like the sibling timeline-comps handler —
        // this id is matched AGAINST that one, so both sides must go through
        // the same normalization or an odd-but-legal id would never match.
        setCanvasActiveArtboard(sanitizeArtboardText(m.id));
      } else if (m.dgn === 'timeline-comps' && Array.isArray(m.comps)) {
        // DDR-148 — a video-comp announces its comp meta (from video-comp.tsx).
        // Gate to the ACTIVE canvas window (phase-28 F-2 pattern): a background
        // canvas must not plant comps into the Timeline panel, which shows the
        // active canvas's comps. Inert display, but keep the seam closed.
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        if (e.source !== activeWin) return;
        const safe = m.comps
          .filter((c) => c && typeof c.id === 'string')
          .slice(0, 32)
          .map((c) => ({
            id: String(c.id).slice(0, 120),
            fps: Math.max(1, Math.min(120, Math.round(Number(c.fps) || 30))),
            durationInFrames: Math.max(
              1,
              Math.min(1_000_000, Math.round(Number(c.durationInFrames) || 1))
            ),
            width: Math.max(1, Math.round(Number(c.width) || 0)),
            height: Math.max(1, Math.round(Number(c.height) || 0)),
            // The enclosing artboard (issue #75) — the key the transport target
            // is resolved on, and (the label) shell chrome the user reads. This
            // is untrusted canvas-origin text, so neutralize the bidi/zero-width
            // class HERE, at the boundary, and every downstream consumer
            // inherits a clean value (security-review 2026-08-12).
            artboardId: sanitizeArtboardText(c.artboardId),
            artboardLabel: sanitizeArtboardText(c.artboardLabel),
          }));
        setActiveComps(safe);
        // rca/issue-video-artboard-frame-reset-on-edit — the SAME comp
        // re-announcing means its Player just remounted (an edit-triggered
        // HMR remount, or a ⌘R hard iframe reload that wiped video-comp.tsx's
        // own module-scope frame mirror too). The shell's `timelineFrame`
        // survives either way (this component doesn't remount) — push it back
        // down so the fresh Player opens where the Timeline left off, instead
        // of the poster-frame default. Skip on a genuinely new comp/canvas
        // (no prior id, or frame still at its post-switch 0).
        const prevCompId = timelineCompIdRef.current;
        const stillPresent = prevCompId && safe.some((c) => c.id === prevCompId);
        if (stillPresent && timelineFrameRef.current > 0) {
          postToActiveCanvas({
            dgn: 'timeline-seek',
            frame: timelineFrameRef.current,
            id: prevCompId,
          });
        }
      } else if (m.dgn === 'timeline-frame' && typeof m.frame === 'number') {
        // Live playhead mirror from the Player (preview scrub/playback).
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        if (e.source !== activeWin) return;
        // Only the Timeline's target comp drives the playhead — a sibling
        // artboard's Player must not fight it for the readout (multi-comp canvas).
        if (m.id && timelineCompIdRef.current && m.id !== timelineCompIdRef.current) return;
        if (Number.isFinite(m.frame)) setTimelineFrame(Math.max(0, Math.round(m.frame)));
      } else if (m.dgn === 'timeline-ended') {
        // The Player stopped itself at the last frame (loop off) — resync the
        // shell's Play/Pause button, which otherwise has no way to learn
        // playback ended on its own (rca/issue-video-artboard-loop-defaults-on).
        const activeWin =
          activePath && activePath !== SYSTEM_TAB
            ? iframesRef.current.get(activePath)?.contentWindow
            : null;
        if (e.source !== activeWin) return;
        if (m.id && timelineCompIdRef.current && m.id !== timelineCompIdRef.current) return;
        setTimelinePlaying(false);
      } else if (m.dgn === 'toggle-palette') {
        // ⌘K pressed while focus was inside the canvas iframe — the injected
        // inspector forwards the chord here since the iframe's keydown never
        // reaches the shell's window listener. Mirror that handler's toggle.
        setPaletteOpen((v) => !v);
      } else if (m.dgn === 'shell-shortcut') {
        // Same forwarding lane for the other shell chords (inspect.ts) — so
        // ⌘R / ⌘⇧I / ⌘⇧M / ⌘⇧E / ⌘⇧H behave identically wherever focus is.
        //
        // SECURITY — every one of these is a chord the user pressed INSIDE the
        // canvas they are looking at, so it gets the same `activeWin` gate as
        // its siblings. Ungated, a background canvas could reload the active
        // file out from under an edit or pop the Export/Handoff dialog on
        // demand — a modal-timing primitive, and the mirror image of the
        // present-enter branch that was already hardened against modal HIDING.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) {
          if (m.id === 'reload') reloadActive();
          else if (m.id === 'inspector') toggleRightPanel('inspector');
          else if (m.id === 'assistant' && isNativeApp()) toggleRightPanel('assistant');
          else if (m.id === 'comments') toggleRightPanel('comments');
          else if (m.id === 'changes') toggleRightPanel('changes');
          else if (m.id === 'timeline') toggleTimeline();
          else if (m.id === 'export') setExportDialog({ mode: 'export' });
          else if (m.id === 'handoff') setExportDialog({ mode: 'handoff' });
        }
      } else if (m.dgn === 'open-export') {
        // Plan C — the in-canvas toolbar / context menu route here so they open
        // the SAME shell Export dialog as the menubar (one look, all settings).
        // Carry the context-menu's scope hint (e.g. "Export selection").
        //
        // SECURITY — gated with `shell-shortcut` above rather than separately:
        // both reach the same `setExportDialog`, so leaving this one open would
        // hand back the capability the other now refuses.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) {
          setExportDialog({
            mode: 'export',
            scope: m.detail && typeof m.detail.scope === 'string' ? m.detail.scope : undefined,
          });
        }
      } else if (m.dgn === 'open-timeline-request') {
        // Artboard-chrome context menu's "Open Timeline" (video-comp artboards
        // only). Scope the Timeline to the right-clicked artboard, then open it.
        // SECURITY — same class: a context-menu action from the canvas in view.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) {
          if (typeof m.artboardId === 'string') setCanvasActiveArtboard(m.artboardId.slice(0, 120));
          setTimelineOpen(true);
        }
      } else if ((m.dgn === 'canvas-rendered' || m.dgn === 'canvas-failed') && m.file) {
        // The canvas drew (or its shell is now showing its own build error) —
        // only now drop the loading screen. See `loaded` below for why that
        // one is not enough. Only from the frame IN VIEW, like every branch
        // that changes what the user sees (review F5).
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source === activeWin) setLoadingPath((p) => (p === m.file ? null : p));
      } else if (m.dgn === 'loaded' && m.file) {
        // The shell document ran — push current comments + carry over the
        // focused pin. For a TSX/JSX canvas this is NOT "drawn": the module
        // still has to build and render, which on a cold cloud canvas takes
        // seconds, and dropping the loading screen here showed a white pane
        // with bare comment pins. Those canvases clear it on `canvas-rendered`
        // / `canvas-failed`; a legacy .html canvas has nothing to wait for.
        if (!isModuleCanvasPath(m.file)) setLoadingPath((p) => (p === m.file ? null : p));
        setLoadedPath(m.file);
        // …and retire any #115 error panel for this canvas: it just proved it
        // can load (a late load, or a successful Retry).
        setCanvasError((e) => (e && e.path === m.file ? null : e));
        // Presentation Mode suppresses comment pins (same gate as the push
        // effect above), so a canvas opened while presenting starts pin-free.
        const list = presentMode ? [] : commentsByFile[m.file] || [];
        const el = [...iframesRef.current.entries()].find(([k]) => k === m.file)?.[1];
        if (el && el.contentWindow) {
          try {
            el.contentWindow.postMessage({ dgn: 'comments-set', comments: list }, '*');
          } catch {}
          // System-review D9 — seed the just-loaded canvas with the current
          // chrome theme so a canvas opened AFTER a theme toggle starts
          // correct (no flash from the dark default).
          try {
            el.contentWindow.postMessage({ dgn: 'theme', theme }, '*');
          } catch {}
          // Seed the just-loaded canvas with the current chrome-visibility
          // state (minimap / zoom-controls toggles + Presentation Mode) so a
          // canvas opened after a toggle starts in the right state.
          try {
            el.contentWindow.postMessage(
              {
                dgn: 'view-chrome',
                minimap: minimapVisible,
                zoom: zoomCtlVisible,
                present: presentMode,
              },
              '*'
            );
          } catch {}
          if (focusedCommentId && list.some((c) => c.id === focusedCommentId)) {
            try {
              el.contentWindow.postMessage({ dgn: 'comment-focus', id: focusedCommentId }, '*');
            } catch {}
          }
          // Phase 12.1 (DDR-138) — a reorder just wrote source: the moved
          // element's positional data-cd-id renumbered, so re-selecting by the
          // PRE-move id would land on the wrong node. Re-select by the recomputed
          // movedId instead (null ⇒ leave selection to the user, never guess), and
          // rebuild the layers tree so the panel reflects the new order.
          const pend = pendingReorderRef.current;
          if (pend && pend.file === m.file) {
            pendingReorderRef.current = null;
            try {
              el.contentWindow.postMessage(
                { dgn: 'request-layers', artboardId: pend.artboardId ?? null },
                '*'
              );
            } catch {}
            if (pend.movedId) {
              try {
                el.contentWindow.postMessage(
                  {
                    dgn: 'select-by-id',
                    id: pend.movedId,
                    artboardId: pend.artboardId ?? null,
                    index: 0,
                  },
                  '*'
                );
              } catch {}
            }
          } else {
            // Phase 12.3 (W1.1) — an edit-css/edit-attr commit triggers the file
            // watcher's HMR reload, which remounts the canvas and drops the
            // in-canvas selection halo. Re-select the same element by its stable
            // data-cd-id so the user keeps focus on what they're editing. The
            // canvas-shell `select-by-id` handler re-emits select-set, which keeps
            // the Inspector panel + halo in sync. Guarded to the active file.
            // Retry-laddered: dgn:'loaded' fires from the inline inspector script
            // BEFORE the React canvas-shell mounts its listener, so a one-shot
            // post is lost on fresh iframes (canvas-switch restore case).
            const sel0 = selectedRef.current;
            const sel = Array.isArray(sel0) ? sel0[0] : sel0;
            if (sel && sel.id && sel.file === m.file) {
              scheduleHaloRestore(sel);
            }
          }
        }
      } else if (m.dgn === 'export-request' && m.id && m.payload) {
        // The export dialog renders inside the canvas iframe (canvas origin),
        // but /_api/export is a privileged MAIN-origin endpoint deliberately
        // kept off the canvas allowlist (DDR-060). A direct in-iframe fetch
        // therefore 403s ("Forbidden (canvas origin)"). Bridge it: run the
        // export here on the trusted main origin, stream the download, and
        // report status back to the iframe. Origin is already validated
        // (e.origin === expectedOrigin) above, so only the real canvas iframe
        // can ask — this is NOT a generic fetch proxy.
        //
        // DDR-231 security (M1): additionally require the request come from the
        // ACTIVE canvas — captureFromCanvas + the browser-lane branch capture
        // and auto-download `activePath`'s pixels regardless of who asked, so
        // WITHOUT this gate a background (untrusted, DDR-054) same-origin canvas
        // could `postMessage({dgn:'export-request'})` with no user gesture and
        // force a silent download of whatever the user is currently looking at.
        // Same one-liner every sibling mutating branch already uses.
        const activeWin = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
        if (e.source !== activeWin) return;
        void runBridgedExport(e.source, m.id, m.payload);
      } else if (m.dgn === 'export-history-request' && m.id) {
        // Same bridge for the dialog's Recent tab (/_api/export-history is
        // also main-origin-only).
        void runBridgedHistory(e.source, m.id);
      }
    }
    // Reply target for the export bridge: the canvas iframe's own origin.
    const replyOrigin = cfg?.canvasOrigin || window.location.origin;
    async function runBridgedExport(source, id, payload) {
      // The in-canvas dialog exports the canvas it LIVES IN — which the M1
      // gate above just proved is `activePath`. Stamp it so scope resolution
      // never falls back to the server's (asynchronously written, possibly
      // stale) `_active.json` — same rule as the shell dialog's canvasFile.
      // OVERWRITE, not fill-if-absent: the M1 gate above proved the sender IS
      // the active canvas iframe (untrusted, DDR-054), so a canvasFile IT
      // supplied must not survive — the bridged export renders the canvas it
      // lives in, full stop (security review W2).
      if (payload?.options && activePath && activePath !== SYSTEM_TAB) {
        payload.options.canvasFile = activePath;
      }
      const reply = (msg) => {
        try {
          if (source) source.postMessage({ dgn: 'export-result', id, ...msg }, replyOrigin);
        } catch {}
      };
      // DDR-231 — the browser lane, mirrored for the IN-CANVAS dialog: png/svg
      // of a known artboard is captured by the asking canvas itself (the shell
      // relays the request back over the export-capture bridge and downloads
      // the blobs — the sandboxed iframe can't download, the shell can).
      const opts = payload?.options || {};
      const bridgedBrowserEligible = browserCaptureEligible({
        exportLane: cfg.exportLane || 'local',
        format: payload?.format,
        scope: payload?.scope,
        artboardId: opts.artboardId,
      });
      if (bridgedBrowserEligible) {
        try {
          if (payload.format === 'pptx') {
            const { filename, blob } = await captureDeckViaBrowser({
              capture: captureFromCanvas,
              name: activePath ? activePath.replace(/^.*\//, '').replace(/\.[^.]+$/, '') : 'export',
            });
            downloadCapturedBlob(filename, blob);
          } else {
            const capScale = captureScale(opts);
            const items = await captureFromCanvas({
              format: payload.format,
              artboardIds: [opts.artboardId],
              scale: capScale,
            });
            const safeItems = await sanitizeCapturedItems(items, payload.format);
            for (const it of safeItems) downloadCapturedBlob(it.name, it.blob);
          }
          reply({ ok: true, browser: true });
          return;
        } catch {
          if (cfg.exportLane !== 'remote') {
            reply({
              ok: false,
              error:
                'Capturing in the browser failed and this workspace has no render service to fall back to — try again, or ask your admin to add maude-render.',
            });
            return;
          }
          // Render service available — degrade to the jobs lane below.
        }
      }
      // feature-cloud-export-render-workers — a workspace with no render
      // service can't produce browser-rendered formats; answer the in-canvas
      // dialog with the reason instead of relaying a request the proxy 404s.
      // ZIP (and any browser-free format) still goes through.
      if (cfg.exportLane === 'none' && payload?.format !== 'zip') {
        reply({
          ok: false,
          error:
            'This format needs the render service, which this workspace doesn’t have configured. PNG/SVG of the active artboard and the PPTX deck export straight from the browser; ZIP works too. For the rest use the desktop app or ask your admin to add maude-render.',
        });
        return;
      }
      try {
        // feature-background-export-notification-center — enqueue and reply
        // with the job id immediately; the notification center (which
        // already owns the WS connection) is the single place status/
        // progress/completion live from here, regardless of which dialog
        // created the job.
        const r = await fetch('/_api/export-jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          reply({ ok: false, error: (await r.text()) || String(r.status) });
          return;
        }
        const { jobId } = await r.json();
        reply({ ok: true, jobId });
      } catch (err) {
        reply({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    }
    async function runBridgedHistory(source, id) {
      let history = [];
      try {
        const r = await fetch('/_api/export-history');
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data.history)) history = data.history;
        }
      } catch {
        /* best-effort — empty list */
      }
      try {
        if (source) source.postMessage({ dgn: 'export-history-result', id, history }, replyOrigin);
      } catch {}
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    commentsByFile,
    focusedCommentId,
    cfg,
    theme,
    reloadActive,
    presentMode,
    minimapVisible,
    zoomCtlVisible,
    broadcastChrome,
    activePath,
    postToActiveCanvas,
    captureFromCanvas,
  ]);

  // Tell the active canvas iframe to drop any persistent selection (canvas
  // SelectionSet) — used when the comment composer closes via submit /
  // cancel / Esc. canvas-shell listens for `force-clear` on the window
  // message channel and calls selSet.clear().
  const clearActiveCanvasSelection = useCallback(() => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    const el = iframesRef.current.get(activePath);
    if (el && el.contentWindow) {
      try {
        el.contentWindow.postMessage({ dgn: 'force-clear' }, '*');
      } catch {}
    }
  }, [activePath]);

  // Phase 12.3 (W1.1) — optimistic inline-style preview. The CSS panel calls this
  // on commit so the selected element updates instantly in the canvas before the
  // edit-css → HMR reload lands. `value` null = the reset path (remove the prop).
  const applyOptimisticStyle = useCallback(
    (payload) => {
      if (!activePath || activePath === SYSTEM_TAB) return;
      const el = iframesRef.current.get(activePath);
      if (el && el.contentWindow) {
        try {
          el.contentWindow.postMessage({ dgn: 'apply-style', ...payload }, '*');
        } catch {}
      }
    },
    [activePath]
  );

  // Inline-edit undo (DDR-103/104 follow-up). The inspector calls this after it
  // POSTs `/_api/edit-css` / `/_api/edit-attr`, so the canvas iframe records the
  // edit on its undo stack and Cmd+Z can invert it. The iframe gates this to
  // parent-origin posts (DDR-054). See `commands/edit-source-command.ts`.
  const recordSourceEdit = useCallback(
    (payload) => {
      if (!activePath || activePath === SYSTEM_TAB || !payload) return;
      const el = iframesRef.current.get(activePath);
      if (el && el.contentWindow) {
        try {
          el.contentWindow.postMessage({ dgn: 'record-edit', payload }, '*');
        } catch {}
      }
    },
    [activePath]
  );

  // Serializes `apply-edit` source writes from canvas undo/redo so a rapid
  // multi-Cmd+Z on the same property lands on disk in dispatch order (the
  // iframe sink is fire-and-forget, so without this the POSTs could race).
  const editApplyChainRef = useRef(Promise.resolve());

  // Phase 12.1 (DDR-138) — commit a Layers-panel drag/keyboard reorder. The shell
  // is main-origin, so it calls the privileged /_api/reorder directly (the CSS/
  // text edits go the other way — canvas requests, shell writes; here the gesture
  // originates in the shell). Serialized on the same chain as apply-edit so a
  // reorder can't race an in-flight edit write to the same file.
  const reorderLayer = useCallback(
    (draggedId, refId, position, occ) => {
      const idIndex = Number.isInteger(occ?.idIndex) ? occ.idIndex : undefined;
      const refIndex = Number.isInteger(occ?.refIndex) ? occ.refIndex : undefined;
      // A same-id move is valid for two INSTANCES of a reused component (distinct
      // occurrence indices → distinct usages); only a true self-move is a no-op.
      if (!draggedId || !refId) return;
      if (draggedId === refId && (idIndex ?? 0) === (refIndex ?? 0)) return;
      const sel = selectedRef.current;
      const one = Array.isArray(sel) ? sel[0] : sel;
      // SECURITY (DDR-139 / adversarial F1): a reorder ALWAYS applies to the
      // ACTIVE canvas — both the in-canvas drag and the Layers panel operate on
      // what the user is viewing. Pin the target to `activePath`; never derive it
      // from `selection.canvas`, which an untrusted iframe can spoof (an ungated
      // dgn:'select' followed by dgn:'reorder-request') to retarget the write to
      // a DIFFERENT canvas (confused deputy, breaks DDR-054/DDR-138 containment).
      const canvas = activePath;
      if (!canvas) return;
      const file = activePath;
      const artboardId = layersTree?.artboardId ?? one?.artboardId ?? null;
      // Optimistically reorder the layers tree so the panel reflects the move
      // instantly; the HMR rebuild (request-layers, dgn:'loaded') confirms it a
      // beat later. Ids here are distinct (repeated/list nodes are non-draggable).
      setLayersTree((prev) =>
        prev ? { ...prev, nodes: moveLayerNode(prev.nodes, draggedId, refId, position) } : prev
      );
      // Gate the next layers-panel drag until the rebuilt tree lands — the write
      // churns positional ids, so a rapid 2nd drag on the optimistic tree would
      // carry stale ids. Cleared by the incoming layers-tree message, with a
      // hard timeout fallback so the list can NEVER stay frozen if that message
      // doesn't arrive (a no-op reorder, no HMR, etc.).
      layersBusyRef.current = true;
      if (layersBusyTimerRef.current) clearTimeout(layersBusyTimerRef.current);
      layersBusyTimerRef.current = setTimeout(() => {
        layersBusyRef.current = false;
        layersBusyTimerRef.current = null;
      }, 700);
      editApplyChainRef.current = editApplyChainRef.current
        .catch(() => {})
        .then(() =>
          fetch('/_api/reorder', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ canvas, id: draggedId, refId, position, idIndex, refIndex }),
          })
            .then((r) => r.json().catch(() => ({})))
            .then((j) => {
              if (!j.ok) {
                console.warn('[reorder]', j.error || 'failed');
                // The move was REJECTED (e.g. a .map()ed/looped element, or a
                // reparent that would break the JSX) — but the canvas already
                // applied it optimistically (applyDrop) and the layers panel via
                // moveLayerNode. Nothing was written, so without a revert the user
                // sees a phantom change that vanishes on the next canvas switch
                // ("it didn't save") and Cmd+Z has no entry to undo. Tell the
                // canvas to put the node back; its observer re-posts the tree, so
                // the panel reverts too. For a LAYERS-panel reorder (no canvas DOM
                // move to observe) also re-request the tree to drop the optimistic
                // moveLayerNode.
                postToActiveCanvas({ dgn: 'reorder-failed' });
                postToActiveCanvas({ dgn: 'request-layers', artboardId });
                layersBusyRef.current = false;
                if (layersBusyTimerRef.current) {
                  clearTimeout(layersBusyTimerRef.current);
                  layersBusyTimerRef.current = null;
                }
                return;
              }
              // The write triggers an HMR reload; the dgn:'loaded' handler
              // re-selects the moved element by its recomputed id + rebuilds the
              // tree. movedId is best-effort — null means "leave selection to the
              // user" (never re-select by the stale pre-move id).
              pendingReorderRef.current = { file, movedId: j.movedId || null, artboardId };
              // Record onto the canvas undo stack so Cmd+Z reverts the move via
              // the server's reorder log (id-churn-proof whole-file swap).
              if (typeof j.seq === 'number') {
                postToActiveCanvas({
                  dgn: 'record-edit',
                  payload: { op: 'reorder', canvas, seq: j.seq, label: 'move element' },
                });
              }
            })
            .catch(() => {})
        );
    },
    [activePath, layersTree, postToActiveCanvas]
  );
  // Keep the ref the (stale-closure) onMessage reorder-request handler reads
  // pointed at the latest reorderLayer.
  useEffect(() => {
    reorderLayerRef.current = reorderLayer;
  }, [reorderLayer]);

  // Commit an in-canvas coordinate-mode drag (out-of-flow element: absolute/
  // fixed) as two sequential single-property writes through the SAME
  // main-origin endpoint the CSS panel already uses (`/_api/edit-css`, Phase
  // 12 / DDR-103) — no new write surface. `editStyleProp` upserts into the
  // existing `style={{}}` object, so the second call (top) lands next to the
  // first (left) rather than clobbering it. Serialized on the shared
  // apply-edit chain so it can't race an in-flight write to the same file.
  const repositionElement = useCallback(
    (id, left, top, beforeLeft, beforeTop, idIndex) => {
      if (!id || !activePath) return;
      const canvas = activePath;
      // Stage H3 — when the dragged target is a whole component INSTANCE the canvas
      // passes its DOM-occurrence index; the server routes the left/top write to
      // that instance's own `<Component/>` usage so moving one instance stays local.
      const occ = Number.isInteger(idIndex) ? idIndex : undefined;
      // INV-2 (DDR-105) — arm the reload-suppression window BEFORE the edit-css
      // writes so the HMR reload is skipped and the canvas doesn't remount + drop
      // the selection (dogfood: "když pohnu elementem myší, ztratím focus"). Same
      // fix as resizeElement; also covers the keyboard nudge (L1) which reuses this.
      applyOptimisticStyle({ id, prop: 'left', value: `${left}px` });
      applyOptimisticStyle({ id, prop: 'top', value: `${top}px` });
      let j1ref = null;
      const writeProp = (property, value) =>
        fetch('/_api/edit-css', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ canvas, id, property, value: `${value}px`, idIndex: occ }),
        }).then((r) => r.json().catch(() => ({})));
      editApplyChainRef.current = editApplyChainRef.current
        .catch(() => {})
        .then(() => writeProp('left', left))
        .then((j1) => {
          if (!j1.ok) throw new Error(j1.error || 'left write failed');
          j1ref = j1;
          return writeProp('top', top);
        })
        .then((j2) => {
          if (!j2.ok) throw new Error(j2.error || 'top write failed');
          // Record BOTH properties onto the canvas undo stack — two Cmd+Z
          // steps (top, then left), same as committing two CSS knobs by hand.
          recordSourceEdit({
            op: 'css',
            canvas,
            id,
            key: 'left',
            before: replacedValue(j1ref, `${beforeLeft}px`),
            after: `${left}px`,
          });
          recordSourceEdit({
            op: 'css',
            canvas,
            id,
            key: 'top',
            before: replacedValue(j2, `${beforeTop}px`),
            after: `${top}px`,
          });
        })
        .catch((err) => {
          console.warn('[reposition]', err?.message || err);
          // Nothing (or only `left`) persisted — tell the canvas to restore
          // the pre-drag inline style so a phantom move doesn't linger.
          postToActiveCanvas({ dgn: 'reposition-failed' });
        });
    },
    [activePath, postToActiveCanvas, recordSourceEdit, applyOptimisticStyle]
  );
  useEffect(() => {
    repositionElementRef.current = repositionElement;
  }, [repositionElement]);

  // feature-element-editing-robustness Stage D (Task D3) — commit an in-canvas
  // drag-resize. `patch` = { width, height, left?, top? } (px strings); left/top
  // are present only for a top/left-edge drag on an out-of-flow element. Writes
  // each present property through the SAME main-origin `/_api/edit-css` endpoint
  // the CSS panel + reposition use (no new write surface), serialized on the
  // shared apply-edit chain, and records one undo entry per property (as
  // reposition records left+top). Pinned to `activePath` (never `m.canvas`) —
  // the confused-deputy guard DDR-138/DDR-054 established for reorder/reposition.
  const resizeElement = useCallback(
    (id, patch, before, idIndex) => {
      if (!id || !activePath || !patch || typeof patch !== 'object') return;
      const canvas = activePath;
      const b = before && typeof before === 'object' ? before : {};
      // Stage H3 — a whole-instance resize carries its DOM-occurrence index so the
      // width/height/left/top write lands on that instance's own `<Component/>`
      // usage (local), not the shared inner definition. undefined for a plain element.
      const occ = Number.isInteger(idIndex) ? idIndex : undefined;
      // `transform` rides the same lane for the rotate handle (Task L8);
      // `padding-*`/`gap` ride it for the on-canvas spacing drag (Stage J);
      // `grid-template-columns`/`grid-template-rows` ride it for the on-canvas
      // grid gutter drag (feature-3-web-artboards T5) — same single-prop
      // /_api/edit-css write + per-prop undo record, no new lane.
      const props = [
        'width',
        'height',
        'left',
        'top',
        'transform',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'gap',
        'grid-template-columns',
        'grid-template-rows',
      ].filter((p) => typeof patch[p] === 'string' && patch[p]);
      if (!props.length) return;
      // Dogfood 2026-07-07 — "resize paddingu nebo gap" was still deselecting on
      // completion. `applyOptimisticStyle` was posting {id, prop, value} only —
      // missing artboardId/index — so the canvas-side `apply-style` handler
      // resolved the UNSCOPED `[data-cd-id]` selector (dom-selection.ts
      // `resolveSelectionEl`/`scopedCdSelector`), which is a latent multi-
      // artboard/reused-component miss. Pull the current selection's own
      // artboardId/index (when it matches `id`) so every optimistic apply +
      // the belt-and-suspenders reselect below target the SAME instance.
      const curSel = selectedRef.current;
      const curOne = Array.isArray(curSel) ? (curSel.length === 1 ? curSel[0] : null) : curSel;
      const selArtboardId = curOne && curOne.id === id ? (curOne.artboardId ?? null) : null;
      const selIndex = curOne && curOne.id === id ? (curOne.index ?? 0) : 0;
      // INV-2 (DDR-105) — arm the reload-suppression window BEFORE the edit-css
      // writes so the follow-up HMR is skipped. Without this the canvas remounts
      // and drops the selection (the "resize deselects the element" dogfood bug).
      for (const p of props) {
        applyOptimisticStyle({
          id,
          artboardId: selArtboardId,
          index: selIndex,
          prop: p,
          value: patch[p],
        });
      }
      const writeProp = (property, value) =>
        fetch('/_api/edit-css', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ canvas, id, property, value, idIndex: occ }),
        }).then((r) => r.json().catch(() => ({})));
      const replies = {};
      let chain = editApplyChainRef.current.catch(() => {});
      for (const p of props) {
        chain = chain.then((prev) => {
          if (prev && prev.ok === false) throw new Error(prev.error || `${p} write failed`);
          return writeProp(p, patch[p]).then((j) => {
            replies[p] = j;
            return j;
          });
        });
      }
      editApplyChainRef.current = chain
        .then((last) => {
          if (last && last.ok === false) throw new Error(last.error || 'resize write failed');
          // Record one undo entry per written property (each Cmd+Z reverts one).
          for (const p of props) {
            recordSourceEdit({
              op: 'css',
              canvas,
              id,
              key: p,
              before: replacedValue(replies[p], b[p] ?? null),
              after: patch[p],
            });
          }
          // Dogfood 2026-07-07 — belt-and-suspenders reselect, mirroring the
          // structural ops' `pendingReorderRef` re-settle. The DDR-105 suppression
          // window should make this a no-op (no reload → the selection was never
          // lost) — idempotent per `scheduleHaloRestore`'s own doc comment, so it's
          // safe to always fire, and it's the backstop if suppression ever misses
          // (a slow FS-watcher round trip past the 1.5s window, for example).
          scheduleHaloRestore({ id, file: canvas, artboardId: selArtboardId, index: selIndex });
        })
        .catch((err) => {
          console.warn('[resize]', err?.message || err);
          // Nothing (or only a prefix) persisted — tell the canvas to restore the
          // pre-drag inline style so a phantom resize doesn't linger.
          postToActiveCanvas({ dgn: 'resize-failed' });
        });
    },
    [activePath, postToActiveCanvas, recordSourceEdit, applyOptimisticStyle, scheduleHaloRestore]
  );
  useEffect(() => {
    resizeElementRef.current = resizeElement;
  }, [resizeElement]);

  // feature-element-editing-robustness Stage I — general element structural edits
  // (delete / insert element / insert artboard) + Stage D4 (artboard resize).
  // Each is a main-origin-only write the untrusted canvas can only REQUEST over
  // the dgn:* bus; the shell performs it, pinned to `activePath` (confused-deputy
  // guard, DDR-054/138). Undo reuses the reorder command's whole-file seq revert
  // (record-edit op:'reorder') — a structural edit renumbers positional ids, so an
  // inverse descriptor goes stale (same reason reorder uses the server seq log).
  const structuralWriteRef = useRef(null);
  const structuralWrite = useCallback(
    (route, body, { label, onOk, onFail: failed } = {}) => {
      if (!activePath) return;
      const canvas = activePath;
      // A refused structural edit used to vanish into the console: the
      // designer pressed Delete and nothing happened. Say so in the canvas.
      const onFail =
        failed ??
        ((j) =>
          postToActiveCanvas({
            dgn: 'op-toast',
            message: `Couldn't ${label || 'apply the edit'}${j?.error ? ` — ${j.error}` : ''}.`,
          }));
      editApplyChainRef.current = editApplyChainRef.current
        .catch(() => {})
        .then(() =>
          fetch(route, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...body, canvas }),
          })
            .then((r) => r.json().catch(() => ({})))
            .then((j) => {
              if (!j.ok) {
                console.warn(`[${route}]`, j.error || 'failed');
                onFail?.(j);
                return;
              }
              if (typeof j.seq === 'number') {
                postToActiveCanvas({
                  dgn: 'record-edit',
                  payload: { op: 'reorder', canvas, seq: j.seq, label: label || 'edit' },
                });
              }
              onOk?.(j, canvas);
            })
            .catch((err) => onFail?.({ error: err?.message }))
        );
    },
    [activePath, postToActiveCanvas]
  );
  useEffect(() => {
    structuralWriteRef.current = structuralWrite;
  }, [structuralWrite]);

  const deleteElementShell = useCallback(
    (id, idIndex) => {
      // After the delete lands + HMR reloads, clear the (now-gone) selection.
      structuralWrite(
        '/_api/delete-element',
        { id, idIndex: Number.isInteger(idIndex) ? idIndex : undefined },
        { label: 'delete element', onOk: () => postToActiveCanvas({ dgn: 'selection-clear' }) }
      );
    },
    [structuralWrite, postToActiveCanvas]
  );

  const insertElementShell = useCallback(
    (refId, position, kind, opts = {}) => {
      const staleSig = lastLayersTreeRef.current?.sig ?? null;
      structuralWrite(
        '/_api/insert-element',
        {
          refId,
          artboardId: typeof opts.artboardId === 'string' ? opts.artboardId : undefined,
          position,
          kind,
          src: typeof opts.src === 'string' ? opts.src : undefined,
          refIndex: Number.isInteger(opts.refIndex) ? opts.refIndex : undefined,
        },
        {
          label: `insert ${kind}`,
          // Select the new element once the HMR reload lands (its id is stamped
          // on transpile — best-effort, like reorder's pendingReorderRef).
          onOk: (j, canvas) => {
            if (!j.newId) return;
            pendingReorderRef.current = {
              file: canvas,
              movedId: j.newId,
              artboardId: null,
              staleSig,
            };
            const last = lastLayersTreeRef.current;
            if (last) settlePendingSelectionRef.current?.(last.tree, last.sig, last.artboardId);
          },
        }
      );
    },
    [structuralWrite]
  );

  // feature-ai-media-generation Phase 1 (Task 1.1) — auto-insert a generated
  // image onto the canvas where the user is looking, so generation is never a
  // dead-end modal. The image landed in the content-addressed asset store
  // (assets/<sha8>.png) via the privileged /_api/generate-jobs route; splice it
  // into the active artboard through the SAME main-origin source-write lane the
  // AssetPicker uses (insertElementShell → /_api/insert-element). Returns true
  // when it placed the image, false when there's no target artboard (no canvas
  // open / no active artboard) so the caller can fall back to a manual affordance.
  const insertGeneratedImage = useCallback(
    (assetPath) => {
      if (typeof assetPath !== 'string' || !assetPath) return false;
      if (!activePath) return false;
      // Respect the active-canvas + selected-artboard signals (_active.json): an
      // explicit selection wins, else the viewport-active artboard canvas-lib
      // reports on pan. Without a target artboard we can't source-write.
      const artboardId = selectedRef.current?.artboardId ?? canvasActiveArtboard ?? null;
      if (!artboardId) return false;
      // Insert as the last child of the artboard (empty or not — the engine's
      // insertElementIntoArtboard handles both). Content-addressed src only; the
      // route contains an `image` src to assets/ (no remote hotlink / scheme).
      insertElementShell(undefined, 'inside-end', 'image', { artboardId, src: assetPath });
      return true;
    },
    [activePath, canvasActiveArtboard, insertElementShell]
  );

  // feature-4 detach-component (2026-07-19) — clone the definition + repoint
  // this usage so edits stay local to this instance. Rides structuralWrite
  // (one undo seq); the id churn after HMR invalidates the selection → clear.
  const detachInstanceShell = useCallback(
    (id, idIndex) => {
      structuralWrite(
        '/_api/detach-component',
        { id, idIndex: Number.isInteger(idIndex) ? idIndex : undefined },
        {
          label: 'detach instance',
          onOk: (j) => {
            postToActiveCanvas({ dgn: 'selection-clear' });
            postToActiveCanvas({
              dgn: 'op-toast',
              message: `Detached — this instance is now ${j.detachedName || 'its own component'}; edits stay local (⌘Z to undo).`,
            });
          },
          onFail: (j) =>
            postToActiveCanvas({
              dgn: 'op-toast',
              message: `Detach failed: ${j?.error || 'unknown error'}`,
            }),
        }
      );
    },
    [structuralWrite, postToActiveCanvas]
  );

  const duplicateElementShell = useCallback(
    (id, idIndex) => {
      const staleSig = lastLayersTreeRef.current?.sig ?? null;
      structuralWrite(
        '/_api/duplicate-element',
        { id, idIndex: Number.isInteger(idIndex) ? idIndex : undefined },
        {
          label: 'duplicate element',
          // Select the copy once the post-write tree lands — not the pre-write
          // one, where the copy's id still names the next sibling.
          onOk: (j, canvas) => {
            if (!j.newId) return;
            pendingReorderRef.current = {
              file: canvas,
              movedId: j.newId,
              artboardId: null,
              staleSig,
            };
            const last = lastLayersTreeRef.current;
            if (last) settlePendingSelectionRef.current?.(last.tree, last.sig, last.artboardId);
          },
        }
      );
    },
    [structuralWrite]
  );

  // Task L4 — copy-style / paste-style. Captures a selection's AUTHORED inline
  // styles (not resolved/computed, so DS-token + inherited values aren't baked in)
  // minus layout/geometry props, then applies them to another element via chained
  // edit-css writes (one per prop, like resize — N-step undo). Clipboard lives in
  // the shell so it survives selection + canvas changes.
  const copiedStyleRef = useRef(null);
  // Appearance-only: exclude position/size/margin so paste-style copies the LOOK,
  // not the layout (Figma parity — padding/color/border/shadow/font/… carry over).
  const PASTE_STYLE_EXCLUDE = useMemo(
    () =>
      new Set([
        'position',
        'top',
        'right',
        'bottom',
        'left',
        'inset',
        'width',
        'height',
        'min-width',
        'max-width',
        'min-height',
        'max-height',
        'margin',
        'margin-top',
        'margin-right',
        'margin-bottom',
        'margin-left',
      ]),
    []
  );
  const copyStyle = useCallback(() => {
    const sel = selectedRef.current;
    const one = Array.isArray(sel) ? (sel.length === 1 ? sel[0] : null) : sel;
    if (!one) return;
    const map = {};
    for (const [k, v] of Object.entries(one.authored || {})) {
      if (!PASTE_STYLE_EXCLUDE.has(k)) map[k] = v;
    }
    for (const [k, v] of Object.entries(one.customStyles || {})) {
      if (!PASTE_STYLE_EXCLUDE.has(k)) map[k] = v;
    }
    copiedStyleRef.current = Object.keys(map).length ? map : null;
  }, [PASTE_STYLE_EXCLUDE]);
  const pasteStyle = useCallback(
    (id) => {
      const canvas = activePath;
      const map = copiedStyleRef.current;
      if (!canvas || !id || !map) return;
      const entries = Object.entries(map);
      let chain = editApplyChainRef.current.catch(() => {});
      for (const [property, value] of entries) {
        applyOptimisticStyle({ id, prop: property, value }); // preview + arm no-flicker
        chain = chain.then(() =>
          fetch('/_api/edit-css', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ canvas, id, property, value }),
          })
            .then((r) => r.json().catch(() => ({})))
            .then((j) => {
              if (j.ok)
                recordSourceEdit({
                  op: 'css',
                  canvas,
                  id,
                  key: property,
                  before: replacedValue(j, null),
                  after: value,
                });
            })
            .catch(() => {})
        );
      }
      editApplyChainRef.current = chain;
    },
    [activePath, applyOptimisticStyle, recordSourceEdit]
  );

  const insertArtboardShell = useCallback(
    ({ id, label, width, height }) => {
      structuralWrite(
        '/_api/insert-artboard',
        { id, label, width, height },
        { label: 'insert artboard' }
      );
    },
    [structuralWrite]
  );

  const resizeArtboardShell = useCallback(
    (artboardId, width, height) => {
      structuralWrite(
        '/_api/resize-artboard',
        { artboardId, width, height },
        {
          label: 'resize artboard',
          // Stage D4 — the resize overlay applies a live inline-style preview
          // during the drag (no HMR yet); on a rejected/failed write, tell it to
          // restore the pre-drag box so a phantom resize doesn't linger.
          onFail: () => postToActiveCanvas({ dgn: 'resize-artboard-failed' }),
          // Dogfood follow-up — resync the Inspector's own W/H (and any other
          // attrs) once the HMR reload lands, so a paper-preset pick doesn't
          // leave the fields showing the pre-resize size.
          onOk: () => scheduleArtboardResync(artboardId, activePath),
        }
      );
    },
    [structuralWrite, postToActiveCanvas, scheduleArtboardResync, activePath]
  );

  const deleteArtboardShell = useCallback(
    (artboardId) => {
      structuralWrite('/_api/delete-artboard', { artboardId }, { label: 'delete artboard' });
    },
    [structuralWrite]
  );

  // feature-3-web-artboards T3 — "Duplicate at width…". No onOk auto-select
  // (matches insertArtboardShell's own precedent above — the new frame lands
  // selectable, not auto-selected).
  const duplicateArtboardShell = useCallback(
    (artboardId, width) => {
      structuralWrite(
        '/_api/duplicate-artboard',
        { artboardId, width },
        { label: 'duplicate artboard at width' }
      );
    },
    [structuralWrite]
  );

  // Artboard "hug height" default — Hug ⇄ Fixed toggle from ArtboardKnobs
  // (CSS panel). Direct shell-side action (no canvas postMessage round trip,
  // unlike resizeArtboardShell's drag-overlay caller), so no *ShellRef needed.
  const setArtboardHugShell = useCallback(
    (artboardId, fixed, freezeHeight) => {
      structuralWrite(
        '/_api/set-artboard-hug',
        { artboardId, fixed, freezeHeight },
        {
          label: fixed ? 'pin artboard height' : 'hug artboard height',
          onOk: () => scheduleArtboardResync(artboardId, activePath),
        }
      );
    },
    [structuralWrite, scheduleArtboardResync, activePath]
  );

  // Artboard "more settings" (background/padding/layout/gap) from ArtboardKnobs.
  const setArtboardStyleShell = useCallback(
    (artboardId, patch) => {
      structuralWrite(
        '/_api/set-artboard-style',
        { artboardId, ...patch },
        {
          label: 'artboard style',
          onOk: () => scheduleArtboardResync(artboardId, activePath),
        }
      );
    },
    [structuralWrite, scheduleArtboardResync, activePath]
  );
  // feature-1-artboard-kinds-foundation, T8 — kind-switch surfaces. Direct
  // callable from ArtboardKnobs (Inspector); the context-menu submenu (inside
  // the iframe) reaches the SAME endpoint via the postMessage ref below.
  //
  // Dogfood follow-up — every one of these ArtboardKnobs writers now resyncs
  // the Inspector's OWN selection snapshot once the HMR reload lands
  // (scheduleArtboardResync's retry ladder). Before this fix the ARTBOARD
  // re-rendered correctly (new kind, new paper size) but the Inspector kept
  // showing PRE-edit attrs (e.g. "Digital" right after picking "Print",
  // "Preset size…" still listing screen presets) until the user manually
  // re-clicked the artboard — structuralWrite's onOk never refreshed
  // `selected`, only recorded undo history.
  // feature-4 dogfood round 6 — the DIRECT kind write (+ the Inspector's
  // print-seed, sequenced AFTER it on the same structuralWrite chain, so a
  // freeze-convert enqueued just before lands FIRST and the A4 resize can't
  // move anything pre-freeze). This is what the canvas's
  // `set-artboard-kind-request` calls — it must NEVER re-enter the ask flow
  // below (that round-trip was an infinite confirm loop: every "Switch +
  // freeze" click spawned the next dialog).
  const pendingPrintSeedRef = useRef(null);
  const directArtboardKindWrite = useCallback(
    (artboardId, kind) => {
      structuralWrite(
        '/_api/set-artboard-kind',
        { artboardId, kind },
        {
          label: 'artboard kind',
          onOk: () => scheduleArtboardResync(artboardId, activePath),
        }
      );
      const seed = pendingPrintSeedRef.current;
      if (kind === 'print' && seed && seed.artboardId === artboardId) {
        pendingPrintSeedRef.current = null;
        // Same chain → serialized after the kind write (and after any freeze
        // convert the canvas enqueued before it).
        structuralWrite(
          '/_api/resize-artboard',
          { artboardId, width: seed.widthPx, height: seed.heightPx },
          { label: 'artboard size' }
        );
        structuralWrite(
          '/_api/set-artboard-print',
          { artboardId, print: seed.defaults },
          { label: 'artboard print' }
        );
      }
    },
    [structuralWrite, scheduleArtboardResync, activePath]
  );
  const directArtboardKindWriteRef = useRef(null);
  useEffect(() => {
    directArtboardKindWriteRef.current = directArtboardKindWrite;
  }, [directArtboardKindWrite]);

  const setArtboardKindShell = useCallback(
    (artboardId, kind, seedPrint) => {
      // feature-4 (user steer 2026-07-20) — Digital & Print are the freely-
      // composed marketing kinds: switching TO them from the Inspector offers
      // the freeze-and-flatten convert first. The confirm runs IN THE CANVAS
      // (canvasConfirm — the shell's window.confirm is a silent no-op in the
      // Tauri WKWebView); the canvas then re-posts `set-artboard-kind-request`,
      // which lands on the DIRECT writer above (no re-entry → no dialog loop).
      if (kind === 'print' || kind == null || kind === 'digital') {
        if (seedPrint) pendingPrintSeedRef.current = { artboardId, ...seedPrint };
        postToActiveCanvas({
          dgn: 'freeze-and-set-kind',
          artboardId,
          kind: kind === 'digital' ? null : kind,
          ask: true,
        });
        return;
      }
      directArtboardKindWrite(artboardId, kind);
    },
    [directArtboardKindWrite, postToActiveCanvas]
  );
  // feature-2-print-artboards T2 — paper/orientation/bleed/margins. Direct
  // Inspector-only callable (no canvas-origin postMessage path — same shape
  // as setArtboardStyleShell, unlike setArtboardKindShell which also has a
  // context-menu caller inside the iframe).
  const setArtboardPrintShell = useCallback(
    (artboardId, print) => {
      structuralWrite(
        '/_api/set-artboard-print',
        { artboardId, print },
        {
          label: 'artboard print',
          onOk: () => scheduleArtboardResync(artboardId, activePath),
        }
      );
    },
    [structuralWrite, scheduleArtboardResync, activePath]
  );

  // Stage I4 — "New artboard: <preset>" from the Edit menu. Generates a unique
  // id (server 422s a dup, negligible with a random suffix) + a preset label/dims
  // and inserts an empty <DCArtboard> after the last one (runtime default-grid
  // places it; DDR-027). The new frame is then selectable + resizable.
  const onInsertArtboard = useCallback(
    (presetKey) => {
      const id = `s${Math.random().toString(36).slice(2, 8)}`;
      // feature-2-print-artboards T2 — kind="print" + the print prop must
      // land together, so the created artboard is never a plain digital
      // board sized to paper by coincidence. structuralWrite serializes
      // calls in submission order (editApplyChainRef), so these three
      // sequential POSTs land as insert → kind → print, in order.
      if (presetKey.startsWith('print-')) {
        const paper = presetKey.slice('print-'.length);
        let resolved;
        try {
          resolved = resolvePrintArtboard({ paper });
        } catch {
          return;
        }
        const preset = PAPER_PRESETS.find((p) => p.id === paper);
        insertArtboardShell({
          id,
          label: preset ? preset.label : paper.toUpperCase(),
          width: resolved.widthPx,
          height: resolved.heightPx,
        });
        setArtboardKindShell(id, 'print');
        setArtboardPrintShell(id, { paper });
        return;
      }
      const p = SCREEN_PRESETS[presetKey];
      if (!p) return;
      insertArtboardShell({ id, label: p.label, width: p.width, height: p.height });
    },
    [insertArtboardShell, setArtboardKindShell, setArtboardPrintShell]
  );
  // Refs the (stale-closure) onMessage handlers below read.
  const deleteElementShellRef = useRef(null);
  const insertElementShellRef = useRef(null);
  const insertArtboardShellRef = useRef(null);
  const resizeArtboardShellRef = useRef(null);
  const deleteArtboardShellRef = useRef(null);
  const setArtboardKindShellRef = useRef(null);
  const duplicateElementShellRef = useRef(null);
  const duplicateArtboardShellRef = useRef(null);
  const copyStyleRef = useRef(null);
  const pasteStyleRef = useRef(null);
  useEffect(() => {
    deleteElementShellRef.current = deleteElementShell;
    insertElementShellRef.current = insertElementShell;
    insertArtboardShellRef.current = insertArtboardShell;
    resizeArtboardShellRef.current = resizeArtboardShell;
    deleteArtboardShellRef.current = deleteArtboardShell;
    setArtboardKindShellRef.current = setArtboardKindShell;
    duplicateElementShellRef.current = duplicateElementShell;
    duplicateArtboardShellRef.current = duplicateArtboardShell;
    copyStyleRef.current = copyStyle;
    pasteStyleRef.current = pasteStyle;
  }, [
    deleteElementShell,
    insertElementShell,
    insertArtboardShell,
    resizeArtboardShell,
    deleteArtboardShell,
    setArtboardKindShell,
    duplicateElementShell,
    duplicateArtboardShell,
    copyStyle,
    pasteStyle,
  ]);

  // Shell-level Backspace/Delete guard. CRITICAL: in the Tauri desktop app, an
  // unhandled Backspace triggers WKWebView back-navigation, which reloads the
  // WHOLE app to "Starting…" (dogfood crash). When an artboard is selected, focus
  // sits on the shell (not the canvas iframe), so the in-canvas key handler never
  // sees the keydown — the shell must catch it. Preventing the default here stops
  // the back-nav universally; if a single artboard is the selection, also delete
  // it (Backspace parity with the context menu). Element delete stays in the
  // canvas iframe (which has focus when an element is selected; its keydown never
  // reaches this window, so there's no double-handling).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const editable =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable);
      if (editable) return;
      // Suppress the WKWebView back-nav unconditionally once focus isn't editable —
      // the activePath/SYSTEM_TAB check below is app logic, not default-action gating,
      // so it must not gate preventDefault (that gap caused the desktop "Starting…" hang).
      e.preventDefault();
      if (!activePath || activePath === SYSTEM_TAB) return;
      const one = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
      if (one?.artboardId && !one.id) deleteArtboardShell(one.artboardId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePath, selected, deleteArtboardShell]);

  // feature-element-editing-robustness Stage F — AssetPicker request. `req` is
  // { purpose:'insert-image', refId, position, refIndex } (Insert ▸ Image) or
  // { purpose:'replace-src', id, before } (Media-section "Replace…"). null = closed.
  const [assetPickerReq, setAssetPickerReq] = useState(null);
  const openAssetPickerRef = useRef(null);
  useEffect(() => {
    openAssetPickerRef.current = (req) => setAssetPickerReq(req);
  }, []);

  // Phase 4 (whiteboard-improvements) — { canvas: activePath } when open, null
  // when closed. Mirrors assetPickerReq's ref-indirection (the message
  // listener below is set up with a minimal dep array, so it reaches a FRESH
  // opener via a ref rather than needing setStickerPickerReq in its own deps).
  const [stickerPickerReq, setStickerPickerReq] = useState(null);
  const openStickerPickerRef = useRef(null);
  useEffect(() => {
    openStickerPickerRef.current = (req) => setStickerPickerReq(req);
  }, []);
  const onAssetPicked = useCallback(
    (pickedPath) => {
      const req = assetPickerReq;
      setAssetPickerReq(null);
      if (!req || !pickedPath) return;
      // G3 security (DDR-152) — the request captured refId/id against the canvas
      // that was active when the picker opened; if the user switched canvases
      // while the modal was up, those ids are meaningless (or worse, collide) on
      // the now-active canvas. Abort rather than write to the wrong file.
      if (req.canvas && req.canvas !== activePath) {
        console.warn('[asset-picker] active canvas changed since request — aborting');
        return;
      }
      if (req.purpose === 'insert-image') {
        insertElementShell(req.refId, req.position || 'after', 'image', {
          artboardId: req.artboardId,
          src: pickedPath,
          refIndex: req.refIndex,
        });
        return;
      }
      if (req.purpose === 'replace-src') {
        // Re-point an authored <img>/<video> src via /_api/edit-attr (+ undo).
        const canvas = activePath;
        if (!canvas || !req.id) return;
        editApplyChainRef.current = editApplyChainRef.current
          .catch(() => {})
          .then(() =>
            fetch('/_api/edit-attr', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ canvas, id: req.id, attr: 'src', value: pickedPath }),
            })
              .then((r) => r.json().catch(() => ({})))
              .then((j) => {
                if (j.ok) {
                  recordSourceEdit({
                    op: 'attr',
                    canvas,
                    id: req.id,
                    key: 'src',
                    before: replacedValue(j, req.before ?? null),
                    after: pickedPath,
                  });
                } else {
                  console.warn('[replace-src]', j.error || 'failed');
                }
              })
              .catch(() => {})
          );
        return;
      }
      if (req.purpose === 'replace-annotation-media') {
        // Stage F3 — relay the picked path DOWN to the canvas; the annotation
        // model owns its own strokes + persistence + undo (`commitStrokes`), so
        // unlike `replace-src` the shell performs no write of its own here.
        postToActiveCanvas({ dgn: 'replace-annotation-media', id: req.id, path: pickedPath });
      }
    },
    [assetPickerReq, insertElementShell, activePath, recordSourceEdit, postToActiveCanvas]
  );

  // feature-bulk-media-insert Task 10 — the picker's multi-select confirm.
  // `destination === 'artboard'`: loop insertElementShell once per path
  // (already race-safe via editApplyChainRef, no new serialization needed);
  // always appended `inside-end` of whichever artboard is currently active —
  // NOT the single-pick request's own refId/position, which only made sense
  // for inserting exactly one image relative to one anchor. `destination ===
  // 'annotation'`: one batched message so the canvas-side handler (Task 11)
  // performs a single atomic commit instead of N racing ones.
  const onPickMany = useCallback(
    (paths, destination) => {
      const req = assetPickerReq;
      setAssetPickerReq(null);
      if (!req || !Array.isArray(paths) || !paths.length) return;
      if (req.canvas && req.canvas !== activePath) {
        console.warn('[asset-picker] active canvas changed since request — aborting');
        return;
      }
      if (destination === 'artboard') {
        const artboardId = selectedRef.current?.artboardId ?? canvasActiveArtboard ?? null;
        if (!artboardId) return;
        for (const src of paths) {
          insertElementShell(undefined, 'inside-end', 'image', { artboardId, src });
        }
        return;
      }
      postToActiveCanvas({ dgn: 'insert-annotation-media', paths });
    },
    [assetPickerReq, activePath, insertElementShell, canvasActiveArtboard, postToActiveCanvas]
  );

  // Phase 4 (whiteboard-improvements) — a bundled sticker has no project asset
  // path yet (it lives in MAUDE's own STICKERS_DIR, main-origin-only per
  // DDR-054), so re-upload its bytes through the SAME /_api/asset lane every
  // other image source uses (content-addressed, canvas-origin-allowlisted) —
  // then relay the resulting project-relative path down to the canvas exactly
  // like replace-annotation-media above (the annotation model owns its own
  // strokes; the shell performs no stroke write of its own).
  const onStickerPicked = useCallback(
    async (sticker) => {
      const req = stickerPickerReq;
      setStickerPickerReq(null);
      if (!req || !sticker?.url) return;
      // G3 security (DDR-152) — same re-check as onAssetPicked: the request
      // captured the active canvas when the picker opened; abort rather than
      // insert into whatever canvas happens to be active now.
      if (req.canvas && req.canvas !== activePath) {
        console.warn('[sticker-picker] active canvas changed since request — aborting');
        return;
      }
      try {
        const blob = await fetch(sticker.url).then((r) =>
          r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))
        );
        const res = await fetch('/_api/asset', {
          method: 'POST',
          headers: { 'content-type': blob.type || 'image/png' },
          body: blob,
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.path) {
          console.warn('[sticker-picker]', j.error || `upload failed (HTTP ${res.status})`);
          return;
        }
        postToActiveCanvas({ dgn: 'insert-sticker', path: j.path });
      } catch {
        console.warn('[sticker-picker] could not load or upload that sticker');
      }
    },
    [stickerPickerReq, activePath, postToActiveCanvas]
  );
  // Media-section "Replace…" (CssKnobs) → open the picker in replace mode with
  // the element's current src as the undo before-value (captured from the
  // Selection's `attrs.src`, not the resolved URL).
  const onReplaceMedia = useCallback(
    (elSel) => {
      if (!elSel?.id) return;
      setAssetPickerReq({
        purpose: 'replace-src',
        canvas: activePath,
        id: elSel.id,
        before: elSel.attrs?.src ?? null,
      });
    },
    [activePath]
  );

  const resolveComment = useCallback((id) => {
    wsSend({ type: 'comments-patch', id, patch: { status: 'resolved' } });
  }, []);
  const reopenComment = useCallback((id) => {
    wsSend({ type: 'comments-patch', id, patch: { status: 'open' } });
  }, []);
  const deleteComment = useCallback((id) => {
    wsSend({ type: 'comments-delete', id });
    setFocusedCommentId((prev) => (prev === id ? null : prev));
  }, []);
  return {
    applyOptimisticStyle,
    assetPickerReq,
    clearActiveCanvasSelection,
    deleteComment,
    detachInstanceShell,
    duplicateArtboardShell,
    insertGeneratedImage,
    onAssetPicked,
    onInsertArtboard,
    onPickMany,
    onReplaceMedia,
    onStickerPicked,
    recordSourceEdit,
    reopenComment,
    reorderLayer,
    resizeArtboardShell,
    resolveComment,
    setArtboardHugShell,
    setArtboardKindShell,
    setArtboardPrintShell,
    setArtboardStyleShell,
    setAssetPickerReq,
    setStickerPickerReq,
    stickerPickerReq,
  };
}
