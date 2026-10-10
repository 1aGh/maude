// client/actions/shell-key-handlers.js — the shell document's key handlers, bound by action id
// (V2-1.3 contract §5.6; V2-2.4 step 3). The bodies are v1's, moved verbatim from the three shell
// listeners this replaces — use-keyboard-shortcuts.jsx, the timeline transport
// (use-photo-and-timeline.jsx) and the ⌫ guard (use-canvas-bridge.jsx) — so the swap is
// behaviour-identical. Which branch runs is the registry's job now (actions/defs/*): a handler
// keeps only the checks v1 made INSIDE a branch.
//
// Pure swap rules (until Phase 4):
//  · a handler calls `e.preventDefault()` exactly where v1 did — the listener never does it for it;
//  · where v1 ran two listeners on one press (esc, ⌫, ⌘, with the timeline open — V2-1.3 defect 7)
//    the handler runs both halves, transport first (v1's registration order).
//
// Each handler gets `(d, { event, ctx })`: `d` is the deps object the shell passes to
// `useActionKeys` (read through a ref, so it is always the current render's), `ctx` the KeyCtx the
// press resolved with.

import { documentIndex } from '../../actions/documents.ts';
import { ACTIONS, ACTIONS_BY_ID } from '../../actions/index.ts';
import { resolveChord } from '../../actions/resolve.ts';
import { activeComp } from '../panels/timeline-comp-target.js';
import { SYSTEM_TAB } from '../shell/constants.js';
import { shellToast } from '../shell/util.js';

