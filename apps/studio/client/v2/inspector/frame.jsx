// client/v2/inspector/frame.jsx — S2.2 (Gate 0 D18): the inspector's frame (14 Editing, ed-inspector).
//
//   crumbs                       Desktop › Nav › Book a call
//   name  [kind chip]            Book a call  [Button]
//   Uses <design system>
//   ── ten numbered sections ──  filled by other slices through slots.js (a section with no body is not drawn)
//   › Advanced                   the code behind it, and the unchanged v1 raw editor (advanced.jsx)
//
// The frame owns no write. A section body gets `ctx` (the panel's edit channels) and writes through the
// existing /_api/edit-* routes; the frame only lays them out, names them and folds the raw layer away.

import { useEffect, useSyncExternalStore } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { activeDsNameFor } from '../../inspector/ds-tokens.js';
import { copyText, InspectorAdvanced, useAdvancedOpen } from './advanced.jsx';
import { bindInspectorActions } from './inspector-actions.js';
import { kindChipOf, resolveKind } from './kinds/index.js';
import { crumbsOf, cssTextOf, hasUsableId, titleOf } from './model.js';
import { SECTIONS } from './sections.js';
import { hasAnySlot, slotsFor, slotsVersion, subscribeSlots } from './slots.js';

function Crumbs({ path }) {
  return (
    <nav className="insp-crumbs" data-testid="inspector-crumbs" aria-label="Where this is">
      {path.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a path can repeat a name; position is its identity
        <span key={`${i}:${p}`} className="insp-crumb-wrap">
          {i ? (
            <span className="insp-crumb-ch" aria-hidden="true">
              <StIcon name="chevron-right" size={10} />
            </span>
          ) : null}
          <span className="insp-crumb" data-last={i === path.length - 1 ? 'true' : undefined}>
            {p}
          </span>
        </span>
      ))}
    </nav>
  );
}

function Section({ def, entries, ctx, el, selection, kindId }) {
  const adder = def.adder ? entries.find((e) => typeof e.add === 'function') : null;
  const aside = entries.find((e) => e.aside != null)?.aside;
  const asideNode = typeof aside === 'function' ? aside({ el, ctx }) : aside;
  return (
    <section
      className="insp-sec"
      data-testid={`insp-sec-${def.id}`}
      data-n={def.n}
      aria-label={def.title}
    >
      <p className="insp-sec-t">
        <span className="insp-sec-name" title={def.explain}>
          {def.title}
        </span>
        {asideNode != null ? (
          <span className="insp-sec-a">{asideNode}</span>
        ) : def.aside && def.aside !== 'unlink' ? (
          <span className="insp-sec-a">{def.aside}</span>
        ) : null}
        {adder ? (
          <button
            type="button"
            className="insp-add"
            data-testid={`insp-add-${def.id}`}
            aria-label={`Add ${def.title.toLowerCase()}`}
            title={`Add ${def.title.toLowerCase()}`}
            onClick={() => adder.add({ el, ctx })}
          >
            <StIcon name="plus" size={12} />
          </button>
        ) : null}
      </p>
      {entries.map(({ id, Body }) => (
        <Body key={id} el={el} selection={selection} kind={kindId} ctx={ctx} />
      ))}
    </section>
  );
}

export function InspectorFrame({
  selected,
  layersTree,
  cfg,
  canvasFile,
  onOptimistic,
  onRecordEdit,
  onReplaceMedia,
  onUndoRedo,
  onRenameElementId,
  onResizeArtboard,
  onSetArtboardHug,
  onSetArtboardStyle,
  onSetArtboardKind,
  onSetArtboardPrint,
  onDuplicateArtboard,
}) {
  // a slice that registers late (hot reload) redraws the frame
  useSyncExternalStore(subscribeSlots, slotsVersion, slotsVersion);
  const el = Array.isArray(selected) ? selected[0] : selected;
  const adv = useAdvancedOpen(hasAnySlot());
  const el1 = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
  // the three registry actions (⌘K) run on what this frame shows; with several objects they say so
  useEffect(() => {
    const only = (fn) => () => (el1 ? fn(el1) : 'Select one object first.');
    return bindInspectorActions({
      'inspector.copy-css': only(async (e) =>
        (await copyText(cssTextOf(e))) ? 'Copied the CSS.' : 'Not copied; try again.'
      ),
      'element.copy-id': only(async (e) =>
        hasUsableId(e)
          ? (await copyText(e.id))
            ? 'Copied the element id.'
            : 'Not copied; try again.'
          : 'This element has no id yet. Edit element id… gives it one.'
      ),
      'element.set-id': only(() => {
        adv.show();
        requestAnimationFrame(() =>
          document.querySelector('[data-testid="inspector-element-id"]')?.focus()
        );
        return null;
      }),
    });
  }, [el1, adv.show]);
  if (!el) return null;

  const kind = resolveKind(selected);
  const chip = kindChipOf(selected);
  const crumbs = crumbsOf(layersTree, Array.isArray(selected) ? null : el);
  const ds = activeDsNameFor(canvasFile, cfg);
  const ctx = {
    canvasFile,
    cfg,
    editable: !!el.id,
    onOptimistic,
    onRecordEdit,
    onUndoRedo,
    onReplaceMedia,
  };
  const edit = { onOptimistic, onRecordEdit, onReplaceMedia, onUndoRedo };
  const artboard = {
    onResizeArtboard,
    onSetArtboardHug,
    onSetArtboardStyle,
    onSetArtboardKind,
    onSetArtboardPrint,
    onDuplicateArtboard,
  };

  return (
    <div className="insp" data-testid="inspector-frame" data-kind={kind.id}>
      {crumbs.length > 1 ? <Crumbs path={crumbs} /> : null}
      <div className="insp-hd">
        <strong className="insp-title" data-testid="inspector-title">
          {titleOf(selected, layersTree)}
        </strong>
        <span className="insp-chip" data-testid="inspector-kind">
          {chip}
        </span>
      </div>
      {ds ? (
        <p className="insp-uses" data-testid="inspector-uses">
          Uses {ds}
        </p>
      ) : null}
      {SECTIONS.map((def) => {
        const entries = slotsFor(def.id, kind.id);
        if (!entries.length) return null;
        return (
          <Section
            key={def.id}
            def={def}
            entries={entries}
            ctx={ctx}
            el={el}
            selection={selected}
            kindId={kind.id}
          />
        );
      })}
      <InspectorAdvanced
        selected={selected}
        el={el}
        layersTree={layersTree}
        cfg={cfg}
        canvasFile={canvasFile}
        open={adv.open}
        onToggle={adv.toggle}
        onRenameElementId={onRenameElementId}
        edit={edit}
        artboard={artboard}
      />
    </div>
  );
}
