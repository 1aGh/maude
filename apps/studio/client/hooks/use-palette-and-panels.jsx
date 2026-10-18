// hooks/use-palette-and-panels.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect, useMemo, useRef } from 'react';
import { ACTIONS_BY_ID } from '../../actions/index.ts';
import { V1_PALETTE } from '../../actions/legacy.ts';
import { copyShareLink } from '../share-dialog.jsx';
import { menuRunner } from '../v2/shell/menu-runner.js';
import { panelAvailable as panelAvailableIn } from '../v2/shell/panel-availability.js';
import { keyHint, menuCtx, menuPaletteRows } from '../v2/shell/project-menu-model.js';
import { roleRefuses } from '../v2/shell/role-gate.js';
import { ROLE_DENIAL } from '../v2/shell/use-canvas-mode-lane.js';
import { bindPaletteEnv, sendToAskAI } from '../v2/search/search-env.js';
import { desktopProjectsEnv } from '../v2/search/search-projects.js';
import { actionSearchRows, settingsSearchRows } from '../v2/search/search-model.js';
import { isNativeApp, onMenuAction } from '../github.js';
import { DOCK_PANELS, PANEL_SIDES_DEFAULTS } from '../shell/dock.jsx';
import { EMPTY_GROUPS, SYSTEM_TAB } from '../shell/constants.js';
import { basename, displayName, openCount, shellToast } from '../shell/util.js';
import { planJump, JUMP_LADDER_MS, JUMP_NOW_MS } from '../v2/canvases/jump-model.js';
import { CANVAS_OP_EVENT } from '../v2/left-panel/left-panel-bus.js';
import { Sidebar } from '../tree/tree.jsx';
import { AssetsPanel } from '../v2/left-panel/assets-panel.jsx';
import GitPanel from '../panels/GitPanel.jsx';
import SyncPanel from '../panels/SyncPanel.jsx';
import { InspectorPanel } from '../inspector/inspector-panel.jsx';
import { layerOpMessage } from '../v2/inspector/layers-row-tools.jsx';
import { runUndoKey } from '../v2/undo/use-undo-projection.jsx';
import { CommentsPanel } from '../shell/comments-panel.jsx';

