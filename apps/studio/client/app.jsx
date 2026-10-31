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
import { applyUiOpen, OPEN_LADDER_MS } from './ui-open.js';
import { dsGoToPlan, dsGoToPosts } from './v2/ds/go-to.js';
import { DsReviewHost } from './v2/ds/review-host.jsx';
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
import SyncConsentDialog from './panels/SyncConsentDialog.jsx';
import CloudBar from './panels/CloudBar.jsx';
import { buildShareLinks, normalizeOpenPath, readOpenParam, withOpenParam } from './share-link.js';
import { isEmbedLocation } from './embed.js';
import { HomeApp } from './home/home-app.jsx';
import { bootShellMode } from './home/shell-mode.js';
import EmbedView from './embed-view.jsx';
import { ShareSheet } from './v2/share/share-sheet.jsx';
import IdentityBar from './panels/IdentityBar.jsx';
import { ReadinessDialog } from './panels/ReadinessList.jsx';
import IntroVideoDialog from './panels/IntroVideoDialog.jsx';
import BrandUploadPanel from './panels/BrandUploadPanel.jsx';
import FigmaImportPanel from './panels/FigmaImportPanel.jsx';
import { FilePreview, prefetchPreviewImage, sanitizeDisplayText } from './panels/file-preview.jsx';
import SetupChecklistDialog, { useSetupReadiness } from './panels/SetupChecklist.jsx';
import TimelinePanel from './v2/timeline/Timeline.jsx';
import TimelineHost from './v2/timeline/TimelineHost.jsx';
import { CommentStripHost } from './v2/timeline/comment-strip-host.jsx';
import { timelineSelection } from './v2/timeline/selection.js';
import { useTimelineKept } from './v2/timeline/timeline-store.js';
import TranscriptHost from './v2/transcript/TranscriptHost.jsx';
import { parseCompTimeline } from './panels/timeline-parse.js';
import {
  activeComp,
  resolveCompTarget,
  sanitizeArtboardText,
} from './panels/timeline-comp-target.js';
import { durationFramesForDrop, probeMediaDuration } from './panels/timeline-media-cache.js';
import GenerateDialog from './generate-dialog.jsx';
import { migrateAtBoot } from './v2/settings/prefs-migrate.js';
import SettingsSheet from './v2/settings/settings-sheet.jsx';
import StickersGallery from './v2/annotations/stickers-gallery.jsx';
import TemplatesPanel from './v2/annotations/templates-panel.jsx';
import VoteHost from './v2/annotations/vote-bar.jsx';
import ComponentPicker from './v2/inspector/component-picker.jsx';
import SizePickerHost from './v2/kinds/SizePickerHost.jsx';
import { canvasTargetOrigin } from './v2/kinds/kind-dim-relay.js';
import { getPaletteEnv } from './v2/search/search-env.js';
import {
  AlignPad,
  AngleDial,
  ColorField,
  IconButtonGroup,
  IconToggleGroup,
  makeScrubHandler,
  NumberField,
  RadiusControl,
  Segmented,
  Select,
  SliderField,
  Toggle,
  UnitSelect,
  ValueTokenField,
} from './inspector-controls.jsx';
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
  cloudSignInPrepare,
  invoke,
  isNativeApp,
  onMenuAction,
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
import { ExportPanel, ExportToast, useExportCenter } from './export-center.jsx';
import { ReportBugDialog } from './report-bug.jsx';
import { QuitDialog } from './v2/ai/QuitDialog.jsx';
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
import {
  ANNOT_STORE,
  ATTENTION_NOTIFY_COOLDOWN_MS,
  CANVAS_EXT_RE,
  COLLAB_TOUR_STORE,
  CP_MODE_STORE,
  EMPTY_GROUPS,
  LAYERS_MODE_STORE,
  MDCC_VERSION,
  MINIMAP_STORE,
  MODE_HINT_SEEN,
  PANEL_SIDES_STORE,
  SHOW_HIDDEN_STORE,
  SIDEBAR_STORE,
  SYSTEM_TAB,
  THEME_STORE,
  USAGE_TOUR_STORE,
  ZOOMCTL_STORE,
  isModuleCanvasPath,
} from './shell/constants.js';
import {
  basename,
  browseFirstRunHint,
  buildTree,
  displayName,
  filterTree,
  groupBySidecar,
  layersTreeSig,
  notifyDesktop,
  openCount,
  pathTestIdSlug,
  persistUiPrefs,
  previewKind,
  readBoolStore,
  readInitialTheme,
  readJsonStore,
  sectionDefaultOpen,
  shellToast,
  timeAgo,
  totalCounts,
} from './shell/util.js';
import { Icon, Kbd, Lu, StIcon } from './shell/icons.jsx';
import {
  DOCK_PANELS,
  DockSlot,
  PANEL_SIDES_DEFAULTS,
  PanelGrip,
  usePanelSize,
} from './shell/dock.jsx';
import { CommandPalette } from './dialogs/command-palette.jsx';
import { AssetPicker } from './dialogs/asset-picker.jsx';
import { importsWaitHereFrom } from './v2/assets/import-offline.js';
import { useLastFinishedAt } from './v2/export/last-finished.js';
import { ExportDialog, downloadCapturedBlob } from './dialogs/export-dialog.jsx';
import { Sidebar } from './tree/tree.jsx';
import { CornerIcons } from './v2/shell/corner-icons.jsx';
import ShellErrorBoundary from './v2/shell/shell-error-boundary.jsx';
import { cutCopyPaste, createMenuHandlers, menuRunner } from './v2/shell/menu-runner.js';
import DiagnosticsHost from './v2/diagnostics/diagnostics-host.jsx';
import { useDiagnosticsMenu } from './v2/diagnostics/use-diagnostics-menu.js';
import { menuCtx, moveDestinations } from './v2/shell/project-menu-model.js';
import { useProjectSwitcher } from './panels/RepoBranchSwitcher.jsx';
import { ProjectPill } from './v2/shell/project-pill.jsx';
import { AskSelectionHost } from './v2/ai/AskSelectionHost.jsx';
import { EmptyHost } from './v2/empty/empty-host.jsx';
import { IntentHost } from './v2/create/intent-host.jsx';
import { useOnline } from './v2/empty/use-empty-canvas.js';
import { ShellShareCluster } from './v2/shell/share-cluster-host.jsx';
import { ShellUndoHistory } from './v2/undo/undo-history.jsx';
import { undoProjection } from './v2/undo/use-undo-projection.jsx';
import { ShellInspectPanel } from './v2/inspect/inspect-host.jsx';
import { ShellPreviewChrome, usePreviewMode } from './v2/preview/preview-chrome-host.jsx';
import { ShellTakes } from './v2/assets/takes-overlay.jsx';
import { ViewBarHost } from './v2/history/history-host.jsx';
import { SyncStatesHost } from './v2/sync-states/conflict-card.jsx';
import { useQueuedMarkedByFile } from './v2/sync-states/row-words.js';
import { panelOpenDecision, rightMainWidth, rightPanelWidth } from './v2/shell/panel-layout.js';
import { aiSlotWidth, gripTarget, usePanelSizes } from './v2/shell/panel-sizes.js';
import { panelLayout, useHydratePanelLayout, usePanelLayout } from './v2/shell/use-panel-layout.js';
import { useFitOnAiPin } from './v2/shell/use-fit-on-ai-pin.js';
import { useFitWhileAiDrafts } from './v2/shell/use-fit-while-ai-drafts.js';
import { useAiRuns } from './v2/ai/runs-store.js';
import { yoursCount } from './v2/ai/runs-model.js';
import { useOccludedInsets } from './v2/shell/use-occluded-insets.js';
import { useShellPanelsRelay } from './v2/shell/shell-panels-relay.js';
import { useToolPanels } from './v2/shell/use-tool-panels.js';
import { useAssetStateLane } from './v2/assets/asset-state-lane.js';
import { useRelinkSheet } from './v2/assets/missing-frame.jsx';
import { HelpModal } from './dialogs/help-modal.jsx';
import { ShortcutsOverlay } from './dialogs/shortcuts-overlay.jsx';
import { SystemView } from './system/system-view.jsx';
import { Viewport } from './shell/viewport.jsx';
import { CommentsPanel } from './shell/comments-panel.jsx';
import { ShellCallouts } from './v2/shell/callouts-host.jsx';
import { noteSaveHold } from './v2/shell/save-hold-notice.js';
import { ShellMentionCallouts, useCommentsShell } from './v2/comments/use-comments-shell.jsx';
import { commentFocusMessage, wantReplyFocus } from './v2/comments/reply-focus.js';
import { noteMadeByAi } from './v2/ai/made-by-ai.js';
import { getRunsStore, noteAiRuns } from './v2/ai/runs-store.js';
import { OPEN_AI_EVENT } from './v2/ai/needs-you-toast.js';
import { OPEN_ASSETS_EVENT } from './v2/ai/AttachMenu.jsx';
import { TRASH_CHANGED_EVENT } from './v2/left-panel/use-trash.js';
import { ACCESS_FRAME_EVENT, observerOn, sessionRole } from './v2/access/access-client.js';
import { isFollowLocation } from './v2/present/follow-location.js';
import FollowView from './v2/present/follow-view.jsx';
import { OrderNotesMount } from './v2/present/order-notes-mount.jsx';
import { ShellPresentChrome } from './v2/present/present-chrome-host.jsx';
import { PresenterViewHost } from './v2/present/presenter-host.jsx';
import {
  CSS_ALIGN_SELF,
  CSS_ASPECT_RATIO,
  CSS_BLEND_MODES,
  CSS_BORDER_STYLES,
  CSS_DISPLAYS,
  CSS_FONTS,
  CSS_FONT_STYLE,
  CSS_OBJECT_FIT,
  CSS_POSITION,
  CSS_TEXT_TRANSFORM,
  CSS_UNITLESS,
  CSS_UNITS,
  CSS_WEIGHTS,
  CSS_WHITE_SPACE,
  GRID_TRACK_UNITS,
  PROP_LEAD,
  SCREEN_PRESETS,
  replacedValue,
} from './inspector/css-vocab.jsx';
import {
  clamp01,
  cssColorToHex,
  cssHint,
  cssSplitUnit,
  hexToRgb,
  hsvToRgb,
  rgbToHex,
  rgbToHsv,
} from './inspector/color.js';
import { mergeSelClientFields } from './inspector/selection.js';
import { activeDsNameFor, useAllDsTokens } from './inspector/ds-tokens.js';
import { ColorPicker } from './inspector/color-picker.jsx';
import { TokenPopover } from './inspector/token-popover.jsx';
import { GridTracksEditor } from './inspector/grid-tracks-editor.jsx';
import { CssKnobs, afterRecordableWrites, trackRecordableWrite } from './inspector/css-knobs.jsx';
import { LAYER_VOID_TAGS, LayerRow, moveLayerNode } from './inspector/layers.jsx';
import { InspectComputed } from './inspector/inspect-computed.jsx';
import { InspectorPanel, PHOTO_ASSET_RE } from './inspector/inspector-panel.jsx';
import { usePaletteAndPanels } from './hooks/use-palette-and-panels.jsx';
import { useActionKeys } from './hooks/use-action-keys.jsx';
import { useCanvasBridge } from './hooks/use-canvas-bridge.jsx';
import { postDsThemePreview, useDsFrames } from './v2/ds/use-ds-frames.js';
import { useTabs } from './hooks/use-tabs.jsx';
import { useGitActions } from './hooks/use-git-actions.jsx';
import { useWebSocket } from './hooks/use-web-socket.jsx';
import { useProjectData } from './hooks/use-project-data.jsx';
import { usePhotoAndTimeline } from './hooks/use-photo-and-timeline.jsx';
import { useShellCore } from './hooks/use-shell-core.jsx';
import { exportSelectionFor, exportSelectionV2, isOwnSelectEcho } from './selection-scope.js';
import { ShellStoreContext, useShellStore } from './stores/shell-store.jsx';

