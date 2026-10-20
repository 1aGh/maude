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
import { startFirstDraft } from '../create/first-draft.js';
import { voteStore } from '../annotations/vote-store.js';
import { createBlankCanvas, openBriefBoardComposer } from '../create/new-canvas.js';
import { createAdvancedHandlers } from '../ai/advanced-handlers.js';
import { aiPanelWantsFocus, requestFocusAI } from '../ai/panel-focus.js';
import { requestViewCode, runErrorOp } from '../code/code-bus.js';
import { createAccessHandlers } from '../access/access-client.js';
import { createDiagnosticsHandlers } from '../diagnostics/diagnostics-handlers.js';
import { runFillAsk } from '../empty/fill-ask.js';
import { runAssetsAction } from '../assets/assets-bus.js';
import { runTakeStepNow } from '../assets/use-takes-lane.js';
import { runCopyPng } from '../export/copy-png.js';
import { foldStore } from '../fold/use-fold.js';
import { INSPECTOR_ACTION_IDS, runInspectorAction } from '../inspector/inspector-actions.js';
import { copyText } from '../left-panel/canvas-file-menu.js';
import { createSettingsHandlers } from '../settings/settings-handlers.js';
import {
  dispatchCanvasOp,
  requestCanvasesOp,
  requestFocusSelector,
  requestTrash,
} from '../left-panel/left-panel-bus.js';
import { toggleViewPref, VIEW_PREF_KEYS } from '../left-panel/view-prefs.js';
import { presenterAvailable, presenterStore } from '../present/presenter-store.js';
import { undoHistoryOpen } from '../undo/undo-history.jsx';
import { requestDsAdvanced } from '../ds/advanced-bus.js';
import { requestDsReview } from '../ds/review-bus.js';
import { setDefaultSystem, requestDsMake } from '../ds/default-write.js';
import { requestDsPreview, requestDsSwitch } from '../ds/switch-bus.js';
import { requestDsConvert, restoreSystemFolder } from '../ds/convert-model.js';
import { runMasterAction } from '../ds/master-write.js';
import { runTokenAction } from '../ds/token-write.js';
import { runUndoKey } from '../undo/use-undo-projection.jsx';
import { runPreviewBack } from '../preview/preview-back.js';
import { requestShareFocus } from '../share/share-model.js';
import { nativeDoors } from './native-doors.js';
import { presentFrom, togglePresentCanvas } from './use-canvas-mode-lane.js';
import { panelLayout } from './use-panel-layout.js';
import { clearFollowedLoop, loopAt } from '../timeline/playhead.js';
import { addTrackAtFollowed } from '../timeline/advanced/actions.js';
import { foldAtFollowed } from '../timeline/fold.js';
import {
  addMarkerAtPlayhead,
  jumpMarkerFromPlayhead,
  removeMarkerAtPlayhead,
} from '../timeline/marker-store.js';
import { allowLongerAtFollowed } from '../timeline/advanced/video-cap.js';
import { setPosterAtPlayhead } from '../timeline/poster.js';
import { timelineStore } from '../timeline/timeline-store.js';
import { addCaptionsFromSpeech, transcriptUi } from '../transcript/captions-api.js';
import { formatsUi } from '../inspector/formats-ui.js';
import { reframeUi } from '../timeline/reframe-island.jsx';

/** Edit ▸ Advanced ▸ New artboard → the preset `onInsertArtboard` takes. */
export const ARTBOARD_PRESET = {
  'artboard.new-desktop': 'desktop',
  'artboard.new-laptop': 'laptop',
  'artboard.new-tablet': 'tablet',
  'artboard.new-mobile': 'mobile',
  'artboard.new-a4': 'print-a4',
  'artboard.new-letter': 'print-letter',
};

/** S7.20 — Edit ▸ Advanced ▸ New artboard › Video: a catalogue preset (kinds/presets.ts) the open canvas places with
 *  `artboard.insert-preset` (it picks the spot and writes the one op), not a v1 `onInsertArtboard` key. */
export const ARTBOARD_PRESET_ID = { 'artboard.new-video': 'video-landscape' };

/** exec 'native' actions → the Tauri command that does them (lib.rs / home.rs). `nav.home` and
 *  `home.open` are one command: the pinned Home tab. */
export const NATIVE_COMMANDS = {
  'nav.home': 'new_home_tab',
  'home.open': 'new_home_tab',
  'project.open': 'open_project_folder',
  // S11.11 — Diagnostics › Logs › Show in Finder; the command is S11.16's (doors.rs), confined to the
  // app's log folder. Until it lands the invoke fails quietly and the sheet hides the button.
  'diag.logs-show-in-finder': 'diagnostics_reveal_logs',
};

