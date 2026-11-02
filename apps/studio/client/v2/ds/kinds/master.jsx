// client/v2/ds/kinds/master.jsx — S10.10: a component master of the Design system canvas, edited in place
// (13 · ds-edit-master).
//
// Select a tile on the Components section and the inspector says what it is — Tlačítko, Component — and lets the
// person change its look right there:
//
//   Corners  [ 6px ]        Fill  [ var(--bg-3) ]        Text  [ var(--fg-0) ]        Height  [ 32px ]
//   Used in 34 canvases · 4 variants · 4 states · 2 sizes
//   1 change waiting.   [ Update canvases… ]
//
// Nothing here writes a CSS file and nothing opens a dialog: each finished edit becomes ONE waiting declaration
// patch (`POST /_api/ds/pending`, master-write.js) and "1 change waiting" shows in the Design system bar. It reaches
// canvases only through "Update N canvases" (S10.8) — where a whole folder can be left out with one tick and its
// canvases keep the old corners with a dot. The panel is hidden from nobody and refused by the server: Can view
// reads, Can edit writes.
//
// "Bare" like the token kind: the ten object sections and the raw code fold mean nothing for a master.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usedWords } from '../../../../ds/board/types.ts';
import { StIcon } from '../../../shell/icons.jsx';
import { registerBlock } from '../../inspector/blocks.js';
import { registerKind, singleOf } from '../../inspector/kinds/index.js';
import { Quiet, Row } from '../../inspector/sections/row.jsx';
import { currentMasterValue, MASTER_ROWS, MASTER_WORDS, writeMaster } from '../master-write.js';
import { systemOfCanvas, useDsBoard } from '../use-ds-model.js';

export const masterNameOf = (el) => {
  const v = el?.attrs?.['data-ds-master'];
  return typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v) ? v : null;
};

export const isDsMaster = (selection) => {
  const el = singleOf(selection);
  return !!el && masterNameOf(el) !== null;
};

const ROW_TESTID = {
  'border-radius': 'corners',
  background: 'fill',
  color: 'text',
  height: 'height',
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function Edit({ master, row, editable, onCommit }) {
  const saved = currentMasterValue(master, row.prop);
  const [typed, setTyped] = useState(null);
  // a different master (or a value that moved under us) starts from what is saved
  // biome-ignore lint/correctness/useExhaustiveDependencies: the saved value is the trigger
  useEffect(() => setTyped(null), [master.name, saved]);
  const id = ROW_TESTID[row.prop];
  return (
    <Row k={row.label} name={`ds-${id}`} mod={master.patches.some((p) => p.prop === row.prop)}>
      <input
        type="text"
        className="ds-tk-text"
        data-testid={`ds-master-${id}`}
        aria-label={`${master.label} — ${row.label.toLowerCase()}`}
        spellCheck={false}
        disabled={!editable}
        placeholder="Not set"
        value={typed ?? saved}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={async () => {
          // what was typed gives way to what is saved once the server has answered (a refusal shows the old value)
          if (typed !== null && typed.trim() !== saved) await onCommit(row.prop, typed);
          setTyped(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setTyped(null);
        }}
      />
    </Row>
  );
}

/** The panel for ONE master of one system. Exported for tests with an injected model and writer. */
export function MasterPanel({ name, ds, model, editable = true, onWrite, onRefresh, onAskUpdate }) {
  const master = model?.components.find((c) => c.name === name) ?? null;
  const [note, setNote] = useState(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the master is the trigger
  useEffect(() => setNote(null), [name]);

  const commit = useCallback(
    async (prop, value) => {
      setNote(null);
      const r = await onWrite({ ds, name, edit: { prop, value }, model });
      if (r.ok) await onRefresh();
      else {
        setNote(r.message);
        await onRefresh();
      }
    },
    [ds, name, model, onWrite, onRefresh]
  );

  if (!master) return null;
  const used = usedWords(master.used);
  const waiting = master.patches.length;
  const axes = [
    master.variants.length ? plural(master.variants.length, 'variant', 'variants') : '',
    master.states.length ? plural(master.states.length, 'state', 'states') : '',
    master.sizes.length ? plural(master.sizes.length, 'size', 'sizes') : '',
  ].filter(Boolean);
  const canEdit = editable && !!master.className;

  return (
    <section
      className="insp-sec ds-tk ds-mk"
      data-testid="insp-sec-ds-master"
      data-master={name}
      aria-label={master.label}
    >
      <p className="insp-sec-t">
        <span className="insp-sec-name">{master.label}</span>
        {waiting ? (
          <span className="insp-sec-a" data-testid="ds-master-edited">
            As edited
          </span>
        ) : null}
      </p>
      {master.className ? null : <Quiet testid="ds-master-noclass">{MASTER_WORDS.noClass}</Quiet>}
      {MASTER_ROWS.map((row) => (
        <Edit key={row.prop} master={master} row={row} editable={canEdit} onCommit={commit} />
      ))}
      {used || axes.length ? (
        <Quiet testid="ds-master-used">
          <StIcon name="layers" size={12} /> {[used, ...axes].filter(Boolean).join(' · ')}
        </Quiet>
      ) : null}
      {waiting ? (
        <p className="insp-quiet ds-mk-wait" data-testid="ds-master-waiting">
          {plural(waiting, 'change', 'changes')} waiting.
          <button
            type="button"
            className="insp-quietlink"
            data-testid="ds-master-update"
            onClick={() => onAskUpdate?.()}
          >
            Update canvases…
          </button>
        </p>
      ) : null}
      {note ? (
        <p
          className="insp-quiet ds-tk-note"
          role="status"
          data-testid="ds-master-note"
          data-tone="warn"
        >
          {note}
        </p>
      ) : null}
    </section>
  );
}

function MasterBody({ el, ctx }) {
  const name = masterNameOf(el);
  const ds = useMemo(() => systemOfCanvas(ctx?.canvasFile, ctx?.cfg), [ctx?.canvasFile, ctx?.cfg]);
  const { model, loading, refresh } = useDsBoard(ds, name ?? '');
  if (!name) return null;
  if (!ds) return <Quiet testid="ds-master-nosystem">This isn’t part of a design system.</Quiet>;
  if (!model)
    return (
      <Quiet testid="ds-master-loading">
        {loading ? 'Reading the system…' : 'The system isn’t available.'}
      </Quiet>
    );
  return (
    <MasterPanel
      name={name}
      ds={ds}
      model={model}
      editable={ctx?.editable !== false}
      onWrite={writeMaster}
      onRefresh={refresh}
      onAskUpdate={() => ctx?.onShellAction?.('ds.publish', { ds })}
    />
  );
}

let offs = [];

/** Register the kind and its block (idempotent; tests that unregistered call it again). */
export function registerDsMasterKind() {
  if (offs.length) return;
  offs = [
    registerKind({
      id: 'ds-master',
      order: 4,
      bare: true,
      label: 'Component',
      match: isDsMaster,
    }),
    registerBlock({
      id: 'ds.master',
      kinds: ['ds-master'],
      at: 'top',
      order: 10,
      Body: MasterBody,
    }),
  ];
}

export const offDsMaster = () => {
  for (const off of offs) off();
  offs = [];
};

registerDsMasterKind();