// ---------- App ----------

function ShellState({ children }) {
  const {
    activeArtboards,
    activeComps,
    activePath,
    addressMode,
    agentActive,
    agentIdleRef,
    annotationsVisible,
    assistantBusy,
    assistantOpen,
    assistantUnseen,
    autoOpenInspector,
    bodyRef,
    brandUploadOpen,
    canvasActiveArtboard,
    canvasError,
    canvasReloadNonce,
    captureFromCanvas,
    cellManaged,
    cfg,
    changesOpen,
    cloudLinkedHub,
    cloudManaged,
    collabNudge,
    commentsByFile,
    commentsFilter,
    commentsPanelOpen,
    componentMap,
    cpMode,
    diffTarget,
    dragSide,
    editScope,
    exportCenter,
    exportDialog,
    figmaImportOpen,
    focusedCommentId,
    generateOpen,
    gitLifecycle,
    gitStatus,
    gitUser,
    groups,
    handleAssistantAttention,
    handleAssistantFinished,
    helpOpen,
    iframesRef,
    inspectorOpen,
    inspectorTab,
    introOpen,
    lastLayersTreeRef,
    lastLocalSelectRef,
    layersBusyRef,
    layersBusyTimerRef,
    layersMode,
    layersOpen,
    assetsOpen,
    layersTree,
    loadServerConfig,
    loadedPath,
    loadingPath,
    localProjectName,
    markCollabSeen,
    markUsageSeen,
    maybeAutoOpenInspectorOnSelect,
    minimapVisible,
    onIframeLoad,
    onPreview,
    openMenu,
    openPanelExclusive,
    openRightPanel,
    paletteOpen,
    panelSide,
    pendingReorderRef,
    photoRev,
    photoSel,
    photoUndoRef,
    postToActiveCanvas,
    presentMode,
    previewPath,
    previousAddressPath,
    printGuidesVisible,
    project,
    quickSetupOpen,
    readinessOpen,
    remoteSync,
    reorderLayerRef,
    reportBugOpen,
    repositionElementRef,
    resizeElementRef,
    rpSize,
    savingIsManaged,
    savingIsManagedRef,
    sbSize,
    scheduleArtboardResync,
    scheduleHaloRestore,
    search,
    sectionsExpanded,
    selected,
    selectedRef,
    setActiveArtboards,
    setActiveComps,
    setActivePath,
    setAgentActive,
    setAnnotationsVisible,
    setAssistantBusy,
    setAssistantOpen,
    setAutoOpenInspector,
    setBrandUploadOpen,
    setCanvasActiveArtboard,
    setCanvasError,
    setCanvasReloadNonce,
    setCfg,
    setChangesOpen,
    setCloudLinkedHub,
    setCommentsByFile,
    setCommentsFilter,
    setCpMode,
    setDiffTarget,
    setDragSide,
    setExportDialog,
    setFigmaImportOpen,
    setFocusedCommentId,
    setGenerateOpen,
    setGitLifecycle,
    setGitStatus,
    setGitUser,
    setGroups,
    setHelpOpen,
    setInspectorOpen,
    setInspectorTab,
    setIntroOpen,
    setLayersMode,
    setLayersOpen,
    setLayersTree,
    setLoadedPath,
    setLoadingPath,
    setLocalProjectName,
    setMinimapVisible,
    setOpenMenu,
    setPaletteOpen,
    setPanelSide,
    setPhotoRev,
    setPhotoSel,
    setPresentMode,
    setPreviewPath,
    setPrintGuidesVisible,
    setProject,
    setQuickSetupOpen,
    setReadinessOpen,
    setRemoteSync,
    setReportBugOpen,
    setSearch,
    setSelected,
    setSettingsOpen,
    setShareDialog,
    setShortcutsOpen,
    setShowHidden,
    setSyncPanelOpen,
    setSyncStatus,
    setSystemData,
    setTabs,
    setTheme,
    setTimelineArtboardId,
    setTimelineAudio,
    setTimelineFrame,
    setTimelineHeight,
    setTimelineLoop,
    setTimelineMuted,
    setTimelineOpen,
    setTimelinePlaying,
    setTimelineSelectedClip,
    setTimelineSequences,
    setTimelineTotal,
    setTimelineTransitions,
    setTimelineVolume,
    setTourSteps,
    setTreeLoadFailures,
    setTreeLoaded,
    setUiPrefsHydrated,
    setUpdateReady,
    setWsConnected,
    setZoomCtlVisible,
    settingsOpen,
    settlePendingSelectionRef,
    setupReadiness,
    shareDialog,
    shortcutsOpen,
    showHidden,
    sidebarOpen,
    startTour,
    syncPanelOpen,
    syncStatus,
    systemData,
    tabs,
    theme,
    timelineArtboardId,
    timelineArtboardIdRef,
    timelineAudio,
    timelineCompId,
    timelineCompIdRef,
    timelineFps,
    timelineFrame,
    timelineFrameRef,
    timelineHeight,
    timelineLoop,
    timelineMuted,
    timelineOpFailed,
    timelineOpen,
    timelinePlaying,
    timelineRefresh,
    timelineSelectedClip,
    timelineSequences,
    timelineTotal,
    timelineTransitions,
    timelineVolume,
    togglePanel,
    toggleRightPanel,
    toggleTimeline,
    tourBus,
    tourSteps,
    treeExp,
    treeLoadFailures,
    treeLoaded,
    uiPrefsHydrated,
    unsavedCount,
    updateReady,
    updateTreeExp,
    usageNudge,
    viewerMode,
    whatsNew,
    wsConnected,
    wsRef,
    zoomCtlVisible,
  } = useShellCore({});
  // S3.5 — Present ⌄ › Order and notes… (`present.order-notes`): the sheet on the active canvas.
  const [orderNotesOpen, setOrderNotesOpen] = useState(false);

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
          done(
            Array.isArray(m.selectors) ? m.selectors.filter((x) => typeof x === 'string') : null
          );
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
    askText,
    broadcastChrome,
    exitPresent,
    lockedKeys,
    onPhotoEdit,
    onPhotoRecordEdit,
    onPhotoRemoveBackground,
    performPhotoUndo,
    pushTlUndo,
    resolveClipRef,
    settleShellPrompt,
    shellPromptState,
    timelineAddComment,
    timelineClipVerb,
    timelineRemoveClip,
    timelineTransClips,
    tlKeyRef,
    toggleAnnotations,
    toggleLockedKey,
    toggleMinimap,
    togglePresent,
    togglePrintGuides,
    toggleSection,
    toggleZoomCtl,
  } = usePhotoAndTimeline({
    groups,
    treeLoaded,
    activePath,
    selected,
    theme,
    setTheme,
    sidebarOpen,
    showHidden,
    treeExp,
    updateTreeExp,
    panelSide,
    setPanelSide,
    layersMode,
    setLayersMode,
    timelineOpen,
    activeComps,
    setActiveComps,
    timelineFrame,
    setTimelineFrame,
    timelinePlaying,
    setTimelinePlaying,
    timelineLoop,
    timelineMuted,
    canvasActiveArtboard,
    timelineSequences,
    setTimelineSequences,
    setTimelineAudio,
    setTimelineTransitions,
    timelineTotal,
    setTimelineTotal,
    timelineArtboardId,
    setTimelineArtboardId,
    timelineArtboardIdRef,
    timelineCompId,
    timelineSelectedClip,
    setTimelineSelectedClip,
    timelineRefresh,
    timelineOpFailed,
    photoUndoRef,
    setPhotoRev,
    autoOpenInspector,
    setAutoOpenInspector,
    annotationsVisible,
    setAnnotationsVisible,
    uiPrefsHydrated,
    setUiPrefsHydrated,
    minimapVisible,
    setMinimapVisible,
    zoomCtlVisible,
    setZoomCtlVisible,
    setPresentMode,
    setPrintGuidesVisible,
    setActiveArtboards,
    setGitUser,
    iframesRef,
    postToActiveCanvas,
    wsSend,
  });
  const treeExpansion = useMemo(
    () => ({
      isOpen: (dirPath) => isDirOpen(treeExp.state, dirPath),
      setOpen: (dirPath, open) => updateTreeExp((st) => setDirOpen(st, dirPath, open)),
    }),
    [treeExp.state, updateTreeExp]
  );
  const { loadSystemData, loadTree, toggleTheme } = useProjectData({
    setGroups,
    setTreeLoaded,
    setTreeLoadFailures,
    setProject,
    setSystemData,
    setCfg,
    setTheme,
  });

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
  // V2-2.4b — `maude design open` (ws `ui-open`, client/ui-open.js). The socket handler below is
  // installed once, so it reads the tab opener + present toggle through this ref (assigned after
  // useTabs), never through a captured closure.
  const uiOpenRef = useRef(null);
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
            // V2-2.8 P2: the window belongs to the canvas it was opened on — a restore for ANOTHER
            // canvas (the one we just switched to) applies, or Export targeted the old canvas.
            const incoming = m.selected;
            const one = Array.isArray(incoming) ? incoming[0] : incoming;
            const prevSel = selectedRef.current;
            const prevOne = Array.isArray(prevSel) ? prevSel[0] : prevSel;
            if (isOwnSelectEcho(incoming, lastLocalSelectRef.current)) return;
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
          } else if (m.type === 'thumb-ready' && typeof m.key === 'string') {
            // S1.14 — a picture landed: Version history looks again for the rows still drawing theirs.
            window.dispatchEvent(new CustomEvent('maude:thumb-ready', { detail: { key: m.key } }));
          } else if (m.type === 'index-changed') {
            // S1.23 — a canvas's content moved (an artboard trashed or added): the Canvases panel re-reads
            // the index so its artboard counts are not stale.
            window.dispatchEvent(
              new CustomEvent('maude:index-changed', { detail: { seq: m.seq, rels: m.rels } })
            );
          } else if (m.type === 'ai:runs') {
            // S5.11 (V2-1.15 §5.4) — the run registry moved: the shell's run store re-reads it.
            // S5.13's needs-you store hears the same window event (`maude:ai-runs`): one dispatch.
            noteAiRuns(m.seq);
          } else if (m.type === 'save-hold') {
            // p8-a1-save-hold — a save waits behind an AI call / landed: the notice (and the close flush)
            noteSaveHold(m);
          } else if (m.type === 'project:action' && m.action) {
            // S2.20 — an accepted action: the ⌘Z projection of every open canvas it touched.
            // S5.15 — "Made by AI" (derived: an ai action marks its artboards, the next person's
            // change clears them); it replaces S5.11's 6 s Done ring, which lit every action's.
            undoProjection.onAction(m.action);
            noteMadeByAi(m.action);
            // Version history looks again (a local project has no applied revision to key a re-read on).
            window.dispatchEvent(new CustomEvent('maude:project-action', { detail: m.action }));
          } else if (m.type === 'trash:changed') {
            // S1.7b — the shared Trash moved: the Trash view re-reads `GET /_api/trash`.
            window.dispatchEvent(new CustomEvent(TRASH_CHANGED_EVENT, { detail: m.payload }));
          } else if (m.type === 'access-changed') {
            // p8-e2e-rolefix (2) — hubs.json changed (desktop): Viewing / editing follows the new claim.
            loadServerConfig();
          } else if (m.type === 'access' || m.type === 'access-request') {
            // S9.21b — the hub's access notices (ws.ts: desktop shells only). The access host says them;
            // a raised / narrowed role re-reads /_config (the server re-exchanged first), so the toolbar
            // follows the new role.
            if (m.type === 'access' && (m.change === 'raised' || m.change === 'narrowed'))
              loadServerConfig();
            window.dispatchEvent(new CustomEvent(ACCESS_FRAME_EVENT, { detail: m }));
          } else if (m.type === 'ui-open') {
            // V2-2.4b (contract V2-1.11 §5.3) — `maude design open <canvas>[#ab][@el]`: open the
            // tab, then run the same registry actions the UI runs (zoom / select / present).
            if (uiOpenRef.current) applyUiOpen(m.open, uiOpenRef.current);
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
    acceptedDiff,
    cloudHistory,
    dirtyByPath,
    gitCommit,
    gitDiscard,
    gitGetLatest,
    gitLoadCloudLog,
    gitLoadLog,
    gitPublish,
    gitResolveConflict,
    loadAcceptedLog,
    loadDiffLog,
    projectHistoryOn,
    projectHistoryRefresh,
    refreshRemoteSync,
    restoreProjectVersion,
    setProjectHistoryOn,
  } = useGitActions({
    gitStatus,
    setGitStatus,
    setRemoteSync,
    diffTarget,
    setDiffTarget,
    savingIsManaged,
    savingIsManagedRef,
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
    assembleVideo,
    clearSelected,
    closeTab,
    createBoard,
    createVideo,
    deleteBoard,
    deleteFileReq,
    deleteFolderReq,
    duplicateCanvasReq,
    moveCanvasReq,
    newFolderReq,
    openLinkedFile,
    openSystem,
    openTab,
    refreshTree,
    reloadActive,
    renameCanvasReq,
    renameFolderReq,
    replaceMediaViaPicker,
    retryCanvasLoad,
    shareLinksFor,
    sharePath,
    shareShell,
    showShare,
    treeRefreshing,
  } = useTabs({
    groups,
    treeLoaded,
    addressMode,
    previousAddressPath,
    project,
    tabs,
    setTabs,
    activePath,
    setActivePath,
    previewPath,
    setPreviewPath,
    onPreview,
    setSelected,
    cloudLinkedHub,
    localProjectName,
    systemData,
    setLoadingPath,
    setCanvasError,
    setCanvasReloadNonce,
    setLoadedPath,
    cfg,
    loadServerConfig,
    setFocusedCommentId,
    updateTreeExp,
    setShareDialog,
    setTimelineOpen,
    timelineArtboardId,
    iframesRef,
    pushTlUndo,
    askText,
    loadTree,
    loadSystemData,
    canvasListChangeRef,
    wsSend,
  });
  uiOpenRef.current = {
    openTab,
    runAction: (id) => menuRunner.run(id),
    frameFor: (f) => iframesRef.current.get(f),
    setPresent: (on) => {
      setPresentMode(on);
      broadcastChrome({ present: on });
    },
  };

  // ----- Push comments to iframe whenever they change for active file -----
  // Presentation Mode hides comment pins: post an empty list while present
  // (re-posting the real list on exit, since this effect re-runs on the flag).
  // Round 11 (10 co-sync-offline): the comments the outbox still holds while offline carry `queued`.
  const commentsOnCanvas = useQueuedMarkedByFile(commentsByFile);
  useEffect(() => {
    if (!activePath || activePath === SYSTEM_TAB) return;
    const el = iframesRef.current.get(activePath);
    if (!el || !el.contentWindow) return;
    const list = presentMode ? [] : commentsOnCanvas[activePath] || [];
    try {
      el.contentWindow.postMessage({ dgn: 'comments-set', comments: list }, '*');
    } catch {}
  }, [activePath, commentsOnCanvas, presentMode]);
  const {
    applyOptimisticStyle,
    assetPickerReq,
    clearActiveCanvasSelection,
    deleteArtboardShell,
    deleteComment,
    detachInstanceShell,
    duplicateArtboardShell,
    insertGeneratedImage,
    onAssetPicked,
    onInsertArtboard,
    onPickMany,
    onReplaceMedia,
    onStickerPicked,
    recordSourceEdit,
    reopenComment,
    reorderLayer,
    resizeArtboardShell,
    resolveComment,
    setArtboardHugShell,
    setArtboardKindShell,
    setArtboardPrintShell,
    setArtboardStyleShell,
    setAssetPickerReq,
    setStickerPickerReq,
    stickerPickerReq,
  } = useCanvasBridge({
    activePath,
    selected,
    setSelected,
    selectedRef,
    lastLocalSelectRef,
    scheduleHaloRestore,
    scheduleArtboardResync,
    pendingReorderRef,
    lastLayersTreeRef,
    settlePendingSelectionRef,
    reorderLayerRef,
    repositionElementRef,
    resizeElementRef,
    layersBusyRef,
    layersBusyTimerRef,
    layersTree,
    setLayersTree,
    setLoadingPath,
    setCanvasError,
    setLoadedPath,
    cfg,
    viewerMode,
    commentsByFile: commentsOnCanvas,
    focusedCommentId,
    setFocusedCommentId,
    theme,
    setPaletteOpen,
    setExportDialog,
    setSettingsOpen,
    setShortcutsOpen,
    setTimelineOpen,
    setActiveComps,
    setTimelineFrame,
    setTimelinePlaying,
    canvasActiveArtboard,
    setCanvasActiveArtboard,
    timelineFrameRef,
    timelineCompIdRef,
    setInspectorTab,
    setPhotoSel,
    openRightPanel,
    toggleRightPanel,
    maybeAutoOpenInspectorOnSelect,
    toggleTimeline,
    minimapVisible,
    zoomCtlVisible,
    presentMode,
    setPresentMode,
    setActiveArtboards,
    iframesRef,
    postToActiveCanvas,
    captureFromCanvas,
    broadcastChrome,
    wsSend,
    reloadActive,
    gitUser,
  });
  // S10.4 — a design system's revision per canvas frame: element pins answered into the frame that asked,
  // and the follower swap (a head that moved is applied at the NEXT LOOK; Present holds it).
  useDsFrames({ cfg, iframesRef, activePath, presentMode, canvasActiveArtboard });

  // Jump from right-sidebar list to a comment: open file tab if needed, focus pin.
  // The iframe may be freshly mounted; the loaded handler also re-sends focus if focusedCommentId matches.
  const jumpToComment = useCallback(
    (file, id, opts) => {
      if (file && file !== activePath) {
        setTabs((prev) => (prev.find((t) => t.path === file) ? prev : [...prev, { path: file }]));
        setActivePath(file);
      }
      // S6.11b — a thread landing asks for the reply field (v2/comments/reply-focus.js)
      const reply = opts?.reply === true && id != null;
      wantReplyFocus(reply ? id : null);
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
            el.contentWindow.postMessage(commentFocusMessage(id, reply), '*');
          } catch {}
        }
      };
      send();
      setTimeout(send, 200);
    },
    [activePath]
  );
  // V2-2.4 — the shell's one key listener (action registry); replaces the global
  // shortcuts, the timeline transport and the ⌫ guard.
  const { onShellContextMenu, registerIframe, totalOpen } = useActionKeys({
    activePath,
    selected,
    viewerMode,
    commentsByFile,
    focusedCommentId,
    setFocusedCommentId,
    sidebarOpen,
    setShowHidden,
    setHelpOpen,
    setShortcutsOpen,
    setPaletteOpen,
    setExportDialog,
    setSettingsOpen,
    inspectorTab,
    openPanelExclusive,
    togglePanel,
    toggleRightPanel,
    toggleTimeline,
    presentMode,
    iframesRef,
    postToActiveCanvas,
    performPhotoUndo,
    tlKeyRef,
    exitPresent,
    openSystem,
    closeTab,
    reloadActive,
    refreshTree,
    clearActiveCanvasSelection,
    deleteArtboardShell,
    setTimelineFrame,
    setTimelinePlaying,
  });
  const {
    activeCanvasFile,
    activeOpenComments,
    dockLabels,
    leftActive,
    leftHostsAssistant,
    leftIds,
    paletteActions,
    renderPanelBody,
    resizingFor,
    rightActive,
    rightHostsAssistant,
    rightIds,
  } = usePaletteAndPanels({
    activeArtboards,
    groups,
    treeLoaded,
    treeLoadFailures,
    project,
    activePath,
    previewPath,
    onPreview,
    selected,
    editScope,
    layersBusyRef,
    layersTree,
    componentMap,
    wsConnected,
    syncStatus,
    cloudLinkedHub,
    setCloudLinkedHub,
    localProjectName,
    setLocalProjectName,
    gitStatus,
    remoteSync,
    changesOpen,
    setChangesOpen,
    syncPanelOpen,
    setSyncPanelOpen,
    setDiffTarget,
    search,
    setSearch,
    systemData,
    dragSide,
    cfg,
    cellManaged,
    cloudManaged,
    savingIsManaged,
    viewerMode,
    commentsByFile,
    focusedCommentId,
    commentsPanelOpen,
    commentsFilter,
    setCommentsFilter,
    sidebarOpen,
    showHidden,
    treeExp,
    sectionsExpanded,
    setHelpOpen,
    setReportBugOpen,
    setShortcutsOpen,
    setExportDialog,
    setSettingsOpen,
    setGenerateOpen,
    inspectorOpen,
    setInspectorOpen,
    layersOpen,
    setLayersOpen,
    assetsOpen,
    panelSide,
    layersMode,
    assistantOpen,
    inspectorTab,
    setInspectorTab,
    photoSel,
    photoRev,
    openPanelExclusive,
    togglePanel,
    openRightPanel,
    toggleRightPanel,
    whatsNew,
    postToActiveCanvas,
    onPhotoEdit,
    onPhotoRecordEdit,
    performPhotoUndo,
    onPhotoRemoveBackground,
    lockedKeys,
    toggleLockedKey,
    toggleSection,
    treeExpansion,
    toggleTheme,
    gitCommit,
    gitDiscard,
    gitPublish,
    gitGetLatest,
    gitLoadLog,
    cloudHistory,
    gitLoadCloudLog,
    projectHistoryOn,
    setProjectHistoryOn,
    projectHistoryRefresh,
    loadAcceptedLog,
    restoreProjectVersion,
    dirtyByPath,
    openTab,
    openLinkedFile,
    sharePath,
    shareShell,
    shareLinksFor,
    showShare,
    openSystem,
    reloadActive,
    treeRefreshing,
    refreshTree,
    createBoard,
    createVideo,
    deleteBoard,
    moveCanvasReq,
    newFolderReq,
    deleteFolderReq,
    renameFolderReq,
    renameCanvasReq,
    duplicateCanvasReq,
    deleteFileReq,
    applyOptimisticStyle,
    recordSourceEdit,
    reorderLayer,
    detachInstanceShell,
    resizeArtboardShell,
    duplicateArtboardShell,
    setArtboardHugShell,
    setArtboardStyleShell,
    setArtboardKindShell,
    setArtboardPrintShell,
    onReplaceMedia,
    resolveComment,
    reopenComment,
    deleteComment,
    jumpToComment,
    gitUser,
  });
  // S9.22b — unread mentions (Share cluster count + toast), the comments.* runners, timeline flags.
  const comments = useCommentsShell({
    commentsByFile,
    me: gitUser,
    activePath,
    jumpToComment,
    setCommentsFilter,
    openRightPanel,
  });
  // V2-2.3: everything the render tree reads, grouped by the module seam it comes from.
  const shellStore = {
    comments,
    shellCore: {
      activeArtboards,
      activeComps,
      activePath,
      agentActive,
      annotationsVisible,
      assistantBusy,
      assistantOpen,
      assistantUnseen,
      autoOpenInspector,
      bodyRef,
      iframesRef,
      brandUploadOpen,
      canvasActiveArtboard,
      canvasError,
      canvasReloadNonce,
      captureFromCanvas,
      cfg,
      changesOpen,
      collabNudge,
      commentsByFile,
      commentsPanelOpen,
      cpMode,
      diffTarget,
      dragSide,
      exportCenter,
      exportDialog,
      figmaImportOpen,
      generateOpen,
      gitLifecycle,
      gitStatus,
      gitUser,
      // S6.2's viewport slot (v2/create/empty-project.jsx EmptyProjectSlot) reads these three
      groups,
      handleAssistantAttention,
      handleAssistantFinished,
      helpOpen,
      inspectorOpen,
      inspectorTab,
      introOpen,
      layersMode,
      loadedPath,
      loadingPath,
      markCollabSeen,
      markUsageSeen,
      minimapVisible,
      onIframeLoad,
      openMenu,
      openPanelExclusive,
      openRightPanel,
      paletteOpen,
      panelSide,
      postToActiveCanvas,
      presentMode,
      previewPath,
      printGuidesVisible,
      project,
      quickSetupOpen,
      readinessOpen,
      reportBugOpen,
      rpSize,
      savingIsManaged,
      sbSize,
      selected,
      setAssistantBusy,
      setAssistantOpen,
      setAutoOpenInspector,
      setBrandUploadOpen,
      setCpMode,
      setDiffTarget,
      setDragSide,
      setExportDialog,
      setFigmaImportOpen,
      setGenerateOpen,
      setGitLifecycle,
      setHelpOpen,
      setInspectorOpen,
      setInspectorTab,
      setIntroOpen,
      setLayersMode,
      setLayersOpen,
      setOpenMenu,
      setPaletteOpen,
      setPanelSide,
      setQuickSetupOpen,
      setReadinessOpen,
      setReportBugOpen,
      setSettingsOpen,
      setShareDialog,
      setShortcutsOpen,
      setCanvasActiveArtboard,
      setOrderNotesOpen,
      setShowHidden,
      setTheme,
      setTimelineFrame,
      setTimelineHeight,
      setTimelineLoop,
      setTimelineMuted,
      setTimelineOpen,
      setTimelinePlaying,
      setTimelineSelectedClip,
      setTimelineVolume,
      setTourSteps,
      setUpdateReady,
      settingsOpen,
      setupReadiness,
      shareDialog,
      shortcutsOpen,
      orderNotesOpen,
      showHidden,
      sidebarOpen,
      startTour,
      syncPanelOpen,
      syncStatus,
      systemData,
      tabs,
      theme,
      timelineArtboardId,
      timelineAudio,
      timelineCompId,
      timelineFps,
      timelineFrame,
      timelineHeight,
      timelineLoop,
      timelineMuted,
      timelineOpFailed,
      timelineOpen,
      timelinePlaying,
      timelineSelectedClip,
      timelineSequences,
      timelineTotal,
      timelineTransitions,
      timelineVolume,
      togglePanel,
      toggleRightPanel,
      toggleTimeline,
      tourBus,
      tourSteps,
      treeLoadFailures,
      treeLoaded,
      unsavedCount,
      updateReady,
      usageNudge,
      viewerMode,
      whatsNew,
      wsConnected,
      zoomCtlVisible,
    },
    local: {
      querySelectionFromCanvas,
      wsSend,
    },
    photoAndTimeline: {
      askText,
      exitPresent,
      pushTlUndo,
      resolveClipRef,
      settleShellPrompt,
      shellPromptState,
      timelineAddComment,
      timelineClipVerb,
      timelineRemoveClip,
      timelineTransClips,
      tlKeyRef,
      toggleAnnotations,
      toggleMinimap,
      togglePresent,
      togglePrintGuides,
      toggleZoomCtl,
    },
    projectData: {
      loadSystemData,
      loadTree,
      toggleTheme,
    },
    gitActions: {
      acceptedDiff,
      gitDiscard,
      gitGetLatest,
      gitResolveConflict,
      loadDiffLog,
      restoreProjectVersion,
    },
    tabs: {
      assembleVideo,
      clearSelected,
      closeTab,
      duplicateCanvasReq,
      moveCanvasReq,
      openSystem,
      openTab,
      reloadActive,
      renameCanvasReq,
      replaceMediaViaPicker,
      retryCanvasLoad,
      shareLinksFor,
      sharePath,
      shareShell,
      showShare,
    },
    canvasBridge: {
      assetPickerReq,
      insertGeneratedImage,
      onAssetPicked,
      onInsertArtboard,
      onPickMany,
      onStickerPicked,
      setAssetPickerReq,
      setStickerPickerReq,
      stickerPickerReq,
    },
    keyboardShortcuts: {
      onShellContextMenu,
      registerIframe,
      totalOpen,
    },
    paletteAndPanels: {
      activeCanvasFile,
      activeOpenComments,
      dockLabels,
      leftActive,
      leftHostsAssistant,
      leftIds,
      paletteActions,
      renderPanelBody,
      resizingFor,
      rightActive,
      rightHostsAssistant,
      rightIds,
    },
  };
  return <ShellStoreContext.Provider value={shellStore}>{children}</ShellStoreContext.Provider>;
}

