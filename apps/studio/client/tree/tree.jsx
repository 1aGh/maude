// tree/tree.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import {
  displayName,
  filterTree,
  groupBySidecar,
  openCount,
  pathTestIdSlug,
  previewKind,
  sectionDefaultOpen,
} from '../shell/util.js';
import { Icon, Kbd, StIcon } from '../shell/icons.jsx';
import { FileTree, FileTreeItem } from '../file-tree.jsx';
import { CANVAS_EXT_RE, SYSTEM_TAB } from '../shell/constants.js';
import { prefetchPreviewImage } from '../panels/file-preview.jsx';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTreeDrag } from '../use-tree-drag.js';
import { TreeRowMenu, useRowMenu } from '../tree-row-menu.jsx';
import RepoBranchSwitcher from '../panels/RepoBranchSwitcher.jsx';
import CloudBar from '../panels/CloudBar.jsx';
import IdentityBar from '../panels/IdentityBar.jsx';

// ───── Tree (CV-08 spec) ─────
// File rows use `.tp-row` with optional .dir / .sel / .star / .modified
// modifiers + a leading `.glyph` (▾ open dir, ▸ closed dir / selected file,
// · file). Section headers use `.tp-section-hd` with a `.pill` counter.
// The flat-row model (vs the old nested <details>) mirrors the mock and
// keeps padding-left under explicit control per depth level.

export const TREE_INDENT_BASE = 12;

export const TREE_INDENT_STEP = 16;

// Issue #124 — disclosure is CONTROLLED: `expansion` is App's tree state (see
// tree-expansion.js), so a collapse outlives this row's unmount (dock-tab
// switch, section toggle, reload). `forceOpen` = an active search; it shows
// the hits without recording anything.
export function DirRow({ name, depth, children, dirPath, drag, menu, expansion, forceOpen }) {
  const open = !!forceOpen || !!expansion?.isOpen(dirPath);
  const setOpen = (v) => {
    if (forceOpen) return; // search is showing hits — don't record a choice
    const next = typeof v === 'function' ? v(open) : v;
    if (next !== open) expansion?.setOpen(dirPath, next);
  };
  // feature-file-tree-drag-drop-folders (Task 8) — a folder row IS the drop
  // target. `drag` is undefined for groups that can't accept a move (the
  // design-system group) — no handlers attach there, so the browser's default
  // "no drop" cursor applies with zero extra code. Spring-load reopens a
  // closed folder after a sustained hover; `setOpen` is this row's OWN local
  // state, which is why the callback lives here rather than in the hook.
  const dropHandlers = drag ? drag.dropProps(dirPath, true, () => setOpen(true)) : {};
  const isOver = drag?.overDir === dirPath;
  // feature-file-tree-drag-drop-folders (Task 11) — a folder is ALSO a drag
  // SOURCE (drag folder onto folder). No client-side branching needed beyond
  // this: the payload is just `dirPath` (no `.tsx` suffix), and the server's
  // moveCanvas auto-detects a non-.tsx source as a folder move.
  const dragHandlers = drag ? drag.dragProps(dirPath, true) : {};
  const isDragging = drag?.draggedPath === dirPath;
  const isBusy = drag?.busyPath === dirPath;
  const row = (
    <button
      type="button"
      role="treeitem"
      data-testid={`tree-folder-${pathTestIdSlug(dirPath)}`}
      aria-expanded={open}
      aria-dropeffect={drag ? 'move' : undefined}
      aria-busy={isBusy || undefined}
      tabIndex={-1}
      className={
        'st-row' +
        (isOver ? ' is-drop-target' : '') +
        (isDragging ? ' is-dragging' : '') +
        (isBusy ? ' is-busy' : '')
      }
      style={{ paddingLeft: TREE_INDENT_BASE + depth * TREE_INDENT_STEP + 'px' }}
      onClick={() => setOpen((v) => !v)}
      onContextMenu={menu ? (e) => menu.openAt(e, { kind: 'dir', dirPath }) : undefined}
      {...dragHandlers}
      {...dropHandlers}
    >
      <span className="st-row-glyph">
        <StIcon name="chevron-right" className={'st-chev' + (open ? ' is-open' : '')} size={13} />
      </span>
      <span className="st-row-name">{name}</span>
    </button>
  );
  return (
    <FileTreeItem
      label={name}
      row={row}
      expanded={open}
      busy={isBusy}
      onToggle={() => setOpen((v) => !v)}
      actions={
        menu ? (
          <button
            type="button"
            className="st-row-menu-btn"
            data-testid={`tree-row-menu-${pathTestIdSlug(dirPath)}`}
            title={`Folder actions — ${name}`}
            aria-label={`Folder actions for ${name}`}
            aria-haspopup="menu"
            onClick={(e) => menu.openAt(e, { kind: 'dir', dirPath })}
          >
            <Icon
              d="M12 6a1 1 0 100-2 1 1 0 000 2zM12 13a1 1 0 100-2 1 1 0 000 2zM12 20a1 1 0 100-2 1 1 0 000 2z"
              size={12}
            />
          </button>
        ) : null
      }
    >
      {open && children}
    </FileTreeItem>
  );
}

