// inspector/layers.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useState } from 'react';
import { StIcon } from '../shell/icons.jsx';

// ---------- Inspector panel (display-only) ----------
//
// T6 (Plan C) — right-dock Inspect / Layers / CSS tabs per `.design/ui/Studio.tsx`
// InspectorPanel. DISPLAY-ONLY: reads the live `selected` payload from the
// inspector bridge (`bounds`, `tag`, `classes`, `dom_path`, `html`). The
// mockup's live-CSS-knob WRITEBACK is Phase 12 (needs a canvas-origin write
// bridge, DDR-054) — the CSS tab shows markup read-only + keeps that callout, so
// it never implies functionality it lacks (the exact reason DDR-096 deferred it).
// ---------- Layers tree row (Phase 12 Task 4) ----------
// Phase 12.3 (W3.1) — map a LayerNode `type` (classified in canvas-shell) to a
// type-distinct icon, matching the Studio.tsx layers design.
export const LAYER_TYPE_ICON = {
  button: 'button',
  heading: 'type',
  text: 'type',
  input: 'input',
  form: 'input',
  image: 'image',
  link: 'link',
  list: 'list',
  nav: 'layers',
  box: 'box',
  // feature-4 T7 — synthetic group row (unstamped wrapper with stamped kids).
  group: 'folder',
};

// Optimistic layers-tree reorder — move the node with `draggedId` relative to
// `refId` (before / after a sibling, or inside-end as a last child). Pure: clones
// the node array and returns a new one, so React re-renders. Ids are distinct
// here (repeated/list nodes can't be dragged), so first-match-by-id is safe.
// Returns the input unchanged if either node isn't found (the HMR rebuild will
// reconcile).
export function moveLayerNode(nodes, draggedId, refId, position) {
  if (!Array.isArray(nodes) || draggedId === refId) return nodes;
  const clone = JSON.parse(JSON.stringify(nodes));
  let dragged = null;
  const remove = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === draggedId) {
        dragged = arr[i];
        arr.splice(i, 1);
        return true;
      }
      if (arr[i].children && remove(arr[i].children)) return true;
    }
    return false;
  };
  remove(clone);
  if (!dragged) return nodes;
  const insert = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === refId) {
        if (position === 'inside-start' || position === 'inside-end') {
          arr[i].children = arr[i].children || [];
          if (position === 'inside-start') arr[i].children.unshift(dragged);
          else arr[i].children.push(dragged);
        } else {
          arr.splice(position === 'before' ? i : i + 1, 0, dragged);
        }
        return true;
      }
      if (arr[i].children && insert(arr[i].children)) return true;
    }
    return false;
  };
  return insert(clone) ? clone : nodes;
}