// V2-4.2: the project pill and the one menu. Every row runs the shell's own function for that action
// (v2/shell/menu-runner.js) — this component hands the runner this render's closures (through a ref, so
// the handler map is built once), binds it (⌘K's twin rows call the same runner) and renders
// PROJECT_MENU through the registry.
function ShellProjectPill() {
  // P8 C4: the pill is the project switcher (a "Switch project" submenu in the desktop app).
  const switcher = useProjectSwitcher();
  const {
    shellCore: {
      activePath,
      annotationsVisible,
      autoOpenInspector,
      cfg,
      cloudLinkedHub,
      changesOpen,
      commentsPanelOpen,
      exportCenter,
      groups,
      inspectorOpen,
      iframesRef,
      minimapVisible,
      openPanelExclusive,
      openRightPanel,
      postToActiveCanvas,
      presentMode,
      printGuidesVisible,
      project,
      setAutoOpenInspector,
      setBrandUploadOpen,
      setExportDialog,
      setFigmaImportOpen,
      setGenerateOpen,
      setHelpOpen,
      setIntroOpen,
      setQuickSetupOpen,
      setReportBugOpen,
      setSettingsOpen,
      setShortcutsOpen,
      setOrderNotesOpen,
      setShowHidden,
      showHidden,
      layersMode,
      setLayersMode,
      setLayersOpen,
      assetsOpen,
      startTour,
      toggleRightPanel,
      toggleTimeline,
      syncStatus,
      tabs,
      viewerMode,
      whatsNew,
      wsConnected,
      zoomCtlVisible,
    },
    photoAndTimeline: {
      toggleAnnotations,
      toggleMinimap,
      togglePresent,
      togglePrintGuides,
      toggleZoomCtl,
    },
    tabs: {
      assembleVideo,
      closeTab,
      duplicateCanvasReq,
      moveCanvasReq,
      openSystem,
      openTab,
      reloadActive,
      renameCanvasReq,
      showShare,
    },
    canvasBridge: { onInsertArtboard },
    paletteAndPanels: { leftActive },
    comments,
  } = useShellStore();
  const { hidden: panelsHidden, pinned, userHidden: panelsUserHiddenLayout } = usePanelLayout();
  const native = isNativeApp();
  const online = useOnline();
  const canvasOpen = !!activePath && activePath !== SYSTEM_TAB;
  const [movePicker, setMovePicker] = useState(null);
  const pillRef = useRef(null);
  const openerRef = useRef(null);
  const live = useRef(null);
  live.current = {
    native,
    activePath,
    // S9.21 — Ask to edit names the open canvas designRoot-relative (the hub keys a grant that way)
    designRel: cfg?.designRel,
    canvasName: displayName(basename(activePath || '')),
    toast: (m, ok, action, extra) => shellToast(m, ok, action, extra),
    postToActiveCanvas,
    openPanelExclusive,
    toggleRightPanel,
    setExportDialog,
    setGenerateOpen,
    setSettingsOpen,
    setHelpOpen,
    setShortcutsOpen,
    setOrderNotesOpen,
    setReportBugOpen,
    onUsageTour: () => startTour(USAGE_TOUR),
    onCollabTour: () => startTour(COLLAB_TOUR),
    onQuickSetup: () => setQuickSetupOpen(true),
    onIntro: () => setIntroOpen(true),
    onWhatsNew: whatsNew.openPanel,
    onShare: () => showShare(),
    onReload: reloadActive,
    onCloseCanvas: () => activePath && closeTab(activePath),
    onAssembleVideo: assembleVideo,
    onToggleShowHidden: () => setShowHidden((v) => !v),
    // S9.22b — comments.filter-* / comments.open-thread (v2/comments/use-comments-shell.jsx)
    onCommentsFilter: (f) => comments?.showFilter(f),
    onOpenCommentThread: (file, id, opts) => comments?.openThread(file, id, opts),
    // V2-4.4a: View › Advanced › Layers as a panel — the Settings › Layout switch, from the menu.
    onToggleLayersMode: () => {
      const next = layersMode === 'separate' ? 'in-inspector' : 'separate';
      setLayersMode(next);
      // Leaving separate mode retires the standalone Layers panel.
      if (next !== 'separate') setLayersOpen(false);
    },
    onToggleAnnotations: toggleAnnotations,
    onToggleMinimap: toggleMinimap,
    onToggleZoomCtl: toggleZoomCtl,
    onTogglePresent: togglePresent,
    onTogglePrintGuides: togglePrintGuides,
    onToggleTimeline: toggleTimeline,
    onToggleAutoOpenInspector: () => setAutoOpenInspector((v) => !v),
    // V2-4.3a: Menu › View › Exports / ⌘K "Exports" / the Share cluster's Exports icon — the export center's list.
    onToggleExports: () =>
      exportCenter.panelOpen ? exportCenter.closePanel() : exportCenter.openPanel(),
    onInsertArtboard,
    onImportFigma: () => setFigmaImportOpen(true),
    onImportBrand: () => setBrandUploadOpen(true),
    onDuplicate: duplicateCanvasReq,
    onRename: renameCanvasReq,
    // Move to… — the Files tree row menu's destination list, opened under the pill.
    onPickMoveDestination: () => {
      const r = pillRef.current?.getBoundingClientRect();
      setMovePicker({
        view: 'move-to',
        x: r?.left ?? 16,
        y: (r?.bottom ?? 56) + 4,
        anchor: r
          ? { top: r.top, bottom: r.bottom, left: r.left }
          : { top: 16, bottom: 56, left: 16 },
        anchorEl: pillRef.current,
      });
    },
    // V2-3.8: this project signs in as someone else — it moves onto a profile of its own and the
    // page reloads signed out. A project with no cloud sign-in has nothing to move.
    onSwitchAccount: () => {
      // V2-4.8a: in a cloud tab this is the menubar's "Sign out": a FORM POST, not a link — signing out
      // revokes the token server-side, so it is a write (no GET can force it on you).
      if (cfg?.cloud) {
        const form = document.createElement('form');
        form.method = 'post';
        form.action = '/auth/browser/signout';
        form.hidden = true;
        document.body.appendChild(form);
        form.submit();
        return;
      }
      cloudSignInPrepare().then(
        (moved) => {
          if (!moved) shellToast('Sign in from the Share panel to use another account.');
        },
        (e) => shellToast(String(e?.message || e || 'Could not switch accounts.'))
      );
    },
    onCutPaste: (kind) => cutCopyPaste(kind, openerRef.current, { postToActiveCanvas }),
    // S10.6 — `ds.set-theme-preview`: the Design system canvas shows its Light or its Dark (preview only).
    onDsThemePreview: (mode) =>
      postDsThemePreview(
        activePath ? iframesRef.current.get(activePath) : null,
        mode,
        cfg?.canvasOrigin || window.location.origin
      ),
    // S10.8 — `ds.go-to`: open the Design system canvas, focus its artboard, select the token / master. The
    // canvas mounts its listener late, so the messages ride the `ui-open` ladder — only while it is still the
    // canvas on screen.
    onDsGoTo: (params) => {
      const plan = dsGoToPlan(params, cfg, activePath);
      if (!plan) return shellToast('There is no design system to go to.');
      // S10.13 — a system not yet on a canvas opens today's v1 view (S10 Q6)
      if (!plan.converted) return openSystem(plan.ds);
      // The tab is the tree's own path (`.design/system/…`): that is the `file` the canvas reports once it has
      // drawn, and the loading card waits for exactly that (a bare `system/…` never matched: "Opening…" for 15 s,
      // then "can't be drawn right now" over a canvas that had drawn).
      const designRel = (cfg?.designRel || '.design').replace(/^\/+|\/+$/g, '');
      const tabPath = `${designRel}/${plan.file}`;
      openTab(tabPath);
      const posts = dsGoToPosts(plan);
      for (const ms of OPEN_LADDER_MS)
        setTimeout(() => {
          if (live.current.activePath !== tabPath) return;
          for (const m of posts) live.current.postToActiveCanvas(m);
        }, ms);
    },
    // V2-4.8a: a cloud tab's "Back to Home" — the v1 menubar's "← Dashboard" link, same tab.
    onOpenDashboard: () => {
      const url = cfg?.cloud?.dashboardUrl;
      if (url) window.location.assign(url);
      else shellToast('This workspace has no dashboard to go back to.');
    },
  };
  const d = useMemo(() => new Proxy({}, { get: (_t, k) => live.current[k] }), []);
  const handlers = useMemo(() => createMenuHandlers(d), [d]);
  // V2-4.7b: the Diagnostics rows' status words (Sync · Server · AI setup) and the rows left out.
  const diag = useDiagnosticsMenu({
    syncStatus,
    project: cfg?.cloud?.projectName || project,
    wsConnected,
    cfg,
  });
  useEffect(() => {
    menuRunner.bind(handlers, {
      postToActiveCanvas: (m) => live.current.postToActiveCanvas(m),
      invokeNative: native ? invoke : null,
    });
    return () => menuRunner.unbind(handlers);
  }, [handlers, native]);
  // S5.13 — a "Needs you" / "Done" toast's Open lands in the AI chat (ChatPanel picks the chat itself).
  // S5.10 — the paperclip's From Assets opens the Assets panel, the same as View › Assets.
  useEffect(() => {
    const onOpenAi = (e) => {
      openRightPanel('assistant');
      // S5.18 (G4): a "needs you" toast's Open lands on the canvas that needs you, not only on its chat.
      const canvas = normalizeOpenPath(e?.detail?.canvas, cfg?.designRel || '.design');
      if (canvas) openTab(canvas);
    };
    const onAttachAssets = () => menuRunner.run('view.assets');
    window.addEventListener(OPEN_AI_EVENT, onOpenAi);
    window.addEventListener(OPEN_ASSETS_EVENT, onAttachAssets);
    return () => {
      window.removeEventListener(OPEN_AI_EVENT, onOpenAi);
      window.removeEventListener(OPEN_ASSETS_EVENT, onAttachAssets);
    };
  }, [openRightPanel, openTab, cfg?.designRel]);
  // S1.22c: the native tab menu's "Sign in as another account…" arrives as `menu://action
  // {id:'account.switch'}` (tabs.rs TabMenuItem::SwitchAccount); it is not a palette row, so the
  // palette's menu://action listener never runs it — the menu handler does.
  useEffect(() => {
    if (!native) return undefined;
    const p = onMenuAction((id) => {
      if (id === 'account.switch') handlers['account.switch']?.();
    });
    return () => {
      p?.then?.((fn) => fn?.());
    };
  }, [handlers, native]);

  const isCloudTab = !!cfg?.cloud;
  // P8 G1a — the role on the OPEN canvas, as the server resolved it (`/_config.access`): a desktop linked to a
  // v2 hub has no `cloud.role`, so reading that alone gave a window narrowed to Can view the Can comment menu
  // (Export, ⇧⌘E). The same value feeds the Export sheet's access line and the vote sheet.
  const activeRel = activePath ? normalizeOpenPath(activePath, cfg?.designRel) : null;
  const activeRole = sessionRole(cfg, activeRel);
  const activeObserver = observerOn(cfg, activeRel);
  const ctx = useMemo(
    () =>
      menuCtx({
        native,
        cloudTab: isCloudTab,
        readOnly: viewerMode,
        observer: activeObserver,
        canvasOpen,
        presenting: presentMode,
        // S3.8 — Copy presentation link reads both: a cloud-linked desktop, and the network up.
        linkedHub: !!cloudLinkedHub?.url,
        online,
      }),
    [
      native,
      isCloudTab,
      viewerMode,
      activeObserver,
      canvasOpen,
      presentMode,
      cloudLinkedHub?.url,
      online,
    ]
  );
  // V2-4.8a: the megaphone's unseen dot, as a word on the Help row; and no "Back to Home" in a hub that
  // serves one project (no dashboard to go back to — the v1 link was absent there too).
  const unseenNews = whatsNew.unseen.length;
  const timelineKept = useTimelineKept(); // S7.7 — ⇧⌘T's check mark is "kept open", not "the island is up"
  const noDashboard = isCloudTab && !cfg.cloud.dashboardUrl;
  // …and who you are, with the way to stop being them: the account row carries the account's email.
  const cloudUser = isCloudTab ? cfg.cloud.user || null : null;
  const state = useMemo(
    () => ({
      ...diag.state,
      hidden: [
        ...(diag.state.hidden ?? []),
        ...(noDashboard ? ['nav.home'] : []),
        ...(isCloudTab && !cloudUser ? ['account.switch'] : []),
      ],
      status: {
        ...diag.state.status,
        ...(unseenNews > 0
          ? { 'help.whats-new': { word: `${unseenNews} new`, tone: 'neutral' } }
          : {}),
        ...(cloudUser
          ? { 'account.switch': { word: cloudUser, tone: 'neutral', mono: true } }
          : {}),
      },
      panelsHidden,
      checked: {
        'view.pin-panels': pinned,
        'view.annotations': annotationsVisible,
        'view.minimap': minimapVisible,
        'view.zoom-controls': zoomCtlVisible,
        'view.print-guides': printGuidesVisible,
        'view.hidden-files': showHidden,
        'view.layers-panel': layersMode === 'separate',
        'view.assets': assetsOpen,
        'view.inspector-on-select': autoOpenInspector,
        'view.timeline-keep-open': timelineKept,
        'view.inspector': inspectorOpen,
        'view.comments': commentsPanelOpen,
        'view.exports': exportCenter.panelOpen,
        'history.open': changesOpen,
        'present.canvas': presentMode,
      },
    }),
    [
      diag.state,
      noDashboard,
      isCloudTab,
      cloudUser,
      unseenNews,
      panelsHidden,
      pinned,
      annotationsVisible,
      minimapVisible,
      zoomCtlVisible,
      printGuidesVisible,
      showHidden,
      layersMode,
      assetsOpen,
      autoOpenInspector,
      timelineKept,
      inspectorOpen,
      commentsPanelOpen,
      exportCenter.panelOpen,
      changesOpen,
      presentMode,
    ]
  );
  const previewing = usePreviewMode();
  const destinations = useMemo(() => moveDestinations(groups), [groups]);
  const dir = activePath ? activePath.slice(0, activePath.lastIndexOf('/')) : '';

  return (
    <>
      <ProjectPill
        pillRef={pillRef}
        project={project || cfg?.cloud?.projectName || ''}
        canvas={canvasOpen ? displayName(basename(activePath)) : ''}
        ctx={ctx}
        state={state}
        run={(id) => menuRunner.run(id)}
        switcher={switcher}
        docked={pinned && !panelsHidden && !!leftActive}
        // S3.9 — Preview folds the pill to its mark (04 md-preview).
        folded={previewing || panelsUserHiddenLayout}
        onOpen={(el) => {
          openerRef.current = el;
          diag.onMenuOpen();
        }}
      />
      <TreeRowMenu
        state={movePicker}
        onClose={() => setMovePicker(null)}
        rootItems={[]}
        destinations={destinations.filter((x) => x.path !== dir)}
        onPickDestination={(dest) => activePath && moveCanvasReq(activePath, dest)}
      />
    </>
  );
}

