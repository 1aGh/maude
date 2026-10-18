// client/v2/shell/menu-runner.js — V2-4.2: what a row of the one menu RUNS.
//
// There is no second handler here. Each id calls the same function the shell already has for it —
// the palette's `run` map, the old menubar's callbacks, the key handlers' bodies — through the
// closures the shell hands in (`d`). `createMenuHandlers(d)` is the map; `menuRunner` is the
// singleton the pill binds on mount and ⌘K calls, so a row and its ⌘K twin are one function.
//
// Dispatch order for `runMenuAction(id)`:
//   1. an explicit shell handler (the map below),
//   2. exec 'canvas' → the canvas iframe's `run-action` lane (V2-1.3 §5.7),
//   3. exec 'native' → the Tauri command that owns it (NATIVE_COMMANDS).
// An id with none of the three has no runner: `runnableIds()` says so and the test pins it empty.

import { TEMPLATES } from '../../../annotations/templates.ts';
import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { runActionMessage } from '../../actions/shell-key-handlers.js';
import { createAdvancedHandlers } from '../ai/advanced-handlers.js';
import { aiPanelWantsFocus, requestFocusAI } from '../ai/panel-focus.js';
import { createDiagnosticsHandlers } from '../diagnostics/diagnostics-handlers.js';
import { foldStore } from '../fold/use-fold.js';
import { INSPECTOR_ACTION_IDS, runInspectorAction } from '../inspector/inspector-actions.js';
import { createSettingsHandlers } from '../settings/settings-handlers.js';
import { dispatchCanvasOp, requestCanvasesOp, requestTrash } from '../left-panel/left-panel-bus.js';
import { presentFrom, togglePresentCanvas } from './use-canvas-mode-lane.js';
import { panelLayout } from './use-panel-layout.js';

/** Edit ▸ Advanced ▸ New artboard → the preset `onInsertArtboard` takes. */
export const ARTBOARD_PRESET = {
  'artboard.new-desktop': 'desktop',
  'artboard.new-laptop': 'laptop',
  'artboard.new-tablet': 'tablet',
  'artboard.new-mobile': 'mobile',
  'artboard.new-a4': 'print-a4',
  'artboard.new-letter': 'print-letter',
};

/** exec 'native' actions → the Tauri command that does them (lib.rs / home.rs). `nav.home` and
 *  `home.open` are one command: the pinned Home tab. */
export const NATIVE_COMMANDS = {
  'nav.home': 'new_home_tab',
  'home.open': 'new_home_tab',
  'project.open': 'open_project_folder',
};

/** Fired on `window` for a menu action whose owner is a mounted component with its own state (the
 *  create-project dialog in IdentityBar). Detail: `{ id }`. */
export const MENU_ACTION_EVENT = 'maude:menu-action';

const noop = () => {};

/**
 * @param d the shell's closures (see ShellProjectPill in app.jsx):
 *   activePath, native, canvasOpen, toast(msg), invoke(cmd), postToActiveCanvas(msg),
 *   openPanelExclusive(id), toggleRightPanel(id), setExportDialog(o), setSettingsOpen(b),
 *   setHelpOpen(b), setShortcutsOpen(b), setReportBugOpen(b), onUsageTour(), onCollabTour(),
 *   onQuickSetup(), onIntro(), onWhatsNew(), onShare(), onReload(), onCloseCanvas(), onAssembleVideo(),
 *   onToggleShowHidden(), onToggleAnnotations(), onToggleMinimap(), onToggleZoomCtl(),
 *   onTogglePresent(), onTogglePrintGuides(), onToggleTimeline(), onToggleAutoOpenInspector(),
 *   onToggleLayersMode(), onInsertArtboard(preset), onImportFigma(), onImportBrand(), onDuplicate(path),
 *   onRename(path, name), onPickMoveDestination() (opens the folder list), onSwitchAccount(),
 *   onOpenDashboard() (a cloud tab's Back to Home), onCutPaste(kind)
 */
