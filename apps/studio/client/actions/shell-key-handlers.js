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
import { chordFromEvent } from '../../actions/keys.ts';
import { resolveChord } from '../../actions/resolve.ts';
import { activeComp } from '../panels/timeline-comp-target.js';
import { SYSTEM_TAB } from '../shell/constants.js';
import { shellToast } from '../shell/util.js';
import { runAssetsAction } from '../v2/assets/assets-bus.js';
import { runTakeStep } from '../v2/assets/use-takes-lane.js';
import { playToggle, stepPlayhead, TIMELINE_KEY_HANDLERS } from '../v2/timeline/keys.js';
import { runCopyPng } from '../v2/export/copy-png.js';
import { createBlankCanvas } from '../v2/create/new-canvas.js';
import { runUndoKey } from '../v2/undo/use-undo-projection.jsx';
import { cycleRegion } from '../v2/shell/f6-cycle.js';
import { presentFrom, presentStep, shellStepBack } from '../v2/shell/use-canvas-mode-lane.js';
import { panelLayout } from '../v2/shell/use-panel-layout.js';
import { timelineStore } from '../v2/timeline/timeline-store.js';
import { keyOutcome } from '../v2/shell/role-gate.js';
import { ROLE_DENIAL } from '../v2/shell/use-canvas-mode-lane.js';

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
  // S2.20 — the ⌘Z projection over the op log first; the canvas stack only off it (V2-1.2 feed).
  const canvas = d.activePath && d.activePath !== SYSTEM_TAB ? d.activePath : null;
  void runUndoKey(canvas, redo, () =>
    d.postToActiveCanvas(runActionMessage(redo ? 'edit.redo' : 'edit.undo'))
  );
}

const focusSearch = () => {
  const inp = document.querySelector('.st-search input');
  if (inp) inp.focus();
};