// V2-2.3: the TimelinePanel surface reads the shell store directly instead of being drilled through ShellTree.
function ShellTimelinePanel() {
  const {
    shellCore: {
      activeComps,
      activePath,
      cfg,
      commentsByFile,
      postToActiveCanvas,
      setTimelineFrame,
      setTimelineHeight,
      setTimelineLoop,
      setTimelineMuted,
      setTimelineOpen,
      setTimelinePlaying,
      setTimelineSelectedClip,
      setTimelineVolume,
      timelineArtboardId,
      timelineAudio,
      timelineCompId,
      timelineFps,
      timelineFrame,
      timelineHeight,
      timelineLoop,
      timelineMuted,
      timelineOpFailed,
      timelinePlaying,
      timelineSelectedClip,
      timelineSequences,
      timelineTotal,
      timelineTransitions,
      timelineVolume,
    },
    local: { wsSend },
    photoAndTimeline: {
      askText,
      pushTlUndo,
      resolveClipRef,
      timelineAddComment,
      timelineClipVerb,
      timelineRemoveClip,
      timelineTransClips,
      tlKeyRef,
    },
    projectData: { loadTree },
    tabs: { openTab, replaceMediaViaPicker },
  } = useShellStore();
  return (
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
        postToActiveCanvas({
          dgn: 'timeline-mute',
          muted: timelineMuted,
          id: timelineCompId,
        });
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
        // S7.9 — a trim or a move is one `clip.retime` edit op: one write, one undo step (the clip is
        // addressed by stableId + fingerprint, read fresh by the verb pipe).
        timelineClipVerb(clipRef, 'retime', patch);
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
              cc?.ok && Array.isArray(cc.media) ? cc.media.filter((m) => m.tag === 'Audio') : [];
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
              if (j.seq != null)
                pushTlUndo(activePath, j.seq, j.hidden ? 'hide clip' : 'show clip');
            }
          })
          .catch(() => shellToast('Hide failed: network error'));
      }}
      onReorderMove={(movedRef2, targetRef, position) => {
        if (!activePath || activePath === SYSTEM_TAB) return;
        // S7.9 — the magnetic drag commit is one `clip.move` edit op (a real series MOVE, any distance).
        timelineClipVerb(movedRef2, 'move', { refRef: targetRef, position });
      }}
      onDropMedia={(files, pos) => {
        if (!activePath || activePath === SYSTEM_TAB) return;
        // DDR-150 P4 + Task 6 — drop media onto the timeline. With a caret
        // position: index-aware storyline insert / frame-anchored
        // overlay-audio insert; multiple files insert in order. Audio
        // files always land in the audio band. Without a position, the
        // legacy append path.
        const fps = timelineFps;
        const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
        const fileStem = (n) => String(n || '').replace(/\.[A-Za-z0-9]{1,8}$/, '');
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
                if (up?.path) clips.push({ src: up.path, mediaKind, name: fileStem(file.name) });
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
            const sized = [];
            for (const c of clips) {
              const probedSec = await probeMediaDuration(c.src).catch(() => null);
              sized.push({ c, durationInFrames: durationFramesForDrop(fps, probedSec) });
            }
            const asItem = (x) => ({
              mediaTag: x.c.mediaKind === 'audio' ? 'Audio' : 'Video',
              src: x.c.src,
              durationInFrames: x.durationInFrames,
              name: x.c.name,
            });
            // The first clip always opens the storyline; later audio goes to the audio band. S7.9: the whole
            // drop is ONE `clip.insert` per band (one write, one undo step), not one write per file.
            const story = sized.filter((x) => x.c.mediaKind !== 'audio' || x === sized[0]);
            const beds = sized.filter((x) => !story.includes(x));
            const jStory = await timelineClipVerb(
              null,
              'insert',
              { lane: 'storyline', items: story.map(asItem) },
              { quiet: true }
            );
            if (jStory?.ok) {
              upgraded = true; // else: no eligible artboard — New Cut fallback below
              if (beds.length) {
                const jBeds = await timelineClipVerb(
                  null,
                  'insert',
                  { lane: 'audio', from: 0, items: beds.map(asItem) },
                  { quiet: true }
                );
                if (!jBeds?.ok) timelineOpFailed('Drop refused', jBeds?.message || jBeds?.error);
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
              shellToast(
                `Started a new cut from ${clips.length} clip${clips.length > 1 ? 's' : ''}.`,
                true
              );
              return;
            }
            shellToast('New cut failed: too many "New Cut" canvases — rename some.');
            return;
          }
          // S7.9 — upload and size every file first, then add each band's files in ONE `clip.insert`:
          // dropping three clips is one gesture, one write, one undo step.
          const groups = new Map();
          const add = (where, item) => {
            const key = JSON.stringify(where);
            if (!groups.has(key)) groups.set(key, { ...where, items: [] });
            groups.get(key).items.push(item);
          };
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
            // p8-t-video-2 — the clip keeps the file's own name ("IMG_5120"), not the asset's content hash.
            const item = { mediaTag, src: up.path, name: fileStem(file.name) };
            if (pos && (isAudio || pos.lane === 'audio')) {
              // Default: stretch toward the end of the cut.
              const from = Math.max(0, pos.frame ?? 0);
              add(
                { lane: 'audio', from },
                { ...item, durationInFrames: Math.max(fps, timelineTotal - from) }
              );
            } else if (pos?.lane === 'storyline' && !isAudio) {
              add(
                { lane: 'storyline', ...(pos.index != null ? { index: pos.index } : {}) },
                { ...item, durationInFrames: durationFramesForDrop(fps, probedSec) }
              );
            } else if (pos?.lane === 'overlay' && !isAudio) {
              const dur = durationFramesForDrop(fps, probedSec);
              if ((timelineSequences || []).length === 0) {
                // First clip of a greenfield comp = the BASE layer →
                // storyline, wherever it was dropped.
                add({ lane: 'storyline' }, { ...item, durationInFrames: dur });
              } else {
                add(
                  { lane: 'overlay', from: Math.max(0, pos.frame ?? 0) },
                  { ...item, durationInFrames: dur }
                );
              }
            } else if (!isAudio) {
              // Default container rule: a video/image drop ANYWHERE on the
              // timeline lands in the storyline (append = hard cut at the
              // end; the caret gives it an index). The old lane-less
              // append refused hard-cut series ("no transition to clone").
              add(
                { lane: 'storyline' },
                { ...item, durationInFrames: durationFramesForDrop(fps, probedSec) }
              );
            } else {
              // Audio without a caret → audio band, from the start.
              add(
                { lane: 'audio', from: 0 },
                { ...item, durationInFrames: Math.max(fps, timelineTotal) }
              );
            }
          }
          for (const g of groups.values()) await timelineClipVerb(null, 'insert', g);
        })();
      }}
      height={timelineHeight}
      onResize={setTimelineHeight}
      onClose={() => setTimelineOpen(false)}
      selectedClipId={timelineSelectedClip}
      onSelect={setTimelineSelectedClip}
      transitionClips={timelineTransClips}
      onClipVerb={timelineClipVerb}
      comments={(commentsByFile[activePath] || []).filter(
        (c) => c && (c.timeline || typeof c.t === 'number')
      )}
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
            rows.find((r2) => r2.series && s.frame >= r2.from && s.frame < r2.from + r2.duration) ||
            rows.find((r2) => s.frame >= r2.from && s.frame < r2.from + r2.duration);
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
                // 07: the new title is selected, so the Title inspector (words, font, motion) is what opens next
                if (typeof j.stableId === 'string' && j.stableId) {
                  // the canvas reloads the rewritten file and echoes a `select`: that must not release this pick
                  timelineSelection.shield(2500);
                  setTimelineSelectedClip(j.stableId);
                }
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
                shellToast(
                  'AI placeholder added — double-click its text to write the prompt, then right-click → Generate ✨.',
                  true
                );
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
                            shellToast(
                              'Placeholder clip is gone — generated asset kept in assets/.'
                            );
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
                shellToast(
                  `Generate failed: ${e?.message || 'provider error'} — is a Gemini key set in Settings?`
                )
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
  );
}