export function usePaletteAndPanels({
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
}) {
  // ⌘K palette actions — shell-doable only (in-canvas export lives in the iframe).
  // T4 (Plan C) — grouped command set per `.design/ui/Studio.tsx` AB-D.
  // `group` drives the section headers; the list stays a flat array so keyboard
  // nav indexes straight across groups. V2-2.4 — the rows (which actions, order,
  // group, label, icon, key) render from the action registry's v1 layout
  // (actions/legacy.ts `V1_PALETTE`); what each row RUNS stays v1's, keyed by
  // action id (the palette opened what the key toggles — Phase 4 unifies them).
  // S1.2 — "Copy link" on a canvas row, and its File-menu / ⌘K twins (`canvas.copy-link`, `canvas.trash`),
  // which reach here as a `maude:canvas-op` event from the menu runner (it holds no shell closures for
  // these). The link is the one Share offers today; S1.18's stable `…/c/<entry>` resolver replaces it.
  const copyCanvasLink = (path) => {
    const links = shareLinksFor(path);
    const link = links.web ?? links.app ?? links.local;
    if (link) copyShareLink(link);
  };
  const canvasOpRef = useRef(null);
  canvasOpRef.current = ({ op, path, label, artboardId }) => {
    if (!path) return;
    if (op === 'jump') {
      // S1.3 — a click in the Canvases panel's jump list: open the canvas if it is not the open one, then take
      // the camera to the artboard (glide + flash when the bridge has `reveal-artboard`, else today's jump).
      // A fresh frame mounts its listener late, so the post repeats on the ladder; every message is idempotent.
      const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      const plan = planJump({ activePath, path, artboardId, reducedMotion: reduced });
      if (plan.open) openTab(path);
      for (const delay of plan.open ? JUMP_LADDER_MS : JUMP_NOW_MS)
        for (const msg of plan.messages) setTimeout(() => postToActiveCanvas(msg), delay);
      return;
    }
    if (op === 'copy-link') copyCanvasLink(path);
    else if (op === 'trash') deleteBoard(path, label || displayName(basename(path)));
  };
  useEffect(() => {
    const on = (e) => canvasOpRef.current?.(e.detail || {});
    window.addEventListener(CANVAS_OP_EVENT, on);
    return () => window.removeEventListener(CANVAS_OP_EVENT, on);
  }, []);

  const paletteActions = useMemo(() => {
    const run = {
      'canvas.new': () => {
        openPanelExclusive('tree');
        setTimeout(
          () => document.querySelector('[aria-label="New blank brief board"]')?.click(),
          60
        );
      },
      'canvas.new-video': () => createVideo(),
      'export.open': () => setExportDialog({ mode: 'export' }),
      'share.copy-link': () => {
        const links = shareLinksFor(sharePath);
        const link = links.web ?? links.app ?? links.local;
        if (link) copyShareLink(link);
      },
      'handoff.open': () => setExportDialog({ mode: 'handoff' }),
      'ai.generate': () => setGenerateOpen(true),
      'settings.open': () => setSettingsOpen(true),
      'view.design-system': () => openSystem(),
      'view.comments': () => toggleRightPanel('comments'),
      'view.inspector': () => openRightPanel('inspector'),
      'canvas.reload': () => reloadActive(),
      'ai.draw-mark': () => {
        // The shell can't invoke Claude — surface the command for the user to
        // paste into Claude Code (clipboard is the honest, useful affordance).
        try {
          navigator.clipboard?.writeText('/design:draw ');
        } catch {}
      },
      'settings.theme': () => toggleTheme(),
      'help.whats-new': () => whatsNew.openPanel(),
      'help.shortcuts': () => setShortcutsOpen(true),
      'help.guides': () => setHelpOpen(true),
      'help.report-bug': () => setReportBugOpen(true),
    };
    const searchCtx = menuCtx({
      native: isNativeApp(),
      cloudTab: !!cfg.cloud, // V2-4.8a: "Back to Home" and "Sign out" are a cloud tab's rows
      readOnly: viewerMode,
      canvasOpen: !!activePath && activePath !== SYSTEM_TAB,
    });
    // V2-4 gate (design blocker 6): a row's key is the registry's live chord in this shell, written by
    // `formatChord` (⌥⇧⌘), or none — never v1's display string (New canvas "N" was Sticky's key, the
    // design-system "S" retired, "⌘⇧M" the wrong modifier order).
    const keyOf = (id) => keyHint(ACTIONS_BY_ID.get(id), searchCtx);
    const v1 = V1_PALETTE.map((r) => {
      const kbd = keyOf(r.id);
      return {
        id: r.id,
        group: r.group,
        label: ACTIONS_BY_ID.get(r.id).legacy.palette,
        icon: r.icon,
        ...(kbd ? { kbd } : {}),
        run: run[r.id],
      };
    });
    // V2-4.2 — ⌘K finds every row of the project menu too: typing a word finds the menu's row for it
    // (the list with nothing typed stays v1's). Same runner as the pill, so a row and its ⌘K twin
    // are one function.
    const menuRows = menuPaletteRows(searchCtx, { existing: v1, run: (id) => menuRunner.run(id) });
    // V2-4.6 — Search ⌘K: the registry's visible actions + the toolbars' tools + the Settings rows, each
    // with its where-path (v2/search). A row runs through the one menu runner; the few v1 palette
    // closures the runner has no handler for (theme, New video, Generate…) are its fallback, not a
    // second dispatcher. Runnable is asked when the list opens: the runner binds after this first render.
    const runAction = (id) => (menuRunner.canRun(id) ? menuRunner.run(id) : run[id]?.());
    const searchRows = [
      ...actionSearchRows(searchCtx, {
        eager: false,
        isRunnable: (id) => menuRunner.canRun(id) || typeof run[id] === 'function',
        run: runAction,
      }),
      ...settingsSearchRows({
        cloud: cfg.cloud,
        readOnly: viewerMode,
        run: (section) => setSettingsOpen(section),
      }),
    ].map((r) => ({ ...r, onlyWhenSearched: true }));
    // V2-4.4a — ⌘K "Trash" and "Refresh tree" (CONTRACT §1 C10, §2 ⇧⌘R). Neither is a menu row; both are
    // the left panel's. Same runner as the panel's own controls.
    const leftRows = [
      {
        id: 'canvases.refresh',
        actionId: 'canvases.refresh',
        group: 'Canvases',
        label: 'Refresh tree',
        icon: 'chevron-right',
        kbd: keyOf('canvases.refresh'),
        run: () => refreshTree(),
        onlyWhenSearched: true,
      },
      ...(viewerMode
        ? []
        : [
            {
              id: 'view.trash',
              actionId: 'view.trash',
              group: 'Canvases',
              label: 'Trash',
              icon: 'chevron-right',
              run: () => menuRunner.run('view.trash'),
              onlyWhenSearched: true,
            },
          ]),
    ];
    return [...v1, ...menuRows, ...leftRows, ...searchRows];
  }, [
    cfg.cloud,
    viewerMode,
    activePath,
    openSystem,
    toggleTheme,
    reloadActive,
    whatsNew,
    createVideo,
    sharePath,
    shareShell,
    cloudLinkedHub,
    localProjectName,
    cfg.designRel,
    refreshTree,
  ]);

  // V2-4.6 — what ⌘K needs from the shell besides rows: open a canvas (and its artboard), hand a query to
  // the AI chat (desktop only — the chat panel is native), where the design root is.
  useEffect(
    () =>
      bindPaletteEnv({
        // S1.5: the other projects' groups — the desktop app's tabs only ({} in a browser tab)
        ...desktopProjectsEnv({ projectName: cfg?.cloud?.projectName || project || '' }),
        designRel: cfg.designRel,
        canAskAI: () => isNativeApp() && !viewerMode,
        askAI: (text) => {
          openPanelExclusive('assistant');
          sendToAskAI(text);
        },
        openCanvas: (path, artboardId) => {
          openTab(path);
          // the canvas mounts a moment later; select the artboard the way a tree click settles one
          if (artboardId)
            for (const delay of [400, 1200, 2800])
              setTimeout(() => postToActiveCanvas({ dgn: 'select-by-id', artboardId }), delay);
        },
      }),
    [
      cfg.designRel,
      cfg?.cloud?.projectName,
      project,
      viewerMode,
      openPanelExclusive,
      openTab,
      postToActiveCanvas,
    ]
  );

  // Native menu items whose registry action runs in the webview (`menu://action {id}`,
  // V2-1.3 §5.8 — File ▸ New Canvas, Help ▸ Report a Bug…) run the palette's row for that
  // id. `project.new` is IdentityBar's (its dialog state lives there).
  const paletteRef = useRef(paletteActions);
  paletteRef.current = paletteActions;
  const viewerRef = useRef(viewerMode);
  viewerRef.current = viewerMode;
  useEffect(() => {
    if (!isNativeApp()) return undefined;
    const p = onMenuAction((id) => {
      // V2-4 gate (roles): AppKit draws File ▸ New Canvas ⌘N without knowing the hub role, so a
      // Can comment person's press is answered here with the one denial line (role-gate.js).
      const ctx = menuCtx({ native: true, readOnly: !!viewerRef.current, canvasOpen: true });
      if (roleRefuses(ACTIONS_BY_ID.get(id), ctx)) {
        shellToast(ROLE_DENIAL);
        return;
      }
      paletteRef.current.find((a) => a.id === id)?.run?.();
    });
    return () => {
      p?.then?.((fn) => fn?.());
    };
  }, []);

  // feature-configurable-panel-docking — resolve, for each slot, the panels
  // assigned to it and which one is active (the open one). Layers is only a
  // dockable panel in `separate` mode; Assistant is native-only.
  // The rule — what a read-only session lacks, and why Inspector and Layers are NOT among it (Cloud
  // Phase 27 C1) — is panel-availability.js; the shell parity table (V2-4.9) reads the same one.
  const panelAvailable = (id) =>
    panelAvailableIn(id, { viewerMode, native: isNativeApp(), layersMode, hasSync: !!syncStatus });
  const idsForSide = (side) =>
    DOCK_PANELS.filter(
      (p) => panelAvailable(p.id) && (panelSide[p.id] || PANEL_SIDES_DEFAULTS[p.id]) === side
    ).map((p) => p.id);
  const panelIsOpen = {
    tree: sidebarOpen,
    layers: layersOpen,
    assets: assetsOpen,
    inspector: inspectorOpen,
    comments: commentsPanelOpen,
    changes: changesOpen,
    sync: syncPanelOpen,
    assistant: assistantOpen,
  };
  // Per-shell overrides for the dock tab strip. In a cell the `changes` panel
  // IS the history (the hub commits server-side), so its tab must say so —
  // otherwise the one visible word still promises a working-tree surface that
  // panel no longer has.
  const dockLabels = cfg.cloud ? { changes: 'History' } : null;
  // V2-4.4b — the AI chat is its own island (CONTRACT §7), not one of a side's tabbed panels: the ids and
  // the "active" panel below are the side's MAIN panel only; `leftHostsAssistant` / `rightHostsAssistant`
  // say which side the chat island sits on, `assistantOpen` whether it shows.
  const leftIds = idsForSide('left').filter((id) => id !== 'assistant');
  const rightIds = idsForSide('right').filter((id) => id !== 'assistant');
  const leftActive = leftIds.find((id) => panelIsOpen[id]) || null;
  const rightActive = rightIds.find((id) => panelIsOpen[id]) || null;
  // Cloud Phase 25 C2 — the Assistant edits; a viewer's session never mounts it.
  const leftHostsAssistant =
    isNativeApp() && !viewerMode && (panelSide.assistant || 'right') === 'left';
  const rightHostsAssistant =
    isNativeApp() && !viewerMode && (panelSide.assistant || 'right') === 'right';
  const resizingFor = (id) =>
    (panelSide[id] || PANEL_SIDES_DEFAULTS[id]) === 'left' ? dragSide === 'sb' : dragSide === 'rp';
  const activeCanvasFile =
    activePath && activePath !== SYSTEM_TAB && /\.(tsx|html)$/i.test(activePath)
      ? activePath
      : null;
  // Issue #74 — drives the chat panel's "Implement N comments" quick action.
  // Canvas-wide on purpose: the verb operates on every open comment of the
  // active canvas, so it is deliberately NOT scoped to the current selection.
  const activeOpenComments = activeCanvasFile ? openCount(commentsByFile[activeCanvasFile]) : 0;

  // Render a panel body by id (width undefined ⇒ fills the .st-dockslot wrapper,
  // which owns the resizable width). Assistant is handled separately below as an
  // always-mounted ChatPanel so its stream survives a tab switch.
  const renderPanelBody = (id) => {
    // C1 again, the second half of the same gate. The panels MOUNT for a
    // viewer; what they must not do is offer an edit, and that is already
    // handled inside them (`readOnly` is threaded through every control).
    // Refusing to mount was a blunter instrument than the role model asks for.

    if (id === 'tree')
      return (
        <Sidebar
          cloud={cfg.cloud}
          readOnly={viewerMode}
          // Held back until the remembered disclosure is read, so the first
          // paint is the user's tree rather than an all-closed flash (#124).
          groups={treeExp.ready ? groups : EMPTY_GROUPS}
          activePath={activePath}
          previewPath={previewPath}
          activeDsName={activePath === SYSTEM_TAB ? (systemData?.ds?.name ?? null) : null}
          onOpen={openTab}
          onPreview={onPreview}
          onOpenLinkedFile={openLinkedFile}
          filesReady={treeLoaded}
          treeLoadFailures={treeLoadFailures}
          onShare={showShare}
          onOpenSystem={openSystem}
          wsConnected={wsConnected}
          search={search}
          setSearch={setSearch}
          commentsByFile={commentsByFile}
          showHidden={showHidden}
          sectionsExpanded={sectionsExpanded}
          onToggleSection={toggleSection}
          treeExpansion={treeExpansion}
          onNewBoard={createBoard}
          onDeleteBoard={deleteBoard}
          onMoveCanvas={moveCanvasReq}
          onNewFolder={newFolderReq}
          onDeleteFolder={deleteFolderReq}
          onRenameFolder={renameFolderReq}
          onRenameCanvas={renameCanvasReq}
          onDuplicateCanvas={duplicateCanvasReq}
          onDeleteFile={deleteFileReq}
          onCopyLink={copyCanvasLink}
          // S1.3 — the artboard in view on the open canvas, so the jump list can highlight it
          activeArtboard={(() => {
            const sel = Array.isArray(selected) ? selected[0] : selected;
            return sel && sel.file === activePath ? (sel.artboardId ?? null) : null;
          })()}
          onRefresh={refreshTree}
          onToggleShowHidden={() => menuRunner.run('view.hidden-files')}
          refreshing={treeRefreshing}
          collapsed={false}
          onCollapse={() => togglePanel('tree')}
          resizing={resizingFor('tree')}
          dirtyByPath={dirtyByPath}
          project={project}
          gitBranch={gitStatus?.branch}
          remoteSync={remoteSync}
          onGetLatest={gitGetLatest}
          canvasKinds={cfg?.canvasKinds}
          syncStatus={syncStatus}
          onLinkedHub={setCloudLinkedHub}
          onLocalProject={setLocalProjectName}
          savingIsManaged={savingIsManaged}
        />
      );
    // V2-4.4a — the left panel's third tab. Lists today's asset library (the Choose-media dialog's list).
    if (id === 'assets')
      return (
        <AssetsPanel
          designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
          readOnly={viewerMode}
        />
      );
    if (id === 'changes')
      return (
        <GitPanel
          status={gitStatus && remoteSync ? { ...gitStatus, ...remoteSync } : gitStatus}
          project={project}
          readOnly={!isNativeApp() || viewerMode}
          // A cloud cell commits every edit server-side as it lands, so the
          // working-tree half of this panel describes work that is already
          // saved. `cfg.cloud` is present exactly when the hub runs the
          // workspace agent that owns this project's history, which is the
          // same condition.
          //
          // PRESENTATION, NOT A CONTROL — nothing may come to depend on this.
          // `/_api/git/commit` and `/_api/git/discard` are classified `edit` in
          // the cell's route manifest and stay reachable by any member with a
          // session; withdrawing the buttons removes an offer that would
          // mislead, it does not remove a capability. The real gates are
          // server-side (`projectReadOnly`, the manifest's role matrix), and
          // they are unchanged by this flag.
          historyOnly={cellManaged}
          // DDR-218 (fix 8) — the DESKTOP half of the same withdrawal: a repo
          // linked+credentialed to Maude Cloud is cloud-managed (the cell
          // commits every edit as it lands), so the local Changes surface is
          // the second save mechanism the sync RCA's user was confused by.
          // Live: CloudBar lifts every link change (resolve/attach/detach)
          // into `cloudLinkedHub`. Same presentation-not-a-control rule as
          // `historyOnly` above; Disconnect restores the panel in place.
          cloudManaged={cloudManaged}
          resizing={resizingFor('changes')}
          onClose={() => setChangesOpen(false)}
          onCommit={gitCommit}
          onDiscard={gitDiscard}
          onPublish={gitPublish}
          onGetLatest={gitGetLatest}
          // WHICH HISTORY, decided at the ONE place the posture is named — not
          // inside the panel, which would be a second derivation of the rule
          // `cloud-managed-save-surfaces.test.ts` exists to keep singular.
          loadLog={async (path) => {
            // The project's accepted history when it has one; Git otherwise.
            const accepted = await loadAcceptedLog(path);
            setProjectHistoryOn(accepted !== 'legacy');
            if (accepted !== 'legacy') return accepted;
            return (cloudManaged ? gitLoadCloudLog : gitLoadLog)(path);
          }}
          historySource={projectHistoryOn ? 'project' : cloudManaged ? 'cloud' : 'local'}
          historyRefresh={`${syncStatus?.appliedRevision ?? 0}:${projectHistoryRefresh}`}
          onRestoreVersion={(revision) =>
            restoreProjectVersion(activePath, revision).then((r) => !!r.ok)
          }
          // Not through a cell's door: every browser editor proposes under the
          // studio's one credential there, so "your own action" is not
          // knowable and the hub refuses the route (studio-manifest.mjs).
          onUndoAction={
            cellManaged
              ? undefined
              : async (actionId) => {
                  const r = await fetch('/_api/project/undo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actionId }),
                  }).catch(() => null);
                  const j = r ? await r.json().catch(() => null) : null;
                  return !!j?.ok;
                }
          }
          // What the cloud half of the header names. The cell reports its own
          // project and branch with the log; the hub host is the fallback,
          // because a header that names the LOCAL folder while listing the
          // CLOUD's commits is the confusion this feature exists to end.
          cloudHistory={cloudHistory}
          onOpenCanvas={(p) => openTab(p)}
          onOpenDiff={(file) => setDiffTarget({ file, beforeSha: 'HEAD', conflict: false })}
          activeCanvas={activeCanvasFile}
          onPreviewVersion={(sha) =>
            setDiffTarget({ file: activePath, beforeSha: sha, conflict: false })
          }
          designRel={(cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '')}
        />
      );
    if (id === 'sync')
      return (
        <SyncPanel
          status={syncStatus}
          project={cfg?.cloud?.projectName || project}
          cloud={cfg?.cloud ?? null}
          groupPaths={(groups || []).map((g) => g.path).filter(Boolean)}
          resizing={resizingFor('sync')}
          onClose={() => setSyncPanelOpen(false)}
        />
      );
    if (id === 'inspector' || id === 'layers')
      return (
        <InspectorPanel
          // Cloud Phase 27 E4 — the parity spec asserts these two panels exist
          // in BOTH shells, so each needs a name a spec can ask for.
          testId={id === 'layers' ? 'layers-panel' : 'inspector-panel'}
          layersOnly={id === 'layers'}
          artboardCount={id === 'layers' ? activeArtboards : undefined}
          hideLayersTab={layersMode === 'separate'}
          selected={selected}
          cfg={cfg}
          tab={id === 'layers' ? 'layers' : inspectorTab}
          onTabChange={setInspectorTab}
          onClose={() => (id === 'layers' ? setLayersOpen(false) : setInspectorOpen(false))}
          onOptimistic={applyOptimisticStyle}
          onRecordEdit={recordSourceEdit}
          // S2.11b — the Position row's pins ask the canvas for one `object.constrain` (run-action)
          onRunAction={postToActiveCanvas}
          onReplaceMedia={onReplaceMedia}
          onResizeArtboard={resizeArtboardShell}
          onSetArtboardHug={setArtboardHugShell}
          onSetArtboardStyle={setArtboardStyleShell}
          onSetArtboardKind={setArtboardKindShell}
          onSetArtboardPrint={setArtboardPrintShell}
          onDuplicateArtboard={duplicateArtboardShell}
          editScope={editScope}
          onUndoRedo={(dir) =>
            // V2-2.4 retired the canvas's `undo`/`redo` lanes for run-action; the inspector
            // knobs' ⌘Z rides the same lane (it reached no handler after step 6 — V2-2.10).
            // S2.20 — the ⌘Z projection first; the canvas stack only off the op log.
            void runUndoKey(activePath, dir === 'redo', () =>
              postToActiveCanvas({
                dgn: 'run-action',
                v: 1,
                id: dir === 'redo' ? 'edit.redo' : 'edit.undo',
              })
            )
          }
          photoSel={photoSel}
          photoRev={photoRev}
          onPhotoEdit={onPhotoEdit}
          onPhotoRemoveBackground={onPhotoRemoveBackground}
          onPhotoRecordEdit={onPhotoRecordEdit}
          onPhotoUndoRedo={(dir) => performPhotoUndo(dir === 'redo')}
          layersTree={layersTree}
          componentMap={componentMap}
          lockedKeys={lockedKeys}
          // S2.6 — lock and hide are shared edits in the TSX (`object.lock` / `object.hide`), run by the
          // canvas like the object menu's; an old per-user padlock (view.json) still unlocks the old way.
          onToggleLock={(key, node) =>
            !node?.locked && lockedKeys.has(key)
              ? toggleLockedKey(key)
              : postToActiveCanvas(
                  layerOpMessage('object.lock', node, layersTree?.artboardId ?? '', !node.locked)
                )
          }
          onToggleHide={(node, hide) =>
            postToActiveCanvas(
              layerOpMessage('object.hide', node, layersTree?.artboardId ?? '', hide)
            )
          }
          onDetachInstance={detachInstanceShell}
          canvasFile={activePath}
          onSelectLayer={(n) =>
            postToActiveCanvas({
              dgn: 'select-by-id',
              id: n.id,
              artboardId: layersTree?.artboardId,
              index: n.index,
            })
          }
          onHoverLayer={(n) =>
            postToActiveCanvas({
              dgn: 'highlight',
              id: n ? n.id : null,
              artboardId: layersTree?.artboardId,
              index: n ? n.index : 0,
            })
          }
          onReorderLayer={reorderLayer}
          layersBusyRef={layersBusyRef}
          resizing={resizingFor(id)}
        />
      );
    if (id === 'comments')
      return (
        <CommentsPanel
          commentsByFile={commentsByFile}
          filter={commentsFilter}
          setFilter={setCommentsFilter}
          activePath={activePath}
          focusedId={focusedCommentId}
          onJump={jumpToComment}
          // Cloud Phase 25 C2 — a viewer READS threads; the mutating actions
          // are absent until C3 lands comments on the cell's allowlist.
          onResolve={viewerMode ? undefined : resolveComment}
          onReopen={viewerMode ? undefined : reopenComment}
          onDelete={viewerMode ? undefined : deleteComment}
          resizing={resizingFor('comments')}
        />
      );
    return null;
  };
  return {
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
  };
}
