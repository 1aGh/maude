// client/v2/inspector/advanced.jsx — S2.2 (Gate 0 D18) + S11.8: the inspector's "› Advanced" fold.
//
// Closed, the inspector speaks designer and the fold says "Code, tokens, CSS". Open, it ADDS what the code says
// under the unchanged rows (06 · ad-inspector): Element (Tag · Classes · Selector · Element id) · Used in
// (Shared · 4 places + Detach) · Tokens bound · CSS (Edit as text · Property · Attribute) · Copy style · Paste
// style · Copy CSS · Copy code — and UNDER them the v1 raw editor exactly as it was (CssKnobs: custom CSS
// property rows, HTML attribute rows, the token popover). An artboard has its own sections (kinds/artboard.jsx, S2.8) and only its Theme here (ArtboardAdvanced).
//
// The rows are a registry (advanced-rows.js, S11-slices §2.3): S2.8, S7 and S8 add theirs without editing this
// file. The Designer/Advanced vocabulary switch is gone (rule 13): the frame is the designer vocabulary, this
// fold is the raw one; the switch "became this fold".

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CssKnobs } from '../../inspector/css-knobs.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { useFold } from '../fold/use-fold.js';
import { menuRunner } from '../shell/menu-runner.js';
import {
  ADVANCED_GROUPS,
  advancedRowsFor,
  advancedRowsVersion,
  GROUP_TITLES,
  subscribeAdvancedRows,
} from './advanced-rows.js';
import { copyText, InspectFacts } from './advanced-rows-default.jsx';
import { NO_CODE_FOR_VIEW, readElementCode } from './element-code.js';
import { bindInspectorActions } from './inspector-actions.js';
import { ArtboardAdvanced } from './kinds/artboard-advanced.jsx';
import { isArtboardSelection } from './kinds/index.js';

export { copyText, InspectFacts };

/** The fold's count: "6 properties" (14 Editing, ed-ab-select). */
export const propertiesWords = (n) =>
  n > 0 ? `${n} ${n === 1 ? 'property' : 'properties'}` : undefined;

/**
 * What the role may do here. Can view = `observer` (no code at all); Can comment is the other read-only role
 * (it may read and copy the code — the server gives it `export` — but writes nothing).
 */
export function advancedAccess(cfg, role) {
  const r = role ?? cfg?.cloud?.role ?? null;
  const readOnly = !!cfg?.readOnly || r === 'viewer' || r === 'observer';
  return { role: r, readOnly, canEdit: !readOnly, canCode: r !== 'observer' };
}

function GroupTitle({ group, rows, ctx, el, kind }) {
  const title = GROUP_TITLES[group];
  if (!title) return null;
  const aside = rows.map((r) => r.aside).find((a) => a != null);
  const node = typeof aside === 'function' ? aside({ el, kind, ctx }) : aside;
  return (
    <p className="insp-adv-h insp-sub">
      <span>{title}</span>
      {node ? <span className="insp-sub-a">{node}</span> : null}
    </p>
  );
}

function Groups({ groups, kind, el, ctx }) {
  return groups.map((group) => {
    const rows = advancedRowsFor(group, { el, kind, ctx });
    if (!rows.length) return null;
    return (
      <div
        className={`insp-group insp-group--${group}`}
        key={group}
        data-testid={`adv-group-${group}`}
      >
        <GroupTitle group={group} rows={rows} ctx={ctx} el={el} kind={kind} />
        {rows.map(({ id, Body }) => (
          <Body key={id} el={el} kind={kind} ctx={ctx} />
        ))}
      </div>
    );
  });
}

/**
 * The fold. `open` / `onToggle` are the frame's (it starts open while no section has a body yet, because
 * until S2.3 lands this fold IS the editor).
 */