// V2-2.3: the Settings surface reads the shell store directly instead of being drilled through ShellTree.
// V2-4.7a: it is the v2 sheet — General · Connections · Advanced (client/v2/settings/).
function ShellSettingsPanel() {
  const {
    shellCore: {
      activePath,
      annotationsVisible,
      autoOpenInspector,
      cfg,
      cpMode,
      layersMode,
      minimapVisible,
      panelSide,
      setAutoOpenInspector,
      setCloudLinkedHub,
      setCpMode,
      setLayersMode,
      setLayersOpen,
      setLocalProjectName,
      setPanelSide,
      setSettingsOpen,
      setTheme,
      setUpdateReady,
      settingsOpen,
      syncStatus,
      theme,
      updateReady,
      viewerMode,
      zoomCtlVisible,
    },
    photoAndTimeline: { toggleAnnotations, toggleMinimap, toggleZoomCtl },
  } = useShellStore();
  return (
    <SettingsSheet
      cloud={cfg.cloud}
      readOnly={viewerMode}
      onClose={() => setSettingsOpen(false)}
      initialTab={typeof settingsOpen === 'string' ? settingsOpen : undefined}
      update={updateReady}
      onUpdateLater={() => setUpdateReady(null)}
      syncStatus={syncStatus}
      onLinkedHub={setCloudLinkedHub}
      onLocalProject={setLocalProjectName}
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
  );
}