export const SHELL_KEY_HANDLERS = {
  // Esc — v1 ran the transport's clip deselect, then the global ladder: leave Presentation Mode
  // (it fired even in a text field), else clear the focused comment pin.
  'ui.step-back': (d, { event: e, ctx }) => {
    // A press a shell widget already consumed (the tree's search field clears or blurs and prevents
    // it — React runs that before this window listener, which then sees focus on BODY) was that
    // widget's step: the v1 rungs below still run as they did, but the mode and the canvas keep still.
    const consumed = e.defaultPrevented;
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
    if (d.focusedCommentId) {
      d.setFocusedCommentId(null);
      return; // one step per press (04 md-esc): the pin first, the mode on the next
    }
    // S3.12 — the mode's own step back, with the shell focused (Preview → Edit, a held past version →
    // now). The canvas keeps its tools/selection rungs; this is what is left once they are not in play.
    // S3.14 (G6) — a tool armed in the canvas is the canvas's rung: hand it the press (`forward`), take the
    // terminal step here only when there is no canvas to hand it to.
    const hasCanvas = !!d.activePath && d.activePath !== SYSTEM_TAB;
    const step = shellStepBack({
      canEdit: !d.viewerMode,
      typing: consumed,
      forward: () => {
        if (!hasCanvas) return false;
        d.postToActiveCanvas(runActionMessage('ui.step-back'));
        return true;
      },
    });
    if (step === 'set' || step === 'forward') e.preventDefault();
  },
  // S2.21 — F6 / ⇧F6: the keyboard moves between the panels and the canvas (client/v2/shell/f6-cycle.js).
  // A chord the canvas forwarded carries `shiftKey` on its event stub, so the direction survives the hop.
  'ui.cycle-region': (_d, { event: e }) => {
    if (cycleRegion(document, e.shiftKey ? -1 : 1)) e.preventDefault();
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
  // S8.12 — ↵ / ⌘I on a picked Assets tile: the tab runs the same functions its tile menu does
  'assets.place': (_d, { event: e }) => {
    e.preventDefault();
    runAssetsAction('assets.place');
  },
  'assets.details': (_d, { event: e }) => {
    e.preventDefault();
    runAssetsAction('assets.details');
  },
  // S8.16 — ← → on a selected picture with other takes: the neighbouring take in its place (image.replace, one undo step)
  'image.next-take': (d, { event: e }) => {
    e.preventDefault();
    if (!e.repeat) void runTakeStep('next', d);
  },
  'image.prev-take': (d, { event: e }) => {
    e.preventDefault();
    if (!e.repeat) void runTakeStep('prev', d);
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
  // S8.8 — ⇧⌘C: the selection as a PNG on the clipboard (the shell binds what it has selected; no sheet)
  'export.copy-png': (_d, { event: e }) => {
    e.preventDefault();
    runCopyPng().then((r) => shellToast(r.message, r.ok));
  },
  'handoff.open': (d, { event: e }) => {
    e.preventDefault();
    d.setExportDialog({ mode: 'handoff' });
  },
  // Cmd+, — Settings. V2-4.9: a read-only session opens it too — the sheet then holds only General (theme,
  // Inspector words, panel positions: kept in this browser), never the Mac-level sections that
  // mutate project config (Cloud Phase 25 C2). With the timeline transport live, v1's transport also
  // took ⌘, as its `,` (previous keyframe) — it ran first.
  'settings.open': (d, { event: e, ctx }) => {
    if (transportLive(ctx)) prevKeyframe(d, e);
    e.preventDefault();
    d.setSettingsOpen(true);
  },
  // S7.7 — ⇧⌘T keeps the timeline island open / hides it (the store owns the rule; the host mirrors it into `timelineOpen`).
  'view.timeline-keep-open': (_d, { event: e }) => {
    e.preventDefault();
    timelineStore.toggleKeep();
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
  // ⌘\ — hide / show ALL panels (V2-4.1; was T → the Files panel). The corner icons stay as the way back.
  'view.panels': (_d, { event: e }) => {
    e.preventDefault();
    panelLayout.toggleHidden();
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
  // ⌘N — a blank canvas, named by the server (S6.1, C4), opened at once. (The brief board is
  // `canvas.new-brief`, from the menu and ⌘K.)
  'canvas.new': (d, { event: e }) => {
    e.preventDefault();
    createBlankCanvas({ toast: shellToast });
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
        // The press was the clip's. The video artboard the timeline hangs from is selected too, and falling
        // through trashed it as well (or, on its only artboard, refused with "A canvas keeps at least one
        // artboard" over the clip's own removal) — P8-B2.
        return;
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
  // ── timeline transport ── (S7.6: ⌘Z / ⇧⌘Z here are `edit.undo` / `edit.redo`, the one stack)
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
  // S7.8 — Space plays / pauses the followed video in place, with sound (the canvas's tap arrives as `space-tap`).
  'timeline.play': (d, { event: e }) => {
    e.preventDefault();
    playToggle(d);
  },
  // ←/→ = ±1 frame (Shift = ±1 s)
  'timeline.step': (d, { event: e }) => {
    e.preventDefault();
    stepPlayhead(d, e);
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
  // S7.8 — I / O loop range (client/v2/timeline/keys.js)
  ...TIMELINE_KEY_HANDLERS,
};

// V2-4.5b — the toolbar keys and ⌥⌘P with the SHELL focused (a panel, the pill): the active canvas
// replays the chord over `run-action`, so its input router stays the one place that decides (arm,
// add one, open a panel, or `mode-request` back to the shell — which owns the role).
for (const a of ACTIONS) {
  if (!a.id.startsWith('tool.') || a.id in SHELL_KEY_HANDLERS) continue;
  SHELL_KEY_HANDLERS[a.id] = (d, { event: e }) => {
    e.preventDefault();
    // A tool key is the person driving the canvas: hand it the focus first. The shell admits a panel
    // request (F's size picker, E's stickers, I's component picker) only from the iframe that holds
    // the focus (use-tool-panels.js, EH-P4-2) — with the focus left on the tree row that opened the
    // canvas, the canvas armed the tool and the panel was refused in silence.
    try {
      d.iframesRef?.current?.get(d.activePath)?.focus?.();
    } catch {}
    d.postToActiveCanvas(runActionMessage('tool.key', { key: chordFromEvent(e) }));
  };
}
// S3.1 — ⌥⌘↵ / ⇧⌥⌘↵: Present · Artboards through the one mode owner (D1). From the canvas the chord
// arrives forwarded (`fromCanvas`); already presenting, nothing (esc leaves first).
SHELL_KEY_HANDLERS['present.from-selection'] = (d, { event: e }) => {
  e.preventDefault();
  if (!d.presentMode) presentFrom('selection');
};
SHELL_KEY_HANDLERS['present.from-start'] = (d, { event: e }) => {
  e.preventDefault();
  if (!d.presentMode) presentFrom('start');
};
// S3.2b — → · space / ← · ⇧space while presenting, from the shell (its controls hold the focus, not the
// iframe). The lane steps the active canvas; a held key steps once.
SHELL_KEY_HANDLERS['present.next'] = (_d, { event: e }) => {
  e.preventDefault();
  if (!e.repeat) presentStep('next');
};
SHELL_KEY_HANDLERS['present.prev'] = (_d, { event: e }) => {
  e.preventDefault();
  if (!e.repeat) presentStep('prev');
};
SHELL_KEY_HANDLERS['mode.preview'] = (d, { event: e }) => {
  e.preventDefault();
  d.postToActiveCanvas(runActionMessage('mode.preview'));
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
// A forwarded chord carries no keyboard event: the canvas already prevented the default. Only the shift
// state of the chord is kept (⇧F6 goes back).
const forwardedEvent = (chord) => ({ preventDefault() {}, shiftKey: /^⌥?⇧/.test(chord) });

/**
 * Canvas → shell: a chord pressed inside the active canvas (`{dgn:'key', v:1, chord}`). The shell
 * re-resolves it with focus 'canvas' and runs it only when the winner is a `fromCanvas` action —
 * the canvas names a chord, never an action (V2-1.3 §5.7). `d` holds what those handlers need
 * (setPaletteOpen, reloadActive, toggleRightPanel, toggleTimeline, setExportDialog). The caller
 * gates the message on the active frame.
 */
export function runForwardedKey(chord, d, index = FORWARDED_KEYS) {
  const ctx = {
    // EH-P4-3 (S2.1) — the SESSION's role, the same derivation as the shell's own keys
    // (actions/ctx.ts shellKeyCtx): a read-only session is Can comment. Was a hard-coded owner, so
    // a viewer's forwarded chord resolved as the owner's.
    role: d.readOnly ? 'comment' : 'owner',
    shell: 'browser',
    mode: 'edit',
    focus: 'canvas',
    selection: 'none',
    facts: new Set(),
  };
  const r = resolveChord(index, chord, ctx);
  if (!r) return false;
  // A disabled winner swallows the chord; when the ROLE disabled it, the one denial line
  // (role-gate.js keyOutcome — the same rule as a key pressed in the shell).
  const outcome = keyOutcome(r.action, ctx);
  if (outcome !== 'run') {
    if (outcome === 'deny') (d.denied ?? shellToast)(ROLE_DENIAL);
    return true;
  }
  SHELL_KEY_HANDLERS[r.action.id](d, { event: forwardedEvent(chord), ctx });
  return true;
}
