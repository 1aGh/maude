// Design plugin local browser — React UI.
// Bundled via Bun.build (DDR-009/012) — IIFE, tree-shaken, React 19 from npm.
// Renders: file tree, tabs, viewport (iframes), status bar, design-system view, comments.
// Universal — no project tokens needed; styling lives in client/styles/.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

// Trusted tool→cursor resolver (shares the single TOOL_CURSORS source with the
// canvas runtime). canvas-cursors.ts is dependency-free (a type-only Tool
// import that Bun erases), so this pulls only string constants into the client
// bundle — no React, no input-router. See the tool-cursor handler below.
import { resolveToolCursor } from '../canvas-cursors.ts';
import { commandForEnter, matchCommands } from './command-palette-match.js';
import {
  defaultScopeForFormat,
  isScopeValidForFormat,
  validScopesForFormat,
} from '../exporters/format-scopes.ts';
// feature-3-web-artboards T5 — the single source (grid-track-handles.ts) for
// the Inspector's Grid-section track parser/serializer, shared with the
// on-canvas gutter-drag overlay so both edit the SAME track-list shape.
import { GRID_KEYWORD_UNITS, parseTrackList, serializeTrackList } from '../grid-track-handles.ts';
// feature-2-print-artboards T2 — the single source (print/units.ts) for the
// Inspector's paper-preset picker, same "pull only pure math/data" shape as
// canvas-cursors.ts above.
import { PAPER_PRESETS, resolvePrintArtboard } from '../print/units.ts';
import { resolveHeightCommit } from '../artboard-hug-commit.ts';
import { sizingModeOf, sizingModePatch } from '../sizing-mode.ts';
// The single "what is the hub link doing" rule, shared with the cloud rail's
// connect note so the two surfaces can never disagree. Pure data + strings —
// same "pull only pure logic into the client bundle" shape as the imports
// above (a type-only SyncStatusSnapshot import that Bun erases).
import { syncPresentation } from '../sync/presentation.ts';
import {
  canvasTokenRefreshDelay,
  canvasUrl,
  setLiveCanvasToken,
  withCanvasToken,
} from './canvas-url.js';
import { applyEditRequest } from './apply-edit-request.ts';
import { createIndexLoader } from './index-loader.ts';
import {
  BROWSER_CAPTURE_FORMATS,
  BROWSER_SERVABLE_FORMATS,
  browserCaptureEligible,
  captureDeckViaBrowser,
  captureScale,
  sanitizeCapturedItems,
  recordBrowserExport,
} from './export-lane.js';
import { TreeRowMenu, useRowMenu } from './tree-row-menu.jsx';
import { FileTree, FileTreeItem } from './file-tree.jsx';
import { useTreeDrag } from './use-tree-drag.js';
import ChatPanel from './panels/ChatPanel.jsx';
import DiffView from './panels/DiffView.jsx';
import GitPanel from './panels/GitPanel.jsx';
import SyncConsentDialog from './panels/SyncConsentDialog.jsx';
import SyncPanel from './panels/SyncPanel.jsx';
import CloudBar from './panels/CloudBar.jsx';
import { buildShareLinks, normalizeOpenPath, readOpenParam, withOpenParam } from './share-link.js';
import { isEmbedLocation } from './embed.js';
import EmbedView from './embed-view.jsx';
import { ShareDialog, copyShareLink } from './share-dialog.jsx';
import IdentityBar from './panels/IdentityBar.jsx';
import OnboardingWizard from './panels/OnboardingWizard.jsx';
import { ReadinessDialog } from './panels/ReadinessList.jsx';
import IntroVideoDialog from './panels/IntroVideoDialog.jsx';
import BrandUploadPanel from './panels/BrandUploadPanel.jsx';
import FigmaImportPanel from './panels/FigmaImportPanel.jsx';
import { FilePreview, prefetchPreviewImage, sanitizeDisplayText } from './panels/file-preview.jsx';
import SetupChecklistDialog, { useSetupReadiness } from './panels/SetupChecklist.jsx';
import TimelinePanel from './panels/TimelinePanel.jsx';
import { parseCompTimeline } from './panels/timeline-parse.js';
import {
  activeComp,
  resolveCompTarget,
  sanitizeArtboardText,
} from './panels/timeline-comp-target.js';
import { durationFramesForDrop, probeMediaDuration } from './panels/timeline-media-cache.js';
import GenerateDialog from './generate-dialog.jsx';
import RepoBranchSwitcher from './panels/RepoBranchSwitcher.jsx';
import SettingsPanel from './panels/SettingsPanel.jsx';
import StickerPicker from './panels/StickerPicker.jsx';
import { AlignPad, AngleDial, ColorField, IconButtonGroup, IconToggleGroup, makeScrubHandler, NumberField, RadiusControl, Segmented, Select, SliderField, Toggle, UnitSelect, ValueTokenField } from './inspector-controls.jsx';
import {
  ALargeSmall as LuALargeSmall,
  AlignCenter as LuAlignCenter,
  AlignHorizontalJustifyCenter as LuJustifyCenter,
  AlignHorizontalJustifyEnd as LuJustifyEnd,
  AlignHorizontalJustifyStart as LuJustifyStart,
  AlignHorizontalSpaceBetween as LuSpaceBetween,
  AlignJustify as LuAlignJustify,
  AlignLeft as LuAlignLeft,
  AlignRight as LuAlignRight,
  AlignVerticalJustifyCenter as LuVJustifyCenter,
  AlignVerticalJustifyEnd as LuVJustifyEnd,
  AlignVerticalJustifyStart as LuVJustifyStart,
  Baseline as LuBaseline,
  Bold as LuBold,
  Columns3 as LuColumns3,
  Eye as LuEye,
  Italic as LuItalic,
  Minus as LuMinus,
  MoveHorizontal as LuMoveH,
  RotateCw as LuRotateCw,
  Rows3 as LuRows3,
  Scissors as LuScissors,
  ScrollText as LuScrollText,
  Spline as LuSpline,
  StretchHorizontal as LuStretch,
  Underline as LuUnderline,
  Braces as LuBraces,
  Wand2 as LuWand2,
} from 'lucide-react';
import { PhotoKnobs } from './photo-knobs.jsx';
import {
  appIsFirstRun,
  invoke,
  isNativeApp,
  onMenuReportBug,
  onUpdateReady,
  pickedMediaSource,
  pickMediaFile,
  pickMediaFiles,
  readPickedMediaBlob,
  restartToUpdate,
} from './github.js';
import { COLLAB_TOUR } from './tour/collab-tour.js';
import { TourOverlay } from './tour/overlay.jsx';
import { QUICK_SETUP_TOUR } from './tour/quick-setup-tour.js';
import { USAGE_TOUR } from './tour/usage-tour.js';
import { dismissNotice, NotificationHost, notify, notifyCanvasText } from '../notifications.tsx';
import { uploadAsset } from '../asset-upload.ts';
import { acceptCanvasNotice } from '../canvas-notice-message.ts';
import { ExportBadge, ExportPanel, ExportToast, useExportCenter } from './export-center.jsx';
import { ReportBugDialog } from './report-bug.jsx';
import { useWhatsNew, WhatsNewPanel, WhatsNewToast } from './whats-new.jsx';
import {
  collectDirPaths,
  isDirOpen,
  pruneDirs,
  remapDirPrefix,
  revealPath,
  setDirOpen,
  toggleSection as toggleSectionState,
  useTreeExpansion,
} from './tree-expansion.js';
import { ANNOT_STORE, ATTENTION_NOTIFY_COOLDOWN_MS, CANVAS_EXT_RE, COLLAB_TOUR_STORE, CP_MODE_STORE, EMPTY_GROUPS, LAYERS_MODE_STORE, MDCC_VERSION, MINIMAP_STORE, MODE_HINT_SEEN, PANEL_SIDES_STORE, SHOW_HIDDEN_STORE, SIDEBAR_STORE, SYSTEM_TAB, THEME_STORE, USAGE_TOUR_STORE, ZOOMCTL_STORE, isModuleCanvasPath } from './shell/constants.js';
import { basename, browseFirstRunHint, buildTree, displayName, filterTree, groupBySidecar, layersTreeSig, notifyDesktop, openCount, pathTestIdSlug, persistUiPrefs, previewKind, readBoolStore, readInitialTheme, readJsonStore, sectionDefaultOpen, shellToast, timeAgo, totalCounts } from './shell/util.js';
import { Icon, Kbd, Lu, StAvatar, StIcon, initialsOf } from './shell/icons.jsx';
import { DOCK_PANELS, DockSlot, PANEL_SIDES_DEFAULTS, PanelGrip, usePanelSize } from './shell/dock.jsx';
import { CommandPalette } from './dialogs/command-palette.jsx';
import { AssetPicker } from './dialogs/asset-picker.jsx';
import { ExportDialog, downloadCapturedBlob } from './dialogs/export-dialog.jsx';
import { Sidebar } from './tree/tree.jsx';
import { CollapsedRail } from './shell/collapsed-rail.jsx';
import { HelpModal } from './dialogs/help-modal.jsx';
import { ShortcutsOverlay } from './dialogs/shortcuts-overlay.jsx';
import { Menubar } from './menus/menubar.jsx';
import { SystemView } from './system/system-view.jsx';
import { Viewport } from './shell/viewport.jsx';
import { StatusBar } from './shell/status-bar.jsx';
import { CommentsPanel } from './shell/comments-panel.jsx';
import { CloudRoleBanner, SyncBanner, UpdateBanner } from './shell/banners.jsx';
import { CSS_ALIGN_SELF, CSS_ASPECT_RATIO, CSS_BLEND_MODES, CSS_BORDER_STYLES, CSS_DISPLAYS, CSS_FONTS, CSS_FONT_STYLE, CSS_OBJECT_FIT, CSS_POSITION, CSS_TEXT_TRANSFORM, CSS_UNITLESS, CSS_UNITS, CSS_WEIGHTS, CSS_WHITE_SPACE, GRID_TRACK_UNITS, PROP_LEAD, SCREEN_PRESETS, replacedValue } from './inspector/css-vocab.jsx';
import { clamp01, cssColorToHex, cssHint, cssSplitUnit, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './inspector/color.js';
import { mergeSelClientFields } from './inspector/selection.js';
import { activeDsNameFor, useAllDsTokens } from './inspector/ds-tokens.js';
import { ColorPicker } from './inspector/color-picker.jsx';
import { TokenPopover } from './inspector/token-popover.jsx';
import { GridTracksEditor } from './inspector/grid-tracks-editor.jsx';
import { CssKnobs, afterRecordableWrites, trackRecordableWrite } from './inspector/css-knobs.jsx';
import { LAYER_VOID_TAGS, LayerRow, moveLayerNode } from './inspector/layers.jsx';
import { InspectComputed } from './inspector/inspect-computed.jsx';
import { ArtboardKnobs, resolveArtboardIdFromSelection } from './inspector/artboard-knobs.jsx';
import { InspectorPanel, PHOTO_ASSET_RE } from './inspector/inspector-panel.jsx';
import { usePaletteAndPanels } from './hooks/use-palette-and-panels.jsx';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts.jsx';
import { useCanvasBridge } from './hooks/use-canvas-bridge.jsx';
import { useTabs } from './hooks/use-tabs.jsx';
import { useGitActions } from './hooks/use-git-actions.jsx';
import { useWebSocket } from './hooks/use-web-socket.jsx';
import { useProjectData } from './hooks/use-project-data.jsx';
import { usePhotoAndTimeline } from './hooks/use-photo-and-timeline.jsx';

// ---------- App ----------

function App() {
  const [groups, setGroups] = useState([]);
  const [treeLoaded, setTreeLoaded] = useState(false);
  // Failed /_index-data attempts since the last success — the tree's loading
  // state says "still trying" instead of sitting blank (the loader retries).
  const [treeLoadFailures, setTreeLoadFailures] = useState(0);
  const addressMode = useRef('push');
  const previousAddressPath = useRef(null);
  const [project, setProject] = useState('Design');
  const [tabs, setTabs] = useState([]);
  const [activePath, setActivePath] = useState(null);
  // feature-studio-file-preview — deliberately separate from `tabs`/
  // `activePath`: a previewed file was never a canvas, so it must never
  // trigger the WS `active`/`tabs` broadcasts, the compile-skeleton loading
  // state, or iframe registration that openTab()/openSystem() drive.
  const [previewPath, setPreviewPath] = useState(null);
  const onPreview = useCallback((path) => {
    addressMode.current = 'push';
    setPreviewPath(path);
  }, []);
  const [selected, setSelected] = useState(null);
  // Phase 12.3 — latest selection, readable from the (stale-closure) onMessage
  // handler so an HMR reload (triggered by a CSS/attr edit) can re-select the
  // same element and restore the in-canvas halo the remount dropped.
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Stage H (INV-3) — resolve the edit-scope (local vs shared component instance)
  // for the current single selection so the Inspector can show whether an edit
  // stays here or changes N places. Read-only GET, debounced by the selection id;
  // aborts a stale in-flight fetch when the selection changes. Fetched with
  // rendered=1 (source-usage-driven; the .map() refinement is a follow-up).
  const [editScope, setEditScope] = useState(null);
  useEffect(() => {
    const one = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
    const id = one && typeof one.id === 'string' ? one.id : null;
    if (!id || !activePath) {
      setEditScope(null);
      return;
    }
    const ac = new AbortController();
    const q = new URLSearchParams({ canvas: activePath, id });
    fetch(`/_api/edit-scope?${q}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) setEditScope(j);
      })
      .catch(() => {
        /* aborted / offline — leave the last verdict, the badge just won't show */
      });
    return () => ac.abort();
  }, [selected, activePath]);
  // feature-acp-context-hardening — halo re-apply retry ladder. A single
  // select-by-id post races the fresh iframe: dgn:'loaded' fires from the
  // inline inspector script at HTML-parse time, BEFORE the React canvas-shell
  // mounts its message listener (module fetch + mount takes 100ms–seconds), so
  // a one-shot post silently evaporates and the restored selection never gets
  // its halo back. Re-post on a fixed ladder; each attempt aborts when the
  // user meanwhile selected something else. select-by-id is idempotent
  // (replace-same → select-set echo → ws guard sees same id → no re-schedule),
  // so the ladder can't loop.
  // feature-4 dogfood fix — timestamp of the last LOCAL selection change sent
  // over WS. The ws 'selected' broadcast is both (a) our own echo and (b) a
  // genuine cross-canvas restore; within this window it's always (a) and must
  // not overwrite fresher local state (multi-select / drill races).
  const lastLocalSelectAtRef = useRef(0);
  const haloRestoreTimersRef = useRef([]);
  const scheduleHaloRestore = useCallback((one) => {
    if (!one?.id || !one.file) return;
    for (const t of haloRestoreTimersRef.current) clearTimeout(t);
    haloRestoreTimersRef.current = [50, 450, 1200, 2500, 5000].map((delay) =>
      setTimeout(() => {
        const cur = selectedRef.current;
        const c1 = Array.isArray(cur) ? cur[0] : cur;
        if (!c1 || c1.id !== one.id || c1.file !== one.file) return; // superseded
        const frame = iframesRef.current.get(one.file);
        if (!frame?.contentWindow) return;
        try {
          frame.contentWindow.postMessage(
            {
              dgn: 'select-by-id',
              id: one.id,
              artboardId: one.artboardId ?? null,
              index: one.index ?? 0,
            },
            '*'
          );
        } catch {}
      }, delay)
    );
  }, []);
  // Dogfood follow-up — the ArtboardKnobs panel (Kind/Print/Style/Hug/W-H)
  // writes via structuralWrite, which never refreshed the Inspector's OWN
  // `attrs` snapshot afterward: the artboard itself re-rendered correctly
  // (new kind, new size) but the Inspector kept showing the PRE-edit values
  // (e.g. "Digital" right after picking "Print") until the user manually
  // re-clicked the artboard. Mirrors scheduleHaloRestore's retry ladder
  // (the HMR reload lands async, so a single immediate post races it) but
  // for a bare ARTBOARD selection (no data-cd-id to key off of — compares
  // by artboardId instead of id).
  const artboardResyncTimersRef = useRef([]);
  const scheduleArtboardResync = useCallback((artboardId, file) => {
    if (!artboardId || !file) return;
    for (const t of artboardResyncTimersRef.current) clearTimeout(t);
    artboardResyncTimersRef.current = [50, 450, 1200, 2500, 5000].map((delay) =>
      setTimeout(() => {
        const cur = selectedRef.current;
        const c1 = Array.isArray(cur) ? cur[0] : cur;
        if (!c1 || c1.artboardId !== artboardId || c1.file !== file) return; // superseded
        const frame = iframesRef.current.get(file);
        if (!frame?.contentWindow) return;
        try {
          frame.contentWindow.postMessage({ dgn: 'select-by-id', artboardId }, '*');
        } catch {}
      }, delay)
    );
  }, []);
  // Phase 12.1 (DDR-138) — after a reorder writes source, the HMR reload remounts
  // the canvas and the positional data-cd-id of the moved element (and everything
  // after it) renumbers. Stash the re-settle target { file, movedId, artboardId }
  // so the dgn:'loaded' handler re-selects the moved element by its NEW id.
  const pendingReorderRef = useRef(null);
  // The last layers tree the canvas posted, and its id signature. A duplicate
  // or insert renumbers every later positional id, so the copy's NEW id already
  // names another element (the next sibling) in the pre-write tree: settling
  // on the first tree that merely contains it selected the wrong node. The
  // pending entry records the signature at request time and waits for a tree
  // that differs from it.
  const lastLayersTreeRef = useRef(null);
  const settlePendingSelectionRef = useRef(null);
  settlePendingSelectionRef.current = (tree, sig, artboardId) => {
    const pend = pendingReorderRef.current;
    if (!pend || !pend.movedId) return;
    if (pend.staleSig != null && sig === pend.staleSig) return; // still the pre-write DOM
    const has = (function find(nodes) {
      return (nodes || []).some((n) => n.id === pend.movedId || find(n.children));
    })(tree);
    if (!has) return;
    pendingReorderRef.current = null;
    const win = activePath ? iframesRef.current.get(activePath)?.contentWindow : null;
    if (win) {
      try {
        win.postMessage({ dgn: 'select-by-id', id: pend.movedId, artboardId, index: 0 }, '*');
      } catch {}
    }
  };
  // Latest `reorderLayer` (defined far below), read from the stale-closure
  // onMessage handler when the in-canvas grip posts dgn:'reorder-request'
  // (same freshness idiom as selectedRef; avoids a render-time TDZ on the
  // later useCallback).
  const reorderLayerRef = useRef(null);
  // Same freshness idiom for `repositionElement` (defined far below), read
  // when the in-canvas drag posts dgn:'reposition-request' — the coordinate-
  // mode commit for out-of-flow (position:absolute/fixed) elements.
  const repositionElementRef = useRef(null);
  // feature-element-editing-robustness Stage D — sibling ref for `resizeElement`
  // (defined far below), read when the in-canvas resize overlay posts
  // dgn:'resize-request' on pointer-up. Same origin-split as reposition.
  const resizeElementRef = useRef(null);
  // Phase 12.1 — true between a layers-panel reorder and the fresh layers-tree
  // landing. A reorder churns positional data-cd-ids, so a rapid 2nd drag would
  // target stale ids; the Layers tree gates new drags on this until the rebuilt
  // tree (with correct ids) arrives. Cleared by the layers-tree message.
  const layersBusyRef = useRef(false);
  const layersBusyTimerRef = useRef(null);
  // Phase 12 Task 4 — Layers tree for the active artboard (posted by canvas-shell).
  const [layersTree, setLayersTree] = useState(null);
  // feature-4 T7a — Layers-panel component map ({ [cdId]: { component, root,
  // usages } }) for purple instance rows. Fetched from the read-only main-origin
  // /_api/component-map on canvas/tree changes, throttled: the map only changes
  // when SOURCE changes, but the tree re-posts on any DOM churn (drag reflows) —
  // don't re-parse the canvas for those.
  const [componentMap, setComponentMap] = useState(null);
  const componentMapAtRef = useRef({ canvas: null, at: 0 });
  useEffect(() => {
    if (!activePath || !layersTree) return;
    const now = Date.now();
    const last = componentMapAtRef.current;
    if (last.canvas === activePath && now - last.at < 1500) return;
    componentMapAtRef.current = { canvas: activePath, at: now };
    fetch(`/_api/component-map?canvas=${encodeURIComponent(activePath)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && j.map && typeof j.map === 'object') setComponentMap(j.map);
        else setComponentMap(null);
      })
      .catch(() => setComponentMap(null));
  }, [activePath, layersTree]);
  const [wsConnected, setWsConnected] = useState(false);
  // Phase 8 Task 7 — git lifecycle reload prompt. Server has already flushed
  // every dirty Y.Doc to disk by the time this state populates, so accepting
  // the reload is data-loss-safe (DDR-051 §3).
  const [gitLifecycle, setGitLifecycle] = useState(null);
  // Phase 9 Task 8 — hub-down offline mode banner. Driven by the 'sync:status'
  // WS message the linked-mode sync runtime emits. null in solo mode.
  const [syncStatus, setSyncStatus] = useState(null);
  // feature-large-project-seed — the NATIVE half of seed progress.
  //
  // A seed against a large project is minutes to hours of work, and the target
  // user (DDR-177) never opens a terminal. The Sync panel is the detail view;
  // this is what reaches them when the panel is not on screen: the window
  // title while it runs, and ONE notification per phase transition.
  //
  // Per TRANSITION, never per file. A 2 961-file seed must produce two
  // notifications, not 2 961 — `send_notification` throttles on the Rust side
  // too, but a client that leans on that is a client that would spam a plain
  // browser tab through the Web fallback.
  const seedPhaseRef = useRef(null);
  useEffect(() => {
    const p = syncStatus?.files?.progress;
    if (!p) return;
    const prev = seedPhaseRef.current;
    seedPhaseRef.current = p.phase;
    if (prev === null || prev === p.phase) return;
    if (p.phase === 'converged' && (prev === 'seeding' || prev === 'paused')) {
      notifyDesktop('Project synced', `${p.delivered} files are up to date.`);
    } else if (p.phase === 'blocked') {
      const total = (p.blocked ?? []).reduce((n, b) => n + b.count, 0);
      notifyDesktop(
        'Sync needs a decision',
        `${total} file${total === 1 ? '' : 's'} could not be sent. Open the Sync panel for the reason.`
      );
    }
  }, [syncStatus?.files?.progress]);
  // The title carries the count while a seed runs, and is restored afterwards —
  // it is the one surface visible without opening anything.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const p = syncStatus?.files?.progress;
    const base = document.title.replace(/\s+—\s+syncing\s+\d+\/\d+$/, '');
    if (p && (p.phase === 'seeding' || p.phase === 'paused') && p.tracked > 0) {
      document.title = `${base} — syncing ${p.delivered}/${p.tracked}`;
    } else {
      document.title = base;
    }
    return undefined;
  }, [syncStatus?.files?.progress]);
  // DDR-218 — the folder's cloud link ({url, credentialed} | null), lifted from
  // CloudBar (status resolve / attach / detach). Gates the GitPanel's
  // cloud-managed posture; linked-but-uncredentialed keeps the full panel.
  const [cloudLinkedHub, setCloudLinkedHub] = useState(null);
  const [localProjectName, setLocalProjectName] = useState(null);
  // Phase 27 (E2) — in-UI git layer. `gitStatus` is the live dirty-state the
  // server broadcasts on `git-status`; `changesOpen` toggles the Changes panel;
  // `diffTarget` opens the before/after DiffView ({ file, conflict }).
  const [gitStatus, setGitStatus] = useState(null);
  // Phase 28 (E3) — remote ahead/behind ("Get latest" nudge). Kept in its OWN
  // slice, NOT folded into `gitStatus`, because the `git-status` WS broadcast
  // (line ~5791) replaces `gitStatus` on every dirty-state change and carries
  // only LOCAL status — merging remote-ahead into it would be clobbered on the
  // next keystroke. The probe is a real network `git fetch` (server-side, token
  // from the keychain bridge), so it runs on a slow cadence — mount, a periodic
  // tick, and after each git action — never on the per-edit WS path.
  const [remoteSync, setRemoteSync] = useState(null); // { remoteAhead, behind } | null
  const [changesOpen, setChangesOpen] = useState(false);
  // feature-sync-progress-modal — the per-file Sync panel; toggled from the
  // status-bar HUB SYNC chip. Only available while `syncStatus` is non-null
  // (a linked project), mirroring how `changes` gates on `gitStatus.repo`.
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [diffTarget, setDiffTarget] = useState(null);
  const [search, setSearch] = useState('');
  const [systemData, setSystemData] = useState(null);
  // Canvas-compile skeleton (single-canvas model → one path at a time).
  const [loadingPath, setLoadingPath] = useState(null);
  const loadFallbackTimer = useRef(null);
  // issue #115 — a canvas that never reported `loaded`. `{ path, kind }`, where
  // kind is 'server' (the canvas origin did not answer /_health — a dead or
  // respawned sidecar) or 'compile' (the origin is up, the canvas itself never
  // mounted). Rendered instead of the blank pane the cap used to leave behind.
  const [canvasError, setCanvasError] = useState(null);
  // Bumped by the error panel's Retry. Folded into the iframe `key` so a retry
  // REMOUNTS the frame — re-setting `src` to the identical URL would not
  // re-navigate, and after a respawn the URL is identical in every case except
  // the port that `loadServerConfig()` is about to correct.
  const [canvasReloadNonce, setCanvasReloadNonce] = useState(0);
  // The canvas whose SHELL DOCUMENT has actually loaded, per its `dgn:'loaded'`
  // post. Distinct from `!loadingPath`, which the 2.5 s onLoad fallback and the
  // 15 s cap also clear — this one only ever means "the shell ran". That makes
  // it the honest signal for `data-canvas-state` below, and the one the #115 E2E
  // scenario asserts: the shell's inline script posts it whether or not the
  // canvas TSX went on to build, so it isolates "the origin was reachable" from
  // "the canvas compiled" — exactly the axis #115 is about.
  const [loadedPath, setLoadedPath] = useState(null);
  // Resizable side panels (DS components-resize-panels) + the active drag side.
  const sbSize = usePanelSize('maude-sb-w', { min: 200, max: 420, def: 252 });
  const rpSize = usePanelSize('maude-rp-w', { min: 260, max: 480, def: 304 });
  const [dragSide, setDragSide] = useState(null); // 'sb' | 'rp' | null
  const bodyRef = useRef(null);

  // Pointer drag for the panel grips — window listeners while dragging (the
  // grip also pointer-captures, and `.st-body.is-resizing iframe` drops pointer
  // events so the canvas iframe can't swallow the move stream mid-drag).
  useEffect(() => {
    if (!dragSide) return;
    const onMove = (e) => {
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (dragSide === 'sb') sbSize.setW(e.clientX - rect.left);
      else rpSize.setW(rect.right - e.clientX);
    };
    const onUp = () => setDragSide(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragSide, sbSize.setW, rpSize.setW]);

  // Loading-skeleton lifecycle: dgn:'loaded' clears it instantly (TSX canvases);
  // the iframe load event arms a short fallback for legacy .html canvases that
  // never post it; a hard cap guards against a canvas that dies mid-compile.
  const onIframeLoad = useCallback((path) => {
    // A module canvas reports its own render; the iframe `load` event fires
    // long before it has drawn anything, so a timer here would only bring
    // back the white pane.
    if (isModuleCanvasPath(path)) return;
    clearTimeout(loadFallbackTimer.current);
    loadFallbackTimer.current = setTimeout(() => {
      setLoadingPath((p) => (p === path ? null : p));
    }, 2500);
  }, []);
  // Loaded at boot from /_config and re-fetched on the server's
  // `config-updated` push (config.json hot-reload — /design:setup-ds rewrites
  // it mid-session) — informs canvasUrl() so TSX iframes can pass the right
  // ?designRel + ?tokens query to the canvas mount shell.
  // `cloud` is deliberately TRI-STATE, and the third state is the useful one:
  //   undefined — `/_config` has not answered yet; which shell this is is
  //               UNKNOWN, and anything that would behave differently in the
  //               two shells must wait rather than assume the desktop.
  //   null      — desktop or plain local browser.
  //   object    — a cloud tab (`{ dashboardUrl?, projectName, user, role }`).
  //
  // Collapsing unknown into "not cloud" is what made the cloud studio open with
  // two console 404s every time: the sign-in bar and the export centre mounted
  // for one frame, each fired the request its shell exists to refuse, and then
  // unmounted. Nothing was broken and everything looked broken.
  const [cfg, setCfg] = useState({ designRel: '.design', cloud: undefined });
  // THE CAP MUST NOT CLEAR TO WHITE — issue #115. This used to be a bare
  // `setLoadingPath(null)`, which is the most useless thing it could do: when
  // the canvas origin is unreachable the shell HTML never loads, so the shell's
  // own `#canvas-mount-error` surface (templates/_shell.html) does not exist to
  // report anything, and dropping the skeleton left a blank pane with no error,
  // no reason and no way back inside the app. Probe the canvas origin to tell
  // the two failures apart — a dead server (the #115 stale-origin case, and any
  // sidecar crash) versus a canvas that genuinely never finished compiling —
  // and hand the user the recovery in both cases.
  //
  // DECLARED AFTER `cfg`, ON PURPOSE — the same rule the block below states for
  // the git flags, and this effect is what taught us it is not decorative. Its
  // dependency array reads `cfg?.canvasOrigin`, and A DEPENDENCY ARRAY IS
  // EVALUATED DURING RENDER: sitting above the `useState` above, it hit `cfg` in
  // its temporal dead zone, so `App` threw `Cannot access 'cfg' before
  // initialization` on its very first render and the WHOLE STUDIO mounted
  // nothing — a white page for every user, not only the desktop shell the fix
  // was written for. It reached the branch because the PR carried a merge
  // conflict, which stops GitHub from building a merge ref, which means the
  // client-boot gate never ran on it (issue #112 close-out).
  // Once the shell has said `loaded` the origin is demonstrably up and the
  // wait is the canvas building — on a cold cloud canvas that can outlast 15 s
  // without anything being wrong, so the cap stretches instead of calling it a
  // failure. The shell reports a real build error itself (`canvas-failed`).
  const shellAlive = !!loadingPath && loadedPath === loadingPath;
  useEffect(() => {
    if (!loadingPath) return;
    const path = loadingPath;
    const cap = setTimeout(async () => {
      let kind = 'compile';
      try {
        const r = await fetch(`${cfg?.canvasOrigin || ''}/_health`, {
          cache: 'no-store',
        });
        if (!r.ok) kind = 'server';
      } catch {
        kind = 'server';
      }
      setCanvasError({ path, kind });
      setLoadingPath((p) => (p === path ? null : p));
    }, shellAlive ? 60000 : 15000);
    return () => clearTimeout(cap);
  }, [loadingPath, shellAlive, cfg?.canvasOrigin]);
  // WHO IS SAVING THIS PROJECT — one expression, read by every surface that
  // would otherwise offer to save it, poll for it, or badge it (DDR-218, widened
  // by feature-cloud-managed-git-posture).
  //
  // These two flags were previously derived at the GitPanel call site alone, so
  // the panel withdrew correctly while the toolbar menu and the status-bar chip
  // kept rendering a raw dirty count from `gitStatus.files.length` — the very
  // "lie about work that is already saved" the withdrawal exists to delete. The
  // count is the claim, wherever it is drawn; hoisting the rule here is what
  // keeps a third surface from re-introducing it.
  //
  // DECLARED HERE, AT THE TOP, ON PURPOSE. Every local-git POLL below is gated
  // on it, and a dependency array evaluates during render — a `const` further
  // down would be in its temporal dead zone at the first `useEffect` that names
  // it. The same hazard the remote-sync effect's own comment records.
  //
  // PRESENTATION, NOT A CONTROL — unchanged from DDR-218. `.git` is untouched:
  // no hook is installed, no config is written, a terminal `git status` /
  // `git commit` behaves exactly as before, the local `/_api/git/*` routes keep
  // exactly their old gates, and `git/watch.ts` still flushes a terminal
  // `git checkout` into Yjs (DDR-051). What stops is MAUDE's own local git
  // activity — the polls and the surfaces that describe a repo nobody is
  // editing through. Disconnect restores every one of them live.
  const cellManaged = !!cfg.cloud;
  const cloudManaged = !cfg.cloud && !!cloudLinkedHub?.credentialed;
  const savingIsManaged = cellManaged || cloudManaged;
  // The raw truth stays available for surfaces that legitimately need it (the
  // panel's own file list); only the COUNT — the thing that reads as a to-do —
  // is withheld when this project's saving is somebody else's job.
  const unsavedCount = savingIsManaged ? 0 : gitStatus?.files?.length || 0;
  // The posture, readable from callbacks that must NOT re-subscribe when it
  // flips: the WS handler is installed once for the socket's lifetime, and the
  // two git-status refreshers are `useCallback([])`s a dozen call sites depend
  // on being stable. A ref is how they read a live value without becoming a
  // reason to tear the socket down.
  const savingIsManagedRef = useRef(savingIsManaged);
  savingIsManagedRef.current = savingIsManaged;
  // Cloud Phase 25 C2 — viewer role, known at boot from /_config. Every
  // editing affordance in the shell gates on this (absent, not hidden).
  const viewerMode = !!cfg.readOnly;
  const loadServerConfig = useCallback(() => {
    fetch('/_config')
      .then((r) => r.json())
      .then((data) => {
        const designRel = (data.designRoot || '.design').replace(/^\/+|\/+$/g, '');
        // Functional merge — the `/_config` and `/_index-data` fetches race, and
        // the latter contributes `canvasDesignSystems` (DDR-093). A full-replace
        // here would clobber that map if it resolved second.
        setCfg((prev) => ({
          ...prev,
          designRel,
          tokensCssRel: data.tokensCssRel,
          // Pass through designSystems so canvasUrl can resolve the right
          // tokens/components paths per-DS. Top-level tokensCssRel is the
          // legacy default; designSystems[0].tokensCssRel is the project's
          // authoritative value (post DS-bootstrap).
          designSystems: data.designSystems,
          // T2 (9.1-A) — segregated canvas-content origin. canvasUrl() prepends
          // it so iframes load cross-origin (hub-pushed JSX is then walled off
          // from the main origin's /_api). Absent on older servers → relative
          // URL fallback keeps same-origin behavior.
          canvasOrigin: data.canvasOrigin,
          // Cloud Phase 25 C2 — the linked hub vouched a `viewer` role at
          // sign-in. Known at BOOT (before anything draws), so editing
          // affordances are ABSENT rather than shown-then-refused. This flag
          // decides what the UI offers; the cell (C1) and the dev-server's
          // read-only gate (http.ts) are what actually stop a write.
          readOnly: !!data.readOnly,
          // Cloud Phase 27 (DDR-209) — the capability that opens the cookieless
          // canvas origin. `canvasUrl()` appends it to every iframe URL. Absent
          // on a desktop, where the canvas origin is loopback and needs none.
          //
          // NOTE FOR WHOEVER ADDS THE NEXT FIELD: this is an explicit
          // projection, not a spread of `data`. A field the server starts
          // returning does NOT arrive here until it is named — which is how
          // both of these went missing and the cloud studio rendered without
          // its chrome and with every canvas iframe unauthenticated.
          canvasToken: data.canvasToken,
          // Which release this server is — rendered as the status-bar chip.
          // Undefined on a server too old to report it, which is why the chip
          // renders conditionally rather than printing `vundefined`.
          version: data.version,
          // C2/C4 — `{ dashboardUrl?, projectName, user, role }` when this is a
          // cloud tab. Its presence is what tells the shared client it is in a
          // browser tab on somebody else's machine; `user`/`role` are what let
          // it say WHICH account that tab is, and offer the way out.
          cloud: data.cloud ?? null,
          // feature-cloud-export-render-workers — `local` | `remote` | `none`.
          // Which export formats this server can actually produce; the export
          // dialogs gate on it. Absent on older servers → undefined, treated
          // as `local` (the pre-lane behavior) everywhere it is read.
          exportLane: data.exportLane,
          // DDR-247 — the apps allowed to frame this studio. Read by the
          // `?embed=1` root (embed-view.jsx), which never mounts <App>; named
          // here so the projection stays total (config-projection.test.ts).
          embedOrigins: data.embedOrigins,
        }));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadServerConfig();
  }, [loadServerConfig]);
  // Backfill the sync banner on mount from /_sync-status. The 'sync:status' WS
  // broadcast is one-shot for the zero-syncable case (DDR-060 / 9.1-D), so a
  // tab that connects after boot would otherwise miss it. {linked:false} (solo)
  // leaves the banner null.
  useEffect(() => {
    let cancelled = false;
    fetch('/_sync-status')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data || data.linked === false) return;
        setSyncStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Phase 27 (E2) — seed the git dirty-state on mount; live updates arrive over
  // the `git-status` WS broadcast (Task 5). Solo/non-git projects → repo:false.
  //
  // NOT WHILE SOMEBODY ELSE IS COMMITTING. In cloud-managed posture this asks
  // about a repo the user is not editing through, and every answer it brings
  // back is drawn somewhere as a claim about their work. Reactive on
  // `savingIsManaged`, not mount-only, so Disconnect resumes it live and
  // Connect stops it live — the requirement `git-cloud-posture.test.ts`
  // already pins for the panel.
  useEffect(() => {
    if (savingIsManaged) {
      // Drop what the local repo last said, too. A stale `gitStatus` left
      // standing keeps the tree's M/A/D badges lit after the posture changed.
      setGitStatus(null);
      return undefined;
    }
    let cancelled = false;
    fetch('/_api/git/status')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data) setGitStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [savingIsManaged]);
  const [commentsByFile, setCommentsByFile] = useState({}); // { file: [Comment] }
  // Phase 6 — the in-iframe composer owns drafting; the shell no longer holds
  // a `draft` state. Mutations route through postMessage → WS instead.
  const [focusedCommentId, setFocusedCommentId] = useState(null);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [commentsFilter, setCommentsFilter] = useState('open'); // 'all' | 'open' | 'resolved'
  const [theme, setTheme] = useState(readInitialTheme);
  // DDR-171 — CSS-panel vocabulary mode ('advanced' | 'designer'), App-owned so
  // the in-panel corner toggle (CssKnobs) and Settings → Appearance share one
  // source of truth; persisted to `maude-cp-mode` (same pattern as `theme`).
  const [cpMode, setCpMode] = useState(() => {
    const m = readJsonStore(CP_MODE_STORE, 'advanced');
    return m === 'designer' ? 'designer' : 'advanced';
  });
  useEffect(() => {
    try {
      localStorage.setItem(CP_MODE_STORE, JSON.stringify(cpMode));
    } catch {}
  }, [cpMode]);
  const [openMenu, setOpenMenu] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => readBoolStore(SIDEBAR_STORE, true));
  const [showHidden, setShowHidden] = useState(() => readBoolStore(SHOW_HIDDEN_STORE, false));
  // Issue #124 — folder + section disclosure of the Files panel, remembered
  // per project on disk (tree-expansion.js). Absent ⇒ closed.
  const treeExp = useTreeExpansion();
  const updateTreeExp = treeExp.update;
  const sectionsExpanded = treeExp.state.sections;
  const [helpOpen, setHelpOpen] = useState(false);
  const [reportBugOpen, setReportBugOpen] = useState(false);

  // Native Help ▸ Report a Bug… (menu.rs emits `menu://report-bug`) — same
  // lane as IdentityBar's File ▸ New Project… subscription.
  useEffect(() => {
    if (!isNativeApp()) return;
    const p = onMenuReportBug(() => setReportBugOpen(true));
    return () => {
      p.then((un) => un()).catch(() => {});
    };
  }, []);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const [brandUploadOpen, setBrandUploadOpen] = useState(false);
  const [figmaImportOpen, setFigmaImportOpen] = useState(false);
  // DDR-166 plan, Phase 2 (T7) — the persistent "Setup" affordance in the empty
  // canvas state (below) only renders while the project's own setup (design
  // system / first canvas / brand assets) is incomplete; native-only concern.
  const { report: setupReadiness } = useSetupReadiness(isNativeApp());
  // ? cheat-sheet (DS components-shortcuts-overlay) — separate from the deep
  // Help modal (F1), which keeps commands & flows.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // T5/T6 (Plan C) — shell-level export/handoff dialog + inspector panel state.
  // The palette (T4) drives them; the dialog (T5) + panel (T6) consume them.
  const [shareDialog, setShareDialog] = useState(null);
  const [exportDialog, setExportDialog] = useState(null); // null | { mode: 'export'|'handoff', scope? }
  // feature-ai-media-generation (DDR-16x) — BYOK provider-key Settings modal +
  // the AI generate action.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // feature-configurable-panel-docking — Layers as its own openable panel (when
  // layersMode==='separate'), plus the per-panel side map + layers mode. All
  // three hydrate from disk (/_api/ui-prefs) on mount and persist on change,
  // mirroring the view-pref pattern.
  const [layersOpen, setLayersOpen] = useState(false);
  const [panelSide, setPanelSide] = useState(() =>
    readJsonStore(PANEL_SIDES_STORE, PANEL_SIDES_DEFAULTS)
  );
  const [layersMode, setLayersMode] = useState(() => {
    try {
      const v = localStorage.getItem(LAYERS_MODE_STORE);
      if (v === 'separate' || v === 'in-inspector') return v;
    } catch {}
    return 'separate';
  });
  // DDR-148 — Timeline panel (right dock) for scrubbing a video-comp. `activeComps`
  // is populated from the iframe's `timeline-comps` announce; `timelineFrame` from
  // its live `timeline-frame`. Empty comps ⇒ the panel shows its empty state.
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [activeComps, setActiveComps] = useState([]);
  const [timelineFrame, setTimelineFrame] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  // Default off — looping is an explicit opt-in per session, not a surprise
  // once the user presses Play (rca/issue-video-artboard-loop-defaults-on).
  const [timelineLoop, setTimelineLoop] = useState(false);
  const [timelineMuted, setTimelineMuted] = useState(false);
  const [timelineVolume, setTimelineVolume] = useState(1);
  const [timelineHeight, setTimelineHeight] = useState(216);
  // The artboard nearest the viewport centre (reported by canvas-lib on pan) —
  // the Timeline follows THIS, so it redraws as you move across the canvas.
  const [canvasActiveArtboard, setCanvasActiveArtboard] = useState(null);
  // DDR-148 — parsed sequence/keyframe rows for the Timeline (from raw .tsx).
  const [timelineSequences, setTimelineSequences] = useState([]);
  const [timelineAudio, setTimelineAudio] = useState([]);
  // Task 5 — seam transitions between series beats ({ afterIndex, dur }).
  const [timelineTransitions, setTimelineTransitions] = useState([]);
  const [timelineTotal, setTimelineTotal] = useState(0);
  // rca/issue-video-artboard-frame-reset-on-edit — last known playhead, read
  // from the `timeline-comps` handler below (which fires on every comp
  // (re)mount, incl. a ⌘R hard iframe reload) to re-seed the fresh Player
  // instance. A ref, not state, so the handler always sees the latest value
  // without pulling `timelineFrame` into that big message-listener's deps.
  const timelineFrameRef = useRef(0);
  useEffect(() => {
    timelineFrameRef.current = timelineFrame;
  }, [timelineFrame]);
  // The DCArtboard id the timeline scoped to (from parseCompTimeline). Used for
  // /_api/comp-clips + every clip op so the enumerator targets the SAME comp the
  // rows came from — `timelineCompId` is the Player's `videocomp-N` id, which
  // never matches a DCArtboard id and made the enumerator fall back to the wrong
  // comp on a multi-comp canvas (the showreel badge/replace/op mis-scope).
  const [timelineArtboardId, setTimelineArtboardId] = useState(null);
  const timelineArtboardIdRef = useRef(null);
  useEffect(() => {
    timelineArtboardIdRef.current = timelineArtboardId;
  }, [timelineArtboardId]);
  // On a multi-comp canvas the Timeline drives ONE comp: the one mounted in the
  // artboard whose rows the panel is drawing. Resolved by artboard identity
  // (announced by video-comp.tsx), NOT by duration — two comps of equal length
  // made the old duration match return the first artboard's Player, so scrub +
  // playback moved a comp the user wasn't even looking at (issue #75).
  const timelineCompId = useMemo(
    () =>
      resolveCompTarget(activeComps, {
        // Both signals, in confidence order: the artboard the ROW PARSER scoped
        // to (lexical, from the .tsx) then the viewport-active one canvas-lib
        // reports on pan (structural). See resolveCompTarget — when the two
        // disagree, the one that names a comp actually mounted there wins.
        artboardId: [timelineArtboardId, canvasActiveArtboard],
        total: timelineTotal,
      }),
    [activeComps, timelineArtboardId, canvasActiveArtboard, timelineTotal]
  );
  const timelineCompIdRef = useRef(null);
  useEffect(() => {
    timelineCompIdRef.current = timelineCompId;
  }, [timelineCompId]);
  // Frame math (drop position, split, overlay insert) must use the timebase of
  // the comp the Timeline is actually on — `activeComps[0].fps` silently used
  // the first artboard's (issue #75).
  const timelineFps = useMemo(
    () => activeComp(activeComps, timelineCompId)?.fps || 30,
    [activeComps, timelineCompId]
  );
  // feature-enhanced-video-editing (Task 3) — the timeline's single-select model.
  // Holds the selected clip's stableId (NOT a row index — DDR-150), so the
  // selection survives comp-clips refetches, reorders, and external file edits.
  const [timelineSelectedClip, setTimelineSelectedClip] = useState(null);
  // Task 8 — bumped after a concurrent-edit refusal so the source + comp-clips
  // effects refetch ("Timeline changed — reloaded, try again").
  const [timelineRefresh, setTimelineRefresh] = useState(0);
  const timelineOpFailed = useCallback((prefix, msg) => {
    if (/concurrent edit|changed since it was read/i.test(msg || '')) {
      shellToast('Timeline changed — reloaded, try again.');
      setTimelineRefresh((n) => n + 1);
    } else {
      shellToast(`${prefix}: ${msg || 'failed'}`);
    }
  }, []);
  // Phase 31 (DDR-123) — the native ACP chat sidepanel (right dock, native-only).
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantUnseen, setAssistantUnseen] = useState(false);
  const assistantOpenRef = useRef(assistantOpen);
  useEffect(() => {
    assistantOpenRef.current = assistantOpen;
    if (assistantOpen) {
      setAssistantUnseen(false); // opening clears the unseen badge
      // Ask for notification permission on a real user gesture (panel open).
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      } catch {
        /* notifications unavailable */
      }
    }
  }, [assistantOpen]);
  // ChatPanel owns one connection PER CHAT (so chats run in parallel in the
  // background) and reports up here: `onBusyChange` for the menubar pulse, and
  // `onFinished` when any chat's turn ends — badge + notify if you weren't looking.
  const handleAssistantFinished = useCallback(() => {
    if (!assistantOpenRef.current || document.hidden) {
      setAssistantUnseen(true);
      notifyDesktop('Claude finished', 'Your assistant turn is ready in Maude.');
    }
  }, []);
  // DDR-185 — same "you weren't looking" gate as handleAssistantFinished
  // above, fired instead when a chat is PAUSED waiting on the user (a
  // permission prompt or an AskUserQuestion/elicitation form), not just when
  // a turn completes. A stalled turn otherwise gives no signal at all if the
  // window isn't focused. Distinct copy so it doesn't read as "done".
  //
  // Security-review addendum (Finding G): DDR-179/180 already cap concurrent
  // pending requests at 10 permissions + 5 elicitations, so a single
  // adversarial turn can legitimately queue up to 15 DISTINCT approval
  // decisions — each one now fires a real OS Notification, which is exactly
  // the burst that manufactures the "rapid Enter-mashing" precondition
  // DDR-179's own addendum already treats as a security-relevant habituation
  // risk. The in-app badge (setAssistantUnseen) still reflects EVERY new
  // request instantly — only the OS notification itself is rate-limited, so
  // a burst reads as one attention-getting ping, not fifteen.
  const lastAttentionNotifyRef = useRef(0);
  const handleAssistantAttention = useCallback(() => {
    if (!assistantOpenRef.current || document.hidden) {
      setAssistantUnseen(true);
      const now = Date.now();
      if (now - lastAttentionNotifyRef.current < ATTENTION_NOTIFY_COOLDOWN_MS) return;
      lastAttentionNotifyRef.current = now;
      notifyDesktop('Maude needs your input', 'Claude is waiting on an approval or a question in Maude.');
    }
  }, []);
  // Inspector tab is lifted so View ▸ Layers can open the panel ON the Layers
  // tab (the menu item sat disabled as "Phase 12" long after the tab shipped).
  const [inspectorTab, setInspectorTab] = useState('inspect');
  // feature-photo-editor (Task 13) — the annotation-image Photo-tab target,
  // threaded up from the annotation layer's "Edit Photo…" (the annotation model
  // has no DOM selection to ride, unlike an artboard `<img>`). `{ asset, strokeId }`
  // or null. Cleared whenever a normal DOM selection arrives so the two never
  // fight over the panel. The shell-side photo undo stack lives alongside it.
  const [photoSel, setPhotoSel] = useState(null);
  const photoUndoRef = useRef({ undo: [], redo: [] });
  // Bumped by the Cmd+Z/Cmd+Shift+Z photo-undo handler below so the mounted
  // PhotoKnobs (keyed on `asset:photoRev`) remounts and re-fetches the sidecar
  // it just PUT, instead of drifting from its own stale local `edit` state.
  const [photoRev, setPhotoRev] = useState(0);
  // feature-element-editing-robustness Stage C — auto-open the Inspector on the
  // CSS tab when a fresh single selection arrives AND no right panel is already
  // open. Preference-backed (default ON); disable it in the View menu. Refs keep
  // the postMessage selection listener stale-closure-safe.
  const [autoOpenInspector, setAutoOpenInspector] = useState(() => {
    try {
      return localStorage.getItem('maude-auto-open-inspector') !== '0';
    } catch {
      return true;
    }
  });
  const autoOpenInspectorRef = useRef(autoOpenInspector);
  useEffect(() => {
    autoOpenInspectorRef.current = autoOpenInspector;
    try {
      localStorage.setItem('maude-auto-open-inspector', autoOpenInspector ? '1' : '0');
    } catch {
      /* private mode / storage disabled */
    }
  }, [autoOpenInspector]);
  // Whether ANY right-dock panel is open — the auto-open guard reads this ref so
  // it never steals focus from an already-open panel (the user's explicit rule).
  const anyRightPanelOpenRef = useRef(false);
  useEffect(() => {
    anyRightPanelOpenRef.current =
      inspectorOpen || commentsPanelOpen || changesOpen || syncPanelOpen || assistantOpen;
  }, [inspectorOpen, commentsPanelOpen, changesOpen, syncPanelOpen, assistantOpen]);
  // The right dock holds exactly ONE panel (Changes / Inspector / Comments) at
  // a time — opening any panel REPLACES whatever was there. These two helpers
  // are the single source of that invariant; every open/toggle path routes
  // through them. (Before, the three booleans were flipped independently across
  // ~13 call sites and only some closed their siblings, so a panel opened via a
  // path that left a sibling `true` rendered *behind* it under the fixed
  // precedence — looking like the new panel "overlapped" the old one.)
  // feature-configurable-panel-docking — generic, SIDE-AWARE panel management.
  // A slot (left/right) shows one panel at a time, so opening a panel closes any
  // OTHER open panel ON THE SAME SIDE (panels on the other side are independent).
  // A live ref carries the current open + side maps so the callbacks stay stable
  // yet never act on stale state. (The Timeline is a BOTTOM dock, DDR-148, and is
  // NOT part of either slot's mutual-exclusion.)
  const panelStateRef = useRef({ open: {}, side: PANEL_SIDES_DEFAULTS });
  panelStateRef.current = {
    open: {
      tree: sidebarOpen,
      layers: layersOpen,
      inspector: inspectorOpen,
      comments: commentsPanelOpen,
      changes: changesOpen,
      sync: syncPanelOpen,
      assistant: assistantOpen,
    },
    side: panelSide,
  };
  const setPanelOpen = useCallback((id, val) => {
    if (id === 'tree') setSidebarOpen(val);
    else if (id === 'layers') setLayersOpen(val);
    else if (id === 'inspector') setInspectorOpen(val);
    else if (id === 'comments') setCommentsPanelOpen(val);
    else if (id === 'changes') setChangesOpen(val);
    else if (id === 'sync') setSyncPanelOpen(val);
    else if (id === 'assistant') setAssistantOpen(val);
  }, []);
  const sideOf = useCallback(
    (id) => panelStateRef.current.side?.[id] || PANEL_SIDES_DEFAULTS[id],
    []
  );
  const openPanelExclusive = useCallback(
    (id) => {
      const side = sideOf(id);
      setPanelOpen(id, true);
      for (const p of DOCK_PANELS) {
        if (p.id !== id && sideOf(p.id) === side) setPanelOpen(p.id, false);
      }
    },
    [setPanelOpen, sideOf]
  );
  const togglePanel = useCallback(
    (id) => {
      if (panelStateRef.current.open?.[id]) setPanelOpen(id, false);
      else openPanelExclusive(id);
    },
    [openPanelExclusive, setPanelOpen]
  );
  // Legacy name kept for the many call sites; now side-aware (opens `which` and
  // closes only same-side siblings, so a panel moved to the left is unaffected).
  const openRightPanel = openPanelExclusive;
  const toggleRightPanel = togglePanel;
  // feature-element-editing-robustness Stage C (Task C1) — open the Inspector on
  // the CSS tab for a fresh SINGLE selection, but only when nothing is already
  // docked on the right (never override an open Layers/Inspect/Comments panel)
  // and only when the preference is on. Idempotent: once the inspector is open,
  // the `anyRightPanelOpen` guard stops it re-firing on the next selection.
  const maybeAutoOpenInspectorOnSelect = useCallback(
    (sel) => {
      if (!autoOpenInspectorRef.current) return;
      if (viewerMode) return; // Cloud Phase 25 C2 — inspector is edit chrome
      if (!sel || !sel.id) return; // need a stable element id to inspect
      if (anyRightPanelOpenRef.current) return; // don't steal from an open panel
      openRightPanel('inspector');
      setInspectorTab('css');
    },
    [openRightPanel, viewerMode]
  );
  // DDR-148 — the Timeline is a BOTTOM dock, independent of the right rail: it
  // toggles on its own and coexists with Inspector/Changes/Comments/Chat.
  const toggleTimeline = useCallback(() => setTimelineOpen((v) => !v), []);
  const whatsNew = useWhatsNew(MDCC_VERSION);
  // Same tri-state rule as the sign-in bar: hydrating before the shell is
  // known 404s every boot. On desktop (`cloud === null`) the export queue is
  // the LOCAL job runner, always on. In a cloud tab it hydrates only when the
  // cell actually holds a jobs lane (`exportLane === 'remote'`) — a cell
  // without a render service still refuses `/_api/export-jobs` outright
  // (DDR-209 D1 posture, now lane-scoped by feature-cloud-export-render-workers).
  const exportCenter = useExportCenter({
    enabled: cfg.cloud === null || cfg.exportLane === 'remote',
  });
  // Phase 29 (E4) — first-run onboarding wizard. The native shell boots a minimal
  // "welcome" project on first launch; we ask it whether this is a first run and, if
  // so, show the wizard OVER the (empty) canvas browser. Completing any door switches
  // the sidecar to a real project (the webview reloads → first-run is then false).
  const [firstRun, setFirstRun] = useState(false);
  // Offer the collab "rychlý kurz" once, AFTER onboarding (native app, not first run,
  // not yet seen). A returning user who already took it isn't re-nudged.
  const [collabNudge, setCollabNudge] = useState(false);
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let alive = true;
    appIsFirstRun()
      .then((v) => {
        if (!alive) return;
        setFirstRun(!!v);
        if (!v && !readBoolStore(COLLAB_TOUR_STORE, false)) setCollabNudge(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const markCollabSeen = useCallback(() => {
    setCollabNudge(false);
    try {
      localStorage.setItem(COLLAB_TOUR_STORE, '1');
    } catch {}
  }, []);
  // Phase 32 (Task 1) — auto-update. The native shell downloads + stages a newer
  // build in the background and emits `update-ready`; we surface a non-blocking
  // banner. Native-only (the web studio is updated by its own deploy).
  const [updateReady, setUpdateReady] = useState(null);
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let un;
    onUpdateReady((p) => setUpdateReady(p && typeof p === 'object' ? p : {}))
      .then((fn) => {
        un = fn;
      })
      .catch(() => {});
    return () => {
      try {
        un?.();
      } catch {}
    };
  }, []);
  const [tourSteps, setTourSteps] = useState(null);
  const [usageNudge, setUsageNudge] = useState(() => !readBoolStore(USAGE_TOUR_STORE, false));
  const startTour = useCallback((steps) => {
    setTourSteps(Array.isArray(steps) && steps.length ? steps : null);
  }, []);
  // Guided-tour bus — the overlay calls setup() before each step to put the shell
  // into the state the step spotlights: open a canvas, open the Inspector, switch
  // its tab. The canvas iframe is cross-origin (DDR-054) so the tour can't select
  // an element for the user; requireSelection steps instead wait for a real
  // ⌘-click. Plain object (the overlay refs it), so per-render churn is harmless.
  const tourBus = {
    setup: (step) => {
      if (!step) return;
      if ((step.canvas || step.requireSelection) && tabs.length === 0) {
        openPanelExclusive('tree');
        setTimeout(() => {
          try {
            document.querySelector('.st-sidebar [data-testid^="canvas-row-"]')?.click();
          } catch {}
        }, 80);
      }
      if (step.inspector || step.tab || step.requireSelection) openRightPanel('inspector');
      if (step.tab) setInspectorTab(step.tab);
      // Phase 29 (E4) collab tour — open the Changes panel so the Save / Publish /
      // Get-latest controls the action steps spotlight actually exist to anchor on.
      if (step.changes) openRightPanel('changes');
    },
  };
  const markUsageSeen = useCallback(() => {
    setUsageNudge(false);
    try {
      localStorage.setItem(USAGE_TOUR_STORE, '1');
    } catch {}
  }, []);
  const [annotationsVisible, setAnnotationsVisible] = useState(() =>
    readBoolStore(ANNOT_STORE, true)
  );
  // feature-unified-settings-modal — gate the disk-write effect until the boot
  // GET /_api/ui-prefs has reconciled (disk-wins), so we never clobber a stored
  // pref with the localStorage/default value on the first render.
  const [uiPrefsHydrated, setUiPrefsHydrated] = useState(false);
  // Canvas-chrome visibility (View menu). minimap + zoom-controls are
  // persistent prefs broadcast to every open canvas iframe; presentMode is a
  // non-destructive "hide ALL chrome + shell, artboards only" overlay with an
  // Esc / floating-pill escape hatch back to the chrome.
  const [minimapVisible, setMinimapVisible] = useState(() => readBoolStore(MINIMAP_STORE, false));
  const [zoomCtlVisible, setZoomCtlVisible] = useState(() => readBoolStore(ZOOMCTL_STORE, false));
  const [presentMode, setPresentMode] = useState(false);
  // feature-2-print-artboards T3 — "Show print guides". Per-CANVAS persisted
  // (view.json `overlays.print`, via /_api/canvas-meta), not a global
  // localStorage pref like minimap/zoomctl — mirrors the foundation's
  // `overlays.guides` lane. Re-read whenever the active canvas changes (see
  // the activeArtboards effect below); sent only to the active iframe.
  const [printGuidesVisible, setPrintGuidesVisible] = useState(false);
  // P2/P3 (Plan C) — top-bar live state. (Zoom lives in the canvas toolbar pill,
  // so the top bar no longer mirrors it.)
  //   activeArtboards — real artboard count of the open canvas, read from its
  //                   `<canvas>.meta.json` sidecar (shell-side, no iframe dep).
  //   gitUser       — local user (name/initials) for the menubar presence avatar.
  //   agentActive   — transient flag set on `ai-activity`, cleared after idle, so
  //                   the menubar shows a live agent avatar while Claude edits.
  const [activeArtboards, setActiveArtboards] = useState(0);
  const [gitUser, setGitUser] = useState(null);
  const [agentActive, setAgentActive] = useState(false);
  const agentIdleRef = useRef(null);
  const wsRef = useRef(null);
  const iframesRef = useRef(new Map());

  // THE CANVAS CAPABILITY OUTLIVES NO TAB (cloud only). It expires 15 minutes
  // after the proxy minted it (render-token.mjs) and cannot be revoked, so it
  // stays short — which left every cloud tab open longer than that with
  // canvases that stopped updating: a teammate's edit re-imports the canvas
  // module, and the canvas origin answered 401. Re-mint it well inside the
  // lifetime (every `/_config` answer carries a fresh one), hand it to each
  // open canvas, and let new frames be built with it. On waking a tab that
  // slept past the cadence, do it at once. Desktops have no capability and
  // never start the timer.
  useEffect(() => {
    if (!cfg?.canvasToken) return undefined;
    let stopped = false;
    let timer = null;
    let dueAt = 0;
    const schedule = (token) => {
      clearTimeout(timer);
      const delay = canvasTokenRefreshDelay(token);
      dueAt = Date.now() + delay;
      timer = setTimeout(refresh, delay);
    };
    async function refresh() {
      let token = null;
      try {
        const res = await fetch('/_config', { cache: 'no-store', credentials: 'same-origin' });
        if (res.ok) token = (await res.json())?.canvasToken;
      } catch {
        /* retried below; the current capability may still be valid */
      }
      if (stopped) return;
      if (typeof token !== 'string' || !token) {
        clearTimeout(timer);
        dueAt = Date.now() + 30_000;
        timer = setTimeout(refresh, 30_000);
        return;
      }
      setLiveCanvasToken(token);
      // To the canvas origin only, never '*': a frame the canvas content
      // navigated elsewhere must not be handed the capability.
      const target = canvasTarget();
      if (target) {
        for (const el of iframesRef.current.values()) {
          try {
            el.contentWindow?.postMessage({ dgn: 'canvas-cap', t: token }, target);
          } catch {}
        }
      }
      schedule(token);
      return token;
    }
    function canvasTarget() {
      try {
        return new URL(cfg.canvasOrigin, location.href).origin;
      } catch {
        return null;
      }
    }
    // A FRAME WHOSE OWN DOCUMENT WAS REFUSED AS EXPIRED. The re-mint above
    // reaches a running canvas's fetches, but not a frame that re-navigates
    // itself (a hard reload, a laptop that slept past the cadence): that load
    // carries the URL it was built with, and the canvas origin answers with a
    // small page that asks us for a fresh capability (hub studio-proxy). Mint
    // one and point just that frame at it — no "reload the project".
    let reviving = false;
    async function onExpired(e) {
      if (e.data?.dgn !== 'canvas-expired' || e.origin !== canvasTarget() || reviving) return;
      reviving = true;
      try {
        const token = await refresh();
        if (!token) return;
        for (const el of iframesRef.current.values()) {
          if (el.contentWindow === e.source) el.src = withCanvasToken(el.src, token);
        }
      } finally {
        reviving = false;
      }
    }
    window.addEventListener('message', onExpired);
    schedule(cfg.canvasToken);
    // A background tab's timers are throttled; one woken past its due time
    // re-mints at once rather than on the throttled tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= dueAt) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('message', onExpired);
    };
  }, [cfg?.canvasToken, cfg?.canvasOrigin]);

  // Phase 5.1 — postMessage bridge from menubar dropdowns to the canvas iframe.
  // The canvas-shell listens for these `dgn:*` messages and dispatches into the
  // matching local provider (annotations visibility / both selection stores /
  // tool mode). Mirrors the existing `force-clear` / `select-clear` channel.
  const postToActiveCanvas = useCallback(
    (payload) => {
      const el = activePath ? iframesRef.current.get(activePath) : null;
      if (!el || !el.contentWindow) return;
      try {
        el.contentWindow.postMessage(payload, '*');
      } catch {}
    },
    [activePath]
  );

  // DDR-231 (hybrid export lanes) — ask the active canvas iframe to capture
  // its own artboards (canvas-lib's useExportCaptureBridge) and hand back the
  // blobs. The shell can't reach the cross-origin canvas DOM, and the sandbox
  // omits allow-downloads, so this is the division of labour: the CANVAS
  // captures (it renders the pixels), the SHELL downloads. Resolves with
  // [{ name, type, blob }]; rejects on canvas error or timeout.
  const browserCaptureSeq = useRef(0);
  const captureFromCanvas = useCallback(
    ({ format, artboardIds = null, scale = 1, onProgress, timeoutMs = 120_000 }) =>
      new Promise((resolve, reject) => {
        const el = activePath ? iframesRef.current.get(activePath) : null;
        if (!el || !el.contentWindow) {
          reject(new Error('no active canvas to capture'));
          return;
        }
        const cw = el.contentWindow;
        browserCaptureSeq.current += 1;
        const id = `cap-${Date.now().toString(36)}-${browserCaptureSeq.current}`;
        let settled = false;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onMsg);
          clearTimeout(timer);
          fn(arg);
        };
        const onMsg = (e) => {
          // Only answers from the iframe we asked — a message with a matching
          // id from any other window is ignored.
          if (e.source !== cw) return;
          const m = e.data;
          if (!m || m.id !== id) return;
          if (m.dgn === 'export-capture-progress') onProgress?.(m.current, m.total);
          else if (m.dgn === 'export-capture-done')
            finish(resolve, Array.isArray(m.items) ? m.items : []);
          else if (m.dgn === 'export-capture-error')
            finish(reject, new Error(m.message || 'capture failed'));
        };
        const timer = setTimeout(
          () => finish(reject, new Error('capture timed out — the canvas did not answer')),
          timeoutMs
        );
        window.addEventListener('message', onMsg);
        try {
          cw.postMessage({ dgn: 'export-capture', id, format, artboardIds, scale }, '*');
        } catch (err) {
          finish(reject, err);
        }
      }),
    [activePath]
  );

  // Issue #125 — "Selection area" needs every selected item, canvas elements
  // AND annotations; the shell tracks only one, so ask the canvas. Resolves
  // null (→ the single tracked selection) when the canvas doesn't answer.
  const querySelectionFromCanvas = useCallback(
    () =>
      new Promise((resolve) => {
        const el = activePath ? iframesRef.current.get(activePath) : null;
        if (!el || !el.contentWindow) {
          resolve(null);
          return;
        }
        const cw = el.contentWindow;
        const id = `sel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const onMsg = (e) => {
          if (e.source !== cw) return;
          const m = e.data;
          if (!m || m.dgn !== 'export-selection' || m.id !== id) return;
          done(Array.isArray(m.selectors) ? m.selectors.filter((x) => typeof x === 'string') : null);
        };
        const timer = setTimeout(() => done(null), 1500);
        function done(v) {
          clearTimeout(timer);
          window.removeEventListener('message', onMsg);
          resolve(v);
        }
        window.addEventListener('message', onMsg);
        try {
          cw.postMessage({ dgn: 'export-selection-query', id }, '*');
        } catch {
          done(null);
        }
      }),
    [activePath]
  );
  const {
    askText, broadcastChrome, exitPresent, lockedKeys, onPhotoEdit, onPhotoRecordEdit,
    onPhotoRemoveBackground, performPhotoUndo, pushTlUndo, resolveClipRef, settleShellPrompt,
    shellPromptState, timelineAddComment, timelineClipVerb, timelineRemoveClip, timelineTransClips,
    tlKeyRef, toggleAnnotations, toggleLockedKey, toggleMinimap, togglePresent, togglePrintGuides,
    toggleSection, toggleZoomCtl
  } = usePhotoAndTimeline({
    groups, treeLoaded, activePath, selected, theme, setTheme, sidebarOpen, showHidden, treeExp,
    updateTreeExp, panelSide, setPanelSide, layersMode, setLayersMode, timelineOpen, activeComps,
    setActiveComps, timelineFrame, setTimelineFrame, timelinePlaying, setTimelinePlaying,
    timelineLoop, timelineMuted, canvasActiveArtboard, timelineSequences, setTimelineSequences,
    setTimelineAudio, setTimelineTransitions, timelineTotal, setTimelineTotal, timelineArtboardId,
    setTimelineArtboardId, timelineArtboardIdRef, timelineCompId, timelineSelectedClip,
    setTimelineSelectedClip, timelineRefresh, timelineOpFailed, photoUndoRef, setPhotoRev,
    autoOpenInspector, setAutoOpenInspector, annotationsVisible, setAnnotationsVisible,
    uiPrefsHydrated, setUiPrefsHydrated, minimapVisible, setMinimapVisible, zoomCtlVisible,
    setZoomCtlVisible, setPresentMode, setPrintGuidesVisible, setActiveArtboards, setGitUser,
    iframesRef, postToActiveCanvas, wsSend
  });
  const treeExpansion = useMemo(
    () => ({
      isOpen: (dirPath) => isDirOpen(treeExp.state, dirPath),
      setOpen: (dirPath, open) => updateTreeExp((st) => setDirOpen(st, dirPath, open)),
    }),
    [treeExp.state, updateTreeExp]
  );
  const { loadSystemData, loadTree, toggleTheme } = useProjectData({ setGroups, setTreeLoaded, setTreeLoadFailures, setProject, setSystemData, setCfg, setTheme });

  // ----- Comments — initial load of all files -----
  const loadAllComments = useCallback(async () => {
    try {
      const r = await fetch('/_comments-all');
      const data = await r.json();
      setCommentsByFile(data || {});
    } catch (e) {
      console.error('failed to load comments', e);
    }
  }, []);
  const { canvasListChangeRef } = useWebSocket({ loadAllComments });
  useEffect(() => {
    // KEEPALIVE. The inspector feed only pushes on events (a comment, a
    // selection, sync:status), so an idle designer's socket exchanges nothing
    // for minutes — and Bun.serve closes a WebSocket after `idleTimeout` (120s
    // default) with no message in EITHER direction. The client then reconnected
    // in a 1 s loop, so the status bar read `reconnecting` every couple of
    // minutes on a perfectly healthy link ("porad reconnecting" while HUB SYNC
    // said synced — the two are different sockets). A cheap app-level ping every
    // 25 s keeps the socket active (Bun resets the idle timer on any frame,
    // inbound OR outbound); the server ignores an unknown message type.
    let pingTimer = null;
    // A RECONNECT MEANS THE PEER MAY BE A DIFFERENT PROCESS — issue #115.
    // The desktop supervisor respawns the sidecar when it dies (DDR-235's Bun
    // fault is a recurring one), and everything this page cached from `/_config`
    // was published by the process that just went away. `canvasOrigin` is the
    // one that bites: it is an OS-assigned ephemeral port (server.ts's
    // `startCanvasServer(0)`), so it is DIFFERENT in every process, while the
    // main origin walks a deterministic ladder from 4399 and usually reclaims
    // its old port. The result was a half-live page — socket back up, status bar
    // `live`, tree and panels fine — whose every canvas iframe navigated to a
    // dead port. Since a canvas switch mounts a FRESH iframe (single-canvas
    // model, keyed by path), the already-open canvas kept rendering and only
    // switching went white, silently and permanently.
    //
    // So: re-derive the config from whoever is answering now. Only on a
    // RE-connect — the boot effect above already did the first fetch.
    let everConnected = false;
    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(proto + '//' + location.host + '/_ws');
      wsRef.current = ws;
      ws.addEventListener('open', () => {
        setWsConnected(true);
        if (everConnected) loadServerConfig();
        everConnected = true;
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
        }, 25000);
      });
      ws.addEventListener('close', () => {
        setWsConnected(false);
        clearInterval(pingTimer);
        setTimeout(connect, 1000);
      });
      ws.addEventListener('error', () => {});
      ws.addEventListener('message', (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'snapshot' && m.state) {
            setSelected((prev) => mergeSelClientFields(m.state.selected, prev));
          } else if (m.type === 'selected') {
            // feature-acp-context-hardening — a canvas switch RESTORES the
            // per-canvas selection server-side and broadcasts it here. The
            // dgn:'loaded' re-select (Phase 12.3 path below) only works when
            // this frame lands BEFORE the new iframe loads; on a fast cached
            // mount it lands after, so re-apply the halo from THIS edge too.
            // Guarded to restore-transitions (prev missing / different id or
            // file) so the select-set echo of our own re-select can't loop.
            //
            // feature-4 dogfood fix (2026-07-19) — the frame is ALSO the echo
            // of our OWN wsSend('select'): it round-trips the server and lands
            // hundreds of ms later, by which time the user may have drilled
            // deeper (dblclick) or multi-selected — the echo then OVERWROTE the
            // fresh state with the stale head and the halo-restore ladder
            // re-imposed it on the canvas ("multiselect snaps back to one",
            // "drill snaps back to the parent"). Suppress the restore path
            // entirely within a short window of any LOCAL selection send — a
            // genuine cross-canvas restore never follows a local select that
            // closely (it follows a canvas switch).
            if (Date.now() - lastLocalSelectAtRef.current < 2000) return;
            const incoming = m.selected;
            const one = Array.isArray(incoming) ? incoming[0] : incoming;
            const prevSel = selectedRef.current;
            const prevOne = Array.isArray(prevSel) ? prevSel[0] : prevSel;
            setSelected((prev) => mergeSelClientFields(incoming, prev));
            if (
              one?.id &&
              one.file &&
              (!prevOne || prevOne.id !== one.id || prevOne.file !== one.file)
            ) {
              scheduleHaloRestore(one);
            }
          } else if (m.type === 'comments' && typeof m.file === 'string') {
            setCommentsByFile((prev) => ({ ...prev, [m.file]: m.comments || [] }));
          } else if (m.type === 'ai-activity' && typeof m.file === 'string') {
            // P3 (Plan C) — surface live agent activity as a menubar presence
            // avatar. Set the flag and (re)arm an idle timer so the avatar
            // fades once Claude stops editing.
            setAgentActive(true);
            if (agentIdleRef.current) clearTimeout(agentIdleRef.current);
            agentIdleRef.current = setTimeout(() => setAgentActive(false), 8000);
            // Phase 8 Task 4 — relay to every open iframe; each canvas's
            // AiBanner filters by its own file path. Lightweight broadcast
            // (one envelope per change, not per iframe count).
            for (const el of iframesRef.current.values()) {
              try {
                el.contentWindow.postMessage(
                  { dgn: 'ai-activity', file: m.file, entry: m.entry },
                  '*'
                );
              } catch {}
            }
          } else if (m.type === 'export:job' && m.payload) {
            // feature-background-export-notification-center — full-snapshot
            // job state on every queued/running/progress/done/failed change.
            exportCenter.upsert(m.payload);
          } else if (m.type === 'sync:status' && m.payload) {
            // Phase 9 Task 8 — hub connection state for the offline banner.
            setSyncStatus(m.payload);
          } else if (m.type === 'canvas-list-update') {
            loadTree();
            canvasListChangeRef.current(m.payload);
          } else if (m.type === 'config-updated') {
            // Server hot-reloaded .design/config.json (/design:setup-ds rewrote
            // it) — refetch /_config so designSystems / tokensCssRel / groups
            // match. The tree refresh arrives separately via canvas-list-update.
            loadServerConfig();
          } else if (m.type === 'acp-focus') {
            // Phase 31 (DDR-123) — `/design:chat` from the terminal asked us to
            // surface the native ACP chat sidepanel. Native-only (the panel
            // doesn't exist on the web surface).
            if (isNativeApp()) openRightPanel('assistant');
          } else if (m.type === 'git-status' && m.payload) {
            // Phase 27 (E2) Task 5 — live dirty-state. Updates the Changes-panel
            // count + tree M/A/D badges reactively, no polling.
            //
            // The server PUSHES this, so gating the fetches alone would not be
            // enough: the broadcast would quietly re-populate everything the
            // polls stopped asking for. Read through a ref because this handler
            // is installed once, by an effect that must not re-subscribe the
            // socket every time the posture flips.
            if (!savingIsManagedRef.current) setGitStatus(m.payload);
          } else if (m.type === 'git-lifecycle' && m.payload) {
            // Phase 8 Task 7 — branch switch / pull mid-session. Server has
            // already flushed every dirty Y.Doc to JSON; just prompt the user.
            // Single confirm covers all open iframes — reload reseeds them all.
            setGitLifecycle(m.payload);
            // Also relay to iframes so canvas-level "Reload?" UI (if any)
            // can react. Outer banner is the primary prompt.
            for (const el of iframesRef.current.values()) {
              try {
                el.contentWindow.postMessage({ dgn: 'git-lifecycle', payload: m.payload }, '*');
              } catch {}
            }
          }
        } catch {}
      });
    }
    connect();
    return () => {
      clearInterval(pingTimer);
      if (wsRef.current) wsRef.current.close();
    };
    // loadTree + loadServerConfig are stable useCallback([])s; listed so the
    // canvas-list-update / config-updated handlers always call the live refs.
  }, [loadTree, loadServerConfig]);

  function wsSend(obj) {
    const ws = wsRef.current;
    try {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    } catch {}
  }

  // A PERSON IS HERE — the desktop park's presence signal (sync/park.ts). A
  // parked desktop has closed its cloud link so the project can sleep; real
  // input brings it back, and keeps an attended desktop from parking. Real
  // input only (not focus): a window left focused overnight is not a person.
  // At most one frame per 30 s, so the socket hears a heartbeat, not a stream.
  useEffect(() => {
    let last = 0;
    const onInput = () => {
      const now = Date.now();
      if (now - last < 30_000) return;
      last = now;
      wsSend({ type: 'presence' });
    };
    const events = ['pointerdown', 'keydown', 'wheel'];
    for (const e of events) window.addEventListener(e, onInput, { capture: true, passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, onInput, { capture: true });
    };
  }, []);
  const {
    acceptedDiff, cloudHistory, dirtyByPath, gitCommit, gitDiscard, gitGetLatest, gitLoadCloudLog,
    gitLoadLog, gitPublish, gitResolveConflict, loadAcceptedLog, loadDiffLog, projectHistoryOn,
    projectHistoryRefresh, refreshRemoteSync, restoreProjectVersion, setProjectHistoryOn
  } = useGitActions({
    gitStatus, setGitStatus, setRemoteSync, diffTarget, setDiffTarget, savingIsManaged,
    savingIsManagedRef
  });

  // Phase 28 (E3) — keep remote ahead/behind fresh so the "Get latest" nudge
  // surfaces on its own: probe once a repo is known, again whenever the Changes
  // panel opens, and on a slow 60 s tick WHILE the panel is open (a teammate's
  // publish then shows up without the user first attempting their own publish).
  // Declared after `refreshRemoteSync` to avoid a temporal-dead-zone on the dep.
  useEffect(() => {
    if (savingIsManaged) {
      // Nothing to nudge about: Publish is withdrawn in this posture, so a
      // probe could only produce a count nobody may act on. Clear the last
      // answer as well — a stale ahead/behind would outlive the link.
      setRemoteSync(null);
      return undefined;
    }
    if (gitStatus?.repo === false) return; // solo / non-git project — no remote
    refreshRemoteSync();
    // Poll in the background too — not only while Changes is open — so the dock's
    // "Get latest" nudge surfaces a teammate's publish proactively. Slower cadence
    // when the panel is closed to stay network-polite (the ahead/behind probe is
    // TTL-cached server-side, so a missed tick is cheap to re-issue).
    const id = setInterval(refreshRemoteSync, changesOpen ? 60000 : 120000);
    return () => clearInterval(id);
  }, [savingIsManaged, gitStatus?.repo, changesOpen, refreshRemoteSync]);
  const {
    assembleVideo, clearSelected, closeTab, createBoard, createVideo, deleteBoard, deleteFileReq,
    deleteFolderReq, duplicateCanvasReq, moveCanvasReq, newFolderReq, openLinkedFile, openSystem,
    openTab, refreshTree, reloadActive, renameCanvasReq, renameFolderReq, replaceMediaViaPicker,
    retryCanvasLoad, shareLinksFor, sharePath, shareShell, showShare, treeRefreshing
  } = useTabs({
    groups, treeLoaded, addressMode, previousAddressPath, project, tabs, setTabs, activePath,
    setActivePath, previewPath, setPreviewPath, onPreview, setSelected, cloudLinkedHub,
    localProjectName, systemData, setLoadingPath, setCanvasError, setCanvasReloadNonce,
    setLoadedPath, cfg, loadServerConfig, setFocusedCommentId, updateTreeExp, setShareDialog,
    setTimelineOpen, timelineArtboardId, iframesRef, pushTlUndo, askText, loadTree, loadSystemData,
    canvasListChangeRef, wsSend
  });

  // ----- Push comments to iframe whenever they change for active file -----
  // Presentation Mode hides comment pins: post an empty list while present
  // (re-posting the real list on exit, since this effect re-runs on the flag).
  useEffect(() => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    const el = iframesRef.current.get(activePath);
    if (!el || !el.contentWindow) return;
    const list = presentMode ? [] : commentsByFile[activePath] || [];
    try {
      el.contentWindow.postMessage({ dgn: 'comments-set', comments: list }, '*');
    } catch {}
  }, [activePath, commentsByFile, presentMode]);
  const {
    applyOptimisticStyle, assetPickerReq, clearActiveCanvasSelection, deleteComment,
    detachInstanceShell, duplicateArtboardShell, insertGeneratedImage, onAssetPicked,
    onInsertArtboard, onPickMany, onReplaceMedia, onStickerPicked, recordSourceEdit, reopenComment,
    reorderLayer, resizeArtboardShell, resolveComment, setArtboardHugShell, setArtboardKindShell,
    setArtboardPrintShell, setArtboardStyleShell, setAssetPickerReq, setStickerPickerReq,
    stickerPickerReq
  } = useCanvasBridge({
    activePath, selected, setSelected, selectedRef, lastLocalSelectAtRef, scheduleHaloRestore,
    scheduleArtboardResync, pendingReorderRef, lastLayersTreeRef, settlePendingSelectionRef,
    reorderLayerRef, repositionElementRef, resizeElementRef, layersBusyRef, layersBusyTimerRef,
    layersTree, setLayersTree, setLoadingPath, setCanvasError, setLoadedPath, cfg, viewerMode,
    commentsByFile, focusedCommentId, setFocusedCommentId, theme, setPaletteOpen, setExportDialog,
    setTimelineOpen, setActiveComps, setTimelineFrame, setTimelinePlaying, canvasActiveArtboard,
    setCanvasActiveArtboard, timelineFrameRef, timelineCompIdRef, setInspectorTab, setPhotoSel,
    openRightPanel, toggleRightPanel, maybeAutoOpenInspectorOnSelect, toggleTimeline, minimapVisible,
    zoomCtlVisible, presentMode, setPresentMode, setActiveArtboards, iframesRef, postToActiveCanvas,
    captureFromCanvas, broadcastChrome, wsSend, reloadActive
  });

  // Jump from right-sidebar list to a comment: open file tab if needed, focus pin.
  // The iframe may be freshly mounted; the loaded handler also re-sends focus if focusedCommentId matches.
  const jumpToComment = useCallback(
    (file, id) => {
      if (file && file !== activePath) {
        setTabs((prev) => (prev.find((t) => t.path === file) ? prev : [...prev, { path: file }]));
        setActivePath(file);
      }
      if (id == null) {
        setFocusedCommentId(null);
        return;
      }
      setFocusedCommentId(id);
      // Try sending focus immediately (existing iframe) and again after a short delay (newly opened tab).
      const send = () => {
        const el = iframesRef.current.get(file);
        if (el && el.contentWindow) {
          try {
            el.contentWindow.postMessage({ dgn: 'comment-focus', id }, '*');
          } catch {}
        }
      };
      send();
      setTimeout(send, 200);
    },
    [activePath]
  );
  const { onShellContextMenu, registerIframe, totalOpen } = useKeyboardShortcuts({
    activePath, selected, viewerMode, commentsByFile, focusedCommentId, setFocusedCommentId,
    sidebarOpen, setShowHidden, setHelpOpen, setShortcutsOpen, setPaletteOpen, setExportDialog,
    setSettingsOpen, inspectorTab, openPanelExclusive, togglePanel, toggleRightPanel, toggleTimeline,
    presentMode, iframesRef, postToActiveCanvas, performPhotoUndo, tlKeyRef, exitPresent, openSystem,
    closeTab, reloadActive, refreshTree, clearActiveCanvasSelection
  });
  const {
    activeCanvasFile, activeOpenComments, dockLabels, leftActive, leftHostsAssistant, leftIds,
    paletteActions, renderPanelBody, resizingFor, rightActive, rightHostsAssistant, rightIds
  } = usePaletteAndPanels({
    groups, treeLoaded, treeLoadFailures, project, activePath, previewPath, onPreview, selected,
    editScope, layersBusyRef, layersTree, componentMap, wsConnected, syncStatus, cloudLinkedHub,
    setCloudLinkedHub, localProjectName, setLocalProjectName, gitStatus, remoteSync, changesOpen,
    setChangesOpen, syncPanelOpen, setSyncPanelOpen, setDiffTarget, search, setSearch, systemData,
    dragSide, cfg, cellManaged, cloudManaged, savingIsManaged, viewerMode, commentsByFile,
    focusedCommentId, commentsPanelOpen, commentsFilter, setCommentsFilter, cpMode, setCpMode,
    sidebarOpen, showHidden, treeExp, sectionsExpanded, setHelpOpen, setReportBugOpen,
    setShortcutsOpen, setExportDialog, setSettingsOpen, setGenerateOpen, inspectorOpen,
    setInspectorOpen, layersOpen, setLayersOpen, panelSide, layersMode, assistantOpen, inspectorTab,
    setInspectorTab, photoSel, photoRev, openPanelExclusive, togglePanel, openRightPanel,
    toggleRightPanel, whatsNew, postToActiveCanvas, onPhotoEdit, onPhotoRecordEdit, performPhotoUndo,
    onPhotoRemoveBackground, lockedKeys, toggleLockedKey, toggleSection, treeExpansion, toggleTheme,
    gitCommit, gitDiscard, gitPublish, gitGetLatest, gitLoadLog, cloudHistory, gitLoadCloudLog,
    projectHistoryOn, setProjectHistoryOn, projectHistoryRefresh, loadAcceptedLog,
    restoreProjectVersion, dirtyByPath, openTab, openLinkedFile, sharePath, shareShell,
    shareLinksFor, showShare, openSystem, reloadActive, treeRefreshing, refreshTree, createBoard,
    createVideo, deleteBoard, moveCanvasReq, newFolderReq, deleteFolderReq, renameFolderReq,
    renameCanvasReq, duplicateCanvasReq, deleteFileReq, applyOptimisticStyle, recordSourceEdit,
    reorderLayer, detachInstanceShell, resizeArtboardShell, duplicateArtboardShell,
    setArtboardHugShell, setArtboardStyleShell, setArtboardKindShell, setArtboardPrintShell,
    onReplaceMedia, resolveComment, reopenComment, deleteComment, jumpToComment
  });

  return (
    <div
      className={'maude' + (presentMode ? ' is-present' : '')}
      data-theme={theme}
      onContextMenu={onShellContextMenu}
    >
      {firstRun && <OnboardingWizard />}
      <CloudRoleBanner cloud={cfg.cloud} />
      <UpdateBanner update={updateReady} onDismiss={() => setUpdateReady(null)} />
      <SyncBanner status={syncStatus} />
      {/* First-upgrade consent (Task 2) — global on purpose: a consent that
          only appears if you happen to open the Sync panel is not consent.
          Skipped during first-run onboarding so two flows don't stack. */}
      {!firstRun && <SyncConsentDialog status={syncStatus} cloud={cfg.cloud} />}
      <NotificationHost paused={!!usageNudge || !!tourSteps}
        hiddenGroups={exportCenter.panelOpen ? ['exports'] : []} />
      <WhatsNewToast wn={whatsNew} />
      <ExportToast center={exportCenter} />
      {gitLifecycle && (
        <div role="status" aria-live="polite" className="st-banner st-banner--info">
          <span className="st-banner-dot" aria-hidden="true" />
          <span>Repo state changed — reload to sync?</span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              try {
                window.location.reload();
              } catch {}
            }}
          >
            Reload
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setGitLifecycle(null)}>
            Dismiss
          </button>
        </div>
      )}
      <div className="st-shell">
        <Menubar
          sharePath={sharePath}
          onShare={() => showShare()}
          readOnly={viewerMode}
          // Cloud Phase 27 C2/C4 — the ONE cloud-only input the shared chrome
          // takes. A prop, not the whole `cfg`: the Menubar needs to know it is
          // in a browser tab on somebody else's machine, and nothing else.
          cloud={cfg.cloud}
          activePath={activePath}
          project={project}
          tabsCount={tabs.length}
          openMenu={openMenu}
          setOpenMenu={setOpenMenu}
          commentsPanelOpen={commentsPanelOpen}
          onToggleComments={() => toggleRightPanel('comments')}
          changesOpen={changesOpen}
          changesCount={unsavedCount}
          onToggleChanges={() => toggleRightPanel('changes')}
          onOpenSystem={openSystem}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => togglePanel('tree')}
          showHidden={showHidden}
          onToggleShowHidden={() => setShowHidden((v) => !v)}
          onOpenHelp={() => setHelpOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onReportBug={() => setReportBugOpen(true)}
          onStartTour={() => startTour(USAGE_TOUR)}
          onStartCollabTour={() => startTour(COLLAB_TOUR)}
          annotationsVisible={annotationsVisible}
          onToggleAnnotations={toggleAnnotations}
          minimapVisible={minimapVisible}
          onToggleMinimap={toggleMinimap}
          zoomCtlVisible={zoomCtlVisible}
          onToggleZoomCtl={toggleZoomCtl}
          presentMode={presentMode}
          onTogglePresent={togglePresent}
          printGuidesVisible={printGuidesVisible}
          onTogglePrintGuides={togglePrintGuides}
          postToActiveCanvas={postToActiveCanvas}
          onOpenReadiness={() => setReadinessOpen(true)}
          onOpenQuickSetup={() => setQuickSetupOpen(true)}
          onWatchIntro={() => setIntroOpen(true)}
          onOpenWhatsNew={whatsNew.openPanel}
          whatsNewCount={whatsNew.unseen.length}
          exportCenter={exportCenter}
          artboardCount={activeArtboards}
          inspectorOpen={inspectorOpen}
          inspectorTab={inspectorTab}
          onToggleInspector={() => toggleRightPanel('inspector')}
          autoOpenInspector={autoOpenInspector}
          onToggleAutoOpenInspector={() => setAutoOpenInspector((v) => !v)}
          onInsertArtboard={onInsertArtboard}
          timelineOpen={timelineOpen}
          onToggleTimeline={toggleTimeline}
          hasComps={activeComps.length > 0}
          assistantOpen={assistantOpen}
          onToggleAssistant={() => toggleRightPanel('assistant')}
          assistantBusy={assistantBusy}
          assistantUnseen={assistantUnseen}
          onOpenLayers={() => {
            // feature-configurable-panel-docking — Layers is its own dockable
            // panel when layersMode==='separate' (toggle it), else it's the
            // Inspector's Layers tab (open the inspector on that tab).
            if (layersMode === 'separate') {
              togglePanel('layers');
            } else if (inspectorOpen && inspectorTab === 'layers') {
              setInspectorOpen(false);
            } else {
              setInspectorTab('layers');
              openPanelExclusive('inspector');
            }
          }}
          onNewCanvas={() => {
            openPanelExclusive('tree');
            setTimeout(
              () => document.querySelector('[aria-label="New blank brief board"]')?.click(),
              60
            );
          }}
          onAssembleVideo={assembleVideo}
          onOpenExport={(mode) => setExportDialog({ mode })}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenGenerate={() => setGenerateOpen(true)}
          onReload={reloadActive}
          onCloseCanvas={() => activePath && closeTab(activePath)}
          presence={
            <>
              <StAvatar
                initials={initialsOf(gitUser || 'you')}
                hue="var(--accent)"
                title={gitUser ? `${gitUser} (you)` : 'You'}
              />
              {agentActive && (
                <StAvatar
                  initials="C"
                  hue="var(--presence-agent)"
                  title="Claude · editing"
                  pulse
                />
              )}
            </>
          }
        />
        <div className={'st-body' + (dragSide ? ' is-resizing' : '')} ref={bodyRef}>
          {/* LEFT dock slot (feature-configurable-panel-docking) — the collapsed
              rail shows when the left slot is empty; the tree's expand hooks open
              it on the tree tab. */}
          <CollapsedRail
            shown={!leftActive}
            onExpand={() => openPanelExclusive('tree')}
            onSearch={() => {
              openPanelExclusive('tree');
              setTimeout(() => document.querySelector('.st-search input')?.focus(), 60);
            }}
          />
          {(leftActive || leftHostsAssistant) && (
            <DockSlot
              side="left"
              width={sbSize.w}
              open={!!leftActive}
              ids={leftIds}
              activeId={leftActive}
              onPick={togglePanel}
              labels={dockLabels}
            >
              {leftHostsAssistant && (
                <ChatPanel
                  hidden={leftActive !== 'assistant'}
                  activeCanvas={activeCanvasFile}
                  selected={selected}
                  openComments={activeOpenComments}
                  designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
                  resizing={resizingFor('assistant')}
                  onClose={() => setAssistantOpen(false)}
                  onBusyChange={setAssistantBusy}
                  onFinished={handleAssistantFinished}
                  onPermissionRequest={handleAssistantAttention}
                  onElicitationRequest={handleAssistantAttention}
                />
              )}
              {leftActive && leftActive !== 'assistant' && renderPanelBody(leftActive)}
            </DockSlot>
          )}
          {leftActive && (
            <PanelGrip
              label="Resize left panel"
              size={sbSize}
              active={dragSide === 'sb'}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                setDragSide('sb');
              }}
            />
          )}
          <div className="main">
            <Viewport
              tabs={tabs}
              activePath={activePath}
              registerIframe={registerIframe}
              systemData={systemData}
              onOpenFromSystem={openTab}
              onSelectDs={loadSystemData}
              project={project}
              cfg={cfg}
              loadingPath={loadingPath}
              onIframeLoad={onIframeLoad}
              canvasError={canvasError}
              canvasReloadNonce={canvasReloadNonce}
              onRetryCanvasLoad={retryCanvasLoad}
              loadedPath={loadedPath}
              showQuickSetup={
                isNativeApp() && !viewerMode && !!setupReadiness && !setupReadiness.ready
              }
              onStartQuickSetup={() => setQuickSetupOpen(true)}
              previewPath={previewPath}
            />
          </div>
          {rightActive && (
            <PanelGrip
              label="Resize right panel"
              dir="rtl"
              size={rpSize}
              active={dragSide === 'rp'}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                setDragSide('rp');
              }}
            />
          )}
          {/* RIGHT dock slot (feature-configurable-panel-docking). The Assistant
              (ACP) chat stays MOUNTED (display:none when inactive) so its stream
              survives a tab switch — DDR-123. Native-only. */}
          {(rightActive || rightHostsAssistant) && (
            <DockSlot
              side="right"
              width={rpSize.w}
              open={!!rightActive}
              ids={rightIds}
              activeId={rightActive}
              onPick={togglePanel}
              labels={dockLabels}
            >
              {rightHostsAssistant && (
                <ChatPanel
                  hidden={rightActive !== 'assistant'}
                  activeCanvas={activeCanvasFile}
                  selected={selected}
                  openComments={activeOpenComments}
                  designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
                  resizing={resizingFor('assistant')}
                  onClose={() => setAssistantOpen(false)}
                  onBusyChange={setAssistantBusy}
                  onFinished={handleAssistantFinished}
                  onPermissionRequest={handleAssistantAttention}
                  onElicitationRequest={handleAssistantAttention}
                />
              )}
              {rightActive && rightActive !== 'assistant' && renderPanelBody(rightActive)}
            </DockSlot>
          )}
        </div>
        {/* DDR-148 — Timeline is a BOTTOM dock (full-width strip below the stage,
            above the status bar) — video timelines are horizontal. */}
        {timelineOpen && (
          <TimelinePanel
            comps={activeComps}
            compId={timelineCompId}
            sequences={timelineSequences}
            audio={timelineAudio}
            transitions={timelineTransitions}
            total={timelineTotal}
            frame={timelineFrame}
            playing={timelinePlaying}
            loop={timelineLoop}
            onSeek={(f) => {
              setTimelineFrame(f);
              setTimelinePlaying(false);
              postToActiveCanvas({ dgn: 'timeline-seek', frame: f, id: timelineCompId });
            }}
            onPlay={() => {
              setTimelinePlaying(true);
              // Sync mute + loop to the Player, then play (the artboard has no
              // chrome — the Timeline owns transport/sound/loop now).
              postToActiveCanvas({ dgn: 'timeline-mute', muted: timelineMuted, id: timelineCompId });
              postToActiveCanvas({ dgn: 'timeline-loop', loop: timelineLoop, id: timelineCompId });
              postToActiveCanvas({ dgn: 'timeline-play', id: timelineCompId });
            }}
            onPause={() => {
              setTimelinePlaying(false);
              postToActiveCanvas({ dgn: 'timeline-pause', id: timelineCompId });
            }}
            onToggleLoop={() =>
              setTimelineLoop((v) => {
                const next = !v;
                postToActiveCanvas({ dgn: 'timeline-loop', loop: next, id: timelineCompId });
                return next;
              })
            }
            muted={timelineMuted}
            onToggleMute={() => {
              setTimelineMuted((v) => {
                const next = !v;
                postToActiveCanvas({ dgn: 'timeline-mute', muted: next, id: timelineCompId });
                return next;
              });
            }}
            volume={timelineVolume}
            onVolume={(v) => {
              setTimelineVolume(v);
              // Dragging volume implies "I want to hear it" — unmute.
              if (v > 0 && timelineMuted) {
                setTimelineMuted(false);
                postToActiveCanvas({ dgn: 'timeline-mute', muted: false, id: timelineCompId });
              }
              postToActiveCanvas({ dgn: 'timeline-volume', volume: v, id: timelineCompId });
            }}
            onRetime={(clipRef, patch) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 P2 / Task 3 — the panel hands a { stableId, index }
              // clipRef; stableId addressing wins (multi-comp-safe), the row
              // index stays as the legacy fallback when the enumerator is
              // unavailable.
              const artboardId = timelineArtboardId || undefined;
              const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(activePath)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
              fetch(ccUrl)
                .then((r) => r.json().catch(() => ({})))
                .then((cc) => {
                  const clip = resolveClipRef(cc, clipRef);
                  const legacyIndex =
                    clipRef && typeof clipRef === 'object' ? clipRef.index : clipRef;
                  const body = clip?.stableId
                    ? {
                        canvas: activePath,
                        artboardId,
                        stableId: clip.stableId,
                        contentHash: clip.contentHash,
                        ...patch,
                      }
                    : { canvas: activePath, index: legacyIndex, ...patch };
                  return fetch('/_api/retime-sequence', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                  });
                })
                .then((r) => r.json())
                .then((j) => {
                  if (!j?.ok) {
                    console.warn('[retime]', j?.error || 'failed');
                    timelineOpFailed('Retime refused', j?.error);
                  } else {
                    shellToast(patch.from != null ? 'Clip moved.' : 'Clip trimmed.', true);
                    if (j?.seq != null)
                      pushTlUndo(activePath, j.seq, patch.from != null ? 'move clip' : 'trim clip');
                  }
                  // The file watcher reloads the canvas → re-announce → the
                  // source-fetch effect re-parses the new timing.
                })
                .catch(() => {});
            }}
            onRemove={timelineRemoveClip}
            onReplace={(clipRef) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 P3 + dogfood #5 — replace a clip's media. The file picker
              // MUST open synchronously inside the click gesture: browsers revoke
              // the transient user-activation after an await/fetch round-trip, so
              // the old fetch-then-click() silently no-oped ("replace neotevře
              // žádné okno"). Picker first; resolve the target + upload in the
              // change handler.
              replaceMediaViaPicker({
                accept: 'video/*,image/*',
                resolveTarget: (cc) => {
                  const clip = resolveClipRef(cc, clipRef);
                  if (clip?.mediaArrayRef) return { arrayRef: clip.mediaArrayRef };
                  if (clip?.mediaCdId) return { cdId: clip.mediaCdId };
                  return null;
                },
              });
            }}
            onReplaceAudio={(index) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 dogfood #5 — audio beds are addressable too: the
              // enumerator lists loose media (an <Audio> under the reel) with a
              // cd-id; ⇄ on the audio row swaps its src.
              replaceMediaViaPicker({
                accept: 'audio/*',
                resolveTarget: (cc) => {
                  const beds =
                    cc?.ok && Array.isArray(cc.media)
                      ? cc.media.filter((m) => m.tag === 'Audio')
                      : [];
                  return beds[index]?.cdId ? { cdId: beds[index].cdId } : null;
                },
              });
            }}
            onReplaceLayer={(clipRef, layerIndex) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 dogfood — replace a SPECIFIC layer inside an expanded clip
              // (the mp4 background separately from the title layer). Targets the
              // layer's own media (array-fed or literal-src) from the enumerator.
              const rowIndex = clipRef && typeof clipRef === 'object' ? clipRef.index : clipRef;
              const kind =
                timelineSequences[rowIndex]?.layers?.[layerIndex]?.kind === 'audio'
                  ? 'audio/*'
                  : timelineSequences[rowIndex]?.layers?.[layerIndex]?.kind === 'image'
                    ? 'image/*'
                    : 'video/*';
              replaceMediaViaPicker({
                accept: kind,
                resolveTarget: (cc) => {
                  const ly = resolveClipRef(cc, clipRef)?.layers?.[layerIndex];
                  if (ly?.mediaArrayRef) return { arrayRef: ly.mediaArrayRef };
                  if (ly?.mediaCdId) return { cdId: ly.mediaCdId };
                  return null;
                },
              });
            }}
            onReorder={(clipRef, direction) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 P5 — z-order reorder: move a standalone <Sequence> before/
              // after a sibling (render stacking; later sibling paints on top).
              // ▲ forward = move AFTER the next sibling; ▼ backward = move BEFORE
              // the previous sibling. Both clips addressed by comp-scoped stableId +
              // fingerprint (via /_api/comp-clips); the engine refuses a TransitionSeries
              // clip + a stale/raced target, then reloads via the file watcher.
              const artboardId = timelineArtboardId || undefined;
              const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(activePath)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
              fetch(ccUrl)
                .then((r) => r.json().catch(() => ({})))
                .then((cc) => {
                  const seqs =
                    cc?.ok && Array.isArray(cc.clips)
                      ? cc.clips.filter((c) => c.kind === 'sequence')
                      : [];
                  const moved = resolveClipRef(cc, clipRef);
                  const index = moved ? seqs.indexOf(moved) : -1;
                  const refIdx = direction === 'forward' ? index + 1 : index - 1;
                  const ref = index >= 0 ? seqs[refIdx] || null : null;
                  const position = direction === 'forward' ? 'after' : 'before';
                  if (!moved?.stableId || !ref?.stableId) return null;
                  return fetch('/_api/reorder-sequence', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      canvas: activePath,
                      artboardId,
                      stableId: moved.stableId,
                      contentHash: moved.contentHash,
                      refStableId: ref.stableId,
                      refContentHash: ref.contentHash,
                      position,
                    }),
                  });
                })
                .then((r) => (r ? r.json() : null))
                .then((j) => {
                  if (j && !j.ok) {
                    console.warn('[reorder-clip]', j.error || 'failed');
                    timelineOpFailed('Reorder refused', j.error);
                  } else if (j?.seq != null) {
                    pushTlUndo(activePath, j.seq, 'reorder clip');
                  }
                })
                .catch(() => {});
            }}
            onToggleHide={(clipRef) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 dogfood — hide/show a clip (gates its body behind
              // {false && …}; the tag + time slot stay). Addressed by comp-scoped
              // stableId + fingerprint.
              const artboardId = timelineArtboardId || undefined;
              const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(activePath)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
              fetch(ccUrl)
                .then((r) => r.json().catch(() => ({})))
                .then((cc) => {
                  const clip = resolveClipRef(cc, clipRef);
                  if (!clip?.stableId) return null;
                  return fetch('/_api/toggle-hide', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      canvas: activePath,
                      artboardId,
                      stableId: clip.stableId,
                      contentHash: clip.contentHash,
                    }),
                  });
                })
                .then((r) => (r ? r.json() : null))
                .then((j) => {
                  if (j && !j.ok) timelineOpFailed('Hide refused', j.error);
                  else if (j && j.ok) {
                    shellToast(j.hidden ? 'Clip hidden.' : 'Clip shown.', true);
                    if (j.seq != null) pushTlUndo(activePath, j.seq, j.hidden ? 'hide clip' : 'show clip');
                  }
                })
                .catch(() => shellToast('Hide failed: network error'));
            }}
            onReorderMove={(movedRef2, targetRef, position) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // Task 6 — the magnetic drag commit: a real series MOVE (any
              // distance), addressed by stableId pair + fingerprints.
              const artboardId = timelineArtboardId || undefined;
              const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(activePath)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
              fetch(ccUrl)
                .then((r) => r.json().catch(() => ({})))
                .then((cc) => {
                  const moved = resolveClipRef(cc, movedRef2);
                  const ref = resolveClipRef(cc, targetRef);
                  if (!moved?.stableId || !ref?.stableId) return null;
                  return fetch('/_api/reorder-sequence', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      canvas: activePath,
                      artboardId,
                      stableId: moved.stableId,
                      contentHash: moved.contentHash,
                      refStableId: ref.stableId,
                      refContentHash: ref.contentHash,
                      position,
                      mode: 'move',
                    }),
                  });
                })
                .then((r) => (r ? r.json() : null))
                .then((j) => {
                  if (j && !j.ok) {
                    console.warn('[reorder-move]', j.error || 'failed');
                    timelineOpFailed('Reorder refused', j.error);
                  } else if (j?.ok) {
                    shellToast('Clip moved.', true);
                    if (j.seq != null) pushTlUndo(activePath, j.seq, 'move clip');
                  }
                })
                .catch(() => shellToast('Reorder failed: network error'));
            }}
            onDropMedia={(files, pos) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // DDR-150 P4 + Task 6 — drop media onto the timeline. With a caret
              // position: index-aware storyline insert / frame-anchored
              // overlay-audio insert; multiple files insert in order. Audio
              // files always land in the audio band. Without a position, the
              // legacy append path.
              const artboardId = timelineArtboardId || undefined;
              const fps = timelineFps;
              const canvas = activePath;
              const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
              (async () => {
                // Dogfood fix — dropping media on the timeline of a canvas with
                // NO video-comp used to dead-end in "Insert refused: no
                // video-comp for this artboard". Drop-first means drop-first:
                // upload the files and spin up a NEW video-comp canvas cut from
                // them (same engine as File → Assemble), then open it.
                if (!activeComps.length) {
                  const clips = [];
                  for (const file of list) {
                    const mediaKind = file.type.startsWith('audio/')
                      ? 'audio'
                      : file.type.startsWith('video/')
                        ? 'video'
                        : null;
                    if (!mediaKind) continue;
                    try {
                      const r = await fetch('/_api/asset', {
                        method: 'POST',
                        headers: { 'Content-Type': file.type || 'application/octet-stream' },
                        body: file,
                      });
                      const up = await r.json().catch(() => ({}));
                      if (up?.path) clips.push({ src: up.path, mediaKind });
                      else shellToast(`Upload failed: ${up?.error || `HTTP ${r.status}`}`);
                    } catch {
                      shellToast('Upload failed: network error');
                    }
                  }
                  if (!clips.length) {
                    shellToast('No video/audio files in the drop — nothing to cut.');
                    return;
                  }
                  // 1) In-place upgrade: a `kind="video"` artboard on THIS
                  // canvas gets a VideoComp injected and takes the clips as
                  // storyline beats (server-side ensure). Falls through to a
                  // fresh "New Cut" canvas only when no artboard opted in.
                  let upgraded = false;
                  for (const c of clips) {
                    const probedSec = await probeMediaDuration(c.src).catch(() => null);
                    const body = {
                      canvas,
                      lane: c.mediaKind === 'audio' && upgraded ? 'audio' : 'storyline',
                      durationInFrames: durationFramesForDrop(fps, probedSec),
                      mediaTag: c.mediaKind === 'audio' ? 'Audio' : 'Video',
                      src: c.src,
                    };
                    if (body.lane === 'audio') body.from = 0;
                    const r = await fetch('/_api/insert-sequence', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(body),
                    }).catch(() => null);
                    const j = r ? await r.json().catch(() => null) : null;
                    if (j?.ok) {
                      upgraded = true;
                      if (j.seq != null) pushTlUndo(canvas, j.seq, 'add clip');
                    } else if (!upgraded) {
                      break; // no eligible artboard — New Cut fallback below
                    } else {
                      timelineOpFailed('Insert refused', j?.error);
                    }
                  }
                  if (upgraded) {
                    shellToast('Artboard upgraded to a video comp — clips added to the storyline.', true);
                    return;
                  }
                  for (let n = 0; n < 8; n += 1) {
                    const name = n === 0 ? 'New Cut' : `New Cut ${n + 1}`;
                    const r = await fetch('/_api/canvas', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name, kind: 'video-comp', clips }),
                    }).catch(() => null);
                    const j = r ? await r.json().catch(() => ({})) : {};
                    if (r?.status === 409) continue; // name taken — try the next
                    if (!r?.ok || !j.ok) {
                      shellToast(`New cut failed: ${j.error || 'create refused'}`);
                      return;
                    }
                    await loadTree();
                    openTab(j.file);
                    shellToast(`Started a new cut from ${clips.length} clip${clips.length > 1 ? 's' : ''}.`, true);
                    return;
                  }
                  shellToast('New cut failed: too many "New Cut" canvases — rename some.');
                  return;
                }
                let slot = pos?.lane === 'storyline' ? pos.index : undefined;
                for (const file of list) {
                  const mediaTag = file.type.startsWith('video/')
                    ? 'Video'
                    : file.type.startsWith('audio/')
                      ? 'Audio'
                      : file.type.startsWith('image/')
                        ? 'Img'
                        : null;
                  if (!mediaTag) continue;
                  let up;
                  try {
                    const r = await fetch('/_api/asset', {
                      method: 'POST',
                      headers: { 'Content-Type': file.type || 'application/octet-stream' },
                      body: file,
                    });
                    up = await r.json().catch(() => ({}));
                  } catch {
                    up = null;
                  }
                  if (!up?.path) {
                    shellToast(`Upload failed: ${up?.error || 'server unreachable — retry in a moment'}`);
                    continue;
                  }
                  const isAudio = mediaTag === 'Audio';
                  // Video clips carry a real duration — probe it so the drop
                  // lands at the clip's own length instead of a fixed 3s that
                  // the user then has to drag out by hand. Images have no
                  // inherent duration, so they keep the fallback.
                  const probedSec =
                    mediaTag === 'Video' ? await probeMediaDuration(up.path).catch(() => null) : null;
                  const body = { canvas, artboardId, mediaTag, src: up.path };
                  if (pos && (isAudio || pos.lane === 'audio')) {
                    body.lane = 'audio';
                    body.from = Math.max(0, pos.frame ?? 0);
                    // Default: stretch toward the end of the cut.
                    body.durationInFrames = Math.max(fps, timelineTotal - body.from);
                  } else if (pos?.lane === 'storyline' && !isAudio) {
                    body.lane = 'storyline';
                    if (slot != null) {
                      body.index = slot;
                      slot += 1; // multiple files insert in order
                    }
                    body.durationInFrames = durationFramesForDrop(fps, probedSec);
                  } else if (pos?.lane === 'overlay' && !isAudio) {
                    if ((timelineSequences || []).length === 0) {
                      // First clip of a greenfield comp = the BASE layer →
                      // storyline, wherever it was dropped.
                      body.lane = 'storyline';
                    } else {
                      body.lane = 'overlay';
                      body.from = Math.max(0, pos.frame ?? 0);
                    }
                    body.durationInFrames = durationFramesForDrop(fps, probedSec);
                  } else if (!isAudio) {
                    // Default container rule: a video/image drop ANYWHERE on the
                    // timeline lands in the storyline (append = hard cut at the
                    // end; the caret gives it an index). The old lane-less
                    // append refused hard-cut series ("no transition to clone").
                    body.lane = 'storyline';
                    body.durationInFrames = durationFramesForDrop(fps, probedSec);
                  } else {
                    // Audio without a caret → audio band, from the start.
                    body.lane = 'audio';
                    body.from = 0;
                    body.durationInFrames = Math.max(fps, timelineTotal);
                  }
                  try {
                    const r = await fetch('/_api/insert-sequence', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(body),
                    });
                    const j = await r.json().catch(() => null);
                    if (j && !j.ok) {
                      console.warn('[insert-clip]', j.error || 'failed');
                      timelineOpFailed('Insert refused', j.error);
                    } else if (j?.ok) {
                      shellToast('Clip added to the timeline.', true);
                      if (j.seq != null) pushTlUndo(canvas, j.seq, 'add clip');
                    }
                  } catch {
                    shellToast('Insert failed: network error');
                  }
                }
              })();
            }}
            height={timelineHeight}
            onResize={setTimelineHeight}
            onClose={() => setTimelineOpen(false)}
            selectedClipId={timelineSelectedClip}
            onSelect={setTimelineSelectedClip}
            transitionClips={timelineTransClips}
            onClipVerb={timelineClipVerb}
            comments={(commentsByFile[activePath] || []).filter((c) => c && c.timeline)}
            promptText={askText}
            onAddComment={timelineAddComment}
            onResolveComment={(id) =>
              wsSend({ type: 'comments-patch', id, patch: { status: 'resolved' } })
            }
            onDeleteComment={(id) => wsSend({ type: 'comments-delete', id })}
            onSplitAtPlayhead={() => {
              const s = tlKeyRef.current;
              let ref = s.selected != null ? { stableId: s.selected } : null;
              if (!ref) {
                const rows = s.sequences || [];
                const under =
                  rows.find(
                    (r2) => r2.series && s.frame >= r2.from && s.frame < r2.from + r2.duration
                  ) || rows.find((r2) => s.frame >= r2.from && s.frame < r2.from + r2.duration);
                if (under?.stableId) ref = { stableId: under.stableId };
              }
              if (ref) timelineClipVerb(ref, 'split', { atFrame: s.frame });
              else shellToast('Nothing under the playhead to split.');
            }}
            onAddTitle={(frame) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // Task 19 — "+ Title": inserts immediately with a default text —
              // edit it via double-click → inspector → Text (the artboard's
              // Player DOM isn't the canvas edit surface, so inline editing
              // happens in the timeline inspector).
              Promise.resolve('Title').then((text) => {
              if (!text) return;
              const fps = timelineFps;
              fetch('/_api/insert-sequence', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  canvas: activePath,
                  artboardId: timelineArtboardId || undefined,
                  lane: 'overlay',
                  from: frame,
                  durationInFrames: Math.round(fps * 3),
                  mediaTag: 'Title',
                  src: text,
                }),
              })
                .then((r) => r.json().catch(() => null))
                .then((j) => {
                  if (j && !j.ok) timelineOpFailed('Title refused', j.error);
                  else if (j?.ok) {
                    shellToast('Title added.', true);
                    if (j.seq != null) pushTlUndo(activePath, j.seq, 'add title');
                  }
                })
                .catch(() => shellToast('Title failed: network error'));
              });
            }}
            onAddAiClip={() => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // Task 22 — "+ AI clip": a prompt-carrying slate beat at the end
              // of the storyline. NO modal (user steer 2026-07-30) — the slate
              // lands with a starter prompt the user rewrites IN PLACE
              // (double-click the slate text in the artboard, or Text tab).
              (async () => {
              const prompt = 'Describe this shot — double-click to edit';
              const kind = 'veo';
              const fps = timelineFps;
              fetch('/_api/insert-sequence', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  canvas: activePath,
                  artboardId: timelineArtboardId || undefined,
                  lane: 'storyline',
                  durationInFrames: Math.round(fps * 5),
                  placeholder: { prompt, kind },
                }),
              })
                .then((r) => r.json().catch(() => null))
                .then((j) => {
                  if (j && !j.ok) timelineOpFailed('AI clip refused', j.error);
                  else if (j?.ok) {
                    shellToast('AI placeholder added — double-click its text to write the prompt, then right-click → Generate ✨.', true);
                    if (j.seq != null) pushTlUndo(activePath, j.seq, 'add AI placeholder');
                  }
                })
                .catch(() => shellToast('AI clip failed: network error'));
              })();
            }}
            onGeneratePlaceholder={(clipRef) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // Task 22 — hand the prompt to the existing generation spine
              // (DDR-164), then poll the job and swap the slate in place. The
              // placeholder stays fully editable while the job runs; the final
              // swap re-resolves by stableId with a FRESH fingerprint.
              const canvas = activePath;
              const artboardId = timelineArtboardId || undefined;
              const ccUrl = `/_api/comp-clips?canvas=${encodeURIComponent(canvas)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
              fetch(ccUrl)
                .then((r) => r.json().catch(() => ({})))
                .then((cc) => {
                  const clip = resolveClipRef(cc, clipRef);
                  const ph = clip?.placeholder;
                  if (!clip?.stableId || !ph?.prompt) {
                    shellToast('No AI placeholder prompt on this clip.');
                    return;
                  }
                  const modality = ph.kind === 'image' ? 'image' : 'video';
                  const prompt =
                    ph.kind === 'motion'
                      ? `Clean, minimal motion-graphics animation (flat shapes, smooth easing): ${ph.prompt}`
                      : ph.prompt;
                  fetch('/_api/generate-jobs', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ provider: 'gemini', modality, prompt }),
                  })
                    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
                    .then((job) => {
                      const jobId = job?.id;
                      if (!jobId) throw new Error('no job id');
                      shellToast(`Generating ${ph.kind}… (runs in the background)`, true);
                      const stableId = clip.stableId;
                      const poll = () => {
                        fetch('/_api/generate-jobs')
                          .then((r) => r.json().catch(() => ({})))
                          .then((d) => {
                            const j2 = (d?.jobs || []).find((x) => x.id === jobId);
                            if (!j2 || j2.status === 'failed') {
                              shellToast(`Generation failed: ${j2?.error || 'job lost'}`);
                              return;
                            }
                            if (j2.status !== 'done') {
                              setTimeout(poll, 4000);
                              return;
                            }
                            const asset = j2.assets?.[0];
                            if (!asset) {
                              shellToast('Generation finished but produced no asset.');
                              return;
                            }
                            // Fresh fingerprint at swap time (the clip may have
                            // been retimed/moved meanwhile — that's fine).
                            fetch(ccUrl)
                              .then((r) => r.json().catch(() => ({})))
                              .then((cc2) => {
                                const live = resolveClipRef(cc2, { stableId });
                                if (!live?.stableId) {
                                  shellToast('Placeholder clip is gone — generated asset kept in assets/.');
                                  return;
                                }
                                timelineClipVerb({ stableId: live.stableId }, 'resolve-placeholder', {
                                  src: asset,
                                  mediaKind: modality === 'image' ? 'image' : 'video',
                                });
                              });
                          })
                          .catch(() => setTimeout(poll, 6000));
                      };
                      setTimeout(poll, 3000);
                    })
                    .catch((e) =>
                      shellToast(`Generate failed: ${e?.message || 'provider error'} — is a Gemini key set in Settings?`)
                    );
                })
                .catch(() => shellToast('Generate failed: network error'));
            }}
            onAddImage={(frame) => {
              if (!activePath || activePath === SYSTEM_TAB) return;
              // Task 19 — "+ Image": picker → content-addressed upload →
              // overlay-lane <Img> at the playhead. WKWebView can't open an
              // HTML file input, so native goes through the Rust pick dialog.
              const uploadPicked = (blob, type) => {
                const fps = timelineFps;
                fetch('/_api/asset', {
                  method: 'POST',
                  headers: { 'Content-Type': type || 'application/octet-stream' },
                  body: blob,
                })
                  .then((r) => r.json().catch(() => ({})))
                  .then((up) => {
                    if (!up?.path) {
                      shellToast(`Upload failed: ${up?.error || 'unknown error'}`);
                      return null;
                    }
                    return fetch('/_api/insert-sequence', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        canvas: activePath,
                        artboardId: timelineArtboardId || undefined,
                        lane: 'overlay',
                        from: frame,
                        durationInFrames: Math.round(fps * 3),
                        mediaTag: 'Img',
                        src: up.path,
                      }),
                    });
                  })
                  .then((r) => (r ? r.json() : null))
                  .then((j) => {
                    if (j && !j.ok) timelineOpFailed('Image refused', j.error);
                    else if (j?.ok) {
                      shellToast('Image overlay added.', true);
                      if (j.seq != null) pushTlUndo(activePath, j.seq, 'add image overlay');
                    }
                  })
                  .catch(() => shellToast('Image failed: network error'));
              };
              if (isNativeApp()) {
                pickMediaFile()
                  .then(async (picked) => {
                    if (picked) uploadPicked(await readPickedMediaBlob(picked), '');
                  })
                  .catch((e2) => shellToast(`Image pick failed: ${e2?.message || 'dialog error'}`));
                return;
              }
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.addEventListener('change', () => {
                const file = input.files?.[0];
                if (file) uploadPicked(file, file.type);
              });
              input.click();
            }}
            resolveMediaUrl={(p) =>
              `/${(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}/${p}`
            }
          />
        )}
        <StatusBar
          activePath={activePath}
          selected={selected}
          wsConnected={wsConnected}
          openCount={totalOpen}
          theme={theme}
          onToggleTheme={toggleTheme}
          onClearSelected={clearSelected}
          syncStatus={syncStatus}
          syncProject={cfg?.cloud?.projectName || project}
          syncOpen={syncPanelOpen}
          // Toggle through the dock helpers so the one-panel-per-side invariant
          // holds (opening Sync closes whatever else the right slot shows).
          onOpenSync={syncStatus ? () => toggleRightPanel('sync') : undefined}
          changesCount={unsavedCount}
          // `unpushed` is a LOCAL-git offer ("N to publish"), and the panel has
          // withdrawn Publish under either managed posture — so the chip must
          // not keep advertising it either.
          unpushed={savingIsManaged ? 0 : gitStatus?.unpushed || 0}
          savingIsManaged={savingIsManaged}
          changesOpen={changesOpen}
          // A REPO IS NOT THE ONLY REASON THIS PANEL HAS SOMETHING TO SHOW.
          // Under managed saving the panel IS the project's history — every
          // accepted action with its author, and Undo on the ones that are
          // yours — and it comes from the hub, not from git. A managed copy on
          // a designer's machine has no `.git`, so gating the chip on a repo
          // left the invited designer with no visible way in at all: the View
          // menu and ⌘⇧G worked, and nothing on screen said so. The chip's own
          // `savingIsManaged` branch below was already written for this case
          // and was simply unreachable here. Found running S20 against a live
          // deployment; asserted in `team-project.e2e.ts` step 4b.
          onOpenChanges={
            gitStatus?.repo || savingIsManaged ? () => openRightPanel('changes') : undefined
          }
          version={cfg?.version}
        />
      </div>
      {presentMode && (
        <button
          type="button"
          className="st-present-exit"
          onClick={exitPresent}
          aria-label="Exit presentation mode"
          title="Exit presentation mode (Esc)"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span>Exit presentation</span>
          <kbd className="st-present-exit-kbd">Esc</kbd>
        </button>
      )}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
      />
      {shellPromptState && (
        <div
          className="st-scrim"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settleShellPrompt(null);
          }}
        >
          <div className="st-dialog st-prompt" role="dialog" aria-modal="true" aria-label={shellPromptState.title}>
            <div className="st-dialog-hd">
              <span className="st-dialog-title">{shellPromptState.title}</span>
            </div>
            <div className="st-dialog-bd">
              <input
                className="st-input"
                data-testid="shell-prompt-input"
                autoFocus
                defaultValue={shellPromptState.value}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') settleShellPrompt(e.currentTarget.value);
                  else if (e.key === 'Escape') settleShellPrompt(null);
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                <button type="button" className="tlci-btn" onClick={() => settleShellPrompt(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="tlci-btn"
                  data-testid="shell-prompt-ok"
                  onClick={(e) =>
                    settleShellPrompt(
                      e.currentTarget.closest('.st-dialog')?.querySelector('input')?.value ?? ''
                    )
                  }
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {shareDialog && <ShareDialog target={shareDialog} links={shareLinksFor(shareDialog.path)} shell={shareShell} onClose={() => setShareDialog(null)} Icon={StIcon} />}
      {exportDialog && (
        <ExportDialog
          mode={exportDialog.mode}
          initialScope={exportDialog.scope}
          activePath={activePath}
          hasComps={activeComps.length > 0}
          comps={activeComps}
          // Which artboard "Active artboard" scope targets. The shell can't query
          // the cross-origin canvas DOM (the in-canvas dialog's activeArtboardId),
          // so use the tracked signals: an explicit selection wins, else the
          // viewport-active artboard canvas-lib reports on pan. Without this,
          // scope=artboard fell back to `:first-of-type` (always the first).
          activeArtboardId={selected?.artboardId ?? canvasActiveArtboard ?? null}
          selection={selected?.selector ? { selector: selected.selector, file: selected.file } : null}
          exportLane={cfg.exportLane || 'local'}
          onBrowserCapture={captureFromCanvas}
          onQuerySelection={querySelectionFromCanvas}
          onClose={() => setExportDialog(null)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          cloud={cfg.cloud}
          onClose={() => setSettingsOpen(false)}
          initialTab={typeof settingsOpen === 'string' ? settingsOpen : undefined}
          theme={theme}
          onSetTheme={setTheme}
          cpMode={cpMode}
          onSetCpMode={setCpMode}
          minimapVisible={minimapVisible}
          onToggleMinimap={toggleMinimap}
          zoomCtlVisible={zoomCtlVisible}
          onToggleZoomCtl={toggleZoomCtl}
          annotationsVisible={annotationsVisible}
          onToggleAnnotations={toggleAnnotations}
          autoOpenInspector={autoOpenInspector}
          onToggleAutoOpenInspector={() => setAutoOpenInspector((v) => !v)}
          hasCanvas={!!activePath && activePath !== SYSTEM_TAB}
          panelSide={panelSide}
          onSetPanelSide={(id, side) => setPanelSide((prev) => ({ ...prev, [id]: side }))}
          layersMode={layersMode}
          onSetLayersMode={(m) => {
            setLayersMode(m);
            // Leaving separate mode retires the standalone Layers panel.
            if (m !== 'separate') setLayersOpen(false);
          }}
        />
      )}
      {generateOpen && (
        <GenerateDialog onClose={() => setGenerateOpen(false)} onInsert={insertGeneratedImage} />
      )}
      {assetPickerReq && (
        <AssetPicker
          designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
          onPick={onAssetPicked}
          onClose={() => setAssetPickerReq(null)}
          multiple={!!assetPickerReq.multiple}
          hasArtboardAnchor={!!assetPickerReq.hasArtboardAnchor}
          onPickMany={onPickMany}
        />
      )}
      {stickerPickerReq && (
        <StickerPicker onPick={onStickerPicked} onClose={() => setStickerPickerReq(null)} />
      )}
      {diffTarget && (
        <DiffView
          target={diffTarget}
          cfg={cfg}
          loadLog={loadDiffLog}
          onClose={() => setDiffTarget(null)}
          onRestore={async (file, version) => {
            const res = acceptedDiff
              ? await restoreProjectVersion(file, /^r\d+$/.test(version || '') ? Number(version.slice(1)) : NaN)
              : await gitDiscard([file]);
            if (res?.ok) setDiffTarget(null);
            else window.alert(res?.error || 'Could not restore that version. Try again.');
          }}
          onResolve={async (choice) => {
            // phase-28 (E3): apply the chosen side via /_api/git/resolve, which
            // completes the two-parent merge commit (and for "both" saves our
            // version as a "(mine)" copy — zero loss). Close on success; keep the
            // resolver open with the error otherwise.
            const res = await gitResolveConflict(choice);
            if (res.ok) {
              setDiffTarget(null);
            } else {
              window.alert(res.error || 'Could not finish the merge. Get the latest again, then retry.');
            }
          }}
        />
      )}
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onStartTour={() => {
          setHelpOpen(false);
          startTour(USAGE_TOUR);
        }}
      />
      {/* `activeCanvas` is THIS window's truth. The server's `_active.json` is
          global and sticky — it survives closing every tab and is written by any
          other session (an agent driving a headless browser, a second window),
          so a report built from it can claim a canvas the user does not have
          open, and capture it. Pass what this client actually shows. */}
      <ReportBugDialog
        open={reportBugOpen}
        activeCanvas={activePath}
        onClose={() => setReportBugOpen(false)}
      />
      <WhatsNewPanel wn={whatsNew} onStartTour={startTour} />
      <ExportPanel center={exportCenter} />
      <ReadinessDialog open={readinessOpen} onClose={() => setReadinessOpen(false)} />
      <IntroVideoDialog open={introOpen} onClose={() => setIntroOpen(false)} />
      <SetupChecklistDialog
        open={quickSetupOpen}
        onClose={() => setQuickSetupOpen(false)}
        onStartTour={() => startTour(QUICK_SETUP_TOUR)}
        onBringBrand={() => setBrandUploadOpen(true)}
        onImportFigma={() => setFigmaImportOpen(true)}
      />
      <BrandUploadPanel open={brandUploadOpen} onClose={() => setBrandUploadOpen(false)} />
      {figmaImportOpen && (
        <FigmaImportPanel
          onClose={() => setFigmaImportOpen(false)}
          onImported={() => loadTree()}
        />
      )}
      {usageNudge && !tourSteps && !collabNudge && (
        <div className="mdcc-tour-nudge" role="status" aria-live="polite">
          <div className="mdcc-tour-nudge__body">
            New here? Take a 60-second tour of the canvas browser.
          </div>
          <button
            type="button"
            className="mdcc-tour-nudge__cta"
            onClick={() => {
              markUsageSeen();
              startTour(USAGE_TOUR);
            }}
          >
            Start
          </button>
          <button
            type="button"
            className="mdcc-tour-nudge__skip"
            aria-label="Dismiss"
            onClick={markUsageSeen}
          >
            ×
          </button>
        </div>
      )}
      {/* Phase 29 (E4) — the collab "rychlý kurz", offered once after onboarding. */}
      {collabNudge && !tourSteps && (
        <div className="mdcc-tour-nudge" role="status" aria-live="polite">
          <div className="mdcc-tour-nudge__body">
            New to working with a team? See how saving &amp; sharing works — 60 seconds.
          </div>
          <button
            type="button"
            className="mdcc-tour-nudge__cta"
            onClick={() => {
              markCollabSeen();
              startTour(COLLAB_TOUR);
            }}
          >
            Start
          </button>
          <button
            type="button"
            className="mdcc-tour-nudge__skip"
            aria-label="Dismiss"
            onClick={markCollabSeen}
          >
            ×
          </button>
        </div>
      )}
      <TourOverlay
        steps={tourSteps ?? []}
        open={!!tourSteps}
        onClose={() => setTourSteps(null)}
        onComplete={markUsageSeen}
        bus={tourBus}
        hasSelection={!!selected}
        hasCanvas={tabs.length > 0}
      />
    </div>
  );
}

// DDR-247 — `?embed=1` is a different root, not a mode of <App>: nothing the
// shell does (prefs, address bar, panels) runs inside another app's frame.
createRoot(document.getElementById('root')).render(isEmbedLocation(location) ? <EmbedView /> : <App />);
