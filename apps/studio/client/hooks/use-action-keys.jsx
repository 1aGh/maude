// hooks/use-action-keys.jsx — the shell document's ONE key listener (V2-1.3 contract §5.5;
// V2-2.4 step 3). It replaces three v1 listeners: use-keyboard-shortcuts.jsx (the global keys),
// the timeline transport (use-photo-and-timeline.jsx) and the ⌫ guard (use-canvas-bridge.jsx).
// Each keydown is resolved against the action registry (actions/) with the shell's KeyCtx; the
// winner's handler (client/actions/shell-key-handlers.js) runs v1's body.
//
// Pure swap (until Phase 4): the listener sits where v1's did — `window`, BUBBLE phase — so a
// widget that stops a key's propagation (a tree row, a layer row, the clip inspector) still shadows
// the shell keys exactly as before; it is attached once and reads the shell through a ref.
//
// The frame helpers at the bottom (registerIframe, totalOpen, onShellContextMenu) moved here
// verbatim with use-keyboard-shortcuts.jsx; they keep the store's `keyboardShortcuts` group.

import { useCallback, useEffect, useRef } from 'react';
import { shellKeyCtx } from '../../actions/ctx.ts';
import { ACTIONS } from '../../actions/index.ts';
import { chordFromEvent } from '../../actions/keys.ts';
import { resolveChord } from '../../actions/resolve.ts';
import { documentIndex } from '../../actions/documents.ts';
import { SHELL_KEY_HANDLERS } from '../actions/shell-key-handlers.js';
import { isNativeApp } from '../github.js';
import { SYSTEM_TAB } from '../shell/constants.js';
import { shellToast, totalCounts } from '../shell/util.js';
import { assetTileSelected } from '../v2/assets/assets-bus.js';
import { selectionHasTakes } from '../v2/assets/takes.js';
import { keyOutcome } from '../v2/shell/role-gate.js';
import { ROLE_DENIAL } from '../v2/shell/use-canvas-mode-lane.js';
import { installFocusRescue } from '../v2/shell/modal-focus.js';
import { useAnnotationPrefsLane } from '../v2/shell/use-annotation-prefs.js';
import { singleKeysStore, useSingleKeysLane } from '../v2/shell/use-single-keys.js';

/** The shell resolves over the actions it has a handler for (the canvas runs its own). */
const SHELL_KEY_INDEX = documentIndex(ACTIONS, 'shell', (id) => id in SHELL_KEY_HANDLERS);

/** What the shell knows about one keydown — the inputs of `shellKeyCtx`. */
function shellState(d) {
  const tl = d.tlKeyRef.current;
  const sel = d.selected;
  const one = Array.isArray(sel) ? (sel.length === 1 ? sel[0] : null) : sel;
  return {
    canvasOpen: !!d.activePath && d.activePath !== SYSTEM_TAB,
    // S3.2b: Present hides the Timeline, so its transport keys (space) are not the timeline's then —
    // space steps the deck (`present.next`).
    timelineVisible: !d.presentMode && !!(tl.open && tl.comps?.length),
    presenting: !!d.presentMode,
    native: isNativeApp(),
    readOnly: !!d.viewerMode,
    clipSelected: tl.selected != null,
    artboardSelected: !!(one?.artboardId && !one.id),
    commentFocused: !!d.focusedCommentId,
    // V2-4 gate (WCAG 2.1.4): Settings › General › Keyboard › Single-key shortcuts.
    singleKeys: singleKeysStore.get(),
    // S8.12: a tile is picked in the Assets tab and focus is inside it (↵ places, ⌘I opens details)
    assetTileSelected: assetTileSelected(),
    // S8.16: the one selected picture has other takes — ← → step them (image.next-take / image.prev-take)
    selectionHasTakes: selectionHasTakes(sel, d.activePath),
  };
}

export function useActionKeys(deps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    function onKey(e) {
      const d = depsRef.current;
      const el = document.activeElement;
      const ctx = shellKeyCtx(
        { tag: el?.tagName, type: el?.type, editable: !!el?.isContentEditable },
        shellState(d)
      );
      const r = resolveChord(SHELL_KEY_INDEX, chordFromEvent(e), ctx);
      if (!r) return;
      // A disabled winner swallows the key (resolve.ts); when the ROLE disabled it, the press hears
      // the one denial line (V2-4 gate — role-gate.js), e.g. a commenter's ⌘Z.
      const outcome = keyOutcome(r.action, ctx);
      if (outcome !== 'run') {
        e.preventDefault();
        if (outcome === 'deny') shellToast(ROLE_DENIAL);
        return;
      }
      SHELL_KEY_HANDLERS[r.action.id](d, { event: e, ctx });
    }
    window.addEventListener('keydown', onKey);
    // V2-4 gate (a11y W3): a key that hides what had focus (⌘\, Present) never leaves focus on BODY.
    const uninstallRescue = installFocusRescue(document);
    return () => {
      window.removeEventListener('keydown', onKey);
      uninstallRescue();
    };
  }, []);

  const { commentsByFile, iframesRef } = deps;
  // The canvas resolves its own keys: it hears the switch over the bridge (`key-prefs`).
  useSingleKeysLane(iframesRef);
  // S4.8: the annotation tools' colours, inks and tip are the person's own — the canvas asks, the shell remembers.
  useAnnotationPrefsLane(iframesRef, deps.activePath);
  const registerIframe = useCallback(
    (path, el) => {
      if (el) iframesRef.current.set(path, el);
    },
    [iframesRef]
  );

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
