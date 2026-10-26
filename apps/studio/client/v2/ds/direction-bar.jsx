// client/v2/ds/direction-bar.jsx — S10.16b: pick a direction, or mix (13 · ds-make-mix).
//
// Select a direction on the Design system canvas (the artboard, or the tile in it) and the inspector offers the
// pick: "Use A", or "Mix with…" — B's type, C's colours, corners. A mix is a base direction with whole groups taken
// from others, so the menu toggles parts and the one button then reads "Use this mix". Saying it in the chat works
// too: the AI uses the same verbs (`ds use`, `ds mix`).
//
// Nothing here writes a token file: `POST /_api/ds/make {action:'use'|'mix'}` materialises the draft into the
// working files and the canvas follows. The panel is hidden from nobody and refused by the server: Can edit on the
// whole project writes. Once the system is made the directions stay to look at and the pick is gone.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { registerBlock } from '../inspector/blocks.js';
import { registerKind, singleOf } from '../inspector/kinds/index.js';
import { Quiet } from '../inspector/sections/row.jsx';
import { mixDirections, useDirection } from './make-write.js';
import { systemOfCanvas, useDsBoard } from './use-ds-model.js';

export const DIRECTION_WORDS = Object.freeze({
  use: (x) => `Use ${x}`,
  useMix: 'Use this mix',
  mix: 'Mix with…',
  picked: 'Picked',
  made: 'This system is made. Its directions stay here to look at.',
  alone: 'Mix needs a second direction.',
  using: (x) => `Using Direction ${x}.`,
  mixed: (x) => `Using Direction ${x} with parts of the others.`,
  noSystem: 'This isn’t part of a design system.',
});

/** What a direction can lend: the word the server takes (`--take <word>=<direction>`) and how it reads. */
export const MIX_PARTS = Object.freeze([
  { word: 'type', label: (x) => `${x}’s type` },
  { word: 'colour', label: (x) => `${x}’s colours` },
  { word: 'radius', label: (x) => `${x}’s corners` },
]);

const upper = (id) => String(id).toUpperCase();

/** The direction a selected element stands for — the tile in it, or its artboard — or null. */
export function directionIdOf(el) {
  const a = el?.attrs?.['data-ds-direction'];
  if (typeof a === 'string' && /^[a-z]{1,8}$/.test(a)) return a;
  const screen =
    el?.attrs?.['data-dc-screen'] ??
    (typeof el?.selector === 'string'
      ? /^\[data-dc-screen="([^"]+)"\]$/.exec(el.selector)?.[1]
      : null);
  const m = /^ds-dir-([a-z]{1,8})$/.exec(typeof screen === 'string' ? screen : '');
  return m ? m[1] : null;
}

/**
 * May this person pick or mix here? The Inspector's generic `editable` wants an element id, and the pick board 13
 * draws is the direction's ARTBOARD (no id): the bar came up greyed. A direction writes through /_api/ds/make, so only
 * read-only access turns it off (the server refuses a viewer anyway). A frame without `readOnly` keeps `editable`.
 */
export function directionEditable(ctx) {
  if (!ctx) return true;
  if (typeof ctx.readOnly === 'boolean') return !ctx.readOnly;
  return ctx.editable !== false;
}

export const isDsDirection = (selection) => {
  const el = singleOf(selection);
  return !!el && directionIdOf(el) !== null;
};

/** "A + B’s type + C’s colours" for the line under the buttons; '' when nothing is taken. */
export function mixSummary(base, takes, directions) {
  const parts = Object.entries(takes).map(([word, from]) => {
    const part = MIX_PARTS.find((p) => p.word === word);
    return part ? part.label(upper(from)) : `${upper(from)}’s ${word}`;
  });
  return parts.length ? [upper(base), ...parts].join(' + ') : '';
  // `directions` is kept in the signature for callers that name them
}

/**
 * The panel for ONE direction. Exported for tests with an injected model and writers.
 * @param {{ id: string, ds: string, model: any, editable?: boolean,
 *           onUse: (a: { ds: string, direction: string }) => Promise<any>,
 *           onMix: (a: { ds: string, base: string, take: Record<string,string> }) => Promise<any>,
 *           onRefresh?: () => Promise<any> }} props
 */