export function InspectorAdvanced({
  selected,
  el,
  layersTree,
  cfg,
  canvasFile,
  open,
  onToggle,
  onRenameElementId,
  edit,
  artboard,
  editScope,
  onDetachInstance,
  role,
  runAction,
  fetchImpl,
}) {
  useSyncExternalStore(subscribeAdvancedRows, advancedRowsVersion, advancedRowsVersion);
  const many = Array.isArray(selected) && selected.length > 1;
  const isArtboard = !many && isArtboardSelection(el);
  let hint = many ? 'Mixed' : isArtboard ? undefined : 'Code, tokens, CSS';
  const access = advancedAccess(cfg, role);
  const [textOn, setTextOn] = useState(false);
  // a different element starts a fresh view of it
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets on a fresh selection only.
  useEffect(() => setTextOn(false), [el?.id, el?.index]);

  const cssText = useMemo(
    () => ({
      on: textOn,
      toggle: () => setTextOn((v) => !v),
      open: () => setTextOn(true),
      close: () => setTextOn(false),
    }),
    [textOn]
  );
  const ctx = {
    ...access,
    canvasFile,
    cfg,
    layersTree,
    edit,
    editScope,
    onDetachInstance,
    onRenameElementId,
    cssText,
    fetchImpl,
    // S7.23: a print artboard's Look and layout row writes through the artboard's own handlers
    artboard,
    runAction: runAction ?? ((id) => menuRunner.run(id)),
  };

  // S2.22 (14 Editing, ed-ab-select): "Advanced  6 properties" — the rows the fold holds for this artboard
  if (isArtboard) {
    const q = { el, kind: 'artboard', ctx };
    const n =
      (artboard?.onSetArtboardTheme ? 1 : 0) +
      advancedRowsFor('artboard', q).length +
      advancedRowsFor('in-code', q).length;
    hint = propertiesWords(n);
  }

  // ⌘K: Copy code · Edit CSS as text… · Detach — the registry actions run on the element this fold shows
  useEffect(() => {
    if (many || isArtboard || !el) return undefined;
    return bindInspectorActions({
      'inspector.copy-code': async () => {
        if (!access.canCode) return NO_CODE_FOR_VIEW;
        const r = await readElementCode({ canvasFile, id: el.id, index: el.index ?? 0, fetchImpl });
        if (!r.ok) return r.message;
        return (await copyText(r.code)) ? 'Copied the code.' : 'Not copied; try again.';
      },
      'inspector.edit-css-as-text': () => {
        if (!access.canEdit) return 'Your role can’t change the CSS.';
        if (!open) onToggle?.();
        setTextOn(true);
        return null;
      },
      'element.detach': () => {
        if (!access.canEdit) return 'Your role can’t detach this.';
        if (editScope?.scope !== 'shared' || !onDetachInstance)
          return 'This element isn’t shared. There is nothing to detach.';
        onDetachInstance(el.id, el.index);
        return null;
      },
    });
  }, [
    many,
    isArtboard,
    el,
    access.canCode,
    access.canEdit,
    canvasFile,
    fetchImpl,
    open,
    onToggle,
    editScope,
    onDetachInstance,
  ]);

  return (
    <AdvancedFold panel="inspector" hint={hint} open={open} onToggle={onToggle}>
      {isArtboard ? (
        <div className="insp-adv">
          <ArtboardAdvanced el={el} ctx={{ cfg, canvasFile, artboard }} />
          <Groups groups={['artboard', 'in-code']} kind="artboard" el={el} ctx={ctx} />
        </div>
      ) : (
        <div className="insp-adv">
          {many ? null : <Groups groups={ADVANCED_GROUPS} kind="element" el={el} ctx={ctx} />}
          {/* several objects: the raw editor alone, as before (a writer's) */}
          {many && access.canEdit ? <CssKnobs el={el} cfg={cfg} mode="advanced" {...edit} /> : null}
        </div>
      )}
    </AdvancedFold>
  );
}

/** Open/closed for the frame: remembered per Mac, but starts open while it is the only editor. */
export function useAdvancedOpen(hasSections) {
  const [stored, setStored] = useFold('inspector');
  const [chosen, setChosen] = useState(null);
  const open = chosen ?? (stored || !hasSections);
  return {
    open,
    toggle: () => {
      setChosen(!open);
      setStored(!open);
    },
    /** open it (⌘K "Edit element id…" needs the field on screen) */
    show: () => {
      setChosen(true);
      setStored(true);
    },
  };
}
