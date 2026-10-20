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

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { AssetAbsentBox } from '../assets/missing-frame.jsx';
import { activeDsNameFor } from '../../inspector/ds-tokens.js';
import { UsesLink } from '../ds/uses-link.jsx';
import { copyText, InspectorAdvanced, useAdvancedOpen } from './advanced.jsx';
import { crumbsFromPath, InspectorCrumbs } from './crumbs.jsx';
import { blocksFor, blocksVersion, subscribeBlocks } from './blocks.js';
import { bindInspectorActions } from './inspector-actions.js';
import { writeLink } from './link-write.js';
import { kindChipOf, resolveKind } from './kinds/index.js';
import { useInstanceSelection } from './kinds/instance.jsx';
// S10.7 — a token of the Design system canvas is a kind of its own (client/v2/ds/kinds/token.jsx)
import '../ds/kinds/token.jsx';
// S10.10 — and so is a component master (client/v2/ds/kinds/master.jsx)
import '../ds/kinds/master.jsx';
// S10.16b — and so is a direction the AI drafted for a system being made (client/v2/ds/direction-bar.jsx)
import '../ds/direction-bar.jsx';
import { crumbsOf, cssTextOf, hasUsableId, titleOf } from './model.js';
import { sectionsFor } from './sections.js';
import { hasAnySlot, slotsFor, slotsVersion, subscribeSlots } from './slots.js';
import { HoldLine, useHoldView, viewModeOf } from './view-mode.jsx';