// V2-2.3: the Viewport surface reads the shell store directly instead of being drilled through ShellTree.
function ShellViewport() {
  const {
    shellCore: {
      activePath,
      canvasError,
      canvasReloadNonce,
      cfg,
      loadedPath,
      loadingPath,
      onIframeLoad,
      previewPath,
      project,
      setQuickSetupOpen,
      setupReadiness,
      systemData,
      tabs,
      viewerMode,
    },
    projectData: { loadSystemData },
    tabs: { openTab, retryCanvasLoad },
    keyboardShortcuts: { registerIframe },
  } = useShellStore();
  return (
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
      showQuickSetup={isNativeApp() && !viewerMode && !!setupReadiness && !setupReadiness.ready}
      onStartQuickSetup={() => setQuickSetupOpen(true)}
      previewPath={previewPath}
    />
  );
}

// V2-2.3: the render tree. It reads the shell store; it owns no state and no effects.
function ShellTree() {
  const {
    shellCore: {
      activeArtboards,
      activeComps,
      activePath,
      assetsOpen,
      assistantBusy,
      assistantOpen,
      bodyRef,
      iframesRef,
      postToActiveCanvas,
      brandUploadOpen,
      canvasActiveArtboard,
      captureFromCanvas,
      cfg,
      diffTarget,
      dragSide,
      exportCenter,
      exportDialog,
      figmaImportOpen,
      generateOpen,
      gitLifecycle,
      handleAssistantAttention,
      handleAssistantFinished,
      helpOpen,
      introOpen,
      markUsageSeen,
      openPanelExclusive,
      paletteOpen,
      presentMode,
      printGuidesVisible,
      project,
      quickSetupOpen,
      readinessOpen,
      reportBugOpen,
      rpSize,
      sbSize,
      selected,
      setAssistantBusy,
      setAssistantOpen,
      setBrandUploadOpen,
      setDiffTarget,
      setDragSide,
      setExportDialog,
      setFigmaImportOpen,
      setGenerateOpen,
      setGitLifecycle,
      setHelpOpen,
      setIntroOpen,
      setPaletteOpen,
      setQuickSetupOpen,
      setReadinessOpen,
      setReportBugOpen,
      setShareDialog,
      setShortcutsOpen,
      setOrderNotesOpen,
      setTourSteps,
      setUpdateReady,
      settingsOpen,
      shareDialog,
      shortcutsOpen,
      orderNotesOpen,
      startTour,
      syncStatus,
      tabs,
      wsConnected,
      theme,
      togglePanel,
      tourBus,
      tourSteps,
      updateReady,
      usageNudge,
      viewerMode,
      whatsNew,
    },
    local: { querySelectionFromCanvas },
    photoAndTimeline: { settleShellPrompt, shellPromptState },
    projectData: { loadTree },
    gitActions: {
      acceptedDiff,
      gitDiscard,
      gitResolveConflict,
      loadDiffLog,
      restoreProjectVersion,
    },
    tabs: { openSystem, shareLinksFor, shareShell },
    canvasBridge: {
      assetPickerReq,
      insertGeneratedImage,
      onAssetPicked,
      onPickMany,
      onStickerPicked,
      setAssetPickerReq,
      setStickerPickerReq,
      stickerPickerReq,
    },
    keyboardShortcuts: { onShellContextMenu },
    paletteAndPanels: {
      activeCanvasFile,
      activeOpenComments,
      dockLabels,
      leftActive,
      leftHostsAssistant,
      leftIds,
      paletteActions,
      renderPanelBody,
      resizingFor,
      rightActive,
      rightHostsAssistant,
      rightIds,
    },
  } = useShellStore();
  // P8 G1a — the server's role on the open canvas (Export sheet access line, vote sheet), never `cloud.role` alone
  const activeRole = sessionRole(
    cfg,
    activePath ? normalizeOpenPath(activePath, cfg?.designRel) : null
  );

  // V2-4.1 — panel layout (⌘\ hide, View › Advanced pin) and the insets the islands cause.
  const {
    hidden: panelsHidden,
    pinned,
    folded: panelsFolded,
    userHidden: panelsUserHidden,
  } = usePanelLayout();
  useHydratePanelLayout();
  // S8.9 — the Export sheet's "From 14:05" while AI is working: the open canvas's last landed change
  const exportLastFinishedAt = useLastFinishedAt({
    open: !!exportDialog,
    activePath,
    designRel: (cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, ''),
  });
  const floating = !pinned;
  // V2-8.5 C2 — the Inspector is a 264 px card (14 `.k-insp`), not the user's panel width
  // P8-C8 — Version history is the 372 px island of 11 `.pn-vh` (pictures 72×54 need the room)
  // P8 C3 (03 ai-long-pinned): the AI chat pinned to the side is the board's 420 column, not the 304 default of the
  // other right panels (the canvas then re-fits to the room left of it - `layoutKey` carries the width)
  // (declared here, above the widths that read `aiInFold` — a const below would be in its temporal dead zone)
  const [rightInFold, setRightInFold] = useState(false);
  // P8 C8 (04 md-draw): the AI chat opened during Preview's fold shows by itself (Canvases stay folded)
  const [aiInFold, setAiInFold] = useState(false);
  // rc.1 finding 16: the Inspector, Version history and the AI chat each own a width (panel-sizes.js) and the grip
  // resizes the widest island in its slot. The AI chat (floating or docked) counts toward the slot it is hosted in.
  const sizes = usePanelSizes();
  const aiSlotW = aiSlotWidth({ w: sizes.get('ai'), full: sizes.aiFull(), pinned });
  const rightAiShown = rightHostsAssistant && assistantOpen && (!panelsFolded || aiInFold);
  const leftAiShown = leftHostsAssistant && assistantOpen;
  const rightOwn =
    rightActive === 'inspector' || rightActive === 'changes' ? sizes.get(rightActive) : null;
  const rpMainW = rightActive
    ? rightMainWidth({ active: rightActive, base: rpSize.w, own: rightOwn })
    : 0;
  const rpW = rightPanelWidth({
    active: rightActive,
    base: rpSize.w,
    own: rightOwn,
    aiW: rightAiShown ? aiSlotW : 0,
  });
  const leftW = leftAiShown ? (leftActive ? Math.max(sbSize.w, aiSlotW) : aiSlotW) : sbSize.w;
  const rightGrip = gripTarget({
    active: rightActive,
    mainW: rpMainW,
    aiW: rightAiShown ? aiSlotW : 0,
    generic: 'rp',
  });
  const leftGrip = gripTarget({
    active: leftActive,
    mainW: leftActive ? sbSize.w : 0,
    aiW: leftAiShown ? aiSlotW : 0,
    generic: 'sb',
  });
  // Opening a panel while ⌘\ hides them brings them all back (the open panel must be seen). V2-4.4b — the AI
  // chat is its own island: its opening un-hides the panels like any other panel's does. P8 C5 — Preview's fold
  // is the mode's: an opening does not end it (`panelOpenDecision`); a right panel opened in it (Inspect on a
  // ⌘-click, Comments) shows by itself, the Canvases and AI chat panels stay folded.
  const shownRef = useRef({ l: leftActive, r: rightActive, ai: assistantOpen });
  useEffect(() => {
    const prev = shownRef.current;
    const next = { l: leftActive, r: rightActive, ai: assistantOpen };
    shownRef.current = next;
    const d = panelOpenDecision({
      prev,
      next,
      userHidden: panelsUserHidden,
      folded: panelsFolded,
      rightInFold,
      aiInFold,
    });
    if (d.rightInFold !== rightInFold) setRightInFold(d.rightInFold);
    if (d.aiInFold !== aiInFold) setAiInFold(d.aiInFold);
    if (d.show) panelLayout.show();
  }, [
    leftActive,
    rightActive,
    assistantOpen,
    panelsUserHidden,
    panelsFolded,
    rightInFold,
    aiInFold,
  ]);
  // P8 C8 (01 cf-open-big): the panels' hide key folds the canvas toolbar too (the project pill and the share
  // cluster follow it); every open frame hears it, a frame opened later is seeded on load.
  useEffect(() => {
    for (const el of iframesRef.current.values()) {
      try {
        // V2-8.9 defender L2 (C6): the frame's canvas origin, never '*'
        const origin = canvasTargetOrigin(el);
        if (origin)
          el.contentWindow.postMessage({ dgn: 'view-chrome', zen: panelsUserHidden }, origin);
      } catch {}
    }
  }, [panelsUserHidden, iframesRef]);
  const rightMainHidden = panelsHidden && !(rightInFold && !panelsUserHidden);
  const aiFoldShown = aiInFold && !panelsUserHidden && rightHostsAssistant && assistantOpen;
  const rightHidden = rightMainHidden && !aiFoldShown;
  // P8 c5 (03 ai-long-pinned): the chat docked as a column narrows the canvas frame - Fit the canvas to what is left
  useFitOnAiPin({
    iframesRef,
    aiPinned:
      pinned && !panelsHidden && assistantOpen && (leftHostsAssistant || rightHostsAssistant),
  });
  // P8 c6 (01 cf-ai-drafting): while an AI run of yours draws, the camera frames every artboard that has landed
  const { view: aiRunsView } = useAiRuns();
  useFitWhileAiDrafts({
    iframesRef,
    count: activeArtboards,
    working: yoursCount(aiRunsView) > 0,
  });
  useOccludedInsets({
    bodyRef,
    iframesRef,
    presenting: presentMode,
    layoutKey: `${pinned}|${panelsHidden}|${rightHidden}|${leftActive}|${rightActive}|${assistantOpen}|${leftW}|${rpW}`,
  });
  // V2-4.5c — the canvas toolbar's panels (Stickers, Assets) are the shell's: `toolbar-rect` +
  // `tool-panel-open`, active canvas only.
  // S4.4 — the Templates panel the Section tool's "Templates" slot opens (same gate as Stickers).
  const [templatesReq, setTemplatesReq] = useState(null);
  // S2.16 — the Component picker (⇧I): same gate, same anchoring as Stickers.
  const [componentsReq, setComponentsReq] = useState(null);
  // S7.20 — the F size picker (F over empty canvas): same gate, same anchoring.
  const [sizesReq, setSizesReq] = useState(null);
  useToolPanels({
    activePath,
    iframesRef,
    cfg,
    canEdit: !viewerMode,
    openStickers: setStickerPickerReq,
    closeStickers: () => setStickerPickerReq(null),
    openTemplates: setTemplatesReq,
    openComponents: setComponentsReq,
    openSizes: setSizesReq,
    openAssets: () => {
      panelLayout.show();
      openPanelExclusive('assets');
    },
  });
  // V2-8.5 c7 - the open panel reaches the canvas dock (Stickers · E, Image · I press while theirs is up)
  useShellPanelsRelay({
    stickersOpen: !!stickerPickerReq,
    assetsOpen,
    componentsOpen: !!componentsReq,
  });
  // S8.19 — "Waiting for Jonas's Mac" vs Missing: each open canvas hears its pictures' states
  // (dgn `asset-state`); a Missing frame's Relink… (and the Inspector's box) opens the relink sheet (S8.19c).
  const relink = useRelinkSheet({ canEdit: !viewerMode });
  useAssetStateLane({
    onRelink: relink.onRelink,
    syncStatus,
    wsConnected,
    canvasOrigin: () => cfg?.canvasOrigin || window.location.origin,
    activeWindow: () =>
      activePath ? (iframesRef.current.get(activePath)?.contentWindow ?? null) : null,
  });
  // The AI chat island's body. Always mounted (the island is `hidden`, not removed), so its stream survives
  // a Hide (DDR-123).
  const renderAssistant = () => (
    <ChatPanel
      hidden={!assistantOpen}
      activeCanvas={activeCanvasFile}
      selected={selected}
      openComments={activeOpenComments}
      // S5.8 — the scope chip's "this artboard" is the one the canvas view is on
      viewArtboardId={canvasActiveArtboard}
      designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
      resizing={resizingFor('assistant')}
      onClose={() => setAssistantOpen(false)}
      onBusyChange={setAssistantBusy}
      onFinished={handleAssistantFinished}
      onPermissionRequest={handleAssistantAttention}
      onElicitationRequest={handleAssistantAttention}
      // S5.12 — the chat list's role gate (a Can view session reads, never writes) and its project chip
      readOnly={viewerMode}
      projectName={cfg?.cloud?.projectName || project || ''}
    />
  );

  return (
    <div
      className={'maude' + (presentMode ? ' is-present' : '')}
      data-theme={theme}
      onContextMenu={onShellContextMenu}
    >
      {/* V2-4.8b — the top banners (sync diverged / rejected, role, update, repo changed, format gate) are
          callouts now, ONE stack. A child of `.maude`, not of `.sh-body`: Presentation mode must not hide a
          fail-closed sync warning (DDR-102, phase-28 audit F-1). */}
      <ShellCallouts />
      <ShellMentionCallouts />
      {/* First-upgrade consent (Task 2) — global on purpose: a consent that
          only appears if you happen to open the Sync panel is not consent.
          (S6.15: there is no first-run wizard to stack under any more.) */}
      <SyncConsentDialog status={syncStatus} cloud={cfg.cloud} />
      <NotificationHost
        paused={!!tourSteps}
        hiddenGroups={exportCenter.panelOpen ? ['exports'] : []}
      />
      <WhatsNewToast wn={whatsNew} />
      <ExportToast center={exportCenter} />
      <div className="sh-shell">
        {/* V2-4.1 — the canvas is the whole window body. Floating (default): the dock slots are
            `.island`s over it and the folded corner icons are the way back; pinned (View › Advanced):
            today's docked columns. ⌘\ hides every panel either way. Every island root carries
            `data-occludes` and the insets reach the canvas through useOccludedInsets. */}
        <div
          className={
            'sh-body' + (floating ? ' sh-body--float' : '') + (dragSide ? ' is-resizing' : '')
          }
          ref={bodyRef}
          style={{ '--sb-w': `${leftW}px`, '--rp-w': `${rpW}px` }}
        >
          <ShellProjectPill />
          {/* V2-4.7b — Menu › Diagnostics: Logs · Server · AI setup · Sync (today's Sync panel, whole). */}
          <DiagnosticsHost toast={shellToast} />
          {/* V2-4.3a — the Share cluster, top-right: faces, status word, comments, Exports, Hide panels, Share. */}
          <ShellShareCluster />
          {/* S2.20 — Menu › Edit › Undo history… (the ⌘Z projection's popover). */}
          <ShellUndoHistory />
          {/* S3.9 — Preview's own islands: "Previewing <canvas> · esc to edit" top centre, the zoom readout
              bottom left. Nothing in the other modes. */}
          <ShellPreviewChrome />
          {/* S8.16 — a generated picture selected: "Take 3 of 4" ‹ › ← → and "Picture made by AI". */}
          <ShellTakes />
          {/* S3.11 — Inspect: the specs of the element a ⌘-click (Preview) / click (Viewing) points at. */}
          <ShellInspectPanel />
          {/* S1.14 — "Viewing “…” · 5 Oct, 18:40 · Jonas · esc back to now" while the mode store holds a past version. */}
          <ViewBarHost activePath={activePath} />
          {/* S10.8 — "Update N canvases" (the design-system review) and the Canvases rows' update word. */}
          <DsReviewHost
            cfg={cfg}
            activePath={activePath}
            toast={shellToast}
            scope={project}
            reloadTree={loadTree}
            frameFor={() => (activePath ? iframesRef.current.get(activePath) : null)}
          />
          {/* S11.2 — "Your canvas is ready." on a canvas with no artboards, the empty-artboard hint, Ask AI to fill. */}
          <EmptyHost />
          {/* S7.7 — the timeline is an island tied to the selected video artboard (it was a bottom dock, DDR-148). */}
          <TimelineHost>
            <ShellTimelinePanel />
          </TimelineHost>
          {/* Round 11 (10 co-comment-video): Preview's read-only comment strip under a video board. */}
          <CommentStripHost />
          {/* S7.11 — the Transcript panel (left slot, Q17) and the feed that keeps a video's words fresh. */}
          <TranscriptHost />
          {/* S6.3 — the intent Home parked for this window (a canvas from one sentence, an import): taken once. */}
          <IntentHost />
          {/* S2.19 — ⌘/ on a selection: the bubble under it, and the asked line while AI works. */}
          <AskSelectionHost />
          {/* S9.24 — offline foot, the back-online toast, the "2 versions" mark and the conflict card. */}
          <SyncStatesHost />
          {/* LEFT dock slot (feature-configurable-panel-docking). V2-4.4b — Canvases · Layers · Assets keep a
              tab strip in the panel's OWN header; the AI chat, when docked here, is a separate island under it
              (always mounted, so its stream survives — DDR-123). Folded, the corner icon below is the way back. */}
          {(leftActive || leftHostsAssistant) && (
            <DockSlot
              side="left"
              width={leftW}
              mainWidth={leftW > sbSize.w ? sbSize.w : 0}
              open={!!leftActive}
              ids={leftIds}
              activeId={leftActive}
              onPick={togglePanel}
              onFold={() => leftActive && togglePanel(leftActive)}
              labels={dockLabels}
              floating={floating}
              hidden={panelsHidden}
              aiShown={leftHostsAssistant && assistantOpen}
              ai={leftHostsAssistant ? renderAssistant() : null}
            >
              {leftActive && renderPanelBody(leftActive)}
            </DockSlot>
          )}
          {(leftActive || (leftHostsAssistant && assistantOpen)) && !panelsHidden && (
            <PanelGrip
              label="Resize left panel"
              size={leftGrip === 'ai' ? sizes.handle('ai') : sbSize}
              active={dragSide === 'sb'}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                sizes.setTarget(leftGrip);
                setDragSide('sb');
              }}
            />
          )}
          <div className="main">
            <ShellViewport />
          </div>
          {(rightActive || (rightHostsAssistant && assistantOpen)) && !rightHidden && (
            <PanelGrip
              label="Resize right panel"
              dir="rtl"
              size={rightGrip === 'rp' ? rpSize : sizes.handle(rightGrip)}
              active={dragSide === 'rp'}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture?.(e.pointerId);
                sizes.setTarget(rightGrip);
                setDragSide('rp');
              }}
            />
          )}
          {/* RIGHT dock slot (feature-configurable-panel-docking). V2-4.4b — separate islands, no tab strip:
              the main island is Inspector / Comments / Changes / Sync (opening one replaces another; each has
              its own opener), the AI chat its own island, native-only. */}
          {(rightActive || rightHostsAssistant) && (
            <DockSlot
              side="right"
              width={rpW}
              mainWidth={rightMainWidth({ active: rightActive, base: rpSize.w, own: rightOwn })}
              open={!!rightActive && !rightMainHidden}
              ids={rightIds}
              activeId={rightActive}
              onPick={togglePanel}
              onFold={() => rightActive && togglePanel(rightActive)}
              labels={dockLabels}
              floating={floating}
              hidden={rightHidden}
              aiShown={rightAiShown}
              ai={rightHostsAssistant ? renderAssistant() : null}
            >
              {rightActive && renderPanelBody(rightActive)}
            </DockSlot>
          )}
          {/* V2-4.4b — the corner icons are the only way back for a panel that is not showing, in every layout:
              they replaced the pinned layout's old collapsed rail (Expand · Search · Files) along with it. */}
          <CornerIcons
            hidden={panelsHidden}
            folded={panelsFolded && !panelsUserHidden}
            leftActive={leftActive}
            rightActive={rightActive}
            leftIds={leftIds}
            rightIds={rightIds}
            assistant={
              leftHostsAssistant || rightHostsAssistant
                ? {
                    side: leftHostsAssistant ? 'left' : 'right',
                    shown: assistantOpen,
                    busy: assistantBusy,
                    inFold: aiFoldShown,
                  }
                : null
            }
            onShowAi={() => setAiInFold(true)}
            onOpen={openPanelExclusive}
            onShow={panelLayout.show}
          />
        </div>
      </div>
      {/* S3.2b — the only chrome Present shows: the controls (Artboards) or the pill (the canvas). It replaces
          the v1 `pv-present-exit` button; the pill keeps that class. */}
      {presentMode && <ShellPresentChrome />}
      {/* S3.6b — Presenter view on the Mac (only when the person turned it on and another display exists). */}
      {presentMode && <PresenterViewHost />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
      />
      {shellPromptState && (
        <div
          className="sh-scrim"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settleShellPrompt(null);
          }}
        >
          <div
            className="sh-dialog sh-prompt"
            role="dialog"
            aria-modal="true"
            aria-label={shellPromptState.title}
          >
            <div className="sh-dialog-hd">
              <span className="sh-dialog-title">{shellPromptState.title}</span>
            </div>
            <div className="sh-dialog-bd">
              <input
                className="sh-input"
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
                      e.currentTarget.closest('.sh-dialog')?.querySelector('input')?.value ?? ''
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
      {relink.sheet}
      {shareDialog && (
        <ShareSheet
          target={shareDialog}
          links={shareLinksFor(shareDialog.path)}
          shell={shareShell}
          project={cfg?.cloud?.projectName || project}
          onClose={() => setShareDialog(null)}
        />
      )}
      {exportDialog && (
        <ExportDialog
          mode={exportDialog.mode}
          initialScope={exportDialog.scope}
          request={exportDialog}
          designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
          projectName={cfg?.cloud?.projectName || cfg?.name || project || ''}
          // S8.9 — Can comment gets the sheet with one line on top; the server is the lock
          access={{ canEdit: !viewerMode, role: activeRole }}
          lastFinishedAt={exportLastFinishedAt}
          {...exportSelectionV2(selected, activePath)}
          activePath={activePath}
          // S8.7 — Show on canvas turns the dashed safe margin on only when it is off
          printGuidesVisible={printGuidesVisible}
          hasComps={activeComps.length > 0}
          comps={activeComps}
          // Which artboard "Active artboard" scope targets. The shell can't query
          // the cross-origin canvas DOM (the in-canvas dialog's activeArtboardId),
          // so use the tracked signals: an explicit selection wins, else the
          // viewport-active artboard canvas-lib reports on pan. Without this,
          // scope=artboard fell back to `:first-of-type` (always the first).
          {...exportSelectionFor(selected, activePath, canvasActiveArtboard)}
          exportLane={cfg.exportLane || 'local'}
          onBrowserCapture={captureFromCanvas}
          onQuerySelection={querySelectionFromCanvas}
          onClose={() => setExportDialog(null)}
        />
      )}
      {settingsOpen && <ShellSettingsPanel />}
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
          // S8.22b — the one line per arrival, and "Kept on this Mac" while a linked project is offline
          toast={shellToast}
          isOffline={() => importsWaitHereFrom({ cfg, syncStatus })}
        />
      )}
      {stickerPickerReq && (
        <StickersGallery
          onPick={onStickerPicked}
          onPickStamp={
            stickerPickerReq.replace ? undefined : (id) => onStickerPicked({ pack: 'stamps', id })
          }
          onClose={() => setStickerPickerReq(null)}
          anchor={stickerPickerReq.anchor ?? null}
        />
      )}
      {/* S4.14 — the vote bar + the Start a vote sheet for the active canvas (Gate 0 A18) */}
      <VoteHost
        iframesRef={iframesRef}
        activePath={activePath}
        canEdit={!viewerMode}
        role={activeRole}
        notify={notify}
      />
      {templatesReq && (
        <TemplatesPanel
          onPick={({ id }) => postToActiveCanvas({ dgn: 'insert-template', id, follow: true })}
          onDescribe={(text) => getPaletteEnv().askAI(text)}
          canAsk={getPaletteEnv().canAskAI()}
          onClose={() => setTemplatesReq(null)}
          anchor={templatesReq.anchor ?? null}
        />
      )}
      {componentsReq && (
        <ComponentPicker
          canvas={componentsReq.canvas}
          canEdit={!viewerMode}
          anchor={componentsReq.anchor ?? null}
          onPlace={(msg) => postToActiveCanvas(msg)}
          onPreview={(msg) => postToActiveCanvas(msg)}
          onOpenDesignSystem={openSystem}
          onClose={() => setComponentsReq(null)}
        />
      )}
      <SizePickerHost req={sizesReq} onClose={() => setSizesReq(null)} />
      {diffTarget && (
        <DiffView
          target={diffTarget}
          cfg={cfg}
          loadLog={loadDiffLog}
          onClose={() => setDiffTarget(null)}
          onRestore={async (file, version) => {
            const res = acceptedDiff
              ? await restoreProjectVersion(
                  file,
                  /^r\d+$/.test(version || '') ? Number(version.slice(1)) : NaN
                )
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
              window.alert(
                res.error || 'Could not finish the merge. Get the latest again, then retry.'
              );
            }
          }}
        />
      )}
      {/* S3.5 — Present ⌄ › Order and notes… (editors; the server refuses the rest) */}
      {orderNotesOpen && activePath && activePath !== SYSTEM_TAB && !viewerMode ? (
        <OrderNotesMount
          key={activePath}
          path={activePath}
          canvasName={displayName(basename(activePath))}
          onClose={() => setOrderNotesOpen(false)}
        />
      ) : null}
      <ShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        readOnly={viewerMode}
      />
      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onStartTour={() => {
          setHelpOpen(false);
          startTour(USAGE_TOUR);
        }}
        canAddGuides={!viewerMode}
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
      {/* S5.14: the shell's "Quit while AI is working?" (quit://ask) — desktop only. */}
      <QuitDialog />
      <WhatsNewPanel wn={whatsNew} onStartTour={startTour} />
      <ExportPanel
        center={exportCenter}
        projectName={cfg?.cloud?.projectName || cfg?.name || project || ''}
      />
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
          activePath={activePath}
        />
      )}
      {/* V2-4.9 — the first-run tour offers are callouts now (client/v2/shell/callouts-model.js tourCallout). */}
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

