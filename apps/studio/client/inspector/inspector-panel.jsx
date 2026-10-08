// inspector/inspector-panel.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect, useRef, useState } from 'react';
import { CssKnobs, trackRecordableWrite } from './css-knobs.jsx';
import { LAYER_VOID_TAGS, LayerRow } from './layers.jsx';
import { Kbd, StIcon } from '../shell/icons.jsx';
import { PhotoKnobs } from '../photo-knobs.jsx';
import { ColorPicker } from './color-picker.jsx';
import { InspectComputed } from './inspect-computed.jsx';
import { ArtboardKnobs, resolveArtboardIdFromSelection } from './artboard-knobs.jsx';

// feature-photo-editor (Task 13/14) — derive the content-addressed photo asset a
// DOM selection points at (an artboard `<img src="assets/<sha8>.<ext>">`). Prefers
// the `photoAsset` the resolver stamped (dom-selection.ts), falling back to a scan
// of the selection's src/html for a selection that reached the panel via a code
// path predating that field. Returns null for a non-photo element.
export const PHOTO_ASSET_RE = /assets\/[0-9a-f]{8}\.[a-z0-9]+/i;

// Simplifier fix (review fan-out, 2026-07-21) — reuse PHOTO_ASSET_RE's own
// source for the global-match variant instead of re-inlining the pattern, so
// the two can never drift apart (e.g. an extension-charset fix landing in one
// and not the other).
export const PHOTO_ASSET_RE_G = new RegExp(PHOTO_ASSET_RE.source, 'gi');

export function photoAssetOfSelection(el) {
  if (!el || Array.isArray(el)) return null;
  if (el.photoAsset) return el.photoAsset;
  const html = el.html || '';
  // feature-4 regression fix (2026-07-20) — the select tool's bare click now
  // picks the TOP-LEVEL container, so a photo selection often arrives as the
  // WRAPPER around the <img>, not the <img> itself. When the selection's
  // subtree contains EXACTLY ONE content-addressed image, offer the Photo tab
  // for it (ambiguous multi-photo containers stay photo-less — drill/⌘-click
  // to pick one).
  if ((el.tag || '').toLowerCase() !== 'img') {
    const imgs = [...new Set(html.match(PHOTO_ASSET_RE_G) || [])];
    const tagged = [...new Set([...html.matchAll(/data-photo-asset="([^"]+)"/g)].map((m) => m[1]))];
    if (tagged.length === 1) return tagged[0];
    if (tagged.length === 0 && imgs.length === 1 && /<img/i.test(html)) return imgs[0];
    return null;
  }
  // Once an edit is baked, the element's LIVE src is a `data:` URL (canvas-lib's
  // PhotoPreviewBridge swaps it in directly) — it never matches PHOTO_ASSET_RE,
  // so a REPLAYED/serialized selection (a WS resync, or the persisted
  // `_active.json` restored on boot) that arrives without the dedicated
  // `photoAsset` field would otherwise permanently lose the Photo tab for any
  // already-edited photo. The element still carries the `data-photo-asset` tag
  // the bridge stamped, and that DOES survive into an outerHTML snapshot — check
  // it before falling back to the plain assets/<sha8> src scan.
  const tagged = /data-photo-asset="([^"]+)"/.exec(html);
  if (tagged) return tagged[1];
  const m = PHOTO_ASSET_RE.exec(`${el.attrs?.src || ''} ${html}`);
  return m ? m[0] : null;
}