export function DirectionPanel({ id, ds, model, editable = true, onUse, onMix, onRefresh }) {
  const directions = model?.directions ?? [];
  const mine = directions.find((d) => d.direction === id) ?? null;
  const others = directions.filter((d) => d.direction !== id);
  const [open, setOpen] = useState(false);
  const [takes, setTakes] = useState({});
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  // another direction is another pick: start clean
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selected direction is the trigger
  useEffect(() => {
    setOpen(false);
    setTakes({});
    setNote(null);
  }, [id]);

  const toggle = useCallback(
    (word, from) =>
      setTakes((t) => {
        const next = { ...t };
        if (next[word] === from) delete next[word];
        else next[word] = from;
        return next;
      }),
    []
  );

  if (!model) return null;
  const making = model.making === true;
  const mixing = Object.keys(takes).length > 0;
  const summary = mixSummary(id, takes, directions);

  const go = async () => {
    if (busy || !mine) return;
    setBusy(true);
    setNote(null);
    const r = mixing
      ? await onMix({ ds, base: id, take: takes })
      : await onUse({ ds, direction: id });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setTakes({});
      setNote({
        tone: 'ok',
        text: mixing ? DIRECTION_WORDS.mixed(upper(id)) : DIRECTION_WORDS.using(upper(id)),
      });
      await onRefresh?.();
    } else {
      setNote({ tone: 'warn', text: r.message });
      await onRefresh?.();
    }
  };

  return (
    <section
      className="insp-sec ds-tk ds-dirbar"
      data-testid="ds-dir-bar"
      data-direction={id}
      aria-label={mine ? `Direction ${upper(id)} · ${mine.label}` : `Direction ${upper(id)}`}
    >
      <p className="insp-sec-t">
        <span className="insp-sec-name" data-testid="ds-dir-name">
          {mine ? `Direction ${upper(id)} · ${mine.label}` : `Direction ${upper(id)}`}
        </span>
        {mine?.picked ? (
          <span className="insp-sec-a" data-testid="ds-dir-picked">
            {DIRECTION_WORDS.picked}
          </span>
        ) : null}
      </p>
      {mine?.mood ? <Quiet testid="ds-dir-mood">{mine.mood}</Quiet> : null}
      {!mine ? (
        <Quiet testid="ds-dir-waiting">AI has not drawn this one yet.</Quiet>
      ) : !making ? (
        <Quiet testid="ds-dir-made">{DIRECTION_WORDS.made}</Quiet>
      ) : (
        <>
          <div className="ds-dirbar-acts">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!editable || busy}
              data-testid="ds-dir-use"
              onClick={go}
            >
              {mixing ? DIRECTION_WORDS.useMix : DIRECTION_WORDS.use(upper(id))}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              aria-expanded={open}
              aria-haspopup="menu"
              disabled={!editable || others.length === 0}
              title={others.length === 0 ? DIRECTION_WORDS.alone : undefined}
              data-testid="ds-dir-mix"
              onClick={() => setOpen((v) => !v)}
            >
              {DIRECTION_WORDS.mix}
            </button>
          </div>
          {open ? (
            <div className="ds-dirbar-menu" role="menu" data-testid="ds-dir-mix-menu">
              {others.map((o) => (
                // biome-ignore lint/a11y/useSemanticElements: a labelled group of menu items, not a form fieldset
                <div key={o.direction} className="ds-dirbar-grp" role="group">
                  <p className="ds-dirbar-gl">
                    From {upper(o.direction)} · {o.label}
                  </p>
                  {MIX_PARTS.map((p) => {
                    const on = takes[p.word] === o.direction;
                    return (
                      <button
                        key={p.word}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={on}
                        className="ds-dirbar-it"
                        data-testid={`ds-dir-mix-${p.word}-${o.direction}`}
                        onClick={() => toggle(p.word, o.direction)}
                      >
                        {p.label(upper(o.direction))}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
          {summary ? <Quiet testid="ds-dir-summary">{summary}</Quiet> : null}
        </>
      )}
      {note ? (
        <p
          className="insp-quiet ds-tk-note"
          role="status"
          data-testid="ds-dir-note"
          data-tone={note.tone}
        >
          {note.text}
        </p>
      ) : null}
    </section>
  );
}

function DirectionBody({ el, ctx }) {
  const id = directionIdOf(el);
  const ds = useMemo(() => systemOfCanvas(ctx?.canvasFile, ctx?.cfg), [ctx?.canvasFile, ctx?.cfg]);
  const { model, loading, refresh } = useDsBoard(ds, id ?? '');
  if (!id) return null;
  if (!ds) return <Quiet testid="ds-dir-nosystem">{DIRECTION_WORDS.noSystem}</Quiet>;
  if (!model)
    return (
      <Quiet testid="ds-dir-loading">
        {loading ? 'Reading the system…' : 'The system isn’t available.'}
      </Quiet>
    );
  return (
    <DirectionPanel
      id={id}
      ds={ds}
      model={model}
      editable={directionEditable(ctx)}
      onUse={useDirection}
      onMix={mixDirections}
      onRefresh={refresh}
    />
  );
}

let offs = [];

/** Register the kind and its block (idempotent; tests that unregistered call it again). */
export function registerDsDirectionKind() {
  if (offs.length) return;
  offs = [
    registerKind({
      id: 'ds-direction',
      order: 3,
      bare: true,
      label: 'Direction',
      match: isDsDirection,
    }),
    registerBlock({
      id: 'ds.direction',
      kinds: ['ds-direction'],
      at: 'top',
      order: 10,
      Body: DirectionBody,
    }),
  ];
}

export const offDsDirection = () => {
  for (const off of offs) off();
  offs = [];
};

registerDsDirectionKind();