// DsFolderRow — a per-DS folder inside the DESIGN SYSTEM section.
// Split target: chevron toggles disclosure of the folder's contents; clicking
// the folder name opens the SystemView focused on that DS (single SystemView
// for now; the dsName is plumbed through so a future per-DS view can use it).
export function DsFolderRow({
  name,
  dsName,
  dirPath,
  depth,
  active,
  onOpenSystem,
  children,
  expansion,
  forceOpen,
}) {
  const open = !!forceOpen || !!expansion?.isOpen(dirPath);
  const setOpen = (v) => {
    if (forceOpen) return; // search is showing hits — don't record a choice
    const next = typeof v === 'function' ? v(open) : v;
    if (next !== open) expansion?.setOpen(dirPath, next);
  };
  return (
    <FileTreeItem
      label={name}
      expanded={open}
      selected={active}
      onToggle={() => setOpen((v) => !v)}
      row={
        <div
          className={'st-row st-ds-folder' + (active ? ' is-sel' : '')}
          style={{ paddingLeft: TREE_INDENT_BASE + depth * TREE_INDENT_STEP + 'px' }}
        >
          <button
            type="button"
            className="st-ds-chev"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse design system' : 'Expand design system'}
            title={open ? 'Collapse' : 'Expand'}
          >
            <StIcon
              name="chevron-right"
              className={'st-chev' + (open ? ' is-open' : '')}
              size={13}
            />
          </button>
          <button
            type="button"
            className="st-ds-open"
            data-tree-primary=""
            tabIndex={-1}
            onClick={() => onOpenSystem(dsName)}
            aria-label={`Open ${dsName} design system view`}
            title="Open the design system view"
          >
            <span className="st-row-glyph">
              <StIcon name="folder" size={13} />
            </span>
            <span className="st-row-name">{name}</span>
          </button>
        </div>
      }
    >
      {open && children}
    </FileTreeItem>
  );
}