function App() {
  return (
    <ShellState>
      <ShellTree />
    </ShellState>
  );
}

// DDR-247 — `?embed=1` is a different root, not a mode of <App>: nothing the
// shell does (prefs, address bar, panels) runs inside another app's frame.
// V2-3.3 — so is Home (`/_config.mode === 'home'`, client/home/shell-mode.js).
const root = createRoot(document.getElementById('root'));
// S3.7a — a follow link (`?present=follow`, or any `audience` URL) is the follower page: never the editor.
// sec-a C3 — every root sits in the shell error boundary: one render throw shows a Reload card
// instead of unmounting the whole window.
if (isFollowLocation(location))
  root.render(
    <ShellErrorBoundary>
      <FollowView />
    </ShellErrorBoundary>
  );
else if (isEmbedLocation(location))
  root.render(
    <ShellErrorBoundary>
      <EmbedView />
    </ShellErrorBoundary>
  );
else {
  // S11.13 (Gate 0 D20) — the 1.x preferences move to their v2 homes once per origin, before the
  // first v2 home is read (a second boot is a no-op without a request). Bounded: a slow server
  // never holds the first paint, and a failure leaves the 1.x keys where they are.
  const migrated = migrateAtBoot().catch(() => {});
  Promise.race([migrated, new Promise((r) => setTimeout(r, 1500))]).then(() =>
    bootShellMode((mode) =>
      root.render(
        <ShellErrorBoundary>{mode === 'home' ? <HomeApp /> : <App />}</ShellErrorBoundary>
      )
    )
  );
}