export function createMenuHandlers(d) {
  const h = {
    // ── File ──
    'canvas.new': () => {
      d.openPanelExclusive('tree');
      setTimeout(() => document.querySelector('[aria-label="New blank brief board"]')?.click(), 60);
    },
    // IdentityBar owns the create dialog's state; it hears this the way it hears the native menu.
    'project.new': () => {
      if (!d.native) {
        d.toast('New project… is in the Maude desktop app.');
        return;
      }
      window.dispatchEvent(new CustomEvent(MENU_ACTION_EVENT, { detail: { id: 'project.new' } }));
    },
    // V2-4 gate: IdentityBar's 'get' / 'share' views, heard like project.new (desktop only).
    'project.pull-copy': () => {
      if (!d.native) {
        d.toast('Pull a local copy… is in the Maude desktop app.');
        return;
      }
      window.dispatchEvent(
        new CustomEvent(MENU_ACTION_EVENT, { detail: { id: 'project.pull-copy' } })
      );
    },
    'project.share-github': () => {
      if (!d.native) {
        d.toast('Share on GitHub… is in the Maude desktop app.');
        return;
      }
      window.dispatchEvent(
        new CustomEvent(MENU_ACTION_EVENT, { detail: { id: 'project.share-github' } })
      );
    },
    'canvas.duplicate': () => {
      if (d.activePath) d.onDuplicate(d.activePath);
    },
    // S1.2 — rename in place: the Canvases panel turns the open canvas's name into a field (↵ renames, esc
    // keeps it). The panel is brought up first and may not be mounted yet, so the request waits for it.
    'canvas.rename': () => {
      if (!d.activePath) return;
      panelLayout.show();
      d.openPanelExclusive('tree');
      requestCanvasesOp({ op: 'rename', path: d.activePath });
    },
    // S1.2 — pins are per person; these act on the open canvas (the row's hover pin does the same).
    'canvases.pin': () => {
      if (d.activePath) requestCanvasesOp({ op: 'pin', path: d.activePath, pinned: true });
    },
    'canvases.unpin': () => {
      if (d.activePath) requestCanvasesOp({ op: 'pin', path: d.activePath, pinned: false });
    },
    'canvases.sort': () => {
      panelLayout.show();
      d.openPanelExclusive('tree');
      requestCanvasesOp({ op: 'sort' });
    },
    // S1.2 — the shell's tab hook owns the closures for these two (share links, the tree reload, the tab).
    'canvas.copy-link': () => {
      if (d.activePath) dispatchCanvasOp('copy-link', d.activePath);
    },
    'canvas.trash': () => {
      if (d.activePath) dispatchCanvasOp('trash', d.activePath, d.canvasName);
    },
    'canvas.move': () => {
      if (d.activePath) d.onPickMoveDestination();
    },
    'import.figma': () => d.onImportFigma(),
    'import.brand': () => d.onImportBrand(),
    'video.assemble': () => d.onAssembleVideo(),
    'export.open': () => d.setExportDialog({ mode: 'export' }),
    'handoff.open': () => d.setExportDialog({ mode: 'handoff' }),
    'canvas.close': () => d.onCloseCanvas(),
    'account.switch': () => d.onSwitchAccount(),
    // ── Edit ── (undo / redo / select / properties ride the canvas lane; artboards the shell's)
    'edit.cut': () => d.onCutPaste('cut'),
    'edit.copy': () => d.onCutPaste('copy'),
    'edit.paste': () => d.onCutPaste('paste'),
    // ── View ──
    'view.panels': () => panelLayout.toggleHidden(),
    'view.pin-panels': () => panelLayout.togglePinned(),
    'view.comments': () => d.toggleRightPanel('comments'),
    'view.exports': () => d.onToggleExports(),
    // V2-4.4a — Assets is the left panel's third tab; Layers as a panel is the switch that puts Layers there
    // (or in the Inspector); Trash is the Canvases panel's last row (⌘K, no menu row).
    'view.assets': () => {
      panelLayout.show();
      d.toggleRightPanel('assets');
    },
    'view.layers-panel': () => d.onToggleLayersMode(),
    'view.trash': () => {
      panelLayout.show();
      d.openPanelExclusive('tree');
      requestTrash();
    },
    // V2-4.10 — ⌘K "Open / Close all Advanced sections" (06 ad-open-all): a one-shot command, not a mode.
    // Each panel then remembers its own fold (fold-store.js); ⌘Z does not undo it, Close all does.
    'view.advanced-open-all': () => {
      foldStore.openAll();
      d.toast?.('All Advanced sections are open.');
    },
    'view.advanced-close-all': () => {
      foldStore.closeAll();
      d.toast?.('All Advanced sections are closed.');
    },
    // S2.2 — Inspector › Advanced: Copy CSS · Copy element id · Edit element id… (the mounted frame binds them)
    ...Object.fromEntries(
      INSPECTOR_ACTION_IDS.map((id) => [
        id,
        () => runInspectorAction(id).then((said) => (said ? d.toast?.(said) : undefined)),
      ])
    ),
    'view.inspector': () => d.toggleRightPanel('inspector'),
    'view.inspector-on-select': () => d.onToggleAutoOpenInspector(),
    'view.timeline-keep-open': () => d.onToggleTimeline(),
    'view.annotations': () => d.onToggleAnnotations(),
    'view.minimap': () => d.onToggleMinimap(),
    'view.zoom-controls': () => d.onToggleZoomCtl(),
    'view.print-guides': () => d.onTogglePrintGuides(),
    'view.hidden-files': () => d.onToggleShowHidden(),
    // S3.1 — every way into Present goes through the one mode owner (use-canvas-mode-lane).
    'present.from-selection': () => presentFrom('selection'),
    'present.from-start': () => presentFrom('start'),
    'present.canvas': () => togglePresentCanvas(),
    // S3.5 — the Order and notes… sheet on the active canvas (the shell mounts it; the server refuses
    // every role below edit on PATCH /_api/present-meta).
    'present.order-notes': () => d.setOrderNotesOpen(true),
    // ── Help ──
    'help.shortcuts': () => d.setShortcutsOpen(true),
    'help.guides': () => d.setHelpOpen(true),
    'help.whats-new': () => d.onWhatsNew(),
    'help.tour': () => d.onUsageTour(),
    'help.setup': () => d.onQuickSetup(),
    'help.intro': () => d.onIntro(),
    'help.sharing': () => d.onCollabTour(),
    'help.report-bug': () => d.setReportBugOpen(true),
    // ── the AI chat (V2-4.9) ── a cloud tab lists it greyed (registry `enabled`), and a click says where it
    // lives instead of doing nothing — the same line "New project…" gives a browser tab.
    'ai.chat': () => {
      if (!d.native) {
        d.toast('AI chat is in the Maude desktop app.');
        return;
      }
      // S5.8 — the panel already open with focus elsewhere: ⌘/ puts focus in its field, it does not fold
      if (aiPanelWantsFocus()) {
        requestFocusAI();
        return;
      }
      d.toggleRightPanel('assistant');
    },
    // ── the AI chat panel's Advanced rows (S5.12) ──
    ...createAdvancedHandlers(d),
    // ── top level ──
    'history.open': () => d.toggleRightPanel('changes'),
    'share.open': () => d.onShare(),
    'settings.open': () => d.setSettingsOpen(true),
    'canvas.reload': () => d.onReload(),
    // ── Diagnostics (V2-4.7b) ──
    ...createDiagnosticsHandlers(d),
    ...createSettingsHandlers(d), // S11.13 — Settings › Advanced: the four settings.* ids
  };
  for (const [id, preset] of Object.entries(ARTBOARD_PRESET))
    h[id] = () => d.onInsertArtboard(preset);
  // S4.4: ⌘K "<Template> template" — the same `insert-template` a Templates-panel tile sends, so the
  // pick trails the pointer until a click (S4.13). Only an open canvas has anywhere to put it.
  for (const t of TEMPLATES)
    h[`annotation.template-${t.id}`] = () => {
      if (d.canvasOpen !== false)
        d.postToActiveCanvas({ dgn: 'insert-template', id: t.id, follow: true });
    };
  // V2-4.8a: outside the desktop app "Back to Home" is the cloud dashboard (the v1 menubar's
  // "← Dashboard" link). In the desktop app it stays the native Home tab (NATIVE_COMMANDS).
  if (!d.native) h['nav.home'] = () => d.onOpenDashboard?.();
  return h;
}