export function InspectorPanel({
  /** E4 — `inspector-panel` / `layers-panel`, so one parity spec can assert
   *  both shells show them. Undefined elsewhere; the attribute simply absent. */
  testId,
  selected,
  onClose,
  layersTree,
  // feature-4 T7a — { [cdId]: { component, root, usages } } for purple rows.
  componentMap,
  // feature-4 T7b — locked layer keys (`"<id>:<index>"`) + toggle.
  lockedKeys,
  onToggleLock,
  // feature-4 detach-component — clone-definition detach for a shared instance.
  onDetachInstance,
  canvasFile,
  onSelectLayer,
  onHoverLayer,
  onReorderLayer,
  layersBusyRef,
  cfg,
  onOptimistic,
  onRecordEdit,
  onReplaceMedia,
  onResizeArtboard,
  onSetArtboardHug,
  onSetArtboardStyle,
  onSetArtboardKind,
  onSetArtboardPrint,
  onDuplicateArtboard,
  onUndoRedo,
  editScope,
  tab: tabProp,
  onTabChange,
  width,
  resizing,
  // feature-photo-editor (Task 13/15) — the Photo tab + its live-preview /
  // bg-removal / undo channels. `photoSel` is the annotation-image target
  // (threaded up separately since the annotation model has no DOM selection);
  // an artboard `<img>` target is derived from `selected` instead.
  photoSel,
  photoRev,
  onPhotoEdit,
  onPhotoRemoveBackground,
  onPhotoRecordEdit,
  onPhotoUndoRedo,
  // feature-configurable-panel-docking — when true this instance IS the standalone
  // Layers panel: it forces the Layers view and hides the tab bar (the tab strip
  // lives on the dock slot instead). `hideLayersTab` drops the inline Layers tab
  // when Layers has been split into its own panel.
  layersOnly = false,
  hideLayersTab = false,
  // DDR-171 — CSS-panel vocabulary mode ('advanced' | 'designer'), owned by App
  // (single source of truth shared with Settings → Appearance).
  cpMode,
  onSetCpMode,
}) {
  // Tab is controllable from the parent (the guided tour drives it to 'css' /
  // 'layers' so a spotlight step lands on a real row) but falls back to local
  // state for normal use. A user click both updates local state and notifies the
  // parent, so the two stay in lockstep whichever owns it.
  const [tabState, setTabState] = useState('inspect');
  const tab = layersOnly ? 'layers' : (tabProp ?? tabState);
  const setTab = (t) => {
    setTabState(t);
    onTabChange?.(t);
  };
  const [collapsed, setCollapsed] = useState(() => new Set());
  // Phase 12.3 (W3.1) — per-layer visibility toggle. Persists via /_api/edit-css
  // (property 'display', mirroring CssKnobs' commit/reset) and is undoable via
  // the same edit-source command (see the undo/redo coverage RCA:
  // .ai/logs/rca/issue-undo-redo-coverage-gaps.md). Keyed by `${id}:${index}`;
  // holds only OPTIMISTIC overrides (either direction) over the tree-reported
  // `node.hidden` (the authoritative source value) so a first render of an
  // already-hidden element shows the correct eye-icon state without a click.
  const [hiddenOverride, setHiddenOverride] = useState(() => new Map());
  // feature-4 T7 — auto-reveal the selected row: expand any collapsed ancestor
  // group + scroll it into view, so a canvas selection is never hidden behind a
  // collapsed wrapper (a Figma layers-panel expectation). Runs whenever the
  // selection or the (HMR-refreshed) tree changes.
  useEffect(() => {
    const sel = Array.isArray(selected) ? selected[0] : selected;
    const selId = sel?.id;
    if (!selId || !layersTree?.nodes) return;
    const selIdx = sel.index;
    let matchedKey = null;
    const ancestorKeys = [];
    (function find(nodes, trail) {
      for (const n of nodes || []) {
        const k = `${n.id}:${n.index}`;
        if (!n.synthetic && n.id === selId && (selIdx == null || n.index === selIdx)) {
          matchedKey = k;
          ancestorKeys.push(...trail);
          return true;
        }
        if (n.children && n.children.length && find(n.children, [...trail, k])) return true;
      }
      return false;
    })(layersTree.nodes, []);
    if (!matchedKey) return;
    if (ancestorKeys.length) {
      setCollapsed((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const k of ancestorKeys) if (next.delete(k)) changed = true;
        return changed ? next : prev;
      });
    }
    requestAnimationFrame(() => {
      try {
        document
          .querySelector(`.st-layer--row[data-layer-key="${matchedKey}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      } catch {
        /* selector edge case — non-fatal */
      }
    });
  }, [selected, layersTree]);
  const isNodeHidden = (node) => {
    const key = `${node.id}:${node.index}`;
    return hiddenOverride.has(key) ? hiddenOverride.get(key) : !!node.hidden;
  };
  // Phase 12.1 (DDR-138) — drag-to-reorder state (lifted so every row sees the
  // same drop target) + an aria-live announcement for keyboard moves.
  const [dragState, setDragState] = useState(null);
  const [reorderMsg, setReorderMsg] = useState('');
  // feature-4 T7c — Layers-panel rename: writes `data-dc-element` (the label's
  // top-priority source in `layerLabel`) via the existing /_api/edit-attr lane
  // + records undo through the same source-edit channel CssKnobs uses. The
  // HMR reload re-posts the tree with the new label.
  const renameLayer = (node, value) => {
    if (!canvasFile || !node?.id) return;
    trackRecordableWrite(fetch('/_api/edit-attr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ canvas: canvasFile, id: node.id, attr: 'data-dc-element', value }),
    })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!j.ok) return;
        onRecordEdit?.({
          op: 'attr',
          canvas: canvasFile,
          id: node.id,
          key: 'data-dc-element',
          before: node.dcElement ?? null,
          after: value,
        });
      })
      .catch(() => {}));
  };
  const handleReorder = onReorderLayer
    ? (dragged, ref, position) => {
        // Gate keyboard + drop moves while a prior reorder is still landing — the
        // write churns positional ids, so acting on the stale tree would misfire.
        if (layersBusyRef?.current) return;
        // feature-4 T7 — a synthetic group row (unstamped wrapper) has no
        // data-cd-id to address in source, so it can be neither dragged nor a
        // drop target. Abort silently rather than post an unresolvable refId
        // that would optimistically move then revert (a visible flicker).
        if (dragged?.synthetic || ref?.synthetic) return;
        const verb =
          position === 'before'
            ? `before ${ref.label}`
            : position === 'after'
              ? `after ${ref.label}`
              : `into ${ref.label}`;
        setReorderMsg(`Moved ${dragged.label} ${verb}`);
        // Pass occurrence indices so a reused-component instance maps to its
        // parent <Component> usage server-side (same-id instances are distinct).
        onReorderLayer(dragged.id, ref.id, position, {
          idIndex: dragged.index,
          refIndex: ref.index,
        });
      }
    : undefined;
  // Flatten the VISIBLE tree (respecting collapse) with each node's depth,
  // parent, siblings, and index — the basis for keyboard nav + moves.
  const flattenVisibleLayers = () => {
    const flat = [];
    (function walk(nodes, depth, parentNode) {
      (nodes || []).forEach((n, i) => {
        flat.push({ node: n, depth, parentNode, siblings: nodes, pos: i });
        if (n.children && n.children.length && !collapsed.has(`${n.id}:${n.index}`))
          walk(n.children, depth + 1, n);
      });
    })(layersTree?.nodes, 0, null);
    return flat;
  };
  // The keyboard cursor is the SELECTED element (NOT DOM focus, which the HMR
  // re-render churns). ↑/↓ move the selection through the flattened tree;
  // Alt+↑/↓ reorder within the parent; Alt+Shift+↑/↓ reorder across the parent
  // boundary (out at first/last, into an adjacent open container). After a move
  // the reorder re-selects the moved element (movedId), so the cursor follows
  // and the next press keeps working — the fix for "Alt+arrow works once".
  const onTreeKeyDown = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!el) return;
    const flat = flattenVisibleLayers();
    const i = flat.findIndex((f) => f.node.id === el.id && f.node.index === el.index);
    if (i < 0) return;
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const cur = flat[i];
    if (!e.altKey) {
      const t = flat[i + dir];
      if (t) {
        e.preventDefault();
        onSelectLayer?.(t.node);
      }
      return;
    }
    if (!handleReorder || !Array.isArray(cur.siblings)) return;
    e.preventDefault();
    const expanded = (n) =>
      n && n.children && n.children.length && !collapsed.has(`${n.id}:${n.index}`);
    if (!e.shiftKey) {
      // Within-parent reorder; stop at the first/last sibling.
      if (dir < 0 && cur.pos > 0) handleReorder(cur.node, cur.siblings[cur.pos - 1], 'before');
      else if (dir > 0 && cur.pos < cur.siblings.length - 1)
        handleReorder(cur.node, cur.siblings[cur.pos + 1], 'after');
      return;
    }
    // Cross-parent reorder (flattened traversal).
    if (dir > 0) {
      const next = cur.siblings[cur.pos + 1];
      if (next) handleReorder(cur.node, next, expanded(next) ? 'inside-start' : 'after');
      else if (cur.parentNode) handleReorder(cur.node, cur.parentNode, 'after');
    } else {
      const prev = cur.siblings[cur.pos - 1];
      if (prev) handleReorder(cur.node, prev, expanded(prev) ? 'inside-end' : 'before');
      else if (cur.parentNode) handleReorder(cur.node, cur.parentNode, 'before');
    }
  };
  // Pointer-based drag-to-reorder in the Layers tree — same model as the
  // in-canvas drag: the row FLOATS with the cursor (transform, slot reserved), a
  // blue divider (or nest ring) marks the drop, and the move commits only on
  // release. Same-origin shell, so it's all local (no dgn bus).
  const layerDragRef = useRef(null);
  const layerTreeRef = useRef(null);
  const startLayerDrag = (e, node, key) => {
    if (!handleReorder || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (layersBusyRef?.current) return; // a prior reorder is still landing (ids churning)
    const startX = e.clientX;
    const startY = e.clientY;
    // Forbid dropping a node into itself or its own subtree.
    const forbidden = new Set([key]);
    (function walk(n) {
      (n.children || []).forEach((c) => {
        forbidden.add(`${c.id}:${c.index}`);
        walk(c);
      });
    })(node);
    // Flatten the VISIBLE tree (respecting collapse) with depth. The drop is
    // computed dnd-kit-tree style: a GAP between rows + a DEPTH from the pointer's
    // X — so you can nest into any container (even an empty one) and the divider
    // INDENTS to show it's going into that nested list (Figma-style).
    const INDENT = 14;
    const BASE = 6;
    const flat = [];
    (function walk(nodes, depth) {
      (nodes || []).forEach((n) => {
        const k = `${n.id}:${n.index}`;
        flat.push({ node: n, key: k, id: n.id, depth, tag: n.tag });
        if (n.children && n.children.length && !collapsed.has(k)) walk(n.children, depth + 1);
      });
    })(layersTree?.nodes, 0);
    const flatByKey = new Map(flat.map((it) => [it.key, it]));
    let started = false;
    const onMove = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        started = true;
      }
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let target = null;
      // Visible rows in DOM (== flat) order, minus the dragged one (its rect is
      // floated, so it's meaningless for gap math).
      const rows = [].slice
        .call(document.querySelectorAll('.st-layer--row[data-layer-key]'))
        .map((el) => ({ rect: el.getBoundingClientRect(), it: flatByKey.get(el.getAttribute('data-layer-key')) }))
        .filter((r) => r.it && r.it.key !== key);
      if (rows.length) {
        const rowLeft = rows[0].rect.left;
        const rowRight = rows[0].rect.right;
        // Gap = index of the first row whose vertical midpoint is below the pointer.
        let gap = rows.length;
        for (let i = 0; i < rows.length; i++) {
          if (ev.clientY < rows[i].rect.top + rows[i].rect.height / 2) {
            gap = i;
            break;
          }
        }
        const prev = rows[gap - 1]?.it || null;
        const nextIt = rows[gap]?.it || null;
        // Depth from pointer X. Clamp between the row below (min) and one level
        // under the row above (max, if it can hold children).
        const raw = Math.round((ev.clientX - rowLeft - BASE) / INDENT);
        const maxDepth = prev ? prev.depth + (LAYER_VOID_TAGS.has(prev.tag) ? 0 : 1) : 0;
        const minDepth = nextIt ? nextIt.depth : 0;
        const depth = Math.max(minDepth, Math.min(raw, maxDepth));
        // Resolve (prev, depth) → { refId, position, refNode, targetDepth }.
        let refIt = null;
        let position = 'before';
        let targetDepth = 0;
        if (!prev) {
          if (nextIt) {
            refIt = nextIt;
            position = 'before';
            targetDepth = nextIt.depth;
          }
        } else if (depth > prev.depth) {
          refIt = prev; // nest as prev's FIRST child
          position = 'inside-start';
          targetDepth = prev.depth + 1;
        } else if (depth === prev.depth) {
          refIt = prev;
          position = 'after';
          targetDepth = prev.depth;
        } else {
          for (let i = gap - 1; i >= 0; i--) {
            if (rows[i].it.depth === depth) {
              refIt = rows[i].it;
              break;
            }
          }
          if (!refIt) refIt = prev;
          position = 'after';
          targetDepth = depth;
        }
        // Guard: no self, no dragged-subtree, no repeated (list) target.
        // forbidden already holds the dragged node's own key + its subtree, so a
        // different INSTANCE of the same reused component (same id, other key) is
        // still a valid target.
        if (refIt && refIt.key !== key && !forbidden.has(refIt.key)) {
          const y = prev ? rows[gap - 1].rect.bottom : rows[0].rect.top;
          const left = rowLeft + BASE + targetDepth * INDENT;
          target = { refId: refIt.id, position, node: refIt.node, y, left, w: Math.max(24, rowRight - left) };
        }
      }
      const next = { key, node, dx, dy, target };
      layerDragRef.current = next;
      setDragState(next);
    };
    const teardown = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
    // Swallow the click that trails a drag so it doesn't also select a row.
    const suppressClick = () => {
      const sup = (ce) => {
        ce.preventDefault();
        ce.stopImmediatePropagation();
        document.removeEventListener('click', sup, true);
      };
      document.addEventListener('click', sup, true);
      setTimeout(() => document.removeEventListener('click', sup, true), 300);
    };
    const onUp = () => {
      teardown();
      const d = layerDragRef.current;
      layerDragRef.current = null;
      setDragState(null);
      if (started && d?.target) {
        suppressClick();
        handleReorder(d.node, d.target.node, d.target.position);
      }
    };
    // Esc — abort the drag: the row snaps back, nothing commits.
    const onKey = (ke) => {
      if (ke.key !== 'Escape') return;
      ke.preventDefault();
      ke.stopImmediatePropagation();
      teardown();
      layerDragRef.current = null;
      setDragState(null);
      if (started) suppressClick();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  };
  const toggleCollapse = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleVisibility = (node) => {
    const key = `${node.id}:${node.index}`;
    const wasHidden = isNodeHidden(node);
    const willHide = !wasHidden;
    setHiddenOverride((prev) => new Map(prev).set(key, willHide));
    onOptimistic?.({
      id: node.id,
      artboardId: layersTree?.artboardId ?? null,
      index: node.index,
      prop: 'display',
      value: willHide ? 'none' : null,
    });
    if (!canvasFile || !node.id) return;
    fetch('/_api/edit-css', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        willHide
          ? { canvas: canvasFile, id: node.id, property: 'display', value: 'none' }
          : { canvas: canvasFile, id: node.id, property: 'display', reset: true }
      ),
    }).catch(() => {});
    // Record onto the canvas undo stack (Cmd+Z), same as any other inline CSS
    // edit — fire-and-forget alongside the POST above, mirroring CssKnobs'
    // commit()/reset() (which don't gate the record on the fetch resolving).
    onRecordEdit?.({
      op: 'css',
      canvas: canvasFile,
      id: node.id,
      key: 'display',
      before: wasHidden ? 'none' : null,
      after: willHide ? 'none' : null,
    });
  };
  // `selected` may be a single element, an array (multi-select), or null.
  const el = Array.isArray(selected) ? selected[0] : selected;
  // feature-photo-editor (Task 13) — resolve the Photo-tab target. Priority: an
  // annotation-image threaded up (`photoSel`, no DOM selection) → a Photo-ONLY
  // panel; else a content-addressed artboard `<img>` selection → Photo alongside
  // the normal tabs.
  const photoTarget = photoSel
    ? { asset: photoSel.asset, kind: 'annotation-image' }
    : (() => {
        const a = photoAssetOfSelection(el);
        return a ? { asset: a, kind: 'artboard-img' } : null;
      })();
  const photoOnly = photoTarget?.kind === 'annotation-image';
  // Cmd+Z / Cmd+Shift+Z (or Cmd+Y) while focus is still inside a Photo-tab
  // slider — mirrors `onKnobKeyDown` above for the same reason: the window-
  // level shortcut listener bails out whenever `document.activeElement` is an
  // `<input>` (native text-undo would otherwise win), so a commit-then-Cmd+Z
  // with the slider still focused needs its own forwarder here.
  const onPhotoKnobKeyDown = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      onPhotoUndoRedo?.(e.shiftKey ? 'redo' : 'undo');
    } else if (k === 'y') {
      e.preventDefault();
      onPhotoUndoRedo?.('redo');
    }
  };
  // An annotation-image has no element tabs; force Photo. Otherwise honor the
  // requested tab, but drop off a stale 'photo' tab when the new selection isn't
  // photo-eligible — onto CSS, the editing tab a fresh selection opens on (Stage
  // C). Landing on read-only Inspect meant that after touching a sticker, the
  // next element you clicked showed facts instead of the controls to change it.
  const effTab = photoOnly ? 'photo' : tab === 'photo' && !photoTarget ? 'css' : tab;
  const tabBtn = (id, label, icon) => (
    <button
      type="button"
      className={'st-rp-tab' + (effTab === id ? ' is-active' : '')}
      onClick={() => setTab(id)}
    >
      <StIcon name={icon} size={14} />
      {label}
    </button>
  );
  const b = el?.bounds || null;
  return (
    <aside
      className={'st-rpanel' + (resizing ? ' is-resizing' : '')}
      style={width ? { width, flexBasis: width } : undefined}
      aria-label="Inspector"
      data-tour="inspector"
      data-testid={testId}
    >
      <div
        className="st-rp-tabs"
        data-tour="inspector-tabs"
        style={layersOnly ? { display: 'none' } : undefined}
      >
        {photoOnly ? (
          tabBtn('photo', 'Photo', 'image')
        ) : (
          <>
            {tabBtn('inspect', 'Inspect', 'sliders')}
            {!hideLayersTab && tabBtn('layers', 'Layers', 'layers')}
            {tabBtn('css', 'CSS', 'code')}
            {photoTarget ? tabBtn('photo', 'Photo', 'image') : null}
          </>
        )}
        <button
          type="button"
          className="st-iconbtn"
          aria-label="Close inspector"
          style={{ marginLeft: 'auto' }}
          onClick={onClose}
        >
          <StIcon name="x" size={14} />
        </button>
      </div>
      {/* Stage H (INV-3) — edit-scope strip: is an edit local to this element or
          shared across N rendered places? Visible across every tab so it's never
          a surprise. Only for a single element selection with a resolved verdict. */}
      {el?.id && !(Array.isArray(selected) && selected.length > 1) && editScope ? (
        <div
          className={`st-scope st-scope--${editScope.scope}`}
          title={
            editScope.scope === 'shared'
              ? `Editing this element's style changes ${editScope.affects} place${
                  editScope.affects === 1 ? '' : 's'
                }${
                  editScope.componentName ? ` (component ${editScope.componentName})` : ''
                }. Move/resize a whole instance to keep it local.`
              : 'This edit affects only this element.'
          }
        >
          <span className="st-scope-dot" aria-hidden="true" />
          {editScope.scope === 'shared'
            ? `Shared${editScope.componentName ? ` · ${editScope.componentName}` : ''} · edits ${
                editScope.affects
              } place${editScope.affects === 1 ? '' : 's'}`
            : 'Local · this element only'}
          {/* feature-4 detach-component (2026-07-19) — make THIS instance its
              own single-usage component so edits (incl. absolute positions)
              stay local per artboard. */}
          {editScope.scope === 'shared' && onDetachInstance ? (
            <button
              type="button"
              className="st-scope-detach"
              title="Clone this component for this instance only — edits stop affecting the other places"
              onClick={() => onDetachInstance(el.id, el.index)}
            >
              Detach
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="st-rp-body">
        {effTab === 'photo' && photoTarget ? (
          <div onKeyDown={onPhotoKnobKeyDown}>
            <PhotoKnobs
              key={`${photoTarget.asset}:${photoRev ?? 0}`}
              asset={photoTarget.asset}
              ColorPicker={ColorPicker}
              StIcon={StIcon}
              onEdit={(edit) => onPhotoEdit?.(photoTarget.asset, edit)}
              onRemoveBackground={onPhotoRemoveBackground}
              onRecordEdit={(before, after) => onPhotoRecordEdit?.(photoTarget.asset, before, after)}
            />
          </div>
        ) : !el && !(effTab === 'layers' && layersTree?.nodes?.length) ? (
          <div className="st-rp-empty">
            {/* <p> wrapper — st-rp-empty is a flex column, bare text nodes +
                kbd would stack as stretched flex items. */}
            <p>
              Press <Kbd>V</Kbd>, then click an element to select it — or <Kbd>⌘</Kbd>-click
              straight from Browse.
            </p>
          </div>
        ) : el && effTab === 'inspect' ? (
          <>
            <div className="st-rp-hd">{el.selector || el.tag || 'element'}</div>
            <div className="st-insp-row">
              <span className="st-insp-label">Pos</span>
              <div className="st-insp-fields">
                <span className="st-fmini">
                  <span className="st-mtag">X</span>
                  <input value={b ? Math.round(b.x) : '—'} readOnly aria-label="x position" />
                </span>
                <span className="st-fmini">
                  <span className="st-mtag">Y</span>
                  <input value={b ? Math.round(b.y) : '—'} readOnly aria-label="y position" />
                </span>
              </div>
            </div>
            <div className="st-insp-row">
              <span className="st-insp-label">Size</span>
              <div className="st-insp-fields">
                <span className="st-fmini">
                  <span className="st-mtag">W</span>
                  <input value={b ? Math.round(b.w) : '—'} readOnly aria-label="width" />
                </span>
                <span className="st-fmini">
                  <span className="st-mtag">H</span>
                  <input value={b ? Math.round(b.h) : '—'} readOnly aria-label="height" />
                </span>
              </div>
            </div>
            <div className="st-insp-row">
              <span className="st-insp-label">Tag</span>
              <div className="st-insp-fields">
                <span className="st-mono" style={{ fontSize: 11, color: 'var(--fg-0)' }}>
                  {el.tag || '—'}
                </span>
              </div>
            </div>
            {el.classes ? (
              <div className="st-insp-row">
                <span className="st-insp-label">Class</span>
                <div className="st-insp-fields">
                  <span className="st-mono" style={{ fontSize: 11, color: 'var(--fg-1)' }}>
                    {el.classes}
                  </span>
                </div>
              </div>
            ) : null}
            <InspectComputed el={el} />
          </>
        ) : effTab === 'layers' ? (
          <>
            <div className="st-rp-hd">Layers{layersTree?.nodes?.length ? '' : ' · ancestry'}</div>
            {layersTree?.nodes?.length ? (
              <>
                {handleReorder ? (
                  <div className="st-rp-hint" aria-hidden="true">
                    Drag or ↑/↓ select · Alt+↑/↓ move · Alt+Shift+↑/↓ move across
                  </div>
                ) : null}
                {/* Keyboard nav/move handled at the container (tabIndex=0), driven
                    by the SELECTION not row focus — survives the HMR re-render. */}
                <div
                  role="tree"
                  aria-label="Artboard layers"
                  tabIndex={0}
                  ref={layerTreeRef}
                  onKeyDown={onTreeKeyDown}
                >
                  {layersTree.nodes.map((n, ni) => (
                    <LayerRow
                      key={`${n.id}:${n.index}`}
                      node={n}
                      depth={0}
                      selectedId={el?.id}
                      selectedIndex={el?.index}
                      collapsed={collapsed}
                      hiddenOverride={hiddenOverride}
                      onToggle={toggleCollapse}
                      onSelect={(node) => {
                        onSelectLayer?.(node);
                        layerTreeRef.current?.focus();
                      }}
                      onHover={(node) => onHoverLayer?.(node)}
                      onToggleVisibility={toggleVisibility}
                      onReorder={handleReorder}
                      onRowPointerDown={startLayerDrag}
                      dragState={dragState}
                      componentMap={componentMap}
                      lockedKeys={lockedKeys}
                      onToggleLock={onToggleLock}
                      onRename={renameLayer}
                    />
                  ))}
                </div>
                {dragState?.target ? (
                  <div
                    className="st-layer-divider"
                    aria-hidden="true"
                    style={{
                      left: dragState.target.left,
                      top: dragState.target.y - 1,
                      width: dragState.target.w,
                    }}
                  />
                ) : null}
                <div className="sr-only" role="status" aria-live="polite">
                  {reorderMsg}
                </div>
              </>
            ) : el && Array.isArray(el.dom_path) && el.dom_path.length ? (
              el.dom_path.map((node, i) => (
                <div
                  key={i}
                  className={'st-layer' + (i === el.dom_path.length - 1 ? ' is-sel' : '')}
                  style={{ paddingLeft: 8 + i * 12 }}
                >
                  <StIcon name="square" size={13} />
                  {node}
                </div>
              ))
            ) : (
              <div className="st-rp-empty">
                Select an element (⌘-click in the canvas) to see its layer tree.
              </div>
            )}
          </>
        ) : !el.id && resolveArtboardIdFromSelection(el) ? (
          <ArtboardKnobs
            el={el}
            cfg={cfg}
            onResizeArtboard={onResizeArtboard}
            onSetArtboardHug={onSetArtboardHug}
            onSetArtboardStyle={onSetArtboardStyle}
            onSetArtboardKind={onSetArtboardKind}
            onSetArtboardPrint={onSetArtboardPrint}
            onDuplicateArtboard={onDuplicateArtboard}
          />
        ) : (
          <CssKnobs
            el={el}
            cfg={cfg}
            onOptimistic={onOptimistic}
            onRecordEdit={onRecordEdit}
            onReplaceMedia={onReplaceMedia}
            onUndoRedo={onUndoRedo}
            mode={cpMode}
            onSetMode={onSetCpMode}
          />
        )}
      </div>
    </aside>
  );
}
