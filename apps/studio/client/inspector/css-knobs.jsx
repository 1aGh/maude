// inspector/css-knobs.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect, useRef, useState } from 'react';
import { activeDsNameFor, useAllDsTokens } from './ds-tokens.js';
import { cssColorToHex, cssHint, cssSplitUnit } from './color.js';
import { sizingModeOf, sizingModePatch } from '../../sizing-mode.ts';
import { AlignPad, AngleDial, ColorField, IconButtonGroup, IconToggleGroup, NumberField, RadiusControl, Segmented, SliderField, Toggle, UnitSelect, ValueTokenField, makeScrubHandler } from '../inspector-controls.jsx';
import { Lu, StIcon } from '../shell/icons.jsx';
import { AlignCenter as LuAlignCenter, AlignHorizontalJustifyCenter as LuJustifyCenter, AlignHorizontalJustifyEnd as LuJustifyEnd, AlignHorizontalJustifyStart as LuJustifyStart, AlignHorizontalSpaceBetween as LuSpaceBetween, AlignJustify as LuAlignJustify, AlignLeft as LuAlignLeft, AlignRight as LuAlignRight, AlignVerticalJustifyCenter as LuVJustifyCenter, AlignVerticalJustifyEnd as LuVJustifyEnd, AlignVerticalJustifyStart as LuVJustifyStart, Bold as LuBold, Braces as LuBraces, Columns3 as LuColumns3, Eye as LuEye, Italic as LuItalic, RotateCw as LuRotateCw, Rows3 as LuRows3, Scissors as LuScissors, ScrollText as LuScrollText, StretchHorizontal as LuStretch, Underline as LuUnderline, Wand2 as LuWand2 } from 'lucide-react';
import { CSS_ALIGN_SELF, CSS_ASPECT_RATIO, CSS_BLEND_MODES, CSS_BORDER_STYLES, CSS_DISPLAYS, CSS_FONTS, CSS_FONT_STYLE, CSS_OBJECT_FIT, CSS_POSITION, CSS_TEXT_TRANSFORM, CSS_UNITLESS, CSS_UNITS, CSS_WEIGHTS, CSS_WHITE_SPACE, PROP_LEAD } from './css-vocab.jsx';
import { TokenPopover } from './token-popover.jsx';
import { parseTrackList, serializeTrackList } from '../../grid-track-handles.ts';
import { GridTracksEditor } from './grid-tracks-editor.jsx';

// Writes whose success ends in a `record-edit` post to the canvas. The canvas
// asks (`undo-barrier`) before Cmd+Z so it never undoes past an edit whose
// record is still on its way (see afterShellRecords in canvas-shell.tsx).
export const recordableWrites = { pending: 0, waiters: [] };

export function trackRecordableWrite(promise) {
  recordableWrites.pending += 1;
  const settle = () => {
    recordableWrites.pending -= 1;
    if (recordableWrites.pending === 0) for (const w of recordableWrites.waiters.splice(0)) w();
  };
  promise.then(settle, settle);
  return promise;
}

export function afterRecordableWrites() {
  return recordableWrites.pending === 0
    ? Promise.resolve()
    : new Promise((resolve) => recordableWrites.waiters.push(resolve));
}