/** Which ids have a runner, given a handlers map (the test's "no dead row"). */
export function runnableIds(handlers, byId = ACTIONS_BY_ID) {
  const out = new Set(Object.keys(handlers));
  for (const [id, def] of byId) {
    if (def.exec === 'canvas') out.add(id);
    else if (def.exec === 'native' && NATIVE_COMMANDS[id]) out.add(id);
  }
  return out;
}

/** The singleton: the pill binds the live handlers (+ canvas post + native invoke); ⌘K and the pill
 *  both run through `run`. Unbound (a surface with no pill), `run` does nothing. */
export const menuRunner = (() => {
  let handlers = null;
  let post = noop;
  let invoke = null;
  return {
    bind(map, { postToActiveCanvas, invokeNative } = {}) {
      handlers = map;
      post = postToActiveCanvas ?? noop;
      invoke = invokeNative ?? null;
    },
    unbind(map) {
      if (handlers === map) handlers = null;
    },
    get bound() {
      return handlers !== null;
    },
    /** V2-4.6: would `run(id)` do something? ⌘K lists only rows that can (no dead row). */
    canRun(id) {
      if (!handlers) return false;
      if (handlers[id]) return true;
      const def = ACTIONS_BY_ID.get(id);
      if (def?.exec === 'canvas') return true;
      return def?.exec === 'native' && !!NATIVE_COMMANDS[id] && invoke !== null;
    },
    /** @returns true when something ran */
    run(id) {
      if (!handlers) return false;
      const fn = handlers[id];
      if (fn) {
        fn();
        return true;
      }
      const def = ACTIONS_BY_ID.get(id);
      if (def?.exec === 'canvas') {
        post(runActionMessage(id));
        return true;
      }
      if (def?.exec === 'native' && NATIVE_COMMANDS[id] && invoke) {
        Promise.resolve(invoke(NATIVE_COMMANDS[id])).catch(noop);
        return true;
      }
      return false;
    },
  };
})();

/** `onCutPaste`: Cut / Copy / Paste on whatever had focus before the menu opened (the menu is
 *  chrome, so its own focus is not the target). Text field → WebKit's own command; the canvas
 *  iframe → the canvas lane (annotation cut / copy / paste). Best effort, like the canvas
 *  context menu's Paste (the clipboard may be blocked). */
export function cutCopyPaste(kind, target, { postToActiveCanvas, doc = document } = {}) {
  const el = target?.isConnected ? target : null;
  if (el?.tagName === 'IFRAME') {
    postToActiveCanvas?.(runActionMessage(`edit.${kind}`));
    return;
  }
  el?.focus?.();
  if (kind === 'paste') {
    const read = globalThis.navigator?.clipboard?.readText?.();
    if (read)
      read.then(
        (t) => {
          if (t) doc.execCommand?.('insertText', false, t);
        },
        () => {}
      );
    return;
  }
  doc.execCommand?.(kind);
}