/** Fired on `window` for a menu action whose owner is a mounted component with its own state (the
 *  create-project dialog in IdentityBar). Detail: `{ id }`. */
export const MENU_ACTION_EVENT = 'maude:menu-action';

const noop = () => {};

/** S11.9 — run a native path door on the open canvas; its refusal (Rust's words, or "browser") becomes a toast. */
async function runDoor(d, id) {
  if (!d.activePath) return;
  const res = await nativeDoors().run(id, d.activePath);
  if (res?.ok) return;
  d.toast(
    res?.reason === 'browser'
      ? 'Open this project in the Mac app to work with its files.'
      : res?.error || 'Couldn’t do that.'
  );
}

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
 *   onOpenDashboard() (a cloud tab's Back to Home), onCutPaste(kind), onDsGoTo(params) (ds.go-to)
 */
export function createMenuHandlers(d) {
  const h = {
    // ── File ──
    // S6.1: a blank canvas, named by the server (C4), opened at once. The tree composer is the brief board's.
    'canvas.new': () => {
      createBlankCanvas({ toast: d.toast });
    },
    'canvas.new-brief': () => openBriefBoardComposer(d),
    // S6.3: Home's "Ask AI for a new canvas…" — a canvas from one sentence, drafted by AI in a new chat.
    'home.ask': (params) => {
      if (typeof params?.prompt === 'string') startFirstDraft(params.prompt, { toast: d.toast });
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
      // S9.20: Share › Advanced › Invite by GitHub username takes it over while a canvas is open;
      // with none open, IdentityBar's own view still answers (nothing lost).
      if (d.activePath) {
        requestShareFocus('github');
        d.onShare();
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
    // S7.24 — the kind chips over the Canvases list: bring the panel up and put the cursor on them
    'canvases.filter-kind': () => {
      panelLayout.show();
      d.openPanelExclusive('tree');
      requestCanvasesOp({ op: 'filter' });
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
    // S11.9 — the row menu's Advanced group on the OPEN canvas. The two native doors take the project-relative
    // path of the open canvas (the tab's path; Rust refuses anything else); a browser tab has no door and says so.
    'canvas.reveal-in-finder': () => runDoor(d, 'canvas.reveal-in-finder'),
    'canvas.open-in-editor': () => runDoor(d, 'canvas.open-in-editor'),
    'canvas.copy-file-path': async () => {
      if (!d.activePath) return;
      d.toast(
        (await copyText(d.activePath)) ? 'File path copied.' : 'Couldn’t copy the file path.'
      );
    },
    // the same in-place rename as Rename: the canvas's name IS its file name
    'canvas.rename-file': () => {
      if (!d.activePath) return;
      panelLayout.show();
      d.openPanelExclusive('tree');
      requestCanvasesOp({ op: 'rename', path: d.activePath });
    },
    // S11.9 — the two switches of the left panel's Advanced folds (this person's own view)
    'canvases.show-file-names': () => {
      toggleViewPref(VIEW_PREF_KEYS.fileNames);
    },
    'layers.show-tags': () => {
      toggleViewPref(VIEW_PREF_KEYS.tags);
    },
    'layers.select-by-selector': () => {
      panelLayout.show();
      d.openPanelExclusive('layers');
      foldStore.set('left.layers', true);
      requestFocusSelector();
    },
    // S11.7 — the code view opens in the Viewport (read-only; the server refuses Can view the source).
    // The three card actions act on the broken-canvas card that is showing, and on nothing otherwise.
    'canvas.view-code': () => {
      if (d.activePath) requestViewCode({ canvas: d.activePath });
    },
    'canvas.copy-error': () => {
      runErrorOp('copy');
    },
    'canvas.ask-ai-fix': () => {
      runErrorOp('ask-ai');
    },
    'canvas.last-good': () => {
      runErrorOp('last-good');
    },
    'import.figma': () => d.onImportFigma(),
    'import.brand': () => d.onImportBrand(),
    'video.assemble': () => d.onAssembleVideo(),
    'export.open': () => d.setExportDialog({ mode: 'export' }),
    // S8.8 — Copy as PNG (⇧⌘C): the selection rendered by the export, on the clipboard
    'export.copy-png': () => runCopyPng().then((r) => d.toast?.(r.message)),
    'handoff.open': () => d.setExportDialog({ mode: 'handoff' }),
    'canvas.close': () => d.onCloseCanvas(),
    'account.switch': () => d.onSwitchAccount(),
    // ── Edit ── (select / properties ride the canvas lane; artboards the shell's)
    // S2.20 — Undo / Redo run the ⌘Z projection over the op log; a project not on it falls back to
    // the canvas stack (the run-action lane, V2-1.2 feed). Undo history… opens the popover.
    'edit.undo': () =>
      runUndoKey(d.activePath, false, () => d.postToActiveCanvas(runActionMessage('edit.undo'))),
    'edit.redo': () =>
      runUndoKey(d.activePath, true, () => d.postToActiveCanvas(runActionMessage('edit.redo'))),
    'edit.undo-history': () => {
      if (d.activePath) undoHistoryOpen.open();
    },
    'edit.cut': () => d.onCutPaste('cut'),
    'edit.copy': () => d.onCutPaste('copy'),
    'edit.paste': () => d.onCutPaste('paste'),
    // ── View ──
    'view.panels': () => panelLayout.toggleHidden(),
    'view.pin-panels': () => panelLayout.togglePinned(),
    'view.comments': () => d.toggleRightPanel('comments'),
    // S9.22b — the Comments panel on a filter, and a thread (`{ file?, id }`; none = the oldest unread
    // mention's thread, else just the panel). The shell's own useCommentsShell runners.
    'comments.filter-open': () => d.onCommentsFilter('open'),
    'comments.filter-mine': () => d.onCommentsFilter('mine'),
    'comments.filter-resolved': () => d.onCommentsFilter('resolved'),
    'comments.filter-all': () => d.onCommentsFilter('all'),
    // S6.11b — a thread landing (shell://navigate) asks for the reply field focused
    'comments.open-thread': (params) =>
      params?.reply === true
        ? d.onOpenCommentThread(params?.file, params?.id, { reply: true })
        : d.onOpenCommentThread(params?.file, params?.id),
    'view.exports': () => d.onToggleExports(),
    // V2-4.4a — Assets is the left panel's third tab; Layers as a panel is the switch that puts Layers there
    // (or in the Inspector); Trash is the Canvases panel's last row (⌘K, no menu row).
    'view.assets': () => {
      panelLayout.show();
      d.toggleRightPanel('assets');
    },
    // S8.12 — the picked tile's Place / Show details (the key and the tile menu run the same two functions)
    'assets.place': () => runAssetsAction('assets.place'),
    'assets.details': () => runAssetsAction('assets.details'),
    'assets.trash': () => runAssetsAction('assets.trash'),
    // S8.16 — Assets › Generate: the ask lives in the Assets tab, so the tab is shown first
    'assets.generate': () => {
      if (runAssetsAction('assets.generate')) return;
      panelLayout.show();
      d.toggleRightPanel('assets');
    },
    'image.next-take': () => void runTakeStepNow('next'),
    'image.prev-take': () => void runTakeStepNow('prev'),
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
      // 06 ad-open-all: one toast, one action. Close all is the inverse; the folds stay as each panel keeps them.
      d.toast?.('All Advanced sections are open.', true, {
        label: 'Close all',
        onClick: () => {
          foldStore.closeAll();
        },
      });
    },
    // S10.6 — Light | Dark on the Design system canvas: a preview of the active canvas only, nothing written.
    'ds.set-theme-preview': (p) => d.onDsThemePreview?.(p?.mode),
    // S10.8 — "Update N canvases": the review sheet (review-host.jsx, mounted once in the shell) opens on the
    // system the open canvas follows. The Inspector's "Update … for every canvas…" is the same sheet.
    'ds.publish': (p) => requestDsReview({ kind: 'review', ds: p?.ds, canvas: p?.canvas }),
    'ds.review-update': (p) =>
      requestDsReview({
        kind: 'push',
        canvas: p?.canvas,
        elementId: p?.elementId,
        target: p?.target,
        ds: p?.ds,
      }),
    // S10.9 — "Used in 5 canvases · Show": the reach view (reach-view.jsx, hosted by review-host.jsx) draws every
    // place the token (or master) lands, ringed, then opens the same review list beside it. A read.
    'ds.show-reach': (p) =>
      requestDsReview({
        kind: 'reach',
        ds: p?.ds,
        canvas: p?.canvas,
        css: p?.css,
        component: p?.component,
        name: p?.name,
        swatch: p?.swatch,
      }),
    // Cancel puts the swatch back: what waited is dropped, no canvas changes.
    'ds.cancel-pending': (p) => requestDsReview({ kind: 'cancel', ds: p?.ds, canvas: p?.canvas }),
    // S10.7 — a token edited in place: the inspector's panel and these two rows are one writer (token-write.js)
    'ds.set-token': async (p) => d.toast?.((await runTokenAction('ds.set-token', p)).message),
    'ds.set-dark-follows': async (p) =>
      d.toast?.((await runTokenAction('ds.set-dark-follows', p)).message),
    // S10.10 — a component master edited in place: the inspector's panel and this row are one writer (master-write.js)
    'ds.set-master': async (p) => d.toast?.((await runMasterAction(p)).message),
    // S10.8 — Go to the design system / a token / a master (the shell opens the tab and selects it)
    'ds.go-to': (p) => d.onDsGoTo?.(p),
    // S10.13 — the pinned rows: open the Design system canvas, make a system, "Use for new canvases"
    'ds.open': (p) => d.onDsGoTo?.(p),
    'ds.make': (p) => requestDsMake(p, { toast: d.toast }),
    // S10.14 — switch canvases to another system (one review) and look at the project in one first (session-only)
    'ds.switch': (p) => requestDsSwitch({ from: p?.from, to: p?.to, scope: p?.scope }),
    'ds.preview': (p) => requestDsPreview({ from: p?.from }),
    // S10.12 — convert the system folders (the folder view's banner opens the dialog) / Restore one to its folder
    'ds.convert': (p) => requestDsConvert(p, { toast: d.toast }),
    'ds.convert-restore': async (p) => {
      const r = await restoreSystemFolder(String(p?.ds ?? ''));
      d.toast?.(r.message, r.ok);
    },
    // S10.19 — Design system › Advanced: run the check (the host says the outcome and shows the system), reveal the
    // system's folder (the Mac app), hand off the tokens (the handoff sheet; its `tokens` target is S8.10's)
    'ds.check-system': (p) => requestDsAdvanced({ kind: 'check', ds: p?.ds }),
    'ds.reveal-files': (p) => requestDsAdvanced({ kind: 'reveal', ds: p?.ds }),
    'ds.handoff-tokens': (p) => d.setExportDialog({ mode: 'handoff', target: 'tokens', ds: p?.ds }),
    'ds.set-default': async (p) => {
      const r = await setDefaultSystem(String(p?.ds ?? ''), { label: p?.label });
      d.toast?.(r.message, r.ok);
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
    // S7.7 — the timeline island: ⇧⌘T keeps it open / hides it; Expand / Compact are its size (no key).
    'view.timeline-keep-open': () => timelineStore.toggleKeep(),
    'timeline.expand': () => timelineStore.expand(),
    'timeline.compact': () => timelineStore.compact(),
    // S7.18 — the timeline's Advanced: "+ track" (an empty Video 2 / Music 2) and Allow longer (C22)
    'timeline.add-track': (p) => d.toast?.(addTrackAtFollowed(p?.track)),
    // S7.16 — fold a track to "Text · 18" (a view, per viewer)
    'timeline.fold-track': (p) => d.toast?.(foldAtFollowed(p)),
    // S7.16 — ruler markers: part of the cut (the video's meta); jump moves the playhead
    'timeline.marker.add': async (p) => d.toast?.(await addMarkerAtPlayhead(p?.name)),
    'timeline.marker.remove': async () => d.toast?.(await removeMarkerAtPlayhead()),
    'timeline.marker.jump': (p) => d.toast?.(jumpMarkerFromPlayhead(p?.dir)),
    'video.allow-longer': async () => d.toast?.(await allowLongerAtFollowed()),
    // S7.8 — the playhead's frame becomes the followed video's poster (client/v2/timeline/poster.js)
    // S7.8 — the loop range, from ⌘K (the keys are I / O with the timeline focused)
    'timeline.loop-in': () => loopAt('in'),
    'timeline.loop-out': () => loopAt('out'),
    'timeline.loop-clear': () => clearFollowedLoop(),
    'video.poster.set': async () => d.toast?.(await setPosterAtPlayhead()),
    // S7.11 — Captions from speech (the island's tool) and the Transcript panel (left slot, Q17)
    'video.captions.add': () => void addCaptionsFromSpeech(),
    'video.transcript.open': () => transcriptUi.toggle(),
    // S7.13 — the Re-frame island (on the selected clip) and the Video inspector's Formats rows (07 ve-reframe, ve-formats)
    'video.reframe': () => reframeUi.open(),
    'video.format.add': () => {
      const said = formatsUi.requestAdd();
      if (said) d.toast?.(said);
    },
    'video.format.unlink': () => {
      const said = formatsUi.unlink();
      if (said) d.toast?.(said);
    },
    'view.annotations': () => d.onToggleAnnotations(),
    'view.minimap': () => d.onToggleMinimap(),
    'view.zoom-controls': () => d.onToggleZoomCtl(),
    'view.print-guides': () => d.onTogglePrintGuides(),
    'view.hidden-files': () => d.onToggleShowHidden(),
    // S3.1 — every way into Present goes through the one mode owner (use-canvas-mode-lane).
    'present.from-selection': () => presentFrom('selection'),
    'present.from-start': () => presentFrom('start'),
    'present.canvas': () => togglePresentCanvas(),
    // S3.10a — back out of a followed link: the PreviewBar's "‹ Homepage" and ⌘K run the same function.
    'preview.back': () => runPreviewBack(),
    // S3.5 — the Order and notes… sheet on the active canvas (the shell mounts it; the server refuses
    // every role below edit on PATCH /_api/present-meta).
    'present.order-notes': () => d.setOrderNotesOpen(true),
    // S3.6b — a person's click (the Present ⌄ row, ⌘K). With one display there is nothing to show it on: the
    // row is hidden there, and a palette run says why instead of switching on a preference that does nothing.
    'present.presenter-view': () => {
      if (!presenterAvailable(presenterStore.get())) {
        d.toast?.('Presenter view needs a second display.');
        return;
      }
      presenterStore.toggle();
    },
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
    // S11.2 — the empty-artboard hint's Ask AI, from ⌘K: the chat opens with "Fill <board> starting from …" in
    // its field (never sent). The empty host knows which board; unbound it does nothing.
    'ai.ask-fill-artboard': () => {
      if (!d.native) {
        d.toast('AI chat is in the Maude desktop app.');
        return;
      }
      runFillAsk();
    },
    // ── the AI chat panel's Advanced rows (S5.12) ──
    ...createAdvancedHandlers(d),
    // ── top level ──
    'history.open': () => d.toggleRightPanel('changes'),
    'share.open': () => d.onShare(),
    // S9.19 — the owner's rows live in the Share sheet: each opens it on Invite
    'share.invite': () => d.onShare(),
    'share.set-role': () => d.onShare(),
    'share.remove': () => d.onShare(),
    'share.resend': () => d.onShare(),
    // S9.20 — Share › Advanced › This link; a local project's Share is where Move to cloud lives
    'share.link-settings': () => {
      requestShareFocus('link');
      d.onShare();
    },
    'share.move-to-cloud': () => d.onShare(),
    // S9.21 — Ask to edit (the Viewing button, ⌘K) and the owner's answer (the request block's buttons)
    ...createAccessHandlers(d),
    'settings.open': () => d.setSettingsOpen(true),
    'canvas.reload': () => d.onReload(),
    // ── Diagnostics (V2-4.7b) ──
    ...createDiagnosticsHandlers(d),
    ...createSettingsHandlers(d), // S11.13 — Settings › Advanced: the four settings.* ids
  };
  for (const [id, preset] of Object.entries(ARTBOARD_PRESET))
    h[id] = () => d.onInsertArtboard(preset);
  for (const [id, presetId] of Object.entries(ARTBOARD_PRESET_ID))
    h[id] = () => {
      if (d.canvasOpen !== false)
        d.postToActiveCanvas(runActionMessage('artboard.insert-preset', { presetId }));
    };
  // S4.4: ⌘K "<Template> template" — the same `insert-template` a Templates-panel tile sends, so the
  // pick trails the pointer until a click (S4.13). Only an open canvas has anywhere to put it.
  for (const t of TEMPLATES)
    h[`annotation.template-${t.id}`] = () => {
      if (d.canvasOpen !== false)
        d.postToActiveCanvas({ dgn: 'insert-template', id: t.id, follow: true });
    };
  // S4.14 — End vote: the shell's vote store (its own canvas, its own vote) asks /_api/votes/end.
  h['annotations.end-vote'] = () => void voteStore.end();
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
    /** @returns true when something ran. `params` reach a shell handler that takes them
     *  (`comments.open-thread` `{ file?, id, reply? }`); every other handler ignores them. */
    run(id, params) {
      if (!handlers) return false;
      const fn = handlers[id];
      if (fn) {
        fn(params);
        return true;
      }
      const def = ACTIONS_BY_ID.get(id);
      if (def?.exec === 'canvas') {
        // sec-a C1(e) — the canvas answers "Start a vote…" with `vote-board {open}`; the shell opens
        // the sheet only because it asked here (a person's ⌘K / menu pick), never on the canvas's own say.
        if (id === 'annotations.start-vote') voteStore.expectSheet();
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
