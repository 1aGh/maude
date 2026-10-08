// hooks/use-palette-and-panels.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useMemo } from 'react';
import { copyShareLink } from '../share-dialog.jsx';
import { isNativeApp } from '../github.js';
import { DOCK_PANELS, PANEL_SIDES_DEFAULTS } from '../shell/dock.jsx';
import { EMPTY_GROUPS, SYSTEM_TAB } from '../shell/constants.js';
import { openCount } from '../shell/util.js';
import { Sidebar } from '../tree/tree.jsx';
import GitPanel from '../panels/GitPanel.jsx';
import SyncPanel from '../panels/SyncPanel.jsx';
import { InspectorPanel } from '../inspector/inspector-panel.jsx';
import { CommentsPanel } from '../shell/comments-panel.jsx';

export function usePaletteAndPanels({
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
  restoreProjectVersion, dirtyByPath, openTab, openLinkedFile, sharePath, shareShell, shareLinksFor,
  showShare, openSystem, reloadActive, treeRefreshing, refreshTree, createBoard, createVideo,
  deleteBoard, moveCanvasReq, newFolderReq, deleteFolderReq, renameFolderReq, renameCanvasReq,
  duplicateCanvasReq, deleteFileReq, applyOptimisticStyle, recordSourceEdit, reorderLayer,
  detachInstanceShell, resizeArtboardShell, duplicateArtboardShell, setArtboardHugShell,
  setArtboardStyleShell, setArtboardKindShell, setArtboardPrintShell, onReplaceMedia, resolveComment,
  reopenComment, deleteComment, jumpToComment
}) {
  // ⌘K palette actions — shell-doable only (in-canvas export lives in the iframe).
  // T4 (Plan C) — grouped command set per `.design/ui/Studio.tsx` AB-D.
  // `group` drives the section headers; the list stays a flat array so keyboard
  // nav indexes straight across groups.
  const paletteActions = useMemo(
    () => [
      // ── Canvas ──────────────────────────────────────────────────────────
      {
        id: 'new',
        group: 'Canvas',
        label: 'New canvas…',
        icon: 'plus',
        kbd: 'N',
        run: () => {
          openPanelExclusive('tree');
          setTimeout(
            () => document.querySelector('[aria-label="New blank brief board"]')?.click(),
            60
          );
        },
      },
      {
        id: 'new-video',
        group: 'Canvas',
        label: 'New video…',
        icon: 'plus',
        run: () => createVideo(),
      },
      {
        id: 'export',
        group: 'Canvas',
        label: 'Export…',
        icon: 'download',
        kbd: '⇧⌘E',
        run: () => setExportDialog({ mode: 'export' }),
      },
      {
        id: 'share-link',
        group: 'Canvas',
        label: 'Copy share link',
        icon: 'link',
        run: () => { const links = shareLinksFor(sharePath); const link = links.web ?? links.app ?? links.local; if (link) copyShareLink(link); },
      },
      {
        id: 'handoff',
        group: 'Canvas',
        label: 'Handoff to production',
        icon: 'external',
        kbd: '⇧⌘H',
        run: () => setExportDialog({ mode: 'handoff' }),
      },
      {
        id: 'generate',
        group: 'Canvas',
        label: 'Generate with AI…',
        icon: 'sparkle',
        run: () => setGenerateOpen(true),
      },
      {
        id: 'settings',
        group: 'Canvas',
        label: 'Settings…',
        icon: 'sliders',
        kbd: '⌘,',
        run: () => setSettingsOpen(true),
      },
      // ── View ────────────────────────────────────────────────────────────
      {
        id: 'system',
        group: 'View',
        label: 'Open design system view',
        icon: 'sliders',
        kbd: 'S',
        run: () => openSystem(),
      },
      {
        id: 'comments',
        group: 'View',
        label: 'Toggle comments panel',
        icon: 'resolve',
        kbd: '⌘⇧M',
        run: () => toggleRightPanel('comments'),
      },
      {
        id: 'inspector',
        group: 'View',
        label: 'Open inspector',
        icon: 'sliders',
        kbd: '⌘⇧I',
        run: () => openRightPanel('inspector'),
      },
      {
        id: 'reload',
        group: 'View',
        label: 'Reload active canvas',
        icon: 'reload',
        kbd: '⌘R',
        run: () => reloadActive(),
      },
      // ── Tools ───────────────────────────────────────────────────────────
      {
        id: 'draw',
        group: 'Tools',
        label: 'Draw a mark with the SVG agent',
        icon: 'pen',
        run: () => {
          // The shell can't invoke Claude — surface the command for the user to
          // paste into Claude Code (clipboard is the honest, useful affordance).
          try {
            navigator.clipboard?.writeText('/design:draw ');
          } catch {}
        },
      },
      {
        id: 'theme',
        group: 'Tools',
        label: 'Toggle light / dark theme',
        icon: 'sun',
        run: () => toggleTheme(),
      },
      // ── Help ────────────────────────────────────────────────────────────
      {
        id: 'whatsnew',
        group: 'Help',
        label: "What's new in maude",
        icon: 'sparkle',
        run: () => whatsNew.openPanel(),
      },
      {
        id: 'shortcuts',
        group: 'Help',
        label: 'Keyboard shortcuts',
        icon: 'help',
        kbd: '?',
        run: () => setShortcutsOpen(true),
      },
      {
        id: 'help',
        group: 'Help',
        label: 'Help · commands & flows',
        icon: 'help',
        kbd: 'F1',
        run: () => setHelpOpen(true),
      },
      {
        id: 'report-bug',
        group: 'Help',
        label: 'Report a bug…',
        icon: 'help',
        run: () => setReportBugOpen(true),
      },
    ],
    [openSystem, toggleTheme, reloadActive, whatsNew, createVideo, sharePath, shareShell, cloudLinkedHub, localProjectName, cfg.designRel]
  );

  // feature-configurable-panel-docking — resolve, for each slot, the panels
  // assigned to it and which one is active (the open one). Layers is only a
  // dockable panel in `separate` mode; Assistant is native-only.
  const panelAvailable = (id) => {
    // The AGENT is genuinely absent for a viewer (it edits; Phase 25 C2).
    //
    // Inspector and Layers are NOT — Cloud Phase 27 C1 reversed that, and this
    // line had been left behind: `viewerHiddenPanels` stopped hiding them in
    // the View menu while this still refused to give them a dock slot, so the
    // menu offered a panel that could never appear. Read-only means cannot
    // CHANGE, not cannot SEE: a reviewer needs structure and measured values,
    // which is the whole reason C1 exists.
    if (viewerMode && id === 'assistant') return false;
    // feature-sync-progress-modal — the Sync panel only exists for a linked
    // project (solo has no hub, so the tab would open onto nothing).
    if (id === 'sync') return !!syncStatus;
    return id === 'assistant' ? isNativeApp() : id === 'layers' ? layersMode === 'separate' : true;
  };
  const idsForSide = (side) =>
    DOCK_PANELS.filter(
      (p) => panelAvailable(p.id) && (panelSide[p.id] || PANEL_SIDES_DEFAULTS[p.id]) === side
    ).map((p) => p.id);
  const panelIsOpen = {
    tree: sidebarOpen,
    layers: layersOpen,
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
  const leftIds = idsForSide('left');
  const rightIds = idsForSide('right');
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
    activePath && activePath !== SYSTEM_TAB && /\.(tsx|html)$/i.test(activePath) ? activePath : null;
  // Issue #74 — drives the chat panel's "Implement N comments" quick action.
  // Canvas-wide on purpose: the verb operates on every open comment of the
  // active canvas, so it is deliberately NOT scoped to the current selection.
  const activeOpenComments = activeCanvasFile
    ? openCount(commentsByFile[activeCanvasFile])
    : 0;

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
          onRefresh={refreshTree}
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
          onRestoreVersion={(revision) => restoreProjectVersion(activePath, revision).then((r) => !!r.ok)}
          // Not through a cell's door: every browser editor proposes under the
          // studio's one credential there, so "your own action" is not
          // knowable and the hub refuses the route (studio-manifest.mjs).
          onUndoAction={cellManaged ? undefined : async (actionId) => {
            const r = await fetch('/_api/project/undo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ actionId }),
            }).catch(() => null);
            const j = r ? await r.json().catch(() => null) : null;
            return !!j?.ok;
          }}
          // What the cloud half of the header names. The cell reports its own
          // project and branch with the log; the hub host is the fallback,
          // because a header that names the LOCAL folder while listing the
          // CLOUD's commits is the confusion this feature exists to end.
          cloudHistory={cloudHistory}
          onOpenCanvas={(p) => openTab(p)}
          onOpenDiff={(file) => setDiffTarget({ file, beforeSha: 'HEAD', conflict: false })}
          activeCanvas={activeCanvasFile}
          onPreviewVersion={(sha) => setDiffTarget({ file: activePath, beforeSha: sha, conflict: false })}
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
          hideLayersTab={layersMode === 'separate'}
          cpMode={cpMode}
          onSetCpMode={setCpMode}
          selected={selected}
          cfg={cfg}
          tab={id === 'layers' ? 'layers' : inspectorTab}
          onTabChange={setInspectorTab}
          onClose={() => (id === 'layers' ? setLayersOpen(false) : setInspectorOpen(false))}
          onOptimistic={applyOptimisticStyle}
          onRecordEdit={recordSourceEdit}
          onReplaceMedia={onReplaceMedia}
          onResizeArtboard={resizeArtboardShell}
          onSetArtboardHug={setArtboardHugShell}
          onSetArtboardStyle={setArtboardStyleShell}
          onSetArtboardKind={setArtboardKindShell}
          onSetArtboardPrint={setArtboardPrintShell}
          onDuplicateArtboard={duplicateArtboardShell}
          editScope={editScope}
          onUndoRedo={(dir) => postToActiveCanvas({ dgn: dir })}
          photoSel={photoSel}
          photoRev={photoRev}
          onPhotoEdit={onPhotoEdit}
          onPhotoRemoveBackground={onPhotoRemoveBackground}
          onPhotoRecordEdit={onPhotoRecordEdit}
          onPhotoUndoRedo={(dir) => performPhotoUndo(dir === 'redo')}
          layersTree={layersTree}
          componentMap={componentMap}
          lockedKeys={lockedKeys}
          onToggleLock={toggleLockedKey}
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
    activeCanvasFile, activeOpenComments, dockLabels, leftActive, leftHostsAssistant, leftIds,
    paletteActions, renderPanelBody, resizingFor, rightActive, rightHostsAssistant, rightIds
  };
}
