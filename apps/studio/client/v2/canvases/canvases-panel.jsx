// client/v2/canvases/canvases-panel.jsx — S1.1: the Canvases tab's list at scale (11 · pn-organise,
// 01 · cf-big-tree).
//
// What it draws: the Pinned group, the project row with its Sort menu, then folders (with counts) and
// canvases (with a picture, kind and AI badges, open-comment count, hover pin and ⋯). It is VIRTUALISED —
// a 93-canvas project puts at most DOM_CAP (60) rows in the page; the rest are a spacer of the right
// height — and it keeps the keys the old FileTree answered (↑ ↓ Home End → ← ↵ Space, type a letter), on the
// flat list. Drag a row onto a folder and the folder's ⋯ menu are the ones the tree always had.
//
// Hooks every old test id back: `canvas-list` (the tree, which also scrolls), `canvas-row-<slug>`,
// `tree-folder-<slug>`, `tree-row-menu-<slug>`, `canvas-row-unsaved`. The Pinned copy of a row is
// `canvas-pinned-<slug>` so a test never finds one canvas twice under the same id.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { placeMenu } from '../../tree-row-menu.jsx';
import { pathTestIdSlug, previewKind, shellToast } from '../../shell/util.js';
import { useArrivingRows } from '../empty/arriving.jsx';
import { copy } from '../empty/empty-copy.js';
import { ArrivingRow } from '../empty/skeleton.jsx';
import { requestViewCode } from '../code/code-bus.js';
import { useFold } from '../fold/use-fold.js';
import { KindChips } from '../kinds/KindChips.jsx';
import { countByKind, isFilterKind, noCanvasesOfKind } from '../kinds/kind-filter-model.js';
import { clearKindFilter, useKindFilter } from '../kinds/kind-filter-store.js';
import { nativeDoors } from '../shell/native-doors.js';
import { PANEL_NONE_FOOT, PanelNoCanvases } from '../create/empty-project.jsx';
import { AskButton, Empty } from '../empty/index.js';
import { getPaletteEnv } from '../search/search-env.js';
import {
  CANVASES_OP_EVENT,
  dispatchArtboardJump,
  takeCanvasesOps,
} from '../left-panel/left-panel-bus.js';
import {
  CANVASES_FOLD,
  copyText,
  fileMenuItems,
  panelRole,
  runFileMenuItem,
} from '../left-panel/canvas-file-menu.js';
import { useViewPref, VIEW_PREF_KEYS } from '../left-panel/view-prefs.js';
import {
  CommentIcon,
  EyeIcon,
  MoreIcon,
  PinIcon,
  PrintIcon,
  SparkIcon,
  TrashIcon,
  VideoIcon,
} from './canvas-icons.jsx';
import { InlineRename } from './inline-rename.jsx';
import { JumpBoardRow, JumpNoteRow, JumpToggle, Marked } from './jump-list.jsx';
import { moveTargets } from './move-model.js';
import { askForCovers } from './covers.js';
import { siblingNames } from './rename-model.js';
import { useRowSlots } from './row-slots.js';
import { supportIcon, supportIndex } from './support-model.js';
import { canvasMenuItems, CanvasRowMenu } from './row-menu.jsx';
import { leftOutOf } from '../ds/update-model.js';
import { SORT_BYS, SORT_LABELS, KIND_NOTE, sortControl } from './sort.js';
import {
  allCanvases,
  buildTree,
  designRelOf,
  emptyFolderWords,
  indexMeta,
  layoutRows,
  navigate,
  panelFootLine,
  relOf,
  rowHeight,
  scrollToReveal,
  visibleRows,
  windowRange,
} from './tree-model.js';
import { useCanvasIndex } from './use-canvas-index.js';
import { useCanvasesSort } from './use-canvases-sort.js';
import { ancestorDirs, useRowOps } from './use-move.js';
import { usePins } from './use-pins.js';

// The Sort menu is 260 wide in 11 · pn-organise (`.cv-menu` width below).
const SORT_MENU_WIDTH = 260;
const INDENT_BASE = 8;
const INDENT_STEP = 16;
const pad = (depth) => ({ paddingLeft: `${INDENT_BASE + depth * INDENT_STEP}px` });
// S1.3 — a canvas row keeps a gutter for its artboard twisty: the column under its folder's own chevron
// (or, at the top level, 20px in). The twisty is positioned in that gutter.
/** Does the project hold more than one kind of artboard? (counts by kind, `all` aside) */
export const kindsMixed = (counts) =>
  ['digital', 'web', 'print', 'video'].filter((k) => (counts?.[k] ?? 0) > 0).length >= 2;

const canvasPad = (depth) => (depth === 0 ? { paddingLeft: '20px' } : pad(depth));
const twistyLeft = (depth) => (depth === 0 ? 3 : INDENT_BASE + (depth - 1) * INDENT_STEP + 1);

/** A canvas dragged over the folder it already sits in has nowhere to go — no "Move here". */
const isOwnFolder = (draggedPath, folderPath) =>
  !!draggedPath && draggedPath.slice(0, draggedPath.lastIndexOf('/')) === folderPath;

const KIND_ICON = { print: PrintIcon, video: VideoIcon };
const KIND_WORD = { print: 'Print', video: 'Video' };

