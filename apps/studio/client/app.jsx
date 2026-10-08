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
import { useShellCore } from './hooks/use-shell-core.jsx';

// ---------- App ----------

function App() {
  const {
    activeArtboards, activeComps, activePath, addressMode, agentActive, agentIdleRef,
    annotationsVisible, assistantBusy, assistantOpen, assistantUnseen, autoOpenInspector, bodyRef,
    brandUploadOpen, canvasActiveArtboard, canvasError, canvasReloadNonce, captureFromCanvas,
    cellManaged, cfg, changesOpen, cloudLinkedHub, cloudManaged, collabNudge, commentsByFile,
    commentsFilter, commentsPanelOpen, componentMap, cpMode, diffTarget, dragSide, editScope,
    exportCenter, exportDialog, figmaImportOpen, firstRun, focusedCommentId, generateOpen,
    gitLifecycle, gitStatus, gitUser, groups, handleAssistantAttention, handleAssistantFinished,
    helpOpen, iframesRef, inspectorOpen, inspectorTab, introOpen, lastLayersTreeRef,
    lastLocalSelectAtRef, layersBusyRef, layersBusyTimerRef, layersMode, layersOpen, layersTree,
    loadServerConfig, loadedPath, loadingPath, localProjectName, markCollabSeen, markUsageSeen,
    maybeAutoOpenInspectorOnSelect, minimapVisible, onIframeLoad, onPreview, openMenu,
    openPanelExclusive, openRightPanel, paletteOpen, panelSide, pendingReorderRef, photoRev,
    photoSel, photoUndoRef, postToActiveCanvas, presentMode, previewPath, previousAddressPath,
    printGuidesVisible, project, quickSetupOpen, readinessOpen, remoteSync, reorderLayerRef,
    reportBugOpen, repositionElementRef, resizeElementRef, rpSize, savingIsManaged,
    savingIsManagedRef, sbSize, scheduleArtboardResync, scheduleHaloRestore, search,
    sectionsExpanded, selected, selectedRef, setActiveArtboards, setActiveComps, setActivePath,
    setAgentActive, setAnnotationsVisible, setAssistantBusy, setAssistantOpen, setAutoOpenInspector,
    setBrandUploadOpen, setCanvasActiveArtboard, setCanvasError, setCanvasReloadNonce, setCfg,
    setChangesOpen, setCloudLinkedHub, setCommentsByFile, setCommentsFilter, setCpMode,
    setDiffTarget, setDragSide, setExportDialog, setFigmaImportOpen, setFocusedCommentId,
    setGenerateOpen, setGitLifecycle, setGitStatus, setGitUser, setGroups, setHelpOpen,
    setInspectorOpen, setInspectorTab, setIntroOpen, setLayersMode, setLayersOpen, setLayersTree,
    setLoadedPath, setLoadingPath, setLocalProjectName, setMinimapVisible, setOpenMenu,
    setPaletteOpen, setPanelSide, setPhotoRev, setPhotoSel, setPresentMode, setPreviewPath,
    setPrintGuidesVisible, setProject, setQuickSetupOpen, setReadinessOpen, setRemoteSync,
    setReportBugOpen, setSearch, setSelected, setSettingsOpen, setShareDialog, setShortcutsOpen,
    setShowHidden, setSyncPanelOpen, setSyncStatus, setSystemData, setTabs, setTheme,
    setTimelineArtboardId, setTimelineAudio, setTimelineFrame, setTimelineHeight, setTimelineLoop,
    setTimelineMuted, setTimelineOpen, setTimelinePlaying, setTimelineSelectedClip,
    setTimelineSequences, setTimelineTotal, setTimelineTransitions, setTimelineVolume, setTourSteps,
    setTreeLoadFailures, setTreeLoaded, setUiPrefsHydrated, setUpdateReady, setWsConnected,
    setZoomCtlVisible, settingsOpen, settlePendingSelectionRef, setupReadiness, shareDialog,
    shortcutsOpen, showHidden, sidebarOpen, startTour, syncPanelOpen, syncStatus, systemData, tabs,
    theme, timelineArtboardId, timelineArtboardIdRef, timelineAudio, timelineCompId,
    timelineCompIdRef, timelineFps, timelineFrame, timelineFrameRef, timelineHeight, timelineLoop,
    timelineMuted, timelineOpFailed, timelineOpen, timelinePlaying, timelineRefresh,
    timelineSelectedClip, timelineSequences, timelineTotal, timelineTransitions, timelineVolume,
    togglePanel, toggleRightPanel, toggleTimeline, tourBus, tourSteps, treeExp, treeLoadFailures,
    treeLoaded, uiPrefsHydrated, unsavedCount, updateReady, updateTreeExp, usageNudge, viewerMode,
    whatsNew, wsConnected, wsRef, zoomCtlVisible
  } = useShellCore({});

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
