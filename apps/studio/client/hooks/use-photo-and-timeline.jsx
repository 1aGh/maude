// hooks/use-photo-and-timeline.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect, useRef, useState } from 'react';
import { syncAnnotationsHiddenToast } from './annotations-hidden-toast.js';
import { acceptFromCanvas } from '../../bridge/dgn-protocol.ts';
import { persistUiPrefs, shellToast } from '../shell/util.js';
import { installDropGuard } from '../shell/drop-guard.js';
import { togglePresentCanvas, usePresentMode } from '../v2/shell/use-canvas-mode-lane.js';
import {
  ANNOT_STORE,
  LAYERS_MODE_STORE,
  MINIMAP_STORE,
  PANEL_SIDES_STORE,
  SHOW_HIDDEN_STORE,
  SIDEBAR_STORE,
  SYSTEM_TAB,
  THEME_STORE,
  ZOOMCTL_STORE,
} from '../shell/constants.js';
import { parseCompTimeline } from '../panels/timeline-parse.js';
import { trackRecordableWrite } from '../inspector/css-knobs.jsx';
import { menuRunner } from '../v2/shell/menu-runner.js';
import {
  clipVerbRefusal,
  clipVerbToast,
  clipVerbToastAction,
  refusalText,
  runClipVerb,
  seqUndoPayload,
} from '../v2/timeline/clip-verb.js';
import { photoPreviewMessage } from '../v2/photo/photo-section.jsx';
import { PANEL_SIDES_DEFAULTS } from '../shell/dock.jsx';
import {
  collectDirPaths,
  pruneDirs,
  toggleSection as toggleSectionState,
} from '../tree-expansion.js';