// ── the timeline transport (was use-photo-and-timeline.jsx, DDR-150 P3 Task 9) ─────────────
// Gated by the registry on focus 'timeline' (timeline open + a comp, focus in the shell, not
// typing) and not a focused <select>; a range slider keeps the keys (the "spacebar stopped
// working" dogfood fix).
function transport(d) {
  const s = d.tlKeyRef.current;
  // The timebase of the comp the transport is on, not of whichever comp announced first —
  // Shift+arrow is "±1 second" on THIS artboard (#75).
  const fps = activeComp(s.comps, s.compId)?.fps || 30;
  const total = Math.max(1, s.total);
  const doSeek = (f) => {
    const nf = Math.max(0, Math.min(total - 1, Math.round(f)));
    d.setTimelineFrame(nf);
    d.setTimelinePlaying(false);
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
  return { s, fps, total, doSeek, snapFrames };
}

/** v1 transport's `,` branch — also reached by ⌘, (see `settings.open`). */
function prevKeyframe(d, e) {
  const { s, doSeek, snapFrames } = transport(d);
  e.preventDefault();
  const prev = snapFrames()
    .reverse()
    .find((n) => n < s.frame);
  if (prev != null) doSeek(prev);
}

/** Is the timeline transport live for this press? (the registry's TRANSPORT predicate) */
const transportLive = (ctx) => ctx.focus === 'timeline' && !ctx.facts.has('selectFocused');

/** v1 use-keyboard-shortcuts' `inEditable` — a range slider counted as typing there. */
const shortcutsTyping = (ctx) => ctx.focus === 'text' || ctx.facts.has('rangeFocused');

/** v1 shell undo/redo: the photo tab's own stack first, else the active canvas's. */
function undoRedo(d, e, redo) {
  // feature-photo-editor — photo edits are sidecar writes (`/_api/photo-edit`), invisible to the
  // canvas's own source-edit undo stack, so they need their own owner here. Claims the keypress
  // only while the Photo tab is the one on screen AND it actually has something to undo/redo.
  if (d.inspectorTab === 'photo' && d.performPhotoUndo(redo)) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  d.postToActiveCanvas(runActionMessage(redo ? 'edit.redo' : 'edit.undo'));
}

const focusSearch = () => {
  const inp = document.querySelector('.st-search input');
  if (inp) inp.focus();
};

export const SHELL_KEY_HANDLERS = {
  // Esc — v1 ran the transport's clip deselect, then the global ladder: leave Presentation Mode
  // (it fired even in a text field), else clear the focused comment pin.
  'ui.step-back': (d, { event: e, ctx }) => {
    if (transportLive(ctx)) {
      const s = d.tlKeyRef.current;
      if (s.selected != null) {
        e.preventDefault();
        s.setSelected?.(null);
      }
    }
    if (d.presentMode) {
      e.preventDefault();
      d.exitPresent();
      return;
    }
    if (shortcutsTyping(ctx)) return;
    if (d.focusedCommentId) d.setFocusedCommentId(null);
  },
  'search.open': (d, { event: e }) => {
    e.preventDefault();
    d.setPaletteOpen((v) => !v);
  },
  'edit.undo': (d, { event: e }) => undoRedo(d, e, false),
  'edit.redo': (d, { event: e }) => undoRedo(d, e, true),
  // Cmd+R — reload the active iframe (override browser reload).
  'canvas.reload': (d, { event: e }) => {
    e.preventDefault();
    d.reloadActive();
  },
  // ⇧⌘R — refresh the FILES tree (re-read /_index-data); the manual escape hatch for a missed
  // fs-watch event in the compiled desktop sidecar.
  'canvases.refresh': (d, { event: e }) => {
    e.preventDefault();
    d.refreshTree();
  },
  'view.comments': (d, { event: e }) => {
    e.preventDefault();
    d.toggleRightPanel('comments');
  },
  'history.open': (d, { event: e }) => {
    e.preventDefault();
    d.toggleRightPanel('changes');
  },
  // Cloud Phase 27 C1 — a viewer gets the inspector too (read-only means cannot CHANGE, not
  // cannot SEE).
  'view.inspector': (d, { event: e }) => {
    e.preventDefault();
    d.toggleRightPanel('inspector');
  },
  // Phase 31 (DDR-123) — the native ACP chat sidepanel; Cloud Phase 25 C2 — absent for a viewer
  // (the key is still swallowed).
  'ai.chat': (d, { event: e }) => {
    e.preventDefault();
    if (!d.viewerMode) d.toggleRightPanel('assistant');
  },
  'export.open': (d, { event: e }) => {
    e.preventDefault();
    d.setExportDialog({ mode: 'export' });
  },
  'handoff.open': (d, { event: e }) => {
    e.preventDefault();
    d.setExportDialog({ mode: 'handoff' });
  },
  // Cmd+, — Settings (Cloud Phase 25 C2 — settings mutate project config; absent for a viewer,
  // key still swallowed). With the timeline transport live, v1's transport also took ⌘, as its
  // `,` (previous keyframe) — it ran first.
  'settings.open': (d, { event: e, ctx }) => {
    if (transportLive(ctx)) prevKeyframe(d, e);
    e.preventDefault();
    if (!d.viewerMode) d.setSettingsOpen(true);
  },
  'view.timeline-keep-open': (d, { event: e }) => {
    e.preventDefault();
    d.toggleTimeline();
  },
  // Cmd+C — Phase 4.1 removed the shell-side comment-drop chord; v1 only logs the deprecation and
  // falls through to the native copy.
  'edit.copy': (d, { ctx }) => {
    if (
      d.selected?.selector &&
      d.activePath &&
      d.activePath !== SYSTEM_TAB &&
      !shortcutsTyping(ctx)
    ) {
      console.warn(
        'Cmd+C comment-drop deprecated — press C inside the canvas to enter Comment tool, then click the element.'
      );
    }
  },
  // / — focus search (or ⌘F per CV-08 placeholder hint)
  'canvases.search': (_d, { event: e }) => {
    e.preventDefault();
    focusSearch();
  },
  'canvases.find': (d, { event: e }) => {
    e.preventDefault();
    if (!d.sidebarOpen) d.openPanelExclusive('tree');
    setTimeout(focusSearch, 0);
  },
  // T — toggle Project Tree (sidebar)
  'view.panels': (d, { event: e }) => {
    e.preventDefault();
    d.togglePanel('tree');
  },
  // H — toggle show-hidden (sidecars + project/runtime orphans)
  'view.hidden-files': (d, { event: e }) => {
    e.preventDefault();
    d.setShowHidden((v) => !v);
  },
  // S — toggle Design system view
  'view.design-system': (d, { event: e }) => {
    e.preventDefault();
    if (d.activePath === SYSTEM_TAB) d.closeTab(SYSTEM_TAB);
    else d.openSystem();
  },
  // N — open the new-brief-board composer (the browser reserves ⌘N and never delivers it).
  'canvas.new': (d, { event: e }) => {
    e.preventDefault();
    d.openPanelExclusive('tree');
    setTimeout(() => document.querySelector('[aria-label="New blank brief board"]')?.click(), 60);
  },
  // ? — keyboard-shortcuts cheat sheet (DS shortcuts overlay)
  'help.shortcuts': (d, { event: e }) => {
    e.preventDefault();
    d.setShortcutsOpen((v) => !v);
  },
  // F1 — the full Help modal (commands & flows)
  'help.guides': (d, { event: e }) => {
    e.preventDefault();
    d.setHelpOpen(true);
  },
  // ⌫ / ⌦ — the transport removes the selected clip (any modifier; ripple on the server for
  // series beats), then the shell-level guard: in the Tauri desktop app an unhandled Backspace
  // triggers WKWebView back-navigation, which reloads the WHOLE app to "Starting…" — prevent it
  // whenever focus isn't editable, and if a single artboard is the selection, delete it.
  'object.remove': (d, { event: e, ctx }) => {
    if (transportLive(ctx)) {
      const s = d.tlKeyRef.current;
      if (s.selected != null) {
        e.preventDefault();
        s.removeClip?.({ stableId: s.selected });
      }
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (ctx.focus === 'text' || ctx.facts.has('selectFocused') || ctx.facts.has('rangeFocused'))
      return;
    // Suppress the back-nav unconditionally once focus isn't editable — the activePath check below
    // is app logic, not default-action gating (the desktop "Starting…" hang).
    e.preventDefault();
    if (!d.activePath || d.activePath === SYSTEM_TAB) return;
    const sel = d.selected;
    const one = Array.isArray(sel) ? (sel.length === 1 ? sel[0] : null) : sel;
    if (one?.artboardId && !one.id) d.deleteArtboardShell(one.artboardId);
  },
  // ── timeline transport ──
  'timeline.undo': (d, { event: e }) => {
    // Only when the shell (not the canvas iframe) has focus + the timeline is active, so the
    // canvas's own annotation undo is untouched.
    e.preventDefault();
    d.tlKeyRef.current.undoRedo('undo');
  },
  'timeline.redo': (d, { event: e }) => {
    e.preventDefault();
    d.tlKeyRef.current.undoRedo('redo');
  },
  // Task 16 — ⌘B splits the selection at the playhead; with nothing selected, the clip under the
  // playhead (iMovie behavior).
  'timeline.split': (d, { event: e }) => {
    const s = d.tlKeyRef.current;
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
  },
  'timeline.play': (d, { event: e }) => {
    const s = d.tlKeyRef.current;
    e.preventDefault();
    if (s.playing) {
      d.setTimelinePlaying(false);
      s.post({ dgn: 'timeline-pause', id: s.compId });
    } else {
      d.setTimelinePlaying(true);
      s.post({ dgn: 'timeline-mute', muted: s.muted, id: s.compId });
      s.post({ dgn: 'timeline-loop', loop: s.loop, id: s.compId });
      s.post({ dgn: 'timeline-play', id: s.compId });
    }
  },
  // ←/→ = ±1 frame (Shift = ±1 s)
  'timeline.step': (d, { event: e }) => {
    const { s, fps, doSeek } = transport(d);
    e.preventDefault();
    const step = e.shiftKey ? fps : 1;
    doSeek(s.frame + (e.key === 'ArrowRight' ? step : -step));
  },
  'timeline.to-start': (d, { event: e }) => {
    const { doSeek } = transport(d);
    e.preventDefault();
    doSeek(0);
  },
  'timeline.to-end': (d, { event: e }) => {
    const { total, doSeek } = transport(d);
    e.preventDefault();
    doSeek(total - 1);
  },
  'timeline.next-keyframe': (d, { event: e }) => {
    const { s, doSeek, snapFrames } = transport(d);
    e.preventDefault();
    const next = snapFrames().find((n) => n > s.frame);
    if (next != null) doSeek(next);
  },
  'timeline.prev-keyframe': (d, { event: e }) => prevKeyframe(d, e),
};

// ── the message lanes (V2-1.3 §5.7; V2-2.4 step 6) ─────────────────────────────────────────

/** Shell → canvas: run one of the iframe's canvas actions. The canvas honours it only from
 *  its parent (canvas-shell.tsx / annotations-layer.tsx). */
export function runActionMessage(id, params) {
  return params ? { dgn: 'run-action', v: 1, id, params } : { dgn: 'run-action', v: 1, id };
}

/** The `fromCanvas` actions the shell runs for a chord the canvas forwarded. */
const FORWARDED_KEYS = documentIndex(
  ACTIONS,
  'shell',
  (id) => !!ACTIONS_BY_ID.get(id)?.fromCanvas && id in SHELL_KEY_HANDLERS
);
// A forwarded chord carries no keyboard event: the canvas already prevented the default.
const FORWARDED_EVENT = { preventDefault() {} };

/**
 * Canvas → shell: a chord pressed inside the active canvas (`{dgn:'key', v:1, chord}`). The shell
 * re-resolves it with focus 'canvas' and runs it only when the winner is a `fromCanvas` action —
 * the canvas names a chord, never an action (V2-1.3 §5.7). `d` holds what those handlers need
 * (setPaletteOpen, reloadActive, toggleRightPanel, toggleTimeline, setExportDialog). The caller
 * gates the message on the active frame.
 */
export function runForwardedKey(chord, d) {
  const ctx = {
    role: 'owner',
    shell: 'browser',
    mode: 'edit',
    focus: 'canvas',
    selection: 'none',
    facts: new Set(),
  };
  const r = resolveChord(FORWARDED_KEYS, chord, ctx);
  if (!r) return false;
  SHELL_KEY_HANDLERS[r.action.id](d, { event: FORWARDED_EVENT, ctx });
  return true;
}
