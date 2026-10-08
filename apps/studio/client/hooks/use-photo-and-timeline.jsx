// hooks/use-photo-and-timeline.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect, useRef, useState } from 'react';
import { persistUiPrefs, shellToast } from '../shell/util.js';
import { ANNOT_STORE, LAYERS_MODE_STORE, MINIMAP_STORE, PANEL_SIDES_STORE, SHOW_HIDDEN_STORE, SIDEBAR_STORE, SYSTEM_TAB, THEME_STORE, ZOOMCTL_STORE } from '../shell/constants.js';
import { activeComp } from '../panels/timeline-comp-target.js';
import { parseCompTimeline } from '../panels/timeline-parse.js';
import { PANEL_SIDES_DEFAULTS } from '../shell/dock.jsx';
import { collectDirPaths, pruneDirs, toggleSection as toggleSectionState } from '../tree-expansion.js';

export function usePhotoAndTimeline({
  groups, treeLoaded, activePath, selected, theme, setTheme, sidebarOpen, showHidden, treeExp,
  updateTreeExp, panelSide, setPanelSide, layersMode, setLayersMode, timelineOpen, activeComps,
  setActiveComps, timelineFrame, setTimelineFrame, timelinePlaying, setTimelinePlaying, timelineLoop,
  timelineMuted, canvasActiveArtboard, timelineSequences, setTimelineSequences, setTimelineAudio,
  setTimelineTransitions, timelineTotal, setTimelineTotal, timelineArtboardId, setTimelineArtboardId,
  timelineArtboardIdRef, timelineCompId, timelineSelectedClip, setTimelineSelectedClip,
  timelineRefresh, timelineOpFailed, photoUndoRef, setPhotoRev, autoOpenInspector,
  setAutoOpenInspector, annotationsVisible, setAnnotationsVisible, uiPrefsHydrated,
  setUiPrefsHydrated, minimapVisible, setMinimapVisible, zoomCtlVisible, setZoomCtlVisible,
  setPresentMode, setPrintGuidesVisible, setActiveArtboards, setGitUser, iframesRef,
  postToActiveCanvas, wsSend
}) {
  // ── feature-photo-editor — the Photo tab's three channels ─────────────────
  // (1) live preview: broadcast the edit DOWN to the active canvas iframe, whose
  //     canvas-lib `PhotoPreviewBridge` bakes the composite and swaps it directly
  //     into the matching `<img>`/`<image>` element's src/href (iteration 2 — see
  //     the bridge's own header comment for why it's a direct swap, not an
  //     overlay). (2) undo: a shell-side stack (photo edits are sidecar writes,
  //     not the canvas-side source-edit stack). (3) background removal: the
  //     client-side @imgly ML flow (Task 12).
  const onPhotoEdit = useCallback(
    (asset, edit) => postToActiveCanvas({ dgn: 'photo-preview', asset, edit }),
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

  // DDR-150 dogfood #7 — a file dragged from Finder and dropped on a shell area
  // with no drop target used to make the browser NAVIGATE AWAY to the file
  // (file:// replaces the app). Document-level guard: always cancel the default
  // for file drags; the TimelinePanel's own onDrop (bubbling before this) still
  // receives the drop first — this only blocks the browser fallback.
  useEffect(() => {
    const isFileDrag = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDocDragOver = (e) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    const onDocDrop = (e) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    document.addEventListener('dragover', onDocDragOver);
    document.addEventListener('drop', onDocDrop);
    return () => {
      document.removeEventListener('dragover', onDocDragOver);
      document.removeEventListener('drop', onDocDrop);
    };
  }, []);

  // DDR-150 P3 Task 9 — timeline keyboard shortcuts. Read live state through a
  // ref so the listener attaches once. Gated on: timeline open + a comp active +
  // focus NOT in a text field. Space doesn't steal the canvas PAN chord because
  // that keydown fires inside the focused canvas iframe, never reaching this
  // top-document listener. Space = play/pause · ←/→ = ±1 frame (Shift = ±1s) ·
  // Home/End = start/end · ,/. = prev/next keyframe boundary.
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

  // DDR-150 dogfood #1 — Timeline undo/redo. Every successful clip op (move /
  // trim / remove / insert / z-reorder / replace-src) returns a server `seq`
  // registered in the whole-file undo log; Cmd+Z / Shift+Cmd+Z replay it via
  // /_api/reorder-revert (guarded swap — 409s honestly if the canvas diverged).
  const tlUndoRef = useRef({ undo: [], redo: [] });
  const pushTlUndo = useCallback((canvas, seq, label) => {
    if (typeof seq !== 'number') return;
    tlUndoRef.current.undo.push({ canvas, seq, label });
    tlUndoRef.current.redo = []; // a new edit invalidates the redo branch
    if (tlUndoRef.current.undo.length > 50) tlUndoRef.current.undo.shift();
  }, []);
  const tlUndoRedo = useCallback((dir) => {
    const s = tlUndoRef.current;
    const src = dir === 'undo' ? s.undo : s.redo;
    const dst = dir === 'undo' ? s.redo : s.undo;
    const canvas = tlKeyRef.current.canvas;
    // Last entry for THIS canvas (stacks are global; ops are per-canvas).
    let idx = -1;
    for (let i = src.length - 1; i >= 0; i--) {
      if (src[i].canvas === canvas) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      shellToast(dir === 'undo' ? 'Nothing to undo on this timeline.' : 'Nothing to redo.');
      return;
    }
    const entry = src[idx];
    fetch('/_api/reorder-revert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas: entry.canvas, seq: entry.seq, dir }),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        src.splice(idx, 1);
        if (j?.ok) {
          dst.push(entry);
          shellToast(`${dir === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}`, true);
        } else {
          // 409 canvas diverged / 404 server restarted — entry is dead, drop it.
          shellToast(`${dir === 'undo' ? 'Undo' : 'Redo'} skipped: ${j?.error || 'failed'}`);
        }
      })
      .catch(() => shellToast(`${dir === 'undo' ? 'Undo' : 'Redo'} failed: network error`));
  }, []);
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

  // Task 3 — remove a clip (with server-side ripple for series beats). Shared by
  // the panel's ×/context-menu and the Delete/Backspace key on the selection.
  const timelineRemoveClip = useCallback(
    (clipRef) => {
      const canvas = tlKeyRef.current.canvas;
      if (!canvas || canvas === SYSTEM_TAB) return;
      const artboardId = timelineArtboardIdRef.current || undefined;
      const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(canvas)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
      fetch(ccUrl)
        .then((r) => r.json().catch(() => ({})))
        .then((cc) => {
          const clip = resolveClipRef(cc, clipRef);
          if (!clip?.stableId) return null;
          return fetch('/_api/remove-sequence', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              canvas,
              artboardId,
              stableId: clip.stableId,
              contentHash: clip.contentHash,
            }),
          });
        })
        .then((r) => (r ? r.json() : null))
        .then((j) => {
          if (j && !j.ok) {
            console.warn('[remove-clip]', j.error || 'failed');
            timelineOpFailed('Remove refused', j.error);
          } else if (j?.ok) {
            shellToast('Clip removed.', true);
            if (j.seq != null) pushTlUndo(canvas, j.seq, 'remove clip');
            setTimelineSelectedClip(null);
          }
        })
        .catch(() => shellToast('Remove failed: network error'));
    },
    [resolveClipRef, pushTlUndo]
  );
  // Phase 2/3 — the parametric verb pipe (speed/trim-in/audio/detach-audio/
  // framing/grade/transition/split/insert-transition/remove-transition), shared
  // by the inspector popover, context menu, seam chips, and keyboard (⌘B).
  const timelineClipVerb = useCallback(
    (clipRef, verb, params) => {
      const canvas = tlKeyRef.current.canvas;
      if (!canvas || canvas === SYSTEM_TAB) return;
      const artboardId = timelineArtboardIdRef.current || undefined;
      const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(canvas)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
      fetch(ccUrl)
        .then((r) => r.json().catch(() => ({})))
        .then((cc) => {
          const all = cc?.ok && Array.isArray(cc.clips) ? cc.clips : [];
          const clip = clipRef?.transition
            ? all.find((c) => c.kind === 'transition' && c.stableId === clipRef.stableId) || null
            : resolveClipRef(cc, clipRef);
          if (!clip?.stableId) return null;
          return fetch('/_api/clip-edit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              canvas,
              artboardId,
              stableId: clip.stableId,
              contentHash: clip.contentHash,
              verb,
              ...params,
            }),
          });
        })
        .then((r) => (r ? r.json() : null))
        .then((j) => {
          if (j && !j.ok) {
            console.warn('[clip-edit]', verb, j.error || 'failed');
            timelineOpFailed(`${verb} refused`, j.error);
          } else if (j?.ok) {
            const labels = {
              speed: 'set speed',
              'trim-in': 'trim in-point',
              audio: 'clip audio',
              'detach-audio': 'detach audio',
              framing: 'crop clip',
              grade: 'grade clip',
              transition: 'edit transition',
              split: 'split clip',
              'insert-transition': 'add transition',
              'remove-transition': 'remove transition',
              'set-text': 'edit text',
              'to-overlay': 'move to overlay layer',
              'to-storyline': 'move to storyline',
              'layer-order': 'reorder layers',
            };
            shellToast(`Applied: ${labels[verb] || verb}.`, true);
            if (j.seq != null) pushTlUndo(canvas, j.seq, labels[verb] || verb);
          }
        })
        .catch(() => shellToast(`${verb} failed: network error`));
    },
    [resolveClipRef, pushTlUndo, timelineOpFailed]
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

  useEffect(() => {
    const onKey = (e) => {
      const s = tlKeyRef.current;
      if (!s.open || !s.comps?.length) return;
      const t = e.target;
      const tag = t?.tagName;
      // Range sliders (zoom / volume) keep focus after a drag — Space must
      // still play/pause (the "spacebar stopped working" dogfood bug). Text
      // inputs stay exempt.
      if (tag === 'INPUT' && t?.type !== 'range') return;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      // The timebase of the comp the transport is on, not of whichever comp
      // announced first — Shift+arrow is "±1 second" on THIS artboard (#75).
      const fps = activeComp(s.comps, s.compId)?.fps || 30;
      const total = Math.max(1, s.total);
      const doSeek = (f) => {
        const nf = Math.max(0, Math.min(total - 1, Math.round(f)));
        setTimelineFrame(nf);
        setTimelinePlaying(false);
        s.post({ dgn: 'timeline-seek', frame: nf, id: s.compId });
      };
      const snapFrames = () => {
        const pts = new Set([0, total - 1]);
        for (const seq of s.sequences || []) {
          pts.add(seq.from);
          for (const kf of seq.keyframes || []) {
            pts.add(kf.from);
            pts.add(kf.to);
          }
        }
        return [...pts].filter((n) => n >= 0 && n < total).sort((a, b) => a - b);
      };
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        // Cmd+Z / Shift+Cmd+Z — undo/redo the last timeline clip op. Only when
        // the shell (not the canvas iframe) has focus + the timeline is active,
        // so the canvas's own annotation undo is untouched.
        e.preventDefault();
        tlUndoRedo(e.shiftKey ? 'redo' : 'undo');
        return;
      }
      // Task 3 — the select → act grammar: Esc deselects, Delete/Backspace
      // removes the selection (with ripple on the server for series beats).
      if (e.key === 'Escape') {
        if (s.selected != null) {
          e.preventDefault();
          s.setSelected?.(null);
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected != null) {
        e.preventDefault();
        s.removeClip?.({ stableId: s.selected });
        return;
      }
      // Task 23 + dogfood 2026-07-30 — `C` ARMS the panel's comment tool
      // (click-to-place, like the artboard's C); the panel's own window
      // keydown owns the toggle, so the shell must NOT double-handle it.
      // Task 16 — ⌘B splits the selection at the playhead; with nothing
      // selected, the clip under the playhead (iMovie behavior).
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        let ref = s.selected != null ? { stableId: s.selected } : null;
        if (!ref) {
          const rows = s.sequences || [];
          const under =
            rows.find((r2) => r2.series && s.frame >= r2.from && s.frame < r2.from + r2.duration) ||
            rows.find((r2) => s.frame >= r2.from && s.frame < r2.from + r2.duration);
          if (under?.stableId) ref = { stableId: under.stableId };
        }
        if (ref) s.clipVerb?.(ref, 'split', { atFrame: s.frame });
        else shellToast('Nothing under the playhead to split.');
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (s.playing) {
          setTimelinePlaying(false);
          s.post({ dgn: 'timeline-pause', id: s.compId });
        } else {
          setTimelinePlaying(true);
          s.post({ dgn: 'timeline-mute', muted: s.muted, id: s.compId });
          s.post({ dgn: 'timeline-loop', loop: s.loop, id: s.compId });
          s.post({ dgn: 'timeline-play', id: s.compId });
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        doSeek(s.frame + (e.shiftKey ? fps : 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        doSeek(s.frame - (e.shiftKey ? fps : 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        doSeek(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        doSeek(total - 1);
      } else if (e.key === '.') {
        e.preventDefault();
        const next = snapFrames().find((n) => n > s.frame);
        if (next != null) doSeek(next);
      } else if (e.key === ',') {
        e.preventDefault();
        const prev = snapFrames()
          .reverse()
          .find((n) => n < s.frame);
        if (prev != null) doSeek(prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      return next;
    });
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
  const togglePresent = useCallback(() => {
    setPresentMode((v) => {
      const next = !v;
      broadcastChrome({ present: next });
      return next;
    });
  }, [broadcastChrome]);
  const exitPresent = useCallback(() => {
    setPresentMode(false);
    broadcastChrome({ present: false });
  }, [broadcastChrome]);
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
    askText, broadcastChrome, exitPresent, lockedKeys, onPhotoEdit, onPhotoRecordEdit,
    onPhotoRemoveBackground, performPhotoUndo, pushTlUndo, resolveClipRef, settleShellPrompt,
    shellPromptState, timelineAddComment, timelineClipVerb, timelineRemoveClip, timelineTransClips,
    tlKeyRef, toggleAnnotations, toggleLockedKey, toggleMinimap, togglePresent, togglePrintGuides,
    toggleSection, toggleZoomCtl
  };
}
