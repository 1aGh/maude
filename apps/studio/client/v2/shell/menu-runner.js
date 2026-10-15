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

import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { runActionMessage } from '../../actions/shell-key-handlers.js';
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
 *   onInsertArtboard(preset), onImportFigma(), onImportBrand(), onDuplicate(path),
 *   onRename(path, name), onPickMoveDestination() (opens the folder list), onSwitchAccount(),
 *   onCutPaste(kind)
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
    'canvas.duplicate': () => {
      if (d.activePath) d.onDuplicate(d.activePath);
    },
    'canvas.rename': () => {
      if (!d.activePath) return;
      const current = d.canvasName;
      const name = window.prompt('Rename canvas to:', current);
      if (name?.trim() && name.trim() !== current) d.onRename(d.activePath, name.trim());
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
    'view.inspector': () => d.toggleRightPanel('inspector'),
    'view.inspector-on-select': () => d.onToggleAutoOpenInspector(),
    'view.timeline-keep-open': () => d.onToggleTimeline(),
    'view.annotations': () => d.onToggleAnnotations(),
    'view.minimap': () => d.onToggleMinimap(),
    'view.zoom-controls': () => d.onToggleZoomCtl(),
    'view.print-guides': () => d.onTogglePrintGuides(),
    'view.hidden-files': () => d.onToggleShowHidden(),
    'present.canvas': () => d.onTogglePresent(),
    // ── Help ──
    'help.shortcuts': () => d.setShortcutsOpen(true),
    'help.guides': () => d.setHelpOpen(true),
    'help.whats-new': () => d.onWhatsNew(),
    'help.tour': () => d.onUsageTour(),
    'help.setup': () => d.onQuickSetup(),
    'help.intro': () => d.onIntro(),
    'help.sharing': () => d.onCollabTour(),
    'help.report-bug': () => d.setReportBugOpen(true),
    // ── top level ──
    'history.open': () => d.toggleRightPanel('changes'),
    'share.open': () => d.onShare(),
    'settings.open': () => d.setSettingsOpen(true),
    'canvas.reload': () => d.onReload(),
  };
  for (const [id, preset] of Object.entries(ARTBOARD_PRESET))
    h[id] = () => d.onInsertArtboard(preset);
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
