// hooks/use-keyboard-shortcuts.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect } from 'react';
import { SYSTEM_TAB } from '../shell/constants.js';
import { isNativeApp } from '../github.js';
import { totalCounts } from '../shell/util.js';

export function useKeyboardShortcuts({
  activePath, selected, viewerMode, commentsByFile, focusedCommentId, setFocusedCommentId,
  sidebarOpen, setShowHidden, setHelpOpen, setShortcutsOpen, setPaletteOpen, setExportDialog,
  setSettingsOpen, inspectorTab, openPanelExclusive, togglePanel, toggleRightPanel, toggleTimeline,
  presentMode, iframesRef, postToActiveCanvas, performPhotoUndo, tlKeyRef, exitPresent, openSystem,
  closeTab, reloadActive, refreshTree, clearActiveCanvasSelection
}) {
  // ----- Keyboard shortcuts (no Cmd+W — let browser close the tab) -----
  useEffect(() => {
    function onKey(e) {
      const meta = e.metaKey || e.ctrlKey;
      const inEditable =
        ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) ||
        document.activeElement?.isContentEditable;
      // Phase 4.1: shell-side letter shortcuts (H/T/S) must not double-fire
      // inside a focused canvas iframe — the canvas input router owns those
      // letters as tool-mode keys (V/H/C). Cmd-modified shortcuts (⌘R, ⌘⇧M,
      // ⌘F) still fire regardless of focus, mirroring browser convention.
      const inCanvasIframe = document.activeElement?.tagName === 'IFRAME';

      // Esc exits Presentation Mode first — it's the primary way back to the
      // chrome (the menubar is hidden while presenting). Highest priority so it
      // wins over the focused-pin / deselect Esc handlers below, and fires even
      // when focus is inside the canvas iframe.
      if (presentMode && e.key === 'Escape') {
        e.preventDefault();
        exitPresent();
        return;
      }

      // Cmd+K / Ctrl+K — toggle the command palette (works even in inputs).
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // Cmd+Z / Cmd+Shift+Z / Cmd+Y — forward to the active canvas's undo stack
      // when focus is in the shell chrome (not a text field, not the canvas
      // iframe). Inside the canvas iframe the canvas owns Cmd+Z; inside an editable
      // field native undo wins (the inspector's CssKnobs forwards on its own). This
      // makes inspector CSS / inline text / attr edits undoable from anywhere.
      if (meta && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        if (!inEditable && !inCanvasIframe && activePath && activePath !== SYSTEM_TAB) {
          // DDR-150 dogfood #1 (team finding) — SINGLE OWNER per keypress. With
          // the Timeline open on a video-comp canvas, the timeline undo stack
          // owns Cmd+Z/Shift+Cmd+Z (the timeline keydown effect performs it).
          // Without this skip, BOTH handlers fired on one keypress — undoing a
          // clip op AND popping the canvas's annotation undo simultaneously.
          if (
            (e.key === 'z' || e.key === 'Z') &&
            tlKeyRef.current.open &&
            tlKeyRef.current.comps?.length
          ) {
            return; // the timeline shortcuts effect claims it
          }
          const redo = e.key === 'y' || e.key === 'Y' || e.shiftKey;
          // feature-photo-editor — photo edits are sidecar writes (`/_api/photo-edit`),
          // invisible to the canvas's own source-edit undo stack, so they need
          // their own owner here. Claims the keypress only while the Photo tab
          // is the one on screen AND it actually has something to undo/redo —
          // otherwise falls through to the canvas stack as before. (Focus still
          // inside a Photo-tab slider is handled separately by
          // `onPhotoKnobKeyDown`, mirroring `onKnobKeyDown` for CSS knobs.)
          if (inspectorTab === 'photo' && performPhotoUndo(redo)) {
            e.preventDefault();
            return;
          }
          e.preventDefault();
          postToActiveCanvas({ dgn: redo ? 'redo' : 'undo' });
          return;
        }
      }
      // Cmd+Shift+R — refresh the FILES tree (re-read /_index-data). The fs-watch
      // → canvas-list-update auto-refresh can miss events in the compiled desktop
      // sidecar (recursive fs.watch is unreliable in a bun --compile binary), and
      // ⌘R is taken by canvas-iframe reload, so this is the manual escape hatch.
      if (meta && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        refreshTree();
        return;
      }
      // Cmd+R — reload active iframe (override browser reload)
      if (meta && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        reloadActive();
        return;
      }
      // Cmd+Shift+M / Ctrl+Shift+M — toggle right "Comments" panel
      if (meta && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        toggleRightPanel('comments');
        return;
      }
      // Cmd+Shift+G — toggle the Changes (git) panel. Opening it closes the
      // other right-dock panels (one panel at a time).
      if (meta && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        toggleRightPanel('changes');
        return;
      }
      // Cmd+Shift+I — toggle Inspector. Was bare "I", which collided with the
      // canvas highlighter tool (same letter, different action by focus).
      //
      // Cloud Phase 27 C1 — a VIEWER GETS THIS TOO, and the line above used to
      // say the opposite ("the panel is edit chrome"). C1 reversed that on
      // purpose: read-only means cannot CHANGE, not cannot SEE, and a reviewer
      // needs structure and measured values as much as anyone. The View menu
      // already offers it (`viewerHiddenPanels` no longer hides it); the
      // shortcut had been left behind, so the menu said yes and the keyboard
      // said no. Found by writing the parity spec that runs in both shells.
      if (meta && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        toggleRightPanel('inspector');
        return;
      }
      // Phase 31 (DDR-123) — Cmd+Shift+A opens the native ACP chat sidepanel.
      // Cloud Phase 25 C2 — the agent edits; absent for a viewer.
      if (meta && e.shiftKey && (e.key === 'a' || e.key === 'A') && isNativeApp()) {
        e.preventDefault();
        if (!viewerMode) toggleRightPanel('assistant');
        return;
      }
      // Cmd+Shift+E / Cmd+Shift+H — the File-menu chords, previously
      // advertised but never bound.
      if (meta && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        setExportDialog({ mode: 'export' });
        return;
      }
      if (meta && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setExportDialog({ mode: 'handoff' });
        return;
      }
      // Cmd+, — open Settings (AI generation keys). The platform convention for
      // a settings/preferences surface (feature-ai-media-generation, DDR-16x).
      // Cloud Phase 25 C2 — settings mutate project config; absent for a viewer.
      if (meta && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault();
        if (!viewerMode) setSettingsOpen(true);
        return;
      }
      // Cmd+Shift+T — toggle the Timeline (video-comp scrub) dock.
      if (meta && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        toggleTimeline();
        return;
      }
      // Cmd+C / Ctrl+C — Phase 4.1 removed the shell-side comment-drop chord.
      // Canvas comment-drop is the `C` tool letter (press C in the canvas,
      // then click the element) or right-click "Add comment". Cmd+C now
      // reverts to native browser copy.
      if (meta && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
        if (
          selected &&
          selected.selector &&
          activePath &&
          activePath !== SYSTEM_TAB &&
          !inEditable &&
          console &&
          console.warn
        ) {
          console.warn(
            'Cmd+C comment-drop deprecated — press C inside the canvas to enter Comment tool, then click the element.'
          );
        }
        // Fall through to native copy.
      }
      if (inEditable) return;
      // / — focus search (or ⌘F per CV-08 placeholder hint)
      if (e.key === '/') {
        e.preventDefault();
        const inp = document.querySelector('.st-search input');
        if (inp) inp.focus();
        return;
      }
      if (meta && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (!sidebarOpen) openPanelExclusive('tree');
        setTimeout(() => {
          const inp = document.querySelector('.st-search input');
          if (inp) inp.focus();
        }, 0);
        return;
      }
      // T / H / S are bare-letter shell shortcuts. When focus is inside a
      // canvas iframe, the canvas input router claims V/H/C — bail out
      // here so the canvas owns the key and the sidebar/system view don't
      // double-fire on focused-canvas keypresses.
      if (inCanvasIframe) {
        // Esc still bubbles below (composer / focused-pin clear).
        if (e.key !== 'Escape') return;
      }
      // T — toggle Project Tree (sidebar)
      if (e.key === 't' || e.key === 'T') {
        if (e.shiftKey || meta) return;
        e.preventDefault();
        togglePanel('tree');
        return;
      }
      // H — toggle show-hidden (sidecars + project/runtime orphans)
      if (e.key === 'h' || e.key === 'H') {
        if (e.shiftKey || meta) return;
        e.preventDefault();
        setShowHidden((v) => !v);
        return;
      }
      // S — toggle Design system view
      if ((e.key === 's' || e.key === 'S') && !meta && !e.shiftKey) {
        e.preventDefault();
        if (activePath === SYSTEM_TAB) {
          closeTab(SYSTEM_TAB);
        } else {
          openSystem();
        }
        return;
      }
      // N — open the new-brief-board composer (replaces the advertised ⌘N,
      // which the browser reserves for New Window and never delivers).
      if ((e.key === 'n' || e.key === 'N') && !meta && !e.shiftKey) {
        e.preventDefault();
        openPanelExclusive('tree');
        setTimeout(
          () => document.querySelector('[aria-label="New blank brief board"]')?.click(),
          60
        );
        return;
      }
      // ? — keyboard-shortcuts cheat sheet (DS shortcuts overlay)
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      // F1 — the full Help modal (commands & flows)
      if (e.key === 'F1') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      // Esc — clear focused pin. The in-place composer (Phase 6) and thread
      // popover handle their own Esc inside the iframe.
      if (e.key === 'Escape') {
        if (focusedCommentId) {
          setFocusedCommentId(null);
          return;
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    reloadActive,
    refreshTree,
    selected,
    activePath,
    focusedCommentId,
    sidebarOpen,
    openSystem,
    closeTab,
    clearActiveCanvasSelection,
    presentMode,
    exitPresent,
    toggleTimeline,
    inspectorTab,
    performPhotoUndo,
    viewerMode,
  ]);

  const registerIframe = useCallback((path, el) => {
    if (el) iframesRef.current.set(path, el);
  }, []);

  const totalOpen = totalCounts(commentsByFile).open;

  // Suppress the native browser context menu across the shell — the canvas
  // input-router already handles right-click inside the canvas host, but
  // sidebar / menubar / statusbar / floating chrome would otherwise leak the
  // native menu on top of our `.dc-context-menu` (or alone, outside canvas).
  // Editable fields (search box, future text inputs) keep the native menu so
  // copy/paste still works.
  const onShellContextMenu = useCallback((e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      return;
    }
    e.preventDefault();
  }, []);
  return { onShellContextMenu, registerIframe, totalOpen };
}