function Section({ def, entries, ctx, el, selection, kindId }) {
  const adder = def.adder
    ? entries.find(
        (e) =>
          typeof e.add === 'function' &&
          (typeof e.canAdd !== 'function' || e.canAdd({ el, selection, kind: kindId, ctx }))
      )
    : null;
  const aside = entries.find((e) => e.aside != null)?.aside;
  const asideNode = typeof aside === 'function' ? aside({ el, ctx }) : aside;
  // a body may rename its section for what is selected: Border is "Stroke" on a line or a Pen path
  const named = entries.find((e) => e.title != null)?.title;
  const title =
    (typeof named === 'function' ? named({ el, selection, kind: kindId }) : named) || def.title;
  return (
    <section
      className="insp-sec"
      data-testid={`insp-sec-${def.id}`}
      data-n={def.n}
      aria-label={title}
    >
      <p className="insp-sec-t">
        <span className="insp-sec-name" title={def.explain}>
          {title}
        </span>
        {asideNode === '' ? null : asideNode != null ? (
          <span className="insp-sec-a">{asideNode}</span>
        ) : def.aside && def.aside !== 'unlink' ? (
          <span className="insp-sec-a">{def.aside}</span>
        ) : null}
        {adder ? (
          <button
            type="button"
            className="insp-add"
            data-testid={`insp-add-${def.id}`}
            aria-label={`Add ${title.toLowerCase()}`}
            title={`Add ${title.toLowerCase()}`}
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
  selected: selectedProp,
  layersTree,
  cfg,
  canvasFile,
  onOptimistic,
  onRecordEdit,
  onRunAction,
  onReplaceMedia,
  onOpenPhoto,
  photoPerUse,
  onUndoRedo,
  onRenameElementId,
  onResizeArtboard,
  onSetArtboardHug,
  onSetArtboardStyle,
  onSetArtboardKind,
  onSetArtboardPrint,
  onSetArtboardTheme,
  onDuplicateArtboard,
  onSelectCrumb,
  editScope,
  onDetachInstance,
  onShellAction,
}) {
  // a slice that registers late (hot reload) redraws the frame
  useSyncExternalStore(subscribeSlots, slotsVersion, slotsVersion);
  useSyncExternalStore(subscribeBlocks, blocksVersion, blocksVersion);
  // S2.17 — the server says whether a single selection is an instance; the answer rides on the selection
  const { selected, refresh: refreshInstance } = useInstanceSelection(selectedProp, canvasFile);
  const el = Array.isArray(selected) ? selected[0] : selected;
  const adv = useAdvancedOpen(hasAnySlot());
  // S2.18 — someone else holds the selection: view mode (view-mode.jsx)
  const rootRef = useRef(null);
  const hold = viewModeOf(useHoldView({ canvasOrigin: cfg?.canvasOrigin, rootRef }));
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
      'element.clear-link': only(async (e) => {
        if (!e.attrs?.['data-cd-link']) return 'This object has no link.';
        const canvas = e.file ?? canvasFile;
        if (!canvas || !e.artboardId || !hasUsableId(e))
          return 'Not changed; select the object again.';
        const r = await writeLink({
          canvas,
          artboardId: e.artboardId,
          id: e.id,
          index: e.index,
          target: null,
        });
        return r.ok ? 'Cleared the link.' : r.message;
      }),
      'element.set-id': only(() => {
        adv.show();
        requestAnimationFrame(() =>
          document.querySelector('[data-testid="inspector-element-id"]')?.focus()
        );
        return null;
      }),
    });
  }, [el1, adv.show, canvasFile]);
  if (!el) return null;

  const kind = resolveKind(selected);
  const chip = kindChipOf(selected);
  const crumbs = crumbsOf(layersTree, Array.isArray(selected) ? null : el);
  const ds = activeDsNameFor(canvasFile, cfg);
  // S2.8 — the artboard's handlers ride on ctx too: kinds/artboard.jsx's section bodies write through them
  const artboard = {
    onResizeArtboard,
    onSetArtboardHug,
    onSetArtboardStyle,
    onSetArtboardKind,
    onSetArtboardPrint,
    onSetArtboardTheme,
    onDuplicateArtboard,
  };
  const ctx = {
    canvasFile,
    cfg,
    editable: !!el.id,
    refreshInstance,
    onOptimistic,
    onRecordEdit,
    onRunAction,
    // S10.8 — a registry action the SHELL runs (`ds.review-update`, `ds.go-to`): `(id, params) => void`
    onShellAction,
    onUndoRedo,
    onReplaceMedia,
    // S2.15 — Adjust… / Remove background hand off to Photo; drawn only when the panel can open it (kinds/image.jsx)
    onOpenPhoto,
    photoPerUse,
    artboard,
  };
  const edit = { onOptimistic, onRecordEdit, onReplaceMedia, onUndoRedo };

  return (
    <div
      ref={rootRef}
      className={hold.view ? 'insp ed-insp--view' : 'insp'}
      data-testid="inspector-frame"
      data-kind={kind.id}
    >
      {/* S2.1 — the canvas's own crumbs (clickable, + esc); the layer-tree path for an old bundle */}
      {Array.isArray(el.crumbs) && !Array.isArray(selected) ? (
        <InspectorCrumbs crumbs={el.crumbs} onPick={onSelectCrumb} />
      ) : crumbs.length > 1 ? (
        <InspectorCrumbs crumbs={crumbsFromPath(crumbs)} />
      ) : null}
      <div className="insp-hd">
        <strong className="insp-title" data-testid="inspector-title">
          {titleOf(selected, layersTree)}
        </strong>
        <span className="insp-chip" data-testid="inspector-kind">
          {chip}
        </span>
      </div>
      {/* S10.13 — the line is a door to the system's canvas (ds.go-to) when the shell can run it */}
      {ds ? <UsesLink ds={ds} cfg={cfg} onShellAction={onShellAction} /> : null}
      {/* S8.19c — a picture that is Waiting for someone's Mac or Missing says so, and offers Relink… */}
      <AssetAbsentBox el={el1} canvas={canvasFile} />
      <HoldLine line={hold.line} />
      {/* view mode: every value stays readable, no field opens (a disabled fieldset is the one switch) */}
      <fieldset className="ed-insp-fields" disabled={hold.view}>
        {/* S2.17 — what only this kind has (an instance: Component · Content), above the ten sections */}
        {blocksFor(kind.id, 'top').map(({ id, Body }) => (
          <Body key={id} el={el} selection={selected} kind={kind.id} ctx={ctx} />
        ))}
        {(kind.bare ? [] : sectionsFor(kind.id)).map((def) => {
          const entries = slotsFor(def.id, kind.id, selected, ctx);
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
        {blocksFor(kind.id, 'bottom').map(({ id, Body }) => (
          <Body key={id} el={el} selection={selected} kind={kind.id} ctx={ctx} />
        ))}
        {kind.bare ? null : kind.Advanced ? (
          // S7.10 — a kind with a fold of its own (a clip on the Timeline: no CSS, a file and its in and out)
          <kind.Advanced
            el={el}
            selection={selected}
            ctx={ctx}
            open={adv.open}
            onToggle={adv.toggle}
          />
        ) : (
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
            editScope={editScope}
            onDetachInstance={onDetachInstance}
          />
        )}
      </fieldset>
    </div>
  );
}
