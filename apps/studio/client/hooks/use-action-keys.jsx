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
import { totalCounts } from '../shell/util.js';

/** The shell resolves over the actions it has a handler for (the canvas runs its own). */
const SHELL_KEY_INDEX = documentIndex(ACTIONS, 'shell', (id) => id in SHELL_KEY_HANDLERS);

/** What the shell knows about one keydown — the inputs of `shellKeyCtx`. */
function shellState(d) {
  const tl = d.tlKeyRef.current;
  const sel = d.selected;
  const one = Array.isArray(sel) ? (sel.length === 1 ? sel[0] : null) : sel;
  return {
    canvasOpen: !!d.activePath && d.activePath !== SYSTEM_TAB,
    timelineVisible: !!(tl.open && tl.comps?.length),
    presenting: !!d.presentMode,
    native: isNativeApp(),
    readOnly: !!d.viewerMode,
    clipSelected: tl.selected != null,
    artboardSelected: !!(one?.artboardId && !one.id),
    commentFocused: !!d.focusedCommentId,
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
      SHELL_KEY_HANDLERS[r.action.id](d, { event: e, ctx });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { commentsByFile, iframesRef } = deps;
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