// Void / self-closing tags can't hold children → not a nest target. Everything
// else (div, section, span, …) can be nested into (matches "drop into any div").
export const LAYER_VOID_TAGS = new Set([
  'img', 'input', 'br', 'hr', 'area', 'base', 'col', 'embed', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

export function LayerRow({
  node,
  depth,
  selectedId,
  selectedIndex,
  collapsed,
  hiddenOverride,
  onToggle,
  onSelect,
  onHover,
  onToggleVisibility,
  onReorder,
  onRowPointerDown,
  dragState,
  // feature-4 T7a/b/c — component map (purple ◇/◆), locked keys + toggle,
  // dblclick rename (writes data-dc-element via edit-attr).
  componentMap,
  lockedKeys,
  onToggleLock,
  onRename,
}) {
  const key = `${node.id}:${node.index}`;
  const hasKids = node.children && node.children.length > 0;
  const isCollapsed = collapsed.has(key);
  // feature-4 T7 — a synthetic group row (unstamped wrapper) is a pure
  // structural stand-in: NOT selectable (no data-cd-id to address in source),
  // NOT draggable, NO eye toggle. Clicking it just expands/collapses.
  const isSynthetic = !!node.synthetic;
  // feature-4 T7a — purple instance rows: this element renders through an
  // instantiated component. `root` = the component's own frame root (◆).
  const inst = !isSynthetic && componentMap ? componentMap[node.id] : null;
  // feature-4 T7b — locked layers can't be selected/dragged on the canvas.
  const isLocked = !isSynthetic && !!lockedKeys?.has(key);
  // feature-4 T7c — inline rename (dblclick the label).
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  // Match the specific INSTANCE (id + occurrence index), not every element that
  // shares this source id — otherwise a `.map`ed element highlights all its
  // clones at once. Fall back to id-only when the selection carries no index.
  const isSel =
    !isSynthetic &&
    node.id === selectedId &&
    (selectedIndex == null || node.index === selectedIndex);
  const isHidden = hiddenOverride?.has(key) ? hiddenOverride.get(key) : !!node.hidden;
  // A shared data-cd-id (reused component instance) IS reorderable now — the
  // server maps the occurrence index to the parent <Component> usage — so these
  // are no longer greyed/blocked. A `.map()`ed single-usage element still can't
  // split; that move is refused server-side and reverts. A LOCKED row never
  // drags (feature-4 T7b).
  const canDrag = !!onReorder && !isSynthetic && !isLocked;
  const commitRename = () => {
    setRenaming(false);
    const v = renameDraft
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    if (!v || v === (node.dcElement ?? '')) return;
    onRename?.(node, v);
  };
  // Phase 12.1 — the row being dragged FLOATS with the cursor (same model as the
  // in-canvas drag): a transform follows the pointer, its layout box stays
  // reserved (empty slot at the origin), and pointer-events:none lets the row
  // under the pointer be hit-tested. A blue divider (rendered by the tree) marks
  // where it drops — indented to show the depth it will nest at (Figma-style).
  const isDragging = dragState?.key === key;
  const dragStyle = isDragging
    ? {
        transform: `translate(${dragState.dx}px, ${dragState.dy}px)`,
        opacity: 0.9,
        zIndex: 20,
        position: 'relative',
        pointerEvents: 'none',
        cursor: 'grabbing',
        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.28)',
      }
    : null;
  return (
    <>
      <div
        className={
          'st-layer st-layer--row' +
          (isSel ? ' is-sel' : '') +
          (isHidden ? ' is-hidden' : '') +
          (isSynthetic ? ' is-group' : '') +
          (inst ? ' is-instance' : '') +
          (isLocked ? ' is-locked' : '')
        }
        style={{ paddingLeft: 6 + depth * 14, ...dragStyle }}
        role="treeitem"
        aria-selected={isSynthetic ? undefined : isSel}
        aria-expanded={hasKids ? !isCollapsed : undefined}
        aria-grabbed={canDrag ? isDragging : undefined}
        tabIndex={0}
        title={
          isSynthetic
            ? `${node.tag} · group (unstamped wrapper)`
            : `${node.tag} · ${node.type}${onRename ? ' · F2 to rename' : ''}`
        }
        data-layer-key={key}
        onClick={() => (isSynthetic ? hasKids && onToggle(key) : onSelect(node))}
        onMouseEnter={() => !isSynthetic && onHover(node)}
        onMouseLeave={() => onHover(null)}
        onPointerDown={canDrag ? (e) => onRowPointerDown(e, node, key) : undefined}
        onKeyDown={(e) => {
          // Enter/Space select (or, for a synthetic group, toggle); ↑/↓ (+
          // modifiers) are handled at the tree container (selection-driven —
          // survives the HMR re-render).
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (isSynthetic) hasKids && onToggle(key);
            else onSelect(node);
          } else if (e.key === 'F2' && onRename && !isSynthetic) {
            // a11y fix (review fan-out, 2026-07-21) — dblclick was the ONLY
            // entry point into rename, a keyboard-only user had no way to
            // reach it at all (WCAG 2.1.1). F2 is the conventional rename key
            // (Explorer/Finder/most tree UIs); mirrors the dblclick handler's
            // own pre-fill.
            e.preventDefault();
            setRenameDraft(node.dcElement || node.label || '');
            setRenaming(true);
          }
        }}
      >
        {hasKids ? (
          <button
            type="button"
            className="st-layer-caret"
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(key);
            }}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="st-layer-caret" aria-hidden="true" />
        )}
        {inst ? (
          // feature-4 T7a — Figma vocabulary: ◆ the component's own frame root,
          // ◇ an inner member of an instance. Purple via .is-instance CSS.
          <span className="st-layer-inst-glyph" aria-hidden="true">
            {inst.root ? '◆' : '◇'}
          </span>
        ) : (
          <StIcon name={LAYER_TYPE_ICON[node.type] || 'box'} size={12} className="st-layer-ticon" />
        )}
        {renaming ? (
          <input
            className="st-layer-rename"
            value={renameDraft}
            autoFocus
            aria-label={`Rename ${node.label}`}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setRenameDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span
            className="st-layer-label"
            onDoubleClick={
              onRename && !isSynthetic
                ? (e) => {
                    // feature-4 T7c — dblclick rename. Pre-fill from the raw
                    // data-dc-element (kebab) when set, else the display label.
                    e.stopPropagation();
                    setRenameDraft(node.dcElement || node.label || '');
                    setRenaming(true);
                  }
                : undefined
            }
          >
            {node.label}
          </span>
        )}
        <span className="st-layer-type">{inst ? inst.component : node.type}</span>
        {onToggleLock && !isSynthetic ? (
          <button
            type="button"
            className="st-layer-lock"
            aria-label={isLocked ? `Unlock ${node.label}` : `Lock ${node.label}`}
            aria-pressed={isLocked}
            title={isLocked ? 'Unlock' : 'Lock'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock(key);
            }}
          >
            <StIcon name={isLocked ? 'lock' : 'unlock'} size={12} />
          </button>
        ) : null}
        {onToggleVisibility && !isSynthetic ? (
          <button
            type="button"
            className="st-layer-eye"
            aria-label={isHidden ? `Show ${node.label}` : `Hide ${node.label}`}
            aria-pressed={isHidden}
            title={isHidden ? 'Show' : 'Hide'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisibility(node);
            }}
          >
            <StIcon name={isHidden ? 'eye-off' : 'eye'} size={13} />
          </button>
        ) : null}
      </div>
      {hasKids && !isCollapsed
        ? node.children.map((c, ci) => (
            <LayerRow
              key={`${c.id}:${c.index}`}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              selectedIndex={selectedIndex}
              collapsed={collapsed}
              hiddenOverride={hiddenOverride}
              onToggle={onToggle}
              onSelect={onSelect}
              onHover={onHover}
              onToggleVisibility={onToggleVisibility}
              onReorder={onReorder}
              onRowPointerDown={onRowPointerDown}
              dragState={dragState}
              componentMap={componentMap}
              lockedKeys={lockedKeys}
              onToggleLock={onToggleLock}
              onRename={onRename}
            />
          ))
        : null}
    </>
  );
}