export function usePhotoAndTimeline({
  groups,
  treeLoaded,
  activePath,
  selected,
  theme,
  setTheme,
  sidebarOpen,
  showHidden,
  treeExp,
  updateTreeExp,
  panelSide,
  setPanelSide,
  layersMode,
  setLayersMode,
  timelineOpen,
  activeComps,
  setActiveComps,
  timelineFrame,
  setTimelineFrame,
  timelinePlaying,
  setTimelinePlaying,
  timelineLoop,
  timelineMuted,
  canvasActiveArtboard,
  timelineSequences,
  setTimelineSequences,
  setTimelineAudio,
  setTimelineTransitions,
  timelineTotal,
  setTimelineTotal,
  timelineArtboardId,
  setTimelineArtboardId,
  timelineArtboardIdRef,
  timelineCompId,
  timelineSelectedClip,
  setTimelineSelectedClip,
  timelineRefresh,
  timelineOpFailed,
  photoUndoRef,
  setPhotoRev,
  autoOpenInspector,
  setAutoOpenInspector,
  annotationsVisible,
  setAnnotationsVisible,
  uiPrefsHydrated,
  setUiPrefsHydrated,
  minimapVisible,
  setMinimapVisible,
  zoomCtlVisible,
  setZoomCtlVisible,
  setPresentMode,
  setPrintGuidesVisible,
  setActiveArtboards,
  setGitUser,
  iframesRef,
  postToActiveCanvas,
  wsSend,
}) {
  // ── feature-photo-editor — the Photo tab's three channels ─────────────────
  // (1) live preview: broadcast the edit DOWN to the active canvas iframe, whose
  //     canvas-lib `PhotoPreviewBridge` bakes the composite and swaps it directly
  //     into the matching `<img>`/`<image>` element's src/href (iteration 2 — see
  //     the bridge's own header comment for why it's a direct swap, not an
  //     overlay). (2) undo: a shell-side stack (photo edits are sidecar writes,
  //     not the canvas-side source-edit stack). (3) background removal: the
  //     client-side @imgly ML flow (Task 12).
  // S8.15 — `use` (the picture's `data-cd-id`) previews that one use only; without it, every use.
  const onPhotoEdit = useCallback(
    (asset, edit, use) => postToActiveCanvas(photoPreviewMessage(asset, edit, use)),
    [postToActiveCanvas]
  );
  const onPhotoRecordEdit = useCallback((asset, before, after) => {
    photoUndoRef.current.undo.push({ asset, before, after });
    photoUndoRef.current.redo.length = 0;
  }, []);
  // Pops the shell-side photo-undo stack, re-persists the reverted edit through
  // the same PUT route PhotoKnobs itself uses, re-broadcasts it to the live
  // preview, and bumps `photoRev` so the mounted PhotoKnobs (keyed on
  // `asset:photoRev`) remounts and re-fetches instead of drifting from its own
  // stale local state. Returns false (does nothing) when the requested stack is
  // empty, so callers can fall through to the canvas's own undo stack.
  const performPhotoUndo = useCallback(
    (redo) => {
      const stack = redo ? photoUndoRef.current.redo : photoUndoRef.current.undo;
      if (!stack.length) return false;
      const entry = stack.pop();
      (redo ? photoUndoRef.current.undo : photoUndoRef.current.redo).push(entry);
      const edit = (redo ? entry.after : entry.before) || {};
      onPhotoEdit(entry.asset, edit);
      fetch(`/_api/photo-edit?asset=${encodeURIComponent(entry.asset)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit),
      }).catch(() => {});
      setPhotoRev((v) => v + 1);
      return true;
    },
    [onPhotoEdit]
  );
  // Task 12 — magic background removal, entirely client-side (WASM/WebGPU via
  // @imgly/background-removal — NEVER the -node native-addon variant, DDR-070).
  // The lib is DYNAMICALLY imported so a session that never removes a background
  // pays zero bundle cost (the lazy-bundle guarantee). Fetches the source bytes,
  // runs the matte, uploads it content-addressed through the SAME /_api/asset lane
  // drag-drop uses, and returns the new `assets/<sha8>.png` for PhotoEdit.
  const onPhotoRemoveBackground = useCallback(
    async (asset) => {
      // Scan/shimmer reveal on the live photo while the ML pass runs, the same
      // "something is actively happening here" language as the agent-edit
      // artboard rim (artboard-activity-overlay.tsx) — but applied directly to
      // the photo element itself (a `data-photo-busy` attribute + injected CSS
      // mask sweep, inspect.ts) rather than a floating tracked overlay. A
      // floating decoy is exactly the architecture DDR-161's addendum tore out
      // for the live-edit preview (z-index/resize/hit-testing bugs); an
      // attribute toggle on the real element sidesteps that whole class.
      postToActiveCanvas({ dgn: 'photo-busy', asset, busy: true });
      try {
        const srcRes = await fetch(`/${asset.replace(/^\/+/, '')}`);
        if (!srcRes.ok) return null;
        const srcBlob = await srcRes.blob();
        const { removeBackground } = await import('@imgly/background-removal');
        // Inference is 100% CLIENT-SIDE (WASM/WebGPU) — the user's pixels NEVER
        // leave the browser. Only the public model weights (~40 MB, identical for
        // everyone) are fetched from IMG.LY's default host on first use; they're
        // too large to bundle in the npm tarball (`resources.json` ships empty).
        // Self-hosting those weights off the dev server for offline / air-gapped
        // parity is the flagged Task-11 follow-up (a one-time download step) — until
        // then the default host provides them, with no pixel-privacy exposure.
        const matte = await removeBackground(srcBlob);
        const up = await fetch('/_api/asset', {
          method: 'POST',
          headers: { 'content-type': matte.type || 'image/png' },
          body: matte,
        });
        const j = await up.json().catch(() => ({}));
        if (up.ok && j.path) return { maskAsset: j.path };
        return null;
      } catch (err) {
        console.error('[photo] background removal failed', err);
        return null;
      } finally {
        // Always clears, success or failure — an errored pass must not leave
        // the shimmer stuck on the photo forever.
        postToActiveCanvas({ dgn: 'photo-busy', asset, busy: false });
      }
    },
    [postToActiveCanvas]
  );

  // DDR-150 dogfood #7 + V2-3.6 N-M2 — a file OR a link dropped on a shell area
  // with no drop target used to make the browser NAVIGATE the top frame to it.
  // Document-level guard (shell/drop-guard.js): cancel the default of every
  // drag except text into an editable field; the TimelinePanel's own onDrop
  // (bubbling before this) still receives the drop first.
  useEffect(() => installDropGuard(document), []);

  // DDR-150 P3 Task 9 — timeline keyboard shortcuts. The transport's keys are
  // registry actions now (V2-2.4: actions/defs/timeline.ts, handled by
  // client/actions/shell-key-handlers.js); they read the live timeline through
  // this ref. Space doesn't steal the canvas PAN chord because that keydown
  // fires inside the focused canvas iframe, never reaching the shell.
  const tlKeyRef = useRef({});
  tlKeyRef.current = {
    open: timelineOpen,
    comps: activeComps,
    frame: timelineFrame,
    total: timelineTotal,
    playing: timelinePlaying,
    compId: timelineCompId,
    muted: timelineMuted,
    loop: timelineLoop,
    sequences: timelineSequences,
    post: postToActiveCanvas,
    canvas: activePath,
  };

  // S7.6 — Timeline undo IS the canvas's undo (decision `maude/v2-S7-timeline-undo-is-project-undo`):
  // one log, so ⌘Z (`edit.undo`, timeline focused or not) takes back the last edit whoever made it.
  // A clip verb records its edit-op `writeId` (client/v2/timeline/clip-verb.js); a v1 clip route
  // that still answers a revert `seq` records the canvas's existing `reorder` record. Both go to the
  // ACTIVE canvas's stack via `record-edit` (parent-origin only there, DDR-054).
  const recordOnCanvas = useCallback(
    (payload) => {
      if (payload) postToActiveCanvas({ dgn: 'record-edit', payload });
    },
    [postToActiveCanvas]
  );
  const pushTlUndo = useCallback(
    (canvas, seq, label) => {
      if (canvas !== tlKeyRef.current.canvas) return; // the record belongs to the canvas on screen
      recordOnCanvas(seqUndoPayload(canvas, seq, label));
    },
    [recordOnCanvas]
  );
  // Task 3 — resolve a `{ stableId, index }` clipRef against a fresh comp-clips
  // response. stableId wins (multi-comp-safe, survives reorder); the row index
  // stays as the legacy fallback for rows the enumerator couldn't identify.
  const resolveClipRef = useCallback((cc, clipRef) => {
    const seqs =
      cc?.ok && Array.isArray(cc.clips) ? cc.clips.filter((c) => c.kind === 'sequence') : [];
    if (clipRef == null) return null;
    if (typeof clipRef === 'object') {
      return (
        (clipRef.stableId ? seqs.find((c) => c.stableId === clipRef.stableId) : null) ||
        (Number.isInteger(clipRef.index) ? seqs[clipRef.index] : null) ||
        null
      );
    }
    if (typeof clipRef === 'string') return seqs.find((c) => c.stableId === clipRef) || null;
    return seqs[clipRef] || null;
  }, []);

  // Phase 2/3 — the parametric verb pipe (speed/trim-in/audio/detach-audio/framing/grade/
  // transition/split/insert-transition/remove-transition/remove …), shared by the inspector popover,
  // context menu, seam chips, ⌫ and ⌘B. S7.6: every verb is `clip.<verb>` through `/_api/edit-op`.
  const timelineClipVerb = useCallback(
    // `opts.quiet`: the caller words the outcome itself (a drop that falls back to a new cut). Resolves the
    // answer (`{ ok, … }`), or null when nothing ran — so a multi-step gesture can wait for its one write.
    (clipRef, verb, params, opts = {}) => {
      const canvas = tlKeyRef.current.canvas;
      if (!canvas || canvas === SYSTEM_TAB) return Promise.resolve(null);
      const artboardId = timelineArtboardIdRef.current || undefined;
      const run = runClipVerb({
        fetch: (url, init) => fetch(url, init),
        canvas,
        artboardId,
        clipRef,
        verb,
        params,
        resolveClip: (cc, ref) => {
          // S7.12 — a loose music bed has no sequence row: the op resolves its `loose:` id itself
          if (ref?.bed && typeof ref.stableId === 'string') return { stableId: ref.stableId };
          const all = cc?.ok && Array.isArray(cc.clips) ? cc.clips : [];
          return ref?.transition
            ? all.find((c) => c.kind === 'transition' && c.stableId === ref.stableId) || null
            : resolveClipRef(cc, ref);
        },
        record: recordOnCanvas,
      });
      // ⌘Z right after a verb waits for its record (the canvas's undo barrier, css-knobs.jsx).
      trackRecordableWrite(run);
      return run
        .then((j) => {
          if (opts.quiet) return j;
          if (j && !j.ok) {
            console.warn('[clip-op]', verb, refusalText(j));
            timelineOpFailed(clipVerbRefusal(verb), refusalText(j));
          } else if (j?.ok) {
            // S7.9 — S names what it split and offers the one Undo; the other verbs say what happened.
            const s = tlKeyRef.current;
            const row = (s.sequences || []).find(
              (r) => r.stableId && r.stableId === (clipRef?.stableId ?? clipRef)
            );
            const toast = clipVerbToast(verb, {
              name: row?.label,
              atFrame: params?.atFrame,
              fps: (s.comps || []).find((c) => c.id === s.compId)?.fps,
              params,
            });
            // Undo = the shell's own ⌘Z (menu-runner → runUndoKey), the same path as every toast Undo.
            shellToast(
              toast.text,
              true,
              clipVerbToastAction(toast, () => menuRunner.run('edit.undo'))
            );
            if (verb === 'remove') setTimelineSelectedClip(null);
          }
          return j;
        })
        .catch(() => {
          if (!opts.quiet)
            shellToast(`${clipVerbRefusal(verb).replace(' refused', '')} failed: network error`);
          return null;
        });
    },
    [resolveClipRef, recordOnCanvas, timelineOpFailed, postToActiveCanvas]
  );
  // Task 3 — remove a clip (with server-side ripple for series beats): `clip.remove`, the same op
  // `/_api/remove-sequence` applies. Shared by the panel's ×/context-menu and Delete/Backspace.
  const timelineRemoveClip = useCallback(
    (clipRef) => timelineClipVerb(clipRef, 'remove'),
    [timelineClipVerb]
  );
  // Tauri's WKWebView does NOT implement window.prompt() (returns null
  // synchronously — the "click does nothing" desktop bug), so every text ask
  // goes through this promise-based shell modal instead.
  const [shellPromptState, setShellPromptState] = useState(null); // { title, value, resolve }
  const askText = useCallback(
    (title, initial = '') =>
      new Promise((resolve) => {
        setShellPromptState({ title, value: initial, resolve });
      }),
    []
  );
  const settleShellPrompt = useCallback((value) => {
    setShellPromptState((s) => {
      s?.resolve?.(value);
      return null;
    });
  }, []);

  // Task 23 — timeline comments ride the EXISTING comment system (same WS
  // channel + `_comments/` store), with a `timeline` anchor:
  // { clipStableId, frameOffset } (survives reorder/ripple) or { frame }.
  const timelineAddComment = useCallback((anchor, text) => {
    const canvas = tlKeyRef.current.canvas;
    if (!canvas || canvas === SYSTEM_TAB || !text || !String(text).trim()) return;
    wsSend({
      type: 'comments-add',
      payload: {
        file: canvas,
        text: String(text).trim(),
        selector: '',
        dom_path: [],
        tag: '',
        classes: '',
        bounds: null,
        html_excerpt: '',
        timeline: anchor,
      },
    });
    shellToast('Comment added.', true);
  }, []);
  tlKeyRef.current.selected = timelineSelectedClip;
  tlKeyRef.current.setSelected = setTimelineSelectedClip;
  tlKeyRef.current.removeClip = timelineRemoveClip;
  tlKeyRef.current.clipVerb = timelineClipVerb;
  tlKeyRef.current.addComment = timelineAddComment;
  tlKeyRef.current.askText = askText;

  // DDR-148 — reset the Timeline's comp meta when the active canvas changes (a
  // non-comp canvas fires no announce, so stale comps would linger), then ask
  // the (possibly already-mounted) active canvas to re-announce. video-comp.tsx
  // answers `timeline-request-comps` with a fresh `timeline-comps`.
  useEffect(() => {
    setActiveComps([]);
    setTimelineFrame(0);
    setTimelinePlaying(false);
    setTimelineSelectedClip(null);
    // A stale artboard id from the PREVIOUS canvas would mis-scope the first
    // ops on the next one until its parse lands — clear it with the rest.
    setTimelineArtboardId(null);
    const t = setTimeout(() => postToActiveCanvas({ dgn: 'timeline-request-comps' }), 60);
    return () => clearTimeout(t);
  }, [activePath, postToActiveCanvas]);

  // DDR-148 — fetch the active canvas's raw source when the Timeline is open.
  // Re-runs when a comp is (re)announced, so it refreshes after a canvas edit.
  const [timelineSource, setTimelineSource] = useState('');
  // DDR-150 dogfood — authoritative per-clip media from the enumerator (handles
  // wrapper components + array-fed src the regex parser can't see), merged into
  // the rows for the kind badge + replace addressing.
  const [timelineClipMedia, setTimelineClipMedia] = useState([]);
  // Phase 2 — the enumerator's transitions (stableId + contentHash), in seam
  // order, for the ⧓ chip → Transition tab flow.
  const [timelineTransClips, setTimelineTransClips] = useState([]);
  useEffect(() => {
    if (!timelineOpen || activeComps.length === 0 || !activePath || activePath === SYSTEM_TAB) {
      setTimelineSource('');
      setTimelineClipMedia([]);
      return undefined;
    }
    let alive = true;
    fetch(`/_api/canvas-source?file=${encodeURIComponent(activePath)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.ok && typeof j.source === 'string') setTimelineSource(j.source);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [timelineOpen, activeComps, activePath, timelineRefresh]);

  // Authoritative per-clip media (comp-clips) — a SEPARATE effect keyed on the
  // RESOLVED artboard id, which the parser only knows AFTER timelineSource
  // arrives. Fetching it here (not in the source effect) means it re-runs once
  // the parser scopes to the right comp — so a multi-comp canvas (the showreel:
  // Movie + Reel) overlays the CORRECT comp's media, not the enumerator's own
  // fallback pick.
  useEffect(() => {
    if (!timelineOpen || !activePath || activePath === SYSTEM_TAB || !timelineSource) {
      setTimelineClipMedia([]);
      setTimelineTransClips([]);
      return undefined;
    }
    let alive = true;
    const artboardId = timelineArtboardId || undefined;
    const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(activePath)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
    fetch(ccUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((cc) => {
        if (!alive) return;
        const all = cc?.ok && Array.isArray(cc.clips) ? cc.clips : [];
        setTimelineClipMedia(all.filter((c) => c.kind === 'sequence'));
        setTimelineTransClips(all.filter((c) => c.kind === 'transition'));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [timelineOpen, activePath, timelineSource, timelineArtboardId, timelineRefresh]);

  // Parse (cheap) — re-runs on source change AND on selection change, so the
  // Timeline REDRAWS to whichever artboard the user just selected/moved to.
  useEffect(() => {
    if (!timelineSource) {
      setTimelineSequences([]);
      setTimelineAudio([]);
      setTimelineTransitions([]);
      setTimelineTotal(0);
      return;
    }
    const artboard = canvasActiveArtboard ?? selected?.artboardId ?? null;
    // Seed the parser's fallback total from the comp mounted in THIS artboard,
    // not from whichever comp announced first (issue #75).
    const seedComp =
      (artboard && activeComps.find((c) => c.artboardId === artboard || c.id === artboard)) ||
      activeComps[0];
    const total = seedComp?.durationInFrames || 0;
    const parsed = parseCompTimeline(timelineSource, total, artboard);
    setTimelineArtboardId(parsed.artboardId ?? artboard ?? null);
    // Overlay the enumerator's authoritative media (kind badge + replace target)
    // onto each row by sequence index — it sees wrapper-component + array-fed
    // media the row parser can't (the showreel <ClipShot clip={CLIPS[i]}/> case).
    const merged = parsed.sequences.map((s, i) => {
      const cm = timelineClipMedia[i];
      if (!cm) return s;
      return {
        ...s,
        // Task 3 — the enumerator's durable identity rides on every row so the
        // panel can select + address ops by stableId, never by row index.
        stableId: cm.stableId,
        contentHash: cm.contentHash,
        // Phase 2 — authoritative parametric props for the clip inspector.
        mediaProps: cm.mediaProps ?? null,
        // S7.10 — what the clip inspector reads back: the title's text and entrance, the picture's fit
        text: cm.text ?? s.text ?? null,
        titleMotion: cm.titleMotion ?? null,
        titleStyle: cm.titleStyle ?? null,
        fit: cm.fit ?? null,
        // S7.13 — the clip's framing keyframes, for the Re-frame island
        reframe: cm.reframe ?? null,
        // Task 21 — AI placeholder slate (✨ row + Generate flow).
        placeholder: cm.placeholder ?? null,
        mediaTag: cm.mediaTag ?? s.mediaTag,
        mediaSrc: cm.mediaSrc ?? s.mediaSrc,
        // Replaceable when the enumerator found an addressable media target:
        // a literal-src element (mediaCdId) or an array-fed src (mediaArrayRef).
        replaceable: !!(cm.mediaCdId || cm.mediaArrayRef),
        // The clip's stacked layers (mp4 background + title/…) for expandable rows.
        layers: Array.isArray(cm.layers) ? cm.layers : [],
        hidden: !!cm.hidden,
      };
    });
    setTimelineSequences(merged);
    setTimelineAudio(parsed.audio || []);
    setTimelineTransitions(parsed.transitions || []);
    setTimelineTotal(parsed.total);
  }, [timelineSource, timelineClipMedia, selected, activeComps, canvasActiveArtboard]);

  const toggleAnnotations = useCallback(() => {
    setAnnotationsVisible((v) => {
      const next = !v;
      const el = activePath ? iframesRef.current.get(activePath) : null;
      if (el && el.contentWindow) {
        try {
          el.contentWindow.postMessage({ dgn: 'view-annotations', visible: next }, '*');
        } catch {}
      }
      // S4.9: hiding says how to bring them back; the shell owns the toast because canvas notices
      // can't carry an action (decision v2-S4.9-shell-owns-hidden-toast).
      queueMicrotask(() => syncAnnotationsHiddenToast(next, () => toggleAnnotations()));
      return next;
    });
  }, [activePath]);
  const toggleAnnotationsRef = useRef(toggleAnnotations);
  toggleAnnotationsRef.current = toggleAnnotations;

  // S4.18 (an-visibility) — ⇧P pressed inside the canvas toggles the layer there (annotations-layer) and
  // reports it: the shell keeps the pref in step and shows the same toast, once (the canvas path never
  // calls toggleAnnotations). Only the active canvas, from the origin its frame was built on.
  useEffect(() => {
    const onMessage = (e) => {
      const el = activePath ? iframesRef.current.get(activePath) : null;
      const win = el?.contentWindow;
      if (!win || e.source !== win) return;
      let canvasOrigin;
      try {
        canvasOrigin = new URL(el.src, window.location.href).origin;
      } catch {
        return;
      }
      const m = acceptFromCanvas(e, { canvasOrigin, active: win });
      if (m && m.dgn === 'annotations-visibility') {
        setAnnotationsVisible(m.visible);
        syncAnnotationsHiddenToast(m.visible, () => toggleAnnotationsRef.current());
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [activePath]);

  // Chrome visibility (minimap / zoom-controls / Presentation Mode) applies to
  // EVERY open canvas iframe, not just the active one — broadcast to all. A
  // freshly-loaded iframe is seeded from the dgn:'loaded' handler below.
  const broadcastChrome = useCallback((patch) => {
    for (const el of iframesRef.current.values()) {
      try {
        el.contentWindow.postMessage({ dgn: 'view-chrome', ...patch }, '*');
      } catch {}
    }
  }, []);
  const toggleMinimap = useCallback(() => {
    setMinimapVisible((v) => {
      const next = !v;
      broadcastChrome({ minimap: next });
      return next;
    });
  }, [broadcastChrome]);
  const toggleZoomCtl = useCallback(() => {
    setZoomCtlVisible((v) => {
      const next = !v;
      broadcastChrome({ zoom: next });
      return next;
    });
  }, [broadcastChrome]);
  // S3.1 (D1) — Present lives in the ONE mode store (use-canvas-mode-lane): the toggle and the exit
  // are calls into it, and the canvases' `view-chrome {present}` follows the store, whatever entered
  // or left Present (the switch, ⌥⌘↵, a canvas `mode-request`, esc, the pill).
  const [presenting] = usePresentMode();
  const chromePresentRef = useRef(false);
  useEffect(() => {
    if (chromePresentRef.current === presenting) return;
    chromePresentRef.current = presenting;
    broadcastChrome({ present: presenting });
  }, [presenting, broadcastChrome]);
  const togglePresent = useCallback(() => togglePresentCanvas(), []);
  const exitPresent = useCallback(() => setPresentMode(false), [setPresentMode]);
  // feature-2-print-artboards T3 — per-canvas persisted, so (unlike
  // broadcastChrome above) this targets ONLY the active iframe and PATCHes
  // view.json's `overlays.print` through the same GET-merge/PATCH-split lane
  // the foundation built for `overlays.guides` (api.ts normalizeOverlays is a
  // flat Record<string, boolean> — no server change needed for a new key).
  const togglePrintGuides = useCallback(() => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    setPrintGuidesVisible((v) => {
      const next = !v;
      postToActiveCanvas({ dgn: 'view-chrome', print: next });
      // S7.23 (C25): the Print inspector shows View's default until an artboard has its own switch — tell it
      globalThis.window?.dispatchEvent?.(
        new CustomEvent('maude:print-guides-default', {
          detail: { canvas: activePath, visible: next },
        })
      );
      fetch('/_api/canvas-meta', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: activePath, patch: { overlays: { print: next } } }),
      }).catch(() => {});
      return next;
    });
  }, [activePath, postToActiveCanvas]);

  // P3 (Plan C) — local git user for the menubar presence avatar. One-shot.
  useEffect(() => {
    let cancelled = false;
    fetch('/_api/git-user')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const n = d && typeof d.name === 'string' ? d.name.trim() : '';
        if (n) setGitUser(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // P2 (Plan C) — when the active canvas changes, read its real artboard count
  // from the `<canvas>.meta.json` sidecar (shell-side, no iframe dep).
  useEffect(() => {
    if (!activePath || activePath === SYSTEM_TAB) {
      setActiveArtboards(0);
      setPrintGuidesVisible(false);
      return;
    }
    let cancelled = false;
    fetch('/_api/canvas-meta?file=' + encodeURIComponent(activePath))
      .then((r) => r.json())
      .then((meta) => {
        if (cancelled) return;
        const n = Array.isArray(meta?.artboards) ? meta.artboards.length : 0;
        setActiveArtboards(n);
        // feature-2-print-artboards T3 — reflect THIS canvas's own persisted
        // print-guides flag in the menu checkbox when switching tabs.
        setPrintGuidesVisible(meta?.overlays?.print === true);
        // feature-4 T7b — seed this canvas's persisted locked-layer keys
        // (view.json `locked`, per-user) into the Layers panel state.
        setLockedKeys(new Set(Array.isArray(meta?.locked) ? meta.locked : []));
      })
      .catch(() => {
        if (!cancelled) {
          setActiveArtboards(0);
          setPrintGuidesVisible(false);
          setLockedKeys(new Set());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  // feature-4 dogfood fix (2026-07-19) — the Layers panel used to stay EMPTY
  // until something was selected (the tree only posted on selection). Request
  // the tree for the viewport-active artboard whenever it (or the canvas)
  // changes, so Layers work in browse mode with no selection at all. Small
  // debounce — the active-artboard signal can flicker during a fast pan.
  useEffect(() => {
    if (!activePath || activePath === SYSTEM_TAB || !canvasActiveArtboard) return;
    const t = setTimeout(() => {
      postToActiveCanvas({ dgn: 'request-layers', artboardId: canvasActiveArtboard });
    }, 250);
    return () => clearTimeout(t);
  }, [activePath, canvasActiveArtboard, postToActiveCanvas]);

  // feature-4 T7b — locked layer keys (`"<cdId>:<index>"`, per-user, per-canvas
  // via view.json). Toggling PATCHes the FULL set (replace semantics) + pushes
  // the live set down to the canvas iframe so select/drag enforcement matches
  // the padlock instantly.
  const [lockedKeys, setLockedKeys] = useState(() => new Set());
  const toggleLockedKey = useCallback(
    (key) => {
      if (!activePath || activePath === SYSTEM_TAB) return;
      setLockedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        const arr = [...next];
        fetch('/_api/canvas-meta', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: activePath, patch: { locked: arr } }),
        }).catch(() => {});
        postToActiveCanvas({ dgn: 'locked-set', locked: arr });
        return next;
      });
    },
    [activePath, postToActiveCanvas]
  );
  // Push the seed to a (re)loaded canvas too — the iframe reads
  // `__canvas_meta__.locked` at boot, but a shell-side toggle after a reload
  // must still reach it; re-broadcast whenever the set or canvas changes.
  useEffect(() => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    postToActiveCanvas({ dgn: 'locked-set', locked: [...lockedKeys] });
  }, [lockedKeys, activePath, postToActiveCanvas]);

  // Sync theme to <html data-theme> + localStorage on every change.
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(THEME_STORE, theme);
    } catch {}
    // System-review D9 — the canvas-shell chrome (workspace plane, floating
    // toolbar, minimap, zoom HUD, halos) follows the Maude theme. Broadcast to
    // EVERY open canvas iframe (not just activePath — several may be open); the
    // iframe's canvas-shell sets `data-maude-theme` and re-themes its floating
    // chrome via the --maude-chrome-* family. Artboards keep their DS theme.
    // Mirrors the git-lifecycle broadcast-to-all loop below. On the initial
    // mount run iframesRef is empty (no canvas open yet) — a freshly-loaded
    // iframe instead gets the current theme from the `dgn:'loaded'` handler.
    for (const el of iframesRef.current.values()) {
      try {
        el.contentWindow.postMessage({ dgn: 'theme', theme }, '*');
      } catch {}
    }
  }, [theme]);

  // Persist sidebar / hidden-files / DS-body toggles. Mirror theme pattern.
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORE, sidebarOpen ? '1' : '0');
    } catch {}
  }, [sidebarOpen]);
  useEffect(() => {
    try {
      localStorage.setItem(SHOW_HIDDEN_STORE, showHidden ? '1' : '0');
    } catch {}
  }, [showHidden]);
  useEffect(() => {
    try {
      localStorage.setItem(MINIMAP_STORE, minimapVisible ? '1' : '0');
    } catch {}
  }, [minimapVisible]);
  useEffect(() => {
    try {
      localStorage.setItem(ZOOMCTL_STORE, zoomCtlVisible ? '1' : '0');
    } catch {}
  }, [zoomCtlVisible]);
  useEffect(() => {
    try {
      localStorage.setItem(ANNOT_STORE, annotationsVisible ? '1' : '0');
    } catch {}
  }, [annotationsVisible]);

  // feature-unified-settings-modal — reconcile view prefs with the on-disk store
  // once on mount (disk wins over the localStorage/default init: it survives a
  // cleared localStorage). Applying a value that already matches is a no-op, so
  // there's no flash in the common case. On failure we still mark hydrated so
  // writes resume best-effort.
  useEffect(() => {
    let cancelled = false;
    fetch('/_api/ui-prefs')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((p) => {
        if (cancelled || !p || typeof p !== 'object') return;
        if (p.theme === 'light' || p.theme === 'dark') setTheme(p.theme);
        if (typeof p.minimap === 'boolean') setMinimapVisible(p.minimap);
        if (typeof p.zoom === 'boolean') setZoomCtlVisible(p.zoom);
        if (typeof p.annotations === 'boolean') setAnnotationsVisible(p.annotations);
        if (typeof p.autoOpenInspector === 'boolean') setAutoOpenInspector(p.autoOpenInspector);
        if (p.panelSides && typeof p.panelSides === 'object')
          setPanelSide({ ...PANEL_SIDES_DEFAULTS, ...p.panelSides });
        if (p.layersMode === 'separate' || p.layersMode === 'in-inspector')
          setLayersMode(p.layersMode);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setUiPrefsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror every view pref to disk once hydrated. The barrier stops the initial
  // render (localStorage/default values) from overwriting the disk store before
  // the boot GET has reconciled.
  useEffect(() => {
    if (!uiPrefsHydrated) return;
    persistUiPrefs({
      theme,
      minimap: minimapVisible,
      zoom: zoomCtlVisible,
      annotations: annotationsVisible,
      autoOpenInspector,
      panelSides: panelSide,
      layersMode,
    });
  }, [
    uiPrefsHydrated,
    theme,
    minimapVisible,
    zoomCtlVisible,
    annotationsVisible,
    autoOpenInspector,
    panelSide,
    layersMode,
  ]);
  // localStorage mirror for panel sides + layers mode (synchronous no-flash init).
  useEffect(() => {
    try {
      localStorage.setItem(PANEL_SIDES_STORE, JSON.stringify(panelSide));
    } catch {}
  }, [panelSide]);
  useEffect(() => {
    try {
      localStorage.setItem(LAYERS_MODE_STORE, layersMode);
    } catch {}
  }, [layersMode]);

  // #124 — forget folders that no longer exist (deleted, or moved outside
  // Maude). ONCE per session, on the first loaded tree: pruning on every tree
  // change would race a move's remap against the reload that follows it.
  const treePruned = useRef(false);
  useEffect(() => {
    if (treePruned.current || !treeExp.ready || !treeLoaded || !groups.length) return;
    treePruned.current = true;
    const known = collectDirPaths(groups);
    updateTreeExp((st) => pruneDirs(st, known));
  }, [treeExp.ready, treeLoaded, groups, updateTreeExp]);

  const toggleSection = useCallback(
    (label) => updateTreeExp((st) => toggleSectionState(st, label)),
    [updateTreeExp]
  );
  return {
    askText,
    broadcastChrome,
    exitPresent,
    lockedKeys,
    onPhotoEdit,
    onPhotoRecordEdit,
    onPhotoRemoveBackground,
    performPhotoUndo,
    pushTlUndo,
    resolveClipRef,
    settleShellPrompt,
    shellPromptState,
    timelineAddComment,
    timelineClipVerb,
    timelineRemoveClip,
    timelineTransClips,
    tlKeyRef,
    toggleAnnotations,
    toggleLockedKey,
    toggleMinimap,
    togglePresent,
    togglePrintGuides,
    toggleSection,
    toggleZoomCtl,
  };
}