export function CanvasesPanel({
  groups,
  search = '',
  projectLabel = '',
  activePath = null,
  onOpen,
  expansion,
  drag,
  menu,
  readOnly = false,
  role = null, // S11.9 — 'view' | 'comment' | 'edit' | 'owner' (Advanced › file rows); omitted: edit, or view when read-only
  onMove,
  onRename,
  onDuplicate,
  onTrash,
  onCopyLink,
  dsCfg = null, // S10.21b — the design-system index maps: a left-out canvas's menu offers Update
  onDsAction, // (id, params) — the shell's action runner (menu-runner); absent: no Update row
  onJumpArtboard, // (path, artboardId) — default: the shell's tab hook, over the left-panel bus
  activeArtboard = null, // the artboard in view on the open canvas
  onNewCanvasIn,
  showHidden = false, // 06 ad-left — Show hidden files: sidecars, loose notes and runtime entries, dimmed in place
  onPreview, // (path) — a supporting file opens its preview in the canvas area
  previewPath = null,
  commentsByFile = {},
  dirtyByPath,
  canvasKinds,
  fetchImpl,
  children,
}) {
  const snapshot = useCanvasIndex({ stamp: groups, fetchImpl });
  const designRel = designRelOf(snapshot, groups);
  const [sort, setSort] = useCanvasesSort(snapshot?.pid ?? null, { fetchImpl });
  const pins = usePins({ stamp: groups, fetchImpl });
  const meta = useMemo(() => indexMeta(snapshot, designRel), [snapshot, designRel]);
  // T-S1a — the words other slices publish (row-slots.js): meta / sub / dim per canvas, the foot, ghost rows
  const slots = useRowSlots();
  // S11.4 — canvases the hub lists that are not on this Mac yet: ghost rows + the "Getting …" foot
  useArrivingRows({ groups, designRel, fetchImpl });
  // P8 C5: the rows' pictures — ask the thumbnail service once for every canvas's cover (background priority)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per page load; the request is the same whatever the panel holds
  useEffect(() => {
    askForCovers(fetchImpl);
  }, []);
  // S11.9 — Canvases › Advanced › Show file names: each canvas row grows a second mono line
  const [showFileNames] = useViewPref(VIEW_PREF_KEYS.fileNames);
  const tree = useMemo(
    () => buildTree({ groups, meta, designRel, opened: pins.opened, ghosts: slots.ghosts }),
    [groups, meta, designRel, pins.opened, slots.ghosts]
  );
  const isOpen = expansion?.isOpen;
  // S7.24 — the kind filter chips (one filter for Canvases and Layers, kind-filter-store.js). Counts are over
  // every canvas of the project, so the chips never change under the filter they set. The Pinned DESIGN SYSTEM
  // rows sit above this panel (tree.jsx) and are not canvases: the filter never reaches them.
  const [kindFilter, , pickKindChip] = useKindFilter();
  const kindCounts = useMemo(() => countByKind(allCanvases(tree)), [tree]);
  const kind = tree.total > 0 && isFilterKind(kindFilter) ? kindFilter : 'all';
  // S1.3 — which canvases show their artboards: path → boolean, the person's own choice (this session)
  const [jumpOpen, setJumpOpen] = useState(() => new Map());
  // the artboard the person just jumped to counts as "in view" until the selection says otherwise
  const [lastJump, setLastJump] = useState(null);
  const currentBoard =
    lastJump && lastJump.base === activeArtboard && lastJump.path === activePath
      ? lastJump.artboardId
      : activeArtboard;
  const support = useMemo(() => (showHidden ? supportIndex(groups) : null), [showHidden, groups]);
  const rows = useMemo(
    () =>
      visibleRows(tree, {
        support,
        sort,
        pins: pins.pinSet,
        pinOrder: pins.pinOrder,
        expanded: (p) => (isOpen ? isOpen(p) : false),
        query: search,
        projectLabel,
        activePath,
        jumpOpen,
        activeArtboard: currentBoard,
        fileNames: showFileNames,
        kind,
      }),
    [
      kind,
      support,
      tree,
      sort,
      pins.pinSet,
      pins.pinOrder,
      isOpen,
      search,
      projectLabel,
      activePath,
      jumpOpen,
      currentBoard,
      showFileNames,
    ]
  );
  const layout = useMemo(() => layoutRows(rows), [rows]);
  const searching = !!search.trim();

  // ── scroll + the window ──
  const treeRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  useLayoutEffect(() => {
    const el = treeRef.current;
    if (!el) return undefined;
    const measure = () => setViewport(el.clientHeight);
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const range = windowRange(rows, layout, scrollTop, viewport);

  // ── focus: one tab stop (roving), moved by the keys ──
  const firstItem = rows.findIndex(
    (r) => r.type === 'folder' || r.type === 'canvas' || r.type === 'ghost'
  );
  const [focusKey, setFocusKey] = useState(null);
  const wantFocus = useRef(false);
  let focusIndex = focusKey ? rows.findIndex((r) => r.key === focusKey) : -1;
  if (focusIndex < 0) {
    const cur = rows.findIndex((r) => r.current && !r.inPinned && !r.inRecent);
    focusIndex = cur >= 0 ? cur : firstItem;
  }
  const focusRow = useCallback(
    (index) => {
      const r = rows[index];
      if (!r) return;
      wantFocus.current = true;
      setFocusKey(r.key);
      const el = treeRef.current;
      if (el) {
        const next = scrollToReveal(rows, layout, index, el.scrollTop, el.clientHeight);
        if (next !== el.scrollTop) {
          el.scrollTop = next;
          setScrollTop(next);
        }
      }
    },
    [rows, layout]
  );
  useLayoutEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    treeRef.current?.querySelector(`[data-index="${focusIndex}"]`)?.focus();
  });

  // the canvas that just opened scrolls into view (once per open, not per render)
  const lastActive = useRef(null);
  useEffect(() => {
    if (!activePath || lastActive.current === activePath) return;
    const i = rows.findIndex((r) => r.current && !r.inPinned && !r.inRecent);
    if (i < 0) return;
    lastActive.current = activePath;
    const el = treeRef.current;
    if (!el) return;
    const next = scrollToReveal(rows, layout, i, el.scrollTop, el.clientHeight);
    if (next !== el.scrollTop) {
      el.scrollTop = next;
      setScrollTop(next);
    }
  }, [activePath, rows, layout]);

  const setOpen = useCallback((path, v) => expansion?.setOpen(path, v), [expansion]);
  const toggleJump = useCallback((row) => {
    setJumpOpen((m) => new Map(m).set(row.path, !row.jumpOpen));
  }, []);
  const doJump = useCallback(
    (row) => {
      setLastJump({
        path: row.path,
        artboardId: row.artboardId,
        base: activeArtboard,
      });
      (onJumpArtboard || dispatchArtboardJump)(row.path, row.artboardId);
    },
    [onJumpArtboard, activeArtboard]
  );
  const toggleRow = useCallback(
    (r) => {
      if (!search.trim()) setOpen(r.path, !r.open);
    },
    [setOpen, search]
  );

  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const item = e.target.closest?.('[role="treeitem"]');
    const el = treeRef.current;
    if (!item || !el || !el.contains(item)) return;
    const index = Number(item.dataset.index);
    const primary = item.querySelector('[data-tree-primary]');
    // the row's own buttons keep Enter / Space / Tab; Escape brings focus back to the row
    if (e.target !== item && e.target !== primary) {
      if (e.key === 'Escape') {
        e.preventDefault();
        focusRow(index);
      }
      return;
    }
    // F2 renames the focused canvas in place (the double-click's keyboard twin)
    if (e.key === 'F2') {
      const r = rows[index];
      if (r?.type === 'canvas' && !readOnly) {
        e.preventDefault();
        e.stopPropagation();
        rowOps.startRename(r.key);
      }
      return;
    }
    if (e.shiftKey && e.key.length === 1) return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target !== item) return;
    const act = navigate(rows, index, e.key);
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    if (act.focus !== undefined) focusRow(act.focus);
    else if (act.toggle !== undefined) toggleRow(rows[act.toggle]);
    else if (act.toggleJump !== undefined) toggleJump(rows[act.toggleJump]);
    else if (act.jump !== undefined) doJump(rows[act.jump]);
    else if (act.activate !== undefined) {
      const r = rows[act.activate];
      if (r.type === 'ghost') r.onOpen?.();
      else if (r.type === 'support') {
        if (!r.runtime && previewKind(r.name)) onPreview?.(r.path);
      } else onOpen(r.path);
    }
  };
  const onFocusIn = (e) => {
    const item = e.target.closest?.('[role="treeitem"]');
    if (!item) return;
    const r = rows[Number(item.dataset.index)];
    if (r && r.key !== focusKey) setFocusKey(r.key);
  };

  // ── the Sort menu ── mouse or keyboard: the checked choice takes the focus, ↑ ↓ Home End walk, ↵ / Space
  // choose, esc closes and gives the focus back to the Sort button, Tab leaves.
  const panelRef = useRef(null);
  const [sortMenu, setSortMenu] = useState(null); // { anchor: {left,right,top,bottom} } | null
  const [sortPlaced, setSortPlaced] = useState(null); // { left, top, maxHeight } | null
  const sortButton = () => panelRef.current?.querySelector('[data-testid="canvases-sort"]');
  const openSortMenuFrom = (btn) => {
    const a = btn?.getBoundingClientRect();
    setSortMenu({
      anchor: a
        ? { left: a.left, right: a.right, top: a.top, bottom: a.bottom }
        : { left: 8, right: 8, top: 0, bottom: 24 },
    });
  };
  // 11 · pn-organise draws the menu 260 wide OUTSIDE the panel, never clipped: it is placed in the window
  // (fixed), at the button's left edge, and pulled back inside the window's edges (`placeMenu`).
  useLayoutEffect(() => {
    if (!sortMenu) {
      setSortPlaced(null);
      return;
    }
    const el = panelRef.current?.querySelector('[data-sort-menu]');
    setSortPlaced(
      placeMenu(
        sortMenu.anchor,
        { width: SORT_MENU_WIDTH, height: el?.scrollHeight || 0 },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [sortMenu]);
  const openSortMenu = (e) => {
    if (sortMenu) {
      setSortMenu(null);
      return;
    }
    openSortMenuFrom(e.currentTarget);
  };
  useEffect(() => {
    if (!sortMenu) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (
        e.type === 'pointerdown' &&
        e.target.closest?.('[data-sort-menu], [data-testid="canvases-sort"]')
      )
        return;
      setSortMenu(null);
      if (e.type === 'keydown') sortButton()?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [sortMenu]);
  // opening it takes the focus into the menu (the checked choice), so the keys have somewhere to land
  const sortOpen = !!sortMenu;
  useEffect(() => {
    if (!sortOpen) return;
    const menuEl = panelRef.current?.querySelector('[data-sort-menu]');
    (menuEl?.querySelector('[aria-checked="true"]') || menuEl?.querySelector('button'))?.focus();
  }, [sortOpen]);
  const onSortKeyDown = (e) => {
    const items = Array.from(e.currentTarget.querySelectorAll('button'));
    const i = items.indexOf(document.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') setSortMenu(null);
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    items[next]?.focus();
  };

  // ── rename in place, the row menu, and what ⌘K / the File menu ask of the panel ──
  const rowOps = useRowOps();
  const edit = !readOnly;
  const [pendingRename, setPendingRename] = useState(null);
  const beginRename = useCallback(
    (path) => {
      for (const d of ancestorDirs(tree, path)) expansion?.setOpen(d, true);
      setPendingRename(path);
    },
    [tree, expansion]
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rowOps.startRename` is stable
  useEffect(() => {
    if (!pendingRename) return;
    const i = rows.findIndex(
      (r) => r.type === 'canvas' && r.path === pendingRename && !r.inPinned && !r.inRecent
    );
    if (i < 0) {
      if (searching) setPendingRename(null); // the row is not in the search's answer: nothing to edit
      return;
    }
    setPendingRename(null);
    rowOps.startRename(rows[i].key);
    focusRow(i);
  }, [pendingRename, rows]);

  // S7.24 — `canvases.filter-kind` (⌘K): the cursor goes to the chip that is on, or to All
  const focusKindChips = () => {
    const on = panelRef.current?.querySelector('.kf-chip[data-on]');
    (on || panelRef.current?.querySelector('.kf-chip'))?.focus();
  };
  const opRef = useRef(null);
  opRef.current = (o) => {
    if (o.op === 'pin' && o.path) pins.toggle(relOf(o.path, designRel), !!o.pinned);
    else if (o.op === 'sort') openSortMenuFrom(sortButton());
    else if (o.op === 'filter') focusKindChips();
    else if (o.op === 'rename' && o.path && edit) beginRename(o.path);
  };
  useEffect(() => {
    const drain = () => {
      for (const o of takeCanvasesOps()) opRef.current?.(o);
    };
    drain();
    window.addEventListener(CANVASES_OP_EVENT, drain);
    return () => window.removeEventListener(CANVASES_OP_EVENT, drain);
  }, []);

  const menuRow = rowOps.menu?.row;
  const doors = useMemo(() => nativeDoors(), []);
  // S11.9 — the Advanced group joins the menu only while Canvases › Advanced is open
  const [advancedOpen] = useFold(CANVASES_FOLD);
  const fileMenu = useMemo(() => {
    if (!advancedOpen || !menuRow) return [];
    const items = fileMenuItems({ role: panelRole({ role, edit }), native: doors.available });
    return items.map((it, i) => (i === 0 ? { ...it, sepBefore: true } : it));
  }, [advancedOpen, menuRow, role, edit, doors]);
  const dsUpdate = !!(edit && onDsAction && menuRow && leftOutOf(menuRow.path, dsCfg));
  const menuItems = menuRow ? canvasMenuItems(menuRow, { edit, extra: fileMenu, dsUpdate }) : [];
  const targets = useMemo(
    () => (menuRow ? moveTargets(tree, { fromDir: menuRow.dir, projectLabel }) : []),
    [tree, menuRow, projectLabel]
  );
  const onMenuSelect = (id) => {
    const row = rowOps.menu?.row;
    if (!row) return;
    if (id === 'move') {
      rowOps.setView('move');
      return;
    }
    rowOps.closeMenu(false);
    if (id === 'open') onOpen(row.path);
    else if (id === 'pin') pins.toggle(row.rel, !row.pinned);
    else if (id === 'rename') rowOps.startRename(row.key);
    else if (id === 'duplicate') onDuplicate?.(row.path);
    else if (id === 'copy-link') onCopyLink?.(row.path);
    else if (id === 'trash') onTrash?.(row.path, row.name);
    else if (id === 'ds-update')
      onDsAction?.('ds.canvas-update', { canvas: relOf(row.path, designRel) });
    else if (fileMenu.some((it) => it.id === id))
      runFileMenuItem(id, row, {
        designRel,
        doors,
        write: copyText,
        toast: (m) => shellToast(m, false),
        requestViewCode,
        startRename: rowOps.startRename,
      });
  };
  const onMovePick = (target) => {
    const row = rowOps.menu?.row;
    rowOps.closeMenu(false);
    if (row) (onMove || drag?.move)?.(row.path, target.path);
  };

  const ctx = {
    onOpen,
    drag: readOnly ? undefined : drag,
    menu,
    edit,
    rowOps,
    tree,
    onRename,
    commentsByFile,
    dirtyByPath,
    canvasKinds,
    togglePin: pins.toggle,
    toggleJump,
    doJump,
    onNewCanvasIn: readOnly ? undefined : onNewCanvasIn,
    setOpen,
    openSortMenu,
    sort,
    sortOpen: !!sortMenu,
    searching,
    slotFor: slots.slotFor,
    showFileNames,
    onPreview,
    previewPath,
  };

  const shown = rows.filter((r) => r.type === 'canvas').length;
  // while artboards are listed, the foot counts them: "21 artboards · 19 digital, 2 print"
  // (a search that opened a canvas by itself keeps its "N results" foot — only a person's own open counts)
  const listed = rows.filter(
    (r) =>
      r.type === 'canvas' &&
      r.jumpOpen &&
      !r.inPinned &&
      !r.inRecent &&
      (!searching || jumpOpen.get(r.path) === true)
  );
  const jumpFootArgs = listed.length
    ? {
        boards: listed.flatMap((r) => r.boards ?? []),
        dynamic: listed.some((r) => r.dynamic),
      }
    : null;
  const emptyProject = !searching && tree.total === 0; // S6.2: "No canvases yet." through the kit
  const foot = panelFootLine({
    total: tree.total,
    shown,
    searching,
    jump: jumpFootArgs,
    foots: slots.foots,
    kind,
    kindMatching: kind === 'all' ? 0 : kindCounts[kind],
  });
  // a11y gate B1: the Sort button is a control, not a treeitem, so it cannot live inside the role=tree element. The
  // head row (name + count) stays a row of the list; the button is drawn over its right end from a sibling lane
  // that follows the list's scroll.
  const sortCtl = sortControl({ by: sort.by, total: tree.total });
  const headIndex = searching ? -1 : rows.findIndex((r) => r.key === 'head:project');
  const headTop = headIndex >= 0 ? layout.tops[headIndex] - scrollTop : 0;
  const headH = headIndex >= 0 ? rowHeight(rows[headIndex]) : 0;
  const sortLane =
    headIndex >= 0 && headTop > -headH ? (
      <div className="cv-sort-lane" style={{ top: headTop + (headH - 20) / 2 }}>
        <button
          type="button"
          className={`cv-sort${sortOpen ? ' is-open' : ''}${sortCtl.quiet ? ' cv-sort--quiet' : ''}`}
          data-testid="canvases-sort"
          aria-haspopup="menu"
          aria-expanded={sortOpen}
          aria-label={sortCtl.label}
          onClick={openSortMenu}
        >
          {sortCtl.text}
          <StIcon name="chevron-down" size={11} />
        </button>
      </div>
    ) : null;
  const slice = [];
  for (let i = range.start; i < range.end; i++) slice.push(i);
  if (focusIndex >= 0 && (focusIndex < range.start || focusIndex >= range.end))
    slice.push(focusIndex);

  return (
    <div className="cv-panel" ref={panelRef}>
      {/* P8 C3 (01 cf-blank, 02, 05, 11): a filter with one kind to pick is noise — the chips come once the project
          mixes kinds (08 draws them for that), and stay while one is on so it can be turned off. */}
      {tree.total > 0 && (kind !== 'all' || kindsMixed(kindCounts)) ? (
        <KindChips counts={kindCounts} on={kind} onPick={(k) => pickKindChip(k, 'canvases')} />
      ) : null}
      <div className="cv-listwrap">
        {sortLane}
        {/* biome-ignore lint/a11y/useSemanticElements: an ARIA tree on a flat, windowed list */}
        <div
          ref={treeRef}
          className="st-tree cv-tree"
          // a tree with no treeitem fails axe aria-required-children: a project with no canvases is a labelled group
          role={emptyProject ? 'group' : 'tree'}
          aria-label="Project file tree"
          data-testid="canvas-list"
          data-rows={rows.length}
          data-drawn={slice.length}
          tabIndex={focusIndex < 0 ? 0 : -1}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          onKeyDown={onKeyDown}
          onFocus={onFocusIn}
        >
          <div className="cv-spacer" style={{ height: layout.height }}>
            {slice.map((i) => (
              <PanelRow
                key={rows[i].key}
                row={rows[i]}
                index={i}
                top={layout.tops[i]}
                tabStop={i === focusIndex}
                ctx={ctx}
                toggleRow={toggleRow}
              />
            ))}
          </div>
          {searching && shown === 0 ? <SearchNone query={search.trim()} /> : null}
          {kind !== 'all' && !searching && shown === 0 ? (
            <KindNone kind={kind} project={projectLabel} total={tree.total} />
          ) : null}
        </div>
        {/* gate-b-a11y: the "New canvas" button is not a treeitem — it sits beside `role=tree`, not in it
            (axe aria-required-children, the wave-A B1 class). */}
        {emptyProject ? <PanelNoCanvases readOnly={readOnly} fetchImpl={fetchImpl} /> : null}
      </div>
      {/* 05 es-project-new: the panel's own "New canvas" is the one row of an empty project; the host's row (and its
          folder button) wait for the first canvas. `children` may be a function of that state. */}
      {typeof children === 'function' ? children({ emptyProject }) : children}
      {/* P8 C5: the board draws no foot line at rest (01 / 02 / 05 / 11) — a foot is a state's words (a
          search, a kind filter, sync, arriving, an empty project). */}
      {foot.source === 'default' && !searching && !emptyProject ? null : (
        <p
          className="cv-foot"
          data-testid="canvases-foot"
          data-slot={foot.source}
          data-tone={foot.tone || undefined}
        >
          {emptyProject && foot.source === 'default' ? (
            PANEL_NONE_FOOT
          ) : typeof foot.progress === 'number' ? (
            <span className="es-progress" data-testid="canvases-foot-progress">
              <span>{foot.text}</span>
              <span className="es-bar" aria-hidden="true">
                <i style={{ width: `${Math.round(foot.progress * 100)}%` }} />
              </span>
            </span>
          ) : (
            foot.text
          )}
        </p>
      )}
      {sortMenu ? (
        <div
          className="cv-menu"
          role="menu"
          aria-label="Sort canvases"
          data-sort-menu
          data-testid="canvases-sort-menu"
          style={
            sortPlaced
              ? {
                  position: 'fixed',
                  left: sortPlaced.left,
                  top: sortPlaced.top,
                  maxHeight: sortPlaced.maxHeight,
                  overflowY: 'auto',
                }
              : { position: 'fixed', left: sortMenu.anchor.left, top: sortMenu.anchor.bottom + 4 }
          }
          onKeyDown={onSortKeyDown}
        >
          <p className="cv-menu-group">Sort by</p>
          {SORT_BYS.map((by) => (
            <button
              key={by}
              type="button"
              role="menuitemradio"
              aria-checked={sort.by === by}
              className="cv-menu-item"
              data-testid={`canvases-sort-${by}`}
              onClick={() => {
                setSort({ by });
                setSortMenu(null);
              }}
            >
              <span className="cv-menu-check">
                {sort.by === by ? <StIcon name="check" size={12} /> : null}
              </span>
              <span className="cv-menu-label">{SORT_LABELS[by]}</span>
              {by === 'kind' ? <span className="cv-menu-note">{KIND_NOTE}</span> : null}
            </button>
          ))}
          <hr className="cv-menu-sep" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={sort.foldersOnTop}
            className="cv-menu-item"
            data-testid="canvases-sort-folders"
            onClick={() => {
              setSort({ foldersOnTop: !sort.foldersOnTop });
              setSortMenu(null);
            }}
          >
            <span className="cv-menu-check">
              {sort.foldersOnTop ? <StIcon name="check" size={12} /> : null}
            </span>
            <span className="cv-menu-label">Folders on top</span>
          </button>
        </div>
      ) : null}
      <CanvasRowMenu
        state={rowOps.menu}
        items={menuItems}
        targets={targets}
        onSelect={onMenuSelect}
        onPick={onMovePick}
        onView={rowOps.setView}
        onClose={rowOps.closeMenu}
      />
    </div>
  );
}

// ── rows ────────────────────────────────────────────────────────────────────────────────────────────

function PanelRow({ row, index, top, tabStop, ctx, toggleRow }) {
  const style = { top, height: rowHeight(row) };
  if (row.type === 'head') return <PanelHead row={row} style={style} ctx={ctx} />;
  if (row.type === 'empty')
    return <PanelEmptyFolder row={row} index={index} style={style} ctx={ctx} />;
  if (row.type === 'folder')
    return (
      <PanelFolderRow
        row={row}
        index={index}
        style={style}
        tabStop={tabStop}
        ctx={ctx}
        toggleRow={toggleRow}
      />
    );
  if (row.type === 'board') {
    const slug = pathTestIdSlug(row.path);
    return (
      <JumpBoardRow
        row={row}
        index={index}
        style={style}
        tabStop={tabStop}
        slug={slug}
        padStyle={pad(row.depth)}
        onJump={ctx.doJump}
      />
    );
  }
  if (row.type === 'note')
    return (
      <JumpNoteRow
        row={row}
        style={style}
        slug={pathTestIdSlug(row.path)}
        padStyle={pad(row.depth)}
      />
    );
  if (row.type === 'ghost')
    return <PanelGhostRow row={row} index={index} style={style} tabStop={tabStop} />;
  if (row.type === 'support')
    return <PanelSupportRow row={row} index={index} style={style} tabStop={tabStop} ctx={ctx} />;
  return <PanelCanvasRow row={row} index={index} style={style} tabStop={tabStop} ctx={ctx} />;
}

function PanelHead({ row, style, ctx }) {
  const isProject = row.id === 'project';
  const dropProps =
    isProject && row.rootPath && ctx.drag ? ctx.drag.dropProps(row.rootPath, true) : {};
  const over =
    isProject &&
    row.rootPath &&
    ctx.drag?.overDir === row.rootPath &&
    !isOwnFolder(ctx.drag.draggedPath, row.rootPath);
  return (
    <div
      className={`cv-head${over ? ' is-drop-target' : ''}`}
      style={style}
      data-testid={`canvases-head-${row.id}`}
      {...dropProps}
    >
      <span className="cv-head-name">{row.label}</span>
      {row.aside ? <span className="cv-head-aside">{row.aside}</span> : null}
      {over ? (
        <span className="cv-drop-tag" data-testid="canvases-drop-tag">
          Move here
        </span>
      ) : null}
    </div>
  );
}

function PanelFolderRow({ row, index, style, tabStop, ctx, toggleRow }) {
  const slug = pathTestIdSlug(row.path);
  const { drag, menu } = ctx;
  const over = drag?.overDir === row.path && !isOwnFolder(drag.draggedPath, row.path);
  const dragging = drag?.draggedPath === row.path;
  const busy = drag?.busyPath === row.path;
  const drop = drag ? drag.dropProps(row.path, true, () => ctx.setOpen(row.path, true)) : {};
  const src = drag ? drag.dragProps(row.path, true) : {};
  return (
    <div
      className="cv-item"
      role="treeitem"
      aria-level={row.level}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-expanded={row.open}
      aria-label={row.name}
      aria-busy={busy || undefined}
      data-index={index}
      tabIndex={tabStop ? 0 : -1}
      style={style}
    >
      <div
        className={`cv-row cv-row--folder${over ? ' is-drop-target' : ''}${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
      >
        <button
          type="button"
          className="cv-main"
          data-tree-primary=""
          data-testid={`tree-folder-${slug}`}
          aria-expanded={row.open}
          aria-dropeffect={drag ? 'move' : undefined}
          tabIndex={-1}
          style={pad(row.depth)}
          onClick={() => toggleRow(row)}
          onContextMenu={
            menu && drag ? (e) => menu.openAt(e, { kind: 'dir', dirPath: row.path }) : undefined
          }
          {...src}
          {...drop}
        >
          <span className="cv-twisty">
            <StIcon
              name="chevron-right"
              className={`st-chev${row.open ? ' is-open' : ''}`}
              size={13}
            />
          </span>
          <span className="cv-fic">
            <StIcon name="folder" size={14} />
          </span>
          <span className="cv-name">{row.name}</span>
          {over ? (
            <span className="cv-drop-tag" data-testid="canvases-drop-tag">
              Move here
            </span>
          ) : null}
          <span className="cv-count" role="img" aria-label={`${row.count} canvases`}>
            {row.count}
          </span>
        </button>
        {menu && drag ? (
          <span className="cv-actions">
            <button
              type="button"
              className="cv-act"
              data-testid={`tree-row-menu-${slug}`}
              title={`Folder actions — ${row.name}`}
              aria-label={`Folder actions for ${row.name}`}
              aria-haspopup="menu"
              onClick={(e) => menu.openAt(e, { kind: 'dir', dirPath: row.path })}
            >
              <MoreIcon size={12} />
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 06 ad-left — a supporting file drawn in place (Show hidden files): a canvas's sidecar, a folder's loose note
 * or a runtime entry. Dim, mono, one line, a glyph where a picture would be. A click previews it (runtime
 * entries are process state, inert like in the old file view); the ⋯ menu is the one the file view had.
 */
function PanelSupportRow({ row, index, style, tabStop, ctx }) {
  const slug = pathTestIdSlug(row.path);
  const pKind = row.runtime ? null : previewKind(row.name);
  const sel = !!ctx.previewPath && ctx.previewPath === row.path;
  const sidecar = row.sidecar === true;
  const supporting = !row.runtime && !!pKind && !sidecar && !!ctx.menu;
  const canShare = !!ctx.menu && !row.runtime;
  const dir = row.path.slice(0, row.path.lastIndexOf('/'));
  const open = (e) =>
    ctx.menu.openAt(e, {
      kind: 'file',
      path: row.path,
      dir,
      canMove: supporting,
      supporting,
      name: row.name.replace(/\/$/, ''),
    });
  return (
    <div
      className="cv-item"
      role="treeitem"
      aria-level={row.level}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-selected={sel}
      aria-disabled={pKind ? undefined : 'true'}
      aria-label={row.name}
      data-index={index}
      tabIndex={tabStop ? 0 : -1}
      style={style}
    >
      <div
        className={`cv-row cv-row--support${sel ? ' is-sel' : ''}${row.runtime ? ' is-runtime' : ''}`}
      >
        <button
          type="button"
          className="cv-main"
          data-tree-primary=""
          data-testid={`file-row-${slug}`}
          tabIndex={-1}
          style={canvasPad(row.depth)}
          title={row.path}
          onClick={() => {
            if (pKind) ctx.onPreview?.(row.path);
          }}
          onContextMenu={canShare ? open : undefined}
        >
          <span className="cv-sup-ic" aria-hidden="true">
            <StIcon name={supportIcon(row.name)} size={14} />
          </span>
          <span className="cv-name cv-name--mono">{row.name}</span>
        </button>
        {canShare ? (
          <span className="cv-actions">
            <button
              type="button"
              className="cv-act"
              data-testid={`tree-row-menu-${slug}`}
              title={`Actions for ${row.name}`}
              aria-label={`Actions for ${row.name}`}
              aria-haspopup="menu"
              onClick={open}
            >
              <MoreIcon size={12} />
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

const SLOT_ICON = { trash: TrashIcon, eye: EyeIcon, comment: CommentIcon };

/** T-S1a — the words after a canvas's name that a slice published (trash line, access line). */
function SlotSub({ sub, source, id }) {
  const Icon = SLOT_ICON[sub.icon];
  return (
    <span className="cv-sub cv-sub--slot" data-testid={id} data-source={source}>
      {Icon ? <Icon size={11} /> : null}
      <span className="cv-sub-text">{sub.text}</span>
    </span>
  );
}

/**
 * T-S1a — a ghost row: a canvas open in a tab that is not in the index any more (trashed while open). Drawn
 * at its last path, dim, with the words its provider gave it; a click (or ↵) focuses that tab.
 */
function PanelGhostRow({ row, index, style, tabStop }) {
  const slug = pathTestIdSlug(row.path);
  const slot = row.slot || {};
  if (slot.arriving || slot.notLocal)
    return <PanelPendingRow row={row} index={index} style={style} tabStop={tabStop} slug={slug} />;
  return (
    <div
      className="cv-item"
      role="treeitem"
      aria-level={row.level}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-label={row.name}
      aria-selected={row.current === true}
      data-index={index}
      tabIndex={tabStop ? 0 : -1}
      style={style}
    >
      <div
        className={`cv-row cv-row--canvas cv-row--ghost${row.current ? ' is-sel' : ''}${slot.dim ? ' is-dim' : ''}`}
      >
        <button
          type="button"
          className="cv-main"
          data-tree-primary=""
          data-testid={`canvas-row-trashed-${slug}`}
          tabIndex={-1}
          style={canvasPad(row.depth)}
          title={row.path}
          onClick={() => row.onOpen?.()}
        >
          <span className="cv-thumb" aria-hidden="true">
            {row.cover ? (
              <img
                src={`/_api/thumb/${row.cover}`}
                alt=""
                loading="lazy"
                draggable={false}
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden';
                }}
              />
            ) : null}
          </span>
          {slot.sub ? (
            <span className="cv-names">
              <span className="cv-name">{row.name}</span>
              <SlotSub sub={slot.sub} source="trash" id={`canvas-row-sub-${slug}`} />
            </span>
          ) : (
            <span className="cv-name">{row.name}</span>
          )}
          {slot.meta ? (
            <span
              className="cv-meta"
              data-tone={slot.meta.tone || 'quiet'}
              title={slot.meta.title || undefined}
            >
              {slot.meta.word}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

/**
 * S11.4 — a canvas the hub lists that is not on this Mac (05 · es-arriving / es-offline-uncached). Arriving:
 * the kit's ArrivingRow (name always shown, the thumb pulsing). Offline and never downloaded: dim, with a
 * cloud. Not a button — there is nothing to open yet.
 */
function PanelPendingRow({ row, index, style, tabStop, slug }) {
  const away = !!row.slot?.notLocal;
  return (
    <div
      className="cv-item"
      role="treeitem"
      aria-level={row.level}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-label={
        away ? copy('es-offline-uncached.not-local', { canvas: row.name }).title : row.name
      }
      aria-disabled="true"
      data-index={index}
      tabIndex={tabStop ? 0 : -1}
      style={style}
    >
      <div className="cv-row cv-row--canvas cv-row--ghost is-dim">
        {away ? (
          <span
            className="cv-main"
            data-tree-primary=""
            data-testid={`canvas-row-not-local-${slug}`}
            style={canvasPad(row.depth)}
            title={row.path}
          >
            <span className="cv-thumb" aria-hidden="true" />
            <span className="cv-name">{row.name}</span>
            <span className="cv-meta" data-tone="quiet" aria-hidden="true">
              <StIcon name="cloud" size={12} />
            </span>
          </span>
        ) : (
          <span
            className="cv-main"
            data-tree-primary=""
            data-testid={`canvas-row-arriving-${slug}`}
            style={canvasPad(row.depth)}
            title={row.path}
          >
            <ArrivingRow name={row.name} />
          </span>
        )}
      </div>
    </div>
  );
}

function PanelCanvasRow({ row, index, style, tabStop, ctx }) {
  const { drag, rowOps } = ctx;
  const slug = pathTestIdSlug(row.path);
  const renaming = rowOps.renaming === row.key;
  const pinnedCopy = !!row.inPinned || !!row.inRecent; // a second listing of a canvas: no artboard twisty, own testids
  const dirty = ctx.dirtyByPath?.get?.(row.path);
  const oc = (ctx.commentsByFile?.[row.path] || []).filter((c) => c.status !== 'resolved').length;
  const experimental = ctx.canvasKinds?.[row.path];
  const src = drag ? drag.dragProps(row.path, true) : {};
  const dragging = drag?.draggedPath === row.path;
  const busy = drag?.busyPath === row.path;
  const openMenu = (e) => rowOps.openMenu(e, row);
  const thumb = (
    <span className="cv-thumb" aria-hidden="true">
      {row.cover ? (
        <img
          src={`/_api/thumb/${row.cover}`}
          alt=""
          loading="lazy"
          draggable={false}
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden';
          }}
        />
      ) : null}
    </span>
  );
  const copyId = row.inRecent ? 'canvas-recent' : 'canvas-pinned';
  const mainId = pinnedCopy ? `${copyId}-${slug}` : `canvas-row-${slug}`;
  const idPrefix = pinnedCopy ? copyId : 'canvas-row';
  const slot = ctx.slotFor?.(row.rel) ?? null; // T-S1a — words other slices publish for this canvas
  const label = row.name;
  const tip = `${row.path}${oc ? ` — ${oc} open` : ''}`;
  return (
    <div
      className="cv-item"
      role="treeitem"
      aria-level={row.level}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-selected={row.current}
      aria-expanded={row.jumpable && !pinnedCopy ? !!row.jumpOpen : undefined}
      aria-label={label}
      aria-busy={busy || undefined}
      data-index={index}
      tabIndex={tabStop ? 0 : -1}
      style={style}
    >
      <div
        className={`cv-row cv-row--canvas${row.current ? ' is-sel' : ''}${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}${row.pinned ? ' is-pinned' : ''}${slot?.dim ? ' is-dim' : ''}`}
      >
        {row.jumpable && !pinnedCopy && !renaming ? (
          <JumpToggle
            open={!!row.jumpOpen}
            slug={slug}
            name={label}
            left={twistyLeft(row.depth)}
            onToggle={() => ctx.toggleJump(row)}
          />
        ) : null}
        {renaming ? (
          <div className="cv-main cv-main--edit" style={canvasPad(row.depth)}>
            {thumb}
            <InlineRename
              slug={slug}
              current={label}
              siblings={siblingNames(ctx.tree, row.dir, row.path)}
              onCommit={(name) => ctx.onRename(row.path, name, { quiet: true })}
              onCancel={rowOps.stopRename}
            />
          </div>
        ) : (
          <button
            type="button"
            className="cv-main"
            data-tree-primary=""
            data-testid={mainId}
            tabIndex={-1}
            style={canvasPad(row.depth)}
            title={tip}
            onClick={() => ctx.onOpen(row.path)}
            onDoubleClick={ctx.edit && ctx.onRename ? () => rowOps.startRename(row.key) : undefined}
            onContextMenu={openMenu}
            {...src}
          >
            {thumb}
            {row.fileName ? (
              <span className="cv-names">
                <span className="cv-name">
                  <Marked text={label} marks={row.nameMarks} />
                </span>
                <span className="cv-file" data-testid={`${idPrefix}-file-${slug}`}>
                  {row.fileName}
                </span>
              </span>
            ) : (
              <span className="cv-name">
                <Marked text={label} marks={row.nameMarks} />
              </span>
            )}
            {row.sub ? (
              <span className="cv-sub">
                <Marked text={row.sub} marks={row.subMarks} />
              </span>
            ) : slot?.sub && !ctx.searching ? (
              <SlotSub sub={slot.sub} source={slot.subSource} id={`${idPrefix}-sub-${slug}`} />
            ) : null}
            {slot?.meta ? (
              <span
                className="cv-meta"
                data-testid={`${idPrefix}-meta-${slug}`}
                data-tone={slot.meta.tone || 'quiet'}
                data-source={slot.metaSource}
                title={slot.meta.title || undefined}
              >
                {slot.meta.word}
              </span>
            ) : null}
            {row.recentWord ? (
              <span className="cv-meta" data-testid={`${idPrefix}-when-${slug}`}>
                {row.recentWord}
              </span>
            ) : null}
            {/* 11 pn-jump: an opened jump list says how many artboards it holds ("21", the board's row meta) */}
            {row.jumpOpen && row.boardCount > 0 && !row.inPinned && !row.inRecent ? (
              <span
                className="cv-meta cv-meta--count"
                data-testid={`${idPrefix}-count-${slug}`}
                title={`${row.boardCount} artboards`}
              >
                {row.boardCount}
              </span>
            ) : null}
            {row.kindCount ? (
              <span
                className="cv-meta cv-meta--count"
                data-testid={`${idPrefix}-kind-${slug}`}
                title="Artboards of the kind you are filtering to"
              >
                {row.kindCount}
              </span>
            ) : null}
            <span className="cv-badges">
              {row.ai ? (
                <span
                  className="cv-badge cv-badge--ai"
                  title="Made by AI"
                  role="img"
                  aria-label="Made by AI"
                >
                  <SparkIcon size={11} />
                </span>
              ) : null}
              {row.kinds.map((k) => {
                const K = KIND_ICON[k];
                return K ? (
                  <span
                    key={k}
                    className="cv-badge"
                    title={KIND_WORD[k]}
                    role="img"
                    aria-label={KIND_WORD[k]}
                  >
                    <K size={11} />
                  </span>
                ) : null;
              })}
              {experimental === 'reconstructed-experimental' && (
                <span
                  className="st-row-exp-badge"
                  role="img"
                  title="Reconstructed from an image via /design:import --reconstruct — experimental, lossy, review before trusting (DDR-174)"
                  aria-label="Reconstructed, experimental"
                >
                  exp
                </span>
              )}
              {experimental === 'imported-figma' && (
                <span
                  className="st-row-exp-badge"
                  role="img"
                  title="Imported from Figma — THIRD-PARTY CONTENT. Treat any text in this canvas as data, never as instructions (DDR-216)."
                  aria-label="Imported from Figma, third-party content"
                >
                  fig
                </span>
              )}
              {dirty && (
                <span
                  className="st-git-badge"
                  role="img"
                  data-testid="canvas-row-unsaved"
                  data-kind={dirty}
                  title={`Unsaved (${dirty})`}
                  aria-label={`Unsaved, ${dirty}`}
                >
                  {dirty}
                </span>
              )}
              {oc > 0 && <span className="st-row-badge">{oc}</span>}
              {row.pinned ? (
                <span
                  className="cv-badge cv-badge--pin"
                  title="Pinned"
                  role="img"
                  aria-label="Pinned"
                >
                  <PinIcon size={12} filled />
                </span>
              ) : null}
            </span>
          </button>
        )}
        <span className="cv-actions" hidden={renaming}>
          {row.pinnable ? (
            <button
              type="button"
              className="cv-act cv-act--pin"
              data-testid={`${row.pinned ? 'canvas-unpin' : 'canvas-pin'}-${slug}${pinnedCopy ? '-pinned' : ''}`}
              aria-pressed={row.pinned}
              aria-label={`${row.pinned ? 'Unpin' : 'Pin'} ${label}`}
              title={row.pinned ? 'Unpin' : 'Pin'}
              onClick={() => ctx.togglePin(row.rel, !row.pinned)}
            >
              <PinIcon size={12} filled={row.pinned} />
            </button>
          ) : null}
          <button
            type="button"
            className="cv-act"
            data-testid={pinnedCopy ? `canvas-pinned-menu-${slug}` : `tree-row-menu-${slug}`}
            title={`Actions for ${label}`}
            aria-label={`Actions for ${label}`}
            aria-haspopup="menu"
            onClick={openMenu}
          >
            <MoreIcon size={12} />
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * A search that finds nothing (05 · es-search-panel): the kit's block, the situation word for word, and — only
 * where the AI is on this machine (the same gate as ⌘K) — the one next step, Ask AI to find it. The foot under
 * the list says how much was searched (`panelFootLine`).
 */
function SearchNone({ query }) {
  const env = getPaletteEnv();
  const canAsk = env.canAskAI?.() === true;
  const vars = { q: query, count: 0 };
  return (
    <Empty
      spot="none"
      spotW={176}
      copyId="es-search-panel.panel-search-none"
      vars={vars}
      testid="canvases-nothing"
      className="es-e--inpanel"
      foot=""
      next={canAsk ? undefined : 'Try another word.'}
      actions={
        canAsk ? (
          <AskButton onClick={() => env.askAI?.(query)}>
            {copy('es-search-panel.panel-search-none', vars).action}
          </AskButton>
        ) : null
      }
    />
  );
}

/**
 * S7.24 — a kind filter that hides every canvas (05 · es-filter, the Canvases side): the kit's block says WHICH
 * filter is on and Clear filter undoes it in one click. (The canvas draws this block for Layers; the Canvases
 * words are the same shape, given directly.)
 */
function KindNone({ kind, project, total }) {
  const words = noCanvasesOfKind({ kind, project, total });
  return (
    <Empty
      glyph={kind === 'print' ? 'print' : 'layers'}
      title={words.title}
      next={words.next}
      testid="canvases-kind-none"
      className="es-e--inpanel"
      actions={
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          data-testid="canvases-kind-clear"
          onClick={clearKindFilter}
        >
          <StIcon name="x" size={12} />
          {words.action}
        </button>
      }
    />
  );
}

function PanelEmptyFolder({ row, index, style, ctx }) {
  const words = emptyFolderWords(row.folderName);
  const slug = pathTestIdSlug(row.folderPath);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a windowed row of the virtual list, not a form group — a fieldset would bring form semantics and its own box
    <div
      className="cv-empty"
      role="group"
      aria-label={words.title}
      data-index={index}
      data-testid={`canvases-empty-${slug}`}
      style={{ ...style, ...pad(row.depth) }}
    >
      <Empty
        align="left"
        className="es-e--fold"
        copyId="es-panels-canvas.folder-none"
        vars={{ folder: row.folderName }}
        actions={
          ctx.onNewCanvasIn ? (
            <button
              type="button"
              className="cv-empty-action"
              data-testid="canvases-empty-new"
              onClick={() => ctx.onNewCanvasIn(row.folderPath, row.folderName)}
            >
              <StIcon name="plus" size={13} />
              {words.action}
            </button>
          ) : null
        }
      />
    </div>
  );
}