export function CssKnobs({ el, cfg, onOptimistic, onRecordEdit, onReplaceMedia, onUndoRedo, mode, onSetMode }) {
  const editable = !!el.id;
  const computed = el.computed || {};
  // Phase 12.3 — optimistic local overlay over the selection's authored / custom
  // / attr maps. With the redundant-reload suppression (the flicker fix), an edit
  // no longer triggers a reselect that would re-post fresh `authored` values — so
  // the panel must reflect its own commits immediately or it shows the stale
  // pre-edit value until the user re-selects. Each commit/reset writes here;
  // `null` marks a removed key. Cleared when a different element is selected —
  // and whenever the canvas re-posts this selection's maps. A re-post carries
  // the source as it is NOW (a teammate's change reloads the canvas); keeping
  // our older commit over it showed a stale value and recorded it as the next
  // undo's `before`, so Cmd+Z restored a value nobody had on screen.
  const [overlay, setOverlay] = useState({ a: {}, c: {}, t: {} });
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on a fresh selection payload only.
  useEffect(() => {
    setOverlay({ a: {}, c: {}, t: {} });
  }, [el.id, el.authored, el.customStyles, el.attrs]);
  const mergeOverlay = (base, ov) => {
    const out = { ...(base || {}) };
    for (const [k, v] of Object.entries(ov)) {
      if (v === null) delete out[k];
      else out[k] = v;
    }
    return out;
  };
  const authored = mergeOverlay(el.authored, overlay.a);
  const customStyles = mergeOverlay(el.customStyles, overlay.c);
  const attrs = mergeOverlay(el.attrs, overlay.t);
  const setA = (prop, v) => setOverlay((o) => ({ ...o, a: { ...o.a, [prop]: v } }));
  const setC = (prop, v) => setOverlay((o) => ({ ...o, c: { ...o.c, [prop]: v } }));
  const setT = (attr, v) => setOverlay((o) => ({ ...o, t: { ...o.t, [attr]: v } }));
  // Token CSS is served from the MAIN origin at the repo-relative path, i.e.
  // WITH the designRoot prefix (`/.design/system/<ds>/colors_and_type.css`) —
  // `tokensCssRel` from config is DS-root-relative (no `.design/`), so prepend it.
  const _designRel = (cfg?.designRel || cfg?.designRoot || '.design').replace(/^\/+|\/+$/g, '');
  const _activeDs = activeDsNameFor(el.file, cfg);
  // W3 — tokens from EVERY configured DS, active one first, so the popover can
  // offer them grouped per design system.
  const allDs = useAllDsTokens(cfg, _designRel, _activeDs);
  // Build per-DS popover groups for one token family (color/space/radius/…).
  const tokenGroups = (familyKey) =>
    allDs
      .map((d) => ({ ds: d.name, names: d[familyKey] || [], vals: d.vals }))
      .filter((g) => g.names.length);
  const [status, setStatus] = useState({});
  const [open, setOpen] = useState({
    Layout: true,
    Position: true,
    Typography: true,
    Spacing: true,
    Size: true,
    Media: true,
    Appearance: true,
    Advanced: false,
  });

  // Phase 12.3 — auto-expand Advanced when the selected element carries custom
  // CSS props / HTML attrs, so a just-added (or pre-existing) custom value is
  // visible without hunting for the disclosure. Keyed on el.id so it re-runs per
  // selection (CssKnobs persists across selections — the el prop changes).
  const hasCustom =
    Object.keys(customStyles).length > 0 || Object.keys(attrs).length > 0;
  useEffect(() => {
    if (hasCustom) setOpen((o) => (o.Advanced ? o : { ...o, Advanced: true }));
  }, [el.id, hasCustom]);
  // DDR-171 — Designer mode's Position cluster mirrors the same auto-expand
  // precedent: collapsed by default (position is the rare case), auto-opens
  // the moment the element actually has a non-static position so the inset
  // fields the user just set (or that came from the source) aren't hidden.
  const hasCustomPosition = (authored.position || cssHint(computed.position) || 'static') !== 'static';
  useEffect(() => {
    if (hasCustomPosition) setOpen((o) => (o['d:Position'] ? o : { ...o, 'd:Position': true }));
  }, [el.id, hasCustomPosition]);

  // DDR-171 — the panel's vocabulary mode: 'advanced' (today's raw-CSS panel,
  // unchanged, still the default — zero behavior change for existing users) or
  // 'designer' (the Figma-vocabulary regroup). Lifted to App state (DDR-171
  // follow-up) so the same preference is controllable from BOTH the in-panel
  // corner toggle AND Settings → Appearance, and the two never diverge — the
  // exact single-source-of-truth pattern `theme` uses. App owns the
  // `maude-cp-mode` localStorage persistence; here it's a controlled prop.
  const setMode = onSetMode;
  // Designer-mode per-cluster "···" disclosure state (Auto layout/Wrap,
  // Size/Min-Max, Position/z-index, Text/extras) — keyed by cluster name, kept
  // in-memory only (unlike `open`, not persisted; matches the disclosure being
  // a "peek", not a durable preference).
  const [designerMore, setDesignerMore] = useState({});

  async function post(url, payload, key) {
    setStatus((s) => ({ ...s, [key]: 'saving' }));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      setStatus((s) => ({
        ...s,
        [key]: !res.ok || !j.ok ? `err:${(j && j.error) || `HTTP ${res.status}`}` : 'saved',
      }));
      return res.ok ? j : null;
    } catch (err) {
      setStatus((s) => ({ ...s, [key]: `err:${err && err.message ? err.message : String(err)}` }));
      return null;
    }
  }
  // Write, THEN record the undo entry from what the write actually replaced
  // (`previous`, read server-side under the file lock). The panel's own value
  // can be a teammate's edit old — it is not re-posted when a peer changes the
  // source — and recording it made Cmd+Z restore a value nobody had on screen.
  // Serialized so the stack keeps edit order; a failed write records nothing.
  const writeChainRef = useRef(Promise.resolve());
  const writeAndRecord = (url, payload, key, op, prop, fallbackBefore, after) => {
    writeChainRef.current = trackRecordableWrite(
      writeChainRef.current.then(async () => {
        const j = await post(url, payload, key);
        if (!j?.ok) return;
        const before = Object.hasOwn(j, 'previous') ? j.previous : fallbackBefore;
        if ((before ?? null) === (after ?? null)) return; // nothing changed to undo
        record(op, prop, before, after);
      })
    );
  };
  // Optimistic preview: nudge the live element so the change shows before the
  // edit → HMR reload lands. `value` null = remove (reset path). No-op when the
  // selection has no stable id (can't be resolved in the canvas).
  const optimistic = (prop, value) => {
    if (!onOptimistic || !el.id) return;
    onOptimistic({
      id: el.id,
      artboardId: el.artboardId ?? null,
      index: el.index ?? 0,
      prop,
      value,
    });
  };
  // Record an inline edit onto the canvas undo stack (Cmd+Z). The edit has
  // already POSTed `/_api/edit-*`; the canvas iframe APPENDS the record (no
  // re-run). `before`/`after` null = the prop/attr was/becomes unset.
  const record = (op, key, before, after) => {
    onRecordEdit?.({
      op,
      canvas: el.file,
      id: el.id,
      key,
      before: before == null || before === '' ? null : before,
      after: after == null || after === '' ? null : after,
    });
  };
  const commit = (property, raw) => {
    const value = (raw || '').trim();
    if (!editable || !value) return;
    const before = authored[property] ?? null;
    if (value === (before ?? '').trim()) return; // no-op
    optimistic(property, value);
    setA(property, value); // reflect in the panel immediately (no reload → no reselect)
    writeAndRecord(
      '/_api/edit-css',
      { canvas: el.file, id: el.id, property, value },
      property,
      'css',
      property,
      before,
      value
    );
  };
  // A custom CSS property (Advanced) — same write, but the panel surfaces it from
  // the customStyles map, so overlay THERE.
  const commitCustom = (property, raw) => {
    const value = (raw || '').trim();
    const prop = property.trim();
    if (!editable || !prop || !value) return;
    const before = customStyles[prop] ?? null;
    optimistic(prop, value);
    setC(prop, value);
    writeAndRecord(
      '/_api/edit-css',
      { canvas: el.file, id: el.id, property: prop, value },
      prop,
      'css',
      prop,
      before,
      value
    );
  };
  const commitAttr = (attr, raw) => {
    const a = (attr || '').trim();
    const value = (raw || '').trim();
    if (!editable || !a || !value) return;
    const before = attrs[a] ?? null;
    setT(a, value);
    writeAndRecord(
      '/_api/edit-attr',
      { canvas: el.file, id: el.id, attr: a, value },
      `@${a}`,
      'attr',
      a,
      before,
      value
    );
  };
  // Phase 12.3 — reset (remove the inline prop / attr → back to class/inherited).
  const reset = (property) => {
    if (!editable) return;
    const before = authored[property] ?? null;
    optimistic(property, null);
    setA(property, null);
    writeAndRecord(
      '/_api/edit-css',
      { canvas: el.file, id: el.id, property, reset: true },
      property,
      'css',
      property,
      before,
      null
    );
  };
  const resetCustom = (property) => {
    if (!editable) return;
    const before = customStyles[property] ?? null;
    optimistic(property, null);
    setC(property, null);
    writeAndRecord(
      '/_api/edit-css',
      { canvas: el.file, id: el.id, property, reset: true },
      property,
      'css',
      property,
      before,
      null
    );
  };
  const resetAttr = (attr) => {
    if (!editable) return;
    const before = attrs[attr] ?? null;
    setT(attr, null);
    writeAndRecord(
      '/_api/edit-attr',
      { canvas: el.file, id: el.id, attr, reset: true },
      `@${attr}`,
      'attr',
      attr,
      before,
      null
    );
  };
  // Stage M1 — apply a Fixed / Hug / Fill sizing mode to one axis. The pure
  // `sizingModePatch` returns the exact writes (context-aware Fill: flex main axis
  // → flex-grow, cross axis → align-self, block/grid → 100%) + the fill-props to
  // clear. Each ride the same commit/reset lanes (per-prop edit-css + undo record);
  // the server's per-file lock serializes them, so the resulting box is coherent.
  const parentLayout = { display: el.parentDisplay, flexDirection: el.parentFlexDirection };
  const applySizing = (axis, mode) => {
    if (!editable) return;
    const px = Math.round((axis === 'width' ? el.bounds?.w : el.bounds?.h) || 0);
    const patch = sizingModePatch(axis, mode, parentLayout, px);
    for (const p of patch.reset) if (authored[p]) reset(p);
    for (const [prop, value] of patch.set) commit(prop, value);
  };
  const parentIsFlexChild =
    el.parentDisplay === 'flex' || el.parentDisplay === 'inline-flex';
  const sizeModeSeg = (axis) => {
    const cur = sizingModeOf(axis, authored, computed, parentLayout);
    return (
      // handoff — a proper inspector row: "Width sizing" / "Height sizing" label
      // in the label column, the shared Segmented right-aligned in the control
      // column (aligned with the number inputs below), input-matching height.
      <div className="st-cp-moderow" key={`mode-${axis}`}>
        <span className="st-cp-modelabel">{axis === 'width' ? 'Width sizing' : 'Height sizing'}</span>
        <div className="st-cp-modeseg" role="group" aria-label={`${axis} sizing mode`}>
          <Segmented
            value={cur}
            ariaLabel={`${axis} sizing`}
            options={[{ value: 'fixed', label: 'fixed' }, { value: 'hug', label: 'hug' }, { value: 'fill', label: 'fill' }]}
            onChange={(m) => applySizing(axis, m)}
          />
        </div>
      </div>
    );
  };
  // DDR-171 — Designer mode's Auto-layout alignment: `AlignPad`'s 9-cell grid
  // maps to the TWO real CSS axes (`justify-content` = main axis,
  // `align-items` = cross axis), which axis is "horizontal" vs "vertical"
  // depending on `flex-direction`. Only the 3 positional align-items values
  // (start/center/end) round-trip through the pad — `stretch` reads as the
  // pad's center cell (closest visual analog) but the pad never WRITES
  // `stretch`; that stays an Advanced-mode-only value, same as Figma's own
  // alignment pad (no "stretch" cell — it's a separate control there too).
  const AP_JC = ['flex-start', 'center', 'flex-end'];
  const AP_AI = ['flex-start', 'center', 'flex-end'];
  const AP_ROWS = ['t', 'c', 'b'];
  const AP_COLS = ['l', 'c', 'r'];
  const alignPadCell = () => {
    const isRow = !(authored['flex-direction'] || cssHint(computed['flex-direction']) || 'row').startsWith('column');
    const jcPos = Math.max(0, AP_JC.indexOf(authored['justify-content'] || cssHint(computed['justify-content']) || 'flex-start'));
    const aiRaw = authored['align-items'] || cssHint(computed['align-items']) || 'stretch';
    const aiPos = aiRaw === 'stretch' ? 1 : Math.max(0, AP_AI.indexOf(aiRaw));
    const [h, v] = isRow ? [jcPos, aiPos] : [aiPos, jcPos];
    return AP_ROWS[v] + AP_COLS[h];
  };
  const setAlignPadCell = (cell) => {
    const v = AP_ROWS.indexOf(cell[0]);
    const h = AP_COLS.indexOf(cell[1]);
    const isRow = !(authored['flex-direction'] || cssHint(computed['flex-direction']) || 'row').startsWith('column');
    const [jcPos, aiPos] = isRow ? [h, v] : [v, h];
    commit('justify-content', AP_JC[jcPos]);
    commit('align-items', AP_AI[aiPos]);
  };
  // Cmd+Z / Cmd+Shift+Z (or Cmd+Y) inside the inspector forwards to the canvas
  // undo stack — Figma-parity: a property field reverts the last DOCUMENT edit,
  // not field text. Without this, an edit committed with focus still in the
  // inspector couldn't be undone (the iframe's own keydown never sees the key).
  const onKnobKeyDown = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      onUndoRedo?.(e.shiftKey ? 'redo' : 'undo');
    } else if (k === 'y') {
      e.preventDefault();
      onUndoRedo?.('redo');
    }
  };
  const provOf = (prop) => {
    const v = authored[prop];
    if (!v) return 'inherit';
    return /var\(\s*--/.test(v) ? 'bound' : 'raw';
  };

  if (!editable) {
    return (
      <div className="st-cp">
        <div className="st-cp-id">
          <span className="st-cp-idtag">{el.tag || 'element'}</span>
        </div>
        <div className="st-css-disabled">
          This selection has no stable element id (a legacy canvas, or a non-element target). Edit
          it with <code>/design:edit</code>.
        </div>
      </div>
    );
  }

  const PROVLABEL = { bound: 'token-bound', raw: 'raw override', inherit: 'inherited' };
  const prov = (p) => (
    <span className={`st-cp-prov st-cp-prov--${p}`} role="img" aria-label={PROVLABEL[p]} />
  );

  // Phase 12.3 (#4) — the LEADING dot carries it all: provenance (shape) + save
  // status (a success/error/saving glow) + reset (double-click an authored row).
  // No trailing ✓/⟲ that shift the input rightward (the user's gripe). A tooltip
  // hints the double-click-to-reset.
  const provDot = (prop, provKind) => {
    const k = provKind ?? provOf(prop);
    const s = status[prop];
    const errMsg = typeof s === 'string' && s.startsWith('err:') ? s.slice(4) : '';
    const stCls = errMsg ? ' is-err' : s === 'saved' ? ' is-saved' : s === 'saving' ? ' is-saving' : '';
    const canReset = !!authored[prop];
    const tip = errMsg
      ? `error: ${errMsg}`
      : canReset
        ? `${PROVLABEL[k]} · double-click to reset`
        : PROVLABEL[k];
    return (
      <button
        type="button"
        className={`st-cp-prov st-cp-prov--${k}${stCls}${canReset ? ' is-resettable' : ''}`}
        aria-label={tip}
        title={tip}
        tabIndex={canReset ? 0 : -1}
        onDoubleClick={canReset ? () => reset(prop) : undefined}
        onKeyDown={
          canReset
            ? (e) => {
                if (e.key === 'Backspace' || e.key === 'Delete') {
                  e.preventDefault();
                  reset(prop);
                }
              }
            : undefined
        }
      />
    );
  };

  // `labelOverride` (DDR-171 — Designer mode) swaps BOTH the visible label text
  // AND the title tooltip together, so they never drift out of sync. Optional
  // and additive — every Advanced-mode call site omits it and renders exactly
  // as before (label = title = the raw CSS property name).
  const row = (prop, control, provKind, labelOverride) => {
    // #1 bigger-bet — scannable diff: a fully-unset single-prop row is dimmed so
    // the handful of overridden rows pop (Webflow/Framer model). Composite rows
    // (border — they pass an explicit provKind) are never dimmed.
    const unset = provKind === undefined && !authored[prop];
    const label = labelOverride ?? prop;
    return (
      <div className={`st-cp-row${unset ? ' is-unset' : ''}`} key={prop}>
        {provDot(prop, provKind)}
        <label className="st-cp-label" title={label}>
          {label}
        </label>
        <div className="st-cp-ctl">{control}</div>
      </div>
    );
  };

  // Props each section owns — drives the per-section "reset section" affordance.
  const SECTION_PROPS = {
    Layout: ['display', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap'],
    // feature-3-web-artboards T5 — Grid track editor + cell placement, so the
    // section-reset affordance clears them like every other section.
    Grid: ['grid-template-columns', 'grid-template-rows'],
    'Grid item': ['grid-column', 'grid-row'],
    // feature-element-editing-robustness Stage B — promoted DDR-104 OUT-list.
    Position: ['position', 'top', 'right', 'bottom', 'left', 'z-index'],
    Typography: [
      'font-family',
      'color',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-align',
      'font-style',
      'text-transform',
      'text-decoration',
      'white-space',
    ],
    Spacing: [
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
    ],
    Size: [
      'width',
      'height',
      'min-width',
      'min-height',
      'max-width',
      'max-height',
      'overflow',
      // Stage M — flex-child sizing props (written by the Fill mode + shown as rows
      // when the parent is flex). Included so a section-reset clears them too.
      'flex-grow',
      'flex-shrink',
      'flex-basis',
      'align-self',
    ],
    Media: ['object-fit', 'aspect-ratio', 'object-position'],
    Appearance: [
      'background-color',
      'border-radius',
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-left-radius',
      'border-bottom-right-radius',
      'border-width',
      'border-style',
      'border-color',
      'box-shadow',
      'filter',
      'mix-blend-mode',
      'opacity',
      'transform',
      'transform-origin',
    ],
  };
  const resetSection = (name) => {
    (SECTION_PROPS[name] || []).forEach((p) => {
      if (authored[p]) reset(p);
    });
  };

  const sec = (name, body) => {
    const dirty = (SECTION_PROPS[name] || []).some((p) => authored[p]);
    return (
      <section className="st-cp-sec" key={name}>
        <div className="st-cp-sechd-row">
          <button
            type="button"
            className="st-cp-sechd"
            data-testid={`inspector-section-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
            aria-expanded={!!open[name]}
            onClick={() => setOpen((o) => ({ ...o, [name]: !o[name] }))}
          >
            <span className="st-cp-caret" aria-hidden="true">
              {open[name] ? '▾' : '▸'}
            </span>
            {name}
          </button>
          {/* handoff — reset always present (design), dimmed when nothing to reset. */}
          <button
            type="button"
            className={`st-cp-secreset${dirty ? '' : ' is-quiet'}`}
            aria-label={`reset ${name} section to original`}
            title={`reset ${name}`}
            disabled={!dirty}
            onClick={() => resetSection(name)}
          >
            <Lu as={LuRotateCw} size={12} />
          </button>
        </div>
        {/* animated collapse — grid-rows 0fr→1fr keeps the DOM + interpolates
            height (feature-inspector-controls-redesign handoff). */}
        <div className={`st-cp-sec-anim${open[name] ? ' is-open' : ''}`}>
          <div className="st-cp-sec-inner">{body}</div>
        </div>
      </section>
    );
  };

  // DDR-171 — Designer mode's cluster wrapper. Mirrors `sec()`'s exact chrome
  // (caret, reset, animated collapse — reuses `.st-cp-sec`/`.st-cp-sechd`/
  // `.st-cp-sec-anim` verbatim, no new CSS shape) but takes an explicit
  // `props` reset-list instead of looking one up in `SECTION_PROPS`, because
  // Designer clusters cut across Advanced-mode section boundaries and don't
  // map 1:1 onto it (e.g. "Auto layout" pulls from both Layout and Size).
  // Open-state lives in the SAME `open` object under a `d:`-prefixed key so no
  // second piece of state is needed; `defaultOpen=false` is how the Position
  // cluster starts collapsed (see `hasCustomPosition` auto-expand above).
  const dsec = (name, props, body, defaultOpen = true) => {
    const key = `d:${name}`;
    const isOpen = open[key] === undefined ? defaultOpen : open[key];
    const dirty = props.some((p) => authored[p]);
    return (
      <section className="st-cp-sec" key={key}>
        <div className="st-cp-sechd-row">
          <button
            type="button"
            className="st-cp-sechd"
            aria-expanded={isOpen}
            onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
          >
            <span className="st-cp-caret" aria-hidden="true">
              {isOpen ? '▾' : '▸'}
            </span>
            {name}
          </button>
          <button
            type="button"
            className={`st-cp-secreset${dirty ? '' : ' is-quiet'}`}
            aria-label={`reset ${name} to original`}
            title={`reset ${name}`}
            disabled={!dirty}
            onClick={() => props.forEach((p) => { if (authored[p]) reset(p); })}
          >
            <Lu as={LuRotateCw} size={12} />
          </button>
        </div>
        <div className={`st-cp-sec-anim${isOpen ? ' is-open' : ''}`}>
          <div className="st-cp-sec-inner">{body}</div>
        </div>
      </section>
    );
  };
  // A cluster's "···" disclosure toggle for its less-common rows (Figma's own
  // per-panel overflow affordance) — distinct from the cluster's own
  // open/collapse caret above. `designerMore[key]` gates the extra rows.
  const moreBtn = (key) => (
    <button
      type="button"
      className="st-cp-clustermore"
      aria-expanded={!!designerMore[key]}
      aria-label={designerMore[key] ? `${key} — fewer options` : `${key} — more options`}
      title={designerMore[key] ? 'fewer' : 'more'}
      onClick={() => setDesignerMore((m) => ({ ...m, [key]: !m[key] }))}
    >
      {designerMore[key] ? '▴' : '···'}
    </button>
  );

  // native <select> committing a CSS value directly
  const csel = (prop, list) => (
    <select
      className="st-cp-nsel"
      aria-label={prop}
      value={list.includes(authored[prop]) ? authored[prop] : ''}
      onChange={(e) => commit(prop, e.target.value)}
    >
      <option value="" disabled>
        {cssHint(computed[prop]) || '—'}
      </option>
      {list.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );

  // ── feature-inspector-controls-redesign handoff — the design's control set,
  // wired to CssKnobs' CSS-string commit lane. ────────────────────────────────
  const flatTokens = (familyKey) => tokenGroups(familyKey).flatMap((g) => (g.names || []).map((n) => ({ name: n, value: g.vals?.[n] || '' })));
  // enum → lucide icon button group (commits the raw CSS keyword)
  const iconseg = (prop, options) => (
    <IconButtonGroup value={authored[prop] || cssHint(computed[prop]) || options[0].value} ariaLabel={prop} options={options} onChange={(v) => commit(prop, v)} />
  );
  // number + unit + ◇ design-token binding (space / radius / type families)
  const vtok = (prop, familyKey, opts = {}) => {
    const cur = cssSplitUnit(authored[prop] ?? '');
    const unitless = CSS_UNITLESS.has(prop);
    const av = authored[prop] ?? '';
    const bound = typeof av === 'string' && /var\(\s*--/.test(av);
    const unit = unitless ? '' : cur.unit && cur.unit !== 'auto' ? cur.unit : 'px';
    const hintN = Number.parseFloat(cssSplitUnit(cssHint(computed[prop]) ?? '').n) || 0;
    const numVal = cur.n !== '' && cur.n != null ? Number.parseFloat(cur.n) || 0 : hintN;
    const lead = PROP_LEAD[prop];
    return (
      <ValueTokenField
        value={bound ? av : numVal}
        tokens={flatTokens(familyKey)}
        ariaLabel={prop}
        min={opts.min ?? 0}
        lead={lead ? (lead.node ?? lead.t) : undefined}
        unitSlot={unitless ? null : <UnitSelect units={CSS_UNITS} value={cur.unit || 'px'} ariaLabel={`${prop} unit`} onChange={(u) => commit(prop, u === 'auto' ? 'auto' : `${cur.n || '0'}${u}`)} />}
        onChange={(v) => commit(prop, typeof v === 'string' ? v : unitless ? `${v}` : `${v}${unit}`)}
      />
    );
  };
  // border-radius → uniform field + ▢ detach → 2×2 corner quad
  const radiusControl = () => {
    const parse = (p) => Number.parseFloat(cssSplitUnit(authored[p] ?? authored['border-radius'] ?? cssHint(computed[p]) ?? cssHint(computed['border-radius']) ?? '0').n) || 0;
    const corners = { tl: parse('border-top-left-radius'), tr: parse('border-top-right-radius'), bl: parse('border-bottom-left-radius'), br: parse('border-bottom-right-radius') };
    const onCorners = (c) => {
      const uniform = c.tl === c.tr && c.tr === c.bl && c.bl === c.br;
      if (uniform) {
        ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'].forEach((p) => { if (authored[p]) reset(p); });
        commit('border-radius', `${c.tl}px`);
      } else {
        commit('border-top-left-radius', `${c.tl}px`);
        commit('border-top-right-radius', `${c.tr}px`);
        commit('border-bottom-left-radius', `${c.bl}px`);
        commit('border-bottom-right-radius', `${c.br}px`);
      }
    };
    const lead = PROP_LEAD['border-radius'];
    return <RadiusControl corners={corners} lead={lead ? (lead.node ?? lead.t) : undefined} onCorners={onCorners} />;
  };
  // border composite (width + style + colour) — DDR-171 pulled this out of the
  // Advanced-mode Appearance row inline JSX so Designer mode's "Stroke"
  // cluster (Task 6) can reuse the exact same control, not a re-implementation.
  const borderControl = () => (
    <div className="st-cp-border">
      {num('border-width', null, { fixedUnit: 'px' })}
      <select
        className="st-cp-nsel st-cp-nsel--mini"
        aria-label="border-style"
        value={CSS_BORDER_STYLES.includes(authored['border-style']) ? authored['border-style'] : ''}
        onChange={(e) => commit('border-style', e.target.value)}
      >
        <option value="" disabled>
          style
        </option>
        {CSS_BORDER_STYLES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <TokenPopover
        kind="color"
        groups={tokenGroups('color')}
        current={authored['border-color']}
        activeDs={_activeDs}
        swatchBg={computed['border-color'] || authored['border-color'] || ''}
        seedHex={cssColorToHex(computed['border-color'] || authored['border-color']) || '#000000'}
        onPick={(v) => commit('border-color', v)}
        label="border colour"
      />
    </div>
  );
  // rotation dial, reading/writing the rotate() term of `transform`
  const rotationControl = () => {
    const t = authored.transform || cssHint(computed.transform) || '';
    const m = /rotate\(\s*(-?\d+(?:\.\d+)?)deg\s*\)/.exec(t);
    const deg = (((m ? Number.parseFloat(m[1]) : 0) % 360) + 360) % 360;
    const setDeg = (d) => {
      const norm = ((d % 360) + 360) % 360;
      const base = (authored.transform || '').replace(/\s*rotate\([^)]*\)\s*/g, ' ').trim();
      commit('transform', `${base ? `${base} ` : ''}rotate(${norm}deg)`.trim());
    };
    return (
      <div className="st-cp-num" style={{ border: 0, background: 'transparent', gap: 'var(--space-2)' }}>
        <AngleDial value={deg} onChange={setDeg} />
        <NumberField value={deg} min={0} max={360} ariaLabel="rotation" lead={<Lu as={LuRotateCw} />} steppers={false} unitSlot={<span className="st-cp-numsuffix" aria-hidden="true">°</span>} onCommit={setDeg} />
      </div>
    );
  };
  // DDR-171 — `filter: blur(Npx)`, scoped to blur-only for v1 (not a full
  // filter-function editor). Local parse/serialize (unlike most rows this
  // doesn't pass the raw string straight to `commit`) — kept as a closure here,
  // not a top-level utility, so it stays governed by the "no new primitives"
  // constraint. A non-blur `filter` value (set via Advanced's raw-CSS hatch)
  // reads as 0 here rather than being clobbered — only written back once the
  // user actually commits a blur amount.
  const blurControl = () => {
    const f = authored.filter || cssHint(computed.filter) || '';
    const m = /blur\(\s*(-?\d+(?:\.\d+)?)px\s*\)/.exec(f);
    const px = m ? Number.parseFloat(m[1]) : 0;
    const setBlur = (n) => {
      const base = (authored.filter || '').replace(/\s*blur\([^)]*\)\s*/g, ' ').trim();
      commit('filter', n > 0 ? `${base ? `${base} ` : ''}blur(${n}px)`.trim() : base || 'none');
    };
    return <NumberField value={px} min={0} ariaLabel="filter blur" unitSlot={<span className="st-cp-numsuffix" aria-hidden="true">px</span>} onCommit={setBlur} />;
  };
  // handoff — shown as 0–100 % (design), stored as the CSS 0–1 value. Pulled
  // out (DDR-171) so Designer mode's "Opacity" cluster reuses it verbatim.
  const opacityControl = () => {
    const a = authored.opacity;
    const raw = a != null && a !== '' ? Number.parseFloat(a) : Number.parseFloat(cssHint(computed.opacity)) || 1;
    const pct = Math.round((Number.isNaN(raw) ? 1 : raw) * 100);
    return (
      <SliderField
        key={`opacity:${a ?? ''}`}
        value={pct}
        min={0}
        max={100}
        step={1}
        unit="%"
        ariaLabel="opacity"
        onInput={(n) => optimistic('opacity', String(n / 100))}
        onCommit={(n) => commit('opacity', String(n / 100))}
      />
    );
  };
  // B / I / U quick-style toggle group → font-weight / font-style / text-decoration
  const textStyleToggle = () => {
    const isBold = Number.parseInt(authored['font-weight'] || cssHint(computed['font-weight']) || '400', 10) >= 600;
    const isItalic = (authored['font-style'] || cssHint(computed['font-style'])) === 'italic';
    const isUnder = /underline/.test(authored['text-decoration'] || cssHint(computed['text-decoration']) || '');
    return (
      <IconToggleGroup
        value={{ b: isBold, i: isItalic, u: isUnder }}
        ariaLabel="text style"
        options={[{ value: 'b', node: <Lu as={LuBold} />, label: 'Bold' }, { value: 'i', node: <Lu as={LuItalic} />, label: 'Italic' }, { value: 'u', node: <Lu as={LuUnderline} />, label: 'Underline' }]}
        onToggle={(k) => {
          if (k === 'b') commit('font-weight', isBold ? '400' : '700');
          else if (k === 'i') commit('font-style', isItalic ? 'normal' : 'italic');
          else commit('text-decoration', isUnder ? 'none' : 'underline');
        }}
      />
    );
  };
  const DIR_OPTS = [{ value: 'row', node: <Lu as={LuColumns3} />, label: 'Row' }, { value: 'column', node: <Lu as={LuRows3} />, label: 'Column' }];
  const JUSTIFY_OPTS = [{ value: 'flex-start', node: <Lu as={LuJustifyStart} />, label: 'Start' }, { value: 'center', node: <Lu as={LuJustifyCenter} />, label: 'Center' }, { value: 'flex-end', node: <Lu as={LuJustifyEnd} />, label: 'End' }, { value: 'space-between', node: <Lu as={LuSpaceBetween} />, label: 'Space between' }];
  const ALIGNITEMS_OPTS = [{ value: 'flex-start', node: <Lu as={LuVJustifyStart} />, label: 'Start' }, { value: 'center', node: <Lu as={LuVJustifyCenter} />, label: 'Center' }, { value: 'flex-end', node: <Lu as={LuVJustifyEnd} />, label: 'End' }, { value: 'stretch', node: <Lu as={LuStretch} />, label: 'Stretch' }];
  const TEXTALIGN_OPTS = [{ value: 'left', node: <Lu as={LuAlignLeft} />, label: 'Left' }, { value: 'center', node: <Lu as={LuAlignCenter} />, label: 'Center' }, { value: 'right', node: <Lu as={LuAlignRight} />, label: 'Right' }, { value: 'justify', node: <Lu as={LuAlignJustify} />, label: 'Justify' }];
  const OVERFLOW_OPTS = [{ value: 'visible', node: <Lu as={LuEye} />, label: 'Visible' }, { value: 'hidden', node: <Lu as={LuScissors} />, label: 'Hidden' }, { value: 'scroll', node: <Lu as={LuScrollText} />, label: 'Scroll' }];

  // token quick-pick — Figma-style POPOVER (W2.1) listing the DS variables for
  // this property (name + resolved value), grouped per design system (W3);
  // picking writes var(--token). `familyKey` selects the token family.
  const tok = (prop, familyKey) => {
    const groups = tokenGroups(familyKey);
    return groups.length ? (
      <TokenPopover
        kind="value"
        groups={groups}
        current={authored[prop]}
        activeDs={_activeDs}
        onPick={(v) => commit(prop, v)}
        label={`${prop} design token`}
      />
    ) : null;
  };

  // Select-all-on-focus (deferred past the browser's own click-caret placement
  // so a SECOND click, already focused, places the caret instead) — the
  // interaction-model rule applied to the CssKnobs fields that stay bespoke
  // <input>s (free text, box-model cells) rather than the shared NumberField.
  const selectAllOnFocus = (e) => {
    const el = e.currentTarget;
    requestAnimationFrame(() => {
      if (document.activeElement === el) el.select();
    });
  };
  // Arrow-key stepping (±1, Shift ×10) for the bespoke box-model cells — same
  // keyboard model NumberField gives the main fields, hand-rolled here because
  // these stay compact <input>s (no room for NumberField's handle+stepper
  // chrome in a 36×24 box-model cell). Returns true if it handled the key.
  const stepBoxInput = (e, commitFn) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
    e.preventDefault();
    const mult = e.shiftKey ? 10 : 1;
    const dir = e.key === 'ArrowUp' ? 1 : -1;
    const n = (Number.parseFloat(e.currentTarget.value) || 0) + dir * mult;
    e.currentTarget.value = String(n);
    commitFn(n);
    return true;
  };

  // free text input — raw value or var(--token), commits on blur/Enter
  const text = (prop) => (
    <input
      className="st-cp-fin"
      key={`${prop}:${authored[prop] ?? ''}`}
      aria-label={prop}
      defaultValue={authored[prop] ?? ''}
      placeholder={cssHint(computed[prop]) || '—'}
      onFocus={selectAllOnFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={(e) => commit(prop, e.currentTarget.value)}
    />
  );

  // number + steppers + unit-select (+ optional token quick-pick after) — built
  // on the shared NumberField (feature-inspector-controls-redesign): the drag
  // handle moves to the leading icon/grip (never the input body, so click-to-
  // type + select-all-on-focus work), and arrow-key stepping comes for free.
  const num = (prop, tokenList, opts = {}) => {
    const cur = cssSplitUnit(authored[prop] ?? '');
    // Unitless CSS properties — a bare number must commit WITHOUT a unit suffix
    // (line-height: 1.5px ≠ 1.5 — knob-smoke finding, 2026-06-12).
    const unitless = CSS_UNITLESS.has(prop);
    // `opts.fixedUnit` — a px-only field (border-width) skips the unit <select>
    // entirely so the compact border-cluster row (width + style + swatch) has
    // room to fit at the panel's 260-304px widths (Task 5 overflow fix).
    const unit = unitless ? '' : opts.fixedUnit || (cur.unit && cur.unit !== 'auto' ? cur.unit : 'px');
    const lead = PROP_LEAD[prop];
    // Unset (no authored value) shows the computed/inherited value as the
    // starting number — same value the old placeholder hinted at; the row's own
    // dimming (`row()`'s `is-unset`) is what signals "inherited", not this field.
    const hintN = Number.parseFloat(cssSplitUnit(cssHint(computed[prop]) ?? '').n) || 0;
    const shownN = cur.n !== '' && cur.n != null ? Number.parseFloat(cur.n) || 0 : hintN;
    return (
      <>
        <NumberField
          key={`${prop}:${authored[prop] ?? ''}`}
          value={shownN}
          min={opts.min ?? 0}
          step={1}
          ariaLabel={prop}
          lead={lead ? (lead.node ?? lead.t) : undefined}
          onCommit={(n) => commit(prop, unitless ? `${n}` : `${n}${unit}`)}
          unitSlot={
            unitless || opts.fixedUnit ? null : (
              <UnitSelect
                units={CSS_UNITS}
                value={cur.unit || 'px'}
                ariaLabel={`${prop} unit`}
                onChange={(u) => commit(prop, u === 'auto' ? 'auto' : `${cur.n || '0'}${u}`)}
              />
            )
          }
        />
        {tok(prop, tokenList)}
      </>
    );
  };

  // color swatch (native picker → hex) + raw text + token quick-pick
  const color = (prop) => {
    // ONE compact colour field (feature-inspector-controls-redesign handoff): the
    // TokenPopover swatch is the FLUSH prefix (divider, no gap) inside ColorField,
    // then the value input — swatch + value read as one field. The popover keeps
    // its full HSV picker (Custom) + DS swatches (Variables) + cross-DS/security.
    const resolved = computed[prop] || authored[prop] || '';
    const av = authored[prop] ?? '';
    const bound = typeof av === 'string' && /var\(\s*--/.test(av);
    const display = bound ? av.replace(/^var\(\s*|\s*\)$/g, '').replace(/^--/, '').replace(/-/g, ' ') : av;
    return (
      <ColorField
        swatch={
          <TokenPopover
            kind="color"
            swatchClassName="st-cp-cf-sw"
            groups={tokenGroups('color')}
            current={authored[prop]}
            activeDs={_activeDs}
            swatchBg={resolved}
            seedHex={cssColorToHex(computed[prop] || authored[prop]) || '#000000'}
            onPick={(v) => commit(prop, v)}
            label={`${prop} colour`}
          />
        }
        displayValue={display}
        bound={bound}
        ariaLabel={prop}
        onValue={(v) => commit(prop, v)}
      />
    );
  };

  // a box-model side input (margin/padding longhand). Phase 12.3 — Webflow-style:
  // always shows the RESOLVED value (0 instead of blank) and a faint `is-zero`
  // styling for an unset/zero side. Edits the single side (the old "link all
  // sides" toggle was removed — DDR-104 Phase 12.3 W1.5).
  // Built on the shared `makeScrubHandler` engine (feature-inspector-controls-
  // redesign) — a plain (non-hook) factory, since `side`/`inset` are helper
  // closures invoked during render, not components (can't call a hook there).
  // These stay compact <input>s with whole-cell scrub (no separate drag handle
  // — the Figma/Webflow convention for tiny box-model cells with no room for
  // one; the 3px dead-zone already lets a plain click through to focus). A
  // multi-side drag (alt = pair, alt+shift = all four) live-updates the sibling
  // box inputs too, so the whole move shows in the panel, not just the dragged
  // cell — `node` closes over the actual input DOM element via onPointerDown.
  const boxScrub = (prop, opts) => {
    let node = null;
    const unit = opts.unitless ? '' : 'px';
    const fmt = (n) => (opts.unitless ? `${n}` : `${n}${unit}`);
    const applyToSides = (n, activeSides, fn) => {
      for (const p of activeSides ?? [prop]) fn(p, fmt(n));
    };
    const scrub = makeScrubHandler({
      getBase: () => node?.value ?? '0',
      min: opts.min ?? 0,
      step: 1,
      sides: opts.sides,
      onInput: (n, activeSides) => {
        if (node) node.value = String(n);
        if (activeSides) {
          const box = node?.closest('.st-cp-box');
          for (const p of activeSides) {
            if (p === prop) continue;
            const sib = box?.querySelector(`.st-cp-boxv[aria-label="${p}"]`);
            if (sib) sib.value = String(n);
          }
        }
        applyToSides(n, activeSides, optimistic);
      },
      onCommit: (n, activeSides) => applyToSides(n, activeSides, commit),
    });
    return {
      onPointerDown: (e) => {
        node = e.currentTarget;
        scrub(e);
      },
    };
  };

  const side = (prop, group) => {
    const a = authored[prop];
    const shown =
      a != null && a !== ''
        ? cssSplitUnit(a).n || a
        : cssSplitUnit(cssHint(computed[prop]) ?? '').n || '0';
    const isZero = !a || a === '0' || a === '0px' || a === 'auto';
    // Webflow scrub modifiers — alt = symmetric pair (block for top/bottom,
    // inline for left/right), alt+shift = all four.
    const edge = prop.split('-').pop();
    const pair =
      edge === 'top' || edge === 'bottom'
        ? [`${group}-top`, `${group}-bottom`]
        : [`${group}-left`, `${group}-right`];
    const all = [`${group}-top`, `${group}-right`, `${group}-bottom`, `${group}-left`];
    return (
      <input
        className={`st-cp-boxv st-cp-scrub st-cp-boxv--${group[0]}${prop.split('-').pop()[0]}${
          isZero ? ' is-zero' : ''
        }`}
        key={`${prop}:${a ?? ''}`}
        aria-label={prop}
        defaultValue={shown}
        title="drag to scrub · alt = symmetric · alt+shift = all sides"
        {...boxScrub(prop, { sides: { pair, all } })}
        onFocus={selectAllOnFocus}
        onKeyDown={(e) => {
          if (stepBoxInput(e, (n) => commit(prop, `${n}px`))) return;
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const raw = e.currentTarget.value.trim();
          if (!raw) return;
          const val = /[a-z%]/i.test(raw) ? raw : `${raw}px`;
          commit(prop, val);
        }}
      />
    );
  };

  // feature-element-editing-robustness Stage B (Task B3) — a position INSET side
  // (top/right/bottom/left). Mirrors `side()` but for the bare inset longhands
  // (no group prefix), allowing NEGATIVE values and an `auto` default, and reuses
  // the same box-model scrub grammar: alt = the axis pair, alt+shift = all four.
  const inset = (prop) => {
    const a = authored[prop];
    const shown =
      a != null && a !== '' && a !== 'auto'
        ? cssSplitUnit(a).n || a
        : cssSplitUnit(cssHint(computed[prop]) ?? '').n || '';
    const isZero = !a || a === 'auto' || a === '0' || a === '0px';
    const pair = prop === 'top' || prop === 'bottom' ? ['top', 'bottom'] : ['left', 'right'];
    const all = ['top', 'right', 'bottom', 'left'];
    return (
      <input
        className={`st-cp-boxv st-cp-scrub st-cp-boxv--i${prop[0]}${isZero ? ' is-zero' : ''}`}
        key={`${prop}:${a ?? ''}`}
        aria-label={prop}
        defaultValue={shown}
        placeholder="auto"
        title="drag to scrub · alt = axis pair · alt+shift = all sides · type auto"
        {...boxScrub(prop, { sides: { pair, all }, min: -Infinity })}
        onFocus={selectAllOnFocus}
        onKeyDown={(e) => {
          if (stepBoxInput(e, (n) => commit(prop, `${n}px`))) return;
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const raw = e.currentTarget.value.trim();
          if (!raw) return;
          const val = /[a-z%]/i.test(raw) ? raw : `${raw}px`;
          commit(prop, val);
        }}
      />
    );
  };

  // Phase 12.3 — authored inline props with no curated row + custom HTML attrs,
  // surfaced in Advanced so the user can see/edit/remove what they added.
  const customStyleRows = Object.entries(customStyles);
  const attrRows = Object.entries(attrs);

  // Stage B (Task B5) — Media framing gate + body, pulled out (DDR-171) so
  // Designer mode's "Media" cluster renders the identical content (just a
  // relabeled wrapper) instead of re-deriving `showMedia`/`canReplace`.
  // Rendered only for a media element (img / video / picture / svg / canvas)
  // or a selection that already carries a framing prop, so a plain <div>
  // doesn't grow object-fit rows. Media = box/framing/source (this plan); the
  // photo-editor plan's "Photo" tab owns pixels/look — separate DOM slots by
  // design.
  const mediaGate = () => {
    const t = (el.tag || '').toLowerCase();
    const isMediaEl = t === 'img' || t === 'video' || t === 'picture' || t === 'svg' || t === 'canvas';
    const showMedia =
      isMediaEl || !!authored['object-fit'] || !!authored['object-position'] || !!authored['aspect-ratio'];
    // Stage F2 — "Replace…" opens the AssetPicker to re-point src (authored
    // <img>/<video> only; a template-expression src can't be string-swapped,
    // so gate on a real src attr being present).
    const canReplace = (t === 'img' || t === 'video') && !!el.attrs?.src && !!onReplaceMedia;
    return { showMedia, canReplace };
  };
  const mediaBody = (canReplace) => (
    <>
      {canReplace && (
        <div className="st-cp-mediabtn">
          <button type="button" className="st-btn st-cp-replace" onClick={() => onReplaceMedia(el)}>
            Replace…
          </button>
        </div>
      )}
      {row('object-fit', csel('object-fit', CSS_OBJECT_FIT))}
      {row('object-position', text('object-position'))}
      {row(
        'aspect-ratio',
        <select
          className="st-cp-nsel"
          aria-label="aspect-ratio"
          value={CSS_ASPECT_RATIO.includes(authored['aspect-ratio']) ? authored['aspect-ratio'] : ''}
          onChange={(e) => {
            const v = e.target.value;
            commit('aspect-ratio', v);
            // A fixed height overrides aspect-ratio (CSS: explicit width+height
            // win). When applying a real ratio, release the height so the ratio
            // actually reshapes the box (dogfood: "nastavil jsem 16/9 a nic se
            // nestalo").
            if (v && v !== 'auto' && authored.height) reset('height');
          }}
        >
          <option value="" disabled>
            {cssHint(computed['aspect-ratio']) || '—'}
          </option>
          {CSS_ASPECT_RATIO.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )}
    </>
  );

  return (
    <div className={`st-cp${mode === 'designer' ? ' st-cp--designer' : ''}`} key={el.id} data-tour="css-panel" onKeyDown={onKnobKeyDown}>
      <div className="st-cp-id">
        <span className="st-cp-idtag">
          {el.tag || 'element'}
          {el.classes ? <span className="st-cp-idcls">.{el.classes.split(/\s+/)[0]}</span> : null}
        </span>
        {/* DDR-171 — vocabulary mode toggle, tucked into the id row's corner
            slot (was a full-width Segmented row — read as too heavy; a
            two-icon IconButtonGroup matches every other compact toggle in
            this panel). 'advanced' is the default (today's panel, byte-
            identical below); 'designer' swaps in the Figma-vocabulary regroup.
            Named "Advanced" (not "Simple"/"Basic") so neither mode reads as
            the lesser fallback — see DDR-171 for the naming-collision call
            against the nested Advanced *section* below. */}
        <span className="st-cp-idmode" data-tour="cp-mode">
          <IconButtonGroup
            value={mode}
            ariaLabel="panel vocabulary mode"
            options={[
              { value: 'advanced', node: <Lu as={LuBraces} size={12} />, label: 'Advanced — raw CSS' },
              { value: 'designer', node: <Lu as={LuWand2} size={12} />, label: 'Designer — Figma vocabulary' },
            ]}
            onChange={setMode}
          />
        </span>
      </div>

      {mode === 'designer' ? (
        <>
          {dsec(
            'Auto layout',
            ['display', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
            (() => {
              const disp = (authored.display || cssHint(computed.display) || '').trim();
              const isFlex = disp === 'flex' || disp === 'inline-flex';
              return isFlex ? (
                <>
                  {row('flex-direction', iconseg('flex-direction', DIR_OPTS), undefined, 'Direction')}
                  {row(
                    'align-items',
                    <AlignPad value={alignPadCell()} onChange={setAlignPadCell} ariaLabel="auto-layout alignment" />,
                    provOf('align-items'),
                    'Alignment'
                  )}
                  {row('gap', vtok('gap', 'space'), undefined, 'Gap')}
                  <div className="st-cp-modes">
                    {sizeModeSeg('width')}
                    {sizeModeSeg('height')}
                  </div>
                  <div className="st-cp-box" aria-label="padding">
                    <span className="st-cp-boxtag st-cp-boxtag--p">
                      {prov(provOf('padding-top'))}padding
                    </span>
                    {side('padding-top', 'padding')}
                    {side('padding-right', 'padding')}
                    {side('padding-bottom', 'padding')}
                    {side('padding-left', 'padding')}
                  </div>
                  <div className="st-cp-clustermore-row">{moreBtn('Auto layout')}</div>
                  {designerMore['Auto layout']
                    ? row(
                        'flex-wrap',
                        <Toggle
                          checked={/^wrap/.test(authored['flex-wrap'] || cssHint(computed['flex-wrap']) || '')}
                          label="wrap items"
                          ariaLabel="flex-wrap"
                          onChange={(w) => commit('flex-wrap', w ? 'wrap' : 'nowrap')}
                        />,
                        provOf('flex-wrap'),
                        'Wrap'
                      )
                    : null}
                </>
              ) : (
                <button type="button" className="st-cp-makeflex" disabled={!editable} onClick={() => commit('display', 'flex')}>
                  + Auto layout (flex)
                </button>
              );
            })()
          )}

          {dsec(
            'Size',
            ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'],
            <>
              {row('width', num('width'), undefined, 'Width')}
              {row('height', num('height'), undefined, 'Height')}
              <div className="st-cp-clustermore-row">{moreBtn('Size')}</div>
              {designerMore.Size ? (
                <>
                  {row('min-width', num('min-width'), undefined, 'Min width')}
                  {row('max-width', num('max-width'), undefined, 'Max width')}
                  {row('min-height', num('min-height'), undefined, 'Min height')}
                  {row('max-height', num('max-height'), undefined, 'Max height')}
                </>
              ) : null}
            </>
          )}

          {dsec(
            'Position',
            ['position', 'top', 'right', 'bottom', 'left', 'z-index'],
            <>
              {row('position', csel('position', CSS_POSITION), undefined, 'Position')}
              <div className="st-cp-box st-cp-box--inset" aria-label="position inset (top / right / bottom / left)">
                <span className="st-cp-boxtag st-cp-boxtag--i">{prov(provOf('top'))}inset</span>
                {inset('top')}
                {inset('right')}
                {inset('bottom')}
                {inset('left')}
                <div className="st-cp-boxcore st-cp-boxcore--pos">
                  {authored.position || cssHint(computed.position) || 'static'}
                </div>
              </div>
              {(authored.position || cssHint(computed.position) || 'static') === 'static' ? (
                <div className="st-cp-note">
                  top / right / bottom / left apply once position is relative, absolute, fixed, or sticky
                </div>
              ) : null}
              <div className="st-cp-clustermore-row">{moreBtn('Position')}</div>
              {designerMore.Position ? row('z-index', num('z-index'), undefined, 'Layer order') : null}
            </>,
            false
          )}

          {dsec('Fill', ['background-color'], row('background-color', color('background-color'), undefined, 'Fill'))}

          {dsec('Stroke', ['border-width', 'border-style', 'border-color'], row('border', borderControl(), provOf('border-width'), 'Stroke'))}

          {dsec(
            'Corner radius',
            ['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'],
            row('border-radius', radiusControl(), provOf('border-radius'), 'Corner radius')
          )}

          {dsec(
            'Effects',
            ['box-shadow', 'filter', 'mix-blend-mode'],
            <>
              {row('box-shadow', tok('box-shadow', 'shadow') || text('box-shadow'), undefined, 'Shadow')}
              {row('filter', blurControl(), provOf('filter'), 'Blur')}
              {row('mix-blend-mode', csel('mix-blend-mode', CSS_BLEND_MODES), undefined, 'Blend')}
            </>
          )}

          {dsec('Opacity', ['opacity'], row('opacity', opacityControl(), undefined, 'Opacity'))}

          {dsec(
            'Text',
            ['font-family', 'color', 'font-size', 'font-weight', 'line-height', 'text-align', 'letter-spacing', 'font-style', 'text-transform', 'white-space'],
            <>
              {row('font-family', csel('font-family', CSS_FONTS), undefined, 'Font')}
              {row('color', color('color'), undefined, 'Color')}
              {row('font-size', vtok('font-size', 'type'), undefined, 'Size')}
              {row('font-weight', csel('font-weight', CSS_WEIGHTS), undefined, 'Weight')}
              {row('line-height', num('line-height', 'lh'), undefined, 'Line height')}
              {row('text-align', iconseg('text-align', TEXTALIGN_OPTS), undefined, 'Align')}
              <div className="st-cp-clustermore-row">{moreBtn('Text')}</div>
              {designerMore.Text ? (
                <>
                  {row('letter-spacing', num('letter-spacing', null, { min: -Infinity }), undefined, 'Letter spacing')}
                  {row('font-style', csel('font-style', CSS_FONT_STYLE), undefined, 'Style')}
                  {row('text-transform', csel('text-transform', CSS_TEXT_TRANSFORM), undefined, 'Case')}
                  {row('white-space', csel('white-space', CSS_WHITE_SPACE), undefined, 'Whitespace')}
                </>
              ) : null}
            </>
          )}

          {dsec(
            'Spacing',
            ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
            <div className="st-cp-box" aria-label="margin">
              <span className="st-cp-boxtag st-cp-boxtag--m">{prov(provOf('margin-top'))}margin</span>
              {side('margin-top', 'margin')}
              {side('margin-right', 'margin')}
              {side('margin-bottom', 'margin')}
              {side('margin-left', 'margin')}
            </div>
          )}

          {(() => {
            const { showMedia, canReplace } = mediaGate();
            return showMedia
              ? dsec('Media', ['object-fit', 'object-position', 'aspect-ratio'], mediaBody(canReplace))
              : null;
          })()}
        </>
      ) : (
        <>
      {sec(
        'Layout',
        (() => {
          // Stage M2 — auto-layout editor. Present the flex vocabulary (Direction ·
          // Wrap · Distribution · Align · Gap) only when the element IS a flex/grid
          // container, so a plain block doesn't carry knobs that do nothing; a
          // non-container gets a one-click "make it a flex layout" instead (the
          // DDR-104 gap-degrades-gracefully precedent). align-items / justify-content
          // / gap apply to grid too; flex-direction / flex-wrap are flex-only.
          const disp = (authored.display || cssHint(computed.display) || '').trim();
          const isFlex = disp === 'flex' || disp === 'inline-flex';
          const isGrid = disp === 'grid' || disp === 'inline-grid';
          return (
            <>
              {row('display', csel('display', CSS_DISPLAYS))}
              {isFlex ? (
                <>
                  {row('flex-direction', iconseg('flex-direction', DIR_OPTS))}
                  {row('flex-wrap', <Toggle checked={/^wrap/.test(authored['flex-wrap'] || cssHint(computed['flex-wrap']) || '')} label="wrap items" ariaLabel="flex-wrap" onChange={(w) => commit('flex-wrap', w ? 'wrap' : 'nowrap')} />, provOf('flex-wrap'))}
                </>
              ) : null}
              {isFlex || isGrid ? (
                <>
                  {row('align-items', iconseg('align-items', ALIGNITEMS_OPTS))}
                  {row('justify-content', iconseg('justify-content', JUSTIFY_OPTS))}
                  {row('gap', vtok('gap', 'space'))}
                </>
              ) : (
                <button
                  type="button"
                  className="st-cp-makeflex"
                  disabled={!editable}
                  onClick={() => commit('display', 'flex')}
                >
                  + Auto layout (flex)
                </button>
              )}
            </>
          );
        })()
      )}

      {(() => {
        // feature-3-web-artboards T5 (absorbed feature-grid-track-editor
        // stub) — Grid section, only when the element IS a grid container.
        // Track parse/serialize is the SAME grid-track-handles.ts module the
        // on-canvas gutter-drag overlay uses, so the Inspector and the drag
        // handles never disagree about track shape.
        const disp = (authored.display || cssHint(computed.display) || '').trim();
        const isGrid = disp === 'grid' || disp === 'inline-grid';
        if (!isGrid) return null;
        const colsRaw = authored['grid-template-columns'] || '';
        const rowsRaw = authored['grid-template-rows'] || '';
        const cols = parseTrackList(colsRaw);
        const rows = parseTrackList(rowsRaw);
        const colsEditable = cols.length > 0 || !colsRaw.trim();
        const rowsEditable = rows.length > 0 || !rowsRaw.trim();
        return sec(
          'Grid',
          <>
            {colsEditable ? (
              <GridTracksEditor
                label="Columns"
                tracks={cols}
                editable={editable}
                onChange={(next) => commit('grid-template-columns', serializeTrackList(next))}
              />
            ) : (
              <div className="st-cp-note">
                Columns use <code>{colsRaw}</code> — not editable as tracks here (repeat()/
                minmax()/subgrid); use /design:edit for these.
              </div>
            )}
            {rowsEditable ? (
              <GridTracksEditor
                label="Rows"
                tracks={rows}
                editable={editable}
                onChange={(next) => commit('grid-template-rows', serializeTrackList(next))}
              />
            ) : (
              <div className="st-cp-note">
                Rows use <code>{rowsRaw}</code> — not editable as tracks here (repeat()/minmax()/
                subgrid); use /design:edit for these.
              </div>
            )}
          </>
        );
      })()}

      {sec(
        'Position',
        <>
          {row('position', csel('position', CSS_POSITION))}
          <div className="st-cp-box st-cp-box--inset" aria-label="position inset (top / right / bottom / left)">
            <span className="st-cp-boxtag st-cp-boxtag--i">{prov(provOf('top'))}inset</span>
            {inset('top')}
            {inset('right')}
            {inset('bottom')}
            {inset('left')}
            <div className="st-cp-boxcore st-cp-boxcore--pos">
              {authored.position || cssHint(computed.position) || 'static'}
            </div>
          </div>
          {(authored.position || cssHint(computed.position) || 'static') === 'static' ? (
            <div className="st-cp-note">
              top / right / bottom / left apply once position is relative, absolute, fixed, or sticky
            </div>
          ) : null}
          {row('z-index', num('z-index'))}
        </>
      )}

      {(el.parentDisplay === 'grid' || el.parentDisplay === 'inline-grid') &&
        sec(
          'Grid item',
          <>
            <div className="st-cp-note">
              Manual cell placement — <code>start / end</code> or <code>start / span N</code>.
            </div>
            {row('grid-column', text('grid-column'))}
            {row('grid-row', text('grid-row'))}
          </>
        )}

      {sec(
        'Typography',
        <>
          {row('font-family', csel('font-family', CSS_FONTS))}
          {row('color', color('color'))}
          {row('font-size', vtok('font-size', 'type'))}
          {row('font-weight', csel('font-weight', CSS_WEIGHTS))}
          {row('line-height', num('line-height', 'lh'))}
          {row('letter-spacing', num('letter-spacing', null, { min: -Infinity }))}
          {/* handoff — text-align as a lucide icon button group; B/I/U as a toggle
              group mapped to font-weight / font-style / text-decoration. */}
          {row('text-align', iconseg('text-align', TEXTALIGN_OPTS))}
          {row('font-style', textStyleToggle(), provOf('font-style'))}
          {/* Stage B (Task B4) — promoted typography knobs (was DDR-104 OUT-list). */}
          {row('text-transform', csel('text-transform', CSS_TEXT_TRANSFORM))}
          {row('white-space', csel('white-space', CSS_WHITE_SPACE))}
        </>
      )}

      {sec(
        'Spacing',
        <>
          <div className="st-cp-box" aria-label="margin and padding">
            <span className="st-cp-boxtag st-cp-boxtag--m">
              {prov(provOf('margin-top'))}margin
            </span>
            {side('margin-top', 'margin')}
            {side('margin-right', 'margin')}
            {side('margin-bottom', 'margin')}
            {side('margin-left', 'margin')}
            <div className="st-cp-boxpad">
              <span className="st-cp-boxtag st-cp-boxtag--p">
                {prov(provOf('padding-top'))}padding
              </span>
              {side('padding-top', 'padding')}
              {side('padding-right', 'padding')}
              {side('padding-bottom', 'padding')}
              {side('padding-left', 'padding')}
              <div className="st-cp-boxcore">
                {/* handoff — prefer the AUTHORED size (updates live as you edit
                    width/height); el.bounds is stale until the canvas re-measures. */}
                {Math.round(Number.parseFloat(authored.width) || el.bounds?.w || 0)} × {Math.round(Number.parseFloat(authored.height) || el.bounds?.h || 0)}
              </div>
            </div>
          </div>
        </>
      )}

      {sec(
        'Size',
        <>
          {/* Stage M1 — per-axis Fixed / Hug / Fill sizing mode (Figma parity). The
              Fixed case leaves the numeric width/height knobs below in control. */}
          <div className="st-cp-modes">
            {sizeModeSeg('width')}
            {sizeModeSeg('height')}
          </div>
          {row('width', num('width'))}
          {row('height', num('height'))}
          {row('min-width', num('min-width'))}
          {row('max-width', num('max-width'))}
          {row('min-height', num('min-height'))}
          {row('max-height', num('max-height'))}
          {row('overflow', iconseg('overflow', OVERFLOW_OPTS))}
          {/* Stage M1 — flex-CHILD controls, only meaningful when the parent is a
              flex container. align-self is the cross-axis override; flex-grow/shrink/
              basis are the main-axis behavior the Fill mode writes for you. */}
          {parentIsFlexChild ? (
            <>
              <div className="st-cp-subhd">In flex parent</div>
              {row('align-self', csel('align-self', CSS_ALIGN_SELF))}
              {row('flex-grow', num('flex-grow', null, { unitless: true }))}
              {row('flex-shrink', num('flex-shrink', null, { unitless: true }))}
              {row('flex-basis', num('flex-basis'))}
            </>
          ) : null}
        </>
      )}

      {/* Stage B (Task B5) — Media framing (gate/body pulled into mediaGate()/
          mediaBody() above, DDR-171, so Designer mode's "Media" cluster
          reuses the identical content). */}
      {(() => {
        const { showMedia, canReplace } = mediaGate();
        return showMedia ? sec('Media', mediaBody(canReplace)) : null;
      })()}

      {sec(
        'Appearance',
        <>
          {row('background-color', color('background-color'))}
          {row('border-radius', radiusControl(), provOf('border-radius'))}
          {row('border', borderControl(), provOf('border-width'))}
          {row('box-shadow', tok('box-shadow', 'shadow') || text('box-shadow'))}
          {/* DDR-171 — blur + blend, real Advanced-mode rows (not Designer-exclusive);
              also power Designer mode's "Effects" cluster. */}
          {row('filter', blurControl(), provOf('filter'))}
          {row('mix-blend-mode', csel('mix-blend-mode', CSS_BLEND_MODES))}
          {row('opacity', opacityControl())}
          {/* Stage B (Task B4) — transform as a free-value row (mirrors box-shadow). */}
          {row('rotation', rotationControl(), provOf('transform'))}
          {row('transform', text('transform'))}
          {row('transform-origin', text('transform-origin'))}
        </>
      )}

      {/* #5 — the idle/saved status now lives in each row's leading dot (a glow),
          so the panel no longer carries a confusing standing 'written to source'
          line. Only a hard ERROR surfaces here, with the failing property. */}
      {(() => {
        const err = Object.entries(status).find(
          ([, s]) => typeof s === 'string' && s.startsWith('err:')
        );
        return err ? (
          <div className="st-cp-save is-err" role="status">
            <StIcon name="x" size={12} />
            {err[0]}: {err[1].slice(4)}
          </div>
        ) : null;
      })()}

      {sec(
        'Advanced',
        <div className="st-cp-advbody">
          {customStyleRows.length ? (
            <>
              <div className="st-cp-advgrp">Custom CSS properties</div>
              {customStyleRows.map(([p, v]) => (
                <div className="st-cp-kv" key={`cs:${p}`}>
                  <input
                    className="st-cp-fin st-cp-fin--ro"
                    readOnly
                    value={p}
                    aria-label={`custom property ${p} name`}
                  />
                  <input
                    className="st-cp-fin"
                    key={`cs:${p}:${v}`}
                    defaultValue={v}
                    aria-label={`${p} value`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    onBlur={(e) => commitCustom(p, e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    className="st-cp-kvx"
                    aria-label={`remove ${p}`}
                    title="remove"
                    onClick={() => resetCustom(p)}
                  >
                    <StIcon name="x" size={11} />
                  </button>
                </div>
              ))}
            </>
          ) : null}
          <div className="st-cp-advgrp">Add CSS property</div>
          <RawKnob commit={commitCustom} />
          <div className="st-cp-note">applied as-is — not token-bound</div>
          {attrRows.length ? (
            <>
              <div className="st-cp-advgrp">Custom HTML attributes</div>
              {attrRows.map(([a, v]) => (
                <div className="st-cp-kv" key={`at:${a}`}>
                  <input
                    className="st-cp-fin st-cp-fin--ro"
                    readOnly
                    value={a}
                    aria-label={`attribute ${a} name`}
                  />
                  <input
                    className="st-cp-fin"
                    key={`at:${a}:${v}`}
                    defaultValue={v}
                    aria-label={`${a} value`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    onBlur={(e) => commitAttr(a, e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    className="st-cp-kvx"
                    aria-label={`remove ${a}`}
                    title="remove"
                    onClick={() => resetAttr(a)}
                  >
                    <StIcon name="x" size={11} />
                  </button>
                </div>
              ))}
            </>
          ) : null}
          <div className="st-cp-advgrp">Add HTML attribute</div>
          <AttrKnob commit={commitAttr} />
        </div>
      )}
        </>
      )}

      <div className="st-cp-legend">
        <span>
          <i className="st-cp-prov st-cp-prov--bound" aria-hidden="true" />
          token
        </span>
        <span>
          <i className="st-cp-prov st-cp-prov--raw" aria-hidden="true" />
          override
        </span>
        <span>
          <i className="st-cp-prov st-cp-prov--inherit" aria-hidden="true" />
          inherited
        </span>
      </div>
    </div>
  );
}

// Custom CSS property hatch — writes an arbitrary `property: value` to inline style.
export function RawKnob({ commit }) {
  const [prop, setProp] = useState('');
  const [val, setVal] = useState('');
  const submit = () => {
    if (prop.trim() && val.trim()) {
      commit(prop.trim(), val);
      setProp('');
      setVal('');
    }
  };
  return (
    <div className="st-cp-kv">
      <input
        className="st-cp-fin"
        aria-label="custom property name"
        placeholder="property"
        value={prop}
        onChange={(e) => setProp(e.target.value)}
      />
      <input
        className="st-cp-fin"
        aria-label="custom property value"
        placeholder="value"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        onBlur={submit}
      />
    </div>
  );
}

// Custom HTML attribute hatch — writes a plain JSX attribute (data-*, aria-*, …).
export function AttrKnob({ commit }) {
  const [attr, setAttr] = useState('');
  const [val, setVal] = useState('');
  const submit = () => {
    if (attr.trim() && val.trim()) {
      commit(attr.trim(), val);
      setAttr('');
      setVal('');
    }
  };
  return (
    <div className="st-cp-kv">
      <input
        className="st-cp-fin"
        aria-label="custom attribute name"
        placeholder="data-…"
        value={attr}
        onChange={(e) => setAttr(e.target.value)}
      />
      <input
        className="st-cp-fin"
        aria-label="custom attribute value"
        placeholder="value"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        onBlur={submit}
      />
    </div>
  );
}