export function FileRow({
  file,
  activePath,
  previewPath,
  onOpen,
  onPreview,
  onDelete,
  openCount: oc,
  depth,
  kind,
  sidecar,
  dirty,
  experimentalKind,
  drag,
  menu,
}) {
  // feature-studio-file-preview (a11y fix) — a previewed row must expose
  // aria-selected too, or a screen-reader user gets no confirmation their
  // click did anything (a11y-auditor finding: state never changed).
  const isSel = file.path === activePath || file.path === previewPath;
  const isCanvas = CANVAS_EXT_RE.test(file.name);
  // feature-studio-file-preview — RUNTIME rows (_active.json, _server.json, …)
  // stay inert no matter their extension: they're gitignored process state,
  // never user-facing content, and must not become previewable just because
  // `.json` also matches the `text` preview kind (DDR-115 exclusion).
  const pKind = !isCanvas && kind !== 'runtime' ? previewKind(file.name) : null;
  // Non-canvas, non-previewable rows (RUNTIME files, unrecognized extensions)
  // are display-only — clicking them doesn't open anything; we leave the
  // click as no-op + cursor hint via `aria-disabled`.
  const inert = !isCanvas && !pKind;
  const label = isCanvas ? displayName(file.name) : file.name;
  // Delete only real canvases in a deletable group (onDelete is undefined for the
  // DS group + runtime files); the server enforces the rest.
  const canDelete = isCanvas && typeof onDelete === 'function' && kind !== 'runtime';
  // feature-file-tree-drag-drop-folders (Task 8) — only real canvas primaries
  // (never sidecars, never runtime rows) are draggable; `drag` is undefined
  // for groups that can't be a move source (the design-system group).
  const draggableRow = isCanvas && !sidecar && kind !== 'runtime' && typeof drag !== 'undefined';
  const dragHandlers = draggableRow ? drag.dragProps(file.path, true) : {};
  const isDragging = drag?.draggedPath === file.path;
  const isBusy = drag?.busyPath === file.path;
  // feature-file-tree-drag-drop-folders (Task 9) — the KEYBOARD path for
  // "Move to…" (drag-only fails WCAG 2.1.1). Same eligibility as dragging.
  const canMove = draggableRow && typeof menu !== 'undefined';
  // Plan T17/L03 — a supporting file (notes, styles, images, media) in a
  // canvas folder gets the same ⋯ menu: rename, move, delete.
  const supporting = !isCanvas && !!pKind && !sidecar && typeof menu !== 'undefined';
  const canShare = typeof menu !== 'undefined' && kind !== 'runtime';
  const fileDir = file.path.split('/').slice(0, -1).join('/');
  // Stable hook for the desktop E2E harness (data-testid convention — see the
  // `desktop-e2e` skill): canvas rows only, slug derived from the relative path
  // (e.g. `ui/Smoke.tsx` → `canvas-row-ui-smoke`).
  const testId = isCanvas
    ? 'canvas-row-' +
      file.path
        .replace(/^\.[^/]+\//, '') // strip the leading designRoot dot-folder (.design/)
        .replace(CANVAS_EXT_RE, '')
        .replace(/[^a-z0-9]+/gi, '-')
        .toLowerCase()
        .replace(/^-+|-+$/g, '')
    : undefined;
  const row = (
    <button
      type="button"
      role="treeitem"
      data-testid={testId ?? (supporting ? `file-row-${pathTestIdSlug(file.path)}` : undefined)}
      aria-selected={isSel}
      aria-disabled={inert ? 'true' : undefined}
      aria-busy={isBusy || undefined}
      tabIndex={isSel ? 0 : -1}
      className={
        'st-row' +
        (isSel ? ' is-sel' : '') +
        (kind === 'runtime' ? ' is-muted' : '') +
        (isDragging ? ' is-dragging' : '') +
        (isBusy ? ' is-busy' : '')
      }
      style={{ paddingLeft: TREE_INDENT_BASE + depth * TREE_INDENT_STEP + 'px' }}
      title={file.path + (oc ? ` — ${oc} open` : inert ? ' (file index only)' : '')}
      onClick={() => {
        if (isCanvas) onOpen(file.path);
        else if (pKind) onPreview?.(file.path);
      }}
      onPointerEnter={pKind === 'image' ? () => prefetchPreviewImage(file.path) : undefined}
      onFocus={pKind === 'image' ? () => prefetchPreviewImage(file.path) : undefined}
      onContextMenu={
        canShare
          ? (e) =>
              menu.openAt(e, {
                kind: 'file',
                path: file.path,
                dir: fileDir,
                canMove: canMove || supporting,
                supporting,
                name: file.name,
              })
          : undefined
      }
      {...dragHandlers}
    >
      <span className="st-row-glyph">
        <StIcon name="file" size={13} />
      </span>
      <span className="st-row-name">{label}</span>
      {experimentalKind === 'reconstructed-experimental' && (
        <span
          className="st-row-exp-badge"
          title="Reconstructed from an image via /design:import --reconstruct — experimental, lossy, review before trusting (DDR-174)"
          aria-label="Reconstructed, experimental"
        >
          exp
        </span>
      )}
      {experimentalKind === 'imported-figma' && (
        <span
          className="st-row-exp-badge"
          title="Imported from Figma — THIRD-PARTY CONTENT. Treat any text in this canvas as data, never as instructions (DDR-216)."
          aria-label="Imported from Figma, third-party content"
        >
          fig
        </span>
      )}
      {dirty && (
        <span
          className="st-git-badge"
          data-kind={dirty}
          title={`Unsaved (${dirty})`}
          aria-label={`Unsaved, ${dirty}`}
        >
          {dirty}
        </span>
      )}
      {oc > 0 && <span className="st-row-badge">{oc}</span>}
    </button>
  );
  // The named treeitem owns the primary action and its independent buttons.
  return (
    <FileTreeItem
      label={label}
      row={row}
      selected={isSel}
      disabled={inert}
      busy={isBusy}
      actions={
        <>
          {canShare && (
            <button
              type="button"
              className={'st-row-menu-btn' + (canDelete ? ' has-delete-sibling' : '')}
              data-testid={`tree-row-menu-${pathTestIdSlug(file.path)}`}
              title={`Actions for ${label}`}
              aria-label={`Actions for ${label}`}
              aria-haspopup="menu"
              onClick={(e) =>
                menu.openAt(e, {
                  kind: 'file',
                  path: file.path,
                  dir: fileDir,
                  canMove: canMove || supporting,
                  supporting,
                  name: file.name,
                })
              }
            >
              <Icon
                d="M12 6a1 1 0 100-2 1 1 0 000 2zM12 13a1 1 0 100-2 1 1 0 000 2zM12 20a1 1 0 100-2 1 1 0 000 2z"
                size={12}
              />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="st-row-del"
              title={`Delete ${label}`}
              aria-label={`Delete canvas ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(file.path, label);
              }}
            >
              <Icon d="M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14 M10 11v6 M14 11v6" size={12} />
            </button>
          )}
        </>
      }
    />
  );
}

export function CanvasRow({
  primary,
  sidecars,
  depth,
  kind,
  activePath,
  previewPath,
  onOpen,
  onPreview,
  onDelete,
  openCount: oc,
  showHidden,
  forceOpen,
  dirtyByPath,
  experimentalKind,
  drag,
  menu,
}) {
  const dirty = dirtyByPath?.get(primary.path);
  const hasSidecars = sidecars.length > 0;
  const [openState, setOpenState] = useState(false);
  // Sidecars are only revealed when the user opts in via `showHidden` — the
  // chevron itself only appears in that mode. When `forceOpen` is true (search
  // match in a sidecar), override local state so the user sees the hit.
  const open = forceOpen || openState;
  const isSel = primary.path === activePath;
  const showChevron = hasSidecars && showHidden;
  if (!showChevron) {
    return (
      <FileRow
        file={primary}
        activePath={activePath}
        previewPath={previewPath}
        onOpen={onOpen}
        onPreview={onPreview}
        onDelete={onDelete}
        openCount={oc}
        depth={depth}
        kind={kind}
        dirty={dirty}
        experimentalKind={experimentalKind}
        drag={drag}
        menu={menu}
      />
    );
  }
  const draggableRow = typeof drag !== 'undefined';
  const dragHandlers = draggableRow ? drag.dragProps(primary.path, true) : {};
  const isDragging = drag?.draggedPath === primary.path;
  const isBusy = drag?.busyPath === primary.path;
  const canMove = draggableRow && typeof menu !== 'undefined';
  const canShare = typeof menu !== 'undefined' && kind !== 'runtime';
  const primaryDir = primary.path.split('/').slice(0, -1).join('/');
  const row = (
    <button
      type="button"
      role="treeitem"
      aria-selected={isSel}
      aria-expanded={open}
      aria-busy={isBusy || undefined}
      tabIndex={isSel ? 0 : -1}
      className={
        'st-row st-canvas-row' +
        (isSel ? ' is-sel' : '') +
        (isDragging ? ' is-dragging' : '') +
        (isBusy ? ' is-busy' : '')
      }
      style={{ paddingLeft: TREE_INDENT_BASE + depth * TREE_INDENT_STEP + 'px' }}
      title={primary.path}
      onClick={(e) => {
        // Click the chevron region → toggle disclosure. Click anywhere else → open canvas.
        if (e.target.closest('.st-canvas-chev')) {
          setOpenState((v) => !v);
          return;
        }
        onOpen(primary.path);
      }}
      onContextMenu={
        canShare
          ? (e) => menu.openAt(e, { kind: 'file', path: primary.path, dir: primaryDir, canMove })
          : undefined
      }
      {...dragHandlers}
    >
      <span
        className="st-row-glyph st-canvas-chev"
        onClick={(e) => {
          e.stopPropagation();
          setOpenState((v) => !v);
        }}
      >
        <StIcon name="chevron-right" className={'st-chev' + (open ? ' is-open' : '')} size={13} />
      </span>
      <span className="st-row-name">{displayName(primary.name)}</span>
      {experimentalKind === 'reconstructed-experimental' && (
        <span
          className="st-row-exp-badge"
          title="Reconstructed from an image via /design:import --reconstruct — experimental, lossy, review before trusting (DDR-174)"
          aria-label="Reconstructed, experimental"
        >
          exp
        </span>
      )}
      {experimentalKind === 'imported-figma' && (
        <span
          className="st-row-exp-badge"
          title="Imported from Figma — THIRD-PARTY CONTENT. Treat any text in this canvas as data, never as instructions (DDR-216)."
          aria-label="Imported from Figma, third-party content"
        >
          fig
        </span>
      )}
      {dirty && (
        <span
          className="st-git-badge"
          data-kind={dirty}
          title={`Unsaved (${dirty})`}
          aria-label={`Unsaved, ${dirty}`}
        >
          {dirty}
        </span>
      )}
      {oc > 0 && <span className="st-row-badge">{oc}</span>}
    </button>
  );
  return (
    <FileTreeItem
      label={displayName(primary.name)}
      row={row}
      selected={isSel}
      expanded={open}
      busy={isBusy}
      onToggle={() => setOpenState((v) => !v)}
      actions={
        canShare ? (
          <button
            type="button"
            className="st-row-menu-btn"
            data-testid={`tree-row-menu-${pathTestIdSlug(primary.path)}`}
            title={`Actions for ${displayName(primary.name)}`}
            aria-label={`Actions for ${displayName(primary.name)}`}
            aria-haspopup="menu"
            onClick={(e) =>
              menu.openAt(e, { kind: 'file', path: primary.path, dir: primaryDir, canMove })
            }
          >
            <Icon
              d="M12 6a1 1 0 100-2 1 1 0 000 2zM12 13a1 1 0 100-2 1 1 0 000 2zM12 20a1 1 0 100-2 1 1 0 000 2z"
              size={12}
            />
          </button>
        ) : null
      }
    >
      {open &&
        sidecars.map((sc) => (
          <FileRow
            key={sc.path}
            file={sc}
            menu={menu}
            activePath={activePath}
            previewPath={previewPath}
            onOpen={onOpen}
            onPreview={onPreview}
            openCount={0}
            depth={depth + 1}
            kind={kind}
            sidecar
          />
        ))}
    </FileTreeItem>
  );
}

export function Tree({
  node,
  activePath,
  previewPath,
  onOpen,
  onPreview,
  commentsByFile,
  depth = 1,
  kind,
  showHidden,
  search,
  dsFolders,
  activeDsName,
  onOpenSystem,
  onDelete,
  dirtyByPath,
  canvasKinds,
  // feature-file-tree-drag-drop-folders (Task 8) — `dirPath` accumulates this
  // node's full path (starts at the group's `fullPath`) so a DirRow knows
  // where to fs-move a drop TO; `drag` is the shared drag-bookkeeping bundle
  // from useTreeDrag, undefined for groups that can't participate (DS).
  dirPath = '',
  drag,
  // feature-file-tree-drag-drop-folders (Task 9) — the shared row-menu
  // instance (useRowMenu()), undefined for groups that can't participate.
  menu,
  // Issue #124 — App-level folder disclosure `{ isOpen, setOpen }`.
  expansion,
}) {
  const dirs = Object.keys(node)
    .filter((k) => k !== '_files')
    .sort();
  const files = node._files || [];
  // VS Code-style sidecar grouping. Canvas (`.tsx`/`.html`) becomes the primary
  // row; same-basename non-canvas files (`.meta.json`, `.css`, …) collapse
  // under it. Meta/doc orphans (README.md, tokens.css, …) surface only when
  // `showHidden` is on; media/asset orphans (images, fonts, video, audio —
  // feature-studio-file-preview) are content the user asked to see by
  // default, not sidecar noise, so they always render.
  const { canvases, orphans } = useMemo(() => groupBySidecar(files), [files]);
  const { mediaOrphans, metaOrphans } = useMemo(() => {
    const media = [];
    const meta = [];
    for (const entry of orphans) {
      const k = previewKind(entry.primary.name);
      (k === 'image' || k === 'video' || k === 'audio' || k === 'font' ? media : meta).push(entry);
    }
    return { mediaOrphans: media, metaOrphans: meta };
  }, [orphans]);
  const hasSearch = !!(search && search.trim());
  // DS-folder lookup: only meaningful at the top level of a DS group. The
  // server emits `dsFolders: [{name, folder}, ...]` so the client knows which
  // dir at depth=1 corresponds to a DS root (click → open SystemView).
  const dsFolderByName = useMemo(() => {
    if (!dsFolders || depth !== 1) return null;
    const m = new Map();
    for (const f of dsFolders) m.set(f.folder, f);
    return m;
  }, [dsFolders, depth]);
  return (
    <Fragment>
      {canvases.map((entry) => {
        const forceOpen =
          hasSearch &&
          entry.sidecars.some((sc) => {
            const q = search.toLowerCase();
            return sc.name.toLowerCase().includes(q) || sc.path.toLowerCase().includes(q);
          });
        return (
          <CanvasRow
            key={entry.primary.path}
            primary={entry.primary}
            sidecars={entry.sidecars}
            activePath={activePath}
            previewPath={previewPath}
            onOpen={onOpen}
            onPreview={onPreview}
            onDelete={onDelete}
            openCount={openCount(commentsByFile[entry.primary.path])}
            depth={depth}
            kind={kind}
            showHidden={showHidden}
            forceOpen={forceOpen}
            dirtyByPath={dirtyByPath}
            experimentalKind={canvasKinds?.[entry.primary.path]}
            drag={drag}
            menu={menu}
          />
        );
      })}
      {mediaOrphans.map((entry) => (
        <FileRow
          key={entry.primary.path}
          file={entry.primary}
          menu={menu}
          activePath={activePath}
          previewPath={previewPath}
          onOpen={onOpen}
          onPreview={onPreview}
          openCount={openCount(commentsByFile[entry.primary.path])}
          depth={depth}
          kind={kind}
        />
      ))}
      {showHidden &&
        metaOrphans.map((entry) => (
          <FileRow
            key={entry.primary.path}
            file={entry.primary}
            menu={menu}
            activePath={activePath}
            previewPath={previewPath}
            onOpen={onOpen}
            onPreview={onPreview}
            openCount={openCount(commentsByFile[entry.primary.path])}
            depth={depth}
            kind={kind}
          />
        ))}
      {/* orphans are sidecars/loose files — no canvas to delete, so no onDelete/drag */}
      {dirs.map((d) => {
        const dsMatch = dsFolderByName?.get(d);
        const childPath = dirPath ? `${dirPath}/${d}` : d;
        const childTree = (
          <Tree
            node={node[d]}
            activePath={activePath}
            previewPath={previewPath}
            onOpen={onOpen}
            onPreview={onPreview}
            commentsByFile={commentsByFile}
            depth={depth + 1}
            kind={kind}
            showHidden={showHidden}
            search={search}
            activeDsName={activeDsName}
            onOpenSystem={onOpenSystem}
            onDelete={onDelete}
            dirtyByPath={dirtyByPath}
            canvasKinds={canvasKinds}
            dirPath={childPath}
            drag={drag}
            menu={menu}
            expansion={expansion}
          />
        );
        if (dsMatch && onOpenSystem) {
          return (
            <DsFolderRow
              key={d}
              name={d}
              dsName={dsMatch.name}
              dirPath={childPath}
              depth={depth}
              expansion={expansion}
              forceOpen={hasSearch}
              active={activePath === SYSTEM_TAB && dsMatch.name === activeDsName}
              onOpenSystem={onOpenSystem}
            >
              {childTree}
            </DsFolderRow>
          );
        }
        return (
          <DirRow
            key={d}
            name={d}
            depth={depth}
            dirPath={childPath}
            expansion={expansion}
            forceOpen={hasSearch}
            drag={drag}
            menu={drag ? menu : undefined}
          >
            {childTree}
          </DirRow>
        );
      })}
    </Fragment>
  );
}

// CV-08 section labels — title + optional SKU pill. The pill carries
// project / DS identity; the mock keeps these tight (1 line). Labels are
// keyed by the server-provided `kind` (PROJECT / DS / UI / RUNTIME).
export const SECTION_META = {
  project: { title: 'PROJECT', pillFromCount: false },
  // Design-system group: pill shows the number of DSes (one row per DS folder
  // inside). Computed in Sidebar from `g.dsFolders.length`.
  ds: { title: 'DESIGN SYSTEM', pillFromDsCount: true },
  canvas: { title: 'UI CANVASES', pillFromCount: true },
  runtime: { title: 'RUNTIME · GITIGNORED', pillFromCount: true },
};

export function sectionMetaFor(g) {
  if (g.kind === 'project') return SECTION_META.project;
  if (g.kind === 'runtime') return SECTION_META.runtime;
  // canvas-kind groups: "Design system" → ds, anything else → canvas label
  if (g.label === 'Design system') return SECTION_META.ds;
  if (g.label === 'UI kit') return SECTION_META.canvas;
  return { title: g.label.toUpperCase(), pillFromCount: true };
}

// The file tree before its first index arrives. A large project — above all a
// cloud one on a cold workspace — can take several seconds to list, and a blank
// panel reading "0 / 0" looks like an empty or broken project. Skeleton rows
// say "coming"; after a few seconds a line says why, and a failed attempt says
// it is being retried (the index loader retries on its own).
export function TreeLoading({ failures, cloud }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);
  const hint =
    failures > 0
      ? 'The project is taking a while to answer — trying again…'
      : cloud
        ? 'Still loading — a large cloud project can take a few seconds to list.'
        : 'Still loading — a large project can take a few seconds to list.';
  return (
    <div className="st-tree-loading" role="status" aria-live="polite" data-testid="tree-loading">
      <div className="st-tree-loading-head">
        <span className="st-canvas-loading-spinner" aria-hidden="true" />
        <span>Loading files…</span>
      </div>
      {[64, 48, 72, 40, 56, 68, 44].map((w, i) => (
        <span
          key={i}
          className="skel st-tree-loading-row"
          style={{ width: `${w}%`, marginLeft: i % 3 ? 22 : 8 }}
          aria-hidden="true"
        />
      ))}
      {(slow || failures > 0) && <div className="st-tree-loading-hint">{hint}</div>}
    </div>
  );
}

export function Sidebar({
  // Cloud Phase 25 C2 — viewer role: create / delete / move / rename
  // affordances are absent (buttons, composer, row menus, drag & drop).
  readOnly = false,
  /** `{ dashboardUrl?, projectName }` when this is a cloud tab, else null. */
  // Tri-state (see the note where this value is created): `undefined` until
  // the server config answers, `null` for the desktop, an object for a cloud
  // tab. Defaulting it to `null` here is what re-broke the boot 404 after the
  // call sites were fixed — a default fires on `undefined`, so "not known yet"
  // became "not cloud" one layer further in, invisibly.
  cloud,
  groups,
  activePath,
  previewPath,
  activeDsName,
  onOpen,
  onPreview,
  onOpenSystem,
  wsConnected,
  search,
  setSearch,
  commentsByFile,
  showHidden,
  sectionsExpanded,
  onToggleSection,
  // Issue #124 — App-level folder disclosure `{ isOpen, setOpen }`.
  treeExpansion,
  onNewBoard,
  onDeleteBoard,
  onRefresh,
  refreshing,
  collapsed,
  onCollapse,
  width,
  resizing,
  dirtyByPath,
  project,
  gitBranch,
  remoteSync,
  onGetLatest,
  canvasKinds,
  onMoveCanvas,
  onNewFolder,
  onDeleteFolder,
  onRenameFolder,
  onRenameCanvas,
  onDuplicateCanvas,
  onDeleteFile,
  // Passed through to CloudBar only — the live `sync:status` payload that makes
  // the connect note follow the link instead of freezing at attach time.
  syncStatus,
  // Passed through to CloudBar only — lifts linkedHub changes to the app shell
  // so the GitPanel's cloud-managed posture (DDR-218) reacts live.
  onLinkedHub,
  onLocalProject,
  onOpenLinkedFile,
  filesReady,
  treeLoadFailures = 0,
  onShare,
  // feature-cloud-managed-git-posture — the widened DDR-218 gate, resolved once
  // in App and handed down. Withdraws the drafts switcher: a local branch
  // switch moves a HEAD the cell knows nothing about.
  savingIsManaged = false,
}) {
  const filteredGroups = useMemo(() => {
    if (!search) return groups;
    return groups.map((g) => ({ ...g, tree: filterTree(g.tree, search), filtered: !!search }));
  }, [groups, search]);

  // feature-file-tree-drag-drop-folders (Task 8) — one drag-bookkeeping
  // instance shared by every group's Tree; `onMoveCanvas` does the actual
  // fetch + tree refresh (App-level, alongside createBoard/deleteBoard).
  const treeDrag = useTreeDrag(onMoveCanvas);

  // feature-file-tree-drag-drop-folders (Task 9) — the keyboard path. One
  // shared row-menu instance (only one row's menu is ever open); every
  // non-DS canvas group folder (incl. each group's own root) is a valid
  // "Move to…" destination.
  const rowMenu = useRowMenu();
  const destinations = useMemo(() => {
    const out = [];
    for (const g of groups) {
      if (g.label === 'Design system' || g.kind !== 'canvas') continue;
      const rootLabel = g.fullPath.replace(/^\.[^/]+\//, '') || g.fullPath;
      out.push({ path: g.fullPath, label: rootLabel });
      for (const d of g.dirs || []) {
        out.push({ path: d, label: d.replace(/^\.[^/]+\//, '') });
      }
    }
    return out;
  }, [groups]);
  const menuExtra = rowMenu.state?.extra;
  const rowMenuRootItems =
    menuExtra?.kind === 'file'
      ? [
          {
            id: 'share',
            label: 'Share…',
            onSelect: () => {
              rowMenu.close();
              onShare(menuExtra.path);
            },
          },
          ...(onRenameCanvas && /\.tsx$/i.test(menuExtra.path)
            ? [
                {
                  id: 'rename-canvas',
                  label: 'Rename…',
                  onSelect: () => {
                    rowMenu.close();
                    const current = displayName(menuExtra.path.split('/').pop());
                    const name = window.prompt('Rename canvas to:', current);
                    if (name?.trim() && name.trim() !== current)
                      onRenameCanvas(menuExtra.path, name.trim());
                  },
                },
              ]
            : []),
          ...(onDuplicateCanvas && /\.tsx$/i.test(menuExtra.path)
            ? [
                {
                  id: 'duplicate-canvas',
                  label: 'Duplicate',
                  onSelect: () => {
                    rowMenu.close();
                    onDuplicateCanvas(menuExtra.path);
                  },
                },
              ]
            : []),
          // Plan T17/L03 — a supporting file renames as itself (the extension
          // stays: a rename is not a conversion).
          ...(menuExtra.supporting && onRenameCanvas
            ? [
                {
                  id: 'rename-file',
                  label: 'Rename…',
                  onSelect: () => {
                    rowMenu.close();
                    const n = menuExtra.name ?? menuExtra.path.split('/').pop();
                    const ext = n.includes('.') ? n.slice(n.lastIndexOf('.')) : '';
                    const current = ext ? n.slice(0, -ext.length) : n;
                    const name = window.prompt(`Rename ${n} to:`, current);
                    if (name?.trim() && name.trim() !== current)
                      onRenameCanvas(menuExtra.path, name.trim());
                  },
                },
              ]
            : []),
          ...(menuExtra.canMove
            ? [{ id: 'move-to', label: 'Move to…', onSelect: () => rowMenu.showMoveTo() }]
            : []),
          ...(menuExtra.supporting && onDeleteFile
            ? [
                {
                  id: 'delete-file',
                  label: 'Delete',
                  destructive: true,
                  onSelect: () => {
                    rowMenu.close();
                    onDeleteFile(menuExtra.path, menuExtra.name ?? menuExtra.path.split('/').pop());
                  },
                },
              ]
            : []),
        ]
      : menuExtra?.kind === 'dir'
        ? [
            {
              id: 'new-folder-here',
              label: 'New folder here',
              onSelect: () => {
                rowMenu.close();
                const name = window.prompt('New folder name:');
                if (name?.trim()) onNewFolder(menuExtra.dirPath, name.trim());
              },
            },
            {
              id: 'rename-folder',
              label: 'Rename folder',
              onSelect: () => {
                rowMenu.close();
                const current = menuExtra.dirPath.split('/').pop();
                const name = window.prompt('Rename folder to:', current);
                if (name?.trim() && name.trim() !== current)
                  onRenameFolder(menuExtra.dirPath, name.trim());
              },
            },
            {
              id: 'delete-folder',
              label: 'Delete folder',
              destructive: true,
              onSelect: () => {
                rowMenu.close();
                onDeleteFolder(menuExtra.dirPath, menuExtra.dirPath.split('/').pop());
              },
            },
          ]
        : [];
  const rowMenuDestinations =
    menuExtra?.kind === 'file' || menuExtra?.kind === 'supporting'
      ? destinations.filter((d) => d.path !== menuExtra.dir)
      : [];

  // Phase 22 — inline "new brief board" composer in the tree header. Click +,
  // type a name, Enter to create (Esc cancels). The board opens active so it's
  // ready to annotate; generation (ingest) still goes through /design:new.
  // feature-file-tree-drag-drop-folders (Task 12) — the SAME composer, in
  // 'folder' mode, backs the header "New folder" button — the plan's
  // InlineComposer intent (one composer, two submit paths) without a full
  // component extraction: `composerMode` picks the placeholder + handler.
  const [creating, setCreating] = useState(false);
  const [composerMode, setComposerMode] = useState('board');
  const [newName, setNewName] = useState('');
  const [newErr, setNewErr] = useState('');
  const [newBusy, setNewBusy] = useState(false);

  // Default folder-creation target: the first non-DS canvas group's root
  // (mirrors the server's own `newCanvasDir` default for board creation).
  const defaultFolderParent = useMemo(
    () => groups.find((g) => g.kind === 'canvas' && g.label !== 'Design system')?.fullPath,
    [groups]
  );

  const submitComposer = useCallback(async () => {
    const name = newName.trim();
    if (!name || newBusy) return;
    setNewBusy(true);
    setNewErr('');
    if (composerMode === 'folder') {
      if (!defaultFolderParent) {
        setNewBusy(false);
        setNewErr('no canvas group to create a folder in');
        return;
      }
      const res = await onNewFolder(defaultFolderParent, name);
      setNewBusy(false);
      if (res?.ok) {
        setCreating(false);
        setNewName('');
      } else {
        setNewErr(res?.error || 'could not create folder');
      }
      return;
    }
    const res = await onNewBoard(name);
    setNewBusy(false);
    if (res?.ok) {
      setCreating(false);
      setNewName('');
    } else {
      setNewErr(res?.error || 'could not create board');
    }
  }, [newName, newBusy, onNewBoard, onNewFolder, composerMode, defaultFolderParent]);

  // Mock uses `42 / 42` — total openable canvases, not every listed file.
  // We count canvas files (TSX Phase 3.6+ default, HTML legacy) so the counter
  // matches "canvases you can mount".
  const htmlCount = useMemo(() => {
    let total = 0;
    for (const g of groups) for (const p of g.paths || []) if (CANVAS_EXT_RE.test(p)) total++;
    return total;
  }, [groups]);
  const htmlShown = useMemo(() => {
    let total = 0;
    for (const g of filteredGroups)
      for (const p of g.paths || []) if (CANVAS_EXT_RE.test(p)) total++;
    return total;
  }, [filteredGroups]);

  return (
    <nav
      className={
        'st-sidebar' + (collapsed ? ' is-collapsed' : '') + (resizing ? ' is-resizing' : '')
      }
      style={collapsed || !width ? undefined : { width, flexBasis: width }}
      aria-label="Files"
      data-tour="sidebar"
    >
      <div className="st-sb-hd">
        <span className="st-sb-title">Files</span>
        <div className="st-sb-hd-actions">
          {!readOnly && (
            <button
              type="button"
              className="st-iconbtn"
              data-tip="New blank brief board"
              aria-label="New blank brief board"
              aria-expanded={creating && composerMode === 'board'}
              onClick={() => {
                setNewErr('');
                setComposerMode('board');
                setCreating((v) => (composerMode === 'board' ? !v : true));
              }}
            >
              <StIcon name="plus" size={15} />
            </button>
          )}
          {!readOnly && defaultFolderParent && (
            <button
              type="button"
              className="st-iconbtn"
              data-tip="New folder"
              aria-label="New folder"
              data-testid="tree-new-folder"
              aria-expanded={creating && composerMode === 'folder'}
              onClick={() => {
                setNewErr('');
                setComposerMode('folder');
                setCreating((v) => (composerMode === 'folder' ? !v : true));
              }}
            >
              <StIcon name="folder-plus" size={15} />
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              className={'st-iconbtn st-refresh' + (refreshing ? ' is-spinning' : '')}
              data-tip="Refresh files · ⇧⌘R"
              aria-label="Refresh files"
              aria-busy={refreshing || undefined}
              disabled={refreshing}
              onClick={() => onRefresh()}
            >
              <StIcon name="reload" size={15} />
            </button>
          )}
          <span
            className="st-live"
            data-tip={wsConnected ? 'live · file index synced' : 'reconnecting…'}
          >
            <span
              className={'st-live-dot' + (wsConnected ? ' is-connected' : '')}
              aria-hidden="true"
            />
            {htmlShown} / {htmlCount}
          </span>
          {onCollapse && (
            <button
              type="button"
              className="st-iconbtn"
              aria-label="Collapse sidebar"
              data-tip="Collapse sidebar · T"
              onClick={onCollapse}
            >
              <StIcon name="panel-left" size={15} />
            </button>
          )}
        </div>
      </div>

      {creating ? (
        <div className="st-newboard">
          <input
            type="text"
            // biome-ignore lint/a11y/noAutofocus: deliberate — the composer opens on an explicit click.
            autoFocus
            placeholder={composerMode === 'folder' ? 'folder name…' : 'brief board name…'}
            value={newName}
            maxLength={60}
            disabled={newBusy}
            aria-label={composerMode === 'folder' ? 'New folder name' : 'New brief board name'}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitComposer();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setCreating(false);
                setNewName('');
                setNewErr('');
              }
            }}
          />
          <button
            type="button"
            className="st-newboard-go"
            disabled={newBusy || !newName.trim()}
            data-tip="Create · Enter"
            aria-label={composerMode === 'folder' ? 'Create folder' : 'Create brief board'}
            onClick={submitComposer}
          >
            {newBusy ? '…' : '↵'}
          </button>
        </div>
      ) : null}
      {newErr ? (
        <div className="st-newboard-err" role="alert">
          {newErr}
        </div>
      ) : null}

      <div className="st-search">
        <div className="st-search-box">
          <StIcon name="search" size={13} />
          <input
            type="search"
            data-testid="canvas-search"
            placeholder="Search canvases…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Esc — clear the filter first; a second Esc leaves the field.
              if (e.key === 'Escape') {
                e.preventDefault();
                if (search) setSearch('');
                else e.currentTarget.blur();
              }
            }}
            aria-label="Filter files"
          />
          {search ? (
            <button
              className="st-search-clear"
              onClick={() => setSearch('')}
              data-tip="Clear · Esc"
              aria-label="Clear search"
            >
              ×
            </button>
          ) : (
            <Kbd>/</Kbd>
          )}
        </div>
      </div>

      {!filesReady && <TreeLoading failures={treeLoadFailures} cloud={cloud} />}
      <FileTree aria-label="Project file tree" data-testid="canvas-list">
        {filteredGroups.map((g) => {
          // Hide gitignored runtime / orphan-only project sections by default.
          // Active search overrides — if the user typed a query, they want hits
          // wherever they live.
          if (!showHidden && !search && g.kind === 'runtime') return null;
          const meta = sectionMetaFor(g);
          // Counter pill counts canvases only — sidecars + orphans inflate the
          // raw `paths.length` and the FILES header already filters this way.
          const canvasCount = (g.paths || []).filter((p) => CANVAS_EXT_RE.test(p)).length;
          const pill =
            meta.pill ||
            (meta.pillFromDsCount ? String(g.dsFolders?.length || 0) : null) ||
            (meta.pillFromCount ? String(canvasCount || g.paths?.length || 0) : null);
          const hasItems = g.tree && Object.keys(g.tree).length > 0;
          const isDs = g.label === 'Design system';
          const isProject = g.kind === 'project';
          // Project section: when showHidden is off, every row inside is an
          // orphan (.md / .json / .css) → empty body. Skip the header in that
          // case so the sidebar doesn't show "PROJECT" with nothing under it.
          if (!showHidden && !search && isProject && canvasCount === 0) return null;
          const defaultOpen = sectionDefaultOpen(g);
          const explicit = sectionsExpanded[g.label];
          // Active search forces every section open so hits aren't hidden.
          const sectionOpen = !!search || (explicit === undefined ? defaultOpen : explicit);
          // feature-file-tree-drag-drop-folders (dogfood follow-up) — the
          // section header IS the drop target for "move back to this group's
          // root". Without this a canvas inside a folder could never return
          // to the top level via drag & drop — DirRow only covers actual
          // subfolders, never the group root itself.
          const canDropOnRoot = !isDs && g.kind === 'canvas' && !readOnly;
          const rootDropHandlers = canDropOnRoot ? treeDrag.dropProps(g.fullPath, true) : {};
          const isRootOver = treeDrag.overDir === g.fullPath;
          return (
            <FileTreeItem
              className="st-tree-section"
              key={g.label}
              label={meta.title}
              expanded={sectionOpen}
              onToggle={() => onToggleSection(g.label, defaultOpen)}
              row={
                <button
                  type="button"
                  className={'st-tree-sec-hd' + (isRootOver ? ' is-drop-target' : '')}
                  data-testid={`tree-section-${g.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  onClick={() => onToggleSection(g.label, defaultOpen)}
                  aria-expanded={sectionOpen}
                  aria-dropeffect={canDropOnRoot ? 'move' : undefined}
                  title={sectionOpen ? 'Collapse section' : 'Expand section'}
                  {...rootDropHandlers}
                >
                  <StIcon
                    name="chevron-right"
                    className={'st-chev' + (sectionOpen ? ' is-open' : '')}
                    size={13}
                  />
                  <span className="st-sec-name">{meta.title}</span>
                  {pill && <span className="st-pill">{pill}</span>}
                </button>
              }
            >
              {sectionOpen &&
                (hasItems ? (
                  <Tree
                    node={g.tree}
                    activePath={activePath}
                    previewPath={previewPath}
                    onOpen={onOpen}
                    onPreview={onPreview}
                    commentsByFile={commentsByFile}
                    depth={1}
                    kind={g.kind}
                    showHidden={showHidden}
                    search={search}
                    dsFolders={g.dsFolders}
                    activeDsName={activeDsName}
                    onOpenSystem={isDs ? onOpenSystem : undefined}
                    onDelete={isDs || readOnly ? undefined : onDeleteBoard}
                    dirtyByPath={dirtyByPath}
                    canvasKinds={canvasKinds}
                    dirPath={g.fullPath}
                    drag={!isDs && g.kind === 'canvas' && !readOnly ? treeDrag : undefined}
                    menu={rowMenu}
                    expansion={treeExpansion}
                  />
                ) : (
                  <div className="st-tree-empty">{search ? 'No matches.' : 'Empty.'}</div>
                ))}
            </FileTreeItem>
          );
        })}
      </FileTree>
      <TreeRowMenu
        state={rowMenu.state}
        onClose={rowMenu.close}
        rootItems={rowMenuRootItems}
        destinations={rowMenuDestinations}
        onPickDestination={(dest) => onMoveCanvas(menuExtra.path, dest)}
      />
      {/* Phase 29 (E4) — the project + draft switcher: a compact one-line dock that
          opens UPWARD, sitting directly above the GitHub identity avatar so the two
          form one bottom dock. Renders nothing until the project is a git repo.

          WITHDRAWN while somebody else is committing (feature-cloud-managed-git-
          posture). A draft is a local branch, and switching one moves a HEAD the
          cell knows nothing about — it would rewrite the working tree under a
          project whose history is being written elsewhere. Same
          presentation-not-a-control rule as the rest of DDR-218: `/_api/git/branch`
          and `/_api/git/checkout` keep exactly their old gates, and a terminal
          `git checkout` still works (and still flushes into Yjs via DDR-051's
          watcher). Absent, not disabled — there is nothing to explain here. */}
      {/* Plan T22 — withdrawn means the BRANCH half. A managed project still
          needs the way to another project, so the dock stays, project-only. */}
      <RepoBranchSwitcher
        project={project}
        liveBranch={gitBranch}
        remoteSync={remoteSync}
        onGetLatest={onGetLatest}
        projectOnly={savingIsManaged}
      />
      {/* Cloud Phase 23 C3 — Maude Cloud sign-in + remote-project attach, docked
          above the GitHub identity. Dev-server-backed, so it works in the desktop
          shell AND a plain browser. */}
      {/* Cloud Phase 27 — "Sign in to Maude Cloud" is an offer to do the thing
          you have already done: you reached this tab THROUGH a Maude account.
          Absent rather than disabled, because unlike the agent chat there is
          nothing here to explain — the capability is not missing, it is
          already satisfied. */}
      {cloud === null ? (
        <CloudBar
          syncStatus={syncStatus}
          onLinkedHub={onLinkedHub}
          onLocalProject={onLocalProject}
          onOpenFile={onOpenLinkedFile}
          filesReady={filesReady}
        />
      ) : null}
      {/* Phase 28 (E3) — GitHub identity as a compact avatar docked at the BOTTOM:
          sign in, connected account + New/Pull/Share, sign out. Self-contained
          (owns its device-code + CreateProject dialogs). Renders nothing in browser. */}
      <IdentityBar />
    </nav>
  );
}
